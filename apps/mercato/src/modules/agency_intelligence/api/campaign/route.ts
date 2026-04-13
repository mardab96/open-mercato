import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import OpenAI from 'openai'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agency_intelligence.view'] },
  POST: { requireAuth: true, requireFeatures: ['agency_intelligence.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const postBodySchema = z.object({
  client_profile_id: z.string().uuid(),
})

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      tags: ['Agency Intelligence'],
      summary: 'Get campaign plan for a client',
      responses: [
        { status: 200, description: 'Campaign plan or null' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
    POST: {
      tags: ['Agency Intelligence'],
      summary: 'Generate a campaign plan for a client',
      requestBody: { schema: postBodySchema },
      responses: [
        { status: 200, description: 'Plan generation started' },
        { status: 400, description: 'Validation error' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Client not found' },
      ],
    },
  },
}

const CAMPAIGN_PLAN_SYSTEM_PROMPT = `Jesteś senior performance marketing strategist z 15-letnim doświadczeniem. Tworzysz szczegółowy plan kampanii płatnych dla agencji.

Na podstawie dostarczonych danych klienta wygeneruj plan kampanii jako obiekt JSON z dokładnie 4 kluczami.

ZASADY:
- Pisz po polsku
- Bądź konkretny — podawaj liczby, kanały, przykłady oparte na rzeczywistych danych klienta
- Jeśli w danych klienta podano preferowane kanały, UŻYJ ICH (nie zakładaj domyślnych)
- Jeśli podano budżet, uwzględnij go wprost
- Jeśli brak danych, zaznacz "⚠️ do uzupełnienia"
- Każda sekcja: 20-40 linii Markdown

Odpowiedź MUSI być prawidłowym JSON-em (bez code blocków, bez dodatkowego tekstu):
{
  "channel_breakdown": "## Podział kanałów i budżetu\\n\\n[treść Markdown — alokacja % na kanał, uzasadnienie, priorytety]",
  "creative_briefs": "## Briefy kreatywne\\n\\n[treść Markdown — per kanał: format reklam, przekaz, headliny, CTA, ton of voice]",
  "funnel_stages": "## Etapy lejka\\n\\n[treść Markdown — Awareness / Consideration / Conversion: taktyki, treści, pixel events]",
  "kpis": "## KPIs i cele\\n\\n[treść Markdown — mierzalne cele na 30/60/90 dni, metryki sukcesu, reporting cadence]"
}`

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const clientProfileId = url.searchParams.get('client_profile_id')
  if (!clientProfileId) return NextResponse.json({ error: 'client_profile_id is required' }, { status: 400 })

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const row = await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:campaign_plan')
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .whereRaw(`doc->>'client_profile_id' = ?`, [clientProfileId])
      .orderBy('created_at', 'desc')
      .first('entity_id', 'doc', 'created_at', 'updated_at')

    if (!row) return NextResponse.json({ plan: null })

    const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc
    return NextResponse.json({ plan: { id: row.entity_id, ...doc } })
  } catch (e) {
    console.error('[campaign] GET error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = postBodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const { client_profile_id } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const profileRow = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:client_profile')
      .where('entity_id', client_profile_id)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .first('doc', 'organization_id')

    if (!profileRow) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const orgId = profileRow.organization_id
    const profile = typeof profileRow.doc === 'string' ? JSON.parse(profileRow.doc) : profileRow.doc

    const entityId = randomUUID()
    const now = new Date()

    const initialDoc = {
      client_profile_id,
      status: 'generating',
      channel_breakdown: null,
      creative_briefs: null,
      funnel_stages: null,
      kpis: null,
      generated_at: null,
    }

    await knex('custom_entities_storage').insert({
      entity_type: 'agency_intelligence:campaign_plan',
      entity_id: entityId,
      tenant_id: auth.tenantId,
      organization_id: orgId,
      doc: JSON.stringify(initialDoc),
      created_at: now,
      updated_at: now,
    })

    void generateCampaignPlan(knex, entityId, client_profile_id, orgId, auth.tenantId, profile)

    return NextResponse.json({ id: entityId, status: 'generating' })
  } catch (e) {
    console.error('[campaign] POST error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function buildClientContext(
  knex: Knex,
  clientProfileId: string,
  orgId: string,
  tenantId: string,
  profile: Record<string, unknown>
): Promise<string> {
  const sections: string[] = []

  sections.push(`KLIENT: ${profile.company_name || 'nieznany'}`)
  sections.push(`BRANŻA: ${profile.industry || 'nieznana'}`)
  sections.push(`BUDŻET MIESIĘCZNY: ${profile.monthly_ad_budget ? `${profile.monthly_ad_budget} PLN` : 'nieznany'}`)
  sections.push(`DOCELOWY ROAS: ${profile.target_roas || 'nieznany'}`)
  sections.push(`MARŻA: ${profile.gross_margin_pct ? `${profile.gross_margin_pct}%` : 'nieznana'}`)

  const auditRow = await knex('custom_entities_storage')
    .where('entity_type', 'agency_onboarding:ai_audit')
    .where('organization_id', orgId)
    .where('tenant_id', tenantId)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .first('doc')

  if (auditRow?.doc) {
    const audit = typeof auditRow.doc === 'string' ? JSON.parse(auditRow.doc) : auditRow.doc
    if (audit.recommended_strategy) {
      sections.push(`\n--- AUDYT AI ---\n${audit.recommended_strategy.slice(0, 6000)}`)
    }
  }

  const audienceRow = await knex('custom_entities_storage')
    .where('entity_type', 'agency_onboarding:target_audience')
    .where('organization_id', orgId)
    .where('tenant_id', tenantId)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .first('doc')

  if (audienceRow?.doc) {
    const audience = typeof audienceRow.doc === 'string' ? JSON.parse(audienceRow.doc) : audienceRow.doc
    if (audience.audience_summary) {
      sections.push(`\n--- WYWIAD AI / GRUPA DOCELOWA ---\n${audience.audience_summary.slice(0, 3000)}`)
    }
    if (audience.channels?.length) {
      sections.push(`PREFEROWANE KANAŁY: ${audience.channels.join(', ')}`)
    }
  }

  const competitorRows = await knex('custom_entities_storage')
    .where('entity_type', 'agency_onboarding:competitor_domain')
    .where('tenant_id', tenantId)
    .whereNull('deleted_at')
    .whereRaw(`doc->>'client_profile_id' = ?`, [clientProfileId])
    .whereRaw(`doc->>'status' = ?`, ['done'])
    .select('doc')
    .limit(3)

  if (competitorRows.length > 0) {
    const competitorSummaries = competitorRows
      .map((row) => {
        const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc
        return `### ${doc.display_name || doc.url}\n${(doc.audit_results || '').slice(0, 1000)}`
      })
      .join('\n\n')
    sections.push(`\n--- ANALIZA KONKURENCJI ---\n${competitorSummaries}`)
  }

  return sections.join('\n')
}

function parsePlanSections(content: string): {
  channel_breakdown: string
  creative_briefs: string
  funnel_stages: string
  kpis: string
} {
  const empty = { channel_breakdown: '', creative_briefs: '', funnel_stages: '', kpis: '' }

  // Strip code block wrappers GPT sometimes adds
  const cleaned = content
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim()

  try {
    const parsed = JSON.parse(cleaned)
    return {
      channel_breakdown: typeof parsed.channel_breakdown === 'string' ? parsed.channel_breakdown : '',
      creative_briefs: typeof parsed.creative_briefs === 'string' ? parsed.creative_briefs : '',
      funnel_stages: typeof parsed.funnel_stages === 'string' ? parsed.funnel_stages : '',
      kpis: typeof parsed.kpis === 'string' ? parsed.kpis : '',
    }
  } catch {
    console.error('[campaign] Failed to parse JSON response, raw length:', content.length)
    return empty
  }
}

async function generateCampaignPlan(
  knex: Knex,
  entityId: string,
  clientProfileId: string,
  orgId: string,
  tenantId: string,
  profile: Record<string, unknown>
) {
  try {
    const context = await buildClientContext(knex, clientProfileId, orgId, tenantId, profile)

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      throw new Error('OPENAI_API_KEY is not configured')
    }

    const model = process.env.AGENCY_AUDIT_MODEL || 'gpt-4o'
    const client = new OpenAI({ apiKey, timeout: 120000 })

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: CAMPAIGN_PLAN_SYSTEM_PROMPT },
        { role: 'user', content: context },
      ],
      temperature: 0.6,
      max_tokens: 8000,
    })

    const content = response.choices[0]?.message?.content || ''
    const sections = parsePlanSections(content)

    await knex('custom_entities_storage')
      .where('entity_id', entityId)
      .where('tenant_id', tenantId)
      .update({
        doc: JSON.stringify({
          client_profile_id: clientProfileId,
          status: 'ready',
          ...sections,
          generated_at: new Date().toISOString(),
        }),
        updated_at: new Date(),
      })
  } catch (e) {
    console.error('[campaign] Generation failed:', e)
    await knex('custom_entities_storage')
      .where('entity_id', entityId)
      .where('tenant_id', tenantId)
      .update({
        doc: JSON.stringify({
          client_profile_id: clientProfileId,
          status: 'failed',
          channel_breakdown: null,
          creative_briefs: null,
          funnel_stages: null,
          kpis: null,
          generated_at: null,
        }),
        updated_at: new Date(),
      })
  }
}

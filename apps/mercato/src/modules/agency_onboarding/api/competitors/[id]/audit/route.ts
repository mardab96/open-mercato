import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import OpenAI from 'openai'
import { scrapeWebsite } from '../../../../lib/web-scraper'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agency_onboarding.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    POST: {
      tags: ['Agency Onboarding'],
      summary: 'Trigger AI audit for a competitor domain',
      responses: [
        { status: 200, description: 'Audit triggered' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Competitor domain not found' },
      ],
    },
  },
}

const COMPETITOR_ANALYSIS_PROMPT = `Jesteś ekspertem od analizy konkurencji w performance marketingu.

Na podstawie zeskrapowanej strony WWW konkurenta przygotuj zwięzłą analizę po polsku (max 80 linii Markdown):

## Analiza Konkurenta: [NAZWA/URL]

### 1. Pozycjonowanie i oferta
- Co sprzedają? Jakie segmenty obsługują?
- Wyróżniki komunikacji (USP)

### 2. Kanały i taktyki marketingowe
- Widoczne kanały (social media, SEO, reklamy)
- Ton komunikacji i styl reklam

### 3. Słabe i mocne strony
- **Mocne strony**: (2-3 punkty)
- **Słabe strony / luki**: (2-3 punkty)

### 4. Szanse dla naszego klienta
- Jak można się wyróżnić / zagospodarować niszę?

Pisz konkretnie. Nie wymyślaj danych. Jeśli brak informacji, zaznacz "⚠️ brak danych".`

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const competitorId = params.id

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const row = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:competitor_domain')
      .where('entity_id', competitorId)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .first('entity_id', 'doc')

    if (!row) return NextResponse.json({ error: 'Competitor domain not found' }, { status: 404 })

    const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc
    const competitorUrl = doc.url

    await knex('custom_entities_storage')
      .where('entity_id', competitorId)
      .where('tenant_id', auth.tenantId)
      .update({ doc: JSON.stringify({ ...doc, status: 'scraping' }), updated_at: new Date() })

    // Run audit in background (fire-and-forget)
    void runCompetitorAudit(knex, competitorId, competitorUrl, doc, auth.tenantId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[competitors/audit] Error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function runCompetitorAudit(
  knex: Knex,
  competitorId: string,
  competitorUrl: string,
  existingDoc: Record<string, unknown>,
  tenantId: string
) {
  try {
    const scrapeResult = await scrapeWebsite(competitorUrl)
    const scrapedContent = scrapeResult.success
      ? scrapeResult.pages.map((p) => `### ${p.title}\n${p.content}`).join('\n\n').slice(0, 12000)
      : null

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      throw new Error('OPENAI_API_KEY is not configured')
    }

    const model = process.env.AGENCY_AUDIT_MODEL || 'gpt-4o'
    const client = new OpenAI({ apiKey, timeout: 60000 })

    const userMessage = scrapedContent
      ? `URL: ${competitorUrl}\n\n--- TREŚĆ STRONY ---\n${scrapedContent}`
      : `URL: ${competitorUrl}\n\n⚠️ Nie udało się pobrać treści strony.`

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: COMPETITOR_ANALYSIS_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.5,
      max_tokens: 2000,
    })

    const auditResults = response.choices[0]?.message?.content || ''

    await knex('custom_entities_storage')
      .where('entity_id', competitorId)
      .where('tenant_id', tenantId)
      .update({
        doc: JSON.stringify({ ...existingDoc, status: 'done', audit_results: auditResults }),
        updated_at: new Date(),
      })
  } catch (e) {
    console.error('[competitors/audit] Background audit failed:', e)
    await knex('custom_entities_storage')
      .where('entity_id', competitorId)
      .where('tenant_id', tenantId)
      .update({
        doc: JSON.stringify({ ...existingDoc, status: 'failed' }),
        updated_at: new Date(),
      })
  }
}

import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import OpenAI from 'openai'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agency_onboarding.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(5000),
})

const bodySchema = z.object({
  client_profile_id: z.string().uuid(),
  messages: z.array(messageSchema).max(30),
})

export const openApi: OpenApiRouteDoc = {
  methods: {
    POST: {
      tags: ['Agency Onboarding'],
      summary: 'Run one turn of the AI client interview',
      requestBody: { schema: bodySchema },
      responses: [
        { status: 200, description: 'Interview response' },
        { status: 400, description: 'Validation error' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}

function buildInterviewerPrompt(auditDocument: string | null, companyName: string): string {
  const auditSection = auditDocument
    ? `ISTNIEJĄCY AUDYT KLIENTA (na podstawie analizy strony WWW):
---
${auditDocument.slice(0, 6000)}
---`
    : `BRAK AUDYTU — strona WWW klienta nie była jeszcze analizowana.`

  return `Jesteś doświadczonym strategiem performance marketingu prowadzącym wywiad z klientem agencji reklamowej.

KLIENT: ${companyName}

${auditSection}

TWOJE ZADANIE:
Uzupełnij wyłącznie dane których AI NIE MOŻE POBRAĆ AUTOMATYCZNIE ze strony WWW ani z połączonych kont reklamowych.

ZASADY ADAPTYWNE:
- Przeanalizuj audyt powyżej. Jeśli dana informacja jest już zawarta i wiarygodna — NIE pytaj o nią ponownie. Jeśli informacja ze strony jest niepewna/ogólna — możesz ją potwierdzić krótko ("Z Twojej strony widzę X — czy to aktualne?"), ale nie zadawaj otwartego pytania o coś co już masz.
- Sekcje z "⚠️ BRAK DANYCH" = pytaj o nie.
- NIE pytaj o: tracking/analytics (pobieramy z kont), wyniki dotychczasowych kampanii (z kont), GA4.
- ZAWSZE pytaj o (tych danych AI nigdy nie pobierze): budżet reklamowy, docelowy ROAS/CPA, marżę brutto, kluczowe daty/eventy, priorytet kanałów (decyzja strategiczna), WSZYSCY znani klientowi konkurenci.
- Jeśli klient poda budżet całościowy ("20 000 zł na 3 miesiące"), przelicz i potwierdź dosłownie: "Rozumiem — to ~6 700 zł/mies. przez 3 miesiące do [wyliczona data]. Dobrze?"
- Gdy klient mówi "za 3 miesiące" — wylicz konkretną datę i użyj jej.
- Zadawaj PO JEDNYM pytaniu na raz.
- Gdy zebrałeś odpowiedzi na wszystkie luki (zazwyczaj 3-7 pytań, max 10), zakończ pisząc TYLKO: [WYWIAD_ZAKOŃCZONY]

Zacznij od KRÓTKIEGO zdania co już wiesz z audytu (np. "Widzę, że sprzedajesz X dla Y — mam kilka pytań o brakujące dane."), a następnie zadaj pierwsze pytanie.`
}

function buildTranscript(messages: Array<{ role: string; content: string }>): string {
  const qa: string[] = []
  let lastQuestion = ''
  for (const msg of messages) {
    if (msg.role === 'assistant' && !msg.content.includes('[WYWIAD_ZAKOŃCZONY]')) {
      lastQuestion = msg.content
    } else if (msg.role === 'user') {
      qa.push(`PYTANIE: ${lastQuestion}\nODPOWIEDŹ: ${msg.content}`)
    }
  }
  return qa.join('\n\n')
}

const SUMMARY_EXTRACTION_PROMPT = `Na podstawie transkryptu wywiadu z klientem agencji reklamowej wyodrębnij kluczowe informacje i zwróć je jako JSON.

WAŻNE:
- Uwzględnij WSZYSTKICH wymienionych konkurentów (imiona i URL-e)
- Wyodrębnij DOKŁADNY budżet podany przez klienta
- Wyodrębnij DOKŁADNIE te kanały, które klient wskazał jako priorytetowe (nie dodawaj innych)
- Jeśli klient wspomniał cennik, uwzględnij go
- Jeśli klient wspomniał tracking, uwzględnij go

Odpowiedź MUSI być prawidłowym JSON-em (bez code blocków):
{
  "audience_summary": "Markdown: kompletne podsumowanie wywiadu z wszystkimi danymi — produkt, klient docelowy, budżet, cennik, tracking, timeline, USP",
  "personas": "Markdown: szczegółowy opis person kupujących z demografią i zachowaniami",
  "pain_points": "Markdown: lista problemów i potrzeb klientów z wywiadu",
  "buying_triggers": "Markdown: co skłania do zakupu, główne trigery, obiekcje",
  "competitors": "Markdown: lista WSZYSTKICH konkurentów z wywiadu (nazwa + URL jeśli podany)",
  "budget_monthly": "liczba PLN/EUR lub null jeśli nie podano",
  "preferred_channels": ["lista", "kanałów", "jako", "string[]"],
  "tracking_status": "Markdown: status trackingu (GA4, Meta Pixel, GTM itp.)",
  "converting_pages": "Markdown: strony konwertujące i dane o konwersji"
}`

async function buildSummaryWithAI(
  messages: Array<{ role: string; content: string }>,
  client: OpenAI,
  model: string
): Promise<{
  audience_summary: string
  personas: string
  pain_points: string
  buying_triggers: string
  channels: string[]
}> {
  const transcript = buildTranscript(messages)

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SUMMARY_EXTRACTION_PROMPT },
        { role: 'user', content: `TRANSKRYPT WYWIADU:\n\n${transcript}` },
      ],
      temperature: 0.2,
      max_tokens: 3000,
    })

    const raw = (response.choices[0]?.message?.content || '').replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    const parsed = JSON.parse(raw)

    const channelMap: Record<string, string> = {
      'meta ads': 'meta_ads', 'facebook ads': 'meta_ads', 'instagram ads': 'meta_ads',
      'google ads': 'google_ads', 'google search': 'google_ads', 'pmax': 'google_ads',
      'tiktok': 'tiktok_ads', 'tiktok ads': 'tiktok_ads',
      'linkedin': 'linkedin_ads', 'linkedin ads': 'linkedin_ads',
      'email': 'email', 'newsletter': 'email',
      'seo': 'seo', 'programmatic': 'programmatic',
    }

    const channels: string[] = []
    if (Array.isArray(parsed.preferred_channels)) {
      for (const ch of parsed.preferred_channels) {
        const normalized = String(ch).toLowerCase().trim()
        const mapped = channelMap[normalized] || normalized.replace(/\s+/g, '_').replace(/-/g, '_')
        if (!channels.includes(mapped)) channels.push(mapped)
      }
    }

    const budgetNote = parsed.budget_monthly ? `\n\n**Budżet miesięczny**: ${parsed.budget_monthly} PLN/EUR` : ''
    const trackingNote = parsed.tracking_status ? `\n\n**Tracking**: ${parsed.tracking_status}` : ''
    const competitorsNote = parsed.competitors ? `\n\n**Konkurenci**: ${parsed.competitors}` : ''
    const convertingNote = parsed.converting_pages ? `\n\n**Strony konwertujące**: ${parsed.converting_pages}` : ''

    return {
      audience_summary: (parsed.audience_summary || '') + budgetNote + trackingNote + competitorsNote + convertingNote,
      personas: parsed.personas || '⚠️ Brak danych z wywiadu',
      pain_points: parsed.pain_points || '⚠️ Brak danych z wywiadu',
      buying_triggers: parsed.buying_triggers || '⚠️ Brak danych z wywiadu',
      channels: channels.length > 0 ? channels : ['google_ads', 'meta_ads'],
    }
  } catch (e) {
    console.error('[interview] Summary extraction failed, using fallback:', e)
    const transcript = buildTranscript(messages)
    return {
      audience_summary: `## Transkrypt wywiadu\n\n${transcript}`,
      personas: '⚠️ Nie udało się wyodrębnić — sprawdź transkrypt powyżej',
      pain_points: '⚠️ Nie udało się wyodrębnić — sprawdź transkrypt powyżej',
      buying_triggers: '⚠️ Nie udało się wyodrębnić — sprawdź transkrypt powyżej',
      channels: ['google_ads', 'meta_ads'],
    }
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const { client_profile_id, messages } = parsed.data

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const knex = getKnex(em)

  const profileRow = await knex('custom_entities_storage')
    .where('entity_type', 'agency_onboarding:client_profile')
    .where('entity_id', client_profile_id)
    .where('tenant_id', auth.tenantId)
    .whereNull('deleted_at')
    .first('doc', 'entity_id', 'organization_id')

  if (!profileRow) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const profile = typeof profileRow.doc === 'string' ? JSON.parse(profileRow.doc) : profileRow.doc
  const companyName = profile?.company_name || 'klient'
  const orgId = profileRow.organization_id

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant')
  const isDone = lastAssistantMsg?.content.includes('[WYWIAD_ZAKOŃCZONY]')

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 500 })
  }

  const model = process.env.AGENCY_AUDIT_MODEL || 'gpt-4o'
  const client = new OpenAI({ apiKey, timeout: 30000 })

  if (isDone) {
    const summary = await buildSummaryWithAI(messages, client, model)
    return NextResponse.json({ message: '', done: true, summary })
  }

  // Fetch existing audit document to build context-aware prompt
  let auditDocument: string | null = null
  try {
    const auditRow = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:ai_audit')
      .where('organization_id', orgId)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .first('doc')

    if (auditRow?.doc) {
      const auditDoc = typeof auditRow.doc === 'string' ? JSON.parse(auditRow.doc) : auditRow.doc
      auditDocument = auditDoc?.recommended_strategy || null
    }
  } catch (e) {
    console.warn('[interview] Could not fetch audit:', e)
  }

  const systemPrompt = buildInterviewerPrompt(auditDocument, companyName)

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ]

  try {
    const response = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      temperature: 0.6,
      max_tokens: 600,
    })

    const message = response.choices[0]?.message?.content || ''
    const done = message.includes('[WYWIAD_ZAKOŃCZONY]')

    if (done) {
      const allMessages = [...messages, { role: 'assistant' as const, content: message }]
      const summary = await buildSummaryWithAI(allMessages, client, model)
      return NextResponse.json({ message, done: true, summary })
    }

    return NextResponse.json({ message, done: false })
  } catch (e) {
    console.error('[interview] OpenAI error:', e)
    return NextResponse.json({ error: 'AI service error' }, { status: 500 })
  }
}

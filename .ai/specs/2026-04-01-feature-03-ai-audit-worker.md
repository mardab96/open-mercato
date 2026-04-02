# Feature 03 — Asynchronous AI Audit Worker

| Field       | Value |
|------------|-------|
| **Status** | Approved |
| **Created** | 2026-04-01 |
| **Phase** | Etap 3 — Asynchroniczny Audyt AI |
| **Depends on** | Feature 01 (Data Model), Feature 02 (UI) |

---

## TLDR

Po utworzeniu rekordu `client_profile` system emituje event, subscriber przechwytuje go i dodaje job do kolejki. Worker w tle pobiera URL klienta + treść załączonych plików, wysyła do OpenAI (gpt-4o), odbiera ustrukturyzowaną odpowiedź w Markdown i zapisuje wyniki do Custom Entities `ai_audit` oraz `target_audience`. Cała logika w module `agency_onboarding` — zero zmian w core.

---

## Architecture Overview

```
┌─ UI (page.tsx) ─────────────────────────────────┐
│ POST /api/entities/records                       │
│ → creates client_profile record                  │
│ → emits agency_onboarding.client_profile.created │
└──────────────────────────────────────────────────┘
                    │
                    ▼
┌─ Event Bus ──────────────────────────────────────┐
│ agency_onboarding.client_profile.created          │
└──────────────────────────────────────────────────┘
                    │
                    ▼
┌─ Subscriber: audit-trigger.ts ───────────────────┐
│ persistent: true                                  │
│ → enqueues job to "agency-onboarding-ai-audit"   │
│   payload: { recordId, entityId, tenantId, orgId }│
└──────────────────────────────────────────────────┘
                    │
                    ▼
┌─ Worker: ai-audit.worker.ts ─────────────────────┐
│ queue: "agency-onboarding-ai-audit"               │
│ concurrency: 2 (I/O-bound, API calls)            │
│                                                   │
│ 1. Fetch client_profile record (website_url)      │
│ 2. Fetch attachments + extracted text content     │
│ 3. Build prompt with context                      │
│ 4. Call OpenAI gpt-4o via SDK                     │
│ 5. Parse structured response                      │
│ 6. Create/update ai_audit record (Markdown)       │
│ 7. Create/update target_audience record (Markdown) │
│ 8. Update client_profile.onboarding_status        │
│ 9. Emit agency_onboarding.audit.completed         │
└──────────────────────────────────────────────────┘
```

---

## Design Decisions

| # | Decision | Resolution | Rationale |
|---|----------|-----------|-----------|
| 1 | Event emission — from API route vs from UI | **From UI page.tsx** — emit event after successful POST response | Custom Entity CRUD (`/api/entities/records`) nie emituje eventów automatycznie. Alternatywnie: API interceptor. Prostsze: emit z page.tsx po sukcesie. |
| 2 | Subscriber vs direct queue enqueue | **Subscriber → Queue** | Decoupling. Subscriber reaguje na event, worker przetwarza. Zgodne z wzorcem Open Mercato. |
| 3 | OpenAI SDK vs raw fetch | **Oficjalne SDK `openai`** | Type safety, retry logic, streaming support. Już w package.json (ai-assistant module). |
| 4 | Jeden worker vs wiele | **Jeden worker** z sekwencyjnymi krokami | MVP — prostsze debugowanie. Podział na mikro-workery w przyszłości. |
| 5 | Zapis wyników — nadpisanie vs append | **Nadpisanie** (upsert) | Zgodnie z decyzją z Feature 01: główne pole nadpisywane, historia via Action Log. |
| 6 | Queue strategy | **Local** (dev) / **Async** (prod) | Domyślny `QUEUE_STRATEGY=local` działa bez Redis. BullMQ gotowy na produkcję. |
| 7 | Concurrency | **2** | I/O-bound (OpenAI API call ~10-30s), ale limitujemy ze względu na rate limits API i koszty. |

---

## Files to Create

```
apps/mercato/src/modules/agency_onboarding/
├── events.ts                          # Event declarations
├── subscribers/
│   └── audit-trigger.ts               # Subscriber: event → queue job
├── workers/
│   └── ai-audit.worker.ts             # Worker: AI audit execution
└── lib/
    └── ai-audit-service.ts            # OpenAI integration logic
```

---

## 1. Event Declaration (`events.ts`)

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'agency_onboarding.client_profile.created',
    label: 'Client Profile Created',
    entity: 'client_profile',
    category: 'crud',
  },
  {
    id: 'agency_onboarding.audit.completed',
    label: 'AI Audit Completed',
    entity: 'ai_audit',
    category: 'lifecycle',
  },
  {
    id: 'agency_onboarding.audit.failed',
    label: 'AI Audit Failed',
    entity: 'ai_audit',
    category: 'lifecycle',
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'agency_onboarding',
  events,
})
export const emitOnboardingEvent = eventsConfig.emit
export type OnboardingEventId = typeof events[number]['id']
export default eventsConfig
```

---

## 2. Event Trigger — z UI (`page.tsx`)

Po pomyślnym `POST /api/entities/records`, strona emituje event via dedykowany endpoint:

```typescript
// Po successful POST:
await apiCall('/api/events/emit', {
  method: 'POST',
  body: JSON.stringify({
    event: 'agency_onboarding.client_profile.created',
    payload: { recordId, entityId: ENTITY_ID, tenantId, organizationId },
  }),
})
```

**Alternatywa (lepsza architektonicznie):** API Interceptor na `POST /api/entities/records` — przechwytuje tworzenie rekordów z `entityId === 'agency_onboarding:client_profile'` i emituje event server-side. Do rozważenia przy implementacji.

---

## 3. Subscriber (`subscribers/audit-trigger.ts`)

```typescript
export const metadata = {
  event: 'agency_onboarding.client_profile.created',
  persistent: true,
  id: 'agency-onboarding-audit-trigger',
}

export default async function handler(payload, ctx) {
  const queue = ctx.resolve('queueFactory')
    .create('agency-onboarding-ai-audit')
  
  await queue.enqueue({
    recordId: payload.recordId,
    entityId: payload.entityId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })
}
```

---

## 4. Worker (`workers/ai-audit.worker.ts`)

```typescript
export const metadata = {
  queue: 'agency-onboarding-ai-audit',
  id: 'agency-onboarding:ai-audit',
  concurrency: 2,
}

export default async function handler(job, ctx) {
  // 1. Fetch client_profile record
  // 2. Fetch attachments + content
  // 3. Call AI audit service
  // 4. Save ai_audit record
  // 5. Save target_audience record
  // 6. Update onboarding_status → 'completed'
  // 7. Emit audit.completed event
}
```

---

## 5. AI Audit Service (`lib/ai-audit-service.ts`)

### Input
- `websiteUrl: string` — adres WWW klienta
- `attachmentContents: string[]` — teksty wyekstrahowane z załączników (pole `content` z Attachment)
- `companyName: string`

### OpenAI Call
- Model: `gpt-4o` (konfigurowalny via env `AGENCY_AUDIT_MODEL`)
- API Key: `process.env.OPENAI_API_KEY` (już w `.env.example`)
- SDK: `openai` (oficjalne SDK Node.js)
- System prompt z instrukcjami generowania audytu

### Prompt Structure
```
SYSTEM: You are a senior performance marketing strategist.
Analyze the following client data and produce a comprehensive audit.

CLIENT: {companyName}
WEBSITE: {websiteUrl}
UPLOADED MATERIALS:
{attachmentContents joined}

Respond in the following JSON structure:
{
  "ai_audit": {
    "website_analysis": "## Markdown...",
    "competitor_analysis": "## Markdown...",
    "communication_style": "## Markdown...",
    "swot": "## Markdown...",
    "recommended_strategy": "## Markdown..."
  },
  "target_audience": {
    "audience_summary": "## Markdown...",
    "personas": "## Markdown...",
    "pain_points": "## Markdown...",
    "buying_triggers": "## Markdown...",
    "channels": ["google_ads", "meta_ads"]
  }
}
```

### Output
- Structured JSON parsed from OpenAI response
- Each field contains Markdown text
- `channels` is an array of string identifiers

### Error Handling
- OpenAI timeout: 120s (configurable via `AGENCY_AUDIT_TIMEOUT_MS`)
- Retry: handled by queue system (persistent job)
- On failure: emit `agency_onboarding.audit.failed`, update status to `draft`
- Idempotent: checking `onboarding_status` before processing (skip if already `completed`)

---

## 6. Saving Results

Worker saves results using existing Custom Entity records API (internal):

```
POST /api/entities/records
{ entityId: "agency_onboarding:ai_audit", values: { ...audit fields } }

POST /api/entities/records
{ entityId: "agency_onboarding:target_audience", values: { ...audience fields } }

PUT /api/entities/records
{ entityId: "agency_onboarding:client_profile", recordId, values: { onboarding_status: "completed" } }
```

Alternatively, use DataEngine directly via DI (`ctx.resolve('dataEngine')`).

---

## 7. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required) | OpenAI API key — already in `.env.example` |
| `AGENCY_AUDIT_MODEL` | `gpt-4o` | Model for audit generation |
| `AGENCY_AUDIT_TIMEOUT_MS` | `120000` | Timeout for OpenAI call |

---

## 8. Dependency: `openai` SDK

Sprawdzić czy `openai` jest już w zależnościach. Moduł `ai-assistant` używa Anthropic/OpenAI — SDK prawdopodobnie dostępny. Jeśli nie: `yarn workspace @open-mercato/app add openai`.

---

## Post-Implementation Commands

```bash
yarn generate         # Register events, subscribers, workers
yarn build:packages   # Rebuild monorepo
yarn dev              # Restart — worker auto-spawns with AUTO_SPAWN_WORKERS=true
```

---

## Scope Exclusions (Etap 3)

- **Brak web scraping** — worker NIE pobiera zawartości strony WWW (do dodania w Etapie 4 via Firecrawl/Puppeteer)
- **Brak progress indicator** w UI — MVP, użytkownik widzi status `in_progress` → `completed`
- **Brak retry UI** — ponowne uruchomienie audytu ręcznie (Etap 4+)
- **Brak streaming** — pełna odpowiedź, nie token-by-token

---

## Backward Compatibility

Żadne ryzyko — nowe pliki w istniejącym module. Brak modyfikacji core.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-01 | Initial spec: Event → Subscriber → Worker pipeline. Approved. |
| 2026-04-01 | Worker registration issue: @app modules don't register workers. Moved logic to persistent subscriber. |
| 2026-04-01 | Fixed SQL: replaced raw $1/$2 placeholders with Knex query builder. Removed retry loop (graceful failure). |
| 2026-04-02 | Etap 7: Added granular statuses (scraping_website, ai_analyzing, failed). Polling UI with progress bar. |

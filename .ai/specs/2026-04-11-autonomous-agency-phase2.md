# Autonomous Agency — Phase 2: AI Interview, Multi-Domain Audit, Campaign Plan, Human-in-the-Loop

## TLDR

Extends the autonomous agency system with five new capabilities: Pipeboard MCP integration for ads execution, AI-driven client interview, multi-domain competitor audit, campaign plan generation, and human-in-the-loop approval for agent actions.

---

## Overview

Phase 1 delivered: agency_onboarding (scraping + AI audit) and agency_intelligence (connection registry + agent action log). Phase 2 closes the loop by enabling AI agents to interview clients, audit competitor domains, generate structured campaign plans, and propose ad-platform actions that operators can approve and mock-execute.

---

## Problem Statement

After Phase 1, the system can scrape a website and produce an AI audit, but:
- Operators cannot interactively enrich client data via conversation
- There is no structured way to audit competitor domains
- Agent action cards have no approve/execute UX
- No campaign plan is generated from the gathered data
- AI agents cannot call ads-platform APIs (Google Ads, Meta Ads)

---

## Proposed Solution

| Feature | Approach |
|---------|----------|
| Pipeboard MCP | Add remote MCP server entry in opencode.jsonc.example; zero code changes |
| Human-in-loop | Approve/Skip/Execute buttons on agent action cards; uses existing PATCH endpoint |
| AI Interview | New chat page + POST /api/agency_onboarding/interview + audience save endpoint |
| Multi-domain audit | New custom entity + GET/POST /api/agency_onboarding/competitors + trigger audit endpoint |
| Campaign plan | New custom entity + POST /api/agency_intelligence/campaign + new campaign plan page |

---

## Architecture

All data is stored in `custom_entities_storage` (JSONB). All API routes follow the existing pattern: `getAuthFromRequest` → `createRequestContainer` → knex queries filtered by `tenant_id`.

```
operator
  │
  ├── /backend/agency_onboarding/interview/[id]   ← new AI interview page
  │     └── POST /api/agency_onboarding/interview  ← GPT-4o conversation driver
  │     └── POST /api/agency_onboarding/audience   ← saves interview summary
  │
  ├── /backend/agency_onboarding/[id]             ← +Competitors tab (existing page extended)
  │     ├── GET  /api/agency_onboarding/competitors?client_profile_id=x
  │     ├── POST /api/agency_onboarding/competitors
  │     └── POST /api/agency_onboarding/competitors/[id]/audit
  │
  ├── /backend/agency_intelligence/[id]           ← +approve/execute buttons
  │     └── PATCH /api/agency_intelligence/actions/[id]  ← already exists
  │
  └── /backend/agency_intelligence/campaign/[id]  ← new campaign plan page
        ├── GET  /api/agency_intelligence/campaign?client_profile_id=x
        └── POST /api/agency_intelligence/campaign
```

---

## Data Models

### New entity: `agency_onboarding:competitor_domain`

| Field | Kind | Notes |
|-------|------|-------|
| client_profile_id | text | FK to client_profile entity_id |
| url | text | Competitor URL |
| display_name | text | Optional label |
| status | select | pending, scraping, done, failed |
| is_ai_suggested | text | 'true'/'false' string |
| audit_results | multiline/markdown | AI-generated competitor analysis |

### New entity: `agency_intelligence:campaign_plan`

| Field | Kind | Notes |
|-------|------|-------|
| client_profile_id | text | FK to client_profile entity_id |
| status | select | draft, generating, ready, failed |
| channel_breakdown | multiline/markdown | Channel mix and budget allocation |
| creative_briefs | multiline/markdown | Per-channel creative direction |
| funnel_stages | multiline/markdown | Awareness → Consideration → Conversion |
| kpis | multiline/markdown | KPIs, targets, measurement plan |
| generated_at | text | ISO 8601 timestamp |

---

## API Contracts

### POST /api/agency_onboarding/interview
- Auth: `agency_onboarding.manage`
- Input: `{ client_profile_id: uuid, messages: [{role: 'user'|'assistant', content: string}] }`
- Output: `{ message: string, done: boolean, summary?: { audience_summary, personas, pain_points, buying_triggers, channels } }`
- Calls GPT-4o with a structured interviewer prompt (8 questions in Polish)

### POST /api/agency_onboarding/audience
- Auth: `agency_onboarding.manage`
- Input: `{ client_profile_id: uuid, data: { audience_summary, personas, pain_points, buying_triggers, channels } }`
- Output: `{ ok: true }`
- Upserts `agency_onboarding:target_audience` scoped to client's organization_id

### GET /api/agency_onboarding/competitors
- Auth: `agency_onboarding.view`
- Query: `?client_profile_id=uuid`
- Output: `{ items: CompetitorDomain[] }`

### POST /api/agency_onboarding/competitors
- Auth: `agency_onboarding.manage`
- Input: `{ client_profile_id: uuid, url: string, display_name?: string, is_ai_suggested?: boolean }`
- Output: `{ id: uuid }`

### POST /api/agency_onboarding/competitors/[id]/audit
- Auth: `agency_onboarding.manage`
- Triggers: web scrape → AI analysis → update `audit_results`
- Output: `{ ok: true }`

### GET /api/agency_intelligence/campaign
- Auth: `agency_intelligence.view`
- Query: `?client_profile_id=uuid`
- Output: `{ plan: CampaignPlan | null }`

### POST /api/agency_intelligence/campaign
- Auth: `agency_intelligence.manage`
- Input: `{ client_profile_id: uuid }`
- Output: `{ id: uuid, status: 'generating' }`
- Sets status=generating, triggers async AI generation

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|-----------|
| OpenAI call timeout in interview API | Low | 30s max, SSE not used — single response per turn |
| Competitor audit scraping failures | Medium | Existing error handling in web-scraper.ts; status=failed on error |
| Campaign plan generation > 60s | Medium | Set status=generating immediately, poll on frontend |
| Pipeboard API key misconfiguration | Low | Config-only, no code impact; PIPEBOARD_API_KEY optional |
| Multi-tenant data leakage | High | All DB queries include `tenant_id` filter (standard pattern) |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-11 | Claude | Phase 2 spec created |

# Pipeboard Ad Account Integration — Real Google Ads & Meta Ads Connections

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Marek Dabrowski |
| **Created** | 2026-04-14 |
| **Related** | SPEC-001 (Autonomous Agency) |

## TLDR

**Key Points:**
- Replace the static connection registry in `agency_intelligence` with verified, live ad account connections
- Build a server-side MCP client that connects to Pipeboard SSE endpoints programmatically from API routes
- Verify real Google Ads / Meta Ads accounts and pull campaign data + metrics
- Display real account data in the Connections UI tab
- Enrich AI agent context with live metrics from connected accounts

**Scope:**
- New: `PipeboardClient` service (DI-registered), `di.ts` for module
- New: POST `/api/agency_intelligence/connections/verify` endpoint
- New: POST `/api/agency_intelligence/connections/sync` endpoint
- Modified: `ce.ts` (7 new fields on `client_connection`)
- Modified: `events.ts` (3 new connection lifecycle events)
- Modified: `api/connections/route.ts` (POST status logic, GET response enrichment)
- Modified: `backend/agency_intelligence/[id]/page.tsx` (verify/sync UI, metrics display)
- Modified: `ai-tools.ts` (enriched connection context)

**Concerns:**
- Pipeboard MCP tool names are unknown until runtime — discovery-first approach required
- SSEClientTransport is deprecated in MCP SDK but required for Pipeboard SSE servers
- External SSE connections may timeout — needs graceful error handling

---

## Overview

The `agency_intelligence` module currently has a `client_connection` custom entity that serves as a static registry — users enter an Account ID and it is stored as "connected" without any verification or data fetching. There is no contact with real Google Ads or Meta Ads APIs.

This spec adds live account verification and data synchronization by building a server-side MCP client that connects to Pipeboard's SSE endpoints. Pipeboard acts as an OAuth/API bridge — it handles token management with Google and Meta, exposing their APIs as MCP tools via SSE.

---

## Problem Statement

### Current State

1. **No verification**: User enters any string as Account ID → status immediately set to "connected" without checking if the account exists or is accessible
2. **No real data**: Connection cards show only static metadata (tool type, display name, status) — no campaigns, metrics, or account info
3. **AI agents blind**: `agency_get_client_context` returns connection entries but without real data — agents cannot make data-driven decisions about ad accounts
4. **Mock execution**: Agent action execution is faked with a 1.5s delay — no real API calls

### Target State

1. **Verified connections**: Adding a Google Ads or Meta Ads connection requires explicit verification via Pipeboard
2. **Real data display**: Connection cards show account name, currency, campaign count, and 7-day metrics (spend, impressions, clicks, CTR)
3. **Enriched AI context**: `agency_get_client_context` includes cached metrics and campaign data for connected accounts
4. **Foundation for real execution**: Verified connections + Pipeboard client = path to real action execution in future phases

---

## Proposed Solution

### Architecture

```
User UI                    API Routes                    Pipeboard MCP (External)
─────────                  ──────────                    ────────────────────────
Add connection    →  POST /connections          
                     (status: 'disconnected' for ads)

Click "Verify"    →  POST /connections/verify   →  SSE connect to Pipeboard
                     resolve pipeboardClient         list_tools → verify account
                     from DI container               ← account_info
                     update doc (status,             SSE disconnect
                     account_name, currency)

Click "Sync"      →  POST /connections/sync     →  SSE connect to Pipeboard
                     resolve pipeboardClient         list_campaigns, get_metrics
                     from DI container               ← campaigns + metrics
                     update doc (cached_campaigns,   SSE disconnect
                     cached_metrics, last_synced_at)
```

### Key Design Decisions

1. **Pipeboard as API bridge** — No direct OAuth with Google/Meta. Pipeboard handles auth, we call MCP tools.
2. **Short-lived SSE connections** — Connect per-request via `withClient()` pattern, no persistent connections.
3. **DI-registered service** — `PipeboardClient` registered in Awilix container via `di.ts`, resolved per-request.
4. **Cached data in CE doc** — Metrics and campaigns stored in the connection's JSONB `doc` field, refreshed on manual sync.
5. **Discovery-first tool naming** — `listTools()` on first call to discover Pipeboard's actual tool names, logged for developer inspection.

---

## Data Models

### Extended `client_connection` CE Fields

Existing fields unchanged. New fields added (all `formEditable: false`):

| Field | Kind | Description |
|-------|------|-------------|
| `account_name` | text | Verified account name from ad platform |
| `account_currency` | text | Account currency code (PLN, USD, EUR) |
| `verified_at` | text | ISO 8601 timestamp of last verification |
| `error_message` | text | Last error from verification or sync |
| `cached_campaigns` | multiline | JSON array of campaign summaries (max 50) |
| `cached_metrics` | multiline | JSON: `{ spend_7d, impressions_7d, clicks_7d, ctr_7d, currency }` |
| `campaigns_count` | text | Total number of campaigns in account |

### New Events

| Event ID | Entity | Category |
|----------|--------|----------|
| `agency_intelligence.connection.verified` | client_connection | lifecycle |
| `agency_intelligence.connection.verification_failed` | client_connection | lifecycle |
| `agency_intelligence.connection.synced` | client_connection | lifecycle |

---

## API Contracts

### POST `/api/agency_intelligence/connections` (Modified)

**Change:** For `tool` = `meta_ads` or `google_ads`, set initial `status` to `'disconnected'` instead of `'connected'`. Other tools unchanged.

### POST `/api/agency_intelligence/connections/verify`

| Field | Value |
|-------|-------|
| Auth | `agency_intelligence.manage` |
| Body | `{ connection_id: string (uuid) }` |
| 200 | `{ verified: true, account_info: { name, currency } }` |
| 200 | `{ verified: false, error: string }` |
| 400 | `{ error: 'Tool not supported for verification' }` |
| 404 | `{ error: 'Connection not found' }` |
| 500 | `{ error: 'Pipeboard service error' }` |

### POST `/api/agency_intelligence/connections/sync`

| Field | Value |
|-------|-------|
| Auth | `agency_intelligence.manage` |
| Body | `{ connection_id: string (uuid) }` |
| 200 | `{ synced: true, campaigns_count: number, last_synced_at: string }` |
| 400 | `{ error: 'Connection not verified' }` or `{ error: 'Tool not supported' }` |
| 404 | `{ error: 'Connection not found' }` |
| 500 | `{ error: 'Sync failed' }` |

### GET `/api/agency_intelligence/connections` (Modified)

**Additional fields in response items:**
`account_name`, `account_currency`, `verified_at`, `error_message`, `campaigns_count`, `cached_metrics`

(`cached_campaigns` excluded from list response — too large.)

---

## UI Changes

### Connections Tab Enhancement

1. **Status display** adapts to tool type:
   - `disconnected` + ad platform → yellow badge "Wymaga weryfikacji" + "Weryfikuj" button
   - `disconnected` + other → gray "Rozlaczone"
   - `connected` + ad platform → green + "Synchronizuj" button
   - `error` → red + error_message display

2. **Enriched connection cards** show:
   - Account name (if verified)
   - 7-day metrics: spend, clicks, CTR
   - Campaign count
   - Last sync timestamp
   - Error message (if error)

3. **Loading states**: Spinner on verify/sync buttons during operations.

4. **i18n**: All user-facing strings use `useT()` translation keys (PL + EN).

---

## Implementation Phases

### Phase 1: Infrastructure (Steps 0-3)
- Spec file (this document)
- `PipeboardClient` service + `di.ts` registration
- CE field extensions + events
- `yarn install` + `yarn generate`

### Phase 2: API Layer (Steps 4-7)
- POST status change for ad platforms
- Verify endpoint
- Sync endpoint
- GET response enrichment

### Phase 3: UI + AI (Steps 8-10)
- Enhanced connections tab with verify/sync
- i18n translations
- AI tools context enrichment
- `yarn build` verification

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|------------|
| Unknown Pipeboard tool names | Medium | `listTools()` discovery + console logging; `TOOL_MAP` const easy to update |
| SSEClientTransport deprecated | Low | Required for Pipeboard SSE; one-line swap if they migrate to StreamableHTTP |
| External SSE timeout | Medium | 30s timeout with Promise.race + clear error messages in UI |
| Missing PIPEBOARD_API_KEY | Low | Verify/Sync return clear error; rest of system works normally |
| Large campaign data in JSONB | Low | Limit to 50 campaigns in sync; store `campaigns_count` for total |

---

## Backward Compatibility

- No breaking changes. All modifications are additive.
- New CE fields are `formEditable: false` — won't appear in auto-generated forms.
- New API endpoints don't affect existing routes.
- GET response includes new optional fields (null if not populated) — backwards compatible.
- Status `'disconnected'` was already in the CE options list — no schema change needed for status flow.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-14 | Initial draft |

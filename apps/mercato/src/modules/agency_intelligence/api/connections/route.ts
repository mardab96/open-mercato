import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { emitIntelligenceEvent } from '../../events'
import '../../commands/createClientConnection'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agency_intelligence.view'] },
  POST: { requireAuth: true, requireFeatures: ['agency_intelligence.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const connectionItemSchema = z.object({
  id: z.string(),
  client_profile_id: z.string(),
  tool: z.string(),
  display_name: z.string().nullable(),
  status: z.string(),
  last_synced_at: z.string().nullable(),
  created_at: z.string(),
})

const createConnectionSchema = z.object({
  client_profile_id: z.string().uuid(),
  tool: z.enum(['ga4', 'meta_ads', 'google_ads', 'gtm', 'slack', 'email']),
  external_id: z.string().min(1).max(2048),
  display_name: z.string().max(255).optional(),
})

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      tags: ['Agency Intelligence'],
      summary: 'List connections for a client',
      responses: [{ status: 200, description: 'Connection list' }],
    },
    POST: {
      tags: ['Agency Intelligence'],
      summary: 'Create a client connection',
      requestBody: { schema: createConnectionSchema },
      responses: [
        { status: 201, description: 'Created' },
        { status: 400, description: 'Validation error' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}

async function encryptIfEnabled(
  value: string,
  tenantId: string,
  resolve: (name: string) => unknown,
): Promise<string> {
  try {
    const encService = resolve('tenantDataEncryptionService') as any
    if (encService?.encrypt) {
      return await encService.encrypt(value, { tenantId })
    }
  } catch {
    // Encryption service not available — store plaintext
  }
  return value
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const clientProfileId = url.searchParams.get('client_profile_id')

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    let query = knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:client_connection')
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')

    if (clientProfileId) {
      query = query.whereRaw("doc->>'client_profile_id' = ?", [clientProfileId])
    }

    const rows = await query.select('entity_id', 'doc', 'created_at')

    const items = rows.map((r: any) => {
      const doc = typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc
      let parsedMetrics = null
      if (doc.cached_metrics) {
        try {
          parsedMetrics = typeof doc.cached_metrics === 'string' ? JSON.parse(doc.cached_metrics) : doc.cached_metrics
        } catch { /* ignore */ }
      }
      return {
        id: r.entity_id,
        client_profile_id: doc.client_profile_id,
        tool: doc.tool,
        display_name: doc.display_name ?? null,
        status: doc.status ?? 'disconnected',
        last_synced_at: doc.last_synced_at ?? null,
        account_name: doc.account_name ?? null,
        account_currency: doc.account_currency ?? null,
        verified_at: doc.verified_at ?? null,
        error_message: doc.error_message ?? null,
        campaigns_count: doc.campaigns_count != null ? Number(doc.campaigns_count) : null,
        cached_metrics: parsedMetrics,
        created_at: r.created_at,
      }
    })

    return NextResponse.json({ items, total: items.length })
  } catch (e) {
    console.error('[agency_intelligence/connections] GET error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createConnectionSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { client_profile_id, tool, external_id, display_name } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const id = crypto.randomUUID()
    const now = new Date()
    const encryptedExternalId = await encryptIfEnabled(external_id, auth.tenantId, resolve)

    await knex('custom_entities_storage').insert({
      entity_type: 'agency_intelligence:client_connection',
      entity_id: id,
      tenant_id: auth.tenantId,
      organization_id: auth.orgId ?? null,
      doc: JSON.stringify({
        client_profile_id,
        tool,
        external_id: encryptedExternalId,
        display_name: display_name ?? null,
        status: ['meta_ads', 'google_ads'].includes(tool) ? 'disconnected' : 'connected',
        last_synced_at: null,
      }),
      created_at: now,
      updated_at: now,
    })

    return NextResponse.json({ id }, { status: 201 })
  } catch (e) {
    console.error('[agency_intelligence/connections] POST error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

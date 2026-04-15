import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { emitIntelligenceEvent } from '../../../events'
import type { PipeboardClient, PipeboardPlatform } from '../../../lib/pipeboard-client'
import { PipeboardError } from '../../../lib/pipeboard-client'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agency_intelligence.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const syncSchema = z.object({
  connection_id: z.string().uuid(),
})

export const openApi: OpenApiRouteDoc = {
  methods: {
    POST: {
      tags: ['Agency Intelligence'],
      summary: 'Sync campaigns and metrics from an ad account via Pipeboard',
      requestBody: { schema: syncSchema },
      responses: [
        { status: 200, description: 'Sync result' },
        { status: 400, description: 'Connection not verified or tool not supported' },
        { status: 404, description: 'Connection not found' },
      ],
    },
  },
}

const AD_PLATFORMS = ['meta_ads', 'google_ads']

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = syncSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { connection_id } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const row = await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:client_connection')
      .where('entity_id', connection_id)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .first()

    if (!row) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc
    const tool: string = doc.tool

    if (!AD_PLATFORMS.includes(tool)) {
      return NextResponse.json({ error: 'Tool not supported for sync' }, { status: 400 })
    }

    if (doc.status !== 'connected') {
      return NextResponse.json({ error: 'Connection not verified. Verify first.' }, { status: 400 })
    }

    // Decrypt external_id using the built-in encryption service
    let externalId: string = doc.external_id
    try {
      const encService = resolve('tenantDataEncryptionService') as any
      if (encService?.decrypt) {
        externalId = await encService.decrypt(externalId, { tenantId: auth.tenantId })
      }
    } catch {
      // Encryption service not available — use value as-is
    }

    const pipeboardClient = resolve('pipeboardClient') as PipeboardClient
    const syncResult = await pipeboardClient.withClient(tool as PipeboardPlatform, async (session) => {
      const [campaigns, metrics] = await Promise.all([
        session.listCampaigns(externalId),
        session.getAccountMetrics(externalId),
      ])
      return { campaigns, metrics }
    })

    const now = new Date().toISOString()

    await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:client_connection')
      .where('entity_id', connection_id)
      .where('tenant_id', auth.tenantId)
      .update({
        doc: JSON.stringify({
          ...doc,
          cached_campaigns: JSON.stringify(syncResult.campaigns),
          cached_metrics: syncResult.metrics ? JSON.stringify(syncResult.metrics) : null,
          campaigns_count: String(syncResult.campaigns.length),
          last_synced_at: now,
          error_message: null,
        }),
        updated_at: new Date(),
      })

    await emitIntelligenceEvent('agency_intelligence.connection.synced', {
      id: connection_id,
      clientProfileId: doc.client_profile_id,
      tool,
      campaignsCount: syncResult.campaigns.length,
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    })

    return NextResponse.json({
      synced: true,
      campaigns_count: syncResult.campaigns.length,
      last_synced_at: now,
    })
  } catch (e) {
    if (e instanceof PipeboardError) {
      return NextResponse.json({ error: `Pipeboard: ${e.message}` }, { status: 500 })
    }
    console.error('[agency_intelligence/connections/sync] Error:', e)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}

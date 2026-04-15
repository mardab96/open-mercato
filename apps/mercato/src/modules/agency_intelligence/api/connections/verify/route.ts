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

const verifySchema = z.object({
  connection_id: z.string().uuid(),
})

export const openApi: OpenApiRouteDoc = {
  methods: {
    POST: {
      tags: ['Agency Intelligence'],
      summary: 'Verify an ad account connection via Pipeboard',
      requestBody: { schema: verifySchema },
      responses: [
        { status: 200, description: 'Verification result' },
        { status: 400, description: 'Tool not supported' },
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

  const parsed = verifySchema.safeParse(json)
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
      return NextResponse.json({ error: 'Tool not supported for verification' }, { status: 400 })
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
    const result = await pipeboardClient.withClient(tool as PipeboardPlatform, async (session) => {
      return session.verifyAccount(externalId)
    })

    const now = new Date().toISOString()

    if (result.verified && result.account_info) {
      await knex('custom_entities_storage')
        .where('entity_type', 'agency_intelligence:client_connection')
        .where('entity_id', connection_id)
        .where('tenant_id', auth.tenantId)
        .update({
          doc: JSON.stringify({
            ...doc,
            status: 'connected',
            account_name: result.account_info.name,
            account_currency: result.account_info.currency,
            verified_at: now,
            error_message: null,
          }),
          updated_at: new Date(),
        })

      await emitIntelligenceEvent('agency_intelligence.connection.verified', {
        id: connection_id,
        clientProfileId: doc.client_profile_id,
        tool,
        accountName: result.account_info.name,
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
      })

      return NextResponse.json({
        verified: true,
        account_info: { name: result.account_info.name, currency: result.account_info.currency },
      })
    }

    // Verification failed
    await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:client_connection')
      .where('entity_id', connection_id)
      .where('tenant_id', auth.tenantId)
      .update({
        doc: JSON.stringify({
          ...doc,
          status: 'error',
          error_message: result.error ?? 'Verification failed',
          verified_at: null,
        }),
        updated_at: new Date(),
      })

    await emitIntelligenceEvent('agency_intelligence.connection.verification_failed', {
      id: connection_id,
      clientProfileId: doc.client_profile_id,
      tool,
      error: result.error,
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    })

    return NextResponse.json({ verified: false, error: result.error ?? 'Verification failed' })
  } catch (e) {
    if (e instanceof PipeboardError) {
      return NextResponse.json({ error: `Pipeboard: ${e.message}` }, { status: 500 })
    }
    console.error('[agency_intelligence/connections/verify] Error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

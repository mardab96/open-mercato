import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { emitIntelligenceEvent } from '../../../events'
import '../../../commands/updateAgentActionStatus'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['agency_intelligence.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const patchActionSchema = z.object({
  status: z.enum(['proposed', 'approved', 'executing', 'done', 'failed', 'skipped']),
  result: z.string().max(10000).optional(),
})

export const openApi: OpenApiRouteDoc = {
  methods: {
    PATCH: {
      tags: ['Agency Intelligence'],
      summary: 'Update agent action status',
      requestBody: { schema: patchActionSchema },
      responses: [
        { status: 200, description: 'Updated' },
        { status: 400, description: 'Validation error' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Not found' },
      ],
    },
  },
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const actionId = params.id

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = patchActionSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { status, result } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const row = await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:agent_action')
      .where('entity_id', actionId)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .first()

    if (!row) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 })
    }

    const existingDoc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc

    await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:agent_action')
      .where('entity_id', actionId)
      .where('tenant_id', auth.tenantId)
      .update({
        doc: JSON.stringify({
          ...existingDoc,
          status,
          result: result ?? existingDoc.result ?? null,
        }),
        updated_at: new Date(),
      })

    if (status === 'done') {
      await emitIntelligenceEvent('agency_intelligence.action.completed', {
        id: actionId,
        clientProfileId: existingDoc.client_profile_id,
        status,
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
      })
    } else if (status === 'failed') {
      await emitIntelligenceEvent('agency_intelligence.action.failed', {
        id: actionId,
        clientProfileId: existingDoc.client_profile_id,
        status,
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
      })
    }

    return NextResponse.json({ id: actionId, status })
  } catch (e) {
    console.error('[agency_intelligence/actions/:id] PATCH error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

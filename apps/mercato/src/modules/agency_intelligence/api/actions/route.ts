import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { emitIntelligenceEvent } from '../../events'
import '../../commands/createAgentAction'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agency_intelligence.view'] },
  POST: { requireAuth: true, requireFeatures: ['agency_intelligence.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const actionItemSchema = z.object({
  id: z.string(),
  client_profile_id: z.string(),
  agent_type: z.string().nullable(),
  action_type: z.string().nullable(),
  title: z.string(),
  rationale: z.string().nullable(),
  status: z.string(),
  impact_estimate: z.string().nullable(),
  result: z.string().nullable(),
  connection_id: z.string().nullable(),
  created_at: z.string(),
})

const createActionSchema = z.object({
  client_profile_id: z.string().uuid(),
  agent_type: z.enum(['optimizer', 'analyst', 'content_creator', 'media_buyer']),
  action_type: z.enum([
    'bid_adjustment',
    'budget_reallocation',
    'audience_update',
    'creative_test',
    'pause_campaign',
    'campaign_create',
    'report',
    'alert',
  ]),
  title: z.string().min(1).max(500),
  rationale: z.string().max(10000).optional(),
  impact_estimate: z.string().max(500).optional(),
  connection_id: z.string().uuid().optional(),
})

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      tags: ['Agency Intelligence'],
      summary: 'List agent actions for a client',
      responses: [{ status: 200, description: 'Action list' }],
    },
    POST: {
      tags: ['Agency Intelligence'],
      summary: 'Create an agent action',
      requestBody: { schema: createActionSchema },
      responses: [
        { status: 201, description: 'Created' },
        { status: 400, description: 'Validation error' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const clientProfileId = url.searchParams.get('client_profile_id')
  const status = url.searchParams.get('status')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100)

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    let query = knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:agent_action')
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .limit(limit)

    if (clientProfileId) {
      query = query.whereRaw("doc->>'client_profile_id' = ?", [clientProfileId])
    }
    if (status) {
      query = query.whereRaw("doc->>'status' = ?", [status])
    }

    const rows = await query.select('entity_id', 'doc', 'created_at')

    const items = rows.map((r: any) => {
      const doc = typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc
      return {
        id: r.entity_id,
        client_profile_id: doc.client_profile_id,
        agent_type: doc.agent_type ?? null,
        action_type: doc.action_type ?? null,
        title: doc.title,
        rationale: doc.rationale ?? null,
        status: doc.status ?? 'proposed',
        impact_estimate: doc.impact_estimate ?? null,
        result: doc.result ?? null,
        connection_id: doc.connection_id ?? null,
        created_at: r.created_at,
      }
    })

    return NextResponse.json({ items, total: items.length })
  } catch (e) {
    console.error('[agency_intelligence/actions] GET error:', e)
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

  const parsed = createActionSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { client_profile_id, agent_type, action_type, title, rationale, impact_estimate, connection_id } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const id = crypto.randomUUID()
    const now = new Date()

    await knex('custom_entities_storage').insert({
      entity_type: 'agency_intelligence:agent_action',
      entity_id: id,
      tenant_id: auth.tenantId,
      organization_id: auth.orgId ?? null,
      doc: JSON.stringify({
        client_profile_id,
        agent_type,
        action_type,
        title,
        rationale: rationale ?? null,
        status: 'proposed',
        impact_estimate: impact_estimate ?? null,
        result: null,
        connection_id: connection_id ?? null,
      }),
      created_at: now,
      updated_at: now,
    })

    await emitIntelligenceEvent('agency_intelligence.action.proposed', {
      id,
      clientProfileId: client_profile_id,
      agentType: agent_type,
      actionType: action_type,
      title,
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    })

    return NextResponse.json({ id }, { status: 201 })
  } catch (e) {
    console.error('[agency_intelligence/actions] POST error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

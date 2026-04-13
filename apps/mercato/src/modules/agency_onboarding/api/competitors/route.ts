import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { randomUUID } from 'crypto'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agency_onboarding.view'] },
  POST: { requireAuth: true, requireFeatures: ['agency_onboarding.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const createBodySchema = z.object({
  client_profile_id: z.string().uuid(),
  url: z.string().url().max(500),
  display_name: z.string().max(200).optional(),
  is_ai_suggested: z.boolean().optional().default(false),
})

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      tags: ['Agency Onboarding'],
      summary: 'List competitor domains for a client',
      responses: [
        { status: 200, description: 'List of competitor domains' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
    POST: {
      tags: ['Agency Onboarding'],
      summary: 'Add a competitor domain',
      requestBody: { schema: createBodySchema },
      responses: [
        { status: 200, description: 'Created' },
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
  if (!clientProfileId) return NextResponse.json({ error: 'client_profile_id is required' }, { status: 400 })

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const rows = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:competitor_domain')
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .whereRaw(`doc->>'client_profile_id' = ?`, [clientProfileId])
      .orderBy('created_at', 'asc')
      .select('entity_id', 'doc', 'created_at', 'updated_at')

    const items = rows.map((row) => {
      const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc
      return { id: row.entity_id, created_at: row.created_at, updated_at: row.updated_at, ...doc }
    })

    return NextResponse.json({ items })
  } catch (e) {
    console.error('[competitors] GET error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = createBodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const { client_profile_id, url: competitorUrl, display_name, is_ai_suggested } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const profileRow = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:client_profile')
      .where('entity_id', client_profile_id)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .first('organization_id')

    if (!profileRow) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const entityId = randomUUID()
    const now = new Date()

    await knex('custom_entities_storage').insert({
      entity_type: 'agency_onboarding:competitor_domain',
      entity_id: entityId,
      tenant_id: auth.tenantId,
      organization_id: profileRow.organization_id,
      doc: JSON.stringify({
        client_profile_id,
        url: competitorUrl,
        display_name: display_name || null,
        status: 'pending',
        is_ai_suggested: is_ai_suggested ? 'true' : 'false',
        audit_results: null,
      }),
      created_at: now,
      updated_at: now,
    })

    return NextResponse.json({ id: entityId })
  } catch (e) {
    console.error('[competitors] POST error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

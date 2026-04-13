import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { randomUUID } from 'crypto'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agency_onboarding.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const audienceDataSchema = z.object({
  audience_summary: z.string().optional(),
  personas: z.string().optional(),
  pain_points: z.string().optional(),
  buying_triggers: z.string().optional(),
  channels: z.array(z.string()).optional(),
})

const bodySchema = z.object({
  client_profile_id: z.string().uuid(),
  data: audienceDataSchema,
})

export const openApi: OpenApiRouteDoc = {
  methods: {
    POST: {
      tags: ['Agency Onboarding'],
      summary: 'Save or update target audience data from AI interview',
      requestBody: { schema: bodySchema },
      responses: [
        { status: 200, description: 'Saved' },
        { status: 400, description: 'Validation error' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Client not found' },
      ],
    },
  },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const { client_profile_id, data } = parsed.data

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

    const orgId = profileRow.organization_id
    const now = new Date()

    const existing = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:target_audience')
      .where('organization_id', orgId)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .whereRaw(`doc->>'client_profile_id' = ?`, [client_profile_id])
      .orderBy('created_at', 'desc')
      .first('entity_id', 'doc')

    if (existing) {
      const existingDoc = typeof existing.doc === 'string' ? JSON.parse(existing.doc) : existing.doc
      await knex('custom_entities_storage')
        .where('entity_type', 'agency_onboarding:target_audience')
        .where('entity_id', existing.entity_id)
        .where('tenant_id', auth.tenantId)
        .update({
          doc: JSON.stringify({ ...existingDoc, ...data, client_profile_id }),
          updated_at: now,
        })
    } else {
      await knex('custom_entities_storage').insert({
        entity_type: 'agency_onboarding:target_audience',
        entity_id: randomUUID(),
        tenant_id: auth.tenantId,
        organization_id: orgId,
        doc: JSON.stringify({ ...data, client_profile_id }),
        created_at: now,
        updated_at: now,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[audience] Error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

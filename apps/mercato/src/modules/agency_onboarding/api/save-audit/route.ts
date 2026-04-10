import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agency_onboarding.manage'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const bodySchema = z.object({
  clientRecordId: z.string().uuid(),
  recommendedStrategy: z.string().min(1),
})

const responseSchema = z.object({ ok: z.literal(true) })

export const openApi: OpenApiRouteDoc = {
  POST: {
    tags: ['Agency Onboarding'],
    summary: 'Save edited audit document',
    requestBody: { schema: bodySchema },
    responses: { 200: { schema: responseSchema, description: 'Saved' } },
  },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 400 })

  const { clientRecordId, recommendedStrategy } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    // Find the organization from the client profile
    const profileRow = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:client_profile')
      .where('entity_id', clientRecordId)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .first('organization_id')

    if (!profileRow) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Update the latest audit record's recommended_strategy
    const updated = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:ai_audit')
      .where('organization_id', profileRow.organization_id)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .limit(1)
      .update({
        doc: knex.raw(`jsonb_set(doc, '{recommended_strategy}', ?::jsonb)`, [JSON.stringify(recommendedStrategy)]),
        updated_at: new Date(),
      })

    if (!updated) return NextResponse.json({ error: 'Audit record not found' }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[save-audit] Error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agency_onboarding.view'] },
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

const clientResponseSchema = z.object({
  profile: z.record(z.string(), z.any()).nullable(),
  audit: z.record(z.string(), z.any()).nullable(),
  audience: z.record(z.string(), z.any()).nullable(),
})

export const openApi: OpenApiRouteDoc = {
  GET: {
    tags: ['Agency Onboarding'],
    summary: 'Get client onboarding data by record ID',
    responses: {
      200: { schema: clientResponseSchema, description: 'Client data' },
    },
  },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const recordId = url.searchParams.get('id')
  if (!recordId) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    // Fetch client profile
    const profileRow = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:client_profile')
      .where('entity_id', recordId)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .first('entity_id', 'organization_id', 'doc')

    const profile = profileRow
      ? { ...profileRow.doc, id: profileRow.entity_id }
      : null

    let audit = null
    let audience = null

    if (profileRow?.organization_id) {
      const orgId = profileRow.organization_id

      const auditRow = await knex('custom_entities_storage')
        .where('entity_type', 'agency_onboarding:ai_audit')
        .where('organization_id', orgId)
        .where('tenant_id', auth.tenantId)
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc')
        .first('doc')

      audit = auditRow?.doc || null

      const audienceRow = await knex('custom_entities_storage')
        .where('entity_type', 'agency_onboarding:target_audience')
        .where('organization_id', orgId)
        .where('tenant_id', auth.tenantId)
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc')
        .first('doc')

      audience = audienceRow?.doc || null
    }

    return NextResponse.json({ profile, audit, audience })
  } catch (e) {
    console.error('[agency_onboarding/client] Error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

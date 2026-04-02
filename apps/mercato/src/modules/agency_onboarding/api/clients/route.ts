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

const responseSchema = z.object({
  items: z.array(z.record(z.string(), z.any())),
  total: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  GET: {
    tags: ['Agency Onboarding'],
    summary: 'List all client profiles',
    responses: { 200: { schema: responseSchema, description: 'Client list' } },
  },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const knex = getKnex(em)

    const rows = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:client_profile')
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .select('entity_id', 'doc', 'created_at')

    const items = rows.map((r: any) => ({
      id: r.entity_id,
      company_name: r.doc?.company_name || '',
      website_url: r.doc?.website_url || '',
      onboarding_status: r.doc?.onboarding_status || 'draft',
      created_at: r.created_at,
    }))

    return NextResponse.json({ items, total: items.length })
  } catch (e) {
    console.error('[agency_onboarding/clients] Error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

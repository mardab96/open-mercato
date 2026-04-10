import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { emitOnboardingEvent } from '../../events'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agency_onboarding.manage'] },
}

const bodySchema = z.object({
  recordId: z.string().min(1),
  entityId: z.string().min(1),
})

const triggerResponseSchema = z.object({ ok: z.literal(true) })
const errorResponseSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  POST: {
    tags: ['Agency Onboarding'],
    summary: 'Trigger AI audit for a client profile',
    requestBody: { schema: bodySchema },
    responses: {
      200: { schema: triggerResponseSchema, description: 'Audit triggered' },
      400: { schema: errorResponseSchema, description: 'Validation error' },
      401: { schema: errorResponseSchema, description: 'Unauthorized' },
    },
  },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const { recordId, entityId } = parsed.data

  await emitOnboardingEvent('agency_onboarding.client_profile.created', {
    recordId,
    entityId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })

  return NextResponse.json({ ok: true })
}

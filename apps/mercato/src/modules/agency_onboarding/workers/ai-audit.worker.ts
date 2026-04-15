import type { WorkerMeta } from '@open-mercato/queue'
import { runAiAudit } from '../lib/ai-audit-service'
import { emitOnboardingEvent } from '../events'
import type { AiAuditJob } from '../lib/queue'

export const AUDIT_QUEUE_NAME = 'agency-onboarding-ai-audit'

export const metadata: WorkerMeta = {
  queue: AUDIT_QUEUE_NAME,
  id: 'agency-onboarding:ai-audit',
  concurrency: 2,
}

type WorkerContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handler(job: { payload: AiAuditJob }, ctx: WorkerContext) {
  const { recordId, entityId, tenantId, organizationId } = job.payload

  console.log(`[ai-audit] Starting audit for record ${recordId}`)

  const de = ctx.resolve('dataEngine') as any
  const em = ctx.resolve('em') as any

  try {
    // 1. Fetch client_profile record
    const profileRecords = await de.listCustomEntityRecords({
      entityId,
      tenantId,
      organizationId,
      filters: {},
      page: 1,
      pageSize: 100,
    })

    const profile = profileRecords.items?.find((r: any) => r.id === recordId || r.record_id === recordId)
    if (!profile) {
      console.error(`[ai-audit] Record ${recordId} not found`)
      return
    }

    const companyName = profile.company_name || profile.cf_company_name || 'Unknown'
    const websiteUrl = profile.website_url || profile.cf_website_url || ''
    const currentStatus = profile.onboarding_status || profile.cf_onboarding_status || ''

    // Idempotency: skip if already completed
    if (currentStatus === 'completed') {
      console.log(`[ai-audit] Record ${recordId} already completed, skipping`)
      return
    }

    // 2. Fetch attachments and their extracted text content
    const attachmentContents: string[] = []
    try {
      const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
      const attachments = await em.find(Attachment, {
        entityId: 'agency_onboarding:client_profile',
        recordId,
        deletedAt: null,
      })

      for (const att of attachments) {
        if (att.content && typeof att.content === 'string' && att.content.trim().length > 0) {
          attachmentContents.push(`[${att.fileName}]\n${att.content}`)
        }
      }
      console.log(`[ai-audit] Found ${attachments.length} attachments, ${attachmentContents.length} with text content`)
    } catch (e) {
      console.warn('[ai-audit] Could not fetch attachments:', e)
    }

    // 3. Call OpenAI
    console.log(`[ai-audit] Calling OpenAI for ${companyName} (${websiteUrl})...`)
    const result = await runAiAudit({ companyName, websiteUrl, scrapedContent: '', attachmentContents }) as any
    console.log('[ai-audit] OpenAI response received')

    // 4. Save ai_audit record
    const auditDate = new Date().toISOString().split('T')[0]
    await de.createCustomEntityRecord({
      entityId: 'agency_onboarding:ai_audit',
      organizationId,
      tenantId,
      values: {
        ...result.ai_audit,
        audit_date: auditDate,
        audit_version: 1,
      },
    })
    console.log('[ai-audit] ai_audit record saved')

    // 5. Save target_audience record
    await de.createCustomEntityRecord({
      entityId: 'agency_onboarding:target_audience',
      organizationId,
      tenantId,
      values: result.target_audience,
    })
    console.log('[ai-audit] target_audience record saved')

    // 6. Update client_profile status → completed
    await de.updateCustomEntityRecord({
      entityId,
      recordId,
      organizationId,
      tenantId,
      values: { onboarding_status: 'completed' },
    })
    console.log(`[ai-audit] Record ${recordId} status → completed`)

    // 7. Emit completion event
    await emitOnboardingEvent('agency_onboarding.audit.completed', {
      recordId,
      entityId,
      tenantId,
      organizationId,
    })

    console.log(`[ai-audit] Audit completed for ${companyName}`)
  } catch (error) {
    console.error(`[ai-audit] Audit failed for record ${recordId}:`, error)

    // Update status back to draft on failure
    try {
      await de.updateCustomEntityRecord({
        entityId,
        recordId,
        organizationId,
        tenantId,
        values: { onboarding_status: 'draft' },
      })
    } catch { /* ignore */ }

    await emitOnboardingEvent('agency_onboarding.audit.failed', {
      recordId,
      entityId,
      tenantId,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })

    throw error // re-throw so queue can retry
  }
}

import { runAiAudit, extractSection } from '../lib/ai-audit-service'
import { scrapeWebsite, formatScrapedContent } from '../lib/web-scraper'
import { emitOnboardingEvent } from '../events'
import type { Knex } from 'knex'

export const metadata = {
  event: 'agency_onboarding.client_profile.created',
  persistent: true,
  id: 'agency-onboarding-audit-trigger',
}

type AuditPayload = {
  recordId: string
  entityId: string
  tenantId: string
  organizationId: string
}

function getKnex(em: any): Knex {
  return (em.getConnection() as any).getKnex()
}

async function updateStatus(knex: Knex, recordId: string, tenantId: string, status: string) {
  await knex('custom_entities_storage')
    .where('entity_type', 'agency_onboarding:client_profile')
    .where('entity_id', recordId)
    .where('tenant_id', tenantId)
    .update({
      doc: knex.raw(`jsonb_set(doc, '{onboarding_status}', ?::jsonb)`, [JSON.stringify(status)]),
      updated_at: new Date(),
    })
  console.log(`[ai-audit] Status → ${status}`)
}

export default async function handler(payload: AuditPayload, ctx: { resolve: <T = unknown>(name: string) => T }) {
  const { recordId, entityId, tenantId, organizationId } = payload
  console.log(`[ai-audit] Starting audit for record ${recordId}`)

  const de = ctx.resolve('dataEngine') as any
  const em = ctx.resolve('em') as any
  const knex = getKnex(em)

  try {
    // 1. Fetch client_profile record
    const profileRow = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:client_profile')
      .where('entity_id', recordId)
      .where('tenant_id', tenantId)
      .whereNull('deleted_at')
      .first('doc')

    if (!profileRow?.doc) {
      console.error(`[ai-audit] Record ${recordId} not found in DB`)
      return // don't retry — record doesn't exist
    }

    const doc = profileRow.doc
    const companyName = doc.company_name || 'Unknown'
    const websiteUrl = doc.website_url || ''
    const currentStatus = doc.onboarding_status || ''

    if (!websiteUrl) {
      console.error(`[ai-audit] No website_url for record ${recordId}`)
      return
    }

    if (currentStatus === 'completed') {
      console.log(`[ai-audit] Record ${recordId} already completed, skipping`)
      return
    }

    // 2. STEP 1: Scrape website
    await updateStatus(knex, recordId, tenantId, 'scraping_website')

    let scrapedContent = ''
    try {
      console.log(`[ai-audit] Scraping ${websiteUrl}...`)
      const scrapeResult = await scrapeWebsite(websiteUrl)
      scrapedContent = formatScrapedContent(scrapeResult)
      console.log(`[ai-audit] Scraped ${scrapeResult.pages.length} pages, ${scrapeResult.totalChars} chars`)
    } catch (scrapeError) {
      console.warn(`[ai-audit] Scraping failed (continuing without):`, scrapeError instanceof Error ? scrapeError.message : scrapeError)
      // Continue without scraped content — don't fail the whole audit
    }

    // 3. Fetch attachment contents
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
      console.log(`[ai-audit] Found ${attachments.length} attachments, ${attachmentContents.length} with text`)
    } catch (e) {
      console.warn('[ai-audit] Could not fetch attachments:', e)
    }

    // 4. STEP 2: AI analysis
    await updateStatus(knex, recordId, tenantId, 'ai_analyzing')

    console.log(`[ai-audit] Calling OpenAI for ${companyName}...`)
    const result = await runAiAudit({ companyName, websiteUrl, scrapedContent, attachmentContents })
    console.log(`[ai-audit] Response: ${result.auditDocument.length} chars, ${result.auditDocument.split('\n').length} lines`)

    // 5. Save ai_audit record
    const auditDate = new Date().toISOString().split('T')[0]
    const sectionA = extractSection(result.auditDocument, 'A')
    const sectionG = extractSection(result.auditDocument, 'G')

    await de.createCustomEntityRecord({
      entityId: 'agency_onboarding:ai_audit',
      organizationId,
      tenantId,
      values: {
        recommended_strategy: result.auditDocument,
        website_analysis: sectionA || result.auditDocument.slice(0, 2000),
        swot: sectionG || '',
        communication_style: '',
        competitor_analysis: sectionG || '',
        audit_date: auditDate,
        audit_version: 1,
      },
    })
    console.log('[ai-audit] ai_audit record saved')

    // 6. Save target_audience record
    await de.createCustomEntityRecord({
      entityId: 'agency_onboarding:target_audience',
      organizationId,
      tenantId,
      values: {
        audience_summary: sectionA,
        personas: extractSection(result.auditDocument, 'E'),
        pain_points: extractSection(result.auditDocument, 'A'),
        buying_triggers: extractSection(result.auditDocument, 'F'),
        channels: result.channels,
      },
    })
    console.log('[ai-audit] target_audience record saved')

    // 7. Completed
    await updateStatus(knex, recordId, tenantId, 'completed')

    await emitOnboardingEvent('agency_onboarding.audit.completed', {
      recordId, entityId, tenantId, organizationId,
    })

    console.log(`[ai-audit] ✅ Audit completed for ${companyName}`)
  } catch (error) {
    // GRACEFUL FAILURE: don't throw → don't retry
    console.error(`[ai-audit] ❌ Audit failed for record ${recordId}:`, error)

    try {
      await updateStatus(knex, recordId, tenantId, 'failed')
    } catch { /* ignore */ }

    try {
      await emitOnboardingEvent('agency_onboarding.audit.failed', {
        recordId, entityId, tenantId, organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    } catch { /* ignore */ }

    // DON'T re-throw — prevents retry loop
  }
}

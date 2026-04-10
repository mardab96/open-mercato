import { createQueue, type Queue } from '@open-mercato/queue'

export type AiAuditJob = {
  recordId: string
  entityId: string
  tenantId: string
  organizationId: string
}

let auditQueue: Queue<AiAuditJob> | null = null

export function getAuditQueue(): Queue<AiAuditJob> {
  if (auditQueue) return auditQueue
  auditQueue = createQueue<AiAuditJob>('agency-onboarding-ai-audit', 'local')
  return auditQueue
}

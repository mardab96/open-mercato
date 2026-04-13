import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { Knex } from 'knex'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { emitIntelligenceEvent } from '../events'

export const updateAgentActionStatusSchema = z.object({
  actionId: z.string().uuid(),
  status: z.enum(['proposed', 'approved', 'executing', 'done', 'failed', 'skipped']),
  result: z.string().max(10000).optional(),
  tenantId: z.string(),
  organizationId: z.string().nullable().optional(),
})

export type UpdateAgentActionStatusInput = z.infer<typeof updateAgentActionStatusSchema>

function getKnex(ctx: CommandRuntimeContext): Knex {
  const em = ctx.container.resolve('em') as EntityManager
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

registerCommand({
  id: 'agency_intelligence.action.update_status',
  isUndoable: false,

  async execute(input: UpdateAgentActionStatusInput, ctx: CommandRuntimeContext) {
    const knex = getKnex(ctx)
    const now = new Date()

    const row = await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:agent_action')
      .where('entity_id', input.actionId)
      .where('tenant_id', input.tenantId)
      .whereNull('deleted_at')
      .first()

    if (!row) {
      throw new Error(`Agent action not found: ${input.actionId}`)
    }

    const existingDoc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc

    await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:agent_action')
      .where('entity_id', input.actionId)
      .where('tenant_id', input.tenantId)
      .update({
        doc: JSON.stringify({
          ...existingDoc,
          status: input.status,
          result: input.result ?? existingDoc.result ?? null,
        }),
        updated_at: now,
      })

    if (input.status === 'done') {
      await emitIntelligenceEvent('agency_intelligence.action.completed', {
        id: input.actionId,
        clientProfileId: existingDoc.client_profile_id,
        status: input.status,
        tenantId: input.tenantId,
        organizationId: input.organizationId ?? null,
      })
    } else if (input.status === 'failed') {
      await emitIntelligenceEvent('agency_intelligence.action.failed', {
        id: input.actionId,
        clientProfileId: existingDoc.client_profile_id,
        status: input.status,
        tenantId: input.tenantId,
        organizationId: input.organizationId ?? null,
      })
    }

    return { id: input.actionId, status: input.status }
  },
})

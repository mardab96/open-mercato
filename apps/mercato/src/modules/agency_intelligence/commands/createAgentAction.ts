import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { Knex } from 'knex'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { emitIntelligenceEvent } from '../events'

export const createAgentActionSchema = z.object({
  clientProfileId: z.string().uuid(),
  agentType: z.enum(['optimizer', 'analyst', 'content_creator', 'media_buyer']),
  actionType: z.enum([
    'bid_adjustment',
    'budget_reallocation',
    'audience_update',
    'creative_test',
    'pause_campaign',
    'campaign_create',
    'report',
    'alert',
  ]),
  title: z.string().min(1).max(500),
  rationale: z.string().max(10000).optional(),
  impactEstimate: z.string().max(500).optional(),
  connectionId: z.string().uuid().optional(),
  tenantId: z.string(),
  organizationId: z.string().nullable().optional(),
})

export type CreateAgentActionInput = z.infer<typeof createAgentActionSchema>

function getKnex(ctx: CommandRuntimeContext): Knex {
  const em = ctx.container.resolve('em') as EntityManager
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

registerCommand({
  id: 'agency_intelligence.action.create',
  isUndoable: false,

  async execute(input: CreateAgentActionInput, ctx: CommandRuntimeContext) {
    const knex = getKnex(ctx)
    const id = crypto.randomUUID()
    const now = new Date()

    await knex('custom_entities_storage').insert({
      entity_type: 'agency_intelligence:agent_action',
      entity_id: id,
      tenant_id: input.tenantId,
      organization_id: input.organizationId ?? null,
      doc: JSON.stringify({
        client_profile_id: input.clientProfileId,
        agent_type: input.agentType,
        action_type: input.actionType,
        title: input.title,
        rationale: input.rationale ?? null,
        status: 'proposed',
        impact_estimate: input.impactEstimate ?? null,
        result: null,
        connection_id: input.connectionId ?? null,
      }),
      created_at: now,
      updated_at: now,
    })

    await emitIntelligenceEvent('agency_intelligence.action.proposed', {
      id,
      clientProfileId: input.clientProfileId,
      agentType: input.agentType,
      actionType: input.actionType,
      title: input.title,
      tenantId: input.tenantId,
      organizationId: input.organizationId ?? null,
    })

    return { id }
  },
})

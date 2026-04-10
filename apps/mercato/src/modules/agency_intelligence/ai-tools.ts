import { z } from 'zod'
import type { Knex } from 'knex'
import type { EntityManager } from '@mikro-orm/postgresql'
import { emitIntelligenceEvent } from './events'

type ToolContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: {
    resolve: <T = unknown>(name: string) => T
  }
  userFeatures: string[]
  isSuperAdmin: boolean
}

type AiToolDefinition = {
  name: string
  description: string
  inputSchema: z.ZodType<any>
  requiredFeatures?: string[]
  handler: (input: any, ctx: ToolContext) => Promise<unknown>
}

function getKnex(ctx: ToolContext): Knex {
  const em = ctx.container.resolve('em') as EntityManager
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

// =============================================================================
// Tool: agency_get_client_context
// =============================================================================

const getClientContextTool: AiToolDefinition = {
  name: 'agency_get_client_context',
  description: `Fetch full context for an agency client: profile, AI audit, target audience, and connected tools.
Use this before creating agent actions to understand the client's strategy and goals.

Returns: company_name, website_url, onboarding_status, audit (recommended_strategy, swot, competitor_analysis), audience (channels, personas, pain_points), connections (tool, status, display_name).`,
  inputSchema: z.object({
    client_profile_id: z.string().uuid().describe('The client_profile entity ID'),
  }),
  requiredFeatures: ['agency_intelligence.view'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) throw new Error('Tenant context required')
    const knex = getKnex(ctx)

    const profileRow = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:client_profile')
      .where('entity_id', input.client_profile_id)
      .where('tenant_id', ctx.tenantId)
      .whereNull('deleted_at')
      .first()

    if (!profileRow) {
      return { error: `Client profile not found: ${input.client_profile_id}` }
    }

    const profile = typeof profileRow.doc === 'string' ? JSON.parse(profileRow.doc) : profileRow.doc

    const auditRow = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:ai_audit')
      .where('tenant_id', ctx.tenantId)
      .whereRaw("doc->>'client_profile_id' = ?", [input.client_profile_id])
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .first()

    const audienceRow = await knex('custom_entities_storage')
      .where('entity_type', 'agency_onboarding:target_audience')
      .where('tenant_id', ctx.tenantId)
      .whereRaw("doc->>'client_profile_id' = ?", [input.client_profile_id])
      .whereNull('deleted_at')
      .first()

    const connectionRows = await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:client_connection')
      .where('tenant_id', ctx.tenantId)
      .whereRaw("doc->>'client_profile_id' = ?", [input.client_profile_id])
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc')
      .select('entity_id', 'doc')

    const audit = auditRow ? (typeof auditRow.doc === 'string' ? JSON.parse(auditRow.doc) : auditRow.doc) : null
    const audience = audienceRow ? (typeof audienceRow.doc === 'string' ? JSON.parse(audienceRow.doc) : audienceRow.doc) : null
    const connections = connectionRows.map((r: any) => {
      const doc = typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc
      return {
        id: r.entity_id,
        tool: doc.tool,
        display_name: doc.display_name,
        status: doc.status,
      }
    })

    return {
      profile: {
        id: input.client_profile_id,
        company_name: profile.company_name,
        website_url: profile.website_url,
        industry: profile.industry,
        monthly_ad_budget: profile.monthly_ad_budget,
        target_roas: profile.target_roas,
        gross_margin_pct: profile.gross_margin_pct,
        onboarding_status: profile.onboarding_status,
      },
      audit: audit
        ? {
            recommended_strategy: audit.recommended_strategy,
            swot: audit.swot,
            competitor_analysis: audit.competitor_analysis,
            communication_style: audit.communication_style,
            website_analysis: audit.website_analysis,
            audit_date: audit.audit_date,
          }
        : null,
      audience: audience
        ? {
            channels: audience.channels,
            personas: audience.personas,
            pain_points: audience.pain_points,
            buying_triggers: audience.buying_triggers,
          }
        : null,
      connections,
    }
  },
}

// =============================================================================
// Tool: agency_list_actions
// =============================================================================

const listActionsTool: AiToolDefinition = {
  name: 'agency_list_actions',
  description: `List recent or pending agent actions for a client.
Use this to check what has been proposed or done recently before creating new actions.

Returns: list of actions with id, title, agent_type, action_type, status, rationale, impact_estimate, result, created_at.`,
  inputSchema: z.object({
    client_profile_id: z.string().uuid().describe('The client_profile entity ID'),
    status: z
      .enum(['proposed', 'approved', 'executing', 'done', 'failed', 'skipped'])
      .optional()
      .describe('Filter by status (omit for all)'),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  requiredFeatures: ['agency_intelligence.view'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) throw new Error('Tenant context required')
    const knex = getKnex(ctx)

    let query = knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:agent_action')
      .where('tenant_id', ctx.tenantId)
      .whereRaw("doc->>'client_profile_id' = ?", [input.client_profile_id])
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .limit(input.limit ?? 20)

    if (input.status) {
      query = query.whereRaw("doc->>'status' = ?", [input.status])
    }

    const rows = await query.select('entity_id', 'doc', 'created_at')

    return {
      actions: rows.map((r: any) => {
        const doc = typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc
        return {
          id: r.entity_id,
          agent_type: doc.agent_type,
          action_type: doc.action_type,
          title: doc.title,
          rationale: doc.rationale,
          status: doc.status,
          impact_estimate: doc.impact_estimate,
          result: doc.result,
          created_at: r.created_at,
        }
      }),
    }
  },
}

// =============================================================================
// Tool: agency_create_action
// =============================================================================

const createActionTool: AiToolDefinition = {
  name: 'agency_create_action',
  description: `Propose a new agent action for a client.
Use this when you have analyzed the client context and decided on an optimization or action to take.

The action is created with status 'proposed'. Use agency_update_action to mark it as executing or done.`,
  inputSchema: z.object({
    client_profile_id: z.string().uuid().describe('The client_profile entity ID'),
    agent_type: z
      .enum(['optimizer', 'analyst', 'content_creator', 'media_buyer'])
      .describe('Type of agent creating this action'),
    action_type: z
      .enum([
        'bid_adjustment',
        'budget_reallocation',
        'audience_update',
        'creative_test',
        'pause_campaign',
        'campaign_create',
        'report',
        'alert',
      ])
      .describe('Category of the action'),
    title: z.string().min(1).max(500).describe('Short, descriptive title of the action'),
    rationale: z
      .string()
      .max(5000)
      .optional()
      .describe('Explanation of why this action is being taken — data, observations, reasoning'),
    impact_estimate: z
      .string()
      .max(500)
      .optional()
      .describe('Expected outcome, e.g. "ROAS +8%, CPC -15%"'),
    connection_id: z
      .string()
      .uuid()
      .optional()
      .describe('Which client_connection this action targets (optional)'),
  }),
  requiredFeatures: ['agency_intelligence.manage'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) throw new Error('Tenant context required')
    const knex = getKnex(ctx)

    const id = crypto.randomUUID()
    const now = new Date()

    await knex('custom_entities_storage').insert({
      entity_type: 'agency_intelligence:agent_action',
      entity_id: id,
      tenant_id: ctx.tenantId,
      organization_id: ctx.organizationId ?? null,
      doc: JSON.stringify({
        client_profile_id: input.client_profile_id,
        agent_type: input.agent_type,
        action_type: input.action_type,
        title: input.title,
        rationale: input.rationale ?? null,
        status: 'proposed',
        impact_estimate: input.impact_estimate ?? null,
        result: null,
        connection_id: input.connection_id ?? null,
      }),
      created_at: now,
      updated_at: now,
    })

    await emitIntelligenceEvent('agency_intelligence.action.proposed', {
      id,
      clientProfileId: input.client_profile_id,
      agentType: input.agent_type,
      actionType: input.action_type,
      title: input.title,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? null,
    })

    return { id, status: 'proposed', message: `Action created: ${input.title}` }
  },
}

// =============================================================================
// Tool: agency_update_action
// =============================================================================

const updateActionTool: AiToolDefinition = {
  name: 'agency_update_action',
  description: `Update the status and result of an agent action.
Use this after executing an action to record what happened.

Statuses: proposed → approved → executing → done | failed | skipped`,
  inputSchema: z.object({
    action_id: z.string().uuid().describe('The agent_action entity ID to update'),
    status: z
      .enum(['proposed', 'approved', 'executing', 'done', 'failed', 'skipped'])
      .describe('New status of the action'),
    result: z
      .string()
      .max(5000)
      .optional()
      .describe('Description of what actually happened after execution'),
  }),
  requiredFeatures: ['agency_intelligence.manage'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) throw new Error('Tenant context required')
    const knex = getKnex(ctx)

    const row = await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:agent_action')
      .where('entity_id', input.action_id)
      .where('tenant_id', ctx.tenantId)
      .whereNull('deleted_at')
      .first()

    if (!row) {
      return { error: `Action not found: ${input.action_id}` }
    }

    const existingDoc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc

    await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:agent_action')
      .where('entity_id', input.action_id)
      .where('tenant_id', ctx.tenantId)
      .update({
        doc: JSON.stringify({
          ...existingDoc,
          status: input.status,
          result: input.result ?? existingDoc.result ?? null,
        }),
        updated_at: new Date(),
      })

    if (input.status === 'done') {
      await emitIntelligenceEvent('agency_intelligence.action.completed', {
        id: input.action_id,
        clientProfileId: existingDoc.client_profile_id,
        status: input.status,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
      })
    } else if (input.status === 'failed') {
      await emitIntelligenceEvent('agency_intelligence.action.failed', {
        id: input.action_id,
        clientProfileId: existingDoc.client_profile_id,
        status: input.status,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
      })
    }

    return {
      id: input.action_id,
      status: input.status,
      message: `Action updated to status: ${input.status}`,
    }
  },
}

// =============================================================================
// Export
// =============================================================================

export const aiTools: AiToolDefinition[] = [
  getClientContextTool,
  listActionsTool,
  createActionTool,
  updateActionTool,
]

export default aiTools

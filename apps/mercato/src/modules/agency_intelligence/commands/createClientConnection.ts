import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { Knex } from 'knex'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'

export const createClientConnectionSchema = z.object({
  clientProfileId: z.string().uuid(),
  tool: z.enum(['ga4', 'meta_ads', 'google_ads', 'gtm', 'slack', 'email']),
  externalId: z.string().min(1).max(2048),
  displayName: z.string().max(255).optional(),
  tenantId: z.string(),
  organizationId: z.string().nullable().optional(),
})

export type CreateClientConnectionInput = z.infer<typeof createClientConnectionSchema>

function getKnex(ctx: CommandRuntimeContext): Knex {
  const em = ctx.container.resolve('em') as EntityManager
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

async function encryptIfEnabled(
  value: string,
  tenantId: string,
  container: CommandRuntimeContext['container'],
): Promise<string> {
  try {
    const encService = container.resolve('tenantDataEncryptionService') as any
    if (encService?.encrypt) {
      return await encService.encrypt(value, { tenantId })
    }
  } catch {
    // Encryption service not available — store plaintext
  }
  return value
}

registerCommand({
  id: 'agency_intelligence.connection.create',
  isUndoable: true,

  async execute(input: CreateClientConnectionInput, ctx: CommandRuntimeContext) {
    const knex = getKnex(ctx)
    const id = crypto.randomUUID()
    const now = new Date()

    const encryptedExternalId = await encryptIfEnabled(input.externalId, input.tenantId, ctx.container)

    await knex('custom_entities_storage').insert({
      entity_type: 'agency_intelligence:client_connection',
      entity_id: id,
      tenant_id: input.tenantId,
      organization_id: input.organizationId ?? null,
      doc: JSON.stringify({
        client_profile_id: input.clientProfileId,
        tool: input.tool,
        external_id: encryptedExternalId,
        display_name: input.displayName ?? null,
        status: 'connected',
        last_synced_at: null,
      }),
      created_at: now,
      updated_at: now,
    })

    return { id }
  },

  async undo(params) {
    const { input, ctx } = params
    const knex = getKnex(ctx)
    await knex('custom_entities_storage')
      .where('entity_type', 'agency_intelligence:client_connection')
      .where('tenant_id', (input as CreateClientConnectionInput).tenantId)
      .update({ deleted_at: new Date() })
  },
})

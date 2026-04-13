import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['agency_onboarding.*'],
    admin: ['agency_onboarding.*'],
    employee: ['agency_onboarding.view'],
  },

  async seedDefaults({ em }) {
    // Ensure attachment storage partitions exist — required for file uploads
    try {
      const { ensureDefaultPartitions } = await import('@open-mercato/core/modules/attachments/lib/partitions')
      await ensureDefaultPartitions(em as any)
    } catch (e) {
      console.warn('[agency_onboarding] Could not seed attachment partitions:', e)
    }
  },
}

export default setup

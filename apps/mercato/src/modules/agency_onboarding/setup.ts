import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['agency_onboarding.*'],
    admin: ['agency_onboarding.*'],
    employee: ['agency_onboarding.view'],
  },
}

export default setup

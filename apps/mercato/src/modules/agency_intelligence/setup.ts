import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['agency_intelligence.*'],
    admin: ['agency_intelligence.view', 'agency_intelligence.manage'],
    employee: ['agency_intelligence.view'],
  },
}

export default setup

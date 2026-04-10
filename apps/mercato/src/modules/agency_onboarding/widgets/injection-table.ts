import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'menu:sidebar:main': {
    widgetId: 'agency_onboarding.injection.menu',
    priority: 40,
  },
}

export default injectionTable

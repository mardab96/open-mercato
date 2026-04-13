import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'menu:sidebar:main': {
    widgetId: 'agency_intelligence.injection.menu',
    priority: 41,
  },
}

export default injectionTable

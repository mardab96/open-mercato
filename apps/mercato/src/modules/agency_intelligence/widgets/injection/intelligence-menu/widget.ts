import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'agency_intelligence.injection.menu',
  },
  menuItems: [
    {
      id: 'agency-intelligence-list',
      labelKey: 'agency_intelligence.menu.label',
      label: 'Agenci AI',
      icon: 'Bot',
      href: '/backend/agency_intelligence',
      groupLabelKey: 'agency_intelligence.menu.group',
      groupLabel: 'Klienci',
      features: ['agency_intelligence.view'],
      placement: { position: InjectionPosition.After, relativeTo: 'agency-onboarding-list' },
    },
  ],
}

export default widget

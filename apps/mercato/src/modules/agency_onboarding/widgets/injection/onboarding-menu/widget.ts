import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'agency_onboarding.injection.menu',
  },
  menuItems: [
    {
      id: 'agency-onboarding-list',
      labelKey: 'agency_onboarding.menu.label',
      label: 'Onboarding AI',
      icon: 'Brain',
      href: '/backend/agency_onboarding/list',
      features: ['agency_onboarding.view'],
      placement: { position: InjectionPosition.Before, relativeTo: 'sign-out' },
    },
  ],
}

export default widget

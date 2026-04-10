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
      label: 'Baza Klientów',
      icon: 'Brain',
      href: '/backend/agency_onboarding/list',
      groupLabelKey: 'agency_onboarding.menu.group',
      groupLabel: 'Klienci',
      features: ['agency_onboarding.view'],
      placement: { position: InjectionPosition.Before, relativeTo: 'sign-out' },
    },
  ],
}

export default widget

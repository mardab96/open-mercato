import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'agency_onboarding.client_profile.created',
    label: 'Client Profile Created',
    entity: 'client_profile',
    category: 'crud',
  },
  {
    id: 'agency_onboarding.audit.completed',
    label: 'AI Audit Completed',
    entity: 'ai_audit',
    category: 'lifecycle',
  },
  {
    id: 'agency_onboarding.audit.failed',
    label: 'AI Audit Failed',
    entity: 'ai_audit',
    category: 'lifecycle',
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'agency_onboarding',
  events,
})

export const emitOnboardingEvent = eventsConfig.emit
export type OnboardingEventId = (typeof events)[number]['id']
export default eventsConfig

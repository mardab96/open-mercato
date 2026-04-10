import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'agency_intelligence.action.proposed',
    label: 'Agent Action Proposed',
    entity: 'agent_action',
    category: 'lifecycle',
  },
  {
    id: 'agency_intelligence.action.completed',
    label: 'Agent Action Completed',
    entity: 'agent_action',
    category: 'lifecycle',
  },
  {
    id: 'agency_intelligence.action.failed',
    label: 'Agent Action Failed',
    entity: 'agent_action',
    category: 'lifecycle',
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'agency_intelligence',
  events,
})

export const emitIntelligenceEvent = eventsConfig.emit
export type IntelligenceEventId = (typeof events)[number]['id']
export default eventsConfig

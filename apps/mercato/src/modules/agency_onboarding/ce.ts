import type { CustomEntitySpec, CustomFieldDefinition } from '@open-mercato/shared/modules/entities'

const clientProfileFields = [
  {
    key: 'company_name',
    kind: 'text',
    label: 'Company Name',
    required: true,
    indexed: true,
    filterable: true,
    formEditable: true,
  },
  {
    key: 'industry',
    kind: 'select',
    label: 'Industry',
    options: ['e-commerce', 'saas', 'services', 'manufacturing', 'healthcare', 'education', 'finance', 'real_estate', 'hospitality', 'other'],
    indexed: true,
    filterable: true,
    formEditable: true,
  },
  {
    key: 'website_url',
    kind: 'text',
    label: 'Website URL',
    indexed: true,
    formEditable: true,
  },
  {
    key: 'monthly_ad_budget',
    kind: 'float',
    label: 'Monthly Ad Budget (PLN)',
    indexed: true,
    filterable: true,
    formEditable: true,
  },
  {
    key: 'target_roas',
    kind: 'float',
    label: 'Target ROAS',
    filterable: true,
    formEditable: true,
  },
  {
    key: 'gross_margin_pct',
    kind: 'float',
    label: 'Gross Margin (%)',
    formEditable: true,
  },
  {
    key: 'onboarding_status',
    kind: 'select',
    label: 'Onboarding Status',
    options: ['draft', 'in_progress', 'completed', 'active'],
    defaultValue: 'draft',
    indexed: true,
    filterable: true,
    formEditable: true,
  },
  {
    key: 'assigned_operator',
    kind: 'text',
    label: 'Assigned Operator',
    indexed: true,
    filterable: true,
    formEditable: true,
  },
  {
    key: 'notes',
    kind: 'multiline',
    label: 'Notes',
    editor: 'markdown',
    formEditable: true,
  },
] satisfies CustomFieldDefinition[]

const targetAudienceFields = [
  {
    key: 'audience_summary',
    kind: 'multiline',
    label: 'Audience Summary',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'personas',
    kind: 'multiline',
    label: 'Buyer Personas',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'pain_points',
    kind: 'multiline',
    label: 'Pain Points',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'buying_triggers',
    kind: 'multiline',
    label: 'Buying Triggers',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'channels',
    kind: 'select',
    label: 'Preferred Channels',
    multi: true,
    options: ['google_ads', 'meta_ads', 'linkedin_ads', 'tiktok_ads', 'email', 'seo', 'programmatic'],
    filterable: true,
    formEditable: true,
  },
] satisfies CustomFieldDefinition[]

const aiAuditFields = [
  {
    key: 'website_analysis',
    kind: 'multiline',
    label: 'Website Analysis',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'competitor_analysis',
    kind: 'multiline',
    label: 'Competitor Analysis',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'communication_style',
    kind: 'multiline',
    label: 'Communication Style (ToV)',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'swot',
    kind: 'multiline',
    label: 'SWOT Analysis',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'recommended_strategy',
    kind: 'multiline',
    label: 'Recommended Strategy',
    editor: 'markdown',
    formEditable: true,
  },
  {
    key: 'audit_date',
    kind: 'text',
    label: 'Audit Date',
    description: 'YYYY-MM-DD',
    indexed: true,
    formEditable: true,
  },
  {
    key: 'audit_version',
    kind: 'integer',
    label: 'Audit Version',
    defaultValue: 1,
    formEditable: true,
  },
] satisfies CustomFieldDefinition[]

export const entities: CustomEntitySpec[] = [
  {
    id: 'agency_onboarding:client_profile',
    label: 'Client Profile',
    description: 'Business profile and onboarding data for an agency client.',
    showInSidebar: true,
    fields: clientProfileFields,
  },
  {
    id: 'agency_onboarding:target_audience',
    label: 'Target Audience',
    description: 'Target audience definition, buyer personas, and channel preferences.',
    showInSidebar: true,
    fields: targetAudienceFields,
  },
  {
    id: 'agency_onboarding:ai_audit',
    label: 'AI Audit',
    description: 'AI-generated audit: website, competitors, communication style, SWOT, strategy.',
    showInSidebar: true,
    fields: aiAuditFields,
  },
]

export default entities

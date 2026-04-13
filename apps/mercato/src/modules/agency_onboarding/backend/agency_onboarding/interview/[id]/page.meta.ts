export const metadata = {
  requireAuth: true,
  requireFeatures: ['agency_onboarding.manage'],
  navHidden: true,
  breadcrumb: [
    { label: 'Onboarding', labelKey: 'agency_onboarding.title', href: '/backend/agency_onboarding' },
    { label: 'Client Details', labelKey: 'agency_onboarding.detail.title' },
    { label: 'Wywiad AI', labelKey: 'agency_onboarding.interview.title' },
  ],
}

/**
 * @jest-environment node
 */

describe('agency_onboarding injection-table', () => {
  it('registers menu widget for sidebar:main', async () => {
    const mod = await import('../../widgets/injection-table')
    const table = mod.injectionTable

    expect(table['menu:sidebar:main']).toBeDefined()
    const entry = table['menu:sidebar:main'] as { widgetId: string; priority: number }
    expect(entry.widgetId).toBe('agency_onboarding.injection.menu')
    expect(entry.priority).toBe(40)
  })
})

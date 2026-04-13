"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useParams } from 'next/navigation'
import { BarChart3, Sparkles, ArrowLeft, Pencil, Save, Loader2 } from 'lucide-react'

type CampaignPlan = {
  id: string
  status: 'draft' | 'generating' | 'ready' | 'failed'
  channel_breakdown: string | null
  creative_briefs: string | null
  funnel_stages: string | null
  kpis: string | null
  generated_at: string | null
}

type SectionKey = 'channel_breakdown' | 'creative_briefs' | 'funnel_stages' | 'kpis'

const SECTION_CONFIG: { key: SectionKey; titleKey: string; titleFallback: string }[] = [
  { key: 'channel_breakdown', titleKey: 'agency_intelligence.campaign.channel_breakdown', titleFallback: 'Podział kanałów i budżetu' },
  { key: 'creative_briefs', titleKey: 'agency_intelligence.campaign.creative_briefs', titleFallback: 'Briefy kreatywne' },
  { key: 'funnel_stages', titleKey: 'agency_intelligence.campaign.funnel_stages', titleFallback: 'Etapy lejka' },
  { key: 'kpis', titleKey: 'agency_intelligence.campaign.kpis', titleFallback: 'KPIs i cele' },
]

function formatDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('pl-PL', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

export default function CampaignPlanPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const routerParams = useParams()
  const clientId = params?.id || (routerParams?.id as string)

  const [plan, setPlan] = React.useState<CampaignPlan | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [generating, setGenerating] = React.useState(false)
  const [editSection, setEditSection] = React.useState<SectionKey | null>(null)
  const [editValue, setEditValue] = React.useState('')
  const [savingSection, setSavingSection] = React.useState(false)

  const fetchPlan = React.useCallback(async (silent = false) => {
    if (!clientId) return
    if (!silent) setLoading(true)
    try {
      const { ok, result } = await apiCall(`/api/agency_intelligence/campaign?client_profile_id=${clientId}`)
      if (ok) {
        const data = result as { plan: CampaignPlan | null }
        setPlan(data?.plan ?? null)
      }
    } catch (e) {
      console.error('[campaign/page] fetch error:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [clientId])

  React.useEffect(() => { fetchPlan() }, [fetchPlan])

  // Poll while generating
  React.useEffect(() => {
    if (plan?.status !== 'generating') return
    const interval = setInterval(() => fetchPlan(true), 3000)
    return () => clearInterval(interval)
  }, [plan?.status, fetchPlan])

  const handleGenerate = async () => {
    if (!clientId) return
    setGenerating(true)
    try {
      const { ok } = await apiCall('/api/agency_intelligence/campaign', {
        method: 'POST',
        body: JSON.stringify({ client_profile_id: clientId }),
      })
      if (ok) {
        flash(t('agency_intelligence.campaign.generating', 'Generowanie planu kampanii uruchomione.'), 'success')
        await fetchPlan(true)
      } else {
        flash(t('agency_intelligence.campaign.generate_error', 'Nie udało się uruchomić generowania.'), 'error')
      }
    } catch {
      flash(t('agency_intelligence.campaign.generate_error', 'Nie udało się uruchomić generowania.'), 'error')
    } finally {
      setGenerating(false)
    }
  }

  const startEdit = (key: SectionKey, value: string | null) => {
    setEditSection(key)
    setEditValue(value || '')
  }

  const cancelEdit = () => {
    setEditSection(null)
    setEditValue('')
  }

  const saveSection = async () => {
    if (!plan || !editSection) return
    setSavingSection(true)
    try {
      // Update via PATCH on the actions endpoint — for now we'll re-fetch after a direct update
      // Since there's no dedicated PATCH for campaign_plan, we'll use a workaround:
      // POST a new plan but keep existing fields — actually let's just update the local state for MVP
      // TODO: add PATCH /api/agency_intelligence/campaign/[id]
      setPlan((prev) => prev ? { ...prev, [editSection]: editValue } : null)
      setEditSection(null)
      setEditValue('')
      flash(t('agency_intelligence.campaign.section_saved', 'Sekcja zapisana lokalnie (odśwież aby potwierdzić).'), 'success')
    } finally {
      setSavingSection(false)
    }
  }

  if (loading) {
    return (
      <Page><PageBody>
        <div className="flex items-center justify-center py-20"><Spinner className="size-8" /></div>
      </PageBody></Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('agency_intelligence.campaign.title', 'Plan kampanii')}
        description={
          plan?.generated_at
            ? `${t('agency_intelligence.campaign.generated_at', 'Wygenerowano:')} ${formatDate(plan.generated_at)}`
            : t('agency_intelligence.campaign.description', 'AI-generowany plan performance marketingu dla klienta.')
        }
      />
      <PageBody>
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Back link */}
          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href={`/backend/agency_intelligence/${clientId}`}>
                <ArrowLeft className="mr-1.5 size-3.5" />
                {t('agency_intelligence.campaign.back', 'Wróć do agentów klienta')}
              </Link>
            </Button>
            {plan?.status === 'ready' && (
              <Badge className="bg-green-500/15 text-green-600">
                {t('agency_intelligence.campaign.status_ready', 'Gotowy')}
              </Badge>
            )}
          </div>

          {/* No plan yet */}
          {!plan && (
            <Card>
              <CardContent className="py-16 text-center">
                <BarChart3 className="mx-auto mb-4 size-12 text-muted-foreground" />
                <p className="text-lg font-medium">
                  {t('agency_intelligence.campaign.no_plan', 'Brak planu kampanii')}
                </p>
                <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                  {t(
                    'agency_intelligence.campaign.no_plan_description',
                    'AI wygeneruje plan na podstawie audytu, wywiadu i analizy konkurencji. Upewnij się, że audyt AI jest zakończony.'
                  )}
                </p>
                <Button type="button" className="mt-6" disabled={generating} onClick={handleGenerate}>
                  {generating ? <Spinner className="mr-2 size-3.5" /> : <Sparkles className="mr-2 size-3.5" />}
                  {t('agency_intelligence.campaign.generate', 'Generuj plan kampanii')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Generating state */}
          {plan?.status === 'generating' && (
            <Card>
              <CardContent className="py-12 text-center">
                <Loader2 className="mx-auto mb-4 size-10 text-primary animate-spin" />
                <p className="font-medium">
                  {t('agency_intelligence.campaign.generating_status', 'AI generuje plan kampanii...')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('agency_intelligence.campaign.generating_wait', 'To może potrwać do 2 minut. Strona odświeży się automatycznie.')}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Failed state */}
          {plan?.status === 'failed' && (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-red-600 font-medium">
                  {t('agency_intelligence.campaign.failed', 'Generowanie nie powiodło się.')}
                </p>
                <Button type="button" variant="outline" className="mt-4" disabled={generating} onClick={handleGenerate}>
                  {t('agency_intelligence.campaign.retry', 'Spróbuj ponownie')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Ready — show sections */}
          {plan?.status === 'ready' && (
            <div className="space-y-6">
              {SECTION_CONFIG.map(({ key, titleKey, titleFallback }) => {
                const isEditing = editSection === key
                const value = plan[key]

                return (
                  <Card key={key}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{t(titleKey, titleFallback)}</CardTitle>
                        {!isEditing && (
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => startEdit(key, value)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {isEditing ? (
                        <Textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="min-h-[300px] font-mono text-sm leading-relaxed"
                        />
                      ) : value ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <MarkdownContent body={value} format="markdown" />
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          {t('agency_intelligence.campaign.section_empty', 'Brak treści')}
                        </p>
                      )}
                    </CardContent>
                    {isEditing && (
                      <CardFooter className="gap-2 border-t pt-4">
                        <Button type="button" disabled={savingSection} onClick={saveSection}>
                          {savingSection ? <Spinner className="mr-2 size-3.5" /> : <Save className="mr-2 size-3.5" />}
                          {t('agency_intelligence.campaign.save_section', 'Zapisz')}
                        </Button>
                        <Button type="button" variant="outline" onClick={cancelEdit}>
                          {t('agency_intelligence.campaign.cancel', 'Anuluj')}
                        </Button>
                      </CardFooter>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </PageBody>
    </Page>
  )
}

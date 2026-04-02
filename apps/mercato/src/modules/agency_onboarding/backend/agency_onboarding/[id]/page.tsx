"use client"

import * as React from 'react'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@open-mercato/ui/primitives/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useParams } from 'next/navigation'
import { RefreshCw, Save, Building2, Globe, Brain, Eye, Pencil } from 'lucide-react'

const CLIENT_ENTITY = 'agency_onboarding:client_profile'

type ClientProfile = {
  id: string
  company_name?: string
  website_url?: string
  onboarding_status?: string
  [key: string]: unknown
}

type AuditData = {
  recommended_strategy?: string
  audit_date?: string
  audit_version?: number
  [key: string]: unknown
}

type AudienceData = {
  channels?: string[]
  [key: string]: unknown
}

const PROCESSING_STATUSES = ['in_progress', 'scraping_website', 'ai_analyzing']

const STEP_CONFIG: Record<string, { progress: number; label: string }> = {
  in_progress: { progress: 10, label: 'Uruchamianie audytu...' },
  scraping_website: { progress: 30, label: 'Krok 1/2: Pobieranie i czytanie strony WWW...' },
  ai_analyzing: { progress: 65, label: 'Krok 2/2: Sztuczna inteligencja analizuje dane...' },
}

function StatusBadge({ status }: { status?: string }) {
  const map: Record<string, { color: string; label: string }> = {
    draft: { color: 'bg-muted text-muted-foreground', label: 'Szkic' },
    in_progress: { color: 'bg-yellow-500/15 text-yellow-600', label: 'W trakcie' },
    scraping_website: { color: 'bg-yellow-500/15 text-yellow-600', label: 'Scraping WWW' },
    ai_analyzing: { color: 'bg-purple-500/15 text-purple-600', label: 'Analiza AI' },
    completed: { color: 'bg-green-500/15 text-green-600', label: 'Zakończony' },
    failed: { color: 'bg-red-500/15 text-red-600', label: 'Błąd' },
  }
  const s = map[status || 'draft'] || map.draft
  return <Badge className={s.color}>{s.label}</Badge>
}

function AuditProgressCard({ status }: { status: string }) {
  const config = STEP_CONFIG[status] || STEP_CONFIG.in_progress
  const [progress, setProgress] = React.useState(0)

  React.useEffect(() => {
    const t = setTimeout(() => setProgress(config.progress), 200)
    return () => clearTimeout(t)
  }, [config.progress])

  React.useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => (p >= config.progress + 15 ? config.progress : p + 1))
    }, 800)
    return () => clearInterval(interval)
  }, [config.progress])

  return (
    <Card>
      <CardContent className="py-10">
        <div className="mx-auto max-w-md space-y-6 text-center">
          <Brain className="mx-auto size-12 text-primary animate-pulse" />
          <p className="font-medium text-lg">{config.label}</p>
          <p className="text-sm text-muted-foreground">
            {status === 'scraping_website'
              ? 'Przeglądarka headless odwiedza stronę klienta i podstrony...'
              : 'Model GPT-4o generuje ustrukturyzowany audyt wg szablonu A-K...'}
          </p>
          <div className="space-y-1">
            <Progress value={progress} className="h-3" />
            <p className="text-xs text-muted-foreground">{Math.min(progress, 95)}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function ClientDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const routerParams = useParams()
  const recordId = params?.id || (routerParams?.id as string)

  const [profile, setProfile] = React.useState<ClientProfile | null>(null)
  const [audit, setAudit] = React.useState<AuditData | null>(null)
  const [audience, setAudience] = React.useState<AudienceData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [rerunning, setRerunning] = React.useState(false)

  // Audit editor state
  const [auditText, setAuditText] = React.useState('')
  const [auditDirty, setAuditDirty] = React.useState(false)
  const [savingAudit, setSavingAudit] = React.useState(false)
  const [previewMode, setPreviewMode] = React.useState(true)

  const fetchData = React.useCallback(async (silent = false) => {
    if (!recordId) return
    if (!silent) setLoading(true)
    try {
      const { ok, result } = await apiCall(`/api/agency_onboarding/client?id=${recordId}`)
      const data = result as any

      if (ok && data?.profile) {
        setProfile({ ...data.profile, id: recordId })
      }

      if (data?.audit) {
        setAudit(data.audit)
        if (!auditDirty) {
          setAuditText(data.audit.recommended_strategy || '')
        }
      }
      if (data?.audience) setAudience(data.audience)
    } catch (e) {
      console.error('[detail] Failed to load data:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [recordId, auditDirty])

  React.useEffect(() => { fetchData() }, [fetchData])

  // Polling while processing
  React.useEffect(() => {
    const isProcessing = profile?.onboarding_status && PROCESSING_STATUSES.includes(profile.onboarding_status)
    if (!isProcessing) return
    const interval = setInterval(() => fetchData(true), 3000)
    return () => clearInterval(interval)
  }, [profile?.onboarding_status, fetchData])

  const handleSaveAudit = async () => {
    if (!audit) return
    setSavingAudit(true)
    try {
      // Find the audit record ID from DB to update it
      const { ok } = await apiCall('/api/agency_onboarding/save-audit', {
        method: 'POST',
        body: JSON.stringify({
          clientRecordId: recordId,
          recommendedStrategy: auditText,
        }),
      })
      if (ok) {
        setAuditDirty(false)
        flash('Audyt zapisany.', 'success')
        await fetchData(true)
      } else {
        flash('Nie udało się zapisać audytu.', 'error')
      }
    } catch {
      flash('Nie udało się zapisać audytu.', 'error')
    } finally {
      setSavingAudit(false)
    }
  }

  const handleRerunAudit = async () => {
    if (!recordId) return
    setRerunning(true)
    try {
      const { ok } = await apiCall('/api/agency_onboarding/trigger-audit', {
        method: 'POST',
        body: JSON.stringify({ recordId, entityId: CLIENT_ENTITY }),
      })
      if (ok) {
        flash('Audyt AI uruchomiony ponownie.', 'success')
        setAuditDirty(false)
        setTimeout(() => fetchData(true), 1000)
      } else {
        flash('Nie udało się uruchomić audytu.', 'error')
      }
    } catch {
      flash('Nie udało się uruchomić audytu.', 'error')
    } finally {
      setRerunning(false)
    }
  }

  if (loading) {
    return (
      <Page><PageBody>
        <div className="flex items-center justify-center py-20"><Spinner className="size-8" /></div>
      </PageBody></Page>
    )
  }

  if (!profile) {
    return (
      <Page>
        <PageHeader title="Client not found" />
        <PageBody><p className="text-muted-foreground">Record {recordId} not found.</p></PageBody>
      </Page>
    )
  }

  const isProcessing = PROCESSING_STATUSES.includes(profile.onboarding_status || '')
  const isFailed = profile.onboarding_status === 'failed'
  const hasAudit = !!audit?.recommended_strategy
  const channels = audience?.channels && Array.isArray(audience.channels) ? audience.channels : []

  return (
    <Page>
      <PageHeader
        title={profile.company_name || 'Client'}
        description={profile.website_url || ''}
      />
      <PageBody>
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Status + Actions bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StatusBadge status={profile.onboarding_status} />
              {audit?.audit_date && (
                <span className="text-xs text-muted-foreground">
                  Audit: {audit.audit_date} (v{audit.audit_version || 1})
                </span>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={rerunning || isProcessing} onClick={handleRerunAudit}>
              {rerunning ? <Spinner className="mr-2 size-3.5" /> : <RefreshCw className="mr-2 size-3.5" />}
              Ponów Audyt AI
            </Button>
          </div>

          {/* Progress bar */}
          {isProcessing && <AuditProgressCard status={profile.onboarding_status || 'in_progress'} />}

          {/* Failed state */}
          {isFailed && (
            <Card>
              <CardContent className="py-8">
                <div className="mx-auto max-w-md space-y-4 text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-500/15">
                    <Brain className="size-6 text-red-600" />
                  </div>
                  <p className="font-medium text-red-600">Audyt AI nie powiódł się</p>
                  <p className="text-sm text-muted-foreground">
                    Wystąpił błąd podczas generowania audytu. Kliknij "Ponów Audyt AI" aby spróbować ponownie.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue={hasAudit ? 'audit' : 'profile'}>
            <TabsList>
              <TabsTrigger value="profile">
                <Building2 className="mr-1.5 size-3.5" />
                Profil Klienta
              </TabsTrigger>
              <TabsTrigger value="audit">
                <Brain className="mr-1.5 size-3.5" />
                Audyt AI
              </TabsTrigger>
            </TabsList>

            {/* TAB: Profile — simplified CRM basics only */}
            <TabsContent value="profile" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Informacje podstawowe</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-muted-foreground flex items-center gap-1.5">
                        <Building2 className="size-3" /> Nazwa firmy
                      </label>
                      <p className="text-sm font-medium">{profile.company_name || '—'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-muted-foreground flex items-center gap-1.5">
                        <Globe className="size-3" /> Adres WWW
                      </label>
                      {profile.website_url ? (
                        <a href={profile.website_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                          {profile.website_url}
                        </a>
                      ) : <p className="text-sm text-muted-foreground">—</p>}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-muted-foreground">Status</label>
                      <div><StatusBadge status={profile.onboarding_status} /></div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-muted-foreground">Audyt</label>
                      <p className="text-sm">{audit?.audit_date ? `${audit.audit_date} (v${audit.audit_version || 1})` : 'Brak'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB: AI Audit — editable Markdown + channels */}
            <TabsContent value="audit" className="space-y-4 mt-4">
              {!hasAudit && !isProcessing ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Brain className="mx-auto mb-3 size-10 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      Brak audytu. Kliknij "Ponów Audyt AI" aby wygenerować.
                    </p>
                  </CardContent>
                </Card>
              ) : hasAudit ? (
                <>
                  {/* Toggle: Preview / Edit */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant={previewMode ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPreviewMode(true)}
                      >
                        <Eye className="mr-1.5 size-3.5" /> Podgląd
                      </Button>
                      <Button
                        type="button"
                        variant={!previewMode ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPreviewMode(false)}
                      >
                        <Pencil className="mr-1.5 size-3.5" /> Edycja
                      </Button>
                    </div>
                    {auditDirty && (
                      <span className="text-xs text-yellow-600">Niezapisane zmiany</span>
                    )}
                  </div>

                  {/* Audit content */}
                  <Card>
                    <CardContent className="pt-6">
                      {previewMode ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <MarkdownContent body={auditText} format="markdown" />
                        </div>
                      ) : (
                        <Textarea
                          value={auditText}
                          onChange={(e) => {
                            setAuditText(e.target.value)
                            setAuditDirty(true)
                          }}
                          className="min-h-[600px] font-mono text-sm leading-relaxed"
                          placeholder="Markdown audytu..."
                        />
                      )}
                    </CardContent>
                    {!previewMode && (
                      <CardFooter>
                        <Button type="button" disabled={savingAudit || !auditDirty} onClick={handleSaveAudit}>
                          {savingAudit ? <Spinner className="mr-2 size-3.5" /> : <Save className="mr-2 size-3.5" />}
                          Zapisz zmiany w audycie
                        </Button>
                      </CardFooter>
                    )}
                  </Card>

                  {/* Recommended channels — at the bottom of audit tab */}
                  {channels.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Rekomendowane Kanały</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2">
                          {channels.map((ch) => (
                            <Badge key={ch} variant="outline">{ch}</Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : null}
            </TabsContent>
          </Tabs>
        </div>
      </PageBody>
    </Page>
  )
}

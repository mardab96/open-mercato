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
import Link from 'next/link'
import { RefreshCw, Save, Building2, Globe, Brain, Eye, Pencil, MessageSquare, Search, Plus, Loader2, CheckCircle2, XCircle, Users, ChevronDown, ChevronUp } from 'lucide-react'

const CLIENT_ENTITY = 'agency_onboarding:client_profile'

type CompetitorDomain = {
  id: string
  url: string
  display_name: string | null
  status: 'pending' | 'scraping' | 'done' | 'failed'
  is_ai_suggested: string
  audit_results: string | null
  created_at: string
}

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
  const [competitors, setCompetitors] = React.useState<CompetitorDomain[]>([])
  const [newCompetitorUrl, setNewCompetitorUrl] = React.useState('')
  const [newCompetitorUrlError, setNewCompetitorUrlError] = React.useState('')
  const [addingCompetitor, setAddingCompetitor] = React.useState(false)
  const [triggeringAudit, setTriggeringAudit] = React.useState<string | null>(null)
  const [expandedCompetitors, setExpandedCompetitors] = React.useState<Set<string>>(new Set())

  // Audit editor state
  const [auditText, setAuditText] = React.useState('')
  const [auditDirty, setAuditDirty] = React.useState(false)
  const [savingAudit, setSavingAudit] = React.useState(false)
  const [previewMode, setPreviewMode] = React.useState(true)

  const fetchCompetitors = React.useCallback(async () => {
    if (!recordId) return
    const { ok, result } = await apiCall(`/api/agency_onboarding/competitors?client_profile_id=${recordId}`)
    if (ok) setCompetitors((result as any)?.items || [])
  }, [recordId])

  const handleAddCompetitor = async (url: string, isAiSuggested = false) => {
    let normalized = url.trim()
    if (!normalized) return

    // Auto-prepend https:// if missing
    if (normalized && !normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`
    }

    // Client-side URL validation
    try {
      new URL(normalized)
    } catch {
      setNewCompetitorUrlError(t('agency_onboarding.competitors.url_invalid', 'Nieprawidłowy URL. Użyj formatu: https://example.pl'))
      return
    }
    setNewCompetitorUrlError('')

    setAddingCompetitor(true)
    try {
      const { ok, result } = await apiCall('/api/agency_onboarding/competitors', {
        method: 'POST',
        body: JSON.stringify({ client_profile_id: recordId, url: normalized, is_ai_suggested: isAiSuggested }),
      })
      if (ok) {
        flash(t('agency_onboarding.competitors.added', 'Domena dodana.'), 'success')
        setNewCompetitorUrl('')
        setNewCompetitorUrlError('')
        await fetchCompetitors()
      } else {
        const errMsg = (result as any)?.error || t('agency_onboarding.competitors.add_error', 'Nie udało się dodać domeny.')
        setNewCompetitorUrlError(errMsg)
      }
    } catch {
      setNewCompetitorUrlError(t('agency_onboarding.competitors.add_error', 'Nie udało się dodać domeny.'))
    } finally {
      setAddingCompetitor(false)
    }
  }

  const handleTriggerAudit = async (competitorId: string) => {
    setTriggeringAudit(competitorId)
    try {
      const { ok } = await apiCall(`/api/agency_onboarding/competitors/${competitorId}/audit`, { method: 'POST' })
      if (ok) {
        flash(t('agency_onboarding.competitors.audit_started', 'Audyt konkurenta uruchomiony.'), 'success')
        await fetchCompetitors()
        // Poll for completion
        const pollInterval = setInterval(async () => {
          await fetchCompetitors()
        }, 4000)
        setTimeout(() => clearInterval(pollInterval), 60000)
      } else {
        flash(t('agency_onboarding.competitors.audit_error', 'Nie udało się uruchomić audytu.'), 'error')
      }
    } catch {
      flash(t('agency_onboarding.competitors.audit_error', 'Nie udało się uruchomić audytu.'), 'error')
    } finally {
      setTriggeringAudit(null)
    }
  }

  function extractUrlsFromMarkdown(markdown: string): string[] {
    const urlRegex = /https?:\/\/[^\s)\]'"]+/g
    const matches = markdown.match(urlRegex) || []
    // Deduplicate and filter out client's own domain
    const unique = [...new Set(matches)].filter((url) => {
      try {
        const host = new URL(url).hostname
        const clientHost = profile?.website_url ? new URL(profile.website_url).hostname : ''
        return host !== clientHost && !host.includes('google') && !host.includes('facebook')
      } catch { return false }
    })
    return unique.slice(0, 5)
  }

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

  React.useEffect(() => {
    fetchData()
    fetchCompetitors()
  }, [fetchData, fetchCompetitors])

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
                {t('agency_onboarding.tabs.profile', 'Profil Klienta')}
              </TabsTrigger>
              <TabsTrigger value="audit">
                <Brain className="mr-1.5 size-3.5" />
                {t('agency_onboarding.tabs.audit', 'Audyt AI')}
              </TabsTrigger>
              <TabsTrigger value="audience">
                <Users className="mr-1.5 size-3.5" />
                {t('agency_onboarding.tabs.audience', 'Audience')}
                {audience && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-green-500" />}
              </TabsTrigger>
              <TabsTrigger value="competitors">
                <Search className="mr-1.5 size-3.5" />
                {t('agency_onboarding.tabs.competitors', 'Konkurenci')}
                {competitors.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {competitors.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* TAB: Profile — simplified CRM basics only */}
            <TabsContent value="profile" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('agency_onboarding.profile.basic_info', 'Informacje podstawowe')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-muted-foreground flex items-center gap-1.5">
                        <Building2 className="size-3" /> {t('agency_onboarding.profile.company_name', 'Nazwa firmy')}
                      </label>
                      <p className="text-sm font-medium">{profile.company_name || '—'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-muted-foreground flex items-center gap-1.5">
                        <Globe className="size-3" /> {t('agency_onboarding.profile.website', 'Adres WWW')}
                      </label>
                      {profile.website_url ? (
                        <a href={profile.website_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">
                          {profile.website_url}
                        </a>
                      ) : <p className="text-sm text-muted-foreground">—</p>}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-muted-foreground">
                        {t('agency_onboarding.profile.status', 'Status')}
                      </label>
                      <div><StatusBadge status={profile.onboarding_status} /></div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-muted-foreground">
                        {t('agency_onboarding.profile.audit', 'Audyt')}
                      </label>
                      <p className="text-sm">
                        {audit?.audit_date ? `${audit.audit_date} (v${audit.audit_version || 1})` : t('agency_onboarding.profile.no_audit', 'Brak')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* AI Interview CTA */}
              <Card>
                <CardContent className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">
                      {t('agency_onboarding.interview.cta_title', 'Wywiad AI z klientem')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t(
                        'agency_onboarding.interview.cta_description',
                        'AI przeprowadzi 8 pytań i automatycznie wypełni profil grupy docelowej.'
                      )}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link href={`/backend/agency_onboarding/interview/${recordId}`}>
                      <MessageSquare className="mr-1.5 size-3.5" />
                      {t('agency_onboarding.interview.start', 'Przeprowadź wywiad AI')}
                    </Link>
                  </Button>
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
            {/* TAB: Audience */}
            <TabsContent value="audience" className="mt-4 space-y-4">
              {!audience ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Users className="mx-auto mb-3 size-10 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      {t('agency_onboarding.audience.empty', 'Brak danych o grupie docelowej.')}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('agency_onboarding.audience.empty_hint', 'Przeprowadź wywiad AI w zakładce Profil Klienta, aby wypełnić tę sekcję.')}
                    </p>
                    <Button type="button" variant="outline" size="sm" className="mt-4" asChild>
                      <Link href={`/backend/agency_onboarding/interview/${recordId}`}>
                        <MessageSquare className="mr-1.5 size-3.5" />
                        {t('agency_onboarding.interview.start', 'Przeprowadź wywiad AI')}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {[
                    { key: 'audience_summary', label: t('agency_onboarding.audience.summary', 'Podsumowanie wywiadu') },
                    { key: 'personas', label: t('agency_onboarding.audience.personas', 'Persony kupujące') },
                    { key: 'pain_points', label: t('agency_onboarding.audience.pain_points', 'Pain points') },
                    { key: 'buying_triggers', label: t('agency_onboarding.audience.buying_triggers', 'Trigery zakupowe') },
                  ].map(({ key, label }) => {
                    const value = (audience as Record<string, unknown>)[key]
                    if (!value || typeof value !== 'string') return null
                    return (
                      <Card key={key}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">{label}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <MarkdownContent body={value} format="markdown" />
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                  {channels.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{t('agency_onboarding.audience.channels', 'Preferowane kanały')}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2">
                          {channels.map((ch) => (
                            <span key={ch} className="rounded-full border border-input bg-muted px-3 py-1 text-xs font-medium">{ch}</span>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" asChild>
                      <Link href={`/backend/agency_onboarding/interview/${recordId}`}>
                        <RefreshCw className="mr-1.5 size-3.5" />
                        {t('agency_onboarding.interview.redo', 'Ponów wywiad AI')}
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* TAB: Competitors */}
            <TabsContent value="competitors" className="mt-4 space-y-4">
              {/* AI suggestions from audit */}
              {typeof audit?.competitor_analysis === 'string' && (() => {
                const suggestedUrls = extractUrlsFromMarkdown(audit.competitor_analysis as string)
                const alreadyAdded = competitors.map((c) => c.url)
                const toShow = suggestedUrls.filter((url) => !alreadyAdded.includes(url))
                if (toShow.length === 0) return null
                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Brain className="size-4 text-primary" />
                        {t('agency_onboarding.competitors.ai_suggestions', 'AI sugeruje (z audytu)')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {toShow.map((url) => (
                        <div key={url} className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                          <p className="text-sm truncate text-muted-foreground">{url}</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={addingCompetitor}
                            onClick={() => handleAddCompetitor(url, true)}
                          >
                            {addingCompetitor ? <Spinner className="size-3" /> : <Plus className="size-3" />}
                            <span className="ml-1">{t('agency_onboarding.competitors.add', 'Dodaj')}</span>
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )
              })()}

              {/* Add custom competitor */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {t('agency_onboarding.competitors.add_custom', 'Dodaj domenę konkurenta')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCompetitorUrl}
                      onChange={(e) => { setNewCompetitorUrl(e.target.value); setNewCompetitorUrlError('') }}
                      placeholder="https://competitor.pl lub competitor.pl"
                      className={`flex-1 rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring ${newCompetitorUrlError ? 'border-red-400' : 'border-input'}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddCompetitor(newCompetitorUrl)
                      }}
                    />
                    <Button
                      type="button"
                      disabled={addingCompetitor || !newCompetitorUrl.trim()}
                      onClick={() => handleAddCompetitor(newCompetitorUrl)}
                    >
                      {addingCompetitor ? <Spinner className="mr-1.5 size-3.5" /> : <Plus className="mr-1.5 size-3.5" />}
                      {t('agency_onboarding.competitors.add_button', 'Dodaj')}
                    </Button>
                  </div>
                  {newCompetitorUrlError && (
                    <p className="text-xs text-red-500">{newCompetitorUrlError}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t('agency_onboarding.competitors.url_hint', 'Wpisz URL z https:// lub samą domenę — https:// zostanie dodane automatycznie.')}
                  </p>
                </CardContent>
              </Card>

              {/* Competitor list */}
              {competitors.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center">
                    <Search className="mx-auto mb-3 size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {t('agency_onboarding.competitors.empty', 'Brak dodanych domen konkurentów.')}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {competitors.map((competitor) => {
                    const statusConfig: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
                      pending: { color: 'bg-muted text-muted-foreground', label: t('agency_onboarding.competitors.status.pending', 'Oczekuje'), icon: null },
                      scraping: { color: 'bg-yellow-500/15 text-yellow-600', label: t('agency_onboarding.competitors.status.scraping', 'Scraping...'), icon: <Loader2 className="size-3 animate-spin" /> },
                      done: { color: 'bg-green-500/15 text-green-600', label: t('agency_onboarding.competitors.status.done', 'Gotowe'), icon: <CheckCircle2 className="size-3" /> },
                      failed: { color: 'bg-red-500/15 text-red-600', label: t('agency_onboarding.competitors.status.failed', 'Błąd'), icon: <XCircle className="size-3" /> },
                    }
                    const cfg = statusConfig[competitor.status] || statusConfig.pending

                    return (
                      <Card key={competitor.id}>
                        <CardContent className="py-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{competitor.display_name || competitor.url}</p>
                                {competitor.display_name && (
                                  <p className="text-xs text-muted-foreground truncate">{competitor.url}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                                  {cfg.icon}
                                  {cfg.label}
                                </span>
                                {(competitor.status === 'pending' || competitor.status === 'failed') && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={triggeringAudit === competitor.id}
                                    onClick={() => handleTriggerAudit(competitor.id)}
                                  >
                                    {triggeringAudit === competitor.id ? (
                                      <Spinner className="mr-1.5 size-3" />
                                    ) : (
                                      <Brain className="mr-1.5 size-3" />
                                    )}
                                    {t('agency_onboarding.competitors.run_audit', 'Audyt')}
                                  </Button>
                                )}
                              </div>
                            </div>
                            {competitor.audit_results && (
                              <div className="rounded-md bg-muted/50 p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-medium text-muted-foreground">
                                    {t('agency_onboarding.competitors.audit_results', 'Wyniki audytu:')}
                                  </p>
                                  <button
                                    type="button"
                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => {
                                      setExpandedCompetitors((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(competitor.id)) next.delete(competitor.id)
                                        else next.add(competitor.id)
                                        return next
                                      })
                                    }}
                                  >
                                    {expandedCompetitors.has(competitor.id) ? (
                                      <><ChevronUp className="size-3" /> {t('agency_onboarding.competitors.collapse', 'Zwiń')}</>
                                    ) : (
                                      <><ChevronDown className="size-3" /> {t('agency_onboarding.competitors.expand', 'Rozwiń')}</>
                                    )}
                                  </button>
                                </div>
                                <div className={expandedCompetitors.has(competitor.id) ? '' : 'line-clamp-3'}>
                                  <div className="prose prose-xs dark:prose-invert max-w-none text-xs">
                                    <MarkdownContent body={competitor.audit_results} format="markdown" />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </PageBody>
    </Page>
  )
}

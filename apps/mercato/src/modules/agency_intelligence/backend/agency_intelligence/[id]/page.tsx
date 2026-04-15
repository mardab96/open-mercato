"use client"

import * as React from 'react'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Bot, Plug, Plus, CheckCircle2, XCircle, Clock, Loader2, SkipForward, Globe, BarChart3, ThumbsUp, Play, Ban, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react'

type ClientProfile = {
  id: string
  company_name?: string
  website_url?: string
  onboarding_status?: string
}

type Connection = {
  id: string
  tool: string
  display_name: string | null
  status: string
  last_synced_at: string | null
  account_name: string | null
  account_currency: string | null
  verified_at: string | null
  error_message: string | null
  campaigns_count: number | null
  cached_metrics: {
    spend_7d?: number
    impressions_7d?: number
    clicks_7d?: number
    ctr_7d?: number
    currency?: string
  } | null
  created_at: string
}

const AD_PLATFORMS = ['meta_ads', 'google_ads']

function isAdPlatform(tool: string): boolean {
  return AD_PLATFORMS.includes(tool)
}

type AgentAction = {
  id: string
  agent_type: string | null
  action_type: string | null
  title: string
  rationale: string | null
  status: string
  impact_estimate: string | null
  result: string | null
  created_at: string
}

const TOOL_LABELS: Record<string, string> = {
  ga4: 'Google Analytics 4',
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  gtm: 'Google Tag Manager',
  slack: 'Slack',
  email: 'Email',
}

const CONNECTION_STATUS_CONFIG: Record<string, { color: string; labelKey: string; labelFallback: string }> = {
  connected: { color: 'bg-green-500/15 text-green-600', labelKey: 'agency_intelligence.connection.status.connected', labelFallback: 'Połączone' },
  disconnected: { color: 'bg-muted text-muted-foreground', labelKey: 'agency_intelligence.connection.status.disconnected', labelFallback: 'Rozłączone' },
  pending_verification: { color: 'bg-yellow-500/15 text-yellow-600', labelKey: 'agency_intelligence.connection.status.pending_verification', labelFallback: 'Wymaga weryfikacji' },
  error: { color: 'bg-red-500/15 text-red-600', labelKey: 'agency_intelligence.connection.status.error', labelFallback: 'Błąd' },
}

function getConnectionStatus(conn: Connection): string {
  if (conn.status === 'disconnected' && isAdPlatform(conn.tool)) return 'pending_verification'
  return conn.status
}

const ACTION_STATUS_CONFIG: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  proposed: { color: 'bg-yellow-500/15 text-yellow-600', label: 'Zaproponowane', icon: <Clock className="size-3.5" /> },
  approved: { color: 'bg-blue-500/15 text-blue-600', label: 'Zatwierdzone', icon: <CheckCircle2 className="size-3.5" /> },
  executing: { color: 'bg-purple-500/15 text-purple-600', label: 'Wykonywanie', icon: <Loader2 className="size-3.5 animate-spin" /> },
  done: { color: 'bg-green-500/15 text-green-600', label: 'Wykonane', icon: <CheckCircle2 className="size-3.5" /> },
  failed: { color: 'bg-red-500/15 text-red-600', label: 'Błąd', icon: <XCircle className="size-3.5" /> },
  skipped: { color: 'bg-muted text-muted-foreground', label: 'Pominięte', icon: <SkipForward className="size-3.5" /> },
}

const AGENT_TYPE_LABELS: Record<string, string> = {
  optimizer: 'Optimizer',
  analyst: 'Analyst',
  content_creator: 'Content Creator',
  media_buyer: 'Media Buyer',
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  bid_adjustment: 'Korekta stawek',
  budget_reallocation: 'Realokacja budżetu',
  audience_update: 'Aktualizacja grupy',
  creative_test: 'Test kreacji',
  pause_campaign: 'Wstrzymanie kampanii',
  campaign_create: 'Nowa kampania',
  report: 'Raport',
  alert: 'Alert',
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('pl-PL', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return dateStr }
}

function AddConnectionForm({ clientId, onAdded }: { clientId: string; onAdded: () => void }) {
  const [tool, setTool] = React.useState('ga4')
  const [externalId, setExternalId] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!externalId.trim()) return
    setSaving(true)
    try {
      const { ok } = await apiCall('/api/agency_intelligence/connections', {
        method: 'POST',
        body: JSON.stringify({
          client_profile_id: clientId,
          tool,
          external_id: externalId.trim(),
          display_name: displayName.trim() || undefined,
        }),
      })
      if (ok) {
        flash('Połączenie dodane.', 'success')
        setExternalId('')
        setDisplayName('')
        onAdded()
      } else {
        flash('Nie udało się dodać połączenia.', 'error')
      }
    } catch {
      flash('Nie udało się dodać połączenia.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="size-4" />
          Dodaj połączenie
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-muted-foreground">Narzędzie</label>
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {Object.entries(TOOL_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-muted-foreground">ID / URL</label>
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="G-XXXXXXXX, account ID, webhook URL..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-muted-foreground">Nazwa (opcjonalna)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="np. GA4 — produkcja"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <Button type="submit" disabled={saving || !externalId.trim()}>
              {saving ? <Spinner className="mr-2 size-3.5" /> : <Plus className="mr-2 size-3.5" />}
              Dodaj połączenie
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export default function ClientIntelligenceDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const routerParams = useParams()
  const clientId = params?.id || (routerParams?.id as string)

  const [profile, setProfile] = React.useState<ClientProfile | null>(null)
  const [connections, setConnections] = React.useState<Connection[]>([])
  const [actions, setActions] = React.useState<AgentAction[]>([])
  const [loading, setLoading] = React.useState(true)
  const [updatingAction, setUpdatingAction] = React.useState<string | null>(null)
  const [verifyingConnection, setVerifyingConnection] = React.useState<string | null>(null)
  const [syncingConnection, setSyncingConnection] = React.useState<string | null>(null)

  const fetchConnections = React.useCallback(async () => {
    if (!clientId) return
    const { ok, result } = await apiCall(`/api/agency_intelligence/connections?client_profile_id=${clientId}`)
    if (ok) setConnections((result as any)?.items || [])
  }, [clientId])

  const fetchData = React.useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const [profileRes, actionsRes] = await Promise.all([
        apiCall(`/api/agency_onboarding/client?id=${clientId}`),
        apiCall(`/api/agency_intelligence/actions?client_profile_id=${clientId}&limit=50`),
      ])

      if (profileRes.ok) {
        const data = profileRes.result as any
        if (data?.profile) {
          setProfile({ id: clientId, ...data.profile })
        }
      }

      if (actionsRes.ok) {
        setActions((actionsRes.result as any)?.items || [])
      }

      await fetchConnections()
    } catch (e) {
      console.error('[intelligence/detail] Failed to load:', e)
    } finally {
      setLoading(false)
    }
  }, [clientId, fetchConnections])

  const updateActionStatus = React.useCallback(async (actionId: string, status: string, result?: string) => {
    setUpdatingAction(actionId)
    try {
      const { ok } = await apiCall(`/api/agency_intelligence/actions/${actionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, result }),
      })
      if (ok) {
        flash(t('agency_intelligence.action.updated', 'Status zaktualizowany.'), 'success')
        await fetchData()
      } else {
        flash(t('agency_intelligence.action.update_error', 'Nie udało się zaktualizować statusu.'), 'error')
      }
    } catch {
      flash(t('agency_intelligence.action.update_error', 'Nie udało się zaktualizować statusu.'), 'error')
    } finally {
      setUpdatingAction(null)
    }
  }, [fetchData, t])

  const handleMockExecute = React.useCallback(async (actionId: string) => {
    await updateActionStatus(actionId, 'executing')
    setTimeout(async () => {
      await updateActionStatus(actionId, 'done', '[Mock] Akcja wykonana pomyślnie. Zmiany zastosowane w systemie.')
    }, 1500)
  }, [updateActionStatus])

  const handleVerify = React.useCallback(async (connectionId: string) => {
    setVerifyingConnection(connectionId)
    try {
      const { ok, result } = await apiCall('/api/agency_intelligence/connections/verify', {
        method: 'POST',
        body: JSON.stringify({ connection_id: connectionId }),
      })
      const data = result as any
      if (ok && data?.verified) {
        flash(t('agency_intelligence.connection.verify_success', `Konto zweryfikowane: ${data?.account_info?.name || ''}`), 'success')
      } else {
        flash(t('agency_intelligence.connection.verify_failed', `Weryfikacja nieudana: ${data?.error || 'Nieznany błąd'}`), 'error')
      }
      await fetchConnections()
    } catch {
      flash(t('agency_intelligence.connection.verify_error', 'Błąd podczas weryfikacji.'), 'error')
    } finally {
      setVerifyingConnection(null)
    }
  }, [fetchConnections, t])

  const handleSync = React.useCallback(async (connectionId: string) => {
    setSyncingConnection(connectionId)
    try {
      const { ok, result } = await apiCall('/api/agency_intelligence/connections/sync', {
        method: 'POST',
        body: JSON.stringify({ connection_id: connectionId }),
      })
      const data = result as any
      if (ok && data?.synced) {
        flash(t('agency_intelligence.connection.sync_success', `Zsynchronizowano ${data?.campaigns_count || 0} kampanii.`), 'success')
      } else {
        flash(t('agency_intelligence.connection.sync_failed', 'Synchronizacja nieudana.'), 'error')
      }
      await fetchConnections()
    } catch {
      flash(t('agency_intelligence.connection.sync_error', 'Błąd podczas synchronizacji.'), 'error')
    } finally {
      setSyncingConnection(null)
    }
  }, [fetchConnections, t])

  React.useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center py-20"><Spinner className="size-8" /></div>
        </PageBody>
      </Page>
    )
  }

  const pendingActions = actions.filter((a) => ['proposed', 'approved', 'executing'].includes(a.status))

  return (
    <Page>
      <PageHeader
        title={profile?.company_name || 'Klient'}
        description={profile?.website_url || ''}
      />
      <PageBody>
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="py-4">
                <p className="text-xs uppercase font-medium text-muted-foreground">
                  {t('agency_intelligence.stats.connections', 'Połączenia')}
                </p>
                <p className="mt-1 text-2xl font-bold">{connections.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs uppercase font-medium text-muted-foreground">
                  {t('agency_intelligence.stats.total_actions', 'Łącznie akcji')}
                </p>
                <p className="mt-1 text-2xl font-bold">{actions.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs uppercase font-medium text-muted-foreground">
                  {t('agency_intelligence.stats.pending', 'Oczekuje')}
                </p>
                <p className="mt-1 text-2xl font-bold text-yellow-600">{pendingActions.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 flex flex-col justify-between h-full">
                <p className="text-xs uppercase font-medium text-muted-foreground">
                  {t('agency_intelligence.stats.campaign_plan', 'Plan kampanii')}
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-2" asChild>
                  <Link href={`/backend/agency_intelligence/campaign/${clientId}`}>
                    <BarChart3 className="mr-1.5 size-3.5" />
                    {t('agency_intelligence.campaign.open', 'Otwórz plan')}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="actions">
            <TabsList>
              <TabsTrigger value="actions">
                <Bot className="mr-1.5 size-3.5" />
                Aktywność Agentów
                {pendingActions.length > 0 && (
                  <Badge className="ml-1.5 bg-yellow-500/15 text-yellow-600 text-xs px-1.5">
                    {pendingActions.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="connections">
                <Plug className="mr-1.5 size-3.5" />
                Połączenia
                <Badge className="ml-1.5 bg-muted text-muted-foreground text-xs px-1.5">
                  {connections.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            {/* TAB: Agent Actions */}
            <TabsContent value="actions" className="mt-4 space-y-3">
              {actions.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Bot className="mx-auto mb-3 size-10 text-muted-foreground" />
                    <p className="text-muted-foreground">Brak akcji agentów.</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Agenci mogą tworzyć akcje przez chat AI (narzędzie agency_create_action).
                    </p>
                  </CardContent>
                </Card>
              ) : (
                actions.map((action) => {
                  const statusCfg = ACTION_STATUS_CONFIG[action.status] || ACTION_STATUS_CONFIG.proposed
                  return (
                    <Card key={action.id}>
                      <CardContent className="py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className={`${statusCfg.color} flex items-center gap-1`}>
                                {statusCfg.icon}
                                {statusCfg.label}
                              </Badge>
                              {action.agent_type && (
                                <Badge variant="outline" className="text-xs">
                                  {AGENT_TYPE_LABELS[action.agent_type] || action.agent_type}
                                </Badge>
                              )}
                              {action.action_type && (
                                <Badge variant="outline" className="text-xs">
                                  {ACTION_TYPE_LABELS[action.action_type] || action.action_type}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium">{action.title}</p>
                            {action.rationale && (
                              <p className="text-xs text-muted-foreground line-clamp-3">{action.rationale}</p>
                            )}
                            {action.impact_estimate && (
                              <p className="text-xs text-green-600 font-medium">↗ {action.impact_estimate}</p>
                            )}
                            {action.result && (
                              <div className="mt-2 rounded-md bg-muted/50 px-3 py-2">
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  {t('agency_intelligence.action.result_label', 'Wynik:')}
                                </p>
                                <p className="text-xs">{action.result}</p>
                              </div>
                            )}
                            {action.status === 'proposed' && (
                              <div className="flex items-center gap-2 pt-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={updatingAction === action.id}
                                  onClick={() => updateActionStatus(action.id, 'approved')}
                                  className="text-green-600 border-green-200 hover:bg-green-50"
                                >
                                  {updatingAction === action.id ? (
                                    <Spinner className="mr-1.5 size-3" />
                                  ) : (
                                    <ThumbsUp className="mr-1.5 size-3" />
                                  )}
                                  {t('agency_intelligence.action.approve', 'Zatwierdź')}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={updatingAction === action.id}
                                  onClick={() => handleMockExecute(action.id)}
                                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                                >
                                  <Play className="mr-1.5 size-3" />
                                  {t('agency_intelligence.action.execute', 'Wykonaj')}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={updatingAction === action.id}
                                  onClick={() => updateActionStatus(action.id, 'skipped')}
                                  className="text-muted-foreground"
                                >
                                  <Ban className="mr-1.5 size-3" />
                                  {t('agency_intelligence.action.skip', 'Pomiń')}
                                </Button>
                              </div>
                            )}
                            {action.status === 'approved' && (
                              <div className="flex items-center gap-2 pt-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={updatingAction === action.id}
                                  onClick={() => handleMockExecute(action.id)}
                                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                                >
                                  {updatingAction === action.id ? (
                                    <Spinner className="mr-1.5 size-3" />
                                  ) : (
                                    <Play className="mr-1.5 size-3" />
                                  )}
                                  {t('agency_intelligence.action.execute', 'Wykonaj')}
                                </Button>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                            {formatDate(action.created_at)}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })
              )}
            </TabsContent>

            {/* TAB: Connections */}
            <TabsContent value="connections" className="mt-4 space-y-4">
              <AddConnectionForm clientId={clientId} onAdded={fetchConnections} />

              {connections.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center">
                    <Plug className="mx-auto mb-3 size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {t('agency_intelligence.connection.empty', 'Brak połączeń. Dodaj pierwsze narzędzie powyżej.')}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {connections.map((conn) => {
                    const effectiveStatus = getConnectionStatus(conn)
                    const statusCfg = CONNECTION_STATUS_CONFIG[effectiveStatus] || CONNECTION_STATUS_CONFIG.disconnected
                    const isVerifying = verifyingConnection === conn.id
                    const isSyncing = syncingConnection === conn.id

                    return (
                      <Card key={conn.id}>
                        <CardContent className="py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0 space-y-1.5">
                              <div className="flex items-center gap-2">
                                <Globe className="size-3.5 text-muted-foreground shrink-0" />
                                <p className="text-sm font-medium truncate">
                                  {conn.account_name || conn.display_name || TOOL_LABELS[conn.tool] || conn.tool}
                                </p>
                              </div>
                              <p className="text-xs text-muted-foreground">{TOOL_LABELS[conn.tool] || conn.tool}</p>

                              {/* Metrics row */}
                              {conn.cached_metrics && (
                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                                  <span className="text-xs text-muted-foreground">
                                    {t('agency_intelligence.connection.spend_7d', 'Wydatki 7d')}:{' '}
                                    <span className="font-medium text-foreground">
                                      {conn.cached_metrics.spend_7d} {conn.cached_metrics.currency}
                                    </span>
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {t('agency_intelligence.connection.clicks', 'Kliknięcia')}:{' '}
                                    <span className="font-medium text-foreground">{conn.cached_metrics.clicks_7d}</span>
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    CTR:{' '}
                                    <span className="font-medium text-foreground">{conn.cached_metrics.ctr_7d}%</span>
                                  </span>
                                </div>
                              )}

                              {/* Campaign count */}
                              {conn.campaigns_count != null && (
                                <p className="text-xs text-muted-foreground">
                                  {t('agency_intelligence.connection.campaigns', 'Kampanie')}: {conn.campaigns_count}
                                </p>
                              )}

                              {/* Error message */}
                              {effectiveStatus === 'error' && conn.error_message && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <AlertTriangle className="size-3 text-red-500 shrink-0" />
                                  <p className="text-xs text-red-500 truncate">{conn.error_message}</p>
                                </div>
                              )}

                              {/* Last sync */}
                              {conn.last_synced_at && (
                                <p className="text-xs text-muted-foreground">
                                  {t('agency_intelligence.connection.last_sync', 'Ostatnia synchronizacja')}: {formatDate(conn.last_synced_at)}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-col items-end gap-2 shrink-0">
                              <Badge className={statusCfg.color}>
                                {t(statusCfg.labelKey, statusCfg.labelFallback)}
                              </Badge>

                              {/* Verify button for unverified ad connections */}
                              {effectiveStatus === 'pending_verification' && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isVerifying}
                                  onClick={() => handleVerify(conn.id)}
                                  className="text-yellow-600 border-yellow-200 hover:bg-yellow-50"
                                >
                                  {isVerifying ? (
                                    <Spinner className="mr-1.5 size-3" />
                                  ) : (
                                    <ShieldCheck className="mr-1.5 size-3" />
                                  )}
                                  {t('agency_intelligence.connection.verify', 'Weryfikuj')}
                                </Button>
                              )}

                              {/* Retry verify for error state on ad platforms */}
                              {effectiveStatus === 'error' && isAdPlatform(conn.tool) && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isVerifying}
                                  onClick={() => handleVerify(conn.id)}
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                >
                                  {isVerifying ? (
                                    <Spinner className="mr-1.5 size-3" />
                                  ) : (
                                    <RefreshCw className="mr-1.5 size-3" />
                                  )}
                                  {t('agency_intelligence.connection.retry', 'Ponów')}
                                </Button>
                              )}

                              {/* Sync button for verified ad connections */}
                              {effectiveStatus === 'connected' && isAdPlatform(conn.tool) && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isSyncing}
                                  onClick={() => handleSync(conn.id)}
                                >
                                  {isSyncing ? (
                                    <Spinner className="mr-1.5 size-3" />
                                  ) : (
                                    <RefreshCw className="mr-1.5 size-3" />
                                  )}
                                  {t('agency_intelligence.connection.sync', 'Synchronizuj')}
                                </Button>
                              )}
                            </div>
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

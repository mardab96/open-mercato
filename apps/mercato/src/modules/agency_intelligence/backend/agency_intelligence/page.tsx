"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardContent } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Bot, ArrowRight, Activity } from 'lucide-react'

type ClientRow = {
  id: string
  company_name: string
  website_url: string
  onboarding_status: string
  created_at: string
}

type ActionCount = {
  client_profile_id: string
  total: number
  pending: number
}

const ONBOARDING_STATUS_MAP: Record<string, { color: string; label: string }> = {
  draft: { color: 'bg-muted text-muted-foreground', label: 'Szkic' },
  in_progress: { color: 'bg-yellow-500/15 text-yellow-600', label: 'W trakcie' },
  completed: { color: 'bg-green-500/15 text-green-600', label: 'Zakończony' },
  active: { color: 'bg-blue-500/15 text-blue-600', label: 'Aktywny' },
  failed: { color: 'bg-red-500/15 text-red-600', label: 'Błąd' },
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('pl-PL', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch { return dateStr }
}

export default function AgencyIntelligenceListPage() {
  const t = useT()
  const [clients, setClients] = React.useState<ClientRow[]>([])
  const [actionCounts, setActionCounts] = React.useState<Record<string, ActionCount>>({})
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    async function load() {
      try {
        const { ok, result } = await apiCall('/api/agency_onboarding/clients')
        if (ok) {
          const items = (result as any)?.items || []
          setClients(items)

          const countMap: Record<string, ActionCount> = {}
          await Promise.all(
            items.map(async (client: ClientRow) => {
              const { ok: aOk, result: aResult } = await apiCall(
                `/api/agency_intelligence/actions?client_profile_id=${client.id}&limit=100`
              )
              if (aOk) {
                const actions = (aResult as any)?.items || []
                const pending = actions.filter((a: any) =>
                  ['proposed', 'approved', 'executing'].includes(a.status)
                ).length
                countMap[client.id] = { client_profile_id: client.id, total: actions.length, pending }
              }
            })
          )
          setActionCounts(countMap)
        }
      } catch (e) {
        console.error('[intelligence/list] Failed to load:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <Page>
      <PageHeader
        title={t('agency_intelligence.list.title', 'Agenci AI — Aktywność')}
        description={t('agency_intelligence.list.description', 'Dashboard obserwabilności autonomicznych agentów. Monitoruj decyzje i działania podejmowane dla klientów.')}
      />
      <PageBody>
        <div className="mx-auto max-w-5xl space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Spinner className="size-8" />
            </div>
          )}

          {!loading && clients.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <Bot className="mx-auto mb-4 size-12 text-muted-foreground" />
                <p className="text-lg font-medium">Brak klientów</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Najpierw przeprowadź onboarding klientów w module "Baza Klientów".
                </p>
              </CardContent>
            </Card>
          )}

          {!loading && clients.length > 0 && (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-xs font-medium uppercase text-muted-foreground">
                      <th className="px-4 py-3">Klient</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          <Activity className="size-3" />
                          Aktywność agentów
                        </span>
                      </th>
                      <th className="px-4 py-3">Onboarding</th>
                      <th className="px-4 py-3 text-right">Akcja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => {
                      const statusCfg = ONBOARDING_STATUS_MAP[client.onboarding_status] || ONBOARDING_STATUS_MAP.draft
                      const counts = actionCounts[client.id]
                      return (
                        <tr key={client.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">{client.company_name || '—'}</p>
                              {client.website_url && (
                                <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                                  {client.website_url.replace(/^https?:\/\//, '')}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={statusCfg.color}>{statusCfg.label}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            {counts ? (
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{counts.total}</span>
                                <span className="text-xs text-muted-foreground">łącznie</span>
                                {counts.pending > 0 && (
                                  <Badge className="bg-yellow-500/15 text-yellow-600 text-xs">
                                    {counts.pending} oczekuje
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-muted-foreground">{formatDate(client.created_at)}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button type="button" variant="ghost" size="sm" asChild>
                              <Link href={`/backend/agency_intelligence/${client.id}`}>
                                <Bot className="mr-1.5 size-3.5" />
                                Widok agentów
                                <ArrowRight className="ml-1.5 size-3.5" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </PageBody>
    </Page>
  )
}

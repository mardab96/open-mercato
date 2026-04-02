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
import { Plus, ArrowRight, Brain } from 'lucide-react'

type ClientRow = {
  id: string
  company_name: string
  website_url: string
  onboarding_status: string
  created_at: string
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  draft: { color: 'bg-muted text-muted-foreground', label: 'Szkic' },
  in_progress: { color: 'bg-yellow-500/15 text-yellow-600', label: 'W trakcie' },
  scraping_website: { color: 'bg-yellow-500/15 text-yellow-600', label: 'Scraping' },
  ai_analyzing: { color: 'bg-purple-500/15 text-purple-600', label: 'Analiza AI' },
  completed: { color: 'bg-green-500/15 text-green-600', label: 'Zakończony' },
  failed: { color: 'bg-red-500/15 text-red-600', label: 'Błąd' },
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('pl-PL', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return dateStr }
}

export default function ClientListPage() {
  const t = useT()
  const [clients, setClients] = React.useState<ClientRow[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    async function load() {
      try {
        const { ok, result } = await apiCall('/api/agency_onboarding/clients')
        if (ok) setClients((result as any)?.items || [])
      } catch (e) {
        console.error('[list] Failed to load clients:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <Page>
      <PageHeader
        title={t('agency_onboarding.list.title', 'Onboarding AI — Klienci')}
        description={t('agency_onboarding.list.description', 'Lista wszystkich onboardingów klientów agencji.')}
      />
      <PageBody>
        <div className="mx-auto max-w-4xl space-y-6">
          {/* New onboarding button */}
          <div className="flex justify-end">
            <Button type="button" asChild>
              <Link href="/backend/agency_onboarding">
                <Plus className="mr-2 size-4" />
                {t('agency_onboarding.list.new', 'Rozpocznij nowy onboarding')}
              </Link>
            </Button>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Spinner className="size-8" />
            </div>
          )}

          {/* Empty state */}
          {!loading && clients.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <Brain className="mx-auto mb-4 size-12 text-muted-foreground" />
                <p className="text-lg font-medium">Brak klientów</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Rozpocznij pierwszy onboarding klikając przycisk powyżej.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Client table */}
          {!loading && clients.length > 0 && (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-xs font-medium uppercase text-muted-foreground">
                      <th className="px-4 py-3">Nazwa firmy</th>
                      <th className="px-4 py-3">Adres WWW</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Data utworzenia</th>
                      <th className="px-4 py-3 text-right">Akcja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => {
                      const status = STATUS_CONFIG[client.onboarding_status] || STATUS_CONFIG.draft
                      return (
                        <tr key={client.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium">{client.company_name || '—'}</span>
                          </td>
                          <td className="px-4 py-3">
                            {client.website_url ? (
                              <a href={client.website_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline truncate block max-w-[200px]">
                                {client.website_url.replace(/^https?:\/\//, '')}
                              </a>
                            ) : <span className="text-sm text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={status.color}>{status.label}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-muted-foreground">{formatDate(client.created_at)}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button type="button" variant="ghost" size="sm" asChild>
                              <Link href={`/backend/agency_onboarding/${client.id}`}>
                                Zobacz Audyt <ArrowRight className="ml-1.5 size-3.5" />
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

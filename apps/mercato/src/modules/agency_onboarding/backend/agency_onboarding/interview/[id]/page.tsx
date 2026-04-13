"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardContent, CardFooter } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useParams } from 'next/navigation'
import { Bot, User, Send, Save, ArrowLeft, CheckCircle2 } from 'lucide-react'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

type InterviewSummary = {
  audience_summary: string
  personas: string
  pain_points: string
  buying_triggers: string
  channels: string[]
}

const MAX_QUESTIONS = 10 // upper bound for progress bar

export default function AIInterviewPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const routerParams = useParams()
  const clientId = params?.id || (routerParams?.id as string)

  const [messages, setMessages] = React.useState<Message[]>([])
  const [inputValue, setInputValue] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [summary, setSummary] = React.useState<InterviewSummary | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Start the interview by calling with empty messages
  React.useEffect(() => {
    if (!clientId) return
    void startInterview()
  }, [clientId])

  const startInterview = async () => {
    setSending(true)
    try {
      const { ok, result } = await apiCall('/api/agency_onboarding/interview', {
        method: 'POST',
        body: JSON.stringify({ client_profile_id: clientId, messages: [] }),
      })
      if (ok && result) {
        const data = result as { message: string; done: boolean; summary?: InterviewSummary }
        if (data.message) {
          setMessages([{ role: 'assistant', content: data.message }])
        }
        if (data.done) {
          setDone(true)
          setSummary(data.summary ?? null)
        }
      }
    } catch {
      flash(t('agency_onboarding.interview.error', 'Błąd połączenia z AI.'), 'error')
    } finally {
      setSending(false)
    }
  }

  const sendMessage = async () => {
    if (!inputValue.trim() || sending || done) return

    const userMessage: Message = { role: 'user', content: inputValue.trim() }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInputValue('')
    setSending(true)

    try {
      const { ok, result } = await apiCall('/api/agency_onboarding/interview', {
        method: 'POST',
        body: JSON.stringify({ client_profile_id: clientId, messages: newMessages }),
      })

      if (ok && result) {
        const data = result as { message: string; done: boolean; summary?: InterviewSummary }
        if (data.message) {
          setMessages((prev) => [...prev, { role: 'assistant', content: data.message }])
        }
        if (data.done) {
          setDone(true)
          setSummary(data.summary ?? null)
        }
      } else {
        flash(t('agency_onboarding.interview.ai_error', 'AI nie odpowiedziało. Spróbuj ponownie.'), 'error')
      }
    } catch {
      flash(t('agency_onboarding.interview.error', 'Błąd połączenia z AI.'), 'error')
    } finally {
      setSending(false)
      // Restore focus so user can keep typing without re-clicking
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const handleSave = async () => {
    if (!summary) return
    setSaving(true)
    try {
      const { ok } = await apiCall('/api/agency_onboarding/audience', {
        method: 'POST',
        body: JSON.stringify({ client_profile_id: clientId, data: summary }),
      })
      if (ok) {
        setSaved(true)
        flash(t('agency_onboarding.interview.saved', 'Wywiad zapisany do profilu klienta.'), 'success')
      } else {
        flash(t('agency_onboarding.interview.save_error', 'Nie udało się zapisać wywiadu.'), 'error')
      }
    } catch {
      flash(t('agency_onboarding.interview.save_error', 'Nie udało się zapisać wywiadu.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const answeredCount = messages.filter((m) => m.role === 'user').length
  const progress = Math.min(answeredCount, MAX_QUESTIONS)

  return (
    <Page>
      <PageHeader
        title={t('agency_onboarding.interview.title', 'Wywiad AI z klientem')}
        description={t(
          'agency_onboarding.interview.description',
          'AI przeprowadzi serię pytań, a na końcu automatycznie wypełni profil grupy docelowej.'
        )}
      />
      <PageBody>
        <div className="mx-auto max-w-2xl space-y-4">
          {/* Back link */}
          <div>
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href={`/backend/agency_onboarding/${clientId}`}>
                <ArrowLeft className="mr-1.5 size-3.5" />
                {t('agency_onboarding.interview.back', 'Wróć do profilu klienta')}
              </Link>
            </Button>
          </div>

          {/* Progress */}
          {!done && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {answeredCount > 0
                  ? t('agency_onboarding.interview.answered', `Odpowiedzi: ${answeredCount}`)
                  : t('agency_onboarding.interview.starting', 'AI analizuje Twój audyt...')}
              </span>
              <div className="flex gap-1">
                {Array.from({ length: MAX_QUESTIONS }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-4 rounded-full transition-colors ${
                      i < progress ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          <Card>
            <CardContent className="p-4 space-y-4 min-h-[400px] max-h-[500px] overflow-y-auto">
              {messages.length === 0 && sending && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner className="size-4" />
                  <span className="text-sm">{t('agency_onboarding.interview.loading', 'AI przygotowuje pytanie...')}</span>
                </div>
              )}

              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                      msg.role === 'assistant' ? 'bg-primary/10' : 'bg-muted'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <Bot className="size-4 text-primary" />
                    ) : (
                      <User className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'assistant'
                        ? 'bg-muted text-foreground'
                        : 'bg-primary text-primary-foreground'
                    }`}
                  >
                    {msg.content.replace('[WYWIAD_ZAKOŃCZONY]', '').trim()}
                  </div>
                </div>
              ))}

              {sending && messages.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="size-4 text-primary" />
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2">
                    <Spinner className="size-3.5" />
                    <span className="text-sm text-muted-foreground">
                      {t('agency_onboarding.interview.thinking', 'AI myśli...')}
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </CardContent>

            {!done && (
              <CardFooter className="border-t p-3 gap-2">
                <Textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('agency_onboarding.interview.placeholder', 'Twoja odpowiedź... (Enter aby wysłać, Shift+Enter nowa linia)')}
                  className="min-h-[60px] resize-none text-sm"
                  disabled={sending}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={sending || !inputValue.trim()}
                  onClick={sendMessage}
                  className="shrink-0"
                >
                  {sending ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </CardFooter>
            )}
          </Card>

          {/* Done state — save prompt */}
          {done && summary && (
            <Card>
              <CardContent className="py-6">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-green-500/15">
                    <CheckCircle2 className="size-6 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {t('agency_onboarding.interview.done_title', 'Wywiad zakończony!')}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(
                        'agency_onboarding.interview.done_description',
                        'AI przeanalizowało odpowiedzi i przygotowało profil grupy docelowej. Kliknij Zapisz, aby zaktualizować profil klienta.'
                      )}
                    </p>
                  </div>
                  <div className="flex gap-3 flex-wrap justify-center">
                    {!saved ? (
                      <Button type="button" disabled={saving} onClick={handleSave}>
                        {saving ? <Spinner className="mr-2 size-3.5" /> : <Save className="mr-2 size-3.5" />}
                        {t('agency_onboarding.interview.save', 'Zapisz wywiad')}
                      </Button>
                    ) : (
                      <>
                        <Button type="button" variant="outline" asChild>
                          <Link href={`/backend/agency_onboarding/${clientId}`}>
                            {t('agency_onboarding.interview.view_profile', 'Zobacz profil klienta')}
                          </Link>
                        </Button>
                        <p className="w-full text-center text-xs text-muted-foreground">
                          {t(
                            'agency_onboarding.interview.reaudit_hint',
                            'Kliknij "Ponów Audyt AI" w profilu klienta, aby zaktualizować audyt o dane z wywiadu.'
                          )}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </PageBody>
    </Page>
  )
}

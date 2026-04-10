"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Upload, Trash2, Rocket, FileText } from 'lucide-react'

const ENTITY_ID = 'agency_onboarding:client_profile'

type UploadedFile = {
  id: string
  fileName: string
  fileSize: number
  status: 'uploading' | 'done' | 'error'
}

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let idx = 0
  let current = bytes
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024
    idx += 1
  }
  return `${current.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

export default function AgencyOnboardingPage() {
  const t = useT()
  const router = useRouter()

  const [companyName, setCompanyName] = React.useState('')
  const [websiteUrl, setWebsiteUrl] = React.useState('')
  const [files, setFiles] = React.useState<UploadedFile[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [errors, setErrors] = React.useState<{ companyName?: string; websiteUrl?: string }>({})

  const recordIdRef = React.useRef(crypto.randomUUID())
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = React.useState(false)

  const validate = (): boolean => {
    const next: typeof errors = {}
    if (!companyName.trim() || companyName.trim().length < 2) {
      next.companyName = t('agency_onboarding.field.company_name.required', 'Nazwa firmy jest wymagana (min. 2 znaki)')
    }
    if (!websiteUrl.trim()) {
      next.websiteUrl = t('agency_onboarding.field.website_url.required', 'Adres WWW jest wymagany')
    } else {
      try {
        const url = websiteUrl.trim().startsWith('http') ? websiteUrl.trim() : `https://${websiteUrl.trim()}`
        new URL(url)
      } catch {
        next.websiteUrl = t('agency_onboarding.field.website_url.invalid', 'Podaj prawidłowy adres URL')
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const uploadFile = async (file: File) => {
    const tempId = crypto.randomUUID()
    setFiles((prev) => [...prev, { id: tempId, fileName: file.name, fileSize: file.size, status: 'uploading' }])

    try {
      const formData = new FormData()
      formData.append('entityId', ENTITY_ID)
      formData.append('recordId', recordIdRef.current)
      formData.append('file', file)

      const res = await fetch('/api/attachments', { method: 'POST', body: formData })
      const data = await res.json()

      if (res.ok && data.ok) {
        setFiles((prev) =>
          prev.map((f) => (f.id === tempId ? { ...f, id: data.item.id, status: 'done' as const } : f))
        )
      } else {
        setFiles((prev) => prev.map((f) => (f.id === tempId ? { ...f, status: 'error' as const } : f)))
      }
    } catch {
      setFiles((prev) => prev.map((f) => (f.id === tempId ? { ...f, status: 'error' as const } : f)))
    }
  }

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return
    Array.from(fileList).forEach((file) => uploadFile(file))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }

  const handleDeleteFile = async (fileId: string) => {
    try {
      await fetch(`/api/attachments?id=${fileId}`, { method: 'DELETE' })
    } catch { /* ignore */ }
    setFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)

    try {
      const url = websiteUrl.trim().startsWith('http') ? websiteUrl.trim() : `https://${websiteUrl.trim()}`

      const { ok, result } = await apiCall('/api/entities/records', {
        method: 'POST',
        body: JSON.stringify({
          entityId: ENTITY_ID,
          recordId: recordIdRef.current,
          values: {
            company_name: companyName.trim(),
            website_url: url,
            onboarding_status: 'in_progress',
          },
        }),
      })

      if (ok && result?.ok) {
        // Emit event to trigger async AI audit
        try {
          await apiCall('/api/agency_onboarding/trigger-audit', {
            method: 'POST',
            body: JSON.stringify({
              recordId: (result as any).item?.recordId || recordIdRef.current,
              entityId: ENTITY_ID,
            }),
          })
        } catch { /* audit trigger is best-effort */ }

        flash(t('agency_onboarding.success', 'Onboarding zapisany. Audyt AI zostanie uruchomiony.'), 'success')
        const savedRecordId = (result as any).item?.recordId || recordIdRef.current
        router.push(`/backend/agency_onboarding/${savedRecordId}`)
      } else {
        flash((result as any)?.error || t('agency_onboarding.error.save', 'Nie udało się zapisać danych onboardingu.'), 'error')
      }
    } catch {
      flash(t('agency_onboarding.error.save', 'Nie udało się zapisać danych onboardingu.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('agency_onboarding.page.title', 'Onboarding Nowego Klienta')}
        description={t('agency_onboarding.page.description', 'Wypełnij dane podstawowe, dodaj materiały i uruchom audyt AI.')}
      />
      <PageBody>
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Section 1: Dane podstawowe */}
          <Card>
            <CardHeader>
              <CardTitle>{t('agency_onboarding.card.basic.title', 'Dane podstawowe')}</CardTitle>
              <CardDescription>{t('agency_onboarding.card.basic.description', 'Podstawowe informacje o kliencie agencji.')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t('agency_onboarding.field.company_name', 'Nazwa firmy')} *</label>
                  <Input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="np. Firma X Sp. z o.o."
                  />
                  {errors.companyName && <p className="text-sm text-destructive">{errors.companyName}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t('agency_onboarding.field.website_url', 'Adres WWW')} *</label>
                  <Input
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://firmax.pl"
                  />
                  {errors.websiteUrl && <p className="text-sm text-destructive">{errors.websiteUrl}</p>}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Baza wiedzy klienta */}
          <Card>
            <CardHeader>
              <CardTitle>{t('agency_onboarding.card.knowledge.title', 'Baza wiedzy klienta')}</CardTitle>
              <CardDescription>{t('agency_onboarding.card.knowledge.description', 'Wgraj materiały: oferty, brand book, screenshoty, cenniki. AI przeanalizuje wszystko.')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer ${
                  dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mb-2 size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t('agency_onboarding.upload.dropzone', 'Przeciągnij pliki tutaj lub kliknij aby wybrać')}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </div>

              {files.length > 0 && (
                <div className="mt-4 space-y-2">
                  {files.map((file) => (
                    <div key={file.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm">{file.fileName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">({formatFileSize(file.fileSize)})</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {file.status === 'uploading' && <Spinner className="size-4" />}
                        {file.status === 'error' && <span className="text-xs text-destructive">Error</span>}
                        {file.status === 'done' && (
                          <IconButton variant="ghost" size="xs" type="button" onClick={() => handleDeleteFile(file.id)} aria-label="Delete">
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 3: Akcja */}
          <Card>
            <CardContent className="flex justify-center py-2">
              <Button type="button" size="lg" disabled={submitting} onClick={handleSubmit}>
                {submitting ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    {t('agency_onboarding.action.submitting', 'Zapisywanie...')}
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 size-4" />
                    {t('agency_onboarding.action.submit', 'Zapisz i Rozpocznij Audyt')}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </Page>
  )
}

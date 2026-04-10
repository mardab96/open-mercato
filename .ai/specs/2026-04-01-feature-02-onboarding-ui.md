# Feature 02 — Onboarding UI (Backend Page)

| Field       | Value |
|------------|-------|
| **Status** | Approved |
| **Created** | 2026-04-01 |
| **Phase** | Etap 2 — Interfejs użytkownika dla Głębokiego Onboardingu |
| **Depends on** | Feature 01 — Onboarding Data Model (Approved) |

---

## TLDR

Strona backend w module `agency_onboarding` z formularzem onboardingu nowego klienta. Nowoczesny layout z kartami (shadcn Card), pola `company_name` i `website_url`, drag & drop upload plików (moduł Attachments), przycisk "Zapisz i Rozpocznij Audyt". Dane zapisywane do Custom Entity `agency_onboarding:client_profile`. Zero modyfikacji core.

---

## Text-Wireframe (Layout Wizualny)

```
┌─────────────────────────────────────────────────────────────┐
│  /backend/agency_onboarding                                 │
│                                                             │
│  ┌─ Page ─────────────────────────────────────────────────┐ │
│  │  PageHeader                                            │ │
│  │  title: "Onboarding Nowego Klienta"                    │ │
│  │  description: "Wypełnij dane podstawowe, dodaj         │ │
│  │  materiały i uruchom audyt AI."                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ PageBody ─────────────────────────────────────────────┐ │
│  │                                                        │ │
│  │  ┌─ Card: Dane podstawowe ──────────────────────────┐  │ │
│  │  │  CardHeader                                      │  │ │
│  │  │    CardTitle: "Dane podstawowe"                   │  │ │
│  │  │    CardDescription: "Podstawowe informacje        │  │ │
│  │  │    o kliencie agencji."                           │  │ │
│  │  │  CardContent                                     │  │ │
│  │  │    ┌──────────────────┬──────────────────┐       │  │ │
│  │  │    │  company_name    │  website_url      │       │  │ │
│  │  │    │  [Input text]    │  [Input text]     │       │  │ │
│  │  │    │  "Nazwa firmy *" │  "Adres WWW"      │       │  │ │
│  │  │    └──────────────────┴──────────────────┘       │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                        │ │
│  │  ┌─ Card: Baza wiedzy klienta ──────────────────────┐  │ │
│  │  │  CardHeader                                      │  │ │
│  │  │    CardTitle: "Baza wiedzy klienta"               │  │ │
│  │  │    CardDescription: "Wgraj materiały: oferty,     │  │ │
│  │  │    brand book, screenshoty, cenniki. AI           │  │ │
│  │  │    przeanalizuje wszystko."                       │  │ │
│  │  │  CardContent                                     │  │ │
│  │  │    ┌──────────────────────────────────────┐      │  │ │
│  │  │    │                                      │      │  │ │
│  │  │    │    ☁ Drag & Drop zone                │      │  │ │
│  │  │    │    "Przeciągnij pliki tutaj           │      │  │ │
│  │  │    │     lub kliknij aby wybrać"           │      │  │ │
│  │  │    │                                      │      │  │ │
│  │  │    │    [Upload] (ikona)                   │      │  │ │
│  │  │    │                                      │      │  │ │
│  │  │    └──────────────────────────────────────┘      │  │ │
│  │  │                                                  │  │ │
│  │  │    Uploaded files list:                          │  │ │
│  │  │    ┌──────────────────────────────────────┐      │  │ │
│  │  │    │ 📄 brandbook.pdf  (2.1 MB)    [🗑]   │      │  │ │
│  │  │    │ 📄 cennik-2026.xlsx (340 KB)  [🗑]   │      │  │ │
│  │  │    └──────────────────────────────────────┘      │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                        │ │
│  │  ┌─ Card: Akcja ───────────────────────────────────┐   │ │
│  │  │  CardContent (centered)                         │   │ │
│  │  │    [🚀 Zapisz i Rozpocznij Audyt]  (Button)    │   │ │
│  │  │    primary, size lg                              │   │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                        │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Architektura Strony

### Ścieżka pliku
```
apps/mercato/src/modules/agency_onboarding/
├── backend/
│   ├── page.meta.ts        # metadata: requireAuth, requireFeatures
│   └── page.tsx             # główna strona onboardingu → /backend/agency_onboarding
```

### Routing
- URL: `/backend/agency_onboarding`
- Auto-discovery: `backend/page.tsx` → `/backend/agency_onboarding` (konwencja Open Mercato)

### Page Metadata
```typescript
// backend/page.meta.ts
export const metadata = {
  requireAuth: true,
  requireFeatures: ['agency_onboarding.manage'],
}
```

---

## Komponenty i importy

| Komponent | Import | Użycie |
|-----------|--------|--------|
| `Page`, `PageHeader`, `PageBody` | `@open-mercato/ui/backend/Page` | Layout strony |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` | `@open-mercato/ui/primitives/card` | Sekcje formularza |
| `Input` | `@open-mercato/ui/primitives/input` | Pola tekstowe |
| `Button` | `@open-mercato/ui/primitives/button` | Przycisk akcji |
| `IconButton` | `@open-mercato/ui/primitives/icon-button` | Przycisk usuwania pliku |
| `Spinner` | `@open-mercato/ui/primitives/spinner` | Loading state |
| `flash` | `@open-mercato/ui/backend/FlashMessages` | Toast success/error |
| `apiCall` | `@open-mercato/ui/backend/utils/apiCall` | Wywołania API |
| `useT` | `@open-mercato/shared/lib/i18n/context` | Tłumaczenia |
| `Upload`, `Trash2`, `Rocket` | `lucide-react` | Ikony |

---

## Flow danych (Sekwencja zapisu)

### Krok 1: Użytkownik wypełnia formularz
- Wpisuje `company_name` (wymagane) i `website_url` (opcjonalne)
- Opcjonalnie uploaduje pliki (drag & drop)

### Krok 2: Upload plików (Attachments API)
Pliki uploadowane na bieżąco (nie czekając na submit formularza):

```
POST /api/attachments
Content-Type: multipart/form-data

entityId: "agency_onboarding:client_profile"
recordId: <tymczasowy UUID lub ID rekordu po pierwszym zapisie>
file: <binary>
```

**Ważne:** Moduł Attachments Open Mercato wymaga `entityId` + `recordId`. Strategia:
1. Przy pierwszym renderze generujemy `recordId` (UUID) po stronie klienta
2. Pliki uploadowane natychmiast z tym `recordId`
3. Przy submit formularza tworzymy rekord Custom Entity z tym samym ID

**Fallback:** Jeśli Custom Entities nie wspierają explicit ID przy tworzeniu — upload plików następuje PO zapisaniu rekordu (sekwencyjnie: create → upload).

### Krok 3: Zapis rekordu Client Profile
```
POST /api/entities/custom-records
Content-Type: application/json

{
  "entityId": "agency_onboarding:client_profile",
  "data": {
    "company_name": "Firma X",
    "website_url": "https://firmax.pl",
    "onboarding_status": "in_progress"
  }
}
```

Alternatywnie, jeśli Custom Entities korzystają ze standardowego CRUD:
```
POST /api/entities/storage
```
(Dokładny endpoint do zweryfikowania w runtime — Custom Entities mogą mieć własny CRUD path.)

### Krok 4: Potwierdzenie
- `flash()` z success message
- Opcjonalnie: redirect do widoku szczegółowego (Etap 3+)

---

## Drag & Drop — Specyfikacja komponentu

### Zachowanie
1. **Drop zone**: szary, przerywana ramka, reaguje na `dragover` (zmiana koloru na blue/primary)
2. **Kliknięcie**: otwiera natywny file picker (`<input type="file" multiple hidden>`)
3. **Akceptowane typy**: PDF, DOCX, XLSX, PNG, JPG, TXT, CSV (doprecyzować w runtime)
4. **Max rozmiar**: 10 MB per plik (limit Attachments module)
5. **Upload progress**: Spinner przy każdym pliku w trakcie uploadu
6. **Lista plików**: Pod drop zone, każdy plik z nazwą, rozmiarem, ikoną typu i przyciskiem usunięcia (🗑 `IconButton`)
7. **Usuwanie**: `DELETE /api/attachments?id=<attachmentId>`

### Implementacja
- **NIE** budujemy własnego upload mechanizmu
- Korzystamy z API `/api/attachments` (POST multipart/form-data)
- Komponenty React: natywne drag/drop events (`onDragOver`, `onDrop`, `onDragLeave`) + hidden `<input type="file">`
- Stan plików: `useState<UploadedFile[]>` z id, fileName, fileSize, status (uploading/done/error)

---

## Walidacja

| Pole | Reguła | Komunikat |
|------|--------|-----------|
| `company_name` | Wymagane, min 2 znaki | "Nazwa firmy jest wymagana" |
| `website_url` | Opcjonalne, jeśli podane — walidacja URL | "Podaj prawidłowy adres URL" |
| Pliki | Opcjonalne | — |

Walidacja po stronie klienta (przed submit). Błędy wyświetlane inline pod polami.

---

## i18n — Nowe klucze

```json
{
  "agency_onboarding.page.title": "Onboarding Nowego Klienta",
  "agency_onboarding.page.description": "Wypełnij dane podstawowe, dodaj materiały i uruchom audyt AI.",
  "agency_onboarding.card.basic.title": "Dane podstawowe",
  "agency_onboarding.card.basic.description": "Podstawowe informacje o kliencie agencji.",
  "agency_onboarding.field.company_name": "Nazwa firmy",
  "agency_onboarding.field.company_name.required": "Nazwa firmy jest wymagana",
  "agency_onboarding.field.website_url": "Adres WWW",
  "agency_onboarding.field.website_url.invalid": "Podaj prawidłowy adres URL",
  "agency_onboarding.card.knowledge.title": "Baza wiedzy klienta",
  "agency_onboarding.card.knowledge.description": "Wgraj materiały: oferty, brand book, screenshoty, cenniki. AI przeanalizuje wszystko.",
  "agency_onboarding.upload.dropzone": "Przeciągnij pliki tutaj lub kliknij aby wybrać",
  "agency_onboarding.upload.uploading": "Przesyłanie...",
  "agency_onboarding.upload.delete.confirm": "Czy na pewno chcesz usunąć ten plik?",
  "agency_onboarding.action.submit": "Zapisz i Rozpocznij Audyt",
  "agency_onboarding.action.submitting": "Zapisywanie...",
  "agency_onboarding.success": "Onboarding zapisany. Audyt AI zostanie uruchomiony.",
  "agency_onboarding.error.save": "Nie udało się zapisać danych onboardingu."
}
```

---

## Scope Exclusions (Etap 2)

- **Brak edycji/widoku szczegółowego** — tylko formularz tworzenia nowego onboardingu
- **Brak listy onboardingów** — do dodania w Etapie 3+
- **Brak automatycznego uruchomienia audytu AI** — przycisk zapisuje dane; logika audytu w Etapie 3
- **Brak progress bar uploadu** — uproszczony spinner (wystarczy na MVP)
- **Brak walidacji file type server-side** — korzystamy z defaults Attachments module

---

## Pliki do utworzenia

| Plik | Opis |
|------|------|
| `backend/page.meta.ts` | Metadata: auth + features |
| `backend/page.tsx` | Strona główna formularza |
| `i18n/en.json` | Aktualizacja — nowe klucze (EN) |
| `i18n/pl.json` | Aktualizacja — nowe klucze (PL) |

## Post-Implementation Commands

Po zaprogramowaniu strony **OBOWIĄZKOWO**:
```bash
yarn generate        # re-generacja routing i modułów (auto-discovery backend page)
yarn build:packages  # przebudowa pakietów monorepo
yarn dev             # restart serwera dev
```

Strona będzie dostępna pod: `http://localhost:3000/backend/agency_onboarding`

---

## Backward Compatibility

Żadne ryzyko — nowa strona w istniejącym module `agency_onboarding`. Brak modyfikacji core ani innych modułów.

---

## Resolved Questions

1. **Pliki opcjonalne** — nie blokują zapisu. Wymagane tylko `company_name` i `website_url`. Klient może oprzeć audyt wyłącznie na stronie WWW.
2. **Po zapisie → redirect** na widok szczegółów dodanego klienta (lub listę) jako wizualne potwierdzenie sukcesu.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-01 | Initial spec: Card-based form with drag & drop. Approved and implemented. |
| 2026-04-01 | Fixed apiCall usage (ApiCallResult vs Response). Redirect changed to detail page. |
| 2026-04-02 | Etap 8: Simplified profile tab (CRM basics only). Etap 9: Added list page + sidebar menu injection. |

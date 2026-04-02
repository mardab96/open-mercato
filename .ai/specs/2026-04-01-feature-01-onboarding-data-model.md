# Feature 01 — Deep Onboarding Data Model

| Field       | Value |
|------------|-------|
| **Status** | Approved |
| **Created** | 2026-04-01 |
| **Phase** | Etap 1 — Struktura danych pod Głęboki Onboarding |
| **Goal** | MVP autonomicznej agencji performance marketingowej |

---

## TLDR

Zdefiniowanie modelu danych dla „Głębokiego Onboardingu" klienta agencji performance marketingowej. Każdy klient = oddzielny Tenant/Organization w module Directory. Dane onboardingowe (www, marża, styl komunikacji, grupa docelowa, audyt AI) przechowywane jako Custom Entities z polami w formacie Markdown — czytelne dla AI, prezentowane użytkownikowi przez sformatowany UI. Żadne pliki core nie są modyfikowane — całość w `apps/mercato/src/modules/agency_onboarding/`.

---

## Problem Statement

Agencja performance marketingowa potrzebuje ustrukturyzowanego procesu onboardingu klienta, który:
1. Zbierze kluczowe dane biznesowe klienta (branża, marża, budżet, grupa docelowa)
2. Zapisze wyniki audytu AI (analiza WWW, konkurencji, komunikacji) w formacie zrozumiałym zarówno dla AI jak i człowieka
3. Utrzyma pełną separację danych między klientami (multi-tenancy)
4. Nie narusza zasady Open-Closed Principle — zero modyfikacji plików rdzenia Open Mercato

---

## User Stories

- **Pracownik agencji** chce **uruchomić onboarding nowego klienta** aby **system zebrał i ustrukturyzował wszystkie potrzebne dane w jednym miejscu**.
- **AI Agent** chce **odczytać dane onboardingowe w formacie Markdown** aby **generować kampanie, treści i strategie bez dodatkowego parsowania**.
- **Pracownik agencji** chce **przeglądać wyniki onboardingu w czytelnym UI** aby **weryfikować i zatwierdzać dane przed uruchomieniem kampanii**.
- **Admin agencji** chce **mieć pewność, że dane jednego klienta nie wyciekną do innego** aby **zachować poufność biznesową**.

---

## Design Decisions

| # | Decision | Resolution | Rationale |
|---|----------|-----------|-----------|
| 1 | Klient = Tenant vs Organization | **Organization** (w ramach jednego Tenanta agencji) | Agencja to jeden Tenant. Każdy klient to osobna Organization. Pracownicy agencji mają dostęp do wielu Organizations via visibility list. Prostsze niż tworzenie osobnych Tenantów. |
| 2 | Dane onboardingowe — osobne tabele vs Custom Entities | **Custom Entities (EAV)** via `ce.ts` | Zgodne z OCP — zero zmian w core. Pola definiowane deklaratywnie. Automatyczna integracja z CrudForm, query index, search. |
| 3 | Format przechowywania | **Markdown w polach `multiline` (editor: markdown)** | Czytelny dla LLM bez transformacji. UI Open Mercato renderuje Markdown natywnie. Jeden dokument na sekcję onboardingu. |
| 4 | Encryption | **Pominięta (MVP)** | Jawny tekst upraszcza debugowanie i rozwój. Do dodania w późniejszym etapie produkcyjnym. |
| 5 | Moduł — core vs app | **`apps/mercato/src/modules/agency_onboarding/`** | Zgodne z AGENTS.md: user/app-specific modules w `apps/mercato/src/modules/`. |
| 6 | Profil klienta — rozszerzenie Organization vs osobna encja | **Osobna Custom Entity `agency_onboarding:client_profile`** powiązana z Organization | Nie modyfikujemy Directory core. Extension entity z FK do `organization_id`. |

---

## Proposed Solution

### 1. Architektura Multi-Tenancy

```
Tenant (Agencja "AdLume")
├── Organization (Klient A — "Firma X")
│   ├── Users: pracownicy agencji z dostępem
│   └── Dane onboardingowe (Custom Entities)
├── Organization (Klient B — "Firma Y")
│   ├── Users: pracownicy agencji z dostępem
│   └── Dane onboardingowe (Custom Entities)
└── ...
```

- **Jeden Tenant** = instancja agencji
- **Jedna Organization per klient** = pełna izolacja danych
- **Pracownicy agencji** = Users z rolą `agency_admin` lub `agency_operator`, widoczność na wybrane Organizations
- **Klient** = opcjonalnie User z rolą `client_viewer` (read-only dostęp do swojego workspace)

### 2. Nowy moduł: `agency_onboarding`

Lokalizacja: `apps/mercato/src/modules/agency_onboarding/`

```
agency_onboarding/
├── index.ts              # metadata modułu
├── acl.ts                # features: agency_onboarding.view, .manage, .audit
├── setup.ts              # defaultRoleFeatures, seedDefaults
├── ce.ts                 # Custom Entity definitions (dane onboardingowe)
├── di.ts                 # DI registrar (jeśli potrzebny)
├── i18n/
│   ├── en.json
│   └── pl.json
├── backend/
│   └── page.tsx          # UI: strona główna onboardingu → /backend/agency_onboarding
├── api/                  # Opcjonalne custom API endpoints (Etap 2+)
└── widgets/
    └── injection/        # Widgety wstrzyknięte do Organization detail page
```

### 3. Custom Entities — Model Danych Onboardingu (`ce.ts`)

Trzy encje logiczne, każda jako Custom Entity:

#### 3a. `agency_onboarding:client_profile` — Profil Biznesowy Klienta

| Pole | Kind | Opis | Indexed | Filterable |
|------|------|------|---------|------------|
| `company_name` | text | Nazwa firmy klienta | yes | yes |
| `industry` | select | Branża (e-commerce, SaaS, usługi, produkcja, ...) | yes | yes |
| `website_url` | text | Adres WWW | yes | no |
| `monthly_ad_budget` | float | Miesięczny budżet reklamowy (PLN) | yes | yes |
| `target_roas` | float | Docelowy ROAS | no | yes |
| `gross_margin_pct` | float | Marża brutto (%) | no | no |
| `onboarding_status` | select | Status: `draft`, `in_progress`, `completed`, `active` | yes | yes |
| `assigned_operator` | text | ID/email operatora agencji | yes | yes |
| `notes` | multiline (markdown) | Notatki ogólne | no | no |

#### 3b. `agency_onboarding:target_audience` — Grupa Docelowa & Persony

| Pole | Kind | Opis |
|------|------|------|
| `audience_summary` | multiline (markdown) | Ustrukturyzowany dokument Markdown z opisem grupy docelowej |
| `personas` | multiline (markdown) | Persony klientów w formacie Markdown |
| `pain_points` | multiline (markdown) | Bóle i potrzeby grupy docelowej |
| `buying_triggers` | multiline (markdown) | Wyzwalacze zakupowe |
| `channels` | select (multi) | Preferowane kanały: `google_ads`, `meta_ads`, `linkedin_ads`, `tiktok_ads`, `email` |

#### 3c. `agency_onboarding:ai_audit` — Wynik Audytu AI

| Pole | Kind | Opis |
|------|------|------|
| `website_analysis` | multiline (markdown) | Analiza WWW: struktura, UX, szybkość, SEO |
| `competitor_analysis` | multiline (markdown) | Analiza konkurencji i benchmarki |
| `communication_style` | multiline (markdown) | Analiza stylu komunikacji marki (ToV) |
| `swot` | multiline (markdown) | Analiza SWOT w Markdown |
| `recommended_strategy` | multiline (markdown) | Rekomendacja strategii performance |
| `audit_date` | text | Data przeprowadzenia audytu (YYYY-MM-DD) |
| `audit_version` | integer | Wersja audytu (inkrementalna) |

### 4. Format Markdown — Konwencja

Pola `multiline` z `editor: 'markdown'` przechowują ustrukturyzowane dokumenty. Przykładowa struktura dla `audience_summary`:

```markdown
## Grupa Docelowa

### Demografika
- Wiek: 25-45
- Płeć: 60% kobiety, 40% mężczyźni
- Lokalizacja: Polska, duże miasta

### Psychografika
- Wartości: wygoda, jakość, szybka dostawa
- Styl życia: aktywni zawodowo, kupują online

### Zachowania Zakupowe
- Średni koszyk: 180 PLN
- Częstotliwość: 2x/miesiąc
- Kanał: mobile-first (72%)
```

**Warstwa danych**: czysty Markdown w bazie (w tabeli `custom_field_values`).
**Warstwa UI**: CrudForm z edytorem Markdown renderuje to w sformatowanej formie.
**Warstwa AI**: odczytuje surowy Markdown bezpośrednio — nie wymaga parsowania.

### 5. Access Control (ACL)

```typescript
// acl.ts
export const features = [
  'agency_onboarding.view',      // Podgląd danych onboardingu
  'agency_onboarding.manage',    // Tworzenie/edycja onboardingu
  'agency_onboarding.audit',     // Uruchamianie audytu AI
]
```

```typescript
// setup.ts — defaultRoleFeatures
{
  superadmin: ['agency_onboarding.*'],
  admin: ['agency_onboarding.*'],          // agency admin
  employee: ['agency_onboarding.view'],    // agency operator (read)
}
```

### 6. Integracja z Organization (bez modyfikacji core)

Powiązanie onboarding → Organization realizowane przez:
- Automatyczne `organization_id` scoping w Custom Field Values (wbudowane w EAV)
- Każdy rekord Custom Entity jest automatycznie przypisany do Organization w kontekście sesji
- Nie tworzymy osobnych FK — korzystamy z natywnego scoping mechanizmu Open Mercato

---

## Scope Exclusions (MVP)

- **Brak szyfrowania** — dane w jawnym tekście (Encryption Maps pominięte)
- **Brak workflow automation** — onboarding ręcznie zarządzany (automatyzacja w Etapie 2+)
- **Brak integracji z zewnętrznymi API** (Google Ads, Meta Ads) — Etap 3+
- **Brak customer portal** — klient nie ma własnego loginu (opcjonalnie w przyszłości)
- **Brak migracji istniejących danych** — nowa instalacja, czysta baza

---

## Implementation Plan (Etap 1 — tylko struktura danych)

| Krok | Co | Pliki |
|------|----|-------|
| 1 | Scaffold modułu `agency_onboarding` | `index.ts`, `acl.ts`, `setup.ts`, `ce.ts` |
| 2 | Definicja Custom Entities w `ce.ts` | 3 encje: client_profile, target_audience, ai_audit |
| 3 | i18n labels | `i18n/en.json`, `i18n/pl.json` |
| 4 | `yarn generate` + `yarn build:packages` | Rejestracja encji w systemie |
| 5 | `yarn initialize -- --reinstall` lub restart dev | Instalacja pól w bazie |
| 6 | Weryfikacja w UI | Backend → Data designer → nowe encje widoczne |

---

## Backward Compatibility

Żadna — nowy moduł, brak modyfikacji istniejących plików core. Zero ryzyka regresji.

---

## Resolved Questions

1. **Portal klienta** → Pominięty na MVP. Wyłącznie widok dla pracowników agencji.
2. **Wersjonowanie audytu AI** → Nadpisywany w głównym polu. Historia zmian śledzona przez wbudowany Action Log (Command pattern).
3. **Globalny search** → Tak. Custom Entities (szczególnie `client_profile`) podpięte pod system indeksowania — wyszukiwalne globalnie przez superadmina.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-01 | Initial spec: 3 Custom Entities (client_profile, target_audience, ai_audit) with 21 fields. Approved and implemented. |
| 2026-04-02 | Fields validated in production. Etap 8 removed redundant business fields from UI (data lives in A-K audit template). |

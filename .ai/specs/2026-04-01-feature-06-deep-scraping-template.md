# Feature 06 — Deep Web Scraping & Structured Audit Template

| Field       | Value |
|------------|-------|
| **Status** | Approved |
| **Created** | 2026-04-01 |
| **Phase** | Etap 6 — Głęboki Web Scraping + Szablon Audytu |
| **Depends on** | Feature 01 (Data Model), Feature 03 (AI Audit Worker) |

---

## TLDR

Przebudowa procesu audytu AI: (1) przed wywołaniem OpenAI, worker scrapuje stronę WWW klienta za pomocą `cheerio` + natywnego `fetch`, wyciągając czysty tekst z HTML, (2) system prompt zastępowany rygorystycznym szablonem A-K (11 sekcji, ~300 linii Markdown), (3) wynik zapisywany jako jeden skonsolidowany dokument Markdown w `ai_audit.recommended_strategy`. Zero zmian w core — wszystko w module `agency_onboarding`.

---

## Problem Statement

Obecny audyt AI bazuje wyłącznie na nazwie firmy i URL (+ opcjonalne pliki). Wynik jest ogólnikowy i nie odpowiada na konkretne pytania performance marketingowe. Potrzebujemy:
1. **Rzeczywistych danych ze strony WWW** — scrapowane treści jako kontekst dla LLM
2. **Ustandaryzowanego szablonu** — 11 sekcji (A-K) pokrywających pełen zakres performance marketingu
3. **Kondensowanego outputu** — ~300 linii Markdown, zero wodolejstwa

---

## Design Decisions

| # | Decision | Resolution | Rationale |
|---|----------|-----------|-----------|
| 1 | Scraping tool | **`cheerio` + natywny `fetch`** | Cheerio już w dependencies. Lekkie, server-side, nie wymaga headless browser. Wystarczy na MVP. |
| 2 | Scraping scope | **Strona główna + max 5 podstron** (o nas, oferta, cennik, kontakt, blog) | Limit kontekstu OpenAI + koszty. Podstrony wykrywane z linków na stronie głównej. |
| 3 | HTML cleanup | **Usunięcie `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>` — ekstrakcja `<main>`, `<article>`, `<section>`, `<p>`, `<h1-h6>`, `<li>`** | Czysty tekst bez noise. |
| 4 | Scraping timeout | **10s per strona, 30s total** | Nie blokujemy workera zbyt długo. Fail gracefully. |
| 5 | Output format | **Jeden skonsolidowany Markdown** zapisany w `ai_audit` | Łatwiejsze do odczytu przez AI i człowieka niż rozrzucone po wielu polach. |
| 6 | Template language | **Polski** (szablon + output) | Agencja polska, klienci polscy. |
| 7 | Model | **gpt-4o** (bez zmian) | Wystarczająco silny na 300-liniowy ustrukturyzowany output. |

---

## Files to Modify / Create

| File | Action | Opis |
|------|--------|------|
| `lib/web-scraper.ts` | **CREATE** | Moduł scrapujący: fetch HTML → cheerio parse → czysty tekst |
| `lib/ai-audit-service.ts` | **MODIFY** | Nowy system prompt z szablonem A-K, input wzbogacony o scraped content |
| `subscribers/audit-trigger.ts` | **MODIFY** | Dodanie kroku scrapingu przed wywołaniem `runAiAudit()` |

---

## 1. Web Scraper (`lib/web-scraper.ts`)

### Algorytm

```
1. Fetch strony głównej (GET website_url)
   - Timeout: 10s
   - User-Agent: "Mozilla/5.0 (compatible; AgencyAuditBot/1.0)"
   - Follow redirects

2. Parse HTML z cheerio:
   - Usuń: <script>, <style>, <noscript>, <svg>, <iframe>
   - Wyciągnij tekst z: <main>, <article>, <section>, <p>, <h1-h6>, <li>, <td>, <th>
   - Zachowaj strukturę nagłówków (h1-h6 → ## Markdown headers)

3. Wykryj linki do podstron (max 5):
   - Szukaj <a href="..."> z tym samym hostname
   - Priorytet: /o-nas, /about, /oferta, /services, /cennik, /pricing, /kontakt, /contact, /blog
   - Heurystyka: linki z nav/menu z krótkimi ścieżkami

4. Fetch + parse każdej podstrony (parallel, timeout 10s each)

5. Połącz w jeden dokument:
   --- STRONA GŁÓWNA ---
   [treść]
   --- /o-nas ---
   [treść]
   ...

6. Limit: max 15,000 znaków total (trim per-page jeśli przekroczone)
```

### Input/Output

```typescript
type ScrapeResult = {
  success: boolean
  pages: Array<{ url: string; title: string; content: string }>
  totalChars: number
  error?: string
}

async function scrapeWebsite(url: string): Promise<ScrapeResult>
```

### Error Handling
- Strona niedostępna → `success: false`, audit kontynuuje bez scraped data (fallback na nazwę + URL + pliki)
- Timeout per strona → skip, kontynuuj z pozostałymi
- SSL error → retry bez weryfikacji certyfikatu (dev only)

---

## 2. Przebudowany System Prompt (`lib/ai-audit-service.ts`)

### Nowy Prompt (szablon A-K)

```
SYSTEM: Jesteś senior performance marketing strategist. Na podstawie
dostarczonych danych (zeskrapowana strona WWW + ewentualne materiały klienta)
wypełnij DOKŁADNIE poniższy szablon. Nie pomijaj żadnej sekcji.
Pisz po polsku. Bądź konkretny — podawaj liczby, nazwy, przykłady.
Tam gdzie brak danych — napisz "⚠️ BRAK DANYCH — do uzupełnienia przez operatora".

Odpowiedz WYŁĄCZNIE jako Markdown (~300 linii). Zachowaj numerację sekcji A-K.

# AUDYT PERFORMANCE MARKETING — [NAZWA FIRMY]

## A. Grupa docelowa (Target Audience)
### Demografia i profil
- Kim jest idealny klient/uczestnik (wiek, płeć, stanowisko, wielkość firmy w B2B)?
### Zachowania online
- Gdzie w sieci przebywają klienci (strony, portale, grupy Meta)?
### Wyzwania
- Jakie problemy lub potrzeby rozwiązuje dany projekt?

## B. Kluczowe Wskaźniki Efektywności (KPI)
### Cele
- Najważniejszy cel performance marketingu.
### Benchmarki
- Historyczne/oczekiwane CVR oraz CPL/CPA.

## C. Budżet (Budget Allocation)
### Kwota
- Całkowity budżet na kampanie (Google Ads + Meta) w skali miesiąca/kwartału.
### Podział
- Jak alokować środki między projektami?

## D. Lokalizacja (Geographic Targeting)
### Obszar
- Dokładny obszar wyświetlania reklam.
### Wykluczenia
- Obszary, na które kategorycznie nie kierujemy reklam.

## E. Unikalna Wartość (USP)
### Wyróżnik
- Co odróżnia produkt od konkurencji i stanowi główną korzyść?
### Materiały
- Konwertujące copy reklamowe i hasła do wykorzystania.

## F. Harmonogram (Timelines)
### Daty
- Terminy kluczowych wydarzeń, rejestracji.
### Sezonowość
- Moment w roku o wzmożonym zainteresowaniu.

## G. Konkurencja (Competitive Landscape)
### Główni gracze
- 3-5 bezpośrednich konkurentów.
### Przewaga
- Obserwacje działań reklamowych konkurencji.

## H. Cena (Pricing Structure)
### Model
- Aktualny cennik, pakiety i progi cenowe.
### Promocje
- Planowane kody rabatowe.

## I. Infrastruktura Techniczna i Analityka
### Tracking
- Google Ads, Meta Pixel, CAPI.
### Dostęp
- GA4, GTM.
### Bazy danych
- Listy CRM/mailingowe.
### Segmentacja
- Potrzeba różnicowania komunikatów.

## J. Strony Docelowe (LP) i Content Strategy
### Skuteczność LP
- Strony docelowe najlepiej konwertujące.
### Testy A/B
- Możliwość testowania.
### Content
- Dostępne materiały (wideo, case studies, blogi).

## K. Ograniczenia i Brand Safety
### Wykluczenia
- Miejsca, na których nie wyświetlamy reklam.
```

### Zmiany w AuditInput

```typescript
type AuditInput = {
  companyName: string
  websiteUrl: string
  scrapedContent: string        // NEW — zeskrapowany tekst ze strony
  attachmentContents: string[]  // existing — treści z plików
}
```

### Zmiany w AuditResult

```typescript
type AuditResult = {
  audit_document: string   // Pełny Markdown (~300 linii) wg szablonu A-K
  channels: string[]       // Extracted recommended channels
}
```

Jedna skonsolidowana odpowiedź Markdown zamiast rozbitych pól JSON.

---

## 3. Zmiany w subscriber (`audit-trigger.ts`)

### Nowy flow

```
1. Fetch client_profile record (company_name, website_url)  [existing]
2. Fetch attachments content                                  [existing]
3. NEW: Scrape website_url → scrapedContent
4. Call runAiAudit({ companyName, websiteUrl, scrapedContent, attachmentContents })
5. Save audit_document → ai_audit entity fields:
   - recommended_strategy = audit_document (pełny Markdown)
   - website_analysis = (first 2 sections A-B extracted)
   - audit_date, audit_version
6. Save channels → target_audience entity
7. Update status → completed
```

---

## 4. Zapis wyniku do bazy

Skonsolidowany `audit_document` (Markdown ~300 linii) zapisywany do:
- `ai_audit.recommended_strategy` — pełny dokument (główne pole)
- `ai_audit.website_analysis` — sekcja A (grupa docelowa) — dla quick preview
- `ai_audit.swot` — sekcja G (konkurencja) — dla quick preview
- `target_audience.audience_summary` — sekcja A wyekstrahowana
- `target_audience.channels` — lista kanałów z audytu

---

## 5. Environment Variables

| Variable | Default | Change |
|----------|---------|--------|
| `AGENCY_SCRAPE_TIMEOUT_MS` | `10000` | NEW — timeout per page |
| `AGENCY_SCRAPE_MAX_PAGES` | `6` | NEW — max pages to scrape (1 main + 5 sub) |
| `AGENCY_SCRAPE_MAX_CHARS` | `15000` | NEW — max total scraped chars |
| `AGENCY_AUDIT_MODEL` | `gpt-4o` | No change |
| `AGENCY_AUDIT_TIMEOUT_MS` | `120000` | No change |

---

## Post-Implementation

```bash
# Nie wymaga yarn generate (brak nowych route'ów/plików auto-discovery)
# Wystarczy HMR (dev server automatycznie przeładuje zmienione pliki)
# Opcjonalnie: restart serwera jeśli HMR nie złapie zmian w lib/
```

---

## Scope Exclusions

- **Brak headless browser** (Puppeteer/Playwright) — cheerio wystarczy na MVP, SPA sites nie będą scrapowane
- **Brak cache scrapingu** — każdy audyt scrapuje od nowa
- **Brak robots.txt check** — MVP, dodać w produkcji
- **Brak scrapowania subdomen** — tylko podstrony w tym samym hostname

---

## Backward Compatibility

Żadne ryzyko. Modyfikujemy wyłącznie pliki wewnątrz `agency_onboarding/lib/` i `agency_onboarding/subscribers/`. Istniejące rekordy w bazie nie będą naruszone — nowe audyty nadpiszą pola zgodnie z ustalonym wzorcem (Etap 1: audit nadpisywany, historia via Action Log).

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-01 | Initial spec: cheerio + structured A-K template. Approved and implemented. |
| 2026-04-01 | Etap 7: Replaced cheerio with Playwright headless browser for SPA/Cloudflare support. |
| 2026-04-02 | Etap 8: Audit output rendered as editable Markdown (Textarea + preview toggle). Channels moved to audit tab. |
| 2026-04-02 | Etap 10: Unit tests for extractSection, formatScrapedContent, injection-table. |

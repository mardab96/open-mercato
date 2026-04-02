import OpenAI from 'openai'

const SYSTEM_PROMPT = `Jesteś senior performance marketing strategist z 15-letnim doświadczeniem w Google Ads i Meta Ads.

Na podstawie dostarczonych danych (zeskrapowana strona WWW klienta + ewentualne materiały) wypełnij DOKŁADNIE poniższy szablon. Nie pomijaj żadnej sekcji ani podpunktu.

ZASADY:
- Pisz po polsku.
- Bądź konkretny — podawaj liczby, nazwy firm, przykłady z danych klienta.
- Gdzie brak danych do wywnioskowania — napisz "⚠️ BRAK DANYCH — do uzupełnienia przez operatora".
- NIE wymyślaj danych liczbowych (budżet, CVR, CPA) jeśli nie wynikają z materiałów.
- Analizuj stronę klienta krytycznie — wskaż słabe i mocne strony.
- Konkurentów szukaj na podstawie branży i oferty klienta.
- Długość: ok. 300 linii Markdown. Zwięźle, zero wodolejstwa.
- Odpowiedz WYŁĄCZNIE czystym Markdown. Bez JSON, bez code block wrappera.

SZABLON:

# AUDYT PERFORMANCE MARKETING — [NAZWA FIRMY]

> Data audytu: [DZISIEJSZA DATA]
> Źródło: Analiza strony WWW + materiały klienta

---

## A. Grupa docelowa (Target Audience)

### A.1 Demografia i profil
- Kim jest idealny klient/uczestnik?
- Wiek, płeć, stanowisko, wielkość firmy (w B2B)
- Segmenty priorytetowe

### A.2 Zachowania online
- Gdzie w sieci przebywają klienci (konkretne strony, portale, grupy Meta)?
- Jakie treści konsumują?
- Ścieżka zakupowa (awareness → consideration → decision)

### A.3 Wyzwania klientów
- Jakie problemy lub potrzeby rozwiązuje dany projekt?
- Top 3 obiekcje przed zakupem

---

## B. Kluczowe Wskaźniki Efektywności (KPI)

### B.1 Cele
- Najważniejszy cel performance marketingu (lead gen / e-commerce / awareness / app install)
- Cel drugorzędny

### B.2 Benchmarki branżowe
- Oczekiwany CVR (Conversion Rate) dla branży
- Szacowany CPL/CPA (Cost per Lead / Acquisition)
- CTR benchmark

---

## C. Budżet (Budget Allocation)

### C.1 Kwota
- Sugerowany budżet miesięczny na kampanie (Google Ads + Meta)
- Budżet kwartalny

### C.2 Podział
- Alokacja: Google Ads vs Meta Ads vs inne kanały
- Podział budżetu między kampanie (brand, performance, retargeting)

---

## D. Lokalizacja (Geographic Targeting)

### D.1 Obszar
- Dokładny obszar wyświetlania reklam (kraje, regiony, miasta, promień)

### D.2 Wykluczenia
- Obszary, na które kategorycznie nie kierujemy reklam

---

## E. Unikalna Wartość (USP)

### E.1 Wyróżnik
- Co odróżnia produkt/usługę od konkurencji?
- Główna korzyść dla klienta (1 zdanie)

### E.2 Materiały reklamowe
- 3 propozycje headline'ów reklamowych
- 2 propozycje description lines
- Hasła CTA (Call to Action)

---

## F. Harmonogram (Timelines)

### F.1 Daty kluczowe
- Terminy wydarzeń, rejestracji, premier, deadlines

### F.2 Sezonowość
- Miesiące o wzmożonym zainteresowaniu
- Okresy niskiej aktywności

---

## G. Konkurencja (Competitive Landscape)

### G.1 Główni gracze
- 3-5 bezpośrednich konkurentów (nazwa, URL, krótki opis)

### G.2 Analiza przewag
- Co konkurenci robią lepiej w reklamach?
- Jakie kanały wykorzystują?
- Luki do zagospodarowania

---

## H. Cena (Pricing Structure)

### H.1 Model cenowy
- Aktualny cennik, pakiety, progi cenowe
- Porównanie z konkurencją

### H.2 Promocje
- Rekomendowane promocje/kody rabatowe na start kampanii

---

## I. Infrastruktura Techniczna i Analityka

### I.1 Tracking
- Status: Google Ads Pixel, Meta Pixel, Conversions API (CAPI)
- Rekomendacje dotyczące implementacji

### I.2 Dostęp
- GA4, GTM — czy wykryto na stronie?

### I.3 Bazy danych
- Listy CRM/mailingowe — potencjał lookalike audiences

### I.4 Segmentacja
- Czy potrzeba różnicowania komunikatów per segment?

---

## J. Strony Docelowe (LP) i Content Strategy

### J.1 Ocena stron docelowych
- Analiza obecnych LP (szybkość, CTA, UX, mobile)
- Strony najlepiej konwertujące (jeśli wykryto)

### J.2 Testy A/B
- Rekomendacje testów do przeprowadzenia

### J.3 Content
- Dostępne materiały (wideo, case studies, blogi, testimoniale)
- Brakujące materiały do stworzenia

---

## K. Ograniczenia i Brand Safety

### K.1 Wykluczenia
- Miejsca/placementy, na których nie wyświetlamy reklam
- Tematy/kategorie treści do wykluczenia

---

## PODSUMOWANIE I NASTĘPNE KROKI

1. [Najważniejsza akcja do podjęcia]
2. [Druga najważniejsza akcja]
3. [Trzecia najważniejsza akcja]`

export type AuditInput = {
  companyName: string
  websiteUrl: string
  scrapedContent: string
  attachmentContents: string[]
}

export type AuditResult = {
  auditDocument: string
  channels: string[]
}

function extractChannels(markdown: string): string[] {
  const channelMap: Record<string, string> = {
    'google ads': 'google_ads',
    'meta ads': 'meta_ads',
    'facebook ads': 'meta_ads',
    'instagram ads': 'meta_ads',
    'linkedin ads': 'linkedin_ads',
    'tiktok ads': 'tiktok_ads',
    'tiktok': 'tiktok_ads',
    'email': 'email',
    'e-mail': 'email',
    'seo': 'seo',
    'programmatic': 'programmatic',
  }

  const found = new Set<string>()
  const lower = markdown.toLowerCase()
  for (const [keyword, channel] of Object.entries(channelMap)) {
    if (lower.includes(keyword)) found.add(channel)
  }
  return Array.from(found)
}

function extractSection(markdown: string, sectionLetter: string): string {
  const regex = new RegExp(`## ${sectionLetter}\\..*?\n([\\s\\S]*?)(?=\n## [A-Z]\\.|\n---|\n## PODSUMOWANIE|$)`)
  const match = markdown.match(regex)
  return match ? match[1].trim() : ''
}

export async function runAiAudit(input: AuditInput): Promise<AuditResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const model = process.env.AGENCY_AUDIT_MODEL || 'gpt-4o'
  const timeout = parseInt(process.env.AGENCY_AUDIT_TIMEOUT_MS || '120000', 10)

  const client = new OpenAI({ apiKey, timeout })

  // Build context sections
  const sections: string[] = []

  sections.push(`KLIENT: ${input.companyName}`)
  sections.push(`STRONA WWW: ${input.websiteUrl}`)

  if (input.scrapedContent) {
    sections.push(`\n--- ZESKRAPOWANA TREŚĆ STRONY WWW ---\n${input.scrapedContent}`)
  } else {
    sections.push('\n⚠️ Nie udało się pobrać treści strony WWW. Bazuj na nazwie firmy i URL.')
  }

  if (input.attachmentContents.length > 0) {
    sections.push(`\n--- MATERIAŁY KLIENTA (WGRANE PLIKI) ---\n${input.attachmentContents.map((c, i) => `[Dokument ${i + 1}]\n${c}`).join('\n\n')}`)
  }

  const userMessage = sections.join('\n')

  console.log(`[ai-audit] Sending to ${model}: ${userMessage.length} chars context`)

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.5,
    max_tokens: 8000,
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('Empty response from OpenAI')
  }

  console.log(`[ai-audit] Response received: ${content.length} chars, ~${content.split('\n').length} lines`)

  const channels = extractChannels(content)

  return {
    auditDocument: content,
    channels,
  }
}

export { extractSection }

import { chromium } from 'playwright'

const PAGE_TIMEOUT = parseInt(process.env.AGENCY_SCRAPE_TIMEOUT_MS || '15000', 10)
const MAX_PAGES = parseInt(process.env.AGENCY_SCRAPE_MAX_PAGES || '6', 10)
const MAX_CHARS = parseInt(process.env.AGENCY_SCRAPE_MAX_CHARS || '15000', 10)

const PRIORITY_PATHS = [
  /\/(o-nas|about|about-us|kim-jestesmy)/i,
  /\/(oferta|services|uslugi|what-we-do)/i,
  /\/(cennik|pricing|prices|pakiety)/i,
  /\/(kontakt|contact)/i,
  /\/(blog|aktualnosci|news)/i,
  /\/(produkty|products|sklep|shop)/i,
  /\/(case-study|portfolio|realizacje)/i,
]

export type ScrapedPage = {
  url: string
  title: string
  content: string
}

export type ScrapeResult = {
  success: boolean
  pages: ScrapedPage[]
  totalChars: number
  error?: string
}

async function extractPageContent(pageObj: import('playwright').Page, url: string): Promise<ScrapedPage | null> {
  try {
    await pageObj.goto(url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT })
    await pageObj.waitForTimeout(1000)

    const data = await pageObj.evaluate(() => {
      // Remove noise elements
      const removeSelectors = [
        'script', 'style', 'noscript', 'svg', 'iframe', 'link', 'meta',
        'nav', 'footer', 'header', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '[class*="cookie"]', '[class*="popup"]', '[class*="modal"]',
        '[id*="cookie"]', '[id*="popup"]', '[class*="chat"]',
      ]
      for (const sel of removeSelectors) {
        document.querySelectorAll(sel).forEach((el) => el.remove())
      }

      const title = document.title || document.querySelector('h1')?.textContent?.trim() || ''

      // Extract visible text with structure
      const blocks: string[] = []
      const seen = new Set<string>()

      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
        const text = el.textContent?.trim()
        if (text && text.length > 1 && !seen.has(text)) {
          seen.add(text)
          const level = parseInt(el.tagName.replace('H', ''), 10)
          blocks.push('#'.repeat(Math.min(level + 1, 4)) + ' ' + text)
        }
      })

      document.querySelectorAll('p, li, td, th, blockquote, figcaption').forEach((el) => {
        const text = el.textContent?.trim()
        if (text && text.length > 15 && !seen.has(text)) {
          seen.add(text)
          blocks.push(el.tagName === 'LI' ? '- ' + text : text)
        }
      })

      // Also collect all internal links
      const links: string[] = []
      document.querySelectorAll('a[href]').forEach((el) => {
        const href = el.getAttribute('href')
        if (href) links.push(href)
      })

      return { title, content: blocks.join('\n'), links }
    })

    return { url, title: data.title, content: data.content }
  } catch (e) {
    console.warn(`[scraper] Failed to scrape ${url}:`, e instanceof Error ? e.message : e)
    return null
  }
}

function resolveSubpageUrls(baseUrl: string, links: string[]): string[] {
  const base = new URL(baseUrl)
  const candidates: Array<{ url: string; priority: number }> = []
  const seen = new Set<string>()

  for (const link of links) {
    try {
      const resolved = new URL(link, baseUrl)
      if (resolved.hostname !== base.hostname) continue
      if (resolved.pathname === '/' || resolved.pathname === base.pathname) continue

      const canonical = `${resolved.origin}${resolved.pathname}`
      if (seen.has(canonical)) continue
      seen.add(canonical)

      if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|css|js|ico|webp|woff|mp4)$/i.test(resolved.pathname)) continue

      let priority = 100
      for (let i = 0; i < PRIORITY_PATHS.length; i++) {
        if (PRIORITY_PATHS[i].test(resolved.pathname)) { priority = i; break }
      }

      const depth = resolved.pathname.split('/').filter(Boolean).length
      if (depth > 3) continue
      if (priority === 100) priority = 50 + depth

      candidates.push({ url: canonical, priority })
    } catch { continue }
  }

  candidates.sort((a, b) => a.priority - b.priority)
  return candidates.slice(0, MAX_PAGES - 1).map((c) => c.url)
}

export async function scrapeWebsite(websiteUrl: string): Promise<ScrapeResult> {
  const pages: ScrapedPage[] = []
  let totalChars = 0
  let browser

  try {
    console.log(`[scraper] Launching headless browser...`)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    })

    const page = await context.newPage()

    // 1. Scrape main page
    console.log(`[scraper] Fetching main page: ${websiteUrl}`)
    const mainResult = await extractPageContent(page, websiteUrl)

    if (!mainResult || !mainResult.content) {
      console.warn(`[scraper] Could not extract content from ${websiteUrl}`)
      await browser.close()
      return { success: false, pages: [], totalChars: 0, error: `No content from ${websiteUrl}` }
    }

    const mainContent = mainResult.content.slice(0, Math.floor(MAX_CHARS * 0.4))
    pages.push({ ...mainResult, content: mainContent })
    totalChars += mainContent.length
    console.log(`[scraper] Main page: "${mainResult.title}" (${mainContent.length} chars)`)

    // 2. Discover subpage links from main page
    const mainLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '')
    }).catch(() => [] as string[])

    const subpageUrls = resolveSubpageUrls(websiteUrl, mainLinks)
    console.log(`[scraper] Found ${subpageUrls.length} subpages: ${subpageUrls.join(', ')}`)

    // 3. Scrape subpages
    const charsPerSubpage = Math.floor((MAX_CHARS - totalChars) / Math.max(subpageUrls.length, 1))

    for (const subUrl of subpageUrls) {
      if (totalChars >= MAX_CHARS) break
      const subResult = await extractPageContent(page, subUrl)
      if (subResult && subResult.content) {
        const trimmed = subResult.content.slice(0, charsPerSubpage)
        pages.push({ ...subResult, content: trimmed })
        totalChars += trimmed.length
        console.log(`[scraper] Subpage: ${subUrl} (${trimmed.length} chars)`)
      }
    }

    await browser.close()
    console.log(`[scraper] Done: ${pages.length} pages, ${totalChars} total chars`)
    return { success: true, pages, totalChars }
  } catch (e) {
    if (browser) await browser.close().catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[scraper] Fatal error: ${msg}`)
    return { success: false, pages, totalChars, error: msg }
  }
}

export function formatScrapedContent(result: ScrapeResult): string {
  if (!result.success || result.pages.length === 0) return ''
  return result.pages
    .map((p) => `--- ${p.title || p.url} ---\n${p.content}`)
    .join('\n\n')
}

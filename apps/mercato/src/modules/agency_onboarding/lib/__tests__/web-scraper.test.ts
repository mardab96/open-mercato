/**
 * @jest-environment node
 */

describe('web-scraper', () => {
  describe('formatScrapedContent', () => {
    let formatScrapedContent: typeof import('../web-scraper').formatScrapedContent

    beforeAll(async () => {
      const mod = await import('../web-scraper')
      formatScrapedContent = mod.formatScrapedContent
    })

    it('returns empty string for failed scrape', () => {
      const result = formatScrapedContent({
        success: false,
        pages: [],
        totalChars: 0,
        error: 'Connection refused',
      })
      expect(result).toBe('')
    })

    it('returns empty string for empty pages', () => {
      const result = formatScrapedContent({
        success: true,
        pages: [],
        totalChars: 0,
      })
      expect(result).toBe('')
    })

    it('formats single page correctly', () => {
      const result = formatScrapedContent({
        success: true,
        pages: [{ url: 'https://example.com', title: 'Example', content: 'Hello world' }],
        totalChars: 11,
      })
      expect(result).toContain('--- Example ---')
      expect(result).toContain('Hello world')
    })

    it('formats multiple pages with separators', () => {
      const result = formatScrapedContent({
        success: true,
        pages: [
          { url: 'https://example.com', title: 'Home', content: 'Main page' },
          { url: 'https://example.com/about', title: 'About', content: 'About us' },
        ],
        totalChars: 17,
      })
      expect(result).toContain('--- Home ---')
      expect(result).toContain('--- About ---')
      expect(result).toContain('Main page')
      expect(result).toContain('About us')
    })

    it('uses URL as fallback when title is empty', () => {
      const result = formatScrapedContent({
        success: true,
        pages: [{ url: 'https://example.com', title: '', content: 'Content' }],
        totalChars: 7,
      })
      expect(result).toContain('--- https://example.com ---')
    })
  })
})

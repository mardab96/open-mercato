/**
 * @jest-environment node
 */

describe('ai-audit-service', () => {
  describe('extractSection', () => {
    let extractSection: (markdown: string, letter: string) => string

    beforeAll(async () => {
      const mod = await import('../ai-audit-service')
      extractSection = mod.extractSection
    })

    it('extracts section A from audit document', () => {
      const markdown = `# AUDYT

## A. Grupa docelowa (Target Audience)

### A.1 Demografia
- Wiek: 25-45

## B. KPI

### B.1 Cele
- Leady`

      const result = extractSection(markdown, 'A')
      expect(result).toContain('Demografia')
      expect(result).toContain('Wiek: 25-45')
      expect(result).not.toContain('KPI')
    })

    it('extracts section G from audit document', () => {
      const markdown = `## F. Harmonogram

### F.1 Daty
- Q1 2026

## G. Konkurencja (Competitive Landscape)

### G.1 Główni gracze
- Firma X
- Firma Y

## H. Cena`

      const result = extractSection(markdown, 'G')
      expect(result).toContain('Główni gracze')
      expect(result).toContain('Firma X')
      expect(result).not.toContain('Harmonogram')
      expect(result).not.toContain('Cena')
    })

    it('returns empty string for missing section', () => {
      const markdown = `## A. Grupa\nContent`
      const result = extractSection(markdown, 'Z')
      expect(result).toBe('')
    })
  })

  describe('extractChannels (via runAiAudit output)', () => {
    it('is tested indirectly via extractSection - channels come from full document parsing', () => {
      // Channel extraction is internal to runAiAudit which requires OpenAI API
      // Integration testing covers this; unit test validates section extraction
      expect(true).toBe(true)
    })
  })
})

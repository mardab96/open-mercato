import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipeboardPlatform = 'meta_ads' | 'google_ads'

export type PipeboardToolInfo = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type PipeboardToolResult = {
  success: boolean
  result?: unknown
  error?: string
}

export type AccountInfo = {
  name: string
  currency: string
  id: string
  raw?: unknown
}

export type CampaignSummary = {
  id: string
  name: string
  status: string
  daily_budget?: number
  raw?: unknown
}

export type AccountMetrics = {
  spend_7d: number
  impressions_7d: number
  clicks_7d: number
  ctr_7d: number
  currency: string
}

export type VerifyResult = {
  verified: boolean
  account_info?: AccountInfo
  error?: string
}

export type PipeboardErrorCode =
  | 'CONFIG_ERROR'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_ERROR'
  | 'CONNECTION_ERROR'

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class PipeboardError extends Error {
  constructor(
    message: string,
    public readonly code: PipeboardErrorCode,
  ) {
    super(message)
    this.name = 'PipeboardError'
  }
}

// ---------------------------------------------------------------------------
// URL mapping
// ---------------------------------------------------------------------------

const PIPEBOARD_URLS: Record<PipeboardPlatform, string> = {
  meta_ads: 'https://meta-ads.mcp.pipeboard.co/',
  google_ads: 'https://google-ads.mcp.pipeboard.co/',
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type PipeboardClientConfig = {
  apiKey: string
}

export class PipeboardClient {
  private readonly apiKey: string

  constructor(config: PipeboardClientConfig) {
    this.apiKey = config.apiKey
  }

  /**
   * Run a callback with a short-lived MCP connection to Pipeboard.
   * Handles connect → callback → cleanup automatically.
   */
  async withClient<T>(
    platform: PipeboardPlatform,
    fn: (session: PipeboardSession) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T> {
    if (!this.apiKey) {
      throw new PipeboardError('PIPEBOARD_API_KEY not configured', 'CONFIG_ERROR')
    }

    const url = new URL(PIPEBOARD_URLS[platform])
    url.searchParams.set('token', this.apiKey)

    const timeoutMs = options?.timeout ?? 30_000

    const transport = new StreamableHTTPClientTransport(url)
    const client = new Client(
      { name: 'agency-intelligence-pipeboard', version: '0.1.0' },
      { capabilities: {} },
    )

    const connectWithTimeout = async (): Promise<void> => {
      const connectPromise = client.connect(transport)
      const timer = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new PipeboardError(`Connection to ${platform} timed out after ${timeoutMs}ms`, 'TIMEOUT')),
          timeoutMs,
        ),
      )
      await Promise.race([connectPromise, timer])
    }

    try {
      await connectWithTimeout()
    } catch (err) {
      if (err instanceof PipeboardError) throw err
      throw new PipeboardError(
        `Failed to connect to Pipeboard ${platform}: ${err instanceof Error ? err.message : String(err)}`,
        'CONNECTION_ERROR',
      )
    }

    const session = new PipeboardSession(client, platform)

    try {
      return await fn(session)
    } finally {
      try { await client.close() } catch { /* ignore */ }
      try { await transport.close() } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Session — active connection to a Pipeboard platform
// ---------------------------------------------------------------------------

export class PipeboardSession {
  private toolsCache: PipeboardToolInfo[] | null = null

  constructor(
    private readonly client: Client,
    private readonly platform: PipeboardPlatform,
  ) {}

  /**
   * Discover available tools. Results are cached for the session lifetime.
   */
  async listTools(): Promise<PipeboardToolInfo[]> {
    if (this.toolsCache) return this.toolsCache

    const response = await this.client.listTools()
    this.toolsCache = response.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }))

    console.log(
      `[Pipeboard/${this.platform}] Discovered ${this.toolsCache.length} tools:`,
      this.toolsCache.map((t) => t.name),
    )

    // Log schemas of key tools for debugging parameter names
    for (const key of ['get_account_info', 'get_campaigns', 'get_insights']) {
      const tool = this.toolsCache.find((t) => t.name === key)
      if (tool) {
        console.log(`[Pipeboard/${this.platform}] ${key} schema:`, JSON.stringify(tool.inputSchema))
      }
    }

    return this.toolsCache
  }

  /**
   * Call a Pipeboard MCP tool by name.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<PipeboardToolResult> {
    try {
      const response = await this.client.callTool({ name, arguments: args })
      const content = response.content

      if (!Array.isArray(content) || content.length === 0) {
        return { success: true, result: null }
      }

      const first = content[0]
      if (first.type === 'text') {
        try {
          const parsed = JSON.parse(first.text)
          if (response.isError || parsed.error) {
            return { success: false, error: parsed.error ?? 'Unknown error' }
          }
          return { success: true, result: parsed }
        } catch {
          // Non-JSON text — long strings are typically Pipeboard error messages
          if (typeof first.text === 'string' && first.text.length > 50) {
            return { success: false, error: first.text.split('\n')[0] }
          }
          return { success: true, result: first.text }
        }
      }

      return { success: true, result: content }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  }

  /**
   * Find a tool by partial name match.
   */
  async findTool(pattern: string): Promise<PipeboardToolInfo | null> {
    const tools = await this.listTools()
    const lower = pattern.toLowerCase()
    return tools.find((t) => t.name.toLowerCase().includes(lower)) ?? null
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalize Meta Ads account ID — auto-prefix with act_ if missing.
   */
  private normalizeAccountId(accountId: string): string {
    if (this.platform === 'meta_ads' && !accountId.startsWith('act_')) {
      return `act_${accountId}`
    }
    return accountId
  }

  // ---------------------------------------------------------------------------
  // Platform-specific tool name maps
  // ---------------------------------------------------------------------------

  private static readonly TOOL_NAMES: Record<PipeboardPlatform, {
    accountInfo: string
    campaigns: string
    insights: string
  }> = {
    meta_ads: {
      accountInfo: 'get_account_info',
      campaigns: 'get_campaigns',
      insights: 'get_insights',
    },
    google_ads: {
      accountInfo: 'get_account_info',
      campaigns: 'get_campaigns',
      insights: 'get_insights',
    },
  }

  /**
   * Verify an ad account exists and is accessible.
   */
  async verifyAccount(accountId: string): Promise<VerifyResult> {
    await this.listTools() // ensure discovery + logging

    const normalizedId = this.normalizeAccountId(accountId)
    const toolName = PipeboardSession.TOOL_NAMES[this.platform].accountInfo
    const result = await this.callTool(toolName, { account_id: normalizedId })

    console.log(`[Pipeboard/${this.platform}] verifyAccount raw response:`, JSON.stringify(result).slice(0, 1000))

    if (!result.success) {
      return { verified: false, error: result.error ?? 'Verification failed' }
    }

    const data = result.result as Record<string, unknown> | null
    return {
      verified: true,
      account_info: {
        name: String(data?.name ?? data?.account_name ?? data?.descriptive_name ?? accountId),
        currency: String(data?.currency ?? data?.currency_code ?? data?.account_currency ?? 'USD'),
        id: accountId,
        raw: data,
      },
    }
  }

  /**
   * List campaigns for an account (max 50).
   */
  async listCampaigns(accountId: string): Promise<CampaignSummary[]> {
    await this.listTools()

    const normalizedId = this.normalizeAccountId(accountId)
    const toolName = PipeboardSession.TOOL_NAMES[this.platform].campaigns
    const result = await this.callTool(toolName, { account_id: normalizedId })

    console.log(`[Pipeboard/${this.platform}] listCampaigns raw response:`, JSON.stringify(result).slice(0, 2000))

    if (!result.success) {
      console.warn(`[Pipeboard/${this.platform}] Campaign listing failed:`, result.error)
      return []
    }

    const data = result.result
    // Meta Ads returns { data: [...] } or array directly
    const campaigns = Array.isArray(data)
      ? data
      : (data as any)?.data ?? (data as any)?.campaigns ?? (data as any)?.results ?? []

    if (!Array.isArray(campaigns)) {
      console.warn(`[Pipeboard/${this.platform}] Unexpected campaigns format:`, typeof campaigns)
      return []
    }

    return campaigns.slice(0, 50).map((c: any) => ({
      id: String(c.id ?? c.campaign_id ?? ''),
      name: String(c.name ?? c.campaign_name ?? 'Unknown'),
      status: String(c.status ?? c.effective_status ?? 'UNKNOWN'),
      daily_budget: c.daily_budget != null ? Number(c.daily_budget) : undefined,
      raw: c,
    }))
  }

  /**
   * Get basic account metrics (last 7 days).
   */
  async getAccountMetrics(accountId: string): Promise<AccountMetrics | null> {
    await this.listTools()

    const normalizedId = this.normalizeAccountId(accountId)
    const toolName = PipeboardSession.TOOL_NAMES[this.platform].insights
    const result = await this.callTool(toolName, {
      object_id: normalizedId,
      time_range: 'last_7d',
      level: 'account',
    })

    console.log(`[Pipeboard/${this.platform}] getAccountMetrics raw response:`, JSON.stringify(result).slice(0, 2000))

    if (!result.success) {
      console.warn(`[Pipeboard/${this.platform}] Metrics fetch failed:`, result.error)
      return null
    }

    // Meta Ads insights returns { data: [{ spend, impressions, clicks, ... }] } or flat object
    const raw = result.result as any
    const row = Array.isArray(raw?.data) ? raw.data[0] : (Array.isArray(raw) ? raw[0] : raw)
    if (!row) return null

    const spend = Number(row.spend ?? 0)
    const impressions = Number(row.impressions ?? 0)
    const clicks = Number(row.clicks ?? 0)
    const ctr = row.ctr != null ? Number(row.ctr) : (impressions > 0 ? (clicks / impressions) * 100 : 0)

    return {
      spend_7d: Math.round(spend * 100) / 100,
      impressions_7d: impressions,
      clicks_7d: clicks,
      ctr_7d: Math.round(ctr * 100) / 100,
      currency: String(raw.currency ?? row.currency ?? row.account_currency ?? 'USD'),
    }
  }
}

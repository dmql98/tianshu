/**
 * Provider 一键授权获取 API Key（OAuth Authorization Code + PKCE）。
 *
 * 服务商在 provider.json 中声明 `oauth` 描述符后，前端渲染「一键获取」按钮；
 * 本服务负责整个密钥铸造流程：
 *  - 服务端生成随机 PKCE verifier，只把 SHA-256 challenge 发给授权页；
 *  - 用户浏览器在 TokenDance 授权页确认后，通过 callback 或手动粘贴带回一次性 code；
 *  - 服务端用 verifier 兑换新铸造的 API Key，直接写入 providerStore；
 *    完整 Key 只经过服务端，不落入浏览器、日志或 URL。
 *
 * Flow 为内存态：32 字节随机 id 绑定 provider 与 verifier，10 分钟 TTL，一次性。
 * 重启后待定流程丢弃，代价只是重新授权一次（上游 code 本就几分钟过期）。
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getPreset } from '../provider-catalog/loader.js'
import { providerStore } from '../db/providerStore.js'

/** 授权码回到本服务的两种方式。 */
export type ProviderOAuthMode = 'callback' | 'manual'

/** Flow 终态。 */
export type ProviderOAuthStatus = 'pending' | 'done' | 'error'

/** 上游 code 10 分钟有效，flow 生命周期对齐该窗口。 */
export const FLOW_TTL_MS = 10 * 60 * 1000

/** 同一 provider 的并发待定 flow 上限，超出时淘汰最旧。 */
const MAX_FLOWS_PER_PROVIDER = 8

export type ProviderOAuthErrorCode =
  | 'invalid_request'
  | 'code_rejected'
  | 'upstream_failed'
  | 'unreachable'
  | 'apply_failed'

interface Flow {
  flowId: string
  provider: string
  mode: ProviderOAuthMode
  exchangeUrl: string
  /** PKCE verifier；flow 被消费的瞬间清空。 */
  verifier: string | null
  /** callback 存入的授权码，等待下一次 poll 兑换。 */
  code: string | null
  createdAt: number
  expiresAt: number
  status: ProviderOAuthStatus
  errorCode?: ProviderOAuthErrorCode
}

/**
 * PKCE verifier：两个随机 UUID 拼接（72 字符，`[0-9a-f-]`），
 * 落在规范要求的 43–128 长度与 `[A-Za-z0-9-._~]` 字符集内。
 */
export function createVerifier(): string {
  return `${randomUUID()}${randomUUID()}`
}

/** PKCE S256 challenge：verifier 的 SHA-256 的 base64url（去填充）。 */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url')
}

/**
 * 构造授权页 URL。
 * callback 模式带 callback_url（授权页重定向回本服务）；manual 模式省略，
 * 授权页改为展示一次性 code。S256 两种模式都必须带：Headless 模式强制要求，
 * callback 模式带上可防 code 被截获后直接兑换。
 * app_url 与 key_name 取自 catalog 的 oauth 描述符，不由客户端提供。
 */
export function buildAuthorizeUrl(input: {
  oauth: { authorizeUrl: string; keyName: string; appUrl: string }
  challenge: string
  callbackUrl?: string
}): string {
  const params = new URLSearchParams()
  if (input.callbackUrl !== undefined) params.set('callback_url', input.callbackUrl)
  params.set('code_challenge', input.challenge)
  params.set('code_challenge_method', 'S256')
  params.set('app_url', input.oauth.appUrl)
  params.set('key_name', input.oauth.keyName)
  return `${input.oauth.authorizeUrl}?${params.toString()}`
}

export type ExchangeResult = { ok: true; key: string } | { ok: false; error: ProviderOAuthErrorCode }

/**
 * 用授权码兑换新铸造的 Key。
 * 上游响应：400 = 请求畸形（callback/PKCE 不完整）；403 = code 无效/过期/已用/verifier 不匹配。
 * 完整 Key 只在成功响应中出现一次，调用方必须立即持久化。
 */
export async function exchangeCode(input: {
  exchangeUrl: string
  code: string
  verifier: string
  fetchImpl: typeof fetch
}): Promise<ExchangeResult> {
  let res: Response
  try {
    res = await input.fetchImpl(input.exchangeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: input.code,
        code_verifier: input.verifier,
        code_challenge_method: 'S256',
      }),
    })
  } catch {
    // 不带 fetch 错误信息：它可能引用请求体（含 code 与 verifier）。
    return { ok: false, error: 'unreachable' }
  }
  if (!res.ok) {
    if (res.status === 400) return { ok: false, error: 'invalid_request' }
    if (res.status === 403) return { ok: false, error: 'code_rejected' }
    return { ok: false, error: 'upstream_failed' }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: 'upstream_failed' }
  }
  const key = (body as { key?: unknown } | null)?.key
  if (typeof key !== 'string' || key === '') return { ok: false, error: 'upstream_failed' }
  return { ok: true, key }
}

export interface ProviderOAuthDeps {
  /** 把兑换出的 Key 写入服务商记录；返回写入的模型/记录数。 */
  applyKey: (provider: string, apiKey: string) => Promise<number>
  fetchImpl?: typeof fetch
  now?: () => number
}

export class ProviderOAuthService {
  private readonly flows = new Map<string, Flow>()
  private readonly applyKey: ProviderOAuthDeps['applyKey']
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number

  constructor(deps: ProviderOAuthDeps) {
    this.applyKey = deps.applyKey
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args))
    this.now = deps.now ?? (() => Date.now())
  }

  /**
   * 为一个 provider 开流并返回授权页地址。
   * provider 的 oauth 描述符只来自内置 catalog（getPreset），客户端无法自选授权/兑换端点。
   */
  start(input: {
    provider: string
    mode: ProviderOAuthMode
    /** callback 模式下授权页应把浏览器送回的本服务 origin。 */
    callbackOrigin: string
  }): { flowId: string; authorizeUrl: string } {
    const preset = getPreset(input.provider)
    const oauth = preset?.oauth
    if (!preset || oauth === undefined) {
      throw new Error(`Provider ${input.provider} does not support authorizing a new API key.`)
    }
    this.sweep()
    this.evictOldest(input.provider)

    const flowId = randomBytes(32).toString('base64url')
    const verifier = createVerifier()
    const createdAt = this.now()
    const callbackUrl =
      input.mode === 'callback'
        ? `${input.callbackOrigin}/api/provider-oauth/callback?flow=${encodeURIComponent(flowId)}`
        : undefined
    this.flows.set(flowId, {
      flowId,
      provider: input.provider,
      mode: input.mode,
      exchangeUrl: oauth.exchangeUrl,
      verifier,
      code: null,
      createdAt,
      expiresAt: createdAt + FLOW_TTL_MS,
      status: 'pending',
    })
    return {
      flowId,
      authorizeUrl: buildAuthorizeUrl({
        oauth,
        challenge: codeChallenge(verifier),
        ...(callbackUrl !== undefined ? { callbackUrl } : {}),
      }),
    }
  }

  /**
   * 记录 callback 重定向带回的授权码。只存不换：兑换发生在 owner 的 poll 里，
   * 因此本方法没有任何写入凭据的权限。拒绝 manual 流（没有可接收的 redirect）、
   * 未知/过期流（404）与已被消费的流（409）。
   */
  deposit(input: { flowId: string; code: string }): void {
    const flow = this.require(input.flowId)
    if (flow.mode !== 'callback') {
      throw new Error('This authorization has expired or does not exist. Start a new one.')
    }
    if (flow.status !== 'pending' || flow.verifier === null || flow.code !== null) {
      throw new Error('This authorization has already been used. Start a new one.')
    }
    flow.code = input.code
  }

  /** 查询 flow 状态；若已有 code 则当场兑换并写 Key。 */
  async poll(input: { flowId: string }): Promise<{
    status: ProviderOAuthStatus
    provider: string
    error?: ProviderOAuthErrorCode
    applied?: number
  }> {
    const flow = this.require(input.flowId)
    const result = flow.code !== null ? await this.redeem(flow, flow.code) : null
    return {
      status: flow.status,
      provider: flow.provider,
      ...(flow.errorCode !== undefined ? { error: flow.errorCode } : {}),
      ...(result?.ok === true ? { applied: result.applied } : {}),
    }
  }

  /** manual 模式：用户粘贴授权码后兑换。 */
  async complete(input: { flowId: string; code: string }): Promise<{ ok: true; applied: number } | { ok: false; error: ProviderOAuthErrorCode }> {
    return this.redeem(this.require(input.flowId), input.code)
  }

  /** 一次性消费 flow：兑换 code 并把 Key 写入服务商记录。 */
  private async redeem(
    flow: Flow,
    code: string,
  ): Promise<{ ok: true; applied: number } | { ok: false; error: ProviderOAuthErrorCode }> {
    const verifier = flow.verifier
    if (flow.status !== 'pending' || verifier === null) {
      throw new Error('This authorization has already been completed. Start a new one.')
    }
    // 先标记已消费再 await：并发兑换只有一个能拿到 verifier。
    flow.verifier = null
    flow.code = null
    const result = await exchangeCode({
      exchangeUrl: flow.exchangeUrl,
      code,
      verifier,
      fetchImpl: this.fetchImpl,
    })
    if (!result.ok) {
      flow.status = 'error'
      flow.errorCode = result.error
      return { ok: false, error: result.error }
    }
    let applied: number
    try {
      applied = await this.applyKey(flow.provider, result.key)
    } catch {
      flow.status = 'error'
      flow.errorCode = 'apply_failed'
      return { ok: false, error: 'apply_failed' }
    }
    flow.status = 'done'
    return { ok: true, applied }
  }

  private require(flowId: string): Flow {
    this.sweep()
    const flow = this.flows.get(flowId)
    if (flow === undefined || flow.expiresAt <= this.now()) {
      throw new Error('This authorization has expired or does not exist. Start a new one.')
    }
    return flow
  }

  private sweep(): void {
    const now = this.now()
    for (const [id, flow] of this.flows) {
      if (flow.expiresAt <= now) this.flows.delete(id)
    }
  }

  private evictOldest(provider: string): void {
    const mine = [...this.flows.values()]
      .filter((f) => f.provider === provider)
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const flow of mine.slice(0, Math.max(0, mine.length - (MAX_FLOWS_PER_PROVIDER - 1)))) {
      this.flows.delete(flow.flowId)
    }
  }
}

/**
 * 把新铸造的 Key 写入服务商：
 * - 已添加（preset_id 命中）→ 更新 api_key（保留模型/协议等已有配置）；
 * - 未添加 → 按预设自动创建一条记录（合并预设 headers，保证 X-App-URL 归因生效）。
 */
export async function applyMintedKey(providerId: string, apiKey: string): Promise<number> {
  const preset = getPreset(providerId)
  if (!preset) throw new Error(`Preset ${providerId} not found`)
  const existing = providerStore.getByPresetId(providerId)
  if (existing) {
    providerStore.update(existing.id, { api_key: apiKey })
    return existing.models?.length ?? 0
  }
  providerStore.create({
    id: providerId,
    name: preset.name,
    base_url: preset.baseUrl,
    api_key: apiKey,
    models: [],
    preset_id: preset.id,
    runtime_plugin: preset.runtime.plugin,
    format: preset.format,
    is_builtin: true,
    headers: preset.headers,
  })
  return 0
}

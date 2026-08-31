/**
 * Provider 一键授权路由：
 *   POST /api/provider-oauth/start           开流，返回 { flowId, authorizeUrl }
 *   GET  /api/provider-oauth/callback        授权页重定向回本服务（deposit code）
 *   GET  /api/provider-oauth/:flowId         轮询状态（deposit 后在此兑换并写 Key）
 *   POST /api/provider-oauth/:flowId/code    manual 模式提交粘贴的 code
 *
 * 天枢为本地单机应用（loopback），无登录态；flow id 本身即能力凭证
 * （32 随机字节，绑定 provider 与 verifier，10 分钟有效、一次性）。
 * callback 只 deposit code，兑换与写 Key 都发生在客户端的 poll/complete 调用里，
 * 因此被重定向的浏览器无法单凭一个 flow id 写入任何凭据。
 */
import { Hono } from 'hono'
import { ProviderOAuthService, applyMintedKey } from '../services/provider-oauth.js'

const FLOW_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const CODE_RE = /^[A-Za-z0-9._~-]{1,512}$/

function resultPage(title: string, body: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f9fafb; color: #111827;
}
main { max-width: 30rem; padding: 2rem; text-align: center; }
h1 { margin: 0 0 0.5rem; font-size: 1.125rem; font-weight: 600; }
p { margin: 0; color: #4b5563; }
@media (prefers-color-scheme: dark) {
  body { background: #0d0d0d; color: #f3f4f6; }
  p { color: #9ca3af; }
}
</style>
</head>
<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p></main></body>
</html>`
}

export function providerOAuthRoutes(service: ProviderOAuthService): Hono {
  const app = new Hono()

  app.post('/start', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const provider = (body as { provider?: unknown })?.provider
    const modeRaw = (body as { mode?: unknown })?.mode
    if (typeof provider !== 'string' || provider.length === 0 || provider.length > 64) {
      return c.json({ error: 'provider is required' }, 400)
    }
    const mode = modeRaw === undefined ? 'callback' : modeRaw
    if (mode !== 'callback' && mode !== 'manual') {
      return c.json({ error: 'mode must be "callback" or "manual"' }, 400)
    }
    // 回调 origin 取自请求自身（loopback 动态端口无需配置）。
    const origin = new URL(c.req.url).origin
    try {
      const started = service.start({ provider, mode, callbackOrigin: origin })
      return c.json(started)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })

  // 授权页重定向落点。只 deposit code；兑换由客户端 poll 触发。
  app.get('/callback', (c) => {
    if (c.req.method === 'HEAD') return c.body(null, 405)
    const flowId = c.req.query('flow') ?? ''
    const code = c.req.query('code') ?? ''
    if (!FLOW_ID_RE.test(flowId) || !CODE_RE.test(code)) {
      return c.html(
        resultPage('授权失败', '链接不完整。请返回天枢，重新发起一次授权。'),
        400,
      )
    }
    try {
      service.deposit({ flowId, code })
    } catch {
      return c.html(
        resultPage('授权失败', '该授权已失效或不存在。请返回天枢重新发起。'),
        400,
      )
    }
    return c.html(
      resultPage('授权成功', '已收到授权，请返回天枢完成密钥写入。你可以关闭此标签页。'),
    )
  })

  app.post('/:flowId/code', async (c) => {
    const flowId = c.req.param('flowId') ?? ''
    if (!FLOW_ID_RE.test(flowId)) return c.json({ error: 'flow not found' }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const code = (body as { code?: unknown })?.code
    if (typeof code !== 'string' || !CODE_RE.test(code.trim())) {
      return c.json({ error: 'code is not a valid authorization code' }, 400)
    }
    try {
      const result = await service.complete({ flowId, code: code.trim() })
      if (!result.ok) return c.json({ ok: false, error: result.error })
      return c.json({ ok: true, applied: result.applied })
    } catch {
      return c.json({ error: 'flow not found' }, 404)
    }
  })

  app.get('/:flowId', async (c) => {
    const flowId = c.req.param('flowId') ?? ''
    if (!FLOW_ID_RE.test(flowId)) return c.json({ error: 'flow not found' }, 404)
    try {
      const state = await service.poll({ flowId })
      return c.json({
        status: state.status,
        provider: state.provider,
        ...(state.applied !== undefined ? { applied: state.applied } : {}),
        ...(state.error !== undefined ? { error: state.error } : {}),
      })
    } catch {
      return c.json({ error: 'flow not found' }, 404)
    }
  })

  return app
}

export function createProviderOAuthService(): ProviderOAuthService {
  return new ProviderOAuthService({
    applyKey: applyMintedKey,
  })
}

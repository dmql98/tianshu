import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'crypto'
import { addEventSink } from '../transport/event-sinks.js'
import { getTransportIo } from '../transport/runtime.js'
import {
  handleHello, handleStrategySet, handleChatRun, handleAbort, handleApprovalRespond,
  sinkChannel,
} from '../ws/handlers.js'

/**
 * Web transport (SSE downlink + fetch POST uplink) — the socket.io-free path
 * for browser clients. Downlink reuses the same durable run events via the
 * global event-sink fan-out; uplink dispatches to the same transport-neutral
 * handlers as socket.io and the Electron IPC bridge.
 */
const router = new Hono()

// Downlink: server-sent events stream. The browser's EventSource reconnects
// automatically; the sink is unregistered when the response aborts.
router.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const id = `sse-${randomUUID()}`
    const unsubscribe = addEventSink({
      id,
      emit: (type, payload) => {
        void stream.writeSSE({ event: type, data: JSON.stringify(payload) }).catch(() => { /* closed */ })
      },
    })
    let closed = false
    stream.onAbort(() => {
      closed = true
      unsubscribe()
    })
    try {
      await stream.writeSSE({ data: JSON.stringify({ __hello: true, ts: Date.now() }) })
    } catch { /* closed before first write */ }
    while (!closed) {
      await new Promise((r) => setTimeout(r, 1000))
    }
  })
})

// Uplink: one POST per client action; the ack is returned in the response body.
// Mounted at /api/events, so the bare path is the uplink root.
router.post('/', async (c) => {
  const body = await c.req.json().catch(() => null) as { type?: string; payload?: unknown } | null
  const type = body?.type
  const payload = (body?.payload ?? {}) as Record<string, unknown>
  if (!type) return c.json({ error: 'type is required' }, 400)
  let ackResp: unknown = { status: 'ok' }
  const channel = sinkChannel((resp) => { ackResp = resp })
  try {
    switch (type) {
      case 'hello':
        handleHello({ io: getTransportIo() }, channel, payload as { session_id?: string })
        break
      case 'strategy.set':
        handleStrategySet({ io: getTransportIo() }, channel, payload as { session_id: string; strategy: unknown })
        break
      case 'chat-run':
        await handleChatRun({ io: getTransportIo() }, channel, payload as Record<string, unknown>)
        break
      case 'abort':
        handleAbort({ io: getTransportIo() }, channel, payload as { session_id?: string })
        break
      case 'approval.respond':
        handleApprovalRespond({ io: getTransportIo() }, channel, payload as { session_id?: string; tool_call_id?: string; choice?: string })
        break
      default:
        return c.json({ error: `unknown event type: ${type}` }, 400)
    }
  } catch (err: any) {
    return c.json({ error: err?.message || String(err) }, 500)
  }
  return c.json({ ack: ackResp })
})

// Readiness ping (mirrors socket.io app:hello; keeps the uplink contract simple).
router.post('/hello', (c) => {
  return c.json({ status: 'ok', ts: Date.now() })
})

export default router

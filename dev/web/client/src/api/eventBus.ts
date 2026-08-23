/**
 * Transport-neutral event bus — the only real-time channel in the client.
 *
 * Two transports, same interface:
 *  - 'ipc' : Electron IPC bridge (window.tianshuDesktop.eventSend/eventOn).
 *            In-process channel — no heartbeat, no reconnect, no drop.
 *  - 'sse' : EventSource downlink (GET /api/events/stream) + fetch POST
 *            uplink (POST /api/events). Browser-native auto-reconnect.
 *
 * The bus mirrors the surface the store relies on:
 *   on(type, cb)          — subscribe
 *   off(type)             — remove ALL listeners of a type (persistent reset)
 *   off(type, cb)         — remove one listener (temporary cleanup)
 *   emit(type, payload?, ack?) — uplink, optional ack
 *   connected / onConnect / onDisconnect — transport lifecycle
 */

export type EventBusTransport = 'ipc' | 'sse'

export interface EventBus {
  readonly transport: EventBusTransport
  readonly connected: boolean
  on(type: string, cb: (data: any) => void): void
  off(type: string, cb?: (data: any) => void): void
  emit(type: string, payload?: unknown, ack?: (resp: unknown) => void): void
  onConnect(cb: () => void): () => void
  onDisconnect(cb: (reason?: string) => void): () => void
}

type ListenerMap = Map<string, Set<(data: any) => void>>

function addListener(map: ListenerMap, type: string, cb: (data: any) => void): void {
  let set = map.get(type)
  if (!set) { set = new Set(); map.set(type, set) }
  set.add(cb)
}

function removeListener(map: ListenerMap, type: string, cb?: (data: any) => void): void {
  if (cb) {
    map.get(type)?.delete(cb)
    return
  }
  map.delete(type)
}

function dispatch(map: ListenerMap, type: string, data: any): void {
  const set = map.get(type)
  if (!set) return
  for (const cb of [...set]) {
    try { cb(data) } catch (err) { console.error(`[eventBus] listener error for ${type}:`, err) }
  }
}

// window.tianshuDesktop is typed in src/types/electron.d.ts (TianShuDesktopAPI).

function persistedSessionId(): string | undefined {
  try {
    const raw = localStorage.getItem('tianshu-chat-defaults')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.activeSessionId === 'string') return parsed.activeSessionId
    }
  } catch { /* ignore */ }
  return undefined
}

/** Pick the transport for this environment: desktop bridge wins, else SSE. */
export function detectTransport(): EventBusTransport {
  if (typeof window !== 'undefined' && window.tianshuDesktop?.eventSend) return 'ipc'
  return 'sse'
}

// ── SSE bus (web) ──

const SSE_HELLO_INTERVAL_MS = 25_000

export function createSSEBus(baseUrl = ''): EventBus {
  const listeners: ListenerMap = new Map()
  const connectCbs = new Set<() => void>()
  const disconnectCbs = new Set<(reason?: string) => void>()
  let es: EventSource | null = null
  let connected = false

  function open(): void {
    if (es) return
    const source = new EventSource(`${baseUrl}/api/events/stream`)
    es = source
    source.onopen = () => {
      connected = true
      for (const cb of [...connectCbs]) { try { cb() } catch { /* ignore */ } }
    }
    source.onerror = () => {
      if (connected) {
        connected = false
        for (const cb of [...disconnectCbs]) { try { cb('sse-error') } catch { /* ignore */ } }
      }
      // EventSource reconnects automatically; listeners attached below persist
      // across reconnects (the browser reuses the EventSource instance).
    }
    for (const type of ALL_KNOWN_EVENTS) {
      source.addEventListener(type, (ev: MessageEvent) => {
        let data: any = ev.data
        try { data = JSON.parse(String(ev.data)) } catch { /* keep raw */ }
        dispatch(listeners, type, data)
      })
    }
    source.onmessage = (ev: MessageEvent) => {
      let data: any = ev.data
      try { data = JSON.parse(String(ev.data)) } catch { /* keep raw */ }
      if (data && typeof data === 'object' && typeof (data as any).type === 'string') {
        dispatch(listeners, (data as any).type, data)
      }
    }
  }

  open()
  const helloTimer = setInterval(() => {
    if (!es || es.readyState !== EventSource.OPEN) return
    void fetch(`${baseUrl}/api/events/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: persistedSessionId() }),
    }).catch(() => { /* offline */ })
  }, SSE_HELLO_INTERVAL_MS)

  return {
    transport: 'sse',
    get connected() { return connected },
    on: (type, cb) => addListener(listeners, type, cb),
    off: (type, cb) => removeListener(listeners, type, cb),
    emit: (type, payload, ack) => {
      void fetch(`${baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`uplink ${type} ${res.status}`)
          const body = (await res.json()) as { ack?: unknown }
          ack?.(body?.ack)
        })
        .catch((err) => {
          console.error(`[eventBus] uplink ${type} failed:`, err)
          ack?.({ error: String(err?.message || err) })
        })
    },
    onConnect: (cb) => { connectCbs.add(cb); if (connected) cb(); return () => connectCbs.delete(cb) },
    onDisconnect: (cb) => { disconnectCbs.add(cb); return () => disconnectCbs.delete(cb) },
  }
}

// ── IPC bus (desktop) ──

function createIpcBus(): EventBus {
  const listeners: ListenerMap = new Map()
  const connectCbs = new Set<() => void>()
  const disconnectCbs = new Set<(reason?: string) => void>()
  const bridge = typeof window !== 'undefined' ? window.tianshuDesktop : undefined

  if (!bridge?.eventSend || !bridge?.eventOn) {
    // No bridge (e.g. web build opened inside Electron without the preload):
    // fall back to SSE so the renderer still works.
    return createSSEBus()
  }

  const unsubscribe = bridge.eventOn((data) => {
    if (!data || typeof data !== 'object') return
    const { eventType, payload } = data as { eventType: string; payload: unknown }
    if (eventType) dispatch(listeners, eventType, payload)
  })

  // IPC is in-process: connected as soon as the bridge exists.
  const connected = true
  queueMicrotask(() => {
    for (const cb of [...connectCbs]) { try { cb() } catch { /* ignore */ } }
  })

  return {
    transport: 'ipc',
    get connected() { return connected },
    on: (type, cb) => addListener(listeners, type, cb),
    off: (type, cb) => removeListener(listeners, type, cb),
    emit: (type, payload, ack) => {
      // ack is routed by the preload bridge ('tianshu:event-ack' echo).
      bridge.eventSend!(type, payload, ack)
    },
    onConnect: (cb) => { connectCbs.add(cb); return () => connectCbs.delete(cb) },
    onDisconnect: (cb) => { disconnectCbs.add(cb); return () => disconnectCbs.delete(cb) },
  }
}

// ── singleton ──

let bus: EventBus | null = null
let busTransport: EventBusTransport | null = null

export function getEventBus(force?: EventBusTransport): EventBus {
  const transport = force || detectTransport()
  if (bus && busTransport === transport) return bus
  bus = transport === 'ipc' ? createIpcBus() : createSSEBus()
  busTransport = transport
  return bus
}

/** Known server event names for SSE named-event binding. */
export const ALL_KNOWN_EVENTS = [
  'run.queued', 'run.started', 'run.retrying', 'run.completed', 'run.failed',
  'run.cancelled', 'run.interrupted', 'run.max_turns', 'run.budget_exhausted',
  'run.limit_warning', 'run.grace_started', 'run.continuation_queued', 'run.compacted',
  'message.delta', 'message.metrics', 'message.created', 'tool.started', 'tool.completed', 'tool.output',
  'approval.requested', 'ask_user', 'usage', 'strategy.updated', 'sub_agent.started',
  'session:new', 'event:status_changed', 'evolution:insight_created', 'workspace.updated',
  'plan.created', 'plan.step.updated', 'goal.created', 'goal.status.changed', 'goal.paused',
] as const

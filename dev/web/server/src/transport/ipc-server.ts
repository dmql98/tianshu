/**
 * Electron IPC transport (server child side).
 *
 * The server child emits run events as an EventSink (process.send to the
 * Electron main process, which forwards to the renderer), and receives uplink
 * actions ('chat-run' / 'abort' / 'approval.respond' / 'strategy.set' /
 * 'hello') from the renderer via the same channel, dispatched to the
 * transport-neutral handlers in ws/handlers.ts.
 *
 * In-process channel: no heartbeat, no reconnect, no disconnects.
 */
import {
  handleHello, handleStrategySet, handleChatRun, handleAbort, handleApprovalRespond,
  sinkChannel,
} from '../ws/handlers.js'
import { addEventSink } from './event-sinks.js'
import { getTransportBroadcaster } from './runtime.js'

const IPC_SINK_ID = 'desktop-ipc'

function sendToParent(payload: unknown): void {
  if (typeof process.send === 'function') {
    try {
      process.send(payload)
    } catch { /* parent may be closing */ }
  }
}

/** Register the IPC downlink sink + uplink message handler. Call once at boot. */
export function registerIpcTransport(): void {
  addEventSink({
    id: IPC_SINK_ID,
    emit: (type, payload) => {
      sendToParent({ type: 'tianshu:event', eventType: type, payload })
    },
  })

  process.on('message', (msg: unknown) => {
    const m = msg as { type?: string } | null
    if (m?.type !== 'tianshu:event') return
    const { reqId, eventType, payload } = m as { reqId?: number; eventType: string; payload: Record<string, unknown> }
    const ack = (resp: unknown) => {
      sendToParent({ type: 'tianshu:event', reqId, eventType: 'ack', payload: resp })
    }
    const channel = sinkChannel(ack)
    switch (eventType) {
      case 'hello':
        handleHello({ broadcaster: getTransportBroadcaster() }, channel, payload as { session_id?: string } | null)
        break
      case 'strategy.set':
        handleStrategySet({ broadcaster: getTransportBroadcaster() }, channel, payload as { session_id: string; strategy: unknown })
        break
      case 'chat-run':
        void handleChatRun({ broadcaster: getTransportBroadcaster() }, channel, payload as Record<string, unknown>)
        break
      case 'abort':
        handleAbort({ broadcaster: getTransportBroadcaster() }, channel, payload as { session_id?: string })
        break
      case 'approval.respond':
        handleApprovalRespond({ broadcaster: getTransportBroadcaster() }, channel, payload as { session_id?: string; tool_call_id?: string; choice?: string })
        break
      default:
        ack({ error: `unknown event type: ${eventType}` })
    }
  })
}

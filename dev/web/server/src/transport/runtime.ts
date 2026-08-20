/**
 * Shared transport runtime: the minimal broadcaster the run path needs.
 *
 * run 路径只需要一个"能 emit 事件的通道"，不绑定具体传输。这个 broadcaster
 * 把 emit 直接转成全局 sink fan-out（SSE 连接与 Electron IPC 是两个已注册的 sink）。
 */
import { fanOutToSinks } from './event-sinks.js'

/** Minimal emit-capable target — the only stream surface the run path uses. */
export interface TransportBroadcaster {
  emit(type: string, payload?: any, ...rest: any[]): unknown
}

let broadcasterRef: TransportBroadcaster | null = null

/** The default broadcaster: every emit fans out to registered sinks. */
export function createBroadcaster(): TransportBroadcaster {
  return {
    emit: (type, payload, ...rest) => {
      if (payload && typeof payload === 'object') {
        fanOutToSinks(type, payload as Record<string, unknown>)
      } else {
        fanOutToSinks(type, { args: [payload, ...rest] })
      }
      return true
    },
  }
}

export function setTransportBroadcaster(broadcaster: TransportBroadcaster): void {
  broadcasterRef = broadcaster
}

export function getTransportBroadcaster(): TransportBroadcaster {
  if (!broadcasterRef) throw new Error('Transport runtime not ready: setTransportBroadcaster() not called')
  return broadcasterRef
}

export function hasTransportBroadcaster(): boolean {
  return broadcasterRef !== null
}

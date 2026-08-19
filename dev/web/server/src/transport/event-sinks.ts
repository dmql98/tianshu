/**
 * Transport-neutral event sinks for run-event fan-out.
 *
 * socket.io 时代：publishRunEvent 只把事件发到发起 run 时捕获的那个 socket。
 * 双通道时代：除 socket.io（可选保留）外，还可能有多个接收者——
 *   - 桌面端：Electron 主进程 IPC（子进程 process.send → 主进程 → 渲染进程）
 *   - Web 端：SSE 长连接（每个 EventSource 响应一个 sink，收到全部事件，
 *     由客户端按 session_id 过滤——chatStore 的处理器本来就按 session_id 分派）
 *
 * sink 注册是全局的（payload 自带 session_id），与既有 `target` socket 发射
 * 并行；sink 抛错绝不影响 run 循环。
 */

export interface EventSink {
  readonly id: string
  emit(type: string, payload: Record<string, unknown>): void
}

const sinks = new Map<string, EventSink>()

/** Register a global sink; returns an unsubscribe function. */
export function addEventSink(sink: EventSink): () => void {
  sinks.set(sink.id, sink)
  return () => {
    sinks.delete(sink.id)
  }
}

export function listEventSinks(): EventSink[] {
  return [...sinks.values()]
}

export function clearEventSinks(): void {
  sinks.clear()
}

/** Fan an emitted event out to every registered sink. Errors are contained. */
export function fanOutToSinks(type: string, payload: Record<string, unknown>): void {
  if (sinks.size === 0) return
  for (const sink of sinks.values()) {
    try {
      sink.emit(type, payload)
    } catch (err) {
      console.error(`[transport] sink ${sink.id} failed for ${type}:`, err)
    }
  }
}

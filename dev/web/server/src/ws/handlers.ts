/**
 * Transport-neutral uplink handlers.
 *
 * The same logic serves the two transports:
 *   - SSE        : POST /api/events dispatches to these handlers (sink channel)
 *   - Electron   : IPC bridge dispatches to the same handlers (sink channel)
 *
 * Delivery model (single delivery per transport): the run's durable stream is
 * a NOOP shim (publishRunEvent emits to it AND fans out to registered sinks —
 * the shim swallows the direct emit, the sink fan-out is the real delivery);
 * `channel.emit` = fanOutToSinks for non-durable one-off events.
 */
import type { TransportBroadcaster } from '../transport/runtime.js'
import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { turnStore } from '../db/turnStore.js'
import { runStore } from '../agent/runtime/run-store.js'
import { sessionLoop } from '../agent/loop.js'
import { setSessionStrategy } from '../agent/session.js'
import { enqueueRun, abortSession } from '../agent/session-runner.js'
import { approvalRegistry, type ApprovalChoice } from '../agent/runtime/approval-registry.js'
import { checkpointStore } from '../agent/runtime/checkpoint-store.js'
import { createDurableStream, publishRunEvent, forceCancelSessionRuns } from '../agent/runtime/run-event-store.js'
import { fanOutToSinks } from '../transport/event-sinks.js'
import { saveAttachment, type AttachmentMeta } from '../agent/media-store.js'
import { isStrategyInput, normalizeStrategy, type StrategyInput } from '../agent/strategy.js'
import type { Strategy } from '../agent/session.js'

export interface UplinkChannel {
  /** stream-like object for createDurableStream / publishRunEvent (NOOP shim:
   *  durable events reach clients via the sink fan-out). */
  stream: { emit: (type: string, payload?: any, ...rest: any[]) => unknown }
  /** Deliver a one-off (non-durable) event to this client. */
  emit(type: string, payload: Record<string, unknown>): void
  ack(resp: unknown): void
}

const NOOP_STREAM: { emit: (type: string, payload?: any, ...rest: any[]) => unknown } = { emit: () => undefined }

/** Sink-backed channel (NOOP stream; delivery via fanOutToSinks). */
export function sinkChannel(ack?: (resp: unknown) => void): UplinkChannel {
  return {
    stream: NOOP_STREAM,
    emit: (type, payload) => fanOutToSinks(type, payload),
    ack: (resp) => ack?.(resp),
  }
}

export interface HandlerContext {
  broadcaster: TransportBroadcaster
}

export function handleHello(ctx: HandlerContext, channel: UplinkChannel, data: { session_id?: string } | null): void {
  channel.ack({ status: 'ok', ts: Date.now() })
}

export function handleStrategySet(
  ctx: HandlerContext,
  channel: UplinkChannel,
  data: { session_id: string; strategy: unknown },
): void {
  const { session_id } = data
  if (!session_id) { channel.ack({ error: 'No session_id' }); return }
  if (!isStrategyInput(data.strategy)) { channel.ack({ error: 'Invalid strategy' }); return }
  const strategy: Strategy = normalizeStrategy(data.strategy)
  setSessionStrategy(session_id, strategy, 'user')
  sessionStore.update(session_id, { current_strategy: strategy })
  console.log(`[strategy.set] session=${session_id} strategy=${strategy}`)
  channel.emit('strategy.updated', { session_id, strategy })
  channel.ack({ status: 'ok' })
}

export async function handleChatRun(
  ctx: HandlerContext,
  channel: UplinkChannel,
  data: Record<string, unknown>,
): Promise<void> {
  const { broadcaster } = ctx
  const sessionId = data.session_id as string
  if (!sessionId) { channel.ack({ error: 'No session_id' }); return }
  const requestedRunId = typeof data.run_id === 'string' ? data.run_id.trim() : ''
  const runId = requestedRunId || `run_${crypto.randomUUID()}`

  let session = sessionStore.getById(sessionId)
  if (!session) {
    const workspacesArr = data.workspaces as string[] | undefined
    session = sessionStore.create({
      id: sessionId,
      character_id: (data.character_id as string) || 'general',
      title: (data.title as string) || '',
      model: (data.model as string) || undefined,
      provider_id: (data.provider_id as string) || undefined,
      workspace: (data.workspace as string) || undefined,
      workspaces: workspacesArr ? JSON.stringify(workspacesArr) : undefined,
      active_group: (data.active_group as string) || undefined,
      session_type: (data.session_type as 'chat' | 'event') || undefined,
      event_id: (data.event_id as string) || undefined,
    })
  } else {
    const patch: Record<string, unknown> = {}
    if (data.provider_id) patch.provider_id = data.provider_id
    if (data.model) patch.model = data.model
    if (data.workspace) patch.workspace = data.workspace
    if (data.workspaces) patch.workspaces = JSON.stringify(data.workspaces)
    if (data.character_id) patch.character_id = data.character_id
    if (data.active_group) patch.active_group = data.active_group
    if (data.event_id) patch.event_id = data.event_id
    if (Object.keys(patch).length > 0) sessionStore.update(sessionId, patch)
  }

  const input = (data.input as string) || ''
  let attachmentsJson: string | null = null
  const rawAttachments = data.attachments as
    | Array<{ name?: string; filename?: string; mime?: string; mediaType?: string; data?: string }>
    | undefined
  if (Array.isArray(rawAttachments) && rawAttachments.length > 0) {
    const metas: AttachmentMeta[] = []
    for (const a of rawAttachments) {
      if (!a.data) continue
      const meta = saveAttachment(sessionId, {
        filename: a.filename || a.name || 'attachment',
        mediaType: a.mediaType || a.mime || 'application/octet-stream',
        data: a.data,
      })
      metas.push(meta)
    }
    if (metas.length > 0) attachmentsJson = JSON.stringify(metas)
  }
  if (runStore.get(runId)) {
    channel.ack({ error: 'Run id already exists', run_id: runId })
    return
  }
  const turn = turnStore.create(sessionId, 'user')
  const userMessage = input.trim() || attachmentsJson
    ? messageStore.addMessage(sessionId, {
        role: 'user',
        content: input,
        attachments: attachmentsJson,
        turn_id: turn.id,
        run_id: runId,
        supersedes_message_id: typeof data.supersedes_message_id === 'number'
          ? data.supersedes_message_id
          : null,
      })
    : null
  if (userMessage) turnStore.attachUserMessage(turn.id, userMessage.id)

  let run
  try {
    run = runStore.create(session, {
      id: runId,
      turnId: turn.id,
      source: session.session_type === 'event' ? 'event' : 'chat',
    })
  } catch (error: any) {
    channel.ack({ error: error.message || String(error), run_id: runId })
    return
  }
  publishRunEvent(channel.stream , runId, 'run.queued', {
    session_id: sessionId,
    run_id: runId,
    character_id: run.character_id,
    character_revision_id: run.character_revision_id,
  })
  const durableStream = createDurableStream(channel.stream , runId)
  const enqueueResult = enqueueRun(sessionId, runId, async (signal) => {
    try {
      await sessionLoop(broadcaster, durableStream, sessionId, signal, {
        thinking: !!data.thinking || !!data.reasoning_effort,
        reasoning_effort: data.reasoning_effort as string | undefined,
        run_id: runId,
      })
    } catch (error: any) {
      publishRunEvent(channel.stream , runId, 'run.failed', {
        session_id: sessionId,
        run_id: runId,
        error: error.message || String(error),
      })
    }
  }, () => {
    publishRunEvent(channel.stream , runId, 'run.cancelled', {
      session_id: sessionId,
      run_id: runId,
      status: 'cancelled',
      reason: 'queue_cleared',
    })
  })

  channel.ack({
    run_id: runId,
    status: enqueueResult.queued ? 'queued' : 'started',
    queue_length: enqueueResult.queueLength,
    user_message_id: userMessage?.id,
  })
}

export function handleAbort(
  ctx: HandlerContext,
  channel: UplinkChannel,
  data: { session_id?: string },
): void {
  if (!data.session_id) { channel.ack({ error: 'Missing session_id' }); return }
  approvalRegistry.cancelSession(data.session_id)
  if (typeof process.send === 'function') {
    try {
      process.send({ type: 'approval-cleared', sessionId: data.session_id })
    } catch { /* desktop IPC may already be closing */ }
  }
  const inMemoryAccepted = abortSession(data.session_id)
  // A stuck run (e.g. awaiting_approval with no live coordinator entry) can't be
  // aborted in-memory. Force it terminal at the DB level and broadcast the
  // terminal event so the client leaves the streaming state.
  for (const { runId, event } of forceCancelSessionRuns(data.session_id)) {
    const payload = JSON.parse(event.payload)
    channel.emit(event.type, {
      ...payload,
      event_id: event.event_id,
      session_id: data.session_id,
      run_id: runId,
      seq: event.seq,
      type: event.type,
      occurred_at: event.created_at,
    })
  }
  channel.ack({ status: inMemoryAccepted ? 'ok' : 'no_active_run' })
}

export function handleApprovalRespond(
  ctx: HandlerContext,
  channel: UplinkChannel,
  data: { session_id?: string; tool_call_id?: string; choice?: string },
): void {
  const sessionId = data.session_id
  const toolCallId = data.tool_call_id
  if (!sessionId || !toolCallId) { channel.ack({ error: 'Missing session_id or tool_call_id' }); return }
  const choice: ApprovalChoice = data.choice === 'once' || data.choice === 'always' ? data.choice : 'reject'
  const { accepted, runId } = approvalRegistry.respond(sessionId, toolCallId, choice)
  if (runId) checkpointStore.clearForRun(runId, 'approval.requested')
  if (accepted && typeof process.send === 'function') {
    try {
      process.send({ type: 'approval-cleared', sessionId, toolCallId })
    } catch { /* desktop IPC may already be closing */ }
  }
  channel.ack({ status: accepted ? 'ok' : 'no_pending' })
}


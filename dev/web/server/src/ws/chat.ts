import { Server, Socket } from 'socket.io'
import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { providerStore } from '../db/providerStore.js'
import { sessionLoop } from '../agent/loop.js'
import { setSessionStrategy, removeSessionState, getSessionState } from '../agent/session.js'
import { enqueueRun, abortSession, getRunState, getQueueLength } from '../agent/session-runner.js'
import { turnStore } from '../db/turnStore.js'
import { runStore } from '../agent/runtime/run-store.js'
import { createDurableSocket, publishRunEvent, forceCancelSessionRuns, bindLiveSocket, unbindSocketOwner } from '../agent/runtime/run-event-store.js'
import { approvalRegistry, type ApprovalChoice } from '../agent/runtime/approval-registry.js'
import { checkpointStore } from '../agent/runtime/checkpoint-store.js'
import { saveAttachment, type AttachmentMeta } from '../agent/media-store.js'
import type { Strategy } from '../agent/session.js'
import { isStrategyInput, normalizeStrategy, type StrategyInput } from '../agent/strategy.js'

export function registerChatSocket(io: Server, socket: Socket) {
  // Readiness handshake: the client waits for this ack after (re)connect
  // before replaying session/run state, so the replay never races the
  // connection-handler setup on a freshly restarted server. The ack proves
  // the socket is fully registered AND the event loop is responsive.
  socket.on('app:hello', (data: { session_id?: string } | null, ack?: (resp: unknown) => void) => {
    // Rebind run-event emission to this (possibly new) socket: a run that
    // started before the renderer disconnected keeps emitting to the old dead
    // socket otherwise, and live streaming never resumes after a reconnect.
    if (data?.session_id) {
      bindLiveSocket(data.session_id, socket)
    }
    ack?.({ status: 'ok', ts: Date.now() })
  })
  socket.on('disconnect', () => {
    // Drop live-socket bindings owned by this socket so a later reconnect with
    // a new socket re-binds cleanly (and we never emit to a dead socket).
    unbindSocketOwner(socket)
  })
  socket.on('strategy.set', (data: { session_id: string; strategy: StrategyInput }, ack?: (resp: unknown) => void) => {
    const { session_id } = data
    if (!session_id) { ack?.({ error: 'No session_id' }); return }
    if (!isStrategyInput(data.strategy)) { ack?.({ error: 'Invalid strategy' }); return }
    const strategy: Strategy = normalizeStrategy(data.strategy)
    setSessionStrategy(session_id, strategy, 'user')
    sessionStore.update(session_id, { current_strategy: strategy })
    console.log(`[strategy.set] session=${session_id} strategy=${strategy}`)
    socket.emit('strategy.updated', { session_id, strategy })
    ack?.({ status: 'ok' })
  })
  socket.on('chat-run', async (data: Record<string, unknown>, ack?: (resp: unknown) => void) => {
    const sessionId = data.session_id as string
    if (!sessionId) { ack?.({ error: 'No session_id' }); return }
    const requestedRunId = typeof data.run_id === 'string' ? data.run_id.trim() : ''
    const runId = requestedRunId || `run_${crypto.randomUUID()}`
    bindLiveSocket(sessionId, socket)

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
        dataspace: (data.dataspace as string) || undefined,
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
      if (data.dataspace) patch.dataspace = data.dataspace
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
      ack?.({ error: 'Run id already exists', run_id: runId })
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
      ack?.({ error: error.message || String(error), run_id: runId })
      return
    }
    publishRunEvent(socket, runId, 'run.queued', {
      session_id: sessionId,
      run_id: runId,
      character_id: run.character_id,
      character_revision_id: run.character_revision_id,
    })
    const durableSocket = createDurableSocket(socket, runId)
    const enqueueResult = enqueueRun(sessionId, runId, async (signal) => {
      try {
        await sessionLoop(io, durableSocket, sessionId, signal, {
          thinking: !!data.thinking,
          reasoning_effort: data.reasoning_effort as string | undefined,
          run_id: runId,
        })
      } catch (error: any) {
        publishRunEvent(socket, runId, 'run.failed', {
          session_id: sessionId,
          run_id: runId,
          error: error.message || String(error),
        })
        throw error
      }
    }, () => {
      publishRunEvent(socket, runId, 'run.cancelled', {
        session_id: sessionId,
        run_id: runId,
        status: 'cancelled',
        reason: 'queue_cleared',
      })
    })

    ack?.({
      run_id: runId,
      status: enqueueResult.queued ? 'queued' : 'started',
      queue_length: enqueueResult.queueLength,
      user_message_id: userMessage?.id,
    })
  })

  socket.on('abort', (data: { session_id?: string }, ack?: (resp: unknown) => void) => {
    if (!data.session_id) { ack?.({ error: 'Missing session_id' }); return }
    approvalRegistry.cancelSession(data.session_id)
    if (typeof process.send === 'function') {
      try {
        process.send({ type: 'approval-cleared', sessionId: data.session_id })
      } catch { /* desktop IPC may already be closing */ }
    }
    const inMemoryAccepted = abortSession(data.session_id)
    // A stuck run (e.g. awaiting_approval with no live coordinator entry)
    // can't be aborted in-memory. Force it terminal at the DB level and
    // broadcast the terminal event so the client leaves the streaming state.
    // The event is already persisted by forceCancelRun — emit straight to the
    // socket instead of re-appending (re-append would be rejected as a second
    // terminal event and never reach the client).
    for (const { runId, event } of forceCancelSessionRuns(data.session_id)) {
      const payload = JSON.parse(event.payload)
      socket.emit(event.type, {
        ...payload,
        event_id: event.event_id,
        session_id: data.session_id,
        run_id: runId,
        seq: event.seq,
        type: event.type,
        occurred_at: event.created_at,
      })
    }
    ack?.({ status: inMemoryAccepted ? 'ok' : 'no_active_run' })
  })

  // Central approval responses: route to the waiting run via the registry
  // (survives the client socket reconnecting) and clear the persisted
  // checkpoint so a fresh page can tell the approval was already answered.
  socket.on('approval.respond', (
    data: { session_id?: string; tool_call_id?: string; choice?: string },
    ack?: (resp: unknown) => void,
  ) => {
    const sessionId = data.session_id
    const toolCallId = data.tool_call_id
    if (!sessionId || !toolCallId) { ack?.({ error: 'Missing session_id or tool_call_id' }); return }
    const choice: ApprovalChoice = data.choice === 'once' || data.choice === 'always' ? data.choice : 'reject'
    const { accepted, runId } = approvalRegistry.respond(sessionId, toolCallId, choice)
    if (runId) checkpointStore.clearForRun(runId, 'approval.requested')
    if (accepted && typeof process.send === 'function') {
      try {
        process.send({ type: 'approval-cleared', sessionId, toolCallId })
      } catch { /* desktop IPC may already be closing */ }
    }
    ack?.({ status: accepted ? 'ok' : 'no_pending' })
  })
}

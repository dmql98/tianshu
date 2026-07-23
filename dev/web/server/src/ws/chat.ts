import { Server, Socket } from 'socket.io'
import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { providerStore } from '../db/providerStore.js'
import { sessionLoop } from '../agent/loop.js'
import { setSessionStrategy, removeSessionState, getSessionState } from '../agent/session.js'
import { enqueueRun, abortSession, getRunState, getQueueLength } from '../agent/session-runner.js'
import { saveAttachment, type AttachmentMeta } from '../agent/media-store.js'
import type { Strategy } from '../agent/session.js'

export function registerChatSocket(io: Server, socket: Socket) {
  socket.on('strategy.set', (data: { session_id: string; strategy: Strategy }, ack?: (resp: unknown) => void) => {
    const { session_id, strategy } = data
    if (!session_id) { ack?.({ error: 'No session_id' }); return }
    if (!['Plan', 'Ask', 'Bypass'].includes(strategy)) { ack?.({ error: 'Invalid strategy' }); return }
    setSessionStrategy(session_id, strategy, 'user')
    sessionStore.update(session_id, { current_strategy: strategy })
    console.log(`[strategy.set] session=${session_id} strategy=${strategy}`)
    socket.emit('strategy.updated', { session_id, strategy })
    ack?.({ status: 'ok' })
  })
  socket.on('chat-run', async (data: Record<string, unknown>, ack?: (resp: unknown) => void) => {
    const sessionId = data.session_id as string
    if (!sessionId) { ack?.({ error: 'No session_id' }); return }

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
    if (input.trim() || attachmentsJson) {
      messageStore.addMessage(sessionId, { role: 'user', content: input, attachments: attachmentsJson })
    }

    enqueueRun(sessionId, async (signal) => {
      await sessionLoop(io, socket, sessionId, signal, {
        thinking: !!data.thinking,
        reasoning_effort: data.reasoning_effort as string | undefined,
      })
    })

    const queueLen = getQueueLength(sessionId)
    ack?.({
      run_id: `run_${sessionId}_${Date.now()}`,
      status: queueLen > 0 ? 'queued' : 'started',
      queue_length: queueLen,
    })
  })

  socket.on('abort', (data: { session_id?: string }) => {
    if (data.session_id) abortSession(data.session_id)
  })
}

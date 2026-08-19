import type { Server, Socket } from 'socket.io'
import { fanOutToSinks } from '../transport/event-sinks.js'
import { eventDefinitionStore, type EventDefinitionRow } from './definition-store.js'
import { eventOccurrenceStore, type EventOccurrenceRow } from './occurrence-store.js'
import { characterMetaStore } from '../db/characterStore.js'
import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { turnStore } from '../db/turnStore.js'
import { runStore } from '../agent/runtime/run-store.js'
import { createDurableSocket, publishRunEvent } from '../agent/runtime/run-event-store.js'
import { enqueueRun } from '../agent/session-runner.js'
import { sessionLoop } from '../agent/loop.js'
import { getDb } from '../db/schema.js'

let ioRef: Server | null = null

export function setEventDefinitionRuntime(io: Server) {
  ioRef = io
}

/**
 * Create a one-shot event (definition + occurrence) and run it. Used by
 * internal producers such as evolution insights.
 */
export function fireOnceEvent(input: {
  name: string
  instruction: string
  characterId: string
  assignedGroup?: string | null
  providerId?: string | null
  model?: string | null
  workspace?: string | null
  approvalMode?: string
}): EventOccurrenceRow {
  const definition = eventDefinitionStore.create({
    name: input.name,
    type: 'once',
    instruction: input.instruction,
    character_id: input.characterId,
    assigned_group: input.assignedGroup,
    provider_id: input.providerId,
    model: input.model,
    workspace: input.workspace,
    approval_mode: input.approvalMode || 'Auto Approve',
  })
  const occurrence = eventOccurrenceStore.create(definition, {
    triggerType: 'scheduled',
    scheduledFor: Date.now(),
  })
  scheduleOccurrence(occurrence.id)
  return occurrence
}

/**
 * After a run finishes, start the oldest still-pending occurrence of the same
 * definition (overlap_policy = queue).
 */
export function drainQueue(definitionId: string): void {
  const next = eventOccurrenceStore.nextPending(definitionId)
  if (next) scheduleOccurrence(next.id)
}

function broadcastSocket(io: Server): Socket {
  return {
    emit: (type: string, ...args: any[]) => {
      io.emit(type, ...args)
      const payload = args[0] && typeof args[0] === 'object' ? args[0] as Record<string, unknown> : { args }
      fanOutToSinks(type, payload)
      return true
    },
    on: () => undefined,
    off: () => undefined,
    id: 'event-occurrence',
  } as any as Socket
}

export async function executeOccurrence(occurrenceId: string): Promise<void> {
  const io = ioRef
  if (!io) throw new Error('Event runtime is not ready')
  const occurrence = eventOccurrenceStore.get(occurrenceId)
  if (!occurrence) throw new Error('Event occurrence not found')
  const definition = eventDefinitionStore.get(occurrence.definition_id)
  if (!definition) throw new Error('Event definition not found')
  const character = characterMetaStore.getById(definition.character_id)
  if (!character) throw new Error(`Character "${definition.character_id}" not found`)

  let session = occurrence.session_id ? sessionStore.getById(occurrence.session_id) : null
  if (!session) {
    session = sessionStore.create({
      id: `evts_${occurrence.id}`,
      title: definition.name,
      character_id: definition.character_id,
      character_binding_mode: 'pinned',
      pinned_character_revision_id: occurrence.resolved_revision_id,
      session_type: 'event',
      event_occurrence_id: occurrence.id,
      active_group: definition.assigned_group,
      provider_id: definition.provider_id || character.provider || null,
      model: definition.model || character.model || null,
      workspace: definition.workspace,
      approval_mode: definition.approval_mode,
      execution_mode: definition.execution_mode,
      current_strategy: definition.approval_mode,
    })
    getDb().prepare(
      'UPDATE event_occurrences SET session_id = ?, updated_at = ? WHERE id = ?',
    ).run(session.id, Date.now(), occurrence.id)
    io.emit('session:new', { sessionId: session.id, title: session.title, isEvent: true })
    fanOutToSinks('session:new', { sessionId: session.id, title: session.title, isEvent: true })
  }

  const turn = turnStore.create(session.id, 'event')
  const run = runStore.create(session, { turnId: turn.id, source: 'event' })
  const userMessage = messageStore.addMessage(session.id, {
    role: 'user',
    content: definition.instruction,
    turn_id: turn.id,
    run_id: run.id,
  })
  turnStore.attachUserMessage(turn.id, userMessage.id)
  getDb().prepare(`
    UPDATE event_occurrences
    SET current_run_id = ?, status = 'running', error = NULL, updated_at = ?
    WHERE id = ?
  `).run(run.id, Date.now(), occurrence.id)
  const rawSocket = broadcastSocket(io)
  publishRunEvent(rawSocket, run.id, 'run.queued', {
    session_id: session.id,
    run_id: run.id,
    character_id: run.character_id,
    character_revision_id: run.character_revision_id,
    event_occurrence_id: occurrence.id,
  })
  const durableSocket = createDurableSocket(rawSocket, run.id)

  await new Promise<void>((resolve) => {
    enqueueRun(session!.id, run.id, async signal => {
      try {
        const result = await sessionLoop(io, durableSocket, session!.id, signal, { run_id: run.id })
        const persisted = runStore.get(run.id)
        const messages = messageStore.getMessages(session!.id, 100000)
        const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant')
        const ok = persisted?.status === 'completed'
        getDb().prepare(`
          UPDATE event_occurrences SET status = ?, result = ?, error = ?, updated_at = ?
          WHERE id = ?
        `).run(
          ok ? 'completed' : 'failed',
          ok ? JSON.stringify({ summary: lastAssistant?.content || '', run_status: result.status }) : null,
          ok ? null : persisted?.error || `Run ended with ${persisted?.status || result.status}`,
          Date.now(),
          occurrence.id,
        )
        io.emit('event_occurrence.updated', eventOccurrenceStore.get(occurrence.id))
        fanOutToSinks('event_occurrence.updated', { occurrence: eventOccurrenceStore.get(occurrence.id) })
      } catch (error: any) {
        publishRunEvent(rawSocket, run.id, 'run.failed', {
          session_id: session!.id,
          run_id: run.id,
          error: error.message || String(error),
        })
        getDb().prepare(`
          UPDATE event_occurrences SET status = 'failed', error = ?, updated_at = ? WHERE id = ?
        `).run(error.message || String(error), Date.now(), occurrence.id)
      } finally {
        drainQueue(definition.id)
        resolve()
      }
    })
  })
}

export function scheduleOccurrence(occurrenceId: string) {
  void executeOccurrence(occurrenceId).catch(error => {
    console.error('[event-occurrence] execution failed:', error)
  })
}


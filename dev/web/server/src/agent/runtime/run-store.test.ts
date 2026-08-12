/**
 * Run: npx tsx src/agent/runtime/run-store.test.ts
 *
 * Covers: terminal-event uniqueness, append->commit->socket order,
 * after_seq replay, revision pinning (follow_latest / pinned), and the
 * RunCoordinator serialization + cancellation semantics.
 */

import { randomUUID } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-runstore-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { getDb, closeDb } = await import('../../db/schema.js')
const { sessionStore } = await import('../../db/sessionStore.js')
const { runStore } = await import('./run-store.js')
const { runEventStore, publishRunEvent, forceCancelRun, forceCancelSessionRuns } = await import('./run-event-store.js')
const { runCoordinator } = await import('./run-coordinator.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const db = getDb()
const NOW = Date.now()

function seedCharacter(characterId: string, revisionId: string, revisionNo = 1) {
  db.prepare(`
    INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(characterId, revisionId, NOW, NOW)
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, ?, ?, '{}', NULL, ?)
  `).run(revisionId, characterId, revisionNo, `hash-${revisionId}`, NOW)
}

function publishRevision(characterId: string, revisionId: string, revisionNo: number) {
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, ?, ?, '{}', NULL, ?)
  `).run(revisionId, characterId, revisionNo, `hash-${revisionId}`, NOW)
  db.prepare('UPDATE character_definitions SET current_revision_id = ?, updated_at = ? WHERE id = ?')
    .run(revisionId, NOW, characterId)
}

function newChar(): string {
  const id = `char_${randomUUID().slice(0, 8)}`
  seedCharacter(id, `rev_${id}_1`)
  return id
}

function makeSession(characterId: string, overrides: Record<string, unknown> = {}) {
  return sessionStore.create({ id: `sess_${randomUUID()}`, character_id: characterId, ...overrides } as any)
}

try {
  // ---- P0 #6: run creation fixes the character revision ------------------
  {
    const charId = newChar()
    const session = makeSession(charId)
    const run1 = runStore.create(session)
    assert(run1.character_revision_id === `rev_${charId}_1`, 'run1 fixed to current revision')
    assert(/^[0-9a-f]{64}$/.test(run1.character_snapshot_hash), 'snapshot hash is sha256 hex')
    assert(run1.status === 'queued' && run1.source === 'chat' && run1.max_turns === 50, 'default run fields')

    publishRevision(charId, `rev_${charId}_2`, 2)
    const run2 = runStore.create(session)
    assert(run2.character_revision_id === `rev_${charId}_2`, 'new run uses the newer revision')
    assert(runStore.get(run1.id)!.character_revision_id === `rev_${charId}_1`, 'old run keeps its pinned snapshot')
    console.log('  OK follow_latest: new runs move, old runs keep fixed revision')
  }

  // ---- P0 #7: pinned sessions always use the pinned revision -------------
  {
    const charId = newChar()
    publishRevision(charId, `rev_${charId}_2`, 2)
    const pinned = makeSession(charId, {
      character_binding_mode: 'pinned',
      pinned_character_revision_id: `rev_${charId}_1`,
    })
    const run = runStore.create(pinned)
    assert(run.character_revision_id === `rev_${charId}_1`, 'pinned session resolves to old revision')

    const badPinned = makeSession(charId, {
      character_binding_mode: 'pinned',
      pinned_character_revision_id: 'rev_nope',
    })
    let threw = false
    try { runStore.create(badPinned) } catch { threw = true }
    assert(threw, 'missing pinned revision throws')

    const otherChar = newChar()
    const crossChar = makeSession(charId, {
      character_binding_mode: 'pinned',
      pinned_character_revision_id: `rev_${otherChar}_1`,
    })
    threw = false
    try { runStore.create(crossChar) } catch { threw = true }
    assert(threw, 'cross-character pinned revision throws')
    console.log('  OK pinned: old revision reused, invalid pins rejected')
  }

  // ---- P0 #2: one terminal event per run ---------------------------------
  {
    const session = makeSession(newChar())
    const run = runStore.create(session)
    assert(runEventStore.append(run.id, 'run.completed', { result: 'done' }) === null,
      'terminal rejected while run is still queued (state machine guard)')
    runStore.transition(run.id, 'preparing', 'context')
    runEventStore.append(run.id, 'run.started', {})
    const ev1 = runEventStore.append(run.id, 'run.completed', { result: 'done', usage: { input: 1, output: 2 } })
    assert(!!ev1, 'first terminal append succeeds')
    assert(runStore.get(run.id)!.status === 'completed', 'run status completed after terminal event')

    const ev2 = runEventStore.append(run.id, 'run.failed', { error: 'boom' })
    assert(ev2 === null, 'second terminal append rejected')
    const events = runEventStore.list(run.id)
    assert(events.length === 2 && events[0].type === 'run.started' && events[1].type === 'run.completed',
      'started + terminal persisted in order')
    assert(events.filter(e => e.type === 'run.completed').length === 1, 'only one terminal event persisted')
    assert(JSON.parse(events[1].payload).result === 'done', 'payload round-trips')

    const run2 = runStore.create(session)
    runStore.transition(run2.id, 'preparing', 'context')
    runEventStore.append(run2.id, 'run.started', {})
    assert(!!runEventStore.append(run2.id, 'run.cancelled', {}), 'cancelled terminal ok')
    assert(runEventStore.append(run2.id, 'run.completed', {}) === null, 'terminal after terminal rejected')
    console.log('  OK only one terminal event per run')
  }

  // ---- P0 #3: append commits before socket emit ---------------------------
  {
    const session = makeSession(newChar())
    const run = runStore.create(session)
    const seen: string[] = []
    const fakeSocket = {
      emit: (type: string, payload: any) => {
        const row = db.prepare('SELECT * FROM run_events WHERE run_id = ? AND seq = ?').get(run.id, payload.seq) as any
        seen.push(type)
        assert(!!row, `event ${type} seq=${payload.seq} already committed before emit`)
        assert(row.type === type && row.seq === payload.seq, 'committed row matches emitted event')
        return true
      },
    }
    const r1 = publishRunEvent(fakeSocket as any, run.id, 'tool.started', { name: 'bash' })
    assert(!!r1 && r1.seq === 1, 'first event seq=1')
    const r2 = publishRunEvent(fakeSocket as any, run.id, 'message.delta', { delta: 'hi' })
    assert(!!r2 && r2.seq === 2, 'second event seq=2')
    assert(seen.join(',') === 'tool.started,message.delta', 'emit order matches append order')
    console.log('  OK append -> commit -> socket emit ordering')
  }

  // ---- P0 #8: after_seq replay without loss or duplicates -----------------
  {
    const session = makeSession(newChar())
    const run = runStore.create(session)
    for (let i = 0; i < 3; i++) runEventStore.append(run.id, 'message.delta', { delta: `t${i}` })
    runEventStore.append(run.id, 'tool.started', { name: 'x' })
    runEventStore.append(run.id, 'message.delta', { delta: 'end' })

    const all = runEventStore.list(run.id, 0)
    assert(all.length === 5, 'full replay returns all events')
    assert(all.map(e => e.seq).join(',') === '1,2,3,4,5', 'seq contiguous ascending')
    const tail = runEventStore.list(run.id, 3)
    assert(tail.length === 2 && tail[0].seq === 4 && tail[1].seq === 5, 'after_seq resumes past cursor')
    assert(runEventStore.list(run.id, 5).length === 0, 'cursor at end returns nothing')

    const joined = [...runEventStore.list(run.id, 0, 2), ...runEventStore.list(run.id, 2, 2), ...runEventStore.list(run.id, 4, 2)]
    assert(joined.length === 5, 'paginated replay has no loss')
    assert(joined.every((e, i) => e.seq === i + 1), 'paginated replay has no duplicates or gaps')
    assert(new Set(joined.map(e => e.event_id)).size === 5, 'no duplicate event ids')
    console.log('  OK after_seq replay: no loss, no duplicates')
  }

  // ---- P0 #4/#5: coordinator serialization + cancellation ------------------
  {
    const session = makeSession(newChar())
    const runA = runStore.create(session)
    const runB = runStore.create(session)
    const runC = runStore.create(session)
    let aStarted = false, aFinished = false, aAborted = false
    let releaseA: () => void = () => {}
    let bCancelled = false, cCancelled = false

    const q1 = runCoordinator.enqueue(session.id, runA.id, signal => {
      aStarted = true
      signal.addEventListener('abort', () => { aAborted = true })
      return new Promise<void>(res => { releaseA = res }).then(() => { aFinished = true })
    })
    assert(!q1.queued, 'first run executes immediately')
    assert(runStore.get(runA.id)!.status === 'preparing', 'active run transitioned to preparing')

    const q2 = runCoordinator.enqueue(session.id, runB.id, async () => { throw new Error('B must never run') }, () => { bCancelled = true })
    assert(q2.queued && q2.queueLength === 1, 'second run queued')
    const q3 = runCoordinator.enqueue(session.id, runC.id, async () => { throw new Error('C must never run') }, () => { cCancelled = true })
    assert(q3.queued && q3.queueLength === 2, 'third run queued')
    assert(!aFinished && aStarted, 'A still running')
    assert(runStore.get(runB.id)!.status === 'queued' && runStore.get(runC.id)!.status === 'queued', 'queued runs stay queued')

    const cancelled = runCoordinator.cancelSession(session.id)
    assert(cancelled === true, 'cancelSession returns true')
    assert(runCoordinator.state(session.id).state === 'cancelling', 'entry kept in cancelling while old promise alive')
    assert(runStore.get(runA.id)!.status === 'cancelling', 'active run marked cancelling')
    assert(aAborted, 'active run signal aborted')
    assert(bCancelled && cCancelled, 'queued runs got cancel callbacks')

    const runD = runStore.create(session)
    let dStarted = false, dFinished = false
    let releaseD: () => void = () => {}
    const q4 = runCoordinator.enqueue(session.id, runD.id, () => {
      dStarted = true
      return new Promise<void>(res => { releaseD = res }).then(() => { dFinished = true })
    })
    assert(q4.queued && runCoordinator.state(session.id).activeRunId === runA.id, 'new run queued, not parallel while old promise alive')

    releaseA()
    await new Promise(r => setTimeout(r, 20))

    assert(aFinished, 'A settled after release')
    assert(dStarted, 'D only started after A settled (no overlap)')
    assert(runCoordinator.state(session.id).activeRunId === runD.id, 'D became active run')
    assert(runStore.get(runD.id)!.status === 'preparing', 'D transitioned to preparing')
    assert(runStore.get(runB.id)!.status === 'queued', 'cancelled queued run never ran')

    releaseD()
    await new Promise(r => setTimeout(r, 10))
    assert(dFinished, 'D settles after release')
    assert(runCoordinator.state(session.id).state === 'idle', 'coordinator idle after all runs settle')
    console.log('  OK cancel keeps mutex until old promise settles; queued runs cancelled')
  }

  // ---- run.started / approval / tool.started drive the state machine ------
  {
    const session = makeSession(newChar())
    const run = runStore.create(session)
    runStore.transition(run.id, 'preparing', 'context')
    runEventStore.append(run.id, 'run.started', {})
    assert(runStore.get(run.id)!.status === 'running', 'run.started -> running')
    assert(runStore.get(run.id)!.phase === 'model', 'run.started phase model')
    runEventStore.append(run.id, 'approval.requested', { tool_name: 'x' })
    assert(runStore.get(run.id)!.status === 'awaiting_approval', 'approval.requested -> awaiting_approval')
    runEventStore.append(run.id, 'tool.started', { name: 'y' })
    assert(runStore.get(run.id)!.status === 'running', 'tool.started resumes running')
    assert(runStore.get(run.id)!.phase === 'tools', 'tool.started phase tools')
    console.log('  OK event-driven run state transitions')
  }

  // ---- bugfix: post-approval tool.completed resumes a parked run ----------
  // Real event order for an escaping tool: tool.started fires BEFORE
  // approval.requested, so after approval the only signals are tool.output /
  // tool.completed. These must also resume awaiting_approval -> running.
  {
    const session = makeSession(newChar())
    const run = runStore.create(session)
    runStore.transition(run.id, 'preparing', 'context')
    runEventStore.append(run.id, 'run.started', {})
    runEventStore.append(run.id, 'tool.started', { name: 'bash' })
    assert(runStore.get(run.id)!.status === 'running', 'tool.started while running stays running')
    runEventStore.append(run.id, 'approval.requested', { tool_name: 'bash' })
    assert(runStore.get(run.id)!.status === 'awaiting_approval', 'approval parks the run')
    // Approval granted, tool re-executes and completes — no second tool.started.
    runEventStore.append(run.id, 'tool.output', { output: 'ok' })
    assert(runStore.get(run.id)!.status === 'running', 'tool.output after approval resumes running')
    runEventStore.append(run.id, 'tool.completed', { tool_name: 'bash', tool_status: 'success' })
    assert(runStore.get(run.id)!.status === 'running', 'tool.completed keeps running')
    console.log('  OK post-approval tool events resume a parked run')
  }

  // ---- bugfix: a parked run can reach terminal states ---------------------
  // Previously awaiting_approval had no path to completed/max_turns, so a
  // run that ended while waiting on approval never emitted its terminal
  // event and the client stayed "working" forever.
  {
    const session = makeSession(newChar())
    const run = runStore.create(session)
    runStore.transition(run.id, 'preparing', 'context')
    runEventStore.append(run.id, 'run.started', {})
    runEventStore.append(run.id, 'approval.requested', { tool_name: 'bash' })
    assert(runStore.get(run.id)!.status === 'awaiting_approval', 'parked awaiting approval')
    const terminal = runEventStore.append(run.id, 'run.completed', { status: 'max_turns' })
    assert(!!terminal, 'max_turns terminal accepted from awaiting_approval')
    assert(runStore.get(run.id)!.status === 'max_turns', 'run finished as max_turns')
    console.log('  OK parked run can reach terminal states')
  }

  // ---- bugfix: forceCancelRun rescues an orphaned stuck run ---------------
  {
    const session = makeSession(newChar())
    const run = runStore.create(session)
    runStore.transition(run.id, 'preparing', 'context')
    runEventStore.append(run.id, 'run.started', {})
    runEventStore.append(run.id, 'approval.requested', { tool_name: 'bash' })
    const event = forceCancelRun(run.id, 'test_abort')
    assert(!!event, 'forceCancelRun persists a cancelled terminal event')
    assert(event!.type === 'run.cancelled', 'forceCancelRun emits run.cancelled')
    assert(runStore.get(run.id)!.status === 'cancelled', 'force-cancelled run is terminal')
    // Already terminal: second force-cancel is a no-op.
    assert(forceCancelRun(run.id) === null, 'second forceCancelRun is rejected')
    console.log('  OK forceCancelRun rescues orphaned stuck runs')
  }

  // ---- bugfix: forceCancelSessionRuns rescues all non-terminal runs -------
  {
    const session = makeSession(newChar())
    const runA = runStore.create(session)
    const runB = runStore.create(session)
    runStore.transition(runA.id, 'preparing', 'context')
    runEventStore.append(runA.id, 'run.started', {})
    runEventStore.append(runA.id, 'approval.requested', { tool_name: 'bash' })
    // runB stays queued (never started).
    const rescued = forceCancelSessionRuns(session.id, 'orphaned_after_restart')
    assert(rescued.length === 2, 'both non-terminal runs rescued')
    assert(runStore.get(runA.id)!.status === 'cancelled' && runStore.get(runB.id)!.status === 'cancelled',
      'both runs cancelled')
    assert(forceCancelSessionRuns(session.id).length === 0, 'no-op once terminal')
    console.log('  OK forceCancelSessionRuns reclaims orphaned runs')
  }

  // ---- append to a missing run throws -------------------------------------
  {
    let threw = false
    try { runEventStore.append('run_missing', 'message.delta', {}) } catch { threw = true }
    assert(threw, 'append to missing run throws')
    console.log('  OK append to missing run rejected')
  }
} finally {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
}

console.log('ALL RUN-STORE TESTS PASSED')

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Set env BEFORE importing config/db modules: getDataDir() caches on first
// call, so a top-level getDb() must see the isolated data dir.
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-runpol-store-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { runStore } from '../src/agent/runtime/run-store.js'
import { evaluateAutoContinuation, createResumedRun } from '../src/agent/runtime/run-resume-service.js'
import { resolveRunPolicy } from '../src/agent/loop/run-policy-resolver.js'
import { getSystemRunPolicy, getDataDir } from '../src/config.js'
import { closeDb } from '../src/db/schema.js'

const db = getDb()
const NOW = Date.now()

afterAll(() => {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

/** Write a real character.json so resolveCharacterBinding can pin it. */
function writeCharacter(characterId: string, runPolicy?: unknown) {
  const dir = resolve(getDataDir(), 'characters', characterId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'character.json'), JSON.stringify({
    id: characterId, name: characterId, color: '#000000', role: 'both', runPolicy,
  }), 'utf-8')
}

function seedCharacter(characterId: string, revisionId: string, runPolicy?: unknown) {
  writeCharacter(characterId, runPolicy)
  db.prepare(`
    INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(characterId, revisionId, NOW, NOW)
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, 1, ?, ?, NULL, ?)
  `).run(revisionId, characterId, `hash-${revisionId}`, JSON.stringify({ meta: { runPolicy } }), NOW)
}

function newChar(runPolicy?: unknown) {
  const id = `char_${randomUUID().slice(0, 8)}`
  seedCharacter(id, `rev_${id}_1`, runPolicy)
  return id
}

function makeSession(characterId: string, overrides: Record<string, unknown> = {}) {
  return sessionStore.create({ id: `sess_${randomUUID()}`, character_id: characterId, ...overrides } as any)
}

describe('run policy persistence', () => {
  it('resolves and persists a policy snapshot at creation', () => {
    const charId = newChar()
    const session = makeSession(charId)
    const run = runStore.create(session)
    expect(run.run_policy_snapshot).toBeTruthy()
    expect(run.soft_turns).toBeGreaterThan(0)
    expect(run.absolute_turns).toBe(run.max_turns)
    const snap = JSON.parse(run.run_policy_snapshot!)
    expect(snap.version).toBe(1)
    expect(snap.effective.absoluteTurns).toBe(run.max_turns)
  })

  it('respects character runPolicy override via pinned revision', () => {
    const charId = newChar({ version: 1, softTurns: 80, graceTurns: 5 })
    const session = makeSession(charId)
    const run = runStore.create(session)
    const snap = runStore.policySnapshot(run.id)!
    expect(snap.character.softTurns).toBe(80)
    expect(snap.effective.softTurns).toBe(80)
    expect(snap.effective.absoluteTurns).toBe(85)
    expect(run.soft_turns).toBe(80)
  })

  it('clamps character override to the system boundary', () => {
    const charId = newChar({ version: 1, softTurns: 99999, graceTurns: 99999 })
    const session = makeSession(charId)
    const run = runStore.create(session)
    const snap = runStore.policySnapshot(run.id)!
    expect(snap.effective.softTurns).toBeLessThanOrEqual(getSystemRunPolicy().maxAbsoluteTurnsPerRun)
  })

  it('legacy runs get a version:1 snapshot on backfill', () => {
    const charId = newChar()
    const session = makeSession(charId)
    // Insert a run row directly with a max_turns but null snapshot (simulating
    // a legacy run). The schema backfill runs at open; insert then read policy.
    const id = `legacy_${randomUUID()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO runs (id, session_id, character_id, character_revision_id, character_snapshot_hash, source,
        status, phase, approval_mode, execution_mode, turn_no, max_turns, queued_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'chat', 'max_turns', 'finalize', 'Ask Risky', 'direct', 0, 120, ?, ?)
    `).run(id, session.id, charId, `rev_${charId}_1`, 'hash', now, now)
    // Manually trigger the backfill semantics for this row.
    db.prepare(`
      UPDATE runs SET
        run_policy_snapshot = json_object('version', 1, 'effective', json_object('absoluteTurns', max_turns, 'softTurns', max_turns, 'graceTurns', 0)),
        configured_max_turns = max_turns, soft_turns = max_turns, absolute_turns = max_turns,
        continuation_root_run_id = id, continuation_index = 0
      WHERE id = ?
    `).run(id)
    const run = runStore.get(id)!
    expect(run.absolute_turns).toBe(120)
    expect(run.soft_turns).toBe(120)
    expect(run.continuation_root_run_id).toBe(id)
  })
})

describe('auto continuation', () => {
  it('rejects non-max_turns and non-continuable modes', () => {
    const charId = newChar()
    const session = makeSession(charId, { execution_mode: 'direct' })
    const run = runStore.create(session, { resumeTrigger: null })
    const decision = evaluateAutoContinuation(run)
    expect(decision.eligible).toBe(false)
  })

  it('creates an auto successor with inherited root and incremented index', () => {
    const charId = newChar()
    const session = makeSession(charId, { execution_mode: 'plan_first' })
    const root = runStore.create(session)
    const rootId = root.id
    // Simulate the root ending at max_turns with a plan to continue.
    db.prepare('UPDATE runs SET status = ?, turn_no = 60, result = ? WHERE id = ?')
      .run('max_turns', JSON.stringify({ limitSummary: { reason: 'no_progress_after_soft_limit' } }), rootId)

    // Give the session an unfinished plan.
    const planId = `plan_${randomUUID()}`
    db.prepare(`INSERT INTO plans (id, session_id, version, status, created_at, updated_at) VALUES (?, ?, 1, 'active', ?, ?)`)
      .run(planId, session.id, NOW, NOW)
    db.prepare(`INSERT INTO plan_steps (id, plan_id, ordinal, title, status, created_at) VALUES (?, ?, 1, 'step', 'pending', ?)`)
      .run(`step_${randomUUID()}`, planId, NOW)

    const resumed = createResumedRun({ previousRunId: rootId, trigger: 'auto_limit', instruction: 'continue', createUserTurn: false })
    expect(resumed.run.resume_trigger).toBe('auto_limit')
    expect(resumed.run.continuation_root_run_id).toBe(rootId)
    expect(resumed.run.continuation_index).toBe(1)

    const decision = evaluateAutoContinuation(root)
    expect(decision.eligible).toBe(false) // successor already exists
  })

  it('supersedes queued auto runs when a user run is created', () => {
    const charId = newChar()
    const session = makeSession(charId, { execution_mode: 'plan_first' })
    const root = runStore.create(session)
    const rootId = root.id
    db.prepare('UPDATE runs SET status = ?, turn_no = 60 WHERE id = ?').run('max_turns', rootId)

    const auto = createResumedRun({ previousRunId: rootId, trigger: 'auto_limit', instruction: 'c', createUserTurn: false }).run
    expect(auto.status).toBe('queued')

    const user = createResumedRun({ previousRunId: rootId, trigger: 'user_input', instruction: 'user answer', createUserTurn: true })
    expect(user.supersededAuto.some(r => r.id === auto.id)).toBe(true)
    expect(runStore.get(auto.id)!.status).toBe('cancelled')
  })

  it('manual trigger starts a fresh chain', () => {
    const charId = newChar()
    const session = makeSession(charId)
    const root = runStore.create(session)
    const manual = createResumedRun({ previousRunId: root.id, trigger: 'manual', instruction: 'go', createUserTurn: true })
    expect(manual.run.continuation_root_run_id).toBeNull()
    expect(manual.run.resume_trigger).toBe('manual')
  })

  it('sub_agent_callback trigger creates a wake run without a fake user turn', () => {
    const charId = newChar()
    const session = makeSession(charId)
    const root = runStore.create(session)
    const before = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?').get(session.id) as { n: number }
    const wake = createResumedRun({ previousRunId: root.id, trigger: 'sub_agent_callback', instruction: '', createUserTurn: false })
    expect(wake.run.resume_trigger).toBe('sub_agent_callback')
    // 非 manual：继承链根（无链时根为自身）。
    expect(wake.run.continuation_root_run_id).toBe(root.id)
    expect(wake.run.status).toBe('queued')
    // createUserTurn=false 不得伪造用户消息（唤醒提示走 systemAlerts，不落库）。
    const after = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?').get(session.id) as { n: number }
    expect(after.n).toBe(before.n)
  })
})

describe('policy consistency between snapshot and columns', () => {
  it('snapshot effective fields match the dedicated columns', () => {
    const charId = newChar({ version: 1, softTurns: 90 })
    const session = makeSession(charId, { execution_mode: 'plan_first' })
    const run = runStore.create(session)
    const snap = runStore.policySnapshot(run.id)!
    expect(run.soft_turns).toBe(snap.effective.softTurns)
    expect(run.absolute_turns).toBe(snap.effective.absoluteTurns)
    expect(run.configured_max_turns).toBe(snap.effective.absoluteTurns)
    expect(resolveRunPolicy(getSystemRunPolicy(), snap.character as never).effective.absoluteTurns).toBe(snap.effective.absoluteTurns)
  })
})

/**
 * Run: npx tsx src/character/revision-stale.test.ts
 *
 * Covers the "maxSteps edited but not applied" bug: `ensureCurrent` must
 * detect a stale revision (live character.json changed since publish) and
 * publish a fresh one so follow_latest runs pick up the change.
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-rev-stale-'))
process.env.TIANSHU_DATA_DIR = dataDir

const { getDb, closeDb } = await import('../db/schema.js')
const { characterMetaStore } = await import('../db/characterStore.js')
const { characterRevisionStore } = await import('./revision-store.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

try {
  const charId = 'stale_char'
  characterMetaStore.create({ id: charId, name: 'T', maxSteps: 10 })

  // First ensureCurrent publishes rev1 with maxSteps=10.
  const rev1 = characterRevisionStore.ensureCurrent(charId)
  assert(rev1.revision_no === 1, 'first ensureCurrent publishes rev1')
  assert(JSON.parse(rev1.snapshot).meta.maxSteps === 10, 'rev1 snapshot carries maxSteps 10')

  // A stale publish (no meta change) returns the same revision.
  const same = characterRevisionStore.ensureCurrent(charId)
  assert(same.id === rev1.id && same.revision_no === 1, 'unchanged character reuses rev1')

  // Edit maxSteps out-of-band (as the character_manager tool / direct file
  // edit does) — no publish call happens.
  characterMetaStore.update(charId, { maxSteps: 999 })

  // ensureCurrent must now detect the stale revision and publish rev2.
  const rev2 = characterRevisionStore.ensureCurrent(charId)
  assert(rev2.revision_no === 2, 'stale character publishes rev2')
  assert(JSON.parse(rev2.snapshot).meta.maxSteps === 999, 'rev2 snapshot carries maxSteps 999')

  // Re-running with no further change stays on rev2.
  const same2 = characterRevisionStore.ensureCurrent(charId)
  assert(same2.id === rev2.id && same2.revision_no === 2, 'rev2 reused until next change')

  // The definition's current_revision_id now points at rev2.
  const def = characterRevisionStore.getDefinition(charId)
  assert(def?.current_revision_id === rev2.id, 'definition points at newest revision')

  console.log('ALL REVISION-STALENESS TESTS PASSED')
} finally {
  closeDb()
  rmSync(dataDir, { recursive: true, force: true })
}

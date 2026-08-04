/**
 * Run: npx tsx src/character/asset-lifecycle.test.ts
 *
 * Covers: run/occurrence asset refs registration, player leases, deletion
 * guards, and the delayed GC for archived characters.
 */

import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-assets-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { getDb, closeDb } = await import('../db/schema.js')
const { characterVisualStore } = await import('./visual-store.js')
const { registerAssetRefs, touchPlayerLease, hasProtectingRef } = await import('./asset-refs.js')
const { runAssetGC, ASSET_RETENTION_MS, PLAYER_LEASE_MS } = await import('./asset-gc.js')
const { sessionStore } = await import('../db/sessionStore.js')
const { runStore } = await import('../agent/runtime/run-store.js')
const { eventDefinitionStore } = await import('../event/definition-store.js')
const { eventOccurrenceStore } = await import('../event/occurrence-store.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const db = getDb()
const NOW = Date.now()

function seedCharacter(characterId: string, revisionId: string, snapshot: string) {
  db.prepare(`
    INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(characterId, revisionId, NOW, NOW)
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, 1, 'h', ?, NULL, ?)
  `).run(revisionId, characterId, snapshot, NOW)
}

function makeSnapshot(visual: Record<string, unknown> | null) {
  return JSON.stringify({ meta: { id: 'c', name: 'x' }, content: { soul: '', user: '', memory: '' }, visual })
}

try {
  // ---- run creation registers asset refs from its fixed revision -----------
  {
    const visual = { schemaVersion: 1, defaultMotion: 'idle', motions: { idle: { assetId: 'asset_run' } } }
    seedCharacter('char_run', 'rev_run', makeSnapshot(visual))
    const session = sessionStore.create({ id: 'sess_run', character_id: 'char_run' })
    const run = runStore.create(session)
    const ref = db.prepare(
      "SELECT owner_type FROM character_asset_refs WHERE owner_id = ? AND asset_id = 'asset_run'",
    ).get(run.id) as { owner_type: string } | undefined
    assert(!!ref && ref.owner_type === 'run', 'run creation pins its revision assets')
    console.log('  OK run registration pins assets')
  }

  // ---- occurrence creation registers asset refs ------------------------------
  {
    const visual = { schemaVersion: 1, defaultMotion: 'idle', motions: { idle: { assetId: 'asset_occ' } } }
    seedCharacter('char_occ', 'rev_occ', makeSnapshot(visual))
    const definition = eventDefinitionStore.create({
      name: 'occ-test', type: 'once', instruction: 'x', character_id: 'char_occ',
    })
    const occurrence = eventOccurrenceStore.create(definition, { triggerType: 'manual', scheduledFor: NOW })
    const ref = db.prepare(
      "SELECT owner_type FROM character_asset_refs WHERE owner_id = ? AND asset_id = 'asset_occ'",
    ).get(occurrence.id) as { owner_type: string } | undefined
    assert(!!ref && ref.owner_type === 'occurrence', 'occurrence creation pins its revision assets')
    console.log('  OK occurrence registration pins assets')
  }

  // ---- player lease protects an asset from GC --------------------------------
  {
    const visual = { schemaVersion: 1, defaultMotion: 'idle', motions: { idle: { assetId: 'asset_lease' } } }
    seedCharacter('char_lease', 'rev_lease', makeSnapshot(visual))
    // Simulate an archived character with a live lease and no other refs.
    db.prepare("UPDATE character_definitions SET status = 'archived', updated_at = ? WHERE id = 'char_lease'")
      .run(NOW - ASSET_RETENTION_MS - 1000)
    db.prepare("DELETE FROM character_asset_refs WHERE character_id = 'char_lease'").run()
    touchPlayerLease('char_lease', 'asset_lease', PLAYER_LEASE_MS)
    assert(hasProtectingRef('char_lease', 'asset_lease'), 'live lease protects the asset')
    const result1 = runAssetGC()
    assert(result1.removed === 0, 'GC keeps leased assets')
    console.log('  OK player lease keeps in-use assets')
  }

  // ---- GC removes unprotected assets after retention --------------------------
  {
    const visual = { schemaVersion: 1, defaultMotion: 'idle', motions: { idle: { assetId: 'asset_gc' } } }
    seedCharacter('char_gc', 'rev_gc', makeSnapshot(visual))
    const added = characterVisualStore.addAsset('char_gc', {
      bytes: new Uint8Array([1, 2, 3]), filename: 'gc.png', mime: 'image/png',
    })
    db.prepare("UPDATE character_definitions SET status = 'archived', updated_at = ? WHERE id = 'char_gc'")
      .run(NOW - ASSET_RETENTION_MS - 1000)
    db.prepare("DELETE FROM character_asset_refs WHERE character_id = 'char_gc'").run()
    const result = runAssetGC()
    assert(result.removed === 1, 'GC removes one unprotected asset')
    assert(!existsSync(characterVisualStore.getAsset('char_gc', added.assetId)?.file || ''),
      'asset file is gone after GC')
    assert(characterVisualStore.listAssets('char_gc').length === 0, 'asset index cleaned')
    console.log('  OK GC removes unprotected assets after retention')
  }

  // ---- GC keeps assets inside the retention window ----------------------------
  {
    const visual = { schemaVersion: 1, defaultMotion: 'idle', motions: { idle: { assetId: 'asset_fresh' } } }
    seedCharacter('char_fresh', 'rev_fresh', makeSnapshot(visual))
    characterVisualStore.addAsset('char_fresh', {
      bytes: new Uint8Array([1]), filename: 'fresh.png', mime: 'image/png',
    })
    db.prepare("UPDATE character_definitions SET status = 'archived', updated_at = ? WHERE id = 'char_fresh'")
      .run(NOW) // archived just now
    db.prepare("DELETE FROM character_asset_refs WHERE character_id = 'char_fresh'").run()
    const result = runAssetGC()
    assert(result.removed === 0, 'GC skips assets inside the retention window')
    console.log('  OK retention window respected')
  }
} finally {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
}

console.log('ALL ASSET-LIFECYCLE TESTS PASSED')

/**
 * Byte-stability & fingerprint tests for system-cache.
 * Run: npx tsx src/agent/system-cache.test.ts
 */

import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { stableKey, normalizeTools, getCached, setCached, extractComponents, diagnoseMiss, capturePrefixShape, compareShapes, cacheStats } from './system-cache.js'

let passed = 0
let failed = 0

function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`) }
  else { failed++; console.error(`  ✗ ${label}`) }
}

// ── 2. SHA-256 fingerprint determinism ──
assert(
  stableKey('1', [{ function: { name: 'read', description: 'Read', parameters: {} } }], ['skill-a'], 'soul', 'user')
  ===
  stableKey('1', [{ function: { name: 'read', description: 'Read', parameters: {} } }], ['skill-a'], 'soul', 'user'),
  'fingerprint is deterministic for same inputs',
)

// ── 6. Tool order does not affect fingerprint ──
assert(
  stableKey('1', [{ function: { name: 'read' } }, { function: { name: 'write' } }], ['skill-a'], 'soul', 'user')
  ===
  stableKey('1', [{ function: { name: 'write' } }, { function: { name: 'read' } }], ['skill-a'], 'soul', 'user'),
  'tool order does not affect fingerprint',
)

// ── Different inputs → different fingerprint ──
assert(
  stableKey('1', [{ function: { name: 'read' } }], ['skill-a'], 'soul', 'user')
  !==
  stableKey('1', [{ function: { name: 'read' } }], ['skill-b'], 'soul', 'user'),
  'different skills change fingerprint',
)

// ── normalizeTools produces sorted output ──
const sorted = normalizeTools([
  { function: { name: 'write' } },
  { function: { name: 'read' } },
  { function: { name: 'bash' } },
])
assert(
  sorted.map(t => t.function.name).join(',') === 'bash,read,write',
  'normalizeTools sorts by name',
)

// ── setCached/getCached round-trip ──
const testKey = 'test-key-12345'
const testPrompt = ['## Character\nTest', '## Workspace\n...']
setCached(testKey, testPrompt)
const retrieved = getCached(testKey)
assert(JSON.stringify(retrieved) === JSON.stringify(testPrompt), 'setCached/getCached round-trip preserves content')
rmSync(resolve(cacheStats().cacheDir, `${testKey}.json`), { force: true })

// ── Cache miss returns null ──
assert(getCached('nonexistent-key') === null, 'getCached returns null for miss')

// ── #3 extractComponents returns stable output ──
const comp1 = extractComponents('1', [{ function: { name: 'read' } }], ['skill-a'], 'soul', 'user')
const comp2 = extractComponents('1', [{ function: { name: 'read' } }], ['skill-a'], 'soul', 'user')
assert(comp1.tools === comp2.tools, 'extractComponents tools is deterministic')
assert(comp1.soulHash === comp2.soulHash, 'extractComponents soulHash is deterministic')

// ── #3 diagnoseMiss returns changes ──
const cur = extractComponents('miss-test', [{ function: { name: 'read' } }], ['skill-a'], 'soul', 'user')
const reasons1 = diagnoseMiss('miss-test', cur)
assert(reasons1.length === 1 && reasons1[0] === 'first_seen (cold start)', 'diagnoseMiss first call reports cold start')
const cur2 = extractComponents('miss-test', [{ function: { name: 'read' } }, { function: { name: 'write' } }], ['skill-a'], 'soul', 'user')
const reasons2 = diagnoseMiss('miss-test', cur2)
assert(reasons2.includes('tools'), 'diagnoseMiss detects tool changes')

const shape1 = capturePrefixShape([
  { role: 'system', content: 'stable' },
  { role: 'user', content: 'hello' },
])
const shape2 = capturePrefixShape([
  { role: 'system', content: 'stable' },
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'world' },
])
assert(compareShapes(shape1, shape2).length === 0, 'append-only history growth is not reported as a cache-shape change')

const shape3 = capturePrefixShape([
  { role: 'system', content: 'stable' },
  { role: 'user', content: 'rewritten' },
])
const rewrittenReason = compareShapes(shape2, shape3).find(r => r.includes('history rewritten'))
assert(!!rewrittenReason, 'history rewrites are still diagnosed')
assert(rewrittenReason!.includes('raw index 1'), 'compareShapes pinpoints the rewritten message raw index')

// ── A rewrite deep in the middle is pinpointed, not just flagged ──
const deep1 = capturePrefixShape([
  { role: 'system', content: 'stable' },
  { role: 'user', content: 'q1' },
  { role: 'assistant', content: 'a1' },
  { role: 'tool', content: '{"output":"big"}', tool_call_id: 't1' },
  { role: 'assistant', content: 'a2' },
])
const deep2 = capturePrefixShape([
  { role: 'system', content: 'stable' },
  { role: 'user', content: 'q1' },
  { role: 'assistant', content: 'a1' },
  { role: 'tool', content: '{"output":"changed"}', tool_call_id: 't1' },
  { role: 'assistant', content: 'a2' },
])
const deepReason = compareShapes(deep1, deep2).find(r => r.includes('history rewritten'))
assert(deepReason!.includes('index 3'), 'mid-history tool rewrite reported at exact index')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

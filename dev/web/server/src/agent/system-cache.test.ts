/**
 * Byte-stability & fingerprint tests for system-cache.
 * Run: npx tsx src/agent/system-cache.test.ts
 */

import { stableKey, normalizeTools, getCached, setCached, extractComponents, diagnoseMiss } from './system-cache.js'

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
const testPrompt = '## Character\nTest\n## Workspace\n...'
setCached(testKey, testPrompt)
const retrieved = getCached(testKey)
assert(retrieved === testPrompt, 'setCached/getCached round-trip preserves content')

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

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

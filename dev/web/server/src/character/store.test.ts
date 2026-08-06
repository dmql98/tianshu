import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-character-content-'))
process.env.TIANSHU_DATA_DIR = dataDir

const { characterContentStore } = await import('./store.js')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

try {
  characterContentStore.save('role', { soul: 'soul-v1', user: 'user-v1', memory: 'memory-v1' })
  characterContentStore.save('role', { soul: 'soul-v2' })
  let content = characterContentStore.get('role')
  assert(content.soul === 'soul-v2', 'supplied soul is updated')
  assert(content.user === 'user-v1', 'omitted user is preserved')
  assert(content.memory === 'memory-v1', 'omitted memory is preserved')

  characterContentStore.save('role', { user: '' })
  content = characterContentStore.get('role')
  assert(content.soul === 'soul-v2', 'clearing user does not clear soul')
  assert(content.user === '', 'explicit empty string clears the selected document')
  assert(readFileSync(join(dataDir, 'characters', 'role', 'memory.md'), 'utf8') === 'memory-v1', 'memory remains on disk')
  console.log('ALL CHARACTER CONTENT STORE TESTS PASSED')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}

/**
 * Run: npx tsx src/character/memory-store.test.ts
 *
 * Covers: remember/recall/forget 条目读写、memory.enabled 门控、charLimit/maxEntries
 * 超限自动压缩（从最旧丢弃）、同内容去重。
 */
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-memory-'))
process.env.TIANSHU_DATA_DIR = dataDir

const { characterMetaStore } = await import('../db/characterStore.js')
const { remember, forget, readMemory, memoryConfig, renderMemory } = await import('./memory-store.js')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
function createCharacter(id: string, memory: any) {
  return characterMetaStore.create({ id, name: 'Test', memory, tools: [], skills: [], skillBindings: [] })
}

try {
  // ── enabled=false：remember 拒绝写入，但配置可读 ──
  createCharacter('a', { enabled: false, charLimit: 50 })
  const cfgA = memoryConfig('a')
  assert(cfgA.enabled === false, 'enabled=false 被读到')
  const ra = remember('a', '一条不该被记住的记忆')
  assert(ra.disabledFallback === true, '未启用时 remember 返回 disabledFallback')
  assert(readMemory('a').length === 0, '未启用时不写入任何条目')

  // ── enabled=true：remember 追加、recall、forget ──
  createCharacter('b', { enabled: true, charLimit: 200, maxEntries: 5 })
  assert(memoryConfig('b').enabled === true, 'enabled=true 被读到')
  remember('b', '用户喜欢简洁汇报')
  remember('b', '讨厌深夜打扰')
  assert(readMemory('b').length === 2, '追加两条后共 2 条')
  // 同内容去重（只留最新一条）
  remember('b', '用户喜欢简洁汇报')
  assert(readMemory('b').length === 2, '同内容去重后仍 2 条')

  // forget 按子串删除
  const f = forget('b', '讨厌')
  assert(f.removed === 1, 'forget 删除匹配条目')
  assert(readMemory('b').length === 1, 'forget 后剩 1 条')

  // ── charLimit 超限自动压缩（从最旧丢弃） ──
  createCharacter('c', { enabled: true, charLimit: 40 })
  // 每条内容足够长，让第 3 条写入即超限
  remember('c', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA 第一条')
  remember('c', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBB 第二条')
  const rc = remember('c', 'CCCCCCCCCCCCCCCCCCCCCCCCCCCC 第三条')
  assert(rc.dropped >= 1, `超限时应丢弃旧条目，实际 dropped=${rc.dropped}`)
  const after = readMemory('c')
  assert(after.length < 3, '压缩后条目数减少')
  assert(!after.some(e => e.content.includes('第一条')), '最旧的被丢弃')

  // ── maxEntries 条数上限 ──
  createCharacter('d', { enabled: true, charLimit: 10000, maxEntries: 2 })
  remember('d', '一')
  remember('d', '二')
  const rd = remember('d', '三')
  assert(rd.dropped >= 1, '条数超限丢弃最旧')
  assert(readMemory('d').length === 2, '条数上限 2')

  console.log('ALL MEMORY STORE TESTS PASSED')
  console.log('  final render sample:\n' + renderMemory(readMemory('d')))
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}

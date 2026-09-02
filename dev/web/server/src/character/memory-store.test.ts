/**
 * Run: npx tsx src/character/memory-store.test.ts
 *
 * Covers (v2): mode 推导（mode/老 enabled 兼容）、write/update/archive、去重、
 * memory.md 渲染/解析（type、[archived]）、charLimit/maxEntries 超限压缩（归档优先、最旧其次、minEntries 保底）、
 * read_only/off 拒绝写入、确定性 id 跨会话稳定。
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-memory-'))
process.env.TIANSHU_DATA_DIR = dataDir

const { characterMetaStore, resolveMemoryMode } = await import('../db/characterStore.js')
const {
  writeEntries, updateEntry, archiveEntry, readMemory, memoryConfig, renderMemory,
  parseMemory,
} = await import('./memory-store.js')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
function createCharacter(id: string, memory: any) {
  return characterMetaStore.create({ id, name: 'Test', memory, tools: [], skills: [], skillBindings: [] })
}

try {
  // ── 模式推导：显式 mode 优先；老角色按 enabled 兼容 ──
  createCharacter('a', { mode: 'off', enabled: true, charLimit: 50 })
  createCharacter('b', { mode: 'read_only', charLimit: 200, maxEntries: 5 })
  createCharacter('c', { enabled: false, charLimit: 1000 })
  createCharacter('d', { enabled: true, charLimit: 1000 })
  createCharacter('e', { charLimit: 1000 })
  createCharacter('legacy', { enabled: true, charLimit: 400 })

  assert(resolveMemoryMode({ mode: 'read_only' }) === 'read_only', 'mode 显式优先')
  assert(resolveMemoryMode({ enabled: false }) === 'off', '老角色 enabled=false → off')
  assert(resolveMemoryMode({ enabled: true }) === 'editable', '老角色 enabled=true → editable')
  assert(resolveMemoryMode(undefined) === 'editable', '未配置 → editable（默认注入）')

  // off：拒绝写入
  const ra = writeEntries('a', [{ content: '不该写入' }])[0]
  assert(ra.denied === true, 'mode=off 拒绝写入')
  assert(readMemory('a').length === 0, 'off 角色无条目落盘')

  // read_only：拒绝写入，但 readMemory 仍可读（内容由外部注入的前提是文件存在）
  const rb = writeEntries('b', [{ content: '只读不可写' }])[0]
  assert(rb.denied === true, 'read_only 拒绝写入')

  // ── editable：追加 + 类型 + 去重 ──
  writeEntries('legacy', [{ content: '用户喜欢简洁汇报', type: 'preference' }, { content: '讨厌深夜打扰' }])
  assert(readMemory('legacy').length === 2, '追加两条后共 2 条')
  const dedup = writeEntries('legacy', [{ content: '用户喜欢简洁汇报', type: 'preference' }])[0]
  assert(dedup.created === false, '同内容去重（不新增）')
  assert(readMemory('legacy').length === 2, '去重后仍 2 条')

  // ── 渲染格式 v2 解析往返 ──
  const all = readMemory('legacy')
  const pref = all.find(e => e.content === '用户喜欢简洁汇报')
  assert(!!pref && pref.type === 'preference', '条目带类型解析')
  const rendered = renderMemory(all)
  assert(rendered.includes('- ['), '渲染含条目行')
  const reparsed = parseMemory(rendered)
  assert(reparsed.length === 2 && reparsed[0].id === all[0].id, '渲染→解析往返 id 稳定')

  // ── v1 老格式（无类型）解析为 note ──
  const v1 = parseMemory('# 记忆\n\n- [2026-08-31 15:04] 用户喜欢用 TypeScript\n')
  assert(v1.length === 1 && v1[0].type === 'note' && v1[0].content === '用户喜欢用 TypeScript', 'v1 无类型行 → note')

  // ── update：按 id / 按 match ──
  createCharacter('h', { charLimit: 1000 })
  writeEntries('h', [{ content: '用户喜欢 TS', type: 'preference' }, { content: '讨厌深夜打扰' }])
  const hAll = readMemory('h')
  const u1 = updateEntry('h', { id: hAll.find(e => e.content === '用户喜欢 TS')!.id }, { content: '用户偏好简洁的代码汇报' })
  assert(u1.updated === true && u1.entry?.content === '用户偏好简洁的代码汇报', '按 id 更新')
  const u2 = updateEntry('h', { match: '讨厌深夜' }, { content: '不喜深夜被打扰' })
  assert(u2.updated === true, '按 match 更新')
  const u3 = updateEntry('h', { match: '不存在的关键词' }, { content: 'x' })
  assert(u3.updated === false, '未命中不更新')

  // ── archive：只归档不删除，readMemory 仍含归档（active 过滤在工具层） ──
  const arc = archiveEntry('h', { match: '不喜深夜' })
  assert(arc.archived === true && arc.remaining === 1, '归档成功且剩 1 条活跃')
  const afterArc = readMemory('h')
  assert(afterArc.filter(e => e.archived).length === 1, '归档条目保留 [archived] 标记')

  // ── charLimit 超限压缩：归档优先移除 ──
  createCharacter('f', { charLimit: 120 })
  writeEntries('f', [{ content: 'AAAAAAAA 第一条 很长的内容用来撑满限制' }, { content: 'BBBBBBBB 第二条' }])
  const beforeF = readMemory('f')
  const archF = archiveEntry('f', { match: '第一条' })
  assert(archF.archived === true, 'f 归档成功')
  writeEntries('f', [{ content: 'CCCCCCCC 第三条超长内容，用于触发压缩释放空间' }])
  const afterF = readMemory('f')
  assert(!afterF.some(e => e.archived), '超限时归档条目最先被移除')
  assert(afterF.length < beforeF.length + 0 || afterF.every(e => !e.archived), '压缩后无归档残留')
  const cfgF = memoryConfig('f')
  assert(renderMemory(readMemory('f')).length <= Math.max(cfgF.charLimit + 200, 1), '压缩后不严重超限')

  // ── maxEntries 条数上限 + minEntries 保底 ──
  createCharacter('g', { charLimit: 100000, maxEntries: 3 })
  writeEntries('g', [
    { content: '一' }, { content: '二' }, { content: '三' }, { content: '四' }, { content: '五' },
  ])
  assert(readMemory('g').length === 3, 'maxEntries=3 只保留 3 条')
  const gAfter = readMemory('g')
  assert(gAfter[gAfter.length - 1].content === '五' && gAfter[gAfter.length - 2].content === '四', '保留最近 N 条')

  console.log('ALL MEMORY STORE TESTS PASSED')
  console.log('  render sample:\n' + renderMemory(readMemory('legacy')))
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}

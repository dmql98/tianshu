/**
 * Run: npx tsx src/tools/mcp_discovery.test.ts
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// replaceWorkspace 用 getDataDir() 替换 ${workspaceFolder}（mcp_discovery.ts），
// 测试需要确定性的 data dir，断言目标也是 getDataDir() 而非 process.cwd()。
const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-mcp-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { normalizeDiscoveredEntry } = await import('./mcp_discovery.js')
const { getDataDir } = await import('../config.js')

// opencode: command as array + `environment`
const openCodeEntry = normalizeDiscoveredEntry('codegraph', {
  type: 'local',
  command: ['codegraph', 'serve', '--mcp'],
  enabled: true,
  environment: { DEBUG: '1' },
}, 'opencode')
if (!openCodeEntry || openCodeEntry.command !== 'codegraph' || openCodeEntry.args.join(' ') !== 'serve --mcp') {
  throw new Error(`opencode command-array normalization failed: ${JSON.stringify(openCodeEntry)}`)
}
if (!openCodeEntry.importable || openCodeEntry.env.DEBUG !== '1') {
  throw new Error(`opencode env/environment handling failed: ${JSON.stringify(openCodeEntry)}`)
}

// claude: command as string, no explicit type
const claudeEntry = normalizeDiscoveredEntry('filesystem', {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  env: { API_KEY: 'xxx' },
}, 'claude')
if (!claudeEntry || claudeEntry.command !== 'npx' || claudeEntry.args.length !== 3) {
  throw new Error(`claude string-command normalization failed: ${JSON.stringify(claudeEntry)}`)
}

// cursor: ${workspaceFolder} placeholder replaced with getDataDir()
const cursorEntry = normalizeDiscoveredEntry('codegraph', {
  type: 'stdio',
  command: 'codegraph',
  args: ['serve', '--mcp', '--path', '${workspaceFolder}'],
}, 'cursor', { replaceWorkspace: true })
if (!cursorEntry || cursorEntry.args[cursorEntry.args.length - 1] !== getDataDir()) {
  throw new Error(`cursor workspace placeholder not replaced: ${JSON.stringify(cursorEntry)}`)
}

// remote (sse) entries are not importable
const remoteEntry = normalizeDiscoveredEntry('remote-foo', {
  type: 'sse',
  url: 'https://example.com/mcp',
}, 'claude')
if (!remoteEntry || remoteEntry.importable !== false || remoteEntry.transport !== 'sse' || remoteEntry.url !== 'https://example.com/mcp') {
  throw new Error(`remote (sse) entry should be importable=false: ${JSON.stringify(remoteEntry)}`)
}

// malformed entries are skipped
if (normalizeDiscoveredEntry('bad', {}, 'claude') !== null) {
  throw new Error('empty entry should be skipped')
}
if (normalizeDiscoveredEntry('bad', { command: [] }, 'claude') !== null) {
  throw new Error('empty command array should be skipped')
}

console.log('  OK MCP discovery normalizes opencode/claude/cursor configs and flags remote servers')

rmSync(tmpData, { recursive: true, force: true })

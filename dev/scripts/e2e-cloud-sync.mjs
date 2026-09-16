/**
 * scripts/e2e-cloud-sync.mjs — 本机双实例云同步端到端演练。
 *
 * 场景：本机起 cloud-server（随机端口）+ 两个伪「桌面实例」（各自独立 dataDir，
 * 即双设备）。复用 desktop/src/cloud 的 scanner/pusher/puller 真实逻辑
 * （编译后 dist），验证：
 *   1. 实例 A 上传角色 → 实例 B 拉取 → 文件内容一致
 *   2. LWW：B 修改同名文件（更新 mtime）→ 上传 → A 拉取得到 B 版本
 *   3. 墓碑：B 删除实体 → A 拉取 → 本地目录被清理
 *   4. 拉取前备份：本地有修改时 .sync-backup/<stamp>/ 生成
 *   5. 配置同步：A 上传 config → B 下载
 *
 * 运行：node scripts/e2e-cloud-sync.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEV_ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'
const CLOUD_SERVER = 'C:\\Users\\dmql\\Desktop\\腾讯云\\腾讯云\\cloud-server'
const DESKTOP_DIST = join(DEV_ROOT, 'desktop', 'dist', 'desktop', 'src', 'cloud')

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// desktop tsc 编译产物是 CJS；这里用 createRequire 动态加载
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// electron stub（必须在 require dist 之前装好；CJS 缓存一次，故用可变指针）
globalThis.__e2eCurrentInstance = null
const electronStub = {
  app: { getPath: () => globalThis.__e2eCurrentInstance.dataDir },
  safeStorage: { isEncryptionAvailable: () => false },
}
const Module = (await import('node:module')).default
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub
  return origLoad.call(this, request, parent, isMain)
}

async function loadCloudModule() {
  const stateMod = require(join(DESKTOP_DIST, 'state.js'))
  const authMod = require(join(DESKTOP_DIST, 'auth.js'))
  const devicesMod = require(join(DESKTOP_DIST, 'devices.js'))
  const indexMod = require(join(DESKTOP_DIST, 'index.js'))
  return { stateMod, authMod, devicesMod, indexMod }
}

async function startCloudServer() {
  const dataDir = mkdtempSync(join(tmpdir(), 'e2e-cloud-'))
  const port = 21000 + Math.floor(Math.random() * 500)
  const proc = spawn('node', ['--experimental-strip-types', 'src/index.ts'], {
    cwd: CLOUD_SERVER,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      CLOUD_PORT: String(port),
      CLOUD_DB_PATH: join(dataDir, 'cloud.db'),
      CLOUD_BLOBS_DIR: join(dataDir, 'blobs'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  proc.stderr?.on('data', d => { stderr += String(d) })
  const base = `http://127.0.0.1:${port}`
  let ready = false
  for (let i = 0; i < 50 && !ready; i++) {
    try { ready = (await fetch(`${base}/health`)).status === 200 } catch { await new Promise(r => setTimeout(r, 200)) }
  }
  if (!ready) throw new Error(`cloud-server not ready: ${stderr.slice(-400)}`)
  return { base, stop: () => proc.kill() }
}

/** 伪桌面实例：独立 dataDir + 真实 CloudManager。绕过 electron app.getPath。 */
class FakeInstance {
  constructor(name, dataDir, cloudUrl) {
    this.name = name
    this.dataDir = dataDir
    this.cloudUrl = cloudUrl
  }

  async init(mods, { newUser }) {
    globalThis.__e2eCurrentInstance = this // electron stub 指向本实例
    const { indexMod } = mods
    this.manager = new indexMod.CloudManager(this.dataDir, () => 0)
    const username = 'user-alpha' // 同一账号、两台设备（多设备模型）
    const r = newUser
      ? await this.manager.register(this.cloudUrl, username, 'password-e2e-1')
      : await this.manager.login(this.cloudUrl, username, 'password-e2e-1')
    if (!r.ok) throw new Error(`auth failed: ${r.error}`)
  }

  /** 切换 stub 指针（跨实例调用前必须先 activate）。 */
  activate() {
    globalThis.__e2eCurrentInstance = this
  }

  seedCharacter(id, files) {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(this.dataDir, 'characters', id, rel)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
  }

  readCharacter(id, rel) {
    return readFileSync(join(this.dataDir, 'characters', id, rel), 'utf-8')
  }

  seedConfig(files) {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(this.dataDir, 'config', rel)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
  }
}

console.log('== e2e-cloud-sync ==')
const server = await startCloudServer()
const mods = await loadCloudModule()
console.log(`cloud-server: ${server.base}`)

try {
  // ── 实例准备 ──
  const dataA = mkdtempSync(join(tmpdir(), 'e2e-inst-a-'))
  const dataB = mkdtempSync(join(tmpdir(), 'e2e-inst-b-'))
  const a = new FakeInstance('Alpha', dataA, server.base)
  const b = new FakeInstance('Beta', dataB, server.base)
  await a.init(mods, { newUser: true })
  await b.init(mods, { newUser: false })
  console.log('\n[0] 双实例注册/登录')
  check('A 已登录（注册即登录）', a.manager.getState().phase === 'idle')
  check('B 已登录', b.manager.getState().phase === 'idle')

  // ── 1. A 上传角色 → B 拉取 ──
  console.log('\n[1] A 上传角色 → B 拉取')
  a.activate()
  a.seedCharacter('coder', { 'personality.md': 'you are a coder v1', 'memory.md': 'remember this' })
  const push1 = await a.manager.pushCharacter('coder')
  check('A push ok', push1.ok && push1.uploaded === 2, JSON.stringify(push1))
  b.activate()
  const pull1 = await b.manager.pullCharacters()
  check('B pull ok', pull1.ok && pull1.downloaded === 2, JSON.stringify(pull1))
  check('B 内容一致', b.readCharacter('coder', 'personality.md') === 'you are a coder v1')
  check('B memory 一致', b.readCharacter('coder', 'memory.md') === 'remember this')

  // ── 2. LWW：B 修改（mtime 更新）→ 上传 → A 拉取 ──
  console.log('\n[2] LWW 覆盖')
  await new Promise(r => setTimeout(r, 20))
  b.activate()
  b.seedCharacter('coder', { 'personality.md': 'you are a coder v2-B' })
  b.activate()
  const push2 = await b.manager.pushCharacter('coder')
  check('B push ok', push2.ok && push2.uploaded >= 1, JSON.stringify(push2))
  a.activate()
  const pull2 = await a.manager.pullCharacters()
  check('A pull ok', pull2.ok)
  check('A 得到 B 版本', a.readCharacter('coder', 'personality.md') === 'you are a coder v2-B')

  // ── 3. 拉取备份：A 本地再改 → B 传更新 → A 拉取时 .sync-backup 生成 ──
  console.log('\n[3] 拉取前备份 .sync-backup')
  a.activate()
  a.activate()
  a.seedCharacter('coder', { 'personality.md': 'local edit on A' })
  a.activate()
  const pull3 = await a.manager.pullCharacters()
  check('pull ok', pull3.ok)
  check('备份文件数 = 2', pull3.backedUp === 2, `backedUp=${pull3.backedUp}`)
  const backupRoot = join(dataA, '.sync-backup')
  check('.sync-backup 目录存在', existsSync(backupRoot))
  if (existsSync(backupRoot)) {
    const stamps = readdirSync(backupRoot)
    const allBackedUp = stamps.flatMap(stamp => {
      const dir = join(backupRoot, stamp)
      const out = []
      const walk = d => { for (const n of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, n.name)
        if (n.isDirectory()) walk(full); else out.push(full)
      } }
      walk(dir)
      return out
    })
    const found = allBackedUp.some(f => readFileSync(f, 'utf-8') === 'local edit on A')
    check('备份内容正确', found, `backed up files: ${allBackedUp.length}`)
  }
  check('A 内容被覆盖为 B 版', a.readCharacter('coder', 'personality.md') === 'you are a coder v2-B')

  // ── 4. 墓碑：B 删除实体 → A 拉取 → 本地清理 ──
  console.log('\n[4] 墓碑')
  // B 用 deviceToken 直接 DELETE（墓碑）
  b.activate()
  const dev = await b.manager.devices.ensureRegistered()
  const del = await fetch(`${server.base}/sync/entities/character/coder`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${dev.deviceToken}`, 'X-Device-Id': dev.deviceId },
  })
  check('B 删除实体 200', del.status === 200, `status=${del.status}`)
  const pull4 = await a.manager.pullCharacters()
  check('A pull ok（墓碑落地）', pull4.ok, JSON.stringify(pull4))
  check('A 本地角色目录已清理', !existsSync(join(dataA, 'characters', 'coder')))

  // ── 5. 配置同步 ──
  console.log('\n[5] 配置同步')
  a.activate()
  a.seedConfig({ 'theme.json': '{"mode":"dark"}' })
  a.activate()
  const push5 = await a.manager.pushConfig()
  check('A 上传配置', push5.ok && push5.uploaded === 1, JSON.stringify(push5))
  b.activate()
  const pull5 = await b.manager.pullConfig()
  check('B 下载配置', pull5.ok && pull5.downloaded === 1, JSON.stringify(pull5))
  check('B 配置内容一致', readFileSync(join(dataB, 'config', 'theme.json'), 'utf-8') === '{"mode":"dark"}')

} finally {
  server.stop()
}

console.log(`\n== 结果：${passed} passed, ${failed} failed ==`)
process.exit(failed > 0 ? 1 : 0)

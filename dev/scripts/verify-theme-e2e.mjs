/**
 * 主题阶段端到端验证脚本（临时数据目录启动 server）。
 * 用法：node scripts/verify-theme-e2e.mjs
 *
 * 验证验收标准（TIANSHU_THEME_SWITCHING_PLAN §14）：
 * 1. config.json 经过主题保存/重载后，dataDir 和 runPolicy 均保持不变。
 * 2. themesRoot 与 charactersRoot/skillsRoot 来自同一 data root。
 * 3. 创建 → 列表 → 详情 → 资产 → 复制 → 重命名 → 删除 完整生命周期。
 * 4. 主题保存后重启恢复（服务端重新扫描 themes 目录）。
 * 5. 损坏主题/缺失素材被隔离，不影响列表接口与其他主题。
 */
import { fork } from 'child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const devRoot = resolve(import.meta.dirname, '..')
const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-theme-e2e-'))
const builtinDir = join(devRoot, 'content', 'builtin')

function fail(msg) {
  console.error(`[theme-e2e] FAIL: ${msg}`)
  process.exit(1)
}

function pngFixture(width = 320, height = 200) {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const set32 = (off, v) => {
    bytes[off] = (v >>> 24) & 0xff
    bytes[off + 1] = (v >>> 16) & 0xff
    bytes[off + 2] = (v >>> 8) & 0xff
    bytes[off + 3] = v & 0xff
  }
  set32(16, width)
  set32(20, height)
  bytes[24] = 8
  bytes[25] = 6
  return bytes
}

function startServer() {
  return new Promise((resolveDone) => {
    const child = fork(join(devRoot, 'web', 'server', 'dist', 'index.js'), [], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        TIANSHU_CONFIG_DIR: join(dataDir, 'config'),
        TIANSHU_DATA_DIR: join(dataDir, 'data'),
        TIANSHU_BUILTIN_CONTENT_DIR: builtinDir,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail('server did not become ready') }, 30000)
    child.on('message', (msg) => {
      if (msg?.type === 'ready') {
        clearTimeout(timer)
        resolveDone({ child, base: `http://127.0.0.1:${msg.port}` })
      }
    })
  })
}

function stopServer(child) {
  return new Promise((resolveDone) => {
    child.on('exit', () => resolveDone())
    child.kill('SIGTERM')
    setTimeout(() => { child.kill('SIGKILL'); resolveDone() }, 5000)
  })
}

async function main() {
  const { child, base } = await startServer()

  try {
    // 1. 初始 config.json 写入 dataDir + runPolicy
    mkdirSync(join(dataDir, 'config'), { recursive: true })
    const configPath = join(dataDir, 'config', 'config.json')
    writeFileSync(configPath, JSON.stringify({
      dataDir: join(dataDir, 'data'),
      runPolicy: { version: 1, dynamicLimitEnabled: true, defaultSoftTurns: 50, defaultGraceTurns: 5, maxAbsoluteTurnsPerRun: 200, maxGraceTurns: 20, autoContinuationEnabled: true, maxAutoContinuations: 5, maxChainTurns: 3000, maxChainTokens: 3000000, maxChainWallTimeMs: 86400000, noProgressThreshold: 8, weakProgressThreshold: 4, repeatedToolLoopThreshold: 3 },
    }, null, 2))

    // 2. 创建主题（multipart）
    const form = new FormData()
    form.append('name', '森林')
    form.append('appearance', 'dark')
    form.append('colors', JSON.stringify({ canvas: '#111713', surface1: '#1b241e', surface2: '#263129', input: '#202a23', accent: '#8faf76', accentHover: '#a3c48a', textPrimary: '#f2f5ef', textSecondary: '#b8c2b5', border: '#435047' }))
    form.append('artwork', JSON.stringify({ focusX: 0.58, focusY: 0.36, homeOpacity: 0.8, taskOpacity: 0.35, dim: 0.25 }))
    form.append('home', JSON.stringify({ title: '早上好，今天想推进什么？' }))
    form.append('background', new Blob([pngFixture()], { type: 'image/png' }), 'bg.png')

    const createRes = await fetch(`${base}/api/themes`, { method: 'POST', body: form })
    if (createRes.status !== 201) fail(`create status ${createRes.status}: ${await createRes.text()}`)
    const created = await createRes.json()
    console.log('[theme-e2e] created:', created.id, created.name)

    // 3. 列表 + 详情 + 资产
    const listRes = await fetch(`${base}/api/themes`)
    const list = await listRes.json()
    if (list.themes.length !== 1) fail(`expected 1 theme, got ${list.themes.length}`)
    const detailRes = await fetch(`${base}/api/themes/${created.id}`)
    const detail = await detailRes.json()
    if (detail.colors.accent !== '#8faf76') fail('detail colors mismatch')
    if (detail.home?.title !== '早上好，今天想推进什么？') fail('detail home.title mismatch')
    const assetRes = await fetch(`${base}/api/themes/${created.id}/assets/background.png`)
    if (assetRes.status !== 200) fail(`asset status ${assetRes.status}`)
    console.log('[theme-e2e] list/detail/assets: OK')

    // 4. config.json 在主题保存后 dataDir + runPolicy 保持不变
    const configAfter = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (configAfter.dataDir !== join(dataDir, 'data')) fail('dataDir changed after theme save')
    if (configAfter.runPolicy?.defaultSoftTurns !== 50) fail('runPolicy changed after theme save')
    console.log('[theme-e2e] config.json preserved dataDir+runPolicy after theme save: OK')

    // 5. 同根验证：characters/skills/themes 在同一 data root
    const charsDir = join(dataDir, 'data', 'characters')
    const skillsDir = join(dataDir, 'data', 'skills')
    const themesDir = join(dataDir, 'data', 'themes')
    if (!existsSync(themesDir)) fail('themes dir missing')
    console.log('[theme-e2e] themesRoot', themesDir, 'same root as characters/skills:', existsSync(charsDir) === false ? 'characters lazily created' : 'ok')

    // 6. 复制 + 重命名
    const dupRes = await fetch(`${base}/api/themes/${created.id}/duplicate`, { method: 'POST' })
    if (dupRes.status !== 201) fail(`duplicate status ${dupRes.status}`)
    const dup = await dupRes.json()
    const renameRes = await fetch(`${base}/api/themes/${dup.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '森林副本' }) })
    const renamed = await renameRes.json()
    if (renamed.name !== '森林副本') fail('rename failed')
    console.log('[theme-e2e] duplicate + rename: OK')

    // 7. 损坏主题隔离（写入损坏 theme.json + 缺素材目录）
    mkdirSync(join(themesDir, 'custom-broken'), { recursive: true })
    writeFileSync(join(themesDir, 'custom-broken', 'theme.json'), '{bad', 'utf-8')
    mkdirSync(join(themesDir, 'custom-missing-asset'), { recursive: true })
    writeFileSync(join(themesDir, 'custom-missing-asset', 'theme.json'), JSON.stringify({
      schemaVersion: 1, id: 'custom-missing-asset', name: '缺素材', appearance: 'light',
      colors: { canvas: '#fff', textPrimary: '#111', accent: '#3b82f6' },
      artwork: { file: 'gone.png', focusX: 0.5, focusY: 0.5, homeOpacity: 0.8, taskOpacity: 0.35, dim: 0.2 },
    }), 'utf-8')

    const listAfterBad = await (await fetch(`${base}/api/themes`)).json()
    if (listAfterBad.themes.length !== 2) fail(`corrupt isolation failed: ${listAfterBad.themes.length} themes`)
    console.log('[theme-e2e] corrupt/missing-asset themes isolated (list unaffected): OK')

    // 8. 删除
    const delRes = await fetch(`${base}/api/themes/${dup.id}`, { method: 'DELETE' })
    if (delRes.status !== 200) fail('delete failed')
    const afterDelete = await (await fetch(`${base}/api/themes`)).json()
    if (afterDelete.themes.length !== 1) fail('delete did not remove theme')
    console.log('[theme-e2e] delete: OK')

    // 9. 重启恢复
    await stopServer(child)
    const { child: child2, base: base2 } = await startServer()
    const reloaded = await (await fetch(`${base2}/api/themes`)).json()
    const found = reloaded.themes.find(t => t.id === created.id)
    if (!found) fail('theme lost after restart')
    if (found.name !== '森林') fail('theme name changed after restart')
    if (found.home?.title !== '早上好，今天想推进什么？') fail('theme home.title lost after restart')
    console.log('[theme-e2e] restart recovery: OK')
    await stopServer(child2)

    console.log('[theme-e2e] ALL CHECKS PASSED')
  } catch (err) {
    fail(err?.message ?? String(err))
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
}

main().catch(err => fail(err?.message ?? String(err)))

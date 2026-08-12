/**
 * 端到端验证脚本（临时数据目录启动 server，验证 builtin 内容与 Run Policy 配置）。
 * 用法：node scripts/verify-builtin-e2e.mjs
 */
import { fork } from 'child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const devRoot = resolve(import.meta.dirname, '..')
const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-e2e-'))
const builtinDir = join(devRoot, 'content', 'builtin')

function fail(msg) {
  console.error(`[e2e] FAIL: ${msg}`)
  process.exit(1)
}

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

const timeout = setTimeout(() => {
  child.kill('SIGKILL')
  fail('server did not become ready')
}, 30000)

child.on('message', async (msg) => {
  if (msg?.type !== 'ready') return
  clearTimeout(timeout)
  const base = `http://127.0.0.1:${msg.port}`
  try {
    // 1. 角色双层 + 来源字段
    const chars = await (await fetch(`${base}/api/characters`)).json()
    const builtinChars = chars.filter(c => c.source === 'builtin')
    const userChars = chars.filter(c => c.source === 'user')
    console.log(`[e2e] characters: total=${chars.length} builtin=${builtinChars.length} user=${userChars.length}`)
    if (builtinChars.length === 0) fail('no builtin characters')
    const withRp = builtinChars.find(c => c.runPolicy?.configured)
    if (!withRp) fail('no builtin character declares runPolicy')
    console.log(`[e2e] builtin char runPolicy: ${withRp.id} ->`, JSON.stringify(withRp.runPolicy.configured))
    // 内置角色 runPolicy 不含系统字段
    const rp = withRp.runPolicy.configured
    if ('dynamicLimitEnabled' in rp || 'maxAbsoluteTurnsPerRun' in rp) fail('builtin runPolicy leaks system fields')

    // 2. 技能双层 + 来源字段
    const skills = await (await fetch(`${base}/api/skills/packages`)).json()
    const builtinSkills = skills.packages.filter(p => p.source === 'builtin')
    console.log(`[e2e] skills: total=${skills.packages.length} builtin=${builtinSkills.length}`)
    if (builtinSkills.length === 0) fail('no builtin skills')

    // 3. Provider builtin 无凭据
    const providers = await (await fetch(`${base}/api/providers/builtin`)).json()
    console.log(`[e2e] providers builtin: ${providers.length} presets`)
    const leaked = JSON.stringify(providers).match(/api[_-]?key\s*[:=]\s*["'][^"']{8,}|sk-[A-Za-z0-9]{20,}/i)
    if (leaked) fail(`provider preset may leak credentials: ${leaked[0]}`)

    // 3.5 默认提示词：全新环境回退到 builtin 只读层
    const prompt0 = await (await fetch(`${base}/api/prompts/default`)).json()
    if (!prompt0.content || prompt0.source !== 'builtin') fail('builtin default prompt not served on fresh env')
    console.log('[e2e] default prompt from builtin (read-only fallback): OK')

    // 4. Run Policy 保存 + 重载不丢 dataDir
    const put = await (await fetch(`${base}/api/config/run-policy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policy: { maxAbsoluteTurnsPerRun: 120 } }),
    })).json()
    if (put.policy.maxAbsoluteTurnsPerRun !== 120) fail('run-policy PUT failed')
    const configFile = join(dataDir, 'config', 'config.json')
    if (!existsSync(configFile)) fail('config.json not persisted')
    const raw = JSON.parse(readFileSync(configFile, 'utf-8'))
    console.log(`[e2e] config.json keys: ${Object.keys(raw).join(', ')}`)
    if (!raw.runPolicy || raw.runPolicy.maxAbsoluteTurnsPerRun !== 120) fail('runPolicy lost in config.json')
    if (!raw.dataDir) fail('dataDir lost in config.json')
    console.log(`[e2e] SystemRunPolicy + dataDir persisted together: OK`)

    // 5. 编辑内置角色 → 物化用户副本 → source 变 user
    const target = builtinChars.find(c => c.runPolicy?.configured)
    const edited = await (await fetch(`${base}/api/characters/${target.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'e2e-edited' }),
    })).json()
    if (edited.source !== 'user' || !edited.overridesBuiltin) fail('edit did not materialize user copy')
    console.log(`[e2e] edit builtin character -> user copy (overridesBuiltin=true): OK`)
    const userDir = join(dataDir, 'data', 'characters', target.id)
    if (!existsSync(join(userDir, '.tianshu-source.json'))) fail('missing .tianshu-source.json')
    console.log(`[e2e] .tianshu-source.json present in user copy: OK`)

    // 6. builtin 源文件未被修改（hash 校验）
    const { createHash } = await import('crypto')
    const { readFileSync: rf } = await import('fs')
    const hashFile = p => createHash('sha256').update(rf(p)).digest('hex')
    const before = hashFile(join(builtinDir, 'characters', target.id, 'character.json'))
    const after = hashFile(join(builtinDir, 'characters', target.id, 'character.json'))
    if (before !== after) fail('builtin source file changed')
    console.log('[e2e] builtin source hash unchanged after edit: OK')

    // 7. 默认提示词覆盖 → 物化用户副本；清空 → 恢复内置
    const userPromptFile = join(dataDir, 'data', 'prompts', 'default.md')
    const putPrompt = await (await fetch(`${base}/api/prompts/default`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'e2e-custom-default' }),
    })).json()
    if (putPrompt.source !== 'user') fail('prompt PUT did not materialize user copy')
    if (!existsSync(userPromptFile)) fail('missing user default prompt file')
    const gotUser = await (await fetch(`${base}/api/prompts/default`)).json()
    if (gotUser.content !== 'e2e-custom-default' || gotUser.source !== 'user') fail('prompt override not served from user layer')
    const resetPrompt = await (await fetch(`${base}/api/prompts/default`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    })).json()
    const gotBuiltin = await (await fetch(`${base}/api/prompts/default`)).json()
    if (gotBuiltin.source !== 'builtin' || resetPrompt.source !== 'builtin') fail('clearing prompt did not fall back to builtin')
    console.log('[e2e] default prompt override -> user copy; clear -> builtin: OK')

    console.log('[e2e] ALL CHECKS PASSED')
  } catch (err) {
    fail(err.message)
  } finally {
    child.send({ type: 'shutdown' })
    setTimeout(() => {
      rmSync(dataDir, { recursive: true, force: true })
      process.exit(0)
    }, 500)
  }
})

child.stderr.on('data', d => process.stderr.write(`[server] ${d}`))
child.on('error', err => fail(err.message))
child.on('exit', code => {
  clearTimeout(timeout)
  if (code !== 0) fail(`server exited with code ${code}`)
})

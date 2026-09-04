// Smoke test for the pwsh close-settle fix (mirror of bash settle.smoke.ts).
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-pwsh-settle-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { tool } = await import('./index.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const ctx = { workspace: tmpData, workspaces: [tmpData] }

const bgHoldCmd = process.platform === 'win32'
  ? 'Write-Output "done"; Start-Process -NoNewWindow powershell -ArgumentList "-NoProfile","-Command","Start-Sleep -Seconds 10"'
  : 'echo done; sleep 10 &'

try {
  {
    const startedAt = Date.now()
    const res = await tool.execute({ command: 'Write-Output hello' }, ctx)
    const dt = Date.now() - startedAt
    assert(!res.error, 'normal pwsh exit has no error')
    assert(res.output.includes('hello'), 'stdout captured')
    assert(dt < 3000, `normal pwsh command must settle fast (took ${dt}ms)`)
    console.log(`  OK normal settles in ${dt}ms`)
  }
  {
    const startedAt = Date.now()
    const res = await tool.execute({ command: bgHoldCmd, timeout_seconds: '8' }, ctx)
    const dt = Date.now() - startedAt
    assert(dt < 8000, `bg-hold must settle well before the bg sleep ends (took ${dt}ms)`)
    console.log(`  OK bg-hold settles in ${dt}ms`)
  }
} finally {
  // 后台 powershell 可能仍持有工作目录句柄，删除容忍 EPERM。
  try { rmSync(tmpData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch { /* best effort */ }
}

console.log('ALL PWSH CLOSE-SETTLE TESTS PASSED')

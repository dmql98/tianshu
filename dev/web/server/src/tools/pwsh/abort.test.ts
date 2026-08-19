import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { tool } from './index.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

const workspace = mkdtempSync(join(tmpdir(), 'tianshu-pwsh-abort-'))
const marker = join(workspace, 'survived.txt')
const controller = new AbortController()

// A PowerShell-style command that writes a marker after a delay, then stays
// alive so we can verify the abort actually kills the process tree.
const command = process.platform === 'win32'
  ? 'Start-Sleep -Seconds 2; "yes" | Out-File -FilePath survived.txt; while ($true) { Start-Sleep -Seconds 1 }'
  : 'sleep 2; echo yes > survived.txt; while true; do sleep 1; done'

try {
  const startedAt = Date.now()
  const execution = tool.execute({ command }, {
    workspace,
    workspaces: [workspace],
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 300)
  const result = await execution
  assert(result.error?.includes('Aborted') || result.error?.includes('abort'), 'aborted pwsh returns an explicit error')
  assert(Date.now() - startedAt < 8000, 'aborted pwsh settles promptly')
  await new Promise(resolve => setTimeout(resolve, 2800))
  assert(!existsSync(marker), 'the spawned process tree is no longer running after abort')
  console.log('ALL PWSH ABORT TESTS PASSED')
} finally {
  rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

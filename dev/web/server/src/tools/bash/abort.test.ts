import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { tool } from './index.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

const workspace = mkdtempSync(join(tmpdir(), 'tianshu-bash-abort-'))
const marker = join(workspace, 'survived.txt')
const controller = new AbortController()

try {
  const startedAt = Date.now()
  const execution = tool.execute({
    command: `node -e "setTimeout(()=>require('fs').writeFileSync('survived.txt','yes'),2500);setInterval(()=>{},1000)"`,
  }, {
    workspace,
    workspaces: [workspace],
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 300)
  const result = await execution
  assert(result.error?.includes('Aborted'), 'aborted bash returns an explicit error')
  assert(Date.now() - startedAt < 8000, 'aborted bash settles promptly')
  await new Promise(resolve => setTimeout(resolve, 2800))
  assert(!existsSync(marker), 'the spawned process tree is no longer running')
  console.log('ALL BASH ABORT TESTS PASSED')
} finally {
  rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

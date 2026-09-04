// Smoke test for the bash close-settle fix. Run: npx tsx src/tools/bash/settle.smoke.ts
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-bash-settle-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { tool } = await import('./index.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const ctx = { workspace: tmpData, workspaces: [tmpData] }

try {
  // 1. normal command settles fast
  {
    const startedAt = Date.now()
    const res = await tool.execute({ command: 'echo hello' }, ctx)
    const dt = Date.now() - startedAt
    assert(!res.error, 'normal exit has no error')
    assert(res.output.includes('hello'), 'stdout captured')
    assert(dt < 3000, `normal command must settle fast (took ${dt}ms)`)
    console.log(`  OK normal settles in ${dt}ms`)
  }

  // 2. command that exits but leaves a background process holding stdout/stderr
  //    pipes -> previously 'close' never fired and the tool hung until the bg
  //    process died. Now it must settle within the exit grace window.
  {
    const startedAt = Date.now()
    const res = await tool.execute({ command: 'echo done; sleep 10 &' }, ctx)
    const dt = Date.now() - startedAt
    assert(!res.error, 'bg-hold command is not a tool error')
    assert(res.output.includes('done'), 'stdout captured before settle')
    assert(dt < 5000, `bg-hold command must settle before the bg sleep ends (took ${dt}ms)`)
    console.log(`  OK bg-hold settles in ${dt}ms (was: hang until sleep 10 finished)`)
  }

  // 3. non-zero exit still marked
  {
    const res = await tool.execute({ command: 'echo before-fail; exit 5' }, ctx)
    assert(!res.error, 'non-zero exit is not a tool error')
    assert(res.output.includes('[exit code: 5]'), 'exit code marker present')
    console.log('  OK non-zero exit marked')
  }

  // 4. non-zero exit + bg pipe holder (same fix, different code path)
  {
    const startedAt = Date.now()
    const res = await tool.execute({ command: 'echo x; sleep 10 & exit 3' }, ctx)
    const dt = Date.now() - startedAt
    assert(!res.error, 'bg-hold non-zero is not a tool error')
    assert(res.output.includes('[exit code: 3]'), 'exit code marker present')
    assert(dt < 5000, `bg-hold non-zero settles fast (took ${dt}ms)`)
    console.log(`  OK bg-hold non-zero settles in ${dt}ms`)
  }
} finally {
  rmSync(tmpData, { recursive: true, force: true })
}

console.log('ALL BASH CLOSE-SETTLE TESTS PASSED')

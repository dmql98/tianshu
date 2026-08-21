/**
 * Run: npx tsx src/tools/pwsh/pwsh-exit.test.ts
 *
 * Covers: pwsh mirrors bash — a command that finishes with a non-zero exit
 * code is the COMMAND's outcome, not a tool failure; the exit code is surfaced
 * as an output marker instead of an error.
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-pwsh-exit-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { tool } = await import('./index.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const ctx = { workspace: tmpData, workspaces: [tmpData] }

try {
  // ---- success path unchanged ------------------------------------------------
  {
    const res = await tool.execute({ command: 'Write-Output hello' }, ctx)
    assert(!res.error, 'exit 0 has no error')
    assert(res.output.includes('hello'), 'stdout captured')
    assert(!res.output.includes('[exit code:'), 'no marker on success')
    console.log('  OK success path unchanged')
  }

  // ---- non-zero exit: marked success, not an error ---------------------------
  {
    const res = await tool.execute({ command: 'Write-Output before-fail; exit 5' }, ctx)
    assert(!res.error, 'non-zero exit is not a tool error')
    assert(res.output.includes('[exit code: 5]'), 'exit code marker present')
    assert(res.output.includes('before-fail'), 'stdout preserved alongside marker')
    console.log('  OK non-zero exit degrades to marked success')
  }
} finally {
  rmSync(tmpData, { recursive: true, force: true })
}

console.log('ALL PWSH EXIT-CODE TESTS PASSED')

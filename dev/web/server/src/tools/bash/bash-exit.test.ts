/**
 * Run: npx tsx src/tools/bash/bash-exit.test.ts
 *
 * Covers: a command that finishes with a non-zero exit code is the COMMAND's
 * outcome, not a tool failure — no `error`, exit code surfaced as an output
 * marker. Probe commands (ls/grep/test on missing paths) must not poison doom
 * detection or is_error bookkeeping (session mt2i2ie348v2tb).
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-bash-exit-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { tool } = await import('./index.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const ctx = { workspace: tmpData, workspaces: [tmpData] }

try {
  // ---- success path unchanged ------------------------------------------------
  {
    const res = await tool.execute({ command: 'echo hello' }, ctx)
    assert(!res.error, 'exit 0 has no error')
    assert(res.output.includes('hello'), 'stdout captured')
    assert(!res.output.includes('[exit code:'), 'no marker on success')
    console.log('  OK success path unchanged')
  }

  // ---- non-zero exit: marked success, not an error ---------------------------
  {
    const res = await tool.execute({ command: 'echo before-fail; exit 5' }, ctx)
    assert(!res.error, 'non-zero exit is not a tool error')
    assert(res.output.includes('[exit code: 5]'), 'exit code marker present')
    assert(res.output.includes('before-fail'), 'stdout preserved alongside marker')
    console.log('  OK non-zero exit degrades to marked success')
  }

  // ---- probe on missing path: stderr visible, still not an error -------------
  {
    const res = await tool.execute({ command: 'ls ./definitely-missing-path-xyz' }, ctx)
    assert(!res.error, 'probe on missing path is not a tool error')
    assert(res.output.includes('[exit code:'), 'probe carries exit code marker')
    console.log('  OK probe-style non-zero exit stays clean')
  }
} finally {
  rmSync(tmpData, { recursive: true, force: true })
}

console.log('ALL BASH EXIT-CODE TESTS PASSED')

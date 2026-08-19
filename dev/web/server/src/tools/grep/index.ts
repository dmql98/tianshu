import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { resolve } from 'path'
import type { ToolModule } from '../types.js'
import { assertPathSafe } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'

const MAX_RESULTS = 200
const execFileP = promisify(execFile)

// Async ripgrep via execFile (no shell) so a long search never blocks the event
// loop. 30s hard timeout + caller AbortSignal for cancellation.
async function grepRipgrep(pattern: string, dir: string, include: string | undefined, signal?: AbortSignal): Promise<string> {
  const args = ['-n', '--no-heading', '--color', 'never', '-S']
  if (include) args.push('-g', include)
  args.push(pattern, dir)
  try {
    const res = await (execFileP('rg', args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
      killSignal: 'SIGKILL',
      windowsHide: true,
      encoding: 'utf-8',
      signal,
    } as any) as Promise<{ stdout: string | Buffer; stderr: string | Buffer }>)
    const stdout = Buffer.isBuffer(res.stdout) ? res.stdout.toString('utf-8') : res.stdout
    const lines = stdout.trim().split('\n').filter(Boolean)
    if (lines.length === 0) return 'No matches found'
    if (lines.length > MAX_RESULTS) {
      return lines.slice(0, MAX_RESULTS).join('\n') + `\n\n... (${lines.length - MAX_RESULTS} more matches. Narrow your search with a more specific pattern or use include filter)`
    }
    return lines.join('\n')
  } catch (e: any) {
    if (signal?.aborted) return 'grep aborted'
    if (e?.code === 1 || e?.status === 1) return 'No matches found'
    return `grep error: ${e?.message || e}`
  }
}

export const tool: ToolModule = {
  name: 'grep',
  description: 'Search file contents using a regex pattern (powered by ripgrep, auto-ignores .git/node_modules)',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern' },
      path: { type: 'string', description: 'Directory to search, relative to workspace (optional)' },
      include: { type: 'string', description: 'File glob filter (e.g. "*.ts", "*.{ts,js}")' },
    },
    required: ['pattern'],
  },
  execute: async (args, { workspace, workspaces, allowedRoots, signal }) => {
    const input = validate(
      z.object({
        pattern: z.string().min(1, 'pattern 不能为空'),
        path: z.string().optional(),
        include: z.string().optional(),
      }),
      args, 'grep',
    )

    const dir = input.path ? (assertPathSafe(input.path, workspaces ?? [workspace], allowedRoots), resolve(workspace, input.path)) : workspace
    if (!existsSync(dir)) return { output: `Directory not found: ${input.path || '.'}` }

    return { output: await grepRipgrep(input.pattern, dir, input.include, signal) }
  },
}

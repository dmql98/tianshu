import { spawn, execSync } from 'child_process'
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs'
import { resolve as pathResolve } from 'path'
import type { ToolModule } from '../types.js'
import { assertPathSafe } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { getOutputDir } from '../truncate.js'
import * as iconv from 'iconv-lite'

let consoleEncoding = 'utf8'
try {
  if (process.platform === 'win32') {
    const cp = execSync('chcp.com', { encoding: 'utf8', timeout: 2000 })
    const m = cp.match(/:(\d+)/)
    if (m) {
      const codePage = parseInt(m[1])
      if (codePage === 936) consoleEncoding = 'cp936'
      else if (codePage === 950) consoleEncoding = 'cp950'
      else if (codePage === 932) consoleEncoding = 'cp932'
      else if (codePage === 949) consoleEncoding = 'cp949'
      else if (codePage === 65001) consoleEncoding = 'utf8'
    }
  }
} catch { /* keep utf8 */ }

function decodeBuffer(buf: Buffer): string {
  if (consoleEncoding === 'utf8') return buf.toString('utf8')
  return iconv.decode(buf, consoleEncoding)
}

const LOG_DIR = pathResolve(process.cwd(), 'data', 'bash-logs')
function logBash(sessionId: string | undefined, cmd: string, stdout: string, stderr: string, exitCode: number | null, duration: number) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
    const name = `bash_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${Math.random().toString(36).slice(2, 6)}.log`
    const filePath = pathResolve(LOG_DIR, name)
    const lines = [
      `# bash log — ${new Date().toLocaleString()}`,
      `# session: ${sessionId || '(none)'}`,
      `# exit: ${exitCode ?? '(null)'}  duration: ${duration}ms`,
      `# command:`,
      cmd,
      stdout ? `\n# stdout (${stdout.length} chars):` : '',
      stdout,
      stderr ? `\n# stderr (${stderr.length} chars):` : '',
      stderr,
    ].join('\n')
    writeFileSync(filePath, lines, 'utf-8')
  } catch { /* best effort */ }
}

const WIN_ABS_PATH_RE = /[A-Za-z]:\\[^\s"'|&;<>(){}[\]`~!@#$%^&*=+]+/g

const PATH_TOKEN_RE = /(?:^|\s+)((?:~\/|\.\.\/|\/|[A-Za-z]:\\)[\S]*)/g
const QUOTED_PATH_RE = /["']((?:~\/|\.\.\/|\/|[A-Za-z]:\\)[^"']*)["']/g

function scanCommandPaths(cmd: string, workspaces: string[], allowedRoots?: string[]): void {
  let m: RegExpExecArray | null
  QUOTED_PATH_RE.lastIndex = 0
  while ((m = QUOTED_PATH_RE.exec(cmd)) !== null) {
    assertPathSafe(m[1], workspaces, allowedRoots)
  }
  PATH_TOKEN_RE.lastIndex = 0
  while ((m = PATH_TOKEN_RE.exec(cmd)) !== null) {
    const p = m[1]
    if (p.includes('=') || p.startsWith('-')) continue
    if (process.platform === 'win32' && /^\/[A-Za-z?](?:[:=][^\\/]*)?$/i.test(p)) continue
    // Skip Windows cmd flags like /f, /im, /t — these are not file paths
    if (process.platform === 'win32' && /^\/[A-Za-z][A-Za-z0-9]*$/.test(p)) continue
    const before = cmd.slice(0, m.index)
    const quotes = (before.match(/["']/g) || []).length
    if (quotes % 2 !== 0) continue
    assertPathSafe(p, workspaces, allowedRoots)
  }
}
const MAX_OUTPUT = 1024 * 1024
const TAIL_SIZE = 50 * 1024
const TIMEOUT_MS = 60000
const FORCE_KILL_MS = 3000

const TEMP_DIR = getOutputDir()

interface ShellInfo {
  path: string
  args: string[]
}

function getShellCandidates(): ShellInfo[] {
  if (process.platform !== 'win32') {
    const sh = process.env.SHELL || '/bin/sh'
    return [{ path: sh, args: ['-c'] }]
  }

  const candidates: ShellInfo[] = []
  const comspec = process.env.ComSpec
  if (comspec) candidates.push({ path: comspec, args: ['/d', '/s', '/c'] })
  candidates.push(
    { path: 'cmd.exe', args: ['/d', '/s', '/c'] },
    { path: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c'] },
    { path: 'C:\\Windows\\Sysnative\\cmd.exe', args: ['/d', '/s', '/c'] },
    { path: 'powershell.exe', args: ['-NoProfile', '-Command'] },
    { path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoProfile', '-Command'] },
  )
  return candidates
}

function twoStageKill(child: import('child_process').ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.killed) return
  child.kill(signal)
  if (FORCE_KILL_MS > 0) {
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
    }, FORCE_KILL_MS)
  }
}

function trySpawn(shell: ShellInfo, cmd: string, workspace: string, windowsHide: boolean): Promise<{ child: import('child_process').ChildProcess; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(shell.path, [...shell.args, cmd], {
        cwd: workspace,
        windowsHide,
        windowsVerbatimArguments: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let settled = false
      const onError = (err: Error) => {
        if (!settled) { settled = true; reject(err) }
      }
      const onOpen = () => {
        if (!settled) { settled = true; resolve({ child, cleanup: () => { child.removeListener('error', onError) } }) }
      }
      child.on('error', onError)
      child.on('spawn', () => { if (!settled) { settled = true; resolve({ child, cleanup: () => { child.removeListener('error', onError) } }) } })
      setTimeout(() => { if (!settled) { settled = true; resolve({ child, cleanup: () => { child.removeListener('error', onError) } }) } }, 500)
    } catch (err: any) {
      reject(err)
    }
  })
}

export const tool: ToolModule = {
  name: 'bash',
  description: 'Execute a shell command in the workspace directory',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string', description: 'Shell command to execute' } },
    required: ['command'],
  },
  dangerous: true,
  execute: async (args, { workspace, workspaces, signal, allowedRoots, onOutput }) => {
    const input = validate(
      z.object({ command: z.string().min(1, 'command 不能为空') }),
      args, 'bash',
    )
    const cmd = input.command
    const roots = workspaces ?? [workspace]
    scanCommandPaths(cmd, roots, allowedRoots)
    const absPaths = cmd.match(WIN_ABS_PATH_RE)
    if (absPaths) {
      for (const raw of absPaths) {
        assertPathSafe(raw, roots, allowedRoots)
      }
    }

    const shellCandidates = getShellCandidates()

    let lastError: string | undefined

    for (const shell of shellCandidates) {
      try {
        const shellCwd = workspace && existsSync(workspace) ? workspace : process.cwd()
        const { child, cleanup } = await trySpawn(shell, cmd, shellCwd, true)
        cleanup()

        return new Promise((resolvePromise) => {
          let stdout = ''
          let stderr = ''
          let fullStdout = ''
          let fullStderr = ''
          let truncated = false
          let writtenOnce = false
          const startTime = Date.now()

          const timeoutId = setTimeout(() => {
            const msg = '\n[Timeout: command exceeded 60000ms]'
            stderr += msg
            onOutput?.(msg)
            twoStageKill(child)
          }, TIMEOUT_MS)

          const abortHandler = () => {
            clearTimeout(timeoutId)
            const msg = '\n[Aborted]'
            stderr += msg
            onOutput?.(msg)
            twoStageKill(child)
            // Force resolve even if child process doesn't die
            setTimeout(() => {
              if (!child.killed) child.kill('SIGKILL')
              const combined = (fullStdout || stdout) + (stderr ? `\n${stderr}` : '')
              resolvePromise({ output: combined.trim(), error: stderr.trim() || 'Aborted' })
            }, FORCE_KILL_MS + 1000)
          }
          signal?.addEventListener('abort', abortHandler, { once: true })
          if (signal?.aborted) abortHandler()

          function ensureOutputFile(stdoutFull: string, stderrFull: string): string | null {
            if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })
            const name = `bash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.log`
            const filePath = pathResolve(TEMP_DIR, name)
            try {
              writeFileSync(filePath, stdoutFull)
              if (stderrFull) appendFileSync(filePath, `\n${stderrFull}`)
              writtenOnce = true
              return filePath
            } catch {
              return null
            }
          }

          function appendOutput(buf: Buffer, isStdout: boolean) {
            const chunk = decodeBuffer(buf)
            const target = isStdout ? stdout : stderr

            if (isStdout) fullStdout += chunk
            else fullStderr += chunk

            if (truncated) {
              onOutput?.(chunk)
              return
            }

            const nextLen = target.length + chunk.length
            if (nextLen > MAX_OUTPUT) {
              const fullBefore = (isStdout ? stdout : stderr) + chunk
              const other = isStdout ? stderr : stdout

              const filePath = ensureOutputFile(
                isStdout ? fullBefore : stdout,
                isStdout ? stderr : fullBefore,
              )
              const pathNote = filePath ? ` (saved: ${filePath})` : ''

              const msg = `\n[Output exceeds 1MB, showing last 50KB${pathNote}]`
              truncated = true

              if (isStdout) {
                stdout = fullBefore.slice(-TAIL_SIZE) + msg
              } else {
                stderr = fullBefore.slice(-TAIL_SIZE) + msg
              }
              onOutput?.(chunk)
              onOutput?.(msg)
              return
            }

            if (isStdout) stdout += chunk
            else stderr += chunk
            onOutput?.(chunk)
          }

          child.stdout!.on('data', (data: Buffer) => appendOutput(data, true))
          child.stderr!.on('data', (data: Buffer) => appendOutput(data, false))

          child.on('error', (err: Error) => {
            clearTimeout(timeoutId)
            signal?.removeEventListener('abort', abortHandler)
            logBash('', cmd, fullStdout, fullStderr, null, Date.now() - startTime)
            resolvePromise({ output: stdout, error: err.message })
          })

          child.on('close', (code) => {
            clearTimeout(timeoutId)
            signal?.removeEventListener('abort', abortHandler)
            const duration = Date.now() - startTime
            logBash('', cmd, fullStdout, fullStderr, code, duration)
            const combined = stdout + (stderr ? `\n${stderr}` : '')
            if (code === 0 || (code === null && stdout)) {
              resolvePromise({ output: combined.trim() })
            } else {
              resolvePromise({ output: stdout.trim(), error: stderr.trim() || `Exit code: ${code}` })
            }
          })
        })
      } catch (err: any) {
        lastError = err.message
      }
    }

    return { output: '', error: lastError || 'No shell available' }
  },
}

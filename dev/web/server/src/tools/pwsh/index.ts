import { spawn, spawnSync, execFileSync } from 'child_process'
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs'
import { resolve as pathResolve } from 'path'
import type { ToolModule } from '../types.js'
import { assertPathSafe } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { getOutputDir } from '../truncate.js'
import { getDataDir } from '../../config.js'
import { maybeRtkWrap } from '../rtk.js'
import * as iconv from 'iconv-lite'

let consoleEncoding = 'utf8'
try {
  if (process.platform === 'win32') {
    const cp = execFileSync('chcp.com', { encoding: 'utf8', timeout: 2000 })
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

const MAX_OUTPUT = 1024 * 1024
const TAIL_SIZE = 50 * 1024
const DEFAULT_TIMEOUT_MS = 60000
const FORCE_KILL_MS = 3000

const TEMP_DIR = getOutputDir()

interface ShellInfo {
  path: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

// PowerShell 是 Windows 原生 shell：模型用 $env:NAME、C:\... 原生路径、管道/对象语义，
// 用 bash 语法写会报错。候选链固定为 powershell.exe / pwsh.exe（Windows），/bin/sh 兜底。
function getShellCandidates(): ShellInfo[] {
  if (process.platform !== 'win32') {
    const sh = process.env.SHELL || '/bin/sh'
    return [{ path: sh, args: ['-c'] }]
  }
  const comspec = process.env.ComSpec
  return [
    { path: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'], windowsVerbatimArguments: false },
    { path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'], windowsVerbatimArguments: false },
    { path: 'pwsh.exe', args: ['-NoProfile', '-NonInteractive', '-Command'], windowsVerbatimArguments: false },
    ...(comspec ? [{ path: comspec, args: ['/d', '/s', '/c'] as string[], windowsVerbatimArguments: true } as ShellInfo] : []),
  ]
}

function isProcessRunning(child: import('child_process').ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

function killProcessTree(child: import('child_process').ChildProcess, force = false) {
  if (!isProcessRunning(child) || !child.pid) return
  if (process.platform === 'win32') {
    try {
      const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore', timeout: 5000,
      })
      if (killed.status !== 0 && isProcessRunning(child)) child.kill()
    } catch {
      try { child.kill() } catch { /* already exited */ }
    }
    return
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    try { child.kill(force ? 'SIGKILL' : 'SIGTERM') } catch { /* already exited */ }
  }
}

function twoStageKill(child: import('child_process').ChildProcess) {
  killProcessTree(child, false)
  if (process.platform !== 'win32' && FORCE_KILL_MS > 0) {
    setTimeout(() => killProcessTree(child, true), FORCE_KILL_MS)
  }
}

function trySpawn(shell: ShellInfo, cmd: string, workspace: string): Promise<{ child: import('child_process').ChildProcess; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(shell.path, [...shell.args, cmd], {
        cwd: workspace,
        windowsHide: true,
        detached: process.platform !== 'win32',
        windowsVerbatimArguments: shell.windowsVerbatimArguments ?? false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let settled = false
      const onError = (err: Error) => { if (!settled) { settled = true; reject(err) } }
      const onOpen = () => { if (!settled) { settled = true; resolve({ child, cleanup: () => { child.removeListener('error', onError) } }) } }
      child.on('error', onError)
      child.on('spawn', onOpen)
      setTimeout(() => { if (!settled) { settled = true; resolve({ child, cleanup: () => { child.removeListener('error', onError) } }) } }, 500)
    } catch (err: any) {
      reject(err)
    }
  })
}

export const tool: ToolModule = {
  name: 'pwsh',
  description: 'Execute a PowerShell command in the workspace directory. Use PowerShell dialect: $env:NAME, native C:\\... paths, and cmdlets like Get-Content / Select-String / Get-ChildItem.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'PowerShell command to execute' },
      timeout_seconds: { type: 'number', description: 'Optional timeout in seconds (default 60).' },
    },
    required: ['command'],
  },
  dangerous: true,
  execute: async (args, { workspace, workspaces, signal, allowedRoots, onOutput }) => {
    const input = validate(
      z.object({
        command: z.string().min(1, 'command 不能为空'),
        timeout_seconds: z.string().optional(),
      }),
      args, 'pwsh',
    )
    const cmd = input.command
    const roots = workspaces ?? [workspace]
    // Path safety: reject any workspace-relative / absolute path that escapes.
    const absPaths = cmd.match(/[A-Za-z]:\\[^\s"'|&;<>(){}[\]`~!@#$%^&*=+]+/g)
    if (absPaths) {
      for (const raw of absPaths) assertPathSafe(raw, roots, allowedRoots)
    }

    const timeoutMs = Math.max(1, Math.min(parseInt(input.timeout_seconds || '60', 10) * 1000, 600000))
    // RTK 集成：若启用且 rtk 可用，命令经 rtk 前缀压缩。
    const execCmd = maybeRtkWrap(cmd)

    let lastError: string | undefined
    const shellCwd = workspace && existsSync(workspace) ? workspace : getDataDir()

    for (const shell of getShellCandidates()) {
      try {
        const { child, cleanup } = await trySpawn(shell, execCmd, shellCwd)
        cleanup()

        return new Promise((resolvePromise) => {
          let stdout = ''
          let stderr = ''
          let fullStdout = ''
          let fullStderr = ''
          let truncated = false
          let writtenOnce = false

          const timeoutId = setTimeout(() => {
            const msg = `\n[Timeout: command exceeded ${timeoutMs / 1000}s]`
            stderr += msg
            onOutput?.(msg)
            twoStageKill(child)
          }, timeoutMs)

          const abortHandler = () => {
            clearTimeout(timeoutId)
            const msg = '\n[Aborted]'
            stderr += msg
            onOutput?.(msg)
            twoStageKill(child)
            setTimeout(() => {
              killProcessTree(child, true)
              const combined = (fullStdout || stdout) + (stderr ? `\n${stderr}` : '')
              resolvePromise({ output: combined.trim(), error: stderr.trim() || 'Aborted' })
            }, FORCE_KILL_MS + 1000)
          }
          signal?.addEventListener('abort', abortHandler, { once: true })
          if (signal?.aborted) abortHandler()

          function ensureOutputFile(stdoutFull: string, stderrFull: string): string | null {
            if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })
            const name = `pwsh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.log`
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
            if (truncated) { onOutput?.(chunk); return }

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
              if (isStdout) stdout = fullBefore.slice(-TAIL_SIZE) + msg
              else stderr = fullBefore.slice(-TAIL_SIZE) + msg
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
            resolvePromise({ output: stdout, error: err.message })
          })

          child.on('close', (code) => {
            clearTimeout(timeoutId)
            signal?.removeEventListener('abort', abortHandler)
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

    return { output: '', error: lastError || 'No PowerShell/shell available' }
  },
}

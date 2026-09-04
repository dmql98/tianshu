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
// 与 bash 工具同构的 close-settle 静默宽限：child 已 'exit' 但孙进程仍持有
// stdout/stderr 管道时，'close' 可能永不触发；exit 后静默 EXIT_GRACE_MS 即结算。
const EXIT_GRACE_MS = 500

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
          // 结算互斥：防止 exit/close/timeout/abort 多路径重复 resolve。
          let exitSettled = false

          const timeoutId = setTimeout(() => {
            clearTimeout(timeoutId)
            const msg = `\n[Timeout: command exceeded ${timeoutMs / 1000}s]`
            stderr += msg
            onOutput?.(msg)
            twoStageKill(child)
            // 与 abort 同构：即使进程树未死也强制结算，保证 promise 一定 resolve。
            exitSettled = true
            resolvePromise({ output: (fullStdout || stdout) + (stderr ? `\n${stderr}` : ''), error: stderr.trim() || 'Timeout' })
          }, timeoutMs)

          const abortHandler = () => {
            clearTimeout(timeoutId)
            const msg = '\n[Aborted]'
            stderr += msg
            onOutput?.(msg)
            twoStageKill(child)
            setTimeout(() => {
              if (exitSettled) return
              exitSettled = true
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

          child.stdout!.on('data', (data: Buffer) => { postExitReset(); appendOutput(data, true) })
          child.stderr!.on('data', (data: Buffer) => { postExitReset(); appendOutput(data, false) })

          // spawn 失败路径：直接以错误结算。
          child.on('error', (err: Error) => {
            exitSettled = true
            clearTimeout(timeoutId)
            signal?.removeEventListener('abort', abortHandler)
            resolvePromise({ output: stdout, error: err.message })
          })

          // ── close-settle fix（与 bash 工具同构，见 tools/bash/index.ts）──
          // PowerShell/其子进程若持有 stdout/stderr 管道继续存活，shell 已
          // 'exit' 但 'close' 永不触发 → 工具 promise 永不 resolve。以 'exit'
          // 为准结算：exit 后进入静默宽限 EXIT_GRACE_MS，静默即结算并 kill 进程树。
          let exited = false
          let exitCode: number | null = null
          let exitSignal: NodeJS.Signals | null = null
          let exitTimer: ReturnType<typeof setTimeout> | null = null
          const settleOnExit = () => {
            if (exitSettled) return
            exitSettled = true
            clearTimeout(timeoutId)
            if (exitTimer) clearTimeout(exitTimer)
            signal?.removeEventListener('abort', abortHandler)
            twoStageKill(child)
            try { child.stdout?.destroy(); child.stderr?.destroy() } catch { /* already closed */ }
            if (signal?.aborted) {
              resolvePromise({ output: (fullStdout || stdout) + (stderr ? `\n${stderr}` : ''), error: stderr.trim() || 'Aborted' })
              return
            }
            const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : '')
            if (exitCode === 0 || (exitCode === null && stdout)) {
              resolvePromise({ output: combined.trim() })
            } else {
              resolvePromise({ output: `[exit code: ${exitCode}]${exitSignal ? ` (signal: ${exitSignal})` : ''}\n${combined}`.trim() })
            }
          }
          const armExitTimer = () => {
            if (exitTimer) clearTimeout(exitTimer)
            exitTimer = setTimeout(settleOnExit, EXIT_GRACE_MS)
          }
          child.on('exit', (code, sig) => {
            exited = true
            exitCode = code
            exitSignal = sig
            armExitTimer()
          })
          // exit 后输出仍在流动 → 重置静默计时（data 回调与 postExitReset
          // 交错执行，保证不会在仍有输出时误结算）。
          const postExitReset = () => {
            if (exited) armExitTimer()
          }

          // 备用结算路径：'close' 正常到来（无句柄泄漏），或 timeout/abort 已
          // 结算，或子进程从未成功 spawn（'error' 已结算）时置空退出计时器。
          child.on('close', (code) => {
            if (exitSettled) return
            exitSettled = true
            // 双保险：即使 'exit' 早于 'close' 到达且静默计时已结算，close 的
            // settle 也不能重复 resolve（Promise 幂等）。
            clearTimeout(timeoutId)
            signal?.removeEventListener('abort', abortHandler)
            if (exitTimer) clearTimeout(exitTimer)
            // abort 后由 abortHandler 的强制 resolve 负责返回 Aborted；
            // 这里对 abort 场景按退出码结算会让 abort 测试拿不到 error。
            if (signal?.aborted) {
              resolvePromise({ output: (fullStdout || stdout) + (stderr ? `\n${stderr}` : ''), error: stderr.trim() || 'Aborted' })
              return
            }
            // Non-zero exit is the COMMAND's outcome, not a tool failure:
            // probes legitimately exit non-zero. Surface the exit code as a
            // marker in the output and let the model decide; only spawn-level
            // errors (the 'error' event) count as tool errors.
            const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : '')
            if (code === 0 || (code === null && stdout)) {
              resolvePromise({ output: combined.trim() })
            } else {
              resolvePromise({ output: `[exit code: ${code}]\n${combined}`.trim() })
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

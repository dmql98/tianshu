import { spawn, spawnSync, execSync } from 'child_process'
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs'
import { resolve as pathResolve } from 'path'
import type { ToolModule } from '../types.js'
import { assertPathSafe } from '../utils.js'
import { z } from 'zod'
import { validate } from '../validate.js'
import { getOutputDir } from '../truncate.js'
import { envInt, getDataDir } from '../../config.js'
import { maybeRtkWrap } from '../rtk.js'
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
// 单条命令硬超时（可用 TIANSHU_BASH_TIMEOUT_MS 覆盖）。
const TIMEOUT_MS = envInt('TIANSHU_BASH_TIMEOUT_MS', 60000)
const FORCE_KILL_MS = 3000
// child 已退出（'exit'）但仍有孙进程持有 stdout/stderr 管道时，'close' 事件
// 可能永不触发（bash 卡住根因）。exit 后进入静默宽限：只要还有输出在流动就
// 继续等，静默 EXIT_GRACE_MS 即结算，保证工具 promise 一定 resolve。
const EXIT_GRACE_MS = 500

const TEMP_DIR = getOutputDir()

interface ShellInfo {
  path: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

function gitBashPaths(): string[] {
  if (process.platform !== 'win32') return []
  const candidates = [
    process.env.GIT_BASH,
    process.env.ProgramFiles ? pathResolve(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : undefined,
    process.env['ProgramFiles(x86)'] ? pathResolve(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe') : undefined,
    'C:\\Program Files\\Git\\bin\\bash.exe',
  ].filter((p): p is string => !!p)
  return [...new Set(candidates)].filter(p => existsSync(p))
}

function getShellCandidates(): ShellInfo[] {
  if (process.platform !== 'win32') {
    const sh = process.env.SHELL || '/bin/sh'
    return [{ path: sh, args: ['-c'] }]
  }

  const candidates: ShellInfo[] = []
  for (const bash of gitBashPaths()) {
    candidates.push({ path: bash, args: ['-lc'], windowsVerbatimArguments: false })
  }
  const comspec = process.env.ComSpec
  if (comspec) candidates.push({ path: comspec, args: ['/d', '/s', '/c'], windowsVerbatimArguments: true })
  candidates.push(
    { path: 'cmd.exe', args: ['/d', '/s', '/c'], windowsVerbatimArguments: true },
    { path: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c'], windowsVerbatimArguments: true },
    { path: 'C:\\Windows\\Sysnative\\cmd.exe', args: ['/d', '/s', '/c'], windowsVerbatimArguments: true },
    { path: 'powershell.exe', args: ['-NoProfile', '-Command'], windowsVerbatimArguments: false },
    { path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoProfile', '-Command'], windowsVerbatimArguments: false },
  )
  return candidates
}

function isProcessRunning(child: import('child_process').ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

function killProcessTree(child: import('child_process').ChildProcess, force = false) {
  if (!isProcessRunning(child) || !child.pid) return
  if (process.platform === 'win32') {
    // child.kill() only signals the shell on Windows. taskkill /T is required
    // to terminate programs launched by Git Bash/cmd/PowerShell as well.
    try {
      const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 5000,
      })
      if (killed.status !== 0 && isProcessRunning(child)) child.kill()
    } catch {
      try { child.kill() } catch { /* already exited */ }
    }
    return
  }
  try {
    // POSIX shells are spawned as process-group leaders below.
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

function trySpawn(shell: ShellInfo, cmd: string, workspace: string, windowsHide: boolean): Promise<{ child: import('child_process').ChildProcess; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(shell.path, [...shell.args, cmd], {
        cwd: workspace,
        windowsHide,
        detached: process.platform !== 'win32',
        windowsVerbatimArguments: shell.windowsVerbatimArguments ?? false,
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
  description: process.platform === 'win32' && gitBashPaths().length === 0
    ? 'Execute a Windows cmd.exe command in the workspace directory. Use cmd syntax; do not use pwd, ls, head, tail, or /c/... paths.'
    : 'Execute a Bash command in the workspace directory. On Windows, Git Bash is used when available and supports /c/... paths.',
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

    // RTK 集成：若启用且 rtk 可用，命令经 rtk 前缀压缩（路径安全检查仍用原命令）。
    const execCmd = maybeRtkWrap(cmd)
    const shellCandidates = getShellCandidates()

    let lastError: string | undefined

    for (const shell of shellCandidates) {
      try {
        const shellCwd = workspace && existsSync(workspace) ? workspace : getDataDir()
        const { child, cleanup } = await trySpawn(shell, execCmd, shellCwd, true)
        cleanup()

        return new Promise((resolvePromise) => {
          let stdout = ''
          let stderr = ''
          let fullStdout = ''
          let fullStderr = ''
          let truncated = false
          let writtenOnce = false

          const timeoutId = setTimeout(() => {
            clearTimeout(timeoutId)
            const msg = `\n[Timeout: command exceeded ${TIMEOUT_MS / 1000}s]`
            stderr += msg
            onOutput?.(msg)
            twoStageKill(child)
            // 与 abort 同构：即使进程树未死（比如子进程无视 kill），也强制结算，
            // 保证工具 promise 一定 resolve，agent 循环不被永久卡住。
            exitSettled = true
            resolvePromise({ output: (fullStdout || stdout) + (stderr ? `\n${stderr}` : ''), error: stderr.trim() || 'Timeout' })
          }, TIMEOUT_MS)

          const abortHandler = () => {
            clearTimeout(timeoutId)
            const msg = '\n[Aborted]'
            stderr += msg
            onOutput?.(msg)
            twoStageKill(child)
            // Force resolve even if child process doesn't die
            setTimeout(() => {
              if (exitSettled) return
              exitSettled = true
              killProcessTree(child, true)
              const combined = (fullStdout || stdout) + (stderr ? `\n${stderr}` : '')
              // 与 close 路径保持同一返回结构：abort 后 child 的 exit/close 事件
              // 仍会触发，close/settleOnExit 会按退出码再次结算（幂等），这里
              // 只需保证「abort 后最迟 FORCE_KILL_MS+1000ms 必然返回 Aborted」。
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

          // spawn 失败路径：直接以错误结算。
          child.on('error', (err: Error) => {
            exitSettled = true
            clearTimeout(timeoutId)
            signal?.removeEventListener('abort', abortHandler)
            resolvePromise({ output: stdout, error: err.message })
          })

          // ── close-settle fix（bash 卡住根因）──
          // Node 只在最后一个持有 stdio 管道 / IPC 通道的句柄关闭后才触发
          // 'close'。bash -lc 启动的服务进程若带着 stdout/stderr 句柄继续
          // 存活（如 npm run dev、ssh、tail -f 等长驻命令），shell 本身已
          // 'exit'，但 'close' 永远不来 → close 回调永不执行，工具 promise
          // 永不 resolve，整条 agent 循环（含子 agent 回写父会话、“工作中”
          // 按钮状态）被永久卡死。
          //
          // 修复：以 'exit' 为准结算。exit 后进入静默宽限 EXIT_GRACE_MS，
          // 期间输出仍在流动就继续等；静默即结算。即使孙进程仍持有管道，
          // 也主动 kill 进程树并返回已捕获的输出与退出码。
          let exited = false
          let exitCode: number | null = null
          let exitSignal: NodeJS.Signals | null = null
          let exitTimer: ReturnType<typeof setTimeout> | null = null
          let exitSettled = false
          const settleOnExit = () => {
            if (exitSettled) return
            exitSettled = true
            clearTimeout(timeoutId)
            if (exitTimer) clearTimeout(exitTimer)
            signal?.removeEventListener('abort', abortHandler)
            twoStageKill(child)
            // 主动清理孙进程持有的管道句柄，让底层 fd 尽快释放。
            try { child.stdout?.destroy(); child.stderr?.destroy() } catch { /* already closed */ }
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
            // 进入静默宽限：若后续仍有输出则重置计时，静默后结算。
            armExitTimer()
          })
          // exit 后输出仍在流动 → 重置静默计时（data 回调与 postExitReset
          // 交错执行，保证不会在仍有输出时误结算）。
          const postExitReset = () => {
            if (exited) armExitTimer()
          }

          // 数据监听：exit 之后孙进程可能仍向管道写输出（追加到 stdout/stderr）。
          child.stdout!.on('data', (data: Buffer) => { postExitReset(); appendOutput(data, true) })
          child.stderr!.on('data', (data: Buffer) => { postExitReset(); appendOutput(data, false) })

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
            // probes like ls/grep/test legitimately exit non-zero. Surface the
            // exit code as a marker in the output and let the model decide;
            // only spawn-level errors (the 'error' event) count as tool errors.
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

    return { output: '', error: lastError || 'No shell available' }
  },
}

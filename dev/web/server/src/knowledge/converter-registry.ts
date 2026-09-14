/**
 * 外部转换器注册表（06 P2 外部转换器路线）。
 *
 * - converters.json 记录「已登记」的转换器（用户点击安装按钮后写入）。
 * - 可用性 = 探测外部 CLI（paddleocr/anydoc --version）成功；探测结果缓存 30s
 *   （对齐 rtk 先例），避免每次转换都 spawn。
 * - 转换 = spawn 外部命令，超时默认 10 分钟（OCR/大 PDF 较慢），产物回写到
 *   normalized/{kbId}/
 */
import { execFileSync, spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { basename, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { knowledgeRoot } from '../data-paths.js'

export interface ConverterMeta {
  /** 唯一标识：paddleocr / anydoc / 后续扩展。 */
  id: string
  /** 显示名。 */
  name: string
  /** 安装命令（提示用户 / 一键安装，P2 仅登记不代执行安装）。 */
  installCommand: string
  /** 探测命令（--version 等）。 */
  detectCommand: string
  /** 支持的输入扩展名。 */
  inputExtensions: string[]
  /** 是否已登记（用户点击安装）。 */
  installed: boolean
  /** 最近探测时间戳。 */
  lastCheckedAt?: number
  /** 是否可用（探测成功）。 */
  available?: boolean
  /** 探测到的版本（可选）。 */
  version?: string
}

export interface ConverterDescriptor extends ConverterMeta {
  /** 当前可用性（未登记但 CLI 存在也算可用）。 */
  detected: boolean
}

const CONVERTERS_FILE = 'converters.json'

// ── 内置转换器目录（后续新增工具只需在此加一条）──
export const BUILTIN_CONVERTERS: Omit<ConverterMeta, 'installed'>[] = [
  {
    id: 'paddleocr',
    name: 'PaddleOCR',
    installCommand: 'pip install paddleocr[doc-parser]',
    detectCommand: 'paddleocr --version',
    inputExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp'],
  },
  {
    id: 'anydoc',
    name: 'AnyDoc',
    installCommand: 'npm install -g @firecrawl/anydoc',
    detectCommand: 'anydoc --version',
    inputExtensions: [
      '.doc', '.docx', '.docm', '.ppt', '.pptx', '.xls', '.xlsx',
      '.odt', '.ods', '.odp', '.rtf', '.epub', '.csv', '.pdf',
    ],
  },
]

/** 全部可转换扩展名（内置转换器 inputExtensions 的并集）。 */
export const CONVERTIBLE_EXTS: string[] = Array.from(
  new Set(BUILTIN_CONVERTERS.flatMap(c => c.inputExtensions)),
).sort()

/** 某扩展名可用的转换器 id 列表（按内置目录顺序）。 */
export function convertersForExt(ext: string): string[] {
  const e = ext.toLowerCase()
  return BUILTIN_CONVERTERS.filter(c => c.inputExtensions.includes(e)).map(c => c.id)
}

/** 某扩展名是否有至少一个内置转换器可处理。 */
export function isConvertibleExt(ext: string): boolean {
  return convertersForExt(ext).length > 0
}

function convertersFile(): string {
  return join(knowledgeRoot(), CONVERTERS_FILE)
}

function readConverters(): Record<string, Omit<ConverterMeta, 'id' | 'name' | 'installCommand' | 'detectCommand' | 'inputExtensions'>> {
  const file = convertersFile()
  if (!existsSync(file)) return {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as unknown
    if (raw && typeof raw === 'object') return raw as Record<string, any>
    return {}
  } catch {
    return {}
  }
}

function writeConverters(state: Record<string, any>): void {
  mkdirSync(knowledgeRoot(), { recursive: true })
  const file = convertersFile()
  const tmp = `${file}.tmp-${randomUUID().slice(0, 8)}`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmp, file)
}

// ── CLI 探测（Windows where / POSIX command -v；--version 取版本号）──

function resolveCommand(cmd: string): string | null {
  try {
    const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`
    const out = execFileSync(probe, { shell: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
      .toString()
      .trim()
    if (out) return out.split(/\r?\n/)[0].trim()
  } catch { /* not on PATH */ }
  return null
}

function detectVersion(meta: Pick<ConverterMeta, 'id' | 'detectCommand'>): { available: boolean; version?: string } {
  try {
    const out = execFileSync(meta.detectCommand, { shell: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 })
      .toString()
      .trim()
    return { available: true, version: out.split(/\r?\n/)[0].slice(0, 80) }
  } catch (err: any) {
    // 探测失败：CLI 存在但命令报错（如 paddleocr 需要依赖），视为不可用并附提示。
    const hint = err?.stderr?.toString?.().slice(0, 120) || err?.message?.slice(0, 120) || ''
    return { available: false, version: hint }
  }
}

// ── 缓存 ──

let cache: { id: string; available: boolean; version?: string; at: number } | null = null
const TTL_MS = 30_000

export const converterRegistry = {
  /** 全部转换器（内置目录 + 登记状态），并做一次实时探测。 */
  list(force = false): ConverterDescriptor[] {
    const stored = readConverters()
    const now = Date.now()
    return BUILTIN_CONVERTERS.map(c => {
      const rec = stored[c.id]
      const installed = !!rec?.installed
      let available = !!rec?.available
      let version = rec?.version
      let lastCheckedAt = rec?.lastCheckedAt
      if (force || !lastCheckedAt || now - lastCheckedAt > TTL_MS) {
        const probe = detectVersion(c)
        available = probe.available
        version = probe.version
        lastCheckedAt = now
        const next = { ...(rec || {}), installed, available, version, lastCheckedAt }
        stored[c.id] = next
        writeConverters(stored)
      }
      return {
        ...c,
        installed,
        available,
        version,
        lastCheckedAt,
        detected: available,
      }
    })
  },

  /** 登记（安装按钮）→ 触发探测，返回该转换器最新状态。 */
  install(id: string): ConverterDescriptor | null {
    const found = BUILTIN_CONVERTERS.find(c => c.id === id)
    if (!found) throw new Error(`未知转换器: ${id}`)
    const stored = readConverters()
    const rec = stored[id] || {}
    stored[id] = { ...rec, installed: true, lastCheckedAt: 0 }
    writeConverters(stored)
    return this.list(true).find(c => c.id === id) ?? null
  },

  /** 卸载登记（不卸载 CLI 本身，仅移除登记标记）。 */
  uninstall(id: string): void {
    const stored = readConverters()
    if (stored[id]) stored[id] = { ...stored[id], installed: false }
    writeConverters(stored)
  },

  /** 取已登记且可用的转换器（未登记但 CLI 存在也可用）。 */
  available(): ConverterDescriptor[] {
    return this.list().filter(c => c.detected)
  },

  /** 用指定转换器转换文件：spawn 外部命令，输出到输出目录，返回产物路径。 */
  async convert(
    id: string,
    inputPath: string,
    outputDir: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ ok: true; outputPath: string; log: string } | { ok: false; error: string }> {
    const found = BUILTIN_CONVERTERS.find(c => c.id === id)
    if (!found) return { ok: false, error: `未知转换器: ${id}` }
    const probe = detectVersion(found)
    if (!probe.available) return { ok: false, error: `转换器 ${id} 不可用：${probe.version || 'CLI 未找到'}` }
    mkdirSync(outputDir, { recursive: true })
    const timeoutMs = opts.timeoutMs ?? 600_000
    try {
      const result = await runExternal(found, inputPath, outputDir, timeoutMs)
      return { ok: true, outputPath: result.outputPath, log: result.log }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) }
    }
  },
}

// ── 各转换器的具体命令构造 ──

interface ExternalRun {
  command: string
  args: string[]
  /** 转换完成后从输出目录里找 .md 产物（默认）。 */
  outputPattern?: string
}

function buildCommand(meta: Omit<ConverterMeta, 'installed'>, inputPath: string, outputDir: string): ExternalRun {
  switch (meta.id) {
    case 'paddleocr': {
      // paddleocr pp_structurev3 -i <file> --save_path <dir>
      // 输出到 <dir>/{stem}.md（PDF 多页时官方建议目录，产出 {stem}.md 合并）
      return {
        command: 'paddleocr',
        args: ['pp_structurev3', '-i', inputPath, '--save_path', outputDir],
        outputPattern: '{stem}.md',
      }
    }
    case 'anydoc': {
      // anydoc <file> -o <out.md>
      return {
        command: 'anydoc',
        args: [inputPath, '-o', join(outputDir, `${basename(inputPath).replace(/\.[^.]+$/, '')}.md`)],
      }
    }
    default:
      throw new Error(`转换器 ${meta.id} 未实现命令构造`)
  }
}

function runExternal(
  meta: Omit<ConverterMeta, 'installed'>,
  inputPath: string,
  outputDir: string,
  timeoutMs: number,
): Promise<{ outputPath: string; log: string }> {
  const { command, args, outputPattern } = buildCommand(meta, inputPath, outputDir)
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { shell: process.platform === 'win32', windowsHide: true })
    // Node 提示：win32 + shell 时 args 会被拼接到命令串（有注入风险）。
    // 本处 command 来自 converters.json 的 detectCommand/convertCommand 模板，args 由
    // buildCommand 用 path 模块 join/basename 生成；仍存在含引号/特殊字符文件名
    // 的边界情况。兜底：对非 windowsHide 场景不 shell 化。
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(new Error(`转换超时（${timeoutMs}ms）: ${command}`))
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', (err: Error) => { clearTimeout(timer); rejectPromise(err) })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      const log = `stdout:\n${stdout}\nstderr:\n${stderr}`.slice(0, 4000)
      if (code !== 0) {
        rejectPromise(new Error(`转换命令失败 (exit=${code}): ${stderr.slice(0, 500) || stdout.slice(0, 500)}`))
        return
      }
      // 找产物：优先 outputPattern；anydoc 显式 -o 已知路径。
      let outputPath: string | null = null
      if (outputPattern && outputPattern === '{stem}.md') {
        const stem = basename(inputPath).replace(/\.[^.]+$/, '')
        const candidate = join(outputDir, `${stem}.md`)
        if (existsSync(candidate)) outputPath = candidate
      }
      if (!outputPath) {
        // 兜底：扫描输出目录最近的 .md
        if (existsSync(outputDir)) {
          const mds = readdirSync(outputDir).filter((f: string) => f.endsWith('.md'))
          if (mds.length > 0) outputPath = join(outputDir, mds[mds.length - 1])
        }
      }
      if (!outputPath) {
        rejectPromise(new Error(`转换未产出 Markdown 文件: ${command} ${args.join(' ')}`))
        return
      }
      resolvePromise({ outputPath, log })
    })
  })
}

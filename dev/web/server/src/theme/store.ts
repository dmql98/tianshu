/**
 * 主题 store（TIANSHU_THEME_SWITCHING_PLAN §5.2 / §5.4）。
 *
 * - 根目录固定为公共 `themesRoot()`（与 characters/skills 同一 data root），
 *   不散落 `resolve(getDataDir(), 'themes')`。
 * - 创建/更新：服务端校验 → 写入 `<dataDir>/themes/.tmp-<id>-<nonce>/` →
 *   图片先写、`theme.json` 最后写 → 完整复验 → 原子替换正式目录。
 * - 更新失败保留原版本；启动时清理超时临时目录，不删除无法确认归属的文件。
 * - 列表扫描遇到损坏主题时跳过并记录诊断，不让整个接口失败。
 * - 资产读取只允许访问已登记在有效 theme.json 中的文件。
 */
import { randomUUID } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, join, resolve } from 'path'
import { themesRoot } from '../data-paths.js'
import {
  buildThemeRecord,
  isValidAssetFileName,
  isValidThemeId,
  parseThemeRecord,
  themeRecordToJson,
  type ThemeRecord,
} from './schema.js'
import { validateThemeImage, type ImageValidationResultOrFailure } from './image-validation.js'

export interface ThemeAssetInput {
  /** 'background' | 'preview' */
  kind: 'background' | 'preview'
  bytes: Uint8Array
  /** 规范化后的文件名（由调用方从扩展名派生）。 */
  filename: string
  mime: string
  width: number
  height: number
}

export interface ThemeWriteInput {
  name: string
  appearance: 'light' | 'dark'
  colors: unknown
  artwork?: unknown
  /** 可选的图片素材（创建必填背景或纯色主题可选；更新时省略表示保留原图）。 */
  background?: ThemeAssetInput
  preview?: ThemeAssetInput
}

const THEME_JSON = 'theme.json'

/** 扫描 <dataDir>/themes 下的主题目录。损坏主题跳过并返回诊断。 */
export function listThemes(): { themes: ThemeRecord[]; skipped: { dir: string; reason: string }[] } {
  const root = themesRoot()
  const themes: ThemeRecord[] = []
  const skipped: { dir: string; reason: string }[] = []
  if (!existsSync(root)) return { themes, skipped }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.tmp-')) continue
    if (!isValidThemeId(entry.name)) {
      skipped.push({ dir: entry.name, reason: 'invalid-id' })
      continue
    }
    const themeFile = join(root, entry.name, THEME_JSON)
    if (!existsSync(themeFile)) {
      skipped.push({ dir: entry.name, reason: 'missing-theme.json' })
      continue
    }
    let raw: string
    try {
      raw = readFileSync(themeFile, 'utf-8')
    } catch (err: any) {
      skipped.push({ dir: entry.name, reason: `read-error: ${err?.message ?? ''}` })
      continue
    }
    const record = parseThemeRecord(raw, entry.name)
    if (!record) {
      skipped.push({ dir: entry.name, reason: 'invalid-theme.json' })
      continue
    }
    themes.push(record)
  }
  themes.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  return { themes, skipped }
}

export function getTheme(id: string): ThemeRecord | null {
  if (!isValidThemeId(id)) return null
  const dir = join(themesRoot(), id)
  const themeFile = join(dir, THEME_JSON)
  if (!existsSync(themeFile)) return null
  try {
    const record = parseThemeRecord(readFileSync(themeFile, 'utf-8'), id)
    if (!record) return null
    // 素材缺失 → 视为损坏（不能让缺失素材成为活动主题）
    if (record.artwork?.file && !existsSync(join(dir, record.artwork.file))) return null
    return record
  } catch {
    return null
  }
}

function themeDir(id: string): string {
  return join(themesRoot(), id)
}

/** 校验主题目录内的素材文件可访问（只允许主题目录内、已登记的文件）。 */
export function resolveThemeAsset(id: string, fileName: string): string | null {
  if (!isValidThemeId(id) || !isValidAssetFileName(fileName)) return null
  const record = getTheme(id)
  if (!record) return null
  const registered = new Set<string>()
  if (record.artwork?.file) registered.add(record.artwork.file)
  if (record.artwork?.preview) registered.add(record.artwork.preview)
  if (!registered.has(fileName)) return null
  const file = resolve(themeDir(id), fileName)
  // 防御：确认解析后的路径仍在主题目录内
  if (!file.startsWith(resolve(themeDir(id)) + '/') && file !== resolve(themeDir(id), fileName)) return null
  if (!existsSync(file)) return null
  return file
}

function writeFileSyncSafe(file: string, data: Uint8Array | string): void {
  writeFileSync(file, data)
}

/**
 * 原子写入主题：素材先写，theme.json 最后写；整体提交到正式目录。
 * 返回写入的 ThemeRecord；失败抛错且不触碰旧版本。
 */
export function saveTheme(id: string, input: ThemeWriteInput): ThemeRecord {
  if (!isValidThemeId(id)) throw new Error('Invalid theme id')
  const name = input.name.trim().slice(0, 80)
  if (!name) throw new Error('Theme name is required')

  const root = themesRoot()
  mkdirSync(root, { recursive: true })
  const finalDir = themeDir(id)
  const nonce = randomUUID().slice(0, 8)
  const tmpDir = join(root, `.tmp-${id}-${nonce}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    // 1. 素材先写（可选：纯色主题无背景图）；文件名必须通过资产名校验
    const backgroundFile = input.background ? `${input.background.filename}` : undefined
    const previewFile = input.preview ? `${input.preview.filename}` : undefined
    if (backgroundFile !== undefined && !isValidAssetFileName(backgroundFile)) throw new Error('Invalid background filename')
    if (previewFile !== undefined && !isValidAssetFileName(previewFile)) throw new Error('Invalid preview filename')

    if (input.background) {
      writeFileSyncSafe(join(tmpDir, input.background.filename), input.background.bytes)
    }
    if (input.preview) {
      writeFileSyncSafe(join(tmpDir, input.preview.filename), input.preview.bytes)
    }

    // 2. 合并旧素材：更新时省略的素材从旧版本继承
    const existing = getTheme(id)
    const artworkInput = { ...(input.artwork ?? {}) } as Record<string, unknown>
    if (input.background) artworkInput.file = input.background.filename
    if (input.preview) artworkInput.preview = input.preview.filename
    if (!input.background && existing?.artwork?.file) artworkInput.file = existing.artwork.file
    if (!input.preview && existing?.artwork?.preview) artworkInput.preview = existing.artwork.preview

    const record: ThemeRecord = {
      ...buildThemeRecord({ id, name, appearance: input.appearance, colors: input.colors, artwork: artworkInput }),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    if (existing) {
      record.createdAt = existing.createdAt
      // 继承未替换的旧素材（实际文件已存在于正式目录，theme.json 提交后仍引用）
      if (!input.background && existing.artwork?.file && !existsSync(join(tmpDir, existing.artwork.file))) {
        copyFileSync(join(finalDir, existing.artwork.file), join(tmpDir, existing.artwork.file))
      }
      if (!input.preview && existing.artwork?.preview && !existsSync(join(tmpDir, existing.artwork.preview))) {
        copyFileSync(join(finalDir, existing.artwork.preview), join(tmpDir, existing.artwork.preview))
      }
    }

    // 3. theme.json 最后写（提交标记）
    writeFileSyncSafe(join(tmpDir, THEME_JSON), themeRecordToJson(record))

    // 4. 完整复验临时目录
    const verify = parseThemeRecord(readFileSync(join(tmpDir, THEME_JSON), 'utf-8'), id)
    if (!verify) throw new Error('Theme verification failed')

    // 5. 原子替换正式目录（Windows 同卷 rename；旧目录先改名备份再替换）
    if (existsSync(finalDir)) {
      const backup = join(root, `.tmp-${id}-old-${nonce}`)
      renameSync(finalDir, backup)
      try {
        renameSync(tmpDir, finalDir)
      } catch (err) {
        // 替换失败：恢复旧版本
        renameSync(backup, finalDir)
        throw err
      }
      rmSync(backup, { recursive: true, force: true })
    } else {
      renameSync(tmpDir, finalDir)
    }

    // 6. 清理更新后不再引用的旧素材（更换背景图后清理旧图）
    cleanupOrphanAssets(id, verify)

    return verify
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw err
  }
}

function cleanupOrphanAssets(id: string, record: ThemeRecord): void {
  const dir = themeDir(id)
  if (!existsSync(dir)) return
  const registered = new Set<string>()
  if (record.artwork?.file) registered.add(record.artwork.file)
  if (record.artwork?.preview) registered.add(record.artwork.preview)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (entry.name === THEME_JSON || entry.name === '.tianshu-source.json') continue
    if (!registered.has(entry.name)) {
      try { rmSync(join(dir, entry.name), { force: true }) } catch { /* ignore */ }
    }
  }
}

/** 复制主题（新 ID + 素材复制），返回新记录。 */
export function duplicateTheme(id: string): ThemeRecord {
  const existing = getTheme(id)
  if (!existing) throw new Error('Theme not found')
  const newId = generateDuplicateId(existing.name)
  const root = themesRoot()
  mkdirSync(root, { recursive: true })
  const finalDir = themeDir(newId)
  if (existsSync(finalDir)) throw new Error('Duplicate id collision')

  const record: ThemeRecord = {
    ...existing,
    id: newId,
    name: existing.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const nonce = randomUUID().slice(0, 8)
  const tmpDir = join(root, `.tmp-${newId}-${nonce}`)
  mkdirSync(tmpDir, { recursive: true })
  try {
    if (existing.artwork?.file && existsSync(join(themeDir(id), existing.artwork.file))) {
      copyFileSync(join(themeDir(id), existing.artwork.file), join(tmpDir, existing.artwork.file))
    }
    if (existing.artwork?.preview && existsSync(join(themeDir(id), existing.artwork.preview))) {
      copyFileSync(join(themeDir(id), existing.artwork.preview), join(tmpDir, existing.artwork.preview))
    }
    writeFileSyncSafe(join(tmpDir, THEME_JSON), themeRecordToJson(record))
    const verify = parseThemeRecord(readFileSync(join(tmpDir, THEME_JSON), 'utf-8'), newId)
    if (!verify) throw new Error('Duplicate verification failed')
    renameSync(tmpDir, finalDir)
    return verify
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw err
  }
}

function generateDuplicateId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'theme'
  return `custom-${slug}-${randomUUID().slice(0, 6)}`
}

/** 删除主题目录（不可恢复；UI 必须先确认，删除当前主题前前端先切回 system）。 */
export function deleteTheme(id: string): { deleted: boolean } {
  if (!isValidThemeId(id)) throw new Error('Invalid theme id')
  const dir = themeDir(id)
  if (!existsSync(dir)) return { deleted: false }
  rmSync(dir, { recursive: true, force: true })
  return { deleted: true }
}

/** 重命名主题（只改 theme.json 的 name）。 */
export function renameTheme(id: string, name: string): ThemeRecord {
  const existing = getTheme(id)
  if (!existing) throw new Error('Theme not found')
  const trimmed = name.trim().slice(0, 80)
  if (!trimmed) throw new Error('Theme name is required')
  const record: ThemeRecord = {
    ...existing,
    name: trimmed,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(join(themeDir(id), THEME_JSON), themeRecordToJson(record), 'utf-8')
  return record
}

/** 校验并规范化一张上传图；失败返回错误（供路由 4xx）。 */
export function validateUploadedImage(
  bytes: Uint8Array,
  kind: 'background' | 'preview',
): { ok: true; filename: string; mime: string; width: number; height: number } | { ok: false; message: string } {
  const result: ImageValidationResultOrFailure = validateThemeImage(bytes)
  if (!result.ok) return { ok: false, message: result.message }
  const ext = result.format === 'png' ? 'png' : result.format === 'jpeg' ? 'jpg' : 'webp'
  const filename = `${kind}.${ext}`
  return {
    ok: true,
    filename,
    mime: result.mime,
    width: result.width,
    height: result.height,
  }
}

/** 启动时清理超时临时目录（只删 .tmp-* 前缀目录，不触碰正式主题）。 */
export function cleanupTempDirs(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const root = themesRoot()
  if (!existsSync(root)) return 0
  let removed = 0
  const now = Date.now()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.tmp-')) continue
    try {
      const st = statSync(join(root, entry.name))
      if (now - st.mtimeMs >= maxAgeMs) {
        rmSync(join(root, entry.name), { recursive: true, force: true })
        removed++
      }
    } catch { /* ignore */ }
  }
  return removed
}

/** 主题目录内登记资产清单（供 GET /assets 诊断）。 */
export function listThemeAssets(id: string): { name: string; kind: 'background' | 'preview'; bytes: number }[] {
  const record = getTheme(id)
  if (!record) return []
  const out: { name: string; kind: 'background' | 'preview'; bytes: number }[] = []
  if (record.artwork?.file) {
    const file = join(themeDir(id), record.artwork.file)
    if (existsSync(file)) out.push({ name: record.artwork.file, kind: 'background', bytes: statSync(file).size })
  }
  if (record.artwork?.preview) {
    const file = join(themeDir(id), record.artwork.preview)
    if (existsSync(file)) out.push({ name: record.artwork.preview, kind: 'preview', bytes: statSync(file).size })
  }
  return out
}

/** 供路由使用：目录内素材完整路径（只读）。 */
export function themeAssetPath(id: string, fileName: string): string | null {
  return resolveThemeAsset(id, basename(fileName))
}

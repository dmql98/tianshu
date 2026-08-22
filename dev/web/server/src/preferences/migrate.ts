import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { configThemeFile, configIconPackFile, configDir, userPreferencesFile } from '../data-paths.js'
import { normalizeThemeSelection, normalizeIconPackSelection } from './validation.js'

/**
 * 把旧 <dataDir>/user-preferences.json（theme+iconPack 聚合）迁移到
 * config/theme.json + config/iconpack.json，并删除旧文件。
 * 基于文件存在性做幂等：旧文件不存在即跳过；迁移后旧文件被删，下次自然 no-op。
 */
export function ensureLegacyMigrated(): void {
  const legacy = userPreferencesFile()
  if (!existsSync(legacy)) return
  let parsed: { theme?: unknown; iconPack?: unknown } | null = null
  try {
    parsed = JSON.parse(readFileSync(legacy, 'utf-8'))
  } catch {
    // 旧文件损坏：直接删除，避免反复尝试
    try { rmSync(legacy) } catch { /* ignore */ }
    return
  }
  if (!parsed) return
  const theme = normalizeThemeSelection(parsed.theme)
  const iconPack = normalizeIconPackSelection(parsed.iconPack)
  mkdirSync(configDir(), { recursive: true })
  if (theme && !existsSync(configThemeFile())) {
    writeFileSync(configThemeFile(), JSON.stringify(theme, null, 2), 'utf-8')
  }
  if (iconPack && !existsSync(configIconPackFile())) {
    writeFileSync(configIconPackFile(), JSON.stringify(iconPack, null, 2), 'utf-8')
  }
  // 迁移完成，删除旧聚合文件
  try { rmSync(legacy) } catch { /* ignore */ }
}

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { configThemeFile } from '../data-paths.js'
import { type UserThemeSelection } from './types.js'
import { normalizeThemeSelection } from './validation.js'
import { ensureLegacyMigrated } from './migrate.js'

function readTheme(): UserThemeSelection | null {
  ensureLegacyMigrated()
  const file = configThemeFile()
  if (!existsSync(file)) return null
  try {
    return normalizeThemeSelection(JSON.parse(readFileSync(file, 'utf-8')))
  } catch {
    return null
  }
}

function persist(theme: UserThemeSelection | null): void {
  const file = configThemeFile()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(theme ?? { mode: 'system' }, null, 2), 'utf-8')
  renameSync(temp, file)
}

export function getThemeSelection(): UserThemeSelection | null {
  return readTheme()
}

export function saveThemeSelection(theme: UserThemeSelection | null): void {
  persist(theme)
}

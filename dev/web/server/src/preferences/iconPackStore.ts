import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { configIconPackFile } from '../data-paths.js'
import { type UserIconPackSelection } from './types.js'
import { normalizeIconPackSelection } from './validation.js'
import { ensureLegacyMigrated } from './migrate.js'

function readIconPack(): UserIconPackSelection | null {
  ensureLegacyMigrated()
  const file = configIconPackFile()
  if (!existsSync(file)) return null
  try {
    return normalizeIconPackSelection(JSON.parse(readFileSync(file, 'utf-8')))
  } catch {
    return null
  }
}

function persist(pack: UserIconPackSelection | null): void {
  const file = configIconPackFile()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(pack ?? { packId: 'lucide' }, null, 2), 'utf-8')
  renameSync(temp, file)
}

export function getIconPackSelection(): UserIconPackSelection | null {
  return readIconPack()
}

export function saveIconPackSelection(pack: UserIconPackSelection | null): void {
  persist(pack)
}

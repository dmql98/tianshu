import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { characterMetaStore } from '../db/characterStore.js'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const CHAR_DIR = resolve(DATA_DIR, 'characters')

function readMdOrLegacy(characterId: string, section: string, legacyKey: string): string {
  const f = resolve(CHAR_DIR, characterId, `${section}.md`)
  if (existsSync(f)) return readFileSync(f, 'utf-8')
  const record = characterMetaStore.getById(characterId)
  if (record) return (record as any)[legacyKey] || ''
  return ''
}

export const characterContentStore = {
  get(characterId: string) {
    return {
      soul: readMdOrLegacy(characterId, 'soul', 'soul'),
      user: readMdOrLegacy(characterId, 'user', 'userProfile'),
      memory: readMdOrLegacy(characterId, 'memory', 'memoryContent'),
    }
  },
  save(characterId: string, data: { soul?: string; user?: string; memory?: string; prompt?: string }) {
    const dir = resolve(CHAR_DIR, characterId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'soul.md'), data.soul ?? '', 'utf-8')
    writeFileSync(resolve(dir, 'user.md'), data.user ?? '', 'utf-8')
    writeFileSync(resolve(dir, 'memory.md'), data.memory ?? '', 'utf-8')
    if (data.prompt !== undefined) {
      if (data.prompt) writeFileSync(resolve(dir, 'prompt.md'), data.prompt, 'utf-8')
      else try { rmSync(resolve(dir, 'prompt.md')) } catch {}
    }
  },
}



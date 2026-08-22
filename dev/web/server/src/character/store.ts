import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { characterMetaStore, type CharacterRecord } from '../db/characterStore.js'
import { charactersRoot } from '../data-paths.js'

/**
 * 角色内容（soul / user / memory / prompt）的目录：单层化后所有角色
 * （内置 seed 副本 + 用户创建/编辑）都在 <dataDir>/characters/<id>/。
 * 运行状态（memory.md 等）只在用户层产生。
 */
export function characterDir(id: string): string {
  return resolve(charactersRoot(), id)
}

/** 用户层角色目录是否存在（写入口判断）。 */
export function userCharacterDir(id: string): string {
  return resolve(charactersRoot(), id)
}

function readMdOrLegacy(characterId: string, section: string, legacyKey: string): string {
  const dir = characterDir(characterId)
  const f = resolve(dir, `${section}.md`)
  if (existsSync(f)) return readFileSync(f, 'utf-8')
  // 内置角色没有 memory.md 时返回空（运行状态不属于发行层）。
  const record = characterMetaStore.getById(characterId)
  if (record && !record.readOnly) {
    const userRec = (record as CharacterRecord & { soul?: string; userProfile?: string; memoryContent?: string })
    if (legacyKey === 'soul' && userRec.soul) return userRec.soul
    if (legacyKey === 'userProfile' && userRec.userProfile) return userRec.userProfile
    if (legacyKey === 'memoryContent' && userRec.memoryContent) return userRec.memoryContent
  }
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

  /**
   * 写入口：内置角色首次持久写入前自动物化用户副本（copy-on-write），
   * 之后所有内容写入用户层。缺省字段表示"保持不变"。
   */
  save(characterId: string, data: { soul?: string; user?: string; memory?: string; prompt?: string }) {
    // 单层化：seed 保证 <dataDir>/characters/<id> 已存在；直接写入用户层。
    const dir = userCharacterDir(characterId)
    mkdirSync(dir, { recursive: true })
    if (data.soul !== undefined) writeFileSync(resolve(dir, 'soul.md'), data.soul, 'utf-8')
    if (data.user !== undefined) writeFileSync(resolve(dir, 'user.md'), data.user, 'utf-8')
    if (data.memory !== undefined) writeFileSync(resolve(dir, 'memory.md'), data.memory, 'utf-8')
    if (data.prompt !== undefined) {
      if (data.prompt) writeFileSync(resolve(dir, 'prompt.md'), data.prompt, 'utf-8')
      else try { rmSync(resolve(dir, 'prompt.md')) } catch {}
    }
  },
}

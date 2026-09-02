/**
 * 皮肤迁移（SKIN_DECOUPLE_PLAN）：把角色里现有的 visual 独立成 skin 并绑定角色。
 *
 * 「现有角色视觉全部强制迁移成 skin/<名>/」：遍历所有角色（内置+用户），
 * 若角色有 visual 且尚未绑定皮肤，则把它抽取为 <dataDir>/skin/<id>/ 皮肤并
 * 在角色上写入 skinId。内置角色 visual 位于只读内容层，采用 copy；用户层
 * 角色 visual 也采用 copy（保留原始目录，避免破坏只读层与运行态引用）。
 *
 * 幂等：角色已绑定存在的皮肤时跳过；重复调用安全。
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { characterMetaStore } from '../db/characterStore.js'
import { charactersRoot } from '../data-paths.js'
import { migrateCharacterVisualToSkin, skinStore } from './skin-store.js'

/** 角色 visual 解析：单层化后视觉只位于 <dataDir>/characters/<id>/visual。 */
function visualDirFor(characterId: string): string | null {
  const userDir = resolve(charactersRoot(), characterId, 'visual')
  if (existsSync(userDir)) return userDir
  return null
}

/**
 * 启动迁移。返回迁移成功的角色数。
 */
export function migrateAllCharacterVisualsToSkin(): { migrated: number; skipped: number } {
  const chars = characterMetaStore.getAll()
  let migrated = 0
  let skipped = 0
  for (const record of chars) {
    const id = record.id
    // 已绑定且皮肤存在 → 跳过（幂等）。
    if (record.skinId && skinStore.get(record.skinId)) {
      skipped++
      continue
    }
    const visualDir = visualDirFor(id)
    if (!visualDir) {
      // 无视觉的角色不参与迁移。
      skipped++
      continue
    }
    const name = record.name || id
    let skinId: string | null = null
    try {
      skinId = migrateCharacterVisualToSkin(id, visualDir, { name, copy: true })
    } catch {
      skinId = null
    }
    if (!skinId) {
      // 没有可迁移资产（清单为空）→ 跳过。
      skipped++
      continue
    }
    try {
      // 直接写 skinId 到 character.json，不走 characterMetaStore.update()
      // 因为 update() 会将 source 强制改为 'user'，破坏内置角色的 builtin 标签。
      const charFile = resolve(charactersRoot(), id, 'character.json')
      const raw = JSON.parse(readFileSync(charFile, 'utf-8'))
      raw.skinId = skinId
      writeFileSync(charFile, JSON.stringify(raw, null, 2), 'utf-8')
      migrated++
    } catch {
      // 角色写失败不中断其它角色。
      skipped++
    }
  }
  return { migrated, skipped }
}

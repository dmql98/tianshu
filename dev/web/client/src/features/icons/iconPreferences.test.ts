import { describe, expect, it } from 'vitest'
import { DEFAULT_ICON_PACK_ID } from './iconDefinitions'
import {
  ICON_PACK_PREFERENCES_STORAGE_KEY,
  LEGACY_ICON_PACK_STORAGE_KEY,
  appliedIconPackId,
  loadIconPackPreferences,
  migrateLegacyIconPackSelection,
  normalizeIconPackPreferences,
  saveIconPackPreferences,
  type IconPackPreferences,
} from './iconPreferences'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('iconPreferences v1: 存储与回退', () => {
  it('空存储返回默认 lucide', () => {
    const storage = new MemoryStorage()
    expect(loadIconPackPreferences(storage)).toEqual({ version: 1, selection: { packId: DEFAULT_ICON_PACK_ID } })
  })

  it('损坏 JSON 安全回退默认', () => {
    const storage = new MemoryStorage()
    storage.setItem(ICON_PACK_PREFERENCES_STORAGE_KEY, '{broken')
    expect(loadIconPackPreferences(storage).selection.packId).toBe(DEFAULT_ICON_PACK_ID)
  })

  it('未知版本回退默认', () => {
    const storage = new MemoryStorage()
    storage.setItem(ICON_PACK_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 99,
      selection: { packId: 'streamline-freehand' },
    }))
    expect(loadIconPackPreferences(storage).selection.packId).toBe(DEFAULT_ICON_PACK_ID)
  })

  it('非法 packId（路径/URL 型）回退默认', () => {
    expect(normalizeIconPackPreferences({ version: 1, selection: { packId: '../../etc/passwd' } } as unknown).selection.packId).toBe(DEFAULT_ICON_PACK_ID)
    expect(normalizeIconPackPreferences({ version: 1, selection: { packId: 'https://evil.example/x' } } as unknown).selection.packId).toBe(DEFAULT_ICON_PACK_ID)
    expect(normalizeIconPackPreferences({ version: 1, selection: { packId: 'custom-forest' } } as unknown).selection.packId).toBe('custom-forest')
  })

  it('保存后 round-trip 一致', () => {
    const storage = new MemoryStorage()
    const prefs: IconPackPreferences = { version: 1, selection: { packId: 'streamline-freehand' } }
    saveIconPackPreferences(prefs, storage)
    expect(loadIconPackPreferences(storage)).toEqual(prefs)
  })

  it('v1 偏好只包含轻量 selection（不携带自定义包内容）', () => {
    const storage = new MemoryStorage()
    saveIconPackPreferences({ version: 1, selection: { packId: 'custom-x' } }, storage)
    const parsed = JSON.parse(storage.getItem(ICON_PACK_PREFERENCES_STORAGE_KEY)!)
    expect(parsed).toEqual({ version: 1, selection: { packId: 'custom-x' } })
    expect(parsed.packs).toBeUndefined()
    expect(parsed.overrides).toBeUndefined()
  })
})

describe('iconPreferences v1: 旧键迁移', () => {
  it('tianshu:iconPack=lucide → v1 lucide', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_ICON_PACK_STORAGE_KEY, 'lucide')
    expect(migrateLegacyIconPackSelection(storage)?.selection).toEqual({ packId: 'lucide' })
  })

  it('tianshu:iconPack=custom-abc → v1 custom-abc', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_ICON_PACK_STORAGE_KEY, 'custom-abc')
    expect(migrateLegacyIconPackSelection(storage)?.selection).toEqual({ packId: 'custom-abc' })
  })

  it('非法旧值回退默认', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_ICON_PACK_STORAGE_KEY, 'a/b')
    expect(migrateLegacyIconPackSelection(storage)?.selection).toEqual({ packId: DEFAULT_ICON_PACK_ID })
  })

  it('无旧键返回 null（不写新键）', () => {
    const storage = new MemoryStorage()
    expect(migrateLegacyIconPackSelection(storage)).toBeNull()
  })

  it('load 在 v1 键缺失时走旧键迁移', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_ICON_PACK_STORAGE_KEY, 'streamline-freehand')
    expect(loadIconPackPreferences(storage).selection.packId).toBe('streamline-freehand')
    expect(storage.getItem(ICON_PACK_PREFERENCES_STORAGE_KEY)).toBeTruthy()
  })
})

describe('iconPreferences v1: 规范化', () => {
  it('normalize 丢弃未知字段', () => {
    const prefs = normalizeIconPackPreferences({
      version: 1,
      selection: { packId: 'lucide' },
      packs: [{ id: 'x' }],
      extra: 42,
    } as unknown)
    expect(prefs).toEqual({ version: 1, selection: { packId: 'lucide' } })
  })

  it('非对象输入回退默认', () => {
    expect(normalizeIconPackPreferences(null)).toEqual({ version: 1, selection: { packId: DEFAULT_ICON_PACK_ID } })
    expect(normalizeIconPackPreferences('nope')).toEqual({ version: 1, selection: { packId: DEFAULT_ICON_PACK_ID } })
  })

  it('appliedIconPackId 返回当前激活包', () => {
    const storage = new MemoryStorage()
    saveIconPackPreferences({ version: 1, selection: { packId: 'custom-abc' } }, storage)
    expect(appliedIconPackId(storage)).toBe('custom-abc')
  })
})

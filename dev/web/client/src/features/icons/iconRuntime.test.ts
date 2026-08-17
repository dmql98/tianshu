/**
 * 图标包运行时测试。
 *
 * 统一模型验证：内置包与用户包都按 asset 解析，差异仅在 source（builtin/user）。
 * 解析顺序：覆盖层 → 激活包（内置或用户）→ 默认 lucide 兜底。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_ICON_PACK_ID } from './iconDefinitions'
import { ICON_PACK_PREFERENCES_STORAGE_KEY } from './iconPreferences'
import {
  appliedPackId,
  resolveIcon,
  setActiveIconPack,
  type IconRuntimeDeps,
} from './iconRuntime'
import type { CustomIconPack } from './iconPacksApi'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function builtinLucide(): CustomIconPack {
  return {
    id: DEFAULT_ICON_PACK_ID,
    name: 'Lucide',
    source: 'builtin',
    readOnly: true,
    slots: {
      'nav-chat': { url: '/api/iconpacks/lucide/assets/nav-chat.svg', tint: true },
      'nav-settings': { url: '/api/iconpacks/lucide/assets/nav-settings.svg', tint: true },
    },
    createdAt: '',
    updatedAt: '',
    slotCount: 2,
  }
}

function deps(overrides = {}, packs: CustomIconPack[] = []): IconRuntimeDeps {
  return { storage: new MemoryStorage(), overrides, packs, dispatch: false }
}

describe('iconRuntime: 激活包', () => {
  it('默认激活 lucide', () => {
    expect(appliedPackId(deps())).toBe(DEFAULT_ICON_PACK_ID)
  })

  it('setActiveIconPack 持久化并返回', () => {
    const d = deps()
    setActiveIconPack('streamline-freehand', d)
    expect(appliedPackId(d)).toBe('streamline-freehand')
    const raw = JSON.parse((d.storage as MemoryStorage).getItem(ICON_PACK_PREFERENCES_STORAGE_KEY)!)
    expect(raw.selection.packId).toBe('streamline-freehand')
  })

  it('非法 packId 回退默认', () => {
    const d = deps()
    setActiveIconPack('../../etc/passwd', d)
    expect(appliedPackId(d)).toBe(DEFAULT_ICON_PACK_ID)
  })
})

describe('iconRuntime: 统一解析（内置 = 用户 = asset）', () => {
  it('内置 lucide 槽位解析为 asset（与用户包同型）', () => {
    const resolved = resolveIcon('nav-chat', deps({}, [builtinLucide()]))
    expect(resolved?.kind).toBe('asset')
    if (resolved?.kind === 'asset') {
      expect(resolved.url).toContain('/api/iconpacks/lucide/assets/')
      expect(resolved.tint).toBe(true)
    }
  })

  it('覆盖层优先于内置包', () => {
    const resolved = resolveIcon('nav-chat', deps({ 'nav-chat': { url: '/api/iconpacks/x/assets/a.svg', tint: true } }, [builtinLucide()]))
    expect(resolved?.kind).toBe('asset')
    if (resolved?.kind === 'asset') {
      expect(resolved.url).toBe('/api/iconpacks/x/assets/a.svg')
      expect(resolved.tint).toBe(true)
    }
  })

  it('激活用户包优先于内置包', () => {
    const pack: CustomIconPack = {
      id: 'custom-mine',
      name: '我的包',
      source: 'user',
      readOnly: false,
      slots: { 'nav-chat': { url: '/api/iconpacks/custom-mine/assets/a.svg', tint: false } },
      createdAt: '',
      updatedAt: '',
      slotCount: 1,
    }
    const d = deps({}, [builtinLucide(), pack])
    setActiveIconPack('custom-mine', d)
    const resolved = resolveIcon('nav-chat', d)
    expect(resolved?.kind).toBe('asset')
    if (resolved?.kind === 'asset') {
      expect(resolved.url).toContain('custom-mine')
      expect(resolved.tint).toBe(false)
    }
  })

  it('覆盖层优先于激活用户包', () => {
    const pack: CustomIconPack = {
      id: 'custom-mine',
      name: '我的包',
      source: 'user',
      readOnly: false,
      slots: { 'nav-chat': { url: '/api/iconpacks/custom-mine/assets/a.svg', tint: false } },
      createdAt: '',
      updatedAt: '',
      slotCount: 1,
    }
    const d = deps({ 'nav-chat': { url: '/api/iconpacks/__overrides__/assets/o.svg', tint: true } }, [builtinLucide(), pack])
    setActiveIconPack('custom-mine', d)
    const resolved = resolveIcon('nav-chat', d)
    expect(resolved?.kind).toBe('asset')
    if (resolved?.kind === 'asset') expect(resolved.url).toContain('__overrides__')
  })

  it('用户包未填槽位回退内置 lucide', () => {
    const pack: CustomIconPack = {
      id: 'custom-mine',
      name: '我的包',
      source: 'user',
      readOnly: false,
      slots: { 'nav-settings': { url: '/x.svg', tint: false } },
      createdAt: '',
      updatedAt: '',
      slotCount: 1,
    }
    const d = deps({}, [builtinLucide(), pack])
    setActiveIconPack('custom-mine', d)
    const resolved = resolveIcon('nav-chat', d)
    expect(resolved?.kind).toBe('asset')
    if (resolved?.kind === 'asset') expect(resolved.url).toContain('lucide')
  })

  it('未知槽位且默认包也未定义 → 返回 null', () => {
    expect(resolveIcon('not-a-slot', deps({}, [builtinLucide()]))).toBeNull()
  })
})
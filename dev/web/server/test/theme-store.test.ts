import { describe, expect, it, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  cleanupTempDirs,
  deleteTheme,
  duplicateTheme,
  getTheme,
  listThemes,
  renameTheme,
  resolveThemeAsset,
  saveTheme,
  validateUploadedImage,
} from '../src/theme/store.js'
import { charactersRoot, dataRoot, skillsRoot, themesRoot } from '../src/data-paths.js'

// config.ts 的 getDataDir() 有模块级缓存，进程内只解析一次；
// 所有 store 测试共享同一 dataRoot，beforeEach 清空 themes 目录实现隔离。
beforeEach(() => {
  if (!process.env.TIANSHU_DATA_DIR) {
    process.env.TIANSHU_DATA_DIR = mkdtempSync(join(tmpdir(), 'tianshu-theme-store-'))
  }
  const themes = themesRoot()
  if (existsSync(themes)) rmSync(themes, { recursive: true, force: true })
  mkdirSync(themes, { recursive: true })
})

const validColors = {
  canvas: '#111713',
  surface1: '#1b241e',
  surface2: '#263129',
  input: '#202a23',
  accent: '#8faf76',
  textPrimary: '#f2f5ef',
  textSecondary: '#b8c2b5',
  border: '#435047',
}

function pngFixture(width = 320, height = 200): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const set32 = (off: number, v: number) => {
    bytes[off] = (v >>> 24) & 0xff
    bytes[off + 1] = (v >>> 16) & 0xff
    bytes[off + 2] = (v >>> 8) & 0xff
    bytes[off + 3] = v & 0xff
  }
  set32(16, width)
  set32(20, height)
  bytes[24] = 8
  bytes[25] = 6
  return bytes
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    name: '森林',
    appearance: 'dark' as const,
    colors: validColors,
    artwork: { focusX: 0.58, focusY: 0.36, homeOpacity: 0.8, taskOpacity: 0.35, dim: 0.25 },
    ...overrides,
  }
}

describe('theme store: 与 characters/skills 同根', () => {
  it('themesRoot 与 charactersRoot/skillsRoot 来自同一 dataRoot', () => {
    const root = dataRoot()
    expect(charactersRoot()).toBe(join(root, 'characters'))
    expect(skillsRoot()).toBe(join(root, 'skills'))
    expect(themesRoot()).toBe(join(root, 'themes'))
  })
})

describe('theme store: 生命周期', () => {
  it('创建 → 列表 → 读取 → 复制 → 重命名 → 删除', () => {
    const record = saveTheme('custom-forest', makeInput({
      background: { kind: 'background', bytes: pngFixture(), filename: 'background.png', mime: 'image/png', width: 320, height: 200 },
    }))
    expect(record.id).toBe('custom-forest')
    expect(record.name).toBe('森林')
    expect(record.artwork?.file).toBe('background.png')

    const { themes, skipped } = listThemes()
    expect(themes.length).toBe(1)
    expect(skipped.length).toBe(0)

    const fetched = getTheme('custom-forest')
    expect(fetched?.colors.canvas).toBe('#111713')

    // 资产可访问
    const assetPath = resolveThemeAsset('custom-forest', 'background.png')
    expect(assetPath).not.toBeNull()
    expect(existsSync(assetPath!)).toBe(true)

    // 复制
    const dup = duplicateTheme('custom-forest')
    expect(dup.id).not.toBe('custom-forest')
    expect(dup.id.startsWith('custom-')).toBe(true)
    expect(listThemes().themes.length).toBe(2)
    expect(existsSync(join(themesRoot(), dup.id, 'background.png'))).toBe(true)

    // 重命名
    const renamed = renameTheme(dup.id, '森林副本')
    expect(renamed.name).toBe('森林副本')

    // 删除
    const result = deleteTheme('custom-forest')
    expect(result.deleted).toBe(true)
    expect(getTheme('custom-forest')).toBeNull()
    expect(listThemes().themes.length).toBe(1)
  })

  it('删除不存在的主题返回 deleted:false', () => {
    expect(deleteTheme('custom-ghost').deleted).toBe(false)
  })

  it('非法 ID 拒绝', () => {
    expect(() => saveTheme('../evil', makeInput())).toThrow()
    expect(() => deleteTheme('../evil')).toThrow()
    expect(getTheme('../evil')).toBeNull()
  })
})

describe('theme store: 原子性与失败保留旧版', () => {
  it('更新替换素材并清理旧素材', () => {
    saveTheme('custom-a', makeInput({
      background: { kind: 'background', bytes: pngFixture(320, 200), filename: 'background.png', mime: 'image/png', width: 320, height: 200 },
    }))
    const updated = saveTheme('custom-a', makeInput({
      name: '森林 v2',
      background: { kind: 'background', bytes: pngFixture(400, 300), filename: 'background.jpg', mime: 'image/jpeg', width: 400, height: 300 },
    }))
    expect(updated.name).toBe('森林 v2')
    expect(updated.artwork?.file).toBe('background.jpg')
    // 旧素材清理
    const dir = join(themesRoot(), 'custom-a')
    const files = readdirSync(dir)
    expect(files).not.toContain('background.png')
    expect(files).toContain('background.jpg')
    expect(files).toContain('theme.json')
  })

  it('保存成功后无残留临时目录', () => {
    saveTheme('custom-clean', makeInput())
    const entries = readdirSync(themesRoot())
    expect(entries.filter(e => e.startsWith('.tmp-'))).toEqual([])
  })

  it('非法素材文件名拒绝保存且不产生正式目录', () => {
    expect(() => saveTheme('custom-bad', makeInput({
      background: { kind: 'background', bytes: new Uint8Array([1, 2, 3]), filename: '../../x.gif', mime: 'image/gif', width: 0, height: 0 },
    }))).toThrow()
    expect(existsSync(join(themesRoot(), 'custom-bad'))).toBe(false)
    // 失败必须无残留临时目录
    const entries = readdirSync(themesRoot())
    expect(entries.filter(e => e.startsWith('.tmp-'))).toEqual([])
  })
})

describe('theme store: 损坏隔离', () => {
  it('损坏 theme.json 跳过列表且 getTheme 返回 null', () => {
    mkdirSync(join(themesRoot(), 'custom-broken'), { recursive: true })
    writeFileSync(join(themesRoot(), 'custom-broken', 'theme.json'), '{broken', 'utf-8')

    const { themes, skipped } = listThemes()
    expect(themes.length).toBe(0)
    expect(skipped.length).toBe(1)
    expect(skipped[0].dir).toBe('custom-broken')
    expect(getTheme('custom-broken')).toBeNull()
  })

  it('缺失 theme.json 的目录被跳过', () => {
    mkdirSync(join(themesRoot(), 'custom-nofile'), { recursive: true })
    const { skipped } = listThemes()
    expect(skipped.some(s => s.dir === 'custom-nofile')).toBe(true)
  })

  it('素材缺失的主题视为无效（getTheme null，不能成为活动主题）', () => {
    const record = saveTheme('custom-forest', makeInput({
      background: { kind: 'background', bytes: pngFixture(), filename: 'background.png', mime: 'image/png', width: 320, height: 200 },
    }))
    expect(getTheme('custom-forest')).not.toBeNull()
    rmSync(join(themesRoot(), 'custom-forest', 'background.png'))
    expect(getTheme('custom-forest')).toBeNull()
    expect(record).toBeTruthy()
  })

  it('空目录返回空列表', () => {
    expect(listThemes().themes).toEqual([])
  })
})

describe('theme store: 资产安全', () => {
  it('资产接口拒绝未登记文件与路径穿越', () => {
    saveTheme('custom-a', makeInput({
      background: { kind: 'background', bytes: pngFixture(), filename: 'background.png', mime: 'image/png', width: 320, height: 200 },
    }))
    expect(resolveThemeAsset('custom-a', 'background.png')).not.toBeNull()
    expect(resolveThemeAsset('custom-a', 'theme.json')).toBeNull()
    expect(resolveThemeAsset('custom-a', '../secret.txt')).toBeNull()
    expect(resolveThemeAsset('custom-a', 'a/b.png')).toBeNull()
    expect(resolveThemeAsset('custom-ghost', 'background.png')).toBeNull()
  })
})

describe('theme store: 临时目录清理', () => {
  it('清理超时 .tmp- 目录，不触碰正式主题', () => {
    saveTheme('custom-keep', makeInput())
    mkdirSync(join(themesRoot(), '.tmp-custom-stale-abc'), { recursive: true })
    writeFileSync(join(themesRoot(), '.tmp-custom-stale-abc', 'theme.json'), '{}', 'utf-8')
    // 把临时目录 mtime 设为过去（文件系统时钟精度不保证 now-mtime>0）
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(themesRoot(), '.tmp-custom-stale-abc'), old, old)
    const removed = cleanupTempDirs(30_000)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(existsSync(join(themesRoot(), '.tmp-custom-stale-abc'))).toBe(false)
    expect(getTheme('custom-keep')).not.toBeNull()
  })
})

describe('theme store: 图片校验集成', () => {
  it('validateUploadedImage 返回规范化文件名与尺寸', () => {
    const result = validateUploadedImage(pngFixture(640, 480), 'background')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.filename).toBe('background.png')
      expect(result.width).toBe(640)
      expect(result.mime).toBe('image/png')
    }
  })

  it('拒绝 GIF 上传', () => {
    const result = validateUploadedImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]), 'background')
    expect(result.ok).toBe(false)
  })
})

describe('theme store: 数据目录切换', () => {
  it('themesRoot 严格派生自当前 dataRoot（不固定 userData）', () => {
    const root = dataRoot()
    expect(themesRoot()).toBe(join(root, 'themes'))
    expect(themesRoot().startsWith(join(root))).toBe(true)
  })
})

describe('theme store: 更新保留 createdAt', () => {
  it('更新不改变 createdAt', () => {
    const created = saveTheme('custom-t', makeInput())
    const updated = saveTheme('custom-t', makeInput({ name: '改名' }))
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.name).toBe('改名')
  })
})

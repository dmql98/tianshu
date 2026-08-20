import { describe, expect, it } from 'vitest'
import {
  THEME_SCHEMA_VERSION,
  buildThemeRecord,
  generateThemeId,
  isValidAssetFileName,
  isValidColorValue,
  isValidThemeId,
  normalizeHomeTitle,
  parseThemeRecord,
} from '../src/theme/schema.js'

describe('theme schema: id 与路径安全', () => {
  it('服务端 ID 形状：custom-<slug>', () => {
    expect(isValidThemeId('custom-forest')).toBe(true)
    expect(isValidThemeId('custom-forest-abc123')).toBe(true)
    expect(isValidThemeId('custom-a')).toBe(true)
    expect(isValidThemeId('forest')).toBe(false)
    expect(isValidThemeId('../etc/passwd')).toBe(false)
    expect(isValidThemeId('custom/../../x')).toBe(false)
    expect(isValidThemeId('C:\\Users\\x')).toBe(false)
    expect(isValidThemeId('')).toBe(false)
  })

  it('generateThemeId 生成安全 slug ID', () => {
    const id = generateThemeId('我的 森林 Theme!')
    expect(isValidThemeId(id)).toBe(true)
    expect(id.startsWith('custom-')).toBe(true)
  })

  it('素材文件名拒绝路径穿越与绝对路径', () => {
    expect(isValidAssetFileName('background.webp')).toBe(true)
    expect(isValidAssetFileName('a.b-c_1.png')).toBe(true)
    expect(isValidAssetFileName('../x.png')).toBe(false)
    expect(isValidAssetFileName('a/b.png')).toBe(false)
    expect(isValidAssetFileName('a\\b.png')).toBe(false)
    expect(isValidAssetFileName('C:\\x.png')).toBe(false)
    expect(isValidAssetFileName('.hidden.png')).toBe(false)
    expect(isValidAssetFileName('')).toBe(false)
    expect(isValidAssetFileName('x'.repeat(200))).toBe(false)
  })
})

describe('theme schema: 颜色校验', () => {
  it('接受 hex 与 rgba，拒绝非法值', () => {
    expect(isValidColorValue('#a1b2c3')).toBe(true)
    expect(isValidColorValue('#ABC')).toBe(false)
    expect(isValidColorValue('rgba(1,2,3,0.5)')).toBe(true)
    expect(isValidColorValue('red')).toBe(false)
    expect(isValidColorValue('url(https://x)')).toBe(false)
  })
})

describe('theme schema: 记录解析', () => {
  const valid = {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: 'custom-forest',
    name: '森林',
    appearance: 'dark',
    artwork: {
      file: 'background.webp',
      preview: 'preview.webp',
      focusX: 0.58,
      focusY: 0.36,
      scale: 1.35,
      homeOpacity: 0.8,
      taskOpacity: 0.35,
      dim: 0.25,
    },
    colors: {
      canvas: '#111713',
      textPrimary: '#f2f5ef',
      accent: '#8faf76',
    },
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  }

  it('解析合法记录', () => {
    const record = parseThemeRecord(JSON.stringify(valid), 'custom-forest')
    expect(record).not.toBeNull()
    expect(record!.id).toBe('custom-forest')
    expect(record!.appearance).toBe('dark')
    expect(record!.colors.canvas).toBe('#111713')
    expect(record!.artwork?.focusX).toBeCloseTo(0.58)
    expect(record!.artwork?.scale).toBeCloseTo(1.35)
  })

  it('目录名与 id 不一致时以目录名为准', () => {
    const record = parseThemeRecord(JSON.stringify({ ...valid, id: 'custom-other' }), 'custom-forest')
    expect(record!.id).toBe('custom-forest')
  })

  it('损坏 JSON → null', () => {
    expect(parseThemeRecord('{broken', 'custom-forest')).toBeNull()
  })

  it('schema 版本未知 → null', () => {
    expect(parseThemeRecord(JSON.stringify({ ...valid, schemaVersion: 99 }), 'custom-forest')).toBeNull()
  })

  it('缺少核心色板 → null', () => {
    const noAccent = { ...valid, colors: { canvas: '#111', textPrimary: '#fff' } }
    expect(parseThemeRecord(JSON.stringify(noAccent), 'custom-forest')).toBeNull()
  })

  it('非法素材路径被剔除（不拒绝整个记录，但 artwork.file 变 undefined）', () => {
    const badArtwork = { ...valid, artwork: { ...valid.artwork, file: '../../x.webp' } }
    const record = parseThemeRecord(JSON.stringify(badArtwork), 'custom-forest')
    expect(record).not.toBeNull()
    expect(record!.artwork?.file).toBeUndefined()
  })

  it('未知颜色 slot 被丢弃', () => {
    const withUnknown = { ...valid, colors: { ...valid.colors, evil: '#000000', '--x': '#fff' } }
    const record = parseThemeRecord(JSON.stringify(withUnknown), 'custom-forest')
    expect(record!.colors.evil).toBeUndefined()
  })

  it('buildThemeRecord 生成新记录', () => {
    const record = buildThemeRecord({
      id: 'custom-a1b2',
      name: '星海',
      appearance: 'light',
      colors: { canvas: '#ffffff', textPrimary: '#111111', accent: '#3b82f6' },
      artwork: { focusX: 0.3, focusY: 0.7, scale: 5, homeOpacity: 0.8, taskOpacity: 0.3, dim: 0.1 },
    })
    expect(record.id).toBe('custom-a1b2')
    expect(record.schemaVersion).toBe(THEME_SCHEMA_VERSION)
    expect(record.updatedAt).toBeTruthy()
    expect(record.artwork?.scale).toBe(2.5)
  })

  it('artwork 翻转：缺省为 false，true 原样保留', () => {
    const record = parseThemeRecord(
      JSON.stringify({ ...valid, artwork: { ...valid.artwork, flipX: true } }),
      'custom-forest',
    )
    expect(record!.artwork?.flipX).toBe(true)
    expect(record!.artwork?.flipY).toBe(false)
    const legacy = parseThemeRecord(JSON.stringify(valid), 'custom-forest')
    expect(legacy!.artwork?.flipX).toBe(false)
    expect(legacy!.artwork?.flipY).toBe(false)
  })
})

describe('theme schema: home.title', () => {
  const base = {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: 'custom-home',
    name: '带标题',
    appearance: 'light',
    colors: { canvas: '#ffffff', textPrimary: '#111111', accent: '#3b82f6' },
  }

  it('旧版无 home 的主题仍能加载', () => {
    const record = parseThemeRecord(JSON.stringify(base), 'custom-home')
    expect(record).not.toBeNull()
    expect(record!.home).toBeUndefined()
  })

  it('合法标题完整往返', () => {
    const record = parseThemeRecord(JSON.stringify({ ...base, home: { title: '早上好，今天想推进什么？' } }), 'custom-home')
    expect(record!.home).toEqual({ title: '早上好，今天想推进什么？' })
  })

  it('首尾空白被清理', () => {
    const record = parseThemeRecord(JSON.stringify({ ...base, home: { title: '  推进计划  ' } }), 'custom-home')
    expect(record!.home!.title).toBe('推进计划')
  })

  it('空标题不写入 home（回退默认标题）', () => {
    const record = parseThemeRecord(JSON.stringify({ ...base, home: { title: '   ' } }), 'custom-home')
    expect(record!.home).toBeUndefined()
  })

  it('非对象 home 被忽略', () => {
    const record = parseThemeRecord(JSON.stringify({ ...base, home: '标题' }), 'custom-home')
    expect(record!.home).toBeUndefined()
  })

  it('超长标题截断到 60 个 Unicode 码点', () => {
    const record = parseThemeRecord(JSON.stringify({ ...base, home: { title: '😀'.repeat(80) } }), 'custom-home')
    expect([...(record!.home!.title)]).toHaveLength(60)
  })

  it('控制字符被去除', () => {
    const record = parseThemeRecord(JSON.stringify({ ...base, home: { title: 'a\u0000b\u0007c' } }), 'custom-home')
    expect(record!.home!.title).toBe('abc')
  })

  it('HTML 仅作为普通文本保留（前端以文本节点渲染）', () => {
    const record = parseThemeRecord(JSON.stringify({ ...base, home: { title: '<b>标题</b>' } }), 'custom-home')
    expect(record!.home!.title).toBe('<b>标题</b>')
  })

  it('buildThemeRecord 支持 home', () => {
    const record = buildThemeRecord({
      id: 'custom-a1b2',
      name: 'x',
      appearance: 'light',
      colors: { canvas: '#ffffff', textPrimary: '#111111', accent: '#3b82f6' },
      home: { title: ' 我的标题 ' },
    })
    expect(record.home).toEqual({ title: '我的标题' })
  })

  it('normalizeHomeTitle 空/非字符串返回空串', () => {
    expect(normalizeHomeTitle('')).toBe('')
    expect(normalizeHomeTitle(42)).toBe('')
    expect(normalizeHomeTitle(null)).toBe('')
  })
})

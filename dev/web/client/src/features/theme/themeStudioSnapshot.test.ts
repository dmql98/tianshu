import { describe, expect, it } from 'vitest'
import { DEFAULT_HOME_TITLE, HOME_TITLE_MAX, normalizeHomeTitle } from './themeDefinitions'
import { cloneSnapshot, snapshotEquals, type StudioSnapshot } from './ThemeStudio'

const base: StudioSnapshot = {
  name: '主题',
  appearance: 'dark',
  tokens: {
    canvas: '#111111', surface1: '#222222', surface2: '#333333', surfaceHover: '#2a2a2a',
    input: '#1a1a1a', overlay: 'rgba(0,0,0,0.5)', border: 'rgba(255,255,255,0.1)', borderSubtle: 'rgba(255,255,255,0.05)',
    textPrimary: '#ffffff', textSecondary: '#cccccc', textMuted: '#999999', textFaint: '#666666',
    textOnAccent: '#111111', accent: '#e0b341', accentHover: '#f0c35c', accentSoft: 'rgba(224,179,65,0.16)',
    link: '#e0b341', focusRing: 'rgba(224,179,65,0.6)', success: '#4caf7d', warning: '#e8933c',
    danger: '#e0735a', info: '#6b9ff3', shadowColor: 'rgba(0,0,0,0.5)', codeBg: '#111111', scrollbar: '#444444',
  },
  artwork: { focusX: 0.5, focusY: 0.5, scale: 1, homeOpacity: 0.8, taskOpacity: 0.35, dim: 0.2 },
  homeTitle: '早上好，今天想推进什么？',
}

describe('ThemeStudio 快照：首页标题', () => {
  it('cloneSnapshot 保留 homeTitle（深拷贝）', () => {
    const clone = cloneSnapshot(base)
    expect(clone.homeTitle).toBe(base.homeTitle)
    clone.homeTitle = '修改后的标题'
    expect(base.homeTitle).toBe('早上好，今天想推进什么？')
  })

  it('snapshotEquals 区分 homeTitle 差异', () => {
    const same = cloneSnapshot(base)
    expect(snapshotEquals(base, same)).toBe(true)
    const changed = cloneSnapshot(base)
    changed.homeTitle = '不同标题'
    expect(snapshotEquals(base, changed)).toBe(false)
  })
})

describe('客户端 normalizeHomeTitle', () => {
  it('默认标题与常量一致', () => {
    expect(DEFAULT_HOME_TITLE).toBe('早上好，今天想推进什么？')
  })

  it('空/非字符串返回空串', () => {
    expect(normalizeHomeTitle('')).toBe('')
    expect(normalizeHomeTitle(undefined)).toBe('')
    expect(normalizeHomeTitle(null)).toBe('')
    expect(normalizeHomeTitle(42)).toBe('')
  })

  it('清理首尾空白与控制字符', () => {
    expect(normalizeHomeTitle('  推进计划  ')).toBe('推进计划')
    expect(normalizeHomeTitle('a\u0000b\u0007c')).toBe('abc')
  })

  it('截断到 60 个 Unicode 码点且不切代理对', () => {
    const long = normalizeHomeTitle('😀'.repeat(80))
    expect([...long]).toHaveLength(HOME_TITLE_MAX)
    expect(long.endsWith('😀')).toBe(true)
  })
})

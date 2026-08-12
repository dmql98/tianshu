import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCES_STORAGE_KEY,
  applyDisplayPreferences,
  deriveTextColors,
  isValidHexColor,
  loadDisplayPreferences,
  normalizeDisplayPreferences,
  resetDisplayPreferences,
  saveDisplayPreferences,
} from './displayPreferences'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function makeRoot() {
  const properties = new Map<string, string>()
  const removed = new Set<string>()
  return {
    style: {
      setProperty(name: string, value: string) { properties.set(name, value) },
      removeProperty(name: string) { removed.add(name); properties.delete(name) },
      getPropertyValue(name: string) { return properties.get(name) ?? '' },
    },
    removed,
  } as unknown as HTMLElement & { removed: Set<string> }
}

describe('displayPreferences', () => {
  it('loads defaults when storage is empty or corrupt', () => {
    const storage = new MemoryStorage()
    expect(loadDisplayPreferences(storage)).toEqual(DEFAULT_DISPLAY_PREFERENCES)
    storage.setItem(DISPLAY_PREFERENCES_STORAGE_KEY, '{broken')
    expect(loadDisplayPreferences(storage)).toEqual(DEFAULT_DISPLAY_PREFERENCES)
  })

  it('normalizes unknown values and clamps the scale', () => {
    expect(normalizeDisplayPreferences({
      fontFamily: 'unknown',
      fontScale: 20,
      textColor: '#fff',
    })).toEqual({
      fontFamily: 'wenkai',
      fontScale: 80,
      textColorMode: 'theme',
      textColor: '#2c2418',
    })
    expect(normalizeDisplayPreferences({
      fontFamily: 'system-sans',
      fontScale: 200,
      textColorMode: 'custom',
      textColor: '#ABCDEF',
    })).toEqual({
      fontFamily: 'system-sans',
      fontScale: 140,
      textColorMode: 'custom',
      textColor: '#abcdef',
    })
  })

  it('migrates v1 data: default text color -> theme mode', () => {
    const v1 = { version: 1, fontFamily: 'wenkai', fontScale: 100, textColor: '#2c2418' }
    expect(normalizeDisplayPreferences(v1)).toEqual(DEFAULT_DISPLAY_PREFERENCES)
  })

  it('migrates v1 data: custom text color -> custom mode', () => {
    const v1 = { version: 1, fontFamily: 'wenkai', fontScale: 110, textColor: '#123456' }
    expect(normalizeDisplayPreferences(v1)).toEqual({
      fontFamily: 'wenkai',
      fontScale: 110,
      textColorMode: 'custom',
      textColor: '#123456',
    })
  })

  it('only accepts full six-digit hex colors', () => {
    expect(isValidHexColor('#123abc')).toBe(true)
    expect(isValidHexColor('#fff')).toBe(false)
    expect(isValidHexColor('123abc')).toBe(false)
    expect(isValidHexColor('#12zz00')).toBe(false)
  })

  it('preserves the existing default text hierarchy', () => {
    expect(deriveTextColors('#2c2418')).toEqual({
      deep: '#2c2418',
      mid: '#5c5040',
      light: '#8a7d68',
      faint: '#b8a890',
    })
  })

  it('saves versioned preferences and restores defaults', () => {
    const storage = new MemoryStorage()
    saveDisplayPreferences({ fontFamily: 'monospace', fontScale: 115, textColorMode: 'custom', textColor: '#112233' }, storage)
    expect(JSON.parse(storage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY)!)).toEqual({
      version: 2,
      fontFamily: 'monospace',
      fontScale: 115,
      textColorMode: 'custom',
      textColor: '#112233',
    })
    expect(loadDisplayPreferences(storage)).toEqual({
      fontFamily: 'monospace',
      fontScale: 115,
      textColorMode: 'custom',
      textColor: '#112233',
    })
    expect(resetDisplayPreferences(storage)).toEqual(DEFAULT_DISPLAY_PREFERENCES)
    expect(loadDisplayPreferences(storage)).toEqual(DEFAULT_DISPLAY_PREFERENCES)
  })

  it('applies font and scale; custom mode writes derived text colors', () => {
    const root = makeRoot()

    applyDisplayPreferences({ fontFamily: 'system-sans', fontScale: 125, textColorMode: 'custom', textColor: '#102030' }, root)

    expect(root.style.getPropertyValue('--ui-font-family')).toContain('system-ui')
    expect(root.style.getPropertyValue('--ui-font-scale')).toBe('1.25')
    expect(root.style.getPropertyValue('--ui-text-color')).toBe('#102030')
    expect(root.style.getPropertyValue('--ink-deep')).toBe('#102030')
    expect(root.style.getPropertyValue('--ink-mid')).toBe('#404c58')
  })

  it('theme mode does not override --ink-* so the theme controls text color', () => {
    const root = makeRoot()
    // 预置主题写入的 ink 值
    root.style.setProperty('--ink-deep', '#e8e2d8')

    applyDisplayPreferences({ fontFamily: 'wenkai', fontScale: 100, textColorMode: 'theme', textColor: '#2c2418' }, root)

    expect(root.removed.has('--ink-deep')).toBe(true)
    expect(root.style.getPropertyValue('--ink-deep')).toBe('')
  })
})

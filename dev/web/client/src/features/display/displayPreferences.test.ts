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
      textColor: '#2c2418',
    })
    expect(normalizeDisplayPreferences({
      fontFamily: 'system-sans',
      fontScale: 200,
      textColor: '#ABCDEF',
    })).toEqual({
      fontFamily: 'system-sans',
      fontScale: 140,
      textColor: '#abcdef',
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
    saveDisplayPreferences({ fontFamily: 'monospace', fontScale: 115, textColor: '#112233' }, storage)
    expect(JSON.parse(storage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY)!)).toEqual({
      version: 1,
      fontFamily: 'monospace',
      fontScale: 115,
      textColor: '#112233',
    })
    expect(loadDisplayPreferences(storage)).toEqual({
      fontFamily: 'monospace',
      fontScale: 115,
      textColor: '#112233',
    })
    expect(resetDisplayPreferences(storage)).toEqual(DEFAULT_DISPLAY_PREFERENCES)
    expect(loadDisplayPreferences(storage)).toEqual(DEFAULT_DISPLAY_PREFERENCES)
  })

  it('applies font, scale, and derived text colors to the root element', () => {
    const properties = new Map<string, string>()
    const root = {
      style: {
        setProperty(name: string, value: string) { properties.set(name, value) },
      },
    } as unknown as HTMLElement

    applyDisplayPreferences({ fontFamily: 'system-sans', fontScale: 125, textColor: '#102030' }, root)

    expect(properties.get('--ui-font-family')).toContain('system-ui')
    expect(properties.get('--ui-font-scale')).toBe('1.25')
    expect(properties.get('--ui-text-color')).toBe('#102030')
    expect(properties.get('--ink-deep')).toBe('#102030')
    expect(properties.get('--ink-mid')).toBe('#404c58')
  })
})

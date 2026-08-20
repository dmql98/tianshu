import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userPreferencesFile } from '../src/data-paths.js'
import {
  readUserPreferences,
  resetUserPreferencesCache,
  setUserPreferences,
} from '../src/preferences/store.js'

let tmpData: string

beforeAll(() => {
  tmpData = mkdtempSync(join(tmpdir(), 'tianshu-prefs-'))
  process.env.TIANSHU_DATA_DIR = tmpData
})

afterAll(() => {
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

describe('user preferences store', () => {
  it('returns empty state when nothing is written', () => {
    resetUserPreferencesCache()
    expect(readUserPreferences()).toEqual({ schemaVersion: 1 })
  })

  it('persists theme and iconPack selections to the config file and survives reload', () => {
    resetUserPreferencesCache()
    const updated = setUserPreferences({
      theme: { mode: 'builtin', themeId: 'tianshu-dark' },
      iconPack: { packId: 'lucide' },
    })
    expect(updated.theme).toEqual({ mode: 'builtin', themeId: 'tianshu-dark' })
    expect(updated.iconPack).toEqual({ packId: 'lucide' })

    const raw = readFileSync(userPreferencesFile(), 'utf8')
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      theme: { mode: 'builtin', themeId: 'tianshu-dark' },
      iconPack: { packId: 'lucide' },
    })

    // 清缓存模拟"重启进程后重新读取"：配置仍在（这才是持久化要保护的能力）
    resetUserPreferencesCache()
    const reloaded = readUserPreferences()
    expect(reloaded.theme?.themeId).toBe('tianshu-dark')
    expect(reloaded.iconPack?.packId).toBe('lucide')
  })

  it('merges partial updates without clobbering the other field', () => {
    resetUserPreferencesCache()
    setUserPreferences({ theme: { mode: 'system' } })
    setUserPreferences({ iconPack: { packId: 'custom-abc' } })
    const prefs = readUserPreferences()
    expect(prefs.theme).toEqual({ mode: 'system' })
    expect(prefs.iconPack).toEqual({ packId: 'custom-abc' })
  })

  it('clears a field when null is provided', () => {
    resetUserPreferencesCache()
    setUserPreferences({ theme: { mode: 'system' }, iconPack: { packId: 'lucide' } })
    const prefs = setUserPreferences({ theme: null })
    expect(prefs.theme).toBeUndefined()
    expect(prefs.iconPack).toEqual({ packId: 'lucide' })
  })

  it('rejects unsafe IDs, invalid modes, and unknown versions', () => {
    resetUserPreferencesCache()
    setUserPreferences({ theme: { mode: 'custom', themeId: '../evil' } })
    expect(readUserPreferences().theme).toBeUndefined()

    resetUserPreferencesCache()
    setUserPreferences({ iconPack: { packId: '/etc/passwd' } })
    expect(readUserPreferences().iconPack).toBeUndefined()

    resetUserPreferencesCache()
    setUserPreferences({ theme: { mode: 'builtin', themeId: 'tianshu-light' } })
    expect(readUserPreferences().theme?.themeId).toBe('tianshu-light')

    // 直接写入一个未知版本号 → 重启后安全回退空状态，不阻塞
    writeFileSync(userPreferencesFile(), JSON.stringify({ schemaVersion: 99 }), 'utf-8')
    resetUserPreferencesCache()
    expect(readUserPreferences()).toEqual({ schemaVersion: 1 })
  })
})
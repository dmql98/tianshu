import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  configThemeFile,
  configIconPackFile,
  configModelUsageFile,
  userPreferencesFile,
} from '../src/data-paths.js'
import { getThemeSelection, saveThemeSelection } from '../src/preferences/themeStore.js'
import { getIconPackSelection, saveIconPackSelection } from '../src/preferences/iconPackStore.js'
import { getModelUsage, saveModelUsage, normalizeModelUsage } from '../src/preferences/modelUsageStore.js'
import { normalizeThemeSelection, normalizeIconPackSelection } from '../src/preferences/validation.js'

let tmpData: string

beforeAll(() => {
  tmpData = mkdtempSync(join(tmpdir(), 'tianshu-prefs-'))
  process.env.TIANSHU_DATA_DIR = tmpData
})

afterAll(() => {
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

// 每个用例前清空 config/ 与旧聚合文件，保证隔离
beforeEach(() => {
  rmSync(join(tmpData, 'config'), { recursive: true, force: true })
  rmSync(userPreferencesFile(), { force: true })
})

describe('themeStore', () => {
  it('returns null when nothing is written (route layer supplies the default)', () => {
    expect(getThemeSelection()).toBeNull()
  })

  it('persists theme selection to config/theme.json and survives reload', () => {
    saveThemeSelection({ mode: 'builtin', themeId: 'tianshu-dark' })
    expect(getThemeSelection()).toEqual({ mode: 'builtin', themeId: 'tianshu-dark' })
    expect(JSON.parse(readFileSync(configThemeFile(), 'utf8'))).toEqual({ mode: 'builtin', themeId: 'tianshu-dark' })
    // 重新读取（模拟重启）仍在
    expect(getThemeSelection()?.themeId).toBe('tianshu-dark')
  })

  it('rejects unsafe theme ids', () => {
    expect(normalizeThemeSelection({ mode: 'custom', themeId: '../evil' })).toBeNull()
    expect(normalizeThemeSelection({ mode: 'builtin', themeId: 'x'.repeat(200) })).toBeNull()
    expect(normalizeThemeSelection({ mode: 'weird' })).toBeNull()
  })
})

describe('iconPackStore', () => {
  it('returns null when nothing is written (route layer supplies the default)', () => {
    expect(getIconPackSelection()).toBeNull()
  })

  it('persists iconPack selection to config/iconpack.json', () => {
    saveIconPackSelection({ packId: 'custom-abc' })
    expect(getIconPackSelection()).toEqual({ packId: 'custom-abc' })
    expect(JSON.parse(readFileSync(configIconPackFile(), 'utf8'))).toEqual({ packId: 'custom-abc' })
  })

  it('rejects unsafe pack ids', () => {
    expect(normalizeIconPackSelection({ packId: '/etc/passwd' })).toBeNull()
  })
})

describe('modelUsageStore', () => {
  it('persists counts to config/model-usage.json', () => {
    saveModelUsage({ version: 1, counts: { 'p::a': 3, 'p::b': 1 } })
    expect(getModelUsage().counts).toEqual({ 'p::a': 3, 'p::b': 1 })
    expect(JSON.parse(readFileSync(configModelUsageFile(), 'utf8')).counts).toEqual({ 'p::a': 3, 'p::b': 1 })
  })

  it('drops invalid keys and non-positive counts on normalize', () => {
    const u = normalizeModelUsage({ version: 1, counts: { bad: 1, 'p::ok': 2.9, 'p::neg': -1 } })
    expect(u.counts).toEqual({ 'p::ok': 2 })
  })
})

describe('legacy user-preferences migration', () => {
  it('migrates theme+iconPack from old user-preferences.json into config/ files and removes the legacy file', () => {
    writeFileSync(
      userPreferencesFile(),
      JSON.stringify({
        schemaVersion: 1,
        theme: { mode: 'builtin', themeId: 'tianshu-mid' },
        iconPack: { packId: 'lucide' },
      }),
      'utf-8',
    )
    expect(getThemeSelection()).toEqual({ mode: 'builtin', themeId: 'tianshu-mid' })
    expect(getIconPackSelection()).toEqual({ packId: 'lucide' })
    expect(existsSync(configThemeFile())).toBe(true)
    expect(existsSync(configIconPackFile())).toBe(true)
    // 旧聚合文件应被删除
    expect(existsSync(userPreferencesFile())).toBe(false)
  })
})

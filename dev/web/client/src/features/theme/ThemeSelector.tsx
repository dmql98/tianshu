/**
 * 主题选择器（设置 → 显示 → 主题区域，TIANSHU_THEME_SWITCHING_PLAN §4.1）。
 *
 * - 跟随系统 / 浅色 / 深色卡片 + 自定义主题列表（预览图、名称、外观、色板）。
 * - 选择立即应用并持久化（localStorage 只存轻量 selection）。
 * - 自定义主题菜单：应用 / 编辑 / 复制 / 重命名 / 删除。
 * - 主题卡片具备 radio/pressed 语义与键盘操作，不依赖颜色表达选择状态。
 * - "恢复默认"仅把选择恢复为 system，不重置字体等显示设置。
 */
import { useCallback, useEffect, useState } from 'react'
import Icon from '@/features/icons/Icon'
import { useI18n } from '@/i18n'
import {
  BUILTIN_THEMES,
  BUILTIN_THEME_DARK_ID,
  BUILTIN_THEME_LIGHT_ID,
  type ThemeDefinition,
  type ThemeSelection,
} from './themeDefinitions'
import { THEME_PREFERENCES_STORAGE_KEY, loadThemePreferences, type ThemePreferences } from './themePreferences'
import { setThemeSelection, appliedThemeId } from './themeRuntime'
import {
  deleteTheme,
  duplicateTheme,
  fetchThemes,
  renameTheme,
  themeAssetUrl,
} from './themeApi'

export interface ThemeSelectorProps {
  showToast: (msg: string, type?: 'ok' | 'err') => void
  /** 打开工作台：null = 新建；ThemeDefinition = 编辑现有主题。 */
  onOpenStudio?: (editing?: ThemeDefinition) => void
}

function selectionLabel(selection: ThemeSelection, t: (k: string) => string): string {
  if (selection.mode === 'builtin') {
    return selection.themeId === BUILTIN_THEME_LIGHT_ID ? t('浅色') : t('深色')
  }
  if (selection.mode === 'custom') return t('自定义')
  return t('跟随系统')
}

export default function ThemeSelector({ showToast, onOpenStudio }: ThemeSelectorProps) {
  const t = useI18n()
  const [prefs, setPrefs] = useState<ThemePreferences>(() => loadThemePreferences())
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>([])
  const [systemResolved, setSystemResolved] = useState<string>(() =>
    appliedThemeId() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? BUILTIN_THEME_DARK_ID : BUILTIN_THEME_LIGHT_ID),
  )
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const themes = await fetchThemes()
      setCustomThemes(themes)
      const root = document.documentElement
      setSystemResolved(root.getAttribute('data-theme-id') ?? systemResolved)
    } catch {
      showToast(t('加载主题列表失败'), 'err')
    } finally {
      setLoading(false)
    }
  }, [showToast, systemResolved])

  useEffect(() => {
    refresh()
    const onChange = () => {
      setPrefs(loadThemePreferences())
      const root = document.documentElement
      const id = root.getAttribute('data-theme-id')
      if (id) setSystemResolved(id)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_PREFERENCES_STORAGE_KEY) onChange()
    }
    window.addEventListener('tianshu:theme-changed', onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('tianshu:theme-changed', onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])

  const isCurrent = (selection: ThemeSelection): boolean => {
    if (prefs.selection.mode === selection.mode) {
      if (selection.mode === 'system') return true
      if (selection.mode === 'builtin' && prefs.selection.mode === 'builtin') {
        return prefs.selection.themeId === selection.themeId
      }
      if (selection.mode === 'custom' && prefs.selection.mode === 'custom') {
        return prefs.selection.themeId === selection.themeId
      }
    }
    return false
  }

  const handleSelect = (selection: ThemeSelection) => {
    const next = setThemeSelection(prefs, selection, { customThemes })
    setPrefs(next)
  }

  const handleDelete = async (theme: ThemeDefinition) => {
    const confirmed = window.confirm(t('删除主题「{name}」？此操作不可恢复。', { name: theme.name }))
    if (!confirmed) return
    try {
      // 删除当前主题：先把活动选择切到 system，确认生效后再删除
      if (prefs.selection.mode === 'custom' && prefs.selection.themeId === theme.id) {
        const next = setThemeSelection(prefs, { mode: 'system' }, { customThemes })
        setPrefs(next)
      }
      await deleteTheme(theme.id)
      setCustomThemes(prev => prev.filter(t => t.id !== theme.id))
      showToast(t('主题已删除'))
    } catch {
      showToast(t('删除失败'), 'err')
    }
  }

  const handleDuplicate = async (theme: ThemeDefinition) => {
    try {
      const dup = await duplicateTheme(theme.id)
      setCustomThemes(prev => [...prev, dup])
      showToast(t('已复制为新主题'))
    } catch {
      showToast(t('复制主题失败'), 'err')
    }
  }

  const handleRename = async (theme: ThemeDefinition) => {
    const name = window.prompt(t('输入新名称：'), theme.name)
    if (!name || name.trim() === theme.name) return
    try {
      const renamed = await renameTheme(theme.id, name.trim())
      setCustomThemes(prev => prev.map(t => t.id === theme.id ? renamed : t))
      showToast(t('已重命名'))
    } catch {
      showToast(t('重命名失败'), 'err')
    }
  }

  const handleReset = () => {
    handleSelect({ mode: 'system' })
    showToast(t('已恢复为跟随系统'))
  }

  const themeCard = (theme: ThemeDefinition, selection: ThemeSelection) => {
    const active = isCurrent(selection)
    const swatches = [theme.tokens.canvas, theme.tokens.surface1, theme.tokens.accent, theme.tokens.textPrimary]
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        className={`theme-card ${active ? 'active' : ''}`}
        onClick={() => handleSelect(selection)}
        key={theme.id}
      >
        <span className="theme-card-preview" style={{ background: theme.tokens.canvas }}>
          {theme.artwork?.previewUrl && (
            <img src={theme.artwork.previewUrl} alt="" loading="lazy" draggable={false} />
          )}
          <span className="theme-card-swatch-row" aria-hidden="true">
            {swatches.map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
          </span>
        </span>
        <span className="theme-card-body">
          <span className="theme-card-name">{theme.name}</span>
          <span className="theme-card-meta">
            {theme.appearance === 'dark' ? t('深色') : t('浅色')}
            {theme.source === 'custom' ? ` · ${t('自定义')}` : ` · ${t('内置')}`}
          </span>
        </span>
        {active && <span className="theme-card-check" aria-hidden="true">✓</span>}
      </button>
    )
  }

  return (
    <div className="theme-selector">
      <div className="setting-row">
        <div className="setting-info">
          <span className="setting-label">{t('主题')}</span>
          <span className="setting-hint">
            {t('当前选择')}：{selectionLabel(prefs.selection, t)}
            {prefs.selection.mode === 'system' && (
              <span className="theme-system-resolved">（{t('当前实际使用')}：{systemResolved === BUILTIN_THEME_DARK_ID ? t('深色') : t('浅色')}）</span>
            )}
          </span>
        </div>
        <div className="setting-control">
          <button className="btn sm" type="button" onClick={handleReset} disabled={prefs.selection.mode === 'system'}>
            恢复默认
          </button>
        </div>
      </div>

      <div className="theme-card-grid" role="radiogroup" aria-label={t('主题选择')}>
        {/* 跟随系统卡片 */}
        <button
          type="button"
          role="radio"
          aria-checked={prefs.selection.mode === 'system'}
          className={`theme-card system-card ${prefs.selection.mode === 'system' ? 'active' : ''}`}
          onClick={() => handleSelect({ mode: 'system' })}
        >
          <span className="theme-card-preview system-preview" aria-hidden="true">
            <span className="system-half light-half" />
            <span className="system-half dark-half" />
          </span>
          <span className="theme-card-body">
            <span className="theme-card-name">跟随系统</span>
            <span className="theme-card-meta">
              当前解析：{systemResolved === BUILTIN_THEME_DARK_ID ? '深色' : '浅色'}
            </span>
          </span>
          {prefs.selection.mode === 'system' && <span className="theme-card-check" aria-hidden="true">✓</span>}
        </button>

        {BUILTIN_THEMES.map(theme =>
          themeCard(theme, { mode: 'builtin', themeId: theme.id as 'tianshu-light' | 'tianshu-dark' }),
        )}

        {customThemes.map(theme => (
          <div className="theme-card-wrap" key={theme.id}>
            {themeCard(theme, { mode: 'custom', themeId: theme.id })}
            <div className="theme-card-menu">
              <button type="button" className="theme-menu-btn" onClick={() => onOpenStudio?.(theme)}><Icon name="tool-edit" size={11} ariaHidden /> 编辑</button>
              <button type="button" className="theme-menu-btn" onClick={() => handleDuplicate(theme)}>⧉ 复制</button>
              <button type="button" className="theme-menu-btn" onClick={() => handleRename(theme)}><Icon name="rename" size={11} ariaHidden /> 重命名</button>
              <button type="button" className="theme-menu-btn danger" onClick={() => handleDelete(theme)}><Icon name="delete" size={11} ariaHidden /> 删除</button>
            </div>
          </div>
        ))}

        {!loading && (
          <button
            type="button"
            className="theme-card create-card"
            onClick={() => onOpenStudio?.()}
          >
            <span className="theme-card-preview create-preview" aria-hidden="true">＋</span>
            <span className="theme-card-body">
              <span className="theme-card-name">创建自定义主题</span>
              <span className="theme-card-meta">选图 · 取色 · 实时预览</span>
            </span>
          </button>
        )}
      </div>

      <p className="theme-selector-note">
        自定义主题及其素材保存在系统数据目录 <code>themes/</code> 下；图片与完整主题不会写入浏览器存储。
      </p>
    </div>
  )
}

export { themeAssetUrl }

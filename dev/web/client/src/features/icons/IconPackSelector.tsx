/**
 * 图标包选择器（设置 → 显示 → 图标包区域）。
 *
 * 统一模型：内置包与自定义包都来自服务端同一列表（/api/iconpacks），
 * 差异仅 source=builtin/user：内置卡只读（无编辑/重命名/删除），自定义卡可管理。
 * - 每张卡片渲染该包自身槽位中的 6 枚预览图标（不再依赖当前激活包）。
 * - 选择立即应用并持久化（localStorage 只存轻量 selection）。
 * - 覆盖层提示条：全局单枚替换数量 + 「管理覆盖」入口。
 */
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import Icon, { IconAsset } from './Icon'
import { DEFAULT_ICON_PACK_ID } from './iconDefinitions'
import { loadIconPackPreferences, type IconPackPreferences } from './iconPreferences'
import { appliedPackId, refreshIconRegistry, setActiveIconPack } from './iconRuntime'
import {
  deleteIconPack,
  fetchCustomIconPacks,
  renameIconPack,
  type CustomIconPack,
  type IconOverrideRef,
  type IconSlotRef,
} from './iconPacksApi'

export interface IconPackSelectorProps {
  showToast: (msg: string, type?: 'ok' | 'err') => void
  /** 打开编辑器：null/undefined = 新建；'__overrides__' = 覆盖层；CustomIconPack = 编辑用户包。 */
  onOpenEditor?: (pack: CustomIconPack | null, focusOverrides?: boolean) => void
}

/** 预览槽位（每张卡片渲染同几枚，便于横向对比风格）。 */
const PREVIEW_SLOTS = ['nav-chat', 'nav-characters', 'nav-skills', 'nav-mcp', 'nav-knowledge', 'nav-market']

/** 渲染某包自身的一个槽位图标：该包 slotes 有资产看其资产，否则回退默认 lucide。 */
function packSlotIcon(pack: CustomIconPack, key: string, size: number) {
  const ref = pack.slots[key] as IconSlotRef | undefined
  if (ref?.url) return <IconAsset url={ref.url} tint={ref.tint} size={size} />
  return <Icon name={key} size={size} />
}

export default function IconPackSelector({ showToast, onOpenEditor }: IconPackSelectorProps) {
  const t = useI18n()
  const [prefs, setPrefs] = useState<IconPackPreferences>(() => loadIconPackPreferences())
  const [packs, setPacks] = useState<CustomIconPack[]>([])
  const [overrides, setOverrides] = useState<Record<string, IconOverrideRef>>({})
  const [loading, setLoading] = useState(true)
  const [activePackId, setActivePackId] = useState<string>(() => appliedPackId())

  const refresh = useCallback(async () => {
    try {
      const data = await fetchCustomIconPacks()
      setPacks(data.packs)
      setOverrides(data.overrides)
    } catch {
      showToast(t('加载图标包列表失败'), 'err')
    } finally {
      setLoading(false)
    }
  }, [showToast, t])

  useEffect(() => {
    refresh()
    const onChanged = () => {
      setPrefs(loadIconPackPreferences())
      setActivePackId(appliedPackId())
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'tianshu:iconPackPreferences') onChanged()
    }
    window.addEventListener('tianshu:iconpack-changed', onChanged)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('tianshu:iconpack-changed', onChanged)
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])

  const isCurrent = (packId: string): boolean => activePackId === packId

  const handleSelect = (packId: string) => {
    const next = setActiveIconPack(packId)
    setPrefs(next)
    setActivePackId(packId)
  }

  const handleDelete = async (pack: CustomIconPack) => {
    const confirmed = window.confirm(t('删除图标库「{name}」？此操作不可恢复。', { name: pack.name }))
    if (!confirmed) return
    try {
      // 删除当前包：先切回默认内置包
      if (activePackId === pack.id) handleSelect(DEFAULT_ICON_PACK_ID)
      await deleteIconPack(pack.id)
      setPacks(prev => prev.filter(p => p.id !== pack.id))
      await refreshIconRegistry()
      showToast(t('图标库已删除'))
    } catch {
      showToast(t('删除失败'), 'err')
    }
  }

  const handleRename = async (pack: CustomIconPack) => {
    const name = window.prompt(t('输入新名称：'), pack.name)
    if (!name || name.trim() === pack.name) return
    try {
      const renamed = await renameIconPack(pack.id, name.trim())
      setPacks(prev => prev.map(p => p.id === pack.id ? renamed : p))
      showToast(t('已重命名'))
    } catch {
      showToast(t('重命名失败'), 'err')
    }
  }

  const overrideCount = Object.keys(overrides).length
  // 内置包放前面，自定义包按服务端顺序跟后
  const ordered = [...packs].sort((a, b) => (a.source === 'builtin' ? -1 : 0) - (b.source === 'builtin' ? -1 : 0))

  return (
    <div className="iconpack-selector">
      <div className="setting-row">
        <div className="setting-info">
          <span className="setting-label">{t('图标包')}</span>
          <span className="setting-hint">
            {t('界面图标风格；切换图标包 = 给全部语义槽位换一套图形')}
          </span>
        </div>
        <div className="setting-control">
          <button
            className="btn sm"
            type="button"
            onClick={() => handleSelect(DEFAULT_ICON_PACK_ID)}
            disabled={activePackId === DEFAULT_ICON_PACK_ID && overrideCount === 0}
          >
            {t('恢复默认')}
          </button>
        </div>
      </div>

      <div className="theme-card-grid" role="radiogroup" aria-label={t('图标包选择')}>
        {ordered.map(pack => {
          const active = isCurrent(pack.id)
          const isBuiltin = pack.source === 'builtin'
          return isBuiltin ? (
            <button
              type="button"
              role="radio"
              aria-checked={active}
              className={`theme-card iconpack-card ${active ? 'active' : ''}`}
              onClick={() => handleSelect(pack.id)}
              key={pack.id}
            >
              <span className="iconpack-preview" aria-hidden="true">
                {PREVIEW_SLOTS.map(key => (
                  <span key={key} className="iconpack-preview-icon">
                    {packSlotIcon(pack, key, 18)}
                  </span>
                ))}
              </span>
              <span className="theme-card-body">
                <span className="theme-card-name">{pack.name}</span>
                <span className="theme-card-meta">{t('内置')}</span>
              </span>
              {active && <span className="theme-card-check" aria-hidden="true">✓</span>}
            </button>
          ) : (
            <div className="theme-card-wrap" key={pack.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                className={`theme-card iconpack-card ${active ? 'active' : ''}`}
                onClick={() => handleSelect(pack.id)}
              >
                <span className="iconpack-preview" aria-hidden="true">
                  {PREVIEW_SLOTS.map(key =>
                    pack.slots[key] ? (
                      <span key={key} className="iconpack-preview-icon">
                        {packSlotIcon(pack, key, 18)}
                      </span>
                    ) : (
                      <span key={key} className="iconpack-preview-icon iconpack-preview-empty" />
                    ),
                  )}
                </span>
                <span className="theme-card-body">
                  <span className="theme-card-name">{pack.name}</span>
                  <span className="theme-card-meta">
                    {t('自定义')} · {t('{n} 枚已填', { n: pack.slotCount })}
                  </span>
                </span>
                {active && <span className="theme-card-check" aria-hidden="true">✓</span>}
              </button>
              <div className="theme-card-menu">
                <button type="button" className="theme-menu-btn" onClick={() => onOpenEditor?.(pack)}>
                  <Icon name="tool-edit" size={11} ariaHidden /> {t('编辑')}
                </button>
                <button type="button" className="theme-menu-btn" onClick={() => handleRename(pack)}>
                  <Icon name="rename" size={11} ariaHidden /> {t('重命名')}
                </button>
                <button type="button" className="theme-menu-btn danger" onClick={() => handleDelete(pack)}>
                  <Icon name="delete" size={11} ariaHidden /> {t('删除')}
                </button>
              </div>
            </div>
          )
        })}

        {!loading && (
          <button
            type="button"
            className="theme-card create-card"
            onClick={() => onOpenEditor?.(null)}
          >
            <span className="theme-card-preview create-preview" aria-hidden="true">＋</span>
            <span className="theme-card-body">
              <span className="theme-card-name">{t('自建图标库')}</span>
              <span className="theme-card-meta">{t('从空槽位开始，一枚枚上传')}</span>
            </span>
          </button>
        )}
      </div>

      {overrideCount > 0 && (
        <div className="iconpack-override-bar">
          <span className="iconpack-override-avatars">
            {Object.keys(overrides).slice(0, 5).map(key => (
              <span key={key} className="iconpack-override-avatar">
                <Icon name={key} size={14} />
              </span>
            ))}
            {overrideCount > 5 && <span className="iconpack-override-more">+{overrideCount - 5}</span>}
          </span>
          <span className="iconpack-override-info">
            {t('当前有 {n} 枚图标被单独覆盖（不随图标包切换，除非还原）', { n: overrideCount })}
          </span>
          <button className="btn sm" type="button" onClick={() => onOpenEditor?.(null, true)}>
            {t('管理覆盖')}
          </button>
        </div>
      )}

      <p className="theme-selector-note">
        {t('内置图标包随发行内容提供（仅展示，不可编辑）；用户图标包及其素材保存在系统数据目录')}
        <code>iconpacks/</code> {t('下；SVG 上传后自动剥离脚本，仅以纯图形渲染')}。
      </p>
    </div>
  )
}
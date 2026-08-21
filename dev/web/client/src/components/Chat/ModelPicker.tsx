import { useState, useRef, useEffect, useMemo } from 'react'
import { topModelKeys, recordModelUse, TOP_MODELS_LIMIT } from '@/features/chat/modelUsage'
import { useI18n } from '@/i18n'

export interface ModelPickerOption {
  providerId: string
  providerName: string
  /** 完整模型键：`providerId::modelName`，与会话存储一致。 */
  modelId: string
  modelName: string
}

interface Props {
  options: ModelPickerOption[]
  value: string
  onChange: (modelKey: string) => void
}

/**
 * 会话模型选择下拉（替代原生 select）：
 * - 顶部搜索框按模型名/服务商名过滤；
 * - 使用频次 Top N（默认 3）标记 ★ 并置顶（见 features/chat/modelUsage.ts）；
 * - 搜索时隐藏置顶区，仅显示过滤结果；支持 ↑↓ 导航、Enter 选择、Esc 关闭。
 */
export default function ModelPicker({ options, value, onChange }: Props) {
  const t = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 每次展开时重算常用榜，避免使用计数更新后展示滞后。
  const topKeys = useMemo(
    () => (open ? topModelKeys(TOP_MODELS_LIMIT) : []),
    [open],
  )

  const byKey = useMemo(() => new Map(options.map(o => [o.modelId, o])), [options])

  const q = search.trim().toLowerCase()
  const matches = (o: ModelPickerOption) =>
    !q || o.modelName.toLowerCase().includes(q) || o.providerName.toLowerCase().includes(q)

  const { pinnedOptions, groups, flat } = useMemo(() => {
    // 置顶区：常用榜 ∩ 当前可用选项（服务商被删/模型停用时自动剔除）。
    const pinned = q
      ? []
      : topKeys.map(k => byKey.get(k)).filter((o): o is ModelPickerOption => !!o)
    const pinnedSet = new Set(pinned.map(o => o.modelId))

    const groupMap = new Map<string, ModelPickerOption[]>()
    for (const o of options) {
      if (!matches(o)) continue
      if (!q && pinnedSet.has(o.modelId)) continue // 未搜索时不重复展示置顶项
      const list = groupMap.get(o.providerName)
      if (list) list.push(o)
      else groupMap.set(o.providerName, [o])
    }
    const gs = Array.from(groupMap.entries()).map(([name, opts]) => ({ name, opts }))
    return {
      pinnedOptions: pinned,
      groups: gs,
      flat: [...pinned, ...gs.flatMap(g => g.opts)],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, byKey, topKeys, q])

  useEffect(() => { setActiveIndex(0) }, [search, open])

  // 点击外部关闭。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const handleSelect = (option: ModelPickerOption) => {
    recordModelUse(option.modelId)
    onChange(option.modelId)
    setOpen(false)
    setSearch('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setSearch('')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, Math.max(flat.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = flat[activeIndex] ?? flat[0]
      if (pick) handleSelect(pick)
    }
  }

  const currentItem = byKey.get(value)

  const renderItem = (option: ModelPickerOption, index: number, isTop: boolean) => {
    const current = option.modelId === value
    return (
      <button
        key={option.modelId}
        type="button"
        className={`model-picker-item${current ? ' current' : ''}${index === activeIndex ? ' active' : ''}`}
        onClick={() => handleSelect(option)}
        onMouseEnter={() => setActiveIndex(index)}
      >
        {isTop && <span className="model-picker-star" title={t('常用')}>★</span>}
        <span className="model-picker-item-name">{option.modelName}</span>
        {isTop && <span className="model-picker-item-provider">{option.providerName}</span>}
        {current && <span className="model-picker-check">✓</span>}
      </button>
    )
  }

  let rendered = 0 // flat 序号，跨分组连续，供键盘导航定位

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className={`model-picker-btn${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={t('模型')}
      >
        <span className="model-picker-value">{currentItem?.modelName || '--'}</span>
        <span className="model-picker-caret">▾</span>
      </button>
      {open && (
        <div className="model-picker-pop">
          <div className="model-picker-search">
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('搜索模型...')}
              autoFocus
            />
          </div>
          <div className="model-picker-list">
            {!q && pinnedOptions.length > 0 && (
              <>
                <div className="model-picker-group-label">{t('常用')}</div>
                {pinnedOptions.map(o => renderItem(o, rendered++, true))}
              </>
            )}
            {groups.map(g => (
              <div key={g.name}>
                <div className="model-picker-group-label">{g.name}</div>
                {g.opts.map(o => renderItem(o, rendered++, false))}
              </div>
            ))}
            {flat.length === 0 && <div className="model-picker-empty">{t('无匹配模型')}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

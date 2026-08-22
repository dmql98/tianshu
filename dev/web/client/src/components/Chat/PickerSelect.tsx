import { useState, useRef, useEffect, useMemo } from 'react'
import { loadModelUsage, topModelKeys } from '@/features/chat/modelUsage'
import { useI18n } from '@/i18n'

export interface PickerSelectOption {
  /** 完整值（模型键或枚举值），与会话存储一致。 */
  value: string
  /** 展示文本。 */
  label: string
  /** 分组名（模型选择 = 服务商名）；缺省不显示组标题，组按首次出现顺序排列。 */
  group?: string
}

interface Props {
  value: string
  options: PickerSelectOption[]
  onChange: (value: string) => void
  title?: string
  /** 显示顶部搜索框（按 label/group 过滤）。默认 false。 */
  searchable?: boolean
  /** >0 时按使用频次把前 N 项标 ★ 置顶（计数见 features/chat/modelUsage.ts）。默认 0。 */
  frequentCount?: number
}

/**
 * 输入区统一自定义下拉（替代原生 select）：
 * - 模型选择器开启搜索框 + 常用置顶；思考强度/执行模式/审核模式为纯选项列表；
 * - 浮层向上弹出（输入区位于页面底部）；支持 ↑↓ 导航、Enter 选择、Esc / 点击外部关闭。
 */
export default function PickerSelect({ value, options, onChange, title, searchable = false, frequentCount = 0 }: Props) {
  const t = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // 每次展开时异步加载常用榜（服务端计数，见 features/chat/modelUsage.ts）。
  const [topKeys, setTopKeys] = useState<string[]>([])
  useEffect(() => {
    setTopKeys([])
    if (!open || frequentCount <= 0) return
    let cancelled = false
    loadModelUsage()
      .then(usage => { if (!cancelled) setTopKeys(topModelKeys(usage, frequentCount)) })
      .catch(() => { if (!cancelled) setTopKeys([]) })
    return () => { cancelled = true }
  }, [open, frequentCount])

  const q = search.trim().toLowerCase()
  const matches = (o: PickerSelectOption) =>
    !q || o.label.toLowerCase().includes(q) || (o.group || '').toLowerCase().includes(q)

  const { pinnedOptions, groups, flat } = useMemo(() => {
    const byValue = new Map(options.map(o => [o.value, o]))
    // 置顶区：常用榜 ∩ 当前可用选项（服务商被删/模型停用时自动剔除）。
    const pinned = q
      ? []
      : topKeys.map(k => byValue.get(k)).filter((o): o is PickerSelectOption => !!o)
    const pinnedSet = new Set(pinned.map(o => o.value))

    const groupOrder: string[] = []
    const groupMap = new Map<string, PickerSelectOption[]>()
    for (const o of options) {
      if (!matches(o)) continue
      if (!q && pinnedSet.has(o.value)) continue // 未搜索时不重复展示置顶项
      const g = o.group || ''
      if (!groupMap.has(g)) {
        groupMap.set(g, [])
        groupOrder.push(g)
      }
      groupMap.get(g)!.push(o)
    }
    const gs = groupOrder.map(name => ({ name, opts: groupMap.get(name)! }))
    return {
      pinnedOptions: pinned,
      groups: gs,
      flat: [...pinned, ...gs.flatMap(g => g.opts)],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, topKeys, q])

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

  const handleSelect = (option: PickerSelectOption) => {
    onChange(option.value)
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

  const currentItem = options.find(o => o.value === value)

  const renderItem = (option: PickerSelectOption, index: number, isTop: boolean) => {
    const current = option.value === value
    return (
      <button
        key={option.value}
        type="button"
        className={`picker-item${current ? ' current' : ''}${index === activeIndex ? ' active' : ''}`}
        onClick={() => handleSelect(option)}
        onMouseEnter={() => setActiveIndex(index)}
      >
        {isTop && <span className="picker-star" title={t('常用')}>★</span>}
        <span className="picker-item-name">{option.label}</span>
        {isTop && option.group && <span className="picker-item-hint">{option.group}</span>}
        {current && <span className="picker-check">✓</span>}
      </button>
    )
  }

  let rendered = 0 // flat 序号，跨分组连续，供键盘导航定位

  return (
    <div className="picker-select" ref={rootRef}>
      <button
        type="button"
        className={`picker-btn${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={title}
      >
        <span className="picker-value">{currentItem?.label || '--'}</span>
        <span className="picker-caret">▾</span>
      </button>
      {open && (
        <div className="picker-pop">
          {searchable && (
            <div className="picker-search">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('搜索模型...')}
                autoFocus
              />
            </div>
          )}
          <div className="picker-list" onKeyDown={searchable ? undefined : handleKeyDown} tabIndex={-1}>
            {!q && pinnedOptions.length > 0 && (
              <>
                <div className="picker-group-label">{t('常用')}</div>
                {pinnedOptions.map(o => renderItem(o, rendered++, true))}
              </>
            )}
            {groups.map(g => (
              <div key={g.name || '__ungrouped__'}>
                {g.name && <div className="picker-group-label">{g.name}</div>}
                {g.opts.map(o => renderItem(o, rendered++, false))}
              </div>
            ))}
            {flat.length === 0 && <div className="picker-empty">{t('无匹配结果')}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

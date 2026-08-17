/**
 * 图标库编辑器（ICON_PACK_PLAN §7）。
 *
 * - 槽位按组排布（导航栏/聊天操作/文件与会话/状态与反馈/界面与入口）。
 * - 每个槽位：当前图标预览 + 语义 key + 状态点（内置 = 无标记 / 已覆盖 = 金色 / 本库自建 = 蓝）。
 * - 点击槽位 → 上传替换（SVG/PNG/WebP）；「随主题着色」仅单色 SVG 有效。
 * - 已填槽位可「还原」（移除本库该槽位 → 回退激活包/内置）。
 * - 模式：
 *   - create（pack=null）：输入名称 → 创建空库 → 逐枚上传。
 *   - edit（pack）：编辑现有用户包。
 *   - overrides（focusOverrides=true）：全局覆盖层（单枚替换，作用于任意包）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import Icon, { IconAsset } from './Icon'
import { ICON_SLOTS, iconSlotsByGroup } from './iconSlots'
import { loadIconPackPreferences } from './iconPreferences'
import { refreshIconRegistry } from './iconRuntime'
import {
  createIconPack,
  deleteIconPack,
  fetchCustomIconPacks,
  removeIconSlot,
  renameIconPack,
  uploadIconSlot,
  type CustomIconPack,
  type IconOverrideRef,
} from './iconPacksApi'

export interface IconPackEditorProps {
  /** null = 新建；CustomIconPack = 编辑用户包；undefined = 覆盖层模式（配合 focusOverrides）。 */
  pack: CustomIconPack | null | undefined
  focusOverrides: boolean
  onClose: () => void
  onSaved: () => void
  showToast: (msg: string, type?: 'ok' | 'err') => void
}

type EditorMode = 'create' | 'edit' | 'overrides'

interface PendingUpload {
  slotKey: string
  slotName: string
}

const ALLOWED_TYPES = ['image/svg+xml', 'image/png', 'image/webp']
const MAX_BYTES = 512 * 1024

export default function IconPackEditor({ pack, focusOverrides, onClose, onSaved, showToast }: IconPackEditorProps) {
  const t = useI18n()

  // 内置包只读：不能进入编辑/上传流程（选择器不提供入口，但防御式拦截）
  const builtinLocked = !focusOverrides && !!pack?.readOnly
  useEffect(() => {
    if (builtinLocked) {
      showToast(t('内置图标包为只读，不可编辑；可创建自建图标库或上传覆盖'), 'err')
      onClose()
    }
  }, [builtinLocked, showToast, t, onClose])

  const [mode, setMode] = useState<EditorMode>(focusOverrides ? 'overrides' : pack?.readOnly ? 'create' : pack ? 'edit' : 'create')
  const [nameDraft, setNameDraft] = useState(pack?.name ?? '')
  const [userPacks, setUserPacks] = useState<CustomIconPack[]>([])
  const [activeSlots, setActiveSlots] = useState<Record<string, IconOverrideRef>>({})
  const [overrides, setOverrides] = useState<Record<string, IconOverrideRef>>({})
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [tint, setTint] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [previewName, setPreviewName] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 当前编辑目标包 id：overrides 模式用服务端保留 id，但不上传表单（直接调覆盖 API）
  const editingId = mode === 'overrides' ? '__overrides__' : pack?.id ?? ''

  const load = useCallback(async () => {
    try {
      const data = await fetchCustomIconPacks()
      setUserPacks(data.packs)
      setOverrides(data.overrides)
      if (mode === 'overrides') {
        setActiveSlots(data.overrides)
      } else if (pack?.id) {
        const found = data.packs.find(p => p.id === pack.id)
        setActiveSlots(found?.slots ?? {})
      } else {
        setActiveSlots({})
      }
    } catch {
      showToast(t('加载失败'), 'err')
    }
  }, [mode, pack?.id, showToast, t])

  useEffect(() => { void load() }, [load])

  // 创建模式：包创建成功后切到 edit
  const [createdId, setCreatedId] = useState<string | null>(null)
  const effectiveId = mode === 'create' ? createdId ?? '' : editingId

  const currentSlots = mode === 'create' ? activeSlots : activeSlots
  const filledCount = Object.keys(currentSlots).length

  const handleCreate = async () => {
    const name = nameDraft.trim()
    if (!name) { showToast(t('请输入图标库名称'), 'err'); return }
    try {
      const created = await createIconPack(name)
      setCreatedId(created.id)
      setMode('edit')
      setActiveSlots(created.slots)
      await refreshIconRegistry()
      showToast(t('图标库已创建，开始逐枚上传'))
    } catch {
      showToast(t('创建失败'), 'err')
    }
  }

  const openPicker = (slotKey: string, slotName: string) => {
    setPending({ slotKey, slotName })
    setPreviewName('')
    setTint(true)
    fileInputRef.current?.click()
  }

  const handleFile = async (file: File | null | undefined) => {
    if (!file || !pending) return
    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast(t('仅支持 SVG / PNG / WebP'), 'err')
      return
    }
    if (file.size > MAX_BYTES) {
      showToast(t('文件超过 512 KB 限制'), 'err')
      return
    }
    setPreviewName(file.name)
    setUploading(true)
    try {
      const targetId = mode === 'overrides' ? '__overrides__' : effectiveId
      if (!targetId) { showToast(t('请先创建图标库'), 'err'); return }
      await uploadIconSlot(targetId, pending.slotKey, file, tint)
      await refreshIconRegistry()
      await load()
      onSaved()
      showToast(t('已替换「{name}」', { name: pending.slotName }))
    } catch {
      showToast(t('上传失败'), 'err')
    } finally {
      setUploading(false)
      setPending(null)
      setPreviewName('')
    }
  }

  const handleResetSlot = async (slotKey: string, slotName: string) => {
    const targetId = mode === 'overrides' ? '__overrides__' : effectiveId
    if (!targetId) return
    try {
      await removeIconSlot(targetId, slotKey)
      await refreshIconRegistry()
      await load()
      onSaved()
      showToast(t('已还原「{name}」', { name: slotName }))
    } catch {
      showToast(t('还原失败'), 'err')
    }
  }

  const handleDeletePack = async () => {
    if (!pack?.id) return
    const confirmed = window.confirm(t('删除图标库「{name}」？此操作不可恢复。', { name: pack.name }))
    if (!confirmed) return
    try {
      await deleteIconPack(pack.id)
      await refreshIconRegistry()
      onSaved()
      onClose()
      showToast(t('图标库已删除'))
    } catch {
      showToast(t('删除失败'), 'err')
    }
  }

  const handleRename = async () => {
    if (!pack?.id) return
    const name = nameDraft.trim()
    if (!name || name === pack.name) return
    try {
      await renameIconPack(pack.id, name)
      await refreshIconRegistry()
      onSaved()
      showToast(t('已重命名'))
    } catch {
      showToast(t('重命名失败'), 'err')
    }
  }

  const groups = iconSlotsByGroup()

  return (
    <div className="approval-overlay iconpack-editor-overlay" onClick={onClose}>
      <div
        className="approval-dialog iconpack-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'overrides' ? t('管理覆盖图标') : mode === 'create' ? t('自建图标库') : t('编辑图标库')}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="iconpack-editor-header">
          <div>
            <div className="iconpack-editor-title">
              {mode === 'overrides' ? t('管理覆盖图标') : mode === 'create' ? t('自建图标库') : pack?.name}
            </div>
            <div className="iconpack-editor-sub">
              {mode === 'overrides'
                ? t('单枚替换，作用于任意图标包之上；可随时还原')
                : mode === 'create'
                  ? t('先命名，再逐枚上传；未填槽位自动使用当前所选内置包')
                  : t('已填 {n} / {total} 槽位 · 未填槽位自动回退内置包', { n: filledCount, total: ICON_SLOTS.length })}
            </div>
          </div>
          <button className="iconpack-editor-close" onClick={onClose} aria-label={t('关闭')}>✕</button>
        </div>

        {/* 创建模式：先命名 */}
        {mode === 'create' && (
          <div className="iconpack-editor-create">
            <input
              className="search-input"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              placeholder={t('图标库名称，例如：我的水墨包')}
              maxLength={40}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate() }}
            />
            <button className="btn primary" type="button" onClick={() => void handleCreate()}>
              {t('创建并开始上传')}
            </button>
          </div>
        )}

        {/* 工具栏 */}
        {(mode === 'edit' || mode === 'overrides') && (
          <div className="iconpack-editor-tools">
            <span className="iconpack-editor-stat">
              {t('已填')} <b>{filledCount}</b> / {ICON_SLOTS.length}
              {mode === 'overrides' && overrides && Object.keys(overrides).length > 0 && (
                <span className="iconpack-editor-stat-note"> · {t('覆盖层共 {n} 枚', { n: Object.keys(overrides).length })}</span>
              )}
            </span>
            {mode === 'edit' && pack?.id && (
              <>
                <input
                  className="search-input iconpack-editor-rename"
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  placeholder={t('重命名…')}
                  maxLength={40}
                />
                <button className="btn sm" type="button" onClick={() => void handleRename()}>{t('重命名')}</button>
                <button className="btn sm danger" type="button" onClick={() => void handleDeletePack()}>{t('删除图标库')}</button>
              </>
            )}
            {mode === 'overrides' && (
              <span className="iconpack-editor-stat-note">{t('覆盖不随包切换而失效；还原后回到包原样')}</span>
            )}
          </div>
        )}

        {/* 槽位网格 */}
        <div className="iconpack-editor-body">
          {Object.entries(groups).map(([group, slots]) => (
            <div className="iconpack-slot-group" key={group}>
              <div className="iconpack-slot-group-head">
                {t(group)}
                <span className="iconpack-slot-group-count">{slots.length} {t('枚')}</span>
              </div>
              <div className="iconpack-slot-grid">
                {slots.map(slot => {
                  const filled = !!currentSlots[slot.key]
                  const slotRef = currentSlots[slot.key]
                  return (
                    <button
                      type="button"
                      key={slot.key}
                      className={`iconpack-slot ${filled ? 'filled' : ''}`}
                      onClick={() => openPicker(slot.key, slot.name)}
                      title={`${slot.name} · ${slot.key}`}
                    >
                      <span className="iconpack-slot-icon">
                        {filled && slotRef ? (
                          <IconAsset url={slotRef.url} tint={slotRef.tint} size={20} />
                        ) : (
                          <Icon name={slot.key} size={20} />
                        )}
                      </span>
                      <span className="iconpack-slot-name">{slot.name}</span>
                      <span className="iconpack-slot-key">{slot.key}</span>
                      <span className="iconpack-slot-tag" data-filled={filled} aria-hidden="true">
                        {filled ? '●' : '○'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 底部说明 */}
        <div className="iconpack-editor-foot">
          <span>
            {t('点击任意槽位上传替换；已填槽位可在槽位菜单中「还原」')}
          </span>
          <button className="btn sm" type="button" onClick={onClose}>{t('完成')}</button>
        </div>

        {/* 隐藏文件输入（由 openPicker 触发） */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={e => { void handleFile(e.target.files?.[0]); e.target.value = '' }}
        />

        {/* 上传确认浮层（tint 勾选） */}
        {pending && (
          <div
            className="iconpack-upload-overlay"
            onClick={() => setPending(null)}
          >
            <div className="iconpack-upload-card" onClick={e => e.stopPropagation()}>
              <div className="iconpack-upload-title">
                {t('替换图标「{name}」', { name: pending.slotName })}
                <span className="iconpack-upload-key">{pending.slotKey}</span>
              </div>
              <div
                className={`iconpack-upload-drop ${dragOver ? 'drag' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault()
                  setDragOver(false)
                  void handleFile(e.dataTransfer.files?.[0])
                }}
              >
                {previewName ? (
                  <span className="iconpack-upload-preview-name">{previewName}</span>
                ) : (
                  <>
                    <span className="iconpack-upload-drop-icon">↥</span>
                    {t('拖拽图片到这里，或点击选择')}
                    <span className="iconpack-upload-drop-hint">SVG · PNG · WebP（≤ 512 KB）</span>
                  </>
                )}
              </div>
              <label className="iconpack-upload-tint">
                <input type="checkbox" checked={tint} onChange={e => setTint(e.target.checked)} />
                {t('随主题着色（仅单色 SVG；PNG/多色图请取消勾选原样显示）')}
              </label>
              <div className="iconpack-upload-actions">
                <button className="btn sm" type="button" onClick={() => setPending(null)}>{t('取消')}</button>
                <button
                  className="btn sm primary"
                  type="button"
                  disabled={uploading || !previewName}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? t('上传中...') : t('选择文件')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

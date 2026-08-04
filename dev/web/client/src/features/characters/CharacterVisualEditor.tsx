import { useEffect, useState } from 'react'
import {
  fetchCharacterVisual, publishCharacterRevision, saveCharacterVisual,
  uploadCharacterAsset, exportCharacterPackage, importCharacterPackage,
  characterAssetUrl,
  type CharacterAssetRef, type CharacterMotion,
  type CharacterVisual,
} from '@/api/characters'
import CharacterRenderer, { invalidateCharacterVisual } from './CharacterRenderer'
import AvatarCropDialog from './AvatarCropDialog'
import { avatarCropStyle } from './avatarCrop'

const EDITABLE_MOTIONS: CharacterMotion[] = [
  'idle', 'thinking', 'working', 'speaking', 'success', 'error',
]

const MOTION_LABELS: Record<string, string> = {
  idle: 'idle（待机）', thinking: 'thinking（思考）', working: 'working（工作）',
  speaking: 'speaking（说话）', success: 'success（完成）', error: 'error（出错）',
}

const ORIGINAL_MAX_BYTES = 20 * 1024 * 1024

interface Props {
  characterId: string
  name: string
  legacyAvatar?: string
}

type UploadSlot = 'original' | CharacterMotion

export default function CharacterVisualEditor({ characterId, name, legacyAvatar }: Props) {
  const [visual, setVisual] = useState<CharacterVisual | null>(null)
  const [assets, setAssets] = useState<CharacterAssetRef[]>([])
  const [previewMotion, setPreviewMotion] = useState<CharacterMotion>('idle')
  const [previewReplay, setPreviewReplay] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [cropTarget, setCropTarget] = useState<'avatar' | 'portrait' | null>(null)

  const reload = async () => {
    const data = await fetchCharacterVisual(characterId)
    setVisual(data.visual)
    setAssets(data.assets)
    invalidateCharacterVisual(characterId)
  }

  useEffect(() => { void reload() }, [characterId])

  if (!visual) return <div className="empty-state">正在读取角色资源…</div>

  const assetName = (assetId?: string) => assets.find(a => a.assetId === assetId)?.filename || ''

  const save = async (publish: boolean) => {
    setBusy(true)
    setMessage('')
    try {
      await saveCharacterVisual(characterId, visual)
      invalidateCharacterVisual(characterId)
      if (publish) {
        const revision = await publishCharacterRevision(characterId)
        setMessage(`已发布角色版本 v${revision.revision_no}`)
      } else {
        setMessage('视觉草稿已保存')
      }
      await reload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const uploadTo = async (slot: UploadSlot, file?: File) => {
    if (!file) return
    if (slot === 'original' && file.size > ORIGINAL_MAX_BYTES) {
      setMessage('原画文件不能超过 20 MB')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const asset = await uploadCharacterAsset(
        characterId,
        file,
        slot === 'original' ? 'static' : undefined,
        slot === 'original' ? 'original' : undefined,
      )
      setAssets(prev => [...prev, asset])
      if (slot === 'original') {
        const saved = await saveCharacterVisual(characterId, {
          ...visual,
          originalAssetId: asset.assetId,
          portraitCrop: undefined,
          avatarCrop: undefined,
        })
        setVisual(saved)
        invalidateCharacterVisual(characterId)
        setPreviewReplay(value => value + 1)
        setMessage(`原画已上传并保存：${file.name}`)
        return
      }
      setVisual(current => {
        if (!current) return current
        const motion = slot
        return {
          ...current,
          motions: {
            ...current.motions,
            [motion]: { assetId: asset.assetId, loop: !['success', 'error'].includes(motion) },
          },
        }
      })
      invalidateCharacterVisual(characterId)
      setMessage(`已上传并绑定 ${file.name}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  const doExport = async () => {
    setBusy(true)
    setMessage('')
    try {
      await exportCharacterPackage(characterId)
      setMessage('角色包已导出')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (file?: File, conflict: 'error' | 'replace' | 'new' = 'error') => {
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      await importCharacterPackage(file, conflict)
      await reload()
      setMessage(`已导入 ${file.name}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const uploadButton = (slot: UploadSlot, accept: string) => (
    <label className={`btn sm ${busy ? 'disabled' : ''}`} style={{ flexShrink: 0 }}>
      {slot === 'original' ? '上传原画' : '上传'}
      <input
        type="file"
        accept={accept}
        hidden
        disabled={busy}
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void uploadTo(slot, file)
        }}
      />
    </label>
  )

  // Existing characters used portraitAssetId as their source image. Treat it as
  // a compatible original until a dedicated original is uploaded.
  const originalAssetId = visual.originalAssetId || visual.portraitAssetId
  const originalUrl = originalAssetId ? characterAssetUrl(characterId, originalAssetId) : null
  const legacyAvatarUrl = visual.avatarAssetId
    ? characterAssetUrl(characterId, visual.avatarAssetId)
    : null
  const avatarCrop = visual.avatarCrop
  const portraitCrop = visual.portraitCrop
  const avatarCroppedStyle = avatarCropStyle(avatarCrop)
  const portraitCroppedStyle = avatarCropStyle(portraitCrop)

  const confirmCrop = async (nextCrop: NonNullable<CharacterVisual['avatarCrop']>) => {
    if (!cropTarget || !originalAssetId) return
    setBusy(true)
    setMessage('')
    try {
      const cropKey = cropTarget === 'portrait' ? 'portraitCrop' : 'avatarCrop'
      const saved = await saveCharacterVisual(characterId, {
        ...visual,
        originalAssetId,
        [cropKey]: nextCrop,
      })
      setVisual(saved)
      invalidateCharacterVisual(characterId)
      setPreviewReplay(value => value + 1)
      setCropTarget(null)
      setMessage(cropTarget === 'portrait' ? '立绘裁剪已保存' : '头像裁剪已保存')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '裁剪保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="character-visual-editor">
      <div className="visual-preview-panel">
        <CharacterRenderer
          key={`${characterId}-${assets.length}-${previewMotion}-${previewReplay}`}
          characterId={characterId}
          name={name}
          legacyAvatar={legacyAvatar}
          mode="stage"
          motion={previewMotion}
          className="character-renderer-editor"
        />
        <div className="visual-preview-controls">
          <div className="visual-preview-motion">{MOTION_LABELS[previewMotion] || previewMotion}</div>
          <button
            className="btn primary"
            type="button"
            onClick={() => setPreviewReplay(value => value + 1)}
          >
            预览动画
          </button>
        </div>
      </div>
      <div className="visual-editor-fields">
        {/* 原画 */}
        <div className="visual-slot">
          <div className="visual-slot-preview" title="原画不限制像素尺寸">
            {originalUrl
              ? <img src={originalUrl} alt="原画" style={{ objectFit: 'contain', transform: 'none' }} />
              : <span className="visual-slot-empty">原画</span>}
          </div>
          <div className="visual-slot-info">
            <div className="visual-slot-name">原画</div>
            <div className="visual-slot-file">
              {assetName(originalAssetId)
                ? `${assetName(originalAssetId)}${!visual.originalAssetId ? '（兼容旧立绘）' : ''} · 像素不限 / ≤20 MB`
                : '未上传 · 像素尺寸不限，文件不超过 20 MB'}
            </div>
          </div>
          {uploadButton('original', 'image/*')}
        </div>

        {/* 立绘 */}
        <div className="visual-slot">
          <div className="visual-slot-preview" title="点击预览">
            {originalUrl
              ? <img src={originalUrl} alt="立绘" style={portraitCroppedStyle} />
              : <span className="visual-slot-empty">立绘</span>}
          </div>
          <div className="visual-slot-info">
            <div className="visual-slot-name">立绘</div>
            <div className="visual-slot-file">
              {originalUrl
                ? portraitCrop ? '已从原画裁剪并保存（详情栏 3:4）' : '尚未裁剪（默认居中 3:4）'
                : '请先上传原画'}
            </div>
          </div>
          <button
            className="btn sm"
            disabled={busy || !originalUrl}
            onClick={() => setCropTarget('portrait')}
            style={{ flexShrink: 0 }}
          >
            裁剪立绘
          </button>
        </div>

        {/* 头像 */}
        <div className="visual-slot">
          <div className="visual-slot-preview" title="点击预览">
            {originalUrl
              ? <img src={originalUrl} alt="头像" style={avatarCroppedStyle} />
              : legacyAvatarUrl
                ? <img src={legacyAvatarUrl} alt="旧头像" />
                : <span className="visual-slot-empty">头像</span>}
          </div>
          <div className="visual-slot-info">
            <div className="visual-slot-name">头像</div>
            <div className="visual-slot-file">
              {originalUrl
                ? avatarCrop ? '已从原画裁剪并保存（方形）' : '尚未裁剪（默认居中方形）'
                : legacyAvatarUrl ? '兼容旧头像 · 上传原画后可重新裁剪' : '请先上传原画'}
            </div>
          </div>
          <button
            className="btn sm"
            disabled={busy || !originalUrl}
            title={originalUrl ? '基于原画设置头像取景' : '需要先上传原画'}
            onClick={() => setCropTarget('avatar')}
            style={{ flexShrink: 0 }}
          >
            裁剪头像
          </button>
        </div>

        {/* 动作 */}
        {EDITABLE_MOTIONS.map(motion => (
          <div className="visual-slot" key={motion}>
            <div
              className="visual-slot-preview"
              title={`点击预览 ${motion}`}
              onClick={() => {
                setPreviewMotion(motion)
                setPreviewReplay(value => value + 1)
              }}
            >
              {visual.motions[motion]?.assetId
                ? <img src={characterAssetUrl(characterId, visual.motions[motion]!.assetId)} alt={motion} />
                : <span className="visual-slot-empty">{motion}</span>}
            </div>
            <div className="visual-slot-info">
              <div className="visual-slot-name">{MOTION_LABELS[motion] || motion}</div>
              <div className="visual-slot-file">{assetName(visual.motions[motion]?.assetId) || '未绑定（使用 idle / 头像降级）'}</div>
            </div>
            {uploadButton(motion, 'image/*,video/*')}
          </div>
        ))}

        <div className="visual-editor-actions">
          <button className="btn" disabled={busy} onClick={() => void save(false)}>保存草稿</button>
          <button className="btn primary" disabled={busy} onClick={() => void save(true)}>发布新版本</button>
          <button className="btn" disabled={busy} onClick={() => void doExport()}>导出角色包</button>
          <label className={`btn ${busy ? 'disabled' : ''}`}>
            导入角色包
            <input
              type="file"
              accept=".gz,.tianshu-character.gz"
              hidden
              disabled={busy}
              onChange={event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                const conflict = window.confirm('若已有同名角色，如何处理？\n\n确定：覆盖该角色\n取消：跳过冲突（报错）') ? 'replace' : 'error'
                void doImport(file, conflict)
              }}
            />
          </label>
        </div>
        {message && <div className="visual-editor-message">{message}</div>}
      </div>

      {cropTarget && originalUrl && (
        <AvatarCropDialog
          imageUrl={originalUrl}
          crop={cropTarget === 'portrait' ? portraitCrop : avatarCrop}
          variant={cropTarget}
          saving={busy}
          onConfirm={nextCrop => { void confirmCrop(nextCrop) }}
          onClose={() => setCropTarget(null)}
        />
      )}
    </div>
  )
}

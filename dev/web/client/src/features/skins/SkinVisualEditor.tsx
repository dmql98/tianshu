import { useI18n } from '@/i18n'
import { useEffect, useState } from 'react'
import {
  fetchSkin, updateSkin, uploadSkinFile, skinFileUrl, deleteSkin,
  type Skin, type SkinMotion, SKIN_MOTIONS,
} from '@/api/skins'
import { useNavigate } from 'react-router-dom'
import AvatarCropDialog, { type AvatarCrop } from '@/features/characters/AvatarCropDialog'
import { normalizeAvatarCrop } from '@/features/characters/avatarCrop'

const MOTION_LABELS: Record<string, string> = {
  idle: 'idle（待机）', thinking: 'thinking（思考）', working: 'working（工作）',
  speaking: 'speaking（说话）', success: 'success（完成）', error: 'error（出错）',
}

const SKIN_MAX_BYTES = 60 * 1024 * 1024

interface Props {
  skinId: string
}

/** 皮肤文件加载到一个槽位（原画/立绘/头像/动画），否则显示空占位。 */
function useSkinPreview(skin: Skin | null) {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [motionUrls, setMotionUrls] = useState<Partial<Record<SkinMotion, string>>>({})

  useEffect(() => {
    if (!skin) { setOriginalUrl(null); setPortraitUrl(null); setAvatarUrl(null); setMotionUrls({}); return }
    const v = skin.updatedAt
    setOriginalUrl(skin.original ? skinFileUrl(skin.id, skin.original.filename, v) : null)
    setPortraitUrl(skin.portrait ? skinFileUrl(skin.id, skin.portrait.filename, v) : null)
    setAvatarUrl(skin.avatar ? skinFileUrl(skin.id, skin.avatar.filename, v) : null)
    const m: Partial<Record<SkinMotion, string>> = {}
    for (const motion of SKIN_MOTIONS) {
      const entry = skin.motions[motion]
      m[motion] = entry ? skinFileUrl(skin.id, entry.filename, v) : undefined
    }
    setMotionUrls(m)
  }, [skin])

  return { originalUrl, portraitUrl, avatarUrl, motionUrls }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('加载图片失败'))
    img.src = url
  })
}

/**
 * 把原画按 crop 取景实际裁剪成指定比例的 PNG Blob。
 * 数学与 AvatarCropDialog 的 avatarCropStyle（object-fit:cover + 围绕焦点缩放）一致，
 * 保证所见即所得。
 */
async function cropImageToBlob(
  imageUrl: string,
  crop: AvatarCrop,
  aspectW: number,
  aspectH: number,
  sizeW: number,
): Promise<Blob> {
  const img = await loadImage(imageUrl)
  const W = img.naturalWidth
  const H = img.naturalHeight
  const sizeH = Math.round(sizeW * aspectH / aspectW)
  const canvas = document.createElement('canvas')
  canvas.width = sizeW
  canvas.height = sizeH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  const n = normalizeAvatarCrop(crop)
  const cover = Math.max(sizeW / W, sizeH / H)
  const s = cover * n.scale
  const px = (n.x / 100) * W
  const py = (n.y / 100) * H
  const fx = (n.x / 100) * sizeW
  const fy = (n.y / 100) * sizeH
  ctx.translate(fx - px * s, fy - py * s)
  ctx.scale(s, s)
  ctx.drawImage(img, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('裁剪失败'))), 'image/png')
  })
}

export default function SkinVisualEditor({ skinId }: Props) {
  const t = useI18n()
  const navigate = useNavigate()
  const [skin, setSkin] = useState<Skin | null>(null)
  const [skinName, setSkinName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [cropTarget, setCropTarget] = useState<{ variant: 'portrait' | 'avatar'; source: 'original' | 'portrait' } | null>(null)
  const [cropping, setCropping] = useState(false)

  const { originalUrl, portraitUrl, avatarUrl, motionUrls } = useSkinPreview(skin)

  const reload = async () => {
    const data = await fetchSkin(skinId)
    setSkin(data)
    setSkinName(data.name)
  }

  useEffect(() => { void reload() }, [skinId])

  if (!skin) return <div className="empty-state">{t('正在读取皮肤资源…')}</div>

  const uploadTo = async (slot: 'original' | 'portrait' | 'avatar' | SkinMotion, file?: File) => {
    if (!file) return
    if (file.size > SKIN_MAX_BYTES) {
      setMessage(t('文件不能超过 60 MB'))
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const updated = await uploadSkinFile(skin.id, slot, file)
      setSkin(updated)
      setMessage(t('已上传 {name}', { name: file.name }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('上传失败'))
    } finally {
      setBusy(false)
    }
  }

  // 名称失焦自动保存（无保存按钮，去掉描述）。
  const saveName = async () => {
    const name = skinName.trim()
    if (!name || name === skin.name) return
    setBusy(true)
    setMessage('')
    try {
      const updated = await updateSkin(skin.id, { name })
      setSkin(updated)
      setMessage(t('皮肤信息已保存'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  // 从原画/立绘裁剪立绘/头像：canvas 真实裁剪后上传到对应槽位。
  const confirmCrop = async (crop: AvatarCrop) => {
    if (!cropTarget) return
    const sourceUrl = cropTarget.source === 'portrait' ? portraitUrl : originalUrl
    if (!sourceUrl) return
    const isPortrait = cropTarget.variant === 'portrait'
    setCropping(true)
    setMessage('')
    try {
      // 头像为方形 256，立绘为 3:4。
      const blob = await cropImageToBlob(sourceUrl, crop, isPortrait ? 3 : 1, isPortrait ? 4 : 1, 256)
      const file = new File([blob], isPortrait ? 'portrait.png' : 'avatar.png', { type: 'image/png' })
      const updated = await uploadSkinFile(skin.id, cropTarget.variant, file)
      setSkin(updated)
      setMessage(isPortrait ? t('已从原画裁剪立绘') : t('已从{source}裁剪头像', { source: cropTarget.source === 'portrait' ? '立绘' : '原画' }))
      setCropTarget(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('裁剪失败'))
    } finally {
      setCropping(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(t('确定删除皮肤「{name}」？', { name: skin.name }))) return
    setBusy(true)
    try {
      await deleteSkin(skin.id)
      navigate('/characters')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('删除失败'))
      setBusy(false)
    }
  }

  const uploadButton = (slot: 'original' | 'portrait' | 'avatar' | SkinMotion, accept: string, label?: string) => (
    <label className={`btn sm ${busy ? 'disabled' : ''}`} style={{ flexShrink: 0 }}>
      {label || t('上传')}
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

  const slotPreview = (url: string | null | undefined, alt: string, video?: boolean, fit: 'cover' | 'contain' = 'cover') =>
    url
      ? video
        ? <video src={url} autoPlay muted loop playsInline title={alt} />
        : <img src={url} alt={alt} style={{ objectFit: fit, transform: 'none' }} />
      : <span className="visual-slot-empty">{alt}</span>

  return (
    <div className="character-visual-editor">
      {/* 顶部身份区：左原画+立绘 + 右 id/名称/头像 */}
      <div className="visual-slot-header">
        {/* 左：立绘大卡 + 原画 */}
        <div className="visual-slot-portrait">
          <div className="visual-slot-portrait-preview">
            {slotPreview(portraitUrl, t('立绘'))}
          </div>
          <div className="visual-slot-portrait-meta">
            <div className="visual-slot-name">{t('立绘')} (portrait)</div>
            <div className="visual-slot-file">
              {skin.portrait ? skin.portrait.filename : t('未上传 · 建议 PNG/WebP，1200×1600')}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {uploadButton('portrait', 'image/*')}
              {originalUrl && (
                <button className="btn sm" disabled={busy} onClick={() => setCropTarget({ variant: 'portrait', source: 'original' })}>{t('从原画裁剪')}</button>
              )}
            </div>
          </div>

          {/* 原画（裁剪前的源图） */}
          <div className="visual-slot original-slot">
            <div className="visual-slot-preview visual-slot-original-preview">
              {slotPreview(originalUrl, t('原画'), false, 'contain')}
            </div>
            <div className="visual-slot-info">
              <div className="visual-slot-name">{t('原画')} (original)</div>
              <div className="visual-slot-file">{skin.original ? skin.original.filename : t('未上传原画 · 可仅上传立绘/头像')}</div>
            </div>
            {uploadButton('original', 'image/*')}
          </div>
        </div>

        {/* 右上：皮肤身份信息 */}
        <div className="visual-slot-identity">
          <div className="visual-slot">
            <div className="visual-slot-info">
              <div className="visual-slot-name">{t('皮肤 ID')}</div>
              {/* id 与磁盘目录绑定，创建后不可修改：只读展示，无编辑按钮 */}
              <div className="visual-slot-file visual-slot-id">{skin.id}</div>
            </div>
            <span className="visual-slot-note">{t('创建后不可修改')}</span>
          </div>
          <div className="visual-slot">
            <div className="visual-slot-info">
              <div className="visual-slot-name">{t('名称')}</div>
              <div className="visual-slot-file">
                <input
                  className="search-input"
                  value={skinName}
                  onChange={e => setSkinName(e.target.value)}
                  onBlur={() => void saveName()}
                  style={{ width: 220, fontSize: 'calc(14px * var(--ui-font-scale))' }}
                />
              </div>
            </div>
          </div>
          {/* 头像 */}
          <div className="visual-slot">
            <div className="visual-slot-preview visual-slot-preview-lg">{slotPreview(avatarUrl, t('头像'), false, 'contain')}</div>
            <div className="visual-slot-info">
              <div className="visual-slot-name">{t('头像')} (avatar)</div>
              <div className="visual-slot-file">{skin.avatar ? skin.avatar.filename : t('未上传 · 建议正方形的图')}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {uploadButton('avatar', 'image/*')}
              {originalUrl && (
                <button className="btn sm" disabled={busy} onClick={() => setCropTarget({ variant: 'avatar', source: 'original' })}>{t('从原画裁剪')}</button>
              )}
              {portraitUrl && (
                <button className="btn sm" disabled={busy} onClick={() => setCropTarget({ variant: 'avatar', source: 'portrait' })}>{t('从立绘裁剪')}</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 动画区：放大卡片，直接在上传位置内联预览动画 */}
      <div className="visual-animations">
        {SKIN_MOTIONS.map(motion => (
          <div className="visual-slot motion-card" key={motion}>
            <div className="visual-slot-preview motion-card-preview">
              {slotPreview(motionUrls[motion], motion, true)}
            </div>
            <div className="visual-slot-info">
              <div className="visual-slot-name">{MOTION_LABELS[motion] || motion}</div>
              <div className="visual-slot-file">{skin.motions[motion]?.filename || t('未绑定（使用立绘降级）')}</div>
            </div>
            {uploadButton(motion, 'image/*,video/*')}
          </div>
        ))}
      </div>

      {message && <div className="visual-editor-message">{message}</div>}

      {/* 页面最底端：删除皮肤 */}
      <div className="visual-delete-zone">
        <button className="btn" disabled={busy || cropping} onClick={() => void remove()} style={{ color: 'var(--danger, #e5484d)' }}>{t('删除皮肤')}</button>
      </div>

      {/* 从原画/立绘裁剪立绘/头像 */}
      {cropTarget && (
        <AvatarCropDialog
          imageUrl={cropTarget.source === 'portrait' ? portraitUrl! : originalUrl!}
          variant={cropTarget.variant}
          saving={cropping}
          onConfirm={c => { void confirmCrop(c) }}
          onClose={() => setCropTarget(null)}
        />
      )}
    </div>
  )
}

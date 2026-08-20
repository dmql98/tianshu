import { useI18n } from '@/i18n'
import { useEffect, useState } from 'react'
import {
  fetchSkin, updateSkin, uploadSkinFile, skinFileUrl, deleteSkin,
  type Skin, type SkinMotion, SKIN_MOTIONS,
} from '@/api/skins'
import { useNavigate } from 'react-router-dom'

const MOTION_LABELS: Record<string, string> = {
  idle: 'idle（待机）', thinking: 'thinking（思考）', working: 'working（工作）',
  speaking: 'speaking（说话）', success: 'success（完成）', error: 'error（出错）',
}

const SKIN_MAX_BYTES = 60 * 1024 * 1024

interface Props {
  skinId: string
}

/** 皮肤文件加载到一个槽位（立绘/头像/动画），否则显示空占位。 */
function useSkinPreview(skin: Skin | null) {
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [motionUrls, setMotionUrls] = useState<Partial<Record<SkinMotion, string>>>({})

  useEffect(() => {
    if (!skin) { setPortraitUrl(null); setAvatarUrl(null); setMotionUrls({}); return }
    setPortraitUrl(skin.portrait ? skinFileUrl(skin.id, skin.portrait.filename) : null)
    setAvatarUrl(skin.avatar ? skinFileUrl(skin.id, skin.avatar.filename) : null)
    const m: Partial<Record<SkinMotion, string>> = {}
    for (const motion of SKIN_MOTIONS) {
      const entry = skin.motions[motion]
      m[motion] = entry ? skinFileUrl(skin.id, entry.filename) : undefined
    }
    setMotionUrls(m)
  }, [skin])

  return { portraitUrl, avatarUrl, motionUrls }
}

export default function SkinVisualEditor({ skinId }: Props) {
  const t = useI18n()
  const navigate = useNavigate()
  const [skin, setSkin] = useState<Skin | null>(null)
  const [skinName, setSkinName] = useState('')
  const [description, setDescription] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewMotion, setPreviewMotion] = useState<SkinMotion>('idle')
  const [previewReplay, setPreviewReplay] = useState(0)
  const [idEdit, setIdEdit] = useState<{ value: string; saving: boolean } | null>(null)

  const { portraitUrl, avatarUrl, motionUrls } = useSkinPreview(skin)

  const reload = async () => {
    const data = await fetchSkin(skinId)
    setSkin(data)
    setSkinName(data.name)
    setDescription(data.description || '')
  }

  useEffect(() => { void reload() }, [skinId])

  if (!skin) return <div className="empty-state">{t('正在读取皮肤资源…')}</div>

  const uploadTo = async (slot: 'portrait' | 'avatar' | SkinMotion, file?: File) => {
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

  const saveMeta = async () => {
    setBusy(true)
    setMessage('')
    try {
      const updated = await updateSkin(skin.id, { name: skinName, description })
      setSkin(updated)
      setMessage(t('皮肤信息已保存'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const saveNewId = async () => {
    if (!idEdit) return
    // 后端 skin id 不可改名（与目录绑定）；这里提示用户。
    setMessage(t('皮肤 ID 对应磁盘目录，已创建后不可修改'))
    setIdEdit(null)
  }

  const remove = async () => {
    if (!window.confirm(t('确定删除皮肤「{name}」？', { name: skin.name }))) return
    setBusy(true)
    try {
      await deleteSkin(skin.id)
      navigate('/skins')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('删除失败'))
      setBusy(false)
    }
  }

  const uploadButton = (slot: 'portrait' | 'avatar' | SkinMotion, accept: string) => (
    <label className={`btn sm ${busy ? 'disabled' : ''}`} style={{ flexShrink: 0 }}>
      {t('上传')}
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

  const slotPreview = (url: string | null | undefined, alt: string, video?: boolean) =>
    url
      ? video
        ? <video src={url} autoPlay muted loop playsInline title={alt} />
        : <img src={url} alt={alt} style={{ objectFit: 'contain', transform: 'none' }} />
      : <span className="visual-slot-empty">{alt}</span>

  return (
    <div className="character-visual-editor">
      {/* 皮肤元信息：ID + 名称 */}
      <div className="detail-section" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div className="detail-section-title">{t('皮肤信息')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="visual-slot">
            <div className="visual-slot-info">
              <div className="visual-slot-name">{t('皮肤 ID')}</div>
              <div className="visual-slot-file">
                {idEdit ? (
                  <input
                    className="search-input"
                    value={idEdit.value}
                    onChange={e => setIdEdit({ value: e.target.value, saving: false })}
                  />
                ) : (
                  <span>{skin.id}　<button className="btn sm" onClick={() => setIdEdit({ value: skin.id, saving: false })}>{t('编辑')}</button></span>
                )}
              </div>
              <div className="visual-slot-file">{t('ID 对应该皮肤在 dataDir/skin 下的目录，创建后不可修改')}</div>
            </div>
          </div>
          <div className="visual-slot">
            <div className="visual-slot-info">
              <div className="visual-slot-name">{t('名称')}</div>
              <div className="visual-slot-file">
                <input className="search-input" value={skinName} onChange={e => setSkinName(e.target.value)} style={{ width: 220 }} />
              </div>
            </div>
          </div>
          <div className="visual-slot">
            <div className="visual-slot-info">
              <div className="visual-slot-name">{t('描述')}</div>
              <div className="visual-slot-file">
                <input className="search-input" value={description} onChange={e => setDescription(e.target.value)} style={{ width: 320 }} placeholder={t('可选')} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn primary" disabled={busy} onClick={() => void saveMeta()}>{t('保存')}</button>
            <button className="btn" disabled={busy} onClick={() => void remove()} style={{ color: 'var(--danger, #e5484d)' }}>{t('删除皮肤')}</button>
          </div>
        </div>
      </div>

      <div className="visual-preview-panel">
        <div className="renderer-frame" style={{ width: 280, margin: '0 auto' }}>
          {motionUrls[previewMotion]
            ? <video src={motionUrls[previewMotion]} key={`${skin.id}-${previewMotion}-${previewReplay}`} autoPlay muted loop playsInline className="character-renderer-editor" style={{ width: '100%', objectFit: 'cover' }} />
            : portraitUrl
              ? <img src={portraitUrl} alt={previewMotion} className="character-renderer-editor" style={{ width: '100%', objectFit: 'contain' }} />
              : <div className="visual-slot-empty" style={{ height: 320 }}>{t('暂无预览')}</div>}
        </div>
        <div className="visual-preview-controls">
          <div className="visual-preview-motion">{MOTION_LABELS[previewMotion] || previewMotion}</div>
          <button className="btn primary" type="button" onClick={() => setPreviewReplay(v => v + 1)}>{t('预览动画')}</button>
        </div>
      </div>

      <div className="visual-editor-fields">
        {/* 立绘 */}
        <div className="visual-slot">
          <div className="visual-slot-preview">{slotPreview(portraitUrl, t('立绘'))}</div>
          <div className="visual-slot-info">
            <div className="visual-slot-name">{t('立绘')} (portrait)</div>
            <div className="visual-slot-file">{skin.portrait ? skin.portrait.filename : t('未上传 · 建议 PNG/WebP，1200×1600')}</div>
          </div>
          {uploadButton('portrait', 'image/*')}
        </div>

        {/* 头像 */}
        <div className="visual-slot">
          <div className="visual-slot-preview">{slotPreview(avatarUrl, t('头像'))}</div>
          <div className="visual-slot-info">
            <div className="visual-slot-name">{t('头像')} (avatar)</div>
            <div className="visual-slot-file">{skin.avatar ? skin.avatar.filename : t('未上传 · 建议正方形的图')}</div>
          </div>
          {uploadButton('avatar', 'image/*')}
        </div>

        {/* 6 个动画 */}
        {SKIN_MOTIONS.map(motion => (
          <div className="visual-slot" key={motion}>
            <div
              className="visual-slot-preview"
              title={t('点击预览 {motion}', { motion })}
              onClick={() => { setPreviewMotion(motion); setPreviewReplay(v => v + 1) }}
            >
              {slotPreview(motionUrls[motion], motion, true)}
            </div>
            <div className="visual-slot-info">
              <div className="visual-slot-name">{MOTION_LABELS[motion] || motion}</div>
              <div className="visual-slot-file">{skin.motions[motion]?.filename || t('未绑定（使用立绘降级）')}</div>
            </div>
            {uploadButton(motion, 'image/*,video/*')}
          </div>
        ))}

        {message && <div className="visual-editor-message">{message}</div>}
      </div>
    </div>
  )
}

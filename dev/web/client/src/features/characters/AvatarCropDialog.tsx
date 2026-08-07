import { useRef, useState } from 'react'
import { avatarCropStyle, normalizeAvatarCrop, type AvatarCrop } from './avatarCrop'

export type { AvatarCrop } from './avatarCrop'

interface Props {
  imageUrl: string
  isVideo?: boolean
  crop?: AvatarCrop
  variant?: 'avatar' | 'portrait' | 'motion'
  saving?: boolean
  onConfirm: (crop: AvatarCrop) => void
  onClose: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * 基于立绘设置头像取景：拖动调整位置，滑杆缩放，右侧实时预览。
 * 保存的是 avatarCrop（x/y 为 objectPosition 百分比，scale 为缩放倍数）。
 */
export default function AvatarCropDialog({
  imageUrl,
  isVideo = false,
  crop,
  variant = 'avatar',
  saving = false,
  onConfirm,
  onClose,
}: Props) {
  const [c, setC] = useState<AvatarCrop>(() => normalizeAvatarCrop(crop))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    x: number
    y: number
  } | null>(null)

  const imgStyle = avatarCropStyle(c) ?? {}
  const isPortrait = variant === 'portrait'
  const cropAspectRatio = isPortrait ? '3 / 4' : '1 / 1'
  const cropTitle = isPortrait
    ? '裁剪立绘（详情栏 3:4）'
    : variant === 'motion'
      ? '调整动作取景'
      : '裁剪头像（基于原画）'
  const cropAreaLabel = isPortrait ? '立绘三比四裁剪区域' : '头像方形裁剪区域'
  const cropAlt = isPortrait ? '立绘预览' : '头像预览'

  const media = (style: React.CSSProperties, key: string) => isVideo
    ? <video key={key} src={imageUrl} autoPlay muted loop playsInline style={style} draggable={false} />
    : <img key={key} src={imageUrl} alt={cropAlt} style={style} draggable={false} />

  return (
    <div className="approval-overlay" onClick={saving ? undefined : onClose}>
      <div className="approval-dialog" style={{ maxWidth: 640, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div className="approval-title">{cropTitle}</div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          {/* 可拖动取景区 */}
          <div
            className={`avatar-crop-stage ${dragging ? 'dragging' : ''}`}
            aria-label={cropAreaLabel}
            style={{ aspectRatio: cropAspectRatio, height: 'auto' }}
            onPointerDown={e => {
              if (e.button !== 0) return
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              dragRef.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                x: c.x,
                y: c.y,
              }
              setDragging(true)
            }}
            onPointerMove={e => {
              const drag = dragRef.current
              if (!drag || drag.pointerId !== e.pointerId) return
              const rect = e.currentTarget.getBoundingClientRect()
              if (!rect.width || !rect.height) return
              const dx = ((e.clientX - drag.startX) / rect.width) * 100
              const dy = ((e.clientY - drag.startY) / rect.height) * 100
              setC(prev => ({
                ...prev,
                x: clamp(drag.x - dx, 0, 100),
                y: clamp(drag.y - dy, 0, 100),
              }))
            }}
            onPointerUp={e => {
              if (dragRef.current?.pointerId !== e.pointerId) return
              dragRef.current = null
              setDragging(false)
              e.currentTarget.releasePointerCapture(e.pointerId)
            }}
            onPointerCancel={e => {
              if (dragRef.current?.pointerId !== e.pointerId) return
              dragRef.current = null
              setDragging(false)
            }}
            onWheel={e => {
              e.preventDefault()
              e.stopPropagation()
              const factor = Math.exp(-e.deltaY * 0.0015)
              setC(prev => ({
                ...prev,
                scale: Math.round(clamp(prev.scale * factor, 0.3, 3) * 20) / 20,
              }))
            }}
          >
            {media(imgStyle, 'stage')}
          </div>
          {/* 实时预览 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <div className="avatar-crop-preview" style={{ aspectRatio: cropAspectRatio, height: 'auto' }}>
              {media(imgStyle, 'preview')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-light)' }}>
              {isPortrait ? '整个 3:4 区域即详情栏立绘' : '整个方形区域即头像'}；按住鼠标左键拖动，滚轮缩放。
            </div>
            <label style={{ fontSize: 12, color: 'var(--ink-light)' }}>
              缩放
              <input
                type="range"
                min={0.3}
                max={3}
                step={0.05}
                value={c.scale}
                onChange={e => setC(prev => ({ ...prev, scale: Number(e.target.value) }))}
                style={{ width: '100%', marginTop: 4 }}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{c.scale.toFixed(2)}x</span>
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" disabled={saving} onClick={onClose}>取消</button>
          <button className="btn primary" disabled={saving} onClick={() => onConfirm(c)}>
            {saving ? '保存中…' : '保存裁剪'}
          </button>
        </div>
      </div>
    </div>
  )
}

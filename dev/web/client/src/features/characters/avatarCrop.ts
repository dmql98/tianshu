import type { CSSProperties } from 'react'

export interface AvatarCrop {
  x: number
  y: number
  scale: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function normalizeAvatarCrop(crop?: AvatarCrop): AvatarCrop {
  return {
    x: clamp(crop?.x ?? 50, 0, 100),
    y: clamp(crop?.y ?? 50, 0, 100),
    scale: clamp(crop?.scale ?? 1, 0.3, 3),
  }
}

/**
 * Position/zoom the media inside its frame.
 *
 * Media always fills the frame via object-fit: cover. The transform scales
 * around the focus point (x%, y%), so:
 * - scale >= 1 zooms in on that point.
 * - scale < 1 shrinks around that point; dragging the focus moves the visible
 *   region, which translates the whole media across the frame.
 * 50/50 with scale 1 is the untouched fill.
 */
export function avatarCropStyle(input?: AvatarCrop): CSSProperties | undefined {
  if (!input) return undefined
  const crop = normalizeAvatarCrop(input)
  return {
    objectFit: 'cover',
    objectPosition: `${crop.x}% ${crop.y}%`,
    transformOrigin: `${crop.x}% ${crop.y}%`,
    transform: `scale(${crop.scale})`,
  }
}

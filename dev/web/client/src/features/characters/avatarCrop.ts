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
    scale: clamp(crop?.scale ?? 1, 1, 3),
  }
}

/**
 * object-position covers overflow caused by the source aspect ratio. The
 * translate component covers the extra overflow introduced by zooming, so
 * x/y=0 or 100 means an image edge is exactly touching the crop boundary.
 */
export function avatarCropStyle(input?: AvatarCrop): CSSProperties | undefined {
  if (!input) return undefined
  const crop = normalizeAvatarCrop(input)
  const extraTravel = (crop.scale - 1) * 50
  const translateX = ((50 - crop.x) / 50) * extraTravel
  const translateY = ((50 - crop.y) / 50) * extraTravel
  return {
    objectFit: 'cover',
    objectPosition: `${crop.x}% ${crop.y}%`,
    transform: `translate(${translateX}%, ${translateY}%) scale(${crop.scale})`,
  }
}

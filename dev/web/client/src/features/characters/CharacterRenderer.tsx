import { useEffect, useMemo, useState } from 'react'
import {
  characterAssetUrl, fetchCharacterVisual,
  type CharacterAssetRef, type CharacterMotion, type CharacterVisualResponse,
} from '@/api/characters'
import { useCharacterPresence } from '@/features/character-presence/useCharacterPresence'
import { avatarCropStyle } from './avatarCrop'

const visualCache = new Map<string, Promise<CharacterVisualResponse>>()
const VISUAL_INVALIDATE_EVENT = 'tianshu:character-visual-invalidated'

function loadVisual(characterId: string) {
  let cached = visualCache.get(characterId)
  if (!cached) {
    cached = fetchCharacterVisual(characterId)
    visualCache.set(characterId, cached)
  }
  return cached
}

export function invalidateCharacterVisual(characterId: string) {
  visualCache.delete(characterId)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VISUAL_INVALIDATE_EVENT, { detail: characterId }))
  }
}

interface Props {
  characterId: string
  name: string
  legacyAvatar?: string
  mode?: 'avatar' | 'portrait' | 'stage'
  motion?: CharacterMotion
  sessionId?: string
  className?: string
  title?: string
}

interface AssetCandidate {
  id?: string
  crop?: 'avatar' | 'portrait'
  motionCrop?: { x: number; y: number; scale: number }
  loop?: boolean
}

interface LoadedVisual {
  characterId: string
  data: CharacterVisualResponse
}

export default function CharacterRenderer({
  characterId,
  name,
  legacyAvatar,
  mode = 'stage',
  motion,
  sessionId,
  className = '',
  title,
}: Props) {
  const projectedMotion = useCharacterPresence(characterId, sessionId, mode === 'stage' && !motion)
  const requestedMotion = mode === 'stage' ? motion || projectedMotion : 'idle'
  const [loadedVisual, setLoadedVisual] = useState<LoadedVisual | null>(null)
  // Effects run after React commits.  Keep the character id beside the payload
  // so a render caused by switching sessions can never combine the new id with
  // the previous character's asset ids and issue a transient invalid request.
  const data = loadedVisual?.characterId === characterId ? loadedVisual.data : null
  const [brokenAssets, setBrokenAssets] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    if (!characterId) return
    const refresh = () => {
      loadVisual(characterId)
        .then(value => { if (active) setLoadedVisual({ characterId, data: value }) })
        .catch(() => { if (active) setLoadedVisual(null) })
    }
    const onInvalidate = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== characterId) return
      setBrokenAssets(new Set())
      refresh()
    }
    refresh()
    window.addEventListener(VISUAL_INVALIDATE_EVENT, onInvalidate)
    return () => {
      active = false
      window.removeEventListener(VISUAL_INVALIDATE_EVENT, onInvalidate)
    }
  }, [characterId])

  const selected = useMemo(() => {
    if (!data) return null
    const assets = new Map(data.assets.map(asset => [asset.assetId, asset]))
    const candidates: AssetCandidate[] = mode === 'avatar'
      ? [
          { id: data.visual.avatarAssetId },
          { id: data.visual.portraitAssetId, crop: 'avatar' },
          { id: data.visual.originalAssetId, crop: 'avatar' },
        ]
      : mode === 'portrait'
        ? [
            { id: data.visual.originalAssetId, crop: 'portrait' },
            { id: data.visual.portraitAssetId, crop: 'portrait' },
            { id: data.visual.avatarAssetId },
          ]
        : [
          {
            id: data.visual.motions[requestedMotion]?.assetId,
            loop: data.visual.motions[requestedMotion]?.loop,
            motionCrop: data.visual.motions[requestedMotion]?.crop,
          },
          {
            id: data.visual.motions.idle?.assetId,
            loop: data.visual.motions.idle?.loop,
            motionCrop: data.visual.motions.idle?.crop,
          },
          { id: data.visual.originalAssetId, crop: 'avatar' },
          { id: data.visual.avatarAssetId },
          { id: data.visual.portraitAssetId, crop: 'avatar' },
        ]
    for (const candidate of candidates) {
      const id = candidate.id
      if (!id || brokenAssets.has(id)) continue
      const asset = assets.get(id)
      if (mode !== 'stage' && asset?.kind !== 'static') continue
      if (asset) return { asset, ...candidate }
    }
    return null
  }, [data, requestedMotion, brokenAssets, mode])

  const markBroken = (asset: CharacterAssetRef) => {
    setBrokenAssets(current => new Set(current).add(asset.assetId))
  }

  const crop = selected?.crop === 'avatar'
    ? data?.visual.avatarCrop
    : selected?.crop === 'portrait'
      ? data?.visual.portraitCrop
      : undefined
  const style = selected?.crop
    ? avatarCropStyle(crop ?? { x: 50, y: 50, scale: 1 })
    : selected?.motionCrop
      ? avatarCropStyle(selected.motionCrop)
      : undefined
  const selectedAsset = selected?.asset

  return (
    <span
      className={`character-renderer character-renderer-${mode} motion-${requestedMotion} ${className}`}
      data-motion={requestedMotion}
      title={title || `${name} · ${requestedMotion}`}
      aria-label={`${name}，${requestedMotion}`}
    >
      {selectedAsset?.kind === 'video' ? (
        <video
          src={characterAssetUrl(characterId, selectedAsset.assetId)}
          autoPlay
          muted
          loop={selected?.loop !== false}
          playsInline
          style={style}
          onError={() => markBroken(selectedAsset)}
          onEnded={() => {
            // One-shot motions (success/error, loop=false) finished playing:
            // signal presence to return to idle exactly when the animation ends.
            if (selected?.loop === false) {
              window.dispatchEvent(new CustomEvent('tianshu:motion-ended', { detail: characterId }))
            }
          }}
        />
      ) : selectedAsset ? (
        <img
          src={characterAssetUrl(characterId, selectedAsset.assetId)}
          alt={name}
          style={style}
          onError={() => markBroken(selectedAsset)}
        />
      ) : legacyAvatar && !brokenAssets.has('__legacy__') ? (
        <img
          src={legacyAvatar}
          alt={name}
          onError={() => setBrokenAssets(current => new Set(current).add('__legacy__'))}
        />
      ) : (
        <span className="character-renderer-name">{name?.trim()?.[0] || ''}</span>
      )}
      <span className="character-motion-dot" aria-hidden="true" />
    </span>
  )
}

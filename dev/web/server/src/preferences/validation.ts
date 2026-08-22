import { SAFE_ID_RE, type UserThemeSelection, type UserIconPackSelection } from './types.js'

export function normalizeThemeSelection(value: unknown): UserThemeSelection | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { mode?: unknown; themeId?: unknown }
  if (candidate.mode === 'system') return { mode: 'system' }
  if (candidate.mode === 'builtin' || candidate.mode === 'custom') {
    if (
      typeof candidate.themeId === 'string' &&
      candidate.themeId.length > 0 &&
      candidate.themeId.length <= 128 &&
      SAFE_ID_RE.test(candidate.themeId)
    ) {
      return { mode: candidate.mode, themeId: candidate.themeId }
    }
  }
  return null
}

export function normalizeIconPackSelection(value: unknown): UserIconPackSelection | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { packId?: unknown }
  if (
    typeof candidate.packId === 'string' &&
    candidate.packId.length > 0 &&
    candidate.packId.length <= 128 &&
    SAFE_ID_RE.test(candidate.packId)
  ) {
    return { packId: candidate.packId }
  }
  return null
}

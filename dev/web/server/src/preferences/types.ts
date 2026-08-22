/** 与客户端 themeDefinitions / iconPreferences 对齐的安全 ID 形状（防路径/URL 注入）。 */
export const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export type UserThemeSelection =
  | { mode: 'system' }
  | { mode: 'builtin'; themeId: string }
  | { mode: 'custom'; themeId: string }

export type UserIconPackSelection = { packId: string }

export interface ModelUsage {
  version: 1
  counts: Record<string, number>
}

export const EMPTY_MODEL_USAGE: ModelUsage = { version: 1, counts: {} }

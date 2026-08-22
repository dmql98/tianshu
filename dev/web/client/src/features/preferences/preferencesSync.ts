/**
 * 偏好服务端同步（USER_PREFERENCES_PLAN 重构：按职责拆分）。
 *
 * 把主题/图标包选择同步到服务端 <dataDir>/config/{theme.json,iconpack.json}，让它们跨重启
 * 保留（桌面客户端每次启动随机端口 → localStorage origin 变化，不能作为持久层）。
 *
 * 流程：
 * - 启动时 `syncPreferencesFromServer()`：分别拉取主题/图标包并应用（服务端无数据时保留本地值），
 *   随后才订阅变更推送，避免自写回环。
 * - 运行期订阅 `tianshu:theme-changed` / `tianshu:iconpack-changed`，把用户选择异步推到服务端
 *   （串行队列 + 尾写优先，不阻塞 UI）。
 */
import { getTheme, setTheme } from '@/api/theme'
import { getIconPack, setIconPack } from '@/api/iconPack'
import { ICON_PACK_CHANGED_EVENT } from '@/features/icons/iconPreferences'
import { setActiveIconPack } from '@/features/icons/iconRuntime'
import { loadThemePreferences, THEME_CHANGED_EVENT } from '@/features/theme/themePreferences'
import { setThemeSelection } from '@/features/theme/themeRuntime'
import type { ThemeSelection } from '@/features/theme/themeDefinitions'

/** 启动时应用服务端偏好；服务端不可达时保留本地值。 */
export async function syncPreferencesFromServer(): Promise<void> {
  const [theme, iconPack] = await Promise.all([
    getTheme().catch(() => null),
    getIconPack().catch(() => null),
  ])
  if (theme) setThemeSelection(loadThemePreferences(), theme)
  if (iconPack?.packId) setActiveIconPack(iconPack.packId)
}

// 串行推送队列：保证并发推送不交错、最后一次写入生效。
let pushQueue: Promise<unknown> = Promise.resolve()

function enqueuePush(push: () => Promise<unknown>): void {
  pushQueue = pushQueue.then(push).catch((err) => {
    console.error('[preferences] 推送服务端失败（下个推送会自动续传）:', err)
  })
}

/** 订阅主题/图标变更事件并推送服务端。返回 cleanup。应在 sync 之后再调用。 */
export function persistPreferenceChanges(): () => void {
  const onThemeChanged = (event: Event): void => {
    const selection = (event as CustomEvent<{ selection?: ThemeSelection }>).detail?.selection
    if (selection) enqueuePush(() => setTheme(selection))
  }
  const onIconPackChanged = (event: Event): void => {
    const packId = (event as CustomEvent<{ packId?: string }>).detail?.packId
    if (packId) enqueuePush(() => setIconPack({ packId }))
  }
  window.addEventListener(THEME_CHANGED_EVENT, onThemeChanged)
  window.addEventListener(ICON_PACK_CHANGED_EVENT, onIconPackChanged)
  return () => {
    window.removeEventListener(THEME_CHANGED_EVENT, onThemeChanged)
    window.removeEventListener(ICON_PACK_CHANGED_EVENT, onIconPackChanged)
  }
}

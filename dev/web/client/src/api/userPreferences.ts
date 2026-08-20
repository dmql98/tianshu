/**
 * 用户偏好 API（USER_PREFERENCES_PLAN）。
 *
 * 服务端 <dataDir>/user-preferences.json 是主题/图标包偏好的跨重启权威来源
 * （随机端口重启场景下 localStorage 会清空）。客户端启动时拉取并应用，变更时
 * 异步推送；localStorage 仍保留作为快速缓存与跨窗口同步层。
 */
import { apiGet, apiPut } from '@/api/client'
import type { ThemeSelection } from '@/features/theme/themeDefinitions'

export interface UserPreferences {
  schemaVersion: 1
  theme?: ThemeSelection
  iconPack?: { packId: string }
}

export type UserPreferencesPatch = {
  theme?: ThemeSelection | null
  iconPack?: { packId: string } | null
}

/** 拉取服务端偏好；服务端不可达/无数据时回退空对象（客户端自行回退默认）。 */
export async function fetchUserPreferences(): Promise<UserPreferences> {
  try {
    return await apiGet<UserPreferences>('/api/user-preferences')
  } catch {
    return { schemaVersion: 1 }
  }
}

/** 局部更新并返回合并后的服务端偏好（失败向上抛出，调用方选择是否吞掉）。 */
export function updateUserPreferences(patch: UserPreferencesPatch): Promise<UserPreferences> {
  return apiPut<UserPreferences>('/api/user-preferences', patch)
}
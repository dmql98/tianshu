/** 主题选择 API：服务端 <dataDir>/config/theme.json 是跨重启权威来源。 */
import { apiGet, apiPut } from '@/api/client'
import type { ThemeSelection } from '@/features/theme/themeDefinitions'

export function getTheme(): Promise<ThemeSelection> {
  return apiGet<ThemeSelection>('/api/preferences/theme')
}

export function setTheme(selection: ThemeSelection): Promise<ThemeSelection> {
  return apiPut<ThemeSelection>('/api/preferences/theme', selection)
}

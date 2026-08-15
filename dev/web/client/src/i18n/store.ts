import { create } from 'zustand'
import { dict } from './dict'

export type Locale = 'zh' | 'en'

const LS_KEY = 'tianshu:lang'

function loadInitialLocale(): Locale {
  try {
    const v = localStorage.getItem(LS_KEY)
    return v === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

export interface I18nState {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

export const useI18nStore = create<I18nState>((set, get) => ({
  locale: loadInitialLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(LS_KEY, locale)
    } catch { /* ignore */ }
    set({ locale })
  },
  t: (key, vars) => {
    const entry = dict[key]
    let text = entry ? entry[get().locale] : key
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, (m, name: string) =>
        name in vars ? String(vars[name]) : m,
      )
    }
    return text
  },
}))

/** React hook：组件内调用得到响应式 t 函数，语言切换时自动重渲染。 */
export function useI18n() {
  return useI18nStore(s => s.t)
}

/** 非组件环境（模块逻辑、事件回调等）取 t 函数。 */
export function getT() {
  return useI18nStore.getState().t
}

export function getLocale() {
  return useI18nStore.getState().locale
}

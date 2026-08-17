import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initializeDisplayPreferences } from './features/display/displayPreferences'
import { initializeThemeRuntime } from './features/theme/themeRuntime'
import { initializeIconRuntime, waitForIconRegistry } from './features/icons/iconRuntime'
import './index.css'

// 在 React 首次渲染前应用主题与显示偏好，避免闪白/错误主题（TIANSHU_THEME_SWITCHING_PLAN §9.1）。
initializeThemeRuntime()
initializeDisplayPreferences()

// 拉取全量图标注册表（内置 + 用户 + 覆盖层）后再渲染，避免图标兜底闪烁。
// 失败静默（服务端不可达时图标回退占位图形，跨窗口切换走 storage 同步）。
async function bootstrap(): Promise<void> {
  await waitForIconRegistry()
  initializeIconRuntime()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )
}

void bootstrap()

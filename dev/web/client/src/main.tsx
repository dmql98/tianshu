import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initializeDisplayPreferences } from './features/display/displayPreferences'
import { initializeThemeRuntime } from './features/theme/themeRuntime'
import './index.css'

// 在 React 首次渲染前应用主题与显示偏好，避免闪白/错误主题（TIANSHU_THEME_SWITCHING_PLAN §9.1）。
initializeThemeRuntime()
initializeDisplayPreferences()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

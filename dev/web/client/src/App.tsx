import { lazy, Suspense, useState, useEffect } from 'react'
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { fetchEventDefinitions } from './api/eventDefinitions'
import { fetchDataDir } from './api/config'
import ThemeBackdrop from './features/theme/ThemeBackdrop'
import UpdateNotificationDialog from './features/update/UpdateNotificationDialog'
import DesktopTitleBar from './components/DesktopTitleBar'
import Icon from './features/icons/Icon'
import { useI18n } from './i18n'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'

// 低频页面走路由级代码分割（React.lazy），主 bundle 不再包含它们：
// 首屏只加载布局 + 首页/聊天，SettingsPage(1008 行)/CharacterDetailPage(807 行)
// 等在进入对应路由时才按需下载。
const CharacterDetailPage = lazy(() => import('./pages/CharacterDetailPage'))
const CharactersPage = lazy(() => import('./pages/CharactersPage'))
const SkinsPage = lazy(() => import('./pages/SkinsPage'))
const SkinDetailPage = lazy(() => import('./pages/SkinDetailPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const SkillPackageDetailPage = lazy(() => import('./pages/SkillPackageDetailPage'))
const NewSkillPackagePage = lazy(() => import('./pages/NewSkillPackagePage'))
const ToolsPage = lazy(() => import('./pages/ToolsPage'))
const McpPage = lazy(() => import('./pages/McpPage'))
const KnowledgePage = lazy(() => import('./pages/KnowledgePage'))
const MarketPage = lazy(() => import('./pages/MarketPage'))
const EventsPage = lazy(() => import('./pages/EventsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

const navItems = [
  { to: '/chat', icon: 'nav-chat', label: '会话' },
  { to: '/characters', icon: 'nav-characters', label: '角色' },
  { to: '/skills', icon: 'nav-skills', label: '技能' },
  { to: '/tools', icon: 'nav-tools', label: '工具' },
  { to: '/mcp', icon: 'nav-mcp', label: 'MCP' },
  { to: '/knowledge', icon: 'nav-knowledge', label: '知识' },
  { to: '/market', icon: 'nav-market', label: '市场' },
]

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const t = useI18n()
  const [activeEventCount, setActiveEventCount] = useState(0)
  const [setupDone, setSetupDone] = useState(true) // true = ok, false = need config

  useEffect(() => {
    const desktop = window.tianshuDesktop
    if (!desktop) return
    return desktop.onOpenSession((sessionId) => {
      if (!sessionId) return
      navigate(`/chat/${encodeURIComponent(sessionId)}`)
    })
  }, [navigate])

  // 首页允许更明显的背景；其余页面（会话/设置/编辑）降低背景存在感
  const backdropStrength: 'home' | 'task' =
    location.pathname === '/' || location.pathname === '/home' ? 'home' : 'task'

  // Startup check: is dataDir configured?
  useEffect(() => {
    fetchDataDir()
      .then(res => {
        if (!res.configured) {
          setSetupDone(false)
          navigate('/settings')
        }
      })
      .catch(() => {}) // server unreachable, let user proceed

    function onConfigured() { setSetupDone(true) }
    window.addEventListener('datadir-configured', onConfigured)
    return () => window.removeEventListener('datadir-configured', onConfigured)
  }, [])

  useEffect(() => {
    // 启动后拉取服务端自定义主题并重新应用当前选择（§9.1：custom 先回退内置，
    // 拉取成功后校验并应用自定义主题，避免启动闪烁；失败保持内置回退）
    let cancelled = false
    import('./features/theme/themeApi').then(async ({ fetchThemes }) => {
      try {
        const themes = await fetchThemes()
        if (cancelled) return
        const [{ loadThemePreferences }, { setThemeSelection }] = await Promise.all([
          import('./features/theme/themePreferences'),
          import('./features/theme/themeRuntime'),
        ])
        setThemeSelection(loadThemePreferences(), loadThemePreferences().selection, { customThemes: themes })
      } catch { /* 服务端不可达：保持内置回退 */ }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function load() {
      fetchEventDefinitions()
        .then(defs => {
          setActiveEventCount(defs.filter(d => d.status === 'active').length)
        })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, 30000) // refresh every 30s
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="app">
      <ThemeBackdrop strength={backdropStrength} />
      <DesktopTitleBar />
      <div className="app-shell">
      <nav className="nav-rail">
        <img className="nav-logo" src="/logo.png" alt="天枢" title="天枢" onClick={() => navigate('/')} />
        {navItems.map(item => (
          <NavLink
            key={item.to}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            to={item.to}
            title={t(item.label)}
          >
            <Icon name={item.icon} size={20} ariaHidden />
            <span className="nav-label">{t(item.label)}</span>
          </NavLink>
        ))}
        <div className="nav-divider"></div>
        <NavLink
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          to="/events"
          title={t('事件')}
        >
          <Icon name="nav-events" size={20} ariaHidden />
          <span className="nav-label">{t('事件')}</span>
          {activeEventCount > 0 && <span className="nav-badge">{activeEventCount}</span>}
        </NavLink>
        <div className="nav-spacer"></div>
        <NavLink
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          to="/settings"
          title={t('设置')}
        >
          <Icon name="nav-settings" size={20} ariaHidden />
          <span className="nav-label">{t('设置')}</span>
        </NavLink>
      </nav>
      <Suspense fallback={<div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-mid)' }}>…</div>}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/chat/:sessionId/trajectory" element={<ChatPage />} />
        <Route path="/characters" element={<CharactersPage />} />
        <Route path="/characters/new" element={<CharacterDetailPage />} />
        <Route path="/characters/:id" element={<CharacterDetailPage />} />
        <Route path="/skins" element={<SkinsPage />} />
        <Route path="/skins/:id" element={<SkinDetailPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/skills/new" element={<NewSkillPackagePage />} />
        <Route path="/skills/packages/:category/:packageId" element={<SkillPackageDetailPage />} />
        <Route path="/skills/packages/:category/:packageId/skills/:skillId" element={<SkillPackageDetailPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
      </Suspense>
      </div>

      <UpdateNotificationDialog />

      {/* Setup required overlay */}
      {!setupDone && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(44,36,24,0.6)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, padding: '32px 40px',
            border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(44,36,24,0.3)',
            textAlign: 'center', maxWidth: 400,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>
              <Icon name="nav-settings" size={40} ariaHidden />
            </div>
            <div style={{ fontSize: 'calc(18px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--ink-deep)', marginBottom: 8 }}>
              {t('需要配置系统路径')}
            </div>
            <div style={{ fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-mid)', lineHeight: 1.6, marginBottom: 20 }}>
              {t('首次使用需要在「设置 → 系统」中配置天枢的数据存储路径，所有系统数据将保存在该目录下。')}
            </div>
            <button
              className="btn primary"
              onClick={() => setSetupDone(true)}
              style={{ padding: '10px 28px' }}
            >
              {t('前往设置')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

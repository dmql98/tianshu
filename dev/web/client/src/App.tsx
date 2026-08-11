import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { fetchEventDefinitions } from './api/eventDefinitions'
import { fetchDataspace } from './api/config'
import CharacterDetailPage from './pages/CharacterDetailPage'
import CharactersPage from './pages/CharactersPage'
import ChatPage from './pages/ChatPage'
import SkillsPage from './pages/SkillsPage'
import SkillPackageDetailPage from './pages/SkillPackageDetailPage'
import NewSkillPackagePage from './pages/NewSkillPackagePage'
import ToolsPage from './pages/ToolsPage'
import McpPage from './pages/McpPage'
import KnowledgePage from './pages/KnowledgePage'
import MarketPage from './pages/MarketPage'
import EventsPage from './pages/EventsPage'
import SettingsPage from './pages/SettingsPage'
import HomePage from './pages/HomePage'

const navItems = [
  { to: '/chat', icon: '💬', label: '会话' },
  { to: '/characters', icon: '🎭', label: '角色' },
  { to: '/skills', icon: '⚡', label: '技能' },
  { to: '/tools', icon: '🔧', label: '工具' },
  { to: '/mcp', icon: '🔗', label: 'MCP' },
  { to: '/knowledge', icon: '📚', label: '知识' },
  { to: '/market', icon: '🏪', label: '市场' },
]

export default function App() {
  const navigate = useNavigate()
  const [activeEventCount, setActiveEventCount] = useState(0)
  const [setupDone, setSetupDone] = useState(true) // true = ok, false = need config

  // Startup check: is dataspace configured?
  useEffect(() => {
    fetchDataspace()
      .then(res => {
        if (!res.configured) {
          setSetupDone(false)
          navigate('/settings')
        }
      })
      .catch(() => {}) // server unreachable, let user proceed

    function onConfigured() { setSetupDone(true) }
    window.addEventListener('dataspace-configured', onConfigured)
    return () => window.removeEventListener('dataspace-configured', onConfigured)
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
      <nav className="nav-rail">
        <img className="nav-logo" src="/logo.png" alt="天枢" title="天枢" onClick={() => navigate('/')} />
        {navItems.map(item => (
          <NavLink
            key={item.to}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            to={item.to}
            title={item.label}
          >
            {item.icon}
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
        <div className="nav-divider"></div>
        <NavLink
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          to="/events"
          title="事件"
        >
          ⚡
          <span className="nav-label">事件</span>
          {activeEventCount > 0 && <span className="nav-badge">{activeEventCount}</span>}
        </NavLink>
        <div className="nav-spacer"></div>
        <NavLink
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          to="/settings"
          title="设置"
        >
          ⚙️
          <span className="nav-label">设置</span>
        </NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/characters" element={<CharactersPage />} />
        <Route path="/characters/new" element={<CharacterDetailPage />} />
        <Route path="/characters/:id" element={<CharacterDetailPage />} />
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
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
            <div style={{ fontSize: 'calc(18px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--ink-deep)', marginBottom: 8 }}>
              需要配置系统路径
            </div>
            <div style={{ fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-mid)', lineHeight: 1.6, marginBottom: 20 }}>
              首次使用需要在「设置 → 系统」中配置天枢的数据存储路径，所有系统数据将保存在该目录下。
            </div>
            <button
              className="btn primary"
              onClick={() => setSetupDone(true)}
              style={{ padding: '10px 28px' }}
            >
              前往设置
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

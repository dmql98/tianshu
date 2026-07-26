import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import CharacterDetailPage from './pages/CharacterDetailPage'
import CharactersPage from './pages/CharactersPage'
import ChatPage from './pages/ChatPage'
import SkillsPage from './pages/SkillsPage'
import SkillDetailPage from './pages/SkillDetailPage'
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

  return (
    <div className="app">
      <nav className="nav-rail">
        <div className="nav-logo" title="天枢" onClick={() => navigate('/')}>天</div>
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
          <span className="nav-badge">2</span>
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
        <Route path="/skills/:category/:name" element={<SkillDetailPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  )
}

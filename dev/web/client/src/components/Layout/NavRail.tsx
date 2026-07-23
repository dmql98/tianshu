import { useNavigate, useLocation } from 'react-router-dom'
import { useUIStore } from '@/stores/uiStore'

const navItems = [
  { path: '/c', icon: '💬', label: '会话', tab: 'chat' },
  { path: '/events', icon: '⚡', label: '事件', tab: 'events' },
  { path: '/role', icon: '🎭', label: '角色', tab: 'role' },
  { path: '/skill', icon: '🛠️', label: '技能', tab: 'skill' },
  { path: '/tool', icon: '🔧', label: '工具', tab: 'tool' },
  { path: '/mcp', icon: '🔗', label: 'MCP', tab: 'mcp' },
  { path: '/market', icon: '🏪', label: '市场', tab: 'market' },
]

export default function NavRail() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setActiveTab } = useUIStore()

  const activeTab = location.pathname.startsWith('/c') ? 'chat'
    : location.pathname === '/events' ? 'events'
    : location.pathname === '/role' ? 'role'
    : location.pathname === '/skill' ? 'skill'
    : location.pathname === '/tool' ? 'tool'
    : location.pathname === '/mcp' ? 'mcp'
    : location.pathname === '/market' ? 'market'
    : location.pathname.startsWith('/settings') ? 'settings'
    : 'chat'

  const handleNav = (path: string, tab: string) => {
    setActiveTab(tab)
    navigate(path)
  }

  return (
    <nav className="nav-rail">
      <div className="nav-logo" title="天枢">天</div>
      {navItems.map(item => (
        <button
          key={item.tab}
          className={`nav-item ${activeTab === item.tab ? 'active' : ''}`}
          onClick={() => handleNav(item.path, item.tab)}
          title={item.label}
        >
          <span>{item.icon}</span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
      <div className="nav-divider" />
      <div className="nav-spacer" />
      <button
        className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => handleNav('/settings', 'settings')}
        title="设置"
      >
        <span>⚙️</span>
        <span className="nav-label">设置</span>
      </button>
    </nav>
  )
}

import { Outlet } from 'react-router-dom'
import NavRail from './NavRail'
import Sidebar from './Sidebar'
import SidePanel from '../Panels/SidePanel'
import FilePanel from '../Panels/FilePanel'
import { useUIStore } from '@/stores/uiStore'

export default function AppLayout() {
  const { activeTab, sidebarOpen, rightPanelOpen, filePanelOpen } = useUIStore()

  return (
    <div className="app-layout">
      <NavRail />
      {activeTab === 'chat' && sidebarOpen && <Sidebar />}
      <Outlet />
      {activeTab === 'chat' && rightPanelOpen && <SidePanel />}
      {activeTab === 'chat' && filePanelOpen && <FilePanel />}
    </div>
  )
}

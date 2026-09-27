import { useState, useEffect, useCallback } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import ModuleTabs from './ModuleTabs'
import PageTabs from './PageTabs'
import CommandPalette from './CommandPalette'
import { authApi } from '../../lib/api'
import './DashboardLayout.css'

interface DashboardLayoutProps {
  children: React.ReactNode
  navigate: (path: string) => void
}

function DashboardLayout({ children, navigate }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sidebar_collapsed')
      return saved !== null ? JSON.parse(saved) : false
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('sidebar_collapsed', JSON.stringify(isCollapsed))
    } catch {
      // Ignore storage errors
    }
  }, [isCollapsed])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleLogout = useCallback(async () => {
    // Revoking the session server-side is what actually ends it; dropping the
    // local tokens only stops this tab from using it. Clearing first would
    // mean an expired token could never be revoked at all.
    try {
      await authApi.logout(true)
    } catch {
      // A logout that fails server-side must still let the user out — the
      // session may already be gone.
    }
    navigate('/login')
  }, [navigate])

  return (
    <div className={`layout-container ${isCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar (drawer on mobile, collapsible on desktop) */}
      <Sidebar
        navigate={navigate}
        onLogout={handleLogout}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={isCollapsed}
      />

      {/* Main View Area */}
      <div className="layout-main">
        <TopBar
          navigate={navigate}
          onLogout={handleLogout}
          onToggleSidebar={() => {
            if (window.innerWidth > 768) {
              setIsCollapsed((c) => !c)
            } else {
              setSidebarOpen((o) => !o)
            }
          }}
        />

        <ModuleTabs navigate={navigate} onOpenCommand={() => setCommandOpen(true)} />

        <PageTabs navigate={navigate} />

        <main className="layout-content">{children}</main>
      </div>

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} navigate={navigate} />
    </div>
  )
}

export default DashboardLayout

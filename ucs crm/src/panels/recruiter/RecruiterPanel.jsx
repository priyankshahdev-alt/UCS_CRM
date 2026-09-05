import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom'
import { useUcs } from '../../store'
import { themes, applyTheme } from '../hr/theme'
import SettingsDrawer from '../../components/SettingsDrawer'
import NotificationDrawer from '../../components/NotificationDrawer'
import { api } from '../../api/auth'
import { requestNotifPermission, showDesktopNotification } from '../../utils/desktopNotif'
import { useRealtime } from '../../hooks/useRealtime'
import { RecProvider, useRec, initials, avatarColor, avatarTint } from './store'
import { Grid, Users, Bell, FileTxt } from './icons'
import Dashboard from './components/Dashboard'
import Leads from './components/Leads'
import Candidates from './components/Candidates'

const TechnicalTickets = lazy(() => import('../../components/TechnicalTickets'))

const NAV = [
  { id:'dashboard',  path:'/recruiter/dashboard',  label:'Dashboard',  icon:Grid,   eyebrow:'Overview',  sub:'Your hiring at a glance' },
  { id:'leads',      path:'/recruiter/leads',      label:'Leads',      icon:Users,  eyebrow:'Leads',    sub:'Manage incoming leads and track conversions' },
  { id:'candidates', path:'/recruiter/candidates', label:'Candidates', icon:Users,  eyebrow:'People',    sub:'Search and filter every applicant' },
  { id:'tickets',    path:'/recruiter/tickets',    label:'Tickets',    icon:FileTxt, eyebrow:'Support',   sub:'Raise and track your tickets' },
]

function Sidebar({ open, onClose }) {
  const location = useLocation()
  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark" style={{background:'#5B6B4E',borderRadius:10,width:40,height:40,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:18}}>U</div>
          <div><h1>UFS</h1><span>Recruiter Panel</span></div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(n => { const Icon = n.icon;
            const active = location.pathname === n.path
            return (
            <NavLink key={n.id} to={n.path} className={`snav-item ${active ? 'active' : ''}`}
              onClick={() => onClose?.()}>
              <Icon className="ico" /> <span>{n.label}</span>
            </NavLink>
          )})}
        </nav>
      </aside>
    </>
  )
}

function AppShell() {
  const location = useLocation()
  const { user, logout } = useUcs()
  const [themeName, setThemeName] = useState(() => localStorage.getItem('recruiter_theme') || 'sky')
  const [showSettings, setShowSettings] = useState(false)
  const [allNotifs, setAllNotifs] = useState([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  let _initSeenNotifs = []; try { _initSeenNotifs = JSON.parse(localStorage.getItem('recruiter_seen_notifs') || '[]'); } catch { /* corrupted */ }
  const seenNotifIds = useRef(new Set(_initSeenNotifs))
  useEffect(() => {
    if (themes[themeName]) applyTheme(themes[themeName], '.panel-recruiter');
    localStorage.setItem('recruiter_theme', themeName)
  }, [themeName])
  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false) }
    if (showMenu) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  const loadNotifications = () => {
    const uid = user?.id;
    if (!uid) return;
    api(`/notifications/${uid}`, { _prefix: 'ucs' })
      .then(data => {
        const all = data || [];
        const unread = all.filter(n => !n.read_at);
        setAllNotifs(unread);
        unread.forEach(n => {
          if (!seenNotifIds.current.has(n.id)) {
            seenNotifIds.current.add(n.id);
            localStorage.setItem('recruiter_seen_notifs', JSON.stringify([...seenNotifIds.current]));
            showDesktopNotification(n.title, n.body);
          }
        });
      })
      .catch((err) => { console.error('Error:', err.message); });
  };

  useEffect(() => {
    loadNotifications();
    requestNotifPermission();
  }, [user?.id]);

  useRealtime('notification_log', {
    filter: `worker_id=eq.${user?.id}`,
    onInsert: () => loadNotifications(),
    enabled: !!user?.id,
  });
  const recruiter = useRec()
  const meta = NAV.find(n => location.pathname === n.path) || NAV[0]
  const name = user?.name || 'User'
  const init = initials(name)
  const col = avatarColor(name)
  const drawerSections = [
    { label: 'Notifications', type: 'notifications', items: allNotifs },
  ];

  return (
    <div className="app">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="main">
        <div className="mobile-top">
          <button className="hamburger" onClick={() => setMenuOpen(true)}><span /><span /><span /></button>
          <div className="mtop-brand">
            <div className="brand-mark" style={{background:'#5B6B4E',borderRadius:8,width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:14}}>U</div>
            <span>UFS Recruiter Panel</span>
          </div>
        </div>
        <header className="topbar">
          <div>
            <div className="eyebrow">{meta.eyebrow || 'Dashboard'}</div>
            <h2>{meta.label || 'Dashboard'}</h2>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div className="topbar-user" ref={menuRef} onClick={() => setShowMenu(!showMenu)}>
              <div className="avatar" style={{background:avatarTint(col),color:col,width:36,height:36, cursor:'pointer'}}>{init}</div>
              {showMenu && (
                <div className="user-menu">
                  <div className="user-menu-item" style={{flexDirection:'column', alignItems:'flex-start', gap:2, cursor:'default'}}>
                    <div style={{fontWeight:600, fontSize:13}}>{name}</div>
                    <div style={{fontSize:11, color:'var(--ink-soft)'}}>{user?.login_id || 'Recruiter'}</div>
                  </div>
                  <div className="user-menu-divider" />
                  <div className="user-menu-item" onClick={() => { setShowMenu(false); setShowSettings(true); }} style={{cursor:'pointer'}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    Settings
                  </div>
                  <div className="user-menu-divider" />
                  <button className="user-menu-item" onClick={() => { setShowMenu(false); logout() }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
          <NotificationDrawer topOffset={66}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            sections={drawerSections}
            onItemClick={() => setDrawerOpen(false)}
          />
          <SettingsDrawer
            open={showSettings}
            onClose={() => setShowSettings(false)}
            themes={themes}
            themeName={themeName}
            onThemeChange={(key) => setThemeName(key)}
          />
        </header>
        <div className="content-body" style={{ marginRight: drawerOpen ? 320 : 0, transition: 'margin-right .25s ease' }}>
          <Suspense fallback={<div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'60vh',color:'var(--ink-soft)',fontSize:13}}>Loading...</div>}>
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="leads" element={<Leads />} />
            <Route path="candidates" element={<Candidates />} />
            <Route path="tickets" element={<TechnicalTickets panel="recruiter" />} />
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export default function RecruiterPanel() {
  return (
    <RecProvider>
      <AppShell />
    </RecProvider>
  )
}

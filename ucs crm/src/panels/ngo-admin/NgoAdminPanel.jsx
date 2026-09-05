import { useState, useEffect, useRef, Suspense, lazy } from 'react'
import { Routes, Route, NavLink, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom'
import { useUcs } from '../../store'
import { themes, applyTheme } from '../hr/theme'
import { usePolling } from './hooks/usePolling'
import { api } from '../../api/auth'
import { requestNotifPermission, showDesktopNotification } from '../../utils/desktopNotif'
import { masterSearch } from './api/auth'
import NotificationDrawer from '../../components/NotificationDrawer'
import SettingsDrawer from '../../components/SettingsDrawer'
import DonorDetailModal from '../../components/DonorDetailModal'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Donors = lazy(() => import('./pages/Donors'))
const DonorDetail = lazy(() => import('./pages/DonorDetail'))
const StationManagement = lazy(() => import('./pages/StationManagement'))
const Alerts = lazy(() => import('./pages/Alerts'))
const RejectedLeads = lazy(() => import('./pages/RejectedLeads'))
const NgoAttendance = lazy(() => import('./pages/Attendance'))
const FroLiveStatus = lazy(() => import('./pages/FroLiveStatus'))
const SuspensePage = lazy(() => import('./pages/Suspense'))
const DonorCRM = lazy(() => import('./pages/DonorCRM'))
const SearchResults = lazy(() => import('./pages/SearchResults'))
const CallAnalytics = lazy(() => import('./pages/CallAnalytics'))
const DataOverview = lazy(() => import('./pages/DataOverview'))
const Codes = lazy(() => import('./pages/Codes'))
const TechnicalTickets = lazy(() => import('../../components/TechnicalTickets'))

const NAV = [
  { id: 'dashboard', path: '/ngo-admin/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'station-mgmt', path: '/ngo-admin/station-mgmt', label: 'Stations & FROs', icon: 'station' },
  // { id: 'fro-status', path: '/ngo-admin/fro-status', label: 'FRO Status', icon: 'froStatus' },
  // { id: 'call-analytics', path: '/ngo-admin/call-analytics', label: 'Call Analytics', icon: 'callAnalytics' },
  { id: 'donor-crm', path: '/ngo-admin/donor-crm', label: 'Donor CRM', icon: 'donorCrm' },
  { id: 'suspense', path: '/ngo-admin/suspense', label: 'Suspense', icon: 'suspense' },
  // { id: 'alerts', path: '/ngo-admin/alerts', label: 'Alerts', icon: 'alerts' },
  { id: 'donors', path: '/ngo-admin/donors', label: 'Donors', icon: 'donors' },
  // { id: 'data-overview', path: '/ngo-admin/data-overview', label: 'Data Overview', icon: 'dataOverview' },
  { id: 'attendance', path: '/ngo-admin/attendance', label: 'Attendance', icon: 'attendance' },
  { id: 'rejected', path: '/ngo-admin/rejected-leads', label: 'Rejected Leads', icon: 'rejected' },
  { id: 'codes', path: '/ngo-admin/codes', label: 'Acting FRO Codes', icon: 'codes' },
  { id: 'my-tickets', path: '/ngo-admin/my-tickets', label: 'Tickets', icon: 'tickets' },
]

const ICONS = {
  dashboard: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>,
  alerts: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  donorCrm: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  donors: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  station: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  attendance: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  rejected: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
  froStatus: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 17a4 4 0 0 1 8 0"/><circle cx="9" cy="7" r="4"/><path d="M13 4.13A4 4 0 0 1 18 8v4"/><path d="M18 12v6"/><line x1="16" y1="18" x2="20" y2="18"/></svg>,
  suspense: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  callAnalytics: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  dataOverview: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>,
  codes: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  tickets: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
}

const MAX_DROPDOWN = 4

const currency = n => n != null ? '\u20B9' + Number(n).toLocaleString('en-IN') : '\u2014'

function Sidebar({ open, onClose }) {
  const location = useLocation()
  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">NA</div>
          <div><h1>UFS</h1><span>Admin Panel</span></div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(n => {
            const active = location.pathname === n.path || location.pathname.startsWith(n.path + '/') || (n.id === 'donors' && location.pathname.startsWith('/ngo-admin/donors/'))
            return (
            <NavLink key={n.id} to={n.path} className={`snav-item ${active ? 'active' : ''}`}
              onClick={() => onClose?.()}>
              <span className="ico">{ICONS[n.icon]}</span>
              <span>{n.label}</span>
            </NavLink>
          )})}
        </nav>
      </aside>
    </>
  )
}

function DonorDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  return <DonorDetail donor={{ id }} onBack={() => navigate('/ngo-admin/donors')} />
}

function DonorsPage() {
  const navigate = useNavigate()
  return <Donors onSelect={(donor) => navigate(`/ngo-admin/donors/${donor.id}`)} />
}

export default function NgoAdminPanel() {
  const { user, logout } = useUcs()
  const navigate = useNavigate()
  const [showMenu, setShowMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [themeName, setThemeName] = useState(() => localStorage.getItem('ngoadmin_theme') || 'sky')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState({ donors: [], fros: [], stations: [] })
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [searchingMaster, setSearchingMaster] = useState(false)
  const [selectedResult, setSelectedResult] = useState(null)
  const [showDonorDetail, setShowDonorDetail] = useState(null)
  const searchRef = useRef(null)
  const searchTimer = useRef(null)
  const menuRef = useRef(null)
  const location = useLocation()
  const [rejectedCount, setRejectedCount] = useState(0);
  const [rejectedItems, setRejectedItems] = useState([]);
  const [allNotifs, setAllNotifs] = useState([]);
  const [showNotifList, setShowNotifList] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const notifRef = useRef(null);
  let _initSeenNotifs = []; try { _initSeenNotifs = JSON.parse(localStorage.getItem('ngoadmin_seen_notifs') || '[]'); } catch { /* corrupted */ }
  const seenNotifIds = useRef(new Set(_initSeenNotifs));

  const loadRejectedCount = (showDesktop = false) => {
    api('/ngo-admin/rejected-leads', { _prefix: 'ucs' })
      .then(data => {
        const items = (data || []).filter(t => t.status === 'pending_review');
        if (showDesktop && items.length > 0) {
          showDesktopNotification('Lead Rejected', `${items[0].donor_name} (\u20B9${items[0].amount || 0}) lead rejected. Reason: ${items[0].rejection_reason}`, '/ngo-admin/rejected-leads');
        }
        setRejectedItems(items);
        setRejectedCount(items.length);
      })
      .catch((err) => { console.error('Error:', err.message); });
  };

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
            localStorage.setItem('ngoadmin_seen_notifs', JSON.stringify([...seenNotifIds.current]));
            showDesktopNotification(n.title, n.body);
          }
        });
      })
      .catch((err) => { console.error('Error:', err.message); });
  };

  useEffect(() => {
    if (themes[themeName]) {
      applyTheme(themes[themeName], '.panel-ngo-admin')
      const t = themes[themeName]
      const el = document.querySelector('.panel-ngo-admin') || document.documentElement
      el.style.setProperty('--bg', t.sand); el.style.setProperty('--card-bg', t.paper); el.style.setProperty('--sage-light', t['sage-soft'])
    }
    localStorage.setItem('ngoadmin_theme', themeName)
  }, [themeName])

  useEffect(() => {
    loadRejectedCount();
    loadNotifications();
    requestNotifPermission();
  }, [user?.id]);

  // Polling for rejected leads (replaces useRealtime)
  usePolling(
    () => loadRejectedCount(true),
    30000,
    {
      enabled: true,
    }
  );

  // Polling for notifications (replaces useRealtime)
  usePolling(
    () => loadNotifications(),
    30000,
    {
      enabled: !!user?.id,
    }
  );

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifList(false)
    }
    if (showMenu || showNotifList) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu, showNotifList])

  const handleMasterSearch = async (q) => {
    setSearchQuery(q);
    if (!q || q.trim().length < 2) {
      setSearchResults({ donors: [], fros: [], stations: [] });
      setShowSearchDropdown(false);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearchingMaster(true);
      try {
        const results = await masterSearch(q.trim());
        setSearchResults(results);
        setShowSearchDropdown(true);
      } catch { setShowSearchDropdown(false); }
      finally { setSearchingMaster(false); }
    }, 300);
  };

  useEffect(() => {
    if (!showSearchDropdown) return;
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearchDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSearchDropdown]);

  if (user && user.role !== 'admin' && user.role !== 'super_admin') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, padding: 32, textAlign: 'center' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#94a3b8' }}>lock</span>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1F332B' }}>Access Restricted</h2>
        <p style={{ margin: 0, fontSize: 14, color: '#64748b', maxWidth: 400 }}>
          NGO Admin panel requires an <strong>Admin</strong> account.<br />
          Your current role is <strong>{user?.role || 'unknown'}</strong>.
        </p>
        <button onClick={() => navigate('/sa/dashboard')} style={{ marginTop: 8, padding: '10px 24px', borderRadius: 10, border: 'none', background: '#2A6B45', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Back to Dashboard
        </button>
      </div>
    )
  }
  const searchTotal = (searchResults.donors?.length || 0) + (searchResults.fros?.length || 0) + (searchResults.stations?.length || 0);

  const meta = NAV.find(n => location.pathname === n.path || location.pathname.startsWith(n.path + '/') || (n.id === 'donors' && location.pathname.startsWith('/ngo-admin/donors/')))
  const userName = user?.name || 'Admin'
  const initials = userName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  const dropdownItems = rejectedItems.slice(0, MAX_DROPDOWN);
  const totalHidden = rejectedCount - dropdownItems.length;

  const drawerSections = [
    { label: 'Rejected Leads', type: 'rejected', items: rejectedItems },
    { label: 'Notifications', type: 'notifications', items: allNotifs },
  ];

  const markRead = async (notifId) => {
    try { await api(`/notifications/${notifId}/read`, { method: 'PUT', _prefix: 'ucs' }); loadNotifications(); }
    catch (e) { console.error('Error:', e.message); }
  };

  const handleDrawerItemClick = (item, section) => {
    setDrawerOpen(false);
    if (section?.type === 'rejected') {
      navigate('/ngo-admin/rejected-leads');
      return;
    }
    if (item.type === 'suspense_assigned' || item.fro_donor_log_id) {
      navigate('/ngo-admin/suspense');
    } else if (item.type === 'lead_rejected') {
      navigate('/ngo-admin/rejected-leads');
    }
  };

  return (
    <div className="app">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <div style={{ minWidth: 140 }}>
              <div className="eyebrow">Admin</div>
              <h2>{meta?.label || 'Dashboard'}</h2>
            </div>
            {/* Global search */}
            <div ref={searchRef} style={{ position:'relative', flex: 1, maxWidth: 420 }}>
              <div style={{ display:'flex', gap:4, alignItems:'center', background:'var(--card-bg)', borderRadius:8, border:'1px solid var(--line)', padding:'4px 8px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" value={searchQuery}
                  onChange={e => handleMasterSearch(e.target.value)}
                  onFocus={() => { if (searchTotal > 0) setShowSearchDropdown(true); }}
                  onKeyDown={e => { if (e.key === 'Enter' && searchQuery.trim().length >= 2) { setShowSearchDropdown(false); navigate(`/ngo-admin/search?q=${encodeURIComponent(searchQuery.trim())}`); } }}
                  placeholder="Search donors, FROs, stations..."
                  style={{ flex:1, border:'none', outline:'none', fontSize:11, fontFamily:'inherit', background:'transparent', padding:'4px 0', minWidth:0 }} />
                {searchQuery && (
                  <span style={{ fontSize:12, color:'var(--ink-soft)', cursor:'pointer' }}
                    onClick={() => { setSearchQuery(''); setSearchResults({ donors:[], fros:[], stations:[] }); setShowSearchDropdown(false); }}>?</span>
                )}
                {searchingMaster && <span style={{ fontSize:9, color:'var(--ink-soft)' }}>�</span>}
              </div>
              {showSearchDropdown && searchTotal > 0 && (
                <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:'1px solid var(--line)', borderRadius:8, boxShadow:'0 4px 16px rgba(0,0,0,.12)', zIndex:200, maxHeight:360, overflowY:'auto', marginTop:2 }}>
                  {searchResults.donors?.length > 0 && (
                    <div>
                      <div style={{ padding:'6px 10px', fontSize:9, fontWeight:700, color:'var(--ink-soft)', textTransform:'uppercase', letterSpacing:.5, background:'var(--bg)' }}>Donors ({searchResults.donors.length})</div>
                      {searchResults.donors.slice(0, 5).map(d => (
                        <div key={d.id} onClick={() => { setShowSearchDropdown(false); setSelectedResult({ type: 'donor', data: d }); }}
                          style={{ padding:'6px 10px', cursor:'pointer', display:'flex', alignItems:'center', gap:8, transition:'background .1s' }}
                          onMouseEnter={e => e.currentTarget.style.background='#f3f4f6'} onMouseLeave={e => e.currentTarget.style.background=''}>
                          <div style={{ width:24, height:24, borderRadius:'50%', background:'#dcfce7', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#16a34a' }}>{d.name?.[0] || '?'}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:11, fontWeight:600, color:'#111827' }}>{d.name || 'Unknown'}</div>
                            <div style={{ fontSize:9, color:'var(--ink-soft)' }}>{d.mobile_number || ''}{d.city ? ` � ${d.city}` : ''}</div>
                          </div>
                        </div>
                      ))}
                      {searchResults.donors.length > 5 && <div style={{ padding:'4px 10px', fontSize:9, color:'var(--ink-soft)', textAlign:'center' }}>+{searchResults.donors.length - 5} more</div>}
                    </div>
                  )}
                  {searchResults.fros?.length > 0 && (
                    <div>
                      <div style={{ padding:'6px 10px', fontSize:9, fontWeight:700, color:'var(--ink-soft)', textTransform:'uppercase', letterSpacing:.5, background:'var(--bg)' }}>FROs ({searchResults.fros.length})</div>
                      {searchResults.fros.slice(0, 5).map(f => (
                        <div key={f.id} onClick={() => { setShowSearchDropdown(false); setSelectedResult({ type: 'fro', data: f }); }}
                          style={{ padding:'6px 10px', cursor:'pointer', display:'flex', alignItems:'center', gap:8, transition:'background .1s' }}
                          onMouseEnter={e => e.currentTarget.style.background='#f3f4f6'} onMouseLeave={e => e.currentTarget.style.background=''}>
                          <div style={{ width:24, height:24, borderRadius:'50%', background:'#e0e7ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#4338ca' }}>{f.name?.[0] || '?'}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:11, fontWeight:600, color:'#111827' }}>{f.name || 'Unknown'}</div>
                            <div style={{ fontSize:9, color:'var(--ink-soft)' }}>{f.login_id || ''}{f.is_active !== false ? ' � Active' : ' � Inactive'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {searchResults.stations?.length > 0 && (
                    <div>
                      <div style={{ padding:'6px 10px', fontSize:9, fontWeight:700, color:'var(--ink-soft)', textTransform:'uppercase', letterSpacing:.5, background:'var(--bg)' }}>Stations ({searchResults.stations.length})</div>
                      {searchResults.stations.slice(0, 5).map((s, i) => (
                        <div key={`${s.station}-${i}`} onClick={() => { setShowSearchDropdown(false); setSelectedResult({ type: 'station', data: s }); }}
                          style={{ padding:'6px 10px', cursor:'pointer', display:'flex', alignItems:'center', gap:8, transition:'background .1s' }}
                          onMouseEnter={e => e.currentTarget.style.background='#f3f4f6'} onMouseLeave={e => e.currentTarget.style.background=''}>
                          <div style={{ width:24, height:24, borderRadius:'50%', background:'#fef3c7', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#d97706' }}>S</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:11, fontWeight:600, color:'#111827' }}>{s.station || 'Unknown'}</div>
                            <div style={{ fontSize:9, color:'var(--ink-soft)' }}>
                              {s.workers?.name || 'No FRO'}
                              {s.donor_count != null ? ` • ${typeof s.donor_count === 'object' ? Object.values(s.donor_count).reduce((sum, v) => sum + (Number(v) || 0), 0) : s.donor_count} donors` : ''}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ padding:'6px 10px', borderTop:'1px solid var(--line)', textAlign:'center' }}>
                    <span onClick={() => { setShowSearchDropdown(false); navigate(`/ngo-admin/search?q=${encodeURIComponent(searchQuery.trim())}`); }}
                      style={{ fontSize:10, color:'var(--sage)', cursor:'pointer', fontWeight:600 }}>View all results ?</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div className="topbar-user" ref={menuRef} onClick={() => setShowMenu(!showMenu)}>
              <div className="avatar">{initials}</div>
              {showMenu && (
                <div className="user-menu">
                  <div className="user-menu-item" style={{flexDirection:'column', alignItems:'flex-start', gap:2, cursor:'default'}}>
                    <div style={{fontWeight:600, fontSize:13}}>{userName}</div>
                    <div style={{fontSize:11, color:'var(--ink-soft)'}}>Admin</div>
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
          <SettingsDrawer
            open={showSettings}
            onClose={() => setShowSettings(false)}
            themes={themes}
            themeName={themeName}
            onThemeChange={(key) => setThemeName(key)}
          />
        </header>
        <div className="content-body" style={{ marginRight: drawerOpen ? 320 : 0, transition: 'margin-right .25s ease' }}>
          <Suspense fallback={<div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'60vh'}}><span style={{fontSize:13,color:'var(--ink-soft)'}}>Loading...</span></div>}>
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="donor-crm" element={<DonorCRM />} />
            <Route path="donors" element={<DonorsPage />} />
            <Route path="donors/:id" element={<DonorDetailPage />} />
            <Route path="station-mgmt" element={<StationManagement />} />
            <Route path="attendance" element={<NgoAttendance />} />
            <Route path="rejected-leads" element={<RejectedLeads />} />
            <Route path="fro-status" element={<FroLiveStatus />} />
            <Route path="suspense" element={<SuspensePage />} />
            <Route path="search" element={<SearchResults />} />
            <Route path="call-analytics" element={<CallAnalytics />} />
            <Route path="data-overview" element={<DataOverview />} />
            <Route path="codes" element={<Codes />} />
            <Route path="my-tickets" element={<TechnicalTickets panel="ngo_admin" />} />
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Routes>
          </Suspense>
        </div>
      </div>
      {/* Search Result Detail Modal */}
      {selectedResult && (() => {
        const r = selectedResult.data
        const close = () => setSelectedResult(null)
        const iname = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
        const bgMap = { donor: '#dcfce7', fro: '#e0e7ff', station: '#fef3c7' }
        const colorMap = { donor: '#16a34a', fro: '#4338ca', station: '#d97706' }
        const iconMap = { donor: '??', fro: '??', station: '??' }

        if (selectedResult.type === 'donor') {
          const asgn = r.assignments?.[0]
          return (
            <div className="modal-overlay" onClick={close}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: bgMap.donor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: colorMap.donor }}>{iname(r.name)}</div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{r.name || 'Unknown'}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.mobile_number || ''}{r.email ? ` � ${r.email}` : ''}</div>
                    </div>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, cursor: 'pointer', color: 'var(--ink-soft)' }} onClick={close}>close</span>
                </div>
                <div style={{ padding: '16px 22px', background: 'var(--bg)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>City</div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r.city || '�'}</div>
                    </div>
                    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>Amount</div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>?{Number(r.amount || 0).toLocaleString('en-IN')}</div>
                    </div>
                    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>Status</div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{asgn?.status?.replace(/_/g, ' ') || 'N/A'}</div>
                    </div>
                    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>Project</div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r.project_supported || '�'}</div>
                    </div>
                    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>Total Donated</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sage)' }}>?{Number(r.total_amount || 0).toLocaleString('en-IN')}</div>
                    </div>
                    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>Donations</div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r.donation_count || 0} time{(r.donation_count || 0) !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>Address</div>
                      <div style={{ fontSize: 11, fontWeight: 500 }}>{r.address_1 || '�'}</div>
                    </div>
                    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>Last Donation</div>
                      <div style={{ fontSize: 11, fontWeight: 500 }}>{r.last_donation_date ? new Date(r.last_donation_date).toLocaleDateString('en-GB') : '�'}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--ink-soft)' }}>
                    {asgn?.workers?.name && <span className="card" style={{ margin: 0, padding: '4px 8px' }}>FRO: <strong>{asgn.workers.name}</strong></span>}
                    {asgn?.station && <span className="card" style={{ margin: 0, padding: '4px 8px' }}>Station: <strong>{asgn.station}</strong></span>}
                    {asgn?.ngo_id && <span className="card" style={{ margin: 0, padding: '4px 8px' }}>NGO ID: <strong>{asgn.ngo_id}</strong></span>}
                    {!asgn && <span className="card" style={{ margin: 0, padding: '4px 8px', color: '#dc2626' }}>No assignment data</span>}
                  </div>
                  {(r.pan_number || r.birth_date) && (
                    <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ink-soft)', padding: '6px 10px', background: 'var(--card-bg)', borderRadius: 6 }}>
                      {r.pan_number && <span>PAN: <strong>{r.pan_number}</strong></span>}
                      {r.birth_date && <span> &nbsp;�&nbsp; DOB: <strong>{r.birth_date}</strong></span>}
                    </div>
                  )}
                  <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm" onClick={close} style={{ background: 'transparent', border: '1px solid var(--line)' }}>Close</button>
                    <button className="btn btn-primary btn-sm" onClick={() => { close(); setShowDonorDetail(r.id); }}>Open Full Detail ?</button>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        if (selectedResult.type === 'fro') {
          return (
            <div className="modal-overlay" onClick={close}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: bgMap.fro, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: colorMap.fro }}>{iname(r.name)}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{r.name || 'Unknown'}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.login_id || ''}</div>
                    </div>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, cursor: 'pointer', color: 'var(--ink-soft)' }} onClick={close}>close</span>
                </div>
                <div style={{ padding: '16px 22px', background: 'var(--bg)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span className={`pill ${r.is_active !== false ? 'pill-green' : 'pill-red'}`}>{r.is_active !== false ? 'Active' : 'Inactive'}</span>
                    <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>ID: {r.id}</span>
                    <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>Joined {r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : '�'}</span>
                  </div>
                  {r.ngos?.name && (
                    <div style={{ fontSize: 10, color: 'var(--ink-soft)', padding: '6px 10px', background: 'var(--card-bg)', borderRadius: 6 }}>
                      NGO: <strong>{r.ngos.name}</strong>
                    </div>
                  )}
                  <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm" onClick={close} style={{ background: 'transparent', border: '1px solid var(--line)' }}>Close</button>
                    <button className="btn btn-primary btn-sm" onClick={() => { close(); navigate(`/ngo-admin/fro-status?fro_id=${r.id}`); }}>View FRO Status ?</button>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        if (selectedResult.type === 'station') {
          const froName = r.workers?.name
          return (
            <div className="modal-overlay" onClick={close}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: bgMap.station, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: colorMap.station }}>S</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{r.station || 'Unknown'}</div>
                      <div style={{ fontSize: 11, color: r.workers?.name ? 'inherit' : '#dc2626' }}>{froName ? `FRO: ${froName}${r.workers?.login_id ? ` (${r.workers.login_id})` : ''}` : 'No FRO assigned'}</div>
                    </div>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, cursor: 'pointer', color: 'var(--ink-soft)' }} onClick={close}>close</span>
                </div>
                <div style={{ padding: '16px 22px', background: 'var(--bg)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="card" style={{ margin: 0, padding: '10px 12px' }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>Donors</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{r.donor_count || 0}</div>
                    </div>
                    <div className="card" style={{ margin: 0, padding: '10px 12px' }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>NGO</div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r.ngo_id || '�'}</div>
                    </div>
                  </div>
                  {!froName && (
                    <div style={{ marginTop: 8, fontSize: 10, color: '#dc2626', padding: '6px 10px', background: '#fef2f2', borderRadius: 6 }}>
                      This station has no FRO assigned. FRO data may not load if the FK relationship is missing.
                    </div>
                  )}
                  <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm" onClick={close} style={{ background: 'transparent', border: '1px solid var(--line)' }}>Close</button>
                    <button className="btn btn-primary btn-sm" onClick={() => { close(); navigate('/ngo-admin/station-mgmt'); }}>Manage Station ?</button>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        return null
      })()}

      <NotificationDrawer topOffset={56}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sections={drawerSections}
        onItemClick={handleDrawerItemClick}
        onMarkRead={markRead}
      />

      {showDonorDetail && (
        <DonorDetailModal donorId={showDonorDetail} onClose={() => setShowDonorDetail(null)} />
      )}

    </div>
  )
}

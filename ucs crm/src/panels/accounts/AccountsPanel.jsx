import { useState, useRef, useEffect } from 'react'
import { Routes, Route, NavLink, useLocation, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Users, Heart, Wallet, Database, Smartphone, ChevronRight } from 'lucide-react'
import { useUcs } from '../../store'
import { themes, applyTheme } from '../hr/theme'
import SettingsDrawer from '../../components/SettingsDrawer'
import NotificationDrawer from '../../components/NotificationDrawer'
import { api } from '../../api/auth'
import { requestNotifPermission, showDesktopNotification } from '../../utils/desktopNotif'
import { useRealtime } from '../../hooks/useRealtime'
import ToastContainer, { toast } from '../../components/Toast'
import SpecialIncentive from '../../components/SpecialIncentive'
import LeadChampionCelebration from '../../components/LeadChampionCelebration'
import NoticePopup from '../../components/NoticePopup'
import LeadAudit from './pages/LeadAudit'
import Reports from './pages/Reports'
import TeamsPage from './pages/Teams'
import IncentiveSetup from './pages/IncentiveSetup'
import IncentiveVerification from './pages/IncentiveVerification'
import NewData from './pages/NewData'
import OldData from './pages/OldData'
import Donors from './pages/Donors'
import AddressImport from './pages/AddressImport'
import AssetRegister from './pages/AssetRegister'
import RazorpayAccountsManager from './components/RazorpayAccountsManager'
import EmailAccountsView from './components/EmailAccountsView'
import Receipts from './pages/Receipts'
import TemplateSettings from './pages/TemplateSettings'
import SyncSettingsView from './components/SyncSettingsView'
import ChangeAccessCode from './components/ChangeAccessCode'
import ChangeSalaryAccessCode from '../hr/components/ChangeSalaryAccessCode'
import AccountsTickets from './pages/Tickets'
import Workers from '../hr/components/Workers'
import EmployeeDetail from '../hr/components/EmployeeDetail'
import Offboarding from '../hr/components/Offboarding'
import Loans from '../hr/components/Loans'
import { fetchWorkerById } from '../hr/store'
import AttendancePage from './pages/Attendance'
import SimSection from './components/SimSection'
import Certificates from './pages/Certificates'
import BeneficiariesPanel from '../beneficiaries/BeneficiariesPanel'

const NAV_TOP = [
  { id: 'leads', path: '/accounts/leads', label: 'Lead and Audit',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 12l2 2 4-4"/><path d="M12 2a10 10 0 1 0 10 10"/></svg> },
  { id: 'receipt-generator', path: '/accounts/receipt-generator', label: 'Receipts',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> },
]

const NAV_GROUPS = [
  {
    title: 'Workforce',
    icon: <Users size={18} />,
    items: [
      { id: 'attendance', path: '/accounts/attendance', label: 'Attendance',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14l2 2 4-4"/></svg> },
      { id: 'volunteers', path: '/accounts/volunteers', label: 'Salary',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
      { id: 'teams', path: '/accounts/teams', label: 'Teams',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
      { id: 'incentive', path: '/accounts/incentive', label: 'Incentive',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg> },
      { id: 'incentive-verify', path: '/accounts/incentive-verify', label: 'Incentive Verify',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
    ],
  },
  {
    title: 'Donor Management',
    icon: <Heart size={18} />,
    items: [
      { id: 'donors', path: '/accounts/donors', label: 'Donors',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
      { id: 'address', path: '/accounts/address', label: 'Address',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
      { id: 'certificates', path: '/accounts/certificates', label: 'Certificates',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 13l1.5 9-5-3-5 3 1.5-9"/></svg> },
    ],
  },
  {
    title: 'Asset & Finance',
    icon: <Wallet size={18} />,
    items: [
      { id: 'asset-register', path: '/accounts/asset-register', label: 'Asset Register',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> },
      { id: 'loans', path: '/accounts/loans', label: 'Loan & Advance',
        icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
    ],
  },
]

const NAV_BOTTOM = [
  { id: 'reports', path: '/accounts/reports', label: 'Reports',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
  { id: 'tickets', path: '/accounts/tickets', label: 'Tickets',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 5H3v14h12"/><path d="M21 12l-6-6v4H9v4h6v4l6-6z"/></svg> },
  { id: 'beneficiaries', path: '/accounts/beneficiaries', label: 'Beneficiaries',
    icon: <Users size={18} />,
    match: (p) => p.startsWith('/accounts/beneficiaries') },
]

const NAV_DATA_GROUP = {
  title: 'Data',
  icon: <Database size={18} />,
  items: [
    { id: 'new-data', path: '/accounts/new-data', label: 'New Data',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> },
    { id: 'old-data', path: '/accounts/old-data', label: 'Old Data',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> },
  ],
}

const SIM_GROUP_ICON = <Smartphone size={18} />

const SIM_NAV = [
  { id: 'sim-dashboard', path: '/accounts/sim/dashboard', label: 'Dashboard',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    match: (p) => p === '/accounts/sim' || p === '/accounts/sim/dashboard' },
  { id: 'sim-inventory', path: '/accounts/sim/inventory', label: 'All SIM Cards',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
    match: (p) => p === '/accounts/sim/inventory' },
  { id: 'sim-owner', path: '/accounts/sim/owner', label: 'All SIM Owner',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    match: (p) => p === '/accounts/sim/owner' },
]

// Flat list used for page-title meta lookup. Every nav item across top/groups/
// bottom/sim lives here so the header can resolve the active page label.
const ALL_NAV = [
  ...NAV_TOP,
  ...NAV_GROUPS.flatMap(g => g.items),
  ...NAV_BOTTOM,
  ...NAV_DATA_GROUP.items,
  ...SIM_NAV,
]

const navIsActive = (n, pathname) => {
  if (n.id === 'volunteers' && pathname.startsWith('/accounts/volunteers')) return true
  if (n.id === 'attendance' && pathname === '/accounts/attendance') return true
  if (n.match) return n.match(pathname)
  return pathname === n.path
}

const GROUP_STORAGE_PREFIX = 'accounts_group_open_'

const settingsViews = [
  { key: 'razorpay', label: 'Razorpay Accounts', width: 420,
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
    content: <RazorpayAccountsManager /> },
  { key: 'email-import', label: 'Email Accounts', width: 420,
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    content: <EmailAccountsView /> },
  { key: 'sync-settings', label: 'Sync & Imports', width: 380,
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.4-3.4L23 10M1 14l5.1 4.4A9 9 0 0 0 20.5 15"/></svg>,
    content: <SyncSettingsView /> },
  { key: 'template-settings', label: 'Template Settings', width: 460,
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    content: <TemplateSettings /> },
  { key: 'access-code', label: 'Change Access Code', width: 380,
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    content: <ChangeAccessCode /> },
  { key: 'salary-access-code', label: 'Change Salary Access Code', width: 380,
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    content: <ChangeSalaryAccessCode /> },
]

function NavGroup({ title, icon, storageKey, active, children }) {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(GROUP_STORAGE_PREFIX + storageKey)
      if (v !== null) return v === '1'
    } catch { /* storage unavailable */ }
    return active
  })

  useEffect(() => {
    if (active) setOpen(true)
  }, [active])

  const toggle = () => {
    setOpen((prev) => {
      try { localStorage.setItem(GROUP_STORAGE_PREFIX + storageKey, prev ? '0' : '1') } catch { /* storage unavailable */ }
      return !prev
    })
  }

  return (
    <div className="snav-group">
      <button type="button" onClick={toggle} aria-expanded={open}
        className={`snav-item snav-group-header${active ? ' active' : ''}`}>
        {icon && <span className="ico">{icon}</span>}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{title}</span>
        </span>
        <span className={`snav-chevron${open ? ' open' : ''}`}><ChevronRight size={14} /></span>
      </button>
      <div className={`snav-group-items${open ? '' : ' collapsed'}`}>
        {children}
      </div>
    </div>
  )
}

function Sidebar({ open, onClose }) {
  const location = useLocation()

  const renderGroup = (group, storageKey) => (
    <NavGroup
      key={group.title}
      title={group.title}
      icon={group.icon}
      storageKey={storageKey}
      active={group.items.some(n => navIsActive(n, location.pathname))}
    >
      {group.items.map(n => (
        <NavLink key={n.id} to={n.path} onClick={onClose}
          data-nav-id={n.id}
          className={`snav-item snav-sub${navIsActive(n, location.pathname) ? ' active' : ''}`}>
          <span className="ico">{n.icon}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{n.label}</span>
          </span>
        </NavLink>
      ))}
    </NavGroup>
  )

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">UCS</div>
          <div className="brand-copy">
            <h1>UCS</h1>
            <span>Accounts Panel</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Accounts navigation">
          {NAV_TOP.map(n => (
            <NavLink key={n.id} to={n.path} onClick={onClose}
              data-nav-id={n.id}
              className={`snav-item ${navIsActive(n, location.pathname) ? 'active' : ''}`}>
              <span className="ico">{n.icon}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{n.label}</span>
              </span>
            </NavLink>
          ))}
          {renderGroup({ ...NAV_GROUPS[0], title: 'WORKFORCE' }, 'workforce')}
          {renderGroup({ ...NAV_GROUPS[1], title: 'DONOR MANAGEMENT' }, 'donor_management')}
          {renderGroup({ ...NAV_GROUPS[2], title: 'ASSET & FINANCE' }, 'asset_finance')}
          {renderGroup({ ...NAV_DATA_GROUP, title: 'DATA' }, 'data')}
          {renderGroup({ title: 'SIM MANAGEMENT', icon: SIM_GROUP_ICON, items: SIM_NAV }, 'sim')}
          {NAV_BOTTOM.map(n => (
            <NavLink key={n.id} to={n.path} onClick={onClose}
              data-nav-id={n.id}
              className={`snav-item ${navIsActive(n, location.pathname) ? 'active' : ''}`}>
              <span className="ico">{n.icon}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{n.label}</span>
              </span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  )
}

function hrScopeStyle(theme) {
  if (!theme) return undefined
  const style = {}
  for (const [k, v] of Object.entries(theme)) {
    if (k === 'name') continue
    style['--' + k] = v
  }
  return style
}

function VolunteersListPage({ theme }) {
  const navigate = useNavigate()
  return (
    <div className="panel-hr" style={hrScopeStyle(theme)}>
      <Workers showAddForm={false} showNgoSalary={false} showBulkPrint={false} title="Attendance" showPagarExport={true}
        onSelect={(w) => navigate(`/accounts/volunteers/${w.id}`)}
        onOffboard={(w) => navigate(`/accounts/volunteers/${w.id}/offboard`)} />
    </div>
  )
}

function VolunteerDetailPage({ theme }) {
  const { id } = useParams()
  const navigate = useNavigate()
  return (
    <div className="panel-hr" style={hrScopeStyle(theme)}>
      <EmployeeDetail worker={{ id }} onBack={() => navigate('/accounts/volunteers')} onOffboard={() => navigate(`/accounts/volunteers/${id}/offboard`)} />
    </div>
  )
}

function VolunteerOffboardPage({ theme }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [worker, setWorker] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchWorkerById(id).then(w => { setWorker(w); setLoading(false) }).catch(() => setLoading(false))
  }, [id])

  return (
    <div className="panel-hr" style={hrScopeStyle(theme)}>
      {loading ? <div className="empty">Loading...</div>
        : !worker ? <div className="empty">Attendance not found.</div>
        : <Offboarding worker={worker} onBack={() => navigate('/accounts/volunteers')} />}
    </div>
  )
}

export default function AccountsPanel() {
  const rightDrawerWidth = 460
  const { user, logout } = useUcs()
  const [showMenu, setShowMenu] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [themeName, setThemeName] = useState(() => localStorage.getItem('accounts_theme') || 'sky')
  const [allNotifs, setAllNotifs] = useState([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuRef = useRef(null)
  let _initSeenNotifs = []; try { _initSeenNotifs = JSON.parse(localStorage.getItem('accounts_seen_notifs') || '[]'); } catch { /* corrupted */ }
  const seenNotifIds = useRef(new Set(_initSeenNotifs))
  const location = useLocation()

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
            localStorage.setItem('accounts_seen_notifs', JSON.stringify([...seenNotifIds.current]));
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

  const seenAccountTicketsRef = useRef(null);
  useEffect(() => {
    const checkNewTickets = async () => {
      try {
        const data = await api('/tickets', { _prefix: 'ucs' });
        if (!Array.isArray(data)) return;
        const queue = data.filter(t => ['suspense', 'payment_issue', 'receipt_issue'].includes(t.category));
        const keys = queue.map(t => `regular:${t.id}`);
        if (seenAccountTicketsRef.current === null) {
          seenAccountTicketsRef.current = new Set(keys);
          return;
        }
        const fresh = queue.filter(t => !seenAccountTicketsRef.current.has(`regular:${t.id}`));
        fresh.forEach(t => seenAccountTicketsRef.current.add(`regular:${t.id}`));
        if (fresh.length === 0) return;
        const others = fresh.filter(t => t.raised_by_panel !== 'accounts');
        if (others.length === 1) {
          const t = others[0];
          toast(`New ticket raised by ${t.workers?.name || t.raised_by_name || 'Someone'}: ${t.subject}`, 'info');
        } else if (others.length > 1) {
          toast(`${others.length} new tickets received`, 'info');
        }
      } catch (err) { console.error('Ticket watcher:', err.message); }
    };
    checkNewTickets();
    const id = setInterval(checkNewTickets, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (themes[themeName]) {
      applyTheme(themes[themeName], '.panel-accounts')
      const t = themes[themeName]
      const el = document.querySelector('.panel-accounts') || document.documentElement
      el.style.setProperty('--bg', t.sand); el.style.setProperty('--card-bg', t.paper); el.style.setProperty('--sage-light', t['sage-soft'])
    }
    localStorage.setItem('accounts_theme', themeName)
  }, [themeName])

  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false) }
    if (showMenu) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  const meta = ALL_NAV.find(n => navIsActive(n, location.pathname))
  const simMeta = SIM_NAV.some(n => n.match(location.pathname))
  const bnfMeta = location.pathname.startsWith('/accounts/beneficiaries')
  const userName = user?.name || 'User'
  const initials = userName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const drawerSections = [
    { label: 'Notifications', type: 'notifications', items: allNotifs },
  ];

  return (
    <div className={`app${sidebarOpen ? ' sidebar-open' : ''}`}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main">
        <header className="topbar">
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Toggle sidebar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div>
              <div className="eyebrow">{bnfMeta ? 'Beneficiaries' : simMeta ? 'SIM Management' : 'Accounts'}</div>
              <h2>{meta?.label || 'Accounts'}</h2>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div className="topbar-user" ref={menuRef} onClick={() => setShowMenu(!showMenu)}>
            <div className="avatar">{initials}</div>
            {showMenu && (
              <div className="user-menu">
                <div className="user-menu-item" style={{flexDirection:'column', alignItems:'flex-start', gap:2, cursor:'default'}}>
                  <div style={{fontWeight:600, fontSize:13}}>{userName}</div>
                  <div style={{fontSize:11, color:'var(--ink-soft)'}}>Accounts</div>
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
          <NotificationDrawer topOffset={56}
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
            views={settingsViews}
          />
        </header>
        <div className={`content-body${location.pathname.endsWith('/tickets') ? ' content-body-tickets' : ''}`} style={{ marginRight: drawerOpen ? rightDrawerWidth : 0, transition: 'margin-right .25s ease' }}>
          <Routes>
            <Route index element={<Navigate to="leads" replace />} />
            <Route path="leads" element={<LeadAudit />} />
            <Route path="receipts" element={<Navigate to="/accounts/receipt-generator" replace />} />
            <Route path="donors" element={<Donors />} />
            <Route path="address" element={<AddressImport />} />
            <Route path="receipt-history" element={<Navigate to="/accounts/receipt-generator" replace />} />
            <Route path="receipt-generator" element={<Receipts />} />
            <Route path="volunteers" element={<VolunteersListPage theme={themes[themeName]} />} />
            <Route path="volunteers/:id" element={<VolunteerDetailPage theme={themes[themeName]} />} />
            <Route path="volunteers/:id/offboard" element={<VolunteerOffboardPage theme={themes[themeName]} />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="tickets" element={<AccountsTickets />} />
            <Route path="loans" element={<Loans />} />
            <Route path="certificates" element={<Certificates />} />
            <Route path="template-settings" element={<TemplateSettings />} />
            <Route path="asset-register" element={<AssetRegister />} />
            <Route path="reports" element={<Reports />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="incentive" element={<IncentiveSetup />} />
            <Route path="incentive-verify" element={<IncentiveVerification />} />
            <Route path="new-data" element={<NewData />} />
            <Route path="old-data" element={<OldData />} />
            <Route path="sim/*" element={<SimSection />} />
            <Route path="beneficiaries/*" element={<BeneficiariesPanel base="/accounts/beneficiaries" />} />
            <Route path="*" element={<Navigate to="leads" replace />} />
          </Routes>
        </div>
      </div>
      <SpecialIncentive />
      <LeadChampionCelebration />
      <NoticePopup />
      <ToastContainer />
    </div>
  )
}

import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { UcsProvider, useUcs } from './store'
import { SalaryPrivacyProvider } from './context/SalaryPrivacyContext'
import { lazy, Suspense, Component, useEffect } from 'react'
import { getSocket } from './lib/socket'
import Login from './pages/Login'
import TempPage from './pages/TempPage'
import NoticesBar from './components/NoticesBar'
import MeetingGate from './components/MeetingGate'
import { ChatUnreadProvider } from './components/chat/ChatUnreadProvider'
import ChatFabHost from './components/chat/ChatFabHost'
import NoticePopupHost from './components/chat/NoticePopupHost'
import TicketPopupHost from './components/TicketPopupHost'

// Each panel is a separate download. A user only ever pays for the panel they
// are routed into instead of every panel on every login.
const SuperAdminPanel = lazy(() => import('./panels/super-admin/SuperAdminPanel'))
const HRPanel = lazy(() => import('./panels/hr/HRPanel'))
const AccountsPanel = lazy(() => import('./panels/accounts/AccountsPanel'))
const NgoAdminPanel = lazy(() => import('./panels/ngo-admin/NgoAdminPanel'))
const FROPanel = lazy(() => import('./panels/fro/FROPanel'))
const RecruiterPanel = lazy(() => import('./panels/recruiter/RecruiterPanel'))
const EventHeadPanel = lazy(() => import('./panels/event-head/EventHeadPanel'))
const DocumentationPanel = lazy(() => import('./panels/documentation/DocumentationPanel'))
const WhatsAppPanel = lazy(() => import('./panels/whatsapp/WhatsAppPanel'))
const DevPanel = lazy(() => import('./panels/dev-panel/DevPanel'))
const SocialPanel = lazy(() => import('./panels/social/SocialPanel'))
const SimCardPanel = lazy(() => import('./panels/sim-card/SimCardPanel'))

const ROLE_PATHS = {
  super_admin: '/sa',
  admin: '/ngo-admin',
  hr: '/hr',
  accounts: '/accounts',
  recruiter: '/recruiter',
  fro: '/fro',
  worker: '/fro',
  event_head: '/event-head',
  event_manager: '/event-head',
  'Event Manager': '/event-head',
  'Event Head': '/event-head',
  digital: '/social',
  developer: '/dev-panel',
  developers: '/dev-panel',
  tester: '/dev-panel',
  social: '/social',
}

const ROLE_PANELS = {
  super_admin: { panel: SuperAdminPanel, cls: 'panel-sa' },
  admin: { panel: NgoAdminPanel, cls: 'panel-ngo-admin' },
  hr: { panel: HRPanel, cls: 'panel-hr' },
  accounts: { panel: AccountsPanel, cls: 'panel-accounts' },
  fro: { panel: FROPanel, cls: 'panel-fro' },
  recruiter: { panel: RecruiterPanel, cls: 'panel-recruiter' },
  event_head: { panel: EventHeadPanel, cls: 'panel-event-head' },
  event_manager: { panel: EventHeadPanel, cls: 'panel-event-head' },
  'Event Manager': { panel: EventHeadPanel, cls: 'panel-event-head' },
  'Event Head': { panel: EventHeadPanel, cls: 'panel-event-head' },
  digital: { panel: SocialPanel, cls: 'panel-dev' },
  developer: { panel: DevPanel, cls: 'panel-dev' },
  developers: { panel: DevPanel, cls: 'panel-dev' },
  tester: { panel: DevPanel, cls: 'panel-dev' },
  social: { panel: SocialPanel, cls: 'panel-dev' },
}

function ProtectedRoute({ role, children }) {
  const { user } = useUcs()
  const allowedRoles = Array.isArray(role) ? role : [role]
  if (!user) return <Navigate to="/login" replace />
  if (allowedRoles.includes('*')) return children
  if (user.role === 'super_admin' && (allowedRoles.includes('super_admin') || allowedRoles.includes('*'))) return children
  if (!allowedRoles.includes(user.role) && !allowedRoles.includes(user.department)) {
    return <AccessDenied />
  }
  return children
}

function PanelFallback() {
  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <div className="login-logo">UCS</div>
        <p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>
          Loading your panel...
        </p>
      </div>
    </div>
  )
}

function PanelWrapper({ roleKey }) {
  const location = useLocation()
  const mapping = ROLE_PANELS[roleKey]
  if (!mapping) return <AccessDenied />
  const Panel = mapping.panel
  // Derived rather than stored on ROLE_PANELS so a changed base path can never
  // leave the circle pointing at a route that no longer exists.
  const base = ROLE_PATHS[roleKey]
  const chatPath = base ? `${base}/chat` : null
  const onChatRoute = !!chatPath && location.pathname === chatPath
  return (
    <ChatUnreadProvider>
      <div className={onChatRoute ? `${mapping.cls} is-chat-route` : mapping.cls}>
        <Suspense fallback={<PanelFallback />}>
          <Panel />
        </Suspense>
        <NoticesBar />
        {chatPath && <ChatFabHost chatPath={chatPath} />}
        {/* Notices reach people wherever they are in the panel, not only on the
            chat route, so this one is mounted unconditionally. */}
        <NoticePopupHost />
        {/* A ticket raised for this panel pops up once per person, wherever
            they are in the panel. Server keeps the seen set (ticket_popup_seen),
            so a reload or a second device never re-shows it. */}
        <TicketPopupHost />
      </div>
    </ChatUnreadProvider>
  )
}

function AccessDenied() {
  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <div className="login-logo">!</div>
        <h2>Access Denied</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: '13px', margin: '12px 0 20px' }}>
          Your account does not have access to this portal.
        </p>
        <button className="btn btn-primary" onClick={() => {
          localStorage.removeItem('ucs_token')
          localStorage.removeItem('ucs_user')
          window.location.href = '/login'
        }}>
          Sign Out
        </button>
      </div>
    </div>
  )
}

function panelPathFor(user) {
  if (!user) return null
  // The backend collapses both 'digital' and any 'develop*' department to the
  // role 'digital', so only the department string tells the two teams apart.
  // Digital (Duars Digital) is reviewed/rostered under Social Media, so it opens
  // the Social panel; developers keep the Developer panel.
  const dept = String(user.department || '').toLowerCase().trim()
  if (dept.includes('develop')) return ROLE_PATHS.developers
  if (dept.includes('digital')) return ROLE_PATHS.digital
  // Role wins over department: a department string does not always name the
  // panel. An accounts worker is department 'Admin' but role 'accounts', and
  // ROLE_PATHS['admin'] points at /ngo-admin — so department-first sent them to
  // a panel whose route only admits role 'admin', ending in AccessDenied right
  // after a successful login. The token's role is the authoritative panel key.
  const role = String(user.role || '').toLowerCase().trim()
  return ROLE_PATHS[role] || ROLE_PATHS[dept] || null
}

function RootRedirect() {
  const { user } = useUcs()
  if (!user) return <Navigate to="/login" replace />
  const path = panelPathFor(user)
  if (path) return <Navigate to={path} replace />
  return <AccessDenied />
}

function LoginWrapper() {
  const { user } = useUcs()
  const navigate = useNavigate()
  if (user) {
    const path = panelPathFor(user)
    if (path) return <Navigate to={path} replace />
  }
  return <Login onLogin={(loggedInUser) => {
    // Same resolver the route guards use, so the landing panel can never be a
    // different one than panelPathFor() would pick (role-first, department only
    // for the digital/develop split).
    const path = panelPathFor(loggedInUser)
    if (path) navigate(path, { replace: true })
  }} />
}

class ErrorBoundary extends Component {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info && info.componentStack)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#666', marginBottom: 16 }}>{this.state.error?.message}</p>
          <pre style={{ textAlign: 'left', overflow: 'auto', maxHeight: 260, background: '#f6f7fb', border: '1px solid #e3e6ef', borderRadius: 8, padding: 10, margin: '0 auto 16px', fontSize: 12, color: '#333' }}>
            {this.state.error?.stack}
          </pre>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
            style={{ padding: '8px 20px', cursor: 'pointer' }}>
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  useEffect(() => { getSocket() }, [])
  return (
    <ErrorBoundary>
    <UcsProvider>
    <SalaryPrivacyProvider>
      <MeetingGate />
      <Routes>
        <Route path="/login" element={<LoginWrapper />} />
        <Route path="/" element={<RootRedirect />} />

        <Route path="/sa/*" element={
          <ProtectedRoute role="super_admin">
            <PanelWrapper roleKey="super_admin" />
          </ProtectedRoute>
        } />
        <Route path="/hr/*" element={
          <ProtectedRoute role={['hr', 'HR', 'super_admin']}>
            <PanelWrapper roleKey="hr" />
          </ProtectedRoute>
        } />
        <Route path="/ngo-admin/*" element={
          <ProtectedRoute role={['admin', 'super_admin']}>
            <PanelWrapper roleKey="admin" />
          </ProtectedRoute>
        } />
        <Route path="/fro/*" element={
          <ProtectedRoute role={['fro', 'worker', 'FRO', 'super_admin']}>
            <PanelWrapper roleKey="fro" />
          </ProtectedRoute>
        } />
        <Route path="/accounts/*" element={
          <ProtectedRoute role={['accounts', 'admin', 'super_admin']}>
            <PanelWrapper roleKey="accounts" />
          </ProtectedRoute>
        } />
        <Route path="/recruiter/*" element={
          // super_admin is here because the super-admin panel renders this panel
          // in an iframe at /recruiter; without it that frame renders AccessDenied.
          <ProtectedRoute role={['recruiter', 'HR-Recruiter', 'super_admin']}>
            <PanelWrapper roleKey="recruiter" />
          </ProtectedRoute>
        } />
        <Route path="/event-head/*" element={
          <ProtectedRoute role={['event_head', 'Event Head', 'Event Manager']}>
            <PanelWrapper roleKey="event_head" />
          </ProtectedRoute>
        } />
        <Route path="/dev-panel/*" element={
          <ProtectedRoute role={['developers', 'developer', 'digital', 'tester', 'Developer', 'Developers', 'Digital', 'Tester', 'super_admin']}>
            <PanelWrapper roleKey="developers" />
          </ProtectedRoute>
        } />

        <Route path="/social/*" element={
          <ProtectedRoute role={['social', 'digital', 'Social', 'Social Media', 'Digital', 'super_admin']}>
            <PanelWrapper roleKey="social" />
          </ProtectedRoute>
        } />

        <Route path="/wa/*" element={
          <ProtectedRoute role={['*']}>
            <Suspense fallback={<PanelFallback />}>
              <WhatsAppPanel />
            </Suspense>
          </ProtectedRoute>
        } />

        <Route path="/docs/*" element={
          <ProtectedRoute role={['*']}>
            <Suspense fallback={<PanelFallback />}>
              <DocumentationPanel />
            </Suspense>
          </ProtectedRoute>
        } />

        <Route path="/sim/*" element={
          <ProtectedRoute role={['super_admin', 'admin', 'hr', 'accounts']}>
            <Suspense fallback={<PanelFallback />}>
              <SimCardPanel />
            </Suspense>
          </ProtectedRoute>
        } />

        <Route path="/temp" element={<TempPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SalaryPrivacyProvider>
    </UcsProvider>
    </ErrorBoundary>
  )
}

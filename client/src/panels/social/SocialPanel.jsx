import { useState, lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { useUcs } from '../../store'
import SocialDailyReport from './pages/SocialDailyReport'
import TechnicalTickets from '../../components/TechnicalTickets'
import SocialReportApprovals from './pages/SocialReportApprovals'
import ChatWorkspace from '../../components/chat/ChatWorkspace'
import ChatNavBadge from '../../components/chat/ChatNavBadge'
import ToastContainer from '../../components/Toast'
import { fetchTaskAssignAccess } from '../../api/taskAssignments'

// Reused from the Event Manager workspace so the Social team plans against the
// exact same NGOs/sectors/activities and AI suggestions. Lazy so the planner
// (and the event-head store it pulls in) is only downloaded if opened.
const ActivityPlanner = lazy(() => import('../event-head/pages/ActivityPlanner'))
// Event Manager screens surfaced here for the Social team: the Calendar, the
// Reels Checklist and Media / Banners. Lazy, same live event-head data the
// backend already exposes to the social/digital roles.
const MonthlyPlanner = lazy(() => import('../event-head/pages/MonthlyPlanner'))
// A focused screen for the AI programme ideas: pick the segment and turn an
// idea into a real programme that shows on the Monthly Planner. Shares the
// planner's suggestion store, so both screens read and write the same rows.
const SuggestProgrammes = lazy(() => import('../event-head/pages/SuggestProgrammes'))
const ReelsChecklist = lazy(() => import('../event-head/components/ReelsChecklist'))
const MediaManagement = lazy(() => import('../event-head/pages/MediaManagement'))
// The monthly report (every event of a chosen month, grouped by NGO) lives in
// the Event Manager's Event Reports screen; surfaced here for the Social team,
// opening straight on the Monthly tab.
const EventReports = lazy(() => import('../event-head/pages/EventReports'))

// Social Media Manager workspace. Mirrors the Developer panel's self-contained
// shell (inline styles, own toast host) and hosts the report, the shared monthly
// planner (borrowed from the Event Manager workspace) and community.

const NAV = [
  { id: 'daily-report', path: '/social/daily-report', label: 'Daily Report', icon: 'description' },
  { id: 'calendar', path: '/social/calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'planner', path: '/social/planner', label: 'Monthly Planner', icon: 'planner' },
  { id: 'suggest-programmes', path: '/social/suggest-programmes', label: 'Suggest Programmes', icon: 'sparkle' },
  { id: 'tickets', path: '/social/tickets', label: 'Tickets', icon: 'ticket' },
  { id: 'reels-checklist', path: '/social/reels-checklist', label: 'Reels Checklist', icon: 'reels' },
  { id: 'media', path: '/social/media', label: 'Media / Banners', icon: 'media' },
  { id: 'monthly-report', path: '/social/monthly-report', label: 'Reports & Analytics', icon: 'report' },
  // Acceptance / rejection of the team's daily reports — the head only. Hidden
  // from members because the review is her call (see canAssign below).
  { id: 'approvals', path: '/social/approvals', label: 'Report Approvals', icon: 'approvals', headOnly: true },
  { id: 'chat', path: '/social/chat', label: 'Community', icon: 'chat' },
]

const ICONS = {
  description: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>,
  calendar: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></svg>,
  planner: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  sparkle: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 14.5l.7 1.8 1.8.7-1.8.7L19 19.5l-.7-1.8-1.8-.7 1.8-.7z"/></svg>,
  ticket: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3 2 2 0 0 0 0 6 3 3 0 0 1-3 3H6a3 3 0 0 1-3-3 2 2 0 0 0 0-6Z"/><line x1="13" y1="6" x2="13" y2="18"/></svg>,
  reels: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>,
  media: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
  report: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>,
  approvals: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18"/><path d="M8 8l4-4 4 4"/><path d="M8 16l4 4 4-4"/></svg>,
  chat: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/></svg>,
}

export default function SocialPanel() {
  const location = useLocation()
  const { user, logout } = useUcs()
  const [collapsed, setCollapsed] = useState(false)
  const isSuperAdmin = user?.role === 'super_admin'

  // Assign UI is for the Social head only; everyone else sees the plan read-only
  // (their tasks still show in the Daily Report). Starts hidden so no member ever
  // flashes the picker before the check resolves.
  const [canAssign, setCanAssign] = useState(false)
  useEffect(() => {
    let alive = true
    fetchTaskAssignAccess()
      .then((res) => { if (alive) setCanAssign(Boolean(res?.can_assign)) })
      .catch(() => { if (alive) setCanAssign(false) })
    return () => { alive = false }
  }, [])

  const activeNav = NAV.find((n) => location.pathname === n.path)

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <ToastContainer />
      <aside style={{
        ...(isSuperAdmin ? { display: 'none' } : {
          width: collapsed ? 56 : 220, flexShrink: 0, background: 'var(--card-bg)', borderRight: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column', transition: 'width .2s', overflow: 'hidden',
        }),
      }}>
        <div style={{ padding: collapsed ? '16px 12px' : '16px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #ec4899, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
            SM
          </div>
          {!collapsed && <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Social Panel</div>
            <div style={{ fontSize: 9, color: 'var(--ink-soft)' }}>Content & Reach</div>
          </div>}
        </div>

        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {NAV.filter((item) => !item.headOnly || canAssign).map((item) => (
            <NavLink key={item.id} to={item.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '10px 16px' : '10px 18px', fontSize: 12, fontWeight: 500, color: 'var(--ink-soft)', textDecoration: 'none', transition: 'all .12s', borderLeft: '3px solid transparent' }}
              className={({ isActive }) => isActive ? 'nav-active' : ''}>
              <span style={{ flexShrink: 0, display: 'flex' }}>{ICONS[item.icon]}</span>
              {!collapsed && <span>{item.label}</span>}
              {item.id === 'chat' && <ChatNavBadge quiet />}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
          {!collapsed && (
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name || user?.login_id}
            </div>
          )}
          <button onClick={logout} style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', fontSize: 11, fontWeight: 500, cursor: 'pointer', color: 'var(--ink-soft)', fontFamily: 'inherit' }}>
            {collapsed ? '...' : 'Sign out'}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '10px 20px', borderBottom: '1px solid var(--line)', background: 'var(--card-bg)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={() => setCollapsed((c) => !c)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-soft)', display: 'flex', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{activeNav?.label || 'Social Panel'}</div>
        </header>

        {/* Chat runs edge to edge (no padding, no second scrollbar) so the
            workspace touches the header, right and bottom like in the other
            panels; every other page keeps its padded scroller. */}
        <div
          style={{
            flex: 1,
            overflowY: location.pathname.endsWith('/chat') ? 'hidden' : 'auto',
            padding: location.pathname.endsWith('/chat') ? 0 : 16,
          }}
        >
          <Routes>
            <Route index element={<Navigate to="daily-report" replace />} />
            <Route path="daily-report" element={<SocialDailyReport />} />
            <Route path="calendar" element={
              <div className="panel-event-head">
                <Suspense fallback={<div style={{ padding: 8, color: 'var(--ink-soft)', fontSize: 13 }}>Loading calendar…</div>}>
                  <MonthlyPlanner />
                </Suspense>
              </div>
            } />
            <Route path="planner" element={
              <div className="panel-event-head">
                <Suspense fallback={<div style={{ padding: 8, color: 'var(--ink-soft)', fontSize: 13 }}>Loading planner…</div>}>
                  <ActivityPlanner taskAssignment={canAssign} />
                </Suspense>
              </div>
            } />
            <Route path="suggest-programmes" element={
              <div className="panel-event-head">
                <Suspense fallback={<div style={{ padding: 8, color: 'var(--ink-soft)', fontSize: 13 }}>Loading suggestions…</div>}>
                  <SuggestProgrammes />
                </Suspense>
              </div>
            } />
            <Route path="tickets" element={<TechnicalTickets panel="social" canResolve canDelete />} />
            <Route path="reels-checklist" element={
              <div className="panel-event-head">
                <Suspense fallback={<div style={{ padding: 8, color: 'var(--ink-soft)', fontSize: 13 }}>Loading checklist…</div>}>
                  <ReelsChecklist />
                </Suspense>
              </div>
            } />
            <Route path="media" element={
              <div className="panel-event-head">
                <Suspense fallback={<div style={{ padding: 8, color: 'var(--ink-soft)', fontSize: 13 }}>Loading media…</div>}>
                  <MediaManagement />
                </Suspense>
              </div>
            } />
            <Route path="monthly-report" element={
              <div className="panel-event-head">
                <Suspense fallback={<div style={{ padding: 8, color: 'var(--ink-soft)', fontSize: 13 }}>Loading report…</div>}>
                  <EventReports initialMode="monthly" />
                </Suspense>
              </div>
            } />
            <Route path="approvals" element={<SocialReportApprovals />} />
            <Route path="chat" element={<ChatWorkspace />} />
            <Route path="*" element={<Navigate to="/social/daily-report" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

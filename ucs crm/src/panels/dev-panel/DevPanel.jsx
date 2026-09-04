import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { useUcs } from '../../store';
import Dashboard from './pages/Dashboard';
import TicketList from './pages/TicketList';
import MyTickets from './pages/MyTickets';
import TicketDetail from './pages/TicketDetail';


import { ToastProvider } from './components/Toast';

const TechnicalTickets = lazy(() => import('../../components/TechnicalTickets'));

const NAV = [
  { id: 'dashboard', path: '/dev-panel', label: 'Dashboard', icon: 'dashboard' },
  { id: 'tickets', path: '/dev-panel/tickets', label: 'All Tickets', icon: 'confirmation_number' },
  { id: 'my-tickets', path: '/dev-panel/my-tickets', label: 'My Tickets', icon: 'person' },
  { id: 'unassigned', path: '/dev-panel/unassigned', label: 'Unassigned', icon: 'assignment_late' },
];

const ICONS = {
  dashboard: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  confirmation_number: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/></svg>,
  person: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  assignment_late: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M12 11v4"/><path d="M9.5 13.5L12 11l2.5 2.5"/></svg>,
};

export default function DevPanel() {
  const location = useLocation();
  const { user, logout } = useUcs();
  const [collapsed, setCollapsed] = useState(false);

  const activeNav = NAV.find(n => location.pathname === n.path || (n.path !== '/dev-panel' && location.pathname.startsWith(n.path)));

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <aside style={{
        width: collapsed ? 56 : 220, flexShrink: 0, background: 'var(--card-bg)', borderRight: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', transition: 'width .2s', overflow: 'hidden',
      }}>
        <div style={{ padding: collapsed ? '16px 12px' : '16px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
            DP
          </div>
          {!collapsed && <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Developer Panel</div>
            <div style={{ fontSize: 9, color: 'var(--ink-soft)' }}>CRM Issue Tracker</div>
          </div>}
        </div>

        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {NAV.map(item => (
            <NavLink key={item.id} to={item.path} end={item.path === '/dev-panel'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '10px 16px' : '10px 18px', fontSize: 12, fontWeight: 500, color: 'var(--ink-soft)', textDecoration: 'none', transition: 'all .12s', borderLeft: '3px solid transparent' }}
              className={({ isActive }) => isActive ? 'nav-active' : '' }>
              <span style={{ flexShrink: 0, display: 'flex' }}>{ICONS[item.icon]}</span>
              {!collapsed && <span>{item.label}</span>}
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
          <button onClick={() => setCollapsed(c => !c)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-soft)', display: 'flex', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{activeNav?.label || 'Developer Panel'}</div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          <ToastProvider>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="tickets" element={<TicketList filter="all" />} />
            <Route path="my-tickets" element={<MyTickets />} />
            <Route path="unassigned" element={<TicketList filter="unassigned" />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="tickets/new" element={<Suspense fallback={<div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-soft)', fontSize: 13 }}>Loading...</div>}><TechnicalTickets panel="dev_panel" /></Suspense>} />
            <Route path="*" element={<Navigate to="/dev-panel" replace />} />
          </Routes>
          </ToastProvider>
        </div>
      </main>
    </div>
  );
}

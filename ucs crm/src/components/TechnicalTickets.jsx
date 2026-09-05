import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/auth';

const AUTO_REFRESH_MS = 30000;

const TICKET_GATE = {
  username: 'jatinsevak@ufs',
  password: 'sevak123',
  sessionKey: 'ucs_ticket_unlocked',
};

const DEPARTMENTS = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'developers', label: 'Developers' },
  { value: 'hr', label: 'HR' },
  { value: 'fro', label: 'FRO' },
];

const CATEGORIES = [
  { value: 'technical', label: 'Technical' },
  { value: 'suspense', label: 'Suspense' },
  { value: 'payment_issue', label: 'Payment Issue' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const STATUS_COLORS = {
  open: { bg: '#fefce8', color: '#a16207' },
  in_progress: { bg: '#eff6ff', color: '#1d4ed8' },
  under_review: { bg: '#faf5ff', color: '#7c3aed' },
  resolved: { bg: '#f0fdf4', color: '#16a34a' },
  closed: { bg: '#f3f4f6', color: '#6b7280' },
  rejected: { bg: '#fef2f2', color: '#dc2626' },
};

const PRIORITY_COLORS = {
  critical: { bg: '#fef2f2', color: '#dc2626' },
  high: { bg: '#fff7ed', color: '#ea580c' },
  medium: { bg: '#fefce8', color: '#a16207' },
  low: { bg: '#f3f4f6', color: '#6b7280' },
};

const apiGet = (p) => api(p, { _prefix: 'ucs' });
const apiPost = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b), _prefix: 'ucs' });

const PANELS = [
  { key: 'event_head', label: 'Event Head', color: '#6366f1' },
  { key: 'ngo_admin',  label: 'NGO Admin',  color: '#0ea5e9' },
  { key: 'recruiter',  label: 'Recruiter',  color: '#8b5cf6' },
  { key: 'fro',        label: 'FRO',        color: '#10b981' },
  { key: 'accounts',   label: 'Accounts',   color: '#f59e0b' },
  { key: 'dev_panel',  label: 'Dev Panel',  color: '#ef4444' },
  { key: 'hr',         label: 'HR',         color: '#14b8a6' },
  { key: 'other',      label: 'Other',      color: '#6b7280' },
];

const PANEL_LABELS = Object.fromEntries(PANELS.map(p => [p.key, p.label]));

function getTicketPanel(t) {
  if (t.raised_by_panel) {
    const p = String(t.raised_by_panel).toLowerCase();
    const hit = PANELS.find(x => x.key === p);
    if (hit) return hit;
  }
  if (t._source === 'developer') return PANELS[5];
  const dept = String(t.workers?.department || t.department || '').toLowerCase();
  if (dept.includes('hr'))       return PANELS[6];
  if (dept.includes('account'))  return PANELS[4];
  if (dept.includes('fro'))      return PANELS[3];
  if (dept.includes('ngo'))      return PANELS[1];
  if (dept.includes('recruit'))  return PANELS[2];
  if (dept.includes('digital') || dept.includes('developer')) return PANELS[5];
  if (dept.includes('event'))    return PANELS[0];
  return PANELS[7];
}

function renderPanel(t) {
  const p = getTicketPanel(t);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>{p.label}</span>
    </span>
  );
}

export default function TechnicalTickets({ panel, viewOnly = false, canRaise = true, requireUnlock = false, category = null }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [gateOpen, setGateOpen] = useState(() => sessionStorage.getItem(TICKET_GATE.sessionKey) === '1');
  const [gateInput, setGateInput] = useState({ username: '', password: '' });
  const [gateError, setGateError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showRaise, setShowRaise] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [form, setForm] = useState({
    department: 'accounts',
    category: 'technical',
    subject: '',
    description: '',
    reference_id: '',
    priority: 'medium',
    desk_number: '',
    ngo: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formErrors, setFormErrors] = useState({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [panelFilter, setPanelFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [deskLoading, setDeskLoading] = useState(false);

  const loadTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const endpoint = viewOnly ? '/tickets' : '/tickets/my';
      const devEndpoint = viewOnly ? '/developer-tickets' : '/developer-tickets/my';
      const [regularTickets, devTickets] = await Promise.all([
        apiGet(endpoint).catch(() => []),
        apiGet(devEndpoint).catch(() => []),
      ]);
      const allTickets = [
        ...(regularTickets || []).map(t => ({ ...t, _source: 'regular' })),
        ...(devTickets || []).map(t => ({ ...t, _source: 'developer' })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setTickets(allTickets);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load tickets:', err);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [viewOnly]);

  useEffect(() => {
    if (requireUnlock && !gateOpen) return;
    loadTickets();
  }, [loadTickets, requireUnlock, gateOpen]);
  useEffect(() => {
    if (requireUnlock && !gateOpen) return;
    const id = setInterval(() => loadTickets(true), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadTickets, requireUnlock, gateOpen]);
  useEffect(() => { setPage(1); }, [tickets.length, statusFilter, search]);

  const unlockSection = (e) => {
    e.preventDefault();
    if (gateInput.username.trim() === TICKET_GATE.username && gateInput.password === TICKET_GATE.password) {
      sessionStorage.setItem(TICKET_GATE.sessionKey, '1');
      setGateOpen(true);
      setGateInput({ username: '', password: '' });
      setGateError('');
    } else {
      setGateError('Invalid username or password');
    }
  };

  const lockSection = () => {
    sessionStorage.removeItem(TICKET_GATE.sessionKey);
    setGateOpen(false);
    setGateInput({ username: '', password: '' });
    setGateError('');
  };

  const fetchMyAsset = async () => {
    setDeskLoading(true);
    try {
      const assets = await apiGet('/assets/my-assigned');
      if (Array.isArray(assets) && assets.length > 0) {
        const desktop = assets.find(a => a.category === 'Desktop' || a.category === 'Laptop') || assets[0];
        if (desktop) {
          setForm(p => ({
            ...p,
            desk_number: p.desk_number || desktop.code || '',
            ngo: p.ngo || desktop.location || '',
          }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch assigned asset:', err);
    } finally {
      setDeskLoading(false);
    }
  };

  const openRaise = () => {
    setForm({
      department: 'accounts',
      category: 'technical',
      subject: '',
      description: '',
      reference_id: '',
      priority: 'medium',
      desk_number: '',
      ngo: '',
    });
    setFormErrors({});
    setShowRaise(true);
    fetchMyAsset();
  };

  const handleRaise = async () => {
    const errs = {};
    if (!form.subject.trim()) errs.subject = 'Subject is required';
    if (!form.desk_number.trim()) errs.desk_number = 'Desk Number is required';
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setFormErrors({});
    setSubmitting(true);
    try {
      if (form.department === 'developers') {
        await apiPost('/developer-tickets', {
          subject: form.subject,
          description: form.description,
          category: form.category,
          priority: form.priority,
          reference_id: form.reference_id,
          raised_by_panel: panel || 'event_head',
          desk_number: form.desk_number || null,
          ngo: form.ngo || null,
        });
      } else {
        await apiPost('/tickets', {
          department: form.department,
          category: form.category,
          subject: form.subject,
          description: form.description,
          reference_id: form.reference_id,
          priority: form.priority,
          desk_number: form.desk_number || null,
          ngo: form.ngo || null,
          raised_by_panel: panel || 'event_head',
        });
      }
      alert('Ticket submitted successfully');
      setShowRaise(false);
      loadTickets();
    } catch (err) {
      setFormErrors({ _general: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = async (ticket) => {
    try {
      const endpoint = ticket._source === 'developer' ? '/developer-tickets' : '/tickets';
      const data = await apiGet(`${endpoint}/${ticket.id}`);
      setShowDetail({ ...data, _source: ticket._source });
      setReplies(data.replies || []);
      setReplyText('');
    } catch (err) { alert(err.message); }
  };

  const handleReply = async () => {
    if (!replyText || !showDetail) return;
    setSendingReply(true);
    try {
      const endpoint = showDetail._source === 'developer' ? '/developer-tickets' : '/tickets';
      await apiPost(`${endpoint}/${showDetail.id}/reply`, { message: replyText });
      setReplyText('');
      const data = await apiGet(`${endpoint}/${showDetail.id}`);
      setReplies(data.replies || []);
    } catch (err) { alert(err.message); }
    finally { setSendingReply(false); }
  };

  const visibleTickets = category ? tickets.filter(t => t.category === category) : tickets;

  const filtered = visibleTickets.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const match = (t.subject || '').toLowerCase().includes(q)
        || (t.description || '').toLowerCase().includes(q)
        || (t.desk_number || '').toLowerCase().includes(q)
        || (t.ngo || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const filteredByPanel = viewOnly && panelFilter !== 'all'
    ? filtered.filter(t => getTicketPanel(t).key === panelFilter)
    : filtered;

  const totalPages = Math.ceil(filteredByPanel.length / pageSize);
  const paginated = filteredByPanel.slice((page - 1) * pageSize, page * pageSize);

  // When in viewOnly mode: active panels (have tickets) for the tab bar,
  // and grouped tickets for the "All" stacked view.
  const activePanels = viewOnly
    ? PANELS.filter(p => filtered.some(t => getTicketPanel(t).key === p.key))
    : [];
  const groupedPanels = viewOnly && panelFilter === 'all'
    ? PANELS.map(p => ({ panel: p, tickets: filtered.filter(t => getTicketPanel(t).key === p.key) })).filter(g => g.tickets.length > 0)
    : [];

  const counts = {
    all: visibleTickets.length,
    open: visibleTickets.filter(t => t.status === 'open').length,
    in_progress: visibleTickets.filter(t => t.status === 'in_progress').length,
    resolved: visibleTickets.filter(t => t.status === 'resolved').length,
    closed: visibleTickets.filter(t => t.status === 'closed').length,
  };

  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatDateTime = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (requireUnlock && !gateOpen) {
    return (
      <div style={{ maxWidth: 420, margin: '40px auto', padding: '28px 24px', background: 'var(--card-bg, #fff)', border: '1px solid var(--line, #e5e7eb)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
          {viewOnly ? 'All Tickets' : 'My Tickets'} Section Locked
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 18, lineHeight: 1.5 }}>
          This section is private. Enter the authorised username and password to view it.
        </div>
        <form onSubmit={unlockSection}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Username</label>
            <input
              value={gateInput.username}
              onChange={e => setGateInput(p => ({ ...p, username: e.target.value }))}
              placeholder="Username"
              autoComplete="username"
              style={{ width: '100%', padding: '9px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 7, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: gateError ? 8 : 14 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Password</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={gateInput.password}
                onChange={e => setGateInput(p => ({ ...p, password: e.target.value }))}
                placeholder="Password"
                autoComplete="current-password"
                style={{ flex: 1, padding: '9px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 7, fontFamily: 'inherit' }}
              />
              <button type="button" onClick={() => setShowPassword(s => !s)}
                style={{ padding: '0 12px', fontSize: 11, border: '1px solid #d1d5db', borderRadius: 7, background: '#fff', cursor: 'pointer', color: '#374151', fontFamily: 'inherit' }}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {gateError && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, background: '#fef2f2', border: '1px solid #fecaca', padding: '7px 10px', borderRadius: 6 }}>{gateError}</div>}
          <button type="submit" className="btn btn-sm btn-primary" style={{ width: '100%' }}>Unlock Section</button>
        </form>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
          {viewOnly ? 'All Tickets' : 'My Tickets'}
          <span style={{ fontWeight: 400, fontSize: 12, color: '#6b7280', marginLeft: 8 }}>({filteredByPanel.length} shown)</span>
          <span style={{ fontWeight: 400, fontSize: 11, color: refreshing ? '#2563eb' : '#16a34a', marginLeft: 10, verticalAlign: 'middle' }}>
            ● {refreshing ? 'Syncing…' : 'Live'} {lastUpdated ? '· ' + lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
        </h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {requireUnlock && (
            <button className="btn btn-sm" onClick={lockSection}
              style={{ border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }}>
              Lock
            </button>
          )}
          {canRaise && !viewOnly && (
            <button className="btn btn-sm btn-primary" onClick={openRaise}>
              + Raise Ticket
            </button>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total', value: counts.all, color: '#1e40af', bg: '#eff6ff' },
          { label: 'Open', value: counts.open, color: '#a16207', bg: '#fefce8' },
          { label: 'In Progress', value: counts.in_progress, color: '#1d4ed8', bg: '#eff6ff' },
          { label: 'Resolved', value: counts.resolved, color: '#16a34a', bg: '#f0fdf4' },
          { label: 'Closed', value: counts.closed, color: '#6b7280', bg: '#f3f4f6' },
        ].map(s => (
          <div key={s.label} style={{ padding: '10px 14px', borderRadius: 8, background: s.bg, border: '1px solid ' + s.color + '22' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: s.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Panel-wise filter (viewOnly / All Tickets only) */}
      {viewOnly && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginRight: 2 }}>Panel:</span>
          <button
            onClick={() => setPanelFilter('all')}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: panelFilter === 'all' ? '#111827' : '#fff',
              color: panelFilter === 'all' ? '#fff' : '#374151',
              boxShadow: '0 1px 2px rgba(0,0,0,.08)', transition: 'all .15s' }}>
            All ({filtered.length})
          </button>
          {activePanels.map(p => {
            const active = panelFilter === p.key;
            const count = filtered.filter(t => getTicketPanel(t).key === p.key).length;
            return (
              <button key={p.key} onClick={() => setPanelFilter(active ? 'all' : p.key)}
                style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: active ? p.color : '#fff',
                  color: active ? '#fff' : '#374151',
                  boxShadow: '0 1px 2px rgba(0,0,0,.08)', transition: 'all .15s' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: active ? '#fff' : p.color, flexShrink: 0 }} />
                {p.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid #d1d5db' }}>
          {['all', 'open', 'in_progress', 'resolved', 'closed'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: statusFilter === s ? '#1e40af' : '#fff',
                color: statusFilter === s ? '#fff' : '#374151',
                textTransform: 'capitalize', transition: 'all .15s' }}>
              {s === 'all' ? 'All' : s.replace('_', ' ')} ({counts[s] || 0})
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search tickets..."
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, flex: '1 1 200px', minWidth: 150 }} />
      </div>

      {/* Ticket List */}
      {viewOnly && panelFilter === 'all' ? (
        /* ═══ PANEL-WISE GROUPED VIEW (All Tickets) ═══ */
        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 13 }}>Loading tickets...</div>
          ) : groupedPanels.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 13 }}>No tickets found</div>
          ) : (
            <>
              {groupedPanels.map(({ panel: p, tickets: ptt }) => (
                <div key={p.key} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{p.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: p.color, background: p.color + '1a', padding: '2px 8px', borderRadius: 999 }}>{ptt.length}</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Subject</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Panel</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Raised By</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Desk #</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>NGO</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Department</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Priority</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px', background: '#fff', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ptt.map(t => (
                          <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 10px', fontWeight: 600, fontSize: 12 }}>{t.subject}</td>
                            <td style={{ padding: '8px 10px' }}>{renderPanel(t)}</td>
                            <td style={{ padding: '8px 10px', fontSize: 12, color: '#4b5563' }}>{t.workers?.name || t.raised_by_name || '—'}</td>
                            <td style={{ padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: '#1e40af' }}>{t.desk_number || '—'}</td>
                            <td style={{ padding: '8px 10px', fontSize: 12, color: '#6b7280' }}>{t.ngo || '—'}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                                background: t._source === 'developer' ? '#eef2ff' : '#f3f4f6',
                                color: t._source === 'developer' ? '#4338ca' : '#374151' }}>
                                {t._source === 'developer' ? 'Dev' : (t.department || '—')}
                              </span>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                                background: PRIORITY_COLORS[t.priority]?.bg || '#f3f4f6',
                                color: PRIORITY_COLORS[t.priority]?.color || '#6b7280' }}>
                                {t.priority}
                              </span>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                                background: STATUS_COLORS[t.status]?.bg || '#f3f4f6',
                                color: STATUS_COLORS[t.status]?.color || '#6b7280' }}>
                                {(t.status || '').replace('_', ' ')}
                              </span>
                            </td>
                            <td style={{ padding: '8px 10px', fontSize: 11, color: '#6b7280' }}>{formatDate(t.created_at)}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <button className="btn btn-sm" onClick={() => openDetail(t)} style={{ fontSize: 11, padding: '3px 10px' }}>View</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>Subject</th>
                {viewOnly && <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>Panel</th>}
                <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>Raised By</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>Desk #</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>NGO</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>Department</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>Priority</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid #d1d5db' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={viewOnly ? 10 : 9} style={{ textAlign: 'center', padding: 30, color: '#9ca3af' }}>Loading tickets...</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={viewOnly ? 10 : 9} style={{ textAlign: 'center', padding: 30, color: '#9ca3af' }}>No tickets found</td></tr>
              ) : (
                paginated.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, fontSize: 12 }}>{t.subject}</td>
                    {viewOnly && <td style={{ padding: '8px 10px' }}>{renderPanel(t)}</td>}
                    <td style={{ padding: '8px 10px', fontSize: 12, color: '#4b5563' }}>{t.workers?.name || t.raised_by_name || '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: '#1e40af' }}>{t.desk_number || '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, color: '#6b7280' }}>{t.ngo || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                        background: t._source === 'developer' ? '#eef2ff' : '#f3f4f6',
                        color: t._source === 'developer' ? '#4338ca' : '#374151' }}>
                        {t._source === 'developer' ? 'Dev' : (t.department || '—')}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                        background: PRIORITY_COLORS[t.priority]?.bg || '#f3f4f6',
                        color: PRIORITY_COLORS[t.priority]?.color || '#6b7280' }}>
                        {t.priority}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                        background: STATUS_COLORS[t.status]?.bg || '#f3f4f6',
                        color: STATUS_COLORS[t.status]?.color || '#6b7280' }}>
                        {(t.status || '').replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 11, color: '#6b7280' }}>{formatDate(t.created_at)}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <button className="btn btn-sm" onClick={() => openDetail(t)} style={{ fontSize: 11, padding: '3px 10px' }}>View</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

        {/* Pagination */}
        {!(viewOnly && panelFilter === 'all') && filteredByPanel.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #e5e7eb', fontSize: 11, color: '#6b7280' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Rows:</span>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 11 }}>
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>Showing {Math.min((page - 1) * pageSize + 1, filteredByPanel.length)}&ndash;{Math.min(page * pageSize, filteredByPanel.length)} of {filteredByPanel.length}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                style={{ padding: '3px 10px', fontSize: 11, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>Prev</button>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{page} / {totalPages || 1}</span>
              <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                style={{ padding: '3px 10px', fontSize: 11, opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
            </div>
          </div>
        )}

      {/* ═══ RAISE TICKET MODAL ═══ */}
      {showRaise && (
        <div className="modal-overlay" onClick={() => setShowRaise(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <div className="modal-head">
              <h3 style={{ margin: 0, fontSize: 15 }}>Raise a Technical Ticket</h3>
              <button className="btn btn-sm btn-icon" onClick={() => setShowRaise(false)} style={{ padding: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{ padding: 16 }}>
              {formErrors._general && (
                <div style={{ padding: '8px 12px', marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>
                  {formErrors._general}
                </div>
              )}

              {/* Auto-filled fields: Desk Number + NGO */}
              <div style={{ padding: '10px 14px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                  {deskLoading ? 'Fetching your asset info...' : 'Auto-filled from Asset Register'}
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                    Desk Number *
                    <input value={form.desk_number} onChange={e => { setForm(p => ({ ...p, desk_number: e.target.value })); if (formErrors.desk_number) setFormErrors(p => { const n = { ...p }; delete n.desk_number; return n; }); }}
                      placeholder="e.g. DESK-1 (AFLF)" style={{ fontSize: 12, ...(formErrors.desk_number ? { borderColor: '#dc2626' } : {}) }} />
                    {formErrors.desk_number && <div style={{ color: '#dc2626', fontSize: 11, marginTop: 3 }}>{formErrors.desk_number}</div>}
                  </label>
                  <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                    NGO
                    <input value={form.ngo} onChange={e => setForm(p => ({ ...p, ngo: e.target.value }))}
                      placeholder="e.g. AFLF Cabin" style={{ fontSize: 12 }} />
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                  Department *
                  <select value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))}>
                    {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                  Category *
                  <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                  Priority
                  <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                  Reference ID (optional)
                  <input value={form.reference_id} onChange={e => setForm(p => ({ ...p, reference_id: e.target.value }))} placeholder="Payment/suspense ID" />
                </label>
              </div>
              <label className="field" style={{ marginBottom: 12 }}>
                Subject *
                <input value={form.subject} onChange={e => { setForm(p => ({ ...p, subject: e.target.value })); if (formErrors.subject) setFormErrors(p => { const n = { ...p }; delete n.subject; return n; }); }}
                  placeholder="Brief title of the issue"
                  style={formErrors.subject ? { borderColor: '#dc2626' } : undefined} />
                {formErrors.subject && <div style={{ color: '#dc2626', fontSize: 11, marginTop: 3 }}>{formErrors.subject}</div>}
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Description
                <div style={{ position: 'relative' }}>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Describe the issue in detail..." maxLength={200} rows={4}
                    style={{ padding: '10px 12px', paddingRight: 56, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
                  <span style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 10, fontWeight: 600, color: form.description.length > 180 ? '#dc2626' : '#9ca3af' }}>
                    {form.description.length}/200
                  </span>
                </div>
              </label>
            </div>
            <div className="modal-foot" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid #e5e7eb' }}>
              <button className="btn" onClick={() => setShowRaise(false)}
                style={{ padding: '8px 20px', color: '#dc2626', border: '1px solid #dc2626', borderRadius: 6, background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRaise} disabled={submitting}
                style={{ padding: '8px 20px', fontSize: 12, borderRadius: 6 }}>
                {submitting ? 'Submitting...' : 'Submit Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TICKET DETAIL MODAL ═══ */}
      {showDetail && (
        <div className="modal-overlay" onClick={() => setShowDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head" style={{ flexShrink: 0 }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>{showDetail.subject}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                    background: STATUS_COLORS[showDetail.status]?.bg || '#f3f4f6', color: STATUS_COLORS[showDetail.status]?.color || '#6b7280' }}>
                    {(showDetail.status || '').replace('_', ' ')}
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                    background: '#f3f4f6', color: '#374151' }}>
                    {showDetail._source === 'developer' ? 'Dev' : showDetail.department}
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                    background: PRIORITY_COLORS[showDetail.priority]?.bg || '#f3f4f6', color: PRIORITY_COLORS[showDetail.priority]?.color || '#6b7280' }}>
                    {showDetail.priority}
                  </span>
                </div>
              </div>
              <button className="btn btn-sm btn-icon" onClick={() => setShowDetail(null)} style={{ padding: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

              {/* Ticket info grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16, padding: '12px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>Desk Number</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', fontFamily: 'monospace' }}>{showDetail.desk_number || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>NGO</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{showDetail.ngo || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>Raised By</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{showDetail.workers?.name || showDetail.raised_by_name || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>Category</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', textTransform: 'capitalize' }}>{CATEGORIES.find(c => c.value === showDetail.category)?.label || showDetail.category}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>Created</div>
                  <div style={{ fontSize: 12, color: '#4b5563' }}>{formatDateTime(showDetail.created_at)}</div>
                </div>
              </div>

              {showDetail.description && (
                <div style={{ padding: '10px 14px', background: '#f9fafb', borderRadius: 8, marginBottom: 16, fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5, border: '1px solid #e5e7eb' }}>
                  {showDetail.description}
                </div>
              )}

              {showDetail.reference_id && (
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
                  Reference: <strong>{showDetail.reference_id}</strong>
                </div>
              )}

              {showDetail.resolution && (
                <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, marginBottom: 16, fontSize: 13, border: '1px solid #bbf7d0' }}>
                  <strong style={{ color: '#16a34a', fontSize: 12 }}>Resolution:</strong>
                  <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{showDetail.resolution}</div>
                </div>
              )}

              {/* Conversation */}
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#1a1a2e' }}>Conversation</div>
                {replies.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: 20 }}>No replies yet</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {replies.map(r => (
                      <div key={r.id} style={{ padding: '10px 14px', background: '#f9fafb', borderRadius: 8, fontSize: 13, border: '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                          {r.sender_panel ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'capitalize', background: '#eef2ff', color: '#4338ca' }}>
                                {PANEL_LABELS[r.sender_panel] || r.sender_panel}
                              </span>
                              {r.sender_name && <span>{r.sender_name}</span>}
                              <span>&middot; {formatDateTime(r.created_at)}</span>
                            </span>
                          ) : (
                            <>{r.sender_type === 'user' ? 'Support' : 'You'} &middot; {formatDateTime(r.created_at)}</>
                          )}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{r.message}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Reply box */}
              {(showDetail.status === 'open' || showDetail.status === 'in_progress') && (
                <div style={{ marginTop: 14, borderTop: '1px solid #e5e7eb', paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Type your reply..."
                      rows={2}
                      style={{ flex: 1, padding: '8px 10px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'inherit', resize: 'vertical' }} />
                    <button className="btn btn-sm btn-primary" onClick={handleReply} disabled={sendingReply || !replyText} style={{ alignSelf: 'flex-end' }}>
                      {sendingReply ? '...' : 'Send'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUcs } from '../../../store';
import { getUnifiedDevTickets, getMyUnifiedTickets, getUnassignedTickets, getDevAssignees, bulkUpdateDevTickets } from '../api/tickets';

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'under_review', label: 'Under Review' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
];

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const CATEGORIES = ['bug', 'feature_request', 'enhancement', 'data_issue', 'payment_issue', 'technical', 'other'];
const PANELS = [
  { value: 'fro', label: 'FRO' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'ngo_admin', label: 'NGO Admin' },
];

const STATUS_COLORS = {
  open: { bg: '#fefce8', color: '#a16207' },
  in_progress: { bg: '#eff6ff', color: '#1d4ed8' },
  under_review: { bg: '#f5f3ff', color: '#7c3aed' },
  resolved: { bg: '#f0fdf4', color: '#16a34a' },
  closed: { bg: '#f3f4f6', color: '#6b7280' },
};
const PRIORITY_COLORS = { low: '#6b7280', medium: '#d97706', high: '#ea580c', critical: '#dc2626' };
const PRIORITY_BG = { low: '#f3f4f6', medium: '#fefce8', high: '#fff7ed', critical: '#fef2f2' };

const PAGE_SIZE = 20;

export default function TicketList({ filter = 'all' }) {
  const navigate = useNavigate();
  const { user } = useUcs();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [panelFilter, setPanelFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [showBulkBar, setShowBulkBar] = useState(false);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkExecuting, setBulkExecuting] = useState(false);

  const loadTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      let data;
      if (filter === 'my') {
        data = await getMyUnifiedTickets();
      } else if (filter === 'unassigned') {
        const all = await getUnifiedDevTickets();
        data = all.filter(t => !t.assigned_to);
      } else {
        const params = {};
        if (statusFilter) params.status = statusFilter;
        if (priorityFilter) params.priority = priorityFilter;
        if (categoryFilter) params.category = categoryFilter;
        if (panelFilter) params.raised_by_panel = panelFilter;
        if (assignedFilter) params.assigned_to = assignedFilter;
        if (search) params.search = search;
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo + 'T23:59:59';
        data = await getUnifiedDevTickets(params);
      }
      setTickets(data || []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
      setTickets([]);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [filter, statusFilter, priorityFilter, categoryFilter, panelFilter, assignedFilter, search, dateFrom, dateTo]);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => {
    const id = setInterval(() => loadTickets(true), 30000);
    return () => clearInterval(id);
  }, [loadTickets]);

  useEffect(() => {
    getDevAssignees().then(setAssignees).catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
    setPage(1);
  }, [statusFilter, priorityFilter, categoryFilter, panelFilter, assignedFilter, search, dateFrom, dateTo, filter]);

  const filteredTickets = tickets;
  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / PAGE_SIZE));
  const pageTickets = filteredTickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === pageTickets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pageTickets.map(t => t.id)));
    }
  };

  const executeBulk = async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    setBulkExecuting(true);
    try {
      const updates = {};
      if (bulkAction === 'status') updates.status = bulkTarget;
      else if (bulkAction === 'priority') updates.priority = bulkTarget;
      else if (bulkAction === 'assign') updates.assigned_to = bulkTarget || null;
      await bulkUpdateDevTickets([...selectedIds], updates);
      setSelectedIds(new Set());
      setBulkAction('');
      setBulkTarget('');
      loadTickets();
    } catch (err) {
      alert(err.message);
    } finally {
      setBulkExecuting(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatSLA = (ticket) => {
    if (!ticket.first_response_at) return { label: 'No response', color: '#dc2626' };
    const mins = (new Date(ticket.first_response_at) - new Date(ticket.created_at)) / 60000;
    if (mins < 60) return { label: `${Math.round(mins)}m`, color: '#16a34a' };
    if (mins < 1440) return { label: `${(mins / 60).toFixed(1)}h`, color: '#d97706' };
    return { label: `${(mins / 1440).toFixed(1)}d`, color: '#dc2626' };
  };

  const getAssignedName = (ticket) => {
    if (ticket.assigned_worker) return ticket.assigned_worker.name || ticket.assigned_worker.login_id || '—';
    if (ticket._source === 'regular') {
      if (ticket.resolved_by && ticket.users) return ticket.users.name || '—';
      return 'Unassigned';
    }
    return 'Unassigned';
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setPriorityFilter('');
    setCategoryFilter('');
    setPanelFilter('');
    setAssignedFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = search || statusFilter || priorityFilter || categoryFilter || panelFilter || assignedFilter || dateFrom || dateTo;

  return (
    <div>
      {/* Status Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '2px solid var(--line)' }}>
        {STATUS_TABS.map(tab => {
          const isActive = (tab.key === '' && filter === 'all' && !statusFilter) || (tab.key === statusFilter && filter === 'all');
          const count = tab.key === '' ? tickets.length : tickets.filter(t => t.status === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => { setStatusFilter(tab.key === statusFilter ? '' : tab.key); }}
              style={{
                padding: '8px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                borderBottom: isActive ? '2px solid #6366f1' : '2px solid transparent',
                marginBottom: -2, background: 'transparent', color: isActive ? '#6366f1' : 'var(--ink-soft)',
                fontFamily: 'inherit', transition: 'all .12s',
              }}
            >
              {tab.label}
              {count > 0 && (
                <span style={{
                  marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px',
                  borderRadius: 10, background: isActive ? '#eef2ff' : 'var(--line)', color: isActive ? '#6366f1' : 'var(--ink-soft)',
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + Filter Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tickets..."
            style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: 12, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', background: 'var(--card-bg)', boxSizing: 'border-box' }}
          />
        </div>

        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={{ padding: '7px 8px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--card-bg)', fontFamily: 'inherit' }}>
          <option value="">All Priority</option>
          {PRIORITIES.map(p => <option key={p} value={p} style={{ textTransform: 'capitalize' }}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </select>

        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ padding: '7px 8px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--card-bg)', fontFamily: 'inherit' }}>
          <option value="">All Category</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
        </select>

        <select value={panelFilter} onChange={e => setPanelFilter(e.target.value)} style={{ padding: '7px 8px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--card-bg)', fontFamily: 'inherit' }}>
          <option value="">All Sources</option>
          {PANELS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        {filter === 'all' && (
          <select value={assignedFilter} onChange={e => setAssignedFilter(e.target.value)} style={{ padding: '7px 8px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--card-bg)', fontFamily: 'inherit' }}>
            <option value="">All Assignees</option>
            <option value="null">Unassigned</option>
            {assignees.map(a => <option key={a.id} value={a.id}>{a.name || a.login_id}</option>)}
          </select>
        )}

        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '6px 8px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--card-bg)', fontFamily: 'inherit' }} title="From date" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '6px 8px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--card-bg)', fontFamily: 'inherit' }} title="To date" />

        {hasFilters && (
          <button onClick={clearFilters} style={{ padding: '6px 10px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontFamily: 'inherit' }}>
            Clear
          </button>
        )}

        <span style={{ fontSize: 11, fontWeight: 600, color: refreshing ? '#2563eb' : '#16a34a', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          ● {refreshing ? 'Syncing…' : 'Live'} {lastUpdated ? '· ' + lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
        <button onClick={loadTickets} style={{ padding: '6px 10px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontFamily: 'inherit' }}>
          Refresh
        </button>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 14px', marginBottom: 12, borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe', fontSize: 12 }}>
          <span style={{ fontWeight: 600, color: '#4338ca' }}>{selectedIds.size} selected</span>
          <select value={bulkAction} onChange={e => { setBulkAction(e.target.value); setBulkTarget(''); }} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #c7d2fe', borderRadius: 6, fontFamily: 'inherit' }}>
            <option value="">Choose action...</option>
            <option value="status">Change Status</option>
            <option value="priority">Change Priority</option>
            <option value="assign">Assign To</option>
          </select>

          {bulkAction === 'status' && (
            <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #c7d2fe', borderRadius: 6, fontFamily: 'inherit' }}>
              <option value="">Select status</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="under_review">Under Review</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          )}
          {bulkAction === 'priority' && (
            <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #c7d2fe', borderRadius: 6, fontFamily: 'inherit' }}>
              <option value="">Select priority</option>
              {PRIORITIES.map(p => <option key={p} value={p} style={{ textTransform: 'capitalize' }}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          )}
          {bulkAction === 'assign' && (
            <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #c7d2fe', borderRadius: 6, fontFamily: 'inherit' }}>
              <option value="">Unassign</option>
              {assignees.map(a => <option key={a.id} value={a.id}>{a.name || a.login_id}</option>)}
            </select>
          )}

          <button
            onClick={executeBulk}
            disabled={!bulkAction || !bulkTarget || bulkExecuting}
            style={{
              padding: '4px 12px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 6,
              background: bulkAction && bulkTarget ? '#4338ca' : '#c7d2fe',
              color: bulkAction && bulkTarget ? '#fff' : '#6b7280',
              cursor: bulkAction && bulkTarget && !bulkExecuting ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
          >
            {bulkExecuting ? 'Applying...' : 'Apply'}
          </button>

          <button onClick={() => { setSelectedIds(new Set()); setBulkAction(''); setBulkTarget(''); }} style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: 11, border: 'none', background: 'transparent', cursor: 'pointer', color: '#4338ca', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--card-bg)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', width: 36 }}>
                  <input
                    type="checkbox"
                    checked={pageTickets.length > 0 && selectedIds.size === pageTickets.length}
                    onChange={toggleSelectAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Subject</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Source</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Category</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Priority</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Status</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Assigned</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>SLA</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Date</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 30, color: 'var(--ink-soft)' }}>Loading tickets...</td></tr>
              ) : pageTickets.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 30, color: 'var(--ink-soft)' }}>No tickets found</td></tr>
              ) : (
                pageTickets.map(t => {
                  const sla = formatSLA(t);
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--line)', background: selectedIds.has(t.id) ? '#f5f3ff' : 'transparent', transition: 'background .1s' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '8px 10px', maxWidth: 260 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</div>
                        {t.reference_id && <div style={{ fontSize: 10, color: 'var(--ink-soft)' }}>Ref: {t.reference_id}</div>}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                          background: t._source === 'developer' ? '#eef2ff' : '#dcfce7',
                          color: t._source === 'developer' ? '#4338ca' : '#166534',
                          textTransform: 'capitalize',
                        }}>
                          {t._source === 'developer' ? 'Dev' : (t.department || 'FRO/Accounts')}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: 11, textTransform: 'capitalize' }}>
                        {(t.category || '—').replace(/_/g, ' ')}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                          background: PRIORITY_BG[t.priority] || '#f3f4f6', color: PRIORITY_COLORS[t.priority] || '#6b7280',
                          textTransform: 'capitalize',
                        }}>
                          {t.priority}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                          background: STATUS_COLORS[t.status]?.bg || '#f3f4f6', color: STATUS_COLORS[t.status]?.color || '#6b7280',
                          textTransform: 'capitalize',
                        }}>
                          {(t.status || '—').replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getAssignedName(t)}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: sla.color }}>{sla.label}</span>
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--ink-soft)' }}>
                        {formatDate(t.created_at)}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <button
                          onClick={() => navigate(`/dev-panel/tickets/${t.id}`, { state: { source: t._source } })}
                          style={{ padding: '3px 10px', fontSize: 11, fontWeight: 500, border: '1px solid var(--line)', borderRadius: 6, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-soft)' }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-soft)' }}>
            <span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, filteredTickets.length)}–{Math.min(page * PAGE_SIZE, filteredTickets.length)} of {filteredTickets.length}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                style={{ padding: '4px 10px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 4, background: 'var(--card-bg)', cursor: page === 1 ? 'default' : 'pointer', fontFamily: 'inherit', opacity: page === 1 ? 0.5 : 1 }}
              >
                Prev
              </button>
              <span style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600 }}>{page}/{totalPages}</span>
              <button
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                style={{ padding: '4px 10px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 4, background: 'var(--card-bg)', cursor: page === totalPages ? 'default' : 'pointer', fontFamily: 'inherit', opacity: page === totalPages ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

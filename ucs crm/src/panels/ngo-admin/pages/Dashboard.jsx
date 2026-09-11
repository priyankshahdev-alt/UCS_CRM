import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Download } from 'lucide-react';
import { apiGet, getFroHourlyPerformance, notifyFro } from '../api/auth';
import { toast } from '../../../components/Toast';
import { SkeletonDashboard } from '../../../components/Skeleton';
import RecentNotices from '../../../components/RecentNotices';

const DISPOSITION_LABELS = {
  pending: 'Pending', contacted: 'Contacted', follow_up: 'Follow Up', scheduled: 'Scheduled',
  busy: 'Busy', ringing: 'Ringing', call_waiting: 'Call Waiting', unreachable: 'Unreachable',
  switched_off: 'Switched Off', out_of_coverage: 'Out of Coverage', wrong_number: 'Wrong Number',
  invalid_number: 'Invalid', rejected: 'Rejected', temporary_network_issue: 'Temporary Network Issue', voicemail: 'Voicemail',
  lead_done: 'Lead Done', done: 'Done', visit_donate: 'Visit & Donate', will_donate_online: 'Will Donate Online',
  promise_to_pay: 'Promise to Pay', payment_pending: 'Payment Pending', already_donated: 'Already Donated',
  email_sent: 'Email Sent', whatsapp_sent: 'WhatsApp Sent', csr_inquiry: 'CSR Inquiry',
  wants_80g_details: 'Wants 80G Details', wants_trust_documents: 'Wants Trust Documents',
  not_interested: 'Not Interested', not_interested_now: 'Not Interested Now', dnd: 'DND',
  wrong_person: 'Wrong Person', call_disconnected: 'Call Disconnected',
  language_barrier: 'Language Barrier', transferred_senior: 'Transferred to Senior',
  query_complaint: 'Query/Complaint', receipt_request: 'Receipt Request',
  donation_collected: 'Lead Done',
  office_program_visit: 'Office / Program Visit',
  promise_pay_wa_email: 'Promise To Pay / WA / Email',
  not_interested_np: 'Not Interested / Disconnected / NP',
  busy_call_waiting: 'Busy / Call Waiting',
  ooc_unreachable_network: 'OOC / Unreachable / Network',
  ringing_voicemail: 'Ringing / Voicemail',
  resolved_suspense: 'Resolved Suspense', others: 'Others',
};

const CONNECTED_STATUS_COLUMNS = [
  { key: 'scheduled', label: 'Follow Up', color: '#16a34a' },
  { key: 'callback', label: 'Callback', color: '#16a34a' },
  { key: 'office_program_visit', label: 'Office / Prog Visit', color: '#16a34a' },
  { key: 'promise_pay_wa_email', label: 'Promise Pay / WA / Email', color: '#16a34a' },
  { key: 'not_interested_np', label: 'Not Inter / Disc / NP', color: '#16a34a' },
  { key: 'dnd', label: 'DND', color: '#16a34a' },
];

const MERGED_STATUS_GROUPS = {
  office_program_visit: ['office_visit_scheduled', 'program_visit_scheduled', 'office_program_visit'],
  promise_pay_wa_email: ['promise_to_pay', 'whatsapp_sent', 'email_sent', 'promise_pay_wa_email'],
  not_interested_np: ['not_interested', 'call_disconnected', 'not_possible', 'not_interested_np'],
  busy_call_waiting: ['busy', 'call_waiting', 'busy_call_waiting'],
  ooc_unreachable_network: ['out_of_coverage', 'unreachable', 'temporary_network_issue', 'ooc_unreachable_network'],
  ringing_voicemail: ['ringing', 'voicemail', 'ringing_voicemail'],
};

const statusMatches = (key, target) =>
  key === target || (MERGED_STATUS_GROUPS[target] || []).includes(key);

const mergedKeyOf = (key) => {
  if (!key) return null;
  if (MERGED_STATUS_GROUPS[key]) return key;
  for (const [group, members] of Object.entries(MERGED_STATUS_GROUPS)) {
    if (members.includes(key)) return group;
  }
  return null;
};

const NOT_CONNECTED_STATUS_COLUMNS = [
  { key: 'switched_off', label: 'Switched Off', color: '#dc2626' },
  { key: 'busy_call_waiting', label: 'Busy / Call Waiting', color: '#dc2626' },
  { key: 'ooc_unreachable_network', label: 'OOC / Unreach / Network', color: '#dc2626' },
  { key: 'ringing_voicemail', label: 'Ringing / Voicemail', color: '#dc2626' },
];

const CONNECTED_IDS = new Set(['contacted', 'lead_done', 'done', 'donation_collected', 'follow_up', 'scheduled', 'callback', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'office_program_visit', 'promise_pay_wa_email', 'not_interested_np', 'office_visit_scheduled', 'program_visit_scheduled', 'not_possible', 'resolved_suspense']);

const NOT_CONNECTED_IDS = new Set(['busy', 'ringing', 'call_waiting', 'unreachable', 'switched_off', 'out_of_coverage', 'wrong_number', 'invalid', 'invalid_number', 'rejected', 'temporary_network_issue', 'voicemail', 'incoming_out', 'busy_call_waiting', 'ooc_unreachable_network', 'ringing_voicemail']);

const DISPOSITION_GROUPS = [
  { label: 'Converted', color: '#16a34a', bg: '#f0fdf4', statuses: ['donation_collected', 'promise_to_pay', 'lead_done', 'done', 'visit_donate', 'will_donate_online', 'payment_pending', 'already_donated', 'promise_pay_wa_email'] },
  { label: 'In Progress', color: '#d97706', bg: '#fffbeb', statuses: ['pending', 'contacted', 'follow_up', 'scheduled', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'office_program_visit'] },
  { label: 'Negative', color: '#dc2626', bg: '#fef2f2', statuses: ['not_interested', 'not_interested_now', 'dnd', 'wrong_person', 'call_disconnected', 'rejected', 'busy', 'ringing', 'call_waiting', 'unreachable', 'switched_off', 'out_of_coverage', 'wrong_number', 'invalid_number', 'temporary_network_issue', 'voicemail', 'language_barrier', 'busy_call_waiting', 'ooc_unreachable_network', 'ringing_voicemail', 'not_interested_np'] },
  { label: 'Other', color: '#5B6B4E', bg: '#f0f2ee', statuses: ['transferred_senior', 'query_complaint', 'receipt_request'] },
];

const PER_PAGE = 50;

const toIstDate = (d = new Date()) =>
  new Date(new Date(d).getTime() + ((5 * 60) + 30) * 60000).toISOString().slice(0, 10);

const PERIOD_LABELS = { today: 'Today', weekly: 'This Week', monthly: 'This Month', custom: 'Custom Range' };

const SCORE_WEIGHTS = [
  { label: 'Collection', weight: '35%', color: '#16a34a', bg: '#f0fdf4' },
  { label: 'Leads', weight: '30%', color: '#2563eb', bg: '#eff6ff' },
  { label: 'Talk Time', weight: '17.5%', color: '#9333ea', bg: '#faf5ff' },
  { label: 'Data Used', weight: '17.5%', color: '#0d9488', bg: '#f0fdfa' },
];

const ScoreFormulaLegend = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '6px 10px', borderBottom: '1px solid var(--line)', fontSize: 9, color: 'var(--ink-soft)' }}>
    <span style={{ fontWeight: 700 }}>Score&nbsp;=</span>
    {SCORE_WEIGHTS.map((w, i) => (
      <span key={w.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {i > 0 && <span>+</span>}
        <span style={{ background: w.bg, color: w.color, fontWeight: 700, padding: '2px 6px', borderRadius: 999, whiteSpace: 'nowrap', border: `1px solid ${w.color}22` }}>{w.label} {w.weight}</span>
      </span>
    ))}
  </div>
);

const NGO_TABS = [
  ['', 'All'],
  ['bsct', 'BSCT'],
  ['aflf', 'AFLF'],
  ['mann', 'MANN'],
];

const NGO_COLORS = { bsct: '#2563eb', mann: '#ec4899', aflf: '#8b5cf6' };
const ngoColorOf = (name) => {
  const hit = NGO_TABS.find(([c]) => c && (name || '').toLowerCase().includes(c));
  return hit ? (NGO_COLORS[hit[0]] || '#6366f1') : '#6366f1';
};
const ngoSortRank = (name) => {
  const hit = NGO_TABS.find(([c]) => c && (name || '').toLowerCase().includes(c));
  return hit ? NGO_TABS.indexOf(hit) : 99;
};

function StationDetailModal({ station, stats, stationInfo, onClose }) {
  const [donors, setDonors] = useState([]);
  const [loadingDonors, setLoadingDonors] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  if (!station) return null;
  const total = Object.values(stats || {}).reduce((t, v) => t + v, 0);
  const groupData = DISPOSITION_GROUPS.map(g => ({
    ...g, total: g.statuses.reduce((t, s) => t + (stats?.[s] || 0), 0),
  })).filter(g => g.total > 0);
  const allStatuses = DISPOSITION_GROUPS.flatMap(g =>
    g.statuses.filter(s => (stats?.[s] || 0) > 0).map(s => ({ status: s, count: stats[s], group: g }))
  );

  const donorsRef = useRef(null);
  const fetchDonors = useCallback(async (status) => {
    if (donorsRef.current) donorsRef.current.abort();
    const controller = new AbortController();
    donorsRef.current = controller;
    setLoadingDonors(true);
    setStatusFilter(status || '');
    try {
      const params = new URLSearchParams({ station });
      if (status) params.set('status', status);
      const data = await apiGet(`/ngo-admin/donors-by-station?${params}`, { signal: controller.signal, timeout: 30000 });
      if (!controller.signal.aborted) {
        setDonors(data || []);
        setPage(1);
      }
    } catch {
      if (!controller.signal.aborted) setDonors([]);
    } finally {
      if (!controller.signal.aborted) setLoadingDonors(false);
    }
  }, [station]);

  const filtered = useMemo(() => {
    if (!search) return donors;
    const q = search.toLowerCase();
    return donors.filter(d =>
      (d.donor_name && d.donor_name.toLowerCase().includes(q)) ||
      (d.donor_mobile && d.donor_mobile.includes(q)) ||
      (d.donor_city && d.donor_city.toLowerCase().includes(q)) ||
      (d.fro_name && d.fro_name.toLowerCase().includes(q))
    );
  }, [donors, search]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated = useMemo(() => {
    const start = (page - 1) * PER_PAGE;
    return filtered.slice(start, start + PER_PAGE);
  }, [filtered, page]);

  useEffect(() => { setPage(1); }, [search]);

  const handleStatusClick = (status) => {
    if (statusFilter === status) {
      setStatusFilter('');
      setDonors([]);
    } else {
      fetchDonors(status);
    }
  };

  const handleClear = () => {
    setDonors([]);
    setStatusFilter('');
    setSearch('');
    setPage(1);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{station}</h3>
            {stationInfo?.fro_worker_name && (
              <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500, background: 'var(--bg)', padding: '2px 10px', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                {stationInfo.fro_worker_name}
              </span>
            )}
            <span style={{ fontSize: 12, background: 'var(--sage)', color: '#fff', padding: '2px 10px', borderRadius: 12, fontWeight: 600 }}>
              {total} donors
            </span>
            {stationInfo?.ngos?.map(n => (
              <span key={n.ngo_id || n.ngo_name} style={{ fontSize: 11, background: '#eef2ff', color: '#6366f1', padding: '2px 8px', borderRadius: 12 }}>
                {n.ngo_name}
              </span>
            ))}
          </div>
          <button className="btn btn-sm btn-outline" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {groupData.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ height: 8, borderRadius: 4, background: '#e5e7eb', display: 'flex', overflow: 'hidden' }}>
                {groupData.map(g => (
                  <div key={g.label} style={{ width: `${(g.total / total) * 100}%`, height: '100%', background: g.color, opacity: 0.6 }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                {groupData.map(g => (
                  <span key={g.label} style={{ fontSize: 11, fontWeight: 600, color: g.color, background: g.bg, padding: '2px 10px', borderRadius: 10 }}>
                    {g.label}: {g.total}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Disposition Breakdown
            {statusFilter && (
              <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                — click a status to view donors
              </span>
            )}
          </div>

          {allStatuses.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
              {allStatuses.map(({ status, count, group }) => (
                <button key={status} onClick={() => handleStatusClick(status)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 10px', borderRadius: 20, border: `1px solid ${statusFilter === status ? group.color : 'transparent'}`,
                    background: statusFilter === status ? group.bg : 'var(--bg)',
                    cursor: 'pointer', fontSize: 12, fontWeight: statusFilter === status ? 700 : 500,
                    color: statusFilter === status ? group.color : 'var(--ink-soft)',
                    transition: 'all .15s',
                  }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: group.color, flexShrink: 0 }} />
                  {DISPOSITION_LABELS[status] || status}
                  <span style={{ fontWeight: 700, color: group.color, marginLeft: 2 }}>{count}</span>
                </button>
              ))}
            </div>
          )}

          {!statusFilter && !donors.length && (
            <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>
              Click a disposition above to view donor list for that status.
            </div>
          )}

          {(statusFilter || donors.length > 0) && (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 4 }}>
              <div className="filter-bar" style={{ marginBottom: 12 }}>
                <input placeholder="Search name, phone, city..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
                {statusFilter && (
                  <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: '#f0f2ee', color: 'var(--ink-soft)', fontWeight: 500 }}>
                    {DISPOSITION_LABELS[statusFilter] || statusFilter}
                  </span>
                )}
                <span className="count">{loadingDonors ? 'Loading...' : `${filtered.length} donors`}</span>
                {donors.length > 0 && (
                  <button className="btn btn-sm btn-outline" onClick={handleClear}>Clear</button>
                )}
              </div>

              {loadingDonors ? (
                <div className="loading" style={{ padding: 20 }}>Loading donors...</div>
              ) : paginated.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Phone</th>
                        <th>City</th>
                        <th>FRO</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map(d => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 500 }}>{d.donor_name || '—'}</td>
                          <td>{d.donor_mobile || '—'}</td>
                          <td>{d.donor_city || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{d.fro_name || 'Unassigned'}</td>
                          <td><span className="pill" style={{
                            background: (() => { const g = DISPOSITION_GROUPS.find(gr => gr.statuses.includes(d.status)); return g ? g.bg : '#f3f4f6'; })(),
                            color: (() => { const g = DISPOSITION_GROUPS.find(gr => gr.statuses.includes(d.status)); return g ? g.color : '#6b7280'; })(),
                          }}>{DISPOSITION_LABELS[d.status] || d.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>
                  No donors match this filter.
                </div>
              )}

              {totalPages > 1 && !loadingDonors && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0 4px' }}>
                  <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                    Previous
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                    <button key={p} className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPage(p)} style={{ minWidth: 32 }}>
                      {p}
                    </button>
                  ))}
                  <button className="btn btn-sm btn-outline" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CollectionDetailModal({ period: defaultPeriod, totalAmount, onClose, status, monthAmount, monthCount, todayAmount, todayCount }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState(defaultPeriod || 'month');

  const isVerification = status === 'verified' || status === 'unverified';
  const label = status === 'verified' ? 'Verified' : status === 'unverified' ? 'Unverified' : 'Collection';

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const url = isVerification
      ? `/ngo-admin/verification?status=${status}&period=${period}`
      : `/ngo-admin/collections/fro-wise?period=${period}`;
    apiGet(url, { signal: controller.signal, timeout: 30000 })
      .then(data => { if (!controller.signal.aborted) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (!controller.signal.aborted) setRows([]); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, status, isVerification]);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(r => (r.fro_name || '').toLowerCase().includes(q));
  }, [rows, search]);

  const isMonth = period === 'month';
  const now = new Date();
  const dateTitle = isMonth
    ? now.toLocaleString('en-US', { month: 'long', year: 'numeric' })
    : `Today – ${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const title = isVerification ? `${label} Collections — ${dateTitle}` : dateTitle;

  const displayAmount = isVerification
    ? (period === 'month' ? (monthAmount || 0) : (todayAmount || 0))
    : rows.reduce((s, r) => s + (r.collection_amount || 0), 0);
  const totalLeads = rows.reduce((s, r) => s + (r.count || 0), 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 500 }}>
              {rows.length} FRO{rows.length !== 1 ? 's' : ''}
            </span>
            <button className="btn btn-sm btn-outline" onClick={onClose} style={{ width: 28, height: 28, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        </div>
        <div className="modal-body" style={{ padding: '14px 18px' }}>
          {loading ? (
            <div className="loading" style={{ padding: 20 }}>Loading...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>
              No {label.toLowerCase()} collection data available.
            </div>
          ) : (
            <>
              {isVerification && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  <button onClick={() => setPeriod('month')} style={{
                    padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: period === 'month' ? '1.5px solid var(--sage)' : '1px solid var(--line)',
                    background: period === 'month' ? '#f0fdf4' : 'transparent',
                    color: period === 'month' ? 'var(--sage)' : 'var(--ink-soft)',
                  }}>Month</button>
                  <button onClick={() => setPeriod('today')} style={{
                    padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: period === 'today' ? '1.5px solid #f59e0b' : '1px solid var(--line)',
                    background: period === 'today' ? '#fffbeb' : 'transparent',
                    color: period === 'today' ? '#b45309' : 'var(--ink-soft)',
                  }}>Today</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="Search FRO name..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{
                    flex: 1, padding: '7px 10px', border: '1px solid var(--line)',
                    borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none',
                    background: 'var(--bg)', color: 'var(--ink)',
                  }}
                />
                {search && (
                  <button onClick={() => setSearch('')} className="btn btn-sm btn-outline">Clear</button>
                )}
              </div>
              {search && (
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 8 }}>
                  Showing {filtered.length} of {rows.length} FRO{rows.length !== 1 ? 's' : ''}
                </div>
              )}

              <div style={{ overflowX: 'auto', maxHeight: '50vh', overflowY: 'auto', borderRadius: 6, border: '1px solid var(--line)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)', padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--line)' }}>
                        FRO Name
                      </th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)', padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--line)' }}>
                        {isVerification ? 'Amount (₹)' : 'Collection (₹)'}
                      </th>
                      {isVerification && (
                        <th style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)', padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--line)' }}>
                          Leads
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => {
                      const val = isVerification ? r.amount : r.collection_amount;
                      return (
                        <tr key={r.fro_id} style={{ borderBottom: '1px solid var(--line)', transition: 'background .1s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}
                        >
                          <td style={{ padding: '8px 10px', fontWeight: 500 }}>{r.fro_name}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: val > 0 ? 'var(--sage)' : '#9ca3af' }}>
                            ₹{Number(val).toLocaleString('en-IN')}
                            {!isVerification && r.is_achieved && (
                              <span style={{ fontSize: 9, color: '#8b5cf6', fontWeight: 500, marginLeft: 4, verticalAlign: 'middle' }}>(set)</span>
                            )}
                          </td>
                          {isVerification && (
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 500, color: 'var(--ink-soft)' }}>
                              {r.count || 0}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={isVerification ? 3 : 2} style={{ padding: 16, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 12 }}>
                          No FROs match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ padding: '10px', fontWeight: 700, borderTop: '2px solid var(--line)', fontSize: 13 }}>Total</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--line)', color: 'var(--sage)', fontSize: 13 }}>
                        ₹{displayAmount.toLocaleString('en-IN')}
                      </td>
                      {isVerification && (
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--line)', color: 'var(--ink-soft)', fontSize: 13 }}>
                          {totalLeads}
                        </td>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const FOLLOWUP_TAB_LABELS = {
  overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', future: 'Future',
  week: 'This Week', month: 'This Month',
};

const FOLLOWUP_BUCKETS = [
  { key: 'overdue', label: 'Overdue', color: '#dc2626' },
  { key: 'today', label: 'Today', color: '#ea580c' },
  { key: 'tomorrow', label: 'Tomorrow', color: '#2563eb' },
  { key: 'future', label: 'Future', color: '#6b7280' },
  { key: 'week', label: 'This Week', color: '#5B6B4E' },
  { key: 'month', label: 'This Month', color: '#7c3aed' },
];

function buildWorkerSummary(rows, todayIst = toIstDate()) {
  const map = {};
  for (const r of rows) {
    const key = r.fro_worker_id || r.telecaller || 'Unknown';
    if (!map[key]) map[key] = { key, telecaller: r.telecaller || 'Unknown', callback: 0, follow_up: 0, overdue: 0, rows: [] };
    map[key][r.type === 'callback' ? 'callback' : 'follow_up']++;
    const fd = r.followup_date ? String(r.followup_date).slice(0, 10) : null;
    if (fd && fd < todayIst) map[key].overdue++;
    map[key].rows.push(r);
  }
  const list = Object.values(map).map(x => ({ ...x, total: x.callback + x.follow_up }));
  // Laziest first: most overdue on top, then busiest — so slackers are instantly visible.
  list.sort((a, b) => b.overdue - a.overdue || b.total - a.total || a.telecaller.localeCompare(b.telecaller));
  return list;
}

function FollowupSummaryTable({ summary, onSelect, hint }) {
  const tCall = summary.reduce((s, w) => s + w.callback, 0);
  const tFup = summary.reduce((s, w) => s + w.follow_up, 0);
  const tOver = summary.reduce((s, w) => s + w.overdue, 0);
  const tTotal = summary.reduce((s, w) => s + w.total, 0);
  const cnt = (v, color) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, animation: 'countPop .3s ease-out', fontWeight: 700, color: v > 0 ? color : 'var(--ink-soft)' }}>
      <AnimatedNumber value={v} />
    </span>
  );
  return (
    <div>
      <style>{`@keyframes countPop { 0% { transform: scale(.55); opacity: .3; } 60% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }`}</style>
      <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {[['#', 'center', 34], ['Telecaller', 'left', null], ['Callback', 'center', null], ['Follow-up', 'center', null], ['Overdue', 'center', null], ['Total', 'center', null]].map(([h, align, w]) => (
                <th key={h} style={{ padding: '8px 10px', textAlign: align, fontSize: 10, textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 600, borderBottom: '2px solid var(--line)', position: 'sticky', top: 0, background: 'var(--bg, #fff)', zIndex: 2, ...(w ? { width: w } : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.map((w, i) => {
              const overPct = Math.min((w.overdue / Math.max(w.total, 1)) * 100, 100);
              return (
                <tr key={w.key} onClick={() => onSelect(w)} style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', animationDelay: `${Math.min(i, 10) * 25}ms` }} title="Click to view donors"
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: w.overdue > 0 ? (i < 3 ? '#dc2626' : '#b91c1c') : 'var(--ink-soft)' }}>
                    {w.overdue > 0 ? `!${i + 1}` : i + 1}
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{w.telecaller}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{cnt(w.callback, '#16a34a')}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{cnt(w.follow_up, '#ea580c')}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      {cnt(w.overdue, '#dc2626')}
                      {w.overdue > 0 && (
                        <div style={{ width: 54, height: 4, borderRadius: 2, background: 'var(--line)', overflow: 'hidden' }} title={`${Math.round(overPct)}% of their follow-ups are overdue`}>
                          <div style={{ width: `${Math.max(overPct, 8)}%`, height: '100%', background: '#dc2626', borderRadius: 2 }} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700 }}>{cnt(w.total, 'var(--ink)')}</td>
                </tr>
              );
            })}
            <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)', fontWeight: 700, position: 'sticky', bottom: 0 }}>
              <td style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'center' }}>Σ</td>
              <td style={{ padding: '8px 10px', fontWeight: 700 }}>TOTAL</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#16a34a' }}>{tCall}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#ea580c' }}>{tFup}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#dc2626' }}>{tOver}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700 }}>{tTotal}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, color: 'var(--ink-soft)' }}>{hint || 'Click a telecaller to view donors — sorted by most overdue first'}</div>
    </div>
  );
}

function FollowupDetailModal({ worker, label, onClose }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  if (!worker) return null;

  const rows = worker.rows || [];
  const callbackCount = rows.filter(r => r.type === 'callback').length;
  const followupCount = rows.length - callbackCount;

  const todayIst = toIstDate();
  const isOverdueRow = (r) => {
    const fd = r.followup_date ? String(r.followup_date).slice(0, 10) : null;
    return !!(fd && fd < todayIst);
  };
  const overdueCount = rows.filter(isOverdueRow).length;
  const sortedRows = [...rows].sort((a, b) => Number(isOverdueRow(b)) - Number(isOverdueRow(a)));

  const typePill = (type) => ({
    padding: '2px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700, display: 'inline-flex',
    textTransform: 'uppercase', letterSpacing: '0.04em',
    background: type === 'callback' ? '#f0fdf4' : '#fff7ed',
    color: type === 'callback' ? '#16a34a' : '#ea580c',
  });

  const fmtTime = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>{worker.telecaller}</h3>
            <span style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 500, background: 'var(--bg)', padding: '2px 10px', borderRadius: 12 }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#ea580c', background: '#fff7ed', padding: '2px 10px', borderRadius: 12 }}>
              {followupCount} Follow-up{followupCount !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', background: '#f0fdf4', padding: '2px 10px', borderRadius: 12 }}>
              {callbackCount} Callback{callbackCount !== 1 ? 's' : ''}
            </span>
            {overdueCount > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', background: '#fee2e2', padding: '2px 10px', borderRadius: 12 }}>
                {overdueCount} Overdue{overdueCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button aria-label="Close" onClick={onClose} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1 }}>✕</button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: '14px 18px' }}>
          {rows.length === 0 ? (
            <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>No records for this telecaller in {label}.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {[['Donor', 'left'], ['Mobile', 'left'], ['Type', 'left'], ['Date', 'center'], ['Scheduled', 'center']].map(([h, align]) => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: align, fontSize: 10, textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 600, borderBottom: '1px solid var(--line)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(r => (
                    <tr key={r.assignment_id || r.assignmentId} style={{ borderBottom: '1px solid var(--line)', background: isOverdueRow(r) ? '#fff7f7' : undefined }}>
                      <td style={{ padding: '8px 10px', fontWeight: 500 }}>{r.donor_name || '—'}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--ink-soft)' }}>{r.mobile || '—'}</td>
                      <td style={{ padding: '8px 10px' }}><span style={typePill(r.type)}>{r.type === 'callback' ? 'Callback' : 'Follow-up'}</span></td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11 }}>
                        {isOverdueRow(r) ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#dc2626', fontWeight: 700 }}>
                            {r.followup_date ? String(r.followup_date).slice(0, 10) : '—'}
                            <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: '#fee2e2', color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Overdue</span>
                          </span>
                        ) : (r.followup_date ? String(r.followup_date).slice(0, 10) : '—')}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11 }}>{fmtTime(r.scheduled_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(null);
  useEffect(() => {
    const to = Number(value) || 0;
    if (prevRef.current === null) {
      prevRef.current = to;
      setDisplay(to);
      return;
    }
    const from = prevRef.current;
    if (from === to) { setDisplay(to); return; }
    const start = performance.now();
    const dur = 450;
    let raf;
    const tick = (t) => {
      const p = Math.min((t - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); prevRef.current = to; };
  }, [value]);
  return display.toLocaleString('en-IN');
}

const FRO_STATUS_META = {
  on_call: { label: 'Calling', dot: '#16a34a', name: '#15803d' },
  online: { label: 'Online', dot: '#16a34a', name: '#15803d' },
  idle: { label: 'Idle', dot: '#f59e0b', name: '#d97706' },
  offline: { label: 'Offline', dot: '#dc2626', name: null },
};

function FroDetailModal({ froId, froName, filterType, rangeFrom, rangeTo, status, onClose }) {
  const [allDonors, setAllDonors] = useState([]);
  const [loadingDonors, setLoadingDonors] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(status || '');
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    if (!froId) return;
    setLoadingDonors(true);
    apiGet(`/ngo-admin/donors-by-fro?fro_worker_id=${froId}&from=${rangeFrom || ''}&to=${rangeTo || ''}`)
      .then(data => setAllDonors(data || []))
      .catch(() => setAllDonors([]))
      .finally(() => setLoadingDonors(false));
  }, [froId, rangeFrom, rangeTo]);

  const isNonConnected = filterType === 'non_connected';
  const filterColor = isNonConnected ? '#dc2626' : '#16a34a';
  const filterBg = isNonConnected ? '#fef2f2' : '#f0fdf4';
  const filterLabel = status ? (DISPOSITION_LABELS[status] || status) : (isNonConnected ? 'Non-Connected' : 'Connected');

  const hasPeriodData = Boolean(rangeFrom || rangeTo);

  const stack = isNonConnected ? NOT_CONNECTED_STATUS_COLUMNS : CONNECTED_STATUS_COLUMNS;

  const baseList = useMemo(() => {
    const getKey = (d) => hasPeriodData && d.call_status ? d.call_status : d.status;
    const deduped = [];
    const seenDonors = new Set();
    for (const d of allDonors) {
      if (d.donor_id && seenDonors.has(d.donor_id)) continue;
      if (d.donor_id) seenDonors.add(d.donor_id);
      deduped.push(d);
    }
    if (status) return deduped.filter(d => statusMatches(getKey(d), status));
    const sideOf = (d) => {
      const k = getKey(d);
      if (NOT_CONNECTED_IDS.has(k)) return 'not_connected';
      if (CONNECTED_IDS.has(k)) return 'connected';
      if (hasPeriodData && d.call_category) return String(d.call_category).toLowerCase();
      return null;
    };
    if (isNonConnected) return deduped.filter(d => sideOf(d) === 'not_connected');
    return deduped.filter(d => sideOf(d) === 'connected');
  }, [allDonors, isNonConnected, hasPeriodData, status]);

  const total = baseList.length;

  const stackCounts = useMemo(() => {
    const counts = {};
    let others = 0;
    for (const d of baseList) {
      const key = hasPeriodData && d.call_status ? d.call_status : d.status;
      const mk = mergedKeyOf(key);
      if (mk && stack.some(c => c.key === mk)) counts[mk] = (counts[mk] || 0) + 1;
      else others++;
    }
    const chips = stack.map(c => ({ ...c, count: counts[c.key] || 0 })).filter(c => c.count > 0);
    if (others > 0) chips.push({ key: 'others', label: 'Others', color: '#5B6B4E', count: others });
    return chips;
  }, [baseList, hasPeriodData, stack]);

  const donorsRef = useRef(null);
  const fetchDonors = useCallback(async (status) => {
    if (donorsRef.current) donorsRef.current.abort();
    const controller = new AbortController();
    donorsRef.current = controller;
    setStatusFilter(status || '');
    setPage(1);
    try {
      const params = new URLSearchParams({ fro_worker_id: froId });
      if (rangeFrom) params.set('from', rangeFrom);
      if (rangeTo) params.set('to', rangeTo);
      if (status) params.set('status', status);
      const data = await apiGet(`/ngo-admin/donors-by-fro?${params}`, { signal: controller.signal, timeout: 30000 });
      if (!controller.signal.aborted) setAllDonors(data || []);
    } catch {
      if (!controller.signal.aborted) setAllDonors([]);
    }
  }, [froId, rangeFrom, rangeTo]);

  const filtered = useMemo(() => {
    let list = baseList;
    if (statusFilter) {
      list = list.filter(d => {
        const key = hasPeriodData && d.call_status ? d.call_status : d.status;
        if (statusFilter === 'others') {
          const mk = mergedKeyOf(key);
          return !mk || !stack.some(c => c.key === mk);
        }
        return statusMatches(key, statusFilter);
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        (d.donor_name && d.donor_name.toLowerCase().includes(q)) ||
        (d.donor_mobile && d.donor_mobile.includes(q)) ||
        (d.station && d.station.toLowerCase().includes(q))
      );
    }
    return list;
  }, [baseList, statusFilter, search, stack]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated = useMemo(() => {
    const start = (page - 1) * PER_PAGE;
    return filtered.slice(start, start + PER_PAGE);
  }, [filtered, page]);

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const handleStatusClick = (status) => {
    setStatusFilter(prev => prev === status ? '' : status);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{froName}</h3>
            <span style={{ fontSize: 12, fontWeight: 600, color: filterColor, background: filterBg, padding: '2px 10px', borderRadius: 12 }}>
              {total} {filterLabel}
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>of {allDonors.length} total</span>
          </div>
          <button className="btn btn-sm btn-outline" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
          {loadingDonors ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>Loading donors...</div>
          ) : total === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>No {filterLabel.toLowerCase()} donors found</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Disposition Breakdown
                <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  — click a status to view donors
                </span>
              </div>

              {stackCounts.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
                  {stackCounts.map(({ key, label, color, count }) => (
                    <button key={key} onClick={() => handleStatusClick(key)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 10px', borderRadius: 20, border: `1px solid ${statusFilter === key ? color : 'transparent'}`,
                        background: statusFilter === key ? `${color}1a` : 'var(--bg)',
                        cursor: 'pointer', fontSize: 12, fontWeight: statusFilter === key ? 700 : 500,
                        color: statusFilter === key ? color : 'var(--ink-soft)',
                        transition: 'all .15s',
                      }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      {label}
                      <span style={{ fontWeight: 700, color, marginLeft: 2 }}>{count}</span>
                    </button>
                  ))}
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 4 }}>
                <div className="filter-bar" style={{ marginBottom: 12 }}>
                  <input placeholder="Search name, phone, station..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
                  {statusFilter && (
                    <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: '#f0f2ee', color: 'var(--ink-soft)', fontWeight: 500 }}>
                      {DISPOSITION_LABELS[statusFilter] || statusFilter}
                    </span>
                  )}
                  <span className="count">{loadingDonors ? 'Loading...' : `${filtered.length} donors`}</span>
                  {statusFilter && (
                    <button className="btn btn-sm btn-outline" onClick={() => { setStatusFilter(''); setSearch(''); setPage(1); }}>Clear</button>
                  )}
                </div>

                {paginated.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Name</th>
                          <th>Phone</th>
                          <th>Station</th>
                          <th>Status</th>
                          {statusFilter === 'others' && <th>Remark</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.map((d, i) => {
                          const displayStatus = hasPeriodData && d.call_status ? d.call_status : d.status;
                          const mk = mergedKeyOf(displayStatus);
                          const col = mk ? [...CONNECTED_STATUS_COLUMNS, ...NOT_CONNECTED_STATUS_COLUMNS].find(c => c.key === mk) : null;
                          const pillColor = col ? col.color : '#6b7280';
                          return (
                            <tr key={d.id || d.donor_id}>
                              <td style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{(page - 1) * PER_PAGE + i + 1}</td>
                              <td style={{ fontWeight: 500 }}>
                                {d.donor_name || '—'}
                                {d.owner_name && froName && String(d.owner_name).trim().toLowerCase() !== String(froName).trim().toLowerCase() && (
                                  <span title={`Assignment owned by ${d.owner_name} — worked via Work-As`} style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }}>via {d.owner_name}</span>
                                )}
                              </td>
                              <td>{d.donor_mobile || '—'}</td>
                              <td style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{d.station || '—'}</td>
                              <td><span className="pill" style={{
                                background: `${pillColor}1a`,
                                color: pillColor,
                              }}>{DISPOSITION_LABELS[mk || displayStatus] || displayStatus}</span></td>
                              {statusFilter === 'others' && (
                                <td style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{d.call_remark || d.notes || '—'}</td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>
                    No donors match this filter.
                  </div>
                )}

                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0 4px' }}>
                    <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                      Previous
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      const p = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                      return (
                        <button key={p} className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPage(p)} style={{ minWidth: 32 }}>
                          {p}
                        </button>
                      );
                    })}
                    <button className="btn btn-sm btn-outline" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                      Next
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [stationStats, setStationStats] = useState(null);
  const [stationsData, setStationsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [selectedNgoId, setSelectedNgoId] = useState('all');
  const [ngoTab, setNgoTab] = useState('');
  const [dashPeriod, setDashPeriod] = useState('today');
  const [customFrom, setCustomFrom] = useState(() => toIstDate());
  const [customTo, setCustomTo] = useState(() => toIstDate());
  const [selectedFroId, setSelectedFroId] = useState('');
  const [accessibleNgos, setAccessibleNgos] = useState([]);
  const [weakPerformers, setWeakPerformers] = useState([]);
  const [weakLoading, setWeakLoading] = useState(false);
  const [showAllLowPerformers, setShowAllLowPerformers] = useState(false);
  const [showAllTopPerformers, setShowAllTopPerformers] = useState(false);
  const [froSearch, setFroSearch] = useState('');
  const [perfTab, setPerfTab] = useState('connected');
  const [selectedFro, setSelectedFro] = useState(null);
  const [hourlyExportFrom, setHourlyExportFrom] = useState(() => toIstDate());
  const [hourlyExportTo, setHourlyExportTo] = useState(() => toIstDate());
  const [froHourlyData, setFroHourlyData] = useState([]);
  const [hourlyDate, setHourlyDate] = useState(() => toIstDate());
  const [hourlyList, setHourlyList] = useState([]);
  const [hourlyFroRows, setHourlyFroRows] = useState([]);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [showAllIdleAlerts, setShowAllIdleAlerts] = useState(false);

  // Global date range (derived from the header filter) used by the table & exports
  const activeRange = useMemo(() => {
    const now = new Date();
    if (dashPeriod === 'today') return { from: toIstDate(), to: toIstDate() };
    if (dashPeriod === 'weekly') {
      const s = new Date(now); s.setDate(now.getDate() - now.getDay());
      return { from: toIstDate(s), to: toIstDate(now) };
    }
    if (dashPeriod === 'monthly') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toIstDate(s), to: toIstDate(now) };
    }
    return { from: customFrom, to: customTo };
  }, [dashPeriod, customFrom, customTo]);

  // Auto-update hourly export date range from the global header filter
  useEffect(() => {
    if (activeRange.from) setHourlyExportFrom(activeRange.from);
    if (activeRange.to) setHourlyExportTo(activeRange.to);
  }, [activeRange]);

  // Collapse expanded performer lists when the global filter or NGO tab changes
  useEffect(() => {
    setShowAllTopPerformers(false);
    setShowAllLowPerformers(false);
  }, [activeRange, selectedNgoId]);

  // Fetch FRO-level hourly performance when date range or NGO changes
  useEffect(() => {
    let cancelled = false;
    getFroHourlyPerformance({ from: hourlyExportFrom, to: hourlyExportTo, ...(selectedNgoId !== 'all' ? { ngo_id: selectedNgoId } : {}) })
      .then(data => { if (!cancelled) setFroHourlyData(data || []); })
      .catch(() => { if (!cancelled) setFroHourlyData([]); });
    return () => { cancelled = true; };
  }, [hourlyExportFrom, hourlyExportTo, selectedNgoId]);

  // Fetch aggregate hourly stats for the selected date
  useEffect(() => {
    let cancelled = false;
    setHourlyLoading(true);
    setShowAllIdleAlerts(false);
    getFroHourlyPerformance({ from: hourlyDate, to: hourlyDate, ...(selectedNgoId !== 'all' ? { ngo_id: selectedNgoId } : {}) })
      .then(data => {
        if (!cancelled) {
          setHourlyFroRows(data || []);
          const hourSlots = Array.from({ length: 12 }, (_, i) => 
            `${String(9+i).padStart(2, '0')}:00-${String(10+i).padStart(2, '0')}:00`
          );
          const aggregated = {};
          for (const h of hourSlots) {
            aggregated[h] = { hour: h, calls: 0, connected: 0, non_connected: 0, interested: 0, donations: 0, amount: 0, connected_statuses: {}, non_connected_statuses: {} };
          }
          for (const row of data || []) {
            if (aggregated[row.hour]) {
              const a = aggregated[row.hour];
              a.calls += (row.calls || 0);
              a.connected += (row.connected || 0);
              a.non_connected += (row.non_connected || 0);
              a.interested += (row.interested || 0);
              a.donations += (row.donations || 0);
              a.amount += (row.amount || 0);
              for (const [k, v] of Object.entries(row.connected_statuses || {})) a.connected_statuses[k] = (a.connected_statuses[k] || 0) + v;
              for (const [k, v] of Object.entries(row.non_connected_statuses || {})) a.non_connected_statuses[k] = (a.non_connected_statuses[k] || 0) + v;
            }
          }
          setHourlyList(Object.values(aggregated));
        }
      })
      .catch(() => { if (!cancelled) { setHourlyList([]); setHourlyFroRows([]); } })
      .finally(() => { if (!cancelled) setHourlyLoading(false); });
    return () => { cancelled = true; };
  }, [hourlyDate, selectedNgoId]);

  // Derived: day totals + per-FRO productivity alerts for the selected hourly date
  const hourlyTotals = useMemo(() => {
    const t = { calls: 0, connected: 0, nonConnected: 0, interested: 0, donations: 0, amount: 0 };
    for (const h of hourlyList) {
      t.calls += h.calls || 0;
      t.connected += h.connected || 0;
      t.nonConnected += h.non_connected || 0;
      t.interested += h.interested || 0;
      t.donations += h.donations || 0;
      t.amount += h.amount || 0;
    }
    return t;
  }, [hourlyList]);

  const hourlyAlerts = useMemo(() => {
    const byFro = {};
    for (const r of hourlyFroRows) {
      if (!r.fro_worker_id) continue;
      if (!byFro[r.fro_worker_id]) byFro[r.fro_worker_id] = { id: r.fro_worker_id, name: r.fro_name || 'Unknown', calls: 0, connected: 0, slots: Array(12).fill(0) };
      const f = byFro[r.fro_worker_id];
      f.calls += r.calls || 0;
      f.connected += r.connected || 0;
      const idx = parseInt(r.hour, 10) - 9;
      if (idx >= 0 && idx < 12) f.slots[idx] = r.calls || 0;
    }
    const isToday = hourlyDate === toIstDate();
    const nowIstHour = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
    // Fully-elapsed working slots: all 12 for past days; up to the current IST hour for today
    const elapsed = isToday ? Math.max(0, Math.min(12, nowIstHour - 9)) : 12;
    const idle = [];
    const noCalls = [];
    for (const f of Object.values(byFro)) {
      if (f.calls > 0) {
        let idleSlots = 0;
        for (let i = 0; i < elapsed; i++) if (f.slots[i] === 0) idleSlots++;
        if (idleSlots > 0) idle.push({ ...f, idleSlots });
      } else {
        noCalls.push(f);
      }
    }
    idle.sort((a, b) => b.idleSlots - a.idleSlots || a.name.localeCompare(b.name));
    noCalls.sort((a, b) => a.name.localeCompare(b.name));
    return { idle, noCalls, elapsed, isToday };
  }, [hourlyFroRows, hourlyDate]);

  const todayStr = new Date().toISOString().slice(0,10);
  const monthStart = new Date().toISOString().slice(0,7) + '-01';
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0,10);

  useEffect(() => {
    let cancelled = false;
    apiGet('/ngo-admin/ngos').then(data => { if (!cancelled) setAccessibleNgos(data); }).catch((err) => { console.error('API error:', err.message); });
    return () => { cancelled = true };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWeakLoading(true);
    const ngoParam = selectedNgoId !== 'all' ? `&ngo_id=${selectedNgoId}` : '';
    apiGet(`/ngo-admin/fro-performance?from=${activeRange.from}&to=${activeRange.to}${ngoParam}`)
      .then(data => { if (!cancelled) setWeakPerformers(data); })
      .catch(() => { if (!cancelled) setWeakPerformers([]); })
      .finally(() => { if (!cancelled) setWeakLoading(false); });
    return () => { cancelled = true };
  }, [selectedNgoId, activeRange]);

  // Top performers = same global-filtered dataset, best score first
  const topPerformers = useMemo(() => [...weakPerformers].sort((a, b) => b.score - a.score), [weakPerformers]);

  // NGO filter pills from the admin's accessible NGOs
  const ngoFilterPills = useMemo(() => (accessibleNgos || []).filter(n => n && n.id).map(n => ({
    id: n.id,
    name: n.name || '',
    label: NGO_TABS.find(([c]) => c && (n.name || '').toLowerCase().includes(c))?.[1] || (n.name || 'NGO'),
    color: ngoColorOf(n.name),
  })), [accessibleNgos]);

  const [tlData, setTlData] = useState(null);
  // Telecaller performance rows (search-filtered) + tab totals for the redesign
  const perfRows = useMemo(() => (tlData?.performance || []).filter(p =>
    !froSearch || (p.fro_name || '').toLowerCase().includes(froSearch.toLowerCase())
  ), [tlData, froSearch]);
  const perfTotals = useMemo(() => perfRows.reduce((a, p) => {
    a.calls += p.calls_range || 0;
    a.connected += p.connected_range || 0;
    a.nonConnected += p.non_connected_range ?? Math.max(0, (p.calls_range || 0) - (p.connected_range || 0));
    return a;
  }, { calls: 0, connected: 0, nonConnected: 0 }), [perfRows]);
  const [followups, setFollowups] = useState([]);
  const [followupTab, setFollowupTab] = useState('overdue');
  const [followupLoading, setFollowupLoading] = useState(false);
  const [showFollowups, setShowFollowups] = useState(true);
  const [followupMode, setFollowupMode] = useState('bucket');
  const [followupDay, setFollowupDay] = useState(() => toIstDate());
  const [daywiseRows, setDaywiseRows] = useState([]);
  const [daywiseLoading, setDaywiseLoading] = useState(false);
  const [fupDetailWorker, setFupDetailWorker] = useState(null);
  const [followupReload, setFollowupReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const buildParams = () => {
      const params = [];
      if (selectedNgoId !== 'all') params.push(`ngo_id=${selectedNgoId}`);
      let from, to;
      if (dashPeriod === 'today') { from = toIstDate(); to = from; }
      else if (dashPeriod === 'weekly') {
        const now = new Date();
        const start = new Date(now); start.setDate(now.getDate() - now.getDay());
        from = toIstDate(start); to = toIstDate(now);
      } else if (dashPeriod === 'monthly') {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        from = toIstDate(start); to = toIstDate(now);
      } else {
        from = customFrom; to = customTo;
      }
      if (from) params.push(`from=${from}`);
      if (to) params.push(`to=${to}`);
      if (selectedFroId) params.push(`fro_id=${selectedFroId}`);
      return params.length ? `?${params.join('&')}` : '';
    };
    const ngoParam = () => buildParams();
    const fetchTl = () => {
      apiGet(`/ngo-admin/tl-dashboard${ngoParam()}`)
        .then(d => { if (!cancelled) setTlData(d); })
        .catch(() => { if (!cancelled) setTlData(null); });
    };
    fetchTl();
    const interval = setInterval(fetchTl, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedNgoId, dashPeriod, customFrom, customTo, selectedFroId]);

  // Send an idle_alert notification to a specific FRO (bell + realtime + FCM).
  const [notifyingFroId, setNotifyingFroId] = useState(null);
  const handleNotifyFro = useCallback(async (froId, froName) => {
    if (notifyingFroId) return;
    setNotifyingFroId(froId);
    try {
      await notifyFro(froId);
      toast(`Idle alert sent to ${froName}`, 'success');
    } catch (e) {
      toast(e.message || 'Could not send alert', 'error');
    } finally {
      setNotifyingFroId(null);
    }
  }, [notifyingFroId]);

  // Always load the pending follow-up pool (header chips + tabs need it even
  // when the section is collapsed).
  useEffect(() => {
    let cancelled = false;
    setFollowupLoading(true);
    const ngoParam = selectedNgoId !== 'all' ? `?ngo_id=${selectedNgoId}` : '';
    apiGet(`/ngo-admin/followups${ngoParam}`)
      .then(d => { if (!cancelled) setFollowups(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setFollowups([]); })
      .finally(() => { if (!cancelled) setFollowupLoading(false); });
    return () => { cancelled = true };
  }, [selectedNgoId, followupReload]);

  useEffect(() => {
    if (!showFollowups || followupMode !== 'daywise') return;
    let cancelled = false;
    setDaywiseLoading(true);
    const params = new URLSearchParams({ date: followupDay });
    if (selectedNgoId !== 'all') params.set('ngo_id', selectedNgoId);
    apiGet(`/ngo-admin/followups?${params}`)
      .then(d => { if (!cancelled) setDaywiseRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setDaywiseRows([]); })
      .finally(() => { if (!cancelled) setDaywiseLoading(false); });
    return () => { cancelled = true };
  }, [showFollowups, followupMode, followupDay, selectedNgoId, followupReload]);

  const daywiseSummary = useMemo(() => buildWorkerSummary(daywiseRows), [daywiseRows]);

  const bucketCountOf = useCallback((key) => {
    if (!Array.isArray(followups)) return 0;
    return followups.filter(f => (f.buckets || (f.bucket ? [f.bucket] : [])).includes(key)).length;
  }, [followups]);

  const bucketRows = useMemo(() => {
    if (!Array.isArray(followups)) return [];
    return followups.filter(f => (f.buckets || (f.bucket ? [f.bucket] : [])).includes(followupTab));
  }, [followups, followupTab]);

  const bucketSummary = useMemo(() => buildWorkerSummary(bucketRows), [bucketRows]);

  const fetchDashboard = useCallback((opts = {}) => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (selectedNgoId !== 'all') params.set('ngo_id', selectedNgoId);
    if (opts.fresh) params.set('fresh', '1');
    const ngoParam = params.toString() ? `?${params.toString()}` : '';
    const reqOpts = { signal: controller.signal, timeout: 180000 };
    apiGet(`/ngo-admin/dashboard${ngoParam}`, reqOpts)
      .then(d => { if (!controller.signal.aborted) setData(d); })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message || 'Failed to load dashboard data');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    apiGet(`/ngo-admin/dashboard/station-stats${ngoParam}`, reqOpts)
      .then(s => { if (!controller.signal.aborted) setStationStats(s); })
      .catch(() => {});
    apiGet('/ngo-admin/stations', reqOpts)
      .then(st => { if (!controller.signal.aborted) setStationsData(Array.isArray(st) ? st : []); })
      .catch(() => {});
    return controller;
  }, [selectedNgoId]);

  useEffect(() => {
    const controller = fetchDashboard();
    return () => controller.abort();
  }, [fetchDashboard]);

  const handleNgoFilter = (ngoId) => {
    if (ngoId === selectedNgoId) return;
    const ngo = (accessibleNgos || []).find(n => n.id === ngoId);
    setNgoTab(NGO_TABS.find(([c]) => c && (ngo?.name || '').toLowerCase().includes(c))?.[0] || '');
    setData(null);
    setStationStats(null);
    setStationsData([]);
    setSelectedNgoId(ngoId);
  };

  if (loading && !data) return <SkeletonDashboard />;
  if (error && !data) {
    return (
      <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p style={{ marginBottom: 6, fontWeight: 600, color: 'var(--ink)' }}>Could not load dashboard data</p>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 16 }}>{error || 'The server took too long to respond. Please try again.'}</p>
        <button className="btn btn-primary" onClick={() => fetchDashboard({ fresh: true })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Retry
        </button>
      </div>
    );
  }
  if (!data) return <SkeletonDashboard />;

  const stations = stationStats?.stations || {};
  const summary = stationStats?.summary || {};
  const stationNames = Object.keys(stations).sort((a, b) => {
    const idxA = a.lastIndexOf('-'), idxB = b.lastIndexOf('-');
    const numA = idxA > 0 ? parseInt(a.slice(idxA + 1)) || 0 : 0;
    const numB = idxB > 0 ? parseInt(b.slice(idxB + 1)) || 0 : 0;
    const preA = idxA > 0 ? a.slice(0, idxA) : a;
    const preB = idxB > 0 ? b.slice(0, idxB) : b;
    if (preA !== preB) return preA.localeCompare(preB);
    return numA - numB;
  });

  const getCell = (station, status) => stations[station]?.[status] || 0;
  const getStationTotal = (station) => Object.values(stations[station] || {}).reduce((t, v) => t + v, 0);

  const stationInfoMap = {};
  for (const st of stationsData) {
    stationInfoMap[st.station] = st;
  }

  const s = data.summary || {};
  const d = s.donors || {};
  const c = s.collection || {};
  const cm = c.month || {};
  const ct = c.today || {};
  const r = s.reactivations || {};
  const w = data.workers || {};
  const f = w.fro || {};
  const att = w.attendance || {};
  const a = data.assignments || {};

  const total_donors = Number(d.total) || 0;
  const assigned_donors = Number(d.assigned) || 0;
  const month_collection = Number(cm.total) || 0;
  const today_collection = Number(ct.total) || 0;
  const daily_target = Number(c.daily_target) || 0;
  const monthly_target = Number(c.monthly_target) || (daily_target > 0 ? daily_target * 26 : 0);
  const verified_month_amount = Number(cm.verified?.amount) || 0;
  const verified_month_count = Number(cm.verified?.count) || 0;
  const unverified_month_amount = Number(cm.unverified?.amount) || 0;
  const unverified_month_count = Number(cm.unverified?.count) || 0;
  const verified_today_amount = Number(ct.verified?.amount) || 0;
  const verified_today_count = Number(ct.verified?.count) || 0;
  const unverified_today_amount = Number(ct.unverified?.amount) || 0;
  const unverified_today_count = Number(ct.unverified?.count) || 0;
  const total_workers = Number(f.active) || 0;
  const workers_present = Number(att.present) || 0;
  const workers_late = Number(att.late) || 0;
  const workers_absent = Number(att.absent) || 0;
  const workers_no_mark = Number(att.no_mark) || 0;
  const attendance_pct = Number(att.pct) || 0;
  const data_used = Number(a.data_connected) || 0;
  const data_unused = Number(a.data_unconnected) || 0;
  const active_donors = Number(d.active) || 0;
  const inactive_donors = Number(d.inactive) || 0;
  const reactivated_today = Number(r.today) || 0;
  const reactivated_monthly = Number(r.month) || 0;
  const stations_per_ngo = tlData?.stations_per_ngo || data.stations_per_ngo || {};
  const stations_summary = tlData?.stations_summary || data.stations_summary || { total: 0, active: 0 };
  const unassigned = Math.max(0, total_donors - assigned_donors);
  const assignPct = Number(d.assigned_pct) || 0;
  const direct_donation_month = Math.max(0, month_collection - verified_month_amount - unverified_month_amount);
  const direct_donation_today = Math.max(0, today_collection - verified_today_amount - unverified_today_amount);

  const pieData = DISPOSITION_GROUPS.map(g => ({
    name: g.label,
    value: g.statuses.reduce((t, s) => t + (summary[s] || 0), 0),
    color: g.color,
  })).filter(d => d.value > 0);

  const handleHourlyExport = async () => {
    const XLSX = await import('xlsx-js-style');
    const wb = XLSX.utils.book_new();
    let data = [];
    try {
      data = await getFroHourlyPerformance({ from: hourlyDate, to: hourlyDate, ...(selectedNgoId !== 'all' ? { ngo_id: selectedNgoId } : {}) });
    } catch (e) {
      data = [];
    }
    const headers = [
      'Telecaller', 'Login ID', 'Date', 'Hour Slot', 'Calls', 'Connected', 'Non-Connected', 'Interested', 'Donations', 'Amount (₹)'
    ];
    const rows = (data || []).map(h => [
      h.fro_name,
      h.fro_login_id || '',
      hourlyDate,
      h.hour,
      h.calls || 0,
      h.connected || 0,
      h.non_connected || 0,
      h.interested || 0,
      h.donations || 0,
      h.amount || 0
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    sheet['!cols'] = [
      { wch: 25 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }
    ];
    XLSX.utils.book_append_sheet(wb, sheet, 'Hourly Performance');
    XLSX.writeFile(wb, `hourly-performance-${hourlyDate}.xlsx`);
  };

  const handleTelecallerExport = async () => {
    if (!tlData?.performance) return;
    const XLSX = await import('xlsx-js-style');
    const wb = XLSX.utils.book_new();
    const enc = XLSX.utils.encode_cell;
    const styleCell = (ws, r, c, s) => { const ref = ws[enc({ r, c })]; if (ref) ref.s = s; };
    const spanRef = (ws) => {
      const cur = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: cur.e });
    };

    const periodLabel = PERIOD_LABELS[dashPeriod] || 'Range';
    const filteredPerformance = tlData.performance.filter(p =>
      !froSearch || p.fro_name?.toLowerCase().includes(froSearch.toLowerCase())
    );

    const HDR = {
      fgColor: { rgb: '5B6B4E' }, pattern: 'solid',
      font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };
    const TITLE = {
      fgColor: { rgb: '5B6B4E' }, pattern: 'solid',
      font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
    const SUB = {
      fgColor: { rgb: 'E8EDE1' }, pattern: 'solid',
      font: { name: 'Calibri', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
    const AMT = { numFmt: '"₹"#,##0' };
    const FONT = { name: 'Calibri', sz: 10 };

    const calc = (p) => {
      const calls = p.calls_range || 0;
      const connected = p.connected_range || 0;
      const interested = p.interested_range || 0;
      const received = p.receivedAmount_range || 0;
      return {
        calls, connected,
        nonConnected: p.non_connected_range ?? Math.max(0, calls - connected),
        interested, received,
        donors: p.receivedDonors || 0,
        statuses: p.connectedStatuses_range || {},
      };
    };
    const calcRows1 = filteredPerformance.map(p => ({ p, c: calc(p) }));
    const sum1 = (k) => calcRows1.reduce((a, { c }) => a + c[k], 0);
    const tcalls = sum1('calls'), tconn = sum1('connected'), tnc = sum1('nonConnected');
    const tint = sum1('interested'), tdon = sum1('donors'), tamt = sum1('received');

    // ── Sheet 1: Telecaller Performance ─────────────────────────────
    const headers1 = [
      'Telecaller', 'Login ID', 'Period', 'Total Calls', 'Connected',
      ...CONNECTED_STATUS_COLUMNS.map(c => c.label),
      'Non-Connected', 'Interested', 'Amount (₹)', 'Live Status'
    ];
    const aoa1 = calcRows1.map(({ p, c }) => [
      p.fro_name, p.fro_login_id || '', periodLabel, c.calls, c.connected,
      ...CONNECTED_STATUS_COLUMNS.map(col => c.statuses[col.key] || 0),
      c.nonConnected, c.interested, c.received, p.status || 'offline'
    ]);
    const t1 = calcRows1.reduce((a, { p, c }) => ({
      calls: a.calls + c.calls, connected: a.connected + c.connected, nonConnected: a.nonConnected + c.nonConnected,
      interested: a.interested + c.interested, donors: a.donors + (p.receivedDonors || 0), amount: a.amount + c.received,
      statuses: CONNECTED_STATUS_COLUMNS.map((col, i) => a.statuses[i] + (c.statuses[col.key] || 0)),
    }), { calls: 0, connected: 0, nonConnected: 0, interested: 0, donors: 0, amount: 0, statuses: CONNECTED_STATUS_COLUMNS.map(() => 0) });
    aoa1.push(['TOTAL', '', '', t1.calls, t1.connected, ...t1.statuses, t1.nonConnected, t1.interested, t1.amount, '']);

    const ws1 = XLSX.utils.aoa_to_sheet([]);
    ws1[enc({ r: 0, c: 0 })] = { t: 's', v: `Telecaller Performance — ${periodLabel}` };
    ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } }];
    ws1['!rows'] = [{ hpt: 30 }, { hpt: 28 }];
    XLSX.utils.sheet_add_aoa(ws1, [headers1], { origin: 'A2' });
    XLSX.utils.sheet_add_aoa(ws1, aoa1, { origin: 'A3' });
    spanRef(ws1);
    ws1['!cols'] = [
      { wch: 25 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
      ...CONNECTED_STATUS_COLUMNS.map(() => ({ wch: 16 })),
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }
    ];
    styleCell(ws1, 0, 0, TITLE);
    for (let c = 0; c <= 14; c++) styleCell(ws1, 1, c, HDR);
    const numCols1 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    for (let r = 2; r < 2 + aoa1.length; r++) {
      for (let c = 0; c <= 14; c++) {
        const s = { font: FONT, alignment: { vertical: 'center', horizontal: numCols1.includes(c) ? 'center' : 'left' } };
        if (c === 13) s.numFmt = AMT.numFmt;
        styleCell(ws1, r, c, s);
      }
    }
    for (let c = 0; c <= 14; c++) styleCell(ws1, 1 + aoa1.length, c, { ...SUB, numFmt: c === 13 ? AMT.numFmt : undefined });
    ws1['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws1['!autofilter'] = { ref: `A2:O${1 + aoa1.length}` };
    XLSX.utils.book_append_sheet(wb, ws1, 'Telecaller Performance');

    // ── Sheet 2: Hourly Performance (subtotals per telecaller) ──────
    let hourlyDataToUse = froHourlyData;
    if (!hourlyDataToUse || hourlyDataToUse.length === 0) {
      try {
        hourlyDataToUse = await getFroHourlyPerformance({ from: hourlyExportFrom, to: hourlyExportTo, ...(selectedNgoId !== 'all' ? { ngo_id: selectedNgoId } : {}) }) || [];
      } catch (e) {
        hourlyDataToUse = [];
      }
    }
    const headers2 = ['Telecaller', 'Login ID', 'Hour Slot', 'Calls', 'Connected', 'Interested', 'Donations', 'Amount (₹)'];
    const ws2 = XLSX.utils.aoa_to_sheet([]);
    ws2[enc({ r: 0, c: 0 })] = { t: 's', v: `Hourly Collection Performance — ${hourlyExportFrom} to ${hourlyExportTo}` };
    ws2['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];
    ws2['!rows'] = [{ hpt: 30 }, { hpt: 26 }];
    XLSX.utils.sheet_add_aoa(ws2, [headers2], { origin: 'A2' });

    const aoa2 = [];
    const subRows2 = [];
    let grandRow2 = -1;
    if (hourlyDataToUse && hourlyDataToUse.length) {
      const groups = {};
      hourlyDataToUse.forEach(h => { const k = h.fro_name || 'Unknown'; (groups[k] = groups[k] || []).push(h); });
      Object.keys(groups).forEach(name => {
        groups[name].forEach(h => aoa2.push([h.fro_name || name, h.fro_login_id || '', h.hour, h.calls || 0, h.connected || 0, h.interested || 0, h.donations || 0, h.amount || 0]));
        const st = groups[name].reduce((a, h) => ({
          calls: a.calls + (h.calls || 0), connected: a.connected + (h.connected || 0), interested: a.interested + (h.interested || 0),
          donations: a.donations + (h.donations || 0), amount: a.amount + (h.amount || 0)
        }), { calls: 0, connected: 0, interested: 0, donations: 0, amount: 0 });
        aoa2.push([`${name} — Subtotal`, '', '', st.calls, st.connected, st.interested, st.donations, st.amount]);
        subRows2.push(1 + aoa2.length);
      });
      const gt = hourlyDataToUse.reduce((a, h) => ({
        calls: a.calls + (h.calls || 0), connected: a.connected + (h.connected || 0), interested: a.interested + (h.interested || 0),
        donations: a.donations + (h.donations || 0), amount: a.amount + (h.amount || 0)
      }), { calls: 0, connected: 0, interested: 0, donations: 0, amount: 0 });
      aoa2.push(['GRAND TOTAL', '', '', gt.calls, gt.connected, gt.interested, gt.donations, gt.amount]);
      grandRow2 = 1 + aoa2.length;
    } else {
      aoa2.push(['No hourly data for selected range', '', '', '', '', '', '', '']);
    }
    XLSX.utils.sheet_add_aoa(ws2, aoa2, { origin: 'A3' });
    spanRef(ws2);
    ws2['!cols'] = [
      { wch: 25 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }
    ];
    styleCell(ws2, 0, 0, TITLE);
    for (let c = 0; c <= 7; c++) styleCell(ws2, 1, c, HDR);
    const numCols2 = [3, 4, 5, 6, 7];
    for (let r = 2; r < 2 + aoa2.length; r++) {
      for (let c = 0; c <= 7; c++) {
        const s = { font: FONT, alignment: { vertical: 'center', horizontal: numCols2.includes(c) ? 'center' : 'left' } };
        if (c === 7) s.numFmt = AMT.numFmt;
        styleCell(ws2, r, c, s);
      }
    }
    subRows2.forEach(r => { for (let c = 0; c <= 7; c++) styleCell(ws2, r, c, { ...SUB, numFmt: c === 7 ? AMT.numFmt : undefined }); });
    if (grandRow2 > 0) for (let c = 0; c <= 7; c++) styleCell(ws2, grandRow2, c, { ...SUB, numFmt: c === 7 ? AMT.numFmt : undefined });
    ws2['!freeze'] = { xSplit: 0, ySplit: 1 };
    if (aoa2.length > 1) ws2['!autofilter'] = { ref: `A2:H${1 + aoa2.length}` };
    XLSX.utils.book_append_sheet(wb, ws2, 'Hourly Performance');

    // ── Sheet 3: Computations ───────────────────────────────────────
    const ws3 = XLSX.utils.aoa_to_sheet([]);
    ws3[enc({ r: 0, c: 0 })] = { t: 's', v: `Computations — ${periodLabel}` };
    ws3['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    ws3['!rows'] = [{ hpt: 30 }];
    let r3 = 1;
    const appendR = (row) => { XLSX.utils.sheet_add_aoa(ws3, [row], { origin: 'A' + (r3 + 1) }); r3++; };

    const secRows = [];
    const hdrRows = [];
    const totRows = [];
    const amtCells = [];

    appendR(['Key Metrics']);
    secRows.push(r3 - 1);
    [
      ['Total Telecallers', calcRows1.length],
      ['Total Calls', tcalls],
      ['Total Connected', tconn],
      ['Connection Rate', tcalls ? `${((tconn / tcalls) * 100).toFixed(1)}%` : '—'],
      ['Non-Connected', tnc],
      ['Interested', tint],
      ['Received Donors', tdon],
      ['Received Amount (₹)', tamt],
      ['Conversion Rate', tcalls ? `${((tdon / tcalls) * 100).toFixed(1)}%` : '—'],
      ['Avg Ticket Size (₹)', tdon ? Math.round(tamt / tdon) : 0],
    ].forEach(([lbl, val]) => { appendR([lbl, val]); if (lbl.includes('₹')) amtCells.push([r3 - 1, 1]); });

    appendR(['']);
    const hourTotals = {};
    if (hourlyDataToUse && hourlyDataToUse.length) {
      hourlyDataToUse.forEach(h => {
        const k = h.hour || 'Unknown';
        hourTotals[k] = hourTotals[k] || { calls: 0, connected: 0, interested: 0, donations: 0, amount: 0 };
        hourTotals[k].calls += h.calls || 0; hourTotals[k].connected += h.connected || 0;
        hourTotals[k].interested += h.interested || 0; hourTotals[k].donations += h.donations || 0;
        hourTotals[k].amount += h.amount || 0;
      });
      appendR(['Hourly Totals']);
      secRows.push(r3 - 1);
      appendR(['Hour Slot', 'Calls', 'Connected', 'Interested', 'Donations', 'Amount (₹)']);
      hdrRows.push(r3 - 1);
      Object.keys(hourTotals).sort().forEach(k => {
        const t = hourTotals[k];
        appendR([k, t.calls, t.connected, t.interested, t.donations, t.amount]);
        amtCells.push([r3 - 1, 5]);
      });
      const ht = Object.values(hourTotals).reduce((a, t) => ({
        calls: a.calls + t.calls, connected: a.connected + t.connected, interested: a.interested + t.interested,
        donations: a.donations + t.donations, amount: a.amount + t.amount
      }), { calls: 0, connected: 0, interested: 0, donations: 0, amount: 0 });
      appendR(['TOTAL', ht.calls, ht.connected, ht.interested, ht.donations, ht.amount]);
      totRows.push(r3 - 1);
      amtCells.push([r3 - 1, 5]);
      appendR(['']);
    }

    appendR(['Per-Telecaller Share']);
    secRows.push(r3 - 1);
    appendR(['Telecaller', 'Calls', 'Connected', 'Interest (I/C) %', 'Amount (₹)', 'Share %']);
    hdrRows.push(r3 - 1);
    calcRows1.forEach(({ p, c }) => {
      appendR([p.fro_name, c.calls, c.connected, c.connected ? `${((c.interested / c.connected) * 100).toFixed(1)}%` : '—', c.received, tamt ? `${((c.received / tamt) * 100).toFixed(1)}%` : '—']);
      amtCells.push([r3 - 1, 4]);
    });
    appendR(['TOTAL', tcalls, tconn, tconn ? `${((tint / tconn) * 100).toFixed(1)}%` : '—', tamt, '100%']);
    totRows.push(r3 - 1);
    amtCells.push([r3 - 1, 4]);
    appendR(['']);

    const shareCols = calcRows1.map(({ p }) => p.fro_name);
    const statusKeys = [...new Set(calcRows1.flatMap(({ c }) => Object.keys(c.statuses)))];
    appendR(['Connected-Status Matrix']);
    secRows.push(r3 - 1);
    appendR(['Connected Disposition', ...shareCols, 'TOTAL']);
    hdrRows.push(r3 - 1);
    statusKeys.forEach(k => {
      const vals = calcRows1.map(({ c }) => c.statuses[k] || 0);
      appendR([DISPOSITION_LABELS[k] || k, ...vals, vals.reduce((a, b) => a + b, 0)]);
    });
    const colTotals = shareCols.length ? calcRows1.map(({ c }, i) => statusKeys.reduce((a, k) => a + (c.statuses[k] || 0), 0)) : [];
    appendR(['TOTAL', ...colTotals, colTotals.reduce((a, b) => a + b, 0)]);
    totRows.push(r3 - 1);

    spanRef(ws3);
    ws3['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    styleCell(ws3, 0, 0, TITLE);
    secRows.forEach(r => {
      styleCell(ws3, r, 0, { font: { name: 'Calibri', sz: 11, bold: true } });
    });
    hdrRows.forEach(r => {
      for (let c = 0; c <= 5; c++) styleCell(ws3, r, c, { ...HDR, fgColor: { rgb: 'D9DFCE' }, font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: '3F4A38' } } });
    });
    totRows.forEach(r => {
      for (let c = 0; c <= 5; c++) styleCell(ws3, r, c, SUB);
    });
    for (let r = 0; r < r3; r++) {
      amtCells.forEach(([ar, ac]) => { if (ar === r) styleCell(ws3, ar, ac, { font: FONT, alignment: { horizontal: 'center' }, numFmt: AMT.numFmt }); });
    }
    XLSX.utils.book_append_sheet(wb, ws3, 'Computations');

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `telecaller-performance-${dateStr}.xlsx`);
  };

  return (
    <div>
      <div className="filter-bar">
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: '#eef1f6', borderRadius: 12 }}>
          {[['today', 'Today'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom']].map(([val, label]) => (
            <button key={val} onClick={() => setDashPeriod(val)} style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 15px', borderRadius: 9, border: 'none', cursor: 'pointer', background: dashPeriod === val ? '#111827' : 'transparent', color: dashPeriod === val ? '#fff' : '#475569', transition: 'background .12s, color .12s' }}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: '#eef1f6', borderRadius: 12 }}>
          <button onClick={() => handleNgoFilter('all')} style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 15px', borderRadius: 9, border: 'none', cursor: 'pointer', background: selectedNgoId === 'all' ? '#111827' : 'transparent', color: selectedNgoId === 'all' ? '#fff' : '#475569', transition: 'background .12s, color .12s' }}>All NGOs</button>
          {ngoFilterPills.map(n => (
            <button key={n.id} onClick={() => handleNgoFilter(n.id)} title={n.name} style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 15px', borderRadius: 9, border: 'none', cursor: 'pointer', background: selectedNgoId === n.id ? n.color : 'transparent', color: selectedNgoId === n.id ? '#fff' : '#475569', transition: 'background .12s, color .12s' }}>{n.label}</button>
          ))}
        </div>
        {dashPeriod === 'custom' && (
          <>
            <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} style={{ padding: '8px 12px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', background: '#fff' }} />
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>to</span>
            <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} style={{ padding: '8px 12px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', background: '#fff' }} />
          </>
        )}
        <select value={selectedFroId} onChange={(e) => setSelectedFroId(e.target.value)} style={{ padding: '8px 12px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
          <option value="">All Telecallers</option>
          {(tlData?.performance || []).map(p => (
            <option key={p.fro_id} value={p.fro_id}>{p.fro_name}</option>
          ))}
        </select>
        <button
          onClick={() => fetchDashboard({ fresh: true })}
          disabled={loading}
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto', opacity: loading ? 0.7 : 1, cursor: loading ? 'default' : 'pointer' }}
          title="Reload dashboard with fresh data"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'weak-spin' : ''}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Top 4 Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 14, marginBottom: 16,
      }}>
        <div className="card" style={{ marginBottom: 0, padding: '16px 18px', cursor: 'pointer' }} onClick={() => setSelectedPeriod('today')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 2 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', flex: 1 }}>Collection</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>₹{Number(tlData?.kpis?.received_amount ?? today_collection).toLocaleString('en-IN')}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 10 }}>
            {Number(tlData?.kpis?.received_amount ?? today_collection) === 0 ? 'No collections yet' : `(As per global filter — e.g. ${PERIOD_LABELS[dashPeriod]})`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {(tlData?.collections_per_ngo?.length > 0 ? tlData.collections_per_ngo : (accessibleNgos || []).filter(n => NGO_TABS.some(([c]) => (n.name || '').toLowerCase().includes(c))).map(n => ({ ngo_id: n.id, ngo_name: n.name, amount: 0 })))
              .slice(0, 9)
              .sort((a, b) => ngoSortRank(a.ngo_name) - ngoSortRank(b.ngo_name))
              .slice(0, 3)
              .map(n => {
                const color = ngoColorOf(n.ngo_name);
                return (
                  <div key={n.ngo_id ?? n.ngo_name} style={{ padding: '10px 8px 11px', borderRadius: 10, border: '1px solid var(--line)', background: `${color}0d`, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .5, color, textTransform: 'uppercase' }}>{n.ngo_name}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginTop: 2 }}>₹{Number(n.amount || 0).toLocaleString('en-IN')}</div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0, padding: '16px 18px', cursor: 'pointer', border: '1px solid #16a34a33' }} onClick={() => setSelectedStatus('verified')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500, flex: 1 }}>Verified</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#16a34a' }}>₹{Number(tlData?.kpis?.received_amount ?? verified_month_amount).toLocaleString('en-IN')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-soft)' }}>
            <span>{tlData?.kpis?.donations ?? verified_month_count} verified donations</span>
            <span>{PERIOD_LABELS[dashPeriod]}</span>
          </div>
          <div style={{ fontSize: 10, color: '#16a34a', marginTop: 4 }}>Verified by Accounts panel</div>
        </div>

      </div>

      {/* Idle Alert Banner */}
      {tlData?.idle_alerts?.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 16px', borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>Idle Alerts:</span>
          {tlData.idle_alerts.map(a => (
            <span key={a.fro_id} style={{ fontSize: 11, fontWeight: 500, color: '#78350f', background: '#fff', padding: '2px 6px 2px 10px', borderRadius: 12, border: '1px solid #fde68a', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {a.fro_name} — {a.idle_minutes}m idle
              <button
                onClick={() => handleNotifyFro(a.fro_id, a.fro_name)}
                disabled={notifyingFroId === a.fro_id}
                title={`Send idle alert to ${a.fro_name}`}
                style={{ border: 'none', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 999, cursor: notifyingFroId === a.fro_id ? 'default' : 'pointer', background: notifyingFroId === a.fro_id ? '#fde68a' : '#d97706', color: '#fff' }}
              >
                {notifyingFroId === a.fro_id ? '…' : 'Notify'}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Telecaller Live Status KPI Bar */}
      {tlData?.kpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Telecallers', value: tlData.kpis.total_fros || 0, color: '#1e40af', bg: '#eff6ff' },
            { label: 'Calling', value: tlData.kpis.calling || 0, color: '#16a34a', bg: '#f0fdf4' },
            { label: 'Idle', value: tlData.kpis.idle || 0, color: '#d97706', bg: '#fffbeb' },
            { label: 'Offline', value: tlData.kpis.offline || 0, color: '#dc2626', bg: '#fef2f2' },
            { label: 'Total Calls', value: tlData.kpis.total_calls || 0, color: '#7c3aed', bg: '#f5f3ff' },
            { label: 'Connected', value: tlData.kpis.connected || 0, color: '#0891b2', bg: '#ecfeff' },
            { label: 'Not Connected', value: tlData.kpis.not_connected || 0, color: '#dc2626', bg: '#fef2f2' },
            { label: 'Connect %', value: (tlData.kpis.connect_rate || 0) + '%', color: '#334155', bg: '#f1f5f9' },
            { label: 'Donations', value: tlData.kpis.donations || 0, color: '#16a34a', bg: '#f0fdf4' },
            { label: 'Interested', value: tlData.kpis.interested || 0, color: '#db2777', bg: '#fdf2f8' },
            { label: 'Received', value: '₹' + Number(tlData.kpis.received_amount || 0).toLocaleString('en-IN'), color: '#16a34a', bg: '#f0fdf4', isAmount: true },
            { label: 'Follow-ups Due', value: tlData.kpis.followups_due || 0, color: '#ea580c', bg: '#fff7ed' },
            { label: 'Target %', value: (tlData.kpis.target_pct || 0) + '%', color: tlData.kpis.target_pct >= 75 ? '#16a34a' : '#dc2626', bg: tlData.kpis.target_pct >= 75 ? '#f0fdf4' : '#fef2f2' },
          ].map((s, i) => (
            <div key={i} className="card" style={{ marginBottom: 0, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* REQUIREMENT 1: Daily Collection Target + Monthly Collection Target (Directly Below) */}
      {daily_target > 0 && (
        <div className="card" style={{ marginBottom: 12, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600, flex: 1 }}>Daily Collection Target
              <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>Set by Super Admin</span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Target: <strong style={{ color: 'var(--ink)' }}>₹{daily_target.toLocaleString('en-IN')}</strong></span>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Collected: <strong style={{ color: '#16a34a' }}>₹{today_collection.toLocaleString('en-IN')}</strong></span>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Remaining: <strong style={{ color: today_collection >= daily_target ? '#16a34a' : '#ef4444' }}>₹{Math.max(0, daily_target - today_collection).toLocaleString('en-IN')}</strong></span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: '#fef2f2', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, (today_collection / daily_target) * 100)}%`,
              height: '100%',
              borderRadius: 4,
              background: today_collection >= daily_target ? '#16a34a' : today_collection >= daily_target * 0.5 ? '#f59e0b' : '#ef4444',
              transition: 'width .5s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
            <span>{Math.round((today_collection / daily_target) * 100)}% achieved</span>
            <span>{today_collection >= daily_target ? 'Daily target completed!' : `${Math.round(((daily_target - today_collection) / daily_target) * 100)}% remaining`}</span>
          </div>
        </div>
      )}

      {monthly_target > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)', fontWeight: 600, flex: 1 }}>Monthly Collection Target
              <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>Current Month</span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Target: <strong style={{ color: 'var(--ink)' }}>₹{monthly_target.toLocaleString('en-IN')}</strong></span>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Collected: <strong style={{ color: '#16a34a' }}>₹{month_collection.toLocaleString('en-IN')}</strong></span>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Remaining: <strong style={{ color: month_collection >= monthly_target ? '#16a34a' : '#ef4444' }}>₹{Math.max(0, monthly_target - month_collection).toLocaleString('en-IN')}</strong></span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: '#fef2f2', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, (month_collection / monthly_target) * 100)}%`,
              height: '100%',
              borderRadius: 4,
              background: month_collection >= monthly_target ? '#16a34a' : month_collection >= monthly_target * 0.5 ? '#f59e0b' : '#ef4444',
              transition: 'width .5s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
            <span>{Math.round((month_collection / monthly_target) * 100)}% achieved</span>
            <span>{month_collection >= monthly_target ? 'Monthly target completed!' : `${Math.round(((monthly_target - month_collection) / monthly_target) * 100)}% remaining`}</span>
          </div>
        </div>
      )}

      {/* REQUIREMENT 3: Workforce / Attendance (Left) & Stations (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 16 }}>
        {/* Left: Workforce & Attendance */}
        <div className="card" style={{ marginBottom: 0, padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500, flex: 1 }}>Workforce & Attendance</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{total_workers}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ width: 64, height: 64, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[
                      { name: 'Present', value: Math.max(0, workers_present), color: '#22c55e' },
                      { name: 'Late', value: Math.max(0, workers_late), color: '#f59e0b' },
                      { name: 'Absent', value: Math.max(0, workers_absent), color: '#ef4444' },
                      { name: 'No Show', value: Math.max(0, workers_no_mark), color: '#d1d5db' },
                    ].filter(d => d.value > 0)} cx="50%" cy="50%" innerRadius={20} outerRadius={30} dataKey="value" startAngle={90} endAngle={-270}>
                      <Cell fill="#22c55e" />
                      <Cell fill="#f59e0b" />
                      <Cell fill="#ef4444" />
                      <Cell fill="#d1d5db" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>Present</span>
                  <span style={{ fontWeight: 600 }}>{workers_present}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                  <span style={{ color: '#f59e0b', fontWeight: 500 }}>Late</span>
                  <span style={{ fontWeight: 500, color: '#f59e0b' }}>{workers_late}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#ef4444', fontWeight: 500 }}>Absent</span>
                  <span style={{ fontWeight: 500, color: '#ef4444' }}>{workers_absent}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{attendance_pct}% attendance</div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, background: '#f0fdf4', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#22c55e' }}>{workers_present}</div>
                <div style={{ fontSize: 9, color: 'var(--ink-soft)' }}>Present</div>
              </div>
              <div style={{ flex: 1, background: '#fffbeb', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b' }}>{workers_late}</div>
                <div style={{ fontSize: 9, color: 'var(--ink-soft)' }}>Late</div>
              </div>
              <div style={{ flex: 1, background: '#fef2f2', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>{workers_absent}</div>
                <div style={{ fontSize: 9, color: 'var(--ink-soft)' }}>Absent</div>
              </div>
              <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#6b7280' }}>{workers_no_mark}</div>
                <div style={{ fontSize: 9, color: 'var(--ink-soft)' }}>No Show</div>
              </div>
            </div>
            {total_workers > 0 && (
              <div style={{ height: 4, borderRadius: 2, background: '#e5e7eb', marginTop: 8, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${(workers_present / total_workers) * 100}%`, height: '100%', background: '#22c55e' }} />
                <div style={{ width: `${(workers_late / total_workers) * 100}%`, height: '100%', background: '#f59e0b' }} />
              </div>
            )}
          </div>
        </div>

        {/* Right: Stations — Total & Currently Active */}
        <div className="card" style={{ marginBottom: 0, padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500, flex: 1 }}>Stations</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10, textAlign: 'center' }}>
              <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '8px 6px' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>{stations_summary.total}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-soft)' }}>Total Stations</div>
              </div>
              <div style={{ background: '#f0fdf4', borderRadius: 6, padding: '8px 6px' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{stations_summary.active}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-soft)' }}>Active Now</div>
              </div>
            </div>
          </div>
          {Object.keys(stations_per_ngo).length > 0 && (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6, textTransform: 'uppercase' }}>Stations per NGO — Active / Total</div>
              {Object.entries(stations_per_ngo).map(([name, v]) => {
                const total = typeof v === 'number' ? v : (Number(v?.total) || 0);
                const active = v && typeof v === 'object' ? (Number(v.active) || 0) : 0;
                const pct = total > 0 ? Math.min(100, (active / total) * 100) : 0;
                return (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, minWidth: 50, color: 'var(--ink)' }}>{name}</span>
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: '#16a34a', transition: 'width .3s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, minWidth: 40, textAlign: 'right', color: 'var(--ink)' }}>{active}/{total}</span>
                  </div>
                );
              })}
              <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 6 }}>Active = station's FRO is online right now</div>
            </div>
          )}
        </div>
      </div>

      {/* REQUIREMENT 2: Top Collection (Left) & Low Collection (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 16 }}>
        {/* Left: Top Performance */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-head">
            <h3 style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#f59e0b' }}>🏆</span> Top Performance
            </h3>
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              <span style={{ fontSize:10, color:'var(--ink-soft)', fontWeight:500 }}>{PERIOD_LABELS[dashPeriod]}</span>
              {weakLoading && <span style={{ fontSize:10, color:'var(--ink-soft)', display:'flex', alignItems:'center', gap:4 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth="3" strokeLinecap="round" className="weak-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" className="weak-spin-arc"/></svg>
                Loading…
              </span>}
            </div>
          </div>
          <ScoreFormulaLegend />
          <div className="card-pad" style={{ padding: 0, overflowX: 'auto' }}>
            {topPerformers.length > 0 ? (
              <table style={{ fontSize: 11, width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{width:24, fontSize:10, padding:'6px 8px', textAlign:'left'}}>#</th>
                    <th style={{fontSize:10, padding:'6px 8px', textAlign:'left'}}>FRO</th>
                    <th style={{textAlign:'right', fontSize:10, padding:'6px 8px'}}>Collection</th>
                    <th style={{textAlign:'center', fontSize:10, padding:'6px 8px'}}>Leads</th>
                    <th style={{textAlign:'center', fontSize:10, padding:'6px 8px'}}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {topPerformers.slice(0, showAllTopPerformers ? topPerformers.length : 10).map((p, i) => (
                    <tr key={p.fro_id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{fontSize:10, fontWeight: i < 3 ? 700 : 400, color: i === 0 ? '#f59e0b' : i === 1 ? '#9ca3af' : i === 2 ? '#b45309' : 'var(--ink-soft)', padding:'5px 8px'}}>#{i + 1}</td>
                      <td style={{fontWeight:600, fontSize:11, padding:'5px 8px'}}>{p.fro_name}</td>
                      <td style={{textAlign:'right', fontWeight:600, fontSize:11, padding:'5px 8px'}}>₹{p.collection_amount.toLocaleString('en-IN')}</td>
                      <td style={{textAlign:'center', fontWeight:600, fontSize:11, padding:'5px 8px'}}>{p.lead_done_count ?? 0}</td>
                      <td style={{textAlign:'center', fontWeight:700, color:p.score >= 0.5 ? '#16a34a' : '#f59e0b', fontSize:11, padding:'5px 8px'}}>{p.score.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                {topPerformers.length > 10 && (
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{padding:0}}>
                        <button onClick={() => setShowAllTopPerformers(!showAllTopPerformers)}
                          style={{width:'100%', padding:'6px 10px', border:'none', fontSize:10, fontWeight:600, fontFamily:'inherit', cursor:'pointer', background:'var(--sage-soft)', color:'var(--sage)', textAlign:'center'}}>
                          {showAllTopPerformers ? '▲ Show Less' : `View All ${topPerformers.length} FROs →`}
                        </button>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--ink-soft)' }}>No performing FROs yet</div>
            )}
          </div>
        </div>

        {/* Right: Low Collection / Weak Performers */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-head">
            <h3 style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#dc2626' }}>⚠️</span> Low Performance
            </h3>
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              <span style={{ fontSize:10, color:'var(--ink-soft)', fontWeight:500 }}>{PERIOD_LABELS[dashPeriod]}</span>
              {weakLoading && <span style={{ fontSize:10, color:'var(--ink-soft)', display:'flex', alignItems:'center', gap:4 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth="3" strokeLinecap="round" className="weak-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" className="weak-spin-arc"/></svg>
                Loading…
              </span>}
            </div>
          </div>
          <ScoreFormulaLegend />
          <div className="card-pad" style={{ padding: 0, overflowX: 'auto' }}>
            {weakPerformers.length > 0 ? (
              <table style={{ fontSize: 11, width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{width:24, fontSize:10, padding:'6px 8px', textAlign:'left'}}>#</th>
                    <th style={{fontSize:10, padding:'6px 8px', textAlign:'left'}}>FRO</th>
                    <th style={{textAlign:'right', fontSize:10, padding:'6px 8px'}}>Collection</th>
                    <th style={{textAlign:'center', fontSize:10, padding:'6px 8px'}}>Leads</th>
                    <th style={{textAlign:'center', fontSize:10, padding:'6px 8px'}}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {weakPerformers.slice(0, showAllLowPerformers ? weakPerformers.length : 10).map((p, i) => (
                    <tr key={p.fro_id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{color:'var(--ink-soft)', fontSize:10, padding:'5px 8px'}}>{i + 1}</td>
                      <td style={{fontWeight:600, fontSize:11, padding:'5px 8px'}}>{p.fro_name}</td>
                      <td style={{textAlign:'right', fontWeight:600, fontSize:11, padding:'5px 8px'}}>₹{p.collection_amount.toLocaleString('en-IN')}</td>
                      <td style={{textAlign:'center', fontWeight:600, fontSize:11, padding:'5px 8px'}}>{p.lead_done_count ?? 0}</td>
                      <td style={{textAlign:'center', fontWeight:700, color:p.score < 0.2 ? '#dc2626' : '#f59e0b', fontSize:11, padding:'5px 8px'}}>{p.score.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                {weakPerformers.length > 10 && (
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{padding:0}}>
                        <button onClick={() => setShowAllLowPerformers(!showAllLowPerformers)}
                          style={{width:'100%', padding:'6px 10px', border:'none', fontSize:10, fontWeight:600, fontFamily:'inherit', cursor:'pointer', background:'var(--sage-soft)', color:'var(--sage)', textAlign:'center'}}>
                          {showAllLowPerformers ? '▲ Show Less' : `View All ${weakPerformers.length} FROs →`}
                        </button>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--ink-soft)' }}>No low performing FROs flagged</div>
            )}
          </div>
        </div>
      </div>

      {/* REQUIREMENT 5: Hourly Call Performance — summary chips + disposition breakdown + productivity alerts */}
      {(() => {
        const hourlyToday = toIstDate();
        const hourlyYesterday = toIstDate(new Date(Date.now() - 86400000));
        const dateBtn = (active) => ({
          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          border: `1px solid ${active ? 'var(--sage)' : 'var(--line)'}`,
          background: active ? 'var(--sage)' : '#fff',
          color: active ? '#fff' : 'var(--ink)',
        });
        const dayChips = [
          { key: 'calls', label: 'Calls', value: hourlyTotals.calls, color: '#2563eb', bg: '#eff6ff' },
          { key: 'connected', label: 'Connected', value: hourlyTotals.connected, color: '#16a34a', bg: '#f0fdf4' },
          { key: 'nonConnected', label: 'Non-Connected', value: hourlyTotals.nonConnected, color: '#dc2626', bg: '#fef2f2' },
          { key: 'interested', label: 'Interested', value: hourlyTotals.interested, color: '#ec4899', bg: '#fdf2f8' },
          { key: 'donations', label: 'Donations', value: hourlyTotals.donations, color: '#8b5cf6', bg: '#f5f3ff' },
        ];
        const chipBadge = (color) => ({
          background: color, color: '#fff', borderRadius: 999, minWidth: 18, height: 16,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, padding: '0 5px',
          animation: 'countPop .3s ease-out',
        });
        const chipWrap = (c) => ({
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
          padding: '3px 10px', borderRadius: 999, background: c.bg, color: c.color, border: `1px solid ${c.color}22`,
        });

        const dispTable = (title, iconName, iconColor, cols, statusesKey, totalKey) => {
          const maxPerCol = cols.map(c => Math.max(...hourlyList.map(h => (h[statusesKey] || {})[c.key] || 0), 1));
          const colTotals = cols.map(c => hourlyList.reduce((t, h) => t + ((h[statusesKey] || {})[c.key] || 0), 0));
          const grandTotal = hourlyList.reduce((t, h) => t + (h[totalKey] || 0), 0);
          const thBase = { padding: '8px 8px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', background: 'var(--bg)' };
          return (
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head">
                <h3 style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: iconColor }}>{iconName}</span> {title}
                </h3>
                <span style={{ fontSize: 10, color: 'var(--ink-soft)', fontWeight: 500 }}>{hourlyDate}</span>
              </div>
              <div className="card-pad" style={{ padding: 0, overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
                {hourlyLoading ? (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>Loading hourly data...</div>
                ) : hourlyTotals.calls === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>No calls recorded on this date</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                        <th style={{ ...thBase, textAlign: 'left', color: 'var(--ink-soft)' }}>Hour</th>
                        {cols.map(c => <th key={c.key} style={{ ...thBase, color: c.color, fontWeight: 700 }}>{c.label}</th>)}
                        <th style={{ ...thBase, color: 'var(--ink)', fontWeight: 700, paddingRight: 12 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hourlyList.map(h => {
                        const hasRow = (h.calls || 0) > 0;
                        return (
                          <tr key={h.hour} style={{ background: !hasRow ? '#fafafa' : 'transparent', borderBottom: '1px solid var(--line)' }}>
                            <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h.hour}</td>
                            {cols.map((c, i) => {
                              const v = (h[statusesKey] || {})[c.key] || 0;
                              const heat = v > 0 ? (c.color + Math.round(20 + 90 * Math.min(1, v / maxPerCol[i])).toString(16).padStart(2, '0')) : undefined;
                              return (
                                <td key={c.key} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: v > 0 ? c.color : 'var(--ink-soft)', background: heat }}>
                                  {v > 0 ? v : '—'}
                                </td>
                              );
                            })}
                            <td style={{ padding: '6px 12px 6px 10px', textAlign: 'right', fontWeight: 700, color: (h[totalKey] || 0) > 0 ? iconColor : 'var(--ink-soft)' }}>{h[totalKey] || 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--bg)' }}>
                        <td style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Total</td>
                        {colTotals.map((t, i) => (
                          <td key={cols[i].key} style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, color: t > 0 ? cols[i].color : 'var(--ink-soft)' }}>{t > 0 ? t : '—'}</td>
                        ))}
                        <td style={{ padding: '8px 12px 8px 10px', textAlign: 'right', fontWeight: 800, color: iconColor }}>{grandTotal}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          );
        };

        // Compress idle slot indices into "09–12, 15–17" IST hour ranges
        const idleRangesOf = (f, elapsed) => {
          const ranges = [];
          let s = null;
          for (let i = 0; i < elapsed; i++) {
            if (f.slots[i] === 0) { if (s === null) s = i; }
            else if (s !== null) { ranges.push([s, i - 1]); s = null; }
          }
          if (s !== null) ranges.push([s, elapsed - 1]);
          return ranges.map(([a, b]) => a === b
            ? `${String(9 + a).padStart(2, '0')}:00`
            : `${String(9 + a).padStart(2, '0')}–${String(10 + b).padStart(2, '0')}`).join(', ');
        };

        return (
          <>
            {/* Header card: date controls + day summary chips */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Hourly Call Performance
                </h3>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <button onClick={() => setHourlyDate(hourlyToday)} style={dateBtn(hourlyDate === hourlyToday)}>Today</button>
                  <button onClick={() => setHourlyDate(hourlyYesterday)} style={dateBtn(hourlyDate === hourlyYesterday)}>Yesterday</button>
                  <input
                    type="date"
                    value={hourlyDate}
                    onChange={e => setHourlyDate(e.target.value)}
                    style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 11, fontFamily: 'inherit', outline: 'none', background: 'var(--bg)', color: 'var(--ink)' }}
                  />
                  <button
                    onClick={handleHourlyExport}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', cursor: 'pointer' }}
                  >
                    <Download width="12" height="12" />
                    Export Hourly (XLSX)
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                {dayChips.map(c => (
                  <span key={c.key} style={chipWrap(c)}>
                    {c.label}
                    <span style={chipBadge(c.color)}><AnimatedNumber value={c.value} /></span>
                  </span>
                ))}
                <span style={chipWrap({ bg: '#f0fdf4', color: '#15803d' })}>
                  ₹ Amount
                  <span style={chipBadge('#15803d')}><AnimatedNumber value={hourlyTotals.amount} /></span>
                </span>
                {hourlyLoading && <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>updating…</span>}
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink-soft)' }}>IST hours • 09:00–21:00 working window</span>
              </div>
            </div>

            {/* Two side-by-side disposition tables (Connected / Non-Connected) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginBottom: 16 }}>
              {dispTable('Connected — by Disposition', '📞', '#16a34a', CONNECTED_STATUS_COLUMNS, 'connected_statuses', 'connected')}
              {dispTable('Non-Connected — by Disposition', '📵', '#dc2626', NOT_CONNECTED_STATUS_COLUMNS, 'non_connected_statuses', 'non_connected')}
            </div>

            {/* Productivity alerts: idle FROs by hour */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h3 style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#dc2626' }}>⚠️</span> Productivity Alerts — Idle Hours
                </h3>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                  <span style={{ fontSize: 10, color: 'var(--ink-soft)', fontWeight: 500 }}>{hourlyDate}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--bg)', color: 'var(--ink-soft)' }}>{hourlyAlerts.elapsed}/12 elapsed hrs</span>
                </div>
              </div>
              <div className="card-pad" style={{ padding: 0 }}>
                {hourlyLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>Loading productivity data...</div>
                ) : hourlyAlerts.elapsed === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>Working window hasn't started yet — alerts begin from 10:00 IST</div>
                ) : hourlyAlerts.idle.length === 0 && hourlyAlerts.noCalls.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: '#16a34a', fontWeight: 600 }}>All FROs made calls in every elapsed working hour</div>
                ) : (
                  <>
                    {hourlyAlerts.idle.length > 0 && (
                      <div style={{ padding: '10px 14px 4px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', marginBottom: 6 }}>
                          FROs with idle hours — zero calls during elapsed working hours
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 24, fontSize: 10, padding: '6px 8px', textAlign: 'left', color: 'var(--ink-soft)' }}>#</th>
                              <th style={{ fontSize: 10, padding: '6px 8px', textAlign: 'left', color: 'var(--ink-soft)' }}>FRO</th>
                              <th style={{ fontSize: 10, padding: '6px 8px', textAlign: 'center', color: 'var(--ink-soft)' }}>Idle Hours</th>
                              <th style={{ fontSize: 10, padding: '6px 8px', textAlign: 'right', color: 'var(--ink-soft)' }}>Calls</th>
                              <th style={{ fontSize: 10, padding: '6px 8px', textAlign: 'right', color: 'var(--ink-soft)' }}>Connected</th>
                              <th style={{ fontSize: 10, padding: '6px 8px', textAlign: 'left', color: 'var(--ink-soft)' }}>Idle Slots (IST)</th>
                              <th style={{ fontSize: 10, padding: '6px 8px', textAlign: 'center', color: 'var(--ink-soft)' }}>Alert</th>
                            </tr>
                          </thead>
                          <tbody>
                            {hourlyAlerts.idle.slice(0, showAllIdleAlerts ? hourlyAlerts.idle.length : 8).map((f, i) => (
                              <tr key={f.id} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ fontSize: 10, fontWeight: 700, color: i < 3 ? '#dc2626' : 'var(--ink-soft)', padding: '5px 8px' }}>{i + 1}</td>
                                <td style={{ fontWeight: 600, padding: '5px 8px' }}>{f.name}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                                  <span style={{
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 16, padding: '0 6px',
                                    borderRadius: 999, fontSize: 10, fontWeight: 700, animation: 'countPop .3s ease-out',
                                    background: f.idleSlots >= 4 ? '#fee2e2' : f.idleSlots >= 2 ? '#ffedd5' : '#fef9c3',
                                    color: f.idleSlots >= 4 ? '#dc2626' : f.idleSlots >= 2 ? '#ea580c' : '#a16207',
                                  }}>
                                    {f.idleSlots}
                                  </span>
                                </td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{f.calls}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>{f.connected}</td>
                                <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{idleRangesOf(f, hourlyAlerts.elapsed) || '—'}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                                  <button
                                    onClick={() => handleNotifyFro(f.id, f.name)}
                                    disabled={notifyingFroId === f.id}
                                    title={`Send idle alert to ${f.name}`}
                                    style={{ border: 'none', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: notifyingFroId === f.id ? 'default' : 'pointer', background: notifyingFroId === f.id ? '#fde68a' : '#d97706', color: '#fff' }}
                                  >
                                    {notifyingFroId === f.id ? '…' : 'Notify'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {hourlyAlerts.idle.length > 8 && (
                          <button onClick={() => setShowAllIdleAlerts(!showAllIdleAlerts)} style={{ width: '100%', padding: '6px 10px', border: 'none', fontSize: 10, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', background: 'var(--sage-soft)', color: 'var(--sage)', textAlign: 'center' }}>
                            {showAllIdleAlerts ? '▲ Show Less' : `View All ${hourlyAlerts.idle.length} FROs →`}
                          </button>
                        )}
                      </div>
                    )}
                    {hourlyAlerts.noCalls.length > 0 && !(hourlyAlerts.isToday && hourlyAlerts.elapsed === 0) && (
                      <div style={{ padding: '10px 14px', borderTop: hourlyAlerts.idle.length > 0 ? '1px solid var(--line)' : 'none' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 6 }}>
                          Zero calls {hourlyAlerts.isToday ? 'so far today' : 'this day'} — {hourlyAlerts.noCalls.length} FRO{hourlyAlerts.noCalls.length > 1 ? 's' : ''}
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {hourlyAlerts.noCalls.slice(0, 12).map(f => (
                            <span key={f.id} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262622' }}>{f.name}</span>
                          ))}
                          {hourlyAlerts.noCalls.length > 12 && (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--bg)', color: 'var(--ink-soft)' }}>+{hourlyAlerts.noCalls.length - 12} more</span>
                          )}
                        </div>
                        {!hourlyAlerts.isToday && <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 6 }}>Note: FROs on leave / absent that day will also appear here.</div>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <style>{`@keyframes countPop { 0% { transform: scale(.55); opacity: .3; } 60% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }`}</style>
          </>
        );
      })()}

      <style>{`@keyframes weakSpin { to { transform: rotate(360deg); } } .weak-spin { animation: weakSpin .6s linear infinite; transform-origin: center; }`}</style>

      {/* Section 6: Telecaller Performance Table */}
      {perfRows.length > 0 && (() => {
        const sc = (p) => FRO_STATUS_META[p.status] || FRO_STATUS_META.offline;
        const connSorted = [...perfRows].sort((a, b) => ((b.connected_range || 0) - (a.connected_range || 0)) || ((b.receivedAmount_range || 0) - (a.receivedAmount_range || 0)));
        const ncSorted = [...perfRows].sort((a, b) => {
          const na = a.non_connected_range ?? Math.max(0, (a.calls_range || 0) - (a.connected_range || 0));
          const nb = b.non_connected_range ?? Math.max(0, (b.calls_range || 0) - (b.connected_range || 0));
          return (nb - na) || ((b.receivedAmount_range || 0) - (a.receivedAmount_range || 0));
        });
        const fmt = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
        const nameCell = (p) => {
          const m = sc(p);
          const live = p.status === 'on_call' || p.status === 'online';
          return (
            <td style={{ padding: '10px', fontWeight: 600, whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span title={m.label} style={{ width: 8, height: 8, borderRadius: '50%', background: m.dot, display: 'inline-block', animation: live ? 'pulseDot 2s infinite' : 'none' }} />
                <span style={{ color: m.name || undefined }}>{p.fro_name}</span>
                {p.status === 'idle' && p.idleMinutes > 0 && (
                  <span
                    title={`No call activity for ${p.idleMinutes} min — click Notify to alert`}
                    onClick={(e) => { e.stopPropagation(); handleNotifyFro(p.fro_id, p.fro_name); }}
                    style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a', cursor: 'pointer', animation: 'countPop .3s ease-out', fontFamily: 'inherit' }}
                  >
                    Idle {p.idleMinutes}m{notifyingFroId === p.fro_id ? ' •…' : ''}
                  </span>
                )}
              </span>
            </td>
          );
        };
        const cntCell = (key, count, color, onClick) => (
          <td key={key} style={{ padding: '10px', textAlign: 'right', color: count > 0 ? color : 'var(--ink-soft)', fontWeight: 600, cursor: count > 0 ? 'pointer' : 'default', fontSize: 12 }}
            onClick={onClick}>
            <span style={{ textDecoration: count > 0 ? 'underline' : 'none', textUnderlineOffset: 2 }}>{count > 0 ? count : '—'}</span>
          </td>
        );
        const tH = (children, extra, cls) => (
          <th className={cls} style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg, #fff)', padding: '10px', fontSize: 10, textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 600, borderBottom: '2px solid var(--line)', ...extra }}>{children}</th>
        );
        const thSub = (label, sub, color, cls) => (
          <th className={cls} style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg, #fff)', padding: '10px', textAlign: 'right', color: color || '#3f4a38', fontWeight: 700, borderBottom: '2px solid var(--line)' }}>
            <span style={{ display: 'block', fontSize: 9, textTransform: 'uppercase', letterSpacing: .3 }}>{label}</span>
            {sub && <span style={{ display: 'block', fontSize: 8, color: 'var(--ink-soft)', fontWeight: 500 }}>{sub}</span>}
          </th>
        );
        const tabs = [
          { key: 'connected', label: 'Connected', count: perfTotals.connected, color: '#16a34a', suffix: PERIOD_LABELS[dashPeriod] },
          { key: 'non_connected', label: 'Non Connected', count: perfTotals.nonConnected, color: '#dc2626', suffix: PERIOD_LABELS[dashPeriod] },
        ];
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                Telecaller Performance
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-soft)' }}> — {perfRows.length} FROs</span>
              </h3>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Search FRO name..."
                  value={froSearch}
                  onChange={e => setFroSearch(e.target.value)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 11, fontFamily: 'inherit', outline: 'none', width: 150, background: 'var(--bg)', color: 'var(--ink)' }}
                />
                <button
                  onClick={handleTelecallerExport}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', border: 'none', background: 'var(--sage)', color: '#fff', cursor: 'pointer' }}
                  title="Export Day-wise summary and FRO hourly sheets"
                >
                  <Download width="12" height="12" />
                  Export Full Report (XLSX)
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '2px 16px 10px' }}>
              {tabs.map(t => {
                const active = perfTab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setPerfTab(t.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
                      border: active ? `1.5px solid ${t.color}` : '1px solid var(--line)',
                      background: active ? `${t.color}14` : 'var(--bg, #fff)',
                      color: active ? t.color : 'var(--ink-soft)',
                      fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      transition: 'all .18s ease',
                      boxShadow: active ? `0 2px 8px ${t.color}2e` : 'none',
                    }}
                  >
                    <span>●</span>
                    <span>{t.label}</span>
                    <span style={{
                      minWidth: 20, height: 18, padding: '0 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                      background: active ? t.color : 'var(--line)', color: '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background .18s ease', animation: 'countPop .3s ease-out',
                    }}>
                      <AnimatedNumber value={t.count} />
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 500, opacity: .75 }}>{t.suffix}</span>
                  </button>
                );
              })}
            </div>

            {/* View */}
            <div key={perfTab} className="perf-view">
              <div className="card-pad" style={{ padding: 0, overflowX: 'auto', maxHeight: 440, overflowY: 'auto' }}>

                {perfTab === 'connected' && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {tH('#', { textAlign: 'left' })}
                        {tH('Name', { textAlign: 'left' })}
                        {thSub('Connected Total', PERIOD_LABELS[dashPeriod], '#16a34a')}
                        {CONNECTED_STATUS_COLUMNS.map(c => thSub(c.label, PERIOD_LABELS[dashPeriod], c.color, 'perf-hide-mobile'))}
                        {thSub('Received Amount', PERIOD_LABELS[dashPeriod], '#3f4a38')}
                      </tr>
                    </thead>
                    <tbody>
                      {connSorted.map((p, i) => {
                        const total = p.connected_range || 0;
                        const statuses = p.connectedStatuses_range || {};
                        return (
                          <tr key={p.fro_id} className="perf-row-in" style={{ borderBottom: '1px solid var(--line)', animationDelay: `${Math.min(i, 10) * 25}ms` }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                            onMouseLeave={e => e.currentTarget.style.background = ''}>
                            <td style={{ padding: '10px', color: 'var(--ink-soft)', fontSize: 11 }}>{i + 1}</td>
                            {nameCell(p)}
                            {cntCell(`conn-total-${p.fro_id}`, total, '#16a34a', (e) => { e.stopPropagation(); if (total > 0) setSelectedFro({ froId: p.fro_id, froName: p.fro_name, filterType: 'connected' }); })}
                            {CONNECTED_STATUS_COLUMNS.map(col => {
                              const c = statuses[col.key] || 0;
                              return cntCell(col.key, c, col.color, (e) => { e.stopPropagation(); if (c > 0) setSelectedFro({ froId: p.fro_id, froName: p.fro_name, filterType: 'connected', status: col.key }); });
                            })}
                            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: (p.receivedAmount_range || 0) > 0 ? '#166534' : 'var(--ink-soft)' }}>
                              {fmt(p.receivedAmount_range)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {perfTab === 'non_connected' && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {tH('#', { textAlign: 'left' })}
                        {tH('Name', { textAlign: 'left' })}
                        {thSub('Non-Conn. Total', PERIOD_LABELS[dashPeriod], '#dc2626')}
                        {NOT_CONNECTED_STATUS_COLUMNS.map(c => thSub(c.label, PERIOD_LABELS[dashPeriod], c.color, 'perf-hide-mobile'))}
                        {thSub('Received Amount', PERIOD_LABELS[dashPeriod], '#3f4a38')}
                      </tr>
                    </thead>
                    <tbody>
                      {ncSorted.map((p, i) => {
                        const total = p.non_connected_range ?? Math.max(0, (p.calls_range || 0) - (p.connected_range || 0));
                        const statuses = p.notConnectedStatuses_range || {};
                        return (
                          <tr key={p.fro_id} className="perf-row-in" style={{ borderBottom: '1px solid var(--line)', animationDelay: `${Math.min(i, 10) * 25}ms` }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                            onMouseLeave={e => e.currentTarget.style.background = ''}>
                            <td style={{ padding: '10px', color: 'var(--ink-soft)', fontSize: 11 }}>{i + 1}</td>
                            {nameCell(p)}
                            {cntCell(`nc-total-${p.fro_id}`, total, '#dc2626', (e) => { e.stopPropagation(); if (total > 0) setSelectedFro({ froId: p.fro_id, froName: p.fro_name, filterType: 'non_connected' }); })}
                            {NOT_CONNECTED_STATUS_COLUMNS.map(col => {
                              const c = statuses[col.key] || 0;
                              return cntCell(col.key, c, col.color, (e) => { e.stopPropagation(); if (c > 0) setSelectedFro({ froId: p.fro_id, froName: p.fro_name, filterType: 'non_connected', status: col.key }); });
                            })}
                            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: (p.receivedAmount_range || 0) > 0 ? '#166534' : 'var(--ink-soft)' }}>
                              {fmt(p.receivedAmount_range)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

              </div>
            </div>

            <style>{`
              .perf-view { animation: perfFadeSlide .25s ease-out; }
              .perf-row-in { animation: perfRowIn .3s both; }
              @keyframes perfFadeSlide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
              @keyframes perfRowIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
              @keyframes countPop { 0% { transform: scale(.55); opacity: .3; } 60% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
              @keyframes pulseDot { 0% { box-shadow: 0 0 0 0 rgba(22,163,74,.45); } 70% { box-shadow: 0 0 0 7px rgba(22,163,74,0); } 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); } }
              @media (max-width: 768px) {
                .perf-hide-mobile { display: none !important; }
              }
            `}</style>
          </div>
        );
      })()}

      {/* Section 7: Follow-up Management */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head" style={{ cursor: 'pointer', flexWrap: 'wrap', gap: 8 }} onClick={() => setShowFollowups(!showFollowups)}>
          <h3 style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Follow-up Management
          </h3>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
            {[
              { key: 'overdue', label: 'Overdue', color: '#dc2626', bg: '#fef2f2' },
              { key: 'today', label: 'Due Today', color: '#ea580c', bg: '#fff7ed' },
              { key: 'tomorrow', label: 'Tomorrow', color: '#2563eb', bg: '#eff6ff' },
            ].map(c => (
              <span key={c.key} title={`${c.label} follow-ups across all FROs`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: c.bg, color: c.color, border: `1px solid ${c.color}22` }}>
                {c.label}
                <span style={{ background: c.color, color: '#fff', borderRadius: 999, minWidth: 16, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, padding: '0 4px', animation: 'countPop .3s ease-out' }}>
                  <AnimatedNumber value={bucketCountOf(c.key)} />
                </span>
              </span>
            ))}
            {followupLoading && (
              <span style={{ fontSize: 10, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth="3" strokeLinecap="round" className="weak-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" className="weak-spin-arc"/></svg>
              </span>
            )}
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)', padding: '2px 8px', borderRadius: 6, background: 'var(--bg)' }}>{showFollowups ? '▲ collapse' : '▼ expand'}</span>
          </div>
        </div>
        {showFollowups && (
          <div className="card-pad">
            {followupLoading && followups.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>Loading follow-ups...</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  {FOLLOWUP_BUCKETS.map(t => {
                    const count = bucketCountOf(t.key);
                    const active = followupMode === 'bucket' && followupTab === t.key;
                    return (
                      <button key={t.key} onClick={() => { setFollowupMode('bucket'); setFollowupTab(t.key); }} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
                        border: active ? `1.5px solid ${t.color}` : '1px solid var(--line)',
                        background: active ? `${t.color}14` : 'var(--bg, #fff)',
                        color: active ? t.color : 'var(--ink-soft)',
                        fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        transition: 'all .18s ease',
                        boxShadow: active ? `0 2px 8px ${t.color}2e` : 'none',
                      }}>
                        <span>●</span>
                        <span>{t.label}</span>
                        <span style={{ minWidth: 20, height: 18, padding: '0 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: active ? t.color : 'var(--line)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'background .18s ease', animation: 'countPop .3s ease-out' }}>
                          <AnimatedNumber value={count} />
                        </span>
                      </button>
                    );
                  })}
                  <span style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 4px' }} />
                  <button onClick={() => { setFollowupMode('daywise'); setFollowupTab(''); }} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, fontFamily: 'inherit',
                    border: followupMode === 'daywise' ? '1.5px solid #5B6B4E' : '1px solid var(--line)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    background: followupMode === 'daywise' ? '#e8ede1' : 'var(--bg, #fff)',
                    color: followupMode === 'daywise' ? '#3f4a38' : 'var(--ink-soft)',
                    boxShadow: followupMode === 'daywise' ? '0 2px 8px #5B6B4E2e' : 'none',
                    transition: 'all .18s ease',
                  }}>
                    📅 Day-wise
                  </button>
                </div>
                {followupMode === 'daywise' ? (
                  (() => {
                    const todayStr = toIstDate();
                    const yesterdayStr = toIstDate(new Date(Date.now() - 86400000));
                    const totalDay = daywiseRows.length;
                    return (
                      <div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                          {[{ label: 'Today', value: todayStr }, { label: 'Yesterday', value: yesterdayStr }].map(opt => (
                            <button key={opt.label} onClick={() => setFollowupDay(opt.value)} style={{
                              padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                              border: followupDay === opt.value ? '1.5px solid #5B6B4E' : '1px solid var(--line)',
                              background: followupDay === opt.value ? '#e8ede1' : '#fff',
                              color: followupDay === opt.value ? '#3f4a38' : 'var(--ink-soft)',
                            }}>{opt.label}</button>
                          ))}
                          <input
                            type="date"
                            value={followupDay}
                            max={todayStr}
                            onChange={e => setFollowupDay(e.target.value)}
                            style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 11, fontFamily: 'inherit', outline: 'none', background: 'var(--bg)', color: 'var(--ink)' }}
                          />
                          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{totalDay} record{totalDay !== 1 ? 's' : ''}</span>
                        </div>
                        {daywiseLoading ? (
                          <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>Loading follow-ups...</div>
                        ) : daywiseSummary.length === 0 ? (
                          <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>No follow-ups or callbacks on {followupDay}</div>
                        ) : (
                          <FollowupSummaryTable
                            summary={daywiseSummary}
                            hint={`${totalDay} record${totalDay !== 1 ? 's' : ''} — click a telecaller to view that day's donors`}
                            onSelect={setFupDetailWorker}
                          />
                        )}
                      </div>
                    );
                  })()
) : (
                  (() => {
                    const tabLabel = FOLLOWUP_TAB_LABELS[followupTab] || followupTab;
                    if (bucketSummary.length === 0) return <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>No {tabLabel} follow-ups</div>;
                    return (
                      <FollowupSummaryTable
                        summary={bucketSummary}
                        hint={`${bucketRows.length} record${bucketRows.length !== 1 ? 's' : ''} in ${tabLabel} — click a telecaller to view donors`}
                        onSelect={setFupDetailWorker}
                      />
                    );
                  })()
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Call Connectivity Widget removed */}

      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--ink-soft)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        Donor Health
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 20 }}>

        <div className="card" style={{ marginBottom: 0, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500, flex: 1 }}>Active Donors</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#8b5cf6' }}>{active_donors}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Donated within last 1 year</div>
        </div>

        <div className="card" style={{ marginBottom: 0, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></svg>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500, flex: 1 }}>Inactive Donors</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#f97316' }}>{inactive_donors}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>No donation in last 1 year</div>
        </div>

        <div className="card" style={{ marginBottom: 0, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500, flex: 1 }}>Reactivated Today</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b' }}>{reactivated_today}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Inactive to active today</div>
        </div>

        <div className="card" style={{ marginBottom: 0, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500, flex: 1 }}>Reactivated Month</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6' }}>{reactivated_monthly}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Inactive to active this month</div>
        </div>
      </div>

    
      {selectedStation && (
        <StationDetailModal
          station={selectedStation}
          stats={stations[selectedStation]}
          stationInfo={stationInfoMap[selectedStation]}
          onClose={() => setSelectedStation(null)}
        />
      )}

      {fupDetailWorker && (
        <FollowupDetailModal
          worker={fupDetailWorker}
          label={followupMode === 'daywise' ? followupDay : (FOLLOWUP_TAB_LABELS[followupTab] || followupTab)}
          onClose={() => setFupDetailWorker(null)}
        />
      )}

      {selectedPeriod && (
        <CollectionDetailModal
          period={selectedPeriod}
          totalAmount={selectedPeriod === 'month' ? month_collection : today_collection}
          onClose={() => setSelectedPeriod(null)}
        />
      )}

      {selectedStatus && (
        <CollectionDetailModal
          status={selectedStatus}
          monthAmount={selectedStatus === 'verified' ? verified_month_amount : unverified_month_amount}
          monthCount={selectedStatus === 'verified' ? verified_month_count : unverified_month_count}
          todayAmount={selectedStatus === 'verified' ? verified_today_amount : unverified_today_amount}
          todayCount={selectedStatus === 'verified' ? verified_today_count : unverified_today_count}
          onClose={() => setSelectedStatus(null)}
        />
      )}

      {selectedFro && (
        <FroDetailModal
          froId={selectedFro.froId}
          froName={selectedFro.froName}
          filterType={selectedFro.filterType}
          status={selectedFro.status}
          rangeFrom={activeRange.from}
          rangeTo={activeRange.to}
          onClose={() => setSelectedFro(null)}
        />
      )}

      <RecentNotices limit={5} />
    </div>
  );
}

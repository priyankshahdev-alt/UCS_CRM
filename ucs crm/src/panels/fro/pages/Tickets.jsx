import { useState, useEffect, useRef } from 'react';
import { api } from '../../../api/auth';
import { toast } from '../../../components/Toast';

const DEPARTMENTS = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'developers', label: 'Developers' },
  { value: 'hr', label: 'HR' },
  { value: 'fro', label: 'FRO' },
];

const CATEGORIES = [
  { value: 'suspense', label: 'Suspense' },
  { value: 'payment_issue', label: 'Payment Issue' },
  { value: 'technical', label: 'Technical' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const STATUS_COLORS = {
  open: { bg: '#fefce8', color: '#a16207' },
  in_progress: { bg: '#eff6ff', color: '#1d4ed8' },
  resolved: { bg: '#f0fdf4', color: '#16a34a' },
  closed: { bg: '#f3f4f6', color: '#6b7280' },
};

const PANEL_LABELS = {
  fro: 'FRO',
  accounts: 'Accounts',
  hr: 'HR',
  dev_panel: 'Developer',
  ngo_admin: 'NGO Admin',
  event_head: 'Event Head',
  recruiter: 'Recruiter',
  other: 'Other',
};

const apiGet = (p) => api(p, { _prefix: 'ucs' });
const apiPost = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b), _prefix: 'ucs' });

export default function FroTickets() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showRaise, setShowRaise] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [form, setForm] = useState({
    department: 'accounts',
    category: 'suspense',
    subject: '',
    description: '',
    reference_id: '',
    priority: 'medium',
    desk_number: '',
    ngo: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [deskLoading, setDeskLoading] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formErrors, setFormErrors] = useState({});

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const [regularTickets, devTickets] = await Promise.all([
        apiGet('/tickets/my').catch(() => []),
        apiGet('/developer-tickets/my').catch(() => []),
      ]);
      const allTickets = [
        ...(regularTickets || []).map(t => ({ ...t, _source: 'regular' })),
        ...(devTickets || []).map(t => ({ ...t, _source: 'developer' })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setTickets(allTickets);
      setLastUpdated(new Date());
    } catch (err) { console.error(err); }
    finally { setRefreshing(false); setLoading(false); }
  };

  const fetchMyAsset = async () => {
    setDeskLoading(true);
    try {
      const assets = await apiGet('/assets/my-assigned').catch(() => []);
      const asset = Array.isArray(assets) ? assets[0] : null;
      if (asset) {
        setForm(p => ({
          ...p,
          desk_number: p.desk_number || asset.code || '',
          ngo: p.ngo || asset.location || '',
        }));
      }
    } catch (err) { /* silent */ }
    finally { setDeskLoading(false); }
  };

  useEffect(() => { fetchMyAsset(); }, []);

  useEffect(() => { setPage(1); }, [tickets.length]);

  const totalPages = Math.ceil(tickets.length / pageSize);
  const paginatedTickets = tickets.slice((page - 1) * pageSize, page * pageSize);
  const counts = {
    open: tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    closed: tickets.filter(t => t.status === 'closed').length,
  };

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 30000);
    return () => clearInterval(id);
  }, []);

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
          desk_number: form.desk_number,
          ngo: form.ngo,
          raised_by_panel: 'fro',
        });
      } else {
        await apiPost('/tickets', { ...form, raised_by_panel: 'fro' });
      }
      toast('Ticket submitted successfully', 'success');
      setShowRaise(false);
      setForm({ department: 'accounts', category: 'suspense', subject: '', description: '', reference_id: '', priority: 'medium', desk_number: '', ngo: '' });
      setFormErrors({});
      load();
    } catch (err) { setFormErrors({ _general: err.message }); }
    finally { setSubmitting(false); }
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

  return (
    <div>
      <div className="card-head" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
          My Tickets
          <span style={{ fontWeight: 400, fontSize: 11, color: refreshing ? '#2563eb' : '#16a34a', marginLeft: 10 }}>
            ● {refreshing ? 'Syncing…' : 'Live'} {lastUpdated ? '· ' + lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
        </h3>
        <button className="btn btn-sm btn-primary" onClick={() => setShowRaise(true)}>
          + Raise Ticket
        </button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, padding: '14px 18px' }}>
          {[
            { label: 'Open', value: counts.open, color: '#a16207', bg: '#fefce8' },
            { label: 'In Progress', value: counts.in_progress, color: '#1d4ed8', bg: '#eff6ff' },
            { label: 'Resolved', value: counts.resolved, color: '#16a34a', bg: '#f0fdf4' },
            { label: 'Closed', value: counts.closed, color: '#6b7280', bg: '#f3f4f6' },
          ].map(s => (
            <div key={s.label} style={{ padding: '10px 12px', borderRadius: 8, background: s.bg, border: '1px solid ' + s.color + '22' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: s.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Department</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-soft)' }}>Loading...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-soft)' }}>No tickets raised yet</td></tr>
              ) : paginatedTickets.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-soft)' }}>No tickets on this page</td></tr>
              ) : (
                paginatedTickets.map(t => (
                  <tr key={t.id}>
                    <td><strong style={{ fontSize: 13 }}>{t.subject}</strong></td>
                    <td>
                      <span className="pill" style={{
                        textTransform: 'capitalize',
                        fontSize: 11,
                        background: t._source === 'developer' ? '#eef2ff' : undefined,
                        color: t._source === 'developer' ? '#4338ca' : undefined,
                      }}>
                        {t._source === 'developer' ? 'Dev' : t.department}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, textTransform: 'capitalize' }}>{CATEGORIES.find(c => c.value === t.category)?.label || t.category}</td>
                    <td>
                      <span className={`pill ${t.priority === 'high' ? 'pill-red' : t.priority === 'medium' ? 'pill-yellow' : 'pill-gray'}`} style={{ textTransform: 'capitalize', fontSize: 11 }}>
                        {t.priority}
                      </span>
                    </td>
                    <td>
                      <span className="pill" style={{ background: STATUS_COLORS[t.status]?.bg || '#f3f4f6', color: STATUS_COLORS[t.status]?.color || '#6b7280', textTransform: 'capitalize', fontSize: 11 }}>
                        {t.status?.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ fontSize: 11 }}>{new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td>
                      <button className="btn btn-sm" onClick={() => openDetail(t)} style={{ fontSize: 11, padding: '2px 8px' }}>
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {tickets.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Rows:</span>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid var(--line)', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer' }}>
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span style={{ marginLeft: 4 }}>Showing {Math.min((page - 1) * pageSize + 1, tickets.length)}&ndash;{Math.min(page * pageSize, tickets.length)} of {tickets.length}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                style={{ padding: '3px 10px', fontSize: 11, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1 }}>
                Prev
              </button>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{page} / {totalPages || 1}</span>
              <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                style={{ padding: '3px 10px', fontSize: 11, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1 }}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {showRaise && (
        <div className="modal-overlay" onClick={() => setShowRaise(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <h3>Raise a Ticket</h3>
              <button className="btn btn-sm btn-icon" onClick={() => setShowRaise(false)} style={{ padding: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              {formErrors._general && (
                <div style={{ padding: '8px 12px', marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>
                  {formErrors._general}
                </div>
              )}
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
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                  Desk Number *
                  <input value={form.desk_number} onChange={e => { setForm(p => ({ ...p, desk_number: e.target.value })); if (formErrors.desk_number) setFormErrors(p => { const n = { ...p }; delete n.desk_number; return n; }); }} placeholder={deskLoading ? 'Fetching your desk...' : 'Auto-filled from your desk'} style={formErrors.desk_number ? { borderColor: '#dc2626' } : undefined} />
                  {formErrors.desk_number && <div style={{ color: '#dc2626', fontSize: 11, marginTop: 3 }}>{formErrors.desk_number}</div>}
                </label>
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                  NGO
                  <input value={form.ngo} onChange={e => setForm(p => ({ ...p, ngo: e.target.value }))} placeholder={deskLoading ? 'Fetching...' : 'Auto-filled from your desk'} />
                </label>
              </div>
              <label className="field" style={{ marginBottom: 12 }}>
                Subject *
                <input value={form.subject} onChange={e => { setForm(p => ({ ...p, subject: e.target.value })); if (formErrors.subject) setFormErrors(p => { const n = { ...p }; delete n.subject; return n; }); }}
                  placeholder="Brief title of the issue"
                  style={formErrors.subject ? { borderColor: '#dc2626' } : undefined} />
                {formErrors.subject && <div style={{ color: '#dc2626', fontSize: 11, marginTop: 3 }}>{formErrors.subject}</div>}
              </label>
              <label className="field" style={{ marginBottom: 12 }}>
                Description
                <div style={{ position: 'relative' }}>
                  <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Describe the issue in detail..." maxLength={200} rows={4} style={{ padding: '10px 12px', paddingRight: 56, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
                  <span style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 10, fontWeight: 600, color: form.description.length > 180 ? '#dc2626' : 'var(--ink-soft)' }}>
                    {form.description.length}/200
                  </span>
                </div>
              </label>
            </div>
            <div className="modal-foot" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowRaise(false)}
                style={{ padding: '8px 20px', color: '#dc2626', border: '1px solid #dc2626', borderRadius: 6, background: '#fff', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', transition: 'all .15s' }}
                onMouseOver={e => { e.currentTarget.style.background = '#fef2f2'; }}
                onMouseOut={e => { e.currentTarget.style.background = '#fff'; }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleRaise} disabled={submitting}
                style={{ padding: '8px 20px', fontSize: 12, borderRadius: 6 }}>
                {submitting ? 'Submitting...' : 'Submit Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDetail && (
        <div className="modal-overlay" onClick={() => setShowDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head" style={{ flexShrink: 0 }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>{showDetail.subject}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span className="pill" style={{ background: STATUS_COLORS[showDetail.status]?.bg || '#f3f4f6', color: STATUS_COLORS[showDetail.status]?.color || '#6b7280', textTransform: 'capitalize', fontSize: 10 }}>
                    {showDetail.status?.replace('_', ' ')}
                  </span>
                  <span className="pill" style={{ textTransform: 'capitalize', fontSize: 10 }}>{showDetail.department}</span>
                  <span className="pill" style={{ textTransform: 'capitalize', fontSize: 10 }}>{CATEGORIES.find(c => c.value === showDetail.category)?.label || showDetail.category}</span>
                  <span className={`pill ${showDetail.priority === 'high' ? 'pill-red' : showDetail.priority === 'medium' ? 'pill-yellow' : 'pill-gray'}`} style={{ textTransform: 'capitalize', fontSize: 10 }}>
                    {showDetail.priority}
                  </span>
                </div>
              </div>
              <button className="btn btn-sm btn-icon" onClick={() => setShowDetail(null)} style={{ padding: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
              {showDetail.description && (
                <div style={{ padding: '10px 14px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', marginBottom: 14, fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {showDetail.description}
                </div>
              )}
              {showDetail.reference_id && (
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 14 }}>
                  Reference: <strong>{showDetail.reference_id}</strong>
                </div>
              )}
              {showDetail.resolution && (
                <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 'var(--radius-sm)', marginBottom: 14, fontSize: 13 }}>
                  <strong style={{ color: '#16a34a', fontSize: 12 }}>Resolution:</strong>
                  <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{showDetail.resolution}</div>
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Conversation</div>
                {replies.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>No replies yet</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {replies.map(r => (
                      <div key={r.id} style={{ padding: '10px 14px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                        <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>
                          {r.sender_panel ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span className="pill" style={{ fontSize: 10, fontWeight: 700, textTransform: 'capitalize', background: '#eef2ff', color: '#4338ca' }}>
                                {PANEL_LABELS[r.sender_panel] || r.sender_panel}
                              </span>
                              {r.sender_name && <span>{r.sender_name}</span>}
                              <span>&middot; {new Date(r.created_at).toLocaleString('en-IN')}</span>
                            </span>
                          ) : (
                            <>{r.sender_type === 'user' ? 'Accounts' : 'You'} &middot; {new Date(r.created_at).toLocaleString('en-IN')}</>
                          )}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{r.message}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(showDetail.status === 'open' || showDetail.status === 'in_progress') && (
                <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Type your reply..."
                      rows={2}
                      style={{ flex: 1, padding: '8px 10px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', resize: 'vertical' }}
                    />
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

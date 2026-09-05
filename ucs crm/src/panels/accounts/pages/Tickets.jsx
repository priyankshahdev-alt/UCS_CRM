import { useState, useEffect } from 'react';
import { apiGet, apiPut, apiPost } from '../api/auth';
import { toast } from '../../../components/Toast';

const DEPARTMENTS = ['accounts', 'developers', 'hr', 'fro'];
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

export default function AccountsTickets() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showDetail, setShowDetail] = useState(null);
  const [replies, setReplies] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [resolution, setResolution] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const [showRaise, setShowRaise] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deskLoading, setDeskLoading] = useState(false);
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
  const [formErrors, setFormErrors] = useState({});

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (deptFilter && deptFilter !== 'developers') params.set('department', deptFilter);
      const qs = params.toString();

      const promises = [apiGet(`/tickets${qs ? '?' + qs : ''}`)];

      if (!deptFilter || deptFilter === 'developers') {
        const devParams = new URLSearchParams();
        if (statusFilter) devParams.set('status', statusFilter);
        const devQs = devParams.toString();
        promises.push(apiGet(`/developer-tickets${devQs ? '?' + devQs : ''}`));
      } else {
        promises.push(Promise.resolve([]));
      }

      const [regularTickets, devTickets] = await Promise.all(promises);
      const allTickets = [
        ...(regularTickets || []).map(t => ({ ...t, _source: 'regular' })),
        ...(devTickets || []).map(t => ({ ...t, _source: 'developer' })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setTickets(allTickets);
      setLastUpdated(new Date());
    } catch (err) { console.error(err); }
    finally { setRefreshing(false); setLoading(false); }
  };

  useEffect(() => { load(); }, [statusFilter, deptFilter]);
  useEffect(() => {
    const id = setInterval(() => load(true), 30000);
    return () => clearInterval(id);
  }, [statusFilter, deptFilter]);

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
          raised_by_panel: 'accounts',
        });
      } else {
        await apiPost('/tickets', {
          department: form.department,
          category: form.category,
          subject: form.subject,
          description: form.description,
          reference_id: form.reference_id,
          priority: form.priority,
          desk_number: form.desk_number,
          ngo: form.ngo,
          raised_by_panel: 'accounts',
        });
      }
      toast('Ticket submitted successfully', 'success');
      setShowRaise(false);
      setForm({ department: 'accounts', category: 'technical', subject: '', description: '', reference_id: '', priority: 'medium', desk_number: form.desk_number, ngo: form.ngo });
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
      setResolution(data.resolution || '');
    } catch (err) { alert(err.message); }
  };

  const handleStatusUpdate = async (newStatus) => {
    if (!showDetail) return;
    try {
      const endpoint = showDetail._source === 'developer' ? '/developer-tickets' : '/tickets';
      await apiPut(`${endpoint}/${showDetail.id}`, {
        status: newStatus,
        resolution: newStatus === 'resolved' || newStatus === 'closed' ? resolution : undefined,
      });
      const data = await apiGet(`${endpoint}/${showDetail.id}`);
      setShowDetail(data);
      setReplies(data.replies || []);
      setResolution(data.resolution || '');
      load();
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

  const totalCount = tickets.length;
  const openCount = tickets.filter(t => t.status === 'open').length;
  const inProgressCount = tickets.filter(t => t.status === 'in_progress').length;
  const resolvedCount = tickets.filter(t => t.status === 'resolved').length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: refreshing ? '#2563eb' : '#16a34a', fontWeight: 600 }}>
          ● {refreshing ? 'Syncing…' : 'Live'} {lastUpdated ? '· ' + lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ' · auto-refresh 30s'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total', value: totalCount, color: '#6b7280' },
          { label: 'Open', value: openCount, color: '#a16207' },
          { label: 'In Progress', value: inProgressCount, color: '#1d4ed8' },
          { label: 'Resolved', value: resolvedCount, color: '#16a34a' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="filter-bar">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">All Departments</option>
            {DEPARTMENTS.map(d => (
              <option key={d} value={d} style={{ textTransform: 'capitalize' }}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>Refresh</button>
          <button className="btn btn-sm btn-primary" onClick={() => setShowRaise(true)}>+ Raise Ticket</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Raised By</th>
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
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-soft)' }}>Loading...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-soft)' }}>No tickets found</td></tr>
              ) : (
                tickets.map(t => (
                  <tr key={t.id}>
                    <td><strong style={{ fontSize: 13 }}>{t.subject}</strong></td>
                    <td style={{ fontSize: 12 }}>{t.workers?.name || t.raised_by_name || 'Unknown'}</td>
                    <td>
                      <span className="pill" style={{
                        textTransform: 'capitalize', fontSize: 11,
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
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
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
                  Desk Number *
                  <input value={form.desk_number} onChange={e => { setForm(p => ({ ...p, desk_number: e.target.value })); if (formErrors.desk_number) setFormErrors(p => { const n = { ...p }; delete n.desk_number; return n; }); }} placeholder={deskLoading ? 'Fetching your desk...' : 'Auto-filled from your desk'} style={formErrors.desk_number ? { borderColor: '#dc2626' } : undefined} />
                  {formErrors.desk_number && <div style={{ color: '#dc2626', fontSize: 11, marginTop: 3 }}>{formErrors.desk_number}</div>}
                </label>
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                  NGO
                  <input value={form.ngo} onChange={e => setForm(p => ({ ...p, ngo: e.target.value }))} placeholder={deskLoading ? 'Fetching...' : 'Auto-filled from your desk'} />
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
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head" style={{ flexShrink: 0 }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>{showDetail.subject}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <span className="pill" style={{ background: STATUS_COLORS[showDetail.status]?.bg || '#f3f4f6', color: STATUS_COLORS[showDetail.status]?.color || '#6b7280', textTransform: 'capitalize', fontSize: 10 }}>
                    {showDetail.status?.replace('_', ' ')}
                  </span>
                  <span className="pill" style={{ textTransform: 'capitalize', fontSize: 10 }}>{showDetail.department}</span>
                  <span className="pill" style={{ fontSize: 10 }}>{CATEGORIES.find(c => c.value === showDetail.category)?.label || showDetail.category}</span>
                  <span className={`pill ${showDetail.priority === 'high' ? 'pill-red' : showDetail.priority === 'medium' ? 'pill-yellow' : 'pill-gray'}`} style={{ textTransform: 'capitalize', fontSize: 10 }}>
                    {showDetail.priority}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
                  Raised by <strong>{showDetail.workers?.name || 'Unknown'}</strong> &middot; {new Date(showDetail.created_at).toLocaleString('en-IN')}
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

              {(showDetail.status === 'open' || showDetail.status === 'in_progress') && (
                <div style={{ marginBottom: 14, padding: '12px 14px', background: '#f8fafc', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Update Status & Resolution</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <textarea
                      value={resolution}
                      onChange={e => setResolution(e.target.value)}
                      placeholder="Add resolution notes..."
                      rows={2}
                      style={{ flex: 1, padding: '8px 10px', fontSize: 12, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {showDetail.status === 'open' && (
                      <button className="btn btn-sm" onClick={() => handleStatusUpdate('in_progress')}
                        style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                        Mark In Progress
                      </button>
                    )}
                    <button className="btn btn-sm" onClick={() => handleStatusUpdate('resolved')}
                      style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                      Resolve
                    </button>
                    <button className="btn btn-sm" onClick={() => handleStatusUpdate('closed')}
                      style={{ background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }}>
                      Close
                    </button>
                  </div>
                </div>
              )}

              {showDetail.resolution && (
                <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 'var(--radius-sm)', marginBottom: 14, fontSize: 13 }}>
                  <strong style={{ color: '#16a34a', fontSize: 12 }}>Resolution:</strong>
                  <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{showDetail.resolution}</div>
                  {showDetail.users && (
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-soft)' }}>
                      Resolved by {showDetail.users.name || showDetail.users.login_id || 'Unknown'}
                    </div>
                  )}
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
                            <>{r.sender_type === 'user' ? 'Accounts' : 'FRO'} &middot; {new Date(r.created_at).toLocaleString('en-IN')}</>
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
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Add Reply</div>
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

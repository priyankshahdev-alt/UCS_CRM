import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useUcs } from '../../../store';
import { getTicketBySource, updateTicketBySource, replyToTicketBySource, resolveTicketBySource, getDevAssignees } from '../api/tickets';

const STATUS_COLORS = {
  open: { bg: '#fefce8', color: '#a16207' },
  in_progress: { bg: '#eff6ff', color: '#1d4ed8' },
  under_review: { bg: '#f5f3ff', color: '#7c3aed' },
  resolved: { bg: '#f0fdf4', color: '#16a34a' },
  closed: { bg: '#f3f4f6', color: '#6b7280' },
};
const PRIORITY_COLORS = { low: '#6b7280', medium: '#d97706', high: '#ea580c', critical: '#dc2626' };
const PRIORITY_BG = { low: '#f3f4f6', medium: '#fefce8', high: '#fff7ed', critical: '#fef2f2' };
const CATEGORIES = {
  bug: 'Bug', feature_request: 'Feature Request', enhancement: 'Enhancement',
  data_issue: 'Data Issue', payment_issue: 'Payment Issue', technical: 'Technical', other: 'Other',
};
const PANEL_LABELS = {
  fro: 'FRO',
  accounts: 'Accounts',
  ngo_admin: 'NGO Admin',
  dev_panel: 'Developer',
  hr: 'HR',
  event_head: 'Event Head',
  recruiter: 'Recruiter',
  other: 'Other',
};

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUcs();
  const [ticket, setTicket] = useState(null);
  const [source, setSource] = useState(location.state?.source || null);
  const [loading, setLoading] = useState(true);
  const [assignees, setAssignees] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [resolution, setResolution] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const conversationRef = useRef(null);

  const isDigital = user?.department === 'digital' || user?.department === 'developers' || user?.role === 'super_admin';

  const loadTicket = async () => {
    setLoading(true);
    try {
      let src = source;
      if (!src) {
        // No source in nav state — try developer first, fall back to regular
        try {
          const devTicket = await getTicketBySource(id, 'developer');
          src = 'developer';
          setSource(src);
          setTicket({ ...devTicket, _source: 'developer' });
          setResolution(devTicket.resolution || '');
          setLoading(false);
          return;
        } catch {
          src = 'regular';
          setSource(src);
        }
      }
      const data = await getTicketBySource(id, src);
      setTicket({ ...data, _source: src });
      setResolution(data.resolution || '');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTicket(); }, [id]);
  useEffect(() => {
    getDevAssignees().then(setAssignees).catch(() => {});
  }, []);

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [ticket?.replies?.length]);

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await replyToTicketBySource(id, { message: replyText.trim(), is_internal: isDigital && isInternal }, source);
      setReplyText('');
      setIsInternal(false);
      await loadTicket();
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleStatusUpdate = async (newStatus) => {
    setStatusUpdating(true);
    try {
      if (newStatus === 'resolved') {
        if (!resolution || resolution.trim() === '') {
          alert('Please provide a resolution note');
          setStatusUpdating(false);
          return;
        }
        await resolveTicketBySource(id, resolution, source);
      } else {
        const updates = { status: newStatus };
        if ((newStatus === 'resolved' || newStatus === 'closed') && resolution) {
          updates.resolution = resolution;
        }
        await updateTicketBySource(id, updates, source);
      }
      await loadTicket();
    } catch (err) {
      alert(err.message);
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleAssign = async (assigneeId) => {
    try {
      await updateTicketBySource(id, { assigned_to: assigneeId || null }, source);
      await loadTicket();
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePriority = async (priority) => {
    try {
      await updateTicketBySource(id, { priority }, source);
      await loadTicket();
    } catch (err) {
      alert(err.message);
    }
  };

  const formatTime = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const timeAgo = (d) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const slaMetrics = () => {
    if (!ticket) return [];
    const items = [];
    items.push({ label: 'Created', value: formatTime(ticket.created_at), color: 'var(--ink-soft)' });

    if (ticket.first_response_at) {
      const mins = (new Date(ticket.first_response_at) - new Date(ticket.created_at)) / 60000;
      const color = mins < 60 ? '#16a34a' : mins < 240 ? '#d97706' : '#dc2626';
      items.push({ label: 'First Response', value: `${mins < 60 ? Math.round(mins) + 'm' : (mins / 60).toFixed(1) + 'h'}`, color });
    } else {
      items.push({ label: 'First Response', value: 'Pending', color: '#dc2626' });
    }

    if (ticket.resolved_at) {
      const mins = (new Date(ticket.resolved_at) - new Date(ticket.created_at)) / 60000;
      const color = mins < 240 ? '#16a34a' : mins < 1440 ? '#d97706' : '#dc2626';
      items.push({ label: 'Resolution', value: `${mins < 60 ? Math.round(mins) + 'm' : (mins / 1440).toFixed(1) + 'd'}`, color });
    } else if (ticket.status === 'resolved' || ticket.status === 'closed') {
      items.push({ label: 'Resolution', value: 'No timestamp', color: '#6b7280' });
    }

    return items;
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-soft)', fontSize: 12 }}>Loading ticket...</div>;
  if (!ticket) return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>Ticket not found</div>
      <button onClick={() => navigate('/dev-panel/tickets')} style={{ padding: '6px 14px', fontSize: 12, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--card-bg)', cursor: 'pointer', fontFamily: 'inherit' }}>
        Back to Tickets
      </button>
    </div>
  );

  const replies = ticket.replies || [];
  const isOpen = ticket.status === 'open' || ticket.status === 'in_progress' || ticket.status === 'under_review';

  return (
    <div>
      {/* Back Button + Header */}
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => navigate(-1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 0', fontSize: 12, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontFamily: 'inherit', marginBottom: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          Back
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                background: source === 'developer' ? '#eef2ff' : '#dcfce7',
                color: source === 'developer' ? '#4338ca' : '#166534',
              }}>
                {source === 'developer' ? `DEV-${ticket.id}` : `SUP-${ticket.id}`}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                background: source === 'developer' ? '#eef2ff' : '#dcfce7',
                color: source === 'developer' ? '#4338ca' : '#166534',
                textTransform: 'capitalize',
              }}>
                {source === 'developer' ? 'Developer' : 'Support'}
              </span>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 6 }}>{ticket.subject}</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                background: STATUS_COLORS[ticket.status]?.bg || '#f3f4f6', color: STATUS_COLORS[ticket.status]?.color || '#6b7280',
                textTransform: 'capitalize',
              }}>
                {(ticket.status || '').replace('_', ' ')}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                background: PRIORITY_BG[ticket.priority] || '#f3f4f6', color: PRIORITY_COLORS[ticket.priority] || '#6b7280',
                textTransform: 'capitalize',
              }}>
                {ticket.priority}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 10,
                background: '#f3f4f6', color: '#374151', textTransform: 'capitalize',
              }}>
                {CATEGORIES[ticket.category] || ticket.category}
              </span>
            </div>
          </div>

          {/* Action Bar */}
          {isDigital && isOpen && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
              {ticket.status === 'open' && (
                <button
                  onClick={() => handleStatusUpdate('in_progress')}
                  disabled={statusUpdating}
                  style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, border: '1px solid #bfdbfe', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Start Progress
                </button>
              )}
              {(ticket.status === 'in_progress' || ticket.status === 'open') && (
                <button
                  onClick={() => handleStatusUpdate('under_review')}
                  disabled={statusUpdating}
                  style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, border: '1px solid #ddd6fe', borderRadius: 6, background: '#f5f3ff', color: '#7c3aed', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Send for Review
                </button>
              )}
              <button
                onClick={() => handleStatusUpdate('resolved')}
                disabled={statusUpdating}
                style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, border: '1px solid #bbf7d0', borderRadius: 6, background: '#f0fdf4', color: '#16a34a', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Resolve
              </button>
              <button
                onClick={() => handleStatusUpdate('closed')}
                disabled={statusUpdating}
                style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb', color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14 }}>
        {/* Left: Conversation */}
        <div>
          {/* Description */}
          {ticket.description && (
            <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--line)', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Description</div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{ticket.description}</div>
            </div>
          )}

          {/* Resolution */}
          {ticket.resolution && (
            <div style={{ padding: '14px 16px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Resolution</div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{ticket.resolution}</div>
            </div>
          )}

          {/* Resolution input (for digital users when resolving) */}
          {isDigital && (ticket.status === 'in_progress' || ticket.status === 'under_review') && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: '#f8fafc', border: '1px solid var(--line)', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Resolution Notes</div>
              <textarea
                value={resolution}
                onChange={e => setResolution(e.target.value)}
                placeholder="Describe the resolution..."
                rows={2}
                style={{ width: '100%', padding: '8px 10px', fontSize: 12, border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
          )}

          {/* Conversation Thread */}
          <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>
              Conversation
              {replies.length > 0 && <span style={{ fontWeight: 400, color: 'var(--ink-soft)', marginLeft: 6 }}>({replies.length})</span>}
            </div>

            <div ref={conversationRef} style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              {replies.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', padding: 20 }}>No replies yet</div>
              ) : (
                replies.map(r => {
                  const isMe = r.sender_id === user?.id;
                  const isInternal = r.is_internal;
                  const panelLabel = PANEL_LABELS[r.sender_panel] || r.sender_panel;

                  return (
                    <div key={r.id} style={{
                      padding: '10px 14px', borderRadius: 8,
                      background: isInternal ? '#fefce8' : isMe ? '#eef2ff' : 'var(--bg)',
                      border: isInternal ? '1px dashed #d97706' : '1px solid transparent',
                      maxWidth: '85%', alignSelf: isMe ? 'flex-end' : 'flex-start',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600 }}>{r.sender_name || panelLabel || 'Reply'}</span>
                        {r.sender_panel && (
                          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'capitalize', padding: '1px 7px', borderRadius: 999, background: '#eef2ff', color: '#4338ca' }}>
                            {panelLabel || r.sender_panel}
                          </span>
                        )}
                        {isInternal && (
                          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>
                            Internal Note
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{timeAgo(r.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{r.message}</div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reply Box */}
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={isDigital && isInternal ? 'Type an internal note (only visible to dev team)...' : 'Type your reply...'}
                    rows={3}
                    style={{ flex: 1, padding: '10px 12px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply(); }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isDigital && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: 'var(--ink-soft)' }}>
                        <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                        Internal note
                      </label>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>Ctrl+Enter to send</span>
                  </div>
                  <button
                    onClick={handleReply}
                    disabled={sending || !replyText.trim()}
                    style={{
                      padding: '7px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6,
                      background: replyText.trim() ? '#6366f1' : '#c7d2fe',
                      color: replyText.trim() ? '#fff' : '#6b7280',
                      cursor: replyText.trim() && !sending ? 'pointer' : 'default',
                      fontFamily: 'inherit',
                    }}
                  >
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar: Meta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Raised By */}
          <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Ticket Info</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              <div>
                <div style={{ color: 'var(--ink-soft)', fontSize: 10, marginBottom: 2 }}>Raised By</div>
                <div style={{ fontWeight: 600 }}>{ticket.workers?.name || ticket.raised_by_name || 'Unknown'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--ink-soft)', fontSize: 10, marginBottom: 2 }}>Source</div>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  background: source === 'developer' ? '#eef2ff' : '#dcfce7',
                  color: source === 'developer' ? '#4338ca' : '#166534',
                  textTransform: 'capitalize', display: 'inline-block',
                }}>
                  {source === 'developer' ? (PANEL_LABELS[ticket.raised_by_panel] || 'Developer') : (ticket.department || 'Support')}
                </span>
              </div>
              {ticket.reference_id && (
                <div>
                  <div style={{ color: 'var(--ink-soft)', fontSize: 10, marginBottom: 2 }}>Reference ID</div>
                  <div style={{ fontWeight: 600 }}>{ticket.reference_id}</div>
                </div>
              )}
              <div>
                <div style={{ color: 'var(--ink-soft)', fontSize: 10, marginBottom: 2 }}>Created</div>
                <div>{formatTime(ticket.created_at)}</div>
              </div>
              {ticket.updated_at !== ticket.created_at && (
                <div>
                  <div style={{ color: 'var(--ink-soft)', fontSize: 10, marginBottom: 2 }}>Last Updated</div>
                  <div>{formatTime(ticket.updated_at)}</div>
                </div>
              )}
            </div>
          </div>

          {/* SLA */}
          <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>SLA Metrics</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {slaMetrics().map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{m.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: m.color }}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Assigned To */}
          {source === 'developer' ? (
            <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Assigned To</div>
              {isDigital ? (
                <select
                  value={ticket.assigned_to || ''}
                  onChange={e => handleAssign(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'inherit', background: 'var(--card-bg)' }}
                >
                  <option value="">Unassigned</option>
                  {assignees.map(a => <option key={a.id} value={a.id}>{a.name || a.login_id}</option>)}
                </select>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {ticket.assigned_worker ? (ticket.assigned_worker.name || ticket.assigned_worker.login_id) : (
                    <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>Unassigned</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Department</div>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{ticket.department || '—'}</div>
            </div>
          )}

          {/* Priority */}
          {isDigital && (
            <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Priority</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {['low', 'medium', 'high', 'critical'].map(p => (
                  <button
                    key={p}
                    onClick={() => handlePriority(p)}
                    style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                      border: ticket.priority === p ? `1px solid ${PRIORITY_COLORS[p]}` : '1px solid var(--line)',
                      background: ticket.priority === p ? PRIORITY_BG[p] : 'transparent',
                      color: ticket.priority === p ? PRIORITY_COLORS[p] : 'var(--ink-soft)',
                      cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

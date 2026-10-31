import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../api/auth';
import WhatsAppThread, { WhatsAppThreadEmpty } from './WhatsAppThread';
import './whatsAppChat.css';

const ACCOUNT_COLORS = ['#0866FF', '#7B5CFA', '#0B6B3A', '#F97316', '#dc2626', '#0ea5e9'];

function accountColor(acc) {
  if (!acc) return '#667781';
  let h = 0;
  for (let i = 0; i < acc.length; i += 1) h = (h * 31 + acc.charCodeAt(i)) >>> 0;
  return ACCOUNT_COLORS[h % ACCOUNT_COLORS.length];
}

function initials(name, phone) {
  const source = String(name || '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }
  return String(phone || '').replace(/\D/g, '').slice(-2) || 'WA';
}

function chatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((today - target) / 86400000);

  if (diffDays === 0) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString('en-IN', { weekday: 'short' });
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function previewOf(thread) {
  const text = String(thread.replyText || thread.lastMessage || '').trim();
  if (!text) return 'No messages yet';
  return text;
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10" />
      <path d="M20.5 15a9 9 0 0 1-14.9 3.4L1 14" />
    </svg>
  );
}

function IconNewChat() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z" />
      <line x1="12" y1="8" x2="12" y2="14" />
      <line x1="9" y1="11" x2="15" y2="11" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconTicks() {
  return (
    <svg width="15" height="11" viewBox="0 0 26 20" fill="none" stroke="#53bdeb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="2,10 6.5,14.5 15,5" />
      <polyline points="9,11.5 11,14.5 20.5,4" />
    </svg>
  );
}

export default function WhatsAppChatWindow() {
  const [accounts, setAccounts] = useState([]);
  const [threads, setThreads] = useState([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);

  const [showNewChat, setShowNewChat] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newAccountId, setNewAccountId] = useState('all');
  const [newError, setNewError] = useState(null);

  useEffect(() => {
    apiGet('/whatsapp/accounts')
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => setAccounts([]));
  }, []);

  const loadThreads = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoadingThreads(true);
      setLoadError(null);
    }
    try {
      const qs = accountFilter !== 'all' ? `?accountId=${encodeURIComponent(accountFilter)}` : '';
      const data = await apiGet(`/whatsapp/chats${qs}`);
      setThreads(Array.isArray(data) ? data : []);
      if (!silent) setLoadError(null);
    } catch (e) {
      if (!silent) {
        setThreads([]);
        setLoadError(e?.message || 'Failed to load chats');
      }
    } finally {
      if (!silent) setLoadingThreads(false);
    }
  }, [accountFilter]);

  useEffect(() => {
    loadThreads();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      loadThreads({ silent: true });
    }, 20000);
    return () => clearInterval(timer);
  }, [loadThreads]);

  const filtered = threads.filter((thread) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [thread.phone, thread.recipientName, thread.lastMessage, thread.replyText, thread.accountName, thread.project]
      .some((value) => String(value || '').toLowerCase().includes(q));
  });

  const handleSelect = (thread) => {
    setSelected(thread);
    setMobileShowChat(true);
  };

  const handleCloseThread = () => {
    setSelected(null);
    setMobileShowChat(false);
  };

  const startNewChat = () => {
    const phone = newPhone.trim();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setNewError('Enter a valid phone number with country code (at least 10 digits).');
      return;
    }
    const account = accounts.find((a) => String(a.id) === String(newAccountId));
    const thread = {
      phone,
      recipientName: newName.trim(),
      accountId: account?.id || null,
      accountName: account?.name || '',
      project: account?.project || null,
      lastMessage: '',
      lastAt: new Date().toISOString(),
      direction: 'outbound',
    };
    setThreads((prev) => [thread, ...prev.filter((t) => t.phone !== phone)]);
    setSelected(thread);
    setMobileShowChat(true);
    setShowNewChat(false);
    setNewPhone('');
    setNewName('');
    setNewAccountId('all');
    setNewError(null);
  };

  const exportToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = threads.filter((thread) => thread.hasReply);
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = ['Phone,Name,Account,RepliedAt,ReplyMessage']
      .concat(rows.map((thread) => [
        escape(thread.phone),
        escape(thread.recipientName || thread.phone),
        escape(thread.accountName || thread.project || ''),
        escape(thread.lastReplyAt || ''),
        escape(thread.replyText || ''),
      ].join(',')))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `whatsapp_replies_${today}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const activeThread = selected?.phone;

  return (
    <div className={`wac-root ${mobileShowChat ? 'is-chatting' : ''}`}>
      <aside className="wac-sidebar">
        <div className="wac-sidebar-head">
          <div className="wac-sidebar-title">
            <h3>
              Chats
              {threads.length > 0 && (
                <span style={{ marginLeft: 7, fontSize: 11, fontWeight: 700, color: '#667781' }}>{threads.length}</span>
              )}
            </h3>
            <div className="wac-sidebar-actions">
              <button
                type="button"
                className="wac-icon-btn"
                title="New chat"
                onClick={() => { setShowNewChat(true); setNewError(null); }}
              >
                <IconNewChat />
              </button>
              <button
                type="button"
                className="wac-icon-btn"
                title="Refresh chats"
                onClick={() => loadThreads()}
              >
                <IconRefresh />
              </button>
            </div>
          </div>

          <div className="wac-search-wrap">
            <IconSearch />
            <input
              className="wac-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, number or message"
            />
          </div>

          <div className="wac-chips">
            <button
              type="button"
              className={`wac-chip ${accountFilter === 'all' ? 'is-active' : ''}`}
              style={accountFilter === 'all' ? { background: '#00a884' } : undefined}
              onClick={() => setAccountFilter('all')}
            >
              All
            </button>
            {accounts.map((account) => {
              const active = accountFilter === String(account.id);
              const color = accountColor(account.name);
              return (
                <button
                  key={account.id}
                  type="button"
                  className={`wac-chip ${active ? 'is-active' : ''}`}
                  style={active ? { background: color } : undefined}
                  onClick={() => setAccountFilter(String(account.id))}
                >
                  <span className="wac-chip-dot" style={{ background: active ? '#fff' : color }} />
                  {account.name}
                </button>
              );
            })}
            <button type="button" className="wac-refresh-link" onClick={exportToday} title="Download replied chats as CSV">
              Export replies
            </button>
          </div>
        </div>

        <div className="wac-list">
          {loadingThreads && Array.from({ length: 7 }).map((_, index) => (
            <div className="wac-skeleton-row" key={index}>
              <div className="wac-skeleton av" />
              <div style={{ flex: 1 }}>
                <div className="wac-skeleton l1" />
                <div className="wac-skeleton l2" />
              </div>
            </div>
          ))}

          {!loadingThreads && loadError && (
            <div className="wac-empty-list">
              <strong style={{ color: '#dc2626' }}>Could not load chats</strong>
              {loadError}
              <div style={{ marginTop: 10 }}>
                <button type="button" className="wac-quick" onClick={() => loadThreads()}>Retry</button>
              </div>
            </div>
          )}

          {!loadingThreads && !loadError && filtered.length === 0 && (
            <div className="wac-empty-list">
              {search.trim() ? (
                <>
                  <strong>No matching chats</strong>
                  Try a different name or number.
                </>
              ) : (
                <>
                  <strong>No chats yet</strong>
                  Send a bulk message, wait for a reply, or start a new chat.
                  <div style={{ marginTop: 12 }}>
                    <button type="button" className="wac-quick" onClick={() => setShowNewChat(true)}>Start a new chat</button>
                  </div>
                </>
              )}
            </div>
          )}

          {!loadingThreads && !loadError && filtered.map((thread) => {
            const active = activeThread === thread.phone;
            const color = accountColor(thread.accountName || thread.project);
            return (
              <div
                key={thread.phone}
                className={`wac-row ${active ? 'is-active' : ''}`}
                onClick={() => handleSelect(thread)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelect(thread); }}
              >
                <div className="wac-avatar" style={{ background: color }}>
                  {initials(thread.recipientName, thread.phone)}
                  {thread.hasReply && <span className="wac-avatar-dot" />}
                </div>

                <div className="wac-row-main">
                  <div className="wac-row-top">
                    <span className="wac-row-name">{thread.recipientName || thread.phone}</span>
                    <span className={`wac-row-time ${isToday(thread.lastAt) ? 'is-new' : ''}`}>{chatTime(thread.lastAt)}</span>
                  </div>

                  <div className="wac-row-preview" title={previewOf(thread)}>
                    {thread.direction === 'outbound' && <IconTicks />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {previewOf(thread)}
                    </span>
                  </div>

                  <div className="wac-row-foot">
                    <span className="wac-badge">{thread.accountName || thread.project || 'WhatsApp'}</span>
                    {thread.recipientName && <span className="wac-badge">{thread.phone}</span>}
                    {thread.hasReply && (
                      <span className="wac-badge" style={{ background: '#dcfce7', color: '#15803d' }}>Replied</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <main className="wac-main">
        {selected ? (
          <WhatsAppThread
            key={`${selected.phone}-${selected.accountId || 'all'}`}
            phone={selected.phone}
            accountId={selected.accountId || undefined}
            accounts={accounts}
            contactName={selected.recipientName || ''}
            onClose={handleCloseThread}
            onBack={() => setMobileShowChat(false)}
            onMessageSent={() => { loadThreads({ silent: true }); }}
          />
        ) : (
          <WhatsAppThreadEmpty />
        )}
      </main>

      {showNewChat && (
        <div
          className="wac-modal-overlay"
          style={{ zIndex: 2500 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNewChat(false); }}
        >
          <div className="wac-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="wac-dialog-head">
              <h3>New chat</h3>
              <button type="button" onClick={() => setShowNewChat(false)} aria-label="Close">×</button>
            </div>

            <div className="wac-dialog-body">
              <label htmlFor="wac-new-phone">WhatsApp number</label>
              <input
                id="wac-new-phone"
                value={newPhone}
                onChange={(e) => { setNewPhone(e.target.value); setNewError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') startNewChat(); }}
                placeholder="+91 98765 43210"
                autoFocus
              />

              <label htmlFor="wac-new-name">Contact name (optional)</label>
              <input
                id="wac-new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') startNewChat(); }}
                placeholder="Donor name"
              />

              <label htmlFor="wac-new-account">Send from</label>
              <select id="wac-new-account" value={newAccountId} onChange={(e) => setNewAccountId(e.target.value)}>
                <option value="all">Default account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={String(account.id)}>{account.name}</option>
                ))}
              </select>

              {newError && (
                <div style={{ color: '#dc2626', fontSize: 12, margin: '-2px 0 10px' }}>{newError}</div>
              )}
            </div>

            <div className="wac-dialog-foot">
              <button type="button" onClick={() => setShowNewChat(false)}>Cancel</button>
              <button type="button" className="primary" onClick={startNewChat} disabled={!newPhone.trim()}>
                Start chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

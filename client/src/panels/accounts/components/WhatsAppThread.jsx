import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api, apiGet, apiPost } from '../api/auth';
import WhatsAppMessageList from './WhatsAppMessageList';
import './whatsAppChat.css';

const ACCOUNT_COLORS = ['#0866FF', '#7B5CFA', '#0B6B3A', '#F97316', '#dc2626', '#0ea5e9'];

const QUICK_REPLIES = [
  'Namaste 🙏',
  'Thank you 🙏',
  'Aapka message mil gaya hai.',
  'Please share your full name and address.',
  'Your receipt is ready.',
  'We will get back to you shortly.',
];

const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '🙂',
  '😉', '😎', '🤩', '🥳', '😇', '🙏', '👏', '👍',
  '👎', '🙌', '🤝', '💪', '❤️', '💚', '💛', '💙',
  '🧡', '💜', '✨', '🔥', '🎉', '🎁', '☀️', '🌙',
  '⭐', '✅', '❌', '⚠️', '📌', '📎', '📄', '📞',
  '✉️', '💬', '🕐', '🚀', '🏆', '🍀', '🌸', '🌹',
];

function accountColor(acc) {
  if (!acc) return '#667781';
  let hash = 0;
  for (let i = 0; i < acc.length; i += 1) hash = (hash * 31 + acc.charCodeAt(i)) >>> 0;
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
}

function initials(name, phone) {
  const source = String(name || '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-2) || 'WA';
}

function templatePart(template, type) {
  return (template?.components || []).find((c) => String(c.type || '').toUpperCase() === type) || null;
}

function templateBodyText(template) {
  return templatePart(template, 'BODY')?.text || '';
}

function templateVariables(template) {
  const text = templateBodyText(template);
  const numbers = [...text.matchAll(/{{\s*(\d+)\s*}}/g)].map((m) => Number(m[1]));
  if (!numbers.length) return [];
  return Array.from({ length: Math.max(...numbers) }, (_, i) => i + 1);
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

function IconBack() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconEmoji() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14.5a4.5 4.5 0 0 0 8 0" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

function IconAttach() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.4 11.6l-8.8 8.8a6 6 0 0 1-8.5-8.5l9.4-9.4a4 4 0 0 1 5.7 5.7l-9.4 9.4a2 2 0 0 1-2.8-2.8l8.4-8.4" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconZap() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconTemplate() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="14" y2="13" />
      <line x1="8" y1="17" x2="11" y2="17" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.2 4.2 2 2 0 0 1 4.2 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.7a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.4a2 2 0 0 1 2.1-.4c.9.4 1.8.6 2.7.7a2 2 0 0 1 1.7 2.1z" />
    </svg>
  );
}

function IconWhatsApp() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.02zm-7.01 15.24h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z" />
    </svg>
  );
}

export default function WhatsAppThread({
  phone,
  accountId,
  accounts: accountsProp,
  contactName,
  onClose,
  onBack,
  embedded = false,
  showAccountSelect = true,
  onMessageSent,
}) {
  const [accounts, setAccounts] = useState(Array.isArray(accountsProp) ? accountsProp : []);
  const [selectedAccountId, setSelectedAccountId] = useState(accountId ? String(accountId) : 'all');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateParams, setTemplateParams] = useState([]);
  const [templateHeaderFile, setTemplateHeaderFile] = useState(null);
  const [templateSending, setTemplateSending] = useState(false);

  const [toast, setToast] = useState(null);

  const bodyRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const templateFileRef = useRef(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    if (Array.isArray(accountsProp)) {
      setAccounts(accountsProp);
      return;
    }
    let cancelled = false;
    apiGet('/whatsapp/accounts')
      .then((data) => { if (!cancelled) setAccounts(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setAccounts([]); });
    return () => { cancelled = true; };
  }, [accountsProp]);

  useEffect(() => {
    setSelectedAccountId(accountId ? String(accountId) : 'all');
  }, [accountId]);

  const loadMessages = useCallback(async ({ silent = false } = {}) => {
    if (!phone) return;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const qs = selectedAccountId && selectedAccountId !== 'all' ? `?accountId=${encodeURIComponent(selectedAccountId)}` : '';
      const data = await apiGet(`/whatsapp/conversations/${encodeURIComponent(phone)}${qs}`);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      if (!silent) setError(null);
    } catch (e) {
      if (!silent) {
        setMessages([]);
        setError(e?.message || 'Failed to load messages');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [phone, selectedAccountId]);

  useEffect(() => {
    atBottomRef.current = true;
    loadMessages();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      loadMessages({ silent: true });
    }, 12000);
    return () => clearInterval(timer);
  }, [loadMessages]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading, searchQuery]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!templateOpen) return undefined;
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    const templateAccountId = selectedAccountId !== 'all'
      ? selectedAccountId
      : (accountId || (accounts[0]?.id ? String(accounts[0].id) : ''));
    const qs = templateAccountId ? `?accountId=${encodeURIComponent(templateAccountId)}` : '';
    apiGet(`/whatsapp/templates${qs}`)
      .then((data) => { if (!cancelled) setTemplates(Array.isArray(data) ? data : []); })
      .catch((e) => { if (!cancelled) { setTemplates([]); setTemplatesError(e?.message || 'Could not load templates'); } })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [templateOpen, selectedAccountId, accountId, accounts]);

  const activeAccountName = useMemo(() => {
    if (selectedAccountId && selectedAccountId !== 'all') {
      return accounts.find((a) => String(a.id) === String(selectedAccountId))?.name || '';
    }
    return accounts.length > 1 ? 'All NGOs' : (accounts[0]?.name || '');
  }, [accounts, selectedAccountId]);

  const sendAccountId = selectedAccountId !== 'all'
    ? selectedAccountId
    : (accountId ? String(accountId) : (accounts[0]?.id ? String(accounts[0].id) : undefined));

  const onBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  const focusComposer = () => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const insertEmoji = (emoji) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    const optimisticId = `local-${Date.now()}`;
    const optimistic = {
      id: optimisticId,
      direction: 'outbound',
      message_type: 'text',
      body_text: body,
      status: 'sending',
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimistic]);
    setText('');
    setSending(true);
    setToast(null);
    atBottomRef.current = true;

    try {
      await apiPost('/whatsapp/send-text', { to: phone, text: body, accountId: sendAccountId });
      setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, status: 'sent' } : m)));
      await loadMessages({ silent: true });
      onMessageSent?.();
    } catch (e) {
      setMessages((prev) => prev.map((m) => (
        m.id === optimisticId ? { ...m, status: 'failed', failure_reason: e?.message || 'Send failed' } : m
      )));
      setToast({ type: 'error', msg: e?.message || 'Could not send the message' });
    } finally {
      setSending(false);
      focusComposer();
    }
  };

  const handleAttach = async (event) => {
    const file = event.target.files?.[0];
    if (event.target) event.target.value = '';
    if (!file || uploading) return;

    const mediaType = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'document';

    setUploading(true);
    setToast(null);
    atBottomRef.current = true;

    try {
      const form = new FormData();
      form.append('file', file);
      const uploaded = await api('/upload', { method: 'POST', body: form, _prefix: 'ucs' });
      const mediaUrl = uploaded?.url;
      if (!mediaUrl) throw new Error('Upload failed');

      const caption = text.trim();
      await apiPost('/whatsapp/send-media', {
        to: phone,
        mediaUrl,
        mediaType,
        mediaMimeType: file.type || null,
        caption,
        accountId: sendAccountId,
      });
      if (caption) setText('');
      await loadMessages({ silent: true });
      onMessageSent?.();
    } catch (e) {
      setToast({ type: 'error', msg: e?.message || 'Could not send the attachment' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openTemplates = () => {
    setEmojiOpen(false);
    setQuickOpen(false);
    setTemplateOpen((prev) => !prev);
  };

  const selectTemplate = (template) => {
    setSelectedTemplate(template);
    setTemplateHeaderFile(null);
    setTemplateParams(templateVariables(template).map(() => ''));
    if (templateFileRef.current) templateFileRef.current.value = '';
  };

  const sendTemplate = async () => {
    if (!selectedTemplate || templateSending) return;
    const header = templatePart(selectedTemplate, 'HEADER');
    const headerFormat = String(header?.format || '').toUpperCase();
    const variables = templateVariables(selectedTemplate);

    if (variables.length && templateParams.some((value) => !String(value).trim())) {
      setToast({ type: 'error', msg: 'Fill every template variable before sending.' });
      return;
    }

    setTemplateSending(true);
    setToast(null);
    try {
      let headerImageUrl = null;
      if (templateHeaderFile) {
        const form = new FormData();
        form.append('file', templateHeaderFile);
        const uploaded = await api('/upload', { method: 'POST', body: form, _prefix: 'ucs' });
        headerImageUrl = uploaded?.url || null;
        if (!headerImageUrl) throw new Error('Header upload failed');
      }
      if (['IMAGE', 'DOCUMENT', 'VIDEO'].includes(headerFormat) && !headerImageUrl) {
        throw new Error('This template needs a header file. Attach one below and try again.');
      }

      await apiPost('/whatsapp/send-bulk-template', {
        accountId: sendAccountId,
        to: phone,
        templateName: selectedTemplate.name,
        templateLang: selectedTemplate.language || 'en',
        parameters: templateParams.map((value) => String(value).trim()),
        headerImageUrl,
        headerFormat: headerFormat || 'IMAGE',
        recipientName: contactName || null,
      });

      setTemplateOpen(false);
      setSelectedTemplate(null);
      setTemplateParams([]);
      setTemplateHeaderFile(null);
      setToast({ type: 'ok', msg: 'Template sent' });
      atBottomRef.current = true;
      await loadMessages({ silent: true });
      onMessageSent?.();
    } catch (e) {
      setToast({ type: 'error', msg: e?.message || 'Could not send the template' });
    } finally {
      setTemplateSending(false);
    }
  };

  const closePopovers = () => {
    setEmojiOpen(false);
    setQuickOpen(false);
    setTemplateOpen(false);
  };

  const title = contactName || phone || 'Chat';
  const headerAccount = selectedAccountId !== 'all'
    ? accounts.find((a) => String(a.id) === String(selectedAccountId))
    : null;
  const threadColor = accountColor(headerAccount?.name || activeAccountName);

  const templateVariablesList = templateVariables(selectedTemplate);

  return (
    <div className="wac-thread">
      <div className="wac-thread-head">
        {onBack && (
          <button type="button" className="wac-icon-btn wac-back" style={{ display: 'none' }} onClick={onBack} title="Back to chats">
            <IconBack />
          </button>
        )}

        <div className="wac-avatar is-lg" style={{ background: threadColor }}>{initials(contactName, phone)}</div>

        <div className="wac-thread-head-info">
          <div className="wac-thread-name">{title}</div>
          <div className="wac-thread-sub">
            {contactName && phone && <span>{phone}</span>}
            {contactName && phone && activeAccountName && <span>·</span>}
            {activeAccountName && <span>{activeAccountName}</span>}
            <span className="dot" />
            <span>WhatsApp</span>
          </div>
        </div>

        <div className="wac-thread-actions">
          {showAccountSelect && accounts.length > 0 && (
            <select
              className="wac-select wac-hide-sm"
              value={selectedAccountId}
              onChange={(e) => { setSelectedAccountId(e.target.value); closePopovers(); }}
              title="WhatsApp account"
            >
              <option value="all">All NGOs</option>
              {accounts.map((account) => (
                <option key={account.id} value={String(account.id)}>{account.name}</option>
              ))}
            </select>
          )}

          <button
            type="button"
            className={`wac-icon-btn ${searchOpen ? 'is-active' : ''}`}
            onClick={() => { setSearchOpen((prev) => !prev); setSearchQuery(''); }}
            title="Search messages"
          >
            <IconSearch />
          </button>

          <button type="button" className="wac-icon-btn wac-hide-sm" onClick={() => loadMessages()} title="Refresh">
            <IconRefresh />
          </button>

          {onClose && (
            <button type="button" className="wac-icon-btn" onClick={onClose} title="Close chat">
              <IconClose />
            </button>
          )}
        </div>
      </div>

      {searchOpen && (
        <div className="wac-searchbar">
          <span style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#8696a0', pointerEvents: 'none' }}>
              <IconSearch />
            </span>
            <input
              autoFocus
              className="wac-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in this conversation…"
              style={{ paddingLeft: 33 }}
            />
          </span>
          <button type="button" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}>Clear</button>
        </div>
      )}

      <div className="wac-wallpaper" ref={bodyRef} onScroll={onBodyScroll}>
        <WhatsAppMessageList
          messages={messages}
          loading={loading}
          error={error}
          searchQuery={searchQuery}
        />
      </div>

      <div className="wac-composer-shell">
        {toast && (
          <div className={`wac-notice ${toast.type === 'error' ? 'is-error' : ''}`}>
            <span>{toast.msg}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        {quickOpen && (
          <div className="wac-quickbar">
            {QUICK_REPLIES.map((reply) => (
              <button
                key={reply}
                type="button"
                className="wac-quick"
                onClick={() => {
                  setText((prev) => (prev ? `${prev} ${reply}` : reply));
                  setQuickOpen(false);
                  focusComposer();
                }}
              >
                {reply}
              </button>
            ))}
          </div>
        )}

        {emojiOpen && (
          <div className="wac-popover wac-emoji-pop">
            <div className="wac-emoji-grid">
              {EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>{emoji}</button>
              ))}
            </div>
          </div>
        )}

        {templateOpen && (
          <div className="wac-popover wac-tpl-pop">
            <div className="wac-tpl-head">
              <h4>Send a template</h4>
              <button type="button" onClick={() => setTemplateOpen(false)} aria-label="Close">×</button>
            </div>

            <div className="wac-tpl-body">
              {templatesLoading && <div className="wac-tpl-empty">Loading templates…</div>}
              {!templatesLoading && templatesError && (
                <div className="wac-tpl-empty">
                  <div style={{ color: '#b91c1c', marginBottom: 6 }}>{templatesError}</div>
                  <button type="button" className="wac-quick" onClick={() => setTemplateOpen(false)}>Close and retry</button>
                </div>
              )}
              {!templatesLoading && !templatesError && templates.length === 0 && (
                <div className="wac-tpl-empty">No approved templates for this account.</div>
              )}
              {!templatesLoading && !templatesError && templates.map((template) => (
                <button
                  key={`${template.name}-${template.language}`}
                  type="button"
                  className={`wac-tpl-item ${selectedTemplate?.name === template.name ? 'is-active' : ''}`}
                  onClick={() => selectTemplate(template)}
                >
                  <div className="wac-tpl-name">{template.name}</div>
                  <div className="wac-tpl-lang">{template.language || 'en'} · approved</div>
                  {templateBodyText(template) && (
                    <div className="wac-tpl-preview">{templateBodyText(template)}</div>
                  )}
                </button>
              ))}
            </div>

            {selectedTemplate && (
              <div className="wac-tpl-form">
                {selectedTemplate && templateBodyText(selectedTemplate) && (
                  <div style={{ fontSize: 12, color: '#3b4a54', marginBottom: 9, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                    {templateBodyText(selectedTemplate)}
                  </div>
                )}

                {templateVariablesList.map((variable, index) => (
                  <div className="wac-tpl-field" key={variable}>
                    <label>{`Variable {{${variable}}}`}</label>
                    <input
                      type="text"
                      value={templateParams[index] || ''}
                      onChange={(e) => {
                        const next = [...templateParams];
                        next[index] = e.target.value;
                        setTemplateParams(next);
                      }}
                      placeholder={`Value for {{${variable}}}`}
                    />
                  </div>
                ))}

                {['IMAGE', 'DOCUMENT', 'VIDEO'].includes(String(templatePart(selectedTemplate, 'HEADER')?.format || '').toUpperCase()) && (
                  <div className="wac-tpl-field">
                    <label>Header {String(templatePart(selectedTemplate, 'HEADER')?.format || '').toLowerCase()}</label>
                    <div className="wac-tpl-upload">
                      <input
                        type="file"
                        ref={templateFileRef}
                        accept={String(templatePart(selectedTemplate, 'HEADER')?.format || '').toUpperCase() === 'IMAGE' ? 'image/*' : '*/*'}
                        onChange={(e) => setTemplateHeaderFile(e.target.files?.[0] || null)}
                      />
                      {templateHeaderFile && <div style={{ marginTop: 4 }}>{templateHeaderFile.name}</div>}
                    </div>
                  </div>
                )}

                <button type="button" className="wac-send" onClick={sendTemplate} disabled={templateSending}>
                  {templateSending ? <span className="wac-spinner" /> : <IconSend />}
                  {templateSending ? 'Sending…' : 'Send template'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="wac-composer">
          <div className="wac-composer-tools">
            <button
              type="button"
              className={`wac-icon-btn ${emojiOpen ? 'is-active' : ''}`}
              title="Emoji"
              onClick={() => { setEmojiOpen((prev) => !prev); setQuickOpen(false); setTemplateOpen(false); }}
            >
              <IconEmoji />
            </button>
            <button
              type="button"
              className="wac-icon-btn"
              title="Attach image, video, audio or document"
              onClick={() => { closePopovers(); fileInputRef.current?.click(); }}
              disabled={uploading || sending}
            >
              {uploading ? <span className="wac-spinner" style={{ borderTopColor: '#00a884' }} /> : <IconAttach />}
            </button>
            <button
              type="button"
              className={`wac-icon-btn ${quickOpen ? 'is-active' : ''}`}
              title="Quick replies"
              onClick={() => { setQuickOpen((prev) => !prev); setEmojiOpen(false); setTemplateOpen(false); }}
            >
              <IconZap />
            </button>
            <button
              type="button"
              className={`wac-icon-btn ${templateOpen ? 'is-active' : ''}`}
              title="Templates"
              onClick={openTemplates}
            >
              <IconTemplate />
            </button>
          </div>

          <textarea
            ref={textareaRef}
            className="wac-textarea"
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a message"
          />

          <button
            type="button"
            className="wac-send"
            onClick={handleSend}
            disabled={!text.trim() || sending || uploading}
            title="Send"
          >
            {sending ? <span className="wac-spinner" /> : <IconSend />}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
          onChange={handleAttach}
        />
      </div>
    </div>
  );
}

export function WhatsAppThreadEmpty() {
  return (
    <div className="wac-thread-empty">
      <div className="orb"><IconWhatsApp /></div>
      <h3>WhatsApp Chat</h3>
      <p>Select a conversation on the left, or start a new chat. Messages you send here reach the donor on WhatsApp.</p>
      <div className="hint"><IconPhone /> Use the search box to find a number or reply.</div>
    </div>
  );
}

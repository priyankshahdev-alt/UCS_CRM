import { useMemo } from 'react';

const TICK_GREY = '#8696a0';
const TICK_BLUE = '#53bdeb';
const EMPTY_MEDIA_TEXT = /^\[(image|video|audio|document|sticker|media|template:[^\]]*)\]$/i;

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((today - target) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function SingleTick() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={TICK_GREY} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="5,13 9.5,17.5 19,7" />
    </svg>
  );
}

function DoubleTick({ color = TICK_GREY }) {
  return (
    <svg width="17" height="15" viewBox="0 0 26 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="2,13 6.5,17.5 15,8" />
      <polyline points="9,14.5 11,17.5 20.5,7" />
    </svg>
  );
}

function Ticks({ status }) {
  if (status === 'queued' || status === 'sending') {
    return (
      <span className="ticks" title="Sending">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={TICK_GREY} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12,7 12,12 15.5,14" />
        </svg>
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="ticks" title="Not delivered">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="8" x2="12" y2="13" />
          <line x1="12" y1="16" x2="12" y2="16.5" />
        </svg>
      </span>
    );
  }
  if (status === 'read') return <span className="ticks" title="Read"><DoubleTick color={TICK_BLUE} /></span>;
  if (status === 'delivered') return <span className="ticks" title="Delivered"><DoubleTick /></span>;
  return <span className="ticks" title="Sent"><SingleTick /></span>;
}

function linkify(text, prefix) {
  const pieces = String(text || '').split(/(https?:\/\/[^\s<]+)/g);
  return pieces.map((piece, i) => (
    /^https?:\/\//.test(piece)
      ? (
        <a key={`${prefix}-l-${i}`} href={piece} target="_blank" rel="noreferrer">
          {piece}
        </a>
      )
      : <span key={`${prefix}-t-${i}`}>{piece}</span>
  ));
}

const FORMAT_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[\s\S]+?```|`[^`\n]+`)/g;

function RichText({ text }) {
  if (!text) return null;
  const parts = String(text).split(FORMAT_RE);
  return (
    <span className="wac-msg-text">
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```') && part.length > 5) {
          return <code key={i}>{part.slice(3, -3)}</code>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <strong key={i}>{part.slice(1, -1)}</strong>;
        }
        if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('~') && part.endsWith('~') && part.length > 2) {
          return <s key={i}>{part.slice(1, -1)}</s>;
        }
        return <span key={i}>{linkify(part, i)}</span>;
      })}
    </span>
  );
}

function fileNameFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
    return last || 'Attachment';
  } catch {
    return String(url || '').split('/').pop() || 'Attachment';
  }
}

function TemplateHeaderImage({ message }) {
  const header = message.template_header;
  if (!header) return null;
  const format = String(header.format || '').toUpperCase();
  if (format !== 'IMAGE') return null;
  const handle = header.example?.header_handle?.[0] || header.example?.header_handle || null;
  const url = typeof handle === 'string' ? handle : (Array.isArray(handle) ? handle[0] : null);
  if (!url) return null;
  return (
    <div className="wac-msg-media">
      <img
        src={url}
        alt="Template header"
        onClick={() => window.open(url, '_blank', 'noopener')}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    </div>
  );
}

function MediaBlock({ message }) {
  const url = message.media_url;
  const type = message.message_type;
  if (!url) {
    if (!['image', 'video', 'audio', 'document', 'sticker', 'media'].includes(type)) return null;
    return <div className="wac-media-placeholder">📎 {type} unavailable</div>;
  }

  if (type === 'image' || type === 'sticker') {
    return (
      <div className="wac-msg-media">
        <img
          src={url}
          alt=""
          onClick={() => window.open(url, '_blank', 'noopener')}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </div>
    );
  }
  if (type === 'video') {
    return <div className="wac-msg-media"><video src={url} controls preload="metadata" /></div>;
  }
  if (type === 'audio') {
    return <div className="wac-msg-media"><audio src={url} controls preload="metadata" /></div>;
  }
  if (type === 'document') {
    return (
      <a className="wac-doc" href={url} target="_blank" rel="noreferrer">
        <span className="wac-doc-icon">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="wac-doc-name">{fileNameFromUrl(url)}</span>
          <span className="wac-doc-sub">{message.media_mime_type || 'Document'}</span>
        </span>
      </a>
    );
  }
  return null;
}

function TemplateButtons({ message }) {
  if (!Array.isArray(message.template_buttons) || message.template_buttons.length === 0) return null;
  return (
    <div className="wac-tpl-buttons">
      {message.template_buttons.map((button, i) => {
        const label = button.text || button.type || `Button ${i + 1}`;
        return button.url
          ? <a key={i} href={button.url} target="_blank" rel="noreferrer">{label}</a>
          : <span key={i}>{label}</span>;
      })}
    </div>
  );
}

/* The sender label for inbound messages helps when one donor writes to several
   NGO accounts: the project tag is the only thing that distinguishes the thread. */
function projectLabel(message) {
  if (message.direction !== 'inbound') return null;
  const project = message.project || message.accountName || '';
  if (!project) return null;
  return String(project).toUpperCase();
}

export default function WhatsAppMessageList({ messages, loading, error, searchQuery = '' }) {
  const rendered = useMemo(() => {
    const list = Array.isArray(messages) ? messages : [];
    const out = [];
    let lastDay = null;
    let prev = null;

    for (let i = 0; i < list.length; i += 1) {
      const message = list[i];
      const key = dayKey(message.created_at);
      if (key !== lastDay) {
        out.push({ kind: 'date', key: `day-${key}-${i}`, at: message.created_at });
        lastDay = key;
        prev = null;
      }

      const groupStart = !prev
        || prev.direction !== message.direction
        || dayKey(prev.created_at) !== key
        || (new Date(message.created_at) - new Date(prev.created_at)) > 5 * 60 * 1000;

      out.push({ kind: 'message', key: `msg-${message.id ?? i}-${i}`, message, groupStart });
      prev = message;
    }
    return out;
  }, [messages]);

  const query = String(searchQuery || '').trim().toLowerCase();
  const visible = query
    ? rendered.filter((item) => item.kind === 'date'
      || String(item.message?.body_text || '').toLowerCase().includes(query)
      || String(item.message?.template_name || '').toLowerCase().includes(query)
      || String(item.message?.status || '').toLowerCase().includes(query))
    : rendered;

  if (loading && (!messages || messages.length === 0)) {
    return <p style={{ textAlign: 'center', color: '#667781', padding: 24, fontSize: 12.5 }}>Loading messages…</p>;
  }
  if (error) {
    return <p style={{ color: '#dc2626', padding: 14, fontSize: 12.5, textAlign: 'center' }}>{error}</p>;
  }
  if (!messages || messages.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: '#667781', padding: 26, fontSize: 12.5 }}>
        No messages yet. Say hello 👋
      </p>
    );
  }
  if (visible.length === 0) {
    return <p style={{ textAlign: 'center', color: '#667781', padding: 26, fontSize: 12.5 }}>No messages match “{searchQuery}”.</p>;
  }

  return (
    <>
      {visible.map((item) => {
        if (item.kind === 'date') {
          return (
            <div className="wac-date" key={item.key}>
              <span>{dayLabel(item.at)}</span>
            </div>
          );
        }

        const m = item.message;
        const outbound = m.direction === 'outbound';
        const body = String(m.body_text || '');
        const showBody = body && !EMPTY_MEDIA_TEXT.test(body.trim());
        const project = projectLabel(m);

        return (
          <div
            className={`wac-msg-row ${outbound ? 'out' : 'in'} ${item.groupStart ? 'group-start' : ''}`}
            key={item.key}
          >
            <div className={`wac-msg ${outbound ? 'out' : 'in'} ${item.groupStart ? 'has-tail' : ''}`}>
              {project && <div className="wac-msg-project">{project}</div>}
              <TemplateHeaderImage message={m} />
              <MediaBlock message={m} />
              {showBody && <RichText text={body} />}
              <TemplateButtons message={m} />
              <div className="wac-msg-meta">
                <span>{fmtTime(m.created_at)}</span>
                {outbound && <Ticks status={m.status} />}
              </div>
              {m.failure_reason && <div className="wac-failure">{m.failure_reason}</div>}
            </div>
          </div>
        );
      })}
    </>
  );
}

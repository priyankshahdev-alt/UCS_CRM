import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, List, Pencil, Plus, Trash2 } from 'lucide-react';

const MASK = '••••••••••••••••';

const ACCENT = {
  bsct: '#0866FF',
  bsct2: '#4B8DFF',
  aflf: '#7B5CFA',
  aflf2: '#A78BFA',
  mann: '#0E9F6E',
  'mann 2': '#34D399',
};

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function AccountCard({
  account,
  revealed,
  onToggleReveal,
  fetchingTemplates,
  onFetchTemplates,
  onAddTemplate,
  onOpenTemplates,
  templates,
  onSelectTemplate,
  onEdit,
  onDelete,
}) {
  const [copied, setCopied] = useState(null);
  const copyTimer = useRef(null);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = async (field, value) => {
    if (!value) return;
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(field);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1800);
  };

  const connected = Boolean(account.is_active);
  const quality = account.quality ?? account.quality_rating ?? 'N/A';
  const qualityLabel = quality === 'N/A' ? 'Not available' : quality;
  const phone = account.phone_number_id || '';
  const waba = account.waba_id || '';
  const token = account.access_token || '';

  const accent = ACCENT[String(account.project || '').toLowerCase()] || '#0866FF';

  return (
    <article className="wa-card" style={{ overflow: 'hidden' }}>
      <div style={{ height: 5, background: accent }} />
      <div className="wa-card-top">
        <span className="wa-avatar" aria-hidden="true">{initialsOf(account.name)}</span>
        <div className="wa-card-id">
          <div className="wa-card-name">{account.name}</div>
          <div className="wa-card-chips">
            <span className="wa-chip wa-chip-code">{account.project}</span>
            {account.is_default && <span className="wa-chip wa-chip-default">Default</span>}
            <span className="wa-chip wa-chip-quality">Quality {qualityLabel}</span>
          </div>
        </div>
        <span className={`wa-status ${connected ? 'is-on' : 'is-off'}`}>
          <span className="wa-dot" aria-hidden="true" />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="wa-fields">
        <div className="wa-field">
          <div className="wa-label-row">
            <span className="wa-field-label">Phone number ID</span>
            {copied === 'phone' && <span className="wa-copied" role="status">Copied</span>}
          </div>
          <div className="wa-readonly">
            <code className={`wa-mono${phone ? '' : ' is-empty'}`}>{phone || '—'}</code>
            <button
              type="button"
              className={`wa-copy${copied === 'phone' ? ' is-done' : ''}`}
              onClick={() => handleCopy('phone', phone)}
              disabled={!phone}
              aria-label="Copy phone number ID"
              title="Copy phone number ID"
            >
              {copied === 'phone'
                ? <Check size={16} strokeWidth={1.8} aria-hidden="true" />
                : <Copy size={16} strokeWidth={1.8} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="wa-field">
          <div className="wa-label-row">
            <span className="wa-field-label">WABA ID</span>
            {copied === 'waba' && <span className="wa-copied" role="status">Copied</span>}
          </div>
          <div className="wa-readonly">
            <code className={`wa-mono${waba ? '' : ' is-empty'}`}>{waba || '—'}</code>
            <button
              type="button"
              className={`wa-copy${copied === 'waba' ? ' is-done' : ''}`}
              onClick={() => handleCopy('waba', waba)}
              disabled={!waba}
              aria-label="Copy WABA ID"
              title="Copy WABA ID"
            >
              {copied === 'waba'
                ? <Check size={16} strokeWidth={1.8} aria-hidden="true" />
                : <Copy size={16} strokeWidth={1.8} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="wa-field wa-field-wide">
          <span className="wa-field-label">Access token</span>
          <div className="wa-readonly">
            <code className={`wa-mono${token ? '' : ' is-empty'}`}>
              {token ? (revealed ? token : MASK) : '—'}
            </code>
            {token && (
              <button
                type="button"
                className="wa-show-btn"
                onClick={onToggleReveal}
                aria-label={revealed ? 'Hide access token' : 'Show access token'}
                aria-pressed={revealed}
                title={revealed ? 'Hide access token' : 'Show access token'}
              >
                {revealed ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
        </div>
      </div>

      {templates && templates.length > 0 && (
        <label className="wa-template-row">
          <span className="wa-template-label">Template</span>
          <select
            value={account.template_name || ''}
            onChange={e => onSelectTemplate(e.target.value)}
          >
            <option value="">N/A</option>
            {templates.map(t => (
              <option key={t.name} value={t.name}>{t.name} ({t.language})</option>
            ))}
          </select>
        </label>
      )}

      <div className="wa-card-footer">
        <div className="wa-foot-group">
          <button
            type="button"
            className="wa-btn-outline"
            onClick={onAddTemplate}
          >
            <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
            Add Template
          </button>
          <button
            type="button"
            className="wa-btn-outline"
            onClick={onFetchTemplates}
            disabled={Boolean(fetchingTemplates)}
          >
            <Download size={15} strokeWidth={1.8} aria-hidden="true" />
            {fetchingTemplates ? 'Loading...' : 'Templates'}
          </button>
          <button
            type="button"
            className="wa-btn-outline"
            onClick={onOpenTemplates}
          >
            <List size={15} strokeWidth={1.8} aria-hidden="true" />
            Show Templates
          </button>
        </div>
        <div className="wa-foot-group">
          <button type="button" className="wa-btn-outline" onClick={onEdit}>
            <Pencil size={15} strokeWidth={1.8} aria-hidden="true" />
            Edit
          </button>
          <button type="button" className="wa-btn-outline wa-btn-danger" onClick={onDelete}>
            <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

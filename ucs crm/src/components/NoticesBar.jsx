import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/auth';
import { useRealtime } from '../hooks/useRealtime';
import { getViewPanel } from '../utils/viewPanel';

const MAX_VISIBLE = 3;

const TARGET_LABELS = {
  all: null,
  admin: 'Admin',
  accounts: 'Accounts',
  hr: 'HR',
  recruiter: 'Recruiter',
  fro: 'FRO',
  event_head: 'Event Head',
  event_manager: 'Event Manager',
  worker: 'Worker',
};

const barSeenKey = () => {
  try {
    const u = localStorage.getItem('ucs_user');
    if (u) {
      const parsed = JSON.parse(u);
      if (parsed && parsed.id != null) return `nc_bar_dismissed_${parsed.id}`;
    }
  } catch { /* ignore */ }
  return 'nc_bar_dismissed';
};

const readDismissed = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
};

const addDismissed = (key, id) => {
  try {
    const s = readDismissed(key);
    s.add(String(id));
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch { /* ignore */ }
};

function getRole() {
  try {
    const u = localStorage.getItem('ucs_user');
    if (u) return JSON.parse(u).role;
  } catch { return null; }
}

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return ''; }
};

const isImageUrl = (url, type) => {
  const t = String(type || '').toLowerCase();
  const u = String(url || '').toLowerCase();
  if (t.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/.test(u);
};

const BAR_CSS = `
@keyframes nc-slide-down { from { transform: translate(-50%, -18px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
`;

export default function NoticesBar() {
  return null;

  const refresh = useCallback(async () => {
    try {
      const r = await api(`/notices${target ? `?target_role=${target}` : ''}`, { _prefix: 'ucs' });
      const arr = Array.isArray(r) ? r : (r?.data || []);
      const visible = arr
        .filter(n => n.is_active !== false)
        .filter(n => !dismissedRef.current.has(String(n.id)))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, MAX_VISIBLE);
      setItems(visible);
    } catch { /* 401/offline — ignore */ }
  }, [target]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  useRealtime('notices', { event: '*', onInsert: refresh, onUpdate: refresh, onDelete: refresh });

  const dismiss = useCallback((id) => {
    addDismissed(dismissedKeyRef.current, id);
    dismissedRef.current.add(String(id));
    setItems(prev => prev.filter(n => String(n.id) !== String(id)));
  }, []);

  if (inSAPanel) return null;
  if (!items.length) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 72,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(860px, calc(100vw - 32px))',
      zIndex: 900,
      animation: 'nc-slide-down .35s cubic-bezier(.22,1,.36,1)',
    }}>
      <style>{BAR_CSS}</style>
      <div style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderTop: '3px solid #2563eb',
        borderRadius: 14,
        boxShadow: '0 14px 40px -10px rgba(15,23,42,.28), 0 2px 8px rgba(15,23,42,.06)',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 16px', background: '#f8fafc', borderBottom: '1px solid #eef2f7',
        }}>
          <span style={{ fontSize: 13 }}>🔔</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#2563eb' }}>Notices</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#15803d', background: '#dcfce7', borderRadius: 99, padding: '2px 8px' }}>
            {items.length}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>Tap ✕ to dismiss · shows on every page</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map(n => (
            <div key={n.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '11px 16px', borderBottom: '1px solid #f1f5f9',
            }}>
              {isImageUrl(n.media_url, n.media_type) ? (
                <img
                  src={n.media_url}
                  alt={n.media_name || n.title || 'notice'}
                  style={{ width: 64, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0, cursor: 'pointer', border: '1px solid #e2e8f0' }}
                  onClick={() => window.open(n.media_url, '_blank', 'noopener')}
                  title="Open image"
                />
              ) : (
                <span style={{
                  width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                  background: 'linear-gradient(135deg,#2563eb,#60a5fa)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 6px rgba(37,99,235,.3)',
                }}>
                  <span style={{ fontSize: 15 }}>🔔</span>
                </span>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', lineHeight: 1.35 }}>{n.title}</div>
                  {TARGET_LABELS[n.target_role] && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#dcfce7', color: '#15803d', whiteSpace: 'nowrap' }}>
                      {TARGET_LABELS[n.target_role]}
                    </span>
                  )}
                </div>
                {(n.description || n.content) && (
                  <div style={{ fontSize: 12.5, color: '#475569', marginTop: 3, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                    {(n.description || n.content).length > 220 ? `${(n.description || n.content).slice(0, 220)}…` : (n.description || n.content)}
                  </div>
                )}
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: '#94a3b8', fontWeight: 600 }}>
                  <span>📅 {fmtDate(n.created_at)}</span>
                  {n.created_by_name && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✍️ {n.created_by_name}</span>}
                </div>
              </div>
              <button onClick={() => dismiss(n.id)} title="Dismiss"
                style={{
                  width: 24, height: 24, padding: 0, flexShrink: 0,
                  background: '#f1f5f9', border: 'none', borderRadius: 7, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#64748b', fontWeight: 700, fontSize: 12, fontFamily: 'inherit',
                  transition: 'background .15s, color .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#fecaca'; e.currentTarget.style.color = '#dc2626'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b'; }}
              >✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
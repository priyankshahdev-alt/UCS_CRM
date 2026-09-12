import { useEffect, useRef, useState } from 'react';
import { api } from '../api/auth';
import { useUcs } from '../store';
import { useRealtime } from '../hooks/useRealtime';

const SEEN_KEY = 'fro_range_rule_seen_v1';

const readSet = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
};
const addToSet = (key, id) => {
  try {
    const s = readSet(key);
    if (s.has(String(id))) return;
    s.add(String(id));
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch { /* ignore */ }
};

const fmt = (n) => {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-IN');
};

// Parse an apply-all body that lists every range on its own line:
// "₹1 – ₹20,000: Minimum Lead ₹300 · ₹20 per qualified lead"
const parseCombined = (body) => {
  const re = /₹([\d,]+)\s*–\s*₹([\d,]+): Minimum Lead ₹([\d,]+)\s*·\s*₹([\d,]+) per qualified lead/g;
  const rows = [];
  let m;
  while ((m = re.exec(String(body || ''))) !== null) {
    rows.push({ min: m[1], max: m[2], minLead: m[3], rate: m[4] });
  }
  return rows;
};

const POPUP_CSS = `
@keyframes rrp-slide-in { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
`;

function useUser() {
  try {
    const u = useUcs();
    return u?.user || null;
  } catch { return null; }
}

export default function RangeRulePopup() {
  const user = useUser();
  const [popup, setPopup] = useState(null);
  const autoTimer = useRef(0);

  const show = (n) => {
    if (!n || n.type !== 'lead_rule_update') return;
    if (readSet(SEEN_KEY).has(String(n.id))) return;
    addToSet(SEEN_KEY, n.id);
    setPopup(n);
    clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => { setPopup(null); }, 9000);
  };

  const dismiss = async () => {
    const n = popup;
    setPopup(null);
    if (n?.id) {
      try { await api(`/notifications/${n.id}/read`, { method: 'PUT', _prefix: 'ucs' }); } catch { /* ignore */ }
    }
  };

  const load = async () => {
    if (!user?.id) return;
    try {
      const data = await api(`/notifications/${user.id}`, { _prefix: 'ucs' });
      const unseen = (data || [])
        .filter(n => n.type === 'lead_rule_update' && !n.read_at)
        .sort((a, b) => new Date(b.created_at || b.sent_at || 0) - new Date(a.created_at || a.sent_at || 0));
      for (const n of unseen) {
        if (readSet(SEEN_KEY).has(String(n.id))) continue;
        show(n);
        break;
      }
    } catch { /* ignore */ }
  };

  useRealtime('notification_log', {
    filter: `worker_id=eq.${user?.id}`,
    onInsert: (row) => show(row),
    enabled: !!user?.id,
  });

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [user?.id]);

  useEffect(() => () => { clearTimeout(autoTimer.current); }, []);

  if (!popup) return null;

  const combined = popup.reference_id === 'all-ranges';
  const combinedRows = combined ? parseCombined(popup.body) : [];

  // Body shape: "₹20,000 – ₹50,000: Minimum Lead ₹400 · ₹30 per qualified lead"
  const rangeMatch = String(popup.body || '').match(/₹([\d,]+)\s*–\s*₹([\d,]+):/);
  const minMatch = String(popup.body || '').match(/Minimum Lead ₹([\d,]+)/);
  const rateMatch = String(popup.body || '').match(/(?:·|,)\s*₹([\d,]+) per qualified lead/);

  const rangeLabel = rangeMatch ? `₹${rangeMatch[1]} – ₹${rangeMatch[2]}` : null;
  const minLead = minMatch ? Number(minMatch[1].replace(/,/g, '')) : null;
  const leadRate = rateMatch ? Number(rateMatch[1].replace(/,/g, '')) : null;

  const title = (popup.title || 'Your Lead Range Updated').replace(/^📢\s*/, '');

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 99996, width: 'min(360px, calc(100vw - 32px))' }}>
      <style>{POPUP_CSS}</style>
      <div style={{
        borderRadius: 16, overflow: 'hidden', boxShadow: '0 18px 44px rgba(0,0,0,.28)',
        border: '1.5px solid #fbbf24', background: 'var(--card-bg)',
        animation: 'rrp-slide-in .3s cubic-bezier(.22,1,.36,1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 14px', background: 'linear-gradient(135deg,#451a03,#b45309,#f59e0b)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>📢</span>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 800, color: '#fff' }}>{title}</div>
          <button onClick={dismiss} aria-label="Close" style={{
            width: 26, height: 26, borderRadius: 50, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,.22)', color: '#fff', fontWeight: 800, fontSize: 13, lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px 16px' }}>
          {combined && combinedRows.length > 0 ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 10, letterSpacing: 0.3 }}>
                NEW COMMON VALUE · {combinedRows.length} RANGE{combinedRows.length > 1 ? 'S' : ''}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {combinedRows.map((r, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    borderRadius: 10, background: 'var(--bg)', border: '1.5px solid var(--line)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        ₹{fmt(r.min)} – ₹{fmt(r.max)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>Min Lead</div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#b45309' }}>₹{fmt(r.minLead)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>₹ / Lead</div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#16a34a' }}>₹{fmt(r.rate)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5, marginTop: 12 }}>
                Your incentive still follows only the range your monthly target is assigned to.
              </div>
            </>
          ) : (
            <>
              {rangeLabel && (
                <div style={{
                  fontSize: 16, fontWeight: 900, color: 'var(--ink)', marginBottom: 2,
                }}>{rangeLabel}</div>
              )}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 12, letterSpacing: 0.3 }}>
                YOUR NEW LEAD RULE
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                {minLead != null && (
                  <div style={{
                    flex: 1, borderRadius: 12, padding: '10px 12px', background: 'var(--bg)',
                    border: '1.5px solid var(--line)', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>Min Lead (₹)</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#b45309' }}>₹{fmt(minLead)}</div>
                  </div>
                )}
                {leadRate != null && (
                  <div style={{
                    flex: 1, borderRadius: 12, padding: '10px 12px', background: 'var(--bg)',
                    border: '1.5px solid var(--line)', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>₹ / Qual. Lead</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#16a34a' }}>₹{fmt(leadRate)}</div>
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5, marginTop: 12 }}>
                A lead only counts as qualified for you if the ₹ collected is ≥ the Minimum Lead Amount.
              </div>
            </>
          )}

          <button onClick={dismiss} style={{
            width: '100%', marginTop: 12, padding: '10px 16px', borderRadius: 10, border: 'none',
            background: 'linear-gradient(90deg,#b45309,#f59e0b)', color: '#fff',
            fontWeight: 800, fontSize: 13.5, cursor: 'pointer',
          }}>
            Got it ✓
          </button>
        </div>
      </div>
    </div>
  );
}
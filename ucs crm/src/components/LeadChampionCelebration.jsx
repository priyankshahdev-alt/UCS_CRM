import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/auth';
import { useRealtime } from '../hooks/useRealtime';
import { useUcs } from '../store';

const CELEB_KEY = 'lc_celeb_v1';

const fmt = (n) => {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-IN');
};

const CELEB_CSS = `
@keyframes lc-slide-in { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes lc-wiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-8deg); } 75% { transform: rotate(8deg); } }
`;

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

const todayLocal = () => new Date().toISOString().slice(0, 10);

function useUser() {
  try {
    const u = useUcs();
    return u?.user || null;
  } catch { return null; }
}

// Small bottom-right side card for today's champion (FRO only).
function ChampionSidePopup({ announcement, isYou, onClose }) {
  const initials = String(announcement.fro_name || 'W')
    .split(' ')
    .slice(0, 2)
    .map(s => s[0]).join('').toUpperCase();
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => { setImgErr(false); }, [announcement?.winner_photo_url]);
  const hasPhoto = !!announcement.winner_photo_url && !imgErr;

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 196, zIndex: 99995, width: 'min(340px, calc(100vw - 32px))' }}>
      <style>{CELEB_CSS}</style>
      <div style={{
        borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 48px rgba(0,0,0,.3)',
        border: '2px solid #fbbf24', background: 'var(--card-bg)',
        animation: 'lc-slide-in .32s cubic-bezier(.22,1,.36,1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 14px', background: 'linear-gradient(90deg,#166534,#16a34a,#4ade80)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16, animation: 'lc-wiggle 1.6s ease-in-out infinite' }}>🏆</span>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 800, color: '#fff' }}>
            {isYou ? 'You are today\'s Champion!' : 'Today\'s Champion'}
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 800, background: '#fff', color: '#166534', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>DAILY WINNER</span>
          <button onClick={onClose} aria-label="Close" style={{
            width: 26, height: 26, borderRadius: 50, border: 'none', cursor: 'pointer',
            background: 'rgba(0,0,0,.18)', color: '#fff', fontWeight: 800, fontSize: 13, lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px 16px', display: 'flex', gap: 12 }}>
          {/* Photo */}
          <div style={{
            width: 64, height: 64, borderRadius: 50, overflow: 'hidden', flexShrink: 0,
            border: '3px solid #f59e0b', background: 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {hasPhoto ? (
              <img src={announcement.winner_photo_url} alt="Winner" onError={() => setImgErr(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <span style={{ fontSize: 22, fontWeight: 900, color: '#b45309' }}>{initials}</span>
            )}
          </div>

          {/* Details */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16.5, fontWeight: 900, color: 'var(--ink)', lineHeight: 1.25, wordBreak: 'break-word' }}>
              {announcement.fro_name || 'A Champion'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 3 }}>
              {announcement.announcement_date ? new Date(announcement.announcement_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : 'Today'} · Best quality lead generator 🚀
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 9 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-soft)' }}>Collection</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)' }}>₹{fmt(announcement.total_amount)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-soft)' }}>Qualified</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: '#16a34a' }}>{announcement.qualified_leads || 0}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-soft)' }}>Bonus</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: '#d97706' }}>₹{fmt(announcement.champion_bonus)}</div>
              </div>
            </div>
            {isYou && (
              <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 800, color: '#b45309' }}>
                🎉 Won ₹{fmt(announcement.champion_bonus)} Champion Bonus!
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Compact champion banner for dashboards.
export function ChampionCard({ announcement }) {
  if (!announcement) return null;
  return (
    <div style={{
      width: 300, borderRadius: 14, border: '2px solid #f59e0b', background: 'linear-gradient(150deg,#fffdf5,#fff3d6)',
      boxShadow: '0 14px 34px rgba(0,0,0,.18)', overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', background: 'linear-gradient(90deg,#b45309,#f59e0b,#fbbf24)', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>🏆</span>
        <div style={{ flex: 1, fontSize: 12.5, fontWeight: 800 }}>Today's Champion</div>
        <span style={{ fontSize: 11, fontWeight: 800, background: '#fff', color: '#b45309', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>DAILY WINNER</span>
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)' }}>{announcement.fro_name}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
          ₹{fmt(announcement.total_amount)} from {announcement.qualified_leads || 0} qualified leads
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Incentive</span>
          <span style={{ fontSize: 14, fontWeight: 900, color: '#b45309' }}>₹{fmt(announcement.total_incentive)}</span>
        </div>
      </div>
    </div>
  );
}

// Shared hook: fetch today's champion + realtime celebration.
export function useLeadChampion() {
  const user = useUser();
  const [current, setCurrent] = useState(null);
  const [celebrate, setCelebrate] = useState(null);
  const celebrationShownRef = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const today = todayLocal();
      const r = await api('/incentive/lead/champion/current?date=' + today, { _prefix: 'ucs' });
      const a = r?.announcement;
      // Only the current day's announcement may ever celebrate.
      if (!a || String(a.announcement_date).slice(0, 10) !== today) {
        setCurrent(null);
        return;
      }
      setCurrent(a);
      // Auto-celebrate once per announcement id.
      if (!celebrationShownRef.current.has(a.id) && !readSet(CELEB_KEY).has(String(a.id))) {
        celebrationShownRef.current.add(a.id);
        addToSet(CELEB_KEY, a.id);
        setCelebrate(a);
      }
    } catch { /* 401/offline */ }
  }, []);

  const debMsg = useRef(0);
  const reloadSoon = useCallback(() => {
    clearTimeout(debMsg.current);
    debMsg.current = setTimeout(() => load(), 1200);
  }, [load]);

  useRealtime('lead_champion_announcements', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon });

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  // Auto-dismiss after 9s.
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(null), 9000);
    return () => clearTimeout(t);
  }, [celebrate]);

  const isChampion = !!(current && user && current.fro_worker_id === user.id);

  return {
    current,
    celebrate,
    closeCelebrate: () => setCelebrate(null),
    isChampion,
    you: user?.id || null,
  };
}

export default function LeadChampionCelebration() {
  const { celebrate, closeCelebrate, isChampion, you } = useLeadChampion();
  return (
    <>
      <style>{CELEB_CSS}</style>
      {celebrate && (
        <ChampionSidePopup
          announcement={celebrate}
          isYou={isChampion && celebrate?.fro_worker_id === you}
          onClose={closeCelebrate}
        />
      )}
    </>
  );
}
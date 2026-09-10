import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api } from '../api/auth';
import { useRealtime } from '../hooks/useRealtime';
import { useUcs } from '../store';

const CELEB_KEY = 'lc_celeb_v1';

const fmt = (n) => {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-IN');
};

const CONFETTI_COLORS = ['#f59e0b', '#16a34a', '#3b82f6', '#a855f7', '#f472b6', '#fb923c', '#eab308', '#22c55e'];

const CONFETTI_CSS = `
@keyframes lc-confetti-fall { 0% { transform: translateY(-6vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(105vh) rotate(720deg); opacity: .8; } }
@keyframes lc-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
@keyframes lc-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.lc-confetti { position: fixed; top: -6vh; border-radius: 2px; z-index: 99995; pointer-events: none; animation-name: lc-confetti-fall; animation-timing-function: linear; animation-iteration-count: infinite; }
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

function useUser() {
  try {
    const u = useUcs();
    return u?.user || null;
  } catch { return null; }
}

// Full-screen champion celebration popup.
function ChampionCelebration({ announcement, onClose }) {
  const pieces = useMemo(() => Array.from({ length: 130 }).map((_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 2.5,
    dur: 2.6 + Math.random() * 2,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    w: 6 + Math.random() * 8,
    h: 10 + Math.random() * 10,
  })), []);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99994, background: 'rgba(15,23,42,.6)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <style>{CONFETTI_CSS}</style>
      {pieces.map((p, i) => (
        <div key={i} className="lc-confetti" style={{
          left: `${p.left}%`, width: p.w, height: p.h, background: p.color,
          animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
        }} />
      ))}
      <div style={{
        width: 'min(430px,100%)', borderRadius: 20, padding: 28, textAlign: 'center',
        background: 'linear-gradient(160deg,#fff8e7,#ffe6b3)', border: '3px solid #f59e0b',
        boxShadow: '0 30px 80px rgba(0,0,0,.4)', animation: 'lc-pop .5s cubic-bezier(.22,1,.36,1)', position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: 12, right: 12, cursor: 'pointer', width: 30, height: 30, borderRadius: 50, background: 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--ink)', zIndex: 2 }} onClick={onClose}>✕</div>
        <div style={{ fontSize: 52, animation: 'lc-bounce 1.2s ease-in-out infinite' }}>🏆</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#b45309', letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 }}>Champion Declared</div>
        <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--ink)', margin: '10px 0 4px' }}>
          {announcement.fro_name || 'A Champion'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 auto', maxWidth: 330 }}>
          Best quality lead generator of {announcement.announcement_date ? new Date(announcement.announcement_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : 'the day'}!
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, margin: '16px 0 6px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' }}>Collection</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>₹{fmt(announcement.total_amount)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' }}>Qualified Leads</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#16a34a' }}>{announcement.qualified_leads || 0}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' }}>Total Incentive</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#d97706' }}>₹{fmt(announcement.total_incentive)}</div>
          </div>
        </div>
        <div style={{ margin: '10px 0 0', fontSize: 16, fontWeight: 900, color: '#d97706' }}>
          🎉 Won ₹{fmt(announcement.champion_bonus)} Champion Bonus!
        </div>
        {announcement.message && (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.72)', border: '1.5px solid #fcd34d', fontSize: 13, lineHeight: 1.5, color: 'var(--ink)', fontWeight: 600 }}>
            {announcement.message}
          </div>
        )}
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

// Shared hook: fetch current champion + realtime celebration.
export function useLeadChampion() {
  const user = useUser();
  const [current, setCurrent] = useState(null);
  const [celebrate, setCelebrate] = useState(null);
  const celebrationShownRef = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const r = await api('/incentive/lead/champion/current?date=' + new Date().toISOString().slice(0, 10), { _prefix: 'ucs' });
      if (r && r.announcement) {
        setCurrent(r.announcement);
        // Auto-celebrate new announcements once per id.
        if (!celebrationShownRef.current.has(r.announcement.id) && !readSet(CELEB_KEY).has(String(r.announcement.id))) {
          celebrationShownRef.current.add(r.announcement.id);
          addToSet(CELEB_KEY, r.announcement.id);
          setCelebrate(r.announcement);
        }
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

  // Auto-dismiss after 10s.
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(null), 10000);
    return () => clearTimeout(t);
  }, [celebrate]);

  return {
    current,
    celebrate,
    closeCelebrate: () => setCelebrate(null),
    isChampion: !!(current && user && current.fro_worker_id === user.id),
    you: user?.id || null,
  };
}

export default function LeadChampionCelebration() {
  const { celebrate, closeCelebrate } = useLeadChampion();
  return (
    <>
      <style>{CONFETTI_CSS}</style>
      {celebrate && <ChampionCelebration announcement={celebrate} onClose={closeCelebrate} />}
    </>
  );
}
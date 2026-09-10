import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { api } from '../api/auth';
import { useRealtime } from '../hooks/useRealtime';
import { CoinsBag } from './AkiBanner';
import { useUcs } from '../store';
import { requestNotifPermission, showDesktopNotification } from '../utils/desktopNotif';

const SEEN_KEY = 'si_seen_v1';
const CELEB_KEY = 'si_celeb_v1';
const CELEB_PHOTO_KEY = 'si_celeb_photo_v1';

const fmt = (n) => {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-IN');
};
const pctOf = (collected, target) => {
  const t = Number(target);
  const c = Number(collected);
  if (!(t > 0) || !Number.isFinite(c)) return 0;
  return Math.min(100, Math.max(0, c / t * 100));
};
const fmtClock = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
};
const fmtEnd = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
};

const CONFETTI_COLORS = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#f472b6', '#fb923c', '#facc15'];

const CONFETTI_CSS = `
@keyframes si-confetti-fall { 0% { transform: translateY(-6vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(105vh) rotate(720deg); opacity: .8; } }
@keyframes si-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
@keyframes si-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
@keyframes si-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes si-rise { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes si-drop { 0% { transform: translateY(-110vh) scale(.92); opacity: 0; } 45% { transform: translateY(2vh) scale(1.03); opacity: 1; } 62% { transform: translateY(-1.2vh) scale(1); } 78% { transform: translateY(.5vh); } 100% { transform: translateY(0); opacity: 1; } }
.si-confetti { position: fixed; top: -6vh; border-radius: 2px; z-index: 99999; pointer-events: none; animation-name: si-confetti-fall; animation-timing-function: linear; animation-iteration-count: infinite; }
`;

const readSet = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
};
const hasInSet = (key, id) => readSet(key).has(String(id));
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

function FillingBag({ pct = 0, size = 120 }) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const coins = Math.max(1, Math.ceil(p / 10));
  return (
    <div style={{ position: 'relative', width: size + 28, textAlign: 'center' }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <CoinsBag size={size} />
        <div style={{
          position: 'absolute', left: '10%', right: '10%', bottom: '28%', overflow: 'hidden',
          display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
        }}>
          <div style={{
            height: `${Math.max(4, (p / 100) * 56)}px`, width: '100%',
            borderRadius: 8,
            background: 'linear-gradient(180deg,#fde68a 0%,#f59e0b 55%,#d97706 100%)',
            transition: 'height .6s cubic-bezier(.22,1,.36,1)',
            boxShadow: '0 2px 4px rgba(180,83,9,.35)',
          }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'center', alignContent: 'flex-end' }}>
            {Array.from({ length: coins }).map((_, i) => (
              <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#fbbf24', border: '1.5px solid #b45309' }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 15, fontWeight: 800, color: '#b45309' }}>{p}%</div>
    </div>
  );
}

function Leaderboard({ rows = [], target, you, limit = 8 }) {
  const sorted = [...rows].sort((a, b) => (Number(b.collected_amount) || 0) - (Number(a.collected_amount) || 0));
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {sorted.slice(0, limit).map((r, i) => {
        const p = pctOf(r.collected_amount, target);
        const isMe = you && r.worker_id === you;
        return (
          <div key={r.worker_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 22, fontSize: 13, textAlign: 'center' }}>
              {medals[i] ? medals[i] : <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{i + 1}</span>}
            </span>
            <span style={{ width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: isMe ? 800 : 600, color: 'var(--ink)' }}>
              {r.name}{isMe ? ' (you)' : ''}
            </span>
            <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--line)', overflow: 'hidden' }}>
              <div style={{ width: `${p}%`, height: '100%', borderRadius: 6, background: 'linear-gradient(90deg,#fbbf24,#f59e0b)', transition: 'width .5s ease' }} />
            </div>
            <span style={{ width: 72, textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#b45309' }}>₹{fmt(r.collected_amount)}</span>
          </div>
        );
      })}
      {sorted.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', padding: 8 }}>No participants yet</div>}
    </div>
  );
}

export function WinnerBanner({ inc }) {
  if (inc?.status === 'won') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'linear-gradient(135deg,#fef3c7,#fde68a)', border: '1.5px solid #f59e0b' }}>
        <span style={{ fontSize: 22 }}>🏆</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e' }}>Winner: {inc.winner_name || 'Unknown'}</div>
          <div style={{ fontSize: 11, color: '#b45309' }}>First to collect ₹{fmt(inc.target_amount)} → won ₹{fmt(inc.incentive_amount)} 🎉</div>
        </div>
      </div>
    );
  }
  if (inc?.status === 'ended' || inc?.status === 'cancelled') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'var(--bg)', border: '1.5px solid var(--line)' }}>
        <span style={{ fontSize: 20 }}>⏳</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{inc.status === 'cancelled' ? 'Cancelled by Sir' : 'Ended — no winner'}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{inc.title}</div>
        </div>
      </div>
    );
  }
  return null;
}

function PopupModal({ inc, you, onClose, nowMs }) {
  const mine = inc?.mine || null;
  const myPct = pctOf(mine?.collected_amount, inc?.target_amount);
  const left = inc ? Math.max(0, new Date(inc.end_at).getTime() - nowMs) : 0;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99990, background: 'rgba(15,23,42,.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <style>{CONFETTI_CSS}</style>
      <div style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto', borderRadius: 18, padding: 20, position: 'relative', border: '2px solid #f59e0b', background: 'linear-gradient(160deg,#fffdf5 0%,#fff7e0 60%,#ffe9c2 100%)', boxShadow: '0 24px 60px rgba(0,0,0,.35)', animation: 'si-pop .45s cubic-bezier(.22,1,.36,1)' }}>
        <div style={{ position: 'absolute', top: 12, right: 12, cursor: 'pointer', width: 30, height: 30, borderRadius: 50, background: 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--ink)', zIndex: 2 }} onClick={onClose}>✕</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'si-pulse 1s linear infinite' }} /> Sir ka Incentive · LIVE
          </div>
          <div style={{ fontSize: 21, fontWeight: 900, color: 'var(--ink)', margin: '10px 0 2px' }}>{inc.title}</div>
          {inc.message && <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '0 auto 4px', maxWidth: 380 }}>{inc.message}</div>}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>Ends {fmtEnd(inc.end_at)} · ⏳ {fmtClock(left)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, margin: '14px 0 4px' }}>
          <div style={{ animation: 'si-bounce 2.4s ease-in-out infinite' }}>
            <FillingBag pct={myPct} size={112} />
          </div>
          <div style={{ textAlign: 'left', minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>Your collection</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>₹{fmt(mine?.collected_amount || 0)}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>Target ₹{fmt(inc.target_amount)}</div>
            <div style={{ marginTop: 6, fontSize: 14, fontWeight: 800, color: '#b45309' }}>Win ₹{fmt(inc.incentive_amount)}</div>
          </div>
        </div>
        <div style={{ borderTop: '1px dashed #f59e0b88', marginTop: 12, paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>🔥 FRO Leaderboard</div>
          <Leaderboard rows={inc.leaderboard || []} target={inc.target_amount} you={you} />
        </div>
        <button onClick={onClose} style={{ marginTop: 14, width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--ink)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Got it — keep collecting! 🔥</button>
      </div>
    </div>
  );
}

function Celebration({ inc, you, onClose }) {
  const isWinner = you && inc.winner_worker_id === you;
  const pieces = useMemo(() => Array.from({ length: 130 }).map((_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 3,
    dur: 2.6 + Math.random() * 2,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    w: 6 + Math.random() * 8,
    h: 10 + Math.random() * 10,
  })), []);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99992, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <style>{CONFETTI_CSS}</style>
      {pieces.map((p, i) => (
        <div key={i} className="si-confetti" style={{
          left: `${p.left}%`, width: p.w, height: p.h, background: p.color,
          animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
        }} />
      ))}
      <div style={{ width: 'min(420px,100%)', borderRadius: 20, padding: 26, textAlign: 'center', background: 'linear-gradient(160deg,#fff8e7,#ffe6b3)', border: '3px solid #f59e0b', boxShadow: '0 30px 80px rgba(0,0,0,.4)', animation: 'si-pop .5s cubic-bezier(.22,1,.36,1)', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 12, right: 12, cursor: 'pointer', width: 30, height: 30, borderRadius: 50, background: 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--ink)', zIndex: 2 }} onClick={onClose}>✕</div>
        <div style={{ fontSize: 54, animation: 'si-bounce 1.2s ease-in-out infinite' }}>{isWinner ? '🏆' : '🎉'}</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#b45309', letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>Winner Declared</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--ink)', margin: '8px 0 4px' }}>
          {isWinner ? 'YOU WON IT!' : `${inc.winner_name || 'A FRO'} won!`}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          {isWinner
            ? <>You were the first to collect ₹{fmt(inc.target_amount)} in <b>{inc.title}</b>.</>
            : <>{inc.winner_name || 'Someone'} was first to collect ₹{fmt(inc.target_amount)} in <b>{inc.title}</b>.</>}
        </div>
        <div style={{ margin: '14px 0 4px', fontSize: 18, fontWeight: 900, color: '#d97706' }}>Won ₹{fmt(inc.incentive_amount)} 🎉</div>
      </div>
    </div>
  );
}

// Full-screen winner-photo celebration. Drops in from the top with confetti and
// shows Sir's posted photo + the AI congratulation on every panel.
function WinnerPhotoPopup({ inc, onClose }) {
  const pieces = useMemo(() => Array.from({ length: 150 }).map((_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 2,
    dur: 2.4 + Math.random() * 2.4,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    w: 6 + Math.random() * 9,
    h: 10 + Math.random() * 12,
  })), []);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99993, background: 'rgba(15,23,42,.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <style>{CONFETTI_CSS}</style>
      {pieces.map((p, i) => (
        <div key={i} className="si-confetti" style={{
          left: `${p.left}%`, width: p.w, height: p.h, background: p.color,
          animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
        }} />
      ))}
      <div style={{ width: 'min(410px,100%)', borderRadius: 22, padding: 10, background: 'linear-gradient(165deg,#fff8e7,#ffe3a6)', border: '3px solid #f59e0b', boxShadow: '0 32px 90px rgba(0,0,0,.45)', animation: 'si-drop .9s cubic-bezier(.22,1,.36,1) both', position: 'relative', textAlign: 'center' }}>
        <div style={{ position: 'absolute', top: 18, right: 18, cursor: 'pointer', width: 30, height: 30, borderRadius: 50, background: '#fff', border: '1.5px solid #f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: '#b45309', zIndex: 3 }} onClick={onClose}>✕</div>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#b45309', marginTop: 4 }}>🎉 Winner Announcement</div>
        {inc.winner_photo_url ? (
          <div style={{ borderRadius: 14, overflow: 'hidden', margin: '10px 0', border: '2px solid #f59e0b', position: 'relative', maxHeight: '38vh' }}>
            <img src={inc.winner_photo_url} alt="Winner" style={{ width: '100%', height: '100%', maxHeight: '38vh', objectFit: 'cover', display: 'block', background: '#fde68a' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 55%, rgba(120,53,15,.55) 100%)' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: '#fff', fontWeight: 900, fontSize: 19, textShadow: '0 1px 6px rgba(0,0,0,.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.winner_name || 'The Winner'}</span>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 16, textShadow: '0 1px 6px rgba(0,0,0,.45)', whiteSpace: 'nowrap' }}>🏆 ₹{fmt(inc.incentive_amount)}</span>
            </div>
          </div>
        ) : (
          <div style={{ margin: '10px 0', padding: '20px 0' }}>
            <div style={{ fontSize: 48 }}>🏆</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--ink)', marginTop: 4 }}>{inc.winner_name || 'The Winner'}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#d97706' }}>Won ₹{fmt(inc.incentive_amount)} 🎉</div>
          </div>
        )}
        {inc.congrats_message && (
          <div style={{ margin: '0 2px 4px', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.72)', border: '1.5px solid #fcd34d', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink)', fontWeight: 600 }}>{inc.congrats_message}</div>
        )}
        <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700, margin: '2px 0 6px' }}>{inc.title}</div>
      </div>
    </div>
  );
}

// Persistent mini card; exported for reuse on dashboards & panels.
export function SpecialIncentiveCard({ inc, you, nowMs }) {
  if (!inc) return null;
  const target = Number(inc?.target_amount) || 0;
  const myPct = pctOf(inc?.mine?.collected_amount, target);
  const left = inc ? Math.max(0, new Date(inc.end_at).getTime() - nowMs) : 0;
  return (
    <div style={{ width: 300, borderRadius: 14, border: '2px solid #f59e0b', background: 'linear-gradient(150deg,#fffdf5,#fff3d6)', boxShadow: '0 14px 34px rgba(0,0,0,.22)', overflow: 'hidden', animation: 'si-rise .3s ease' }}>
      <div style={{ padding: '10px 14px', background: 'linear-gradient(90deg,#b45309,#f59e0b,#fbbf24)', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>💰</span>
        <div style={{ flex: 1, fontSize: 12.5, fontWeight: 800 }}>{inc.title}</div>
        <span style={{ fontSize: 11, fontWeight: 800, background: '#fff', color: '#b45309', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
          {inc.status === 'won' ? '🏆 WON' : inc.status === 'ended' || inc.status === 'cancelled' ? (inc.status === 'cancelled' ? 'CANCELLED' : 'ENDED') : `⏳ ${fmtClock(left)}`}
        </span>
      </div>
      <div style={{ padding: 12 }}>
        {inc.status === 'won' || inc.status === 'ended' || inc.status === 'cancelled' ? (
          <WinnerBanner inc={inc} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ animation: 'si-bounce 2.6s ease-in-out infinite' }}><CoinsBag size={44} /></div>
              {you ? (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' }}>My progress</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)' }}>₹{fmt(inc.mine?.collected_amount || 0)} <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>/ ₹{fmt(target)}</span></div>
                  <div style={{ height: 8, borderRadius: 6, background: 'var(--line)', overflow: 'hidden', marginTop: 4 }}>
                    <div style={{ width: `${myPct}%`, height: '100%', background: 'linear-gradient(90deg,#fbbf24,#f59e0b)', borderRadius: 6, transition: 'width .5s ease' }} />
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-soft)' }}>Win ₹{fmt(inc.incentive_amount)} — first past ₹{fmt(target)}! 🏁</div>
              )}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' }}>Leader: {((inc.leaderboard || [])[0]?.name) || '—'} · Ends {fmtEnd(inc.end_at)}</div>
          </>
        )}
      </div>
    </div>
  );
}

// Shared hook: fetch + realtime + popup/celebration state for any panel.
export function useSpecialIncentive() {
  const user = useUser();
  const [data, setData] = useState({ incentives: [], recent: [] });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [celebrate, setCelebrate] = useState(null);
  const [photoCeleb, setPhotoCeleb] = useState(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [dismissedId, setDismissedId] = useState(null);
  const trackedRef = useRef(new Set());
  const celebrationShownRef = useRef(new Set());
  const photoShownRef = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const r = await api('/incentive/special/active', { _prefix: 'ucs' });
      if (r && Array.isArray(r.incentives)) setData(r);
    } catch { /* 401/offline */ }
  }, []);

  const debMsg = useRef(0);
  const reloadSoon = useCallback(() => {
    clearTimeout(debMsg.current);
    debMsg.current = setTimeout(() => load(), 1200);
  }, [load]);

  useRealtime('special_incentives', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon });
  useRealtime('special_incentive_progress', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon });

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    const c = setInterval(() => setNowMs(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [load]);

  const active = data.incentives?.[0] || null;

  // Auto-popup the newest active incentive once per id.
  useEffect(() => {
    if (active && !trackedRef.current.has(active.id)) {
      trackedRef.current.add(active.id);
      setPopupOpen(true);
      try { if (navigator.vibrate) navigator.vibrate(300); } catch { /* ignore */ }
      requestNotifPermission().then(() => {
        showDesktopNotification('Sir ka Incentive LIVE 🎯', active.title || 'New special incentive is live — go collect!');
      }).catch(() => {});
    }
  }, [active]);

  // Celebration when an incentive resolves as "won" — once per id.
  useEffect(() => {
    const closed = (data.recent || [])[0];
    if (closed && closed.status === 'won' && !closed.archived_at && !celebrationShownRef.current.has(closed.id) && !hasInSet(CELEB_KEY, closed.id)) {
      celebrationShownRef.current.add(closed.id);
      addToSet(CELEB_KEY, closed.id);
      setCelebrate(closed);
      const t = setTimeout(() => setCelebrate(null), 6500);
      return () => clearTimeout(t);
    }
  }, [data.recent]);

  // Winner-photo celebration: when Sir posts the winner's photo, drop the popup
  // on every panel (once per id per device).
  useEffect(() => {
    const c = data.celeb;
    if (c && c.celebrated_at && !c.archived_at && !photoShownRef.current.has(c.id) && !hasInSet(CELEB_PHOTO_KEY, c.id)) {
      photoShownRef.current.add(c.id);
      addToSet(CELEB_PHOTO_KEY, c.id);
      setPhotoCeleb(c);
      const t = setTimeout(() => setPhotoCeleb(null), 12000);
      return () => clearTimeout(t);
    }
  }, [data.celeb]);

  return {
    active,
    recent: data.recent?.[0] || null,
    celebrate,
    photoCeleb,
    popupOpen,
    nowMs,
    user,
    dismissedId,
    dismissCard: (id) => setDismissedId(id ? String(id) : null),
    closePopup: () => setPopupOpen(false),
    closeCelebrate: () => setCelebrate(null),
    closePhotoCeleb: () => setPhotoCeleb(null),
    reload: load,
  };
}

export default function SpecialIncentive() {
  const { active, celebrate, photoCeleb, popupOpen, nowMs, user, dismissedId, dismissCard, closePopup, closeCelebrate, closePhotoCeleb } = useSpecialIncentive();
  const you = user?.id || null;

  // Show the sticky bottom-left card ONLY while an incentive is genuinely
  // active (running). Once it is won/ended/cancelled, the card disappears
  // automatically (no winner banner left pinned in the corner).
  const showCard = !!active && !popupOpen && String(active.id) !== String(dismissedId);

  return (
    <>
      <style>{CONFETTI_CSS}</style>
      {photoCeleb && <WinnerPhotoPopup inc={photoCeleb} onClose={closePhotoCeleb} />}
      {celebrate && <Celebration inc={celebrate} you={you} onClose={closeCelebrate} />}
      {popupOpen && active && <PopupModal inc={active} you={you} onClose={closePopup} nowMs={nowMs} />}
      {showCard && !celebrate && (
        <div style={{ position: 'fixed', left: 14, bottom: 14, zIndex: 99980, width: 312 }}>
          <div style={{ position: 'relative' }}>
            <div
              onClick={() => dismissCard(active.id)}
              title="Close"
              style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, cursor: 'pointer', width: 24, height: 24, borderRadius: 50, background: '#fff', border: '1.5px solid #f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: '#b45309', boxShadow: '0 2px 6px rgba(0,0,0,.18)' }}
            >✕</div>
            <SpecialIncentiveCard inc={active} you={you} nowMs={nowMs} />
          </div>
        </div>
      )}
    </>
  );
}
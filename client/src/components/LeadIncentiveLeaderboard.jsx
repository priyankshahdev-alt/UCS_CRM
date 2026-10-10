import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/auth';
import { useRealtime } from '../hooks/useRealtime';
import { useUcs } from '../store';
import { CoinsBag } from './AkiBanner';

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

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const LEAD_CSS = `
@keyframes lil-pop { 0% { transform: scale(.85); opacity: 0; } 60% { transform: scale(1.03); } 100% { transform: scale(1); opacity: 1; } }
@keyframes lil-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes lil-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes lil-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
`;

// Bronze/Silver/Gold milestone tiers (per range). Same hues as the admin board.
const T_META = {
  bronze: { key: 'bronze', label: 'Bronze', medal: '🥉', color: '#c2410c', bg: '#ffedd5', border: '#fdba74' },
  silver: { key: 'silver', label: 'Silver', medal: '🥈', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
  gold: { key: 'gold', label: 'Gold', medal: '🥇', color: '#a16207', bg: '#fef3c7', border: '#fcd34d' },
};
export const tMeta = (key) => T_META[String(key || '').toLowerCase()] || T_META.bronze;

export function TierPill({ tierKey, label, size = 10.5 }) {
  const m = tMeta(tierKey);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 999, background: m.bg, border: `1px solid ${m.border}`, fontSize: size, fontWeight: 800, color: m.color, whiteSpace: 'nowrap' }}>
      {m.medal} {label || m.label}
    </span>
  );
}

function useUser() {
  try {
    const u = useUcs();
    return u?.user || null;
  } catch { return null; }
}

const initialsOf = (name) => String(name || 'F')
  .split(' ')
  .slice(0, 2)
  .map(s => s[0]).join('').toUpperCase();

function Avatar({ url, name, size = 34 }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [url]);
  if (url && !err) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        border: '2px solid #f59e0b', background: 'var(--bg)',
      }}>
        <img src={url} alt={name} onError={() => setErr(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: '#b45309', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 800, border: '2px solid #fbbf24',
    }}>{initialsOf(name)}</div>
  );
}

// Shared hook: today's per-range leaderboard + realtime refresh.
export function useLeadIncentiveLeaderboard() {
  const [data, setData] = useState({ has_activity: false, ranges: [], champions: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const date = todayLocal();
      const r = await api(`/incentive/lead/leaderboard?date=${date}`, { _prefix: 'ucs' });
      if (r && Array.isArray(r.ranges)) setData(r);
      else setData({ has_activity: false, ranges: [], champions: [] });
    } catch { /* 401 / not launched yet / offline */ }
    finally { setLoading(false); }
  }, []);

  const debMsg = useRef(0);
  const reloadSoon = useCallback(() => {
    clearTimeout(debMsg.current);
    debMsg.current = setTimeout(() => load(), 1200);
  }, [load]);

  useRealtime('lead_champion_announcements', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon });
  useRealtime('incentive_slabs', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon });
  // No polling: verified collections arrive as fro_donor_logs and refresh us
  // through the same debounced reload (mirrors the admin board).
  useRealtime('fro_donor_logs', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon });

  useEffect(() => {
    load();
    return () => clearTimeout(debMsg.current);
  }, [load]);

  return { data, loading, reload: load };
}

// Reusable block: every live range rendered as a TOP-10 vertical bar chart.
// Bars are leader-relative (tallest = range leader), animate with live updates
// (CSS height transition on each realtime refresh) and use flat solid colors.
export function RangeLeaderboard({ data, you, spread = false }) {
  const ranges = data.ranges || [];
  const BAR_MAX = 140;   // bar region height (px)
  const FOOT_H = 54;     // avatar + name + leads zone below the bars

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ranges.map(r => {
        const fros = [...(r.fros || [])]
          .sort((a, b) => (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0))
          .slice(0, 10);
        const tierMode = !!r.tier_mode && (r.tiers || []).length > 0;
        const tiers = tierMode
          ? [...r.tiers].sort((a, b) => Number(a.target_amount) - Number(b.target_amount))
          : [];
        const maxTierTarget = tiers.length ? Math.max(...tiers.map(t => Number(t.target_amount) || 0)) : 0;
        const winOn = Number(r.amount_to_win) || 1500;
        const prize = Number(r.incentive_amount) || 0;
        // Scale so the tallest bar is the leader; tier lines sit proportionally.
        const leaderAmount = Math.max(1, maxTierTarget, ...fros.map(f => Number(f.total_amount) || 0));
        const lineBottomFor = (amount) => FOOT_H + Math.round(BAR_MAX * Math.min(1, Math.max(0, (Number(amount) || 0) / leaderAmount)));
        const leaderByKey = {};
        for (const l of r.tier_leaders || []) leaderByKey[l.tier_key] = l;

        return (
          <div key={r.slab_id} style={{ borderRadius: 14, border: '1.5px solid var(--line)', background: '#fff', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '10px 12px', background: '#fff3d6', borderBottom: '1px dashed #fcd34d', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ink)' }}>{r.slab_label}</span>
              <div style={{ flex: 1 }} />
              {tierMode ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: r.tiers_final ? '#22c55e' : '#ffedd5', color: r.tiers_final ? '#fff' : '#c2410c', fontSize: 11, fontWeight: 800 }}>
                  {r.tiers_final ? '🏆 FINAL winners' : '🥇 Milestone race — running'}
                </span>
              ) : r.champion ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: '#22c55e', color: '#fff', fontSize: 11, fontWeight: 800, animation: 'lil-pulse 1.6s ease-in-out infinite' }}>
                  🏆 {r.champion.fro_name} won
                </span>
              ) : (
                <span style={{ padding: '3px 10px', borderRadius: 999, background: '#ffedd5', color: '#c2410c', fontSize: 11, fontWeight: 800 }}>
                  🏁 Running — no winner yet
                </span>
              )}
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                {tierMode ? (
                  tiers.map(t => (
                    <TierPill key={t.tier_key} tierKey={t.tier_key} label={`${t.label} · reach ₹${fmt(t.target_amount)} → win ₹${fmt(t.prize_amount)}`} />
                  ))
                ) : (
                  <>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: '#fff', border: '1px solid #fde68a', fontSize: 11, fontWeight: 800, color: '#92400e' }}>
                      🎯 Win On ₹{fmt(winOn)} collected
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: '#fff', border: '1px solid #86efac', fontSize: 11, fontWeight: 800, color: '#166534' }}>
                      🏆 Prize ₹{fmt(prize)} · first to cross wins
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Bar chart */}
            <div style={{ padding: '14px 10px 8px' }}>
              <div style={{ position: 'relative', display: 'flex', justifyContent: spread ? 'stretch' : 'center', alignItems: 'stretch', gap: 6, minHeight: BAR_MAX + FOOT_H }}>
                {/* Target line(s): one per tier in milestone mode, else the Win On line */}
                {tierMode ? (
                  tiers.map(t => {
                    const m = tMeta(t.tier_key);
                    return (
                      <div key={t.tier_key} style={{
                        position: 'absolute', left: 8, right: 8, bottom: lineBottomFor(t.target_amount),
                        borderTop: `1.5px dashed ${m.color}`, opacity: .75, pointerEvents: 'none',
                      }}>
                        <span style={{ position: 'absolute', left: 0, top: -9, fontSize: 9, fontWeight: 800, color: m.color, background: '#fff', padding: '0 4px', whiteSpace: 'nowrap' }}>
                          {m.medal} {t.label} ₹{fmt(t.target_amount)}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div style={{
                    position: 'absolute', left: 8, right: 8, bottom: lineBottomFor(winOn),
                    borderTop: '1.5px dashed #16a34a', opacity: .7, pointerEvents: 'none',
                  }}>
                    <span style={{ position: 'absolute', left: 0, top: -9, fontSize: 9, fontWeight: 800, color: '#15803d', background: '#fff', padding: '0 4px', whiteSpace: 'nowrap' }}>
                      → Win On ₹{fmt(winOn)}
                    </span>
                  </div>
                )}

                {/* Top 10 columns */}
                {fros.map((f, i) => {
                  const isMe = you && String(f.fro_id) === String(you);
                  const pct = Math.min(100, Math.max(0, (Number(f.total_amount) || 0) / leaderAmount * 100));
                  // In milestone mode the winner isn't decided mid-race — only
                  // mark the bar green once the window is final.
                  const wonFinal = f.is_winner && (!tierMode || r.tiers_final);
                  const barColor = wonFinal ? '#16a34a' : (isMe ? '#b45309' : '#f59e0b');
                  return (
                    <div key={f.fro_id} style={{ flex: '1 1 0', maxWidth: spread ? 'none' : 64, minWidth: spread ? 0 : 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      {/* Bar region (bottom-aligned) */}
                      <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 3, overflow: 'hidden' }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: isMe ? '#b45309' : '#92400e', whiteSpace: 'nowrap', lineHeight: 1 }}>
                          ₹{fmt(f.total_amount)}
                        </span>
                        <div style={{
                          width: 26, height: pct ? `${Math.max(3, Math.round(BAR_MAX * pct / 100))}px` : '3px',
                          background: barColor, borderRadius: '6px 6px 0 0', transition: 'height .6s ease',
                          boxShadow: isMe ? '0 0 0 2px #fdba74' : 'none',
                        }} />
                      </div>
                      {/* Footer: avatar + name + leads */}
                      <div style={{ height: FOOT_H, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, justifyContent: 'flex-end', paddingTop: 4 }}>
                        <div style={{ position: 'relative' }}>
                          <Avatar url={f.photo_url} name={f.fro_name} size={26} />
                          <span style={{ position: 'absolute', top: -5, right: -6, fontSize: 11 }}>
                            {wonFinal ? '🏆' : (['🥇', '🥈', '🥉'][i] && <span>{['🥇', '🥈', '🥉'][i]}</span>)}
                          </span>
                        </div>
                        <span style={{ fontSize: 9.5, fontWeight: isMe ? 900 : 700, color: 'var(--ink)', maxWidth: 62, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.1 }}>
                          {f.fro_name}{isMe ? ' (you)' : ''}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', lineHeight: 1 }}>{f.qualified_leads || 0} verified ✓</span>
                      </div>
                    </div>
                  );
                })}

                {fros.length === 0 && (
                  <div style={{ padding: '16px 10px', fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center' }}>
                    No FROs competing in this range yet
                  </div>
                )}
              </div>

              {tierMode && (
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--line)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {tiers.map(t => {
                    const info = leaderByKey[t.tier_key];
                    const ldr = info?.leader;
                    const m = tMeta(t.tier_key);
                    const isFinal = r.tiers_final;
                    return (
                      <div key={t.tier_key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TierPill tierKey={t.tier_key} label={t.label} size={10} />
                        <span style={{ fontSize: 10, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>₹{fmt(t.target_amount)} → <b style={{ color: 'var(--ink)' }}>₹{fmt(t.prize_amount)}</b></span>
                        <span style={{ flex: 1, borderBottom: '1px dashed #fcd34d', opacity: .4 }} />
                        {ldr ? (
                          <span style={{ fontSize: 10.5, fontWeight: isFinal ? 800 : 600, color: isFinal ? '#166534' : (String(ldr.fro_id) === String(you) ? '#b45309' : 'var(--ink)'), whiteSpace: 'nowrap' }}>
                            {isFinal ? '🏆 ' : '📈 '}{ldr.fro_name}{String(ldr.fro_id) === String(you) ? ' (you)' : ''} · ₹{fmt(ldr.amount)}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#c2410c' }}>no one yet</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {fros.length > 0 && (
                <div style={{ fontSize: 9.5, color: 'var(--ink-soft)', textAlign: 'center', marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--line)' }}>
                  {tierMode
                    ? `Top ${fros.length} · bars update live · race runs till the window ends, then each tier's highest collection wins`
                    : `Top ${fros.length} · bars update live as verified collections come in · first to cross the 🎯 line wins ₹${fmt(prize)}`}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {ranges.length === 0 && (
        <div style={{ padding: 20, fontSize: 12.5, color: 'var(--ink-soft)', textAlign: 'center', lineHeight: 1.6 }}>
          No lead ranges are live right now.<br />Ranges appear here once Sir starts today's competition.
        </div>
      )}
    </div>
  );
}

// Big full-screen leaderboard popup: all ranges, ranked FROs, winner photos.
function LeaderboardModal({ data, you, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99991, background: 'rgba(15,23,42,.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <style>{LEAD_CSS}</style>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', borderRadius: 18,
        background: '#fffdf5',
        border: '2px solid #f59e0b', boxShadow: '0 24px 60px rgba(0,0,0,.35)',
        animation: 'lil-pop .4s cubic-bezier(.22,1,.36,1)', position: 'relative',
      }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 4, padding: '14px 18px 12px', background: '#b45309', borderBottom: '1px dashed #f59e0b88', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: 10.5, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'lil-pulse 1s linear infinite' }} /> Lead Incentive · LIVE
            </span>
            <span style={{ padding: '4px 11px', borderRadius: 999, background: 'rgba(255,255,255,.18)', fontSize: 10.5, fontWeight: 800 }}>⏳ Today</span>
            <div style={{ flex: 1 }} />
            <div onClick={onClose} style={{ cursor: 'pointer', width: 30, height: 30, borderRadius: 50, background: 'rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff' }}>✕</div>
          </div>
          <div style={{ fontSize: 17, fontWeight: 900, margin: '10px 0 2px', lineHeight: 1.25 }}>
            🚨🔥 SIR KA LEAD INCENTIVE – LIMITED TIME ONLY! 🔥🚨
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#ffe4b8', lineHeight: 1.5 }}>
            Collect the range's target to win — flat prize for the first to cross, or one prize per Bronze/Silver/Gold milestone. Every verified rupee counts!
          </div>
        </div>

        <div style={{ padding: 14 }}>
          <RangeLeaderboard data={data} you={you} />
        </div>

        <div style={{ padding: '0 14px 18px', textAlign: 'center' }}>
          <button onClick={onClose} style={{ width: '100%', padding: '11px 0', borderRadius: 10, border: 'none', background: 'var(--ink)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Keep collecting! 🔥</button>
        </div>
      </div>
    </div>
  );
}

// Winner card pinned to the TOP-RIGHT corner when a range is won — shows the
// winner's photo + name + prize, like "Sir ka Incentive". Dismissible per day.
function LeadWinnerCard({ champion, onClose, styleTop }) {
  const [open, setOpen] = useState(true);
  const [err, setErr] = useState(false);
  if (!champion || !open) return null;
  const url = champion.photo_url;
  const prize = Number(champion.slab_bonus) || Number(champion.total_incentive) || Number(champion.incentive_amount) || 0;
  return (
    <div style={{ position: 'fixed', top: styleTop || 74, right: 14, zIndex: 99984, width: 230, borderRadius: 14, overflow: 'hidden', border: '2px solid #f59e0b', background: '#fffdf5', boxShadow: '0 14px 34px rgba(0,0,0,.28)', animation: 'lil-rise .35s ease' }}>
      <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, cursor: 'pointer', width: 24, height: 24, borderRadius: 50, background: '#fff', border: '1.5px solid #f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: '#b45309', boxShadow: '0 2px 6px rgba(0,0,0,.18)' }}
        onClick={() => { setOpen(false); onClose && onClose(); }}>✕</div>
      {url && !err ? (
        <div style={{ height: 108, position: 'relative', overflow: 'hidden' }}>
          <img src={url} alt="Winner" onError={() => setErr(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#fde68a' }} />
          <div style={{ position: 'absolute', right: 6, top: 6, padding: '3px 8px', borderRadius: 999, background: 'rgba(255,255,255,.92)', fontSize: 10, fontWeight: 800, color: '#b45309', letterSpacing: .4 }}>
            🏆 {champion.tier_label ? `${champion.tier_label} Winner` : 'Winner'} · Today
          </div>
          <div style={{ position: 'absolute', left: 10, right: 10, bottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar url={url} name={champion.fro_name} size={30} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#fff', fontWeight: 900, fontSize: 14, textShadow: '0 1px 6px rgba(0,0,0,.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{champion.fro_name || 'The Winner'}</div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 12.5, textShadow: '0 1px 6px rgba(0,0,0,.5)' }}>Won ₹{fmt(prize)} 🎉</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative', fontSize: 30, animation: 'lil-bounce 1.2s ease-in-out infinite' }}>🏆</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#b45309', letterSpacing: .5, textTransform: 'uppercase' }}>{champion.tier_label ? `${champion.tier_label} Winner` : "Today's Winner"}</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{champion.fro_name || 'The Winner'}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#d97706' }}>Won ₹{fmt(prize)} 🎉</div>
          </div>
        </div>
      )}
      <div style={{ padding: '7px 10px', borderTop: '1px dashed #f59e0b88', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          Lead Incentive · {champion.slab_label}{champion.tier_label ? ` · ${champion.tier_label} tier (₹${fmt(champion.tier_target)})` : ''}
        </span>
      </div>
    </div>
  );
}

// Sticky corner widget shown only while today's lead competition is live.
// Styled like "Sir ka Incentive": brand header, my progress + the running ranges.
// Tap the card to open the big leaderboard. Dismissible per session.
export default function LeadIncentiveLeaderboard() {
  const user = useUser();
  const { data } = useLeadIncentiveLeaderboard();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [dismissedWinners, setDismissedWinners] = useState({});
  const freshTimer = useRef(0);
  const wasActiveRef = useRef(false);

  const isFro = !!user && (user.role === 'fro' || user.role === 'worker');
  const hasActivity = !!data.has_activity;
  const ranges = data.ranges || [];
  const competitionLive = ranges.length > 0;
  const you = user?.id || null;

  // "NEW" pulse when competition first appears this session; reset dismissal too.
  useEffect(() => {
    if (hasActivity && !wasActiveRef.current) {
      setDismissed(false);
      setFresh(true);
      clearTimeout(freshTimer.current);
      freshTimer.current = setTimeout(() => setFresh(false), 12000);
    }
    wasActiveRef.current = hasActivity;
    return () => clearTimeout(freshTimer.current);
  }, [hasActivity]);

  if (!isFro) return null;
  const winnerKeyOf = (c) => `${c.slab_id}|${c.tier_key || ''}`;
  const winners = (data.champions || []).filter(c => !dismissedWinners[winnerKeyOf(c)]);
  const showWidget = !open && !dismissed && competitionLive;
  const showAnything = showWidget || winners.length > 0;
  if (!open && !showAnything) return null;

  // The logged-in FRO's own range + progress (leaderboard already carries target).
  let me = null;
  for (const r of ranges) {
    const m = (r.fros || []).find(f => f.fro_id === you);
    if (m) { me = { ...m, range: r }; break; }
  }
  const myWinOn = me ? (Number(me.range.amount_to_win) || 1500) : 0;
  const myPrize = me ? (Number(me.range.incentive_amount) || 0) : 0;
  const myPct = me ? pctOf(me.total_amount, myWinOn) : 0;

  // Tier-mode progress for the logged-in FRO: which tier they've reached and how
  // much more to the next one (so "reached Gold" is never mistaken for "won").
  const myTiers = me && me.range.tier_mode
    ? [...(me.range.tiers || [])].sort((a, b) => Number(a.target_amount) - Number(b.target_amount))
    : [];
  let myReached = null;
  let myNext = null;
  if (me && myTiers.length) {
    for (const t of myTiers) {
      if ((Number(me.total_amount) || 0) >= Number(t.target_amount)) myReached = t;
    }
    myNext = myTiers.find(t => (Number(me.total_amount) || 0) < Number(t.target_amount)) || null;
  }

  return (
    <>
      <style>{LEAD_CSS}</style>

      {winners.map((c, idx) => (
        <LeadWinnerCard
          key={winnerKeyOf(c)}
          champion={c}
          styleTop={74 + idx * 158}
          onClose={() => setDismissedWinners(p => ({ ...p, [winnerKeyOf(c)]: true }))}
        />
      ))}

      {open && <LeaderboardModal data={data} you={you} onClose={() => setOpen(false)} />}

      {!open && showWidget && (
        <div style={{ position: 'fixed', right: 16, bottom: 96, zIndex: 99980, width: 'min(310px, calc(100vw - 32px))' }}>
          <div style={{ position: 'relative', cursor: 'pointer', animation: 'lil-rise .35s ease' }} onClick={() => setOpen(true)}>
            {fresh && (
              <div style={{ position: 'absolute', top: -8, right: -6, zIndex: 3, padding: '2px 9px', borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: .4, animation: 'lil-pulse 1.2s linear infinite' }}>🔴 NEW</div>
            )}
            <div style={{
              borderRadius: 16, overflow: 'hidden', border: '2px solid #f59e0b', background: '#fffdf5',
              boxShadow: '0 14px 34px rgba(0,0,0,.22)',
            }}>
              {/* Brand header */}
              <div style={{ padding: '10px 12px', background: '#b45309', color: '#fff', display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 15 }}>🏆</span>
                <div style={{ flex: 1, fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Lead Incentive · {ranges.length} range{ranges.length > 1 ? 's' : ''} live
                </div>
                <span style={{ fontSize: 9.5, fontWeight: 800, background: '#dc2626', color: '#fff', padding: '3px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'lil-pulse 1s linear infinite' }} /> LIVE
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 800, background: '#fff', color: '#b45309', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>TODAY</span>
              </div>

              <div style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11.5, fontWeight: 900, color: '#b45309', background: '#fff3d6', borderBottom: '1px dashed #fcd34d', lineHeight: 1.4 }}>
                🚨🔥 SIR KA LEAD INCENTIVE – LIMITED TIME ONLY! 🔥🚨
              </div>

              <div style={{ padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                {/* My progress — like Sir ka Incentive */}
                {me ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ animation: 'lil-bounce 2.6s ease-in-out infinite', flexShrink: 0 }}><CoinsBag size={44} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        My progress · {me.range.slab_label}{me.range.tier_mode ? '' : ` · prize ₹${fmt(myPrize)}`}
                      </div>
                      {me.range.tier_mode ? (
                        <>
                          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                            ₹{fmt(me.total_amount)} <span style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 }}>collected</span>
                          </div>
                          <div style={{ marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                            {myReached ? <TierPill tierKey={myReached.tier_key} label={`Reached ${myReached.label}`} size={9.5} /> : <span style={{ fontSize: 10, color: 'var(--ink-soft)', fontWeight: 700 }}>No tier yet</span>}
                            {myNext && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#b45309' }}>₹{fmt(Math.max(0, Number(myNext.target_amount) - (Number(me.total_amount) || 0)))} to {myNext.label}</span>}
                          </div>
                          <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: '#b45309', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <span>{me.qualified_leads} verified ✓</span>
                            <span>· highest collection at end wins each tier</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                            ₹{fmt(me.total_amount)} <span style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700 }}>/ ₹{fmt(myWinOn)} collected → win</span>
                          </div>
                          <div style={{ height: 8, borderRadius: 6, background: 'var(--line)', overflow: 'hidden', marginTop: 4 }}>
                            <div style={{ width: `${myPct}%`, height: '100%', background: '#f59e0b', borderRadius: 6, transition: 'width .5s ease' }} />
                          </div>
                          <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: '#b45309', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <span>{me.qualified_leads} verified ✓</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', textAlign: 'center', padding: '2px 0' }}>
                    You're not in a live range yet — open the leaderboard to see the running FROs!
                  </div>
                )}

                {/* Live ranges snapshot */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {ranges.slice(0, 4).map(r => {
                    if (r.tier_mode) {
                      const gold = [...(r.tiers || [])].sort((a, b) => Number(b.target_amount) - Number(a.target_amount))[0];
                      const goldLeader = (r.tier_leaders || []).find(l => l.tier_key === gold?.tier_key)?.leader;
                      return (
                        <div key={r.slab_id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink)' }}>
                          <span style={{ fontWeight: 700, color: '#b45309', flexShrink: 0 }}>{r.slab_label}</span>
                          <TierPill tierKey={gold?.tier_key} label={gold ? `top ${gold.label}` : 'tier'} size={9} />
                          <span style={{ flex: 1, borderBottom: '1px dashed #fcd34d', opacity: .4 }} />
                          {goldLeader ? (
                            <span style={{ fontSize: 11, fontWeight: String(goldLeader.fro_id) === String(you) ? 800 : 600, color: String(goldLeader.fro_id) === String(you) ? '#b45309' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 92 }}>
                              {goldLeader.fro_name}{String(goldLeader.fro_id) === String(you) ? ' (you)' : ''}
                            </span>
                          ) : (
                            <span style={{ color: '#c2410c', fontWeight: 700 }}>🏁 no lead</span>
                          )}
                        </div>
                      );
                    }
                    const leader = r.champion
                      ? { name: r.champion.fro_name, won: true }
                      : (r.fros && r.fros.length ? { name: r.fros[0].fro_name, won: false } : null);
                    return (
                      <div key={r.slab_id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink)' }}>
                        <span style={{ fontWeight: 700, color: '#b45309', flexShrink: 0 }}>{r.slab_label}</span>
                        <span style={{ flex: 1, borderBottom: '1px dashed #fcd34d', opacity: .4 }} />
                        {leader ? (
                          <span style={{ fontSize: 11, fontWeight: leader.won ? 800 : 600, color: leader.won ? '#166534' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                            {leader.name}{leader.won ? ' 🏆' : ''}
                          </span>
                        ) : (
                          <span style={{ color: '#c2410c', fontWeight: 700 }}>🏁 no lead</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 4, textAlign: 'center', fontSize: 11, fontWeight: 800, color: '#b45309', background: '#fffdf5', border: '1.5px dashed #f59e0b', borderRadius: 9, padding: '5px 8px' }}>
              👆 Tap to view full leaderboard ▶
            </div>
            <div
              onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
              title="Hide for today"
              style={{ position: 'absolute', top: 4, right: 6, cursor: 'pointer', width: 22, height: 22, borderRadius: 50, background: 'rgba(0,0,0,.16)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</div>
          </div>
        </div>
      )}
    </>
  );
}
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../api/auth';
import { useUcs } from '../../../store';
import { useRealtime } from '../../../hooks/useRealtime';
import { useLeadIncentiveLeaderboard, RangeLeaderboard, TierPill, tMeta } from '../../../components/LeadIncentiveLeaderboard';

const fmt = (n) => {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-IN');
};

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const LEAD_PAGE_CSS = `
@keyframes lp-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes lp-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes lp-pop-in { 0% { transform: scale(.7) translateY(30px); opacity: 0; } 70% { transform: scale(1.04); } 100% { transform: scale(1) translateY(0); opacity: 1; } }
@keyframes lp-celebrate { 0%,100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(-12px) rotate(-8deg); } 75% { transform: translateY(-12px) rotate(8deg); } }
`;

function Avatar({ url, name, size = 44 }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [url]);
  const initials = String(name || 'W').split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase();
  if (url && !err) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, border: '3px solid #fbbf24', background: 'var(--bg)' }}>
        <img src={url} alt={name} onError={() => setErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 900, border: '3px solid #4ade80' }}>
      {initials}
    </div>
  );
}

function WinnerPopup({ champion, onClose }) {
  const me = useUcs();
  const isMe = me?.user && champion && String(champion.fro_id) === String(me.user.id);
  if (!champion) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: 'rgba(15,23,42,.66)', backdropFilter: 'blur(3px)', animation: 'lp-rise .2s ease' }}>
      <div style={{ width: '100%', maxWidth: 360, borderRadius: 20, overflow: 'hidden', background: '#fefce8', border: '3px solid #f59e0b', boxShadow: '0 24px 60px rgba(180,83,9,.45)', animation: 'lp-pop-in .45s cubic-bezier(.2,1.4,.4,1)' }}>
        <div style={{ padding: '18px 20px', textAlign: 'center', position: 'relative' }}>
          <button onClick={onClose} style={{ position: 'absolute', top: 10, right: 12, border: 'none', background: 'rgba(146,64,14,.12)', color: '#92400e', width: 28, height: 28, borderRadius: '50%', fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1 }}>✕</button>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#92400e', letterSpacing: 1 }}>🏆 LEAD INCENTIVE WINNER 🏆</div>
          <div style={{ fontSize: 46, margin: '8px 0 4px', animation: 'lp-celebrate 1.2s ease-in-out infinite', display: 'inline-block' }}>🎉</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <Avatar url={champion.photo_url} name={champion.fro_name} size={64} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#78350f' }}>{champion.fro_name}{isMe ? ' (you!)' : ''}</div>
          {champion.tier_mode && champion.tier_label && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
              <TierPill tierKey={champion.tier_key} label={`${champion.tier_label} tier winner`} size={11} />
            </div>
          )}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#b45309', margin: '6px 0 2px' }}>
            {isMe
              ? (champion.tier_mode ? `🎊 Congratulations! You won the ${champion.tier_label || ''} tier!` : '🎊 Congratulations! You won the range!')
              : (champion.tier_mode ? `Won the ${champion.tier_label || ''} tier in ${champion.slab_label || 'the range'}!` : `Won the ${champion.slab_label || 'range'}!`)}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#78350f', marginTop: 8 }}>
            {champion.tier_mode
              ? <>Highest collection at window close — tier prize <span style={{ color: '#16a34a' }}>+₹{fmt(champion.tier_bonus ?? champion.slab_bonus ?? 0)}</span></>
              : <>Crossed <span style={{ color: '#b45309' }}>₹{fmt(champion.crossing_amount ?? champion.hit_amount ?? champion.total_amount)}</span> — flat prize <span style={{ color: '#16a34a' }}>+₹{fmt(champion.slab_bonus ?? champion.total_incentive ?? 0)}</span></>}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <span style={{ padding: '4px 10px', borderRadius: 999, background: '#dcfce7', border: '1px solid #86efac', fontSize: 11, fontWeight: 800, color: '#166534' }}>{champion.qualified_leads} verified leads ✓</span>
          </div>
          <button onClick={onClose} style={{ marginTop: 14, width: '100%', padding: '10px 0', borderRadius: 11, border: 'none', background: '#d97706', color: '#fff', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}>
            Awesome, got it! 🥳
          </button>
        </div>
      </div>
    </div>
  );
}

function useUser() {
  try {
    const u = useUcs();
    return u?.user || null;
  } catch { return null; }
}

function StatCard({ label, value, unit, color, icon }) {
  return (
    <div style={{ borderRadius: 14, border: '1.5px solid var(--line)', background: 'var(--card-bg)', padding: '12px 14px', boxShadow: '0 2px 10px rgba(0,0,0,.04)' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4, display: 'flex', alignItems: 'center', gap: 5 }}>
        {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, color: color || 'var(--ink)', marginTop: 4, whiteSpace: 'nowrap' }}>
        {unit}{fmt(value)}
      </div>
    </div>
  );
}

function HeroLive({ summary }) {
  const slab = summary?.slab;
  const rangeLabel = slab
    ? `₹${fmt(slab.min_amount)} – ₹${fmt(slab.max_amount)}`
    : 'your range';
  const winOn = Number(summary?.amount_to_win) || 1500;
  const prize = Number(summary?.slab?.incentive_amount) || Number(summary?.incentive_amount) || 0;
  const collected = Number(summary?.total_amount) || 0;
  const pct = winOn > 0 ? Math.min(100, Math.max(0, collected / winOn * 100)) : 0;

  const tierMode = !!summary?.tier_mode && (summary?.tiers || []).length > 0;
  const tiers = tierMode
    ? [...summary.tiers].sort((a, b) => Number(a.target_amount) - Number(b.target_amount))
    : [];
  const maxTarget = tiers.length ? Number(tiers[tiers.length - 1].target_amount) || 0 : 0;
  let reached = null;
  let next = null;
  for (const t of tiers) {
    if (collected >= (Number(t.target_amount) || 0)) reached = t;
    else if (!next) next = t;
  }
  const tierPct = maxTarget > 0 ? Math.min(100, Math.max(0, collected / maxTarget * 100)) : 0;
  const toNext = next ? Math.max(0, Number(next.target_amount) - collected) : 0;

  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', border: '2px solid #f59e0b', background: '#b45309', boxShadow: '0 14px 34px rgba(180,83,9,.28)', animation: 'lp-rise .35s ease' }}>
      <div style={{ padding: '16px 18px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: 10.5, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'lp-pulse 1s linear infinite' }} /> Lead Incentive · LIVE
          </span>
          <span style={{ padding: '4px 11px', borderRadius: 999, background: 'rgba(255,255,255,.18)', fontSize: 10.5, fontWeight: 800 }}>⏳ Today</span>
          {rangeLabel !== 'your range' && (
            <span style={{ padding: '4px 11px', borderRadius: 999, background: 'rgba(255,255,255,.18)', fontSize: 10.5, fontWeight: 800 }}>{rangeLabel}</span>
          )}
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, margin: '12px 0 4px', lineHeight: 1.25 }}>
          🚨🔥 SIR KA LEAD INCENTIVE – LIMITED TIME ONLY! 🔥🚨
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#ffe4b8', lineHeight: 1.6 }}>
          {tierMode
            ? 'Reach each Bronze / Silver / Gold target to race for it. When the window closes, the FRO with the highest collection in each tier wins that tier\u2019s prize!'
            : 'First FRO to collect the 🎯 Win On amount wins the flat prize! Every verified rupee counts. Let\u2019s go!'}
        </div>

        {tierMode ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>
              <span style={{ color: '#ffe4b8' }}>{reached ? `Reached ${reached.label}` : 'My collection'} · ladder to ₹{fmt(maxTarget)}</span>
              <span style={{ color: '#fff' }}>₹{fmt(collected)}</span>
            </div>
            <div style={{ position: 'relative', height: 16, borderRadius: 8, background: 'rgba(255,255,255,.2)', overflow: 'hidden' }}>
              <div style={{ width: `${tierPct}%`, height: '100%', background: '#fde047', borderRadius: 8, transition: 'width .5s ease' }} />
              {tiers.map(t => {
                const frac = maxTarget > 0 ? Math.min(100, Number(t.target_amount) / maxTarget * 100) : 0;
                const m = tMeta(t.tier_key);
                return (
                  <div key={t.tier_key} style={{ position: 'absolute', top: 0, bottom: 0, left: `${frac}%`, width: 2, background: '#fff', opacity: .85 }} />
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
              {tiers.map(t => {
                const done = collected >= (Number(t.target_amount) || 0);
                return (
                  <span key={t.tier_key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 10, background: done ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.16)', color: done ? tMeta(t.tier_key).color : '#fff', fontSize: 11, fontWeight: 800 }}>
                    {tMeta(t.tier_key).medal} {t.label} · ₹{fmt(t.target_amount)} → ₹{fmt(t.prize_amount)}
                  </span>
                );
              })}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: '#fff' }}>
              {next
                ? <>🎯 ₹{fmt(toNext)} more to reach <span style={{ color: '#fde047' }}>{next.label}</span> — highest collection at close wins</>
                : <>🏁 You've cleared every tier target — hold your lead till the window closes!</>}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 180 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
                <span style={{ color: '#ffe4b8' }}>My collection · win at</span>
                <span style={{ color: '#fff' }}>₹{fmt(collected)} <span style={{ opacity: .75, fontWeight: 600 }}>/ ₹{fmt(winOn)}</span></span>
              </div>
              <div style={{ height: 9, borderRadius: 6, background: 'rgba(255,255,255,.22)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#fde047', borderRadius: 6, transition: 'width .5s ease' }} />
              </div>
            </div>
            <span style={{ padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,255,.16)', fontSize: 12, fontWeight: 800 }}>🎯 Win On ₹{fmt(winOn)} · 🏆 Prize ₹{fmt(prize)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function HeroWaiting({ summary, ranges }) {
  const liveRangeCount = (ranges || []).length;
  return (
    <div style={{ borderRadius: 16, border: '1.5px dashed var(--line)', background: 'var(--card-bg)', padding: '18px', textAlign: 'center', animation: 'lp-rise .35s ease' }}>
      <div style={{ fontSize: 26 }}>🏆</div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--ink)', margin: '6px 0 2px' }}>Lead Incentive</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>
        {liveRangeCount > 0
          ? 'Your range hasn\u2019t started yet — the competition is live for other ranges. Keep collecting; your leads will count once your range starts!'
          : 'No lead ranges are live right now. Come back when Sir starts today\u2019s Lead Incentive competition!'}
      </div>
    </div>
  );
}

export default function LeadIncentive() {
  const user = useUser();
  const you = user?.id || null;
  const { data, loading } = useLeadIncentiveLeaderboard();

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const debRef = useRef(0);
  const [popupChamp, setPopupChamp] = useState(null);
  const seenChipRef = useRef(new Set());

  useEffect(() => {
    const newChamp = (data.champions || []).find(c => !seenChipRef.current.has(String(c.fro_id) + '|' + c.slab_id + '|' + (c.tier_key || '')));
    if (newChamp) {
      seenChipRef.current.add(String(newChamp.fro_id) + '|' + newChamp.slab_id + '|' + (newChamp.tier_key || ''));
      setPopupChamp(newChamp);
    }
  }, [data.champions]);

  const loadSummary = useCallback(async () => {
    try {
      const date = todayLocal();
      const r = await api(`/incentive/lead/my-summary?date=${date}`, { _prefix: 'ucs' });
      if (r) setSummary(r);
    } catch { /* not found / offline */ }
    finally { setSummaryLoading(false); }
  }, []);

  const reloadSoon = useCallback(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(loadSummary, 800);
  }, [loadSummary]);

  useRealtime('lead_champion_announcements', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon });
  useRealtime('incentive_slabs', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon });
  // Verified collections land as fro_donor_logs — same realtime source the
  // admin board uses, so the race updates live with zero polling.
  useRealtime('fro_donor_logs', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon });

  useEffect(() => {
    loadSummary();
    return () => { clearTimeout(debRef.current); };
  }, [loadSummary]);

  const ranges = data.ranges || [];
  const live = !!summary?.is_live;
  const isChampion = !!summary?.is_champion;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860, margin: '0 auto', padding: '4px 0 24px' }}>
      <style>{LEAD_PAGE_CSS}</style>

      <WinnerPopup champion={popupChamp} onClose={() => setPopupChamp(null)} />

      <div>
        <h3 style={{ margin: 0 }}>🏆 Lead Incentive</h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
          Win by collecting the most in your range — first to cross the Win On target, or the top collector in each Bronze/Silver/Gold tier when the window closes.
        </p>
      </div>

      {summaryLoading ? (
        <div style={{ borderRadius: 16, border: '1.5px dashed var(--line)', background: 'var(--card-bg)', padding: '22px', textAlign: 'center', fontSize: 13, color: 'var(--ink-soft)' }}>
          Loading lead incentive…
        </div>
      ) : live ? (
        <HeroLive summary={summary} />
      ) : (
        <HeroWaiting summary={summary} ranges={ranges} />
      )}

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, animation: 'lp-rise .35s ease' }}>
          <StatCard label="My Range" icon="🎯" value={summary.slab ? `₹${fmt(summary.slab.min_amount)} – ₹${fmt(summary.slab.max_amount)}` : '—'} />
          <StatCard label="Target" icon="📈" value={summary.target} unit="₹" />
          <StatCard label="Collected" icon="💰" value={summary.total_amount} unit="₹" color="#16a34a" />
          <StatCard label="Verified Leads" icon="✅" value={summary.qualified_leads} />
          {summary.tier_mode ? (
            <StatCard label="Tier Won" icon="🏅" value={summary.tier_bonus || 0} unit="₹" color={isChampion ? '#16a34a' : '#b45309'} />
          ) : (
            <>
              <StatCard label="Win On" icon="🎯" value={summary.amount_to_win ?? 1500} unit="₹" color="#b45309" />
              <StatCard label="Prize" icon="🏆" value={summary.slab_bonus} unit="₹" color={isChampion ? '#16a34a' : '#b45309'} />
            </>
          )}
          <StatCard label="Total Incentive" icon="💵" value={summary.total_incentive} unit="₹" color="#b45309" />
        </div>
      )}

      {isChampion && (
        <div style={{ borderRadius: 14, padding: '12px 16px', background: '#dcfce7', border: '2px solid #22c55e', display: 'flex', alignItems: 'center', gap: 10, animation: 'lp-rise .35s ease' }}>
          <span style={{ fontSize: 26 }}>🏆</span>
          <div style={{ flex: 1 }}>
            {summary.tier_mode ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 900, color: '#166534' }}>You won {(summary.won_tiers || []).length} tier prize{(summary.won_tiers || []).length > 1 ? 's' : ''} today! 🎉</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                  {(summary.won_tiers || []).map(w => (
                    <TierPill key={w.tier_key} tierKey={w.tier_key} label={`${w.label} · +₹${fmt(w.prize)}`} size={10.5} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 900, color: '#166534' }}>You are today's range champion!</div>
                <div style={{ fontSize: 12, color: '#15803d' }}>
                  First to collect the range's Win On amount — flat prize ₹{fmt(summary.slab_bonus)} added.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ borderRadius: 16, border: '1.5px solid var(--line)', background: 'var(--card-bg)', overflow: 'hidden', animation: 'lp-rise .35s ease' }}>
        <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)' }}>🏆 Live Ranges</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Range-wise leaderboard — live standings and per-tier leaders</div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999, background: live ? '#dc2626' : 'var(--line)', color: live ? '#fff' : 'var(--ink-soft)', fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase' }}>
            {live ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'lp-pulse 1s linear infinite' }} /> : null}
            {live ? 'LIVE' : 'Not started'}
          </span>
        </div>
        <div style={{ padding: 12 }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--ink-soft)' }}>Loading live ranges…</div>
          ) : (
            <RangeLeaderboard data={data} you={you} />
          )}
        </div>
      </div>

      {summary && (summary.leads || []).length > 0 && (
        <div style={{ borderRadius: 16, border: '1.5px solid var(--line)', background: 'var(--card-bg)', overflow: 'hidden', animation: 'lp-rise .35s ease' }}>
          <div style={{ padding: '14px 16px 0' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)' }}>📋 My Verified Leads Today</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{summary.qualified_leads} of {summary.leads.length} leads collected today</div>
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {summary.leads.map(l => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 10, background: 'var(--bg)', border: '1.5px solid var(--line)' }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: l.qualified ? '#16a34a' : 'var(--ink-soft)', flexShrink: 0 }}>{l.qualified ? '✓' : '✗'}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.donor_name}{l.donor_mobile ? ` · ${l.donor_mobile}` : ''}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: l.qualified ? '#16a34a' : 'var(--ink-soft)', flexShrink: 0 }}>₹{fmt(l.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
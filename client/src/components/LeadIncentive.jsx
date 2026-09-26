import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { api } from '../api/auth'
import { useRealtime } from '../hooks/useRealtime'
import { ChartBar, ArrowsClockwise, GearSix, Stack, CaretRight, Plus, X, Trophy, Users, CalendarBlank, FileText, PencilSimple, Trash, Play, ClockCounterClockwise, Sparkle, Camera, PaperPlaneTilt, CheckCircle, Clock } from '@phosphor-icons/react'

const fmt = (n) => {
  const v = Number(n)
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-IN')
}

const pad2 = (n) => String(n).padStart(2, '0')
const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
const DEFAULT_END_TIME = '19:00' // blank end time → range runs until 7:00 PM today
const toTimeInput = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`
}
// Combine today's date with an HH:MM time → a local Date (null when blank).
const todayAt = (hhmm) => {
  if (!hhmm) return null
  const dt = new Date(`${todayLocal()}T${hhmm}`)
  return Number.isNaN(dt.getTime()) ? null : dt
}
const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const fmtTime = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

const fmtSlabRange = (s) => `₹${fmt(s.min_amount)} ↔ ₹${fmt(s.max_amount)}`

// A stale DB could hold duplicate rows for the same (min, max) range, which would
// make the UI list every range twice. Keep a single row per range — preferring an
// active one — so the screen never shows "double" ranges.
const uniqueByRange = (rows) => {
  const map = new Map()
  for (const s of rows || []) {
    const key = `${Number(s.min_amount)}-${Number(s.max_amount)}`
    const cur = map.get(key)
    if (!cur || (!cur.is_active && s.is_active)) map.set(key, s)
  }
  return [...map.values()]
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
  border: '1.5px solid var(--line)', background: 'var(--card-bg)', color: 'var(--ink)',
  fontSize: 13.5, outline: 'none',
}

const btnStyle = (bg = 'var(--ink)', fg = '#fff') => ({
  padding: '8px 16px', borderRadius: 10, border: 'none', background: bg, color: fg,
  fontWeight: 700, fontSize: 13, cursor: 'pointer',
})

const slabInputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1.5px solid var(--line)', background: 'var(--card-bg)', color: 'var(--ink)',
  fontSize: 13, outline: 'none', textAlign: 'right',
}

// ─── Exact color tokens from the reference design ─────────
const C = {
  primary: '#1677E8',
  dark: '#12233F',
  muted: '#65758B',
  line: '#DCE7F5',
  panelBg: '#FFFFFF',
  pageBg: '#F7FAFE',
  green: '#18A957',
  greenBg: '#EAF9F0',
  end: '#F2A23A',
  endBg: '#FFF5DF',
  ns: '#6C8EBF',
  nsBg: '#F1F6FC',
}

const STATUS_META = {
  running: { label: 'Running', color: C.green, bg: C.greenBg, accent: C.green },
  ended: { label: 'Ended', color: '#B7791F', bg: C.endBg, accent: C.end },
  not_started: { label: 'Not Started', color: C.ns, bg: C.nsBg, accent: C.ns },
}

// Range status: Running only while its live window is open. The moment the
// live is over (end time passed, or never started), it goes back to
// Not Started so it can be started fresh again.
const rangeStatus = (slab) => {
  if (!slab) return 'not_started'
  if (!slab.started_at) return 'not_started'
  const s = new Date(slab.started_at).getTime()
  if (Number.isNaN(s) || s > Date.now()) return 'not_started'
  if (slab.ended_at) {
    const e = new Date(slab.ended_at).getTime()
    if (!Number.isNaN(e) && e <= Date.now()) return 'not_started'
  }
  return 'running'
}

// A range stopped by an admin today stays hidden until it is started again.
const stoppedToday = (slab) => !!(
  slab && slab.stopped_date && String(slab.stopped_date).slice(0, 10) === todayLocal()
)

// The 3-minute pre-live window after clicking Start: started_at sits a few
// minutes in the future. Return that exact timestamp (ISO) so the table can
// show a live countdown; null when the range has gone live or never started.
const pendingStartAt = (slab) => {
  if (!slab || !slab.started_at) return null
  const s = new Date(slab.started_at).getTime()
  if (Number.isNaN(s) || s <= Date.now()) return null
  return slab.started_at
}

const LI_CSS = `
.li-grid, .li-col, .li-panel, .li-table-scroll { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-sizing: border-box; color: ${C.dark}; }
.li-col *, .li-panel *, .li-table-scroll *, .li-col *:before, .li-panel *:before, .li-col *:after, .li-panel *:after { box-sizing: border-box; }
.li-col img, .li-panel img { max-width: 100%; }
.li-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.9fr); gap: 16px; align-items: start; max-width: 100%; }
.li-col { min-width: 0; max-width: 100%; }
.li-panel { background: ${C.panelBg}; border: 1px solid ${C.line}; border-radius: 12px; box-shadow: 0 2px 10px rgba(30,80,140,.05); overflow: hidden; max-width: 100%; }
.li-table-scroll { overflow-x: auto; max-width: 100%; }
.li-table { width: 100%; min-width: 460px; table-layout: fixed; border-collapse: collapse; }
.li-ranges-table { min-width: 640px; }
.li-noscroll { scrollbar-width: none; -ms-overflow-style: none; }
.li-noscroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
.li-table th { padding: 9px 10px; font-size: 11px; font-weight: 700; color: #52698A; background: #F8FAFD; border-bottom: 1px solid #E5EDF7; white-space: nowrap; }
.li-table td { padding: 9px 10px; font-size: 13px; }
.li-table tbody tr { border-bottom: 1px solid #F2F6FB; transition: background .15s ease; }
.li-table tbody tr:last-child { border-bottom: none; }
.li-table tbody tr:hover { background: #F8FBFF; }
.li-configure { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid #E2EAF5; background: #fff; color: #52698A; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background .15s ease, color .15s ease, border-color .15s ease; }
.li-configure:hover { background: #F4F9FF; color: ${C.primary}; border-color: #CDE4FF; }
@keyframes li-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
.li-shimmer { background: linear-gradient(90deg, #F2F6FB 25%, #E8EEF6 37%, #F2F6FB 63%); background-size: 800px 100%; animation: li-shimmer 1.2s ease-in-out infinite; border-radius: 6px; }
@keyframes li-rot { to { transform: rotate(360deg); } }
.li-spin { animation: li-rot .7s linear infinite; }
@media (max-width: 1199px) { .li-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .li-panel-head { flex-direction: column; align-items: stretch; } }
`

// ─── Avatar ───────────────────────────────────────────────
const initialsOf = (name) => String(name || 'F')
  .split(' ')
  .slice(0, 2)
  .map(s => s[0]).join('').toUpperCase()

function Avatar({ url, name, size = 28 }) {
  const [err, setErr] = useState(false)
  useEffect(() => { setErr(false) }, [url])
  const box = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    border: '1.5px solid #EAF1FB', background: '#EAF1FB',
  }
  if (url && !err) {
    return (
      <img src={url} alt={name} onError={() => setErr(true)}
        style={{ ...box, objectFit: 'cover', display: 'block' }} />
    )
  }
  return (
    <div style={{ ...box, color: '#4473B8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 700 }}>
      {initialsOf(name)}
    </div>
  )
}

// ─── Status pill ──────────────────────────────────────────
function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.not_started
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px',
      borderRadius: 999, background: m.bg, color: m.color, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color, display: 'inline-block' }} />
      {m.label}
    </span>
  )
}

// ─── Live countdown until a range goes live ───────────────
// Shows only after Start is clicked (started_at set ~3 min ahead) and ticks
// down to 0:00, after which the range counts as Running.
function StartCountdown({ startedAt, onDone }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const target = new Date(startedAt).getTime()
  const valid = Number.isFinite(target)
  const remaining = valid ? Math.max(0, Math.ceil((target - now) / 1000)) : 0
  const fired = useRef(false)
  useEffect(() => {
    if (valid && remaining === 0 && !fired.current) {
      fired.current = true
      onDone && onDone()
    }
  }, [valid, remaining, onDone])
  if (!valid || remaining === 0) return null
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: '#FFF7E8', color: '#B7791F', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      <Clock size={11} weight="fill" /> {mm}:{ss}
    </span>
  )
}

// ─── Compact horizontal progress bar ──────────────────────
function MiniBar({ pct, color }) {
  return (
    <div style={{ height: 8, borderRadius: 999, background: '#EDF2F7', overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%`, height: '100%', borderRadius: 999, background: color || C.primary, transition: 'width .3s ease' }} />
    </div>
  )
}

// ─── Range display: min ◀━━━━▶ max, column-aligned ────────
// minW/maxW are fixed ch widths (longest labels across rows) so every row's
// minimums end at the same x and every maximum starts at the same x.
function RangeArrow({ min, max, minW, maxW }) {
  const tri = (side) => side === 'left'
    ? { borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderRight: `6px solid ${C.primary}` }
    : { borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: '6px solid #9CC4F5' }
  const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700, color: C.dark }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0, maxWidth: '100%' }}>
      <span style={{ ...num, width: minW ? `${minW}ch` : 'auto', textAlign: 'right', flexShrink: 0 }}>₹{fmt(min)}</span>
      <span style={{ position: 'relative', flex: '1 1 28px', minWidth: 28, height: 2, borderRadius: 2, background: `linear-gradient(90deg, ${C.primary}, #9CC4F5)` }}>
        <span style={{ position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)', width: 0, height: 0, ...tri('left') }} />
        <span style={{ position: 'absolute', right: -1, top: '50%', transform: 'translateY(-50%)', width: 0, height: 0, ...tri('right') }} />
      </span>
      <span style={{ ...num, width: maxW ? `${maxW}ch` : 'auto', textAlign: 'left', flexShrink: 0 }}>₹{fmt(max)}</span>
    </span>
  )
}

const RANK_META = [
  { color: '#A9760C', bg: '#FDF1D6' },
  { color: '#5E6B7E', bg: '#EEF2F6' },
  { color: '#9A5A22', bg: '#FBEDDE' },
]

// ─── Leaderboard member row (top 3) ───────────────────────
function MemberRow({ f, i, r, onSelect }) {
  const pct = r.winOn > 0 ? Math.min(100, Math.round(((Number(f.total_amount) || 0) / r.winOn) * 100)) : 0
  const rank = RANK_META[i] || RANK_META[2]
  return (
    <button type="button"
      onClick={() => onSelect && onSelect(f.fro_id)}
      title={f.is_winner ? `${f.fro_name} — winner` : `View ${f.fro_name}'s leads`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px',
        border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
        transition: 'background .15s ease',
      }}>
      <span style={{
        width: 18, height: 18, borderRadius: '50%', background: rank.bg, color: rank.color,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0,
      }}>{i + 1}</span>
      <Avatar url={f.photo_url} name={f.fro_name} size={28} />
      <span style={{
        flex: '1 1 0', minWidth: 0, fontSize: 12.5, fontWeight: f.is_winner ? 700 : 600,
        color: f.is_winner ? '#168A4E' : C.dark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {f.fro_name}{f.is_winner ? ' 🏆' : ''}
      </span>
      <span style={{ flex: '0 1 auto', fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
        ₹{fmt(f.total_amount)} <span style={{ color: '#B9C8DC' }}>/ ₹{fmt(r.winOn)}</span>
      </span>
      <div style={{ flex: '0 1 58px', minWidth: 40 }}>
        <MiniBar pct={pct} />
      </div>
      <span style={{ flexShrink: 0, width: 34, textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.dark }}>{pct}%</span>
    </button>
  )
}

// ─── Leaderboard card empty state (not started / no activity) ───
function LeaderboardEmpty({ status }) {
  const isNs = status === 'not_started'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '30px 16px' }}>
      <span style={{ width: 36, height: 36, borderRadius: '50%', background: C.nsBg, color: C.ns, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Users size={18} />
      </span>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.dark, marginTop: 8 }}>
        {isNs ? 'Leaderboard will be visible once the range starts' : 'No verified collections yet'}
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
        Be the first to make verified collections!
      </div>
    </div>
  )
}

// ─── Right panel: per-range compact leaderboard card ──────
function RangeCard({ r, onViewAll, onSelectFro }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #F2F6FB' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: C.dark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.slab_label}
          </span>
          <StatusPill status={r.status} />
        </div>
        <div style={{ marginTop: 6, fontSize: 11.5, color: C.muted }}>
          Win On <b style={{ color: C.dark, fontWeight: 600 }}>₹{fmt(r.winOn)}</b>
          <span style={{ margin: '0 5px', color: '#B9C8DC' }}>|</span>
          Prize <b style={{ color: C.dark, fontWeight: 600 }}>₹{fmt(r.prize)}</b>
        </div>
      </div>

      {r.top3.length > 0 ? (
        <>
          <div style={{ padding: '6px 0' }}>
            {r.top3.map((f, i) => <MemberRow key={`${r.slab_id}-${f.fro_id}`} f={f} i={i} r={r} onSelect={onSelectFro} />)}
          </div>
          {r.totalCount > 3 && (
            <div style={{ padding: '4px 12px 10px', textAlign: 'right' }}>
              <button type="button" onClick={() => onViewAll && onViewAll(r)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', padding: 0, color: C.primary, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                View All ({r.totalCount}) <CaretRight size={12} weight="bold" />
              </button>
            </div>
          )}
        </>
      ) : (
        <LeaderboardEmpty status={r.status} />
      )}
    </div>
  )
}

// ─── Left panel: Incentive Ranges ─────────────────────────
function IncentiveRangesPanel({ ranges, loading, slabFros, onConfigure, onTargetSlabs, onCountdownDone }) {
  // Fixed label widths (longest min/max across rows) so every row's arrow
  // starts and ends at the same distance — nothing looks crooked.
  const arrowW = useMemo(() => {
    let minW = 0
    let maxW = 0
    for (const r of ranges || []) {
      minW = Math.max(minW, (`₹${fmt(r.slab.min_amount)}`).length)
      maxW = Math.max(maxW, (`₹${fmt(r.slab.max_amount)}`).length)
    }
    return { minW, maxW }
  }, [ranges])
  const [viewFros, setViewFros] = useState(null)
  return (
    <div className="li-panel">
      <div className="li-panel-head" style={{ padding: '10px 14px', borderBottom: '1px solid #EEF2F8', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: '#E8F3FF', color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Stack size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.dark, lineHeight: 1.2 }}>Incentive Ranges</div>
        </div>
        <button type="button" onClick={onTargetSlabs}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px', borderRadius: 8, border: `1px solid ${C.line}`, background: '#fff', color: C.dark, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          <FileText size={14} /> Target Slabs
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '10px 16px 14px' }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px', borderBottom: '1px solid #F2F6FB' }}>
              <div className="li-shimmer" style={{ width: 24, height: 12, flexShrink: 0 }} />
              <div className="li-shimmer" style={{ flex: 1, height: 12 }} />
              <div className="li-shimmer" style={{ width: 92, height: 20, borderRadius: 999, flexShrink: 0 }} />
              <div className="li-shimmer" style={{ width: 72, height: 26, borderRadius: 999, flexShrink: 0 }} />
              <div className="li-shimmer" style={{ width: 76, height: 28, borderRadius: 8, flexShrink: 0 }} />
            </div>
          ))}
        </div>
      ) : ranges.length === 0 ? (
        <div style={{ padding: '58px 20px', textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, margin: '0 auto 12px', borderRadius: '50%', background: C.nsBg, color: C.ns, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Stack size={22} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.dark }}>No incentive ranges yet</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>Create your first incentive range to start tracking collections.</div>
          <button type="button" onClick={onTargetSlabs}
            style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', borderRadius: 9, border: `1px solid ${C.line}`, background: '#fff', color: C.dark, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <FileText size={15} /> Target Slabs
          </button>
        </div>
      ) : (
        <div className="li-table-scroll">
          <table className="li-table li-ranges-table">
            <colgroup>
              <col style={{ width: 34 }} />
              <col />
              <col style={{ width: 70 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>#</th>
                <th style={{ textAlign: 'left' }}>Range (₹)</th>
                <th style={{ textAlign: 'center' }}>Starts In</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th style={{ textAlign: 'left' }}>FROs</th>
                <th style={{ textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {ranges.map(r => {
                const rangeFros = (slabFros || {})[r.slab_id] || []
                return (
                  <tr key={r.slab_id}>
                    <td style={{ color: C.muted, fontWeight: 600 }}>{r.idx}</td>
                    <td style={{ minWidth: 0 }}>
                      <RangeArrow min={r.slab.min_amount} max={r.slab.max_amount} minW={arrowW.minW} maxW={arrowW.maxW} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {r.starts_in
                        ? <StartCountdown startedAt={r.starts_in} onDone={onCountdownDone} />
                        : <span style={{ fontSize: 11.5, color: C.muted }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}><StatusPill status={r.status} /></td>
                    <td>
                      <FroStack fros={rangeFros} onViewAll={() => setViewFros({ label: r.slab_label, fros: rangeFros })} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button type="button" className="li-configure" onClick={() => onConfigure(r.slab)}>
                        <Play size={12} weight="fill" /> Start
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewFros && (
        <RangeFrosModal slabLabel={viewFros.label} fros={viewFros.fros} onClose={() => setViewFros(null)} />
      )}
    </div>
  )
}

// ─── Right panel: Live Leaderboard (live/running ranges only) ──
function LiveLeaderboardPanel({ ranges, totalRanges, loading, error, onRefresh, onViewAll, onSelectFro }) {
  return (
    <div className="li-panel">
      <div className="li-panel-head" style={{ padding: 16, borderBottom: '1px solid #EEF2F8', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: '#FFF7E8', color: '#B7791F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Trophy size={18} weight="fill" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.dark }}>Live Leaderboard</div>
          <div style={{ fontSize: 12.5, color: '#6B7C93', marginTop: 1 }}>Top performers based on verified collections</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: '#FDECEC', color: '#D92D20', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E5484D', display: 'inline-block' }} /> Live
        </span>
      </div>

      {error ? (
        <div style={{ padding: '54px 20px', textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, margin: '0 auto 12px', borderRadius: '50%', background: '#FEF2F2', color: '#E5484D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>!</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.dark }}>Unable to load leaderboard</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>Please refresh and try again.</div>
          <button type="button" onClick={onRefresh}
            style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid #E2EAF5', background: '#fff', color: C.primary, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <ArrowsClockwise size={14} /> Refresh
          </button>
        </div>
      ) : loading ? (
        <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="li-shimmer" style={{ height: 152, borderRadius: 12 }} />
          ))}
        </div>
      ) : ranges.length === 0 ? (
        <div style={{ padding: '54px 20px', textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, margin: '0 auto 12px', borderRadius: '50%', background: C.nsBg, color: C.ns, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Users size={18} /></div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.dark }}>
            {(totalRanges || 0) === 0 ? 'No incentive ranges configured yet' : 'No live ranges right now'}
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
            {(totalRanges || 0) === 0 ? 'Create a range to start the competition.' : 'Start a range to begin the competition.'}
          </div>
        </div>
      ) : (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ranges.map(r => <RangeCard key={r.slab_id} r={r} onViewAll={onViewAll} onSelectFro={onSelectFro} />)}
        </div>
      )}
    </div>
  )
}

// ─── Configure Range modal ────────────────────────────────
function ConfigureRangeModal({ slab, saving, onSave, onClose }) {
  const [form, setForm] = useState(() => ({
    amount_to_win: slab.amount_to_win ?? '',
    incentive_amount: slab.incentive_amount ?? '',
    ended_at: slab.ended_at ? toTimeInput(slab.ended_at) : '',
  }))
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    const amount_to_win = Number(form.amount_to_win)
    if (!(amount_to_win > 0)) { setError('Enter a valid Win On amount (must be more than ₹0)'); return }
    const incentive_amount = Number(form.incentive_amount)
    if (!(incentive_amount > 0)) { setError('Enter a valid Prize amount (must be more than ₹0)'); return }
    try {
      await onSave({ amount_to_win, incentive_amount, ended_time: form.ended_at })
      onClose()
    } catch (e) {
      setError(e.message || 'Failed to save')
    }
  }

  const field = (label, hint, extra) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: C.dark, display: 'block', marginBottom: 6 }}>
        {label} {hint && <span style={{ fontWeight: 500, color: C.muted }}>{hint}</span>}
      </label>
      {extra}
    </div>
  )

  const inputBox = (value, onChange, prefix, placeholder, opts = {}) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', background: '#fff', border: '1px solid #DCE7F5', borderRadius: 10, transition: 'border-color .15s ease' }}>
      {prefix ? <span style={{ fontSize: 14, fontWeight: 700, color: C.primary }}>₹</span> : null}
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, fontWeight: 700, color: C.dark, fontFamily: 'inherit', boxSizing: 'border-box' }}
        {...(opts.step ? { step: opts.step } : {})}
      />
    </div>
  )

  const timeInput = (value, onChange) => (
    <input
      type="time"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #DCE7F5', borderRadius: 10, background: '#fff', fontSize: 13, fontWeight: 600, color: C.dark, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
    />
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99992, background: 'rgba(18,35,63,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(460px, 100%)', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: '0 24px 60px rgba(18,35,63,.18)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #EEF2F8', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, background: '#E8F3FF', color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><GearSix size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.dark }}>Configure Incentive Range</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{fmtSlabRange(slab)}</div>
          </div>
          <button type="button" onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #E2EAF5', background: '#fff', color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={14} weight="bold" /></button>
        </div>

        <div style={{ padding: '18px 20px 0' }}>
          {error && (
            <div style={{ padding: '9px 12px', borderRadius: 8, background: '#FEF2F2', color: '#C0392B', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>{error}</div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dark, display: 'block', marginBottom: 6 }}>Range</label>
            <div style={{ display: 'flex', alignItems: 'center', height: 40, padding: '0 12px', background: '#F8FAFD', border: '1px solid #E5EDF7', borderRadius: 10, color: C.muted, fontSize: 13.5, fontWeight: 600 }}>
              {fmtSlabRange(slab)}
            </div>
          </div>

          {field('Win On Target', '(₹) — total verified collection to win', inputBox(form.amount_to_win, v => setForm(p => ({ ...p, amount_to_win: v })), true, '1500'))}
          {field('Prize', '(₹) — flat payout to the winner', inputBox(form.incentive_amount, v => setForm(p => ({ ...p, incentive_amount: v })), true, '0'))}

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.dark, display: 'block', marginBottom: 6 }}>End Time <span style={{ fontWeight: 500, color: C.muted }}>(optional — defaults to 7:00 PM today)</span></label>
            {timeInput(form.ended_at, v => setForm(p => ({ ...p, ended_at: v })))}
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>This range starts 3 minutes after you click start and counts until this time.</div>
          </div>
        </div>

        <div style={{ padding: '14px 20px 18px', borderTop: '1px solid #EEF2F8', display: 'flex', gap: 10 }}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{ flex: 1, height: 40, borderRadius: 10, border: '1px solid #DCE7F5', background: '#fff', color: '#52698A', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={saving}
            style={{ flex: 1, height: 40, borderRadius: 10, border: 'none', background: C.primary, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Saving…' : (rangeStatus(slab) === 'running' && !stoppedToday(slab) ? 'Save Changes' : 'Start Range')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── View All modal: every FRO in a range ─────────────────
function ViewAllModal({ range, onSelectFro, onClose }) {
  const meta = STATUS_META[range.status] || STATUS_META.not_started
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99991, background: 'rgba(18,35,63,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(640px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: '0 24px 60px rgba(18,35,63,.18)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #EEF2F8', background: '#F8FAFD', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, background: '#FFF7E8', color: '#B7791F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Trophy size={16} weight="fill" /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.dark }}>{range.slab_label}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Win On ₹{fmt(range.winOn)} <span style={{ margin: '0 4px' }}>|</span> Prize ₹{fmt(range.prize)}</div>
          </div>
          <StatusPill status={range.status} />
          <button type="button" onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #E2EAF5', background: '#fff', color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={14} weight="bold" /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: '10px 0' }}>
          {range.members.map((f, i) => (
            <button type="button" key={`${range.slab_id}-${f.fro_id}`} onClick={() => onSelectFro && onSelectFro(f.fro_id)}
              className="li-configure"
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 20px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: C.dark, borderBottom: '1px solid #F2F6FB', fontSize: 13 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', background: (RANK_META[i] || RANK_META[2]).bg, color: (RANK_META[i] || RANK_META[2]).color,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>{i + 1}</span>
              <Avatar url={f.photo_url} name={f.fro_name} size={30} />
              <span style={{ flex: 1, minWidth: 0, fontWeight: f.is_winner ? 700 : 600, color: f.is_winner ? '#168A4E' : C.dark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.fro_name}
                {f.is_winner ? ' 🏆' : ''}
              </span>
              <span style={{ flexShrink: 0, fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>₹{fmt(f.total_amount)} <span style={{ color: '#B9C8DC' }}>/ ₹{fmt(range.winOn)}</span></span>
              <div style={{ flex: '0 1 80px', minWidth: 48 }}>
                <MiniBar pct={range.winOn > 0 ? Math.min(100, (Number(f.total_amount) || 0) / range.winOn * 100) : 0} />
              </div>
              <span style={{ flexShrink: 0, width: 38, textAlign: 'right', fontSize: 11.5, fontWeight: 600 }}>{range.winOn > 0 ? Math.min(100, Math.round((Number(f.total_amount) || 0) / range.winOn * 100)) : 0}%</span>
              <CaretRight size={13} color="#B9C8DC" style={{ flexShrink: 0 }} />
            </button>
          ))}
          <div style={{ padding: '10px 20px', fontSize: 11.5, color: C.muted, textAlign: 'center' }}>
            Click a person to view their verified leads.
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Overlapping FRO avatar stack (3 + view-more) ─────────
function FroStack({ fros, onViewAll }) {
  const list = fros || []
  if (list.length === 0) {
    return <span style={{ fontSize: 12, color: '#B9C8DC' }}>—</span>
  }
  const shown = list.slice(0, 3)
  const extra = list.length - shown.length
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((f, i) => (
        <span key={f.fro_id || i} title={f.fro_name}
          style={{ marginLeft: i === 0 ? 0 : -9, border: '2px solid #fff', borderRadius: '50%', display: 'inline-flex', flexShrink: 0 }}>
          <Avatar url={f.photo_url} name={f.fro_name} size={26} />
        </span>
      ))}
      {extra > 0 && (
        <button type="button" onClick={onViewAll} title={`View all ${list.length} FROs`}
          style={{ marginLeft: -9, width: 30, height: 30, borderRadius: '50%', background: '#E8F3FF', color: C.primary, border: '2px solid #fff', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, padding: 0 }}>
          +{extra}
        </button>
      )}
    </span>
  )
}

// ─── All FROs in a range (view-more modal) ────────────────
function RangeFrosModal({ slabLabel, fros, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99991, background: 'rgba(18,35,63,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(420px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: '0 24px 60px rgba(18,35,63,.18)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #EEF2F8', background: '#F8FAFD', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: '#E8F3FF', color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Users size={15} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.dark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slabLabel}</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{(fros || []).length} FRO{(fros || []).length !== 1 ? 's' : ''} in this range</div>
          </div>
          <button type="button" onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #E2EAF5', background: '#fff', color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><X size={14} weight="bold" /></button>
        </div>
        <div className="li-noscroll" style={{ overflowY: 'auto', padding: '8px 0' }}>
          {(fros || []).map(f => (
            <div key={f.fro_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 18px' }}>
              <Avatar url={f.photo_url} name={f.fro_name} size={30} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: C.dark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.fro_name}</span>
            </div>
          ))}
          {(!fros || fros.length === 0) && (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: C.muted }}>No FROs in this range today.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Slab Config (Target Slabs modal) ─────────────────────
function SlabConfig({ slabs, onAdd, onUpdate, onDelete, saving, embedded = false }) {
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ min_amount: '', max_amount: '', incentive_amount: '', amount_to_win: '' })
  const [error, setError] = useState('')

  const startEdit = (slab) => {
    setEditing(slab.id)
    setAdding(false)
    setForm({ min_amount: slab.min_amount, max_amount: slab.max_amount, incentive_amount: slab.incentive_amount, amount_to_win: slab.amount_to_win })
    setError('')
  }

  const startAdd = () => {
    setAdding(true)
    setEditing(null)
    setForm({ min_amount: '', max_amount: '', incentive_amount: '', amount_to_win: '' })
    setError('')
  }

  const cancel = () => { setEditing(null); setAdding(false); setError('') }

  const submit = async () => {
    setError('')
    if (!(Number(form.min_amount) >= 0) || !(Number(form.max_amount) > 0)) { setError('Enter valid min and max amounts'); return }
    if (Number(form.min_amount) >= Number(form.max_amount)) { setError('Min must be less than max'); return }
    try {
      if (editing) { await onUpdate(editing, form) } else { await onAdd(form) }
      cancel()
    } catch (e) { setError(e.message || 'Failed') }
  }

  const active = (slabs || []).filter(s => s.is_active)

  const moneyInput = (value, onChange, placeholder) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', background: '#fff', border: '1px solid #DCE7F5', borderRadius: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>₹</span>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, fontWeight: 600, color: C.dark, fontFamily: 'inherit', boxSizing: 'border-box' }} />
    </div>
  )

  const fldLabel = (text) => (
    <label style={{ fontSize: 11.5, fontWeight: 700, color: C.dark, display: 'block', marginBottom: 6 }}>{text}</label>
  )

  const rowBtn = (kind) => kind === 'save'
    ? { flex: 1, height: 36, borderRadius: 9, border: 'none', background: C.primary, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
    : { flex: 1, height: 36, borderRadius: 9, border: '1px solid #DCE7F5', background: '#fff', color: '#52698A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }

  return (
    <div style={embedded
      ? { display: 'flex', flexDirection: 'column' }
      : { border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.muted }}>
          {active.length} range{active.length !== 1 ? 's' : ''} configured
        </div>
        {!adding && !editing && (
          <button type="button" onClick={startAdd}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 9, border: 'none', background: C.primary, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            <Plus size={15} weight="bold" /> Add Range
          </button>
        )}
      </div>

      {error && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#FEF2F2', color: '#C0392B', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{error}</div>}

      {adding && (
        <div style={{ marginBottom: 12, padding: 14, borderRadius: 12, border: `1px solid ${C.line}`, background: '#F8FAFD' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, marginBottom: 12 }}>New incentive range</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>{fldLabel('Min Amount')}{moneyInput(form.min_amount, v => setForm(p => ({ ...p, min_amount: v })), '0')}</div>
            <div>{fldLabel('Max Amount')}{moneyInput(form.max_amount, v => setForm(p => ({ ...p, max_amount: v })), '50000')}</div>
            <div>{fldLabel('Win On Target')}{moneyInput(form.amount_to_win, v => setForm(p => ({ ...p, amount_to_win: v })), '1500')}</div>
            <div>{fldLabel('Prize')}{moneyInput(form.incentive_amount, v => setForm(p => ({ ...p, incentive_amount: v })), '0')}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="button" onClick={cancel} disabled={saving} style={rowBtn()}>Cancel</button>
            <button type="button" onClick={submit} disabled={saving} style={rowBtn('save')}>{saving ? 'Adding…' : 'Add Range'}</button>
          </div>
        </div>
      )}

      <div style={{ border: `1px solid #EEF2F8`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, tableLayout: 'fixed' }}>
          <colgroup>
            <col />
            <col style={{ width: 104 }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#F8FAFD' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#52698A', fontSize: 11, borderBottom: '1px solid #E5EDF7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Range (₹)</th>
              <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#52698A', fontSize: 11, borderBottom: '1px solid #E5EDF7', whiteSpace: 'nowrap' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {active.map(slab => {
              const rangeLabel = `₹${fmt(slab.min_amount)} ↔ ₹${fmt(slab.max_amount)}`
              return editing === slab.id ? (
                <tr key={slab.id} style={{ background: '#F4F9FF' }}>
                  <td style={{ padding: 6 }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>{moneyInput(form.min_amount, v => setForm(p => ({ ...p, min_amount: v })), 'Min')}</div>
                      <span style={{ color: C.muted, fontSize: 11, flexShrink: 0 }}>to</span>
                      <div style={{ flex: 1, minWidth: 0 }}>{moneyInput(form.max_amount, v => setForm(p => ({ ...p, max_amount: v })), 'Max')}</div>
                    </div>
                  </td>
                  <td style={{ padding: 6 }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button type="button" onClick={submit} disabled={saving}
                        style={{ height: 28, padding: '0 10px', borderRadius: 7, border: 'none', background: C.primary, color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        {saving ? '…' : 'Save'}
                      </button>
                      <button type="button" onClick={cancel} disabled={saving}
                        style={{ height: 28, padding: '0 10px', borderRadius: 7, border: '1px solid #E2EAF5', background: '#fff', color: '#52698A', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={slab.id} style={{ borderTop: '1px solid #F2F6FB' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600, color: C.dark, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12.5 }}>{rangeLabel}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button type="button" onClick={() => startEdit(slab)} title="Edit range"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, border: '1px solid #E2EAF5', background: '#fff', color: '#52698A', cursor: 'pointer' }}>
                        <PencilSimple size={13} />
                      </button>
                      <button type="button" onClick={() => onDelete(slab.id)} title="Delete range"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, border: '1px solid #FECACA', background: '#FEF2F2', color: '#B91C1C', cursor: 'pointer' }}>
                        <Trash size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {active.length === 0 && !adding && (
              <tr>
                <td colSpan={2} style={{ padding: '28px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>No incentive ranges yet</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Click Add Range to create the first one.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
        Edit a range's Min/Max here. Use <b style={{ fontWeight: 600 }}>Start</b> on the main table to set its Win On target and prize. A range starts 3 minutes after clicking start and runs until the end time you pick (default 7:00 PM).
      </div>
    </div>
  )
}

// ─── FRO Detail Modal ─────────────────────────────────────
function FroDetailModal({ froId, date, champions, onClose }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api(`/incentive/lead/lead-summary/fro/${froId}?date=${date}`, { _prefix: 'ucs' })
      .then(data => { if (alive) setDetail(data) })
      .catch(e => { if (alive) setError(e.message || 'Failed to load detail') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [froId, date])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 99993, background: 'rgba(18,35,63,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px, 100%)', borderRadius: 14, background: '#fff', border: '1px solid #DCE7F5', boxShadow: '0 24px 60px rgba(18,35,63,.18)', overflow: 'hidden' }}>
          <div style={{ padding: 40, textAlign: 'center', color: '#65758B', fontSize: 13 }}>Loading leads…</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 99993, background: 'rgba(18,35,63,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px, 100%)', borderRadius: 14, background: '#fff', border: '1px solid #DCE7F5', boxShadow: '0 24px 60px rgba(18,35,63,.18)', overflow: 'hidden' }}>
          <div style={{ padding: 24, textAlign: 'center', color: '#C0392B', fontSize: 13 }}>{error}</div>
          <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 20 }}>
            <button onClick={onClose} style={btnStyle('#E2EAF5', '#52698A')}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  if (!detail) return null

  const isChampion = (champions || []).some(c => c.fro_id === detail.fro_id)
  const slabLabel = detail.slab ? `₹${fmt(detail.slab.min_amount)} – ₹${fmt(detail.slab.max_amount)}` : '—'
  const winOn = detail.amount_to_win ?? detail.slab?.amount_to_win ?? 1500
  const prize = detail.incentive_amount ?? detail.slab?.incentive_amount ?? 0

  const stat = (label, value, color) => (
    <div style={{ borderRadius: 12, padding: '12px 14px', background: '#F8FAFD', border: '1.5px solid #E5EDF7', textAlign: 'center', minWidth: 110, flex: 1 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#65758B', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 900, color: color || '#12233F', marginTop: 4 }}>{value}</div>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99993, background: 'rgba(18,35,63,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', borderRadius: 14, background: '#fff', border: '1px solid #DCE7F5', boxShadow: '0 24px 60px rgba(18,35,63,.18)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #EEF2F8', background: '#F8FAFD', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏆</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#12233F' }}>
              {detail.fro_name}
              {isChampion && <span style={{ marginLeft: 6, fontSize: 13 }}>🏆</span>}
            </div>
            <div style={{ fontSize: 12, color: '#65758B' }}>{fmtDate(detail.date)} · Lead detail</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 50, background: '#fff', border: '1px solid #E2EAF5', fontWeight: 700, color: '#65758B', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '16px 20px 20px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            {stat('Target', `₹${fmt(detail.target)}`)}
            {stat('Slab', slabLabel)}
            {stat('Leads', detail.total_leads)}
            {stat('Amount', `₹${fmt(detail.total_amount)}`)}
            {stat('Win On', `🎯 ₹${fmt(winOn)}`, '#B45309')}
            {stat('Prize', `₹${fmt(prize)}`, '#1677E8')}
            {isChampion && stat('Won', '✓ Champion', '#18A957')}
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, color: '#12233F', marginBottom: 8 }}>
            Individual Leads ({detail.leads?.length || 0})
          </div>
          {detail.leads && detail.leads.length > 0 ? (
            <div style={{ border: '1.5px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Status</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Donor</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Mobile</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Amount</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.leads.map((lead, i) => (
                      <tr key={lead.id || i} style={{ borderBottom: '1px solid var(--line)', background: lead.qualified ? 'rgba(220,252,231,.35)' : 'transparent' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 50, background: lead.qualified ? '#dcfce7' : '#f1f5f9', fontSize: 12, fontWeight: 800, color: lead.qualified ? '#16a34a' : '#94a3b8' }}>
                            {lead.qualified ? '✓' : '✗'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--ink)' }}>{lead.donor_name || `Donor #${lead.donor_id || '—'}`}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{lead.donor_mobile || '—'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: lead.qualified ? '#16a34a' : 'var(--ink-soft)' }}>₹{fmt(lead.amount)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{fmtDate(lead.verified_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 12, border: '1.5px dashed var(--line)', borderRadius: 12 }}>
              No leads for this date
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── History: winner celebration composer ─────────────────
// Per announced winner: optional photo upload, AI-written congratulation,
// one-time Send to every panel (backend enforces single publish; each panel
// shows the popup once and never again on reload/login).
function WinnerComposer({ row, onSent }) {
  const [photo, setPhoto] = useState(null)
  const [message, setMessage] = useState(row.message || '')
  const [aiBusy, setAiBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const pickPhoto = (file) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Photo must be JPG, PNG or WEBP'); return }
    if (file.size > 5 * 1024 * 1024) { setError('Photo must be under 5MB'); return }
    setError('')
    const reader = new FileReader()
    reader.onload = () => setPhoto({ dataUrl: reader.result, mime: file.type })
    reader.readAsDataURL(file)
  }

  const aiWrite = async () => {
    setAiBusy(true)
    setError('')
    try {
      const r = await api(`/incentive/lead/champion/${row.id}/congrats`, { method: 'POST', _prefix: 'ucs' })
      if (r?.message) setMessage(r.message)
    } catch (e) { setError(e.message || 'AI write failed') }
    finally { setAiBusy(false) }
  }

  const send = async () => {
    setSending(true)
    setError('')
    try {
      let file_base64 = null
      let mime_type = null
      if (photo) {
        const parts = String(photo.dataUrl).split(',')
        file_base64 = parts[1] || null
        mime_type = photo.mime
      }
      await api(`/incentive/lead/champion/${row.id}/celebrate`, {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({ file_base64, mime_type, message: message.trim() || null }),
      })
      onSent()
    } catch (e) { setError(e.message || 'Send failed') }
    finally { setSending(false) }
  }

  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: `1px solid ${C.line}`, background: '#F8FAFD' }}>
      {error && (
        <div style={{ padding: '8px 10px', borderRadius: 8, background: '#FEF2F2', color: '#C0392B', fontSize: 11.5, fontWeight: 600, marginBottom: 10 }}>{error}</div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={sending}
          style={{ width: 56, height: 56, borderRadius: 10, border: photo ? 'none' : '1.5px dashed #B9C8DC', background: photo ? 'transparent' : '#fff', color: C.ns, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, overflow: 'hidden', padding: 0 }}>
          {photo ? (
            <img src={photo.dataUrl} alt="Winner" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <Camera size={20} />
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
          onChange={e => { pickPhoto(e.target.files && e.target.files[0]); e.target.value = '' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <textarea value={message} onChange={e => setMessage(e.target.value)} disabled={sending} rows={2}
            placeholder="Write a congratulation… or let AI write it"
            style={{ width: '100%', minHeight: 56, padding: '8px 10px', border: '1px solid #DCE7F5', borderRadius: 10, background: '#fff', fontSize: 12.5, color: C.dark, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" onClick={aiWrite} disabled={aiBusy || sending}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid #E2EAF5', background: '#fff', color: C.primary, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          <Sparkle size={14} /> {aiBusy ? 'Writing…' : 'AI Write'}
        </button>
        <button type="button" onClick={send} disabled={sending}
          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 8, border: 'none', background: C.primary, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          <PaperPlaneTilt size={14} /> {sending ? 'Sending…' : 'Send to all panels'}
        </button>
      </div>
    </div>
  )
}

// ─── History: winners + celebrations ──────────────────────
// Shows the range's competition window (start → end) for each winner.
function TimeRange({ slab, started_at, ended_at }) {
  const s = started_at || slab?.started_at
  const e = ended_at || slab?.ended_at
  if (!s && !e) return null
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 3, fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      <Clock size={12} />
      <span style={{ color: C.dark, fontWeight: 600 }}>{fmtTime(s)}</span>
      <span style={{ color: '#B9C8DC' }}>→</span>
      <span style={{ color: C.dark, fontWeight: 600 }}>{fmtTime(e)}</span>
    </div>
  )
}

function HistoryPanel({ date, onDateChange, champions, announcements, loading, fetchError, onRetry, announcing, announceError, onAnnounce, onSent, slabs }) {
  const slabById = useMemo(() => {
    const m = {}
    for (const s of slabs || []) m[String(s.id)] = s
    return m
  }, [slabs])
  const announcedSlabIds = useMemo(
    () => new Set((announcements || []).map(a => String(a.slab_id))),
    [announcements]
  )
  const dayKey = String(date).slice(0, 10)
  const pending = useMemo(
    () => (champions || []).filter(c => !announcedSlabIds.has(String(c.slab_id))),
    [champions, announcedSlabIds]
  )
  const dayRows = useMemo(
    () => (announcements || [])
      .filter(a => String(a.announcement_date).slice(0, 10) === dayKey)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    [announcements, dayKey]
  )
  const earlier = useMemo(
    () => (announcements || [])
      .filter(a => String(a.announcement_date).slice(0, 10) !== dayKey)
      .sort((a, b) => String(b.announcement_date).localeCompare(String(a.announcement_date)))
      .slice(0, 10),
    [announcements, dayKey]
  )

  return (
    <div className="li-panel">
      <div className="li-panel-head" style={{ padding: '10px 14px', borderBottom: '1px solid #EEF2F8', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: '#FFF7E8', color: '#B7791F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ClockCounterClockwise size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.dark, lineHeight: 1.2 }}>History</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px', border: `1px solid ${C.line}`, borderRadius: 9, background: '#fff', color: '#52698A' }}>
          <CalendarBlank size={15} />
          <input
            type="date"
            value={date}
            onChange={e => onDateChange && e.target.value && onDateChange(e.target.value)}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, fontWeight: 600, color: C.dark, fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
        {pending.length > 0 && (
          <button type="button" onClick={onAnnounce} disabled={announcing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 9, border: 'none', background: C.primary, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            <Trophy size={14} /> {announcing ? 'Announcing…' : `Announce (${pending.length})`}
          </button>
        )}
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {announceError && (
          <div style={{ padding: '9px 12px', borderRadius: 8, background: '#FEF2F2', color: '#C0392B', fontSize: 12, fontWeight: 600 }}>{announceError}</div>
        )}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map(i => (
              <div key={i} className="li-shimmer" style={{ height: 56, borderRadius: 10 }} />
            ))}
          </div>
        ) : fetchError ? (
          <div style={{ padding: '26px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>Unable to load history</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{fetchError}</div>
            <button type="button" onClick={onRetry}
              style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid #E2EAF5', background: '#fff', color: C.primary, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <ArrowsClockwise size={14} /> Retry
            </button>
          </div>
        ) : (
        <>
        {pending.length === 0 && dayRows.length === 0 && earlier.length === 0 && (
          <div style={{ padding: '26px 16px', textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, margin: '0 auto 10px', borderRadius: '50%', background: C.nsBg, color: C.ns, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Trophy size={18} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>No winners yet for this date</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Winners appear here the moment someone hits a range target.</div>
          </div>
        )}

        {pending.map(c => (
          <div key={`pending-${c.slab_id}-${c.fro_id}`} style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar url={c.photo_url} name={c.fro_name} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.fro_name}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.slab_label} · ₹{fmt(c.total_amount)} collected
              </div>
              <TimeRange started_at={c.started_at} ended_at={c.ended_at} slab={slabById[String(c.slab_id)]} />
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: '#FFF5DF', color: '#B7791F', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F2A23A', display: 'inline-block' }} /> Won — not announced
            </span>
          </div>
        ))}

        {dayRows.map(a => (
          <div key={a.id} style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar url={a.winner_photo_url} name={a.fro_name} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.fro_name}
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.slab_label} · ₹{fmt(a.total_amount)} · Prize ₹{fmt(a.slab_bonus || a.total_incentive)}
                </div>
                <TimeRange started_at={a.started_at} ended_at={a.ended_at} slab={slabById[String(a.slab_id)]} />
              </div>
              {a.celebrated_at ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: C.greenBg, color: C.green, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  <CheckCircle size={13} /> Sent
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: C.nsBg, color: C.ns, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Announced
                </span>
              )}
            </div>
            {a.celebrated_at ? (
              <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#F8FAFD', border: '1px solid #EEF2F8', display: 'flex', gap: 10 }}>
                {a.winner_photo_url && (
                  <img src={a.winner_photo_url} alt={a.fro_name} style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flexShrink: 0, display: 'block' }} />
                )}
                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.dark, lineHeight: 1.55 }}>{a.message || 'Celebration sent to all panels.'}</div>
              </div>
            ) : (
              <WinnerComposer key={a.id} row={a} onSent={onSent} />
            )}
          </div>
        ))}

        {earlier.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, margin: '2px 0 8px' }}>Earlier</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {earlier.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid #EEF2F8', borderRadius: 10, background: '#fff' }}>
                  <Avatar url={a.winner_photo_url} name={a.fro_name} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.dark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fro_name}</div>
                    <div style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.slab_label} · {String(a.announcement_date).slice(0, 10)}
                    </div>
                    <TimeRange started_at={a.started_at} ended_at={a.ended_at} slab={slabById[String(a.slab_id)]} />
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B7791F', whiteSpace: 'nowrap' }}>₹{fmt(a.slab_bonus || a.total_incentive)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────
export default function LeadIncentive() {
  const [slabs, setSlabs] = useState([])
  const [summary, setSummary] = useState(null)
  // Live board always follows today; History has its own date filter.
  const [date] = useState(() => todayLocal())
  const [histDate, setHistDate] = useState(() => todayLocal())
  const [loading, setLoading] = useState(true)
  const [slabsLoading, setSlabsLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(null)
  const [savingSlab, setSavingSlab] = useState(false)
  const [history, setHistory] = useState([])
  const [announcing, setAnnouncing] = useState(false)
  const [historyError, setHistoryError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [detailFroId, setDetailFroId] = useState(null)
  const [slabsOpen, setSlabsOpen] = useState(false)
  const [configureSlab, setConfigureSlab] = useState(null)
  const [viewAll, setViewAll] = useState(null)

  // Today's FROs grouped by range (for the Target Slabs FRO stacks).
  const frosBySlab = useMemo(() => {
    const map = {}
    for (const f of summary?.fros || []) {
      const id = f.slab && String(f.slab.id)
      if (!id) continue
      if (!map[id]) map[id] = []
      map[id].push(f)
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0))
    }
    return map
  }, [summary])

  const uniqueSlabs = useMemo(() => uniqueByRange(slabs), [slabs])

  // Aggregate each award range with live status + leaderboard members + progress.
  const rangeRows = useMemo(() => {
    const champs = summary?.champions || []
    const fros = summary?.fros || []
    return (uniqueSlabs || [])
      .filter(s => s.is_active)
      .sort((a, b) => (Number(a.min_amount) || 0) - (Number(b.min_amount) || 0))
      .map((slab, idx) => {
        const members = fros
          .filter(f => f.slab && String(f.slab.id) === String(slab.id))
          .sort((a, b) => (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0))
          .map(f => ({ ...f, is_winner: champs.some(c => String(c.fro_id) === String(f.fro_id) && String(c.slab_id) === String(slab.id)) }))
        const champion = champs.find(c => String(c.slab_id) === String(slab.id)) || null
        const winOn = Number(slab.amount_to_win) || 1500
        const prize = Number(slab.incentive_amount) || 0
        const leaderAmount = members.length ? (Number(members[0].total_amount) || 0) : 0
        const progressPct = winOn > 0 ? Math.min(100, Math.round((leaderAmount / winOn) * 100)) : 0
        return {
          slab_id: slab.id,
          slab,
          slab_label: fmtSlabRange(slab),
          idx: idx + 1,
          status: rangeStatus(slab),
          // ~3-min pre-live window after Start: expose the future start time so
          // the table can render a live countdown between Range and Status.
          starts_in: pendingStartAt(slab),
          // STOP-AFTER-WIN: a range with a winner (or stopped today) is out of
          // the live race — the table shows it back as Not Started and the
          // leaderboard hides it; the winner lives on in History.
          won: !!champion,
          stopped: stoppedToday(slab),
          champion,
          members,
          top3: members.slice(0, 3),
          winOn,
          prize,
          leaderAmount,
          progressPct,
          totalCount: members.length,
        }
      })
  }, [uniqueSlabs, summary])

  const loadSlabs = useCallback(async (silent = false) => {
    try {
      if (!silent) setSlabsLoading(true)
      const data = await api('/incentive/lead/slabs', { _prefix: 'ucs' })
      if (Array.isArray(data)) setSlabs(data)
    } catch { /* ignore */ }
    finally { if (!silent) setSlabsLoading(false) }
  }, [])

  const loadSummary = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const data = await api(`/incentive/lead/lead-summary?date=${date}`, { _prefix: 'ucs' })
      if (data) setSummary(data)
      setSummaryError(null)
    } catch {
      if (!silent) setSummaryError('Failed to load the leaderboard data')
    }
    finally { if (!silent) setLoading(false) }
  }, [date])

  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyFetchError, setHistoryFetchError] = useState(null)

  const loadHistory = useCallback(async (silent = false) => {
    try {
      const h = await api('/incentive/lead/champion/history', { _prefix: 'ucs' })
      setHistory(Array.isArray(h) ? h : [])
      setHistoryFetchError(null)
    } catch (e) {
      if (!silent) setHistoryFetchError(e.message || 'Failed to load history')
    }
    finally { if (!silent) setHistoryLoading(false) }
  }, [])

  useEffect(() => { loadSlabs() }, [loadSlabs])
  useEffect(() => { loadSummary(); loadHistory() }, [loadSummary, loadHistory])

  // Live updates via realtime (no polling): slabs, verified collections,
  // champion announcements and celebrations all refresh this page instantly.
  // Background refreshes are silent — they never flash the loading skeleton.
  const reloadTimer = useRef(null)
  const reloadAll = useCallback(() => {
    loadSlabs(true)
    loadSummary(true)
    loadHistory(true)
  }, [loadSlabs, loadSummary, loadHistory])
  const reloadSoon = useCallback(() => {
    clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(reloadAll, 1200)
  }, [reloadAll])
  useEffect(() => () => clearTimeout(reloadTimer.current), [])
  useRealtime('incentive_slabs', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon })
  useRealtime('fro_donor_logs', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon })
  useRealtime('lead_champion_announcements', { event: '*', onInsert: reloadSoon, onUpdate: reloadSoon, onDelete: reloadSoon })

  const announceWinners = async () => {
    if (announcing) return
    setAnnouncing(true)
    setHistoryError(null)
    try {
      await api('/incentive/lead/champion/announce', {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({ date }),
      })
      await Promise.all([loadHistory(true), loadSummary(true)])
    } catch (e) {
      setHistoryError(e.message || 'Failed to announce winners')
    } finally { setAnnouncing(false) }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([loadSlabs(), loadSummary(), loadHistory()])
    } finally { setRefreshing(false) }
  }

  const addSlab = async (form) => {
    setSavingSlab(true)
    try {
      await api('/incentive/lead/slabs', {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({
          min_amount: Number(form.min_amount),
          max_amount: Number(form.max_amount),
          incentive_amount: Number(form.incentive_amount) || 0,
          amount_to_win: Number(form.amount_to_win) || 1500,
        }),
      })
      await loadSlabs()
      loadSummary()
    } finally { setSavingSlab(false) }
  }

  const updateSlab = async (id, form) => {
    setSavingSlab(true)
    try {
      await api(`/incentive/lead/slabs/${id}`, {
        method: 'PUT', _prefix: 'ucs',
        body: JSON.stringify({
          min_amount: Number(form.min_amount),
          max_amount: Number(form.max_amount),
          incentive_amount: Number(form.incentive_amount) || 0,
          amount_to_win: Number(form.amount_to_win) || 1500,
        }),
      })
      await loadSlabs()
      loadSummary()
    } finally { setSavingSlab(false) }
  }

  // Start a range (or edit a live one): the race always starts "today" — 3
  // minutes from now — and ends today at the chosen time (default 7:00 PM).
  const updateSlabRates = async (slab, { amount_to_win, incentive_amount, ended_time }) => {
    setSavingSlab(true)
    try {
      const isLive = rangeStatus(slab) === 'running' && !stoppedToday(slab)
      const startAt = isLive && slab.started_at
        ? new Date(slab.started_at)
        : new Date(Date.now() + 3 * 60 * 1000)
      const endAt = todayAt(ended_time || DEFAULT_END_TIME)
      if (!endAt || endAt <= startAt) {
        throw new Error('End time must be later than start (3 minutes from now)')
      }
      await api(`/incentive/lead/slabs/${slab.id}`, {
        method: 'PUT', _prefix: 'ucs',
        body: JSON.stringify({
          min_amount: Number(slab.min_amount),
          max_amount: Number(slab.max_amount),
          incentive_amount: Number(incentive_amount) || 0,
          amount_to_win: Number(amount_to_win) || 1500,
          started_at: startAt.toISOString(),
          ended_at: endAt.toISOString(),
        }),
      })
      await loadSlabs()
      loadSummary()
    } finally { setSavingSlab(false) }
  }

  const deleteSlab = async (id) => {
    if (!window.confirm('Remove this slab?')) return
    setSavingSlab(true)
    try {
      await api(`/incentive/lead/slabs/${id}`, { method: 'DELETE', _prefix: 'ucs' })
      await loadSlabs()
      loadSummary()
    } finally { setSavingSlab(false) }
  }

  return (
    <>
      <style>{LI_CSS}</style>

      {/* Two-column layout */}
      <div className="li-grid">
        <div className="li-col">
          <IncentiveRangesPanel
            ranges={rangeRows}
            loading={slabsLoading}
            slabFros={frosBySlab}
            onConfigure={setConfigureSlab}
            onTargetSlabs={() => setSlabsOpen(true)}
            onCountdownDone={reloadAll}
          />
          <div style={{ height: 16 }} />
          <HistoryPanel
            date={histDate}
            onDateChange={setHistDate}
            champions={histDate === date ? (summary?.champions || []) : []}
            announcements={history}
            slabs={uniqueSlabs}
            loading={historyLoading}
            fetchError={historyFetchError}
            onRetry={() => { setHistoryLoading(true); loadHistory() }}
            announcing={announcing}
            announceError={historyError}
            onAnnounce={announceWinners}
            onSent={() => { loadHistory() }}
          />
        </div>
        <div className="li-col">
          <LiveLeaderboardPanel
            ranges={rangeRows.filter(r => r.status === 'running' && !r.won && !r.stopped)}
            totalRanges={rangeRows.length}
            loading={loading}
            error={summaryError}
            onRefresh={refresh}
            onViewAll={setViewAll}
            onSelectFro={setDetailFroId}
          />
        </div>
      </div>

      {/* Configure Range modal */}
      {configureSlab && (
        <ConfigureRangeModal
          slab={configureSlab}
          saving={savingSlab}
          onSave={payload => updateSlabRates(configureSlab, payload)}
          onClose={() => setConfigureSlab(null)}
        />
      )}

      {/* View All modal */}
      {viewAll && (
        <ViewAllModal range={viewAll} onSelectFro={setDetailFroId} onClose={() => setViewAll(null)} />
      )}

      {/* FRO Detail modal */}
      {detailFroId && (
        <FroDetailModal
          froId={detailFroId}
          date={date}
          champions={summary?.champions || []}
          onClose={() => setDetailFroId(null)}
        />
      )}

      {/* Target Slabs modal */}
      {slabsOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99990, background: 'rgba(18,35,63,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' }} onClick={() => setSlabsOpen(false)}>
          <div style={{ width: 'min(480px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 14, background: '#fff', border: `1px solid ${C.line}`, boxShadow: '0 24px 60px rgba(18,35,63,.18)', overflow: 'hidden', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #EEF2F8', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: '#E8F3FF', color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><FileText size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.dark }}>Target Slabs</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Add, edit or remove incentive ranges</div>
              </div>
              <button type="button" onClick={() => setSlabsOpen(false)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #E2EAF5', background: '#fff', color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><X size={14} weight="bold" /></button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto' }}>
              <SlabConfig slabs={uniqueSlabs} onAdd={addSlab} onUpdate={updateSlab} onDelete={deleteSlab} saving={savingSlab} embedded />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
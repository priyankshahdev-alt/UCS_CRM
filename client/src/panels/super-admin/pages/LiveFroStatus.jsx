import { useState, useEffect, useMemo, useRef } from 'react'
import { api } from '../../../api/auth'
import { onDbChange } from '../../../lib/socket'
import { now as serverNow, syncFrom as syncServerClock } from '../../../lib/serverClock'
import { fmt } from '../components/froShared'

const LFS_CSS = `
.lfs-page { width: 100%; min-width: 0; }
.lfs-crumb { font-size: 11px; color: #6D7E95; margin-bottom: 2px; }
.lfs-title { margin: 0; font-size: 27px; font-weight: 700; color: #10213D; line-height: 1.2; }
.lfs-sub { margin-top: 2px; font-size: 13px; color: #6D7E95; }
.lfs-head-actions { display: flex; align-items: center; gap: 8; flex-wrap: wrap; }
.lfs-btn { display: inline-flex; align-items: center; gap: 6; height: 38px; padding: 0 14px; border-radius: 9px; border: 1px solid #DCE7F5; background: #fff; color: #10213D; font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; white-space: nowrap; }
.lfs-btn:hover { background: #F6F9FD; }
.lfs-btn:focus-visible { outline: 2px solid #2F7DF4; outline-offset: 2px; }
.lfs-btn-danger { background: #E52B4A; border-color: #E52B4A; color: #fff; }
.lfs-btn-danger:hover { background: #c81f3c; }
.lfs-btn:disabled { opacity: .6; cursor: wait; }
.lfs-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.lfs-sum { background: #fff; border: 1px solid #DCE7F5; border-radius: 11px; box-shadow: 0 2px 8px rgba(35,76,120,.05); padding: 12px 14px; min-width: 0; min-height: 78px; display: flex; align-items: center; gap: 12px; }
.lfs-sum-ico { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lfs-sum-val { font-size: 22px; font-weight: 700; color: #10213D; line-height: 1.1; font-variant-numeric: tabular-nums; }
.lfs-sum-lbl { font-size: 12px; color: #6D7E95; font-weight: 600; }
.lfs-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.lfs-input, .lfs-select { height: 38px; border-radius: 9px; border: 1px solid #DCE7F5; background: #fff; color: #10213D; font-size: 13px; font-family: inherit; outline: none; padding: 0 12px; min-width: 0; }
.lfs-input:focus, .lfs-select:focus { border-color: #2F7DF4; }
.lfs-input { flex: 1 1 220px; }
.lfs-select { flex: 0 1 auto; cursor: pointer; }
.lfs-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.lfs-grid > * { min-width: 0; }
.lfs-card { background: #fff; border: 1px solid #DCE7F5; border-radius: 12px; padding: 12px; box-shadow: 0 2px 8px rgba(35,76,120,.04); min-width: 0; }
.lfs-card-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lfs-avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: #EFF6FF; color: #287FE8; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; overflow: hidden; }
.lfs-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; max-width: 100%; }
.lfs-id { flex: 1 1 auto; min-width: 0; }
.lfs-name { font-size: 15px; font-weight: 700; color: #10213D; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lfs-mail { font-size: 12px; color: #6D7E95; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lfs-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; flex-shrink: 0; }
.lfs-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.lfs-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin-top: 10px; }
.lfs-metric { background: #F6F9FD; border-radius: 7px; padding: 7px 4px; text-align: center; min-width: 0; }
.lfs-metric-val { font-size: 13px; font-weight: 700; color: #10213D; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lfs-metric-lbl { font-size: 10px; color: #6D7E95; font-weight: 600; margin-top: 1px; }
.lfs-seen { font-size: 11px; color: #6D7E95; margin-top: 8px; }
.lfs-skel { background: #fff; border: 1px solid #DCE7F5; border-radius: 12px; padding: 12px; min-width: 0; }
.lfs-shimmer { border-radius: 8px; background: linear-gradient(90deg, #EDF2F9 25%, #F7FAFE 50%, #EDF2F9 75%); background-size: 200% 100%; animation: lfs-sh 1.2s ease-in-out infinite; }
@keyframes lfs-sh { to { background-position: -200% 0; } }
.lfs-state { background: #fff; border: 1px solid #DCE7F5; border-radius: 12px; padding: 44px 20px; text-align: center; margin-top: 12px; }
@media (max-width: 1100px) {
  .lfs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .lfs-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .lfs-grid { grid-template-columns: minmax(0, 1fr); }
  .lfs-input { flex: 1 1 100%; }
}
`

const PILL = {
  online: { label: 'Online', color: '#12A65A', bg: '#EAF9F0' },
  idle: { label: 'Idle', color: '#E98A00', bg: '#FFF7EA' },
  on_call: { label: 'Talking', color: '#287FE8', bg: '#EFF6FF' },
  break: { label: 'Break', color: '#E98A00', bg: '#FFF7EA' },
  offline: { label: 'Offline', color: '#6D7E95', bg: '#F1F5F9' },
}

const FILTERS = [
  { value: 'all', label: 'All Status' },
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Idle' },
  { value: 'on_call', label: 'Talking' },
  { value: 'break', label: 'On Break' },
  { value: 'offline', label: 'Offline' },
]

const SORTS = [
  { value: 'name-asc', label: 'Sort by Name (A-Z)' },
  { value: 'name-desc', label: 'Sort by Name (Z-A)' },
  { value: 'idle-desc', label: 'Sort by Idle (High First)' },
  { value: 'calls-desc', label: 'Sort by Calls (High First)' },
]

const initialsOf = (name) => String(name || 'F').split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase()

function Avatar({ fs, name }) {
  const [err, setErr] = useState(false)
  const url = fs?.worker?.photo_url || fs?.photo_url || null
  useEffect(() => { setErr(false) }, [url])
  if (url && !err) {
    return (
      <span className="lfs-avatar" aria-hidden="true">
        <img src={url} alt="" onError={() => setErr(true)} />
      </span>
    )
  }
  return <span className="lfs-avatar" aria-hidden="true">{initialsOf(name)}</span>
}

export default function LiveFroStatus() {
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [resetting, setResetting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pausingId, setPausingId] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sort, setSort] = useState('name-asc')
  // Ticks on the SERVER's clock. Using the device clock made these durations
  // wrong on any machine whose clock is off (clamped to 00:00 or inflated).
  const [now, setNow] = useState(() => serverNow())
  // Attendance-punched roster for today. Separate from `statuses` on purpose:
  // that list is built from fro_live_status, so anyone who punched in at the
  // attendance app but never opened the CRM panel is missing from it entirely.
  const [present, setPresent] = useState({ loading: true, error: null, data: null, open: true })
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const loadStatuses = async (showSpinner) => {
    if (showSpinner && aliveRef.current) setRefreshing(true)
    try {
      const data = await api('/fro/status', { _prefix: 'ucs' })
      if (!aliveRef.current) return
      setStatuses(Array.isArray(data) ? data : [])
      setLoadError(null)
    } catch (e) {
      if (!aliveRef.current) return
      setLoadError(e?.message || 'Failed to load')
    } finally {
      if (aliveRef.current) { setLoading(false); setRefreshing(false) }
    }
  }

  useEffect(() => { loadStatuses(false) }, [])

  // Attendance roster: loaded once on mount and re-read only on an explicit
  // refresh. Punch-ins change on a human timescale, so there is no reason to
  // re-poll it on every FRO heartbeat.
  const loadPresent = async () => {
    if (!aliveRef.current) return
    setPresent(p => ({ ...p, loading: true, error: null }))
    try {
      const data = await api('/fro/status/present', { _prefix: 'ucs' })
      if (!aliveRef.current) return
      setPresent({ loading: false, error: null, data: data || null, open: true })
    } catch (e) {
      if (!aliveRef.current) return
      setPresent(p => ({ ...p, loading: false, error: e?.message || 'Failed to load attendance' }))
    }
  }

  useEffect(() => { loadPresent() }, [])

  // db:change fires on every FRO heartbeat (each open panel pushes ~every
  // 30s), so reloads are coalesced to at most one per 10s. The list stays
  // live without refetching the status aggregation N times per heartbeat wave.
  useEffect(() => {
    let timer = null
    let last = 0
    const queue = () => {
      if (!aliveRef.current || timer) return
      const wait = Math.max(0, 10000 - (Date.now() - last))
      timer = setTimeout(() => {
        timer = null
        if (!aliveRef.current) return
        last = Date.now()
        loadStatuses(false)
      }, wait)
    }
    const off = onDbChange({
      table: 'fro_live_status',
      event: '*',
      onInsert: queue,
      onUpdate: queue,
      onDelete: queue,
    })
    return () => {
      if (timer) clearTimeout(timer)
      if (typeof off === 'function') off()
    }
  }, [])

  // One shared ticker for call/break durations — no per-card intervals.
  useEffect(() => {
    const t = setInterval(() => { if (aliveRef.current) setNow(serverNow()) }, 30000)
    return () => clearInterval(t)
  }, [])

  // Anchor the device clock to the server on mount. GET /meeting is the cheap
  // authenticated endpoint that stamps `server_now`; it is called here purely for
  // its clock and the meeting payload itself is ignored.
  useEffect(() => {
    let alive = true
    const sentAt = Date.now()
    api('/meeting', { _prefix: 'ucs' })
      .then((r) => {
        if (!alive) return
        syncServerClock(r, { sentAt, receivedAt: Date.now() })
        if (aliveRef.current) setNow(serverNow())
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const refresh = () => { loadStatuses(true); loadPresent() }

  // Per-FRO admin pause ("play/pause"): freezes all their timers and shows a
  // blocking popup on their panel until resumed here.
  const togglePause = async (fs) => {
    const id = fs.worker_id || fs.fro_id || fs.id
    if (!id || pausingId) return
    const pausing = !fs.is_paused
    // `updated_at` is written by the server, so compare it against the SERVER
    // clock. A device clock 12h behind made this look stale and falsely warned
    // that the FRO's panel was offline.
    const liveSeen = fs.updated_at ? serverNow() - Date.parse(fs.updated_at) : Infinity
    // Freshness gate (~3 min): a stale heartbeat means their panel is
    // closed/offline — the pause still saves server-side and applies the
    // moment they next open the app.
    const panelOffline = pausing && liveSeen > 3 * 60 * 1000
    if (pausing && !window.confirm(`Pause ${fs.worker?.name || 'this FRO'}? All their timers stop until you resume them.${panelOffline ? ' Their panel looks offline right now — the pause will apply when they next open the app.' : ''}`)) return
    setPausingId(id)
    try {
      await api(`/ngo-admin/fro/${id}/${pausing ? 'pause' : 'resume'}`, { method: 'POST', body: JSON.stringify({}), _prefix: 'ucs' })
      // Optimistic flip: render Resume instantly instead of waiting for the
      // next realtime reload (which then confirms it server-side).
      const stamp = new Date().toISOString();
      setStatuses(prev => (prev || []).map(s => String(s.worker_id || s.fro_id || s.id) === String(id)
        ? { ...s, is_paused: pausing, paused_by: pausing ? (s.paused_by || 'Admin') : null, paused_at: pausing ? (s.paused_at || stamp) : null }
        : s));
      await loadStatuses(false)
    } catch (e) {
      console.error('Error:', e.message)
      window.alert(`Could not ${pausing ? 'pause' : 'resume'} this FRO: ${e.message || 'request failed'}`)
    } finally {
      setPausingId(null)
    }
  }

  const resetAllIdle = async () => {
    if (!window.confirm("Clear today's idle time for ALL FROs? This resets every FRO's current idle counter to zero.")) return
    setResetting(true)
    try {
      await api('/fro/status/reset-idle', { method: 'PUT', body: JSON.stringify({}), _prefix: 'ucs' })
      await loadStatuses(false)
    } catch (e) {
      console.error('Error:', e.message)
    } finally {
      if (aliveRef.current) setResetting(false)
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = statuses.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (!q) return true
      const name = (s.worker?.name || '').toLowerCase()
      const mail = (s.worker?.email || s.worker?.login_id || '').toLowerCase()
      return name.includes(q) || mail.includes(q)
    })
    const byName = (a, b) => (a.worker?.name || '').localeCompare(b.worker?.name || '')
    const idleOf = (s) => Number(s.performance?.today_idle_seconds) || 0
    const callsOf = (s) => Number(s.performance?.today_calls) || 0
    if (sort === 'name-desc') out.sort((a, b) => byName(b, a))
    else if (sort === 'idle-desc') out.sort((a, b) => idleOf(b) - idleOf(a) || byName(a, b))
    else if (sort === 'calls-desc') out.sort((a, b) => callsOf(b) - callsOf(a) || byName(a, b))
    else out.sort(byName)
    return out
  }, [statuses, query, statusFilter, sort])

  // `now` is on the server's clock (see serverClock), and an unparseable
  // timestamp must render as 00:00 rather than NaN.
  const secsSince = (iso) => {
    const s = Date.parse(iso)
    if (Number.isNaN(s)) return 0
    return Math.max(0, Math.floor((now - s) / 1000))
  }
  const liveCallSecs = (fs) => {
    if (fs.computed?.call_duration_seconds != null) return fs.computed.call_duration_seconds
    if (fs.call_started_at) return secsSince(fs.call_started_at)
    return 0
  }
  const liveBreakSecs = (fs) => {
    if (fs.computed?.break_duration_seconds != null) return fs.computed.break_duration_seconds
    if (fs.break_started_at) return secsSince(fs.break_started_at)
    return 0
  }

  return (
    <div className="lfs-page">
      <style>{LFS_CSS}</style>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div className="lfs-crumb">Operations › Live FRO Status</div>
          <h1 className="lfs-title">Live FRO Status</h1>
          <div className="lfs-sub">Monitor your field team in real-time.</div>
        </div>
        <div className="lfs-head-actions">
          <button type="button" className="lfs-btn" onClick={refresh} disabled={refreshing} aria-label="Refresh FRO status">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="lfs-btn lfs-btn-danger" onClick={resetAllIdle} disabled={resetting}>
            {resetting ? 'Clearing…' : 'Clear Idle Time'}
          </button>
        </div>
      </div>

      <div className="lfs-toolbar">
        <input
          type="text"
          className="lfs-input"
          placeholder="Search FRO..."
          aria-label="Search FRO by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="lfs-select" aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <select className="lfs-select" aria-label="Sort FROs" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="button" className="lfs-btn" onClick={refresh} disabled={refreshing} aria-label="Refresh list">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="lfs-grid" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="lfs-skel">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div className="lfs-shimmer" style={{ width: 40, height: 40, borderRadius: '50%' }} />
                <div style={{ flex: 1 }}>
                  <div className="lfs-shimmer" style={{ height: 14, width: '60%', marginBottom: 6 }} />
                  <div className="lfs-shimmer" style={{ height: 11, width: '80%' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4, marginTop: 10 }}>
                {[0, 1, 2, 3].map((j) => <div key={j} className="lfs-shimmer" style={{ height: 44 }} />)}
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="lfs-state" role="alert">
          <div style={{ fontSize: 15, fontWeight: 700, color: '#10213D' }}>Unable to load FRO status</div>
          <div style={{ fontSize: 13, color: '#6D7E95', marginTop: 4 }}>Please try again.</div>
          <button type="button" className="lfs-btn" style={{ marginTop: 12 }} onClick={refresh}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="lfs-state">
          <div style={{ fontSize: 15, fontWeight: 700, color: '#10213D' }}>No FROs found</div>
          <div style={{ fontSize: 13, color: '#6D7E95', marginTop: 4 }}>Try changing your search or status filter.</div>
          {(query || statusFilter !== 'all') && (
            <button type="button" className="lfs-btn" style={{ marginTop: 12 }} onClick={() => { setQuery(''); setStatusFilter('all') }}>Clear Filters</button>
          )}
        </div>
      ) : (
        <div className="lfs-grid">
          {rows.map((fs) => {
            const paused = !!fs.is_paused
            const meta = paused ? { label: 'Paused', color: '#6D28D9', bg: '#F5F3FF' } : (PILL[fs.status] || PILL.offline)
            const name = fs.worker?.name || 'Unknown'
            const mail = fs.worker?.email || fs.worker?.login_id || ''
            const rowId = fs.worker_id || fs.fro_id || fs.id
            const talk = Number(fs.performance?.today_talk_seconds) || 0
            const idleS = Number(fs.performance?.today_idle_seconds) || 0
            const calls = Number(fs.performance?.today_calls) || 0
            const denom = talk + idleS
            const prod = denom > 0 ? `${Math.round((talk / denom) * 100)}%` : '—'
            return (
              <article key={fs.id} className="lfs-card" aria-label={`${name}, ${meta.label}`}>
                <div className="lfs-card-top">
                  <Avatar fs={fs} name={name} />
                  <div className="lfs-id">
                    <div className="lfs-name" title={name}>{name}</div>
                    {!!mail && <div className="lfs-mail" title={mail}>{mail}</div>}
                  </div>
                  <span className="lfs-pill" style={{ background: meta.bg, color: meta.color }} title={paused && fs.paused_by ? `Paused by ${fs.paused_by}` : undefined}>
                    <span className="lfs-dot" style={{ background: meta.color }} aria-hidden="true" />
                    {meta.label}
                  </span>
                </div>
                <div className="lfs-metrics">
                  <div className="lfs-metric">
                    <div className="lfs-metric-val" style={{ color: '#287FE8' }}>{fmt(fs.status === 'on_call' ? liveCallSecs(fs) : talk)}</div>
                    <div className="lfs-metric-lbl">Talk</div>
                  </div>
                  <div className="lfs-metric">
                    <div className="lfs-metric-val" style={{ color: '#10213D' }}>{calls}</div>
                    <div className="lfs-metric-lbl">Calls</div>
                  </div>
                  <div className="lfs-metric">
                    <div className="lfs-metric-val" style={{ color: '#E98A00' }}>{fmt(idleS)}</div>
                    <div className="lfs-metric-lbl">Idle</div>
                  </div>
                  <div className="lfs-metric">
                    <div className="lfs-metric-val" style={{ color: '#E52B4A' }}>{prod}</div>
                    <div className="lfs-metric-lbl">Productivity</div>
                  </div>
                </div>
                <div className="lfs-seen">Last seen: {fs.updated_at ? new Date(fs.updated_at).toLocaleTimeString('en-IN') : '—'}</div>
                {paused && fs.paused_at && (() => {
                  const m = Math.floor((now - new Date(fs.paused_at).getTime()) / 60000);
                  return m >= 0 ? (
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6D28D9', marginTop: 4 }}>
                      Paused {m}m · by {fs.paused_by || 'Admin'}
                    </div>
                  ) : null;
                })()}
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="lfs-btn"
                    style={{ height: 32, fontSize: 12, padding: '0 12px', ...(paused ? {} : { background: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E' }) }}
                    onClick={() => togglePause(fs)}
                    disabled={pausingId === rowId}
                    aria-label={paused ? `Resume ${name}` : `Pause ${name}`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{paused ? 'play_arrow' : 'pause'}</span>
                    {pausingId === rowId ? '…' : paused ? 'Resume' : 'Pause'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Present today (attendance app). Deliberately separate from the live
          FRO grid above: this roster comes from the attendance app, so it
          includes people who punched in but never opened the CRM panel. */}
      <section style={{ marginTop: 26 }} aria-label="Present today from attendance">
        <button
          type="button"
          onClick={() => setPresent(p => ({ ...p, open: !p.open }))}
          aria-expanded={present.open}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            background: '#fff', border: '1px solid #DCE7F5', borderRadius: 10,
            padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#287FE8' }}>how_to_reg</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#10213D' }}>Present today</span>
          <span style={{ fontSize: 12, color: '#6D7E95' }}>punched in via the attendance app</span>
          {!present.loading && present.data && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#F0FDF4', color: '#16A34A' }}>
                {present.data.total} in
              </span>
              {present.data.late > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#FFFBEB', color: '#B45309' }}>
                  {present.data.late} late
                </span>
              )}
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#F2F6FC', color: '#475569' }}>
                {present.data.in_crm} in CRM
              </span>
            </span>
          )}
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#6D7E95' }}>{present.open ? 'expand_less' : 'expand_more'}</span>
        </button>

        {present.open && (
          <div style={{ marginTop: 10, background: '#fff', border: '1px solid #DCE7F5', borderRadius: 10, overflow: 'hidden' }}>
            {present.loading ? (
              <div style={{ padding: 18, fontSize: 13, color: '#6D7E95' }}>Loading attendance…</div>
            ) : present.error ? (
              <div style={{ padding: 18, fontSize: 13, color: '#B42318' }}>
                Could not load attendance: {present.error}
                <button type="button" className="lfs-btn" style={{ marginLeft: 10 }} onClick={loadPresent}>Retry</button>
              </div>
            ) : !present.data || present.data.members.length === 0 ? (
              <div style={{ padding: 18, fontSize: 13, color: '#6D7E95' }}>
                Nobody has punched in for {present.data?.date || 'today'} yet.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', color: '#6D7E95', textAlign: 'left' }}>
                    <th style={{ padding: '9px 12px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>Member</th>
                    <th style={{ padding: '9px 12px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>Department</th>
                    <th style={{ padding: '9px 12px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>NGO</th>
                    <th style={{ padding: '9px 12px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>Punched in</th>
                    <th style={{ padding: '9px 12px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>Status</th>
                    <th style={{ padding: '9px 12px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>CRM</th>
                  </tr>
                </thead>
                <tbody>
                  {present.data.members.map((m) => {
                    const late = m.attendance_status === 'late'
                    const half = m.attendance_status === 'half-day'
                    const attColor = half ? '#6D7E95' : late ? '#B45309' : '#16A34A'
                    const attBg = half ? '#F2F6FC' : late ? '#FFFBEB' : '#F0FDF4'
                    const attLabel = half ? 'Half-day' : (late ? `Late${m.late_minutes ? ` ${m.late_minutes}m` : ''}` : 'Present')
                    return (
                      <tr key={m.worker_id} style={{ borderTop: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 600, color: '#10213D' }}>
                          {m.name}
                          {!!m.login_id && <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>{m.login_id}</div>}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#475569' }}>{m.department || '—'}</td>
                        <td style={{ padding: '9px 12px', color: '#475569' }}>{m.ngo_name || '—'}</td>
                        <td style={{ padding: '9px 12px', color: '#10213D', fontVariantNumeric: 'tabular-nums' }}>
                          {m.punch_in_label || '—'}
                          {!!m.punch_out_label && <div style={{ fontSize: 11, color: '#94A3B8' }}>out {m.punch_out_label}</div>}
                        </td>
                        <td style={{ padding: '9px 12px' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                            background: attBg, color: attColor,
                          }}>
                            {attLabel}
                          </span>
                        </td>
                        <td style={{ padding: '9px 12px' }}>
                          {m.in_crm ? (
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#EFF6FF', color: '#287FE8' }}>
                              {m.is_paused ? 'Paused' : (PILL[m.crm_status]?.label || m.crm_status || 'In CRM')}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: '#94A3B8' }}>Not in CRM</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

    </div>
  )
}

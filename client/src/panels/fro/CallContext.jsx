import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { api } from './api/auth'
import { useActivityTracking } from './hooks/useActivityTracking'
import { istDateString, istDateTimeToIso } from './utils/time'
import { useMeeting } from '../../meetingStore'
import { onFroResetIdle, onSocketConnect, onFroPause, onFroResume, onDbChange } from '../../lib/socket'

const CallContext = createContext()

const BREAK_LIMIT = 3600

// A live call is exempt from idle detection, but only for a bounded window. A
// disposition modal left open (or a startCall whose endCall never fires) must
// not disable idle for the rest of the shift. The idle watchdog re-reads this
// every 15s, so a long call simply starts accruing idle once it passes the cap.
const MAX_CALL_EXEMPT = 30 * 60 * 1000
const isWithinCallExempt = (call) => !!call && Date.now() - (call.startTime || 0) < MAX_CALL_EXEMPT

const ZERO_STATS = { calls: 0, totalSeconds: 0, skippedDonors: 0, idleSeconds: 0, breakSeconds: 0, breakCount: 0 }

function fmt(seconds) {
  if (seconds == null) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Short attention chime for the first idle alert of a streak (best effort —
// browsers may block audio until a user gesture, the popup still shows).
function playAlertBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9)
    osc.start()
    osc.stop(ctx.currentTime + 0.95)
    setTimeout(() => { try { ctx.close() } catch {} }, 1200)
  } catch { /* audio unavailable — popup is the alert */ }
}

// Blocking popup shown while the FRO is call-idle. Sound plays on the first
// alert only; snoozing hides it for 6 minutes and it re-appears (silently)
// while idle continues. Mouse activity or real call activity dismisses it when
// the other inactivity condition is also clear.
const IdleAlertPopup = ({ callIdleSince, resetCallActivity }) => {
  const [now, setNow] = useState(Date.now())
  const [visible, setVisible] = useState(true)
  const snoozeTimerRef = useRef(null)

  useEffect(() => {
    playAlertBeep() // first alert only — remounts only after real activity
  }, [])

  // Live "Idle for X min" ticker
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const t = setInterval(tick, 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    return () => { if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current) }
  }, [])

  const snooze = () => {
    setVisible(false)
    snoozeTimerRef.current = setTimeout(() => setVisible(true), 6 * 60 * 1000)
  }

  const minutesIdle = callIdleSince
    ? Math.max(0, Math.floor((now - new Date(callIdleSince).getTime()) / 60000))
    : 0

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99994,
      background: 'rgba(15,23,42,.7)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 8,
    }}>
      <div style={{
        width: 'min(420px, 100%)',
        borderRadius: 18, background: '#fff', boxShadow: '0 24px 60px rgba(0,0,0,.4)',
        padding: 20,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
        }}>
          <span style={{
            width: 30, height: 30, borderRadius: 9, background: '#f87171',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(248,113,113,.3)',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#dc2626' }}>You are idle</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Idle for</span>
          <span style={{ fontSize: 22, color: '#dc2626', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {minutesIdle} min
          </span>
        </div>

        <div style={{ marginBottom: 16, fontSize: 13, fontWeight: 600, color: '#d97706' }}>
          No mouse movement or call activity for over 4 minutes. Please resume calling donors.
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={resetCallActivity}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none',
              background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Resume calling
          </button>
          <button
            onClick={snooze}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none',
              background: '#f59e0b', color: '#fff', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Snooze 6m
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: '#9ca3af' }}>
          This alert re-appears every 6 minutes while you remain idle. Making a call, saving a disposition, or ending a break dismisses it immediately.
        </div>
      </div>
    </div>
  )
}

export function CallProvider({ children, userId, operatorId }) {
  const [activeCall, setActiveCall] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null)
  const [todayStats, setTodayStats] = useState(ZERO_STATS)
  const lastDonorIdRef = useRef(null)
  const [onBreak, setOnBreak] = useState(false)
  const [breakElapsed, setBreakElapsed] = useState(0)
  const breakTimerRef = useRef(null)
  const [liveStatus, setLiveStatus] = useState('online')

  // Post-shift freeze: once the FRO falls idle after their own shift end
  // (worker shift_end_time → office_end_time setting → 19:00 default) the panel
  // reports offline and stops booking idle. Active overtime work keeps showing
  // its real status (on_call / break / online).
  const [postShiftIdle, setPostShiftIdle] = useState(false)
  const postShiftIdleRef = useRef(false)
  // Today's shift window (ms epoch) resolved from GET /attendance/today.
  const shiftStartMsRef = useRef(null)
  const shiftEndMsRef = useRef(null)
  const shiftTimesRef = useRef({ start: '10:00', end: '19:00' })

  // Admin per-FRO pause: freezes every live counter exactly like meeting mode.
  // Only an admin resume lifts it — the panel never unpauses itself.
  const [paused, setPaused] = useState(false)
  const [pausedBy, setPausedBy] = useState(null)
  const pausedRef = useRef(false)

  // Company-wide meeting mode: freezes every live counter while active.
  const meeting = useMeeting()
  const meetingActive = !!meeting
  const meetingActiveRef = useRef(false); meetingActiveRef.current = meetingActive
  // Wall-clock frozen while the meeting is active (null when not in a meeting).
  const meetingStartRef = useRef(null)
  // Wall-clock frozen while an admin pause is active (null when not paused).
  // Subtracted from call/break timers exactly like the meeting window.
  const pauseStartRef = useRef(null)
  // Paused milliseconds accumulated for the CURRENT call / break (per cycle).
  const callPausedMsRef = useRef(0)
  const breakPausedMsRef = useRef(0)
  const breakStartRef = useRef(null) // when the current break started

  // Refs mirroring state so syncAllStats stays stable and always reads fresh values
  const activeCallRef = useRef(null); activeCallRef.current = activeCall
  const onBreakRef = useRef(false); onBreakRef.current = onBreak
  const todayStatsRef = useRef(todayStats); todayStatsRef.current = todayStats
  // Start of the current idle streak (ISO), set by the call-idle engine
  const callIdleSinceRef = useRef(null)
  // True once today's counters have been seeded from the server on panel load.
  // Until then the in-memory counters are ZERO_STATS — pushing them would
  // overwrite the day's real totals (now guarded server-side too, but a fresh
  // tab must never even send zeros).
  const hydratedRef = useRef(false)
  // Timestamp of our last successful heartbeat push. Used after a socket
  // reconnect to detect a server-side reset (Clear Idle / midnight) that we
  // missed while disconnected.
  const lastPushAtRef = useRef(0)
  // Reset epoch: bumped by every Clear Idle Time / midnight reset. The server
  // ignores counters + streak from pushes carrying an older epoch, so a panel
  // that missed the reset broadcast can never resurrect wiped totals.
  const epochRef = useRef(0)

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  const clearBreakTimer = () => { if (breakTimerRef.current) { clearInterval(breakTimerRef.current); breakTimerRef.current = null } }

  const totalBreakWithCurrent = todayStats.breakSeconds + (onBreak ? breakElapsed : 0)
  const isBreakOvertime = totalBreakWithCurrent > BREAK_LIMIT

  // Stats are server-authoritative: the client keeps today's counters in memory
  // only (never localStorage) and pushes them on every change. statsOverride lets
  // a caller push a freshly-computed value before React re-renders the ref.
  const syncAllStats = useCallback((extra = {}, statsOverride = null) => {
    const stats = statsOverride || todayStatsRef.current
    // Admin pause freezes like meeting mode: panel reports 'meeting' so every
    // timer/counter path treats it as frozen; is_paused on the server row
    // drives the distinct "Paused" display on admin screens.
    const status = (meetingActiveRef.current || pausedRef.current) ? 'meeting'
      : (onBreakRef.current ? 'break'
        : (activeCallRef.current ? 'on_call'
          : (postShiftIdleRef.current ? 'offline'
            : (callIdleSinceRef.current ? 'idle' : 'online'))))
    setLiveStatus(status)
    // Pre-hydration (or explicit stats): never send unseeded in-memory
    // counters — status-only announce keeps presence fresh without risking
    // the day's totals. Explicit statsOverride values are always safe to send.
    const countersReady = hydratedRef.current || statsOverride != null
    api('/fro/status', {
      method: 'PUT',
      body: JSON.stringify({
        status,
        idle_epoch: epochRef.current,
        current_donor_name: activeCallRef.current?.donorName || null,
        current_donor_id: activeCallRef.current?.donorId || null,
        ...(countersReady ? {
          today_calls: stats.calls,
          today_talk_seconds: stats.totalSeconds,
          today_skipped: stats.skippedDonors,
          today_idle_seconds: stats.idleSeconds,
          today_break_seconds: stats.breakSeconds,
        } : {}),
        on_break: onBreakRef.current,
        ...extra,
      }),
    })
      .then((res) => {
        lastPushAtRef.current = Date.now()
        // Midnight/clear-reset ephemera: a force push that went through returns
        // the current epoch, so a panel that stayed open across the IST-midnight
        // reset re-learns it and keeps writing the new day instead of being
        // frozen out all day as stale.
        if (Number.isFinite(Number(res?.idle_epoch))) epochRef.current = Number(res.idle_epoch)
      })
      .catch((err) => { console.error('Error:', err.message); })
  }, [])

  // Update todayStats in memory (merge or replace) + push it to the server.
  const commitTodayStats = useCallback((next, extra = {}, opts = {}) => {
    const merged = opts.replace ? next : { ...todayStatsRef.current, ...next }
    todayStatsRef.current = merged
    setTodayStats(merged)
    syncAllStats(extra, merged)
  }, [syncAllStats])

  // Seed today's counters (used on panel load — no localStorage anymore).
  // Also learns the server's reset epoch so our pushes are never mistaken
  // for pre-reset stale data.
  const hydrateTodayStats = useCallback((next, epoch) => {
    todayStatsRef.current = next
    setTodayStats(next)
    hydratedRef.current = true
    if (Number.isFinite(Number(epoch))) epochRef.current = Number(epoch)
  }, [])

// ---------- Combined mouse/call idle engine (6 min) ----------
  const markPostShiftIdle = useCallback((value) => {
    postShiftIdleRef.current = value
    setPostShiftIdle(value)
  }, [])

  // Book an open idle streak (started via onCallIdle) once, clamped to the shift
  // end so a streak that ran past the FRO's shift never books after-hours time.
  // No-op when no streak is open. Called on activity, meeting/pause start, day
  // rollover and the shift-end boundary tick.
  const closeIdleStreak = useCallback(() => {
    const since = callIdleSinceRef.current
    if (!since) return
    callIdleSinceRef.current = null
    // Defensive: never book a streak that started on an earlier IST day. The
    // open path guards this too, but a suspended tab may close its streak late
    // after the day rollover.
    if (istDateString(since) !== istDateString()) return
    let endMs = Date.now()
    const shiftEndMs = shiftEndMsRef.current
    if (shiftEndMs && endMs > shiftEndMs) endMs = shiftEndMs
    const idleSecs = Math.max(0, Math.floor((endMs - new Date(since).getTime()) / 1000))
    if (idleSecs > 0) {
      commitTodayStats({ ...todayStatsRef.current, idleSeconds: todayStatsRef.current.idleSeconds + idleSecs })
    }
  }, [commitTodayStats])

  const { isCallIdle, callIdleSince, resetCallActivity } = useActivityTracking(userId, {
    callIdleThreshold: 4 * 60 * 1000,
    // Breaks, live calls, meeting mode and admin pause are exempt from idle
    // detection. Open donor views are NOT exempt: opening a record refreshes
    // the activity timers, but a record left open with no work for over 4
    // minutes starts counting as idle (mouse movement does NOT reset it — idle
    // tracks panel work only, on any page or modal). A call is exempt only for
    // MAX_CALL_EXEMPT so a forgotten modal can never suspend idle indefinitely.
    isExempt: () => meetingActiveRef.current || pausedRef.current || onBreakRef.current || isWithinCallExempt(activeCallRef.current),
    onCallIdle: (sinceIso) => {
      const nowMs = Date.now()
      if (shiftStartMsRef.current && nowMs < shiftStartMsRef.current) {
        // Before the shift: idle is not booked, the panel stays online.
        syncAllStats({ status: 'online', idle_since: null })
        return
      }
      if (shiftEndMsRef.current && nowMs >= shiftEndMsRef.current) {
        // After the shift: never open a streak; the panel goes offline and books
        // nothing until the FRO becomes active again.
        markPostShiftIdle(true)
        syncAllStats({ status: 'offline', idle_since: null })
        return
      }
      // Never open a streak that started on an earlier IST day — a throttled or
      // suspended tab can fire this after midnight and would otherwise carry the
      // previous day's streak into the new day.
      if (istDateString(sinceIso) !== istDateString()) return
      callIdleSinceRef.current = sinceIso
      syncAllStats({ status: 'idle', idle_since: sinceIso })
    },
    onCallResume: () => {
      closeIdleStreak()
      markPostShiftIdle(false)
      syncAllStats({ idle_since: null })
    },
  })

  // ---------- Meeting mode: freeze every counter ----------
  useEffect(() => {
    if (meetingActive) {
      meetingStartRef.current = Date.now()
      // Close any open idle streak counting only up to the meeting start, so
      // meeting time never becomes idle time.
      closeIdleStreak()
      resetCallActivity()
      syncAllStats({ idle_since: null })
    } else {
      // Meeting over — accrue the paused window once, then resume normally.
      if (meetingStartRef.current) {
        const paused = Date.now() - meetingStartRef.current
        callPausedMsRef.current += paused
        breakPausedMsRef.current += paused
        meetingStartRef.current = null
      }
      resetCallActivity() // fresh idle streak starts post-meeting, no meeting seconds
      syncAllStats()
    }
  }, [meetingActive, syncAllStats, resetCallActivity, closeIdleStreak])

  // ---------- Stats sync & status transitions ----------
  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return
    let cancelled = false
    // No localStorage anymore: hydrate today's counters from the server (same IST
    // day only — a new day starts at zero), then announce online/status.
    ;(async () => {
      try {
        const live = await api('/fro/status/me', { _prefix: 'ucs' })
        if (cancelled || !live) return
        const serverDay = istDateString(live.updated_at || new Date().toISOString())
        if (serverDay === istDateString()) {
          hydrateTodayStats({
            calls: live.today_calls || 0,
            totalSeconds: live.today_talk_seconds || 0,
            skippedDonors: live.today_skipped || 0,
            idleSeconds: live.today_idle_seconds || 0,
            breakSeconds: live.today_break_seconds || 0,
            breakCount: 0,
          }, live.idle_epoch)
          // Paused while away: enter frozen mode immediately on load.
          if (live.is_paused) {
            pausedRef.current = true
            setPaused(true)
            setPausedBy(live.paused_by || null)
          }
        } else if (Number.isFinite(Number(live.idle_epoch))) {
          // New day: counters stay zero, but still learn the epoch.
          epochRef.current = Number(live.idle_epoch)
        }
      } catch (e) {
        console.error('Error:', e.message)
      } finally {
        // Mark hydrated even on failure / new-day (zeros are then deliberate
        // for the new day) so later syncs carry counters; the pre-hydration
        // sync above stays status-only and can never push unseeded zeros.
        hydratedRef.current = true
        if (!cancelled) syncAllStats()
      }
    })()
    return () => {
      cancelled = true
      if (!localStorage.getItem('ucs_token')) return
      api('/fro/status', { method: 'PUT', body: JSON.stringify({ status: 'offline' }) }).catch(() => {})
    }
  }, [hydrateTodayStats, syncAllStats])

  // Admin "Clear Idle Time": the backend zeroed today_idle_seconds server-side
  // and broadcast fro:reset-idle. Mirror it in memory so the UI matches.
  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return undefined
    return onFroResetIdle((evt) => {
      if (Number.isFinite(Number(evt?.epoch))) epochRef.current = Number(evt.epoch)
      callIdleSinceRef.current = null
      const next = { ...todayStatsRef.current, idleSeconds: 0 }
      todayStatsRef.current = next
      setTodayStats(next)
      syncAllStats({ idle_since: null, force_counters: true })
    })
  }, [syncAllStats])

  // ── Admin per-FRO pause ──────────────────────────────────────
  // applyPause freezes exactly like meeting start: close any open idle streak
  // counting only up to this moment, then announce (panel reports 'meeting'
  // while paused; is_paused on the server drives the Paused badge).
  const applyPause = useCallback((by) => {
    if (pausedRef.current) {
      if (by) setPausedBy(by)
      return
    }
    pausedRef.current = true
    setPaused(true)
    setPausedBy(by || null)
    if (pauseStartRef.current == null) pauseStartRef.current = Date.now()
    closeIdleStreak()
    resetCallActivity()
    syncAllStats({ idle_since: null })
  }, [closeIdleStreak, resetCallActivity, syncAllStats])

  const clearPause = useCallback(() => {
    if (!pausedRef.current) return
    pausedRef.current = false
    setPaused(false)
    setPausedBy(null)
    // Accrue the paused window once so in-progress calls/breaks exclude it,
    // mirroring the meeting-over path. Fresh idle streak starts post-pause.
    if (pauseStartRef.current) {
      const pausedMs = Date.now() - pauseStartRef.current
      callPausedMsRef.current += pausedMs
      breakPausedMsRef.current += pausedMs
      pauseStartRef.current = null
    }
    resetCallActivity() // fresh streak starts post-pause, no paused seconds counted
    syncAllStats()
  }, [resetCallActivity, syncAllStats])

  // FRO self-resume: the Play button in the blocking pause popup. Server
  // clears the flag (converging socket event follows); lift locally at once.
  const resumeSelf = useCallback(async () => {
    await api('/fro/status/resume-self', { method: 'POST', body: JSON.stringify({}) })
    clearPause()
  }, [clearPause])

  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return undefined
    const offPause = onFroPause((evt) => applyPause(evt?.by))
    const offResume = onFroResume(() => clearPause())
    return () => { offPause(); offResume() }
  }, [applyPause, clearPause])

  // Self-row watch (belt and suspenders): every fro_live_status write is
  // broadcast as db:change, so even if a targeted fro:pause/fro:resume event
  // is missed, the panel converges the moment any heartbeat lands. This is
  // what makes pause work for panels that reconnected, missed events, or run
  // older code paths — no room targeting involved.
  // Acting ("work as") session: also watch the real operator's row — a pause
  // on the operator never touches the impersonated target's row, so watching
  // only userId would miss it. Unpause converges via /fro/status/me (which
  // merges both rows) so resuming one side can't lift the other's pause.
  useEffect(() => {
    if (!localStorage.getItem('ucs_token') || !userId) return undefined
    const watched = new Set([String(userId)])
    if (operatorId) watched.add(String(operatorId))
    const converge = () => {
      api('/fro/status/me', { _prefix: 'ucs' })
        .then((live) => {
          if (live?.is_paused) applyPause(live.paused_by)
          else clearPause()
        })
        .catch(() => {})
    }
    return onDbChange({
      table: 'fro_live_status',
      event: '*',
      filter: (p) => watched.has(String((p.new || p.old || {}).worker_id)),
      onInsert: (row) => { if (row?.is_paused) applyPause(row.paused_by); },
      onUpdate: (row) => {
        // Heartbeats rewrite this row ~every 30s without changing pause
        // state — only converge (GET /fro/status/me) when the flag flipped,
        // otherwise every heartbeat costs a pointless round-trip per panel.
        if (!!row?.is_paused === pausedRef.current) return
        if (row?.is_paused) applyPause(row?.paused_by)
        else converge()
      },
      onDelete: () => {},
    })
  }, [userId, operatorId, applyPause, clearPause])

  // Socket reconnect convergence: if the server row was authoritatively
  // zeroed (Clear Idle Time / midnight reset) while we were disconnected, our
  // in-memory counters are stale — adopting them via max-keep would resurrect
  // the wiped totals on the next push. Adopt the server zeros instead (and
  // drop any phantom streak). Non-zero server rows are left alone: max-keep
  // already converges those correctly. Pause state is always adopted.
  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return undefined
    return onSocketConnect(() => {
      if (!hydratedRef.current || !lastPushAtRef.current) return
      api('/fro/status/me', { _prefix: 'ucs' })
        .then((live) => {
          if (!live || !live.updated_at) return
          if (Number.isFinite(Number(live.idle_epoch))) epochRef.current = Number(live.idle_epoch)
          if (live.is_paused && !pausedRef.current) { applyPause(live.paused_by); return }
          if (!live.is_paused && pausedRef.current) { clearPause(); return }
          if (new Date(live.updated_at).getTime() <= lastPushAtRef.current) return
          const serverZero = ['today_calls', 'today_talk_seconds', 'today_skipped', 'today_idle_seconds', 'today_break_seconds']
            .every((k) => Number(live[k] || 0) === 0)
          if (!serverZero) return
          const mem = todayStatsRef.current
          const memDirty = (mem.calls || mem.totalSeconds || mem.skippedDonors || mem.idleSeconds || mem.breakSeconds) > 0
          if (!memDirty && !callIdleSinceRef.current) return
          callIdleSinceRef.current = null
          const next = { calls: 0, totalSeconds: 0, skippedDonors: 0, idleSeconds: 0, breakSeconds: 0, breakCount: 0 }
          todayStatsRef.current = next
          setTodayStats(next)
        })
        .catch(() => {})
    })
  }, [applyPause, clearPause])
  // New IST day while the panel is open: roll today's counters back to 0 so the
  // heartbeat never carries yesterday's totals into the new day's fro_daily_stats
  // row (which is upserted with GREATEST and would otherwise keep them forever).
  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return undefined
    let day = istDateString()
    const timer = setInterval(() => {
      const now = istDateString()
      if (now === day) return
      day = now
      callIdleSinceRef.current = null
      const next = { calls: 0, totalSeconds: 0, skippedDonors: 0, idleSeconds: 0, breakSeconds: 0, breakCount: 0 }
      todayStatsRef.current = next
      setTodayStats(next)
      // force_counters: this zero-push is the deliberate daily reset — it must
      // win over any max-kept value on the server, otherwise idle would never
      // reset each day.
      syncAllStats({ idle_since: null, force_counters: true }, next)
    }, 30 * 1000)
    return () => clearInterval(timer)
  }, [syncAllStats])

  // ---------- Shift window (idle only within the FRO's own shift) ----------
  // The per-worker shift is resolved by GET /attendance/today (worker
  // shift_start/shift_end → office_start/office_end settings → 10:00–19:00).
  const resolveShift = useCallback(() => {
    const date = istDateString()
    const startIso = istDateTimeToIso(date, shiftTimesRef.current.start)
    const endIso = istDateTimeToIso(date, shiftTimesRef.current.end)
    shiftStartMsRef.current = startIso ? new Date(startIso).getTime() : null
    shiftEndMsRef.current = endIso ? new Date(endIso).getTime() : null
  }, [])

  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return undefined
    let cancelled = false
    api('/attendance/today')
      .then((d) => {
        if (cancelled || !d) return
        shiftTimesRef.current = {
          start: d.officeStartTime || '10:00',
          end: d.officeEndTime || '19:00',
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) resolveShift() })
    return () => { cancelled = true }
  }, [resolveShift])

  // Every 30s: roll the shift window at IST midnight and freeze idle the moment
  // the shift ends while an idle streak is running (booking only the in-shift
  // part). Active overtime work is left untouched.
  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return undefined
    let day = istDateString()
    const tick = () => {
      const today = istDateString()
      if (today !== day) {
        day = today
        resolveShift()
        if (postShiftIdleRef.current) markPostShiftIdle(false)
        resetCallActivity()
      }
      const endMs = shiftEndMsRef.current
      if (!endMs || Date.now() < endMs) return
      if (callIdleSinceRef.current) {
        closeIdleStreak() // clamps the streak to the shift end
        markPostShiftIdle(true)
        syncAllStats({ status: 'offline', idle_since: null })
      }
    }
    tick()
    const timer = setInterval(tick, 30 * 1000)
    return () => clearInterval(timer)
  }, [resolveShift, resetCallActivity, closeIdleStreak, markPostShiftIdle, syncAllStats])

  // ---------- Idle streak heartbeat ----------
  // An open idle streak emits no other pushes (presence is socket-based), so a
  // truly idle-and-motionless panel leaves the row stale and freshness-gated
  // Idle readings on the FRO strip freeze after ~3 min. Ping the status
  // endpoint once a minute while the streak is open: same counters, same
  // idle_since, same epoch — idempotent, keeps the row fresh and the daily
  // stats snapshot current without touching the streak.
  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return undefined
    const timer = setInterval(() => {
      if (callIdleSinceRef.current) syncAllStats()
    }, 60 * 1000)
    return () => clearInterval(timer)
  }, [syncAllStats])

  // Push status whenever it changes (call started/ended, break toggled)
  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return
    syncAllStats()
  }, [activeCall, onBreak, syncAllStats])

  useEffect(() => {
    if (activeCall) {
      clearBreakTimer()
      timerRef.current = setInterval(() => {
        const nowClock = Date.now()
        const paused = callPausedMsRef.current + (meetingStartRef.current ? nowClock - meetingStartRef.current : 0) + (pauseStartRef.current ? nowClock - pauseStartRef.current : 0)
        setElapsed(Math.max(0, Math.floor((nowClock - activeCall.startTime - paused) / 1000)))
      }, 1000)
      return clearTimer
    } else {
      setElapsed(0)
      callPausedMsRef.current = 0
    }
  }, [activeCall])

  useEffect(() => {
    if (onBreak) {
      clearTimer()
      breakStartRef.current = Date.now()
      breakTimerRef.current = setInterval(() => {
        const nowClock = Date.now()
        const paused = breakPausedMsRef.current + (meetingStartRef.current ? nowClock - meetingStartRef.current : 0) + (pauseStartRef.current ? nowClock - pauseStartRef.current : 0)
        setBreakElapsed(Math.max(0, Math.floor((nowClock - breakStartRef.current - paused) / 1000)))
      }, 1000)
      return clearBreakTimer
    } else {
      setBreakElapsed(0)
      breakPausedMsRef.current = 0
      breakStartRef.current = null
    }
  }, [onBreak])

  const startDonorView = useCallback((donorId) => {
    lastDonorIdRef.current = donorId
    // Opening a donor record IS the work (the FRO dials from the record on her
    // phone): counts as activity, clearing any open idle streak and restarting
    // the 4-minute timer. It does not exempt the record beyond that grace.
    resetCallActivity()
  }, [resetCallActivity])

  const endDonorView = useCallback(() => {
    // A donor view is working time, never idle (the panel's call button is
    // unused — the call happens on the FRO's phone while the record is open).
    // No skipped/idle booking happens here; idle is booked only by the streak
    // engine, which closes on this activity reset.
    resetCallActivity() // donor reviewed → counts as activity
  }, [resetCallActivity])

  const toggleBreak = useCallback(() => {
    if (onBreak) {
      commitTodayStats({
        breakSeconds: todayStatsRef.current.breakSeconds + breakElapsed,
        breakCount: todayStatsRef.current.breakCount + 1,
      })
      setOnBreak(false)
      setBreakElapsed(0)
      resetCallActivity() // break ended → idle timer restarts
    } else {
      setOnBreak(true)
      setBreakElapsed(0)
      resetCallActivity() // break started → clear any live idle streak
    }
  }, [onBreak, breakElapsed, resetCallActivity])

  const startCall = useCallback((donor) => {
    if (onBreak) toggleBreak()
    setActiveCall({
      donorId: donor.id || donor.donorId,
      donorName: donor.donor_name || donor.donorName,
      donorMobile: donor.donor_mobile || donor.donorMobile,
      startTime: Date.now(),
    })
    resetCallActivity() // calling resets the idle timer
  }, [onBreak, toggleBreak, resetCallActivity])

  const endCall = useCallback(() => {
    // Read the call through activeCallRef, never through the `activeCall`
    // closure. endCall is invoked from effect cleanups (the disposition modal
    // calls it on unmount with [] deps), where a closure captured before
    // startCall ran still holds activeCall === null — so the old `if (activeCall)`
    // silently skipped the call/talk counters and left today_calls at 0 all day.
    const call = activeCallRef.current
    if (call) {
      // Clear before counting so a cleanup plus an explicit endCall in the same
      // tick cannot book the same call twice.
      activeCallRef.current = null
      const nowClock = Date.now()
      // Meeting/paused time is excluded: only talk time outside those windows counts.
      const paused = callPausedMsRef.current + (meetingStartRef.current ? nowClock - meetingStartRef.current : 0) + (pauseStartRef.current ? nowClock - pauseStartRef.current : 0)
      const duration = Math.max(0, Math.floor((nowClock - call.startTime - paused) / 1000))
      if (duration > 0) {
        commitTodayStats({
          calls: todayStatsRef.current.calls + 1,
          totalSeconds: todayStatsRef.current.totalSeconds + duration,
        })
      }
    }
    setActiveCall(null)
    resetCallActivity() // call ended → idle timer restarts
  }, [commitTodayStats, resetCallActivity])

  return (
    <CallContext.Provider value={{
      activeCall, elapsed, todayStats, startCall, endCall, isOnCall: !!activeCall,
      startDonorView, endDonorView, syncAllStats, fmt,
      onBreak, breakElapsed, toggleBreak, isBreakOvertime, BREAK_LIMIT,
      isCallIdle, resetCallActivity, status: liveStatus,
      paused, pausedBy, resumeSelf,
    }}>
      {children}
      {isCallIdle && !meetingActive && !paused && !postShiftIdle && (
        <IdleAlertPopup
          callIdleSince={callIdleSince}
          resetCallActivity={resetCallActivity}
        />
      )}
    </CallContext.Provider>
  )
}

export function useCall() {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall must be used within CallProvider')
  return ctx
}

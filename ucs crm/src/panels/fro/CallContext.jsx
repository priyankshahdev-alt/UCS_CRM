import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { api } from './api/auth'
import { useActivityTracking } from './hooks/useActivityTracking'
import { istDateString } from './utils/time'

const CallContext = createContext()

const STATS_KEY = 'fro_call_stats'
const BREAK_LIMIT = 3600

function loadStats(userId) {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (!raw) return { calls: 0, totalSeconds: 0, skippedDonors: 0, idleSeconds: 0, breakSeconds: 0, breakCount: 0 }
    const data = JSON.parse(raw)
    const today = istDateString()
    if (data.date === today && data.userId === userId) {
      return {
        calls: data.calls || 0,
        totalSeconds: data.totalSeconds || 0,
        skippedDonors: data.skippedDonors || 0,
        idleSeconds: data.idleSeconds || 0,
        breakSeconds: data.breakSeconds || 0,
        breakCount: data.breakCount || 0,
      }
    }
    return { calls: 0, totalSeconds: 0, skippedDonors: 0, idleSeconds: 0, breakSeconds: 0, breakCount: 0 }
  } catch { return { calls: 0, totalSeconds: 0, skippedDonors: 0, idleSeconds: 0, breakSeconds: 0, breakCount: 0 } }
}

function saveStats(userId, stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify({
      date: istDateString(),
      userId,
      calls: stats.calls,
      totalSeconds: stats.totalSeconds,
      skippedDonors: stats.skippedDonors,
      idleSeconds: stats.idleSeconds,
      breakSeconds: stats.breakSeconds,
      breakCount: stats.breakCount,
    }))
  } catch (e) { console.error('Error:', e.message); }
}

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
// alert only; snoozing hides it for 5 minutes and it re-appears (silently)
// while idle continues. Only real call activity dismisses it for good.
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
    snoozeTimerRef.current = setTimeout(() => setVisible(true), 5 * 60 * 1000)
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
          No call activity for over 2 minutes. Please resume calling donors.
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
            Snooze 5m
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: '#9ca3af' }}>
          This alert re-appears every 5 minutes while you remain idle. Making a call, saving a disposition, or ending a break dismisses it immediately.
        </div>
      </div>
    </div>
  )
}

export function CallProvider({ children, userId }) {
  const [activeCall, setActiveCall] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null)
  const [todayStats, setTodayStats] = useState(() => loadStats(userId))
  const donorViewStartRef = useRef(null)
  const lastDonorIdRef = useRef(null)
  const [onBreak, setOnBreak] = useState(false)
  const [breakElapsed, setBreakElapsed] = useState(0)
  const breakTimerRef = useRef(null)

  // Refs mirroring state so syncAllStats stays stable and always reads fresh values
  const activeCallRef = useRef(null); activeCallRef.current = activeCall
  const onBreakRef = useRef(false); onBreakRef.current = onBreak
  const todayStatsRef = useRef(todayStats); todayStatsRef.current = todayStats
  // Start of the current idle streak (ISO), set by the call-idle engine
  const callIdleSinceRef = useRef(null)

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  const clearBreakTimer = () => { if (breakTimerRef.current) { clearInterval(breakTimerRef.current); breakTimerRef.current = null } }

  const totalBreakWithCurrent = todayStats.breakSeconds + (onBreak ? breakElapsed : 0)
  const isBreakOvertime = totalBreakWithCurrent > BREAK_LIMIT

  const syncAllStats = useCallback((extra = {}) => {
    const status = onBreakRef.current ? 'break'
      : (activeCallRef.current ? 'on_call'
        : (callIdleSinceRef.current ? 'idle' : 'online'))
    api('/fro/status', {
      method: 'PUT',
      body: JSON.stringify({
        status,
        current_donor_name: activeCallRef.current?.donorName || null,
        current_donor_id: activeCallRef.current?.donorId || null,
        today_calls: todayStatsRef.current.calls,
        today_talk_seconds: todayStatsRef.current.totalSeconds,
        today_skipped: todayStatsRef.current.skippedDonors,
        today_idle_seconds: todayStatsRef.current.idleSeconds,
        today_break_seconds: todayStatsRef.current.breakSeconds,
        on_break: onBreakRef.current,
        ...extra,
      }),
    }).catch((err) => { console.error('Error:', err.message); })
  }, [])

  // ---------- Call-idle engine (2 min) ----------
  const { isCallIdle, callIdleSince, resetCallActivity, sendHeartbeat } = useActivityTracking(userId, {
    callIdleThreshold: 2 * 60 * 1000,
    // Breaks, live calls and open donor views are exempt from idle detection
    isExempt: () => onBreakRef.current || activeCallRef.current != null || donorViewStartRef.current != null,
    onCallIdle: (sinceIso) => {
      callIdleSinceRef.current = sinceIso
      syncAllStats({ status: 'idle', idle_since: sinceIso })
    },
    onCallResume: () => {
      const since = callIdleSinceRef.current
      callIdleSinceRef.current = null
      if (since) {
        const idleSecs = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000))
        if (idleSecs > 0) {
          setTodayStats(prev => {
            const next = { ...prev, idleSeconds: prev.idleSeconds + idleSecs }
            saveStats(userId, next)
            return next
          })
        }
      }
      syncAllStats({ idle_since: null })
    },
    onIdle: () => { syncAllStats() },
    onActive: () => { syncAllStats() },
  })

  // ---------- Stats sync & status transitions ----------
  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return
    syncAllStats()
    return () => {
      if (!localStorage.getItem('ucs_token')) return
      api('/fro/status', { method: 'PUT', body: JSON.stringify({ status: 'offline' }) }).catch(() => {})
    }
  }, [])

  // Push status whenever it changes (call started/ended, break toggled)
  useEffect(() => {
    if (!localStorage.getItem('ucs_token')) return
    syncAllStats()
  }, [activeCall, onBreak, syncAllStats])

  useEffect(() => {
    if (activeCall) {
      clearBreakTimer()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - activeCall.startTime) / 1000))
      }, 1000)
      return clearTimer
    } else {
      setElapsed(0)
    }
  }, [activeCall])

  useEffect(() => {
    if (onBreak) {
      clearTimer()
      breakTimerRef.current = setInterval(() => {
        setBreakElapsed(prev => prev + 1)
      }, 1000)
      return clearBreakTimer
    } else {
      setBreakElapsed(0)
    }
  }, [onBreak])

  const startDonorView = useCallback((donorId) => {
    donorViewStartRef.current = Date.now()
    lastDonorIdRef.current = donorId
  }, [])

  const endDonorView = useCallback((wasCalled) => {
    const start = donorViewStartRef.current
    if (!start) return
    const elapsedView = Math.floor((Date.now() - start) / 1000)
    if (!wasCalled && elapsedView >= 3) {
      setTodayStats(prev => {
        const next = {
          ...prev,
          skippedDonors: prev.skippedDonors + 1,
          idleSeconds: prev.idleSeconds + elapsedView,
        }
        saveStats(userId, next)
        return next
      })
    }
    donorViewStartRef.current = null
    resetCallActivity() // donor reviewed → counts as activity
  }, [userId, resetCallActivity])

  const toggleBreak = useCallback(() => {
    if (onBreak) {
      setTodayStats(prev => {
        const next = { ...prev, breakSeconds: prev.breakSeconds + breakElapsed, breakCount: prev.breakCount + 1 }
        saveStats(userId, next)
        return next
      })
      setOnBreak(false)
      setBreakElapsed(0)
      resetCallActivity() // break ended → idle timer restarts
    } else {
      setOnBreak(true)
      setBreakElapsed(0)
      resetCallActivity() // break started → clear any live idle streak
    }
  }, [onBreak, breakElapsed, userId, resetCallActivity])

  const startCall = useCallback((donor) => {
    if (onBreak) toggleBreak()
    donorViewStartRef.current = null
    setActiveCall({
      donorId: donor.id || donor.donorId,
      donorName: donor.donor_name || donor.donorName,
      donorMobile: donor.donor_mobile || donor.donorMobile,
      startTime: Date.now(),
    })
    resetCallActivity() // calling resets the idle timer
  }, [onBreak, toggleBreak, resetCallActivity])

  const endCall = useCallback(() => {
    if (activeCall) {
      const duration = Math.floor((Date.now() - activeCall.startTime) / 1000)
      setTodayStats(prev => {
        const next = { ...prev, calls: prev.calls + 1, totalSeconds: prev.totalSeconds + duration }
        saveStats(userId, next)
        return next
      })
    }
    setActiveCall(null)
    resetCallActivity() // call ended → idle timer restarts
  }, [activeCall, userId, resetCallActivity])

  return (
    <CallContext.Provider value={{
      activeCall, elapsed, todayStats, startCall, endCall, isOnCall: !!activeCall,
      startDonorView, endDonorView, syncAllStats, fmt,
      onBreak, breakElapsed, toggleBreak, isBreakOvertime, BREAK_LIMIT,
      isCallIdle, resetCallActivity, sendHeartbeat,
    }}>
      {children}
      {isCallIdle && (
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

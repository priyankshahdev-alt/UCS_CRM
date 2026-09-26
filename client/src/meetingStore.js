import { useEffect, useState } from 'react'
import { api } from './api/auth'
import { onDbChange } from './lib/socket'
import { syncFrom as syncServerClock } from './lib/serverClock'

// Shared "meeting mode" state for the whole web CRM. One poller + realtime
// events feed every consumer (MeetingGate overlay, admin button, FRO call
// context, NGO dashboard) so there is a single source of truth.

const POLL_MS = 12000

let state = { meeting: null }
const listeners = new Set()
let timer = null
let inflight = false

function emit() {
  const s = state
  for (const l of listeners) l(s)
}

function ensureTimer() {
  if (!timer) timer = setInterval(refreshMeeting, POLL_MS)
}

function stopTimerIfIdle() {
  if (listeners.size === 0 && timer) {
    clearInterval(timer)
    timer = null
  }
}

export function refreshMeeting() {
  if (inflight) return
  const token = localStorage.getItem('ucs_token')
  if (!token) {
    if (state.meeting) {
      state = { meeting: null }
      emit()
    }
    return
  }
  inflight = true
  const sentAt = Date.now()
  api('/meeting', { _prefix: 'ucs' })
    .then((r) => {
      // Keep the device clock anchored to the server on every poll, even when
      // the meeting itself hasn't changed — this is what makes the elapsed
      // counter read the same on a phone with a wrong clock.
      syncServerClock(r, { sentAt, receivedAt: Date.now() })
      const next = r && r.active ? r : null
      if ((next?.id) !== (state.meeting?.id) || Boolean(next) !== Boolean(state.meeting)) {
        state = { meeting: next }
        emit()
      }
    })
    .catch(() => {})
    .finally(() => { inflight = false })
}

export async function startMeeting(title, teams) {
  const r = await api('/meeting/start', {
    method: 'POST',
    body: JSON.stringify({ title, teams }),
    _prefix: 'ucs',
  })
  refreshMeeting()
  return r
}

export async function endMeeting() {
  const r = await api('/meeting/end', {
    method: 'POST',
    body: JSON.stringify({}),
    _prefix: 'ucs',
  })
  refreshMeeting()
  return r
}

export function useMeeting() {
  const [snapshot, setSnapshot] = useState(state)
  useEffect(() => {
    listeners.add(setSnapshot)
    ensureTimer()
    refreshMeeting()
    // Instant cross-tab broadcast when an admin starts/ends a meeting.
    const unsub = onDbChange({
      table: 'meetings',
      event: '*',
      onInsert: refreshMeeting,
      onUpdate: refreshMeeting,
      onDelete: refreshMeeting,
    })
    const onVis = () => { if (document.visibilityState === 'visible') refreshMeeting() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      listeners.delete(setSnapshot)
      stopTimerIfIdle()
      unsub()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return snapshot.meeting
}
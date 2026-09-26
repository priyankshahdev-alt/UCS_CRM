import { useCallback, useEffect, useRef, useState } from 'react';

// Work-based idle detection.
//
// Idle means no donor/call/disposition WORK for callIdleThreshold ms — NOT no
// raw input. Mouse movement / typing are deliberately ignored: only real work
// resets the clock, via resetCallActivity() on every genuine action (opening a
// donor, calling, saving a disposition...). Opening a donor view therefore
// grants a fresh 4-minute grace but does not suspend detection beyond that.
//
// Why this is hand-rolled instead of delegated to an idle-timer library: the
// previous version opened a streak only from react-idle-timer's onIdle
// callback, which the library gates on EVERY cross-tab registry token being
// idle AND on the caller being the elected leader. Tab tokens are cleared only
// by a destroy message sent from beforeunload/effect cleanup, so a tab that
// dies uncleanly (crash, force-close, browser or OS kill, sleep, tab discard)
// leaves a token behind forever and those gates can never pass again. With two
// tabs open the donor-record tab pins itself "active" while the FRO works the
// lead list, so idle simply stopped being counted — silently, with no error.
// Recorded idle fell from 670,696s to 6,369s per day. Detection below is a
// local clock instead: nothing external can suppress it.
//
// Multi-tab: every work action stamps a shared key. A tab that has been quiet
// for longer than OTHER_TAB_GRACE cannot claim idle, so a duplicate tab can
// neither invent idle while a real tab works nor double-book when nobody is
// active. Crucially the stamp is TIME-based — a tab that dies simply ages out
// of the grace window instead of blocking idle permanently.
//
// The hook interface is unchanged: { isCallIdle, callIdleSince, resetCallActivity }.
const ACTIVITY_KEY = 'ucs_fro_activity';
const CHECK_INTERVAL = 15 * 1000;
const BUSY_INTERVAL = 60 * 1000;
const OTHER_TAB_GRACE = 90 * 1000;

const stampActivity = () => {
  try { localStorage.setItem(ACTIVITY_KEY, String(Date.now())) } catch (_) {}
};

export function useActivityTracking(userId, options = {}) {
  const {
    callIdleThreshold = 4 * 60 * 1000, // 4 minutes without donor/call/disposition work
    onCallIdle,
    onCallResume,
    isExempt, // () => boolean — true while on a call, on break, in a meeting, or paused
  } = options;

  const [isCallIdle, setIsCallIdle] = useState(false);
  const [callIdleSince, setCallIdleSince] = useState(null); // ISO string
  const isCallIdleRef = useRef(false);

  // Callbacks live in a ref so the watchdog effect stays stable and always reads
  // fresh closures (isExempt closes over refs that change every render).
  const cbsRef = useRef({});
  cbsRef.current = { onCallIdle, onCallResume, isExempt };

  const lastWorkAtRef = useRef(Date.now());
  // Newest activity another open tab of this worker reported. 0 = none seen.
  const otherTabActiveAtRef = useRef(0);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const openIdle = useCallback((sinceIso) => {
    if (isCallIdleRef.current) return
    isCallIdleRef.current = true
    setIsCallIdle(true)
    setCallIdleSince(sinceIso)
    // Silent detection failures are what made this bug invisible for days, so
    // every streak opening is traceable in the panel console.
    console.debug('[fro-idle] streak opened', {
      worker: userIdRef.current,
      idle_since: sinceIso,
      quiet_for_s: Math.round((Date.now() - lastWorkAtRef.current) / 1000),
    })
    cbsRef.current.onCallIdle?.(sinceIso)
  }, [])

  const closeIdle = useCallback(() => {
    if (!isCallIdleRef.current) return
    isCallIdleRef.current = false
    setIsCallIdle(false)
    setCallIdleSince(null)
    cbsRef.current.onCallResume?.()
  }, [])

  // Donor/call work: restart the "no work" clock, announce the activity to the
  // other tabs of this worker, and close any open streak (any work ends idle).
  const resetCallActivity = useCallback(() => {
    lastWorkAtRef.current = Date.now()
    stampActivity()
    closeIdle()
  }, [closeIdle])

  // While this tab is NOT idle it re-stamps every minute, so a stale duplicate
  // tab cannot open a streak mid-call or while a single record stays open.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isCallIdleRef.current) stampActivity()
    }, BUSY_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  // Surface activity stamped by the OTHER tabs of this worker (fires only in the
  // other tabs — never in the tab that wrote the stamp).
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== ACTIVITY_KEY || e.newValue == null) return
      const t = Number(e.newValue)
      if (Number.isFinite(t) && t > otherTabActiveAtRef.current) otherTabActiveAtRef.current = t
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Watchdog: the single source of truth for opening a streak. Driven purely by
  // the local work clock, so no timer, socket or leader state can silently
  // suppress it. Checks immediately on mount and then every 15s.
  useEffect(() => {
    if (!userId) return undefined
    const checkCallIdle = () => {
      if (isCallIdleRef.current) return
      if (cbsRef.current.isExempt?.()) {
        closeIdle() // defensive: break/meeting/pause/call must never idle
        return
      }
      const now = Date.now()
      if (now - otherTabActiveAtRef.current < OTHER_TAB_GRACE) return
      if (now - lastWorkAtRef.current <= callIdleThreshold) return
      openIdle(new Date().toISOString())
    }
    checkCallIdle()
    const interval = setInterval(checkCallIdle, CHECK_INTERVAL)
    return () => clearInterval(interval)
  }, [userId, callIdleThreshold, openIdle, closeIdle])

  return {
    isCallIdle,
    callIdleSince,
    resetCallActivity,
  };
}

export default useActivityTracking;

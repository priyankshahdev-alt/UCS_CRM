// Single source of truth for "what time is it, really".
//
// Elapsed timers in this app are all computed as `now - <timestamp the server
// wrote>`. Using the device clock made the result depend on each user's own
// machine: a clock BEHIND the server produced a negative value that
// `Math.max(0, ...)` silently clamped to a permanent "00:00:00", and a clock
// AHEAD inflated it (e.g. "12:30:54"). A timezone setting alone cannot cause
// this — Date.now() is UTC-epoch — so it is device clock drift.
//
// The server stamps `server_now` on the payloads it sends. We turn that into an
// offset once and add it to the local clock, so every device shows the same
// elapsed time no matter how wrong its own clock is. Until the first sync we
// fall back to the device clock, which is the previous behaviour.

let offsetMs = 0
let synced = false
const listeners = new Set()

// A bogus/missing timestamp must never poison every timer on the page, so
// implausible offsets (and non-finite values) are rejected.
const MAX_PLAUSIBLE_OFFSET_MS = 18 * 60 * 60 * 1000 // 18h

/**
 * Sync the local clock against a server timestamp.
 * @param payload object carrying `server_now` (ISO-8601 with Z)
 * @param timing  optional { sentAt, receivedAt } Date.now() marks around the
 *                request, used to halve the network round-trip bias.
 */
export function syncFrom(payload, timing) {
  const raw = payload && typeof payload === 'object' ? payload.server_now : null
  if (!raw) return false

  const serverMs = Date.parse(raw)
  if (Number.isNaN(serverMs)) return false

  // Assume the server stamped its clock at the midpoint of the round trip.
  const localMs =
    timing && Number.isFinite(timing.sentAt) && Number.isFinite(timing.receivedAt)
      ? (timing.sentAt + timing.receivedAt) / 2
      : Date.now()

  const next = serverMs - localMs
  if (!Number.isFinite(next) || Math.abs(next) > MAX_PLAUSIBLE_OFFSET_MS) return false

  const changed = !synced || Math.abs(next - offsetMs) > 250
  offsetMs = next
  synced = true
  if (changed) for (const l of listeners) l(offsetMs)
  return true
}

export function isSynced() {
  return synced
}

/** How far this device's clock is from the server's, in ms. */
export function skewMs() {
  return synced ? offsetMs : 0
}

/** Current time on the server's clock, as best we can tell from this device. */
export function now() {
  return Date.now() + (synced ? offsetMs : 0)
}

export function onSync(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function reset() {
  offsetMs = 0
  synced = false
}

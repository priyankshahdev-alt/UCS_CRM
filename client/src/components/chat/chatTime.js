/**
 * Time formatting for chat.
 *
 * Every timestamp renders in IST (Asia/Kolkata) regardless of where the viewer's
 * browser thinks it is — a distributed team reading payroll messages should not
 * see two different clocks for the same message.
 */

export const CHAT_TZ = 'Asia/Kolkata'

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: CHAT_TZ,
})

const dayFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: CHAT_TZ,
})

const dayYearFmt = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: CHAT_TZ,
})

const partsFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: CHAT_TZ,
})

/** Calendar day in IST, as a comparable `YYYY-MM-DD` string. */
function istDayKey(value) {
  const d = typeof value === 'string' ? new Date(value) : value
  if (!d || Number.isNaN(d.getTime())) return ''
  // reduce accumulates an object keyed by part type, so it must be read as one.
  // Destructuring it as an array throws "object is not iterable".
  const parts = partsFmt.formatToParts(d).reduce((acc, p) => {
    if (p.type === 'year' || p.type === 'month' || p.type === 'day') acc[p.type] = p.value
    return acc
  }, {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

function daysBetweenIST(a, b) {
  const ka = istDayKey(a)
  const kb = istDayKey(b)
  if (!ka || !kb) return NaN
  const da = new Date(`${ka}T00:00:00Z`).getTime()
  const db = new Date(`${kb}T00:00:00Z`).getTime()
  return Math.round((db - da) / 86400000)
}

export function formatTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return timeFmt.format(d)
}

/** "Today" / "Yesterday" / "Mon, 12 Jan" / "12 Jan 2024" — separator labels. */
export function formatDayLabel(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diff = daysBetweenIST(d, new Date())
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const sameYear = istDayKey(d).slice(0, 4) === istDayKey(new Date()).slice(0, 4)
  return sameYear ? dayFmt.format(d) : dayYearFmt.format(d)
}

/** Compact stamp for conversation rows. */
export function formatListTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diff = daysBetweenIST(d, new Date())
  if (diff === 0) return timeFmt.format(d)
  if (diff === 1) return 'Yesterday'
  const sameYear = istDayKey(d).slice(0, 4) === istDayKey(new Date()).slice(0, 4)
  return sameYear ? dayFmt.format(d) : dayYearFmt.format(d)
}

/** true when the two stamps fall on the same IST calendar day. */
export function isSameDay(a, b) {
  return !!a && !!b && istDayKey(a) === istDayKey(b)
}

export function fullStamp(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${formatDayLabel(d)}, ${timeFmt.format(d)} IST`
}

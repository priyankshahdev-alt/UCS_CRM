import { daysLeft, todayObj } from './helpers'

const DISMISSED_KEY = 'reminder_dismissed'
const DISMISSED_DATE_KEY = 'reminder_dismissed_date'
const SNOOZE_KEY = 'reminder_snoozed'
const NOTIF_PERMISSION_KEY = 'reminder_notif_permission'

export function getDismissedSet() {
  try {
    const savedDate = localStorage.getItem(DISMISSED_DATE_KEY)
    const today = new Date().toDateString()
    if (savedDate !== today) {
      localStorage.removeItem(DISMISSED_KEY)
      localStorage.setItem(DISMISSED_DATE_KEY, today)
      return new Set()
    }
    const raw = localStorage.getItem(DISMISSED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

export function dismissAlarmKey(key) {
  const set = getDismissedSet()
  set.add(key)
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]))
}

export function isDismissed(key) {
  return getDismissedSet().has(key)
}

export function getSnoozedMap() {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function setSnoozed(key, minutes) {
  const map = getSnoozedMap()
  map[key] = Date.now() + minutes * 60 * 1000
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(map))
}

export function isSnoozed(key) {
  const map = getSnoozedMap()
  if (!map[key]) return false
  if (Date.now() > map[key]) {
    delete map[key]
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map))
    return false
  }
  return true
}

export function computeEffectiveDueDate(r) {
  if (r.due_date) {
    const d = daysLeft(r.due_date)
    if (d !== null) return r.due_date
  }

  const display = r.due_date_display || ''
  const freq = r.display_frequency || ''

  const dayMatch = display.match(/(\d{1,2})(?:st|nd|rd|th)/i)
  if (!dayMatch) return null
  const day = parseInt(dayMatch[1], 10)

  if (freq.includes('Month') && !freq.includes('Year')) {
    const intervalMatch = freq.match(/(\d+)\s*(?:Months?|Alternate)/i)
    const isAlternate = /alternate/i.test(freq)
    const interval = isAlternate ? 2 : (intervalMatch ? parseInt(intervalMatch[1], 10) : 1)

    const today = todayObj()
    for (let m = 0; m <= interval * 2; m++) {
      const candidate = new Date(today.getFullYear(), today.getMonth() + m, day)
      if (candidate >= today) {
        return candidate.toISOString().slice(0, 10)
      }
    }
  }

  if (freq.includes('Year') || freq.includes('Aug') || freq.includes('Dec') || freq.includes('Jun') || freq.includes('May') || freq.includes('Sept') || freq.includes('Feb') || freq.includes('Jan') || freq.includes('Mar') || freq.includes('Apr') || freq.includes('Jul') || freq.includes('Oct') || freq.includes('Nov')) {
    const monthMap = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sept: 8, sep: 8, oct: 9, nov: 10, dec: 11
    }
    let month = -1
    for (const [name, idx] of Object.entries(monthMap)) {
      if (display.toLowerCase().includes(name)) { month = idx; break }
    }

    const today = todayObj()
    if (month >= 0) {
      const thisYear = new Date(today.getFullYear(), month, day)
      if (thisYear >= today) return thisYear.toISOString().slice(0, 10)
      const nextYear = new Date(today.getFullYear() + 1, month, day)
      return nextYear.toISOString().slice(0, 10)
    }

    const thisYear = new Date(today.getFullYear(), today.getMonth(), day)
    if (thisYear >= today) return thisYear.toISOString().slice(0, 10)
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, day)
    return nextMonth.toISOString().slice(0, 10)
  }

  if (freq.includes('Month')) {
    const today = todayObj()
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, day)
    if (nextMonth >= today) return nextMonth.toISOString().slice(0, 10)
    const twoMonths = new Date(today.getFullYear(), today.getMonth() + 2, day)
    return twoMonths.toISOString().slice(0, 10)
  }

  return null
}

export function getAlarmType(r, threshold = 10) {
  const effectiveDate = computeEffectiveDueDate(r)
  if (!effectiveDate) return null

  const dl = daysLeft(effectiveDate)
  if (dl === null) return null

  if (dl < 0) return 'OVERDUE'
  if (dl === 0) return 'DUE_TODAY'
  if (dl > 0 && dl <= threshold) return 'DUE_SOON'
  return null
}

let audioCtx = null
let lastPlayTime = 0

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return audioCtx
}

export function playAlarmSound(type = 'due_soon') {
  try {
    const now = Date.now()
    if (now - lastPlayTime < 2000) return
    lastPlayTime = now

    const ctx = getAudioContext()
    if (ctx.state === 'suspended') ctx.resume()

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    if (type === 'OVERDUE') {
      osc.frequency.value = 880
      osc.type = 'square'
      gain.gain.value = 0.15
      osc.start()
      osc.stop(ctx.currentTime + 0.15)

      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.frequency.value = 660
      osc2.type = 'square'
      gain2.gain.value = 0.15
      osc2.start(ctx.currentTime + 0.2)
      osc2.stop(ctx.currentTime + 0.35)

      const osc3 = ctx.createOscillator()
      const gain3 = ctx.createGain()
      osc3.connect(gain3)
      gain3.connect(ctx.destination)
      osc3.frequency.value = 880
      osc3.type = 'square'
      gain3.gain.value = 0.15
      osc3.start(ctx.currentTime + 0.4)
      osc3.stop(ctx.currentTime + 0.55)
    } else if (type === 'DUE_TODAY') {
      osc.frequency.value = 800
      osc.type = 'sine'
      gain.gain.value = 0.2
      osc.start()
      osc.stop(ctx.currentTime + 0.2)

      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.frequency.value = 1000
      osc2.type = 'sine'
      gain2.gain.value = 0.2
      osc2.start(ctx.currentTime + 0.25)
      osc2.stop(ctx.currentTime + 0.45)
    } else {
      osc.frequency.value = 600
      osc.type = 'sine'
      gain.gain.value = 0.12
      osc.start()
      osc.stop(ctx.currentTime + 0.3)
    }
  } catch {}
}

export function requestNotificationPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export function sendBrowserNotification(title, body, tag) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: tag || `reminder-${Date.now()}`,
      requireInteraction: true,
    })
  } catch {}
}

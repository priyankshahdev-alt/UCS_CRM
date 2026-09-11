import { daysLeft, todayObj } from './helpers'

const DISMISSED_KEY = 'reminder_dismissed'
const DISMISSED_DATE_KEY = 'reminder_dismissed_date'
const SNOOZE_KEY = 'reminder_snoozed'

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

const MONTH_MAP = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sept: 8, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
}

function parseExactDate(text) {
  const t = text.toLowerCase().trim()
  const dayMatch = t.match(/(\d{1,2})(?:st|nd|rd|th)/)
  if (!dayMatch) return null
  const day = parseInt(dayMatch[1], 10)

  let month = -1
  for (const [name, idx] of Object.entries(MONTH_MAP)) {
    if (t.includes(name)) { month = idx; break }
  }
  if (month < 0) return null

  const yearMatch = t.match(/\b(20\d{2})\b/)
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10)
    return new Date(y, month, day).toISOString().slice(0, 10)
  }
  return null
}

export function computeEffectiveDueDate(r) {
  if (r.due_date) {
    const d = daysLeft(r.due_date)
    if (d !== null) return String(r.due_date).slice(0, 10)
  }

  const display = r.due_date_display || ''
  const freq = r.display_frequency || ''
  const dl = display.toLowerCase()

  if (!display || display === 'Paid by Tenant') return null

  const exactDate = parseExactDate(display)
  if (exactDate) {
    if (freq.toLowerCase().includes('every') && (freq.toLowerCase().includes('month') || freq.toLowerCase().includes('year'))) {
      const dayMatch = display.match(/(\d{1,2})(?:st|nd|rd|th)/)
      const day = dayMatch ? parseInt(dayMatch[1], 10) : 1
      let month = -1
      for (const [name, idx] of Object.entries(MONTH_MAP)) {
        if (dl.includes(name)) { month = idx; break }
      }

      if (freq.toLowerCase().includes('year') || month >= 0) {
        const today = todayObj()
        if (month >= 0) {
          const thisYear = new Date(today.getFullYear(), month, day)
          if (thisYear >= today) return thisYear.toISOString().slice(0, 10)
          return new Date(today.getFullYear() + 1, month, day).toISOString().slice(0, 10)
        }
        const thisYear = new Date(today.getFullYear(), today.getMonth(), day)
        if (thisYear >= today) return thisYear.toISOString().slice(0, 10)
        return new Date(today.getFullYear(), today.getMonth() + 1, day).toISOString().slice(0, 10)
      }

      if (freq.toLowerCase().includes('month')) {
        const isAlternate = /alternate/i.test(freq)
        const intervalMatch = freq.match(/(\d+)\s*(?:months?|alternate)/i)
        const interval = isAlternate ? 2 : (intervalMatch ? parseInt(intervalMatch[1], 10) : 1)
        const today = todayObj()
        for (let m = 0; m <= interval * 3; m++) {
          const candidate = new Date(today.getFullYear(), today.getMonth() + m, day)
          if (candidate >= today) return candidate.toISOString().slice(0, 10)
        }
      }
    }
    return exactDate
  }

  const dayMatch = display.match(/(\d{1,2})(?:st|nd|rd|th)/i)
  if (!dayMatch) {
    if (dl.includes('march') && freq.toLowerCase().includes('year')) {
      const today = todayObj()
      const thisYear = new Date(today.getFullYear(), 2, 1)
      if (thisYear >= today) return thisYear.toISOString().slice(0, 10)
      return new Date(today.getFullYear() + 1, 2, 1).toISOString().slice(0, 10)
    }
    return null
  }
  const day = parseInt(dayMatch[1], 10)

  if (freq.toLowerCase().includes('month') && !freq.toLowerCase().includes('year')) {
    const isAlternate = /alternate/i.test(freq)
    const intervalMatch = freq.match(/(\d+)\s*(?:months?|alternate)/i)
    const interval = isAlternate ? 2 : (intervalMatch ? parseInt(intervalMatch[1], 10) : 1)
    const today = todayObj()
    for (let m = 0; m <= interval * 3; m++) {
      const candidate = new Date(today.getFullYear(), today.getMonth() + m, day)
      if (candidate >= today) return candidate.toISOString().slice(0, 10)
    }
  }

  if (freq.toLowerCase().includes('year') || Object.keys(MONTH_MAP).some(n => dl.includes(n))) {
    let month = -1
    for (const [name, idx] of Object.entries(MONTH_MAP)) {
      if (dl.includes(name)) { month = idx; break }
    }
    const today = todayObj()
    if (month >= 0) {
      const thisYear = new Date(today.getFullYear(), month, day)
      if (thisYear >= today) return thisYear.toISOString().slice(0, 10)
      return new Date(today.getFullYear() + 1, month, day).toISOString().slice(0, 10)
    }
    const thisYear = new Date(today.getFullYear(), today.getMonth(), day)
    if (thisYear >= today) return thisYear.toISOString().slice(0, 10)
    return new Date(today.getFullYear(), today.getMonth() + 1, day).toISOString().slice(0, 10)
  }

  if (freq.toLowerCase().includes('month')) {
    const today = todayObj()
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, day)
    if (nextMonth >= today) return nextMonth.toISOString().slice(0, 10)
    return new Date(today.getFullYear(), today.getMonth() + 2, day).toISOString().slice(0, 10)
  }

  return null
}

export function computeCurrentMonthDate(r) {
  if (r.due_date) {
    const d = daysLeft(r.due_date)
    if (d !== null) return String(r.due_date).slice(0, 10)
  }

  const display = r.due_date_display || ''
  const freq = r.display_frequency || ''
  const dl = display.toLowerCase()

  if (!display || display === 'Paid by Tenant') return null

  const dayMatch = display.match(/(\d{1,2})(?:st|nd|rd|th)/i)
  if (!dayMatch) {
    if (dl.includes('march') && freq.toLowerCase().includes('year')) {
      const today = todayObj()
      return new Date(today.getFullYear(), 2, 1).toISOString().slice(0, 10)
    }
    return null
  }
  const day = parseInt(dayMatch[1], 10)
  const today = todayObj()

  let month = -1
  for (const [name, idx] of Object.entries(MONTH_MAP)) {
    if (dl.includes(name)) { month = idx; break }
  }

  if (freq.toLowerCase().includes('year') || month >= 0) {
    if (month >= 0) {
      return new Date(today.getFullYear(), month, day).toISOString().slice(0, 10)
    }
    return new Date(today.getFullYear(), today.getMonth(), day).toISOString().slice(0, 10)
  }

  if (freq.toLowerCase().includes('month')) {
    const isAlternate = /alternate/i.test(freq)
    const intervalMatch = freq.match(/(\d+)\s*(?:months?|alternate)/i)
    const interval = isAlternate ? 2 : (intervalMatch ? parseInt(intervalMatch[1], 10) : 1)
    if (interval === 1) {
      return new Date(today.getFullYear(), today.getMonth(), day).toISOString().slice(0, 10)
    }
    const monthsSinceEpoch = today.getFullYear() * 12 + today.getMonth()
    if (monthsSinceEpoch % interval === 0) {
      return new Date(today.getFullYear(), today.getMonth(), day).toISOString().slice(0, 10)
    }
    for (let m = 1; m <= interval; m++) {
      const candidate = new Date(today.getFullYear(), today.getMonth() + m, day)
      const candMonths = candidate.getFullYear() * 12 + candidate.getMonth()
      if (candMonths % interval === 0) {
        return candidate.toISOString().slice(0, 10)
      }
    }
    return new Date(today.getFullYear(), today.getMonth(), day).toISOString().slice(0, 10)
  }

  const exactDate = parseExactDate(display)
  if (exactDate) {
    const ed = new Date(exactDate + 'T00:00:00')
    if (ed.getMonth() === today.getMonth() && ed.getFullYear() === today.getFullYear()) {
      return exactDate
    }
    return null
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
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => playSound(ctx, type))
    } else {
      playSound(ctx, type)
    }
  } catch {}
}

function playSound(ctx, type) {
  try {
    if (type === 'OVERDUE') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      osc.type = 'square'
      gain.gain.value = 0.3
      osc.start()
      osc.stop(ctx.currentTime + 0.15)

      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.frequency.value = 660
      osc2.type = 'square'
      gain2.gain.value = 0.3
      osc2.start(ctx.currentTime + 0.2)
      osc2.stop(ctx.currentTime + 0.35)

      const osc3 = ctx.createOscillator()
      const gain3 = ctx.createGain()
      osc3.connect(gain3)
      gain3.connect(ctx.destination)
      osc3.frequency.value = 880
      osc3.type = 'square'
      gain3.gain.value = 0.3
      osc3.start(ctx.currentTime + 0.4)
      osc3.stop(ctx.currentTime + 0.55)
    } else if (type === 'DUE_TODAY') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 800
      osc.type = 'sine'
      gain.gain.value = 0.4
      osc.start()
      osc.stop(ctx.currentTime + 0.2)

      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.frequency.value = 1000
      osc2.type = 'sine'
      gain2.gain.value = 0.4
      osc2.start(ctx.currentTime + 0.25)
      osc2.stop(ctx.currentTime + 0.45)
    } else {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 600
      osc.type = 'sine'
      gain.gain.value = 0.3
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

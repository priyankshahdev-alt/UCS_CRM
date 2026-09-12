import { useMemo, useEffect, useState, useCallback } from 'react'
import { useRem } from './store'
import { computeEffectiveDueDate } from './notifications'
import { daysLeft, categoryLabel } from './helpers'

const WINDOW_DAYS = 7
const DISMISS_KEY = 'ucs_banner_dismissed'
const MAX_STORED_SIGS = 20

function getDismissedSignatures() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return Array.isArray(parsed.sigs) ? parsed.sigs : []
  } catch { return [] }
}

function saveDismissedSignatures(sigs) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ sigs: sigs.slice(-MAX_STORED_SIGS) }))
  } catch { /* ignore */ }
}

export function isPaid(r) {
  if (r.status === 'Completed' || r.completed_at) return true
  if (r.due_date_display && String(r.due_date_display).includes('Paid by Tenant')) return true
  if (r.notes && String(r.notes).includes('Paid by Tenant')) return true
  return false
}

const PRIORITY = { overdue: 0, today: 1, tomorrow: 2, soon: 3 }

export function usePaymentReminders(windowDays = WINDOW_DAYS) {
  const { reminders } = useRem()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const result = useMemo(() => {
    const items = []
    for (const r of reminders) {
      if (r.is_deleted) continue
      if (isPaid(r)) continue
      const eff = computeEffectiveDueDate(r)
      if (!eff) continue
      const dl = daysLeft(eff)
      if (dl === null) continue
      let bucket = null
      if (dl < 0) bucket = 'overdue'
      else if (dl === 0) bucket = 'today'
      else if (dl === 1) bucket = 'tomorrow'
      else if (dl <= windowDays) bucket = 'soon'
      if (!bucket) continue
      items.push({ r, dl, eff, bucket, priority: PRIORITY[bucket] })
    }
    items.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      if (a.dl !== b.dl) return a.dl - b.dl
      return String(a.r.title || '').localeCompare(String(b.r.title || ''))
    })

    const labels = []
    for (const it of items) {
      const label = categoryLabel(it.r.category)
      if (!labels.includes(label)) labels.push(label)
    }
    const shown = labels.slice(0, 3)
    const nearestLabels = labels.length > 3 ? [...shown, `+${labels.length - 3} more`] : shown

    const signature = items.map(i => `${String(i.r.id)}:${i.bucket}`).join('|')

    return {
      items,
      count: items.length,
      overdueCount: items.filter(i => i.bucket === 'overdue').length,
      dueTodayCount: items.filter(i => i.bucket === 'today').length,
      dueSoonCount: items.filter(i => i.bucket === 'soon' || i.bucket === 'tomorrow').length,
      nearestLabels,
      signature,
    }
  }, [reminders, now, windowDays])

  const [dismissed, setDismissed] = useState(() => getDismissedSignatures().includes(result.signature))

  useEffect(() => {
    setDismissed(getDismissedSignatures().includes(result.signature))
  }, [result.signature])

  const dismiss = useCallback(() => {
    const sigs = getDismissedSignatures()
    if (!sigs.includes(result.signature)) {
      saveDismissedSignatures([...sigs, result.signature])
    }
    setDismissed(true)
  }, [result.signature])

  return { ...result, dismissed, dismiss }
}
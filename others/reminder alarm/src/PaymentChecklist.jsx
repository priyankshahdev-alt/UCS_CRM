import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRem } from './store'
import { computeEffectiveDueDate } from './notifications'
import { daysLeft, categoryLabel, categoryIcon } from './helpers'
import { isPaid, usePaymentReminders } from './PaymentReminderBanner'
import { Icon } from './components'

const TOPN = 5

const CAT_COLORS = {
  PROPERTY_MAINTENANCE: '#2563eb',
  BMC_TAX: '#16a34a',
  RENT_TDS: '#2563eb',
  INSURANCE: '#7c3aed',
  MEDICAL_EXPENSES: '#7c3aed',
  EDUCATION: '#0891b2',
  VI_BILL: '#4f46e5',
  WEBSITE_DOMAIN: '#ea580c',
  VEHICLE_INSURANCE: '#dc2626',
  ELECTRICITY: '#d97706',
  OTHER_BILL: '#475569',
}

const PRIORITY = {
  overdue: 0,
  today: 1,
  tomorrow: 2,
  week: 3,
  month: 4,
  future: 5,
  none: 6,
}

function groupOf(dl) {
  if (dl === null) return 'none'
  if (dl < 0) return 'overdue'
  if (dl === 0) return 'today'
  if (dl === 1) return 'tomorrow'
  if (dl <= 7) return 'week'
  if (dl <= 30) return 'month'
  return 'future'
}

function statusLabel(group, dl) {
  switch (group) {
    case 'overdue': return 'Overdue'
    case 'today': return 'Due today'
    case 'tomorrow': return 'Due tomorrow'
    case 'week': return `Due in ${dl} days`
    case 'month': return `Due in ${dl} days`
    case 'future': {
      const months = Math.max(1, Math.ceil(dl / 30))
      return `Due in ${months} month${months > 1 ? 's' : ''}`
    }
    default: return 'No due date'
  }
}

function parseAmount(r) {
  if (r.amount) {
    const n = Number(r.amount)
    if (!isNaN(n) && n > 0) return n
  }
  const match = String(r.notes || '').match(/Rs\.?\s*([\d,]+)/i)
  if (!match) return null
  const cleaned = match[1].replace(/,/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

export function formatINR(num) {
  if (num === null || num === undefined || isNaN(num)) return '—'
  return '₹' + Math.round(num).toLocaleString('en-IN')
}

export function useChecklist(query = '') {
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
      const dl = eff ? daysLeft(eff) : null
      const group = groupOf(dl)
      const amount = parseAmount(r)
      items.push({
        r,
        eff,
        dl,
        group,
        priority: PRIORITY[group],
        amount,
        label: categoryLabel(r.category),
        icon: categoryIcon(r.category),
        color: CAT_COLORS[r.category] || '#475569',
      })
    }

    items.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      const da = a.dl === null ? Infinity : a.dl
      const db = b.dl === null ? Infinity : b.dl
      if (da !== db) return da - db
      return String(a.r.title || '').localeCompare(String(b.r.title || ''))
    })

    const q = String(query || '').trim().toLowerCase()
    let filtered = items
    if (q) {
      filtered = items.filter(it => {
        const r = it.r
        return [
          r.title, r.owner, it.label, r.category,
          r.due_date_display, r.renewal_date_display,
          r.notes, r.description, r.display_frequency,
        ].some(v => v && String(v).toLowerCase().includes(q))
      })
    }

    return { items: filtered, count: items.length }
  }, [reminders, now, query])

  return result
}

export function PaymentChecklistItem({ item, onClickRow }) {
  const { r, dl, group, amount, label, icon, color } = item
  return (
    <div className="cl-item" role="button" tabIndex={0} onClick={() => onClickRow?.(r)} onKeyDown={e => { if (e.key === 'Enter') onClickRow?.(r) }}>
      <div className="cl-item-icon" style={{ backgroundColor: `${color}1f`, color }}>
        <Icon name={icon} size={17} />
      </div>
      <div className="cl-item-body">
        <div className="cl-item-name">{r.title || '—'}</div>
        <div className="cl-item-meta">
          <span>{label} • {r.owner || '—'}</span>
          <span className="cl-item-amount">{formatINR(amount)}</span>
        </div>
        <div className="cl-item-foot">
          <span className={`cl-badge cl-badge-${group}`}>{statusLabel(group, dl)}</span>
        </div>
      </div>
    </div>
  )
}

export default function PaymentChecklist() {
  const navigate = useNavigate()
  const { setActiveFilter } = useRem()
  const [query, setQuery] = useState('')
  const { items, count } = useChecklist(query)
  const { count: attentionCount, overdueCount, nearestLabels, dismissed, dismiss } = usePaymentReminders()

  const goViewAll = () => { navigate('/rem') }

  const goRow = (r) => {
    setActiveFilter(r.category || '')
    navigate('/rem')
  }

  const attentionTitle =
    attentionCount === 0 ? ''
      : overdueCount > 0 && overdueCount === attentionCount
        ? `${attentionCount} overdue payment${attentionCount > 1 ? 's' : ''}`
        : `${attentionCount} payment${attentionCount > 1 ? 's' : ''} due soon`

  return (
    <>
      {attentionCount > 0 && !dismissed && (
        <div className="cl-attention full">
          <Icon name="alert" size={15} />
          <span className="cl-attention-text">
            <span className="cl-attention-title">{attentionTitle}</span>
            <span className="cl-attention-near">Nearest: {nearestLabels.join(', ')}</span>
          </span>
          <button className="cl-attention-dismiss" onClick={dismiss}>Dismiss</button>
        </div>
      )}
      <div className="cl-wrap">
      <section className="dash-section cl-card" aria-label="Your checklist">
      <div className="cl-head">
        <h3 className="cl-title">Your checklist <span className="cl-count">{count}</span></h3>
      </div>
      <div className="cl-search">
        <svg className="cl-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="cl-search-input"
          placeholder="Search payments, properties, categories…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {query && (
          <button className="cl-search-clear" onClick={() => setQuery('')} title="Clear search">×</button>
        )}
      </div>
      <div className="cl-list">
        {items.length === 0 ? (
          <div className="cl-empty">
            {count === 0 ? 'No payments need attention right now.' : 'No results match your search.'}
          </div>
        ) : items.slice(0, TOPN).map((item) => (
          <PaymentChecklistItem key={item.r.id} item={item} onClickRow={goRow} />
        ))}
      </div>
      {items.length > TOPN && (
        <button className="cl-viewall" onClick={goViewAll}>View all <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
      )}
    </section>
    </div>
    </>
  )
}
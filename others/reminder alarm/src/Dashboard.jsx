import { useMemo, useState } from 'react'
import { useRem, useUcs } from './store'
import { Icon } from './components'
import { CATEGORIES, categoryLabel, categoryIcon, formatDate, daysLeft, statusPillClass } from './helpers'
import { computeEffectiveDueDate, computeCurrentMonthDate } from './notifications'
import PaymentChecklist from './PaymentChecklist'
import BillChart from './BillChart'
import { AddBillModal } from './modals'
import './dashboard.css'

const RENEWAL_CATEGORIES = new Set(['INSURANCE', 'MEDICAL_EXPENSES', 'EDUCATION', 'WEBSITE_DOMAIN', 'VEHICLE_INSURANCE'])

const OWNER_COLORS = {
  'Priyank Shah': '#2563eb',
  'Shweta Shah': '#7c3aed',
  'BSCT': '#0891b2',
  'AFLF': '#16a34a',
  'MANN': '#d97706',
  'Suraj Patil': '#dc2626',
  'Anjana Vyas': '#ec4899',
  'Naresh Bhanushali': '#6366f1',
}

const GROUP_MAP = {
  'PROPERTY_MAINTENANCE': 'Home',
  'BMC_TAX': 'Home',
  'ELECTRICITY': 'Home',
  'RENT_TDS': 'Office',
  'INSURANCE': 'Insurance',
  'MEDICAL_EXPENSES': 'Insurance',
  'VEHICLE_INSURANCE': 'Vehicles',
  'EDUCATION': 'Education',
  'WEBSITE_DOMAIN': 'Subscriptions',
  'VI_BILL': 'Subscriptions',
  'OTHER_BILL': 'Subscriptions',
}

const GROUP_ICONS = { Home: 'home', Office: 'file', Vehicles: 'car', Insurance: 'shield', Education: 'book', Subscriptions: 'globe' }
const GROUP_COLORS = { Home: '#2563eb', Office: '#0891b2', Vehicles: '#dc2626', Insurance: '#7c3aed', Education: '#16a34a', Subscriptions: '#d97706' }

const CATEGORY_SECTIONS = [
  {
    title: 'RECHARGE',
    heading: { col: 1, span: 2, row: 1 },
    tiles: [
      { key: 'MOBILE_RECHARGE', label: 'Mobile Recharge', icon: 'zap', col: 1, row: 2, match: r => /mobile/i.test(String(r.title || '')) },
      { key: 'FASTAG_RECHARGE', label: 'Fastag Recharge', icon: 'car', col: 2, row: 2, match: r => /fastag|MH13EK9999/i.test(String(r.title || '')) },
    ],
  },
  {
    title: 'Utility Bills',
    heading: { col: 3, span: 4, row: 1 },
    tiles: [
      { key: 'ELECTRICITY', label: 'Electricity Bills', icon: 'zap', col: 3, row: 2, match: r => r.category === 'ELECTRICITY' },
      { key: 'BROADBAND', label: 'Broadband', icon: 'wifi', col: 4, row: 2, match: r => r.category === 'OTHER_BILL' && /internet/i.test(String(r.title || '')) },
      { key: 'GAS_PIPELINE', label: 'Gas Pipeline', icon: 'home', col: 5, row: 2, match: r => r.category === 'OTHER_BILL' && /\(Flat No\. 401\)|\(Priyank Sir\)/i.test(String(r.title || '')) },
      { key: 'EDUCATION', label: 'Education', icon: 'book', col: 6, row: 2, match: r => r.category === 'EDUCATION' },
    ],
  },
  {
    title: 'Property & Tax',
    heading: { col: 7, span: 2, row: 1 },
    tiles: [
      { key: 'PROPERTY_MAINTENANCE', label: 'Property & Tax', icon: 'home', col: 7, row: 2, match: r => r.category === 'PROPERTY_MAINTENANCE' },
      { key: 'BMC_TAX', label: 'BMC Tax', icon: 'file', col: 8, row: 2, match: r => r.category === 'BMC_TAX' },
    ],
  },
  {
    title: 'Rent & TDS',
    heading: { col: 9, span: 2, row: 1 },
    tiles: [
      { key: 'RENT', label: 'Rent', icon: 'money', col: 9, row: 2, match: r => r.category === 'RENT_TDS' && !/tds/i.test(String(r.title || '')) && (/rent/i.test(String(r.title || '')) || String(r.title || '') === 'Raj Cresent (Priyank Sir)') },
      { key: 'TDS', label: 'TDS', icon: 'file', col: 10, row: 2, match: r => r.category === 'RENT_TDS' && /tds/i.test(String(r.title || '')) },
    ],
  },
  {
    title: 'Finance & Tax',
    heading: { col: 1, span: 7, row: 3 },
    tiles: [
      { key: 'LIC_INSURANCE', label: 'LIC/Insurance', icon: 'shield', col: 1, row: 4, match: r => r.category === 'INSURANCE' && !/mediclaim/i.test(String(r.title || '')) },
      { key: 'MEDICLAIM', label: 'Mediclaim', icon: 'file', col: 2, row: 4, match: r => r.category === 'INSURANCE' && /mediclaim/i.test(String(r.title || '')) },
      { key: 'LOAN_EMI', label: 'Loan/EMI', icon: 'money', col: 3, row: 4, match: r => r.category === 'OTHER_BILL' && /loan emi/i.test(String(r.title || '')) },
      { key: 'CREDIT_CARD', label: 'Credit Card', icon: 'money', col: 4, row: 4, match: r => r.category === 'OTHER_BILL' && /credit card/i.test(String(r.title || '')) },
      { key: 'ADVANCE_TAX', label: 'Advance Tax', icon: 'file', col: 5, row: 4, match: r => r.category === 'OTHER_BILL' && String(r.title || '') === 'Advance Tax' },
      { key: 'LEGAL_FEES', label: 'Legal Fees', icon: 'file', col: 6, row: 4, match: r => r.category === 'OTHER_BILL' && String(r.title || '') === 'Accounts and Audit Fees' },
      { key: 'INCOME_TAX', label: 'Income Tax', icon: 'file', col: 7, row: 4, match: r => r.category === 'OTHER_BILL' && String(r.title || '') === 'Income Tax' },
    ],
  },
]

const CATEGORY_TILE_COLORS = {
  PROPERTY_MAINTENANCE: { bg: '#eff6ff', border: '#93c5fd', iconBg: '#dbeafe', color: '#2563eb' },
  BMC_TAX: { bg: '#f0fdf4', border: '#86efac', iconBg: '#dcfce7', color: '#16a34a' },
  RENT: { bg: '#fffbeb', border: '#fcd34d', iconBg: '#fef3c7', color: '#d97706' },
  TDS: { bg: '#f8fafc', border: '#cbd5e1', iconBg: '#e2e8f0', color: '#475569' },
  LIC_INSURANCE: { bg: '#f5f3ff', border: '#ddd6fe', iconBg: '#ede9fe', color: '#7c3aed' },
  MEDICLAIM: { bg: '#fef2f2', border: '#fca5a5', iconBg: '#fee2e2', color: '#dc2626' },
  LOAN_EMI: { bg: '#fff7ed', border: '#fdba74', iconBg: '#ffedd5', color: '#ea580c' },
  CREDIT_CARD: { bg: '#ecfeff', border: '#67e8f9', iconBg: '#cffafe', color: '#0891b2' },
  ADVANCE_TAX: { bg: '#f8fafc', border: '#e2e8f0', iconBg: '#e2e8f0', color: '#475569' },
  LEGAL_FEES: { bg: '#fefce8', border: '#fde047', iconBg: '#fef9c3', color: '#ca8a04' },
  INCOME_TAX: { bg: '#eff6ff', border: '#93c5fd', iconBg: '#dbeafe', color: '#2563eb' },
  RENT_TDS: { bg: '#fffbeb', border: '#fcd34d', iconBg: '#fef3c7', color: '#d97706' },
  INSURANCE: { bg: '#fef2f2', border: '#fca5a5', iconBg: '#fee2e2', color: '#dc2626' },
  EDUCATION: { bg: '#ecfeff', border: '#67e8f9', iconBg: '#cffafe', color: '#0891b2' },
  VI_BILL: { bg: '#eef2ff', border: '#a5b4fc', iconBg: '#e0e7ff', color: '#4f46e5' },
  WEBSITE_DOMAIN: { bg: '#fff7ed', border: '#fdba74', iconBg: '#ffedd5', color: '#ea580c' },
  VEHICLE_INSURANCE: { bg: '#fefce8', border: '#fde047', iconBg: '#fef9c3', color: '#ca8a04' },
  ELECTRICITY: { bg: '#f0fdfa', border: '#5eead4', iconBg: '#ccfbf1', color: '#0d9488' },
  OTHER_BILL: { bg: '#f8fafc', border: '#e2e8f0', iconBg: '#e2e8f0', color: '#475569' },
  MOBILE_RECHARGE: { bg: '#ecfeff', border: '#67e8f9', iconBg: '#cffafe', color: '#0891b2' },
  FASTAG_RECHARGE: { bg: '#fefce8', border: '#fde047', iconBg: '#fef9c3', color: '#ca8a04' },
  BROADBAND: { bg: '#fdf4ff', border: '#e9d5ff', iconBg: '#fae8ff', color: '#a21caf' },
  GAS_PIPELINE: { bg: '#fff7ed', border: '#fdba74', iconBg: '#ffedd5', color: '#ea580c' },
}

const TILE_STATUSES = [
  { key: 'overdue', label: 'Overdue', color: '#dc2626', soft: '#fee2e2' },
  { key: 'dueToday', label: 'Due Today', color: '#ea580c', soft: '#ffedd5' },
  { key: 'upcoming', label: 'Upcoming', color: '#2563eb', soft: '#dbeafe' },
  { key: 'paidToday', label: 'Paid', color: '#16a34a', soft: '#dcfce7' },
]

function parseAmountFromNotes(notes) {
  if (!notes) return 0
  const match = String(notes).match(/Rs\.?\s*([\d,]+)/i)
  if (!match) return 0
  const cleaned = match[1].replace(/,/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function formatCurrency(num) {
  if (!num) return '₹0'
  return '₹' + num.toLocaleString('en-IN')
}

function compactAmount(num) {
  if (!num) return ''
  if (num >= 10000000) return '₹' + parseFloat((num / 10000000).toFixed(1)) + 'Cr'
  if (num >= 100000) return '₹' + parseFloat((num / 100000).toFixed(1)) + 'L'
  if (num >= 1000) return '₹' + parseFloat((num / 1000).toFixed(1)) + 'k'
  return '₹' + Math.round(num).toLocaleString('en-IN')
}

function isSameDay(a, b) {
  const d = a ? new Date(a) : null
  if (!d) return false
  return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate()
}

function getDueStatus(r) {
  if (r.status === 'Completed' || r.completed_at) return 'Paid'
  if (r.due_date_display && String(r.due_date_display).includes('Paid by Tenant')) return 'Paid'
  if (r.notes && String(r.notes).includes('Paid by Tenant')) return 'Paid'
  const effectiveDate = computeEffectiveDueDate(r)
  const dl = effectiveDate ? daysLeft(effectiveDate) : daysLeft(r.due_date)
  if (dl === null) return 'Pending'
  if (dl < 0) return 'Overdue'
  if (dl === 0) return 'Due Today'
  if (dl <= 7) return 'Due Soon'
  return 'Upcoming'
}

function getRenewalType(r) {
  if (r.category === 'VEHICLE_INSURANCE') return 'Vehicle'
  if (r.category === 'INSURANCE' || r.category === 'MEDICAL_EXPENSES') return 'Insurance'
  if (r.category === 'WEBSITE_DOMAIN' || r.category === 'OTHER_BILL') return 'Website/Domain'
  if (r.category === 'EDUCATION') return 'Education'
  return 'Other'
}

export default function Dashboard() {
  const { reminders, refresh } = useRem()

  const [billOpen, setBillOpen] = useState(false)

  const [calMonth, setCalMonth] = useState(() => new Date().getMonth())
  const [calYear, setCalYear] = useState(() => new Date().getFullYear())
  const [calDay, setCalDay] = useState(null)
  const [upcomingTab, setUpcomingTab] = useState('7days')
  const [upDay, setUpDay] = useState(null)
  const [upShowAll, setUpShowAll] = useState(false)
  const [catModalKey, setCatModalKey] = useState(null)

  const active = useMemo(() => reminders.filter(r => !r.is_deleted), [reminders])

  const enriched = useMemo(() => {
    return active.map(r => {
      const dueStatus = getDueStatus(r)
      const amount = r.amount ? Number(r.amount) : parseAmountFromNotes(r.notes)
      const effectiveDate = computeEffectiveDueDate(r)
      const dl = effectiveDate ? daysLeft(effectiveDate) : daysLeft(r.due_date)
      const isRenewal = RENEWAL_CATEGORIES.has(r.category) || !!r.renewal_date
      const group = GROUP_MAP[r.category] || 'Other'
      return { ...r, _dueStatus: dueStatus, _amount: amount, _daysLeft: dl, _isRenewal: isRenewal, _group: group, _effectiveDate: effectiveDate }
    })
  }, [active])

  const filtered = enriched

  const summary = useMemo(() => {
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    let dueToday = 0, overdue = 0, dueIn7 = 0, dueIn30 = 0, pending = 0, renewals = 0, thisMonth = 0, paidThisMonth = 0
    let dueTodayAmt = 0, overdueAmt = 0, dueIn7Amt = 0, dueIn30Amt = 0, thisMonthAmt = 0, paidThisMonthAmt = 0
    let monthlyObligations = 0, monthlyPaid = 0, monthlyPending = 0, monthlyOverdue = 0
    for (const r of filtered) {
      const st = r._dueStatus
      const dl = r._daysLeft
      const amt = r._amount || 0

      const effectiveDate = r._effectiveDate
      const currentMonthDate = computeCurrentMonthDate(r)
      if (currentMonthDate) {
        const ed = new Date(currentMonthDate + 'T00:00:00')
        const edMonth = ed.getMonth()
        const edYear = ed.getFullYear()
        if (edMonth === currentMonth && edYear === currentYear) {
          monthlyObligations += amt
          if (st === 'Paid') monthlyPaid += amt
          else if (ed < now) monthlyOverdue += amt
          else monthlyPending += amt
        }
      }

      if (st === 'Paid') { paidThisMonth++; paidThisMonthAmt += amt; continue }
      if (dl === 0) { dueToday++; dueTodayAmt += amt }
      if (dl !== null && dl < 0) { overdue++; overdueAmt += amt }
      if (dl !== null && dl > 0 && dl <= 7) { dueIn7++; dueIn7Amt += amt }
      if (dl !== null && dl > 0 && dl <= 30) { dueIn30++; dueIn30Amt += amt }
      if (st === 'Pending') pending++
      if (st !== 'Paid') { thisMonth++; thisMonthAmt += amt }
      if (r.renewal_date) {
        const renewal = new Date(String(r.renewal_date).slice(0, 10) + 'T00:00:00')
        if (renewal.getMonth() === currentMonth && renewal.getFullYear() === currentYear) renewals++
      }
    }
    return { dueToday, overdue, dueIn7, dueIn30, pending, renewals, thisMonth, paidThisMonth, dueTodayAmt, overdueAmt, dueIn7Amt, dueIn30Amt, thisMonthAmt, paidThisMonthAmt, monthlyObligations, monthlyPaid, monthlyPending, monthlyOverdue }
  }, [filtered])

  const upPeriodItems = useMemo(() => {
    const days = upcomingTab === '7days' ? 7 : upcomingTab === '30days' ? 30 : 365
    return filtered
      .filter(r => r._dueStatus !== 'Paid' && r._daysLeft !== null && r._daysLeft > 0 && r._daysLeft <= days)
      .sort((a, b) => a._daysLeft - b._daysLeft)
  }, [filtered, upcomingTab])

  const upDaysTotal = useMemo(() => upPeriodItems.reduce((s, r) => s + (r._amount || 0), 0), [upPeriodItems])

  const upGroups = useMemo(() => {
    const map = new Map()
    for (const r of upPeriodItems) {
      const key = categoryLabel(r.category) || r.category || 'Other'
      if (!map.has(key)) map.set(key, { key, count: 0, owners: new Set(), total: 0, minDays: null, minDate: null, category: r.category })
      const g = map.get(key)
      g.count += 1
      if (r.owner) g.owners.add(r.owner)
      g.total += r._amount || 0
      if (g.minDays === null || r._daysLeft < g.minDays) {
        g.minDays = r._daysLeft
        g.minDate = r._effectiveDate || null
      }
    }
    return [...map.values()]
      .map(g => ({ key: g.key, count: g.count, owners: [...g.owners], total: g.total, minDays: g.minDays, minDate: g.minDate, category: g.category }))
      .sort((a, b) => a.minDays - b.minDays)
  }, [upPeriodItems])

  const renewalTracker = useMemo(() => {
    return filtered
      .filter(r => r._isRenewal && r._dueStatus !== 'Paid' && r._effectiveDate)
      .sort((a, b) => {
        const da = new Date(a._effectiveDate + 'T00:00:00')
        const db = new Date(b._effectiveDate + 'T00:00:00')
        return da - db
      })
      .slice(0, 10)
  }, [filtered])

  const calDays = useMemo(() => {
    const first = new Date(calYear, calMonth, 1)
    const last = new Date(calYear, calMonth + 1, 0)
    const startDay = first.getDay()
    const totalDays = last.getDate()
    const cells = []
    for (let i = 0; i < startDay; i++) {
      const d = new Date(calYear, calMonth, -startDay + i + 1)
      cells.push({ day: d.getDate(), date: d, otherMonth: true })
    }
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(calYear, calMonth, d)
      cells.push({ day: d, date, otherMonth: false })
    }
    const totalCells = Math.ceil(cells.length / 7) * 7
    const remaining = totalCells - cells.length
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(calYear, calMonth + 1, i)
      cells.push({ day: i, date: d, otherMonth: true })
    }
    return cells
  }, [calMonth, calYear])

  const calEvents = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      const ed = r._effectiveDate
      if (ed) {
        if (!map[ed]) map[ed] = []
        map[ed].push(r)
      }
    }
    return map
  }, [filtered])

  const calDayItems = useMemo(() => {
    if (!calDay) return []
    const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(calDay).padStart(2, '0')}`
    return calEvents[ds] || []
  }, [calDay, calMonth, calYear, calEvents])

  const today = new Date()
  const isToday = (day) => day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()
  const calTotal = useMemo(() => calDayItems.reduce((s, r) => s + (r._amount || 0), 0), [calDayItems])

  function getCalDots(date) {
    const ds = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const items = calEvents[ds] || []
    if (!items.length) return []
    const dots = []
    if (items.some(r => r._dueStatus === 'Overdue')) dots.push('red')
    if (items.some(r => r._dueStatus === 'Due Today')) dots.push('yellow')
    if (items.some(r => r._dueStatus === 'Due Soon')) dots.push('blue')
    if (items.some(r => r._dueStatus === 'Upcoming')) dots.push('blue')
    if (items.some(r => r._dueStatus === 'Paid')) dots.push('green')
    return [...new Set(dots)].slice(0, 3)
  }

  const summaryCards = [
    { key: 'dueToday', label: 'Due Today', icon: 'alarm', color: '#d97706', bg: '#fffbeb', num: summary.dueToday, amt: summary.dueTodayAmt },
    { key: 'overdue', label: 'Overdue', icon: 'alert', color: '#dc2626', bg: '#fef2f2', num: summary.overdue, amt: summary.overdueAmt },
    { key: 'dueIn7', label: 'Due in 7 Days', icon: 'clock', color: '#0891b2', bg: '#ecfeff', num: summary.dueIn7, amt: summary.dueIn7Amt },
    { key: 'dueIn30', label: 'Due in 30 Days', icon: 'clock', color: '#6366f1', bg: '#eef2ff', num: summary.dueIn30, amt: summary.dueIn30Amt },
    { key: 'pending', label: 'Pending', icon: 'file', color: '#d97706', bg: '#fffbeb', num: summary.pending, amt: 0 },
    { key: 'renewals', label: 'Renewals', icon: 'history', color: '#7c3aed', bg: '#f5f3ff', num: summary.renewals, amt: 0 },
    { key: 'thisMonth', label: 'This Month', icon: 'bell', color: '#2563eb', bg: '#eff6ff', num: summary.thisMonth, amt: 0 },
    { key: 'paidThisMonth', label: 'Paid This Month', icon: 'check', color: '#16a34a', bg: '#f0fdf4', num: summary.paidThisMonth, amt: 0 },
  ]

  const catSectionItems = useMemo(() => {
    const now = new Date()
    const statusFor = rows => {
      const s = { overdue: { n: 0, amt: 0 }, dueToday: { n: 0, amt: 0 }, upcoming: { n: 0, amt: 0 }, paidToday: { n: 0, amt: 0 } }
      for (const r of rows) {
        const amt = r._amount || 0
        if (r._dueStatus === 'Overdue') { s.overdue.n++; s.overdue.amt += amt }
        else if (r._dueStatus === 'Due Today') { s.dueToday.n++; s.dueToday.amt += amt }
        else if (r._dueStatus === 'Upcoming' || r._dueStatus === 'Due Soon') { s.upcoming.n++; s.upcoming.amt += amt }
        else if (r._dueStatus === 'Paid' && isSameDay(r.paid_at || r.completed_at, now)) { s.paidToday.n++; s.paidToday.amt += amt }
      }
      return s
    }
    return CATEGORY_SECTIONS.map(section => ({
      title: section.title,
      heading: section.heading,
      tiles: section.tiles
        .map(t => {
          const cat = CATEGORIES.find(c => c.key === t.key)
          const rows = t.match ? enriched.filter(t.match) : enriched.filter(r => r.category === t.key)
          const count = rows.length
          return count > 0 ? { key: t.key, label: t.label || cat?.label, icon: t.icon || cat?.icon, count, statuses: statusFor(rows), col: t.col, row: t.row } : null
        })
        .filter(Boolean),
    }))
  }, [enriched])

  const catModalItems = useMemo(() => {
    if (!catModalKey) return []
    const tile = CATEGORY_SECTIONS.flatMap(section => section.tiles).find(t => t.key === catModalKey)
    if (!tile) return []
    return enriched.filter(tile.match ? tile.match : r => r.category === catModalKey)
  }, [enriched, catModalKey])

  const catModalLabel = catModalKey ? (CATEGORY_SECTIONS.flatMap(section => section.tiles).find(t => t.key === catModalKey)?.label || CATEGORIES.find(c => c.key === catModalKey)?.label || catModalKey) : ''

  return (
    <div className="dash-container">
      <div className="dash-header">
        <h2>PAYMENT & RENEWAL MANAGEMENT</h2>
        <p>Track payments, upcoming dues, renewals and overdue obligations.</p>
      </div>

      <div className="dash-row asymmetric">
        <div className="dash-financial-hero">
        <div className="fin-hero">
          <div className="fin-hero-left">
            <div className="fin-hero-label">Total Obligations</div>
            <div className="fin-hero-amount">{summary.monthlyObligations > 0 ? formatCurrency(summary.monthlyObligations) : 'Not available'}</div>
          </div>
          <div className="fin-hero-right">
            {summary.monthlyObligations > 0 && (
              <>
                <div className="fin-hero-pct">{Math.round((summary.monthlyPaid / summary.monthlyObligations) * 100)}%</div>
                <div className="fin-hero-sub">of total paid</div>
              </>
            )}
          </div>
        </div>
        {summary.monthlyObligations > 0 && (
          <div className="fin-progress">
            <div className="fin-progress-track">
              <div className="fin-progress-fill" style={{ width: `${(summary.monthlyPaid / summary.monthlyObligations) * 100}%` }} />
            </div>
            <div className="fin-progress-legend">
              <span className="fin-legend-item"><span className="fin-legend-dot" style={{ background: '#16a34a' }} />Paid</span>
              <span className="fin-legend-item"><span className="fin-legend-dot" style={{ background: '#f59e0b' }} />Pending</span>
              <span className="fin-legend-item"><span className="fin-legend-dot" style={{ background: '#ef4444' }} />Overdue</span>
            </div>
          </div>
        )}
        <div className="fin-cards">
          <div className="fin-card fin-card-paid">
            <div className="fin-card-icon"><Icon name="check" size={16} /></div>
            <div className="fin-card-body">
              <div className="fin-card-label">Paid</div>
              <div className="fin-card-amount">{summary.monthlyPaid > 0 ? formatCurrency(summary.monthlyPaid) : '₹0'}</div>
            </div>
          </div>
          <div className="fin-card fin-card-pending">
            <div className="fin-card-icon"><Icon name="clock" size={16} /></div>
            <div className="fin-card-body">
              <div className="fin-card-label">Pending</div>
              <div className="fin-card-amount">{summary.monthlyPending > 0 ? formatCurrency(summary.monthlyPending) : '₹0'}</div>
            </div>
          </div>
          <div className="fin-card fin-card-overdue">
            <div className="fin-card-icon"><Icon name="alert" size={16} /></div>
            <div className="fin-card-body">
              <div className="fin-card-label">Overdue</div>
              <div className="fin-card-amount">{summary.monthlyOverdue > 0 ? formatCurrency(summary.monthlyOverdue) : '₹0'}</div>
            </div>
          </div>
        </div>
      </div>

        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="history" size={16} /> Calendar</h3>
          </div>
          <div className="dash-cal">
            <div className="dash-cal-head">
              <h4>{new Date(calYear, calMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h4>
              <div className="dash-cal-nav">
                <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) } else setCalMonth(m => m - 1) }}>◀</button>
                <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) } else setCalMonth(m => m + 1) }}>▶</button>
              </div>
            </div>
            <div className="dash-cal-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="dash-cal-dow">{d}</div>
              ))}
              {calDays.map((cell, i) => {
                const dots = cell.otherMonth ? [] : getCalDots(cell.date)
                return (
                  <div
                    key={i}
                    className={`dash-cal-day ${cell.otherMonth ? 'other-month' : ''} ${isToday(cell.day) && !cell.otherMonth ? 'today' : ''} ${dots.length ? 'has-dots' : ''}`}
                    onClick={() => { if (!cell.otherMonth) setCalDay(calDay === cell.day ? null : cell.day) }}
                  >
                    <span>{cell.day}</span>
                    {dots.length > 0 && (
                      <div className="cal-dots">
                        {dots.map((d, j) => <div key={j} className={`cal-dot ${d}`} />)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {calDay && calDayItems.length > 0 && (
            <div className="cal-detail">
              <h4>{calMonth + 1}/{calDay}/{calYear}</h4>
              {calDayItems.map(r => (
                <div key={r.id} className="cal-detail-item">
                  <Icon name={categoryIcon(r.category)} size={14} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{r.title || '—'}</span>
                  <span style={{ color: 'var(--rem-ink-soft)' }}>{r.owner || '—'}</span>
                  {r._amount > 0 && <span style={{ fontWeight: 600 }}>{formatCurrency(r._amount)}</span>}
                  <span className={`pill ${statusPillClass(r._dueStatus === 'Paid' ? 'Completed' : r._dueStatus)}`} style={{ fontSize: 10 }}>{r._dueStatus}</span>
                </div>
              ))}
              <div className="cal-detail-total">Total Due: {formatCurrency(calTotal)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="dash-cat-sections">
        {catSectionItems.map(section => (
          <div key={section.title} className="dash-cat-section">
            <div className="dash-cat-section-title" style={{ gridColumn: `${section.heading.col} / span ${section.heading.span}`, gridRow: section.heading.row }}>
              {section.title}
            </div>
            {section.tiles.map(c => {
              const colors = CATEGORY_TILE_COLORS[c.key] || { bg: '#f8fafc', border: '#e2e8f0', iconBg: '#e2e8f0', color: '#475569' }
              return (
                <div
                  key={c.key}
                  className="dash-cat-tile"
                  title={`${c.label} (${c.count})`}
                  onClick={() => setCatModalKey(c.key)}
                  style={{ gridColumn: c.col, gridRow: c.row, background: colors.bg, borderColor: colors.border }}
                >
                  <div className="dash-cat-tile-status">
                    {TILE_STATUSES.filter(s => c.statuses?.[s.key]?.n > 0).slice(0, 4).map(s => (
                      <span key={s.key} className="tile-st" style={{ color: s.color, background: s.soft }} title={`${s.label}: ${c.statuses[s.key].n} · ${formatCurrency(c.statuses[s.key].amt)}`}>
                        {s.label} {c.statuses[s.key].n}{c.statuses[s.key].amt > 0 ? ` · ${compactAmount(c.statuses[s.key].amt)}` : ''}
                      </span>
                    ))}
                  </div>
                  <div className="dash-cat-tile-icon" style={{ background: colors.iconBg, color: colors.color }}>
                    <Icon name={c.icon} size={18} />
                  </div>
                  <div className="dash-cat-tile-label">{c.label}</div>
                  <div className="dash-cat-tile-count" style={{ color: colors.color }}>{c.count}</div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="dash-row">
        <PaymentChecklist />

        <BillChart reminders={enriched} />
      </div>

      <div className="dash-row">
        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="clock" size={16} /> Upcoming Payments</h3>
            <span className="sec-count">{upPeriodItems.length} · {formatCurrency(upDaysTotal)}</span>
          </div>
          <div className="up-tabs">
            <button className={`up-tab ${upcomingTab === '7days' ? 'active' : ''}`} onClick={() => { setUpcomingTab('7days'); setUpDay(null) }}>Next 7 Days</button>
            <button className={`up-tab ${upcomingTab === '30days' ? 'active' : ''}`} onClick={() => { setUpcomingTab('30days'); setUpDay(null) }}>Next 30 Days</button>
            <button className={`up-tab ${upcomingTab === 'all' ? 'active' : ''}`} onClick={() => { setUpcomingTab('all'); setUpDay(null) }}>All Upcoming</button>
          </div>
          <div className="up-list">
            {upGroups.length === 0 ? (
              <div className="dash-empty"><div className="big">No upcoming payments</div><div>Nothing due in this period.</div></div>
            ) : (
              <>
                {(upShowAll ? upGroups : upGroups.slice(0, 5)).map(g => (
                  <div key={g.key} className={`up-row ${g.minDays <= 3 ? 'urgent' : ''}`}>
                    <div className="up-row-icon">
                      <Icon name={categoryIcon(g.category)} size={14} />
                    </div>
                    <div className="up-row-body">
                      <div className="up-row-top">
                        <span className="up-row-name">{g.key}</span>
                        {g.total > 0 && <span className="up-row-amt">{formatCurrency(g.total)}</span>}
                      </div>
                      <div className="up-row-meta">
                        <span className="up-row-owners">{g.owners.join(' · ')}</span>
                        {g.count > 1 && <span className="up-row-count">{g.count}</span>}
                        {g.minDays !== null && <span className={`up-row-days ${g.minDays <= 3 ? 'warn' : ''}`}>{g.minDays}d</span>}
                      </div>
                    </div>
                  </div>
                ))}
                {upGroups.length > 5 && !upShowAll && (
                  <button className="up-more" onClick={() => setUpShowAll(true)}>+{upGroups.length - 5} more</button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="history" size={16} /> Renewal Tracker</h3>
            <span className="sec-count">{renewalTracker.length}</span>
          </div>
          <div className="rn-list">
            {renewalTracker.length === 0 ? (
              <div className="dash-empty"><div className="big">No renewals due</div><div>No renewals in this period.</div></div>
            ) : renewalTracker.map(r => {
              const isExpired = r._daysLeft !== null && r._daysLeft < 0
              const isUrgent = r._daysLeft !== null && r._daysLeft >= 0 && r._daysLeft <= 30
              return (
                <div key={r.id} className={`rn-row ${isExpired ? 'expired' : isUrgent ? 'urgent' : ''}`}>
                  <div className="rn-icon">
                    <Icon name={categoryIcon(r.category)} size={12} />
                  </div>
                  <div className="rn-body">
                    <span className="rn-name" title={r.title}>{r.title || '—'}</span>
                    <span className="rn-meta">{categoryLabel(r.category)} · {r.owner || '—'}</span>
                  </div>
                  <div className="rn-right">
                    <span className="rn-date">{r._effectiveDate ? formatDate(r._effectiveDate) : r.renewal_date_display || '—'}</span>
                    <span className={`rn-badge ${isExpired ? 'red' : isUrgent ? 'amber' : 'blue'}`}>
                      {isExpired ? 'Expired' : r._daysLeft === 0 ? 'Today' : `${r._daysLeft}d`}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {catModalKey && (
        <div className="cat-modal-overlay" onClick={() => setCatModalKey(null)}>
          <div className="cat-modal" onClick={e => e.stopPropagation()}>
            <div className="cat-modal-head">
              <h3>{catModalLabel}</h3>
              <span className="cat-modal-count">{catModalItems.length} item{catModalItems.length !== 1 ? 's' : ''}</span>
              <button className="cat-modal-close" onClick={() => setCatModalKey(null)}>&times;</button>
            </div>
            <div className="cat-modal-body">
              {catModalItems.length === 0 ? (
                <div className="dash-empty"><div className="big">No items</div></div>
              ) : catModalItems.map(r => (
                <div key={r.id} className="cat-modal-item">
                  <div className="cat-modal-item-icon" style={{ background: r._dueStatus === 'Paid' ? '#dcfce7' : r._dueStatus === 'Overdue' ? '#fee2e2' : '#f1f5f9', color: r._dueStatus === 'Paid' ? '#16a34a' : r._dueStatus === 'Overdue' ? '#dc2626' : '#64748b' }}>
                    <Icon name={categoryIcon(r.category)} size={14} />
                  </div>
                  <div className="cat-modal-item-body">
                    <div className="cat-modal-item-title">{r.title || '—'}</div>
                    <div className="cat-modal-item-meta">{r.owner || '—'}{r._amount > 0 ? ` · ${formatCurrency(r._amount)}` : ''}</div>
                    {r._effectiveDate && <div className="cat-modal-item-meta" style={{ fontSize: 10 }}>Next due: {formatDate(r._effectiveDate)}{r._daysLeft !== null ? ` (${r._daysLeft < 0 ? 'overdue' : r._daysLeft === 0 ? 'today' : r._daysLeft + 'd'})` : ''}</div>}
                  </div>
                  <span className={`pill ${statusPillClass(r._dueStatus === 'Paid' ? 'Completed' : r._dueStatus)}`} style={{ fontSize: 10 }}>{r._dueStatus}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <AddBillModal
        open={billOpen}
        onClose={() => setBillOpen(false)}
        onSaved={() => { refresh() }}
      />
    </div>
  )
}

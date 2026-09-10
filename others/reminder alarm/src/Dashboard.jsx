import { useMemo, useState } from 'react'
import { useRem, useUcs } from './store'
import { useNavigate } from 'react-router-dom'
import { Icon } from './components'
import { CATEGORIES, categoryLabel, categoryIcon, formatDate, daysLeft, statusPillClass } from './helpers'
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

function parseAmount(notes) {
  if (!notes) return 0
  const cleaned = notes.replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function formatCurrency(num) {
  if (!num) return '₹0'
  return '₹' + num.toLocaleString('en-IN')
}

function getDueStatus(r) {
  if (r.status === 'Completed' || r.completed_at) return 'Paid'
  if (r.due_date_display && String(r.due_date_display).includes('Paid by Tenant')) return 'Paid'
  if (r.notes && String(r.notes).includes('Paid by Tenant')) return 'Paid'
  const dl = daysLeft(r.due_date)
  if (dl === null) return 'Pending'
  if (dl < 0) return 'Overdue'
  if (dl === 0) return 'Due Today'
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
  const { reminders } = useRem()
  const navigate = useNavigate()

  const [calMonth, setCalMonth] = useState(() => new Date().getMonth())
  const [calYear, setCalYear] = useState(() => new Date().getFullYear())
  const [calDay, setCalDay] = useState(null)
  const [upcomingTab, setUpcomingTab] = useState('7days')

  const active = useMemo(() => reminders.filter(r => !r.is_deleted), [reminders])

  const enriched = useMemo(() => {
    return active.map(r => {
      const dueStatus = getDueStatus(r)
      const amount = parseAmount(r.notes)
      const dl = daysLeft(r.due_date)
      const isRenewal = RENEWAL_CATEGORIES.has(r.category) || !!r.renewal_date
      const group = GROUP_MAP[r.category] || 'Other'
      return { ...r, _dueStatus: dueStatus, _amount: amount, _daysLeft: dl, _isRenewal: isRenewal, _group: group }
    })
  }, [active])

  const filtered = enriched

  const summary = useMemo(() => {
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    let dueToday = 0, overdue = 0, dueIn7 = 0, dueIn30 = 0, pending = 0, renewals = 0, thisMonth = 0, paidThisMonth = 0
    let dueTodayAmt = 0, overdueAmt = 0, dueIn7Amt = 0, dueIn30Amt = 0, thisMonthAmt = 0, paidThisMonthAmt = 0
    for (const r of filtered) {
      const st = r._dueStatus
      const dl = r._daysLeft
      const amt = r._amount
      if (st === 'Paid') { paidThisMonth++; paidThisMonthAmt += amt; continue }
      if (dl === 0) { dueToday++; dueTodayAmt += amt }
      if (dl !== null && dl < 0) { overdue++; overdueAmt += amt }
      if (dl !== null && dl > 0 && dl <= 7) { dueIn7++; dueIn7Amt += amt }
      if (dl !== null && dl > 0 && dl <= 30) { dueIn30++; dueIn30Amt += amt }
      if (st === 'Pending') pending++
      if (st === 'Upcoming' || st === 'Pending' || st === 'Due Today' || st === 'Overdue') { thisMonth++; thisMonthAmt += amt }
      if (r.renewal_date) {
        const renewal = new Date(String(r.renewal_date).slice(0, 10) + 'T00:00:00')
        if (renewal.getMonth() === currentMonth && renewal.getFullYear() === currentYear) renewals++
      }
    }
    return { dueToday, overdue, dueIn7, dueIn30, pending, renewals, thisMonth, paidThisMonth, dueTodayAmt, overdueAmt, dueIn7Amt, dueIn30Amt, thisMonthAmt, paidThisMonthAmt }
  }, [filtered])

  const todaysAttention = useMemo(() => {
    return filtered
      .filter(r => r._dueStatus === 'Overdue' || r._dueStatus === 'Due Today')
      .sort((a, b) => (a._daysLeft ?? 999) - (b._daysLeft ?? 999))
      .slice(0, 8)
  }, [filtered])

  const upcomingPayments = useMemo(() => {
    const days = upcomingTab === '7days' ? 7 : upcomingTab === '30days' ? 30 : 365
    return filtered
      .filter(r => r._dueStatus !== 'Paid' && r._daysLeft !== null && r._daysLeft > 0 && r._daysLeft <= days && !r._isRenewal)
      .sort((a, b) => a._daysLeft - b._daysLeft)
      .slice(0, 10)
  }, [filtered, upcomingTab])

  const renewalGroups = useMemo(() => {
    const groups = {}
    for (const r of filtered) {
      if (!r._isRenewal || r._dueStatus === 'Paid') continue
      const type = getRenewalType(r)
      if (!groups[type]) groups[type] = { type, count: 0, items: [] }
      groups[type].count++
      groups[type].items.push(r)
    }
    return Object.values(groups).sort((a, b) => b.count - a.count)
  }, [filtered])

  const renewalTracker = useMemo(() => {
    return filtered
      .filter(r => r._isRenewal && r._dueStatus !== 'Paid' && r.renewal_date)
      .sort((a, b) => {
        const da = new Date(String(a.renewal_date).slice(0, 10) + 'T00:00:00')
        const db = new Date(String(b.renewal_date).slice(0, 10) + 'T00:00:00')
        return da - db
      })
      .slice(0, 10)
  }, [filtered])

  const groupSummary = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      const g = r._group
      if (!map[g]) map[g] = { group: g, count: 0, pendingAmt: 0, paidAmt: 0 }
      map[g].count++
      if (r._dueStatus === 'Paid') map[g].paidAmt += r._amount
      else map[g].pendingAmt += r._amount
    }
    return Object.values(map).sort((a, b) => b.count - a.count)
  }, [filtered])

  const categorySummary = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      if (!map[r.category]) map[r.category] = { count: 0, pendingAmt: 0, paidAmt: 0 }
      map[r.category].count++
      if (r._dueStatus === 'Paid') map[r.category].paidAmt += r._amount
      else map[r.category].pendingAmt += r._amount
    }
    return CATEGORIES
      .filter(c => map[c.key])
      .map(c => ({ ...c, ...map[c.key] }))
      .sort((a, b) => b.count - a.count)
  }, [filtered])

  const ownerResponsibility = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      if (!r.owner) continue
      if (r._dueStatus === 'Paid') continue
      if (!map[r.owner]) map[r.owner] = { pending: 0, overdue: 0, total: 0 }
      map[r.owner].total++
      if (r._dueStatus === 'Overdue') map[r.owner].overdue++
      map[r.owner].pending++
    }
    return Object.entries(map).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.total - a.total)
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
      if (r.due_date) {
        const ds = String(r.due_date).slice(0, 10)
        if (!map[ds]) map[ds] = []
        map[ds].push(r)
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
  const calTotal = useMemo(() => calDayItems.reduce((s, r) => s + parseAmount(r.notes), 0), [calDayItems])

  function getCalDots(date) {
    const ds = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const items = calEvents[ds] || []
    if (!items.length) return []
    const dots = []
    if (items.some(r => r._dueStatus === 'Overdue')) dots.push('red')
    if (items.some(r => r._dueStatus === 'Due Today')) dots.push('yellow')
    if (items.some(r => r._dueStatus === 'Upcoming')) dots.push('blue')
    if (items.some(r => r._dueStatus === 'Paid')) dots.push('green')
    return [...new Set(dots)].slice(0, 3)
  }

  const handleAdd = () => navigate('/rem')

  const summaryCards = [
    { key: 'dueToday', label: 'Due Today', icon: 'alarm', color: '#d97706', bg: '#fffbeb', num: summary.dueToday, amt: summary.dueTodayAmt },
    { key: 'overdue', label: 'Overdue', icon: 'alert', color: '#dc2626', bg: '#fef2f2', num: summary.overdue, amt: summary.overdueAmt },
    { key: 'dueIn7', label: 'Due in 7 Days', icon: 'clock', color: '#0891b2', bg: '#ecfeff', num: summary.dueIn7, amt: summary.dueIn7Amt },
    { key: 'dueIn30', label: 'Due in 30 Days', icon: 'clock', color: '#6366f1', bg: '#eef2ff', num: summary.dueIn30, amt: summary.dueIn30Amt },
    { key: 'pending', label: 'Pending', icon: 'file', color: '#d97706', bg: '#fffbeb', num: summary.pending, amt: 0 },
    { key: 'renewals', label: 'Renewals', icon: 'history', color: '#7c3aed', bg: '#f5f3ff', num: summary.renewals, amt: 0 },
    { key: 'thisMonth', label: 'This Month', icon: 'bell', color: '#2563eb', bg: '#eff6ff', num: summary.thisMonth, amt: summary.thisMonthAmt },
    { key: 'paidThisMonth', label: 'Paid This Month', icon: 'check', color: '#16a34a', bg: '#f0fdf4', num: summary.paidThisMonth, amt: summary.paidThisMonthAmt },
  ]

  const dashCategories = useMemo(() => {
    return CATEGORIES.map(c => {
      const count = enriched.filter(r => r.category === c.key).length
      return { ...c, count }
    }).filter(c => c.count > 0)
  }, [enriched])

  return (
    <div className="dash-container">
      <div className="dash-header">
        <h2>PAYMENT & RENEWAL MANAGEMENT</h2>
        <p>Track payments, upcoming dues, renewals and overdue obligations.</p>
      </div>

      <div className="dash-summary">
        {summaryCards.map(c => (
          <div key={c.key} className="dash-card">
            <div className="dc-icon" style={{ background: c.bg, color: c.color }}>
              <Icon name={c.icon} size={16} />
            </div>
            <div className="dc-body">
              <div className="dc-label">{c.label}</div>
              <div className="dc-num">{c.num}</div>
              {c.amt > 0 && <div className="dc-amount">{formatCurrency(c.amt)}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="dash-cat-bar">
        {dashCategories.map(c => (
          <div key={c.key} className="dash-cat-chip" title={`${c.label} (${c.count})`}>
            <Icon name={c.icon} size={12} />
            <span>{c.label}</span>
            <span className="dash-cat-count">{c.count}</span>
          </div>
        ))}
      </div>

      <div className="dash-row">
        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="alert" size={16} /> Today's Attention</h3>
            <span className="sec-count">{todaysAttention.length}</span>
          </div>
          <div className="sec-body">
            {todaysAttention.length === 0 ? (
              <div className="dash-empty"><div className="big">No urgent items</div><div>All clear for today.</div></div>
            ) : todaysAttention.map(r => (
              <div key={r.id} className="dash-item">
                <div className="di-icon" style={{ background: r._dueStatus === 'Overdue' ? '#fef2f2' : '#fffbeb', color: r._dueStatus === 'Overdue' ? '#dc2626' : '#d97706' }}>
                  <Icon name={categoryIcon(r.category)} size={16} />
                </div>
                <div className="di-body">
                  <div className="di-title" title={r.title}>{r.title || '—'}</div>
                  <div className="di-meta">{categoryLabel(r.category)} · {r.owner || '—'}</div>
                </div>
                <div className="di-right">
                  {r._amount > 0 && <div className="di-amount">{formatCurrency(r._amount)}</div>}
                  <div className="di-date">{r.due_date_display || formatDate(r.due_date)}</div>
                </div>
                <span className={`pill ${statusPillClass(r._dueStatus === 'Paid' ? 'Completed' : r._dueStatus === 'Overdue' ? 'Overdue' : r._dueStatus === 'Due Today' ? 'Due Today' : 'Upcoming')}`}>
                  {r._dueStatus}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="plus" size={16} /> Quick Actions</h3>
          </div>
          <div className="dash-qa">
            <button onClick={handleAdd}><Icon name="plus" size={14} /> Add Payment</button>
            <button onClick={handleAdd}><Icon name="plus" size={14} /> Add Renewal</button>
            <button onClick={() => navigate('/rem')}><Icon name="check" size={14} /> Mark Paid</button>
            <button onClick={() => navigate('/rem/settings')}><Icon name="settings" size={14} /> Settings</button>
          </div>
        </div>
      </div>

      <div className="dash-row">
        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="clock" size={16} /> Upcoming Payments</h3>
          </div>
          <div className="dash-tabs">
            <button className={`dash-tab ${upcomingTab === '7days' ? 'active' : ''}`} onClick={() => setUpcomingTab('7days')}>Next 7 Days</button>
            <button className={`dash-tab ${upcomingTab === '30days' ? 'active' : ''}`} onClick={() => setUpcomingTab('30days')}>Next 30 Days</button>
            <button className={`dash-tab ${upcomingTab === 'all' ? 'active' : ''}`} onClick={() => setUpcomingTab('all')}>All Upcoming</button>
          </div>
          <div className="sec-body">
            {upcomingPayments.length === 0 ? (
              <div className="dash-empty"><div className="big">No upcoming payments</div><div>Nothing due in this period.</div></div>
            ) : upcomingPayments.map(r => (
              <div key={r.id} className="dash-item">
                <div className="di-icon" style={{ background: 'var(--rem-blue-soft)', color: 'var(--rem-blue)' }}>
                  <Icon name={categoryIcon(r.category)} size={16} />
                </div>
                <div className="di-body">
                  <div className="di-title" title={r.title}>{r.title || '—'}</div>
                  <div className="di-meta">{categoryLabel(r.category)} · {r.owner || '—'}</div>
                </div>
                <div className="di-right">
                  {r._amount > 0 && <div className="di-amount">{formatCurrency(r._amount)}</div>}
                  <div className="di-date">{r.due_date_display || formatDate(r.due_date)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="history" size={16} /> Renewal Tracker</h3>
            <span className="sec-count">{renewalTracker.length}</span>
          </div>
          <div className="sec-body">
            {renewalTracker.length === 0 ? (
              <div className="dash-empty"><div className="big">No renewals due</div><div>No renewals in this period.</div></div>
            ) : renewalTracker.map(r => (
              <div key={r.id} className="dash-item">
                <div className="di-icon" style={{ background: 'var(--rem-violet-soft)', color: 'var(--rem-violet)' }}>
                  <Icon name={categoryIcon(r.category)} size={16} />
                </div>
                <div className="di-body">
                  <div className="di-title" title={r.title}>{r.title || '—'}</div>
                  <div className="di-meta">{categoryLabel(r.category)} · {r.owner || '—'}</div>
                </div>
                <div className="di-right">
                  <div className="di-date">{r.renewal_date_display || formatDate(r.renewal_date)}</div>
                  <div className="di-date" style={{ fontWeight: 600, color: r._daysLeft !== null && r._daysLeft <= 30 ? 'var(--rem-amber)' : 'var(--rem-ink-soft)' }}>
                    {r._daysLeft !== null ? (r._daysLeft < 0 ? 'Expired' : `${r._daysLeft} days`) : '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dash-row">
        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="history" size={16} /> Renewal Summary</h3>
          </div>
          <div className="sec-body">
            {renewalGroups.length === 0 ? (
              <div className="dash-empty"><div className="big">No renewals</div></div>
            ) : renewalGroups.map(g => (
              <div key={g.type} className="dash-item">
                <div className="di-icon" style={{ background: 'var(--rem-violet-soft)', color: 'var(--rem-violet)' }}>
                  <Icon name={g.type === 'Vehicle' ? 'car' : g.type === 'Insurance' ? 'shield' : g.type === 'Education' ? 'book' : 'globe'} size={16} />
                </div>
                <div className="di-body">
                  <div className="di-title">{g.type} Renewals</div>
                  <div className="di-meta">{g.count} item{g.count !== 1 ? 's' : ''} pending</div>
                </div>
                <span className="pill pill-upcoming">{g.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="home" size={16} /> Payment Responsibility</h3>
          </div>
          <div className="sec-body">
            {ownerResponsibility.length === 0 ? (
              <div className="dash-empty"><div className="big">No owners</div></div>
            ) : ownerResponsibility.map(o => (
              <div key={o.name} className="resp-row">
                <div className="resp-avatar" style={{ background: OWNER_COLORS[o.name] || '#6b7280', color: '#fff' }}>
                  {o.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                </div>
                <div className="resp-name">{o.name}</div>
                {o.overdue > 0 && <span className="pill pill-overdue" style={{ marginRight: 8 }}>{o.overdue} overdue</span>}
                <div className="resp-count">{o.total}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dash-row">
        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="bell" size={16} /> Monthly Financial Summary</h3>
          </div>
          <div className="sec-body padded">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--rem-ink-soft)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Total Obligations</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{formatCurrency(summary.thisMonthAmt + summary.paidThisMonthAmt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--rem-ink-soft)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Paid</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: 'var(--rem-green)' }}>{formatCurrency(summary.paidThisMonthAmt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--rem-ink-soft)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Pending</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: 'var(--rem-amber)' }}>{formatCurrency(summary.thisMonthAmt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--rem-ink-soft)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Overdue</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: 'var(--rem-red)' }}>{formatCurrency(summary.overdueAmt)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="file" size={16} /> Category Breakdown</h3>
          </div>
          <div className="sec-body">
            {groupSummary.length === 0 ? (
              <div className="dash-empty"><div className="big">No data</div></div>
            ) : groupSummary.map(g => {
              const maxCount = Math.max(...groupSummary.map(x => x.count), 1)
              return (
                <div key={g.group} className="cat-row">
                  <div className="cat-icon" style={{ background: `${GROUP_COLORS[g.group]}15`, color: GROUP_COLORS[g.group] }}>
                    <Icon name={GROUP_ICONS[g.group] || 'file'} size={14} />
                  </div>
                  <div className="cat-body">
                    <div className="cat-name">{g.group}</div>
                    <div className="cat-count">{g.count} item{g.count !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="cat-bar">
                    <div className="cat-bar-fill" style={{ width: `${(g.count / maxCount) * 100}%`, background: GROUP_COLORS[g.group] }} />
                  </div>
                  <div className="cat-amount">
                    {g.pendingAmt > 0 && <div>{formatCurrency(g.pendingAmt)}</div>}
                    {g.paidAmt > 0 && <div style={{ color: 'var(--rem-green)', fontSize: 11 }}>Paid: {formatCurrency(g.paidAmt)}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="dash-row asymmetric">
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

        <div className="dash-section">
          <div className="sec-head">
            <h3><Icon name="bell" size={16} /> Category Summary</h3>
          </div>
          <div className="sec-body">
            {categorySummary.length === 0 ? (
              <div className="dash-empty"><div className="big">No data</div></div>
            ) : (
              <div className="cat-grid">
                {categorySummary.map(c => (
                  <div key={c.key} className="cat-card">
                    <span className="cat-card-badge">{c.count}</span>
                    <div className="cat-card-icon" style={{ background: 'var(--rem-blue-soft)', color: 'var(--rem-blue)' }}>
                      <Icon name={c.icon} size={22} />
                    </div>
                    <div className="cat-card-label">{c.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

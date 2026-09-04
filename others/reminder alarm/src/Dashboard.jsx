import { useMemo } from 'react'
import { useRem } from './store'
import { daysLeft } from './helpers'
import { Icon } from './components'

const STAT_FILTERS = [
  { key: '', label: 'Total Reminders', icon: 'list' },
  { key: 'dueToday', label: 'Due Today', icon: 'alarm' },
  { key: 'dueTomorrow', label: 'Due Tomorrow', icon: 'clock' },
  { key: 'dueThisWeek', label: 'Due This Week', icon: 'clock' },
  { key: 'upcoming', label: 'Upcoming', icon: 'bell' },
  { key: 'overdue', label: 'Overdue', icon: 'alert' },
  { key: 'renewalsThisMonth', label: 'Renewals This Month', icon: 'history' },
  { key: 'completed', label: 'Completed', icon: 'check' },
]

export default function Dashboard() {
  const { reminders, activeFilter, setActiveFilter } = useRem()

  const stats = useMemo(() => {
    const active = reminders.filter(r => !r.is_deleted)
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    let dueToday = 0
    let dueTomorrow = 0
    let dueThisWeek = 0
    let upcoming = 0
    let overdue = 0
    let renewalsThisMonth = 0
    let completed = 0

    for (const r of active) {
      if (r.completed_at) {
        completed++
        continue
      }

      const dl = daysLeft(r.due_date)
      if (dl === 0) dueToday++
      else if (dl === 1) dueTomorrow++
      else if (dl > 1 && dl <= 7) dueThisWeek++
      else if (dl === null || dl > 7) upcoming++
      else if (dl < 0) overdue++

      if (r.renewal_date) {
        const renewal = new Date(String(r.renewal_date).slice(0, 10) + 'T00:00:00')
        if (renewal.getMonth() === currentMonth && renewal.getFullYear() === currentYear) {
          renewalsThisMonth++
        }
      }
    }

    return {
      all: active.length,
      dueToday,
      dueTomorrow,
      dueThisWeek,
      upcoming,
      overdue,
      renewalsThisMonth,
      completed,
    }
  }, [reminders])

  const handleFilterClick = (key) => {
    setActiveFilter(activeFilter === key ? '' : key)
  }

  const statColors = {
    '': { bg: 'var(--rem-blue-soft)', color: 'var(--rem-blue)' },
    dueToday: { bg: 'var(--rem-amber-soft)', color: 'var(--rem-amber)' },
    dueTomorrow: { bg: 'var(--rem-amber-soft)', color: 'var(--rem-amber)' },
    dueThisWeek: { bg: 'var(--rem-cyan-soft)', color: 'var(--rem-cyan)' },
    upcoming: { bg: 'var(--rem-blue-soft)', color: 'var(--rem-blue)' },
    overdue: { bg: 'var(--rem-red-soft)', color: 'var(--rem-red)' },
    renewalsThisMonth: { bg: 'var(--rem-violet-soft)', color: 'var(--rem-violet)' },
    completed: { bg: 'var(--rem-green-soft)', color: 'var(--rem-green)' },
  }

  return (
    <div className="grid-4">
      {STAT_FILTERS.map(stat => (
        <div
          key={stat.key || 'all'}
          className={`stat-card ${activeFilter === stat.key ? 'active' : ''}`}
          onClick={() => handleFilterClick(stat.key)}
          title="Click to filter the reminders table"
        >
          <div className="ic" style={{ background: statColors[stat.key].bg, color: statColors[stat.key].color }}>
            <Icon name={stat.icon} size={18} />
          </div>
          <div className="num">{stats[stat.key === '' ? 'all' : stat.key]}</div>
          <div className="title">{stat.label}</div>
        </div>
      ))}
    </div>
  )
}

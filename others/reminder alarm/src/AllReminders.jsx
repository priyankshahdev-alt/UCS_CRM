import { useState, useMemo, useEffect } from 'react'
import { useRem } from './store'
import { CATEGORIES, derivedStatus, statusPillClass, formatDate, daysLeft, categoryLabel, categoryIcon } from './helpers'
import { Icon } from './components'
import Dashboard from './Dashboard'

const STATUS_OPTIONS = ['Overdue', 'Due Today', 'Due Tomorrow', 'Due Soon', 'Upcoming', 'Completed', 'Snoozed']
const PAGE_SIZE = 20

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 }

const VIEW_FILTERS = {
  completed: 'completed',
  overdue: 'overdue',
  dueToday: 'dueToday',
  dueTomorrow: 'dueTomorrow',
  dueThisWeek: 'dueThisWeek',
  upcoming: 'upcoming',
  renewalsThisMonth: 'renewalsThisMonth',
}

function isCategoryKey(val) {
  return CATEGORIES.some(c => c.key === val)
}

function matchesView(r, viewKey) {
  if (r.completed_at) return viewKey === 'completed'
  const dl = daysLeft(r.due_date)
  switch (viewKey) {
    case 'completed': return !!r.completed_at
    case 'overdue': return dl !== null && dl < 0
    case 'dueToday': return dl === 0
    case 'dueTomorrow': return dl === 1
    case 'dueThisWeek': return dl !== null && dl > 1 && dl <= 7
    case 'upcoming': return dl === null || dl > 7
    case 'renewalsThisMonth': {
      if (!r.renewal_date) return false
      const renewal = new Date(String(r.renewal_date).slice(0, 10) + 'T00:00:00')
      const now = new Date()
      return renewal.getMonth() === now.getMonth() && renewal.getFullYear() === now.getFullYear()
    }
    default: return true
  }
}

export default function AllReminders({ onAdd, onEdit, onDelete, onHistory, onComplete, onSnooze }) {
  const { reminders, activeFilter, setActiveFilter } = useRem()

  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dueDateFilter, setDueDateFilter] = useState('')
  const [renewalFilter, setRenewalFilter] = useState('')
  const [sortKey, setSortKey] = useState('due_date')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [activeFilter, search, ownerFilter, statusFilter, dueDateFilter, renewalFilter])

  const owners = useMemo(() => {
    const set = new Set()
    reminders.forEach(r => { if (r.owner) set.add(r.owner) })
    return Array.from(set).sort()
  }, [reminders])

  const enriched = useMemo(() => {
    return reminders.map(r => {
      const status = derivedStatus(r)
      const dl = daysLeft(r.due_date)
      return { ...r, _status: status, _daysLeft: dl }
    })
  }, [reminders])

  const filtered = useMemo(() => {
    let list = enriched

    if (activeFilter && !isCategoryKey(activeFilter)) {
      const viewKey = VIEW_FILTERS[activeFilter]
      if (viewKey) list = list.filter(r => matchesView(r, activeFilter))
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.owner || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q) ||
        (r.display_frequency || '').toLowerCase().includes(q) ||
        (r.due_date_display || '').toLowerCase().includes(q) ||
        (r.renewal_date_display || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      )
    }

    const effectiveCat = isCategoryKey(activeFilter) ? activeFilter : ''
    if (effectiveCat) list = list.filter(r => r.category === effectiveCat)

    if (ownerFilter) list = list.filter(r => r.owner === ownerFilter)

    const effectiveStatus =
      activeFilter === 'completed' ? 'Completed'
        : activeFilter === 'overdue' ? 'Overdue'
        : statusFilter
    if (effectiveStatus) list = list.filter(r => r._status === effectiveStatus)

    if (dueDateFilter) list = list.filter(r => (r.due_date || '').slice(0, 10) === dueDateFilter)
    if (renewalFilter) list = list.filter(r => (r.renewal_date || '').slice(0, 10) === renewalFilter)

    list.sort((a, b) => {
      let va, vb
      switch (sortKey) {
        case 'title':
          va = (a.title || '').toLowerCase(); vb = (b.title || '').toLowerCase(); break
        case 'category':
          va = (a.category || '').toLowerCase(); vb = (b.category || '').toLowerCase(); break
        case 'owner':
          va = (a.owner || '').toLowerCase(); vb = (b.owner || '').toLowerCase(); break
        case 'due_date':
          va = a.due_date || ''; vb = b.due_date || ''; break
        case 'renewal_date':
          va = a.renewal_date || ''; vb = b.renewal_date || ''; break
        case 'daysLeft':
          va = a._daysLeft === null ? Infinity : a._daysLeft
          vb = b._daysLeft === null ? Infinity : b._daysLeft
          break
        case 'priority':
          va = PRIORITY_ORDER[a.priority] ?? 4; vb = PRIORITY_ORDER[b.priority] ?? 4; break
        case 'status':
          va = (a._status || '').toLowerCase(); vb = (b._status || '').toLowerCase(); break
        default:
          va = 0; vb = 0
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [enriched, activeFilter, search, ownerFilter, statusFilter, dueDateFilter, renewalFilter, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length)

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  const handleCategoryChange = (val) => {
    setActiveFilter(val || '')
    setPage(1)
  }

  const clearFilters = () => {
    setSearch('')
    setOwnerFilter('')
    setStatusFilter('')
    setDueDateFilter('')
    setRenewalFilter('')
    setActiveFilter('')
    setSortKey('due_date')
    setSortDir('asc')
    setPage(1)
  }

  const effectiveCat = isCategoryKey(activeFilter) ? activeFilter : ''
  const hasFilters = search || ownerFilter || statusFilter || dueDateFilter || renewalFilter || activeFilter

  const th = (label, key) => (
    <th className="sortable" onClick={() => handleSort(key)}>
      {label}
      {sortKey === key && <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )

  const activeLabel = activeFilter ? (isCategoryKey(activeFilter) ? categoryLabel(activeFilter) : (
    VIEW_FILTERS[activeFilter]
      ? ({ completed: 'Completed', overdue: 'Overdue', dueToday: 'Due Today', dueTomorrow: 'Due Tomorrow', dueThisWeek: 'Due This Week', upcoming: 'Upcoming', renewalsThisMonth: 'Renewals This Month' })[activeFilter]
      : 'All Reminders'
  )) : 'All Reminders'

  return (
    <>
      <Dashboard />

      <div className="card-block" style={{ marginTop: 20 }}>
        <div className="tb">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="bell" size={18} />
            <h3>{activeLabel}</h3>
            <span className="pill pill-upcoming">{filtered.length} reminder{filtered.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasFilters && (
              <button className="rem-btn sm" onClick={clearFilters}>
                <Icon name="close" size={14} /> Clear Filters
              </button>
            )}
            <button className="rem-btn primary sm" onClick={onAdd}>
              <Icon name="plus" size={14} /> Add Reminder
            </button>
          </div>
        </div>

        <div className="toolbar">
          <input
            type="text"
            className="rem-input search-input"
            placeholder="Search reminders..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="rem-select" value={effectiveCat} onChange={e => handleCategoryChange(e.target.value)}>
            <option value="">All Categories</option>
            {CATEGORIES.map(c => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <select className="rem-select" value={ownerFilter} onChange={e => { setOwnerFilter(e.target.value); setPage(1) }}>
            <option value="">All Owners</option>
            {owners.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select className="rem-select" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); if (activeFilter === 'completed' || activeFilter === 'overdue') setActiveFilter('') }}>
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="date"
            className="rem-input"
            title="Due Date"
            value={dueDateFilter}
            onChange={e => setDueDateFilter(e.target.value)}
          />
          <input
            type="date"
            className="rem-input"
            title="Renewal Date"
            value={renewalFilter}
            onChange={e => setRenewalFilter(e.target.value)}
          />
          {hasFilters && (
            <button className="rem-btn sm" onClick={clearFilters}>
              <Icon name="close" size={14} /> Clear
            </button>
          )}
        </div>

        <div className="table-wrap">
          <table className="rem-table">
            <thead>
              <tr>
                {th('Category', 'category')}
                {th('Reminder / Property / Item', 'title')}
                {th('Owner', 'owner')}
                {th('Due Date', 'due_date')}
                {th('Renewal Date', 'renewal_date')}
                {th('Status', 'status')}
                <th>Reminder</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <Icon name="bell" size={40} color="var(--rem-ink-soft)" />
                      <div className="big">No reminders found</div>
                      <div className="small">Try adjusting your search or filters.</div>
                    </div>
                  </td>
                </tr>
              ) : pageItems.map(r => {
                const status = r._status
                return (
                  <tr key={r.id}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                        <Icon name={categoryIcon(r.category)} size={14} />
                        {categoryLabel(r.category)}
                      </span>
                    </td>
                    <td>
                      <div
                        style={{ fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={r.title || ''}
                      >
                        {r.title || '—'}
                      </div>
                      {r.notes && (
                        <div style={{ fontSize: 11, color: 'var(--rem-ink-soft)', marginTop: 2, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.notes}>
                          {r.notes}
                        </div>
                      )}
                    </td>
                    <td>{r.owner || '—'}</td>
                    <td>{r.due_date_display || formatDate(r.due_date)}</td>
                    <td>{r.renewal_date_display || formatDate(r.renewal_date)}</td>
                    <td>
                      <span className="status-badge">
                        <span className={`status-dot ${status === 'Overdue' ? 'dot-overdue' : status === 'Due Today' || status === 'Due Tomorrow' ? 'dot-due-today' : status === 'Due Soon' ? 'dot-due-soon' : status === 'Completed' ? 'dot-completed' : status === 'Snoozed' ? 'dot-snoozed' : 'dot-upcoming'}`} />
                        <span className={`pill ${statusPillClass(status)}`}>{status}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`pill ${r.reminder_enabled ? 'pill-overdue' : 'pill-neutral'}`}>
                        {r.reminder_enabled ? 'ON' : 'OFF'}
                      </span>
                      {r.reminder_enabled && r.reminder_time && (
                        <div style={{ fontSize: 11, color: 'var(--rem-ink-soft)', marginTop: 2 }}>
                          {r.reminder_time} · {r.reminder_minutes_before != null ? `${r.reminder_minutes_before} min` : 'at due'}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="cell-actions">
                        {onComplete && status !== 'Completed' && (
                          <button className="mini-btn" title="Complete" onClick={() => onComplete(r.id)}>
                            <Icon name="check" size={13} />
                          </button>
                        )}
                        {onSnooze && status !== 'Completed' && (
                          <button className="mini-btn" title="Snooze" onClick={() => onSnooze(r)}>
                            <Icon name="moon" size={13} />
                          </button>
                        )}
                        {onEdit && (
                          <button className="mini-btn" title="Edit" onClick={() => onEdit(r)}>
                            <Icon name="edit" size={13} />
                          </button>
                        )}
                        {onHistory && (
                          <button className="mini-btn" title="View History" onClick={() => onHistory(r)}>
                            <Icon name="history" size={13} />
                          </button>
                        )}
                        {onDelete && (
                          <button className="mini-btn danger" title="Delete" onClick={() => onDelete(r)}>
                            <Icon name="trash" size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="pagination">
            <span style={{ fontSize: 12, color: 'var(--rem-ink-soft)' }}>
              Showing {pageStart + 1}–{pageEnd} of {filtered.length}
            </span>
            <div className="pages">
              <button className="page-btn" disabled={safePage <= 1} onClick={() => setPage(1)}>&laquo;</button>
              <button className="page-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>&lsaquo;</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('...')
                  acc.push(p)
                  return acc
                }, [])
                .map((item, i) => (
                  item === '...'
                    ? <span key={`e${i}`} style={{ padding: '0 4px', fontSize: 12, color: 'var(--rem-ink-soft)' }}>…</span>
                    : <button
                        key={item}
                        className={`page-btn ${item === safePage ? 'active' : ''}`}
                        onClick={() => setPage(item)}
                      >
                        {item}
                      </button>
                ))
              }
              <button className="page-btn" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>&rsaquo;</button>
              <button className="page-btn" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>&raquo;</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

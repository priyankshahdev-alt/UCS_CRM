import { useState, useMemo, useEffect } from 'react'
import { useRem } from './store'
import { CATEGORIES, daysLeft, statusPillClass, categoryLabel, categoryIcon } from './helpers'
import { computeEffectiveDueDate } from './notifications'
import { Icon } from './components'
import { toast } from './Toast'
import { buildReminderItems } from './reminderSeedData'

const STATUS_OPTIONS = ['Overdue', 'Due Today', 'Due Tomorrow', 'Due Soon', 'Upcoming', 'Completed', 'Snoozed']
const PAGE_SIZE = 20

const VIEW_FILTERS = {
  completed: 'completed',
  overdue: 'overdue',
  dueToday: 'dueToday',
  dueTomorrow: 'dueTomorrow',
  dueThisWeek: 'dueThisWeek',
  upcoming: 'upcoming',
  renewalsThisMonth: 'renewalsThisMonth',
  attention: 'attention',
}

function isCategoryKey(val) {
  return CATEGORIES.some(c => c.key === val)
}

function matchesView(r, viewKey) {
  if (r.completed_at) return viewKey === 'completed'
  const effectiveDate = computeEffectiveDueDate(r)
  const dl = effectiveDate ? daysLeft(effectiveDate) : daysLeft(r.due_date)
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
    case 'attention': return dl !== null && dl <= 7
    default: return true
  }
}

function itemStatus(it) {
  const due = it.due || ''
  if (/paid by tenant/i.test(due) || /paid by tenant/i.test(it.notes || '')) return 'Upcoming'
  const eff = computeEffectiveDueDate(it)
  if (!eff) return 'Upcoming'
  const dl = daysLeft(eff)
  if (dl === null) return 'Upcoming'
  if (dl < 0) return 'Overdue'
  if (dl === 0) return 'Due Today'
  if (dl === 1) return 'Due Tomorrow'
  if (dl <= 7) return 'Due Soon'
  return 'Upcoming'
}

export default function AllReminders({ onAdd, onEdit, onDelete, onHistory }) {
  const { reminders, activeFilter, setActiveFilter } = useRem()

  const sourceItems = useMemo(() => buildReminderItems(), [])

  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [activeFilter, search, ownerFilter, statusFilter])

  const owners = useMemo(() => {
    const set = new Set()
    sourceItems.forEach(it => { if (it.owner) set.add(it.owner) })
    return Array.from(set).sort()
  }, [sourceItems])

  const filtered = useMemo(() => {
    let list = sourceItems.map(it => ({ ...it, _status: itemStatus(it) }))

    if (activeFilter && !isCategoryKey(activeFilter)) {
      const viewKey = VIEW_FILTERS[activeFilter]
      if (viewKey) list = list.filter(it => matchesView(it, activeFilter))
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(it =>
        it.title.toLowerCase().includes(q) ||
        (it.owner || '').toLowerCase().includes(q) ||
        categoryLabel(it.category).toLowerCase().includes(q) ||
        it._group.toLowerCase().includes(q) ||
        it._sub.toLowerCase().includes(q) ||
        it.frequency.toLowerCase().includes(q) ||
        it.due.toLowerCase().includes(q) ||
        it.renewal.toLowerCase().includes(q) ||
        it.lastPaid.toLowerCase().includes(q) ||
        it.paidAmount.toLowerCase().includes(q) ||
        it.notes.toLowerCase().includes(q)
      )
    }

    const effectiveCat = isCategoryKey(activeFilter) ? activeFilter : ''
    if (effectiveCat) list = list.filter(it => it.category === effectiveCat)

    if (ownerFilter) list = list.filter(it => it.owner === ownerFilter)

    const effectiveStatus =
      activeFilter === 'completed' ? 'Completed'
        : activeFilter === 'overdue' ? 'Overdue'
        : statusFilter
    if (effectiveStatus) list = list.filter(it => it._status === effectiveStatus)

    return list
  }, [sourceItems, activeFilter, search, ownerFilter, statusFilter])

  const displayRows = useMemo(() => {
    const rows = []
    let lastGroup = null
    let lastSub = null
    for (const it of filtered) {
      if (it._group !== lastGroup) {
        rows.push({ kind: 'group', label: it._group })
        lastGroup = it._group
        lastSub = null
      }
      if (it._sub && it._sub !== lastSub) {
        rows.push({ kind: 'sub', label: it._sub })
        lastSub = it._sub
      }
      rows.push({ kind: 'item', it })
    }
    return rows
  }, [filtered])

  const itemCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(displayRows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageItems = displayRows.slice(pageStart, pageStart + PAGE_SIZE)
  const pageEnd = Math.min(pageStart + PAGE_SIZE, displayRows.length)

  const handleCategoryChange = (val) => {
    setActiveFilter(val || '')
    setPage(1)
  }

  const clearFilters = () => {
    setSearch('')
    setOwnerFilter('')
    setStatusFilter('')
    setActiveFilter('')
    setPage(1)
  }

  const resolveDbItem = (it) => {
    const cat = it.category
    const title = it.title || ''
    const ownerKey = it.owner || ''
    let found = reminders.find(r =>
      r.category === cat &&
      String(r.title || '') === title &&
      String(r.owner || '') === ownerKey
    )
    if (found) return found
    if (it._sub) {
      found = reminders.find(r =>
        r.category === cat &&
        String(r.title || '') === it._sub &&
        String(r.owner || '') === title
      )
      if (found) return found
      found = reminders.find(r =>
        r.category === cat &&
        String(r.title || '').startsWith(title) &&
        String(r.title || '').includes(it._sub)
      )
      if (found) return found
    }
    if (it._sub === 'Rent TDS' && cat === 'RENT_TDS') {
      found = reminders.find(r =>
        r.category === cat &&
        String(r.owner || '') === title &&
        / TDS$/i.test(String(r.title || ''))
      )
      if (found) return found
    }
    return null
  }

  const handleAction = (it, kind) => {
    const dbItem = resolveDbItem(it)
    if (!dbItem) {
      toast('Could not find the matching saved reminder for this row', 'error')
      return
    }
    if (kind === 'edit') onEdit?.(dbItem)
    else if (kind === 'history') onHistory?.(dbItem.id, dbItem)
    else if (kind === 'delete') onDelete?.(dbItem)
  }

  const actionBtnStyle = {
    padding: 4,
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  const effectiveCat = isCategoryKey(activeFilter) ? activeFilter : ''
  const hasFilters = search || ownerFilter || statusFilter || activeFilter

  const activeLabel = activeFilter ? (isCategoryKey(activeFilter) ? categoryLabel(activeFilter) : (
    VIEW_FILTERS[activeFilter]
      ? ({ completed: 'Completed', overdue: 'Overdue', dueToday: 'Due Today', dueTomorrow: 'Due Tomorrow', dueThisWeek: 'Due This Week', upcoming: 'Upcoming', renewalsThisMonth: 'Renewals This Month', attention: 'Needs Attention' })[activeFilter]
      : 'All Reminders'
  )) : 'All Reminders'

  return (
    <>
      <div className="card-block" style={{ marginTop: 20 }}>
        <div className="tb">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="bell" size={18} />
            <h3>{activeLabel}</h3>
            <span className="pill pill-upcoming">{itemCount} reminder{itemCount !== 1 ? 's' : ''}</span>
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
                <th>Category</th>
                <th>Reminder / Property / Item</th>
                <th>Owner</th>
                <th>Due Date</th>
                <th>Renewal Date</th>
                <th>Last Paid Date</th>
                <th>Paid Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-state">
                      <Icon name="bell" size={40} color="var(--rem-ink-soft)" />
                      <div className="big">No reminders found</div>
                      <div className="small">Try adjusting your search or filters.</div>
                    </div>
                  </td>
                </tr>
              ) : pageItems.map((row, i) => {
                if (row.kind === 'group') {
                  return (
                    <tr className="rem-group-row" key={`g-${i}-${row.label}`}>
                      <td colSpan={9}>
                        <span className="rem-heading-label">{row.label}</span>
                      </td>
                    </tr>
                  )
                }
                if (row.kind === 'sub') {
                  return (
                    <tr className="rem-subgroup-row" key={`s-${i}-${row.label}`}>
                      <td colSpan={9}>
                        <span className="rem-heading-label sub">{row.label}</span>
                      </td>
                    </tr>
                  )
                }
                const it = row.it
                const status = it._status
                return (
                  <tr key={`i-${it._seq}`}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                        <Icon name={categoryIcon(it.category)} size={14} />
                        {categoryLabel(it.category)}
                      </span>
                    </td>
                    <td>
                      <div
                        style={{ fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={it.title || ''}
                      >
                        {it.title || '—'}
                      </div>
                      {it.notes && (
                        <div style={{ fontSize: 11, color: 'var(--rem-ink-soft)', marginTop: 2 }}>{it.notes}</div>
                      )}
                    </td>
                    <td>{it.owner || '—'}</td>
                    <td>{it.due || '—'}</td>
                    <td>{it.renewal || '—'}</td>
                    <td>{it.lastPaid || '—'}</td>
                    <td>{it.paidAmount || '—'}</td>
                    <td>
                      <span className="status-badge">
                        <span className={`status-dot ${status === 'Overdue' ? 'dot-overdue' : status === 'Due Today' || status === 'Due Tomorrow' ? 'dot-due-today' : status === 'Due Soon' ? 'dot-due-soon' : status === 'Completed' ? 'dot-completed' : status === 'Snoozed' ? 'dot-snoozed' : 'dot-upcoming'}`} />
                        <span className={`pill ${statusPillClass(status)}`}>{status}</span>
                      </span>
                    </td>
                    <td>
                      <div className="cell-actions">
                        <button className="rem-btn sm" style={actionBtnStyle} title="Edit reminder" onClick={() => handleAction(it, 'edit')}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button className="rem-btn sm" style={actionBtnStyle} title="View history" onClick={() => handleAction(it, 'history')}>
                          <Icon name="history" size={14} />
                        </button>
                        <button className="rem-btn sm danger" style={actionBtnStyle} title="Delete reminder" onClick={() => handleAction(it, 'delete')}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {displayRows.length > 0 && (
          <div className="pagination">
            <span style={{ fontSize: 12, color: 'var(--rem-ink-soft)' }}>
              Showing {pageStart + 1}–{pageEnd} of {displayRows.length}
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
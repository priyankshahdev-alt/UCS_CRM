import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/auth'
import { useUcs } from '../../../store'
import { LockKey, ShieldCheck, UsersThree, Clock, MagnifyingGlass, ArrowLeft, Plus, PencilSimple, Trash, Eye, EyeSlash } from '@phosphor-icons/react'

const PIN_KEY = 'sa_attendance_pin'
const STATUSES = ['present', 'late', 'absent', 'leave']

function getPinKey(user) {
  return `${PIN_KEY}:${user?.id || user?.email || 'super-admin'}`
}

function formatDate(value) {
  if (!value) return '-'
  const [year, month, day] = String(value).split('T')[0].split('-')
  return `${day}-${month}-${year}`
}

function formatTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dateForInput(value) {
  return value ? String(value).split('T')[0] : ''
}

function timeForInput(value) {
  return value ? new Date(value).toTimeString().slice(0, 5) : ''
}

function toIso(date, time) {
  return date && time ? new Date(`${date}T${time}`).toISOString() : null
}

function StatusBadge({ status }) {
  return <span className={`sa-att-status sa-att-status-${status || 'unknown'}`}>{status || 'Unknown'}</span>
}

function PinGate({ pinKey, onUnlock }) {
  const hasPin = Boolean(localStorage.getItem(pinKey))
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    setError('')
    if (!/^\d{4,6}$/.test(pin)) return setError('Use a 4 to 6 digit PIN.')
    if (!hasPin && pin !== confirm) return setError('The PINs do not match.')
    if (hasPin && pin !== localStorage.getItem(pinKey)) return setError('That PIN is incorrect.')
    if (!hasPin) localStorage.setItem(pinKey, pin)
    onUnlock()
  }

  return (
    <div className="sa-att-lock-page">
      <div className="sa-att-lock-glow" />
      <div className="sa-att-lock-card">
        <div className="sa-att-lock-icon"><LockKey size={30} weight="duotone" /></div>
        <div className="sa-att-lock-kicker">Restricted workspace</div>
        <h3>{hasPin ? 'Unlock attendance' : 'Create your attendance PIN'}</h3>
        <p>{hasPin ? 'This page is protected on this device. Enter your PIN to continue.' : 'Add a private PIN for this sensitive attendance workspace. You will need it every time you return.'}</p>
        <form onSubmit={submit} className="sa-att-pin-form">
          <label className="sa-att-pin-field">
            <span>{hasPin ? 'Enter PIN' : 'New PIN'}</span>
            <div>
              <input autoFocus inputMode="numeric" maxLength={6} type={showPin ? 'text' : 'password'} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4 - 6 digits" />
              <button type="button" onClick={() => setShowPin(value => !value)} aria-label={showPin ? 'Hide PIN' : 'Show PIN'}>{showPin ? <EyeSlash size={18} /> : <Eye size={18} />}</button>
            </div>
          </label>
          {!hasPin && <label className="sa-att-pin-field"><span>Confirm PIN</span><input inputMode="numeric" maxLength={6} type="password" value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))} placeholder="Repeat your PIN" /></label>}
          {error && <div className="sa-att-pin-error">{error}</div>}
          <button className="sa-att-primary-btn" type="submit"><LockKey size={17} /> {hasPin ? 'Unlock workspace' : 'Secure workspace'}</button>
        </form>
        <div className="sa-att-lock-note"><ShieldCheck size={16} /> Your PIN is stored only in this browser.</div>
      </div>
    </div>
  )
}

function RecordModal({ record, worker, onClose, onSave, onDelete }) {
  const [date, setDate] = useState(dateForInput(record?.date))
  const [punchIn, setPunchIn] = useState(timeForInput(record?.punch_in_time))
  const [punchOut, setPunchOut] = useState(timeForInput(record?.punch_out_time))
  const [status, setStatus] = useState(record?.status || 'present')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!date) return
    setSaving(true)
    try {
      await onSave({ date, punch_in_time: toIso(date, punchIn), punch_out_time: toIso(date, punchOut), status })
    } finally { setSaving(false) }
  }

  return <div className="sa-att-modal-backdrop" onClick={onClose}>
    <div className="sa-att-modal" onClick={e => e.stopPropagation()}>
      <div className="sa-att-modal-head"><div><div className="sa-att-kicker">{record?.id ? 'Update record' : 'New record'}</div><h3>{record?.id ? 'Edit attendance' : 'Add attendance'}</h3></div><button className="sa-att-close" onClick={onClose}>x</button></div>
      <div className="sa-att-modal-body">
        <label>Worker<input value={worker?.name || ''} disabled /></label>
        <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <div className="sa-att-form-grid"><label>Punch in<input type="time" value={punchIn} onChange={e => setPunchIn(e.target.value)} /></label><label>Punch out<input type="time" value={punchOut} onChange={e => setPunchOut(e.target.value)} /></label></div>
        <label>Status<select value={status} onChange={e => setStatus(e.target.value)}>{STATUSES.map(item => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>
      </div>
      <div className="sa-att-modal-foot">{record?.id && <button className="sa-att-delete-btn" onClick={() => onDelete(record.id)}><Trash size={16} /> Delete</button>}<span /><button className="sa-att-secondary-btn" onClick={onClose}>Cancel</button><button className="sa-att-primary-btn" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save record'}</button></div>
    </div>
  </div>
}

export default function AdminAttendance() {
  const { user } = useUcs()
  const pinKey = getPinKey(user)
  const [unlocked, setUnlocked] = useState(false)
  const [records, setRecords] = useState([])
  const [workers, setWorkers] = useState([])
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))

  useEffect(() => {
    if (!unlocked) return
    setLoading(true)
    Promise.all([api('/attendance/all'), api('/workers')]).then(([attendance, workerList]) => { setRecords(Array.isArray(attendance) ? attendance : []); setWorkers(Array.isArray(workerList) ? workerList : []) }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [unlocked])

  const workerMap = useMemo(() => Object.fromEntries(workers.map(worker => [worker.id, worker])), [workers])
  const visibleWorkers = useMemo(() => workers.filter(worker => !search || `${worker.name || ''} ${worker.login_id || ''}`.toLowerCase().includes(search.toLowerCase())), [workers, search])
  const monthRecords = records.filter(record => String(record.date || '').startsWith(month))
  const stats = STATUSES.map(status => ({ status, count: monthRecords.filter(record => record.status === status).length }))

  async function reload() {
    const data = await api('/attendance/all')
    setRecords(Array.isArray(data) ? data : [])
  }

  async function saveRecord(data) {
    if (modal?.id) await api(`/attendance/${modal.id}`, { method: 'PUT', body: JSON.stringify(data) })
    else await api('/attendance', { method: 'POST', body: JSON.stringify({ ...data, worker_id: selected.id }) })
    await reload(); setModal(null)
  }

  async function deleteRecord(id) {
    if (!window.confirm('Delete this attendance record?')) return
    await api(`/attendance/${id}`, { method: 'DELETE' }); await reload(); setModal(null)
  }

  if (!unlocked) return <PinGate pinKey={pinKey} onUnlock={() => setUnlocked(true)} />
  if (selected) {
    const workerRecords = records.filter(record => record.worker_id === selected.id && String(record.date || '').startsWith(month)).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    return <div className="sa-page sa-att-page"><div className="sa-att-detail-head"><button className="sa-att-back" onClick={() => setSelected(null)}><ArrowLeft size={18} /> Employees</button><div><div className="sa-att-kicker">Attendance profile</div><h3>{selected.name}</h3><p>{selected.department || 'Employee'}{selected.login_id ? `  /  ${selected.login_id}` : ''}</p></div><div className="sa-att-detail-actions"><input type="month" value={month} onChange={e => setMonth(e.target.value)} /><button className="sa-att-primary-btn" onClick={() => setModal({})}><Plus size={17} /> Add record</button></div></div><div className="sa-att-table-card"><table className="sa-table"><thead><tr><th>Date</th><th>Status</th><th>Punch in</th><th>Punch out</th><th /></tr></thead><tbody>{workerRecords.map(record => <tr key={record.id}><td>{formatDate(record.date)}</td><td><StatusBadge status={record.status} /></td><td>{formatTime(record.punch_in_time)}</td><td>{formatTime(record.punch_out_time)}</td><td className="sa-att-row-action"><button onClick={() => setModal(record)}><PencilSimple size={16} /></button></td></tr>)}{!workerRecords.length && <tr><td colSpan="5" className="sa-att-empty">No attendance records for this month.</td></tr>}</tbody></table></div>{modal && <RecordModal record={modal} worker={selected} onClose={() => setModal(null)} onSave={saveRecord} onDelete={deleteRecord} />}</div>
  }

  return <div className="sa-page sa-att-page"><div className="sa-att-hero"><div><div className="sa-att-kicker">Operations / People</div><h3>Admin attendance</h3><p>Review employee attendance and make corrections from one protected workspace.</p></div><div className="sa-att-hero-icon"><Clock size={34} weight="duotone" /></div></div><div className="sa-att-stat-grid">{stats.map(item => <div className="sa-att-stat" key={item.status}><span className={`sa-att-stat-dot sa-att-stat-dot-${item.status}`} /><div><strong>{item.count}</strong><small>{item.status}</small></div></div>)}<div className="sa-att-stat"><span className="sa-att-stat-dot sa-att-stat-dot-total" /><div><strong>{workers.length}</strong><small>employees</small></div></div></div><div className="sa-att-toolbar"><div className="sa-att-search"><MagnifyingGlass size={18} /><input placeholder="Search employee or login ID" value={search} onChange={e => setSearch(e.target.value)} /></div><input type="month" value={month} onChange={e => setMonth(e.target.value)} /><div className="sa-att-protected"><ShieldCheck size={17} /> Protected</div></div>{error && <div className="sa-err-card">{error}</div>}{loading ? <div className="sa-att-loading">Loading attendance...</div> : <div className="sa-att-employee-grid">{visibleWorkers.map(worker => { const count = monthRecords.filter(record => record.worker_id === worker.id).length; const present = monthRecords.filter(record => record.worker_id === worker.id && ['present', 'late'].includes(record.status)).length; return <button className="sa-att-employee" key={worker.id} onClick={() => setSelected(worker)}><div className="sa-att-avatar">{(worker.name || '?').slice(0, 1).toUpperCase()}</div><div className="sa-att-employee-copy"><strong>{worker.name || 'Unknown employee'}</strong><span>{worker.department || 'No department'}</span><small>{present} present days <i /> {count} records</small></div><span className="sa-att-arrow">→</span></button> })}{!visibleWorkers.length && <div className="sa-att-empty">No employees match your search.</div>}</div>}</div>
}

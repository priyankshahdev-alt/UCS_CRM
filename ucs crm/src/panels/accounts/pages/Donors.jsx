import { useState, useEffect, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/auth'
import { UserCog, Trash2, MapPin, AlertCircle, CheckCircle2, X } from 'lucide-react'
import { useUcs } from '../../../store'

// Soft accent palette cycled per NGO so each assignment card is instantly
// recognizable even when a donor spans several NGOs.
const NGO_TONES = [
  { bg: '#E8EDE1', fg: '#44543a', dot: '#5B6B4E' },
  { bg: '#F6EAD0', fg: '#7a5a17', dot: '#C08A2E' },
  { bg: '#F4E4DA', fg: '#8a4626', dot: '#B5603A' },
  { bg: '#E3ECF3', fg: '#33566e', dot: '#48789b' },
  { bg: '#EDE7F1', fg: '#5d4370', dot: '#825aa0' },
]
const ngoTone = (id) => {
  let h = 0
  const s = String(id ?? '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return NGO_TONES[h % NGO_TONES.length]
}

const initialsOf = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

const currency = (n) => {
  if (n == null || isNaN(n)) return '\u20B90'
  return '\u20B9' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

const SkeletonNum = ({ w = 48 }) => (
  <span className="sk-num" style={{ display: 'inline-block', width: w, height: 24, borderRadius: 6, background: 'linear-gradient(90deg,var(--bg) 25%,var(--line) 50%,var(--bg) 75%)', backgroundSize: '200% 100%', animation: 'sk-shimmer 1.4s infinite' }} />
)

const SkeletonRow = ({ cols }) => (
  <tr>{Array.from({ length: cols }, (_, i) => <td key={i}><span className="sk-num" style={{ display: 'inline-block', width: i === 0 ? 140 : i === 1 ? 110 : i === 2 ? 90 : i === 3 ? 80 : i === 4 ? 60 : 90, height: 14, borderRadius: 4, background: 'linear-gradient(90deg,var(--bg) 25%,var(--line) 50%,var(--bg) 75%)', backgroundSize: '200% 100%', animation: 'sk-shimmer 1.4s infinite' }} /></td>)}</tr>
)

const StatCard = ({ icon, label, value, color, loading: l }) => (
  <div className="stat-card">
    <div className="stat-icon" style={{ background: color + '18', color }}>{icon}</div>
    <div className="stat-info">
      {l ? <SkeletonNum w={72} /> : <div className="stat-num">{value}</div>}
      <div className="stat-lbl">{label}</div>
    </div>
  </div>
)

const DONOR_FIELDS = [
  ['name', 'Full Name'], ['mobile_number', 'Mobile Number'], ['mobile_2', 'Mobile 2'], ['email', 'Email'],
  ['address_1', 'Address Line 1'], ['address_2', 'Address Line 2'],
  ['pan_number', 'PAN Card'],
]

const fieldVal = (d, key) => {
  const v = d?.[key]
  if (v == null) return ''
  return String(v).slice(0, 10)
}

const inputStyle = { width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink)', background: '#fff', boxSizing: 'border-box' }

function DonorDetail({ donorId, onClose, onChanged, ngoOptions }) {
  const { user } = useUcs()
  const canManage = ['accounts', 'admin', 'super_admin'].includes(user?.role) || ['accounts', 'admin'].includes(user?.department)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [agents, setAgents] = useState([])
  const [stationOpts, setStationOpts] = useState([])
  const [assignmentForm, setAssignmentForm] = useState({ ngo_id: '', worker_id: '', station: '' })
  const [editingAssignmentId, setEditingAssignmentId] = useState(null)
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [assignmentErr, setAssignmentErr] = useState('')

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const loadDetail = useCallback((id) => {
    setLoading(true)
    apiGet('/accounts/donors/' + id)
      .then(r => setData(r))
      .catch(e => console.error('Error:', e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadDetail(donorId) }, [donorId, loadDetail])

  useEffect(() => {
    if (!canManage) return
    Promise.all([
      apiGet('/accounts/receipts/fro-workers'),
      apiGet('/accounts/stations-options'),
    ]).then(([workerRows, stationRows]) => {
      setAgents(Array.isArray(workerRows) ? workerRows : [])
      setStationOpts(stationRows?.options || [])
    }).catch(e => setAssignmentErr(e.message))
  }, [canManage])

  const startEdit = () => {
    if (!data?.donor) return
    const f = {}
    for (const [key] of DONOR_FIELDS) f[key] = fieldVal(data.donor, key)
    setForm(f)
    setSaveErr('')
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setSaveErr('') }

  const saveEdit = async () => {
    if (!data?.donor || saving) return
    const changes = {}
    for (const [key] of DONOR_FIELDS) {
      if ((form[key] || '') !== fieldVal(data.donor, key)) changes[key] = form[key]
    }
    if (Object.keys(changes).length === 0) { setEditing(false); return }
    setSaving(true)
    setSaveErr('')
    try {
      await apiPatch('/accounts/donors/' + donorId, changes)
      setEditing(false)
      loadDetail(donorId)
      if (onChanged) onChanged()
    } catch (e) {
      setSaveErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const refreshDetail = () => {
    setEditingAssignmentId(null)
    setAssignmentForm({ ngo_id: '', worker_id: '', station: '' })
    setAssignmentErr('')
    loadDetail(donorId)
    if (onChanged) onChanged()
  }

  const startAssignmentEdit = (assignment) => {
    setAssignmentErr('')
    setEditingAssignmentId(assignment.id)
    setAssignmentForm({ ngo_id: assignment.ngo_id || '', worker_id: assignment.worker_id || '', station: assignment.station || '' })
  }

  const saveAssignment = async (event) => {
    event.preventDefault()
    if (assignmentBusy) return
    const { ngo_id, worker_id, station } = assignmentForm
    if (!ngo_id || !worker_id || !String(station).trim()) {
      setAssignmentErr('Select an NGO, active FRO agent, and station')
      return
    }
    setAssignmentBusy(true)
    setAssignmentErr('')
    try {
      if (editingAssignmentId) {
        await apiPatch(`/accounts/donors/${donorId}/assignments/${editingAssignmentId}/replace`, {
          fro_worker_id: worker_id,
          station: String(station).trim(),
        })
      } else {
        await apiPost(`/accounts/donors/${donorId}/assignments`, {
          fro_worker_id: worker_id,
          ngo_id,
          station: String(station).trim(),
        })
      }
      refreshDetail()
    } catch (e) {
      setAssignmentErr(e.message)
    } finally {
      setAssignmentBusy(false)
    }
  }

  const removeAssignment = async (assignment) => {
    if (!window.confirm(`Remove ${assignment.worker_name || 'this agent'} from this donor? The worker account will not be deleted.`)) return
    setAssignmentBusy(true)
    setAssignmentErr('')
    try {
      await apiDelete(`/accounts/donors/${donorId}/assignments/${assignment.id}`)
      refreshDetail()
    } catch (e) {
      setAssignmentErr(e.message)
    } finally {
      setAssignmentBusy(false)
    }
  }

  const deleteDonor = async () => {
    const name = data?.donor?.name || data?.donor?.mobile_number || 'this donor'
    if (!window.confirm(`Permanently delete ${name}? This removes the donor profile, FRO assignments, call logs, and schedules. Financial receipts will be kept but detached. This cannot be undone.`)) return
    setAssignmentBusy(true)
    setAssignmentErr('')
    try {
      await apiDelete(`/accounts/donors/${donorId}`)
      if (onChanged) onChanged()
      onClose()
    } catch (e) {
      setAssignmentErr(e.message)
      setAssignmentBusy(false)
    }
  }

  if (loading) return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520, width: '90%', padding: 32 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <SkeletonNum w={44} /><div style={{ flex: 1 }}><SkeletonNum w={160} /><div style={{ marginTop: 6 }}><SkeletonNum w={100} /></div></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          {Array.from({ length: 4 }, (_, i) => <div key={i}><SkeletonNum w={60} /><div style={{ marginTop: 6 }}><SkeletonNum w={100} /></div></div>)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 4 }, (_, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}><SkeletonNum w={8} /><div style={{ flex: 1 }}><SkeletonNum w={i % 2 === 0 ? 180 : 140} /></div><SkeletonNum w={70} /></div>)}
        </div>
      </div>
    </div>
  )

  if (!data || !data.donor) return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520, width: '90%', padding: 40, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }} onClick={e => e.stopPropagation()}>
        Failed to load donor details
      </div>
    </div>
  )

  const d = data.donor
  const receipts = data.receipts || []
  const initial = (d.name || d.bank_donor_name || d.agent_donor_name || '?')[0].toUpperCase()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560, width: '92%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-head" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="stat-icon" style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>{initial}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{d.name || d.bank_donor_name || d.agent_donor_name || 'Donor'}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 1 }}>{d.mobile_number || ''} &middot; <strong>{data.receiptCount}</strong> receipt{data.receiptCount !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!editing && <button className="btn btn-sm btn-primary" onClick={startEdit}>Edit</button>}
            <button onClick={onClose} className="btn btn-icon" title="Close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto', padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14, background: 'var(--bg)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
            <div><div style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4 }}>First Donation</div><div style={{ fontSize: 12, color: 'var(--ink)' }}>{d.first_donation_date ? new Date(d.first_donation_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4 }}>Last Donation</div><div style={{ fontSize: 12, color: 'var(--ink)' }}>{d.last_donation_date ? new Date(d.last_donation_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4 }}>Lifetime Total</div><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sage)' }}>{currency(d.total_amount)}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4 }}>Donations</div><div style={{ fontSize: 12, color: 'var(--ink)' }}>{data.receiptCount}</div></div>
          </div>

          {!editing ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
              {DONOR_FIELDS.map(([key, label]) => {
                const v = fieldVal(data.donor, key)
                return (
                  <div key={key} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4 }}>{label}</div>
                    <div style={{ fontSize: 13, color: v ? 'var(--ink)' : 'var(--ink-soft)', fontFamily: key === 'pan_number' || key.startsWith('mobile') ? 'monospace' : undefined, wordBreak: 'break-word' }}>
                      {v || '\u2014'}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); saveEdit() }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 12px' }}>
                {DONOR_FIELDS.map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4 }}>{label}</span>
                    <input
                      type="text"
                      value={form[key] ?? ''}
                      onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                      style={inputStyle}
                    />
                  </label>
                ))}
              </div>
              {saveErr && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>Save failed: {saveErr}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 6 }}>
                <button type="button" className="btn btn-sm" onClick={cancelEdit} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </form>
          )}

          {canManage && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5 }}>Agent assignments</div>
                <button className="btn btn-sm" onClick={() => { setEditingAssignmentId(null); setAssignmentForm({ ngo_id: ngoOptions[0]?.id || '', worker_id: '', station: '' }); setAssignmentErr('') }} disabled={assignmentBusy}>Add agent</button>
              </div>
              {(data.assignments || []).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', padding: '8px 0' }}>No active agent assigned.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {data.assignments.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 7, background: '#fff' }}>
                      <UserCog size={14} style={{ color: 'var(--sage)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                        <strong>{a.worker_name || 'Unassigned'}</strong>
                        <div style={{ color: 'var(--ink-soft)', marginTop: 2 }}>{a.ngo_name || 'NGO'} · {a.station || 'No station'}</div>
                      </div>
                      <button className="btn btn-sm" onClick={() => startAssignmentEdit(a)} disabled={assignmentBusy}>Replace</button>
                      <button className="btn btn-sm" onClick={() => removeAssignment(a)} disabled={assignmentBusy} title="Remove assignment" style={{ color: '#b91c1c' }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              {(editingAssignmentId || assignmentForm.worker_id || assignmentForm.ngo_id) && (
                <form onSubmit={saveAssignment} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10, padding: 10, background: 'var(--bg)', borderRadius: 7 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase' }}>
                    NGO
                    <select value={assignmentForm.ngo_id} onChange={e => setAssignmentForm(p => ({ ...p, ngo_id: e.target.value }))} disabled={!!editingAssignmentId} style={inputStyle}>
                      <option value="">Select NGO</option>
                      {ngoOptions.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase' }}>
                    Active FRO agent
                    <select value={assignmentForm.worker_id} onChange={e => setAssignmentForm(p => ({ ...p, worker_id: e.target.value }))} style={inputStyle}>
                      <option value="">Select agent</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase' }}>
                    Station
                    <select value={assignmentForm.station} onChange={e => setAssignmentForm(p => ({ ...p, station: e.target.value }))} style={inputStyle}>
                      <option value="">Select station</option>
                      {stationOpts.map(o => <option key={`${o.ngo_id}|${o.station}`} value={o.station}>{o.station}</option>)}
                    </select>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
                    <button type="submit" className="btn btn-sm btn-primary" disabled={assignmentBusy}>{assignmentBusy ? 'Saving...' : editingAssignmentId ? 'Save replacement' : 'Assign agent'}</button>
                    <button type="button" className="btn btn-sm" onClick={() => { setEditingAssignmentId(null); setAssignmentForm({ ngo_id: '', worker_id: '', station: '' }); setAssignmentErr('') }} disabled={assignmentBusy}>Cancel</button>
                  </div>
                </form>
              )}
              {assignmentErr && <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '7px 9px', marginTop: 8 }}><AlertCircle size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />{assignmentErr}</div>}
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, margin: '14px 0 10px' }}>Receipts</div>
          {receipts.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', padding: 24, margin: 0 }}>No receipts found</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {receipts.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < receipts.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink-soft)', flexShrink: 0, opacity: .4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'monospace', color: 'var(--ink)' }}>{r.receipt_no}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.receipt_date ? new Date(r.receipt_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>{r.mode || ''}{r.project_id ? ` \u00B7 ${r.project_id}` : ''}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sage)', whiteSpace: 'nowrap' }}>{currency(r.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canManage && <button className="btn btn-sm" onClick={deleteDonor} disabled={assignmentBusy} style={{ color: '#b91c1c', borderColor: '#fecaca' }}><Trash2 size={13} /> Delete donor</button>}
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Total donations</span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--sage)' }}>{currency(data.totalAmount)} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-soft)' }}>({data.receiptCount})</span></span>
        </div>
      </div>
    </div>
  )
}

const parseAssignments = (d, ngoFilter = '') => {
  if (Array.isArray(d.assignment_list)) return d.assignment_list
  if (!d.assigned_to) return []
  const parsed = String(d.assigned_to).split(/\s*,\s*/).map(s => {
    const m = s.match(/^(.+?)\s*\(([^)]*)\)(?:\s*—\s*(.*))?$/)
    if (m) return { name: m[1].trim(), station: m[2].trim(), ngo: (m[3] || '').trim() }
    const clean = s.replace(/\s*—\s*.*$/, '').trim()
    return { name: clean, station: '', ngo: '' }
  }).filter(a => a.name)
  if (!ngoFilter) return parsed
  return parsed.filter(a => a.ngo && a.ngo.toLowerCase().includes(ngoFilter.toLowerCase()))
}

const hasBlankStationEntry = (d) =>
  Array.isArray(d.assignment_list) &&
  d.assignment_list.some(a => a.id && a.name && !(a.station && String(a.station).trim() !== ''))

// Mini modal to manage an orphaned donor's agent-assignments: set the missing
// station, swap in a different agent, or delete the assignment outright.
// Station choices come from the real registry so saved strings always match
// queue matching exactly; agents are active FROs from /receipts/fro-workers.
function SetStationModal({ donor, ngoOptions, onClose, onSaved }) {
  const [entries, setEntries] = useState(() =>
    (Array.isArray(donor.assignment_list) ? donor.assignment_list : [])
      .filter(a => a.id && a.name && !(a.station && String(a.station).trim() !== ''))
  )
  const [agents, setAgents] = useState([])
  const [stationOpts, setStationOpts] = useState([])
  const [picks, setPicks] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    apiGet('/accounts/stations-options')
      .then(r => setStationOpts(r.options || []))
      .catch(e => setErr(e.message))
    apiGet('/accounts/receipts/fro-workers')
      .then(r => setAgents(Array.isArray(r) ? r : []))
      .catch(() => {})
  }, [])

  const ngoNameOf = (id) => (ngoOptions.find(n => n.id === id) || {}).name || ''
  // Station choices scoped to the assignment's own NGO first; fall back to the
  // full registry when that NGO has no registered stations yet.
  const optionsFor = (entry) => {
    const own = stationOpts.filter(o => o.ngo_id === entry.ngo_id)
    return own.length > 0 ? own : stationOpts
  }

  const pickOf = (e) => picks[e.id] || { worker_id: '', station: '' }
  const setPick = (id, patch) => setPicks(p => ({ ...p, [id]: { ...(p[id] || { worker_id: '', station: '' }), ...patch } }))
  const changedEntries = () => entries.filter(e => {
    const p = pickOf(e)
    return (p.worker_id && p.worker_id !== e.worker_id) || p.station
  })

  const save = async () => {
    const targets = changedEntries()
    if (targets.length === 0) { setErr('Change an agent or pick a station first'); return }
    for (const t of targets) if (!pickOf(t).station) { setErr('Pick a station for every row you are saving'); return }
    setSaving(true); setErr('')
    try {
      for (const t of targets) {
        const p = pickOf(t)
        await apiPatch(`/accounts/donors/${donor.id}/assignments/${t.id}/replace`, {
          fro_worker_id: p.worker_id || t.worker_id,
          station: p.station,
        })
      }
      onSaved()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const removeAssignment = async (entry) => {
    setBusyId(entry.id); setErr('')
    try {
      await apiDelete(`/accounts/donors/${donor.id}/assignments/${entry.id}`)
      const left = entries.filter(e => e.id !== entry.id)
      setEntries(left)
      setConfirmId(null)
      if (left.length === 0) onSaved()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const changedCount = changedEntries().length
  const agentNameOf = (id) => (agents.find(a => String(a.id) === String(id)) || {}).name || ''

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 540, width: '94%', borderRadius: 'var(--radius)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--line)', background: 'linear-gradient(180deg,#fafbf8, #fff)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--sage-soft, #E8EDE1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#44543a', flexShrink: 0 }}>
                <UserCog size={19} />
              </div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--ink)' }}>Manage Assignments</h3>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{donor.name || 'Donor'}</span>
                  {donor.mobile_number && <span>· {donor.mobile_number}</span>}
                  {donor.city && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={11} />{donor.city}</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} title="Close" style={{ background: 'transparent', border: 'none', color: 'var(--ink-soft)', padding: 6, borderRadius: 8, display: 'flex' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 22px', maxHeight: '62vh', overflowY: 'auto' }}>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
            These assignments are missing a station. Set one, swap the agent, or remove the assignment entirely.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {entries.map(e => {
              const tone = ngoTone(e.ngo_id)
              const p = pickOf(e)
              const modified = (p.worker_id && p.worker_id !== e.worker_id) || p.station
              return (
                <div
                  key={e.id}
                  style={{
                    border: `1px solid ${modified ? 'var(--sage)' : 'var(--line)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 14px',
                    position: 'relative',
                    background: modified ? '#f7f9f5' : '#fff',
                    boxShadow: modified ? '0 0 0 1px var(--sage)' : 'none',
                    transition: 'border-color .15s, box-shadow .15s',
                  }}
                >
                  {modified && (
                    <span title="Unsaved change" style={{ position: 'absolute', top: -5, right: -5, width: 11, height: 11, borderRadius: '50%', background: 'var(--warning, #e67e22)', border: '2px solid #fff' }} />
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: tone.bg, color: tone.fg, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot }} />
                      {ngoNameOf(e.ngo_id) || 'NGO'}
                    </span>
                    {confirmId === e.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--danger)' }}>Remove agent & history?</span>
                        <button onClick={() => removeAssignment(e)} disabled={busyId === e.id} style={{ background: 'var(--danger, #d9534f)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600 }}>
                          {busyId === e.id ? 'Removing…' : 'Yes, remove'}
                        </button>
                        <button onClick={() => setConfirmId(null)} style={{ background: '#fff', color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', fontSize: 11 }}>No</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(e.id)}
                        disabled={busyId === e.id}
                        title="Delete assignment — frees the donor completely"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 9px', fontSize: 11, opacity: busyId === e.id ? .5 : 1 }}
                      >
                        <Trash2 size={12} /> Remove
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {initialsOf(p.worker_id ? agentNameOf(p.worker_id) : e.name)}
                    </div>
                    <div style={{ fontSize: 12 }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{p.worker_id ? (agentNameOf(p.worker_id) || e.name) : e.name}</span>
                      {!p.station && <span style={{ color: 'var(--warning, #e67e22)' }}> · no station yet</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <label style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)' }}>Agent</span>
                      <select
                        value={p.worker_id}
                        onChange={ev => setPick(e.id, { worker_id: ev.target.value })}
                        style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13, background: '#fff', color: 'var(--ink)' }}
                      >
                        {(e.worker_id && !agents.some(a => String(a.id) === String(e.worker_id))
                          ? [{ id: e.worker_id, name: `${e.name}` }]
                          : []
                        ).concat(agents).map(a => (
                          <option key={a.id} value={a.id}>{a.name}{String(a.id) === String(e.worker_id) ? ' — current' : ''}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: p.station && !modified ? 'var(--success)' : 'var(--ink-soft)' }}>Station</span>
                      <select
                        value={p.station}
                        onChange={ev => setPick(e.id, { station: ev.target.value })}
                        style={{ padding: '7px 9px', borderRadius: 8, border: `1px solid ${p.station ? 'var(--success)' : 'var(--line)'}`, fontSize: 13, background: '#fff', color: 'var(--ink)' }}
                      >
                        <option value="">— pick station —</option>
                        {optionsFor(e).map(o => <option key={o.ngo_id + '|' + o.station} value={o.station}>{o.station}</option>)}
                      </select>
                    </label>
                  </div>
                  {modified && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#44543a', background: 'var(--sage-soft, #E8EDE1)', borderRadius: 6, padding: '5px 9px' }}>
                      On save → <strong>{agentNameOf(p.worker_id) || e.name}</strong> picks up this donor at <strong>{p.station}</strong>. Old assignment kept in history.
                    </div>
                  )}
                </div>
              )
            })}
            {entries.length === 0 && (
              <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--success)' }}>
                <CheckCircle2 size={28} style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>All assignments resolved</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Reloading…</div>
              </div>
            )}
          </div>
          {err && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', marginTop: 14 }}>
              <AlertCircle size={14} /> {err}
            </div>
          )}
        </div>

        <div style={{ padding: '13px 22px', borderTop: '1px solid var(--line)', background: '#fafbf8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: changedCount > 0 ? 'var(--warning, #e67e22)' : 'var(--ink-soft)', fontWeight: changedCount > 0 ? 600 : 400 }}>
            {changedCount > 0 ? `${changedCount} unsaved change${changedCount > 1 ? 's' : ''}` : 'No changes yet'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving || changedCount === 0}>
              {saving ? 'Saving…' : `Save${changedCount > 0 ? ` (${changedCount})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Donors() {
  const [donors, setDonors] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [ngoFilter, setNgoFilter] = useState('')
  const [ngoOptions, setNgoOptions] = useState([])
  const [restoring, setRestoring] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [missingOnly, setMissingOnly] = useState(false)
  const [stationDonor, setStationDonor] = useState(null)
  const limit = 100

  useEffect(() => {
    apiGet('/accounts/ngos').then(res => setNgoOptions(Array.isArray(res) ? res : [])).catch(() => {})
  }, [])

  const load = useCallback(async (q, pg, ngo, ms) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q) params.set('search', q)
      if (ngo) params.set('ngo', ngo)
      if (ms) params.set('missing_station', 'true')
      params.set('limit', String(limit))
      params.set('page', String(pg))
      const res = await apiGet('/accounts/donors?' + params.toString())
      setDonors(res.data || [])
      setTotal(res.total || 0)
    } catch (err) { console.error('Error:', err.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(search, page, ngoFilter, missingOnly) }, [load, search, page, ngoFilter, missingOnly])

  const stats = useMemo(() => {
    let amount = 0, count = 0
    for (const d of donors) {
      amount += parseFloat(d.total_amount || 0)
      count += d.donation_count || 0
    }
    return { amount, count }
  }, [donors])

  const totalPages = Math.ceil(total / limit)

  const handleSearch = (e) => {
    setSearch(e.target.value)
    setPage(1)
  }

  const handleNgoChange = (name) => {
    setNgoFilter(name)
    setPage(1)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await apiGet('/accounts/donors/export?' + params.toString())
      const rows = res.data || []
      if (rows.length === 0) {
        alert('No donors to export.')
        return
      }
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Donors')
      XLSX.writeFile(wb, `donors_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      console.error('Export error:', err.message)
      alert('Export failed: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  const handleRestoreWrong = async () => {
    if (!window.confirm('This will remove donors who were manually assigned to FROs they don\'t belong to (no station). Continue?')) return
    setRestoring(true)
    try {
      const res = await apiPost('/accounts/donors/restore-wrong-assignments')
      alert(`Restored ${res?.restored || 0} wrong assignments`)
      load(search, page, ngoFilter, missingOnly)
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setRestoring(false)
    }
  }

  const handleRepairSync = async () => {
    if (!window.confirm('This sets each donor\'s NGO & station from their latest agent assignment, repairing profiles that were never kept in sync. Continue?')) return
    setSyncing(true)
    try {
      const res = await apiPost('/accounts/donors/repair-sync' + (ngoFilter ? `?ngo=${encodeURIComponent(ngoFilter)}` : ''))
      alert(`Repaired ${res?.repaired || 0} donor record(s)`)
      load(search, page, ngoFilter, missingOnly)
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <div className="stats-grid">
        <StatCard icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>} label="Total Donors" value={total} color="#5B6B4E" loading={loading} />
        <StatCard icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>} label="Total Donation Amount" value={currency(stats.amount)} color="#16a34a" loading={loading} />
        <StatCard icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 2 7 2 9 22 9 22 7 12 2"/><rect x="4" y="11" width="3" height="7"/><rect x="10.5" y="11" width="3" height="7"/><rect x="17" y="11" width="3" height="7"/></svg>} label="Total Donations" value={stats.count.toLocaleString('en-IN')} color="#e67e22" loading={loading} />
      </div>

      <div className="card">
        <div className="filter-bar" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginRight: 'auto' }}>
            <button className={`btn btn-sm${ngoFilter === '' ? ' btn-primary' : ''}`} onClick={() => handleNgoChange('')}>All</button>
            {ngoOptions.map(n => (
              <button key={n.id} className={`btn btn-sm${ngoFilter === n.name ? ' btn-primary' : ''}`} onClick={() => handleNgoChange(n.name)}>{n.name}</button>
            ))}
            <button
              className={`btn btn-sm${missingOnly ? ' btn-primary' : ''}`}
              onClick={() => { setMissingOnly(v => !v); setPage(1) }}
              title="Donors whose agent is assigned but station is blank"
              style={missingOnly ? {} : { background: '#fff7ed', color: '#9a3412', border: '1px solid #fdba74' }}
            >
              Missing station
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 'auto' }}>
            <input
              className="search-input"
              placeholder="Search by name, mobile, or city..."
              value={search}
              onChange={handleSearch}
            />
            <button className="btn" onClick={handleExport} disabled={exporting} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
            <button className="btn" onClick={handleRestoreWrong} disabled={restoring} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, background: restoring ? '#e5e7eb' : '#fef3c7', color: '#92400e', border: '1px solid #f59e0b' }}>
              {restoring ? 'Restoring...' : 'Restore Wrong Assignments'}
            </button>
            <button className="btn" onClick={handleRepairSync} disabled={syncing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, background: syncing ? '#e5e7eb' : '#e8f0fe', color: '#1d4ed8', border: '1px solid #93c5fd' }}>
              {syncing ? 'Repairing...' : 'Repair Donor Sync'}
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="donors-table">
            <thead>
              <tr>
                <th>Donor</th>
                <th>Mobile</th>
                <th>Data Category</th>
                <th>Assigned To</th>
                <th>Station</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} cols={5} />)
              ) : donors.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-soft)' }}>No donors found</td></tr>
              ) : donors.map(d => {
                const initial = (d.name || d.bank_donor_name || d.agent_donor_name || '?')[0].toUpperCase()
                const assignments = parseAssignments(d, ngoFilter)
                return (
                  <tr key={d.id} className="clickable-row" onClick={() => setSelectedId(d.id)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{initial}</div>
                        <strong>{d.name || d.bank_donor_name || d.agent_donor_name || '-'}</strong>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-soft)' }}>{d.mobile_number || '-'}</td>
                    <td><span className="pill pill-blue">{d.data_category || d.category || '—'}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--ink-soft)', padding: 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {assignments.length > 0 ? assignments.map((a, i) => (
                          <span key={i} style={{ padding: '9px 10px', borderBottom: i < assignments.length - 1 ? '1px solid var(--line)' : 'none' }}>{a.name || '—'}</span>
                        )) : <span style={{ padding: '9px 10px' }}>—</span>}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-soft)', padding: 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {assignments.length > 0 ? assignments.map((a, i) => (
                          <span key={i} style={{ padding: '9px 10px', borderBottom: i < assignments.length - 1 ? '1px solid var(--line)' : 'none' }}>{a.station || '—'}</span>
                        )) : <span style={{ padding: '9px 10px' }}>—</span>}
                        {hasBlankStationEntry(d) && (
                          <button
                            className="btn btn-sm"
                            onClick={e => { e.stopPropagation(); setStationDonor(d) }}
                            title="Assign the missing station"
                            style={{ margin: '6px 10px', fontSize: 11, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--sage-soft, #E8EDE1)', color: '#44543a', border: '1px solid #cdd9c2', borderRadius: 20, fontWeight: 600, width: 'fit-content' }}
                          >
                            <UserCog size={12} /> Manage
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
      </div>

      {!loading && totalPages > 1 && (
        <div className="pagination">
          <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
          <div>
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p
              if (totalPages <= 7) p = i + 1
              else if (page <= 4) p = i + 1
              else if (page >= totalPages - 3) p = totalPages - 6 + i
              else p = page - 3 + i
              return <button key={p} className={`btn btn-sm${p === page ? ' btn-primary' : ''}`} onClick={() => setPage(p)}>{p}</button>
            })}
            <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        </div>
      )}

      {selectedId && <DonorDetail donorId={selectedId} ngoOptions={ngoOptions} onClose={() => { setSelectedId(null) }} onChanged={() => load(search, page, ngoFilter, missingOnly)} />}

      {stationDonor && (
        <SetStationModal
          donor={stationDonor}
          ngoOptions={ngoOptions}
          onClose={() => setStationDonor(null)}
          onSaved={() => { setStationDonor(null); load(search, page, ngoFilter, missingOnly) }}
        />
      )}

      <style>{`
        .donors-table th, .donors-table td { border-right: 1px solid var(--line); }
        .donors-table th:last-child, .donors-table td:last-child { border-right: none; }
      `}</style>
    </div>
  )
}

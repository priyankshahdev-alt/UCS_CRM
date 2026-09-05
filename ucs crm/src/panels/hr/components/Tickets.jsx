import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { fetchPendingTickets, fetchAllTickets, verifyTicket, rejectTicket } from '../store'
import { SkeletonRows } from './ui'

const TechnicalTickets = lazy(() => import('../../../components/TechnicalTickets'))

const IST_OFFSET = 5.5 * 60 * 60 * 1000

function fmtTime(iso) {
  if (!iso) return '\u2014'
  const d = new Date(new Date(iso).getTime() + IST_OFFSET)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function getIstDateStr(date) {
  const ist = new Date(date.getTime() + IST_OFFSET)
  const y = ist.getUTCFullYear()
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const d = String(ist.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function Badge({ status }) {
  const map = {
    pending: { cls: 'badge-pending2', lbl: 'Pending' },
    hr_verified: { cls: 'badge-verified', lbl: 'HR Verified' },
    approved: { cls: 'badge-present', lbl: 'Approved' },
    rejected: { cls: 'badge-absent', lbl: 'Rejected' },
  }
  const { cls, lbl } = map[status] || { cls: '', lbl: status }
  return <span className={`badge ${cls}`}>{lbl}</span>
}

function VerifyModal({ ticket, onClose, onVerified }) {
  const [remark, setRemark] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Verify Ticket</h3>
          <button className="btn btn-sm" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:12 }}>
            <div><strong>Worker:</strong> {ticket.workers?.name || 'Unknown'}</div>
            <div><strong>Date:</strong> {ticket.date}</div>
            <div><strong>Field:</strong> {ticket.field === 'punch_in' ? 'Punch In' : 'Punch Out'}</div>
            <div><strong>Current Time:</strong> {fmtTime(ticket.field === 'punch_in' ? ticket.punch_in_time : ticket.punch_out_time)}</div>
            <div><strong>Claimed Time:</strong> {fmtTime(ticket.requested_time)}</div>
            <div><strong>Reason:</strong> {ticket.reason}</div>
          </div>
          <label className="field">
            <span>HR Remark (optional)</span>
            <textarea rows={3} value={remark} onChange={e => setRemark(e.target.value)} placeholder="Add notes after speaking with worker..." />
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn btn-danger" onClick={async () => {
            if (!confirm('Reject this ticket?')) return
            setLoading(true)
            try { await rejectTicket(ticket.id, remark); onVerified() } catch (e) { alert(e.message) }
            setLoading(false)
          }} disabled={loading}>Reject</button>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={async () => {
            setLoading(true)
            try { await verifyTicket(ticket.id, remark); onVerified() } catch (e) { alert(e.message) }
            setLoading(false)
          }} disabled={loading}>{loading ? 'Verifying...' : 'Mark Verified'}</button>
        </div>
      </div>
    </div>
  )
}

export default function Tickets() {
  const [pending, setPending] = useState([])
  const [allTickets, setAllTickets] = useState([])
  const [tab, setTab] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [verifyTicketId, setVerifyTicketId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, a] = await Promise.all([
        fetchPendingTickets(),
        fetchAllTickets(),
      ])
      setPending(Array.isArray(p) ? p : [])
      setAllTickets(Array.isArray(a) ? a : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const todayStr = getIstDateStr(new Date())

  return (
    <div>
      <div className="tabs">
        <button className={'tab' + (tab === 'pending' ? ' active' : '')} onClick={() => setTab('pending')}>
          Pending {pending.length > 0 && <span className="badge badge-pending2" style={{marginLeft:6}}>{pending.length}</span>}
        </button>
        <button className={'tab' + (tab === 'all' ? ' active' : '')} onClick={() => setTab('all')}>All Tickets</button>
        <button className={'tab' + (tab === 'technical' ? ' active' : '')} onClick={() => setTab('technical')}>Technical</button>
      </div>

      {tab === 'pending' && (
        <div className="card" style={{ padding: '20px 22px' }}>
          {loading ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Date</th><th>Worker</th><th>Department</th><th>Field</th><th>Current</th><th>Claimed</th><th>Reason</th><th>Action</th></tr>
                </thead>
                <tbody>
                  <SkeletonRows rows={5} widths={[30, 90, 120, 90, 70, 70, 70, 130, 80]} />
                </tbody>
              </table>
            </div>
          ) : pending.length === 0 ? (
            <div className="empty-state"><p>No pending tickets.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Date</th><th>Worker</th><th>Department</th><th>Field</th><th>Current</th><th>Claimed</th><th>Reason</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {pending.map((t, i) => (
                    <tr key={t.id}>
                      <td>{i + 1}</td>
                      <td>{t.date}</td>
                      <td><strong>{t.workers?.name || 'Unknown'}</strong></td>
                      <td>{t.workers?.department || '\u2014'}</td>
                      <td>{t.field === 'punch_in' ? 'Punch In' : 'Punch Out'}</td>
                      <td>{fmtTime(t.field === 'punch_in' ? t.punch_in_time : t.punch_out_time)}</td>
                      <td>{fmtTime(t.requested_time)}</td>
                      <td>{t.reason}</td>
                      <td>
                        <button className="btn btn-sm" onClick={() => setVerifyTicketId(t.id)}>Verify</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'all' && (
        <div className="card" style={{ padding: '20px 22px' }}>
          {loading ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Date</th><th>Worker</th><th>Field</th><th>Status</th><th>Reason</th><th>HR Remark</th></tr>
                </thead>
                <tbody>
                  <SkeletonRows rows={5} widths={[30, 90, 120, 90, 90, 140, 120]} />
                </tbody>
              </table>
            </div>
          ) : allTickets.length === 0 ? (
            <div className="empty-state"><p>No tickets yet.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Date</th><th>Worker</th><th>Field</th><th>Status</th><th>Reason</th><th>HR Remark</th></tr>
                </thead>
                <tbody>
                  {allTickets.map((t, i) => (
                    <tr key={t.id}>
                      <td>{i + 1}</td>
                      <td>{t.date}</td>
                      <td><strong>{t.workers?.name || 'Unknown'}</strong></td>
                      <td>{t.field === 'punch_in' ? 'Punch In' : 'Punch Out'}</td>
                      <td><Badge status={t.status} /></td>
                      <td style={{maxWidth:200, overflow:'hidden', textOverflow:'ellipsis'}}>{t.reason}</td>
                      <td>{t.hr_remark || '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'technical' && (
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>Loading...</div>}>
          <TechnicalTickets panel="hr" />
        </Suspense>
      )}

      {verifyTicketId && (() => {
        const ticket = pending.find(t => t.id === verifyTicketId)
        if (!ticket) return null
        return <VerifyModal ticket={ticket} onClose={() => setVerifyTicketId(null)} onVerified={() => { setVerifyTicketId(null); load() }} />
      })()}
    </div>
  )
}

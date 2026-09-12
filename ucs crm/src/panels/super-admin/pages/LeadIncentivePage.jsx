import { useState, useCallback, useEffect } from 'react'
import { api } from '../../../api/auth'
import { useRealtime } from '../../../hooks/useRealtime'
import LeadIncentive from '../../../components/LeadIncentive'

const fmt = (n) => {
  const v = Number(n)
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-IN')
}

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const fmtDay = (d) => {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

const TabBtn = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    padding: '9px 18px', borderRadius: 999, border: '1.5px solid var(--line)',
    background: active ? 'var(--ink)' : 'var(--card-bg)',
    color: active ? '#fff' : 'var(--ink)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  }}>{children}</button>
)

const btnStyle = (bg = 'var(--ink)', fg = '#fff') => ({
  padding: '7px 14px', borderRadius: 9, border: 'none', background: bg, color: fg,
  fontWeight: 700, fontSize: 12, cursor: 'pointer',
})

const statStyle = {
  borderRadius: 10, padding: '9px 12px', background: 'var(--bg)',
  border: '1.5px solid var(--line)', textAlign: 'center', minWidth: 92, flex: 1,
}

export default function LeadIncentivePage() {
  const [tab, setTab] = useState('live')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  const loadHistory = useCallback(() => {
    api('/incentive/lead/champion/history', { _prefix: 'ucs' })
      .then(h => setHistory(Array.isArray(h) ? h : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])
  useRealtime('lead_champion_announcements', { event: '*', onInsert: loadHistory, onUpdate: loadHistory, onDelete: loadHistory })
  useEffect(() => {
    const t = setInterval(loadHistory, 20000)
    return () => clearInterval(t)
  }, [loadHistory])

  const removeAnnouncement = async (row) => {
    if (busyId) return
    if (!window.confirm(
      `Permanently delete the champion announcement for ${row.announcement_date || row.fro_name} (${row.fro_name})?\n` +
      'The FRO-facing champion banner for that date will be removed. This cannot be undone.'
    )) return
    setBusyId(row.id)
    try {
      await api(`/incentive/lead/champion/${row.id}`, { method: 'DELETE', _prefix: 'ucs' })
      loadHistory()
    } catch (e) {
      console.error(e)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <TabBtn active={tab === 'live'} onClick={() => setTab('live')}>🟢 Live</TabBtn>
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')}>📜 History ({history.length})</TabBtn>
      </div>

      {tab === 'live' ? <LeadIncentive /> : <HistoryList history={history} loading={loading} busyId={busyId} onDelete={removeAnnouncement} onRefresh={loadHistory} />}
    </div>
  )
}

function HistoryList({ history, loading, busyId, onDelete }) {
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>Loading history…</div>
  }

  if (history.length === 0) {
    return (
      <div style={{
        padding: 48, textAlign: 'center', borderRadius: 16, border: '1.5px dashed var(--line)',
        color: 'var(--ink-soft)', fontSize: 13, background: 'var(--card-bg)',
      }}>
        No champion announcements yet — announce the first one in the Live tab!
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {history.map(row => (
        <div key={row.id} style={{ border: '1.5px solid var(--line)', borderRadius: 16, padding: 18, background: 'var(--card-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20 }}>🏆</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{row.fro_name}</span>
                <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: '#fef3c7', color: '#b45309' }}>
                  {fmtDay(row.announcement_date)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                Announced {fmtDate(row.created_at || row.announced_at)}
              </div>
            </div>
            <button
              onClick={() => onDelete(row)}
              disabled={busyId === row.id}
              style={{
                padding: '7px 14px', borderRadius: 8, border: '1.5px solid #fca5a5', background: '#fef2f2',
                color: '#b91c1c', fontSize: 12, fontWeight: 800, cursor: busyId === row.id ? 'wait' : 'pointer',
              }}
            >
              {busyId === row.id ? 'Deleting…' : '🗑 Hard Delete'}
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {stat('Qualified Leads', row.qualified_leads, '#16a34a')}
            {stat('Amount', `₹${fmt(row.total_amount)}`)}
            {stat('Lead Inc.', `₹${fmt(row.lead_incentive)}`)}
            {stat('Slab Bonus', `₹${fmt(row.slab_bonus)}`, '#b45309')}
            {stat('Champion', `₹${fmt(row.champion_bonus)}`, '#f59e0b')}
            {stat('Total', `₹${fmt(row.total_incentive)}`, '#b45309')}
          </div>

          {row.message ? (
            <div style={{
              padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(135deg,#fffdf5,#fef3c7)',
              border: '1.5px solid #fde68a', fontSize: 13, lineHeight: 1.55, color: '#92400e', fontWeight: 600,
            }}>
              💬 {row.message}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>No message attached</div>
          )}
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--ink-soft)', textAlign: 'center' }}>
        Refreshing live · rows removed here vanish from the FRO champion banner for that date
      </div>
    </div>
  )
}

function stat(label, value, color) {
  return (
    <div style={statStyle}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 900, color: color || 'var(--ink)', marginTop: 3 }}>{value}</div>
    </div>
  )
}
import { fmt, STATUS_META, StatBox } from './froShared'
import { now as serverNow } from '../../../lib/serverClock'

// Elapsed time on the SERVER's clock — a device with a wrong clock used to show
// a clamped 00:00 or an inflated value here. Unparseable timestamps give 00:00.
const secsSince = (iso) => {
  const s = Date.parse(iso)
  if (Number.isNaN(s)) return 0
  return Math.max(0, Math.floor((serverNow() - s) / 1000))
}

export function FroDeepDetailModal({ fro, onClose }) {
  if (!fro) return null
  const workerName = fro.worker?.name || 'Unknown'
  const meta = STATUS_META[fro.status] || STATUS_META.offline
  const totalActive = (fro.performance?.today_talk_seconds || 0) + (fro.performance?.today_idle_seconds || 0)
  const productivity = totalActive > 0 ? Math.round(((fro.performance?.today_talk_seconds || 0) / totalActive) * 100) : null
  return (
    <div className="nd-modal-overlay" onClick={onClose}>
      <div className="card" style={{ width: 420, padding: '24px 28px', background: '#fff', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: meta.bg, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>
              {workerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{workerName}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{fro.worker?.login_id || ''}</div>
            </div>
          </div>
          <button className="nd-modal-close" onClick={onClose}><span className="material-symbols-outlined">close</span></button>
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 6, background: meta.bg, border: `1px solid ${meta.border}`, textAlign: 'center', marginBottom: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: meta.color }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.color, display: 'inline-block' }} />
            {meta.label}
          </span>
        </div>
        {fro.status === 'on_call' && (
          <div style={{ padding: '10px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#991b1b', fontWeight: 600, marginBottom: 4 }}> Current Call</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', flex: 1 }}>{fro.current_donor_name}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', fontVariantNumeric: 'tabular-nums' }}>
                {fro.computed?.call_duration_seconds != null ? fmt(fro.computed.call_duration_seconds) : (fro.call_started_at ? fmt(secsSince(fro.call_started_at)) : '00:00')}
              </span>
            </div>
          </div>
        )}
        {fro.status === 'break' && (
          <div style={{ padding: '10px 12px', borderRadius: 6, background: (fro.performance?.today_break_seconds || 0) > 3600 ? '#fef2f2' : '#fefce8', border: `1px solid ${(fro.performance?.today_break_seconds || 0) > 3600 ? '#fecaca' : '#fde68a'}`, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#92400e', fontWeight: 600, marginBottom: 4 }}> On Break</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: (fro.performance?.today_break_seconds || 0) > 3600 ? '#dc2626' : '#d97706', fontVariantNumeric: 'tabular-nums' }}>
                {fro.computed?.break_duration_seconds != null ? fmt(fro.computed.break_duration_seconds) : (fro.break_started_at ? fmt(secsSince(fro.break_started_at)) : '00:00')}
              </span>
              <span style={{ fontSize: 11, color: '#92400e' }}>today: {fmt(fro.performance?.today_break_seconds || 0)}</span>
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#091426', marginBottom: 8 }}> Today's Performance</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <StatBox label="Calls" value={fro.performance?.today_calls || 0} icon="" />
          <StatBox label="Talk Time" value={fmt(fro.performance?.today_talk_seconds || 0)} icon="" />
          <StatBox label="Skipped" value={fro.performance?.today_skipped || 0} icon="" />
          <StatBox label="Idle Time" value={fmt(fro.performance?.today_idle_seconds || 0)} icon="" />
          {(fro.performance?.today_break_seconds || 0) > 0 && <StatBox label="Break" value={fmt(fro.performance?.today_break_seconds || 0)} icon="" />}
          {productivity !== null && <StatBox label="Productivity" value={`${productivity}%`} icon="" />}
        </div>
        <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 14, textAlign: 'center' }}>Auto-refreshes every 30s</div>
      </div>
    </div>
  )
}

export function FroDetailModal({ fro, onClose, onShowDeep }) {
  if (!fro) return null
  const meta = STATUS_META[fro.status] || STATUS_META.offline
  const workerName = fro.worker?.name || 'Unknown'
  const totalActive = (fro.performance?.today_talk_seconds || 0) + (fro.performance?.today_idle_seconds || 0)
  const productivity = totalActive > 0 ? Math.round(((fro.performance?.today_talk_seconds || 0) / totalActive) * 100) : null
  return (
    <div className="nd-modal-overlay" onClick={onClose}>
      <div className="card" style={{ width: 340, padding: '20px 24px', background: '#fff', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={onShowDeep}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: meta.bg, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
              {workerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2A6B45' }}>{workerName} <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>→</span></div>
              <div style={{ fontSize: 10, color: '#64748b' }}>{fro.worker?.login_id || ''}</div>
            </div>
          </div>
          <button className="nd-modal-close" onClick={onClose}><span className="material-symbols-outlined">close</span></button>
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 6, background: meta.bg, border: `1px solid ${meta.border}`, marginBottom: 12, textAlign: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: meta.color }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, display: 'inline-block' }} />
            {meta.label}
          </span>
        </div>
        {fro.status === 'on_call' && (
          <div style={{ padding: '8px 10px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#dc2626' }}>call</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#991b1b', flex: 1 }}>{fro.current_donor_name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', fontVariantNumeric: 'tabular-nums' }}>
                {fro.computed?.call_duration_seconds != null ? fmt(fro.computed.call_duration_seconds) : (fro.call_started_at ? fmt(secsSince(fro.call_started_at)) : '00:00')}
              </span>
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <StatBox label="Today Calls" value={fro.performance?.today_calls || 0} icon="" />
          <StatBox label="Talk Time" value={fmt(fro.performance?.today_talk_seconds || 0)} icon="" />
          {(fro.performance?.today_skipped || 0) > 0 && <StatBox label="Skipped" value={fro.performance?.today_skipped} icon="" />}
          <StatBox label="Idle Time" value={fmt(fro.performance?.today_idle_seconds || 0)} icon="" />
          {(fro.performance?.today_break_seconds || 0) > 0 && <StatBox label="Break" value={fmt(fro.performance?.today_break_seconds || 0)} icon="" />}
          {productivity !== null && <StatBox label="Productivity" value={`${productivity}%`} icon="" />}
        </div>
        <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 12, textAlign: 'center' }}>
          Last seen: {fro.updated_at ? new Date(fro.updated_at).toLocaleTimeString('en-IN') : '—'}
        </div>
      </div>
    </div>
  )
}

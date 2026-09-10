import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../../../api/auth'
import { useRealtime } from '../../../hooks/useRealtime'
import { SpecialIncentiveCard, WinnerBanner } from '../../../components/SpecialIncentive'
import LeadIncentive from '../../../components/LeadIncentive'

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`
const fmtDate = (d) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const toLocalInput = (d) => {
  const dt = new Date(d)
  const pad = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

const STATUS_META = {
  active: { label: 'LIVE', bg: '#dcfce7', text: '#15803d' },
  won: { label: 'WON', bg: '#fef3c7', text: '#b45309' },
  verified: { label: 'VERIFIED', bg: '#dbeafe', text: '#1d4ed8' },
  ended: { label: 'ENDED', bg: '#f1f5f9', text: '#475569' },
  cancelled: { label: 'CANCELLED', bg: '#fee2e2', text: '#b91c1c' },
}

const MESSAGE_TEMPLATES = [
  { key: 'speed', label: '⚡ Speed Race', text: 'Fastest FRO to collect ₹{target} wins the prize! Start collecting now — every rupee counts. Let\'s go!' },
  { key: 'festival', label: '🎉 Festival Push', text: 'Special festive push! First FRO to collect ₹{target} takes home the reward. Maximum effort, maximum speed!' },
  { key: 'highest', label: '🏆 Highest Collection', text: 'Push hard for the top collection. Cross ₹{target} the fastest and win. Don\'t stop — keep going!' },
  { key: 'payday', label: '💵 Payday Bonus', text: 'Extra bonus day! Collect ₹{target} first to grab the incentive. Your hard work pays off today!' },
]

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 18px', borderRadius: 999, border: '1.5px solid var(--line)', background: active ? 'var(--ink)' : 'var(--card-bg)',
      color: active ? '#fff' : 'var(--ink)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    }}>{children}</button>
  )
}

export default function SpecialIncentives() {
  const [tab, setTab] = useState('create')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  const loadHistory = useCallback(() => {
    api('/incentive/special')
      .then(h => setHistory(Array.isArray(h) ? h : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadHistory() }, [loadHistory])
  useRealtime('special_incentive_progress', { event: '*', onInsert: loadHistory, onUpdate: loadHistory })
  useEffect(() => {
    const t = setInterval(loadHistory, 20000)
    return () => clearInterval(t)
  }, [loadHistory])

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 24 }}>💰</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>Sir ka Incentive</h2>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Announce special collection incentives — first FRO past target wins</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <TabBtn active={tab === 'create'} onClick={() => setTab('create')}>Create New</TabBtn>
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')}>History ({history.length})</TabBtn>
        <TabBtn active={tab === 'photo'} onClick={() => setTab('photo')}>Photo</TabBtn>
        <TabBtn active={tab === 'lead'} onClick={() => setTab('lead')}>📊 Lead Incentive</TabBtn>
      </div>

      {tab === 'create' ? <CreateForm onCreated={loadHistory} /> : tab === 'photo' ? <PhotoTab history={history} onRefresh={loadHistory} /> : tab === 'lead' ? <LeadIncentive /> : <HistoryList history={history} loading={loading} onRefresh={loadHistory} />}
    </div>
  )
}

function CreateForm({ onCreated }) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState('')
  const [reward, setReward] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!start) {
      const now = new Date(Date.now() + 5 * 60000)
      setStart(toLocalInput(now))
      const endDt = new Date(now.getTime() + 24 * 3600 * 1000)
      setEnd(toLocalInput(endDt))
    }
  }, [start])

  const submit = async () => {
    setError('')
    if (!title.trim() || !(Number(target) > 0) || !(Number(reward) > 0) || !start || !end) {
      setError('Fill title, target, reward and both date-times.')
      return
    }
    setSubmitting(true)
    try {
      await api('/incentive/special', {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({ title: title.trim(), message: message.trim(), target_amount: Number(target), incentive_amount: Number(reward), start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString() }),
      })
      setTitle(''); setMessage(''); setTarget(''); setReward(''); setStart(''); setEnd('')
      onCreated()
    } catch (e) {
      setError(e.message || 'Failed to create')
    } finally {
      setSubmitting(false)
    }
  }

  const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--card-bg)', color: 'var(--ink)', fontSize: 13.5, outline: 'none' }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
      <div style={{ border: '1.5px solid var(--line)', borderRadius: 16, padding: 20, background: 'var(--card-bg)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', marginBottom: 14 }}>Announcement</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>Title (shown in popups)</label>
            <input style={field} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Maha Shivratri Push ₹5,000" />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>Message (optional)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {MESSAGE_TEMPLATES.map(t => (
                <button
                  key={t.key}
                  onClick={() => setMessage(t.text.replace('{target}', Number(target) || 0).replace('{reward}', Number(reward) || 0))}
                  style={{ padding: '5px 10px', borderRadius: 999, border: '1.5px solid #f59e0b', background: '#fffdf5', color: '#b45309', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >{t.label}</button>
              ))}
            </div>
            <textarea style={{ ...field, minHeight: 72, resize: 'vertical' }} value={message} onChange={e => setMessage(e.target.value)} placeholder="Whoever collects the most fastest…" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>Target (₹)</label>
              <input style={field} type="number" value={target} onChange={e => setTarget(e.target.value)} placeholder="5000" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>Reward (₹)</label>
              <input style={field} type="number" value={reward} onChange={e => setReward(e.target.value)} placeholder="500" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>Starts</label>
              <input style={field} type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>Ends</label>
              <input style={field} type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
            Counts live <code>fro_donor_logs</code> collections by every active FRO inside the window. First to reach target wins and closes the contest.
          </div>
          {error && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fee2e2', color: '#b91c1c', fontSize: 12, fontWeight: 600 }}>{error}</div>}
          <button onClick={submit} disabled={submitting} style={{ padding: '11px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(90deg,#b45309,#f59e0b)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? .6 : 1 }}>
            {submitting ? 'Announcing…' : '🚀 Announce Incentive to All Panels'}
          </button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', marginBottom: 10 }}>Live preview</div>
        <SpecialIncentiveCard
          inc={{
            title: title.trim() || 'Your Incentive Title',
            message,
            target_amount: Number(target) || 5000,
            incentive_amount: Number(reward) || 500,
            start_at: start ? new Date(start).toISOString() : null,
            end_at: end ? new Date(end).toISOString() : null,
            status: 'active',
            mine: { worker_id: 'a', collected_amount: Math.round((Number(target) || 5000) * 0.37) },
            leaderboard: [
              { worker_id: 'a', name: 'Rajesh Kumar', collected_amount: Math.round((Number(target) || 5000) * 0.7), hit_target_at: null },
              { worker_id: 'b', name: 'Priya Sharma', collected_amount: Math.round((Number(target) || 5000) * 0.45), hit_target_at: null },
              { worker_id: 'c', name: 'Amit Verma', collected_amount: Math.round((Number(target) || 5000) * 0.18), hit_target_at: null },
            ],
          }}
          nowMs={new Date(end || Date.now() + 86400000).getTime()}
        />
      </div>
    </div>
  )
}

function HistoryList({ history, loading, onRefresh }) {
  const [busyId, setBusyId] = useState(null)

  const cancel = async (id) => {
    if (busyId) return
    if (!window.confirm('Cancel this incentive? It will be closed with no winner.')) return
    setBusyId(id)
    try {
      await api(`/incentive/special/${id}/cancel`, { method: 'POST', _prefix: 'ucs', body: JSON.stringify({}) })
      onRefresh()
    } catch (e) {
      console.error(e)
    } finally {
      setBusyId(null)
    }
  }

  const archive = async (id) => {
    if (busyId) return
    if (!window.confirm('Archive this incentive? Its winner and photo popups will stop showing on all panels.')) return
    setBusyId(id)
    try {
      await api(`/incentive/special/${id}/archive`, { method: 'POST', _prefix: 'ucs', body: JSON.stringify({}) })
      onRefresh()
    } catch (e) {
      console.error(e)
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id) => {
    if (busyId) return
    if (!window.confirm('Delete this incentive permanently? This cannot be undone.')) return
    setBusyId(id)
    try {
      await api(`/incentive/special/${id}`, { method: 'DELETE', _prefix: 'ucs' })
      onRefresh()
    } catch (e) {
      console.error(e)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>Loading history…</div>

  if (history.length === 0) {
    return <div style={{ padding: 48, textAlign: 'center', borderRadius: 16, border: '1.5px dashed var(--line)', color: 'var(--ink-soft)', fontSize: 13 }}>
      No incentives yet — announce the first one!
    </div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {history.map(inc => {
        const meta = STATUS_META[inc.status] || STATUS_META.ended
        const isArchived = !!inc.archived_at
        return (
          <div key={inc.id} style={{ border: '1.5px solid var(--line)', borderRadius: 16, padding: 18, background: 'var(--card-bg)', opacity: isArchived ? .72 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{inc.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{fmtDate(inc.start_at)} → {fmtDate(inc.end_at)}</div>
              </div>
              <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: meta.bg, color: meta.text }}>
                {(inc.status === 'won' || inc.status === 'verified') ? `🏆 ${meta.label} · ${inc.winner_name || '—'}` : meta.label}
              </span>
              {isArchived ? (
                <span style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink-soft)', fontSize: 11.5, fontWeight: 800 }}>
                  ✓ ARCHIVED
                </span>
              ) : (
                <>
                  {inc.status === 'active' && (
                    <button onClick={() => cancel(inc.id)} disabled={busyId === inc.id} style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 11.5, fontWeight: 700, cursor: busyId === inc.id ? 'wait' : 'pointer' }}>
                      {busyId === inc.id ? '…' : 'Cancel'}
                    </button>
                  )}
                  {inc.status !== 'active' && (
                    <button onClick={() => archive(inc.id)} disabled={busyId === inc.id} style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 11.5, fontWeight: 700, cursor: busyId === inc.id ? 'wait' : 'pointer' }}>
                      {busyId === inc.id ? '…' : 'Archive'}
                    </button>
                  )}
                </>
              )}
              <button onClick={() => remove(inc.id)} disabled={busyId === inc.id} style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: 11.5, fontWeight: 700, cursor: busyId === inc.id ? 'wait' : 'pointer' }}>
                Delete
              </button>
            </div>
            {inc.status === 'won' && <div style={{ marginBottom: 10 }}><WinnerBanner inc={inc} /></div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8 }}>
              {(inc.leaderboard || []).slice(0, 10).map(r => (
                <div key={r.worker_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 9, background: 'var(--bg)', fontSize: 12 }}>
                  <span style={{ color: 'var(--ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.workers?.name || '—'}</span>
                  <span style={{ color: '#b45309', fontWeight: 800 }}>{money(r.collected_amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <div style={{ fontSize: 11, color: 'var(--ink-soft)', textAlign: 'center' }}>Refreshing every 20s · amounts = live collections within the incentive window</div>
    </div>
  )
}

const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => {
    const s = String(r.result || '')
    resolve(s.includes(',') ? s.split(',')[1] : s)
  }
  r.onerror = reject
  r.readAsDataURL(file)
})

function PhotoTab({ history, onRefresh }) {
  const won = history.filter(inc => inc.status === 'won')

  if (won.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', borderRadius: 16, border: '1.5px dashed var(--line)', color: 'var(--ink-soft)', fontSize: 13 }}>
        No won incentives yet — once a winner is declared, upload their photo here 🎉
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {won.map(inc => (
        inc.celebrated_at ? <PostedCard key={inc.id} inc={inc} /> : <CelebrateForm key={inc.id} inc={inc} onPosted={onRefresh} />
      ))}
      <div style={{ fontSize: 11, color: 'var(--ink-soft)', textAlign: 'center' }}>
        Posting a celebration pops it up on every panel with a drop animation. Leave the message empty and AI will write a congratulation.
      </div>
    </div>
  )
}

function CelebrateForm({ inc, onPosted }) {
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState('')
  const [msg, setMsg] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const pick = async (e) => {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setError('')
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setError('Use a JPG, PNG or WebP image.')
      return
    }
    setPreview(URL.createObjectURL(f))
    setPhoto({ mime_type: f.type, base64: await toBase64(f) })
  }

  const post = async () => {
    setError(''); setDone(false)
    if (!photo) { setError('Upload a photo of the winner first.'); return }
    setPosting(true)
    try {
      await api(`/incentive/special/${inc.id}/celebrate`, {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({ file_base64: photo.base64, mime_type: photo.mime_type, message: msg.trim() }),
      })
      setDone(true)
      onPosted()
    } catch (err) {
      setError(err.message || 'Failed to post')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div style={{ border: '1.5px solid var(--line)', borderRadius: 16, padding: 18, background: 'var(--card-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 22 }}>🏆</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{inc.winner_name || 'Winner'} won this Incentive</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{inc.title} · won {money(inc.incentive_amount)}</div>
        </div>
        <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: '#fef3c7', color: '#b45309' }}>🏆 WON</span>
      </div>

      {done && (
        <div style={{ padding: '9px 12px', borderRadius: 8, background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 700, marginBottom: 12 }}>
          Celebration posted! It now pops up on every panel. 🎉
        </div>
      )}
      {error && (
        <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fee2e2', color: '#b91c1c', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 6 }}>Winner photo</label>
          {preview ? (
            <img src={preview} alt="Winner" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 12, border: '2px solid #f59e0b' }} />
          ) : (
            <div style={{ width: '100%', height: 160, borderRadius: 12, border: '1.5px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: 12, textAlign: 'center', padding: 8, boxSizing: 'border-box' }}>
              Chosen winner photo 📸
            </div>
          )}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} style={{ width: '100%', marginTop: 8, fontSize: 11.5 }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>Congratulation message <span style={{ fontWeight: 500 }}>(optional — AI writes it if empty)</span></label>
            <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Leave empty and AI will congratulate her..." style={{ width: '100%', minHeight: 84, boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, outline: 'none', resize: 'vertical' }} />
          </div>
          <button onClick={post} disabled={posting} style={{ padding: '11px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(90deg,#b45309,#f59e0b)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? .6 : 1 }}>
            {posting ? 'Posting…' : '🎉 Post Winner Celebration'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PostedCard({ inc }) {
  return (
    <div style={{ border: '1.5px solid #f59e0b', borderRadius: 16, padding: 18, background: 'linear-gradient(150deg,var(--card-bg),#fffdf5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 22 }}>📸</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{inc.winner_name || 'Winner'} — celebration posted</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{inc.title} · posted {fmtDate(inc.celebrated_at)}</div>
        </div>
        <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: '#dcfce7', color: '#15803d' }}>✓ POSTED</span>
      </div>
      {inc.winner_photo_url && (
        <img src={inc.winner_photo_url} alt="Winner" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 12, border: '2px solid #f59e0b', display: 'block' }} />
      )}
      {inc.congrats_message && (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.8)', border: '1.5px solid #fcd34d', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink)', fontWeight: 600 }}>{inc.congrats_message}</div>
      )}
    </div>
  )
}
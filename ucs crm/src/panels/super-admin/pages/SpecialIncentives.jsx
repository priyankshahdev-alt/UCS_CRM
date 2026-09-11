import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../../../api/auth'
import { useRealtime } from '../../../hooks/useRealtime'
import { SpecialIncentiveCard, WinnerBanner, NgoBadge, ngoColor } from '../../../components/SpecialIncentive'
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

const defaultRace = () => {
  const now = new Date(Date.now() + 5 * 60000)
  const end = new Date(now.getTime() + 24 * 3600 * 1000)
  return { title: '', message: '', target: '', reward: '', start: toLocalInput(now), end: toLocalInput(end) }
}

function CreateForm({ onCreated }) {
  const [ngos, setNgos] = useState([])
  const [forms, setForms] = useState(() => ({ all: defaultRace() }))
  const [cardMsg, setCardMsg] = useState({})

  useEffect(() => {
    let mounted = true
    api('/ngos').then(list => { if (mounted) setNgos(Array.isArray(list) ? list : []) }).catch(() => {})
    return () => { mounted = false }
  }, [])

  const cards = [
    { key: 'all', name: 'All NGOs', full: 'Combined race across every NGO', color: 'var(--ink)', ngo_id: null },
    ...ngos
      .filter(n => (n.name || '').trim().toUpperCase() !== 'OTHER')
      .map(n => ({ key: n.id, name: n.name, full: n.city || n.short_name || '', color: ngoColor(n.name), ngo_id: n.id })),
  ]

  const cur = (k) => forms[k] || defaultRace()
  const setField = (k, field, v) => {
    setForms(prev => ({ ...prev, [k]: { ...(prev[k] || defaultRace()), [field]: v } }))
    setCardMsg(prev => { const n = { ...prev }; delete n[k]; return n })
  }
  const applyTemplate = (k, t) => {
    const f = cur(k)
    setField(k, 'message', t.text.replace('{target}', Number(f.target) || 0).replace('{reward}', Number(f.reward) || 0))
  }

  const save = async (card) => {
    const f = cur(card.key)
    if (!f.title.trim() || !(Number(f.target) > 0) || !(Number(f.reward) > 0) || !f.start || !f.end) {
      setCardMsg(prev => ({ ...prev, [card.key]: { type: 'error', text: 'Fill title, target, reward and both date-times.' } }))
      return
    }
    setCardMsg(prev => ({ ...prev, [card.key]: { type: 'saving', text: 'Saving…' } }))
    try {
      await api('/incentive/special', {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({
          title: f.title.trim(),
          message: (f.message || '').trim(),
          ngo_id: card.ngo_id,
          target_amount: Number(f.target),
          incentive_amount: Number(f.reward),
          start_at: new Date(f.start).toISOString(),
          end_at: new Date(f.end).toISOString(),
        }),
      })
      setForms(prev => ({ ...prev, [card.key]: defaultRace() }))
      setCardMsg(prev => ({ ...prev, [card.key]: { type: 'ok', text: `${card.name} incentive is live on all panels!` } }))
      onCreated()
    } catch (e) {
      setCardMsg(prev => ({ ...prev, [card.key]: { type: 'error', text: e.message || 'Failed to create' } }))
    }
  }

  const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--card-bg)', color: 'var(--ink)', fontSize: 13.5, outline: 'none' }
  const label = { fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', marginBottom: 12 }}>NGO races · each saved independently</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {cards.map(card => {
          const f = cur(card.key)
          const msg = cardMsg[card.key]
          const saving = msg && msg.type === 'saving'
          return (
            <div key={card.key} style={{ border: '1.5px solid var(--line)', borderRadius: 16, overflow: 'hidden', background: 'var(--card-bg)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: card.color, color: '#fff' }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>{card.name}</span>
                {card.full && <span style={{ fontSize: 11, opacity: .85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.full}</span>}
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={label}>Title (shown in popups)</label>
                  <input style={field} value={f.title} onChange={e => setField(card.key, 'title', e.target.value)} placeholder={`e.g. ${card.key === 'all' ? 'Grand All-NGO' : card.name} Collection Race`} />
                </div>
                <div>
                  <label style={label}>Message (optional)</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {MESSAGE_TEMPLATES.map(t => (
                      <button
                        key={t.key}
                        onClick={() => applyTemplate(card.key, t)}
                        style={{ padding: '5px 10px', borderRadius: 999, border: '1.5px solid #f59e0b', background: '#fffdf5', color: '#b45309', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >{t.label}</button>
                    ))}
                  </div>
                  <textarea style={{ ...field, minHeight: 68, resize: 'vertical' }} value={f.message} onChange={e => setField(card.key, 'message', e.target.value)} placeholder="Whoever collects the fastest…" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={label}>Target (₹)</label>
                    <input style={field} type="number" value={f.target} onChange={e => setField(card.key, 'target', e.target.value)} placeholder="12000" />
                  </div>
                  <div>
                    <label style={label}>Reward (₹)</label>
                    <input style={field} type="number" value={f.reward} onChange={e => setField(card.key, 'reward', e.target.value)} placeholder="500" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={label}>Starts (only this NGO)</label>
                    <input style={field} type="datetime-local" value={f.start} onChange={e => setField(card.key, 'start', e.target.value)} />
                  </div>
                  <div>
                    <label style={label}>Ends (only this NGO)</label>
                    <input style={field} type="datetime-local" value={f.end} onChange={e => setField(card.key, 'end', e.target.value)} />
                  </div>
                </div>
                {msg && msg.type === 'error' && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fee2e2', color: '#b91c1c', fontSize: 12, fontWeight: 600 }}>{msg.text}</div>}
                {msg && msg.type === 'ok' && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 600 }}>{msg.text}</div>}
                <button onClick={() => save(card)} disabled={saving} style={{ padding: '11px 0', borderRadius: 10, border: 'none', background: card.color, color: '#fff', fontWeight: 800, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .6 : 1 }}>
                  {saving ? msg.text : `💾 Save / Update ${card.key === 'all' ? 'All-NGO' : card.name} Incentive`}
                </button>
              </div>
            </div>
          )
        })}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <NgoBadge ngoName={inc.ngo_name} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{inc.title}</span>
                </div>
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
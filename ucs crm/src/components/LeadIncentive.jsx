import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/auth'
import { useRealtime } from '../hooks/useRealtime'
import { toast } from './Toast'

const SLAB_TAG = '[SLAB]'

const fmt = (n) => {
  const v = Number(n)
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-IN')
}

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const fmtSlab = (n) => {
  const v = Number(n)
  if (v >= 100000) return `₹${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L`
  if (v >= 1000) return `₹${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`
  return `₹${v}`
}

const fmtClock = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00:00'
  const s = Math.floor(ms / 1000)
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${sec}`
}

const toLocalInput = (d) => {
  const dt = new Date(d)
  const pad = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
  border: '1.5px solid var(--line)', background: 'var(--card-bg)', color: 'var(--ink)',
  fontSize: 13.5, outline: 'none',
}

const btnStyle = (bg = 'var(--ink)', fg = '#fff') => ({
  padding: '8px 16px', borderRadius: 10, border: 'none', background: bg, color: fg,
  fontWeight: 700, fontSize: 13, cursor: 'pointer',
})

const slabInputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1.5px solid var(--line)', background: 'var(--card-bg)', color: 'var(--ink)',
  fontSize: 13, outline: 'none', textAlign: 'right',
}

const MESSAGE_TEMPLATES = [
  { key: 'speed', label: '⚡ Speed Race', text: 'Fastest FRO to reach ₹{target} and win ₹{reward}! Every rupee counts — start collecting now!' },
  { key: 'festival', label: '🎉 Festival Push', text: 'Special festive push! Smash the ₹{target} target to win ₹{reward}. Maximum effort, maximum speed!' },
  { key: 'highest', label: '🏆 Highest Collection', text: 'Push hard to cross ₹{target} and claim ₹{reward}. Keep going — don\u0027t stop!' },
  { key: 'payday', label: '💵 Payday Bonus', text: 'Extra bonus day! Reach ₹{target} and grab ₹{reward}. Your hard work pays off today!' },
]

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 99992, background: 'rgba(15,23,42,.55)',
  backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
}

const modalCardStyle = {
  width: 'min(500px, 100%)', borderRadius: 16, background: 'var(--card-bg)',
  boxShadow: '0 24px 60px rgba(0,0,0,.35)', overflow: 'hidden',
}

// ─── Per-range configure card ─────────────────────────────
function RangeCard({ slab, saving, onSave, onDelete, onSendPop }) {
  const base = {
    min_amount: Number(slab.min_amount) || 0,
    max_amount: Number(slab.max_amount) || 0,
    incentive_amount: Number(slab.incentive_amount) || 0,
    min_lead_amount: Number(slab.min_lead_amount) || 0,
    lead_rate: Number(slab.lead_rate) || 0,
  }
  const [f, setF] = useState(base)
  useEffect(() => {
    setF({
      min_amount: Number(slab.min_amount) || 0,
      max_amount: Number(slab.max_amount) || 0,
      incentive_amount: Number(slab.incentive_amount) || 0,
      min_lead_amount: Number(slab.min_lead_amount) || 0,
      lead_rate: Number(slab.lead_rate) || 0,
    })
  }, [slab])

  const dirty = JSON.stringify(f) !== JSON.stringify(base)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const label = { fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 4 }
  const hint = { fontSize: 11, color: 'var(--ink-soft)', marginTop: 4, opacity: .85 }
  const row = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }

  return (
    <div style={{ border: '1.5px solid var(--line)', borderRadius: 16, overflow: 'hidden', background: 'var(--card-bg)' }}>
      <div style={{ padding: '12px 16px', background: 'linear-gradient(135deg,#fffdf5,#fef3c7)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15 }}>⚙️</span>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)', letterSpacing: .4, textTransform: 'uppercase' }}>Configure Range</div>
        <span style={{ fontWeight: 900, color: '#b45309', fontSize: 14 }}>{fmtSlab(f.min_amount)} – {fmtSlab(f.max_amount)}</span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={row}>
          <div>
            <label style={label}>Min Amount (₹)</label>
            <input type="number" style={slabInputStyle} value={f.min_amount} onChange={e => set('min_amount', e.target.value)} />
          </div>
          <div>
            <label style={label}>Max Amount (₹)</label>
            <input type="number" style={slabInputStyle} value={f.max_amount} onChange={e => set('max_amount', e.target.value)} />
          </div>
          <div>
            <label style={label}>Incentive / Slab Bonus (₹)</label>
            <input type="number" style={slabInputStyle} value={f.incentive_amount} onChange={e => set('incentive_amount', e.target.value)} />
          </div>
        </div>

        <div style={{ padding: '9px 12px', borderRadius: 10, background: '#f8fafc', border: '1.5px dashed var(--line)', fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
          💡 A lead only qualifies for this range if the ₹ collected is ≥ its Minimum Lead Amount.
        </div>

        <div style={row}>
          <div>
            <label style={label}>Minimum Lead Amount (₹)</label>
            <input type="number" style={slabInputStyle} value={f.min_lead_amount} onChange={e => set('min_lead_amount', e.target.value)} />
            <div style={hint}>Lead must collect at least this amount to count as qualified</div>
          </div>
          <div>
            <label style={label}>₹ per Qualified Lead</label>
            <input type="number" style={slabInputStyle} value={f.lead_rate} onChange={e => set('lead_rate', e.target.value)} />
            <div style={hint}>Reward paid for every verified qualified lead in this range</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => onSave(slab.id, f)} disabled={!dirty || saving} style={{ ...btnStyle('linear-gradient(90deg,#b45309,#f59e0b)'), opacity: (!dirty || saving) ? .5 : 1 }}>
            {saving ? 'Saving…' : '💾 Save Range'}
          </button>
          <button onClick={() => setF(base)} style={btnStyle('var(--line)', 'var(--ink)')}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => onDelete(slab.id)} style={{ ...btnStyle('#fee2e2', '#b91c1c'), padding: '6px 12px', fontSize: 11.5, border: '1px solid #fecaca' }}>Delete</button>
        </div>

        <button onClick={() => onSendPop(slab)} style={{ padding: '11px 0', borderRadius: 10, border: '1.5px solid #f59e0b', background: '#fffdf5', color: '#b45309', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
          📣 Send Pop — advertise this target slab to all FROs
        </button>
      </div>
    </div>
  )
}

function NewRangeCard({ saving, onAdd, onCancel }) {
  const [f, setF] = useState({ min_amount: '', max_amount: '', incentive_amount: '', min_lead_amount: 300, lead_rate: 20 })
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const submit = () => {
    setErr('')
    if (!(Number(f.min_amount) >= 0) || !(Number(f.max_amount) > 0)) { setErr('Enter valid min and max amounts'); return }
    if (Number(f.min_amount) >= Number(f.max_amount)) { setErr('Min must be less than max'); return }
    onAdd({
      min_amount: Number(f.min_amount),
      max_amount: Number(f.max_amount),
      incentive_amount: Number(f.incentive_amount) || 0,
      min_lead_amount: Number(f.min_lead_amount) || 0,
      lead_rate: Number(f.lead_rate) || 0,
    })
  }

  const label = { fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 4 }

  return (
    <div style={{ border: '1.5px dashed #f59e0b', borderRadius: 16, padding: 16, background: '#fffdf5', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: '#b45309', marginBottom: 12 }}>＋ Add a new Configure Range</div>
      {err && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fee2e2', color: '#b91c1c', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div>
          <label style={label}>Min Amount (₹)</label>
          <input type="number" style={slabInputStyle} value={f.min_amount} onChange={e => set('min_amount', e.target.value)} placeholder="0" />
        </div>
        <div>
          <label style={label}>Max Amount (₹)</label>
          <input type="number" style={slabInputStyle} value={f.max_amount} onChange={e => set('max_amount', e.target.value)} placeholder="20000" />
        </div>
        <div>
          <label style={label}>Incentive / Slab Bonus (₹)</label>
          <input type="number" style={slabInputStyle} value={f.incentive_amount} onChange={e => set('incentive_amount', e.target.value)} placeholder="0" />
        </div>
        <div>
          <label style={label}>Minimum Lead Amount (₹)</label>
          <input type="number" style={slabInputStyle} value={f.min_lead_amount} onChange={e => set('min_lead_amount', e.target.value)} placeholder="300" />
        </div>
        <div>
          <label style={label}>₹ per Qualified Lead</label>
          <input type="number" style={slabInputStyle} value={f.lead_rate} onChange={e => set('lead_rate', e.target.value)} placeholder="20" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={submit} disabled={saving} style={btnStyle('#16a34a')}>{saving ? 'Saving…' : '💾 Save Range'}</button>
        <button onClick={onCancel} style={btnStyle('var(--line)', 'var(--ink)')}>Cancel</button>
      </div>
    </div>
  )
}

function RangeConfig({ slabs, savingId, onSave, onAdd, onDelete, onSendPop, addBusy }) {
  const [adding, setAdding] = useState(false)
  const active = slabs.filter(s => s.is_active).sort((a, b) => Number(a.min_amount) - Number(b.min_amount))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>📋</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>Configure Ranges — target slab rules</div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setAdding(o => !o)} style={btnStyle('linear-gradient(90deg,#b45309,#f59e0b)')}>
          {adding ? '✕ Close' : '＋ Add Range'}
        </button>
      </div>
      {adding && <NewRangeCard saving={addBusy} onAdd={onAdd} onCancel={() => setAdding(false)} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
        {active.map(slab => (
          <RangeCard key={slab.id} slab={slab} saving={savingId === slab.id} onSave={onSave} onDelete={onDelete} onSendPop={onSendPop} />
        ))}
        {active.length === 0 && !adding && (
          <div style={{ padding: 48, textAlign: 'center', borderRadius: 16, border: '1.5px dashed var(--line)', color: 'var(--ink-soft)', fontSize: 13 }}>
            No ranges configured — add the first one!
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Send Pop modal (same procedure as Create New) ────────
function SlabAnnounceModal({ slab, onClose, onSaved }) {
  const min = Number(slab.min_amount) || 0
  const max = Number(slab.max_amount) || 0
  const rangeLabel = `${fmtSlab(min)} – ${fmtSlab(max)}`

  const [f, setF] = useState(() => ({
    title: `${SLAB_TAG} ${rangeLabel} Target`,
    message: '',
    target: max,
    reward: Number(slab.incentive_amount) || 0,
    start: toLocalInput(Date.now()),
    end: toLocalInput(Date.now() + 24 * 3600 * 1000),
  }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const applyTemplate = (t) => {
    setF(prev => ({ ...prev, message: t.text.replace('{target}', Number(prev.target) || 0).replace('{reward}', Number(prev.reward) || 0) }))
  }

  const save = async () => {
    setErr('')
    if (!f.title.trim()) { setErr('Title is required'); return }
    if (!(Number(f.target) > 0)) { setErr('Target must be greater than 0'); return }
    if (!(Number(f.reward) > 0)) { setErr('Reward must be greater than 0 to send the popup'); return }
    if (!f.start || !f.end) { setErr('Set both start and end date-time'); return }
    if (new Date(f.end).getTime() <= new Date(f.start).getTime()) { setErr('End must be after start'); return }
    setSaving(true)
    try {
      await api('/incentive/special', {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({
          title: f.title.trim(),
          message: (f.message || '').trim(),
          ngo_id: null,
          target_amount: Number(f.target),
          incentive_amount: Number(f.reward),
          start_at: new Date(f.start).toISOString(),
          end_at: new Date(f.end).toISOString(),
        }),
      })
      toast('Slab popup is now live on all FRO panels 🎉', 'success')
      onSaved()
      onClose()
    } catch (e) {
      setErr(e.message || 'Failed to send popup')
    } finally {
      setSaving(false)
    }
  }

  const label = { fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalCardStyle, width: 'min(540px, 100%)', maxHeight: '92vh', overflowY: 'auto', padding: 20 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 20 }}>📣</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Send Pop — {rangeLabel}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>Same procedure as Create New · live interactive popup to every FRO</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 50, background: 'var(--line)', border: 'none', fontWeight: 700, color: 'var(--ink)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        {err && <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fee2e2', color: '#b91c1c', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={label}>Title (shown in popup)</label>
            <input style={inputStyle} value={f.title} onChange={e => set('title', e.target.value)} />
          </div>
          <div>
            <label style={label}>Message (optional)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {MESSAGE_TEMPLATES.map(t => (
                <button key={t.key} onClick={() => applyTemplate(t)} style={{ padding: '5px 10px', borderRadius: 999, border: '1.5px solid #f59e0b', background: '#fffdf5', color: '#b45309', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{t.label}</button>
              ))}
            </div>
            <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={f.message} onChange={e => set('message', e.target.value)} placeholder="Whoever reaches the target first…" />
          </div>
          <div style={grid}>
            <div>
              <label style={label}>Target (₹)</label>
              <input type="number" style={inputStyle} value={f.target} onChange={e => set('target', e.target.value)} />
            </div>
            <div>
              <label style={label}>Reward (₹)</label>
              <input type="number" style={inputStyle} value={f.reward} onChange={e => set('reward', e.target.value)} />
            </div>
          </div>
          <div style={grid}>
            <div>
              <label style={label}>Starts</label>
              <input type="datetime-local" style={inputStyle} value={f.start} onChange={e => set('start', e.target.value)} />
            </div>
            <div>
              <label style={label}>Ends</label>
              <input type="datetime-local" style={inputStyle} value={f.end} onChange={e => set('end', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ ...btnStyle('var(--line)', 'var(--ink)'), flex: 1 }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ ...btnStyle('linear-gradient(90deg,#b45309,#f59e0b)'), flex: 1 }}>
              {saving ? 'Sending…' : '📣 Send Pop'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Live Slab Pops strip + history ───────────────────────
function LiveSlabPops({ pops, history, busyId, onStop, onDelete }) {
  const now = Date.now()
  const rangeOf = (inc) => String(inc.title || '').replace(/^\[SLAB\]\s*/, '').replace(/ Target$/, '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ border: '1.5px solid #bbf7d0', borderRadius: 16, padding: 14, background: '#f0fdf4' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#15803d', marginBottom: 10 }}>
          🟢 LIVE SLAB POPS — {pops.length === 0 ? 'none right now' : 'advertising to all FROs'}
        </div>
        {pops.map(inc => {
          const left = Math.max(0, new Date(inc.end_at).getTime() - now)
          return (
            <div key={inc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 10, background: '#fff', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 900, color: '#b45309' }}>{rangeOf(inc)}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.message || 'Reach the target and earn the bonus!'}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>⏳ {fmtClock(left)}</span>
              <button onClick={() => onStop(inc.id)} disabled={busyId === inc.id} style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: 11.5, fontWeight: 700, cursor: busyId === inc.id ? 'wait' : 'pointer' }}>{busyId === inc.id ? '…' : 'Stop'}</button>
              <button onClick={() => onDelete(inc)} disabled={busyId === inc.id} style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 11.5, fontWeight: 700, cursor: busyId === inc.id ? 'wait' : 'pointer' }}>Delete</button>
            </div>
          )
        })}
      </div>
      {history.length > 0 && (
        <div style={{ border: '1.5px solid var(--line)', borderRadius: 16, padding: 12, background: 'var(--card-bg)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)', marginBottom: 8 }}>POP HISTORY (sent from ranges)</div>
          {history.map(inc => (
            <div key={inc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontWeight: 900, color: '#b45309', fontSize: 13 }}>{rangeOf(inc)}</span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.message || 'Target pop'}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{fmtDate(inc.created_at)}</span>
              <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, background: inc.status === 'won' ? '#fef3c7' : '#f1f5f9', color: inc.status === 'won' ? '#b45309' : '#475569', textTransform: 'uppercase' }}>{inc.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── FRO Lead Summary ─────────────────────────────────────
function FroLeadSummary({ fros, champion, date, onSelectFro }) {
  return (
    <div style={{ border: '1.5px solid var(--line)', borderRadius: 16, background: 'var(--card-bg)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>📋</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>FRO Lead Summary</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
          Qualified = verified lead ≥ range Minimum Lead Amount
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--line)', background: 'var(--bg)' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>FRO</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Target</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Slab</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Leads</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Qual.</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Amount</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Lead Inc.</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Slab Bonus</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Champion</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {fros.map(fro => {
              const isChampion = champion && champion.fro_id === fro.fro_id
              const slabLabel = fro.slab
                ? `₹${fmt(fro.slab.min_amount)} – ₹${fmt(fro.slab.max_amount)}`
                : '—'
              return (
                <FroRow key={fro.fro_id} fro={fro} isChampion={isChampion} slabLabel={slabLabel} onSelect={onSelectFro} />
              )
            })}
            {fros.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: 32, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>No FROs found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '8px 18px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-soft)', textAlign: 'center' }}>
        Leads auto-calculated from verified lead_done dispositions · Click a row to view individual leads
      </div>
    </div>
  )
}

function FroRow({ fro, isChampion, slabLabel, onSelect }) {
  return (
    <tr onClick={() => onSelect && onSelect(fro.fro_id)} style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', background: isChampion ? '#fffdf5' : 'transparent' }}>
      <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--ink)' }}>
        <span style={{ marginRight: 6, fontSize: 11, color: 'var(--ink-soft)' }}>👁</span>
        {fro.fro_name}
        {isChampion && <span style={{ marginLeft: 6, fontSize: 12 }}>🏆</span>}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--ink-soft)' }}>₹{fmt(fro.target)}</td>
      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-soft)' }}>{slabLabel}</td>
      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: 'var(--ink)' }}>{fro.total_leads}</td>
      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#16a34a' }}>{fro.qualified_leads}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--ink)' }}>₹{fmt(fro.total_amount)}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--ink)' }}>₹{fmt(fro.lead_incentive)}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#b45309' }}>₹{fmt(fro.slab_bonus)}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', color: isChampion ? '#f59e0b' : 'var(--ink-soft)' }}>
        {fro.champion_bonus > 0 ? `₹${fmt(fro.champion_bonus)}` : '—'}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, color: '#b45309', fontSize: 14 }}>₹{fmt(fro.total_incentive)}</td>
    </tr>
  )
}

// ─── FRO Detail Modal ─────────────────────────────────────
function FroDetailModal({ froId, date, champion, onClose }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api(`/incentive/lead/lead-summary/fro/${froId}?date=${date}`, { _prefix: 'ucs' })
      .then(data => { if (alive) setDetail(data) })
      .catch(e => { if (alive) setError(e.message || 'Failed to load detail') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [froId, date])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (loading) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={modalCardStyle} onClick={e => e.stopPropagation()}>
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>Loading leads…</div>
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={modalCardStyle} onClick={e => e.stopPropagation()}>
          <div style={{ padding: 24, textAlign: 'center', color: '#dc2626', fontSize: 13 }}>{error}</div>
          <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 20 }}>
            <button onClick={onClose} style={btnStyle('var(--line)', 'var(--ink)')}>Close</button>
          </div>
        </div>
      </div>
    )
  }
  if (!detail) return null

  const isChampion = champion && champion.fro_id === detail.fro_id
  const slabLabel = detail.slab ? `₹${fmt(detail.slab.min_amount)} – ₹${fmt(detail.slab.max_amount)}` : '—'

  const stat = (label, value, color) => (
    <div style={{ borderRadius: 12, padding: '12px 14px', background: 'var(--bg)', border: '1.5px solid var(--line)', textAlign: 'center', minWidth: 110, flex: 1 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 900, color: color || 'var(--ink)', marginTop: 4 }}>{value}</div>
    </div>
  )

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalCardStyle, width: 'min(760px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', background: 'linear-gradient(135deg,#fffdf5,#fef3c7)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏆</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{detail.fro_name}{isChampion && <span style={{ marginLeft: 6, fontSize: 13 }}>🏆</span>}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{fmtDate(detail.date)} · Lead detail</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 50, background: 'var(--line)', border: 'none', fontWeight: 700, color: 'var(--ink)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 20px 20px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            {stat('Target', `₹${fmt(detail.target)}`)}
            {stat('Slab', slabLabel)}
            {stat('Leads', detail.total_leads)}
            {stat('Qualified', detail.qualified_leads, '#16a34a')}
            {stat('Amount', `₹${fmt(detail.total_amount)}`)}
            {stat('Lead Inc.', `₹${fmt(detail.lead_incentive)}`)}
            {stat('Slab Bonus', `₹${fmt(detail.slab_bonus)}`, '#b45309')}
            {detail.champion_bonus > 0 && stat('Champion', `₹${fmt(detail.champion_bonus)}`, '#f59e0b')}
            {stat('Total', `₹${fmt(detail.total_incentive)}`, '#b45309')}
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>Individual Leads ({detail.leads?.length || 0})</div>
          {detail.leads && detail.leads.length > 0 ? (
            <div style={{ border: '1.5px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Status</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Donor</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Mobile</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Amount</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 11 }}>Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.leads.map((lead, i) => (
                      <tr key={lead.id || i} style={{ borderBottom: '1px solid var(--line)', background: lead.qualified ? 'rgba(220,252,231,.35)' : 'transparent' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 50, background: lead.qualified ? '#dcfce7' : '#f1f5f9', fontSize: 12, fontWeight: 800, color: lead.qualified ? '#16a34a' : '#94a3b8' }}>
                            {lead.qualified ? '✓' : '✗'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--ink)' }}>{lead.donor_name || `Donor #${lead.donor_id || '—'}`}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{lead.donor_mobile || '—'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: lead.qualified ? '#16a34a' : 'var(--ink-soft)' }}>₹{fmt(lead.amount)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{fmtDate(lead.verified_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 12, border: '1.5px dashed var(--line)', borderRadius: 12 }}>No leads for this date</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────
export default function LeadIncentive() {
  const [date, setDate] = useState(() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  })
  const [slabs, setSlabs] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)
  const [champion, setChampion] = useState(null)
  const [selectedFroId, setSelectedFroId] = useState(null)
  const [savingSlabId, setSavingSlabId] = useState(null)
  const [addBusy, setAddBusy] = useState(false)
  const [announcingSlab, setAnnouncingSlab] = useState(null)
  const [popsBusyId, setPopsBusyId] = useState(null)

  // form state: champion bonus (formerly global rate/amount removed)
  const [formData, setFormData] = useState({ champion_bonus: 0 })
  const [saveMsg, setSaveMsg] = useState('')

  // ── live slab pops ──
  const [livePops, setLivePops] = useState([])
  const [popHistory, setPopHistory] = useState([])

  const loadLivePops = useCallback(async () => {
    try {
      const all = await api('/incentive/special?_all=1', { _prefix: 'ucs' })
      const list = Array.isArray(all) ? all : []
      setLivePops(list.filter(x =>
        String(x.title || '').startsWith(SLAB_TAG) &&
        (x.status === 'active' || x.status === 'draft') &&
        new Date(x.end_at).getTime() > Date.now()
      ))
      setPopHistory(list.filter(x => String(x.title || '').startsWith(SLAB_TAG)).slice(0, 20))
    } catch { /* ignore */ }
  }, [])

  // ── load data ──
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [slabData, summaryData, settingsData] = await Promise.all([
        api(`/incentive/lead/slabs?date=${date}`, { _prefix: 'ucs' }),
        api(`/incentive/lead/lead-summary?date=${date}`, { _prefix: 'ucs' }),
        api('/incentive/lead/settings', { _prefix: 'ucs' }),
      ])
      setSlabs(slabData || [])
      setSummary(summaryData)
      setFormData({ champion_bonus: Number(settingsData?.champion_bonus) || 0 })
      if (summaryData?.champion) setChampion(summaryData.champion)
    } catch (e) {
      console.error('Failed to load lead incentive data', e)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadLivePops() }, [loadLivePops])

  // ── realtime ──
  useRealtime('special_incentives', { onInsert: loadLivePops, onUpdate: loadLivePops, onDelete: loadLivePops })
  useRealtime('incentive_slabs', { onInsert: loadData, onUpdate: loadData, onDelete: loadData })

  // ── save champion bonus only ──
  const saveSettings = async () => {
    setSaveMsg('')
    try {
      await api('/incentive/lead/settings', {
        method: 'PUT', _prefix: 'ucs',
        body: JSON.stringify({ champion_bonus: Number(formData.champion_bonus) || 0 }),
      })
      setSaveMsg('✓ Champion bonus saved')
      loadData()
    } catch (e) {
      setSaveMsg(e.message || 'Failed to save')
    }
  }

  // ── slab CRUD ──
  const saveSlab = async (id, f) => {
    setSavingSlabId(id)
    try {
      await api(`/incentive/lead/slabs/${id}`, {
        method: 'PUT', _prefix: 'ucs',
        body: JSON.stringify({
          min_amount: Number(f.min_amount),
          max_amount: Number(f.max_amount),
          incentive_amount: Number(f.incentive_amount),
          min_lead_amount: Number(f.min_lead_amount),
          lead_rate: Number(f.lead_rate),
        }),
      })
      toast('Range saved', 'success')
      loadData()
    } catch (e) {
      toast(e.message || 'Failed to save range', 'error')
    } finally {
      setSavingSlabId(null)
    }
  }

  const addSlab = async (f) => {
    setAddBusy(true)
    try {
      await api('/incentive/lead/slabs', {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({
          min_amount: Number(f.min_amount),
          max_amount: Number(f.max_amount),
          incentive_amount: Number(f.incentive_amount),
          min_lead_amount: Number(f.min_lead_amount),
          lead_rate: Number(f.lead_rate),
        }),
      })
      toast('New range added', 'success')
      loadData()
    } catch (e) {
      toast(e.message || 'Failed to add range', 'error')
    } finally {
      setAddBusy(false)
    }
  }

  const deleteSlab = async (id) => {
    if (!confirm('Delete this range permanently?')) return
    try {
      await api(`/incentive/lead/slabs/${id}`, { method: 'DELETE', _prefix: 'ucs' })
      toast('Range deleted', 'success')
      loadData()
    } catch (e) {
      toast(e.message || 'Failed to delete range', 'error')
    }
  }

  // ── send pop (trigger modal) ──
  const onSendPop = (slab) => setAnnouncingSlab(slab)
  const onPopSaved = () => { loadLivePops(); loadData() }

  // ── stop / delete live pop ──
  const stopPop = async (id) => {
    setPopsBusyId(id)
    try {
      await api(`/incentive/special/${id}/cancel`, { method: 'POST', _prefix: 'ucs' })
      toast('Slab pop stopped', 'success')
      loadLivePops()
    } catch (e) {
      toast(e.message || 'Failed to stop pop', 'error')
    } finally {
      setPopsBusyId(null)
    }
  }

  const deletePop = async (pop) => {
    if (!confirm(`Delete "${pop.title}" permanently?`)) return
    setPopsBusyId(pop.id)
    try {
      await api(`/incentive/special/${pop.id}`, { method: 'DELETE', _prefix: 'ucs' })
      toast('Slab pop deleted', 'success')
      loadLivePops()
    } catch (e) {
      toast(e.message || 'Failed to delete pop', 'error')
    } finally {
      setPopsBusyId(null)
    }
  }

  // ── calculate ──
  const calculate = async () => {
    setCalculating(true)
    try {
      await api(`/incentive/lead/calculate?date=${date}`, { method: 'POST', _prefix: 'ucs' })
      toast('Recalculated!', 'success')
      loadData()
    } catch (e) {
      toast(e.message || 'Failed to calculate', 'error')
    } finally {
      setCalculating(false)
    }
  }

  const froSummaryList = summary?.fro_summaries || []
  const hasSlabs = slabs.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Live pops */}
      <LiveSlabPops pops={livePops} history={popHistory} busyId={popsBusyId} onStop={stopPop} onDelete={deletePop} />

      {/* Date + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)' }}>Period:</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1.5px solid var(--line)', fontSize: 13, color: 'var(--ink)' }} />
        <button onClick={calculate} disabled={calculating || !hasSlabs} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(90deg,#16a34a,#22c55e)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: (!hasSlabs || calculating) ? 'not-allowed' : 'pointer', opacity: (!hasSlabs || calculating) ? .55 : 1 }}>
          {calculating ? 'Calculating…' : '💰 Calculate'}
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
          {hasSlabs ? `${slabs.length} active range${slabs.length > 1 ? 's' : ''} configured` : 'Configure at least one range below'}
        </span>
      </div>

      {!hasSlabs && (
        <div style={{ padding: 20, textAlign: 'center', borderRadius: 14, border: '1.5px dashed var(--line)', background: 'var(--card-bg)', color: 'var(--ink-soft)', fontSize: 13 }}>
          No slab ranges configured yet — add one below to start tracking lead incentives
        </div>
      )}

      {summary?.has_settings === false && (
        <div style={{ padding: 20, textAlign: 'center', borderRadius: 14, border: '1.5px dashed #f59e0b', background: '#fffdf5', color: '#b45309', fontSize: 13 }}>
          Global incentive settings not configured yet. Lead incentive works without them but per-range values will be used.
        </div>
      )}

      {/* Champion bonus */}
      <div style={{ border: '1.5px solid var(--line)', borderRadius: 14, padding: 14, background: 'var(--card-bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 16 }}>🏆</span>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>Champion Bonus</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>₹ Fixed Bonus (top FRO)</label>
          <input
            type="number"
            value={formData.champion_bonus}
            onChange={e => setFormData(p => ({ ...p, champion_bonus: e.target.value }))}
            style={{ width: 130, padding: '7px 10px', borderRadius: 8, border: '1.5px solid var(--line)', fontSize: 13, color: 'var(--ink)', textAlign: 'right' }}
          />
          <button onClick={saveSettings} style={{ padding: '6px 14px', borderRadius: 8, border: '1.5px solid #bbf7d0', background: '#f0fdf4', color: '#15803d', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Save</button>
          {saveMsg && <span style={{ fontSize: 11.5, color: '#15803d', fontWeight: 700 }}>{saveMsg}</span>}
        </div>
      </div>

      {/* Range config */}
      <RangeConfig slabs={slabs} savingId={savingSlabId} onSave={saveSlab} onAdd={addSlab} onDelete={deleteSlab} onSendPop={onSendPop} addBusy={addBusy} />

      {/* FRO summary */}
      {froSummaryList.length > 0 && <FroLeadSummary fros={froSummaryList} champion={champion} date={date} onSelectFro={setSelectedFroId} />}
      {loading && <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 12 }}>Loading…</div>}

      {/* Detail modal */}
      {selectedFroId && <FroDetailModal froId={selectedFroId} date={date} champion={champion} onClose={() => setSelectedFroId(null)} />}

      {/* Send Pop modal */}
      {announcingSlab && <SlabAnnounceModal slab={announcingSlab} onClose={() => setAnnouncingSlab(null)} onSaved={onPopSaved} />}
    </div>
  )
}
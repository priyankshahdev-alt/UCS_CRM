import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/auth'

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

// ─── Lead Rules Settings ──────────────────────────────────
function LeadRulesSettings({ settings, onSave, saving }) {
  const [local, setLocal] = useState({ ...settings })
  const [dirty, setDirty] = useState(false)

  useEffect(() => { setLocal({ ...settings }); setDirty(false) }, [settings])

  const update = (key, val) => {
    setLocal(prev => ({ ...prev, [key]: val }))
    setDirty(true)
  }

  return (
    <div style={{ border: '1.5px solid var(--line)', borderRadius: 16, padding: 20, background: 'var(--card-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>⚙️</span>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>Lead Rules</div>
        </div>
        {dirty && (
          <button onClick={() => { onSave(local); setDirty(false) }} disabled={saving}
            style={btnStyle('linear-gradient(90deg,#b45309,#f59e0b)')}>
            {saving ? 'Saving…' : 'Save Rules'}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>
            ₹ per Qualified Lead
          </label>
          <input type="number" style={inputStyle} value={local.lead_rate}
            onChange={e => update('lead_rate', e.target.value)} placeholder="20" />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>
            Minimum Lead Amount (₹)
          </label>
          <input type="number" style={inputStyle} value={local.min_lead_amount}
            onChange={e => update('min_lead_amount', e.target.value)} placeholder="300" />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>
            Champion Bonus (₹)
          </label>
          <input type="number" style={inputStyle} value={local.champion_bonus}
            onChange={e => update('champion_bonus', e.target.value)} placeholder="250" />
        </div>
      </div>
    </div>
  )
}

// ─── Slab Config ──────────────────────────────────────────
function SlabConfig({ slabs, onAdd, onUpdate, onDelete, saving }) {
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ min_amount: '', max_amount: '', incentive_amount: '' })
  const [error, setError] = useState('')

  const startEdit = (slab) => {
    setEditing(slab.id)
    setAdding(false)
    setForm({ min_amount: slab.min_amount, max_amount: slab.max_amount, incentive_amount: slab.incentive_amount })
    setError('')
  }

  const startAdd = () => {
    setAdding(true)
    setEditing(null)
    setForm({ min_amount: '', max_amount: '', incentive_amount: '' })
    setError('')
  }

  const cancel = () => { setEditing(null); setAdding(false); setError('') }

  const submit = async () => {
    setError('')
    if (!(Number(form.min_amount) >= 0) || !(Number(form.max_amount) > 0)) {
      setError('Enter valid min and max amounts'); return
    }
    if (Number(form.min_amount) >= Number(form.max_amount)) {
      setError('Min must be less than max'); return
    }
    try {
      if (editing) {
        await onUpdate(editing, form)
      } else {
        await onAdd(form)
      }
      cancel()
    } catch (e) {
      setError(e.message || 'Failed')
    }
  }

  const fmtSlab = (n) => {
    const v = Number(n)
    if (v >= 100000) return `₹${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L`
    if (v >= 1000) return `₹${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`
    return `₹${v}`
  }

  return (
    <div style={{ border: '1.5px solid var(--line)', borderRadius: 16, padding: 20, background: 'var(--card-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📋</span>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>Target Slabs</div>
        </div>
        {!adding && !editing && (
          <button onClick={startAdd} style={btnStyle('linear-gradient(90deg,#b45309,#f59e0b)')}>+ Add Slab</button>
        )}
      </div>

      {error && (
        <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fee2e2', color: '#b91c1c', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, marginBottom: 16, padding: 14, borderRadius: 12, border: '1.5px dashed #f59e0b', background: '#fffdf5' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 4 }}>Min Amount (₹)</label>
            <input type="number" style={slabInputStyle} value={form.min_amount} onChange={e => setForm(p => ({ ...p, min_amount: e.target.value }))} placeholder="0" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 4 }}>Max Amount (₹)</label>
            <input type="number" style={slabInputStyle} value={form.max_amount} onChange={e => setForm(p => ({ ...p, max_amount: e.target.value }))} placeholder="20000" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 4 }}>Incentive (₹)</label>
            <input type="number" style={slabInputStyle} value={form.incentive_amount} onChange={e => setForm(p => ({ ...p, incentive_amount: e.target.value }))} placeholder="0" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <button onClick={submit} disabled={saving} style={btnStyle('#16a34a')}>{saving ? '…' : 'Save'}</button>
            <button onClick={cancel} style={btnStyle('var(--line)', 'var(--ink)')}>Cancel</button>
          </div>
        </div>
      )}

      {/* Slab table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--line)' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Range</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12 }}>Incentive</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--ink-soft)', fontSize: 12, width: 140 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {slabs.filter(s => s.is_active).map(slab => (
              editing === slab.id ? (
                <tr key={slab.id} style={{ borderBottom: '1px solid var(--line)', background: '#fffdf5' }}>
                  <td style={{ padding: 6 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="number" style={{ ...slabInputStyle, width: 110 }} value={form.min_amount} onChange={e => setForm(p => ({ ...p, min_amount: e.target.value }))} />
                      <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>to</span>
                      <input type="number" style={{ ...slabInputStyle, width: 110 }} value={form.max_amount} onChange={e => setForm(p => ({ ...p, max_amount: e.target.value }))} />
                    </div>
                  </td>
                  <td style={{ padding: 6 }}>
                    <input type="number" style={slabInputStyle} value={form.incentive_amount} onChange={e => setForm(p => ({ ...p, incentive_amount: e.target.value }))} />
                  </td>
                  <td style={{ padding: 6, textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button onClick={submit} disabled={saving} style={{ ...btnStyle('#16a34a'), padding: '6px 12px', fontSize: 12 }}>{saving ? '…' : 'Save'}</button>
                      <button onClick={cancel} style={{ ...btnStyle('var(--line)', 'var(--ink)'), padding: '6px 12px', fontSize: 12 }}>Cancel</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={slab.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink)' }}>
                    {fmtSlab(slab.min_amount)} – {fmtSlab(slab.max_amount)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: '#b45309' }}>
                    ₹{fmt(slab.incentive_amount)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button onClick={() => startEdit(slab)} style={{ ...btnStyle('var(--card-bg)', 'var(--ink)'), padding: '5px 10px', fontSize: 11, border: '1px solid var(--line)' }}>Edit</button>
                      <button onClick={() => onDelete(slab.id)} style={{ ...btnStyle('#fee2e2', '#b91c1c'), padding: '5px 10px', fontSize: 11, border: '1px solid #fecaca' }}>Delete</button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {slabs.filter(s => s.is_active).length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
                  No slabs configured — add the first one!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── FRO Lead Summary ─────────────────────────────────────
function FroLeadSummary({ fros, champion, settings, date, onSelectFro }) {
  return (
    <div style={{ border: '1.5px solid var(--line)', borderRadius: 16, background: 'var(--card-bg)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>📋</span>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>FRO Lead Summary</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
          ₹{settings.lead_rate}/lead · Min ₹{fmt(settings.min_lead_amount)}
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
                <FroRow
                  key={fro.fro_id}
                  fro={fro}
                  isChampion={isChampion}
                  slabLabel={slabLabel}
                  onSelect={onSelectFro}
                />
              )
            })}
            {fros.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: 32, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
                  No FROs found
                </td>
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

// ─── FRO Row (click to open detail modal) ─────────────────
function FroRow({ fro, isChampion, slabLabel, onSelect }) {
  return (
    <tr
      onClick={() => onSelect && onSelect(fro.fro_id)}
      style={{
        borderBottom: '1px solid var(--line)',
        cursor: 'pointer',
        background: isChampion ? '#fffdf5' : 'transparent',
      }}
    >
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
      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, color: '#b45309', fontSize: 14 }}>
        ₹{fmt(fro.total_incentive)}
      </td>
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
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--danger)', fontSize: 13 }}>{error}</div>
          <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 20 }}>
            <button onClick={onClose} style={btnStyle('var(--line)', 'var(--ink)')}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  if (!detail) return null

  const isChampion = champion && champion.fro_id === detail.fro_id
  const slabLabel = detail.slab
    ? `₹${fmt(detail.slab.min_amount)} – ₹${fmt(detail.slab.max_amount)}`
    : '—'

  const stat = (label, value, color) => (
    <div style={{
      borderRadius: 12, padding: '12px 14px', background: 'var(--bg)',
      border: '1.5px solid var(--line)', textAlign: 'center', minWidth: 110, flex: 1,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 900, color: color || 'var(--ink)', marginTop: 4 }}>{value}</div>
    </div>
  )

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalCardStyle, width: 'min(760px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        {/* Modal header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', background: 'linear-gradient(135deg,#fffdf5,#fef3c7)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏆</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
              {detail.fro_name}
              {isChampion && <span style={{ marginLeft: 6, fontSize: 13 }}>🏆</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              {fmtDate(detail.date)} · Lead detail
            </div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 50, background: 'var(--line)', border: 'none', fontWeight: 700, color: 'var(--ink)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '16px 20px 20px' }}>
          {/* Stats grid */}
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

          {/* Leads list */}
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>
            Individual Leads ({detail.leads?.length || 0})
          </div>
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
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 22, height: 22, borderRadius: 50,
                            background: lead.qualified ? '#dcfce7' : '#f1f5f9',
                            fontSize: 12, fontWeight: 800, color: lead.qualified ? '#16a34a' : '#94a3b8',
                          }}>
                            {lead.qualified ? '✓' : '✗'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--ink)' }}>
                          {lead.donor_name || `Donor #${lead.donor_id || '—'}`}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                          {lead.donor_mobile || '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: lead.qualified ? '#16a34a' : 'var(--ink-soft)' }}>
                          ₹{fmt(lead.amount)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                          {fmtDate(lead.verified_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 12, border: '1.5px dashed var(--line)', borderRadius: 12 }}>
              No leads for this date
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 99992, background: 'rgba(15,23,42,.55)',
  backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
}

const modalCardStyle = {
  width: 'min(500px, 100%)', borderRadius: 16, background: 'var(--card-bg)',
  boxShadow: '0 24px 60px rgba(0,0,0,.35)', overflow: 'hidden',
}

// ─── Main Component ───────────────────────────────────────
export default function LeadIncentive() {
  const [settings, setSettings] = useState({ lead_rate: 20, min_lead_amount: 300, champion_bonus: 250 })
  const [slabs, setSlabs] = useState([])
  const [summary, setSummary] = useState(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingSlab, setSavingSlab] = useState(false)
  const [announced, setAnnounced] = useState(null)
  const [announceOpen, setAnnounceOpen] = useState(false)
  const [announceMsg, setAnnounceMsg] = useState('')
  const [announcing, setAnnouncing] = useState(false)
  const [detailFroId, setDetailFroId] = useState(null)

  const loadSettings = useCallback(async () => {
    try {
      const data = await api('/incentive/lead/settings', { _prefix: 'ucs' })
      if (data) setSettings(data)
    } catch { /* ignore */ }
  }, [])

  const loadSlabs = useCallback(async () => {
    try {
      const data = await api('/incentive/lead/slabs', { _prefix: 'ucs' })
      if (Array.isArray(data)) setSlabs(data)
    } catch { /* ignore */ }
  }, [])

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api(`/incentive/lead/lead-summary?date=${date}`, { _prefix: 'ucs' })
      if (data) setSummary(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [date])

  const loadAnnouncement = useCallback(async () => {
    try {
      const r = await api(`/incentive/lead/champion/current?date=${date}`, { _prefix: 'ucs' })
      if (r && r.announcement) setAnnounced(r.announcement)
      else setAnnounced(null)
    } catch { /* ignore */ }
  }, [date])

  useEffect(() => { loadSettings(); loadSlabs() }, [loadSettings, loadSlabs])
  useEffect(() => { loadSummary(); loadAnnouncement() }, [loadSummary, loadAnnouncement])

  const saveSettings = async (newSettings) => {
    setSavingSettings(true)
    try {
      const updated = await api('/incentive/lead/settings', {
        method: 'PUT', _prefix: 'ucs',
        body: JSON.stringify({
          lead_rate: Number(newSettings.lead_rate),
          min_lead_amount: Number(newSettings.min_lead_amount),
          champion_bonus: Number(newSettings.champion_bonus),
        }),
      })
      if (updated) setSettings(updated)
      loadSummary()
    } catch (e) {
      alert(e.message || 'Failed to save')
    } finally { setSavingSettings(false) }
  }

  const addSlab = async (form) => {
    setSavingSlab(true)
    try {
      await api('/incentive/lead/slabs', {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({
          min_amount: Number(form.min_amount),
          max_amount: Number(form.max_amount),
          incentive_amount: Number(form.incentive_amount) || 0,
        }),
      })
      await loadSlabs()
      loadSummary()
    } finally { setSavingSlab(false) }
  }

  const updateSlab = async (id, form) => {
    setSavingSlab(true)
    try {
      await api(`/incentive/lead/slabs/${id}`, {
        method: 'PUT', _prefix: 'ucs',
        body: JSON.stringify({
          min_amount: Number(form.min_amount),
          max_amount: Number(form.max_amount),
          incentive_amount: Number(form.incentive_amount) || 0,
        }),
      })
      await loadSlabs()
      loadSummary()
    } finally { setSavingSlab(false) }
  }

  const deleteSlab = async (id) => {
    if (!window.confirm('Remove this slab?')) return
    setSavingSlab(true)
    try {
      await api(`/incentive/lead/slabs/${id}`, { method: 'DELETE', _prefix: 'ucs' })
      await loadSlabs()
      loadSummary()
    } finally { setSavingSlab(false) }
  }

  const confirmAnnounce = async () => {
    setAnnouncing(true)
    try {
      const r = await api('/incentive/lead/champion/announce', {
        method: 'POST', _prefix: 'ucs',
        body: JSON.stringify({ date, message: announceMsg.trim() }),
      })
      if (r && r.announcement) {
        setAnnounced(r.announcement)
        setAnnounceOpen(false)
        setAnnounceMsg('')
      }
    } catch (e) {
      alert(e.message || 'Failed to announce')
    } finally { setAnnouncing(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 22 }}>📊</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Lead Incentive</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Auto-calculated from verified lead_done dispositions</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>📅</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ ...inputStyle, width: 160 }}
          />
          <button onClick={loadSummary} style={btnStyle('var(--card-bg)', 'var(--ink)')}>↻ Refresh</button>
        </div>
      </div>

      {/* Lead Rules */}
      <LeadRulesSettings settings={settings} onSave={saveSettings} saving={savingSettings} />

      {/* Slab Config */}
      <SlabConfig slabs={slabs} onAdd={addSlab} onUpdate={updateSlab} onDelete={deleteSlab} saving={savingSlab} />

      {/* Champion */}
      {announced ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
          borderRadius: 14, background: 'linear-gradient(135deg,#dcfce7,#bbf7d0)',
          border: '2px solid #22c55e',
        }}>
          <span style={{ fontSize: 24 }}>🏆</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#166534' }}>
              Champion Announced: {announced.fro_name}
            </div>
            <div style={{ fontSize: 12, color: '#15803d', marginTop: 2 }}>
              ₹{fmt(announced.total_amount)} · {announced.qualified_leads || 0} qualified leads · Total ₹{fmt(announced.total_incentive)}
            </div>
          </div>
          <span style={{ padding: '5px 12px', borderRadius: 999, background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>
            ✓ ANNOUNCED
          </span>
        </div>
      ) : summary?.champion && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
          borderRadius: 14, background: 'linear-gradient(135deg,#fef3c7,#fde68a)',
          border: '2px solid #f59e0b', boxShadow: '0 4px 14px rgba(245,158,11,.2)',
        }}>
          <span style={{ fontSize: 28 }}>🏆</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e' }}>
              Today's Leader: {summary.champion.fro_name}
            </div>
            <div style={{ fontSize: 12, color: '#b45309', marginTop: 2 }}>
              Highest collection: ₹{fmt(summary.champion.total_amount)} from qualified leads
            </div>
          </div>
          <button onClick={() => setAnnounceOpen(true)} style={btnStyle('linear-gradient(90deg,#b45309,#f59e0b)')}>
            🎉 Announce Champion
          </button>
        </div>
      )}

      {/* FRO Summary */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
          Loading lead data…
        </div>
      ) : (
        <FroLeadSummary
          fros={summary?.fros || []}
          champion={summary?.champion || null}
          settings={settings}
          date={date}
          onSelectFro={id => setDetailFroId(id)}
        />
      )}

      {/* FRO Detail Modal */}
      {detailFroId && (
        <FroDetailModal
          froId={detailFroId}
          date={date}
          champion={summary?.champion || null}
          onClose={() => setDetailFroId(null)}
        />
      )}

      {/* Announce Champion Modal */}
      {announceOpen && summary?.champion && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99991, background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(400px,100%)', borderRadius: 16, padding: 22, background: 'var(--card-bg)', border: '2px solid #f59e0b', boxShadow: '0 24px 60px rgba(0,0,0,.35)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>🏆 Announce Champion for {date}?</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 8 }}>
              <b style={{ color: 'var(--ink)' }}>{summary.champion.fro_name}</b> has the highest collection (₹{fmt(summary.champion.total_amount)}).
              This will lock them as today's champion and notify every panel.
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }}>Message (optional)</label>
              <textarea
                value={announceMsg}
                onChange={e => setAnnounceMsg(e.target.value)}
                placeholder="e.g. Great work today everyone! 🎉"
                style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => setAnnounceOpen(false)} disabled={announcing} style={{ ...btnStyle('var(--line)', 'var(--ink)'), flex: 1 }}>
                Cancel
              </button>
              <button onClick={confirmAnnounce} disabled={announcing} style={{ ...btnStyle('linear-gradient(90deg,#b45309,#f59e0b)'), flex: 1 }}>
                {announcing ? 'Announcing…' : '🏆 Confirm Announce'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

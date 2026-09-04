import { useState, useEffect } from 'react';
import { toast } from './Toast';
import { addSimCard, updateSimCard, replaceSimCard, fetchSimHistory } from './api';
import { SIM_STATUSES, SIM_TYPES, SIM_SLOTS, MAX_SIM_SLOTS, FORM_FIELDS, daysLeft, todayStr, effectiveStatus, dayLabel, dayClass, formatDate, pillForStatus } from './helpers';

function Field({ label, value, onChange, type = 'text', disabled, placeholder }) {
  return (
    <div className="form-row">
      <label>{label}</label>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} />
    </div>
  );
}

function computeDl(expiry) {
  return expiry ? daysLeft(expiry) : null;
}

export function SimFormModal({ open, onClose, card, onSaved }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(FORM_FIELDS.map((f) => [f.key, card?.[f.key] || '']))
  );
  const [extra, setExtra] = useState({
    team: card?.team || '',
    signature: card?.signature || '',
    ngo: card?.ngo || '',
    sim_type: card?.sim_type || '',
    gb: card?.gb || '',
    issue_date: card?.issue_date || '',
    expiry_date: card?.expiry_date || '',
    status: card?.status || 'Active',
  });
  const [simList, setSimList] = useState(() => {
    const existing = [];
    for (let i = 1; i <= MAX_SIM_SLOTS; i++) {
      const val = card?.[`sim_${i}`];
      if (val && String(val).trim()) existing.push(val);
    }
    return existing;
  });
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let active = true;
    if (open && card) {
      fetchSimHistory(card.id)
        .then((h) => { if (active && Array.isArray(h)) setHistory(h); })
        .catch(() => { if (active) setHistory([]); });
    } else if (!open) {
      setHistory([]);
    }
    return () => { active = false; };
  }, [open, card]);

  if (!open) return null;

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));
  const setE = (key, val) => setExtra((p) => ({ ...p, [key]: val }));

  const dl = computeDl(extra.expiry_date);

  function addSimField() { if (simList.length < MAX_SIM_SLOTS) setSimList((p) => [...p, '']); }
  function removeSimField(idx) { setSimList((p) => p.filter((_, i) => i !== idx)); }
  function setSimVal(idx, val) { setSimList((p) => p.map((v, i) => i === idx ? val : v)); }

  async function handleSave() {
    if (!form.mobile_id || !String(form.mobile_id).trim()) {
      toast('Please fill Mobile ID No.', 'error');
      return;
    }
    setSaving(true);
    const simFields = {};
    simList.filter((v) => v && String(v).trim()).forEach((v, i) => { simFields[`sim_${i + 1}`] = v; });
    for (let i = simList.filter((v) => v && String(v).trim()).length + 1; i <= MAX_SIM_SLOTS; i++) { simFields[`sim_${i}`] = null; }
    const payload = {
      ...form,
      ...simFields,
      team: extra.team,
      signature: extra.signature,
      ngo: extra.ngo,
      sim_type: extra.sim_type || null,
      gb: extra.gb || null,
      issue_date: extra.issue_date,
      expiry_date: extra.expiry_date,
      status: extra.status,
    };
    try {
      if (card) {
        await updateSimCard(card.id, payload);
        toast('SIM card updated', 'success');
      } else {
        await addSimCard(payload);
        toast('SIM card added', 'success');
      }
      if (card) {
        try {
          const h = await fetchSimHistory(card.id);
          if (Array.isArray(h)) setHistory(h);
        } catch { /* keep current history */ }
      }
      onSaved();
      onClose();
    } catch (e) {
      toast(e.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{card ? 'Edit SIM Card' : 'Add SIM Card'}</h3>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <Field label="Mobile ID No.*" value={form.mobile_id} onChange={(v) => set('mobile_id', v)} />
            <Field label="Device & Model Name" value={form.device_model} onChange={(v) => set('device_model', v)} />
            <Field label="GB" value={extra.gb} onChange={(v) => setE('gb', v)} placeholder="e.g. 64 GB" />
            <Field label="IMEI No." value={form.imei} onChange={(v) => set('imei', v)} />
            <Field label="Team" value={extra.team} onChange={(v) => setE('team', v)} />
            <Field label="NGO" value={extra.ngo} onChange={(v) => setE('ngo', v)} />
            <Field label="Remark" value={extra.signature} onChange={(v) => setE('signature', v)} />
            <div className="form-row">
              <label>SIM Type</label>
              <select value={extra.sim_type} onChange={(e) => setE('sim_type', e.target.value)}>
                <option value="">Select SIM Type</option>
                {SIM_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Field label="SIM Card Issue Date" type="date" value={extra.issue_date} onChange={(v) => setE('issue_date', v)} />
            <Field label="Auto Expiry Date" type="date" value={extra.expiry_date} onChange={(v) => setE('expiry_date', v)} />
            <div className="form-row">
              <label>SIM Card Status</label>
              <select value={extra.status} onChange={(e) => setE('status', e.target.value)}>
                {SIM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-row locked full">
              <label>SIM Expiry Days Left (auto-calculated)</label>
              <input value={dl === null ? '—' : `${dl} days`} disabled />
            </div>
          </div>

          <div className="section-title" style={{ margin: '18px 0 10px', fontSize: 13 }}>SIM Details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {simList.map((val, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
                  <label>SIM {idx + 1}</label>
                  <input value={val} onChange={(e) => setSimVal(idx, e.target.value)} placeholder={`SIM ${idx + 1}`} />
                </div>
                {simList.length > 1 && (
                  <button type="button" className="mini-btn danger" onClick={() => removeSimField(idx)} style={{ marginTop: 18, padding: '5px 8px', fontSize: 14, lineHeight: 1 }}>×</button>
                )}
              </div>
            ))}
            {simList.length < MAX_SIM_SLOTS && (
              <button type="button" className="sim-btn" onClick={addSimField} style={{ alignSelf: 'flex-start', marginTop: 2 }}>+ Add SIM</button>
            )}
          </div>

          {card && (
            <>
            <div className="section-title" style={{ margin: '18px 0 10px', fontSize: 13 }}>Change History</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
              {history.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--sim-ink-soft)' }}>No previous changes saved.</div>
              ) : (
                history.map((h) => (
                  <div key={h.id} style={{ border: '1px solid var(--sim-line)', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {h.changed_at ? new Date(h.changed_at).toLocaleString() : ''}
                      {h.changed_by ? ` · by ${h.changed_by}` : ''}
                    </div>
                    {(h.changed_cols && Object.keys(h.changed_cols).length) ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {Object.entries(h.changed_cols).map(([field, v]) => {
                          const shName = field.replace(/^sim_(\d+)$/, 'SIM $1').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                          const added = (v.old === null || v.old === '') && !(v.new === null || v.new === '');
                          const removed = !(v.old === null || v.old === '') && (v.new === null || v.new === '');
                          return (
                            <div key={field}>
                              <span style={{ color: 'var(--sim-ink-soft)' }}>{shName}: </span>
                              {added ? (
                                <span style={{ color: 'var(--sim-green)' }}>Added: {String(v.new)}</span>
                              ) : removed ? (
                                <span style={{ color: 'var(--sim-red)' }}>Removed: {String(v.old)}</span>
                              ) : (
                                <>
                                  <span style={{ textDecoration: 'line-through', color: 'var(--sim-red)' }}>{String(v.old)}</span>
                                  <span> → </span>
                                  <span style={{ color: 'var(--sim-green)' }}>{String(v.new)}</span>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--sim-ink-soft)' }}>Data updated</div>
                    )}
                  </div>
                ))
              )}
            </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="sim-btn" onClick={onClose}>Cancel</button>
          <button className="sim-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : card ? 'Save Changes' : 'Save SIM Card'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SimViewModal({ card, open, onClose, onEdit, onReplace }) {
  if (!open || !card) return null;
  const dl = card.days_left !== undefined && card.days_left !== null ? card.days_left : daysLeft(card.expiry_date);
  const status = effectiveStatus(card);
  const Item = ({ k, v }) => (
    <div className="detail-item">
      <div className="k">{k}</div>
      <div className="v">{v || '—'}</div>
    </div>
  );
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal drawer" style={{ borderRadius: 14, marginLeft: 'auto', marginRight: 0 }}>
        <div className="modal-head">
          <h3>SIM Card Details</h3>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="detail-sections">
            <div className="detail-sec">
              <h4>SIM Information</h4>
              <div className="detail-grid">
                <Item k="Mobile ID" v={card.mobile_id} />
                <div className="detail-item"><div className="k">SIM Status</div><div className="v"><span className={`pill ${pillForStatus(status)}`}>{status}</span></div></div>
                <Item k="Issue Date" v={formatDate(card.issue_date)} />
                <Item k="Expiry Date" v={formatDate(card.expiry_date)} />
                <div className="detail-item"><div className="k">Days Left</div><div className={`v ${dl !== null ? dayClass(dl) : ''}`}>{dayLabel(dl)}</div></div>
                <Item k="Replacement Count" v={card.replacement_count} />
              </div>
            </div>
            <div className="detail-sec">
              <h4>Device Information</h4>
              <div className="detail-grid">
                <Item k="Device & Model" v={card.device_model} />
                <Item k="IMEI" v={card.imei} />
                <Item k="Team" v={card.team} />
                <Item k="NGO" v={card.ngo} />
                <Item k="Signature" v={card.signature} />
              </div>
            </div>
            <div className="detail-sec">
              <h4>SIM Details</h4>
              <div className="detail-grid">
                {SIM_SLOTS.map((n) => <Item key={n} k={`SIM ${n}`} v={card[`sim_${n}`]} />)}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="sim-btn" onClick={() => { onClose(); onReplace(); }}>Replace</button>
          <button className="sim-btn" onClick={() => { onClose(); onEdit(); }}>Edit</button>
          <button className="sim-btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function ReplaceModal({ card, open, onClose, onDone }) {
  const [form, setForm] = useState({ new_sim: '', replacement_date: todayStr(), reason: '', new_expiry_date: '' });
  const [saving, setSaving] = useState(false);
  if (!open || !card) return null;
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function handleReplace() {
    if (!form.new_sim) {
      toast('New SIM number is required', 'error');
      return;
    }
    setSaving(true);
    try {
      await replaceSimCard(card.id, form);
      toast('SIM card replaced', 'success');
      onDone();
      onClose();
    } catch (e) {
      toast(e.message || 'Replacement failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  const Item = ({ k, v }) => (
    <div className="detail-item"><div className="k">{k}</div><div className="v">{v || '—'}</div></div>
  );

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>Replace SIM Card</h3>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="detail-sec" style={{ marginBottom: 18 }}>
            <h4>Current SIM</h4>
            <div className="detail-grid">
              <Item k="Mobile ID" v={card.mobile_id} />
              <Item k="Device" v={card.device_model} />
              <Item k="Current Status" v={card.status} />
              <Item k="Current Issue Date" v={formatDate(card.issue_date)} />
              <div className="detail-item"><div className="k">Current Expiry Date</div><div className="v">{formatDate(card.expiry_date)}</div></div>
              <Item k="Replacement Count" v={card.replacement_count} />
            </div>
          </div>
          <div className="form-grid">
            <Field label="New SIM Number *" value={form.new_sim} onChange={(v) => set('new_sim', v)} />
            <Field label="Replacement Date" type="date" value={form.replacement_date} onChange={(v) => set('replacement_date', v)} />
            <Field label="New Expiry Date" type="date" value={form.new_expiry_date} onChange={(v) => set('new_expiry_date', v)} />
            <div className="form-row full">
              <label>Reason</label>
              <textarea rows={2} value={form.reason} onChange={(e) => set('reason', e.target.value)} style={{ fontFamily: 'inherit', fontSize: 13, padding: '9px 11px', border: '1px solid var(--sim-line)', borderRadius: 8, outline: 'none' }} />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="sim-btn" onClick={onClose}>Cancel</button>
          <button className="sim-btn primary" onClick={handleReplace} disabled={saving}>{saving ? 'Replacing...' : 'Replace SIM'}</button>
        </div>
      </div>
    </div>
  );
}

const HISTORY_FIELD_LABELS = {
  mobile_id: 'Mobile ID No.',
  device_model: 'Device & Model Name',
  gb: 'GB',
  imei: 'IMEI No.',
  team: 'Team',
  signature: 'Remark',
  ngo: 'NGO',
  sim_type: 'SIM Type',
  issue_date: 'SIM Card Issue Date',
  expiry_date: 'Auto Expiry Date',
  status: 'SIM Card Status',
  replacement_count: 'Sim Card Repla. Count',
};

function historyFieldLabel(key) {
  if (HISTORY_FIELD_LABELS[key]) return HISTORY_FIELD_LABELS[key];
  if (/^sim_\d+$/.test(key)) return `SIM ${key.slice(4)}`;
  return key.replace(/_/g, ' ');
}

function historyAction(oldV, newV) {
  const oldEmpty = oldV === null || oldV === undefined || String(oldV).trim() === '';
  const newEmpty = newV === null || newV === undefined || String(newV).trim() === '';
  if (oldEmpty && !newEmpty) return 'Added';
  if (!oldEmpty && newEmpty) return 'Removed';
  return 'Updated';
}

function displayValue(v) {
  if (v === null || v === undefined || v === '') return 'Blank';
  return String(v);
}

function formatDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(dt.getDate());
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[dt.getMonth()];
  const year = dt.getFullYear();
  let h = dt.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${day}-${mon}-${year} ${pad(h)}:${pad(dt.getMinutes())} ${ampm}`;
}

function historyRows(list) {
  const rows = [];
  for (const h of list || []) {
    const cols = h.changed_cols && typeof h.changed_cols === 'object' ? h.changed_cols : {};
    const entries = Object.entries(cols);
    if (entries.length === 0) {
      rows.push({ id: h.id, changed_at: h.changed_at, mobile_id: h.mobile_id, field: '—', old: '—', new: '—', action: '—' });
      continue;
    }
    for (const [k, ch] of entries) {
      const oldV = ch && typeof ch === 'object' ? ch.old : ch;
      const newV = ch && typeof ch === 'object' ? ch.new : ch;
      rows.push({
        id: h.id,
        changed_at: h.changed_at,
        mobile_id: h.mobile_id,
        field: historyFieldLabel(k),
        old: displayValue(oldV),
        new: displayValue(newV),
        action: historyAction(oldV, newV),
      });
    }
  }
  return rows;
}

export function SimHistoryModal({ card, open, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && card) {
      setLoading(true);
      setHistory([]);
      fetchSimHistory(card.id)
        .then((res) => setHistory(res?.data || res || []))
        .catch(() => setHistory([]))
        .finally(() => setLoading(false));
    }
  }, [open, card]);

  if (!open || !card) return null;

  const rows = historyRows(history);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>Sim Card Change History</h3>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="detail-sec" style={{ marginBottom: 14 }}>
            <div className="detail-grid">
              <div className="detail-item"><div className="k">Mobile ID</div><div className="v">{card.mobile_id || '—'}</div></div>
              <div className="detail-item"><div className="k">Device & Model</div><div className="v">{card.device_model || '—'}</div></div>
              <div className="detail-item"><div className="k">Team</div><div className="v">{card.team || '—'}</div></div>
              <div className="detail-item"><div className="k">NGO</div><div className="v">{card.ngo || '—'}</div></div>
              <div className="detail-item"><div className="k">Remark</div><div className="v">{card.signature || '—'}</div></div>
            </div>
          </div>
          {loading ? (
            <div className="empty-state"><div className="small">Loading history...</div></div>
          ) : rows.length === 0 ? (
            <div className="empty-state"><div className="small">No previous changes saved.</div></div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="sim-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date &amp; Time</th>
                    <th>Field Changed</th>
                    <th>Old Value</th>
                    <th>New Value</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={`${r.id}-${idx}`}>
                      <td>{idx + 1}</td>
                      <td>{formatDateTime(r.changed_at)}</td>
                      <td>{r.field}</td>
                      <td>{r.old}</td>
                      <td>{r.new}</td>
                      <td>{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="sim-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

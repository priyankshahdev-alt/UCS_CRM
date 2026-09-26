import { useState, useEffect } from 'react';
import { toast } from '../../../components/Toast';
import { addSimCard, updateSimCard, replaceSimCard, fetchSimHistory } from './api';
import { Icon } from './components';
import { SIM_STATUSES, SIM_TYPES, SIM_SLOTS, MAX_SIM_SLOTS, FORM_FIELDS, daysLeft, todayStr, effectiveStatus, dayLabel, dayClass, formatDate, pillForStatus } from './helpers';

function Field({ label, value, onChange, type = 'text', disabled, placeholder, full, required }) {
  return (
    <div className={`form-row${full ? ' full' : ''}`}>
      <label>
        {label}
        {required ? <span className="req">*</span> : null}
      </label>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} />
    </div>
  );
}

function Select({ label, value, onChange, options, placeholder, full }) {
  return (
    <div className={`form-row${full ? ' full' : ''}`}>
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

function Group({ title, icon, hint, grid, count, children }) {
  return (
    <section className="se-sec">
      <div className="se-sec-head">
        <span className="se-sec-ic">{icon}</span>
        <div className="se-sec-txt">
          <h4>{title}</h4>
          {hint ? <p>{hint}</p> : null}
        </div>
        {count ? <span className="se-sec-count">{count}</span> : null}
      </div>
      <div className={grid ? 'se-sec-body se-form-grid' : 'se-sec-body'}>{children}</div>
    </section>
  );
}

function computeDl(expiry) {
  return expiry ? daysLeft(expiry) : null;
}

function raw(v) {
  return v === null || v === undefined || String(v).trim() === '' ? null : String(v);
}

function txt(v) {
  const s = raw(v);
  return s === null ? '\u2014' : s;
}

export function SimFormModal({ open, onClose, card, onSaved }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(FORM_FIELDS.map((f) => [f.key, card?.[f.key] || '']))
  );
  const [extra, setExtra] = useState({
    team: card?.team || '',
    owner: card?.owner || '',
    signature: card?.signature || '',
    ngo: card?.w1_name || card?.ngo || '',
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
      owner: extra.owner,
      signature: extra.signature,
      ngo: extra.ngo,
      w1_name: extra.ngo,
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
    <div className="modal-overlay sim-edit-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sim-edit-modal">
        <div className="se-head">
          <div className="se-head-main">
            <span className="se-avatar"><Icon name={card ? 'settings' : 'simcard'} size={18} /></span>
            <div className="se-head-txt">
              <h3>{card ? 'Edit SIM Card' : 'Add SIM Card'}</h3>
              <div className="se-head-sub">
                {card ? (
                  <>
                    <span className="se-head-id">{txt(card.mobile_id)}</span>
                    {raw(card.device_model) ? <><i className="se-dot" /><span className="se-head-model">{card.device_model}</span></> : null}
                  </>
                ) : (
                  'Fill in the card details below'
                )}
              </div>
            </div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Icon name="close" size={17} /></button>
        </div>

        <div className="modal-body se-body">
          <Group title="Device Identification" icon={<Icon name="mobile" size={14} />} hint="How this SIM card is identified in the system" grid>
            <Field label="Mobile ID No." value={form.mobile_id} onChange={(v) => set('mobile_id', v)} placeholder="e.g. Android 1" required />
            <Field label="Device & Model Name" value={form.device_model} onChange={(v) => set('device_model', v)} placeholder="e.g. M2006C3LI" />
            <Field label="IMEI No." value={form.imei} onChange={(v) => set('imei', v)} placeholder="15-digit IMEI" />
            <Field label="GB" value={extra.gb} onChange={(v) => setE('gb', v)} placeholder="e.g. 64 GB" />
          </Group>

          <Group title="Assignment" icon={<Icon name="report" size={14} />} hint="Who this card is issued to" grid>
            <Field label="Team" value={extra.team} onChange={(v) => setE('team', v)} />
            <Field label="Owner" value={extra.owner} onChange={(v) => setE('owner', v)} />
            <Field label="NGO" value={extra.ngo} onChange={(v) => setE('ngo', v)} />
            <Field label="Remark" value={extra.signature} onChange={(v) => setE('signature', v)} />
          </Group>

          <Group title="SIM Configuration" icon={<Icon name="sim" size={14} />} hint="Plan type, validity window and current status" grid>
            <Select label="SIM Type" value={extra.sim_type} onChange={(v) => setE('sim_type', v)} options={SIM_TYPES} placeholder="Select SIM Type" />
            <Select label="SIM Card Status" value={extra.status} onChange={(v) => setE('status', v)} options={SIM_STATUSES} />
            <Field label="SIM Card Issue Date" type="date" value={extra.issue_date} onChange={(v) => setE('issue_date', v)} />
            <Field label="Auto Expiry Date" type="date" value={extra.expiry_date} onChange={(v) => setE('expiry_date', v)} />
            <div className="form-row locked full">
              <label>SIM Expiry Days Left <span className="auto-tag">auto</span></label>
              <input value={dl === null ? '\u2014' : `${dl} days`} disabled readOnly />
            </div>
          </Group>

          <Group
            title="SIM Numbers"
            icon={<Icon name="simcard" size={14} />}
            hint={`${simList.filter((v) => v && String(v).trim()).length} of ${MAX_SIM_SLOTS} slots filled`}
          >
            <div className="se-slots">
              {simList.map((val, idx) => (
                <div className="se-slot" key={idx}>
                  <span className="se-slot-idx">{idx + 1}</span>
                  <input value={val} onChange={(e) => setSimVal(idx, e.target.value)} placeholder={`SIM ${idx + 1} number`} />
                  {simList.length > 1 && (
                    <button type="button" className="se-slot-x" onClick={() => removeSimField(idx)} aria-label={`Remove SIM ${idx + 1}`}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {simList.length < MAX_SIM_SLOTS && (
              <button type="button" className="sim-btn se-add-sim" onClick={addSimField}>
                <Icon name="sim" size={14} /> Add SIM Slot
              </button>
            )}
          </Group>

          {card && (
            <section className="se-sec">
              <div className="se-sec-head">
                <span className="se-sec-ic"><Icon name="history" size={14} /></span>
                <div className="se-sec-txt">
                  <h4>Change History</h4>
                  <p>Every saved edit to this card, newest first</p>
                </div>
                {history.length > 0 && <span className="se-sec-count">{history.length}</span>}
              </div>
              <div className="se-sec-body">
                {history.length === 0 ? (
                  <div className="se-empty">
                    <Icon name="history" size={18} />
                    <span>No previous changes saved for this card.</span>
                  </div>
                ) : (
                  <div className="se-tl-scroll">
                    <div className="se-timeline">
                      {history.map((h) => {
                        const cols = h.changed_cols && typeof h.changed_cols === 'object' ? Object.entries(h.changed_cols) : [];
                        return (
                          <div className="se-tl-item" key={h.id}>
                            <span className="se-tl-dot" />
                            <div className="se-tl-card">
                              <div className="se-tl-head">
                                <span className="se-tl-time">{formatDateTime(h.changed_at)}</span>
                                {h.changed_by ? <span className="se-tl-by">by {h.changed_by}</span> : null}
                              </div>
                              {cols.length === 0 ? (
                                <div className="se-tl-none">Data updated</div>
                              ) : (
                                <div className="se-tl-rows">
                                  {cols.map(([field, v]) => {
                                    const name = field.replace(/^sim_(\d+)$/, 'SIM $1').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                                    const oldE = v.old === null || v.old === undefined || v.old === '';
                                    const newE = v.new === null || v.new === undefined || v.new === '';
                                    return (
                                      <div className="se-tl-row" key={field}>
                                        <span className="se-tl-field">{name}</span>
                                        {oldE && !newE ? (
                                          <span className="se-delta add">+ {String(v.new)}</span>
                                        ) : !oldE && newE ? (
                                          <span className="se-delta del">&minus; {String(v.old)}</span>
                                        ) : (
                                          <span className="se-delta">
                                            <s>{String(v.old)}</s>
                                            <em>&rarr;</em>
                                            <b className="new">{String(v.new)}</b>
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="modal-foot se-foot">
          <span className="se-foot-hint">
            {card ? 'Changes are recorded in Change History on save.' : 'Mobile ID No. is required to save.'}
          </span>
          <div className="se-foot-btns">
            <button className="sim-btn" onClick={onClose}>Cancel</button>
            <button className="sim-btn primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : card ? 'Save Changes' : 'Save SIM Card'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SimViewModal({ card, open, onClose, onEdit, onReplace }) {
  if (!open || !card) return null;
  const dl = card.days_left !== undefined && card.days_left !== null ? card.days_left : daysLeft(card.expiry_date);
  const status = effectiveStatus(card);

  const filledSlots = SIM_SLOTS
    .map((n) => ({ n, v: card[`sim_${n}`] }))
    .filter((s) => s.v && String(s.v).trim());

  const totalSpan = (() => {
    if (!card.issue_date || !card.expiry_date) return null;
    const a = new Date(`${String(card.issue_date).slice(0, 10)}T00:00:00`);
    const b = new Date(`${String(card.expiry_date).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    const total = Math.round((b - a) / 86400000);
    return total > 0 ? total : null;
  })();
  const pct = totalSpan && dl !== null ? Math.max(0, Math.min(100, Math.round((dl / totalSpan) * 100))) : null;

  const Item = ({ k, v, wide, mono }) => {
    const empty = v === null || v === undefined || v === '';
    return (
      <div className={`sv-item${wide ? ' wide' : ''}`}>
        <div className="k">{k}</div>
        <div className={`v${mono ? ' mono' : ''}${empty ? ' empty' : ''}`}>{empty ? 'Not set' : v}</div>
      </div>
    );
  };

  const Section = ({ title, icon, count, children }) => (
    <section className="sv-sec">
      <div className="sv-sec-head">
        <span className="sv-sec-ic">{icon}</span>
        <h4>{title}</h4>
        {count ? <span className="sv-sec-count">{count}</span> : null}
      </div>
      <div className="sv-grid">{children}</div>
    </section>
  );

  return (
    <div className="modal-overlay sim-view-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal drawer sim-view-drawer">
        <div className="sv-head">
          <div className="sv-head-main">
            <span className="sv-avatar"><Icon name="simcard" size={20} /></span>
            <div className="sv-head-txt">
              <h3>SIM Card Details</h3>
              <div className="sv-head-sub">
                <span className="sv-head-id">{txt(card.mobile_id)}</span>
                {raw(card.device_model) ? <><i className="sv-dot" />{card.device_model}</> : null}
                {raw(card.team) ? <><i className="sv-dot" />{card.team}</> : null}
              </div>
            </div>
          </div>
          <div className="sv-head-right">
            <span className={`pill ${pillForStatus(status)}`}>{status}</span>
            <button className="sv-x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
        </div>

        <div className="modal-body sv-body">
          <div className="sv-hero">
            <div className="sv-hero-top">
              <div className="sv-hero-cell">
                <span className="sv-hero-k">Issued</span>
                <span className="sv-hero-v">{formatDate(card.issue_date)}</span>
              </div>
              <div className="sv-hero-sep" />
              <div className="sv-hero-cell">
                <span className="sv-hero-k">Expires</span>
                <span className="sv-hero-v">{formatDate(card.expiry_date)}</span>
              </div>
              <div className="sv-hero-sep" />
              <div className="sv-hero-cell">
                <span className="sv-hero-k">Days Left</span>
                <span className={`sv-hero-v ${dl !== null ? dayClass(dl) : ''}`}>{dayLabel(dl)}</span>
              </div>
            </div>
            {pct !== null && (
              <div className="sv-meter">
                <div className="sv-meter-track">
                  <span className={`sv-meter-fill ${dayClass(dl)}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="sv-meter-txt">{pct}% of validity remaining</span>
              </div>
            )}
          </div>

          <div className="sv-sections">
            <Section title="SIM Information" icon={<Icon name="sim" size={14} />} count={raw(card.sim_type)}>
              <Item k="Mobile ID" v={txt(card.mobile_id)} mono wide />
              <Item k="SIM Type" v={txt(card.sim_type)} />
              <Item k="Data Pack" v={txt(card.gb)} />
              <Item k="Replacement Count" v={txt(card.replacement_count)} />
            </Section>

            <Section title="Device Information" icon={<Icon name="mobile" size={14} />}>
              <Item k="Device & Model" v={txt(card.device_model)} wide />
              <Item k="IMEI No." v={txt(card.imei)} mono />
              <Item k="Status" v={<span className={`pill ${pillForStatus(status)}`}>{status}</span>} />
            </Section>

            <Section title="Ownership" icon={<Icon name="report" size={14} />}>
              <Item k="Team" v={txt(card.team)} />
              <Item k="Owner" v={txt(card.owner)} />
              <Item k="NGO" v={txt(card.ngo)} />
              <Item k="Remark" v={txt(card.signature)} wide />
            </Section>

            <Section title="SIM Numbers" icon={<Icon name="simcard" size={14} />} count={`${filledSlots.length}/${MAX_SIM_SLOTS}`}>
              {filledSlots.length === 0 ? (
                <div className="sv-empty">No SIM numbers linked to this card yet.</div>
              ) : (
                filledSlots.map(({ n, v }) => (
                  <Item key={n} k={`SIM ${n}`} v={txt(v)} mono />
                ))
              )}
            </Section>
          </div>
        </div>

        <div className="modal-foot sv-foot">
          <span className="sv-foot-note">Record ID {txt(card.id)}</span>
          <div className="sv-foot-btns">
            <button className="sim-btn" onClick={() => { onClose(); onReplace(); }}>
              <Icon name="replace" size={15} /> Replace
            </button>
            <button className="sim-btn" onClick={() => { onClose(); onEdit(); }}>
              <Icon name="settings" size={15} /> Edit
            </button>
            <button className="sim-btn primary" onClick={onClose}>Close</button>
          </div>
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
  owner: 'Owner',
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
    <div className="modal-overlay sim-edit-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sim-hist-modal">
        <div className="se-head">
          <div className="se-head-main">
            <span className="se-avatar"><Icon name="history" size={18} /></span>
            <div className="se-head-txt">
              <h3>SIM Card Change History</h3>
              <div className="se-head-sub">
                <span className="se-head-id">{txt(card.mobile_id)}</span>
                {raw(card.device_model) ? <><i className="se-dot" />{card.device_model}</> : null}
              </div>
            </div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Icon name="close" size={17} /></button>
        </div>

        <div className="modal-body se-body">
          <section className="se-sec">
            <div className="se-sec-head">
              <span className="se-sec-ic"><Icon name="mobile" size={14} /></span>
              <div className="se-sec-txt">
                <h4>Card Summary</h4>
                <p>The record this history belongs to</p>
              </div>
            </div>
            <div className="se-sum">
              {[
                ['Mobile ID', card.mobile_id],
                ['Device & Model', card.device_model],
                ['Team', card.team],
                ['NGO', card.ngo],
                ['Owner', card.owner],
                ['Remark', card.signature],
              ].map(([k, v]) => (
                <div className="se-sum-cell" key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{txt(v)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="se-sec">
            <div className="se-sec-head">
              <span className="se-sec-ic"><Icon name="history" size={14} /></span>
              <div className="se-sec-txt">
                <h4>Change Log</h4>
                <p>Old value crossed out, new value shown in green</p>
              </div>
              {!loading && rows.length > 0 && <span className="se-sec-count">{rows.length} changes</span>}
            </div>
            <div className="se-sec-body">
              {loading ? (
                <div className="se-empty"><span className="se-spin" /> Loading history...</div>
              ) : rows.length === 0 ? (
                <div className="se-empty">
                  <Icon name="history" size={18} />
                  <span>No previous changes saved for this card.</span>
                </div>
              ) : (
                <div className="se-log-wrap">
                  <table className="se-log">
                    <thead>
                      <tr>
                        <th className="c-when">Date &amp; Time</th>
                        <th className="c-field">Field Changed</th>
                        <th className="c-old">Old Value</th>
                        <th className="c-new">New Value</th>
                        <th className="c-act">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => (
                        <tr key={`${r.id}-${idx}`}>
                          <td className="c-when">{formatDateTime(r.changed_at)}</td>
                          <td className="c-field">{r.field}</td>
                          <td className="c-old"><s>{r.old}</s></td>
                          <td className="c-new">{r.new}</td>
                          <td className="c-act">
                            <span className={`se-act ${r.action.toLowerCase()}`}>{r.action}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="modal-foot se-foot">
          <span className="se-foot-hint">{loading ? 'Fetching change log...' : `${rows.length} recorded change${rows.length === 1 ? '' : 's'}`}</span>
          <div className="se-foot-btns">
            <button className="sim-btn primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

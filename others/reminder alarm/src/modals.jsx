import { useState, useEffect, useRef, useCallback } from 'react';
import { addReminder, updateReminder, fetchReminderHistory, importReminders } from './api';
import { toast } from './Toast';
import {
  CATEGORIES,
  FREQUENCY_OPTIONS,
  PRIORITIES,
  REMIND_BEFORE_OPTIONS,
  formatDateTime,
} from './helpers';
import * as XLSX from 'xlsx';

/* ------------------------------------------------------------------ */
/*  FIELD LABEL MAP (shared by HistoryModal)                          */
/* ------------------------------------------------------------------ */
const FIELD_LABELS = {
  title: 'Reminder Name',
  category: 'Category',
  owner: 'Owner',
  description: 'Description',
  due_date: 'Due Date',
  renewal_date: 'Renewal Date',
  frequency_type: 'Frequency Type',
  frequency_interval: 'Frequency Interval',
  day_of_month: 'Day of Month',
  month_of_year: 'Month of Year',
  priority: 'Priority',
  alarm_enabled: 'Alarm Enabled',
  reminder_enabled: 'Reminder Enabled',
  reminder_time: 'Reminder Time',
  reminder_minutes_before: 'Reminder Minutes Before',
  notification_enabled: 'Notification Enabled',
  notes: 'Notes',
};

const fieldLabel = (key) => FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const STATUS_OPTIONS = ['Upcoming', 'Completed', 'Overdue', 'Due Today', 'Due Tomorrow', 'Due Soon', 'Snoozed'];

/* ================================================================== */
/*  1. ReminderFormModal                                               */
/* ================================================================== */
export function ReminderFormModal({ open, reminder, onClose, onSaved }) {
  const isEdit = reminder != null;
  const originalRef = useRef(null);

  const emptyForm = {
    title: '',
    category: '',
    owner: '',
    description: '',
    due_date: '',
    renewal_date: '',
    frequency_type: '',
    frequency_interval: '',
    day_of_month: '',
    month_of_year: '',
    priority: 'Medium',
    status: 'Upcoming',
    alarm_enabled: false,
    reminder_enabled: false,
    reminder_time: '',
    reminder_minutes_before: '',
    notification_enabled: false,
    notes: '',
  };

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (isEdit) {
        const mapped = {};
        Object.keys(emptyForm).forEach((k) => {
          mapped[k] = reminder[k] != null ? reminder[k] : emptyForm[k];
        });
        setForm(mapped);
        originalRef.current = { ...mapped };
      } else {
        setForm({ ...emptyForm });
        originalRef.current = null;
      }
    }
  }, [open, isEdit, reminder?.id]);

  const set = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  if (!open) return null;

  const handleChange = (key) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    set(key, val);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast('Title is required', 'error');
      return;
    }

    const payload = {};
    Object.keys(form).forEach((k) => {
      if (k === 'title') {
        payload[k] = form[k];
        return;
      }
      if (isEdit && originalRef.current) {
        const orig = originalRef.current[k];
        const curr = form[k];
        if (curr !== orig && curr !== '' && curr !== false) {
          payload[k] = curr;
        } else if (curr === false && orig === true) {
          payload[k] = false;
        } else if (curr === '' && orig) {
          payload[k] = curr;
        }
      } else {
        if (form[k] !== '' && form[k] !== false) {
          payload[k] = form[k];
        }
      }
    });

    // Map friendly frequency options to structured backend values.
    const freqMap = {
      MONTH_2: ['MONTH', 2],
      MONTH_3: ['MONTH', 3],
      MONTH_6: ['MONTH', 6],
    };
    const rawFreq = payload.frequency_type || form.frequency_type || '';
    if (rawFreq === 'CUSTOM') {
      payload.frequency_type = payload.frequency_type || 'MONTH';
      payload.frequency_type = 'MONTH';
    } else if (freqMap[rawFreq]) {
      payload.frequency_type = freqMap[rawFreq][0];
      payload.frequency_interval = freqMap[rawFreq][1];
    } else if (rawFreq && !['ONE_TIME', 'DAY', 'WEEK', 'MONTH', 'YEAR'].includes(rawFreq)) {
      payload.frequency_type = 'ONE_TIME';
    }
    if ((payload.frequency_type === 'MONTH' || payload.frequency_type === 'YEAR') && payload.frequency_interval === undefined) {
      payload.frequency_interval = Number(form.frequency_interval) || 1;
    }

    if (isEdit && Object.keys(payload).length <= 1 && payload.title) {
      toast('No changes to save', 'info');
      onClose();
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateReminder(reminder.id, payload);
      } else {
        await addReminder(payload);
      }
      toast('Reminder saved successfully', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message || 'Failed to save reminder', 'error');
    } finally {
      setSaving(false);
    }
  };

  const showCustomFreq = form.frequency_type === 'CUSTOM';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{isEdit ? 'Edit Reminder' : 'Add Reminder'}</h3>
          <button className="rem-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            {/* Title */}
            <div className="form-row">
              <label>
                Title <span style={{ color: 'var(--danger, #e74c3c)' }}>*</span>
              </label>
              <input
                className="rem-input"
                value={form.title}
                onChange={handleChange('title')}
                placeholder="Reminder title"
              />
            </div>

            {/* Category */}
            <div className="form-row">
              <label>Category</label>
              <select
                className="rem-select"
                value={form.category}
                onChange={handleChange('category')}
              >
                <option value="">-- Select --</option>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Owner */}
            <div className="form-row">
              <label>Owner</label>
              <input
                className="rem-input"
                value={form.owner}
                onChange={handleChange('owner')}
                placeholder="Owner name"
              />
            </div>

            {/* Description */}
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Description</label>
              <textarea
                className="rem-textarea"
                rows={3}
                value={form.description}
                onChange={handleChange('description')}
                placeholder="Description"
              />
            </div>

            {/* Due Date */}
            <div className="form-row">
              <label>Due Date</label>
              <input
                className="rem-input"
                type="date"
                value={form.due_date}
                onChange={handleChange('due_date')}
              />
            </div>

            {/* Renewal Date */}
            <div className="form-row">
              <label>Renewal Date</label>
              <input
                className="rem-input"
                type="date"
                value={form.renewal_date}
                onChange={handleChange('renewal_date')}
              />
            </div>

            {/* Frequency */}
            <div className="form-row">
              <label>Frequency Type</label>
              <select
                className="rem-select"
                value={form.frequency_type}
                onChange={handleChange('frequency_type')}
              >
                <option value="">-- Select --</option>
                {FREQUENCY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {showCustomFreq && (
              <>
                <div className="form-row">
                  <label>Frequency Interval</label>
                  <input
                    className="rem-input"
                    type="number"
                    min={1}
                    value={form.frequency_interval}
                    onChange={handleChange('frequency_interval')}
                    placeholder="e.g. 3"
                  />
                </div>
                <div className="form-row">
                  <label>Day of Month</label>
                  <input
                    className="rem-input"
                    type="number"
                    min={1}
                    max={31}
                    value={form.day_of_month}
                    onChange={handleChange('day_of_month')}
                    placeholder="1-31"
                  />
                </div>
                <div className="form-row">
                  <label>Month of Year</label>
                  <input
                    className="rem-input"
                    type="number"
                    min={1}
                    max={12}
                    value={form.month_of_year}
                    onChange={handleChange('month_of_year')}
                    placeholder="1-12"
                  />
                </div>
              </>
            )}

            {/* Priority */}
            <div className="form-row">
              <label>Priority</label>
              <select
                className="rem-select"
                value={form.priority}
                onChange={handleChange('priority')}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div className="form-row">
              <label>Status</label>
              <select
                className="rem-select"
                value={form.status}
                onChange={handleChange('status')}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Toggles */}
            <div className="form-row">
              <label>Alarm Enabled</label>
              <div className="row-toggle">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.alarm_enabled}
                    onChange={handleChange('alarm_enabled')}
                  />
                  <span className="switch" />
                  <span>Alarm</span>
                </label>
              </div>
            </div>

            <div className="form-row">
              <label>Reminder Enabled</label>
              <div className="row-toggle">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.reminder_enabled}
                    onChange={handleChange('reminder_enabled')}
                  />
                  <span className="switch" />
                  <span>Reminder</span>
                </label>
              </div>
            </div>

            {/* Reminder Time */}
            <div className="form-row">
              <label>Reminder Time</label>
              <input
                className="rem-input"
                type="time"
                value={form.reminder_time}
                onChange={handleChange('reminder_time')}
              />
            </div>

            {/* Reminder Minutes Before */}
            <div className="form-row">
              <label>Remind Before</label>
              <select
                className="rem-select"
                value={form.reminder_minutes_before}
                onChange={handleChange('reminder_minutes_before')}
              >
                <option value="">-- Select --</option>
                {REMIND_BEFORE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Notification Enabled */}
            <div className="form-row">
              <label>Notification Enabled</label>
              <div className="row-toggle">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.notification_enabled}
                    onChange={handleChange('notification_enabled')}
                  />
                  <span className="switch" />
                  <span>Notification</span>
                </label>
              </div>
            </div>

            {/* Notes */}
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Notes</label>
              <textarea
                className="rem-textarea"
                rows={3}
                value={form.notes}
                onChange={handleChange('notes')}
                placeholder="Additional notes"
              />
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="rem-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="rem-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  2. HistoryModal                                                    */
/* ================================================================== */
export function HistoryModal({ reminderId, open, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && reminderId) {
      setLoading(true);
      fetchReminderHistory(reminderId)
        .then((data) => setHistory(Array.isArray(data) ? data : data.results || []))
        .catch(() => setHistory([]))
        .finally(() => setLoading(false));
    }
    if (!open) {
      setHistory([]);
    }
  }, [open, reminderId]);

  if (!open) return null;

  const formatVal = (v) => {
    if (v === null || v === undefined || v === '') return '(empty)';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Change History</h3>
          <button className="rem-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body" style={{ maxHeight: 480, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#888' }}>Loading...</div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#888' }}>No history yet</div>
          ) : (
            history.map((entry, idx) => (
              <div
                key={entry.id || idx}
                style={{
                  padding: '12px 0',
                  borderBottom: idx < history.length - 1 ? '1px solid #eee' : 'none',
                }}
              >
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                  {formatDateTime(entry.changed_at || entry.timestamp)} · by{' '}
                  {entry.changed_by || 'System'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  {entry.action === 'updated' && 'Updated'}
                  {entry.action === 'completed' && 'Completed'}
                  {entry.action === 'snoozed' && 'Snoozed'}
                  {entry.action === 'completed_and_advanced' && 'Completed & Advanced'}
                  {!['updated', 'completed', 'snoozed', 'completed_and_advanced'].includes(
                    entry.action,
                  ) && entry.action}
                </div>
                {entry.changed_cols &&
                  Object.entries(entry.changed_cols).map(([key, val]) => (
                    <div key={key} style={{ fontSize: 12, color: '#444', marginLeft: 8 }}>
                      {fieldLabel(key)}:{' '}
                      {Array.isArray(val)
                        ? `${formatVal(val[0])} → ${formatVal(val[1])}`
                        : formatVal(val)}
                    </div>
                  ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  3. DeleteConfirmModal                                              */
/* ================================================================== */
export function DeleteConfirmModal({ reminder, deleting, onClose, onConfirm }) {
  if (!reminder) return null;

  return (
    <div className="dc-overlay" onClick={onClose}>
      <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dc-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </div>
        <div className="dc-title">Delete Reminder</div>
        <div className="dc-desc">
          Are you sure you want to delete{' '}
          <strong>{reminder.title}</strong>? This action cannot be undone.
        </div>
        <div className="dc-foot">
          <button className="dc-btn cancel" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button className="dc-btn delete" onClick={() => onConfirm(reminder)} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  4. ImportModal                                                     */
/* ================================================================== */
const HEADER_MAP = {
  'reminder name': 'title',
  'title': 'title',
  'name': 'title',
  'category': 'category',
  'owner': 'owner',
  'description': 'description',
  'desc': 'description',
  'due date': 'due_date',
  'duedate': 'due_date',
  'due_date': 'due_date',
  'renewal date': 'renewal_date',
  'renewaldate': 'renewal_date',
  'renewal_date': 'renewal_date',
  'frequency type': 'frequency_type',
  'frequencytype': 'frequency_type',
  'frequency_type': 'frequency_type',
  'frequency interval': 'frequency_interval',
  'frequencyinterval': 'frequency_interval',
  'frequency_interval': 'frequency_interval',
  'priority': 'priority',
  'alarm enabled': 'alarm_enabled',
  'alarmenabled': 'alarm_enabled',
  'alarm_enabled': 'alarm_enabled',
  'reminder enabled': 'reminder_enabled',
  'reminderenabled': 'reminder_enabled',
  'reminder_enabled': 'reminder_enabled',
  'reminder time': 'reminder_time',
  'remindertime': 'reminder_time',
  'reminder_time': 'reminder_time',
  'reminder minutes before': 'reminder_minutes_before',
  'reminderminutesbefore': 'reminder_minutes_before',
  'reminder_minutes_before': 'reminder_minutes_before',
  'notification enabled': 'notification_enabled',
  'notificationenabled': 'notification_enabled',
  'notification_enabled': 'notification_enabled',
  'notes': 'notes',
};

function mapHeaders(rawHeaders) {
  return rawHeaders.map((h) => {
    const key = String(h).trim().toLowerCase().replace(/\s+/g, ' ');
    return HEADER_MAP[key] || key;
  });
}

function parseBool(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  const s = String(val).trim().toLowerCase();
  return ['true', '1', 'yes', 'y'].includes(s);
}

export function ImportModal({ open, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [validCount, setValidCount] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreview([]);
      setHeaders([]);
      setValidCount(0);
      setInvalidCount(0);
      setImporting(false);
      setDone(false);
    }
  }, [open]);

  if (!open) return null;

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (raw.length < 2) {
          toast('File is empty or has no data rows', 'error');
          return;
        }
        const mappedHeaders = mapHeaders(raw[0]);
        const rows = raw.slice(1).map((row) => {
          const obj = {};
          mappedHeaders.forEach((h, i) => {
            obj[h] = row[i] ?? '';
          });
          return obj;
        });

        let valid = 0;
        let invalid = 0;
        rows.forEach((r) => {
          if (r.title && String(r.title).trim()) valid++;
          else invalid++;
        });

        setHeaders(mappedHeaders);
        setPreview(rows);
        setValidCount(valid);
        setInvalidCount(invalid);
      } catch {
        toast('Failed to parse file', 'error');
      }
    };
    reader.readAsArrayBuffer(f);
  };

  const handleImport = async () => {
    const rowsToImport = preview.filter((r) => r.title && String(r.title).trim());
    if (!rowsToImport.length) {
      toast('No valid rows to import', 'error');
      return;
    }

    setImporting(true);
    try {
      const cleaned = rowsToImport.map((r) => {
        const obj = {};
        Object.entries(r).forEach(([k, v]) => {
          if (k === 'alarm_enabled' || k === 'reminder_enabled' || k === 'notification_enabled') {
            obj[k] = parseBool(v);
          } else if (v !== '' && v !== null && v !== undefined) {
            obj[k] = v;
          }
        });
        return obj;
      });
      await importReminders(cleaned);
      toast(`Imported ${cleaned.length} reminders successfully`, 'success');
      setDone(true);
      onDone?.();
    } catch (err) {
      toast(err.message || 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Import Reminders</h3>
          <button className="rem-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          {!file ? (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={handleFile}
              />
              <button className="rem-btn primary" onClick={() => fileRef.current?.click()}>
                Choose File (Excel / CSV)
              </button>
              <p style={{ marginTop: 12, fontSize: 13, color: '#888' }}>
                Supported formats: .xlsx, .xls, .csv
              </p>
            </div>
          ) : done ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--success, #27ae60)' }}>
              Import completed successfully!
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13, marginBottom: 8 }}>
                <strong>{file.name}</strong> — {preview.length} rows found
              </p>
              <p style={{ fontSize: 13, marginBottom: 16 }}>
                <span style={{ color: 'var(--success, #27ae60)' }}>{validCount} valid</span>
                {invalidCount > 0 && (
                  <span style={{ color: 'var(--danger, #e74c3c)', marginLeft: 12 }}>
                    {invalidCount} invalid (missing title)
                  </span>
                )}
              </p>
              <div style={{ maxHeight: 240, overflowY: 'auto', fontSize: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            padding: '6px 8px',
                            borderBottom: '2px solid #ddd',
                            fontWeight: 600,
                          }}
                        >
                          {fieldLabel(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 50).map((row, idx) => {
                      const isValid = row.title && String(row.title).trim();
                      return (
                        <tr
                          key={idx}
                          style={{
                            background: isValid ? 'transparent' : 'rgba(231,76,60,0.06)',
                          }}
                        >
                          {headers.map((h) => (
                            <td
                              key={h}
                              style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}
                            >
                              {String(row[h] ?? '')}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="rem-btn" onClick={onClose} disabled={importing}>
            {done ? 'Close' : 'Cancel'}
          </button>
          {file && !done && (
            <button
              className="rem-btn primary"
              onClick={handleImport}
              disabled={importing || validCount === 0}
            >
              {importing ? 'Importing...' : `Import ${validCount} Reminders`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  5. NotificationPanel                                               */
/* ================================================================== */
const LEVEL_STYLES = {
  overdue: { color: '#e74c3c', bg: 'rgba(231,76,60,0.08)' },
  due_today: { color: '#f39c12', bg: 'rgba(243,156,18,0.08)' },
  due_soon: { color: '#f1c40f', bg: 'rgba(241,196,15,0.08)' },
  upcoming: { color: '#3498db', bg: 'rgba(52,152,219,0.08)' },
};

const LEVEL_LABELS = {
  overdue: 'Overdue',
  due_today: 'Due Today',
  due_soon: 'Due Soon',
  upcoming: 'Upcoming',
};

export function NotificationPanel({ notifications = [], onClose, onMarkRead, onMarkAllRead, onClickReminder }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const grouped = {};
  notifications.forEach((n) => {
    const level = n.level || 'upcoming';
    if (!grouped[level]) grouped[level] = [];
    grouped[level].push(n);
  });

  const levelOrder = ['overdue', 'due_today', 'due_soon', 'upcoming'];

  return (
    <div className="notif-panel" ref={panelRef}>
      <div className="notif-header">
        <h4>Notifications</h4>
        {notifications.some((n) => !n.read) && (
          <button className="rem-btn" onClick={onMarkAllRead} style={{ fontSize: 12 }}>
            Mark All as Read
          </button>
        )}
      </div>
      <div className="notif-body" style={{ maxHeight: 400, overflowY: 'auto' }}>
        {notifications.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>
            No notifications
          </div>
        ) : (
          levelOrder.map((level) => {
            const items = grouped[level];
            if (!items || items.length === 0) return null;
            const style = LEVEL_STYLES[level] || LEVEL_STYLES.upcoming;
            return (
              <div key={level}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: style.color,
                    padding: '8px 14px 4px',
                    letterSpacing: 0.5,
                  }}
                >
                  {LEVEL_LABELS[level] || level} ({items.length})
                </div>
                {items.map((n) => (
                  <div
                    key={n.id}
                    className="notif-item"
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid #f0f0f0',
                      cursor: 'pointer',
                      background: n.read ? 'transparent' : style.bg,
                      opacity: n.read ? 0.65 : 1,
                    }}
                    onClick={() => onClickReminder?.(n)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                          {n.title || n.message}
                        </div>
                        {n.due_date && (
                          <div style={{ fontSize: 11, color: '#888' }}>
                            Due: {formatDateTime(n.due_date)}
                          </div>
                        )}
                      </div>
                      {!n.read && (
                        <button
                          className="rem-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkRead?.(n.id);
                          }}
                          style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0, marginLeft: 8 }}
                        >
                          Mark Read
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  6. AlarmToast                                                      */
/* ================================================================== */
export function AlarmToast({ reminder, alarmType, onDismiss, onComplete, onSnooze, onView }) {
  const [showSnooze, setShowSnooze] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!reminder) return;
    setShowSnooze(false);
    timerRef.current = setTimeout(() => {
      onDismiss?.();
    }, 60000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reminder?.id, onDismiss]);

  if (!reminder) return null;

  const alarmMsg =
    alarmType === 'overdue'
      ? 'This reminder is overdue!'
      : alarmType === 'due_soon'
      ? 'This reminder is due soon'
      : alarmType === 'due_today'
      ? 'This reminder is due today'
      : 'Reminder alert';

  const snoozeOptions = [
    { label: '5 min', minutes: 5 },
    { label: '15 min', minutes: 15 },
    { label: '30 min', minutes: 30 },
    { label: '60 min', minutes: 60 },
  ];

  return (
    <div className="alarm-toast">
      <div className="alarm-toast-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f39c12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <strong style={{ fontSize: 14 }}>{reminder.title}</strong>
        </div>
      </div>
      <div className="alarm-toast-body">
        <div style={{ fontSize: 13, marginBottom: 4 }}>{alarmMsg}</div>
        {reminder.due_date && (
          <div style={{ fontSize: 12, color: '#888' }}>Due: {formatDateTime(reminder.due_date)}</div>
        )}
      </div>
      <div className="alarm-toast-actions">
        <button className="rem-btn" onClick={() => onView?.(reminder)}>
          View
        </button>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <button
            className="rem-btn"
            onClick={() => setShowSnooze((v) => !v)}
          >
            Snooze
          </button>
          {showSnooze && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                zIndex: 10,
                minWidth: 100,
              }}
            >
              {snoozeOptions.map((opt) => (
                <div
                  key={opt.minutes}
                  style={{
                    padding: '8px 14px',
                    cursor: 'pointer',
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => {
                    setShowSnooze(false);
                    onSnooze?.(reminder, opt.minutes);
                  }}
                >
                  {opt.label}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="rem-btn primary" onClick={() => onComplete?.(reminder)}>
          Mark Complete
        </button>
        <button className="rem-btn" onClick={() => onDismiss?.()}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

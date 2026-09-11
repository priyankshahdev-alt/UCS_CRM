import { useState, useEffect, useRef } from 'react';
import { getDonorDetail, getDonorHistory, addDonorLog, uploadPaymentScreenshot } from '../api/donors';
import { DatePicker } from './ui';
import { TimePicker } from './TimePicker';
import { useCall } from '../CallContext';
import { toast } from '../../../components/Toast';
import { extractTransactionData } from '../utils/ocr';
import usePasteImage from '../../../utils/usePasteImage';
import { NOT_CONNECTED_GROUPS, CONNECTED_GROUPS, CONNECTED_IDS, findDisp, SCHEDULE_DATE_TYPES, SCHEDULE_TIME_TYPES } from '../dispositions';
import { GroupedDispositionOptions } from './GroupedDispositionOptions';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { istDateString, istDateTimeToIso } from '../utils/time';

const PROJECTS = [
  'Mission Annapurna', 'Mission Vidhya', 'Mission Aurat', 'Mission Bezubaan',
  'Mission Atmanirbhar', 'Mission Arogya', 'Sevak Seva Kendra', 'Mission Eco-Warriors',
];
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const initials = (name) => (name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

const timelineIcon = (log) => {
  if (log.action === 'disposition') return log.disposition_category === 'connected' ? 'check_circle' : 'cancel';
  const map = { call: 'call', visit: 'home', message: 'mail', follow_up: 'history', donation: 'payments', note: 'note' };
  return map[log.action] || 'circle';
};

const formatTime = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).toUpperCase();

const logDate = (log) => (log.action === 'donation' || (log.disposition_detail === 'lead_done' && log.accounts_status === 'verified'))
  ? (log.transaction_datetime || log.verified_at || log.created_at)
  : log.created_at;

const isThisMonth = (dateStr) => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

export default function DispositionModal({ donorId, ngoId, donorName, donorMobile, scheduledAt: origScheduledAt, onClose, onDone, onSnooze }) {
  const isMobile = useIsMobile();
  const [profile, setProfile] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leadAmount, setLeadAmount] = useState('');
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [callbackTime, setCallbackTime] = useState('');
  const [leadScreenshot, setLeadScreenshot] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [leadAddress, setLeadAddress] = useState('');
  const [leadPan, setLeadPan] = useState('');
  const [panError, setPanError] = useState('');
  const [leadDob, setLeadDob] = useState('');
  const [projectName, setProjectName] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [message, setMessage] = useState(null);
  const [upiTransactionId, setUpiTransactionId] = useState('');
  const [transactionDatetime, setTransactionDatetime] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrFromName, setOcrFromName] = useState('');
  const isOverdue = origScheduledAt && new Date(origScheduledAt) < new Date();
  const { startCall, endCall, resetCallActivity } = useCall();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getDonorHistory(donorId, 'financial_year').catch(() => ({ donor: null, logs: [] })),
      getDonorDetail(donorId, ngoId).catch(() => ({ logs: [], total_collected: 0, next_schedule: null })),
    ]).then(([hist, det]) => {
      setProfile(hist.donor);
      setDetail(det);
    }).finally(() => setLoading(false));
  }, [donorId, ngoId]);

  useEffect(() => {
    startCall({ id: donorId, donorName, donorMobile })
    return () => endCall()
  }, []);

  const logs = detail?.logs || [];
  const totalCollected = detail?.total_collected || 0;

  const processScreenshotFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      setLeadScreenshot({ base64, mime: file.type });
      setScreenshotPreview(result);
      setOcrLoading(true);
      try {
        const { upiTransactionId, transactionDatetime, amount, fromName } = await extractTransactionData(result);
        if (upiTransactionId) setUpiTransactionId(upiTransactionId);
        if (transactionDatetime) {
          const dt = new Date(transactionDatetime);
          if (!isNaN(dt.getTime())) {
            setTransactionDatetime(dt.toISOString().slice(0, 16));
          }
        }
        if (amount && !leadAmount) setLeadAmount(amount);
        if (fromName) setOcrFromName(fromName);
      } catch (e) { console.error('Error:', e.message); }
      setOcrLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleScreenshotChange = (e) => {
    processScreenshotFile(e.target.files[0]);
  };

  const handlePasteScreenshot = usePasteImage(({ base64, mime, file }) => {
    setLeadScreenshot({ base64, mime });
    const reader = new FileReader();
    reader.onload = async () => {
      setScreenshotPreview(reader.result);
      setOcrLoading(true);
      try {
        const { upiTransactionId, transactionDatetime, amount, fromName } = await extractTransactionData(reader.result);
        if (upiTransactionId) setUpiTransactionId(upiTransactionId);
        if (transactionDatetime) {
          const dt = new Date(transactionDatetime);
          if (!isNaN(dt.getTime())) setTransactionDatetime(dt.toISOString().slice(0, 16));
        }
        if (amount && !leadAmount) setLeadAmount(amount);
        if (fromName) setOcrFromName(fromName);
      } catch (e) { console.error('Error:', e.message); }
      setOcrLoading(false);
    };
    reader.readAsDataURL(file);
  });

  const handleSave = async () => {
    if (!selected) { setMessage({ type: 'error', text: 'Select a disposition' }); return; }
    if (SCHEDULE_DATE_TYPES.has(selected) && (!scheduledDate || !scheduledTime)) { setMessage({ type: 'error', text: 'Select date & time' }); return; }
    if (SCHEDULE_TIME_TYPES.has(selected) && !callbackTime) { setMessage({ type: 'error', text: 'Select time for callback' }); return; }
    if ((selected === 'lead_done' || selected === 'done') && (!leadAmount || isNaN(leadAmount) || Number(leadAmount) <= 0)) { setMessage({ type: 'error', text: 'Enter a valid payment amount' }); return; }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const logPayload = {
        action: 'disposition',
        disposition_category: CONNECTED_IDS.has(selected) ? 'connected' : 'not_connected',
        disposition_detail: selected,
        notes: notes || null,
        ngo_id: ngoId,
      };
      if (SCHEDULE_DATE_TYPES.has(selected)) logPayload.scheduled_at = istDateTimeToIso(scheduledDate, scheduledTime);
      if (SCHEDULE_TIME_TYPES.has(selected)) {
        const todayIst = istDateString();
        logPayload.scheduled_at = istDateTimeToIso(todayIst, callbackTime);
      }
      if (selected === 'lead_done') {
        if (leadScreenshot) {
          const uploadResult = await uploadPaymentScreenshot(leadScreenshot.base64, leadScreenshot.mime);
          logPayload.payment_screenshot_url = uploadResult.file_url;
        }
        logPayload.donor_address = leadAddress || null;
        logPayload.pan_number = leadPan || null;
        logPayload.donor_dob = leadDob || null;
        logPayload.project_name = projectName || null;
        logPayload.amount_collected = leadAmount !== '' ? Number(leadAmount) : null;
        logPayload.upi_transaction_id = upiTransactionId || null;
        logPayload.transaction_datetime = transactionDatetime ? new Date(transactionDatetime).toISOString() : null;
      }
      if (selected === 'done') {
        logPayload.amount_collected = leadAmount !== '' ? Number(leadAmount) : null;
      }
      await addDonorLog(donorId, logPayload);
      // Saving a disposition counts as call activity (resets the 2-min idle timer)
      resetCallActivity();
      endCall();
      const disp = findDisp(selected);
      if (selected === 'lead_done') toast('Lead sent to Accounts for verification', 'success');
      else if (selected === 'done') toast('Collection recorded', 'success');
      else if (SCHEDULE_DATE_TYPES.has(selected) || SCHEDULE_TIME_TYPES.has(selected)) toast(`Follow-up scheduled`, 'info');
      else toast(`Disposition: ${disp?.label || selected}`, 'info');
      onDone();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally { setSaving(false); savingRef.current = false; }
  };

  const handleDropdownChange = (detailId) => {
    setSelected(detailId);
    setMessage(null);
    if (SCHEDULE_DATE_TYPES.has(detailId)) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      setScheduledDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      setScheduledTime('');
      setDateConfirmed(false);
    }
    if (SCHEDULE_TIME_TYPES.has(detailId)) {
      const now = new Date();
      setCallbackTime(now.toTimeString().slice(0, 5));
    }
    if (detailId === 'lead_done') {
      setProjectName(profile?.donor_project || '');
      setPanError('');
    } else if (detailId === 'done') {
      setLeadAmount('');
    } else {
      setLeadScreenshot(null);
      setScreenshotPreview(null);
      setLeadAddress('');
      setLeadPan('');
      setPanError('');
      setLeadDob('');
      setProjectName('');
      setLeadAmount('');
      setUpiTransactionId('');
      setTransactionDatetime('');
      setOcrFromName('');
      setOcrLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.4)' }} onClick={() => { if (!selected || window.confirm('Discard unsaved disposition?')) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 12, width: isMobile ? 'calc(100vw - 24px)' : 1000, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,.15)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{donorName}</span>
          <span className="material-symbols-outlined" style={{ fontSize: 18, cursor: 'pointer', color: 'var(--ink-soft)' }} onClick={() => { if (!selected || window.confirm('Discard unsaved disposition?')) onClose(); }}>close</span>
        </div>

        {message && (
          <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600, background: message.type === 'error' ? '#fef2f2' : '#f0fdf4', color: message.type === 'error' ? '#dc2626' : '#16a34a', borderBottom: `1px solid ${message.type === 'error' ? '#fecaca' : '#bbf7d0'}` }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{message.type === 'error' ? 'error' : 'check_circle'}</span>
            {message.text}
          </div>
        )}
        {!isOverdue && origScheduledAt && (
          <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600, background: '#f0fdf4', color: '#166534', borderBottom: '1px solid #bbf7d0' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>schedule</span>
            Already scheduled at {new Date(origScheduledAt).toLocaleString('en-GB')}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Loading donor details...</div>
            </div>
          ) : (
            <>
              <div className="detail-left" style={{ width: isMobile ? '100%' : '30%', padding: 12, borderRight: isMobile ? 'none' : '1px solid var(--line)', overflowY: 'auto', borderBottom: isMobile ? '1px solid var(--line)' : 'none', maxHeight: isMobile ? '30vh' : undefined }}>
                <div style={{ textAlign: 'center', paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
                  <div className="detail-avatar">{initials(profile?.name || donorName)}</div>
                  <div className="detail-name">{profile?.name || donorName}</div>
                  <div className="detail-phone">{donorMobile || profile?.mobile_number || '—'}</div>
                </div>
                <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="detail-field-row">
                    <div className="fld">
                      <label>City</label>
                      <div>{profile?.city || 'NA'}</div>
                    </div>
                  </div>
                  <div className="detail-field-row">
                    <div className="fld">
                      <label>Email</label>
                      <div style={{ fontStyle: profile?.email ? 'normal' : 'italic', color: profile?.email ? 'inherit' : 'var(--ink-soft)' }}>{profile?.email || 'No email'}</div>
                    </div>
                  </div>
                  <div className="detail-field-row">
                    <div className="fld">
                      <label>Address</label>
                      <div style={{ fontStyle: profile?.address_1 ? 'normal' : 'italic', color: profile?.address_1 ? 'inherit' : 'var(--ink-soft)' }}>{profile?.address_1 || 'No address'}</div>
                    </div>
                  </div>
                  {profile?.pan_number && (
                    <div className="detail-field-row">
                      <div className="fld">
                        <label>PAN</label>
                        <div>{profile.pan_number}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ width: isMobile ? '100%' : '40%', padding: 12, borderRight: isMobile ? 'none' : '1px solid var(--line)', overflowY: 'auto', borderBottom: isMobile ? '1px solid var(--line)' : 'none', flex: isMobile ? 1 : undefined }}>
                <div className="detail-card" style={{ flex: 1, minHeight: 0 }}>
                  <div className="detail-card-head">Connection Status</div>
                  <div className="detail-card-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="detail-dropdown-row">
                      <div className="dd">
                        <label>Connected</label>
                        <select value={selected !== null && CONNECTED_IDS.has(selected) ? selected : ''} onChange={e => { if (e.target.value) handleDropdownChange(e.target.value); }}
                          style={{ borderColor: selected !== null && CONNECTED_IDS.has(selected) ? '#16a34a' : undefined }}>
                          <option value="">— Select —</option>
                          <GroupedDispositionOptions groups={CONNECTED_GROUPS} />
                        </select>
                      </div>
                      <div className="dd">
                        <label>Not Connected</label>
                        <select value={selected !== null && !CONNECTED_IDS.has(selected) ? selected : ''} onChange={e => { if (e.target.value) handleDropdownChange(e.target.value); }}
                          style={{ borderColor: selected !== null && !CONNECTED_IDS.has(selected) ? '#dc2626' : undefined }}>
                          <option value="">— Select —</option>
                          <GroupedDispositionOptions groups={NOT_CONNECTED_GROUPS} />
                        </select>
                      </div>
                    </div>

                    {SCHEDULE_DATE_TYPES.has(selected) && (
                      <>
                        <div className="detail-field-row">
                          <div className="fld">
                            <label>Follow Up Date</label>
                            <DatePicker value={scheduledDate} onChange={e => { setScheduledDate(e.target.value); setDateConfirmed(true); }} placeholder="Select date" />
                          </div>
                        </div>
                        {dateConfirmed && (
                          <div className="detail-field-row">
                            <div className="fld">
                              <label>Follow Up Time</label>
                              <TimePicker value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} placeholder="Select time" />
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {SCHEDULE_TIME_TYPES.has(selected) && (
                      <div className="detail-field-row">
                        <div className="fld">
                          <label>Callback Time (Today)</label>
                          <TimePicker value={callbackTime} onChange={e => setCallbackTime(e.target.value)} placeholder="Select time" />
                        </div>
                      </div>
                    )}

                    {selected === 'done' && (
                      <div className="detail-field-row">
                        <div className="fld">
                          <label>Amount Collected</label>
                          <input type="number" min="0" value={leadAmount}
                            onChange={e => setLeadAmount(e.target.value)} placeholder="e.g. 5000" />
                        </div>
                      </div>
                    )}

                    {selected === 'lead_done' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className="detail-field-row">
                          <div className="fld">
                            <label>Project</label>
                            <select value={projectName} onChange={e => setProjectName(e.target.value)}>
                              <option value="">— Select Project —</option>
                              {PROJECTS.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                        </div>
                          <div className="detail-field-row">
                    <div className="fld">
                      <label>Amount Collected</label>
                      <input type="number" min="0" value={leadAmount}
                        onChange={e => setLeadAmount(e.target.value)} placeholder="e.g. 5000" />
                    </div>
                  </div>
                        <div className="detail-field-row">
                          <div className="fld">
                            <label>Screenshot / Proof image</label>
                            <label htmlFor="dm-ss-input" className="ss-upload" onPaste={handlePasteScreenshot}
                              title="Upload a file or paste an image (Ctrl+V)">
                              {screenshotPreview ? (
                                <div style={{ position: 'relative' }}>
                                  <img src={screenshotPreview} alt="preview" className="ss-preview"
                                    onClick={e => { e.preventDefault(); window.open(screenshotPreview, '_blank'); }} />
                                  <span className="ss-remove"
                                    onClick={e => { e.preventDefault(); setLeadScreenshot(null); setScreenshotPreview(null); document.getElementById('dm-ss-input').value = ''; }}>close</span>
                                </div>
                              ) : (
                                <div className="ss-placeholder">
                                  <span className="material-symbols-outlined">upload</span>
                                  <span>Upload or paste (Ctrl+V)</span>
                                </div>
                              )}
                            </label>
                            <input id="dm-ss-input" type="file" accept="image/*" onChange={handleScreenshotChange} onPaste={handlePasteScreenshot} />
                          </div>
                        </div>
                        <div className="detail-field-row">
                          <div className="fld">
                            <label>UPI Transaction ID {ocrLoading && <span style={{fontSize:9,color:'var(--md-outline)',marginLeft:4}}>OCR…</span>}</label>
                            <input type="text" value={upiTransactionId} onChange={e => setUpiTransactionId(e.target.value)} placeholder="Auto-detected from screenshot" />
                          </div>
                          <div className="fld">
                            <label>Transaction Date/Time</label>
                            <input type="datetime-local" value={transactionDatetime} onChange={e => setTransactionDatetime(e.target.value)} />
                          </div>
                        </div>
                        {ocrFromName && (
                          <div className="detail-field-row">
                            <div className="fld">
                              <label>Detected From Name</label>
                              <input type="text" value={ocrFromName} readOnly style={{color:'var(--md-outline)',fontStyle:'italic'}} />
                            </div>
                          </div>
                        )}
                        <div className="detail-field-row">
                          <div className="fld">
                            <label>Address</label>
                            <input type="text" value={leadAddress} onChange={e => setLeadAddress(e.target.value)} placeholder="Donor address" />
                          </div>
                        </div>
                        <div className="detail-field-row">
                          <div className="fld">
                            <label>PAN</label>
                            <input type="text" value={leadPan} onChange={e => {
                              const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                              setLeadPan(v);
                              if (v.length === 0) setPanError('');
                              else if (!PAN_REGEX.test(v) && v.length === 10) setPanError('Invalid PAN — use format: ABCDE1234F');
                              else if (v.length > 0 && v.length < 10) setPanError('PAN must be 10 characters');
                              else setPanError('');
                            }} placeholder="e.g. ABCDE1234F" maxLength={10} style={{ borderColor: panError ? '#dc2626' : undefined }} />
                            {leadPan.length > 0 && panError && <span style={{ fontSize: 9, color: '#dc2626', marginTop: 1, display: 'block' }}>{panError}</span>}
                          </div>
                          <div className="fld">
                            <label>DOB</label>
                            <input type="date" value={leadDob} onChange={e => setLeadDob(e.target.value)} />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="detail-notes">
                      <label style={{ display: 'block', fontSize: 9, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 3 }}>Notes</label>
                      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Add notes here..." />
                    </div>
                  </div>
                </div>
              </div>

              <div className="detail-right" style={{ width: isMobile ? '100%' : '30%', padding: 12, overflowY: 'auto', maxHeight: isMobile ? '25vh' : undefined }}>
                <div className="detail-card" style={{ flex: 1, minHeight: 0 }}>
                  <div className="detail-card-head">
                    <span>CRM Timeline</span>
                    {totalCollected > 0 && <span style={{ color: 'var(--sage)', fontSize: 10 }}>₹{totalCollected.toLocaleString('en-IN')}</span>}
                  </div>
                  <div className="detail-card-scroll">
                    {logs.length === 0 ? (
                      <div className="empty-timeline">No activity yet.</div>
                    ) : (
                      <div className="detail-timeline-list">
                        {logs.slice(0, 15).map(log => {
                          const isDisp = log.action === 'disposition';
                          const cat = log.disposition_category;
                          const icon = timelineIcon(log);
                          const connected = isDisp && cat === 'connected';
                          const lbl = isDisp ? (log.disposition_detail?.replace(/_/g, ' ') || '') : log.action.replace(/_/g, ' ');
                          const bg = isDisp ? (connected ? '#f0fdf4' : '#fef2f2') : 'var(--bg)';
                          return (
                            <div key={log.id} className="detail-timeline-item" style={{ background: bg }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 12, color: connected ? 'var(--sage)' : 'var(--md-error, #dc2626)', flexShrink: 0, marginTop: 1 }}>{icon}</span>
                              <div className="tl-info">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <span className="tl-lbl">{lbl}</span>
                                  <span className="tl-time">{formatTime(logDate(log))}</span>
                                </div>
                                {isThisMonth(logDate(log)) && (log.remark || log.notes) && <div className="tl-note">{log.remark || log.notes}</div>}
                                {log.amount_collected != null && <div className="tl-note" style={{ color: 'var(--sage)', fontWeight: 600 }}>₹{Number(log.amount_collected).toLocaleString('en-IN')}</div>}
                                {log.disposition_detail === 'lead_done' && (
                                  <span style={{ fontSize: 8, fontWeight: 700, background: 'var(--md-tertiary-fixed, #e0e7ff)', padding: '1px 4px', borderRadius: 2, textTransform: 'uppercase', display: 'inline-block', marginTop: 1 }}>
                                    {log.accounts_status === 'verified' ? 'Verified' : log.accounts_status === 'rejected' ? 'Rejected' : 'Pending'}
                                  </span>
                                )}
                                {log.disposition_detail === 'done' && (
                                  <span style={{ fontSize: 8, fontWeight: 700, background: '#f0fdf4', color: 'var(--sage)', padding: '1px 4px', borderRadius: 2, textTransform: 'uppercase', display: 'inline-block', marginTop: 1 }}>Collected</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {logs.length > 15 && <div className="empty-timeline" style={{ padding: '8px 0' }}>+{logs.length - 15} more</div>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
          {onSnooze && (
            <button onClick={onSnooze} disabled={saving}
              style={{ padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 6, background: '#fff', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? .4 : 1, display: 'flex', alignItems: 'center', gap: 4, marginRight: 'auto' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>alarm</span>
              Snooze 2 min
            </button>
          )}
          <button onClick={onClose} disabled={saving || !selected}
            style={{ padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 6, background: '#fff', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: saving || !selected ? 'not-allowed' : 'pointer', opacity: saving ? .4 : selected ? 1 : 0.4 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !selected}
            style={{ padding: '7px 12px', border: 'none', borderRadius: 6, background: 'var(--sage)', color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? .5 : 1 }}>
            {saving ? 'Saving...' : selected ? `Log ${findDisp(selected)?.label || selected}` : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

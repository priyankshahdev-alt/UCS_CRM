import { useState, useEffect, useRef, useCallback } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ModernTimeInput } from '../components/ModernTimeInput';
import { apiGet, apiPost } from '../api/auth';
import { toast } from '../../../components/Toast';
import { generateReceiptPDF } from '../services/pdfGenerator';
import { useRealtime } from '../../../hooks/useRealtime';
import ReceiptTemplate_MannCar from '../components/ReceiptTemplate_MannCar';
import ReceiptTemplate_Ashray from '../components/ReceiptTemplate_Ashray';
import ReceiptTemplate_BeingSevak from '../components/ReceiptTemplate_BeingSevak';

const TEMPLATES = { manncar: ReceiptTemplate_MannCar, ashray: ReceiptTemplate_Ashray, beingsevak: ReceiptTemplate_BeingSevak };
const DB_TO_TEMPLATE = { mann: 'manncar', aflf: 'ashray', bsct: 'beingsevak' };
const PROJECT_LABELS = { mann: 'Mann Care Foundation', aflf: 'Ashray For Life Foundation', bsct: 'Being Sevak Charitable Trust' };
const SHORT_NGO_LABELS = { mann: 'Mann Care', aflf: 'Ashray', bsct: 'Being Sevak' };

function resolveNgo(projectId) {
  const p = (projectId || '').toLowerCase().trim();
  if (!p) return null;
  if (PROJECT_LABELS[p] || SHORT_NGO_LABELS[p]) return { code: p, label: PROJECT_LABELS[p] || SHORT_NGO_LABELS[p] };
  for (const [code, aliases] of Object.entries({ bsct: ['beingsevak', 'being sevak', 'sevak', 'bsct'], mann: ['manncar', 'mann care', 'manncare', 'maan', 'mann'], aflf: ['ashray', 'ashray life', 'aflf'] })) {
    if (aliases.some(a => p === a || p.includes(a))) return { code, label: PROJECT_LABELS[code] || SHORT_NGO_LABELS[code] };
  }
  return { code: null, label: p };
}

function getTemplateId(projectId) { return DB_TO_TEMPLATE[projectId] || 'beingsevak'; }

const currency = n => n != null ? '\u20B9' + Number(n).toLocaleString('en-IN') : 'NA';

function SkeletonField({ w = 100 }) {
  return <span style={{ display:'block', height:14, width: typeof w === 'number' ? w : w, borderRadius:4, background:'linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%)', backgroundSize:'200% 100%', animation:'sk-shimmer 1.4s infinite', marginBottom:3 }} />;
}
function SkeletonLabel() {
  return <span style={{ display:'block', height:10, width:48, borderRadius:3, background:'linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%)', backgroundSize:'200% 100%', animation:'sk-shimmer 1.4s infinite', marginBottom:6 }} />;
}

function parseDatetime(iso) {
  if (!iso) return { date: null, time: '' };
  try { const d = new Date(iso); const h = String(d.getHours()).padStart(2,'0'); const m = String(d.getMinutes()).padStart(2,'0'); return { date: d, time: `${h}:${m}` }; }
  catch { return { date: null, time: '' }; }
}
function fmtTime12(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const ap = h >= 12 ? 'PM' : 'AM';
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
function combineDatetime(date, time) {
  if (!date) return null;
  const d = new Date(date);
  if (time) { const [h, m] = time.split(':').map(Number); d.setHours(h||0, m||0, 0, 0); }
  return d.toISOString();
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function buildDonor(receipt) {
  return {
    'Receipt No.': receipt.receipt_no || '', 'Receipt Date': receipt.receipt_date || '',
    'Donor Name': receipt.donor_name || '', 'Address 1': receipt.address || '',
    'PAN No.': receipt.pan_number || '', 'Email ID': '', 'Amount': receipt.amount || 0,
    'Mode of Payment (MOP)': receipt.mode || '', 'Payment ID No.': '', 'Donor Bank Name': receipt.bank_name || '',
    'Account Of': 'Corpus', 'City': '', 'State': '', 'Pincode': '',
  };
}

export default function LeadDetail({ logId, onBack, onAfterAction, variant = 'page', onDelete }) {
  const drawer = variant === 'drawer';
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [goBackOpen, setGoBackOpen] = useState(false);
  const [goBackReason, setGoBackReason] = useState('');
  const [sendingWA, setSendingWA] = useState(false);
  const [waPhone, setWaPhone] = useState('');
  const [waResult, setWaResult] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('all');

  const [form, setForm] = useState({ donor_name:'',donor_receipt_name:'',donor_mobile:'',donor_city:'',donor_email:'',donor_address:'',donor_pan:'',donor_dob:null, upi_transaction_id:'',transaction_date:null,transaction_time:'',payment_from:'', payment_mode:'UPI' });
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestRef = useRef(null);
  const suggestTimer = useRef(null);

  const [addrSuggestions, setAddrSuggestions] = useState([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const addrSuggestRef = useRef(null);
  const addrSuggestTimer = useRef(null);

  const fetchAddressSuggestions = useCallback(async (typed, leadName, leadMobile) => {
    try {
      const params = new URLSearchParams();
      if (typed && typed.trim().length >= 2) params.set('q', typed.trim());
      if (leadMobile && leadMobile.trim()) params.set('mobile', leadMobile.trim());
      if (leadName && leadName.trim()) params.set('name', leadName.trim());
      if (!params.toString()) { setAddrSuggestions([]); setShowAddrSuggestions(false); return; }
      const data = await apiGet('/accounts/leads/address-suggest?' + params.toString());
      setAddrSuggestions(data || []);
      setShowAddrSuggestions(data?.length > 0);
    } catch { setAddrSuggestions([]); }
  }, []);

  const handleAddressChange = (value) => {
    setField('donor_address', value);
    if (addrSuggestTimer.current) clearTimeout(addrSuggestTimer.current);
    addrSuggestTimer.current = setTimeout(() => fetchAddressSuggestions(value, form.donor_name, form.donor_mobile), 300);
  };

  const selectAddressSuggestion = (item) => {
    setField('donor_address', item.address);
    setShowAddrSuggestions(false);
    setAddrSuggestions([]);
  };

  const handleAddressFocus = () => {
    if (addrSuggestions.length === 0) fetchAddressSuggestions(form.donor_address, form.donor_name, form.donor_mobile);
  };

  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.length < 2) { setSuggestions([]); return; }
    try {
      const data = await apiGet('/accounts/bank-audit/entries/suggest?q=' + encodeURIComponent(q));
      setSuggestions(data || []);
      setShowSuggestions(data?.length > 0);
    } catch { setSuggestions([]); }
  }, []);

  const handleUpiChange = (value) => {
    setField('upi_transaction_id', value);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  const selectSuggestion = (item) => {
    setField('upi_transaction_id', item.payment_id);
    setShowSuggestions(false);
    setSuggestions([]);
  };
  const receiptRef = useRef(null);
  const hasInitRef = useRef(false);

  const load = () => {
    setLoading(true);
    apiGet('/accounts/leads')
      .then(all => all.find(ll => ll.log_id === parseInt(logId)))
      .then(ll => { setLead(ll||null); return ll; })
      .then(ll => {
        if (ll && !hasInitRef.current) {
          const {date,time} = parseDatetime(ll.transaction_datetime);
          setForm({ donor_name:ll.donor_name||'',donor_mobile:ll.donor_mobile||'',donor_city:ll.donor_city||'', donor_email:ll.donor_email||'',donor_address:ll.donor_address||'',donor_pan:ll.donor_pan||ll.pan_number||'', donor_dob:ll.donor_dob?new Date(ll.donor_dob):null, upi_transaction_id:ll.upi_transaction_id||'',transaction_date:date,transaction_time:time, payment_from:ll.payment_from||'',payment_mode:ll.payment_mode||'UPI' });
          hasInitRef.current = true;
        }
      }).catch(()=>{})
      .finally(() => setLoading(false));
  };

  const loadReceipt = async () => {
    if (!lead) return;
    try { const r = await apiGet(`/accounts/leads/${lead.log_id}/receipt`); setReceipt(r||null); }
    catch { setReceipt(null); }
  };

  // Live updates: a lead verified (or a receipt raised) anywhere - in the
  // FRO app, in Quick Verify, in another tab - must show up here without a
  // manual reload, otherwise the detail pane shows stale state.
  useRealtime('fro_donor_logs', { event: '*', onInsert: () => load(), onUpdate: () => load() });
  useRealtime('bank_audit_entries', { event: '*', onInsert: () => { load(); loadReceipt(); }, onUpdate: () => { load(); loadReceipt(); } });
  useRealtime('receipts', { event: '*', onInsert: () => loadReceipt(), onUpdate: () => loadReceipt() });
  useRealtime('leads', { event: '*', filter: lead?.id ? `id=eq.${lead.id}` : undefined, onInsert: () => load(), onUpdate: () => load(), onDelete: () => load() });

  const loadHistory = async () => {
    if (!l?.donor_id) return;
    setHistory([]); setHistoryOpen(true); setHistoryLoading(true);
    try { const d = await apiGet(`/accounts/donor/${l.donor_id}/history`); setHistory(d||[]); }
    catch { setHistory([]); }
    finally { setHistoryLoading(false); }
  };

  useEffect(()=>{load();},[logId]);
  useEffect(()=>{if(lead&&lead.accounts_status==='verified')loadReceipt();},[lead?.accounts_status]);
  useEffect(()=>{
    if(lead?.donor_mobile){
      const raw=lead.donor_mobile.replace(/\D/g,'');
      const f=raw.length===10?'91'+raw:raw.startsWith('0')?'91'+raw.slice(1):raw;
      setWaPhone(f);
    }
  },[lead?.donor_mobile]);
  const setField = (key,val) => setForm(prev=>({...prev,[key]:val}));

  useEffect(()=>{
    if(!lead?.donor_mobile || lead?.accounts_status !== 'pending') return;
    let cancelled = false;
    apiGet('/accounts/receipts/by-mobile?mobile=' + encodeURIComponent(lead.donor_mobile))
      .then(data => {
        if (cancelled || !data) return;
        setForm(prev => ({
          ...prev,
          donor_receipt_name: data.donor_name || prev.donor_receipt_name || '',
          donor_address: data.address || prev.donor_address || '',
          donor_pan: data.pan_number || prev.donor_pan || '',
        }));
      })
      .catch(()=>{});
    return ()=>{ cancelled = true; };
  },[lead?.log_id, lead?.donor_mobile, lead?.accounts_status]);

  const handleVerify = async () => {
    if (!lead) return; setConfirmOpen(false); setSubmitting(true);
    try {
      const res = await apiPost(`/accounts/leads/${lead.log_id}/verify`, {
        pan_number:form.donor_pan||null,donor_name:form.donor_name||null,donor_receipt_name:form.donor_receipt_name||null,donor_mobile:form.donor_mobile||null,
        donor_city:form.donor_city||null,donor_email:form.donor_email||null,donor_pan:form.donor_pan||null,
        donor_address:form.donor_address||null,donor_dob:form.donor_dob?form.donor_dob.toISOString():null,
        upi_transaction_id:form.upi_transaction_id||null,
        transaction_datetime:combineDatetime(form.transaction_date,form.transaction_time),
        payment_from:form.payment_from||null,payment_mode:form.payment_mode||'UPI',
      });
      if (res.receipt) setReceipt(res.receipt);
      if (onBack) onBack();
      // onBack only reloads THIS list. Without onAfterAction the sibling
      // Bank Audit panel never learned that the money was verified and kept
      // showing the entry as unclaimed until a manual reload.
      if (onAfterAction) onAfterAction();
      toast('Successfully verified', 'success');
    } catch(err) { alert(err.message); }
    finally { setSubmitting(false); }
  };

  const handleDone = async () => {
    if (!lead) return; setDoneOpen(false); setSubmitting(true);
    try {
      await apiPost(`/accounts/leads/${lead.log_id}/done`);
      toast('Lead completed', 'success');
      if (onBack) onBack();
      if (onAfterAction) onAfterAction();
    } catch(err) { alert(err.message); }
    finally { setSubmitting(false); }
  };

  const handleReject = async () => {
    if (!lead||!rejectReason.trim()) return; setRejectOpen(false); setSubmitting(true);
    try { await apiPost(`/accounts/leads/${lead.log_id}/reject`,{reason:rejectReason}); setRejectReason(''); load(); if (onAfterAction) onAfterAction(); }
    catch(err) { alert(err.message); }
    finally { setSubmitting(false); }
  };

  const handleGoBack = async () => {
    if (!lead) return; setGoBackOpen(false); setSubmitting(true);
    try {
      await apiPost(`/accounts/leads/${lead.log_id}/go-back`,{reason:goBackReason||null});
      setGoBackReason('');
      onBack ? onBack() : load();
      if (onAfterAction) onAfterAction();
    }
    catch(err) { alert(err.message); }
    finally { setSubmitting(false); }
  };

  const handleDownload = async () => {
    if (!receiptRef.current) return;
    try { const pdf = await generateReceiptPDF(receiptRef.current); pdf.save(`receipt_${(receipt?.receipt_no||'download').replace(/[/\\]/g,'_')}.pdf`); }
    catch(err) { alert('Failed: '+err.message); }
  };

  const sendWA = async () => {
    const phone = (waPhone || '').replace(/\D/g, '');
    if (!phone || phone.length < 10) { alert('Please enter a valid WhatsApp number'); return; }
    if (!lead?.log_id) { alert('No donation log linked to this lead. Receipt cannot be sent.'); return; }
    setWaResult(null);
    setSendingWA(true);
    try {
      let pdfBase64 = null;
      if (receiptRef.current) {
        const pdf = await generateReceiptPDF(receiptRef.current, { scale: 1, jpegQuality: 0.7 });
        pdfBase64 = pdf.output('datauristring').split(',')[1];
      }
      const res = await apiPost(`/whatsapp/send-receipt/${lead.log_id}`, {
        number: phone,
        pdfBase64,
        receiptNo: receipt?.receipt_no,
        donorName: donor?.name,
        amount: receipt?.amount,
      });
      setWaResult({ success: true, message: res.uploadError ? 'Sent (text only - PDF upload failed: ' + res.uploadError + ')' : 'Receipt PDF sent!' });
    } catch (err) {
      setWaResult({ success: false, message: 'Failed: ' + err.message });
    } finally { setSendingWA(false); }
  };

  const openReceiptAndSendWA = () => { setShowReceipt(true); };
  const openReceiptAndDownload = () => { setShowReceipt(true); };

  if (loading) {
    return (
      <div>
        {!drawer && <div className="detail-header"><button className="back-btn" onClick={onBack}>{'\u2190'}</button><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>Lead Details</div></div></div>}
        <div className="two-col detail-layout" style={drawer ? { gridTemplateColumns: '1fr' } : undefined}>
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div className="card"><div className="card-head"><h3>Payment & Transaction Details</h3></div><div className="card-pad"><div className="info-grid">{[1,2,3,4,5,6,7,8].map(i=><div key={i}><SkeletonLabel /><SkeletonField w={`${50+Math.random()*40}%`} /></div>)}</div></div></div>
            <div className="card"><div className="card-head"><h3>Donor Information</h3></div><div className="card-pad"><div className="info-grid">{[1,2,3,4,5,6,7,8,9,10].map(i=><div key={i}><SkeletonLabel /><SkeletonField w={`${50+Math.random()*40}%`} /></div>)}</div></div></div>
          </div>
        </div>
      </div>
    );
  }
  if (!lead) return <div className="empty-state"><p>Lead not found</p><button className="btn" onClick={onBack}>Back to Leads</button></div>;

  const l = lead;
  const isPending = l.accounts_status === 'pending';
  const isVerified = l.accounts_status === 'verified';
  const projectId = (l.donor_project||'').toLowerCase();
  const templateId = getTemplateId(projectId);
  const ReceiptComp = TEMPLATES[templateId];
  const donor = receipt ? buildDonor(receipt) : null;

  const filteredHistory = (() => {
    if (historyFilter === 'all') return history;
    const now = new Date();
    if (historyFilter === 'this-month') return history.filter(h => h.verified_at && new Date(h.verified_at).getMonth()===now.getMonth() && new Date(h.verified_at).getFullYear()===now.getFullYear());
    if (historyFilter === 'this-year') return history.filter(h => h.verified_at && new Date(h.verified_at).getFullYear()===now.getFullYear());
    if (historyFilter.startsWith('fy')) {
      const fyYear = parseInt(historyFilter.split('-')[1]);
      return history.filter(h => {
        if (!h.verified_at) return false;
        const d = new Date(h.verified_at);
        const y = d.getFullYear();
        const m = d.getMonth()+1;
        return (m >= 4 && y === fyYear) || (m <= 3 && y === fyYear+1);
      });
    }
    return history;
  })();

  const finYears = [];
  for (let y = new Date().getFullYear(); y >= 2022; y--) finYears.push(`FY ${y}-${(y+1).toString().slice(-2)}`);

  return (
    <div style={drawer ? undefined : { paddingBottom: 65 }}>
      {!drawer && <div className="detail-header">
        <button className="back-btn" onClick={onBack}>{'\u2190'}</button>
        <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>Lead Details</div></div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {resolveNgo(l.donor_project)?.label && <span className="pill" style={{background:'#e8f0e4',color:'#5B6B4E',whiteSpace:'nowrap'}} title={`NGO: ${resolveNgo(l.donor_project).label}`}>{resolveNgo(l.donor_project).label}</span>}
          {isVerified && <span className="pill pill-green">Verified</span>}
          {l.accounts_status==='rejected' && <span className="pill pill-red" title={l.rejection_reason||''}>Rejected</span>}
        </div>
      </div>}

      {/* Notes/Remarks/Rejection Banner */}
      {(l.notes||l.remark||l.rejection_reason)&&(
        <div style={{margin:'16px 0',background:'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',borderRadius:12,border:'1px solid #fecaca',overflow:'hidden'}}>
          <div style={{padding:'12px 16px',display:'flex',gap:10,alignItems:'flex-start',borderBottom:(l.remark&&l.notes)||(l.remark&&l.rejection_reason)||(l.notes&&l.rejection_reason)?'1px solid #fecaca':'none'}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" style={{flexShrink:0,marginTop:1}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div style={{flex:1}}>
              {l.remark&&<div><span style={{fontSize:10,fontWeight:700,color:'#dc2626',textTransform:'uppercase',letterSpacing:'0.05em'}}>Remark</span><p style={{margin:'4px 0 0',fontSize:13,color:'#7f1d1d',whiteSpace:'pre-wrap',lineHeight:1.5}}>{l.remark}</p></div>}
              {l.notes&&<div style={{marginTop:l.remark?12:0}}><span style={{fontSize:10,fontWeight:700,color:'#dc2626',textTransform:'uppercase',letterSpacing:'0.05em'}}>Notes</span><p style={{margin:'4px 0 0',fontSize:13,color:'#7f1d1d',whiteSpace:'pre-wrap',lineHeight:1.5}}>{l.notes}</p></div>}
              {l.rejection_reason&&<div style={{marginTop:(l.remark||l.notes)?12:0}}><span style={{fontSize:10,fontWeight:700,color:'#dc2626',textTransform:'uppercase',letterSpacing:'0.05em'}}>Rejection Reason</span><p style={{margin:'4px 0 0',fontSize:13,color:'#7f1d1d',whiteSpace:'pre-wrap',lineHeight:1.5}}>{l.rejection_reason}</p></div>}
            </div>
          </div>
        </div>
      )}

      {/* Claim Info Card */}
      {l.claimed_receipt && (
        <div style={{margin:'16px 0',background:'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',borderRadius:12,border:'1px solid #fed7aa',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',display:'flex',gap:12,alignItems:'flex-start'}}>
            <div style={{width:36,height:36,borderRadius:10,background:'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:10,fontWeight:700,color:'#c2410c',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:4}}>Claimed by FRO</div>
              <div style={{fontSize:13,color:'#7c2d12',lineHeight:1.5}}>
                <strong>{l.claimant_name || l.agent_name || 'An FRO'}</strong> claimed this lead from Suspense
                {l.claimed_receipt.receipt_no ? ` · Receipt #${l.claimed_receipt.receipt_no}` : ''}
                {l.claimant_login && <span style={{color:'#9a3412'}}> ({l.claimant_login})</span>}
                {l.created_at && <span> · {new Date(l.created_at).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>}
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'4px 12px',marginTop:6}}>
                {(l.original_payer || l.claimed_receipt?.bank_payer_name || l.claimed_receipt?.donor_name) && (
                  <span style={{fontSize:12,color:'#7c2d12',background:'rgba(249,115,22,.14)',padding:'3px 9px',borderRadius:6}}>As per bank: <strong>{(l.original_payer || l.claimed_receipt?.bank_payer_name || l.claimed_receipt?.donor_name)}</strong></span>
                )}
                {l.received_source && (
                  <span style={{fontSize:12,color:'#7c2d12',background:'rgba(249,115,22,.14)',padding:'3px 9px',borderRadius:6}}>Received from: <strong>{l.received_source}</strong></span>
                )}
              </div>
              <div style={{fontSize:11,color:'#9a3412',marginTop:4,opacity:0.8}}>Accounts verifies the bank audit entry to credit the claimant.</div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="two-col detail-layout" style={drawer ? { gridTemplateColumns: '1fr' } : undefined}>
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* Payment & Transaction Details */}
          <div style={{background:'var(--card-bg)',borderRadius:14,border:'1px solid var(--line)',overflow:'hidden',boxShadow:'var(--shadow)'}}>
            <div style={{padding:'14px 18px',background:'linear-gradient(135deg, var(--bg) 0%, var(--card-bg) 100%)',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              </div>
              <h3 style={{margin:0,fontSize:14,fontWeight:700,color:'var(--ink)'}}>Payment & Transaction Details</h3>
            </div>
            <div style={{padding:'18px'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))',gap:'16px 20px'}}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Amount</div>
                  <div style={{fontSize:20,fontWeight:800,color:'var(--sage)',fontFamily:'var(--font-mono, monospace)'}}>{currency(l.amount)}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Agent</div>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--ink)'}}>{l.claimant_name || l.agent_name}</div>
                  <div style={{fontSize:11,color:'var(--ink-soft)',marginTop:2}}>{l.agent_login}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Submitted</div>
                  <div style={{fontSize:12,color:'var(--ink)'}}>{new Date(l.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
                  <div style={{fontSize:11,color:'var(--ink-soft)',marginTop:2}}>{new Date(l.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>MOP (as per audit)</div>
                  <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',padding:'8px 12px',background:'var(--bg)',borderRadius:8,border:'1px solid var(--line)',display:'inline-block'}}>{l.audit_mop||'NA'}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Received Bank</div>
                  <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',padding:'8px 12px',background:'var(--bg)',borderRadius:8,border:'1px solid var(--line)',display:'inline-block'}}>{l.audit_source||'NA'}</div>
                </div>
                <div style={{position:'relative'}} ref={suggestRef}>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>UPI Transaction ID</div>
                  {isPending?<input className="field-input" value={form.upi_transaction_id ?? ''} onChange={e=>handleUpiChange(e.target.value)} placeholder="e.g. UPI123456789" onBlur={()=>setTimeout(()=>setShowSuggestions(false),200)} onFocus={()=>suggestions.length>0&&setShowSuggestions(true)} style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1.5px solid var(--line)',fontSize:12}} />:<div style={{fontSize:12,color:'var(--ink)',fontFamily:'var(--font-mono, monospace)',padding:'8px 12px',background:'var(--bg)',borderRadius:8,border:'1px solid var(--line)'}}>{form.upi_transaction_id||'NA'}</div>}
                  {isPending&&showSuggestions?<div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--card-bg)',border:'1px solid var(--line)',borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,.12)',zIndex:50,maxHeight:200,overflowY:'auto',marginTop:4}}>{suggestions.map(s=><div key={s.id} onMouseDown={(e)=>{e.stopPropagation();selectSuggestion(s);}} style={{padding:'10px 12px',cursor:'pointer',fontSize:12,borderBottom:'1px solid var(--line)',display:'flex',justifyContent:'space-between',alignItems:'center',transition:'background .1s'}} onMouseOver={e=>e.currentTarget.style.background='var(--bg)'} onMouseOut={e=>e.currentTarget.style.background='transparent'}><span style={{fontWeight:500}}>{s.payment_id}</span><span className="pill pill-gray" style={{fontSize:10}}>{s.bank_audit_sources?.name}</span></div>)}</div>:null}
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Date</div>
                  {isPending?<DatePicker selected={form.transaction_date} onChange={d=>setField('transaction_date',d)} dateFormat="dd/MM/yyyy" placeholderText="Select date" isClearable showYearDropdown scrollableYearDropdown yearDropdownItemNumber={50} className="datepicker-input" style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1.5px solid var(--line)',fontSize:12}} />:<div style={{fontSize:12,color:'var(--ink)',padding:'8px 12px',background:'var(--bg)',borderRadius:8,border:'1px solid var(--line)'}}>{form.transaction_date?new Date(form.transaction_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'NA'}</div>}
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Time</div>
                  {isPending?<div className="field-picker"><ModernTimeInput value={form.transaction_time ?? ''} onChange={v=>setField('transaction_time',v)} placeholder="Select time" /></div>:                  <div style={{fontSize:12,color:'var(--ink)',padding:'8px 12px',background:'var(--bg)',borderRadius:8,border:'1px solid var(--line)'}}>{fmtTime12(form.transaction_time)||'NA'}</div>}
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>From</div>
                  {isPending?<input className="field-input" value={form.payment_from ?? ''} onChange={e=>setField('payment_from',e.target.value)} placeholder="Sender name" style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1.5px solid var(--line)',fontSize:12}} />:<div style={{fontSize:12,color:'var(--ink)',padding:'8px 12px',background:'var(--bg)',borderRadius:8,border:'1px solid var(--line)'}}>{form.payment_from||'NA'}</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Donor Information */}
          <div style={{background:'var(--card-bg)',borderRadius:14,border:'1px solid var(--line)',overflow:'hidden',boxShadow:'var(--shadow)'}}>
            <div style={{padding:'14px 18px',background:'linear-gradient(135deg, var(--bg) 0%, var(--card-bg) 100%)',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <h3 style={{margin:0,fontSize:14,fontWeight:700,color:'var(--ink)'}}>Donor Information</h3>
            </div>
            <div style={{padding:'18px'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))',gap:'16px 20px'}}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Name</div>
                  {isPending?<input className="field-input" value={form.donor_name ?? ''} onChange={e=>setField('donor_name',e.target.value)} placeholder="NA" style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1.5px solid var(--line)',fontSize:12}} />:<div style={{fontSize:13,fontWeight:600,color:'var(--ink)'}}>{form.donor_name||'NA'}</div>}
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Donor Receipt Name</div>
                  {isPending?<input className="field-input" value={form.donor_receipt_name ?? ''} onChange={e=>setField('donor_receipt_name',e.target.value)} placeholder="NA" style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1.5px solid var(--line)',fontSize:12}} />:<div style={{fontSize:13,fontWeight:600,color:'var(--ink)'}}>{form.donor_receipt_name||'NA'}</div>}
                </div>
                {l.audit_name && String(l.audit_name).trim().toLowerCase() !== String(l.donor_name || '').trim().toLowerCase() && (
                  <div style={{gridColumn:'1 / -1'}}>
                    <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Bank / as per audit name</div>
                    <div style={{fontSize:12,color:'var(--ink)'}}>{l.audit_name}</div>
                  </div>
                )}
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Mobile</div>
                  {isPending?<input className="field-input" value={form.donor_mobile ?? ''} onChange={e=>setField('donor_mobile',e.target.value)} placeholder="NA" style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1.5px solid var(--line)',fontSize:12}} />:<div style={{fontSize:12,color:'var(--ink)',fontFamily:'var(--font-mono, monospace)'}}>{form.donor_mobile||'NA'}</div>}
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Email</div>
                  {isPending?<input className="field-input" value={form.donor_email ?? ''} onChange={e=>setField('donor_email',e.target.value)} placeholder="NA" style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1.5px solid var(--line)',fontSize:12}} />:<div style={{fontSize:12,color:'var(--ink)'}}>{form.donor_email||'NA'}</div>}
                </div>
                <div style={{gridColumn:'1 / -1'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Address</div>
                  {isPending?<div style={{position:'relative'}} ref={addrSuggestRef}><input className="field-input" value={form.donor_address ?? ''} onChange={e=>handleAddressChange(e.target.value)} placeholder="NA" onFocus={handleAddressFocus} onBlur={()=>setTimeout(()=>setShowAddrSuggestions(false),200)} style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1.5px solid var(--line)',fontSize:12}} />{isPending&&showAddrSuggestions?<div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--card-bg)',border:'1px solid var(--line)',borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,.12)',zIndex:50,maxHeight:220,overflowY:'auto',marginTop:4}}>{addrSuggestions.map((s,i)=><div key={i} onMouseDown={(e)=>{e.stopPropagation();selectAddressSuggestion(s);}} style={{padding:'10px 12px',cursor:'pointer',fontSize:12,borderBottom:'1px solid var(--line)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,transition:'background .1s'}} onMouseOver={e=>e.currentTarget.style.background='var(--bg)'} onMouseOut={e=>e.currentTarget.style.background='transparent'}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.address}</span><span className="pill pill-gray" style={{fontSize:10,flexShrink:0}}>{s.source}{s.count>1?` \u00D7${s.count}`:''}</span></div>)}</div>:null}</div>:<div style={{fontSize:12,color:'var(--ink)',lineHeight:1.5}}>{form.donor_address||'NA'}</div>}
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>PAN</div>
                  {isPending?<input className="field-input" value={form.donor_pan ?? ''} onChange={e=>setField('donor_pan',e.target.value)} placeholder="NA" style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1.5px solid var(--line)',fontSize:12,textTransform:'uppercase'}} />:<div style={{fontSize:12,color:'var(--ink)',fontFamily:'var(--font-mono, monospace)',textTransform:'uppercase'}}>{form.donor_pan||'NA'}</div>}
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Donations</div>
                  <div style={{fontSize:12,color:'var(--ink)'}}>{l.donation_count||0} times</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Total Donated</div>
                  <div style={{fontSize:14,fontWeight:700,color:'var(--sage)',fontFamily:'var(--font-mono, monospace)',cursor:'pointer',borderBottom:'1px dashed var(--sage)',display:'inline-block'}} onClick={loadHistory} title="Click to view donation history">{currency(l.total_donated)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {receipt && donor && ReceiptComp && (
        <div style={{ position:'absolute',zIndex:-1,opacity:0,pointerEvents:'none' }}>
          <div ref={receiptRef} data-receipt data-receipt-print><ReceiptComp donor={donor} index={0} project={templateId} /></div>
        </div>
      )}

      {drawer ? (
        <div style={{position:'sticky',bottom:-18,margin:'16px -18px -18px',padding:'12px 18px',background:'rgba(255,255,255,.97)',backdropFilter:'blur(16px)',borderTop:'1px solid #e5e7eb',boxShadow:'0 -2px 12px rgba(0,0,0,.06)',zIndex:100}}>
          {isPending && (
            <div style={{display:'flex',gap:12,width:'100%',alignItems:'center'}}>
              {onDelete && (
                <button onClick={onDelete} disabled={submitting} title="Delete lead" style={{border:'1px solid #fecaca',background:'#fff',color:'#dc2626',borderRadius:10,width:42,height:42,flexShrink:0,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all .15s'}} onMouseOver={e=>{e.currentTarget.style.background='#fef2f2'}} onMouseOut={e=>{e.currentTarget.style.background='#fff'}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
              )}
              <button onClick={()=>setRejectOpen(true)} disabled={submitting} className="reject-btn" style={{flex:1}}>{submitting?'...':'\u2716 Reject'}</button>
              <button onClick={()=>setGoBackOpen(true)} disabled={submitting} style={{flex:1,padding:'10px 22px',fontSize:13,fontWeight:600,background:'#fff',color:'#92400e',border:'1.5px solid #fcd34d',borderRadius:10,cursor:'pointer',transition:'all .2s',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}>{'\u21a9 Go Back'}</button>
              {receipt?.receipt_no ? (
                <button onClick={()=>setDoneOpen(true)} disabled={submitting} style={{flex:2,padding:'10px 22px',fontSize:13,fontWeight:600,background:'#0369a1',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',transition:'all .2s',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}>
                  {submitting?<span style={{display:'inline-flex',alignItems:'center',gap:6}}><span style={{display:'inline-block',width:14,height:14,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>Saving</span>:'\u2714 Done'}
                </button>
              ) : (
                <button onClick={()=>setConfirmOpen(true)} disabled={submitting} className="verify-btn" style={{flex:2}}>{submitting?<span style={{display:'inline-flex',alignItems:'center',gap:6}}><span style={{display:'inline-block',width:14,height:14,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>Saving</span>:'\u2714 Verify & Save'}</button>
              )}
            </div>
          )}
          {isVerified && (
            <div style={{display:'flex',gap:12,width:'100%'}}>
              {receipt && <button className="wa-btn" onClick={()=>setShowReceipt(true)}>{'\u2709'} Send WhatsApp</button>}
              {receipt && <button className="verify-btn" style={{flex:1}} onClick={()=>setShowReceipt(true)}>View Receipt</button>}
              <button onClick={()=>setGoBackOpen(true)} disabled={submitting} style={{flex:1,padding:'10px 22px',fontSize:13,fontWeight:600,background:'#fff',color:'#92400e',border:'1.5px solid #fcd34d',borderRadius:10,cursor:'pointer',transition:'all .2s',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}>{'\u21a9 Go Back'}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="action-bar">
          {isPending && (
            <div style={{display:'flex',gap:12,maxWidth:600,margin:'0 auto',width:'100%'}}>
              <button onClick={()=>setRejectOpen(true)} disabled={submitting} className="reject-btn" style={{flex:1}}>{submitting?'...':'\u2716 Reject'}</button>
              <button onClick={()=>setGoBackOpen(true)} disabled={submitting} style={{flex:1,padding:'10px 22px',fontSize:13,fontWeight:600,background:'#fff',color:'#92400e',border:'1.5px solid #fcd34d',borderRadius:10,cursor:'pointer',transition:'all .2s',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}>{'\u21a9 Go Back'}</button>
              {receipt?.receipt_no ? (
                <button onClick={()=>setDoneOpen(true)} disabled={submitting} style={{flex:2,padding:'10px 22px',fontSize:13,fontWeight:600,background:'#0369a1',color:'#fff',border:'none',borderRadius:10,cursor:'pointer',transition:'all .2s',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}>
                  {submitting?<span style={{display:'inline-flex',alignItems:'center',gap:6}}><span style={{display:'inline-block',width:14,height:14,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>Saving</span>:'\u2714 Done'}
                </button>
              ) : (
                <button onClick={()=>setConfirmOpen(true)} disabled={submitting} className="verify-btn" style={{flex:2}}>{submitting?<span style={{display:'inline-flex',alignItems:'center',gap:6}}><span style={{display:'inline-block',width:14,height:14,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>Saving</span>:'\u2714 Verify & Save'}</button>
              )}
            </div>
          )}
          {isVerified && (
            <div style={{display:'flex',gap:12,maxWidth:600,margin:'0 auto',width:'100%'}}>
              {receipt && <button className="wa-btn" onClick={()=>setShowReceipt(true)}>{'\u2709'} Send WhatsApp</button>}
              {receipt && <button className="verify-btn" style={{flex:1}} onClick={()=>setShowReceipt(true)}>View Receipt</button>}
              <button onClick={()=>setGoBackOpen(true)} disabled={submitting} style={{flex:1,padding:'10px 22px',fontSize:13,fontWeight:600,background:'#fff',color:'#92400e',border:'1.5px solid #fcd34d',borderRadius:10,cursor:'pointer',transition:'all .2s',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}>{'\u21a9 Go Back'}</button>
            </div>
          )}
        </div>
      )}

      {confirmOpen && (
        <div className="modal-overlay" onClick={()=>setConfirmOpen(false)}>
          <div className="modal" style={{maxWidth:420,width:'90%'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>Confirm Verification</h3></div>
            <div className="modal-body" style={{padding:20}}>
              <p style={{margin:'0 0 6px',fontSize:14}}>Verify this lead and mark amount as collected?</p>
              <p style={{margin:0,fontSize:13,color:'var(--ink-soft)'}}>A matched bank audit entry will be verified and credited, and its receipt reused; otherwise a receipt will be auto-generated.</p>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:20}}>
                <button className="btn btn-sm" onClick={()=>setConfirmOpen(false)}>Cancel</button>
                <button className="verify-btn" onClick={handleVerify} disabled={submitting}>{submitting?<span style={{display:'inline-flex',alignItems:'center',gap:6}}><span style={{display:'inline-block',width:14,height:14,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>Saving</span>:'\u2714 Confirm & Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {doneOpen && (
        <div className="modal-overlay" onClick={()=>setDoneOpen(false)}>
          <div className="modal" style={{maxWidth:420,width:'90%'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>Complete Lead</h3></div>
            <div className="modal-body" style={{padding:20}}>
              <p style={{margin:'0 0 6px',fontSize:14}}>Mark this lead as done?</p>
              <p style={{margin:0,fontSize:13,color:'var(--ink-soft)'}}>Receipt <strong>{receipt?.receipt_no}</strong> already exists. This will credit the FRO and mark the lead verified.</p>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:20}}>
                <button className="btn btn-sm" onClick={()=>setDoneOpen(false)}>Cancel</button>
                <button className="verify-btn" onClick={handleDone} disabled={submitting} style={{background:'#0369a1'}}>{submitting?<span style={{display:'inline-flex',alignItems:'center',gap:6}}><span style={{display:'inline-block',width:14,height:14,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>Saving</span>:'\u2714 Done'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {rejectOpen && (
        <div className="modal-overlay" onClick={()=>setRejectOpen(false)}>
          <div className="modal" style={{maxWidth:420,width:'90%'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>Reject Lead</h3></div>
            <div className="modal-body" style={{padding:20}}>
              <label className="field" style={{display:'block',marginBottom:16}}><span style={{fontSize:11,color:'var(--ink-soft)',textTransform:'uppercase',marginBottom:4,display:'block'}}>Reason</span><textarea className="field-input" value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Enter rejection reason..." rows={3} style={{resize:'vertical'}} autoFocus /></label>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button className="btn btn-sm" onClick={()=>{setRejectOpen(false);setRejectReason('');}}>Cancel</button>
                <button className="reject-btn" onClick={handleReject} disabled={!rejectReason.trim()} style={{background:'#dc2626',color:'#fff',border:'none'}}>Reject</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {goBackOpen && (
        <div className="modal-overlay" onClick={()=>setGoBackOpen(false)}>
          <div className="modal" style={{maxWidth:440,width:'90%'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>Go Back to FRO</h3></div>
            <div className="modal-body" style={{padding:20}}>
              <p style={{margin:'0 0 8px',fontSize:14}}>{isVerified
                ? 'Send this lead back to the FRO as if it never came?'
                : 'Send this lead back to the FRO?'}</p>
              <p style={{margin:0,fontSize:13,color:'var(--ink-soft)',lineHeight:1.5}}>
                {isVerified
                  ? 'It will be removed from collected totals, the receipt will be released/deleted, and the FRO will need to rework the lead. If the receipt was already sent to the donor it will no longer be valid.'
                  : 'The lead_done disposition will be cleared and the FRO will need to redo it. If it was a suspense claim, the money returns to the suspense pool.'}
              </p>
              <label className="field" style={{display:'block',margin:'16px 0'}}><span style={{fontSize:11,color:'var(--ink-soft)',textTransform:'uppercase',marginBottom:4,display:'block'}}>Reason (optional)</span><textarea className="field-input" value={goBackReason} onChange={e=>setGoBackReason(e.target.value)} placeholder="Why is it being sent back?" rows={3} style={{resize:'vertical'}} /></label>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button className="btn btn-sm" onClick={()=>{setGoBackOpen(false);setGoBackReason('');}}>Cancel</button>
                <button onClick={handleGoBack} disabled={submitting} style={{padding:'10px 22px',fontSize:13,fontWeight:600,background:'#d97706',color:'#fff',border:'none',borderRadius:10,cursor:'pointer'}}>{submitting?'Sending back...':'Send Back'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReceipt && receipt && donor && ReceiptComp && (
        drawer ? (
          <div style={{margin:'16px -18px -18px',borderTop:'1px solid var(--line)',background:'var(--card-bg)'}}>
            <div style={{padding:'12px 18px',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',justifyContent:'space-between',background:'var(--bg)'}}>
              <span style={{fontSize:13,fontWeight:600,color:'var(--ink)'}}>Receipt Preview</span>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <button className="btn btn-primary btn-sm" onClick={handleDownload}>Download PDF</button>
                {waResult && (
                  <span style={{fontSize:11,color:waResult.success?'#059669':'#dc2626'}}>{waResult.message}</span>
                )}
                <button className="btn btn-sm" style={{background:'#25D366',color:'#fff'}} onClick={sendWA} disabled={sendingWA}>{sendingWA ? 'Sending...' : 'Send via WhatsApp'}</button>
                <button className="btn btn-sm btn-icon" onClick={()=>setShowReceipt(false)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div style={{padding:20,display:'flex',justifyContent:'center',overflow:'auto',maxHeight:'60vh'}}>
              <div data-receipt-print><ReceiptComp donor={donor} index={0} project={templateId} /></div>
            </div>
          </div>
        ) : (
          <div className="modal-overlay" onClick={()=>setShowReceipt(false)}>
            <div className="modal" style={{maxWidth:800,width:'90%',maxHeight:'90vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
              <div className="modal-header">
                <h3>Receipt Preview</h3>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <button className="btn btn-primary btn-sm" onClick={handleDownload}>Download PDF</button>
                  {waResult && (
                    <span style={{fontSize:11,color:waResult.success?'#059669':'#dc2626',marginRight:4}}>{waResult.message}</span>
                  )}
                  <button className="btn btn-sm" style={{background:'#25D366',color:'#fff'}} onClick={sendWA} disabled={sendingWA}>{sendingWA ? 'Sending...' : 'Send via WhatsApp'}</button>
                  <button className="btn btn-sm" onClick={()=>setShowReceipt(false)}>Close</button>
                </div>
              </div>
              <div className="modal-body" style={{padding:20}}>
                <div data-receipt-print><ReceiptComp donor={donor} index={0} project={templateId} /></div>
              </div>
            </div>
          </div>
        )
      )}

      {historyOpen && (
        <div className="modal-overlay" onClick={()=>setHistoryOpen(false)} style={{background:'rgba(15,23,42,.46)',backdropFilter:'blur(2px)'}}>
          <div className="modal" style={{maxWidth:520,width:'90%',maxHeight:'80vh',display:'flex',flexDirection:'column',overflow:'hidden',border:'1px solid #e5e7eb',borderRadius:16,boxShadow:'0 24px 70px rgba(15,23,42,.24)'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'20px 22px',background:'linear-gradient(135deg,#f8fafc 0%,#ffffff 72%)',borderBottom:'1px solid var(--line)'}}>
              <div style={{display:'flex',alignItems:'center',gap:12,minWidth:0}}>
                <div style={{width:44,height:44,borderRadius:13,background:'linear-gradient(135deg,var(--sage),#435437)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700,flexShrink:0,boxShadow:'0 4px 10px rgba(91,107,78,.22)'}}>
                  {l.donor_name ? l.donor_name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2) : '?'}
                </div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--sage)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:3}}>Donor history</div>
                  <div style={{fontSize:16,fontWeight:700,color:'var(--ink)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l.donor_name || 'Donor'}</div>
                  {!historyLoading && filteredHistory.length > 0 && (
                    <div style={{fontSize:12,color:'var(--ink-soft)',marginTop:3,display:'flex',alignItems:'center',gap:6}}>
                      <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',minWidth:22,height:22,padding:'0 6px',borderRadius:7,background:'#e8efe5',color:'var(--sage)',fontWeight:700}}>{filteredHistory.length}</span>
                      donation{filteredHistory.length!==1?'s':''}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={()=>setHistoryOpen(false)} title="Close donor history" aria-label="Close donor history" style={{width:34,height:34,border:'1px solid var(--line)',borderRadius:10,background:'#fff',color:'var(--ink-soft)',display:'inline-flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,transition:'all .15s'}} onMouseOver={e=>{e.currentTarget.style.background='#f1f5f9';e.currentTarget.style.color='var(--ink)'}} onMouseOut={e=>{e.currentTarget.style.background='#fff';e.currentTarget.style.color='var(--ink-soft)'}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{padding:'18px 22px',overflowY:'auto'}}>
              <div style={{marginBottom:16}}>
                <select value={historyFilter} onChange={e=>setHistoryFilter(e.target.value)} style={{width:'100%',padding:'8px 12px',border:'1px solid var(--line)',borderRadius:'var(--radius)',fontSize:13,fontFamily:'inherit',outline:'none',background:'var(--card-bg)',cursor:'pointer'}}>
                  <option value="all">All Time</option>
                  <option value="this-month">This Month</option>
                  <option value="this-year">This Year</option>
                  {finYears.map(fy=><option key={fy} value={fy}>{fy}</option>)}
                </select>
              </div>
              {historyLoading ? (
                <div style={{textAlign:'center',padding:'40px 20px',color:'var(--ink-soft)'}}>
                  <div style={{width:28,height:28,border:'2.5px solid var(--line)',borderTopColor:'var(--sage)',borderRadius:'50%',animation:'spin 0.7s linear infinite',margin:'0 auto 12px'}} />
                  <div style={{fontSize:13}}>Loading donations...</div>
                </div>
              ) : filteredHistory.length === 0 ? (
                <p style={{fontSize:12,color:'var(--ink-soft)',textAlign:'center',padding:24,margin:0}}>No donations found</p>
              ) : (
                <>
                  <div style={{fontSize:12,fontWeight:600,color:'var(--ink-soft)',textTransform:'uppercase',letterSpacing:.5,marginBottom:10}}>Donations</div>
                  <div style={{display:'flex',flexDirection:'column'}}>
                    {filteredHistory.map((h,i)=>(
                      <div key={h.log_id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 0',borderBottom:i<filteredHistory.length-1?'1px solid var(--line)':'none'}}>
                        <div style={{width:6,height:6,borderRadius:'50%',background:'var(--sage)',flexShrink:0}} />
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <span style={{fontSize:12,fontWeight:600,fontFamily:'monospace',color:'var(--ink)'}}>{h.receipt_no||'—'}</span>
                            <span style={{fontSize:11,color:'var(--ink-soft)'}}>
                              {h.verified_at?new Date(h.verified_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'}
                            </span>
                          </div>
                          <div style={{fontSize:11,color:'var(--ink-soft)',marginTop:2}}>
                            {h.payment_mode||''}
                            {h.payment_from && <> · {h.payment_from}</>}
                            {h.agent_name && <> · {h.agent_name}</>}
                          </div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <div style={{fontSize:14,fontWeight:700,color:'var(--sage)',whiteSpace:'nowrap'}}>{currency(h.amount)}</div>
                          {h.receipt_no && (
                            <button
                              onClick={()=>{
                                const receiptData = {
                                  receipt_no: h.receipt_no,
                                  receipt_date: h.verified_at || h.created_at,
                                  donor_name: l.donor_name,
                                  amount: h.amount,
                                  mode: h.payment_mode,
                                  payment_id: h.upi_transaction_id,
                                  bank_name: h.payment_from,
                                  pan_number: l.donor_pan,
                                  address: l.donor_address,
                                  project_id: l.donor_project,
                                };
                                setReceipt(receiptData);
                                setShowReceipt(true);
                              }}
                              title="View Receipt"
                              style={{padding:'4px 8px',border:'1px solid var(--line)',borderRadius:'var(--radius-sm)',background:'var(--card-bg)',cursor:'pointer',display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--ink-soft)',transition:'all 0.15s'}}
                              onMouseOver={e=>{e.currentTarget.style.background='var(--sage)';e.currentTarget.style.color='#fff';e.currentTarget.style.borderColor='var(--sage)'}}
                              onMouseOut={e=>{e.currentTarget.style.background='var(--card-bg)';e.currentTarget.style.color='var(--ink-soft)';e.currentTarget.style.borderColor='var(--line)'}}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            {!historyLoading && filteredHistory.length > 0 && (
              <div style={{padding:'14px 20px',borderTop:'1px solid var(--line)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--bg)'}}>
                <span style={{fontSize:12,color:'var(--ink-soft)',fontWeight:500}}>Total donations</span>
                <span style={{fontSize:16,fontWeight:700,color:'var(--sage)'}}>
                  {currency(filteredHistory.reduce((sum,h)=>sum+Number(h.amount||0),0))}
                  <span style={{fontSize:11,fontWeight:400,color:'var(--ink-soft)',marginLeft:4}}>({filteredHistory.length})</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes sk-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .verify-btn{padding:10px 22px;font-size:13px;font-weight:600;background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;border-radius:10px;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 2px 8px rgba(5,150,105,.25)}
        .verify-btn:hover:not(:disabled){background:linear-gradient(135deg,#047857,#065f46);transform:translateY(-1px);box-shadow:0 6px 20px rgba(5,150,105,.35)}
        .verify-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
        .reject-btn{padding:10px 22px;font-size:13px;font-weight:500;background:#fff;color:#dc2626;border:1.5px solid #fecaca;border-radius:10px;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;justify-content:center;gap:6px}
        .reject-btn:hover:not(:disabled){background:#fef2f2;border-color:#fca5a5;transform:translateY(-1px);box-shadow:0 4px 12px rgba(220,38,38,.1)}
        .reject-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
        .wa-btn{padding:10px 22px;font-size:13px;font-weight:600;background:#25D366;color:#fff;border:none;border-radius:10px;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:1.2}
        .wa-btn:hover:not(:disabled){background:#1ea350;transform:translateY(-1px);box-shadow:0 4px 12px rgba(37,211,102,.3)}
        .wa-btn:disabled{opacity:.5;cursor:not-allowed}
        .field-input{width:100%;box-sizing:border-box;padding:8px 12px;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;outline:none;background:#f9fafb;color:#1f2937;transition:border-color .15s,box-shadow .15s,background .15s;height:36px}
        .field-input:focus{border-color:var(--sage,#5B6B4E);box-shadow:0 0 0 3px rgba(91,107,78,.08);background:#fff}
        .field-input::placeholder{color:#9ca3af}
        .field-picker button{height:36px!important;padding:8px 12px!important;font-size:13px!important;border:1px solid #e5e7eb!important;border-radius:8px!important;background:#f9fafb!important;color:#1f2937!important;display:flex!important;align-items:center!important;box-sizing:border-box!important}
        .action-bar{position:fixed;bottom:0;left:200px;right:0;z-index:50;background:rgba(255,255,255,.97);backdrop-filter:blur(16px);border-top:1px solid #e5e7eb;padding:10px 24px;display:flex;justify-content:center;box-shadow:0 -2px 12px rgba(0,0,0,.06)}
        @media(max-width:952px){.action-bar{left:0}}
        .datepicker-input{width:100%;box-sizing:border-box;padding:8px 12px;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;outline:none;background:#f9fafb;color:#1f2937;height:36px}
        .datepicker-input:focus{border-color:var(--sage,#4ade80);box-shadow:0 0 0 2px rgba(74,222,128,.15)}
        .react-datepicker{font-family:inherit;font-size:13px;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.08)}
        .react-datepicker__header{background:#f0fdf4;border-bottom:1px solid #dcfce7;border-radius:10px 10px 0 0;padding-top:10px}
        .react-datepicker__current-month{font-weight:600;color:#166534;font-size:14px}
        .react-datepicker__day-name{color:#6b7280;font-weight:500;font-size:11px;width:32px}
        .react-datepicker__day{width:32px;height:32px;line-height:32px;border-radius:8px;margin:1px;color:#374151}
        .react-datepicker__day:hover{background:#dcfce7;border-radius:8px}
        .react-datepicker__day--selected,.react-datepicker__day--keyboard-selected{background:#166534!important;color:#fff!important;border-radius:8px}
        .react-datepicker__day--today{font-weight:700;color:#166534;background:#f0fdf4}
        .react-datepicker__navigation{top:10px}
        .react-datepicker__year-dropdown-container{margin-left:5px}
        .react-datepicker__year-select{padding:2px 6px;font-size:13px;border:1px solid #d1d5db;border-radius:4px;background:#fff;color:#166534;font-weight:600;cursor:pointer;outline:none}
        .react-datepicker__close-icon::after{background:#9ca3af;font-size:14px;height:16px;width:16px}
        .react-datepicker__triangle{display:none}
        select.field-input{cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");background-position:right 8px center;background-repeat:no-repeat;background-size:16px;padding-right:32px}
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:center;justify-content:center}
        .modal{position:relative;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.2)}
        .modal-header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid #e5e7eb}
        .modal-header h3{margin:0;font-size:16px}
        .modal-body{overflow:auto;max-height:calc(90vh - 70px)}
        @media print{
          @page{size:A4 portrait;margin:8mm}
          html,body{margin:0!important;padding:0!important;background:#fff!important}
          body *{visibility:hidden}
          [data-receipt-print],[data-receipt-print] *{visibility:visible}
          .modal-overlay{display:none!important}
          .modal-header{display:none!important}
          .modal{position:static!important;transform:none!important;width:100%!important;max-width:none!important;max-height:none!important;overflow:visible!important;box-shadow:none!important;border-radius:0!important;margin:0!important;padding:0!important}
          .modal-body{padding:0!important;margin:0!important;max-height:none!important;overflow:visible!important;display:flex!important;justify-content:center!important}
          [data-receipt-print]{position:relative;width:100%;margin:-8mm 0 0!important;padding:0!important;display:flex!important;justify-content:center!important}
          [data-receipt-print] [data-receipt-sheet]{margin:0 auto!important;max-width:none!important;break-inside:avoid;page-break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
          [data-receipt-print] [data-pdf-width="1000"]{zoom:.68}
          [data-receipt-print] [data-pdf-width="900"]{zoom:.75}
          [data-receipt-print] [data-pdf-width="794"]{zoom:.85}
        }
      `}</style>
    </div>
  );
}

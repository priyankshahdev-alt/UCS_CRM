import { useState, useEffect, useMemo, useRef } from 'react';
import { Inbox, Search, ChevronRight, Phone } from 'lucide-react';
import { getSuspenseReceipts, claimSuspenseReceipt, searchDonorsByMobile, searchSuspenseDonors } from '../api/donors';
import { useRealtime } from '../../../hooks/useRealtime';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { SkeletonTable } from '../../../components/Skeleton';

const currency = n => n != null ? '\u20B9' + Number(n).toLocaleString('en-IN') : '\u2014';

const fieldStyle = { width: '100%', padding: '10px 12px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', transition: 'border-color .15s' };

function fmtTime12(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return String(t);
  const ap = h >= 12 ? 'PM' : 'AM';
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

const CLAIM_BADGES = {
  pending: { text: 'Claimed · Pending', color: '#b45309', bg: '#fef3c7' },
  verified: { text: 'Claim Verified', color: '#166534', bg: '#dcfce7' },
  rejected: { text: 'Claim Rejected', color: '#b91c1c', bg: '#fee2e2' },
  receipt_sent: { text: 'Receipt Sent · Awaiting FRO', color: '#0369a1', bg: '#e0f2fe' },
};

const NGO_LABELS = { bsct: 'Being Sevak', mann: 'Mann Care', aflf: 'Ashray' };
const NGO_SHORT = { bsct: 'BSCT', mann: 'MANN', aflf: 'AFLF' };
const NGO_PILL = {
  bsct: { bg: '#dbeafe', color: '#1e40af' },
  mann: { bg: '#fce7f3', color: '#be185d' },
  aflf: { bg: '#dcfce7', color: '#166534' },
};

const initials = (name) => (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

export default function FroSuspense() {
  const isMobile = useIsMobile()
  const [month, setMonth] = useState('');
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ngoFilter, setNgoFilter] = useState('');
  const [query, setQuery] = useState('');
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimReceipt, setClaimReceipt] = useState(null);
  const [claimDonor, setClaimDonor] = useState(null);
  const [claimSearch, setClaimSearch] = useState('');
  const [claimResults, setClaimResults] = useState([]);
  const [claimSearching, setClaimSearching] = useState(false);
  const claimTimer = useRef(null);
  const [claimUpi, setClaimUpi] = useState('');
  const [claimDate, setClaimDate] = useState('');
  const [claimTime, setClaimTime] = useState('');
  const [claimNotes, setClaimNotes] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimDName, setClaimDName] = useState('');
  const [claimDMobile, setClaimDMobile] = useState('');
  const [claimDCity, setClaimDCity] = useState('');
  const [claimDAddress, setClaimDAddress] = useState('');
  const [claimDPan, setClaimDPan] = useState('');
  const [claimDEmail, setClaimDEmail] = useState('');

  const load = async () => {
    try {
      const data = await getSuspenseReceipts();
      setMonth(data?.month || '');
      setReceipts(data?.receipts || []);
    } catch (err) {
      console.error('API error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getSuspenseReceipts();
        if (!cancelled) {
          setMonth(data?.month || '');
          setReceipts(data?.receipts || []);
        }
      } catch (err) { console.error('API error:', err.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  useRealtime('receipts', {
    event: '*',
    onInsert: () => load(),
    onUpdate: () => load(),
    onDelete: () => load(),
  });

  const openClaimModal = (r) => {
    setClaimReceipt(r);
    setClaimDonor(null);
    setClaimSearch('');
    setClaimResults([]);
    setClaimUpi('');
    setClaimDate('');
    setClaimTime('');
    setClaimNotes('');
    setClaimError('');
    setClaimSuccess(false);
    setClaimDName('');
    setClaimDMobile('');
    setClaimDCity('');
    setClaimDAddress('');
    setClaimDPan('');
    setClaimDEmail('');
    setShowClaimModal(true);
  };

  const searchClaimDonors = (q) => {
    setClaimSearch(q);
    clearTimeout(claimTimer.current);
    if ((q || '').trim().length < 2) { setClaimResults([]); setClaimSearching(false); return; }
    claimTimer.current = setTimeout(async () => {
      setClaimSearching(true);
      try {
        const [profileRes, receiptRes] = await Promise.all([
          searchDonorsByMobile(q.trim()).catch(() => []),
          searchSuspenseDonors(q.trim()).catch(() => []),
        ]);
        const profileList = Array.isArray(profileRes) ? profileRes : [];
        const receiptList = Array.isArray(receiptRes) ? receiptRes : [];
        const merged = [];
        const seenById = new Set();
        const seenByMobile = new Set();
        for (const d of profileList) {
          merged.push(d);
          if (d.donor_id) seenById.add(String(d.donor_id));
          const m = (d.donor_mobile || '').replace(/\D/g, '');
          if (m) seenByMobile.add(m);
        }
        for (const d of receiptList) {
          if (d.donor_id && seenById.has(String(d.donor_id))) continue;
          const m = (d.donor_mobile || '').replace(/\D/g, '');
          if (m && seenByMobile.has(m)) continue;
          merged.push(d);
          if (d.donor_id) seenById.add(String(d.donor_id));
          if (m) seenByMobile.add(m);
        }
        setClaimResults(merged);
      } catch (err) {
        setClaimResults([]);
      } finally {
        setClaimSearching(false);
      }
    }, 350);
  };

  const submitClaim = async () => {
    if (!claimReceipt) return;
    if (!claimDonor) { setClaimError('Select the donor to claim this receipt'); return; }
    setClaiming(true);
    setClaimError('');
    try {
      let txDatetime = null;
      if (claimDate) txDatetime = claimTime ? `${claimDate}T${claimTime}` : claimDate;
      await claimSuspenseReceipt(claimReceipt.id, {
        donor_id: claimDonor.donor_id,
        donor_name: claimDName.trim() || undefined,
        donor_mobile: claimDMobile.trim() || undefined,
        donor_city: claimDCity.trim() || undefined,
        donor_email: claimDEmail.trim() || undefined,
        donor_pan: claimDPan.trim() || undefined,
        donor_address: claimDAddress.trim() || undefined,
        upi_transaction_id: (claimUpi || '').trim() || undefined,
        transaction_datetime: txDatetime || undefined,
        notes: claimNotes.trim() || undefined,
      });
      setClaimSuccess(true);
      const data = await getSuspenseReceipts();
      setMonth(data?.month || '');
      setReceipts(data?.receipts || []);
      setTimeout(() => setShowClaimModal(false), 1200);
    } catch (err) {
      setClaimError(err.message);
    } finally {
      setClaiming(false);
    }
  };

  const ngos = [...new Set((receipts || []).map(r => r.project_id).filter(Boolean))];

  const list = useMemo(() => {
    let base = ngoFilter ? (receipts || []).filter(r => r.project_id === ngoFilter) : (receipts || []);
    const q = query.trim().toLowerCase();
    if (q) base = base.filter(r => (r.donor_name || '').toLowerCase().includes(q) || (r.donor_mobile || '').includes(q));
    return base;
  }, [receipts, ngoFilter, query]);

  const totalAmount = list.reduce((s, r) => s + Number(r.amount || 0), 0);

  if (loading) return <div style={{ padding: 18 }}><SkeletonTable rows={8} /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar: NGO pill tabs + search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 18px', flexShrink: 0 }}>
        <div style={{ display: 'inline-flex', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 999, padding: 3 }}>
          {[['', 'All']].concat(ngos.map(p => [p, NGO_SHORT[p] || p.toUpperCase()])).map(([v, l]) => {
            const count = v ? receipts.filter(r => r.project_id === v).length : receipts.length;
            const active = ngoFilter === v;
            return (
              <button key={v || 'all'} onClick={() => setNgoFilter(v)}
                style={{
                  padding: '6px 16px', borderRadius: 999, border: 'none', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: active ? 'var(--sage)' : 'transparent', color: active ? '#fff' : 'var(--ink-soft)',
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,.18)' : 'none', transition: 'all .15s',
                }}>
                {l}
                <span style={{
                  minWidth: 17, padding: '0 5px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                  background: active ? 'rgba(255,255,255,.22)' : 'var(--line)', color: active ? '#fff' : 'var(--ink-soft)',
                }}>{count}</span>
              </button>
            );
          })}
        </div>

        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-soft)' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name or mobile…"
            style={{
              padding: '7px 12px 7px 30px', border: '1px solid var(--line)', borderRadius: 999, background: 'var(--card-bg)',
              fontSize: 12, fontFamily: 'inherit', outline: 'none', width: isMobile ? '100%' : 210, color: 'var(--ink)',
            }}
          />
        </div>
      </div>

      {/* Month strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 18px 8px', flexShrink: 0, fontSize: 11, color: 'var(--ink-soft)' }}>
        <span>Unlinked donations received in <b style={{ color: 'var(--ink)' }}>{month}</b> waiting for an owner. Claim one to get credit after accounts verification.</span>
        <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{currency(totalAmount)} · {list.length}</span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 18px 18px' }}>
        {list.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 220, gap: 10, color: 'var(--ink-soft)' }}>
            <span style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Inbox size={24} />
            </span>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{query ? 'No matching receipts' : 'No suspense receipts'}{ngoFilter ? ' for this NGO' : ''}</div>
            <div style={{ fontSize: 11 }}>{query ? 'Try a different name or mobile number.' : 'New suspense receipts will appear here.'}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(r => {
              const badge = r.waiting_receipt_no ? { text: 'Waiting for receipt number', color: '#6b7280', bg: '#f3f4f6' } : r.kind === 'receipt_sent' ? CLAIM_BADGES.receipt_sent : r.my_claim_status ? CLAIM_BADGES[r.my_claim_status] : r.kind === 'no_receipt' ? { text: 'Unclaimed', color: '#b45309', bg: '#fef3c7' } : null;
              const claimable = !r.waiting_receipt_no && (!r.my_claim_status || r.kind === 'receipt_sent');
              return (
                <div key={r.id} onClick={() => claimable && openClaimModal(r)}
                  onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--sage)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.boxShadow = 'var(--shadow)'; e.currentTarget.style.transform = 'none'; }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                    background: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
                    boxShadow: 'var(--shadow)', cursor: claimable ? 'pointer' : 'default', transition: 'transform .12s, box-shadow .12s, border-color .12s',
                  }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#B5603A1A', color: '#B5603A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                    {initials(r.donor_name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.donor_name || 'Unknown donor'}</span>
                      {badge && (
                        <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: badge.bg, color: badge.color }}>
                          {badge.text}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span>{r.receipt_date || '\u2014'}{r.receipt_time ? ` · ${fmtTime12(r.receipt_time)}` : ''}</span>
                      {r.payment_id ? (
                        <>
                          <span style={{ color: 'var(--line)' }}>•</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-soft)' }}>UPI: <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{r.payment_id}</span></span>
                        </>
                      ) : null}
                      <span style={{
                        padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                        background: (NGO_PILL[r.project_id] || { bg: '#f3f4f6', color: '#6b7280' }).bg,
                        color: (NGO_PILL[r.project_id] || { bg: '#f3f4f6', color: '#6b7280' }).color,
                      }}>{NGO_SHORT[r.project_id] || NGO_LABELS[r.project_id] || r.project_id}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{currency(r.amount)}</div>
                    {claimable && (
                      <button
                        onClick={e => { e.stopPropagation(); openClaimModal(r); }}
                        className="btn btn-sm"
                        style={{ fontSize: 11, padding: '3px 12px', background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', marginTop: 4 }}>
                        Claim
                      </button>
                    )}
                    {r.claim_count > 1 && !claimable && (
                      <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 3 }}>{r.claim_count} claims</div>
                    )}
                  </div>
                  {claimable && <ChevronRight size={16} style={{ color: 'var(--ink-soft)', flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showClaimModal && claimReceipt && (
        <div onClick={() => { if (!claiming && !claimSuccess) setShowClaimModal(false) }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(4px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: isMobile ? 'calc(100vw - 32px)' : 480, maxWidth: '100%', maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.2)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--line)', background: 'linear-gradient(135deg, #f8fafc 0%, #fff 100%)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18 }}>
                  <Inbox size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Claim Suspense Receipt</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Link this receipt to a donor for verification</div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              {claimSuccess ? (
                <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#166534', marginBottom: 6 }}>Claim Submitted Successfully</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>This receipt is now pending in Lead Verification</div>
                </div>
              ) : (
                <>
                  {/* Receipt Summary */}
                  <div style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', borderRadius: 12, padding: '16px 18px', marginBottom: 20, border: '1px solid #fbbf24' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Receipt Details</div>
                      <div style={{ fontSize: 10, color: '#92400e', opacity: 0.7 }}>{NGO_SHORT[claimReceipt.project_id] || claimReceipt.project_id}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#78350f', marginBottom: 4 }}>{claimReceipt.donor_name || 'Unknown donor'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#92400e' }}>
                      <span>{claimReceipt.receipt_date || '—'}</span>
                      {claimReceipt.receipt_time && <span>· {fmtTime12(claimReceipt.receipt_time)}</span>}
                      <span style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 800, color: '#78350f' }}>{currency(claimReceipt.amount)}</span>
                    </div>
                  </div>

                  {/* Donor Selection */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Select Donor</div>
                    {claimDonor ? (
                      <div style={{ background: '#f0fdf4', border: '2px solid var(--sage)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>
                            {initials(claimDonor.donor_name)}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{claimDonor.donor_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>
                              {claimDonor.donor_mobile || '—'}
                              {claimDonor.donor_city && <span> · {claimDonor.donor_city}</span>}
                            </div>
                          </div>
                        </div>
                        <button onClick={() => { setClaimDonor(null); setClaimSearch(''); setClaimResults([]); setClaimDName(''); setClaimDMobile(''); setClaimDCity(''); setClaimDAddress(''); setClaimDPan(''); setClaimDEmail('') }}
                          style={{ border: 'none', background: 'rgba(0,0,0,.05)', width: 28, height: 28, borderRadius: '50%', fontSize: 18, cursor: 'pointer', color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                      </div>
                    ) : (
                      <>
                        <div style={{ position: 'relative', marginBottom: 8 }}>
                          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-soft)' }} />
                          <input
                            value={claimSearch}
                            onChange={e => searchClaimDonors(e.target.value)}
                            placeholder="Search by donor name or mobile number..."
                            style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', transition: 'border-color .15s' }}
                            onFocus={e => e.target.style.borderColor = 'var(--sage)'}
                            onBlur={e => e.target.style.borderColor = 'var(--line)'}
                          />
                        </div>
                        {claimSearching && (
                          <div style={{ fontSize: 11, color: 'var(--ink-soft)', textAlign: 'center', padding: '12px 0' }}>
                            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--line)', borderTopColor: 'var(--sage)', borderRadius: '50%', animation: 'spin 0.6s linear infinite', marginRight: 6 }} />
                            Searching donors...
                          </div>
                        )}
                        {!claimSearching && claimResults.length > 0 && (
                          <div style={{ border: '1px solid var(--line)', borderRadius: 10, maxHeight: 180, overflowY: 'auto', background: 'var(--card-bg)' }}>
                            {claimResults.map((d, i) => (
                              <div key={d.donor_id} onClick={() => { setClaimDonor(d); setClaimResults([]); setClaimDName(d.donor_name || ''); setClaimDMobile(d.donor_mobile || ''); setClaimDCity(d.donor_city || ''); setClaimDAddress(d.donor_address || ''); setClaimDPan(d.donor_pan || ''); setClaimDEmail(d.donor_email || '') }}
                                style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: i < claimResults.length - 1 ? '1px solid var(--line)' : 'none', display: 'flex', alignItems: 'center', gap: 10, transition: 'background .1s' }}
                                onMouseOver={e => e.currentTarget.style.background = 'var(--bg)'}
                                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                                  {initials(d.donor_name)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{d.donor_name}</div>
                                  <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 1 }}>{d.donor_mobile || ''}{d.donor_city ? ` · ${d.donor_city}` : ''}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {!claimSearching && claimSearch.trim().length >= 2 && claimResults.length === 0 && (
                          <div style={{ padding: '16px', border: '1.5px dashed var(--line)', borderRadius: 10, textAlign: 'center', fontSize: 11, color: 'var(--ink-soft)', background: 'var(--bg)' }}>
                            <div style={{ fontSize: 20, marginBottom: 4 }}>🔍</div>
                            No donor found for "{claimSearch}"
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Donor Details — editable, prefilled from the selected donor,
                      written onto the Accounts audit entry with the claim */}
                  {claimDonor && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                        Donor Details
                        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 'normal', marginLeft: 6, color: 'var(--ink-soft)' }}>— editable, shown on the Accounts audit entry</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <input value={claimDName} onChange={e => setClaimDName(e.target.value)} placeholder="Full name" style={{ ...fieldStyle, flex: 1.4 }} />
                          <input value={claimDMobile} onChange={e => setClaimDMobile(e.target.value)} placeholder="Mobile number" style={{ ...fieldStyle, flex: 1 }} />
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <input value={claimDPan} onChange={e => setClaimDPan(e.target.value)} placeholder="PAN (ABCDE1234F)" style={fieldStyle} />
                        </div>
                        <input value={claimDAddress} onChange={e => setClaimDAddress(e.target.value)} placeholder="Address" style={fieldStyle} />
                        <input value={claimDEmail} onChange={e => setClaimDEmail(e.target.value)} placeholder="Email" style={fieldStyle} />
                      </div>
                    </div>
                  )}

                  {/* Optional Details */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Optional Details</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <input
                        value={claimUpi}
                        onChange={e => setClaimUpi(e.target.value)}
                        placeholder="UPI Transaction ID (e.g., UPI123456789)"
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', transition: 'border-color .15s' }}
                        onFocus={e => e.target.style.borderColor = 'var(--sage)'}
                        onBlur={e => e.target.style.borderColor = 'var(--line)'}
                      />
                      <div style={{ display: 'flex', gap: 10 }}>
                        <input type="date" value={claimDate} onChange={e => setClaimDate(e.target.value)}
                          style={{ flex: 1, padding: '10px 12px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', transition: 'border-color .15s' }}
                          onFocus={e => e.target.style.borderColor = 'var(--sage)'}
                          onBlur={e => e.target.style.borderColor = 'var(--line)'} />
                        <input type="time" value={claimTime} onChange={e => setClaimTime(e.target.value)}
                          style={{ flex: 1, padding: '10px 12px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', transition: 'border-color .15s' }}
                          onFocus={e => e.target.style.borderColor = 'var(--sage)'}
                          onBlur={e => e.target.style.borderColor = 'var(--line)'} />
                      </div>
                      <textarea value={claimNotes} onChange={e => setClaimNotes(e.target.value)} rows={2}
                        placeholder="Note for accounts (how do you know this donor?)"
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--line)', borderRadius: 10, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', outline: 'none', transition: 'border-color .15s', minHeight: 60 }}
                        onFocus={e => e.target.style.borderColor = 'var(--sage)'}
                        onBlur={e => e.target.style.borderColor = 'var(--line)'} />
                    </div>
                  </div>

                  {claimError && (
                    <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#b91c1c', marginBottom: 16 }}>
                      {claimError}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            {!claimSuccess && (
              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)', background: 'var(--bg)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowClaimModal(false)} disabled={claiming}
                  style={{ padding: '10px 20px', border: '1.5px solid var(--line)', borderRadius: 10, background: '#fff', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', transition: 'all .15s' }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                  Cancel
                </button>
                <button onClick={submitClaim} disabled={claiming || !claimDonor}
                  style={{ padding: '10px 24px', border: 'none', borderRadius: 10, background: 'var(--sage)', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 2px 8px rgba(91,107,78,.3)', transition: 'all .15s', opacity: (claiming || !claimDonor) ? .5 : 1 }}
                  onMouseOver={e => { if (!claiming && claimDonor) e.currentTarget.style.transform = 'translateY(-1px)' }}
                  onMouseOut={e => e.currentTarget.style.transform = 'none'}>
                  {claiming ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                      Claiming...
                    </span>
                  ) : 'Submit Claim'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

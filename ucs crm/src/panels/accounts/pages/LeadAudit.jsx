import { useState, useEffect, useRef } from 'react';
import { Link2, Loader2, X } from 'lucide-react';
import { apiGet, apiPost } from '../api/auth';
import { toast } from '../../../components/Toast';
import Dashboard from './Dashboard';
import BankAudit from './BankAudit';
import MatchLines from '../components/MatchLines';

function SectionTitle({ children }) {
  return <div className="lead-audit-section-title"><span>{children}</span></div>;
}

const currency = n => n != null ? '\u20B9' + Number(n).toLocaleString('en-IN') : '';

const NGO_LABELS = { bsct: 'Being Sevak', mann: 'Mann Care', aflf: 'Ashray' };
const NGO_RECEIPT = {
  bsct: { bg: '#d4e4ff', accent: '#1e40af' },
  mann: { bg: '#ecc9df', accent: '#be185d' },
  aflf: { bg: '#c8ecd4', accent: '#166534' },
};

export default function LeadAudit() {
  const [audit, setAudit] = useState({ sources: [], summary: {}, combo: null, loading: true });
  const [globalNgo, setGlobalNgo] = useState('');
  const [amountFilter, setAmountFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [suspenseCardNgo, setSuspenseCardNgo] = useState('');
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [detailView, setDetailView] = useState(null);
  const [entryDetailView, setEntryDetailView] = useState(null);
  const [matching, setMatching] = useState(false);
  const [receiptNums, setReceiptNums] = useState(null);
  const [collections, setCollections] = useState(null);
  const [alertBusy, setAlertBusy] = useState(false);
  const workspaceRef = useRef(null);

  // Last issued + next upcoming receipt number per NGO. Read-only; refetched
  // whenever the bank-audit data changes (e.g. after a new receipt is created).
  useEffect(() => {
    let cancelled = false;
    apiGet('/accounts/receipts/numbers')
      .then(d => { if (!cancelled) setReceiptNums(d || []); })
      .catch(() => { if (!cancelled) setReceiptNums([]); });
    return () => { cancelled = true; };
  }, [audit]);

  // Today + month collection totals per NGO (right-hand "NGO Collections" cards).
  useEffect(() => {
    let cancelled = false;
    apiGet('/accounts/collections')
      .then(d => { if (!cancelled) setCollections(d || []); })
      .catch(() => { if (!cancelled) setCollections([]); });
    return () => { cancelled = true; };
  }, [audit]);

  const handleMatch = async () => {
    if (!selectedLead || !selectedEntry || matching) return;
    setMatching(true);
    try {
      const res = await apiPost('/accounts/bank-audit/entries/' + selectedEntry.id + '/manual-match', { log_id: selectedLead.log_id });
      setSelectedLead(null);
      setSelectedEntry(null);
      alert(res?.match_no ? `Matched manually \u00B7 ${res.match_no}` : 'Matched manually');
    } catch (err) {
      alert(err.message);
    } finally {
      setMatching(false);
    }
  };

  const chip = (selected, onClear, main, sub, hint) => selected ? (
    <div className="match-chip" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: '#f0f7ef', border: '1px solid #cfe3cb', fontSize: 12 }}>
      <span style={{ fontWeight: 600, color: 'var(--sage)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{main}</span>
      <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{sub}</span>
      <button onClick={onClear} title="Clear" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af', display: 'flex', padding: 0, flexShrink: 0 }}><X size={14} strokeWidth={2.5} /></button>
    </div>
  ) : (
    <div className="match-hint" style={{ fontSize: 12, color: '#9ca3af', padding: '0 4px', whiteSpace: 'nowrap' }}>{hint}</div>
  );

  const ready = !!(selectedLead && selectedEntry && !matching);

  const isPanelOpen = !!(detailView || entryDetailView);

  const filterBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>NGO</span>
      <select value={globalNgo} onChange={e => setGlobalNgo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '1px solid #d1d5db', fontWeight: 600, background: '#fff' }}>
        <option value="">All NGOs</option>
        <option value="bsct">Being Sevak</option>
        <option value="mann">Mann Care</option>
        <option value="aflf">Ashray</option>
      </select>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Date</span>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} aria-label="Filter by date" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '1px solid #d1d5db', fontWeight: 600 }} />
        {dateFilter && <button onClick={() => setDateFilter('')} title="Clear date" aria-label="Clear date" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af', display: 'inline-flex', alignItems: 'center', padding: 0, flexShrink: 0 }}><X size={14} strokeWidth={2.5} /></button>}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Amount</span>
      <input type="number" min="0" step="any" placeholder="All amounts" value={amountFilter} onChange={e => setAmountFilter(e.target.value)} aria-label="Filter by amount" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '1px solid #d1d5db', fontWeight: 600, width: 96 }} />
    </div>
  );

  const handleAlertAll = async () => {
    if (alertBusy) return;
    setAlertBusy(true);
    try {
      const res = await apiPost('/notifications/suspense-alert', {});
      toast('Alert sent to ' + (res?.count || 0) + ' FROs', 'success');
    } catch { toast('Failed to send alert', 'error'); }
    setTimeout(() => setAlertBusy(false), 10000);
  };

  const collectionKeys = ['bsct', 'aflf', 'mann'];

  const colTotal = (field) => collections === null
    ? null
    : collectionKeys.reduce((s, k) => s + Number(collections.find(x => x.project_id === k)?.[field] || 0), 0);

  const summaryLoading = audit.loading || !audit.combo;

  const collectionRows = (
    <>
      {collectionKeys.map(key => {
        const c = NGO_RECEIPT[key] || { bg: '#f1f5f9', accent: '#475569' };
        const d = collections?.find(x => x.project_id === key);
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid ' + c.accent + '44', borderRadius: 12, background: c.bg, padding: '9px 12px', minHeight: 46 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: c.accent, flex: 1, marginRight: 8, whiteSpace: 'nowrap' }}>{key.toUpperCase()}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
              <div style={{ textAlign: 'center', minWidth: 64 }}>
                <div style={{ color: c.accent, opacity: .6, fontSize: 8.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase' }}>Today</div>
                <div style={{ color: '#111827', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, whiteSpace: 'nowrap' }}>{collections === null ? <span className="sk" style={{ display: 'inline-block', width: 40, height: 11, borderRadius: 6 }} /> : currency(d?.today_total || 0)}</div>
              </div>
              <div style={{ textAlign: 'center', minWidth: 80 }}>
                <div style={{ color: c.accent, opacity: .6, fontSize: 8.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase' }}>Month</div>
                <div style={{ color: c.accent, fontVariantNumeric: 'tabular-nums', fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap' }}>{collections === null ? <span className="sk" style={{ display: 'inline-block', width: 56, height: 11, borderRadius: 6 }} /> : currency(d?.month_total || 0)}</div>
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e7ecf3', borderRadius: 12, background: '#fff', padding: '9px 12px', minHeight: 46 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#374151', flex: 1, marginRight: 8, whiteSpace: 'nowrap' }}>TOTAL</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
          <div style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ color: '#8a93a3', fontSize: 8.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase' }}>Today</div>
            <div style={{ color: '#111827', fontVariantNumeric: 'tabular-nums', fontSize: 13, whiteSpace: 'nowrap' }}>{colTotal('today_total') === null ? <span className="sk" style={{ display: 'inline-block', width: 40, height: 11, borderRadius: 6 }} /> : currency(colTotal('today_total') || 0)}</div>
          </div>
          <div style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{ color: '#8a93a3', fontSize: 8.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase' }}>Month</div>
            <div style={{ color: '#111827', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{colTotal('month_total') === null ? <span className="sk" style={{ display: 'inline-block', width: 56, height: 11, borderRadius: 6 }} /> : currency(colTotal('month_total') || 0)}</div>
          </div>
        </div>
      </div>
    </>
  );

  const suspenseRows = (
    <>
      {collectionKeys.map(key => {
        const c = NGO_RECEIPT[key] || { bg: '#f1f5f9', accent: '#475569' };
        const active = suspenseCardNgo === key;
        const count = audit.combo?.[key]?.count;
        return (
          <button key={key} onClick={() => setSuspenseCardNgo(active ? '' : key)} title={'Filter suspense to ' + key.toUpperCase()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', border: active ? '2px solid ' + c.accent : '1px solid ' + c.accent + '44', borderRadius: 12, background: c.bg, padding: '9px 12px', minHeight: 46, boxShadow: active ? '0 4px 14px ' + c.accent + '30' : 'none' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: c.accent, whiteSpace: 'nowrap' }}>{key.toUpperCase()}{count ? <span style={{ fontWeight: 700, opacity: .65, marginLeft: 6, fontSize: 10.5 }}>{count}</span> : null}</span>
            <span style={{ color: '#111827', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{summaryLoading ? <span className="sk" style={{ display: 'inline-block', width: 64, height: 11, borderRadius: 6 }} /> : currency(audit.combo?.[key]?.amount || 0)}</span>
          </button>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e7ecf3', borderRadius: 12, background: '#fff', padding: '9px 12px', minHeight: 46 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#374151', whiteSpace: 'nowrap' }}>TOTAL</span>
        <span style={{ color: '#111827', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{summaryLoading ? <span className="sk" style={{ display: 'inline-block', width: 64, height: 11, borderRadius: 6 }} /> : currency(audit.combo?.all?.amount || 0)}</span>
      </div>
    </>
  );

return (
    <>
      <div className="top-summary-grid">
        <div className="top-summary-card">
          <SectionTitle>Collection</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{collectionRows}</div>
        </div>
        <div className="top-summary-card">
          <SectionTitle>Receipt Numbers</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {receiptNums === null ? (
              [0, 1, 2].map(i => (
                <div key={i} style={{ border: '1px solid #e7ecf3', borderRadius: 14, background: '#fff', boxShadow: '0 6px 24px rgba(30,41,59,.06)', padding: '12px 12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: '4px 16px' }}>
                    <span className="sk" style={{ width: '70%', height: 11, borderRadius: 6 }} />
                    <span className="sk" style={{ width: 34, height: 11, borderRadius: 6 }} />
                    <span className="sk" style={{ width: 30, height: 11, borderRadius: 6 }} />
                    <span className="sk" style={{ width: 52, height: 13, borderRadius: 6 }} />
                    <span className="sk" style={{ width: 40, height: 13, borderRadius: 6 }} />
                    <span className="sk" style={{ width: 40, height: 13, borderRadius: 6 }} />
                  </div>
                </div>
              ))
            ) : receiptNums && receiptNums.length > 0 ? (
              receiptNums.map(n => {
                const c = NGO_RECEIPT[n.project_id] || { bg: '#f1f5f9', accent: '#475569' };
                return (
                  <div key={n.project_id} style={{ border: '1px solid ' + c.accent + '44', borderRadius: 14, background: c.bg, boxShadow: '0 6px 24px rgba(30,41,59,.06)', padding: '12px 12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: '4px 16px' }}>
                      <span></span>
                      <span style={{ color: c.accent, opacity: .6, fontSize: 8.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', textAlign: 'right' }}>Current</span>
                      <span style={{ color: c.accent, opacity: .6, fontSize: 8.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', textAlign: 'right' }}>Next</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.accent, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{NGO_LABELS[n.project_id] || n.project_id}</span>
                      <span style={{ color: '#111827', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{n.last_no || '\u2014'}</span>
                      <span style={{ color: c.accent, fontVariantNumeric: 'tabular-nums', fontSize: 12.5, fontWeight: 800, textAlign: 'right' }}>{n.next_no || '\u2014'}</span>
                    </div>
                  </div>
                );
              })
            ) : null}
          </div>
        </div>
        <div className="top-summary-card">
          <SectionTitle>Suspense</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{suspenseRows}</div>
        </div>
      </div>

      <div className="dash-actions">
        <div className="dash-actions-filters">{filterBar}</div>
        <button className="dash-action-btn" onClick={() => {}} title="Work">WORK</button>
        <button className="dash-action-btn dash-action-alert" onClick={handleAlertAll} disabled={alertBusy} title="Alert all FROs">{alertBusy ? 'SENT ✓' : '🔔 ALERT'}</button>
      </div>

      <div ref={workspaceRef} className="lead-audit-workspace" style={{ position: 'relative', marginRight: isPanelOpen ? 640 : 0, width: isPanelOpen ? 'calc(100% - 640px)' : '100%', transition: 'width .25s ease, margin-right .25s ease' }}>
        <div className="two-col lead-audit-columns" style={{ alignItems: 'flex-start' }}>
          <div style={{ alignSelf: 'flex-start' }}>
            <SectionTitle>Lead Verification</SectionTitle>
            <Dashboard embedded selectedLogId={selectedLead?.log_id} onSelectLead={l => { setSelectedLead(l); setSelectedEntry(null); }} onView={setDetailView} globalNgo={globalNgo} amountFilter={amountFilter} dateFilter={dateFilter} />
          </div>
          <div>
            <SectionTitle>Bank Audit</SectionTitle>
            <BankAudit embedded onSummary={setAudit} selectedEntryId={selectedEntry?.id} onSelectEntry={setSelectedEntry} selectionEnabled={!!selectedLead} onView={setEntryDetailView} globalNgo={globalNgo} suspenseNgo={suspenseCardNgo} amountFilter={amountFilter} dateFilter={dateFilter} leadFilter={selectedLead ? { log_id: selectedLead.log_id, amount: selectedLead.amount, ngo: selectedLead.donor_project || '' } : null} />
          </div>
        </div>

        <MatchLines containerRef={workspaceRef}
          previewLogId={!detailView && !entryDetailView && selectedLead && selectedEntry ? String(selectedLead.log_id) : ''}
          previewEntryId={!detailView && !entryDetailView && selectedLead && selectedEntry ? String(selectedEntry.id) : ''}
        />

        {(selectedLead || selectedEntry) && (
          <div className="match-bar">
            {chip(selectedLead, () => { setSelectedLead(null); setSelectedEntry(null); }, selectedLead?.donor_name || 'Lead', currency(selectedLead?.amount), 'Double-click a lead to select · single-click to clear')}
            <span style={{ color: '#d1d5db', fontSize: 16, flexShrink: 0 }}>+</span>
            {chip(selectedEntry, () => setSelectedEntry(null), selectedEntry?.payment_id || selectedEntry?.check_id || 'No ref', currency(selectedEntry?.amount), 'Double-click a bank entry to select · single-click to open')}
            <button onClick={handleMatch} disabled={!ready}
              title={!selectedLead ? 'Select a lead first' : !selectedEntry ? 'Select a bank audit entry first' : 'Link entry to lead as manual match'}
              style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, borderRadius: 10, border: 'none', cursor: ready ? 'pointer' : 'not-allowed', background: ready ? 'var(--sage)' : '#d1d5db', color: ready ? '#fff' : '#9ca3af', opacity: matching ? .7 : 1, flexShrink: 0 }}>
              {matching ? <Loader2 size={17} style={{ animation: 'fb-spin 1s linear infinite' }} /> : <Link2 size={17} strokeWidth={2.5} />}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

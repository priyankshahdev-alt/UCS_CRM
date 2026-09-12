import { useState, useEffect, useRef } from 'react';
import { Link2, Loader2, X } from 'lucide-react';
import { apiGet, apiPost } from '../api/auth';
import { toast } from '../../../components/Toast';
import Dashboard from './Dashboard';
import BankAudit, { AuditStatCards } from './BankAudit';
import MatchLines from '../components/MatchLines';

function SectionTitle({ children }) {
  return <div className="lead-audit-section-title"><span>{children}</span></div>;
}

const currency = n => n != null ? '\u20B9' + Number(n).toLocaleString('en-IN') : '';
const formatTeamName = name => String(name || '').replace(/^UFS\s*(\d+)$/i, 'UFS $1');

const NGO_COLLECTION = {
  bsct: { label: 'BSCT', bg: '#d4e4ff', accent: '#1e40af' },
  aflf: { label: 'AFLF', bg: '#c8ecd4', accent: '#166534' },
  mann: { label: 'MANN', bg: '#ecc9df', accent: '#be185d' },
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
  const [alertBusy, setAlertBusy] = useState(false);
  const [froActionBusy, setFroActionBusy] = useState('');
  const [froModalOpen, setFroModalOpen] = useState(false);
  const [froWorkers, setFroWorkers] = useState([]);
  const [froWorkersLoading, setFroWorkersLoading] = useState(false);
  const [froSelectedId, setFroSelectedId] = useState('');
  const [froText, setFroText] = useState('');
  const [froSending, setFroSending] = useState(false);
  const [entertainModalOpen, setEntertainModalOpen] = useState(false);
  const [entertainAudios, setEntertainAudios] = useState([]);
  const [entertainAudioId, setEntertainAudioId] = useState('');
  const [entertainLoading, setEntertainLoading] = useState(false);
  const [entertainUploading, setEntertainUploading] = useState(false);
  const [entertainSending, setEntertainSending] = useState(false);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [teamSending, setTeamSending] = useState(false);
  const [collections, setCollections] = useState(null);
  const workspaceRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    apiGet('/accounts/collections')
      .then(d => { if (!cancelled) setCollections(Array.isArray(d) ? d : []); })
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
  const handleAlertAll = async () => {
    if (alertBusy) return;
    setAlertBusy(true);
    try {
      const res = await apiPost('/notifications/suspense-alert', {});
      toast('Alert sent to ' + (res?.count || 0) + ' FROs', 'success');
    } catch {
      toast('Failed to send alert', 'error');
    } finally {
      setTimeout(() => setAlertBusy(false), 10000);
    }
  };
  const openEntertainModal = async () => {
    setEntertainModalOpen(true);
    setEntertainAudioId('');
    setEntertainLoading(true);
    try {
      const res = await apiGet('/notifications/entertain-audios');
      const list = Array.isArray(res?.audios) ? res.audios : [];
      setEntertainAudios(list);
      if (list[0]) setEntertainAudioId(list[0].id);
    } catch (err) {
      toast(err.message || 'Failed to load entertainment audios', 'error');
    } finally {
      setEntertainLoading(false);
    }
  };
  const uploadEntertainAudio = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) { toast('Select an audio file', 'error'); return; }
    if (file.size > 7 * 1024 * 1024) { toast('Audio must be smaller than 7 MB', 'error'); return; }
    setEntertainUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await apiPost('/notifications/entertain-audios', { name: file.name, mime_type: file.type, file_base64: base64 });
      const audio = res?.audio;
      if (audio) {
        setEntertainAudios(prev => [...prev, audio]);
        setEntertainAudioId(audio.id);
      }
      toast('Audio uploaded', 'success');
    } catch (err) {
      toast(err.message || 'Failed to upload audio', 'error');
    } finally {
      setEntertainUploading(false);
    }
  };
  const sendEntertainment = async () => {
    if (entertainSending) return;
    if (!entertainAudioId) { toast('Upload or select an audio first', 'error'); return; }
    setEntertainSending(true);
    try {
      const res = await apiPost('/notifications/fro-action', { action: 'entertain', audio_id: entertainAudioId });
      toast(`Entertain audio sent to ${res?.count || 0} FROs`, 'success');
      setEntertainModalOpen(false);
    } catch (err) {
      toast(err.message || 'Failed to send entertainment audio', 'error');
    } finally {
      setEntertainSending(false);
    }
  };
  const handleFroAction = async (action) => {
    if (froActionBusy) return;
    setFroActionBusy(action);
    try {
      const res = await apiPost('/notifications/fro-action', { action });
      toast(`${({ follow_up: 'Follow-up', less_calls: 'Less calls', entertain: 'Entertain' }[action] || action)} sent to ${res?.count || 0} FROs`, 'success');
    } catch (err) {
      toast(err.message || 'Failed to send FRO action', 'error');
    } finally {
      setFroActionBusy('');
    }
  };
  const openFroModal = async () => {
    setFroModalOpen(true);
    setFroText('');
    setFroSelectedId('');
    if (froWorkers.length) return;
    setFroWorkersLoading(true);
    try {
      const workers = await apiGet('/workers?status=active');
      const fro = (Array.isArray(workers) ? workers : [])
        .filter(w => String(w.department || '').toLowerCase().trim() === 'fro' && w.is_active !== false)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      setFroWorkers(fro);
    } catch {
      toast('Failed to load FROs', 'error');
    } finally {
      setFroWorkersLoading(false);
    }
  };
  const selectedFro = froWorkers.find(w => String(w.id) === String(froSelectedId)) || null;
  const sendFroBroadcast = async () => {
    if (froSending) return;
    if (!selectedFro) { toast('Select an FRO', 'error'); return; }
    if (!froText.trim()) { toast('Enter a message', 'error'); return; }
    setFroSending(true);
    try {
      const res = await apiPost('/notifications/fro-broadcast', { worker_id: selectedFro.id, text: froText });
      toast(`Announcement sent to ${res?.count || 0} FROs`, 'success');
      setFroModalOpen(false);
    } catch (err) {
      toast(err.message || 'Failed to send announcement', 'error');
    } finally {
      setFroSending(false);
    }
  };
  const toggleTeam = (name) => {
    setSelectedTeams(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]);
  };
  const openTeamModal = async () => {
    setTeamModalOpen(true);
    setSelectedTeams([]);
    if (teams.length) return;
    setTeamsLoading(true);
    try {
      const res = await apiGet('/teams');
      setTeams(Array.isArray(res?.teams) ? res.teams : []);
    } catch {
      toast('Failed to load teams', 'error');
    } finally {
      setTeamsLoading(false);
    }
  };
  const sendTeamCongrats = async () => {
    if (teamSending) return;
    if (!selectedTeams.length) { toast('Select at least one team', 'error'); return; }
    setTeamSending(true);
    try {
      const res = await apiPost('/notifications/fro-team-broadcast', { teams: selectedTeams });
      toast(`🎉 Congratulations sent to ${res?.count || 0} FROs for ${selectedTeams.map(formatTeamName).join(', ')}`, 'success');
      setTeamModalOpen(false);
    } catch (err) {
      toast(err.message || 'Failed to send congratulations', 'error');
    } finally {
      setTeamSending(false);
    }
  };
  const collectionKeys = ['bsct', 'aflf', 'mann'];
  const collectionTotal = field => collections === null ? null : collectionKeys.reduce((sum, key) => sum + Number(collections.find(x => x.project_id === key)?.[field] || 0), 0);

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

  return (
    <>
      <div style={{ display: 'flex', gap: 14, marginBottom: 18, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div style={{ width: 'min(360px, 100%)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, padding: 14, border: '1px solid #e7ecf3', borderRadius: 16, background: 'transparent', boxShadow: 'none' }}>
          <SectionTitle>Collections</SectionTitle>
          {collectionKeys.map(key => {
            const c = NGO_COLLECTION[key];
            const item = collections?.find(x => x.project_id === key);
            return <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 10px', border: '1px solid ' + c.accent + '44', borderRadius: 11, background: c.bg }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: c.accent, letterSpacing: '.05em' }}>{c.label}</span>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ textAlign: 'right' }}><small style={{ display: 'block', color: c.accent, opacity: .7, fontSize: 8, fontWeight: 700, textTransform: 'uppercase' }}>Today</small><strong style={{ fontSize: 12, color: '#111827' }}>{collections === null ? '...' : currency(item?.today_total || 0)}</strong></div>
                <div style={{ textAlign: 'right' }}><small style={{ display: 'block', color: c.accent, opacity: .7, fontSize: 8, fontWeight: 700, textTransform: 'uppercase' }}>Month</small><strong style={{ fontSize: 12, color: c.accent }}>{collections === null ? '...' : currency(item?.month_total || 0)}</strong></div>
              </div>
            </div>;
          })}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, padding: '10px', borderRadius: 11, background: '#f8fafc', border: '1px solid #eef2f7' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '.06em' }}>Total Collection</span>
            <div style={{ display: 'flex', gap: 14, textAlign: 'right' }}>
              <span><small style={{ display: 'block', color: '#8a93a3', fontSize: 8, fontWeight: 700, textTransform: 'uppercase' }}>Today</small><strong style={{ fontSize: 12, color: '#111827' }}>{collections === null ? '...' : currency(collectionTotal('today_total') || 0)}</strong></span>
              <span><small style={{ display: 'block', color: '#8a93a3', fontSize: 8, fontWeight: 700, textTransform: 'uppercase' }}>Month</small><strong style={{ fontSize: 15, color: '#111827' }}>{collections === null ? '...' : currency(collectionTotal('month_total') || 0)}</strong></span>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, border: '1px solid #e7ecf3', borderRadius: 16, background: '#fff', boxShadow: '0 6px 24px rgba(30,41,59,.06)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 18 }}>
            <AuditStatCards sources={audit.sources} summary={audit.summary} loading={audit.loading} suspenseNgo={suspenseCardNgo} setSuspenseNgo={setSuspenseCardNgo} combo={audit.combo} bare />
          </div>
          <div className="lead-audit-action-row">
            <button className="lead-audit-action-btn lead-audit-action-alert" onClick={handleAlertAll} disabled={alertBusy}>{alertBusy ? 'SENT' : 'SUSPENSE'}</button>
            <button className="lead-audit-action-btn" onClick={() => handleFroAction('follow_up')} disabled={!!froActionBusy}>{froActionBusy === 'follow_up' ? 'SENDING' : 'FOLLOW UP'}</button>
            <button className="lead-audit-action-btn" onClick={() => handleFroAction('less_calls')} disabled={!!froActionBusy}>{froActionBusy === 'less_calls' ? 'SENDING' : 'LESS CALLS'}</button>
            <button className="lead-audit-action-btn" onClick={openEntertainModal} disabled={!!froActionBusy}>ENTERTAIN</button>
            <button className="lead-audit-action-btn" onClick={openFroModal}>FRO</button>
            <button className="lead-audit-action-btn" onClick={openTeamModal}>TEAM</button>
          </div>
          <div style={{ height: 1, background: '#eef1f6' }} />
          <div style={{ padding: '12px 18px' }}>{filterBar}</div>
        </div>
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

        <MatchLines containerRef={workspaceRef} previewLogId={!detailView && !entryDetailView && selectedLead && selectedEntry ? String(selectedLead.log_id) : ''} previewEntryId={!detailView && !entryDetailView && selectedLead && selectedEntry ? String(selectedEntry.id) : ''} />

        {(selectedLead || selectedEntry) && (
          <div className="match-bar">
            {chip(selectedLead, () => { setSelectedLead(null); setSelectedEntry(null); }, selectedLead?.donor_name || 'Lead', currency(selectedLead?.amount), 'Double-click a lead to select · single-click to clear')}
            <span style={{ color: '#d1d5db', fontSize: 16, flexShrink: 0 }}>+</span>
            {chip(selectedEntry, () => setSelectedEntry(null), selectedEntry?.payment_id || selectedEntry?.check_id || 'No ref', currency(selectedEntry?.amount), 'Double-click a bank entry to select · single-click to open')}
            <button onClick={handleMatch} disabled={!ready} title={!selectedLead ? 'Select a lead first' : !selectedEntry ? 'Select a bank audit entry first' : 'Link entry to lead as manual match'} style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, borderRadius: 10, border: 'none', cursor: ready ? 'pointer' : 'not-allowed', background: ready ? 'var(--sage)' : '#d1d5db', color: ready ? '#fff' : '#9ca3af', opacity: matching ? .7 : 1, flexShrink: 0 }}>
              {matching ? <Loader2 size={17} style={{ animation: 'fb-spin 1s linear infinite' }} /> : <Link2 size={17} strokeWidth={2.5} />}
            </button>
          </div>
        )}
      </div>

      {entertainModalOpen && (
        <div className="modal-overlay" onClick={() => { if (!entertainUploading && !entertainSending) setEntertainModalOpen(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500, borderRadius: 16, overflow: 'hidden', padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Entertainment Audio</div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>Upload an audio or select one to send to every active FRO panel</div>
              </div>
              <button className="btn btn-sm btn-icon" onClick={() => { if (!entertainUploading && !entertainSending) setEntertainModalOpen(false); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--ink-soft)' }} aria-label="Close">
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', borderRadius: 10, border: '1.5px dashed #9ca3af', background: '#f8fafc', color: 'var(--ink)', fontSize: 12.5, fontWeight: 700, cursor: entertainUploading ? 'wait' : 'pointer' }}>
                {entertainUploading ? 'Uploading…' : '＋ Upload new audio'}
                <input type="file" accept="audio/*" onChange={uploadEntertainAudio} disabled={entertainUploading} style={{ display: 'none' }} />
              </label>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' }}>Uploaded audios</div>
              {entertainLoading ? (
                <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 18 }}>Loading audios…</div>
              ) : entertainAudios.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 18, border: '1px dashed #d1d5db', borderRadius: 10 }}>No audios uploaded yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                  {entertainAudios.map(audio => (
                    <label key={audio.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, border: `1px solid ${entertainAudioId === audio.id ? '#86efac' : '#e5e7eb'}`, background: entertainAudioId === audio.id ? '#f0fdf4' : '#fff', cursor: 'pointer' }}>
                      <input type="radio" name="entertain-audio" checked={entertainAudioId === audio.id} onChange={() => setEntertainAudioId(audio.id)} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{audio.name}</div>
                        <audio controls preload="none" src={audio.url} style={{ width: '100%', height: 30, marginTop: 4 }} />
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <button onClick={sendEntertainment} disabled={entertainSending || entertainLoading || !entertainAudioId} style={{ marginTop: 2, width: '100%', padding: '11px 0', borderRadius: 10, border: 'none', background: 'var(--sage, #166534)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: entertainSending ? 'default' : 'pointer', fontFamily: 'inherit', opacity: entertainSending || !entertainAudioId ? .6 : 1 }}>
                {entertainSending ? 'Sending…' : 'Send selected audio to all FROs'}
              </button>
            </div>
          </div>
        </div>
      )}

      {froModalOpen && (
        <div className="modal-overlay" onClick={() => { if (!froSending) setFroModalOpen(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, borderRadius: 16, overflow: 'hidden', padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>FRO Announcement</div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>Shows once on every open FRO panel · nothing is stored</div>
              </div>
              <button className="btn btn-sm btn-icon" onClick={() => { if (!froSending) setFroModalOpen(false); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--ink-soft)' }} aria-label="Close">
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' }}>FRO</label>
              <select value={froSelectedId} onChange={e => setFroSelectedId(e.target.value)} disabled={froWorkersLoading} style={{ fontSize: 13, padding: '8px 10px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', color: 'var(--ink)', fontWeight: 600, fontFamily: 'inherit' }}>
                <option value="">{froWorkersLoading ? 'Loading FROs…' : 'Select an FRO'}</option>
                {froWorkers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {selectedFro && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f7' }}>
                  {selectedFro.photo_url ? (
                    <img src={selectedFro.photo_url} alt={selectedFro.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {(selectedFro.name || '?').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFro.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>FRO · {selectedFro.employee_id || '—'}</div>
                  </div>
                </div>
              )}
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' }}>Message</label>
              <textarea rows={4} value={froText} onChange={e => setFroText(e.target.value)} placeholder="e.g. Please complete your follow-up calls before 6 pm." style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', color: 'var(--ink)', fontFamily: 'inherit', resize: 'vertical' }} />
              <div style={{ fontSize: 10.5, color: '#94a3b8', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                <span>✨</span>
                <span>Your message is rephrased with correct grammar before it is broadcast to active FRO panels.</span>
              </div>
              <button onClick={sendFroBroadcast} disabled={froSending} style={{ marginTop: 2, width: '100%', padding: '11px 0', borderRadius: 10, border: 'none', background: 'var(--sage, #166534)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: froSending ? 'default' : 'pointer', fontFamily: 'inherit', opacity: froSending ? .7 : 1 }}>
                {froSending ? 'Sending…' : 'Send to all FROs'}
              </button>
            </div>
          </div>
        </div>
      )}

      {teamModalOpen && (
        <div className="modal-overlay" onClick={() => { if (!teamSending) setTeamModalOpen(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, borderRadius: 16, overflow: 'hidden', padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Team Congratulations</div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>AI writes a celebratory message for the selected teams &amp; members</div>
              </div>
              <button className="btn btn-sm btn-icon" onClick={() => { if (!teamSending) setTeamModalOpen(false); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--ink-soft)' }} aria-label="Close">
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' }}>Select teams <span style={{ color: '#94a3b8', textTransform: 'none', fontWeight: 600 }}>(multiple)</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {teamsLoading && <span style={{ fontSize: 12, color: '#94a3b8' }}>Loading teams…</span>}
                {!teamsLoading && teams.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>No teams found</span>}
                {teams.length > 0 && (
                  <button
                    onClick={() => setSelectedTeams(prev => prev.length === teams.length ? [] : teams.slice())}
                    style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 10px', borderRadius: 999, border: '1px solid #d1d5db', background: selectedTeams.length === teams.length ? 'var(--sage, #166534)' : '#fff', color: selectedTeams.length === teams.length ? '#fff' : 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit' }}
                   >All</button>
                 )}
                {teams.map(t => {
                  const on = selectedTeams.includes(t);
                  return (
                    <button key={t} onClick={() => toggleTeam(t)}
                      style={{ fontSize: 12.5, fontWeight: 800, padding: '7px 14px', borderRadius: 999, border: on ? 'none' : '1px solid #d1d5db', background: on ? 'var(--sage, #166534)' : '#fff', color: on ? '#fff' : 'var(--ink)', cursor: 'pointer', fontFamily: 'inherit', boxShadow: on ? '0 6px 14px rgba(22,101,52,.35)' : 'none' }}>
                      {formatTeamName(t)}
                    </button>
                  );
                })}
              </div>
              {selectedTeams.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 10, borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f7' }}>
                   {selectedTeams.map(t => (
                     <span key={t} onClick={() => toggleTeam(t)} style={{ fontSize: 11, fontWeight: 700, color: 'var(--sage, #166534)', background: '#f0f7ef', border: '1px solid #cfe3cb', padding: '3px 9px', borderRadius: 999, cursor: 'pointer' }}>{formatTeamName(t)} ✕</span>
                   ))}
                </div>
              )}
              <div style={{ fontSize: 10.5, color: '#94a3b8', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                <span>✨</span>
                <span>AI generates a warm congratulatory message naming the selected teams and every active member, then shows it as a popup on all open FRO panels.</span>
              </div>
              <button onClick={sendTeamCongrats} disabled={teamSending} style={{ marginTop: 2, width: '100%', padding: '11px 0', borderRadius: 10, border: 'none', background: 'var(--sage, #166534)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: teamSending ? 'default' : 'pointer', fontFamily: 'inherit', opacity: teamSending ? .7 : 1 }}>
                {teamSending ? 'Generating & sending…' : 'Congratulate teams'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

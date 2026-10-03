import { useState, useEffect } from 'react';
import { useRec, CANDIDATE_STAGES } from '../store';
import { Plus, Users, Search, RefreshCw, Trash, X, Pencil } from '../icons';
import { Dropdown, cleanField } from './ui';
import LeadDetail from './LeadDetail';

const calcAge = (dob) => {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / 31557600000);
};

const getJobRole = (lead) => {
  if (lead.job_role) return lead.job_role;
  let notes = [];
  try { notes = JSON.parse(lead.notes || '[]'); } catch (e) { console.error('Error:', e.message); }
  const meta = notes.find(n => n.__meta === true && n.type === 'job_role');
  return meta ? meta.value : null;
};

const DEFAULT_JOB_ROLES = [
  'Web Developer','Calling','Digital Marketing','HR','Graphic Designer','Content Writer',
  'SEO Specialist','Sales Executive','Business Analyst','Data Entry','Accountant',
  'Social Media Manager','Video Editor',
].map(r => ({ value: r, label: r }));

const DEFAULT_SOURCES = ['Walk-in','LinkedIn','Referral','Job Portal'].map(s => ({ value: s, label: s }));

const DEFAULT_CONNECTED = [
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'call_back', label: 'Call Back' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 're_scheduled', label: 'Re-Scheduled' },
];

const DEFAULT_NOT_CONNECTED = [
  { value: 'ringing', label: 'Ringing' },
  { value: 'unreachable', label: 'Unreachable' },
  { value: 'busy', label: 'Busy' },
  { value: 'switched_off', label: 'Switched Off' },
  { value: 'wrong_number', label: 'Wrong Number' },
  { value: 'invalid', label: 'Invalid' },
  { value: 'rejected', label: 'Rejected' },
];

const CONNECTED_STATUS_MAP = { follow_up: 'followed_up', call_back: 'call_back', schedule: 'scheduled', not_interested: 'not_interested', re_scheduled: 're_scheduled' };

const REVERSE_CONNECTED_MAP = { followed_up: 'follow_up', call_back: 'call_back', scheduled: 'schedule', not_interested: 'not_interested', re_scheduled: 're_scheduled' };

const toLocalDT = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function useList(key, defaults) {
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const defaultValues = defaults.map(d => d.value);
          const missing = defaults.filter(d => !parsed.some(p => p.value === d.value));
          return missing.length > 0 ? [...parsed, ...missing] : parsed;
        }
      }
    } catch (e) {}
    return defaults;
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(items)); } catch (e) {}
  }, [key, items]);
  return [items, setItems];
}

const statusPill = (s, labelMap) => {
  const m = { rejected:'pill-danger', hold:'pill-gold', scheduled:'pill-clay' };
  const label = s ? (labelMap[s] || s) : '—';
  return <span className={`pill ${m[s] || 'pill-gray'}`}>{label}</span>;
};

function OptionsGroup({ title, items, onChange, valueMode, addPlaceholder }) {
  const [text, setText] = useState('');
  const update = (i, label) => onChange(items.map((it, idx) => idx === i ? (valueMode === 'label' ? { value: label, label } : { ...it, label }) : it));
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onChange([...items, valueMode === 'label' ? { value: t, label: t } : { value: slug(t), label: t }]);
    setText('');
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{title}</div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <input value={it.label} onChange={e => update(i, e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <button type="button" className="btn btn-icon" onClick={() => remove(i)} title="Remove" style={{ color: '#dc2626' }}><Trash width={13}/></button>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={addPlaceholder || 'Add new…'} style={{ flex: 1, minWidth: 0 }} />
        <button type="button" className="btn btn-sm" onClick={add}><Plus width={13}/> Add</button>
      </div>
    </div>
  );
}

const formatDT = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
};

const getLeadDate = (l) => {
  if (!l) return '';
  let parsed = [];
  try { parsed = JSON.parse(l.notes || '[]'); } catch (e) {}
  const meta = (parsed.find(n => n && n.__meta && n.type === 'option_dates') || {}).value || {};
  const st = cleanField(l.status);
  const key = { followed_up:'follow_up', call_back:'call_back', scheduled:'schedule', not_interested:'not_interested', re_scheduled:'re_scheduled' }[st] || st;
  const dedicated = { followed_up:l.follow_up_date, call_back:l.call_back_time, scheduled:l.scheduled_date, re_scheduled:l.re_scheduled_date }[st];
  return meta[key] || dedicated || l.created_at || l.createdAt || l.updated_at || l.updatedAt || '';
};

const SkeletonRow = ({ cols }) => (
  <tr>
    {Array.from({length:cols}).map((_,i) => (
      <td key={i}><div className="skeleton" style={{height:14,width:i===0?100:60}}/></td>
    ))}
  </tr>
);

const TABS = [
  { key:'leads', label:'Leads' },
  { key:'scheduled', label:'Scheduled' },
];

export default function Leads() {
  const { leads, leadsLoading, addLead, updateLead, deleteLead, currentUser, user, refreshLeads, leadFilters, setLeadFilters, leadScope, setLeadScope, canViewAllLeads, jobs } = useRec();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [source, setSource] = useState('Walk-in');
  const [customSource, setCustomSource] = useState('');
  const [notConnectedOption, setNotConnectedOption] = useState('');
  const [connectedOption, setConnectedOption] = useState('');
  const [connectionType, setConnectionType] = useState('');
  const [optionDates, setOptionDates] = useState({});
  const setOptionDate = (key, val) => setOptionDates(p => ({ ...p, [key]: val }));
  const [formNotes, setFormNotes] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [selectedJobRole, setSelectedJobRole] = useState('');
  const [customJobRole, setCustomJobRole] = useState('');
  const [stage, setStage] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [searchInput, setSearchInput] = useState(leadFilters.search || '');
  const [tab, setTab] = useState('leads');
  const [nameError, setNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteMsg, setDeleteMsg] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [jobRoles, setJobRoles] = useList('rec_leads_jobRoles', DEFAULT_JOB_ROLES);
  const [sources, setSources] = useList('rec_leads_sources', DEFAULT_SOURCES);
  const [connectedOpts, setConnectedOpts] = useList('rec_leads_connectedOptions', DEFAULT_CONNECTED);
  const [notConnectedOpts, setNotConnectedOpts] = useList('rec_leads_notConnectedOptions', DEFAULT_NOT_CONNECTED);
  const [showOptions, setShowOptions] = useState(false);

  const handleNameChange = (val) => {
    if (/\d/.test(val)) { setNameError('Name cannot contain numbers'); setTimeout(() => setNameError(''), 3000); }
    setName(val.replace(/[^a-zA-Z\s'-]/g,''));
  };
  const handlePhoneChange = (val) => {
    const digits = val.replace(/[^0-9]/g,'');
    if (/[a-zA-Z]/.test(val)) { setPhoneError('Phone number must be digits only'); setTimeout(() => setPhoneError(''), 3000); }
    else if (digits.length > 10) { setPhoneError('Phone number must be 10 digits only'); setTimeout(() => setPhoneError(''), 3000); }
    setPhone(digits.slice(0,10));
  };

  const handleDelete = async (id) => {
    setDeleting(true);
    try {
      await deleteLead(id);
      setDeleteMsg('Lead deleted successfully.');
      setDeleteConfirm(null);
      setTimeout(() => setDeleteMsg(''), 3000);
    } catch {
      setDeleteMsg('Failed to delete lead.');
      setTimeout(() => setDeleteMsg(''), 3000);
    } finally {
      setDeleting(false);
    }
  };

  const resetForm = () => {
    setName(''); setPhone(''); setDob(''); setSource('Walk-in'); setCustomSource(''); setConnectedOption(''); setNotConnectedOption(''); setConnectionType(''); setOptionDates({}); setFormNotes([]); setSelectedJobRole(''); setCustomJobRole(''); setStage('');
    setEditingLead(null);
  };

  const startEdit = (l) => {
    setEditingLead(l);
    setName(l.name || '');
    setPhone(l.phone || '');
    setDob(l.dob ? String(l.dob).slice(0, 10) : '');
    const src = cleanField(l.source);
    if (sources.some(s => s.value === src)) { setSource(src); setCustomSource(''); }
    else { setSource('Other'); setCustomSource(src || ''); }
    let notesArr = [];
    try { notesArr = JSON.parse(l.notes || '[]'); } catch (e) { console.error('Error:', e.message); }
    const roleMeta = notesArr.find(n => n && n.__meta && n.type === 'job_role');
    const role = l.job_role || (roleMeta ? roleMeta.value : '') || '';
    if (role && jobRoles.some(r => r.value === role)) { setSelectedJobRole(role); setCustomJobRole(''); }
    else if (role) { setSelectedJobRole('Other'); setCustomJobRole(role); }
    else { setSelectedJobRole(''); setCustomJobRole(''); }
    const stageMeta = notesArr.find(n => n && n.__meta && n.type === 'stage');
    setStage(stageMeta ? stageMeta.value : '');
    setFormNotes(notesArr.filter(n => !n || !n.__meta));
    if (REVERSE_CONNECTED_MAP[l.status]) {
      setConnectionType('connected');
      setConnectedOption(REVERSE_CONNECTED_MAP[l.status]);
      setNotConnectedOption('');
    } else if (notConnectedOpts.some(o => o.value === l.status)) {
      setConnectionType('not_connected');
      setNotConnectedOption(l.status);
      setConnectedOption('');
    } else {
      setConnectionType(''); setConnectedOption(''); setNotConnectedOption('');
    }
    const preDates = (notesArr.find(n => n && n.__meta && n.type === 'option_dates') || {}).value || {};
    setOptionDates({
      ...preDates,
      follow_up: toLocalDT(l.follow_up_date) || preDates.follow_up || '',
      call_back: toLocalDT(l.call_back_time) || preDates.call_back || '',
      schedule: toLocalDT(l.scheduled_date) || preDates.schedule || '',
      re_scheduled: toLocalDT(l.re_scheduled_date) || preDates.re_scheduled || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addNoteToForm = () => {
    if (!noteText.trim()) return;
    const n = { text: noteText.trim(), date: new Date().toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}), by: user.name };
    setFormNotes(p => [...p, n]); setNoteText('');
  };

  const removeFormNote = (i) => setFormNotes(p => p.filter((_,idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formValid) { setFormError('Mandatory field validation is missing.'); setTimeout(() => setFormError(''), 3000); return; }
    try {
      const finalSource = source === 'Other' ? (customSource.trim() || 'Other') : source;
      let finalStatus = connectionType === 'connected'
        ? (CONNECTED_STATUS_MAP[connectedOption] || connectedOption || '')
        : notConnectedOption;
      if (editingLead && !finalStatus) finalStatus = editingLead.status || '';
      const finalJobRole = selectedJobRole === 'Other' ? (customJobRole.trim() || 'Other') : selectedJobRole;
      const notesArr = [...formNotes];
      if (stage) notesArr.unshift({ __meta: true, type: 'stage', value: stage });
      if (finalJobRole) notesArr.unshift({ __meta: true, type: 'job_role', value: finalJobRole });
      const optionDatesMeta = Object.keys(optionDates).filter(k => optionDates[k]).reduce((acc, k) => { acc[k] = optionDates[k]; return acc; }, {});
      if (Object.keys(optionDatesMeta).length) notesArr.push({ __meta: true, type: 'option_dates', value: optionDatesMeta });
      const payload = { name: name.trim(), phone, dob: dob || null, source: finalSource, status: finalStatus, notes: notesArr.length ? JSON.stringify(notesArr) : null, job_role: finalJobRole || null };
      if (!editingLead) payload.created_by_name = user.name;
      if (finalStatus === 'followed_up' && optionDates.follow_up) payload.follow_up_date = optionDates.follow_up;
      if (finalStatus === 'call_back' && optionDates.call_back) payload.call_back_time = optionDates.call_back;
      if (finalStatus === 'scheduled' && optionDates.schedule) payload.scheduled_date = optionDates.schedule;
      if (finalStatus === 're_scheduled' && optionDates.re_scheduled) payload.re_scheduled_date = optionDates.re_scheduled;
      if (editingLead) {
        await updateLead(editingLead.id, payload);
        setSuccessMsg('Lead updated successfully.');
      } else {
        await addLead(payload);
        setSuccessMsg('Lead created successfully.');
      }
      setTimeout(() => setSuccessMsg(''), 3000);
      setLeadFilters(p => ({ ...p, status: '', source: '' }));
      resetForm();
    } catch (err) { alert(err.message); }
  };

  const handleSearch = () => {
    setLeadFilters(p => ({ ...p, search: searchInput }));
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  const age = calcAge(dob);
  const filteredLeads = leads.filter(l => {
    if (leadFilters.search) {
      const s = leadFilters.search.toLowerCase();
      if (!l.name.toLowerCase().includes(s) && !(l.phone||'').includes(s)) return false;
    }
    if (leadFilters.status && l.status !== leadFilters.status) return false;
    if (leadFilters.source && l.source !== leadFilters.source) return false;
    return true;
  });

  const scheduledLeads = leads.filter(l => l.status === 'scheduled');

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [leadFilters.search, leadFilters.status, leadFilters.source]);
  const totalLeadPages = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const safeLeadPage = Math.min(page, totalLeadPages);
  const paginatedLeads = filteredLeads.slice((safeLeadPage - 1) * PAGE_SIZE, safeLeadPage * PAGE_SIZE);
  const selectedLead = selectedLeadId ? leads.find(l => l.id === selectedLeadId) : null;
  const formValid = name.trim() && phone.trim() && source && selectedJobRole;

  const jobRoleOptions = [{ value: '', label: 'Select a role' }, ...jobRoles, { value: 'Other', label: 'Other' }];
  const sourceOptions = [...sources, { value: 'Other', label: 'Other' }];
  const connectedOptions = [{ value: '', label: 'Select' }, ...connectedOpts];
  const notConnectedOptions = [{ value: '', label: 'Select' }, ...notConnectedOpts];
  const stageOptions = [{ value: '', label: 'Select a stage' }, ...CANDIDATE_STAGES.map(s => ({ value: s, label: s }))];
  const statusFilterOptions = [
    { value: 'hold', label: 'Hold' },
    ...connectedOpts.map(o => ({ value: CONNECTED_STATUS_MAP[o.value] || o.value, label: o.label })),
    ...notConnectedOpts.map(o => ({ value: o.value, label: o.label })),
  ];
  const statusLabelMap = {
    hold: 'Hold',
    new: 'New',
    contacted: 'Contacted',
    screening: 'Screening',
    shortlisted: 'Shortlisted',
    selected: 'Selected',
    interviewed: 'Interviewed',
    offer_released: 'Offer Released',
    offer_accepted: 'Offer Accepted',
    onboarding: 'Onboarding',
    on_hold: 'On Hold',
    withdrawn: 'Withdrawn',
    re_scheduled: 'Re-Scheduled',
    ...connectedOpts.reduce((acc, o) => { acc[CONNECTED_STATUS_MAP[o.value] || o.value] = o.label; return acc; }, {}),
    ...notConnectedOpts.reduce((acc, o) => { acc[o.value] = o.label; return acc; }, {}),
  };

  const optionsPanel = (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-head"><h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Manage options</h4></div>
      <div className="card-pad">
        <OptionsGroup title="Job roles" items={jobRoles} onChange={setJobRoles} valueMode="label" addPlaceholder="New role…" />
        <OptionsGroup title="Sources" items={sources} onChange={setSources} valueMode="label" addPlaceholder="New source…" />
        <OptionsGroup title="CONNECTED statuses" items={connectedOpts} onChange={setConnectedOpts} addPlaceholder="New status…" />
        <OptionsGroup title="NOT CONNECTED statuses" items={notConnectedOpts} onChange={setNotConnectedOpts} addPlaceholder="New status…" />
        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Changes are saved automatically and apply to the lead form and filters.</div>
      </div>
    </div>
  );


  if (selectedLead) {
    return (
      <>
        <div className="card" style={{marginBottom:20}}>
        <div className="card-head"><h3><Users width={18}/> {editingLead ? 'Edit lead' : 'Add new lead'}</h3><button type="button" className="btn btn-sm" onClick={()=>setShowOptions(p=>!p)}>{showOptions ? 'Hide options' : 'Manage options'}</button></div>
          <form className="card-pad" onSubmit={handleSubmit}>
            <div className="form-row lead-basics" style={{display:'grid',gap:12,gridTemplateColumns:'repeat(4,minmax(0,1fr))',alignItems:'flex-start'}}>
              <label className="field" style={{flex:1,minWidth:0}}>Name
                <input value={name} onChange={e=>handleNameChange(e.target.value)} placeholder="e.g. Arun Sharma" style={nameError ? {borderColor:'#dc2626'} : undefined} required />
                {nameError && <span style={{fontSize:11,color:'#dc2626',marginTop:2}}>{nameError}</span>}
              </label>
              <label className="field" style={{flex:1,minWidth:0}}>Phone
                <input value={phone} onChange={e=>handlePhoneChange(e.target.value)} placeholder="e.g. 9876543210" style={phoneError ? {borderColor:'#dc2626'} : undefined} required />
                {phoneError && <span style={{fontSize:11,color:'#dc2626',marginTop:2}}>{phoneError}</span>}
              </label>
              <label className="field" style={{flex:1,minWidth:0}}>DOB
                <input type="date" value={dob} onChange={e=>setDob(e.target.value)} />
              </label>
              <label className="field" style={{flex:1,minWidth:0}}>Source
                <Dropdown value={source} onChange={e=>{setSource(e.target.value);if(e.target.value!=='Other')setCustomSource('')}} options={sourceOptions} customTrigger="Other" customValue={customSource} onCustomChange={setCustomSource} />
              </label>
            </div>
            <div className="card" style={{marginTop:12,border:'1.5px solid var(--line)',borderRadius:'var(--radius)'}}>
              <div className="card-head"><h4 style={{fontSize:13,fontWeight:600,margin:0}}>CONNECTION STATUS</h4></div>
              <div className="card-pad">
                <div style={{display:'flex',gap:16}}>
                  <div style={{flex:1,minWidth:0}}>
                    <label style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:4,display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                      <input type="radio" name="connectionStatus" checked={connectionType==='connected'} onChange={()=>{setConnectionType('connected');setNotConnectedOption('');setOptionDates({});}} />
                      CONNECTED
                    </label>
                    <div style={connectionType==='not_connected'?{opacity:.4,pointerEvents:'none'}:undefined}>
                      <Dropdown menuInset value={connectedOption} onChange={e=>{setConnectionType('connected');setConnectedOption(e.target.value);setNotConnectedOption('');setOptionDates({});}} options={connectedOptions} style={{width:'100%'}} />
                      {connectedOption && (
                        <div style={{display:'inline-flex',alignItems:'center',gap:8,marginTop:6,flexWrap:'wrap'}}>
                          <span style={{fontSize:13,fontWeight:500,color:'var(--ink)'}}>{(connectedOpts.find(o=>o.value===connectedOption)||{}).label || connectedOption}</span>
                          <input type="datetime-local" value={optionDates[connectedOption] || ''} onChange={e=>setOptionDate(connectedOption, e.target.value)} style={{width:'auto'}} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <label style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:4,display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                      <input type="radio" name="connectionStatus" checked={connectionType==='not_connected'} onChange={()=>{setConnectionType('not_connected');setConnectedOption('');setOptionDates({});}} />
                      NOT CONNECTED
                    </label>
                    <div style={connectionType==='connected'?{opacity:.4,pointerEvents:'none'}:undefined}>
                      <Dropdown menuInset value={notConnectedOption} onChange={e=>{setConnectionType('not_connected');setNotConnectedOption(e.target.value);setConnectedOption('');setOptionDates({});}} options={notConnectedOptions} style={{width:'100%'}} />
                      {notConnectedOption && (
                        <div style={{display:'inline-flex',alignItems:'center',gap:8,marginTop:6,flexWrap:'wrap'}}>
                          <span style={{fontSize:13,fontWeight:500,color:'var(--ink)'}}>{(notConnectedOpts.find(o=>o.value===notConnectedOption)||{}).label || notConnectedOption}</span>
                          <input type="datetime-local" value={optionDates[notConnectedOption] || ''} onChange={e=>setOptionDate(notConnectedOption, e.target.value)} style={{width:'auto'}} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid var(--line)'}}>
                  <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:6}}>JOB DESCRIPTION *</div>
                      <Dropdown menuInset value={selectedJobRole} onChange={e=>{setSelectedJobRole(e.target.value);if(e.target.value!=='Other')setCustomJobRole('')}} options={jobRoleOptions} customTrigger="Other" customValue={customJobRole} onCustomChange={setCustomJobRole} style={{width:'100%',maxWidth:280}} />
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:6}}>STAGE</div>
                      <Dropdown menuInset value={stage} onChange={e=>setStage(e.target.value)} options={stageOptions} style={{width:'100%'}} />
                    </div>
                  </div>
                </div>
                <div style={{display:'flex',gap:8,marginTop:16,justifyContent:'flex-end',alignItems:'center'}}>
                  {formError && <span style={{fontSize:12,color:'#dc2626',marginRight:'auto'}}>{formError}</span>}
                  <button type="button" className="btn" onClick={()=>setSelectedLeadId(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" ><Plus width={15}/> Create lead</button>
                </div>
              </div>
            </div>
          </form>
        </div>

        {showOptions && optionsPanel}

        <LeadDetail lead={selectedLead} onBack={() => setSelectedLeadId(null)} />
      </>
    );
  }

  return (
    <>
      <div className="card" style={{marginBottom:20}}>
        <div className="card-head"><h3><Users width={18}/> Add new lead</h3><button type="button" className="btn btn-sm" onClick={()=>setShowOptions(p=>!p)}>{showOptions ? 'Hide options' : 'Manage options'}</button></div>
        <form className="card-pad" onSubmit={handleSubmit}>
          <div className="form-row lead-basics" style={{display:'grid',gap:12,gridTemplateColumns:'repeat(4,minmax(0,1fr))',alignItems:'flex-start'}}>
            <label className="field" style={{flex:1,minWidth:0}}>Name
              <input value={name} onChange={e=>handleNameChange(e.target.value)} placeholder="e.g. Arun Sharma" style={nameError ? {borderColor:'#dc2626'} : undefined} required />
              {nameError && <span style={{fontSize:11,color:'#dc2626',marginTop:2}}>{nameError}</span>}
            </label>
            <label className="field" style={{flex:1,minWidth:0}}>Phone
              <input value={phone} onChange={e=>handlePhoneChange(e.target.value)} placeholder="e.g. 9876543210" style={phoneError ? {borderColor:'#dc2626'} : undefined} required />
              {phoneError && <span style={{fontSize:11,color:'#dc2626',marginTop:2}}>{phoneError}</span>}
            </label>
            <label className="field" style={{flex:1,minWidth:0}}>DOB
              <input type="date" value={dob} onChange={e=>setDob(e.target.value)} />
            </label>
            <label className="field" style={{flex:1,minWidth:0}}>Source
              <Dropdown value={source} onChange={e=>{setSource(e.target.value);if(e.target.value!=='Other')setCustomSource('')}} options={sourceOptions} customTrigger="Other" customValue={customSource} onCustomChange={setCustomSource} />
            </label>
          </div>
          <div className="card" style={{marginTop:12,border:'1.5px solid var(--line)',borderRadius:'var(--radius)'}}>
            <div className="card-head"><h4 style={{fontSize:13,fontWeight:600,margin:0}}>CONNECTION STATUS</h4></div>
            <div className="card-pad">
              <div style={{display:'flex',gap:16}}>
                <div style={{flex:1,minWidth:0}}>
                  <label style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:4,display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                    <input type="radio" name="connectionStatus" checked={connectionType==='connected'} onChange={()=>{setConnectionType('connected');setNotConnectedOption('');setOptionDates({});}} />
                    CONNECTED
                  </label>
                  <div style={connectionType==='not_connected'?{opacity:.4,pointerEvents:'none'}:undefined}>
                    <Dropdown menuInset value={connectedOption} onChange={e=>{setConnectionType('connected');setConnectedOption(e.target.value);setNotConnectedOption('');setOptionDates({});}} options={connectedOptions} style={{width:'100%'}} />
                    {connectedOption && (
                      <div style={{display:'inline-flex',alignItems:'center',gap:8,marginTop:6,flexWrap:'wrap'}}>
                        <span style={{fontSize:13,fontWeight:500,color:'var(--ink)'}}>{(connectedOpts.find(o=>o.value===connectedOption)||{}).label || connectedOption}</span>
                        <input type="datetime-local" value={optionDates[connectedOption] || ''} onChange={e=>setOptionDate(connectedOption, e.target.value)} style={{width:'auto'}} />
                      </div>
                    )}
                  </div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <label style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:4,display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                    <input type="radio" name="connectionStatus" checked={connectionType==='not_connected'} onChange={()=>{setConnectionType('not_connected');setConnectedOption('');setOptionDates({});}} />
                    NOT CONNECTED
                  </label>
                  <div style={connectionType==='connected'?{opacity:.4,pointerEvents:'none'}:undefined}>
                    <Dropdown menuInset value={notConnectedOption} onChange={e=>{setConnectionType('not_connected');setNotConnectedOption(e.target.value);setConnectedOption('');setOptionDates({});}} options={notConnectedOptions} style={{width:'100%'}} />
                    {notConnectedOption && (
                      <div style={{display:'inline-flex',alignItems:'center',gap:8,marginTop:6,flexWrap:'wrap'}}>
                        <span style={{fontSize:13,fontWeight:500,color:'var(--ink)'}}>{(notConnectedOpts.find(o=>o.value===notConnectedOption)||{}).label || notConnectedOption}</span>
                        <input type="datetime-local" value={optionDates[notConnectedOption] || ''} onChange={e=>setOptionDate(notConnectedOption, e.target.value)} style={{width:'auto'}} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid var(--line)'}}>
                <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:6}}>JOB DESCRIPTION *</div>
                    <Dropdown menuInset value={selectedJobRole} onChange={e=>{setSelectedJobRole(e.target.value);if(e.target.value!=='Other')setCustomJobRole('')}} options={jobRoleOptions} customTrigger="Other" customValue={customJobRole} onCustomChange={setCustomJobRole} style={{width:'100%',maxWidth:280}} />
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:6}}>STAGE</div>
                    <Dropdown menuInset value={stage} onChange={e=>setStage(e.target.value)} options={stageOptions} style={{width:'100%'}} />
                  </div>
                </div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:16,justifyContent:'flex-end',alignItems:'center'}}>
                {formError && <span style={{fontSize:12,color:'#dc2626',marginRight:'auto'}}>{formError}</span>}
                {editingLead && <button type="button" className="btn" onClick={resetForm}>Cancel</button>}
                <button type="submit" className="btn btn-primary" ><Plus width={15}/> {editingLead ? 'Update lead' : 'Create lead'}</button>
              </div>
            </div>
          </div>
        </form>
      </div>

      {showOptions && optionsPanel}

      <div className="tabs" style={{marginBottom:0}}>
        {TABS.map(t => {
          const counts = { leads: leads.length, scheduled: scheduledLeads.length };
          const dots = { leads: '#5B6B4E', scheduled: '#3b82f6' };
          return (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {counts[t.key] > 0 && <span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:dots[t.key],marginLeft:6,verticalAlign:'middle'}}/>}
            </button>
          );
        })}
      </div>

      {tab === 'leads' && (
        <div className="card" style={{marginTop:20}}>
          <div className="card-head">
            <h3>Leads</h3>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <span className="sub">{leadsLoading ? '…' : filteredLeads.length + ' leads'}</span>
              <button className="btn btn-sm" onClick={refreshLeads} title="Refresh" style={{color:'var(--sage)',borderColor:'var(--sage)'}}><RefreshCw width={13}/></button>
            </div>
          </div>
          <div className="card-pad" style={{paddingTop:0,paddingBottom:0}}>
            <div className="filter-bar">
              <div className="search-group">
                <input value={searchInput} onChange={e=>{setSearchInput(e.target.value);setLeadFilters(p=>({...p,search:e.target.value}))}}
                  placeholder="Search by name or phone…" />
              </div>
              <Dropdown className="filter-select" value={leadFilters.status} onChange={e=>setLeadFilters(p=>({...p,status:e.target.value}))}
                options={[{value:'',label:'All statuses'}, ...statusFilterOptions]} />
              <Dropdown className="filter-select" value={leadFilters.source} onChange={e=>setLeadFilters(p=>({...p,source:e.target.value}))}
                options={[{value:'',label:'All sources'}, ...sources]} />
              {canViewAllLeads && (
                <Dropdown className="filter-select" value={leadScope} onChange={e=>setLeadScope(e.target.value)}
                  options={[{value:'mine',label:'My leads'}, {value:'all',label:'All leads'}]} />
              )}
            </div>
            <div className="sub" style={{padding:'0 0 10px'}}>
              {leadScope === 'mine'
                ? 'Assigned to you or entered by you.'
                : 'Every lead in the CRM, newest first.'}
            </div>
          </div>
          {leadsLoading ? (
            <div style={{overflowX:'auto'}}><table><tbody>{[1,2,3,4,5].map(i => <SkeletonRow key={i} cols={7}/>)}</tbody></table></div>
          ) : filteredLeads.length === 0 ? (
            <div className="empty">No leads found.</div>
          ) : (
            <div style={{overflowX:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Phone</th><th>Source</th><th>Status</th><th>Date</th><th>Job Description</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLeads.map(l => {
                  let parsed = [];
                  try { parsed = JSON.parse(l.notes || '[]'); } catch (e) { console.error('Error:', e.message); }
                  const displayAge = l.dob ? calcAge(l.dob) : l.age;
                  return (
                    <tr key={l.id} onClick={() => setSelectedLeadId(l.id)} style={{cursor:'pointer'}}>
                      <td style={{fontWeight:500}}>{l.name}</td>
                      <td style={{color:'var(--ink-soft)'}}>{l.phone || '—'}</td>
                      <td>{cleanField(l.source)}</td>
                      <td>{statusPill(cleanField(l.status), statusLabelMap)}</td>
                      <td style={{color:'var(--ink-soft)',whiteSpace:'nowrap',fontSize:13}}>{formatDT(getLeadDate(l))}</td>
                      <td style={{color:'var(--ink-soft)'}}>{cleanField(getJobRole(l)) || '—'}</td>
                      <td onClick={e => e.stopPropagation()}>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-icon" onClick={() => startEdit(l)} title="Edit">
                          <Pencil width={13} />
                        </button>
                        <button className="btn btn-icon" onClick={() => setDeleteConfirm(l)} title="Delete" style={{color:'#dc2626'}}>
                          <Trash width={13} />
                        </button>
                      </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
          {!leadsLoading && filteredLeads.length > 0 && totalLeadPages > 1 && (
            <div className="pagination">
              <div className="pagination-left">
                <button className="btn btn-sm btn-primary" disabled={safeLeadPage <= 1} onClick={() => setPage(safeLeadPage - 1)}>← Prev</button>
              </div>
              <div className="pagination-center">Page {safeLeadPage} of {totalLeadPages}</div>
              <div className="pagination-right">
                <div className="pagination-dots">
                  {Array.from({ length: totalLeadPages }, (_, i) => i + 1).map(p => (
                    <span key={p} className={`dot ${p === safeLeadPage ? 'dot-active' : ''}`} onClick={() => setPage(p)} />
                  ))}
                </div>
                <button className="btn btn-sm btn-primary" disabled={safeLeadPage >= totalLeadPages} onClick={() => setPage(safeLeadPage + 1)}>Next →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'scheduled' && (
        <div className="card" style={{marginTop:20}}>
          <div className="card-head">
            <h3>Submit</h3>
            <span className="sub">{scheduledLeads.length} lead{scheduledLeads.length!==1?'s':''}</span>
          </div>
          {leadsLoading ? (
            <table><tbody>{[1,2,3].map(i => <SkeletonRow key={i} cols={6}/>)}</tbody></table>
          ) : scheduledLeads.length === 0 ? (
            <div className="empty">No scheduled interviews.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Phone</th><th>Interview date</th><th>Scheduled by</th><th>Scheduled at</th><th>Source</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {scheduledLeads.map(l => (
                  <tr key={l.id} onClick={() => setSelectedLeadId(l.id)} style={{cursor:'pointer'}}>
                    <td style={{fontWeight:500}}>{l.name}</td>
                    <td style={{color:'var(--ink-soft)'}}>{l.phone || '—'}</td>
                    <td>{l.scheduled_date ? new Date(l.scheduled_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
                    <td>{l.scheduled_by_name || l.created_by_name || '—'}</td>
                    <td style={{color:'var(--ink-soft)'}}>{formatDT(l.scheduled_at)}</td>
                    <td>{cleanField(l.source)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <button className="btn btn-icon" onClick={() => startEdit(l)} title="Reschedule">
                        <Pencil width={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {deleteMsg && (
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'var(--paper)',border:'1px solid var(--line)',borderRadius:'var(--radius)',boxShadow:'var(--shadow)',padding:'10px 20px',fontSize:14,zIndex:1000,display:'flex',alignItems:'center',gap:10}}>
          <span>{deleteMsg}</span>
          <button className="btn btn-sm" onClick={() => setDeleteMsg('')} style={{padding:'2px 6px',lineHeight:1}}><X width={12}/></button>
        </div>
      )}

      {successMsg && (
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:'var(--radius)',boxShadow:'var(--shadow)',padding:'10px 20px',fontSize:14,zIndex:1000,display:'flex',alignItems:'center',gap:10,color:'#166534'}}>
          <span>{successMsg}</span>
          <button className="btn btn-sm" onClick={() => setSuccessMsg('')} style={{padding:'2px 6px',lineHeight:1,color:'#166534'}}><X width={12}/></button>
        </div>
      )}

      {deleteConfirm && (
        <div onClick={() => setDeleteConfirm(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100, padding: '20px'
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#FFFFFF', width: '100%', maxWidth: '400px',
            borderRadius: '16px', boxShadow: '0 25px 60px rgba(0,0,0,0.15), 0 4px 20px rgba(0,0,0,0.08)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '28px 28px 20px', textAlign: 'center' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%', background: '#FEE2E2',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px'
              }}>
                <Trash width={22} />
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                Delete Lead?
              </h3>
              <p style={{ margin: 0, fontSize: '14px', color: '#6B7280', lineHeight: 1.5 }}>
                Are you sure you want to delete <strong style={{ color: '#111827' }}>"{deleteConfirm.name}"</strong>? This action cannot be undone.
              </p>
            </div>
            <div style={{
              padding: '16px 28px 24px', display: 'flex', gap: '10px', justifyContent: 'center'
            }}>
              <button onClick={() => setDeleteConfirm(null)} style={{
                padding: '10px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: 600,
                background: '#FFFFFF', color: '#111827', border: '1px solid #E5E7EB',
                cursor: 'pointer', flex: 1
              }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm.id)} disabled={deleting} style={{
                padding: '10px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: 600,
                background: '#EF4444', color: '#FFFFFF', border: 'none',
                cursor: 'pointer', flex: 1
              }}>{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

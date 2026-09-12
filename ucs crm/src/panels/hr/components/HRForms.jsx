import { useState, useEffect, useRef } from 'react';
import { useHR } from '../store';
import { initials as initialsFn } from '../store';
import { Plus, Trash, ArrowLeft, Pencil, Mail } from '../../../icons';
import PrintForms from './forms/PrintForms';
import { deptLabel } from '../../../lib/labels';

const titleCase = (s) => (s || '').replace(/\b\w/g, c => c.toUpperCase());

const PALETTE = ['#5B6B4E', '#B5603A', '#C08A2E', '#4F6472', '#7A5C7E', '#88693D'];
const avatarColorLocal = (name) => {
  let h = 0;
  for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
};
const tint = (hex) => hex + '22';

function formCompletion(w) {
  const val = (v) => v && typeof v === 'string' && v.trim() !== '';
  const edu = (w.education || [])[0] || {};
  const fam = (w.family || [])[0] || {};
  const checks = [
    val(w.name),
    val(w.father_husband_name),
    val(w.address),
    val(w.phone),
    val(w.dob),
    val(w.marital_status),
    val(w.email),
    val(w.gender),
    val(w.aadhar_number),
    val(w.pan_number),
    val(w.bank_name),
    val(w.ifsc_code),
    val(w.account_number),
    val(edu.degree),
    val(edu.institution),
    val(fam.name),
  ];
  const filled = checks.filter(Boolean).length;
  return { pct: Math.round((filled / checks.length) * 100), filled, total: checks.length };
}

const statusOf = (w) => w.employment_status || (w.is_active ? 'active' : 'inactive');
const statusStyle = (w) => {
  const st = statusOf(w);
  if (st === 'active') return { bg: 'rgba(22,101,52,0.9)' };
  if (st === 'absconded') return { bg: 'rgba(153,27,27,0.9)' };
  if (st === 'offboarded') return { bg: 'rgba(67,56,202,0.9)' };
  return { bg: 'rgba(55,65,81,0.9)' };
};

function MiniFormPreview({ worker }) {
  const w = worker;
  const name = w.name || '';
  const dept = w.department || '';
  const phone = w.phone || '';
  const email = w.email || '';
  const gender = w.gender || '';
  const dob = w.dob ? new Date(w.dob).toLocaleDateString('en-IN') : '';
  const joinDate = w.date_of_joining ? new Date(w.date_of_joining).toLocaleDateString('en-IN') : '';
  const photo = w.photo_url || '';

  return (
    <div style={{
      width: '595px',
      height: '842px',
      background: '#fff',
      border: '6px double #000',
      padding: '10px 12px',
      fontFamily: 'Arial, Helvetica, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'absolute',
      top: 0,
      left: 0,
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 26, fontFamily: 'Georgia, serif', fontWeight: 700, margin: 0, textDecoration: 'underline' }}>VOLUNTEER JOINING FORM</div>
      </div>

      {/* Personal Details */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
        <tbody>
          <tr><td colSpan="3" style={{ background: '#d8d8d8', fontWeight: 700, fontSize: 13, border: '1px solid #666', padding: '6px 8px' }}>PERSONAL DETAILS</td></tr>
          <tr>
            <td style={{ border: '1px solid #666', padding: '6px 8px', fontWeight: 700, width: '25%', whiteSpace: 'nowrap' }}>Name :</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px', fontWeight: 600 }}>{titleCase(name)}</td>
            <td rowSpan="4" style={{ border: '1px solid #666', padding: 6, textAlign: 'center', verticalAlign: 'middle', width: 100, fontWeight: 700, fontSize: 20, height: 140 }}>
              {photo ? <img src={photo} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} /> : 'PHOTOGRAPH'}
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #666', padding: '6px 8px', fontWeight: 700 }}>Father's / Husband Name :</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}>{titleCase(w.father_husband_name || '')}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #666', padding: '6px 8px', fontWeight: 700 }}>Address :</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px', whiteSpace: 'pre-wrap' }}>{titleCase(w.address || '')}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #666', padding: '6px 8px', fontWeight: 700 }}>Permanent Address :</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px', whiteSpace: 'pre-wrap' }}>{titleCase(w.permanent_address || w.address || '')}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}><strong>Mobile :</strong> {phone}</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}><strong>Email :</strong> {email}</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}><strong>Gender :</strong> {titleCase(gender)}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}><strong>Date of Birth :</strong> {dob}</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}><strong>Marital Status :</strong> {titleCase(w.marital_status || '')}</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}><strong>Date of Joining :</strong> {joinDate}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}><strong>PAN :</strong> {w.pan_number || ''}</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}><strong>Aadhaar :</strong> {w.aadhar_number || ''}</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}><strong>Dept :</strong> {dept}</td>
          </tr>
        </tbody>
      </table>

      {/* Education */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginTop: 4 }}>
        <tbody>
          <tr><td colSpan="5" style={{ background: '#d8d8d8', fontWeight: 700, fontSize: 13, border: '1px solid #666', padding: '6px 8px' }}>EDUCATIONAL DETAILS</td></tr>
          <tr>
            {[<th key="1" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>Degree</th>, <th key="2" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>University / Institute</th>, <th key="3" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>Year</th>, <th key="4" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>%</th>]}
          </tr>
          {[...Array(2)].map((_, i) => (
            <tr key={i}>
              <td style={{ border: '1px solid #666', padding: '4px 6px', height: 28 }}></td>
              <td style={{ border: '1px solid #666', padding: '4px 6px' }}></td>
              <td style={{ border: '1px solid #666', padding: '4px 6px' }}></td>
              <td style={{ border: '1px solid #666', padding: '4px 6px' }}></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Organizations */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginTop: 4 }}>
        <tbody>
          <tr><td colSpan="5" style={{ background: '#d8d8d8', fontWeight: 700, fontSize: 13, border: '1px solid #666', padding: '6px 8px' }}>PREVIOUS ORGANISATIONS</td></tr>
          <tr>
            {[<th key="1" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9, width: '6%' }}>Sr</th>, <th key="2" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>Organisation</th>, <th key="3" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>Role</th>, <th key="4" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9, width: '12%' }}>From</th>, <th key="5" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9, width: '12%' }}>To</th>]}
          </tr>
          {[...Array(2)].map((_, i) => (
            <tr key={i}>
              <td style={{ border: '1px solid #666', padding: '4px 6px', textAlign: 'center', height: 28 }}>{i + 1}</td>
              <td style={{ border: '1px solid #666', padding: '4px 6px' }}></td>
              <td style={{ border: '1px solid #666', padding: '4px 6px' }}></td>
              <td style={{ border: '1px solid #666', padding: '4px 6px', textAlign: 'center' }}></td>
              <td style={{ border: '1px solid #666', padding: '4px 6px', textAlign: 'center' }}></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Family */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginTop: 4 }}>
        <tbody>
          <tr><td colSpan="5" style={{ background: '#d8d8d8', fontWeight: 700, fontSize: 13, border: '1px solid #666', padding: '6px 8px' }}>FAMILY DETAILS</td></tr>
          <tr>
            {[<th key="1" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9, width: '6%' }}>S.No</th>, <th key="2" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>Name</th>, <th key="3" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>Relation</th>, <th key="4" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>Occupation</th>, <th key="5" style={{ border: '1px solid #666', padding: '4px 6px', fontSize: 9 }}>Mobile</th>]}
          </tr>
          {[...Array(2)].map((_, i) => (
            <tr key={i}>
              <td style={{ border: '1px solid #666', padding: '4px 6px', textAlign: 'center', height: 28 }}>{i + 1}</td>
              <td style={{ border: '1px solid #666', padding: '4px 6px' }}></td>
              <td style={{ border: '1px solid #666', padding: '4px 6px', textAlign: 'center' }}></td>
              <td style={{ border: '1px solid #666', padding: '4px 6px', textAlign: 'center' }}></td>
              <td style={{ border: '1px solid #666', padding: '4px 6px', textAlign: 'center' }}></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Bank */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginTop: 4 }}>
        <tbody>
          <tr><td colSpan="4" style={{ background: '#d8d8d8', fontWeight: 700, fontSize: 13, border: '1px solid #666', padding: '6px 8px' }}>BANK DETAILS</td></tr>
          <tr>
            <td style={{ border: '1px solid #666', padding: '6px 8px', fontWeight: 700 }}>Bank Name</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}>{w.bank_name || ''}</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px', fontWeight: 700 }}>A/C No</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}>{w.account_number || ''}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #666', padding: '6px 8px', fontWeight: 700 }}>IFSC</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}>{w.ifsc_code || ''}</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px', fontWeight: 700 }}>Holder Name</td>
            <td style={{ border: '1px solid #666', padding: '6px 8px' }}>{w.account_holder_name || ''}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const inputStyle = {
  padding: '8px 12px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
  background: 'var(--paper)',
  color: 'var(--ink)',
  width: '100%',
  boxSizing: 'border-box',
};

function EditableField({ label, value, onChange, type = 'text', options, textarea, placeholder, wide }) {
  return (
    <label className={'field' + (wide ? ' wide' : '')}>
      <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500 }}>{label}</span>
      {options ? (
        <select style={inputStyle} value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : textarea ? (
        <textarea
          rows={textarea}
          style={{ ...inputStyle, resize: 'vertical' }}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          type={type}
          style={inputStyle}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

const IconUser = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>);
const IconEdu = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>);
const IconOrg = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>);
const IconFam = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>);
const IconBank = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="5 6 12 3 19 6"/><line x1="4" y1="10" x2="4" y2="21"/><line x1="20" y1="10" x2="20" y2="21"/><line x1="8" y1="14" x2="8" y2="17"/><line x1="12" y1="14" x2="12" y2="17"/><line x1="16" y1="14" x2="16" y2="17"/></svg>);
const IconPhone = () => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>);

const SECTIONS = [
  { id: 'personal', label: 'Personal', icon: <IconUser /> },
  { id: 'education', label: 'Education', icon: <IconEdu /> },
  { id: 'organizations', label: 'Organizations', icon: <IconOrg /> },
  { id: 'family', label: 'Family', icon: <IconFam /> },
  { id: 'bank', label: 'Bank', icon: <IconBank /> },
];

function findNgo(ngos, ngoId) {
  if (!ngoId || !ngos || !ngos.length) return null;
  return ngos.find(n => n.id === ngoId) || null;
}

export default function HRForms() {
  const { fetchWorkers, fetchWorkerById, updateWorker, fetchNGOs } = useHR();
  const [workers, setWorkers] = useState([]);
  const [ngos, setNgos] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [activeSection, setActiveSection] = useState('personal');
  const contentRef = useRef(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    fetchWorkers().then(setWorkers).catch((err) => console.error('API error:', err.message)).finally(() => setLoading(false));
    fetchNGOs().then(setNgos).catch((err) => console.error('API error:', err.message));
  }, []);

  const filtered = workers.filter((w) => {
    const q = search.toLowerCase();
    const matchQ = !q ||
      (w.name || '').toLowerCase().includes(q) ||
      (w.email || '').toLowerCase().includes(q) ||
      (w.department || '').toLowerCase().includes(q);
    if (!matchQ) return false;
    if (statusFilter === 'incomplete') return formCompletion(w).pct < 100;
    if (statusFilter) return statusOf(w) === statusFilter;
    return true;
  });

  const totalCount = workers.length;
  const activeCount = workers.filter((w) => statusOf(w) === 'active').length;
  const incompleteCount = workers.filter((w) => formCompletion(w).pct < 100).length;

  const handleCardClick = async (worker) => {
    setSelectedWorker(worker);
    setLoadingPreview(true);
    setSaveMsg('');
    setActiveSection('personal');
    try {
      const data = await fetchWorkerById(worker.id);
      setPreviewData(data);
      setForm(data ? JSON.parse(JSON.stringify(data)) : null);
    } catch (e) {
      console.error('Error fetching worker:', e.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleBack = () => {
    setSelectedWorker(null);
    setPreviewData(null);
    setForm(null);
    setSaveMsg('');
  };

  const cancelEdit = () => {
    setForm(previewData ? JSON.parse(JSON.stringify(previewData)) : null);
    setSaveMsg('');
  };

  const setField = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const setCorrField = (key) => (val) =>
    setForm((f) => ({ ...f, correspondence: { ...(f.correspondence || {}), [key]: val } }));

  const setArrayItem = (key) => (i, field, val) =>
    setForm((f) => {
      const arr = [...((f[key] || []))];
      if (!arr[i]) arr[i] = {};
      arr[i] = { ...arr[i], [field]: val };
      return { ...f, [key]: arr };
    });

  const removeArrayItem = (key) => (i) =>
    setForm((f) => ({ ...f, [key]: (f[key] || []).filter((_, idx) => idx !== i) }));

  const addArrayItem = (key) => () =>
    setForm((f) => ({ ...f, [key]: [...(f[key] || []), {}] }));

  const save = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = { ...form };
      payload.education = (payload.education || []).filter((e) => e.degree || e.institution || e.university || e.year || e.year_of_passing || e.percentage || e.from_year || e.to_year);
      payload.previous_organizations = (payload.previous_organizations || []).filter((o) => o.name || o.organization_name || o.role || o.designation || o.from_year || o.to_year);
      payload.family = (payload.family || []).filter((f) => f.name || f.relationship || f.occupation || f.phone || f.dob);
      payload.references = (payload.references || []).filter((r) => r.name || r.designation || r.organization || r.phone);
      await updateWorker(previewData.id, payload);
      const fresh = await fetchWorkerById(previewData.id);
      setPreviewData(fresh);
      setForm(fresh ? JSON.parse(JSON.stringify(fresh)) : null);
      setSaveMsg('Changes saved successfully.');
    } catch (e) {
      console.error('Error saving worker:', e.message);
      setSaveMsg('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const scrollToSection = (id) => {
    const el = contentRef.current;
    const node = sectionRefs.current[id];
    if (el && node) {
      const diff = node.getBoundingClientRect().top - el.getBoundingClientRect().top;
      el.scrollTo({ top: el.scrollTop + diff - 64, behavior: 'smooth' });
    }
    setActiveSection(id);
  };

  const onContentScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    let current = SECTIONS[0].id;
    for (const s of SECTIONS) {
      const node = sectionRefs.current[s.id];
      if (node && node.getBoundingClientRect().top - top <= 80) current = s.id;
    }
    setActiveSection(current);
  };

  const d = previewData;
  const f = form || d;
  const GENDERS = ['Male', 'Female', 'Other'];
  const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];

  return (
    <>
      <style>{`
        .panel-hr .hrf-stats { display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap; }
        .panel-hr .hrf-stat { background:var(--paper); border:1px solid var(--line); border-radius:var(--radius-sm); padding:14px 18px; flex:1; min-width:150px; box-shadow:var(--shadow); display:flex; align-items:center; gap:12px; }
        .panel-hr .hrf-stat-num { font-size:26px; font-weight:700; line-height:1; color:var(--ink); }
        .panel-hr .hrf-stat-lbl { font-size:11px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.05em; margin-top:3px; }
        .panel-hr .hrf-stat-dot { width:34px; height:34px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .panel-hr .hrf-toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:22px; }
        .panel-hr .hrf-search { position:relative; flex:1; min-width:220px; }
        .panel-hr .hrf-search svg { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--ink-soft); pointer-events:none; }
        .panel-hr .hrf-search input { width:100%; padding:10px 14px 10px 36px; border:1px solid var(--line); border-radius:var(--radius-sm); font-size:14px; font-family:inherit; outline:none; background:var(--paper); color:var(--ink); box-sizing:border-box; }
        .panel-hr .hrf-search input:focus { border-color:var(--sage); }
        .panel-hr .hrf-status-select { padding:10px 14px; border:1px solid var(--line); border-radius:var(--radius-sm); font-size:13px; font-family:inherit; background:var(--paper); color:var(--ink); outline:none; cursor:pointer; }
        .panel-hr .hrf-grid-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:22px; }
        .panel-hr .hrf-card { border-radius:16px; overflow:hidden; background:var(--paper); border:1px solid var(--line); box-shadow:var(--shadow); cursor:pointer; transition:transform .2s ease, box-shadow .2s ease; display:flex; flex-direction:column; }
        .panel-hr .hrf-card:hover { transform:translateY(-4px); box-shadow:0 14px 40px rgba(0,0,0,.14); }
        .panel-hr .hrf-doc { position:relative; height:186px; background:linear-gradient(180deg,#e8ecf1,#dde2e9); overflow:hidden; flex-shrink:0; }
        .panel-hr .hrf-doc-label { position:absolute; top:10px; left:10px; z-index:2; font-size:10px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; color:var(--ink-soft); background:rgba(255,255,255,.88); padding:3px 9px; border-radius:6px; display:inline-flex; align-items:center; gap:6px; }
        .panel-hr .hrf-doc-paper { position:absolute; top:16px; left:50%; width:297px; height:421px; margin-left:-148px; background:#fff; box-shadow:0 8px 22px rgba(0,0,0,.22); overflow:hidden; border-radius:2px; }
        .panel-hr .hrf-doc-paper > div { transform:scale(.5); transform-origin:top left; }
        .panel-hr .hrf-status-pill { position:absolute; top:10px; right:10px; z-index:2; padding:3px 10px; border-radius:10px; font-size:11px; font-weight:600; text-transform:capitalize; color:#fff; box-shadow:0 2px 6px rgba(0,0,0,.18); }
        .panel-hr .hrf-body { padding:16px 18px 18px; display:flex; flex-direction:column; gap:12px; flex:1; }
        .panel-hr .hrf-id { display:flex; align-items:center; gap:12px; }
        .panel-hr .hrf-avatar { width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:17px; flex-shrink:0; overflow:hidden; }
        .panel-hr .hrf-avatar img { width:100%; height:100%; object-fit:cover; }
        .panel-hr .hrf-id-name { font-weight:700; font-size:15px; color:var(--ink); line-height:1.25; }
        .panel-hr .hrf-id-dept { font-size:12px; color:var(--ink-soft); }
        .panel-hr .hrf-progress-label { display:flex; justify-content:space-between; font-size:11px; color:var(--ink-soft); font-weight:600; margin-bottom:5px; }
        .panel-hr .hrf-progress-track { height:6px; border-radius:99px; background:var(--line); overflow:hidden; }
        .panel-hr .hrf-progress-fill { height:100%; border-radius:99px; transition:width .3s ease; background:var(--sage); }
        .panel-hr .hrf-chips { display:flex; flex-wrap:wrap; gap:6px; }
        .panel-hr .hrf-chip { display:inline-flex; align-items:center; gap:5px; font-size:11px; padding:3px 9px; border-radius:99px; background:var(--sage-soft); color:var(--ink); max-width:100%; }
        .panel-hr .hrf-chip span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .panel-hr .hrf-open { margin-top:auto; justify-content:center; }
        .panel-hr .hrf-detail { display:flex; flex-direction:column; }
        .panel-hr .hrf-detail-top { display:flex; align-items:center; gap:14px; padding:14px 20px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
        .panel-hr .hrf-detail-id { display:flex; align-items:center; gap:12px; min-width:0; flex:1; }
        .panel-hr .hrf-detail-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .panel-hr .hrf-detail-nav { display:flex; gap:4px; padding:10px 20px; border-bottom:1px solid var(--line); overflow-x:auto; background:var(--paper); scrollbar-width:none; }
        .panel-hr .hrf-detail-nav::-webkit-scrollbar { display:none; }
        .panel-hr .hrf-nav-item { display:inline-flex; align-items:center; gap:7px; padding:8px 14px; border-radius:8px; border:none; background:transparent; color:var(--ink-soft); font-size:13px; font-weight:600; font-family:inherit; cursor:pointer; white-space:nowrap; transition:all .15s; }
        .panel-hr .hrf-nav-item:hover { background:var(--sage-soft); color:var(--ink); }
        .panel-hr .hrf-nav-item.active { background:var(--sage); color:#fff; }
        .panel-hr .hrf-detail-body { max-height:calc(100vh - 330px); overflow-y:auto; padding:24px 26px 30px; }
        .panel-hr .hrf-section { margin-bottom:32px; }
        .panel-hr .hrf-section-title { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
        .panel-hr .hrf-section-title h3 { margin:0; font-size:15px; }
        .panel-hr .hrf-section-icon { display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:9px; background:var(--sage-soft); color:var(--sage); flex-shrink:0; }
        .panel-hr .hrf-section-count { margin-left:auto; font-size:11px; font-weight:700; color:var(--ink-soft); background:var(--line); padding:2px 10px; border-radius:99px; }
        .panel-hr .hrf-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px 14px; }
        .panel-hr .hrf-grid .field.wide { grid-column:1 / -1; }
        .panel-hr .hrf-entry { border:1px solid var(--line); border-radius:var(--radius-sm); padding:16px; margin-bottom:12px; background:var(--paper); }
        .panel-hr .hrf-entry-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .panel-hr .hrf-entry-title { font-weight:600; font-size:13px; color:var(--ink); display:flex; align-items:center; gap:8px; }
        .panel-hr .hrf-add { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; color:var(--sage); background:var(--sage-soft); border:none; padding:5px 11px; border-radius:7px; cursor:pointer; font-family:inherit; }
        .panel-hr .hrf-add:hover { filter:brightness(.97); }
        .panel-hr .hrf-empty { border:1px dashed var(--line); border-radius:var(--radius-sm); padding:20px; text-align:center; color:var(--ink-soft); font-size:13px; background:var(--paper); }
        .panel-hr .hrf-print-btn { background:#dc2626; color:#fff; border-color:#dc2626; }
        .panel-hr .hrf-print-btn:hover { background:#b91c1c; color:#fff; }
        @media (max-width:640px) {
          .panel-hr .hrf-grid-cards { grid-template-columns:1fr; }
          .panel-hr .hrf-detail-top { padding:12px 14px; }
          .panel-hr .hrf-detail-actions { width:100%; }
          .panel-hr .hrf-detail-body { padding:16px; max-height:none; overflow:visible; }
          .panel-hr .hrf-stat { min-width:calc(50% - 5px); }
        }
      `}</style>

      {/* ── BOX GRID VIEW ── */}
      {!selectedWorker && (
        <div className="card">
          <div className="card-head">
            <h3>HR Forms</h3>
            <span className="sub">Volunteer onboarding forms</span>
          </div>
          <div className="card-pad">
            <div className="hrf-stats">
              <div className="hrf-stat">
                <span className="hrf-stat-dot" style={{ background: 'var(--sage-soft)', color: 'var(--sage)' }}><IconUser /></span>
                <div>
                  <div className="hrf-stat-num">{totalCount}</div>
                  <div className="hrf-stat-lbl">Total Employees</div>
                </div>
              </div>
              <div className="hrf-stat">
                <span className="hrf-stat-dot" style={{ background: 'rgba(22,101,52,0.12)', color: '#166534' }}><IconFam /></span>
                <div>
                  <div className="hrf-stat-num">{activeCount}</div>
                  <div className="hrf-stat-lbl">Active</div>
                </div>
              </div>
              <div className="hrf-stat">
                <span className="hrf-stat-dot" style={{ background: 'rgba(180,83,9,0.12)', color: '#b45309' }}><IconEdu /></span>
                <div>
                  <div className="hrf-stat-num">{incompleteCount}</div>
                  <div className="hrf-stat-lbl">Incomplete Forms</div>
                </div>
              </div>
            </div>

            <div className="hrf-toolbar">
              <div className="hrf-search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email, or department..."
                />
              </div>
              <select className="hrf-status-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="absconded">Absconded</option>
                <option value="offboarded">Offboarded</option>
                <option value="incomplete">Incomplete forms</option>
              </select>
            </div>

            <div className="hrf-grid-cards">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} aria-hidden="true" className="hrf-card">
                    <div className="sk" style={{ height: 186, borderRadius: 0 }} />
                    <div style={{ padding: 18 }}>
                      <div className="sk" style={{ width: '60%', height: 20, marginBottom: 8, borderRadius: 4 }} />
                      <div className="sk" style={{ width: '40%', height: 14, borderRadius: 4 }} />
                    </div>
                  </div>
                ))
              ) : (
                filtered.map((w) => {
                  const name = w.name || 'Unknown';
                  const color = avatarColorLocal(name);
                  const comp = formCompletion(w);
                  const joinDate = w.created_at ? new Date(w.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
                  return (
                    <div key={w.id} className="hrf-card" onClick={() => handleCardClick(w)}>
                      <div className="hrf-doc">
                        <span className="hrf-doc-label">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          Application Form
                        </span>
                        <div className="hrf-doc-paper">
                          <MiniFormPreview worker={w} />
                        </div>
                        <span className="hrf-status-pill" style={statusStyle(w)}>{statusOf(w)}</span>
                      </div>
                      <div className="hrf-body">
                        <div className="hrf-id">
                          <span className="hrf-avatar" style={{ background: tint(color), color }}>
                            {w.photo_url ? <img src={w.photo_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : initialsFn(name)}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div className="hrf-id-name">{name}</div>
                            <div className="hrf-id-dept">{w.department ? deptLabel(w.department) : 'Team Member'}</div>
                          </div>
                        </div>
                        <div>
                          <div className="hrf-progress-label">
                            <span>Form completeness</span>
                            <span>{comp.pct}%</span>
                          </div>
                          <div className="hrf-progress-track">
                            <div className="hrf-progress-fill" style={{ width: comp.pct + '%', background: comp.pct === 100 ? '#166534' : comp.pct >= 60 ? 'var(--sage)' : '#c08a2e' }} />
                          </div>
                        </div>
                        <div className="hrf-chips">
                          {w.phone && <span className="hrf-chip"><IconPhone /><span>{w.phone}</span></span>}
                          {w.email && <span className="hrf-chip"><Mail size={11} /><span>{w.email}</span></span>}
                          {joinDate && <span className="hrf-chip"><span>Joined {joinDate}</span></span>}
                        </div>
                        <button className="btn btn-primary hrf-open" onClick={(e) => { e.stopPropagation(); handleCardClick(w); }}>
                          <Pencil size={14} /> Open Form
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
              {!loading && filtered.length === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 0', color: 'var(--ink-soft)' }}>
                  No volunteers found
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── FORM DETAIL VIEW ── */}
      {selectedWorker && (
        <div className="card hrf-detail">
          <div className="hrf-detail-top">
            <button className="btn btn-icon" onClick={handleBack} aria-label="Back">
              <ArrowLeft size={18} />
            </button>
            <div className="hrf-detail-id">
              {d?.photo_url ? (
                <img src={d.photo_url} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <span className="hrf-avatar" style={{ background: tint(avatarColorLocal((f?.name || '').trim() || '?')), color: avatarColorLocal((f?.name || '').trim() || '?') }}>
                  {initialsFn(f?.name || '')}
                </span>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{f?.name || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{deptLabel(f?.department) || '—'}</div>
              </div>
            </div>
            <div className="hrf-detail-actions">
              <button className="btn" onClick={cancelEdit} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn hrf-print-btn" onClick={() => setShowPrint(true)}>Print All Forms</button>
            </div>
          </div>

          <div className="hrf-detail-nav">
            {SECTIONS.map((s) => (
              <button key={s.id} className={'hrf-nav-item' + (activeSection === s.id ? ' active' : '')} onClick={() => scrollToSection(s.id)}>
                {s.icon}<span>{s.label}</span>
              </button>
            ))}
          </div>

          <div className="hrf-detail-body" ref={contentRef} onScroll={onContentScroll}>
            {saveMsg && (
              <div style={{ padding: '10px 14px', marginBottom: 18, borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, background: saveMsg.startsWith('Error') ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.12)', color: saveMsg.startsWith('Error') ? '#b91c1c' : '#166534' }}>
                {saveMsg}
              </div>
            )}
            {loadingPreview ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink-soft)' }}>Loading...</div>
            ) : d && f ? (
              <>
                {/* Personal Details */}
                <section className="hrf-section" id="hrf-personal" ref={(el) => (sectionRefs.current['personal'] = el)}>
                  <div className="hrf-section-title">
                    <span className="hrf-section-icon"><IconUser /></span>
                    <h3>Personal Details</h3>
                  </div>
                  <div className="hrf-grid">
                    <EditableField label="Full Name" value={f.name} onChange={setField('name')} />
                    <EditableField label="Email" value={f.email} onChange={setField('email')} />
                    <EditableField label="Phone" value={f.phone} onChange={setField('phone')} />
                    <EditableField label="Alt. Phone" value={f.alternate_phone} onChange={setField('alternate_phone')} />
                    <EditableField label="Father / Husband Name" value={f.father_husband_name} onChange={setField('father_husband_name')} />
                    <EditableField label="Gender" value={f.gender} onChange={setField('gender')} options={GENDERS} />
                    <EditableField label="Date of Birth" type="date" value={f.dob ? f.dob.slice(0, 10) : ''} onChange={setField('dob')} />
                    <EditableField label="Marital Status" value={f.marital_status} onChange={setField('marital_status')} options={MARITAL} />
                    <EditableField label="PAN Number" value={f.pan_number} onChange={setField('pan_number')} />
                    <EditableField label="Aadhaar Number" value={f.aadhar_number} onChange={setField('aadhar_number')} />
                    <EditableField label="Address" value={f.address} onChange={setField('address')} textarea={2} wide />
                    <EditableField label="City" value={f.city} onChange={setField('city')} />
                    <EditableField label="State" value={f.state} onChange={setField('state')} />
                    <EditableField label="Pincode" value={f.pincode} onChange={setField('pincode')} />
                    <EditableField label="Permanent Address" value={f.permanent_address} onChange={setField('permanent_address')} textarea={2} wide />
                  </div>
                  {d.correspondence && (
                    <>
                      <div className="hrf-section-title" style={{ marginTop: 20 }}>
                        <span className="hrf-section-icon" style={{ background: 'var(--clay-soft)', color: 'var(--clay)' }}><IconOrg /></span>
                        <h3>Correspondence Address</h3>
                      </div>
                      <div className="hrf-grid">
                        <EditableField label="Address" value={f.correspondence?.address} onChange={setCorrField('address')} textarea={2} wide />
                        <EditableField label="City" value={f.correspondence?.city} onChange={setCorrField('city')} />
                        <EditableField label="State" value={f.correspondence?.state} onChange={setCorrField('state')} />
                        <EditableField label="Pincode" value={f.correspondence?.pincode} onChange={setCorrField('pincode')} />
                      </div>
                    </>
                  )}
                </section>

                {/* Education */}
                <section className="hrf-section" id="hrf-education" ref={(el) => (sectionRefs.current['education'] = el)}>
                  <div className="hrf-section-title">
                    <span className="hrf-section-icon"><IconEdu /></span>
                    <h3>Education</h3>
                    <span className="hrf-section-count">{f.education?.length || 0}</span>
                    <button className="hrf-add" onClick={addArrayItem('education')}><Plus size={13} /> Add</button>
                  </div>
                  {!f.education || f.education.length === 0 ? (
                    <div className="hrf-empty">No education entries yet. Click “Add” to include qualification details.</div>
                  ) : f.education.map((e, i) => (
                    <div key={i} className="hrf-entry">
                      <div className="hrf-entry-head">
                        <span className="hrf-entry-title"><IconEdu /> Entry {i + 1}</span>
                        <button className="btn btn-icon" onClick={() => removeArrayItem('education')(i)} aria-label="Remove entry" style={{ color: '#dc2626' }}><Trash size={15} /></button>
                      </div>
                      <div className="hrf-grid">
                        <EditableField label="Degree" value={e.degree} onChange={(v) => setArrayItem('education')(i, 'degree', v)} />
                        <EditableField label="Institution" value={e.institution} onChange={(v) => setArrayItem('education')(i, 'institution', v)} />
                        <EditableField label="University" value={e.university} onChange={(v) => setArrayItem('education')(i, 'university', v)} />
                        <EditableField label="Year of Passing" value={e.year_of_passing || e.year || ''} onChange={(v) => setArrayItem('education')(i, 'year_of_passing', v)} />
                        <EditableField label="From Year" value={e.from_year} onChange={(v) => setArrayItem('education')(i, 'from_year', v)} />
                        <EditableField label="To Year" value={e.to_year} onChange={(v) => setArrayItem('education')(i, 'to_year', v)} />
                        <EditableField label="Percentage / Grade" value={e.percentage} onChange={(v) => setArrayItem('education')(i, 'percentage', v)} wide />
                      </div>
                    </div>
                  ))}
                </section>

                {/* Previous Organizations */}
                <section className="hrf-section" id="hrf-organizations" ref={(el) => (sectionRefs.current['organizations'] = el)}>
                  <div className="hrf-section-title">
                    <span className="hrf-section-icon"><IconOrg /></span>
                    <h3>Previous Organizations</h3>
                    <span className="hrf-section-count">{f.previous_organizations?.length || 0}</span>
                    <button className="hrf-add" onClick={addArrayItem('previous_organizations')}><Plus size={13} /> Add</button>
                  </div>
                  {!f.previous_organizations || f.previous_organizations.length === 0 ? (
                    <div className="hrf-empty">No previous organizations recorded.</div>
                  ) : f.previous_organizations.map((o, i) => (
                    <div key={i} className="hrf-entry">
                      <div className="hrf-entry-head">
                        <span className="hrf-entry-title"><IconOrg /> Organization {i + 1}</span>
                        <button className="btn btn-icon" onClick={() => removeArrayItem('previous_organizations')(i)} aria-label="Remove entry" style={{ color: '#dc2626' }}><Trash size={15} /></button>
                      </div>
                      <div className="hrf-grid">
                        <EditableField label="Organization Name" value={o.organization_name || o.name} onChange={(v) => setArrayItem('previous_organizations')(i, 'organization_name', v)} />
                        <EditableField label="Role / Designation" value={o.role || o.designation} onChange={(v) => setArrayItem('previous_organizations')(i, 'role', v)} />
                        <EditableField label="From Year" value={o.from_year} onChange={(v) => setArrayItem('previous_organizations')(i, 'from_year', v)} />
                        <EditableField label="To Year" value={o.to_year} onChange={(v) => setArrayItem('previous_organizations')(i, 'to_year', v)} />
                      </div>
                    </div>
                  ))}
                </section>

                {/* Family */}
                <section className="hrf-section" id="hrf-family" ref={(el) => (sectionRefs.current['family'] = el)}>
                  <div className="hrf-section-title">
                    <span className="hrf-section-icon"><IconFam /></span>
                    <h3>Family</h3>
                    <span className="hrf-section-count">{f.family?.length || 0}</span>
                    <button className="hrf-add" onClick={addArrayItem('family')}><Plus size={13} /> Add</button>
                  </div>
                  {!f.family || f.family.length === 0 ? (
                    <div className="hrf-empty">No family members recorded.</div>
                  ) : f.family.map((fm, i) => (
                    <div key={i} className="hrf-entry">
                      <div className="hrf-entry-head">
                        <span className="hrf-entry-title"><IconFam /> Member {i + 1}</span>
                        <button className="btn btn-icon" onClick={() => removeArrayItem('family')(i)} aria-label="Remove entry" style={{ color: '#dc2626' }}><Trash size={15} /></button>
                      </div>
                      <div className="hrf-grid">
                        <EditableField label="Name" value={fm.name} onChange={(v) => setArrayItem('family')(i, 'name', v)} />
                        <EditableField label="Relationship" value={fm.relationship} onChange={(v) => setArrayItem('family')(i, 'relationship', v)} />
                        <EditableField label="Occupation" value={fm.occupation} onChange={(v) => setArrayItem('family')(i, 'occupation', v)} />
                        <EditableField label="Phone" value={fm.phone} onChange={(v) => setArrayItem('family')(i, 'phone', v)} />
                      </div>
                    </div>
                  ))}
                </section>

                {/* Bank Details */}
                <section className="hrf-section" id="hrf-bank" ref={(el) => (sectionRefs.current['bank'] = el)}>
                  <div className="hrf-section-title">
                    <span className="hrf-section-icon"><IconBank /></span>
                    <h3>Bank Details</h3>
                  </div>
                  <div className="hrf-grid">
                    <EditableField label="Bank Name" value={f.bank_name} onChange={setField('bank_name')} />
                    <EditableField label="Account Holder" value={f.account_holder_name} onChange={setField('account_holder_name')} />
                    <EditableField label="IFSC Code" value={f.ifsc_code} onChange={setField('ifsc_code')} />
                    <EditableField label="Account Number" value={f.account_number} onChange={setField('account_number')} />
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── PRINT OVERLAY ── */}
      {showPrint && previewData && (
        <PrintForms
          data={{
            personal: {
              fullName: previewData.name || '',
              email: previewData.email || '',
              phone: previewData.phone || '',
              altPhone: previewData.alternate_phone || '',
              fatherHusband: previewData.father_husband_name || '',
              gender: previewData.gender || '',
              dob: previewData.dob ? previewData.dob.slice(0, 10) : '',
              maritalStatus: previewData.marital_status || '',
              address: previewData.address || '',
              city: previewData.city || '',
              state: previewData.state || '',
              pincode: previewData.pincode || '',
              panNumber: previewData.pan_number || '',
              aadhaarNumber: previewData.aadhar_number || '',
              permanentAddress: previewData.permanent_address || '',
              corrAddress: previewData.correspondence?.address || '',
              corrCity: previewData.correspondence?.city || '',
              corrState: previewData.correspondence?.state || '',
              corrPincode: previewData.correspondence?.pincode || '',
            },
            education: (previewData.education || []).map((e) => ({
              degree: e.degree || '',
              institution: e.institution || '',
              university: e.university || '',
              year: (e.year_of_passing || e.year)?.toString() || '',
              percentage: e.percentage?.toString() || '',
            })),
            organizations: (previewData.previous_organizations || []).map((o) => ({
              name: o.organization_name || o.name || '',
              role: o.role || o.designation || '',
              fromYear: o.from_year?.toString() || '',
              toYear: o.to_year?.toString() || '',
            })),
            family: (previewData.family || []).map((f) => ({
              name: f.name || '',
              relationship: f.relationship || '',
              occupation: f.occupation || '',
              phone: f.phone || '',
              dob: f.dob ? f.dob.slice(0, 10) : '',
            })),
            references: (previewData.references || []).map((r) => ({
              name: r.name || '',
              designation: r.designation || '',
              organization: r.organization || '',
              phone: r.phone || '',
            })),
            bank: {
              bankName: previewData.bank_name || '',
              accountHolder: previewData.account_holder_name || '',
              ifsc: previewData.ifsc_code || '',
              accountNo: previewData.account_number || '',
            },
            declarationDate: previewData.declaration_date ? previewData.declaration_date.slice(0, 10) : previewData.created_at ? previewData.created_at.slice(0, 10) : '',
            place: previewData.declaration_place || 'Mumbai',
            photo_url: previewData.photo_url || '',
            signature_url: previewData.signature_url || '',
            ngoName: findNgo(ngos, previewData.ngo_id)?.name || 'Organization',
            ngoCode: findNgo(ngos, previewData.ngo_id)?.code || '',
          }}
          onClose={() => setShowPrint(false)}
        />
      )}
    </>
  );
}

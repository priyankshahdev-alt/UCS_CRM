import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Check, TriangleAlert, Trash2, Settings, ChevronDown, Eye, EyeOff, Download, XCircle, Clock, UserPlus, Upload, Unlink } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete, listTemporaryAccess, revokeTemporaryAccess, getHideOldDonors, setHideOldDonors, setHideOldDonorsSchedule } from '../api/auth';
import { api } from '../../../api/auth';
import { toast } from '../../../components/Toast';
import { isFreshStation } from '../../../lib/stations';
import { istMonthKey } from '../../../utils/istDate';
import { dispositionGroupOf, dispositionLabelOf } from '../../../lib/dispositions';
import TemporaryAccessModal from './TemporaryAccessModal';
import DonorStacksModal from './DonorStacksModal';

// IST (Asia/Kolkata) helpers for temporary-access badges: the grant stores
// UTC timestamptz; admins read IST, so every display goes through the zone
// explicitly rather than the browser's local time.
const fmtIstShort = (v) => {
  const d = new Date(v);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
};
const fmtIstDateTime = (v) => {
  const d = new Date(v);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const NGO_NAME_COLORS = {
  bsct: '#2563eb',
  aflf: '#16a34a',
  mann: '#ec4899',
};

function groupOfNameLocal(name) {
  const k = String(name || '').trim().toLowerCase();
  if (NGO_NAME_COLORS[k]) return k;
  if (k.includes('bsct')) return 'bsct';
  if (k.includes('aflf')) return 'aflf';
  if (k.includes('mann')) return 'mann';
  return 'other';
}

function StationNgoColumns({ stations, froWorkers, allNgos, searchTerm, fresh, renderRow }) {
  const term = String(searchTerm || '').trim().toLowerCase();
  const base = (stations || []).filter(s => fresh ? isFreshStation(s.station) : !isFreshStation(s.station));
  const searched = term ? base.filter(s => String(s.station || '').toLowerCase().includes(term) || String(s.fro_worker_name || '').toLowerCase().includes(term)) : base;

  // One representative NGO per known group (BSCT / AFLF / MANN).
  const groupNgo = {};
  for (const n of (allNgos || [])) {
    const g = groupOfNameLocal(n.name);
    if ((g === 'bsct' || g === 'aflf' || g === 'mann') && !groupNgo[g]) groupNgo[g] = n;
  }

  const froNameOf = (id) => (froWorkers || []).find(f => String(f.id) === String(id))?.name || null;

  return (
    <>
    <style>{`.sm-no-scrollbar::-webkit-scrollbar{display:none}.sm-no-scrollbar{scrollbar-width:none;-ms-overflow-style:none}`}</style>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, alignItems: 'start' }}>
      {['bsct', 'aflf', 'mann'].map(g => {
        const ngo = groupNgo[g];
        const color = NGO_NAME_COLORS[g];
        const label = g.toUpperCase();
        const ngoId = ngo?.id;
        const rows = searched
          .filter(s => (s.ngos || []).some(n => groupOfNameLocal(n.ngo_name || n.name) === g))
          .sort((a, b) => {
                const pa = String(a.station || ''); const pb = String(b.station || '');
                return pa.localeCompare(pb, undefined, { numeric: true });
              });
        // Total donors across all stations of this NGO (stable regardless of search).
        const allNgoRows = base.filter(s => (s.ngos || []).some(n => groupOfNameLocal(n.ngo_name || n.name) === g));
        const totalDonors = allNgoRows.reduce((sum, s) => sum + (Number(s.donor_count?.[ngoId]) || 0) + (Number(s.high_tier_donor_count?.[ngoId]) || 0), 0);
        return (
          <div key={g} style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 0, overflow: 'hidden', background: '#fff' }}>
            <div style={{ background: color, color: '#fff', padding: '8px 12px', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{label}</span>
              <span style={{ opacity: 0.85, fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>{rows.length} station{rows.length === 1 ? '' : 's'}</span>
                <span>· {totalDonors.toLocaleString('en-IN')} donor{totalDonors === 1 ? '' : 's'}</span>
              </span>
            </div>
            <div className="sm-no-scrollbar" style={{ maxHeight: 'none', overflowY: 'visible' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', position: 'sticky', top: 0, background: '#f8fafc', zIndex: 2 }}>Station</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--ink-soft)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', position: 'sticky', top: 0, background: '#f8fafc', zIndex: 2 }}>FRO Name</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={2} style={{ padding: '14px 10px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: 12 }}>No stations</td>
                    </tr>
                  ) : rows.map(s => (renderRow ? renderRow(s, (allNgos || []).find(n => String(n.id) === String((groupNgo && groupNgo[g])?.id)) || null) : null))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}

// Planned station-code mapping (station-rename-mapping.xlsx): old code ->
// new code per NGO. Drives the green auto-suggestion in the bulk-rename modal.
const STATION_RENAME_MAP = {
  'M-2':   { BSCT: 'BOD-1',  AFLF: 'AOD-1',  MANN: 'MOD-1' },
  'ND-1':  { BSCT: 'BOD-2',  AFLF: 'AOD-2',  MANN: 'MOD-2' },
  'ND-2':  { BSCT: 'BOD-3',  AFLF: 'AOD-3',  MANN: 'MOD-3' },
  'ND-3':  { BSCT: 'BOD-4',  AFLF: 'AOD-4',  MANN: 'MOD-4' },
  'ND-4':  { BSCT: 'BOD-5',  AFLF: 'AOD-5',  MANN: 'MOD-5' },
  'ND-5':  { BSCT: 'BOD-6',  AFLF: 'AOD-6',  MANN: 'MOD-6' },
  'ND-6':  { BSCT: 'BOD-7',  AFLF: 'AOD-7',  MANN: 'MOD-7' },
  'ND-7':  { BSCT: 'BOD-8',  AFLF: 'AOD-8',  MANN: 'MOD-8' },
  'ND-8':  { BSCT: 'BOD-9',  AFLF: 'AOD-9',  MANN: 'MOD-9' },
  'DH-1':  { BSCT: 'BOD-10', AFLF: 'AOD-10', MANN: 'MOD-10' },
  'DH-2':  { BSCT: 'BOD-11', AFLF: 'AOD-11', MANN: 'MOD-11' },
  'DH-3':  { BSCT: 'BOD-12', AFLF: 'AOD-12', MANN: 'MOD-12' },
  'DH-4':  { BSCT: 'BOD-13', AFLF: 'AOD-13', MANN: 'MOD-13' },
  'DH-5':  { BSCT: 'BOD-14', AFLF: 'AOD-14', MANN: 'MOD-14' },
  'DH-6':  { BSCT: 'BOD-15', AFLF: 'AOD-15', MANN: 'MOD-15' },
  'DH-7':  { BSCT: 'BOD-16', AFLF: 'AOD-16', MANN: 'MOD-16' },
  'DH-8':  { BSCT: 'BOD-17', AFLF: 'AOD-17', MANN: 'MOD-17' },
  'DH-9':  { BSCT: 'BOD-18', AFLF: 'AOD-18', MANN: 'MOD-18' },
  'DH-10': { BSCT: 'BOD-19', AFLF: 'AOD-19', MANN: 'MOD-19' },
  'DH-11': { BSCT: 'BOD-20', AFLF: 'AOD-20', MANN: 'MOD-20' },
  'DH-12': { BSCT: 'BOD-21', AFLF: 'AOD-21', MANN: 'MOD-21' },
  'DH-13': { BSCT: 'BOD-22', AFLF: 'AOD-22', MANN: 'MOD-22' },
  'DH-14': { BSCT: 'BOD-23', AFLF: 'AOD-23', MANN: 'MOD-23' },
  'FD-1':  { BSCT: 'BFD-1',  AFLF: 'AFD-1',  MANN: 'MFD-1' },
  'FD-2':  { BSCT: 'BFD-2',  AFLF: 'AFD-2',  MANN: 'MFD-2' },
  'FD-3':  { BSCT: 'BFD-3',  AFLF: 'AFD-3',  MANN: 'MFD-3' },
  'FD-4':  { BSCT: 'BFD-4',  AFLF: 'AFD-4',  MANN: 'MFD-4' },
  'FD-5':  { BSCT: 'BFD-5',  AFLF: 'AFD-5',  MANN: 'MFD-5' },
  'FD-6':  { BSCT: 'BFD-6',  AFLF: 'AFD-6',  MANN: 'MFD-6' },
  'FD-7':  { BSCT: 'BFD-7',  AFLF: 'AFD-7',  MANN: 'MFD-7' },
  'FD-8':  { BSCT: 'BFD-8',  AFLF: 'AFD-8',  MANN: 'MFD-8' },
  'FD-9':  { BSCT: 'BFD-9',  AFLF: 'AFD-9',  MANN: 'MFD-9' },
  'FD-10': { BSCT: 'BFD-10', AFLF: 'AFD-10', MANN: 'MFD-10' },
  'FD-11': { BSCT: 'BFD-11', AFLF: 'AFD-11', MANN: 'MFD-11' },
  'FD-12': { BSCT: 'BFD-12', AFLF: 'AFD-12', MANN: 'MFD-12' },
  'FD-13': { BSCT: 'BFD-13', AFLF: 'AFD-13', MANN: 'MFD-13' },
  'FD-14': { BSCT: 'BFD-14', AFLF: 'AFD-14', MANN: 'MFD-14' },
  'FD-15': { BSCT: 'BFD-15', AFLF: 'AFD-15', MANN: 'MFD-15' },
  'FD-16': { BSCT: 'BFD-16', AFLF: 'AFD-16', MANN: 'MFD-16' },
  'FD-17': { BSCT: 'BFD-17', AFLF: 'AFD-17', MANN: 'MFD-17' },
  'FD-18': { BSCT: 'BFD-18', AFLF: 'AFD-18', MANN: 'MFD-18' },
  'FD-19': { BSCT: 'BFD-19', AFLF: 'AFD-19', MANN: 'MFD-19' },
  'FD-20': { BSCT: 'BFD-20', AFLF: 'AFD-20', MANN: 'MFD-20' },
  'FD-21': { BSCT: 'BFD-21', AFLF: 'AFD-21', MANN: 'MFD-21' },
  'FD-22': { BSCT: 'BFD-22', AFLF: 'AFD-22', MANN: 'MFD-22' },
  'FD-23': { BSCT: 'BFD-23', AFLF: 'AFD-23', MANN: 'MFD-23' },
};

function OldDataUploadModal({ station, ngoId, onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError('');

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        setPreview(json.slice(0, 20));
      } catch {
        setError('Failed to parse file. Ensure it is a valid .xlsx file.');
      }
    };
    reader.readAsArrayBuffer(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    setResult(null);
    setProgressLabel('Reading file...');
    await new Promise(r => setTimeout(r, 200));
    setProgress(30);
    setProgressLabel('Uploading & processing...');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (ngoId) fd.append('ngo_id', ngoId);
      setProgress(60);
      setProgressLabel('Creating profiles & assignments...');
      const res = await api(`/ngo-admin/stations/${encodeURIComponent(station)}/upload-old-data`, { method: 'POST', body: fd, _prefix: 'ucs' });
      setProgress(100);
      setProgressLabel('Complete!');
      setResult(res);
    } catch (err) {
      setError(err.message);
      setProgress(0);
      setProgressLabel('');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="modal-head">
          <h3>Upload Old Data — {station}</h3>
          <button className="btn btn-sm btn-outline" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: '#6b7280', background: '#f9fafb', padding: '10px 12px', borderRadius: 6, marginBottom: 12 }}>
            Upload an Excel file. Donors will be assigned to station <strong>{station}</strong> across all your NGOs.
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 12, background: 'var(--bg)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--line)' }}>
            <strong>Required columns:</strong> <code>mobile</code><br />
            <strong>Optional:</strong> <code>name</code>, <code>amount</code>, <code>city</code>, <code>station</code>
          </div>
          <label className="field">
            File
            <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} />
          </label>

          {error && (
            <div style={{ padding: '10px 14px', marginTop: 12, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 13, color: '#991b1b' }}>
              {error}
            </div>
          )}

          {uploading && (
            <div style={{ marginTop: 12, padding: '14px 16px', background: '#f0f7ff', border: '1px solid #bdd3eb', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1e40af' }}>{progressLabel}</span>
                <span style={{ fontSize: 11, color: '#1e40af' }}>{progress}%</span>
              </div>
              <div style={{ width: '100%', height: 8, background: '#dbeafe', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: '#2563eb', borderRadius: 4, transition: 'width .3s ease' }} />
              </div>
            </div>
          )}

          {result && (
            <div style={{ padding: '12px 14px', marginTop: 12, borderRadius: 6, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 13, color: '#166534' }}>
              <strong style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Check size={14} /> {result.message}</strong><br />
              <div style={{ fontSize: 11, marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span><strong>{result.total_rows}</strong> rows</span>
                <span><strong>{result.created_profiles}</strong> new profiles</span>
                <span><strong>{result.created_assignments}</strong> assignments</span>
                {result.skipped_duplicate_assignments > 0 && <span><strong>{result.skipped_duplicate_assignments}</strong> skipped (duplicates)</span>}
              </div>
            </div>
          )}

          {preview.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Preview ({preview.length} rows)</span>
                {!result && (
                  <button className="btn btn-primary btn-sm" onClick={handleUpload} disabled={uploading || !file}>
                    {uploading ? `${progress}%` : 'Upload & Assign'}
                  </button>
                )}
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 240, overflowY: 'auto' }}>
                <table style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      {Object.keys(preview[0]).map(k => <th key={k}>{k}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => <td key={j}>{String(v).slice(0, 50)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-outline" onClick={() => { if (result && onUploaded) onUploaded(); else onClose(); }}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Groups rename rows by NGO (preserving first-appearance order) for the
// grouped card lists in the bulk-rename modal.
function groupRows(list) {
  const groups = [];
  const byNgo = new Map();
  for (const r of list) {
    if (!byNgo.has(r.ngo_name)) {
      byNgo.set(r.ngo_name, { ngo: r.ngo_name, items: [] });
      groups.push(byNgo.get(r.ngo_name));
    }
    byNgo.get(r.ngo_name).items.push(r);
  }
  return groups;
}

// Colored mini-badges showing what a rename touches (from the dry-run counts).
function ImpactBadges({ c }) {
  if (!c) return <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>—</span>;
  const badges = [
    { label: 'donors', value: c.fro_assignments ?? 0, bg: '#eff6ff', color: '#1e40af' },
    { label: 'transfers', value: c.fro_transfers ?? 0, bg: '#f5f3ff', color: '#6d28d9' },
    { label: 'queue', value: c.work_queue ?? 0, bg: '#fefce8', color: '#a16207' },
    { label: 'sessions', value: c.work_as_sessions ?? 0, bg: '#f0fdf4', color: '#15803d' },
    { label: 'profiles', value: c.donor_profiles_renamable ?? 0, bg: '#f0fdf4', color: '#166534' },
  ].filter(b => b.value > 0 || b.label === 'donors' || b.label === 'profiles');
  const amb = c.donor_profiles_ambiguous ?? 0;
  if (amb > 0) badges.push({ label: 'skipped (ambiguous)', value: amb, bg: '#ffedd5', color: '#c2410c' });
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {badges.map(b => (
        <span key={b.label} style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: b.bg, color: b.color, whiteSpace: 'nowrap' }}>
          {b.value.toLocaleString('en-IN')} {b.label}
        </span>
      ))}
    </span>
  );
}

// Categorized old-station picker for the bulk-rename modal: a popup listing
// every station grouped by NGO (BSCT / AFLF / MANN, unregistered last), with
// search, per-NGO donor counts and already-queued markers. Picking an entry
// fills the NGO and old-station fields in one click.
function StationPicker({ stations, value, queuedKeys, onSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const colorOf = (name) => NGO_NAME_COLORS[String(name || '').toLowerCase()] || '#6b7280';

  // Natural sort: prefix alphabetically, then trailing number (matches the
  // backend's station ordering in getStations).
  const parseStation = (s) => {
    const idx = s.lastIndexOf('-');
    if (idx === -1) return [s, 0];
    const num = parseInt(s.slice(idx + 1), 10);
    return [s.slice(0, idx), isNaN(num) ? 0 : num];
  };
  const byCode = (a, b) => {
    const [pA, nA] = parseStation(a.station);
    const [pB, nB] = parseStation(b.station);
    return pA !== pB ? pA.localeCompare(pB) : nA - nB;
  };

  // One entry per (station, NGO); stations with no NGO registration fall into
  // a trailing "No NGO" group.
  const groups = [];
  const byNgo = new Map();
  const addTo = (ngoName, entry) => {
    if (!byNgo.has(ngoName)) { byNgo.set(ngoName, { ngo: ngoName, items: [] }); groups.push(byNgo.get(ngoName)); }
    byNgo.get(ngoName).items.push(entry);
  };
  for (const s of stations) {
    const code = String(s.station || '').trim();
    if (!code) continue;
    if ((s.ngos || []).length === 0) {
      addTo('', {
        ngo_id: null,
        station: code,
        donorCount: Object.values(s.donor_count || {}).reduce((a, b) => a + b, 0),
        fro: s.fro_worker_name || null,
      });
    } else {
      for (const n of s.ngos) {
        addTo(n.ngo_name || 'Unknown', {
          ngo_id: n.ngo_id,
          station: code,
          donorCount: s.donor_count?.[n.ngo_id] || 0,
          fro: s.fro_worker_name || null,
        });
      }
    }
  }
  const tabOrder = (name) => {
    const NGO_SORT = ['BSCT', 'AFLF', 'MANN'];
    const i = NGO_SORT.indexOf(String(name || '').trim());
    return i === -1 ? 99 : i;
  };
  groups.sort((a, b) => {
    const ta = tabOrder(a.ngo), tb = tabOrder(b.ngo);
    if (ta !== tb) return ta - tb;
    if (!a.ngo || !b.ngo) return 0;
    return a.ngo.localeCompare(b.ngo);
  });
  for (const g of groups) g.items.sort(byCode);

  const term = search.trim().toLowerCase();
  const visibleGroups = term
    ? groups.map(g => ({ ...g, items: g.items.filter(it => it.station.toLowerCase().includes(term)) })).filter(g => g.items.length > 0)
    : groups;
  const totalEntries = groups.reduce((sum, g) => sum + g.items.length, 0);
  const visibleEntries = visibleGroups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '4px 8px', borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#fff', minHeight: 26, boxSizing: 'border-box', width: '100%' }}>
        <span style={{ color: value ? 'inherit' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: value ? 600 : 400 }}>
          {value || 'Pick station…'}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
      </div>

      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 200, marginTop: 2, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search station…"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 11, fontFamily: 'inherit', background: 'transparent' }}
              autoFocus />
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {visibleGroups.map(g => (
              <div key={g.ngo || '_none'}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: `${colorOf(g.ngo)}14`, borderBottom: '1px solid var(--line, #e5e7eb)' }}>
                  {g.ngo
                    ? <><span style={{ width: 8, height: 8, borderRadius: 999, background: colorOf(g.ngo), flexShrink: 0 }} /><strong style={{ fontSize: 11 }}>{g.ngo}</strong></>
                    : <strong style={{ fontSize: 11, color: 'var(--ink-soft)' }}>No NGO</strong>}
                  <span className="pill" style={{ background: g.ngo ? colorOf(g.ngo) : '#9ca3af', color: '#fff', fontSize: 9, marginLeft: 'auto' }}>{g.items.length}</span>
                </div>
                {g.items.map(it => {
                  const queued = queuedKeys?.has(`${g.ngo}|${it.station}`);
                  const selected = value === it.station;
                  return (
                    <div key={`${g.ngo}-${it.station}`}
                      onClick={() => { if (queued) return; onSelect(it.ngo_id, it.station); setOpen(false); }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '6px 10px', fontSize: 12, cursor: queued ? 'default' : 'pointer', opacity: queued ? 0.55 : 1, borderBottom: '1px solid var(--line, #e5e7eb)', background: selected ? '#f0fdf4' : 'transparent' }}
                      onMouseEnter={e => { if (!queued) e.currentTarget.style.background = selected ? '#f0fdf4' : '#f3f4f6'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = selected ? '#f0fdf4' : 'transparent'; }}>
                      <span style={{ fontWeight: 600 }}>{it.station}</span>
                      {queued
                        ? <span className="pill" style={{ background: '#f3f4f6', color: 'var(--ink-soft)', fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={9} /> Queued</span>
                        : <span style={{ fontSize: 10, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {it.donorCount > 0 && <>{it.donorCount.toLocaleString('en-IN')} donor{it.donorCount === 1 ? '' : 's'}</>}
                            {it.fro && <span> · {it.fro}</span>}
                            {it.donorCount === 0 && !it.fro && '—'}
                          </span>}
                    </div>
                  );
                })}
              </div>
            ))}
            {visibleEntries === 0 && (
              <div style={{ padding: '10px', fontSize: 11, color: 'var(--ink-soft)', textAlign: 'center' }}>No stations match “{search}”</div>
            )}
          </div>
          <div style={{ padding: '4px 8px', borderTop: '1px solid var(--line, #e5e7eb)', fontSize: 10, color: 'var(--ink-soft)', textAlign: 'right' }}>
            {visibleEntries} / {totalEntries} stations
          </div>
        </div>
      )}
    </div>
  );
}

function BulkRenameModal({ ngos, stations, defaultNgoId, onClose, onRenamed }) {
  const [step, setStep] = useState('input');        // input | preview | confirm | result
  const [mode, setMode] = useState('manual');       // manual | file
  const [mNgoId, setMNgoId] = useState(defaultNgoId || '');
  const [mOld, setMOld] = useState('');
  const [mNew, setMNew] = useState('');
  const [rows, setRows] = useState([]);             // [{ ngo_name, old_station, new_station }]
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState(null);     // dry-run response { ready, rows }
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [rowFilter, setRowFilter] = useState('');
  const [history, setHistory] = useState(null);    // rename-log batches

  const ngoNameById = (id) => ngos.find(n => String(n.id) === String(id))?.name || '';
  const ngoColor = (name) => NGO_NAME_COLORS[String(name || '').toLowerCase()] || '#6b7280';
  const queuedKeys = new Set(rows.map(r => `${r.ngo_name}|${r.old_station}`));
  const mNewRef = useRef(null);
  const suggestionFor = (ngoId, oldStation) => {
    const name = ngoNameById(ngoId);
    if (!name || !oldStation) return '';
    return STATION_RENAME_MAP[oldStation]?.[name] || '';
  };
  const suggestion = suggestionFor(mNgoId, mOld.trim());
  const pickOldStation = (ngoId, station) => {
    const nextNgoId = ngoId ? String(ngoId) : mNgoId;
    if (ngoId) setMNgoId(String(ngoId));
    setMOld(station);
    setMNew(suggestionFor(nextNgoId, station));
    setTimeout(() => mNewRef.current?.focus(), 0);
  };

  const removeRow = (r) => setRows(prev => prev.filter(x =>
    !(x.ngo_name === r.ngo_name && x.old_station === r.old_station && x.new_station === r.new_station)));

  const addManualRow = () => {
    const ngoName = ngoNameById(mNgoId);
    const oldS = mOld.trim();
    const newS = mNew.trim();
    if (!ngoName || !oldS || !newS) return;
    if (oldS === newS) { toast('Old and new station must differ', 'error'); return; }
    if (rows.some(r => r.ngo_name === ngoName && r.old_station === oldS)) {
      toast(`${oldS} is already in the list for ${ngoName}`, 'error'); return;
    }
    if (rows.some(r => r.ngo_name === ngoName && r.new_station === newS)) {
      toast(`Target "${newS}" is already used for ${ngoName}`, 'error'); return;
    }
    setRows([...rows, { ngo_name: ngoName, old_station: oldS, new_station: newS }]);
    setMOld(''); setMNew('');
  };

  // station-rename-mapping.xlsx: "Current Station" + one *_new column per NGO
  // (BSCT_new / AFLF_new / MANN_new) -> expanded into per-NGO rename rows.
  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFileError('');
    try {
      const XLSX = await import('xlsx');
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const keys = Object.keys(json[0] || {});
      const currentCol = keys.find(k => /current/i.test(k));
      const ngoCols = [];
      for (const k of keys) {
        if (!/new/i.test(k)) continue;
        const ngo = ngos.find(n => k.toLowerCase().includes(String(n.name || '').toLowerCase()));
        if (ngo) ngoCols.push({ key: k, ngo_name: ngo.name });
      }
      if (!currentCol || ngoCols.length === 0) {
        setFileError('Unrecognized file. Expected a "Current Station" column and at least one NGO_new column (e.g. BSCT_new).');
        return;
      }
      const parsed = [];
      for (const row of json) {
        const current = String(row[currentCol] || '').trim();
        if (!current) continue;
        for (const c of ngoCols) {
          const val = String(row[c.key] || '').trim();
          if (!val || val === current) continue;
          parsed.push({ ngo_name: c.ngo_name, old_station: current, new_station: val });
        }
      }
      if (parsed.length === 0) { setFileError('No rename rows found in the file.'); return; }
      setRows(parsed);
    } catch {
      setFileError('Failed to parse file. Ensure it is a valid .xlsx file.');
    }
    e.target.value = '';
  };

  // Preview with an explicit list so removing a flagged row can immediately
  // re-run the dry-run with the remaining rows (state updates are async).
  const runPreviewWith = async (list) => {
    if (!list || list.length === 0) { setPreview(null); setStep('input'); return; }
    setBusy(true);
    try {
      const res = await apiPost('/ngo-admin/stations/bulk-rename', { dry_run: true, renames: list });
      setPreview(res);
      setStep('preview');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runPreview = () => runPreviewWith(rows);

  // Rename history (for reverting): fetches the logged batches and shows the
  // newest first; loading one queues its reverse mapping.
  const loadHistory = async () => {
    setBusy(true);
    try {
      const res = await apiGet('/ngo-admin/stations/rename-log');
      setHistory(Array.isArray(res) ? res : []);
      setStep('history');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadRevert = (b) => {
    const reversed = b.entries.map(e => ({
      ngo_name: e.ngo_name, old_station: e.new_station, new_station: e.old_station,
    }));
    setRows(reversed);
    setRowFilter('');
    setStep('input');
    toast(`Loaded ${reversed.length} reverse rename(s) — review the queue, then Preview`, 'success');
  };

  const removeFlagged = (r) => {
    const next = rows.filter(x =>
      !(x.ngo_name === r.ngo_name && x.old_station === r.old_station && x.new_station === r.new_station));
    setRows(next);
    runPreviewWith(next);
  };

  const applyRenames = async () => {
    setBusy(true);
    try {
      const res = await apiPost('/ngo-admin/stations/bulk-rename', { dry_run: false, confirm: true, renames: rows });
      setResult(res);
      setStep('result');
      toast(`Renamed ${res.applied} station(s) successfully`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const previewOk = (preview?.rows || []).filter(r => r.status === 'ok');
  const previewBad = (preview?.rows || []).filter(r => r.status !== 'ok');
  const totalDonors = previewOk.reduce((s, r) => s + (r.counts?.fro_assignments || 0), 0);
  const totalTransfers = previewOk.reduce((s, r) => s + (r.counts?.fro_transfers || 0), 0);
  const totalQueue = previewOk.reduce((s, r) => s + (r.counts?.work_queue || 0), 0);
  const filterTerm = rowFilter.trim().toLowerCase();
  const filteredRows = filterTerm
    ? rows.filter(r => r.old_station.toLowerCase().includes(filterTerm) || r.new_station.toLowerCase().includes(filterTerm))
    : rows;

  const title = step === 'input' ? 'Bulk Rename Stations'
    : step === 'preview' ? 'Bulk Rename — Preview'
    : step === 'history' ? 'Revert a Rename'
    : step === 'confirm' ? 'Confirm Bulk Rename'
    : 'Rename Complete';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-sm btn-outline" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">

          {/* ---------------- STEP 1: INPUT ---------------- */}
          {step === 'input' && (
            <>
              <div style={{ fontSize: 12, color: '#6b7280', background: '#f9fafb', padding: '10px 12px', borderRadius: 6, marginBottom: 12 }}>
                Renames a station code <strong>in place</strong> across all data — donors, FRO assignments, transfers,
                queue and sessions keep their links; only the code changes. Scoped per NGO (M-2 can become
                BOD-1 / AOD-1 / MOD-1). Always run the preview first.
              </div>

              <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', borderRadius: 8, padding: 2, marginBottom: 12 }}>
                {[['manual', 'Manual Entry'], ['file', 'Upload .xlsx']].map(([key, label]) => (
                  <button key={key} onClick={() => setMode(key)}
                    style={{ flex: 1, padding: '6px 12px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', background: mode === key ? 'var(--sage)' : 'transparent', color: mode === key ? '#fff' : 'var(--ink-soft)' }}>
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'manual' && (
                <div className="form-row" style={{ marginBottom: 12 }}>
                  <label className="field" style={{ flex: 1 }}>
                    NGO
                    <select value={mNgoId} onChange={e => {
                      setMNgoId(e.target.value);
                      const planned = suggestionFor(e.target.value, mOld.trim());
                      if (planned) setMNew(planned);
                    }}>
                      <option value="">-- Select NGO --</option>
                      {ngos.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    Old Station
                    <StationPicker
                      stations={stations}
                      value={mOld}
                      queuedKeys={queuedKeys}
                      onSelect={pickOldStation}
                    />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    New Station
                    <input ref={mNewRef} value={mNew} onChange={e => setMNew(e.target.value)} placeholder="e.g. BOD-1"
                      style={suggestion && mNew === suggestion ? { borderColor: '#86efac', background: '#f0fdf4', color: '#166534', fontWeight: 600 } : undefined} />
                    {suggestion && (
                      mNew === suggestion ? (
                        <span style={{ fontSize: 10, color: '#15803d', marginTop: 3, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={11} /> Planned code — {mOld} → {suggestion} for {ngoNameById(mNgoId)}</span>
                      ) : (
                        <button type="button" onClick={() => setMNew(suggestion)}
                          style={{ marginTop: 3, width: 'fit-content', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, border: '1px solid #86efac', background: '#f0fdf4', color: '#15803d', cursor: 'pointer', fontFamily: 'inherit' }}>
                          ↻ Use planned code: {suggestion}
                        </button>
                      )
                    )}
                  </label>
                  <button className="btn btn-outline" onClick={addManualRow}
                    disabled={!mNgoId || !mOld.trim() || !mNew.trim()} style={{ alignSelf: 'flex-end' }}>
                    + Add Row
                  </button>
                </div>
              )}

              {mode === 'file' && (
                <label className="field" style={{ marginBottom: 12 }}>
                  Mapping file (station-rename-mapping.xlsx)
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
                  {fileError && (
                    <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12, color: '#991b1b' }}>{fileError}</div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
                    Expected columns: <code>Current Station</code>, <code>BSCT_new</code>, <code>AFLF_new</code>, <code>MANN_new</code>.
                    Each row expands into one rename per NGO column.
                  </div>
                </label>
              )}

              {rows.length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {rows.length} rename{rows.length > 1 ? 's' : ''} queued
                      {filterTerm && <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}> · {filteredRows.length} shown</span>}
                    </span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {rows.length > 10 && (
                        <input value={rowFilter} onChange={e => setRowFilter(e.target.value)} placeholder="Filter station…"
                          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)', width: 150 }} />
                      )}
                      <button className="btn btn-sm btn-outline" onClick={() => { setRows([]); setRowFilter(''); }}
                        style={{ fontSize: 11, color: '#dc2626', borderColor: '#fca5a5' }}>Clear All</button>
                    </div>
                  </div>
                  <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {groupRows(filteredRows).map(g => (
                      <div key={g.ngo} style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: `${ngoColor(g.ngo)}14`, borderBottom: '1px solid var(--line)' }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: ngoColor(g.ngo), flexShrink: 0 }} />
                          <strong style={{ fontSize: 12 }}>{g.ngo}</strong>
                          <span className="pill" style={{ background: ngoColor(g.ngo), color: '#fff', fontSize: 10 }}>{g.items.length}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {g.items.map((r, i) => (
                            <div key={`${r.old_station}-${r.new_station}-${i}`}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
                              <span style={{ fontSize: 13 }}>
                                <strong>{r.old_station}</strong>
                                <span style={{ color: 'var(--ink-soft)', margin: '0 6px' }}>→</span>
                                <strong style={{ color: 'var(--sage)' }}>{r.new_station}</strong>
                                {STATION_RENAME_MAP[r.old_station]?.[r.ngo_name] === r.new_station && (
                                  <span className="pill" style={{ background: '#f0fdf4', color: '#15803d', fontSize: 9, marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={9} /> planned</span>
                                )}
                              </span>
                              <button className="btn btn-sm btn-outline" onClick={() => removeRow(r)} style={{ fontSize: 10, padding: '2px 8px' }}><X size={12} /></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {filteredRows.length === 0 && (
                      <div style={{ padding: '12px', textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)', border: '1px dashed var(--line)', borderRadius: 8 }}>
                        No rows match “{rowFilter}”
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button className="btn btn-outline" onClick={onClose}>Cancel</button>
                <button className="btn btn-outline" onClick={loadHistory} disabled={busy}
                  style={{ fontSize: 12, color: '#b45309', borderColor: '#fdba74' }}>
                  ↩ Revert a rename…
                </button>
                <button className="btn btn-primary" onClick={runPreview} disabled={busy || rows.length === 0}>
                  {busy ? 'Checking…' : 'Preview Rename'}
                </button>
              </div>
            </>
          )}

          {/* ---------------- STEP 1b: RENAME HISTORY / REVERT ---------------- */}
          {step === 'history' && (
            <>
              <div style={{ fontSize: 12, color: '#6b7280', background: '#f9fafb', padding: '10px 12px', borderRadius: 6, marginBottom: 12 }}>
                Every applied rename is logged below (newest first). Loading a run queues its
                <strong> reverse mapping</strong> (new code → old code) — it then goes through the same
                preview and confirmation as a normal rename, so nothing can be undone by accident.
              </div>
              <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(history || []).length === 0 && (
                  <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)', border: '1px dashed var(--line)', borderRadius: 8 }}>
                    No renames have been applied yet.
                  </div>
                )}
                {(history || []).map(b => (
                  <div key={b.batch_id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {b.performed_at ? new Date(b.performed_at).toLocaleString('en-IN') : '—'}
                        <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>
                          {' '}· {b.entries.length} mapping{b.entries.length > 1 ? 's' : ''}
                          {b.donor_assignments ? ` · ${b.donor_assignments.toLocaleString('en-IN')} donor rows` : ''}
                          {b.performed_by?.includes('@') ? ` · by ${b.performed_by}` : ''}
                        </span>
                      </span>
                      <button className="btn btn-sm btn-outline" onClick={() => loadRevert(b)}
                        style={{ fontSize: 11, color: '#b45309', borderColor: '#fdba74', whiteSpace: 'nowrap' }}>
                        ↩ Load reverse mapping
                      </button>
                    </div>
                    {groupRows(b.entries).map(g => (
                      <div key={g.ngo} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: ngoColor(g.ngo), flexShrink: 0 }} />
                          <strong style={{ fontSize: 11 }}>{g.ngo}</strong>
                          <span className="pill" style={{ background: ngoColor(g.ngo), color: '#fff', fontSize: 9 }}>{g.items.length}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.8 }}>
                          {g.items.map((e, i) => (
                            <span key={`${e.old_station}-${e.new_station}-${i}`}>
                              {e.old_station}→<strong style={{ color: 'var(--sage)' }}>{e.new_station}</strong>
                              {i < g.items.length - 1 ? ' · ' : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button className="btn btn-outline" onClick={() => setStep('input')}>Back</button>
              </div>
            </>
          )}

          {/* ---------------- STEP 2: PREVIEW ---------------- */}
          {step === 'preview' && preview && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
                <div style={{ padding: '10px 8px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#166534', lineHeight: 1.2 }}>{previewOk.length}</div>
                  <div style={{ fontSize: 10, color: '#166534' }}>ready</div>
                </div>
                <div style={{ padding: '10px 8px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1e40af', lineHeight: 1.2 }}>{totalDonors.toLocaleString('en-IN')}</div>
                  <div style={{ fontSize: 10, color: '#1e40af' }}>donor rows</div>
                </div>
                <div style={{ padding: '10px 8px', borderRadius: 8, background: '#f5f3ff', border: '1px solid #ddd6fe', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#6d28d9', lineHeight: 1.2 }}>{(totalTransfers + totalQueue).toLocaleString('en-IN')}</div>
                  <div style={{ fontSize: 10, color: '#6d28d9' }}>transfers + queue</div>
                </div>
                <div style={{ padding: '10px 8px', borderRadius: 8, background: previewBad.length ? '#fef3c7' : '#f9fafb', border: previewBad.length ? '1px solid #fde68a' : '1px solid var(--line)', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: previewBad.length ? '#b45309' : '#6b7280', lineHeight: 1.2 }}>{previewBad.length}</div>
                  <div style={{ fontSize: 10, color: previewBad.length ? '#b45309' : '#6b7280' }}>issues</div>
                </div>
              </div>

              <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {groupRows(previewOk).map(g => (
                  <div key={g.ngo} style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: `${ngoColor(g.ngo)}14`, borderBottom: '1px solid var(--line)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: ngoColor(g.ngo), flexShrink: 0 }} />
                      <strong style={{ fontSize: 12 }}>{g.ngo}</strong>
                      <span className="pill" style={{ background: ngoColor(g.ngo), color: '#fff', fontSize: 10 }}>{g.items.length} ready</span>
                    </div>
                    {g.items.map((r, i) => (
                      <div key={`${r.old_station}-${r.new_station}-${i}`}
                        style={{ padding: '8px 10px', borderTop: i > 0 ? '1px solid var(--line)' : 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <div style={{ fontSize: 13 }}>
                          <strong>{r.old_station}</strong>
                          <span style={{ color: 'var(--ink-soft)', margin: '0 6px' }}>→</span>
                          <strong style={{ color: 'var(--sage)' }}>{r.new_station}</strong>
                        </div>
                        <ImpactBadges c={r.counts} />
                      </div>
                    ))}
                  </div>
                ))}

                {previewBad.length > 0 && (
                  <div style={{ border: '1px solid #fde68a', borderRadius: 8, overflow: 'hidden', background: '#fffbeb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#fef3c7', borderBottom: '1px solid #fde68a' }}>
                      <span style={{ display: 'inline-flex' }}><TriangleAlert size={14} color="#d97706" /></span>
                      <strong style={{ fontSize: 12, color: '#92400e' }}>Needs attention — remove these rows to apply</strong>
                    </div>
                    {previewBad.map((r, i) => (
                      <div key={`${r.ngo_name}-${r.old_station}-${i}`}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', borderTop: i > 0 ? '1px solid #fde68a' : 'none' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span style={{ fontSize: 12 }}>
                            <span className="pill" style={{ background: ngoColor(r.ngo_name), color: '#fff', fontSize: 9, marginRight: 6 }}>{r.ngo_name}</span>
                            <strong>{r.old_station}</strong>
                            <span style={{ color: 'var(--ink-soft)', margin: '0 4px' }}>→</span>
                            <strong>{r.new_station}</strong>
                          </span>
                          <span style={{ fontSize: 11, color: '#b45309' }}>{r.reason}</span>
                        </div>
                        <button className="btn btn-sm btn-outline" onClick={() => removeFlagged(r)}
                          disabled={busy} style={{ fontSize: 10, padding: '2px 8px', color: '#b45309', borderColor: '#fdba74', whiteSpace: 'nowrap' }}>
                          {busy ? '…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><X size={12} /> Remove</span>}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, color: '#6b7280', background: '#f9fafb', padding: '8px 12px', borderRadius: 6, marginTop: 12 }}>
                Old codes are replaced everywhere — assignments, transfer history, queue cycles, active sessions and
                donor profiles. Ambiguous donor profiles are skipped and listed in the result. The mapping is kept in
                station_rename_log.
              </div>

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button className="btn btn-outline" onClick={() => { setStep('input'); setPreview(null); }}>Back</button>
                <button className="btn btn-outline" onClick={runPreview} disabled={busy || rows.length === 0}>
                  {busy ? 'Checking…' : 'Re-preview'}
                </button>
                <button className="btn btn-primary" onClick={() => { setConfirmText(''); setStep('confirm'); }}
                  disabled={busy || previewBad.length > 0 || previewOk.length === 0}>
                  Apply {previewOk.length} Rename{previewOk.length > 1 ? 's' : ''} ⟶
                </button>
              </div>
            </>
          )}

          {/* ---------------- STEP 3: CONFIRM ---------------- */}
          {step === 'confirm' && (
            <>
              <div style={{ padding: '12px 14px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 13, color: '#991b1b' }}>
                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><TriangleAlert size={14} /> You are about to rename {rows.length} station{rows.length > 1 ? 's' : ''} on live data.</strong><br />
                This rewrites station codes across 6 tables ({totalDonors.toLocaleString('en-IN')} donor assignments).
                Old codes will no longer exist anywhere — the mapping is preserved in station_rename_log.
                Everything runs in one transaction: if any check fails, nothing changes.
              </div>
              <label className="field" style={{ marginTop: 14 }}>
                Type <strong>RENAME</strong> to confirm
                <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="RENAME" autoFocus />
              </label>
              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button className="btn btn-outline" onClick={() => setStep('preview')}>Back</button>
                <button className="btn btn-primary" onClick={applyRenames}
                  disabled={busy || confirmText !== 'RENAME'}>
                  {busy ? 'Renaming… this may take a minute' : 'Rename Stations'}
                </button>
              </div>
            </>
          )}

          {/* ---------------- STEP 4: RESULT ---------------- */}
          {step === 'result' && result && (
            <>
              <div style={{ padding: '12px 14px', borderRadius: 6, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 13, color: '#166534' }}>
                <strong style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Check size={14} /> {result.applied} station{result.applied > 1 ? 's' : ''} renamed · old codes remaining: {result.post_verify?.old_codes_remaining ?? 0}</strong><br />
                <div style={{ fontSize: 11, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span><strong>{result.totals?.fro_assignments ?? 0}</strong> donor assignments</span>
                  <span><strong>{result.totals?.fro_transfers ?? 0}</strong> transfers</span>
                  <span><strong>{result.totals?.work_queue ?? 0}</strong> queue rows</span>
                  <span><strong>{result.totals?.work_as_sessions ?? 0}</strong> active sessions</span>
                </div>
              </div>

              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {groupRows(result.rows || []).map(g => (
                  <div key={g.ngo} style={{ border: '1px solid #bbf7d0', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: `${ngoColor(g.ngo)}14`, borderBottom: '1px solid #bbf7d0' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: ngoColor(g.ngo), flexShrink: 0 }} />
                      <strong style={{ fontSize: 12 }}>{g.ngo}</strong>
                      <span className="pill" style={{ background: ngoColor(g.ngo), color: '#fff', fontSize: 10 }}>{g.items.length} renamed</span>
                    </div>
                    {g.items.map((r, i) => (
                      <div key={`${r.old_station}-${r.new_station}-${i}`}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderTop: i > 0 ? '1px solid var(--line)' : 'none', fontSize: 12, flexWrap: 'wrap' }}>
                        <span>
                          <Check size={13} color="#16a34a" />{' '}
                          <strong>{r.old_station}</strong>
                          <span style={{ color: 'var(--ink-soft)', margin: '0 6px' }}>→</span>
                          <strong style={{ color: 'var(--sage)' }}>{r.new_station}</strong>
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                          {r.updated_donors ?? 0} donor profile{r.updated_donors === 1 ? '' : 's'} updated
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {(result.skipped_donors || []).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <button className="btn btn-sm btn-outline" onClick={() => setShowSkipped(!showSkipped)}>
                    ▸ {result.skipped_donors.length} donor profile{result.skipped_donors.length > 1 ? 's' : ''} skipped (ambiguous NGO)
                  </button>
                  {showSkipped && (
                    <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
                      {(result.skipped_donors || []).map(d => (
                        <div key={d.donor_id} style={{ padding: '3px 0', color: '#92400e' }}>
                          #{d.donor_id} {d.name} — {d.station} ({d.reason})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button className="btn btn-primary" onClick={() => { if (onRenamed) onRenamed(); else onClose(); }}>Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchableSelect({ options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setDropUp(window.innerHeight - rect.bottom < 260);
    }
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = options.filter(w =>
    !search || w.name?.toLowerCase().includes(search.toLowerCase()) || w.login_id?.toLowerCase().includes(search.toLowerCase())
  );

  const selected = options.find(w => w.id === value);

  return (
    <div ref={ref} className="searchable-select" style={{ position: 'relative', maxWidth: 200 }}>
      <div onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '5px 8px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer', background: '#fff', minHeight: 28 }}>
        <span style={{ color: selected ? 'inherit' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.name : (placeholder || '-- Select --')}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
      </div>

      {open && (
        <div style={{ position: 'absolute', left: 0, right: 0, background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 300, overflow: 'hidden', ...(dropUp ? { bottom: '100%', marginBottom: 2 } : { top: '100%', marginTop: 2 }) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search FRO..."
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 11, fontFamily: 'inherit', background: 'transparent' }}
              autoFocus />
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            <div onClick={() => { onChange(''); setOpen(false); }}
              style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: '#9ca3af', borderBottom: '1px solid var(--line, #e5e7eb)' }}>
              -- No FRO --
            </div>
            {filtered.map(w => (
              <div key={w.id} onClick={() => { onChange(w.id); setOpen(false); }}
                style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', background: w.id === value ? '#f0fdf4' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                onMouseLeave={e => e.currentTarget.style.background = w.id === value ? '#f0fdf4' : 'transparent'}>
                <span>{w.name}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '10px', fontSize: 11, color: 'var(--ink-soft)', textAlign: 'center' }}>No FROs match</div>
            )}
          </div>
          <div style={{ padding: '4px 8px', borderTop: '1px solid var(--line, #e5e7eb)', fontSize: 10, color: 'var(--ink-soft)', textAlign: 'right' }}>
            {filtered.length} / {options.length}
          </div>
        </div>
      )}
    </div>
  );
}

// Source badge. The backend used to emit one value per auto tier ('auto_month1'
// through 'auto_month3'); it now emits a single 'auto' plus the tier in a
// separate field, because the tier is derived at read time by one shared
// resolver rather than recomputed per surface. The old values are still accepted
// so an in-flight response from a previous deploy cannot render as "Not Set".
function SourcePill({ source, monthsEmployed, sourceMonth }) {
  const tier = Number.isFinite(monthsEmployed)
    ? Math.min(Math.max(monthsEmployed + 1, 1), 3)
    : null;
  if (source === 'auto' || source === 'auto_month1' || source === 'auto_month2' || source === 'auto_month3') {
    const fallback = source === 'auto_month2' ? 2 : source === 'auto_month3' ? 3 : tier;
    return <span className="pill pill-yellow">Auto M{fallback ?? 1}</span>;
  }
  if (source === 'manual') return <span className="pill pill-green">Manual</span>;
  // Inherited from an earlier month rather than set for this one - worth showing
  // distinctly, otherwise a carried figure looks like a deliberate value.
  if (source === 'carried_forward') {
    const from = sourceMonth ? ` from ${String(sourceMonth).slice(0, 7)}` : '';
    return <span className="pill pill-blue" title={`Carried over${from}. Editing it creates a value for this month.`}>Carried over{from}</span>;
  }
  return <span className="pill pill-gray">Not Set</span>;
}

// Per-row ⋮ kebab menu (absolute overlay; does not affect column widths).
function StationKebab({ activeTransfer, returningId, onReturn, onUpload, onViewList, onAddDonor, onDownload, onTarget, onGrantTempAccess, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const run = (fn) => () => { setOpen(false); if (fn) fn(); };

  const itemStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', border: 'none', width: '100%', textAlign: 'left', color: 'var(--ink)', whiteSpace: 'nowrap' };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button className="btn btn-sm btn-outline" onClick={() => setOpen(o => !o)}
        aria-label="Station actions"
        style={{ width: 30, height: 30, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, lineHeight: 1 }}>
        ⋮
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 300, marginTop: 4, background: '#fff', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.14)', overflow: 'hidden', minWidth: 190 }}>
          {activeTransfer && onReturn && (
            <button onClick={run(() => onReturn(activeTransfer.id))} style={{ ...itemStyle, color: '#92400e', fontWeight: 600 }}>
              {returningId === activeTransfer.id ? 'Returning…' : '↩ Return leads'}
            </button>
          )}
          <button onClick={run(onUpload)} style={itemStyle}>⇧ Upload old data</button>
          {onViewList && (
            <button onClick={run(onViewList)} style={{ ...itemStyle, fontWeight: 600 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Eye size={14} /> View donor list</span>
            </button>
          )}
          {onAddDonor && (
            <button onClick={run(onAddDonor)} style={{ ...itemStyle, fontWeight: 600 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><UserPlus size={14} /> Add donor</span>
            </button>
          )}
          {onDownload && <button onClick={run(onDownload)} style={itemStyle}>⤓ Download Excel</button>}
          {onGrantTempAccess && (
            <button onClick={run(onGrantTempAccess)} style={{ ...itemStyle, fontWeight: 600, color: '#1d4ed8' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Clock size={14} /> Grant temporary access</span>
            </button>
          )}
          <div style={{ borderTop: '1px solid var(--line, #e5e7eb)', margin: '4px 0' }} />
          <button onClick={run(onDelete)} style={{ ...itemStyle, color: 'var(--danger)' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Trash2 size={14} /> Delete station</span></button>
        </div>
      )}
    </div>
  );
}

// Compact add-station modal (replaces the always-visible Add Station card).
function AddStationModal({ allNgos, newStation, newStationNgo, onChangeName, onChangeNgo, adding, onCreate, onClose }) {
  const [tempFile, setTempFile] = useState(null);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-head">
          <h3>Add Station</h3>
          <button className="btn btn-sm btn-outline" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">
            Station Name
            <input value={newStation} onChange={e => onChangeName(e.target.value)} placeholder="e.g. BOD-1" autoFocus />
          </label>
          <label className="field">
            NGO
            <select value={newStationNgo} onChange={e => onChangeNgo(e.target.value)}>
              <option value="">-- Select NGO --</option>
              {allNgos.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Temp upload (optional)
            <input type="file" accept=".xlsx,.xls,.csv" onChange={e => setTempFile(e.target.files[0] || null)} />
            <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
              Same columns as old-data upload. Processed only for the new station you create now.
            </span>
          </label>
          <div className="modal-actions">
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => onCreate(tempFile)} disabled={adding || !newStation.trim()}>
              {adding ? 'Adding...' : 'Create Station'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Auto-hide schedule for the Hide Old Donors switch ───────────────────────
// Two IST times: at `hideAt` the switch turns ON by itself, at `showAt` it
// turns OFF again. The manual button still works in between — the next
// boundary re-asserts the schedule.
function AutoHideScheduleModal({ value, saving, onSave, onClose }) {
  const [enabled, setEnabled] = useState(!!value?.enabled);
  const [hideAt, setHideAt] = useState(value?.hideAt || '10:00');
  const [showAt, setShowAt] = useState(value?.showAt || '19:00');

  const sameTime = !!hideAt && !!showAt && hideAt === showAt;
  const invalid = sameTime || !hideAt || !showAt;
  const overnight = !invalid && hideAt > showAt;

  // Preview of the next automatic flip, computed in IST exactly like the
  // scheduler does — so the admin never has to guess whether saving will flip
  // the switch right now (it never does; only boundaries do).
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const istMinutes = (() => {
    const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  })();
  const untilHide = ((toMin(hideAt) - istMinutes + 1440) % 1440) || 1440;
  const untilShow = ((toMin(showAt) - istMinutes + 1440) % 1440) || 1440;
  const nextIsHide = untilHide <= untilShow;
  const nextAt = nextIsHide ? hideAt : showAt;
  const nextWhen = (nextIsHide ? untilHide : untilShow) < 1440 ? 'aaj' : 'kal';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h3>Auto-hide old donors</h3>
          <button className="btn btn-sm btn-outline" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
            Har din fix time pe <strong>Hide Old Donors</strong> switch khud badal jayega.
            Tab tak manual button normal kaam karega — agla boundary aate hi schedule
            apna state wapas laga dega.
          </p>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--sage)' }}
            />
            Auto-hide chalu rakho
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="field" style={{ opacity: enabled ? 1 : 0.5 }}>
              Hide at (IST)
              <input
                type="time"
                value={hideAt}
                onChange={e => setHideAt(e.target.value)}
                disabled={!enabled}
              />
            </label>
            <label className="field" style={{ opacity: enabled ? 1 : 0.5 }}>
              Show at (IST)
              <input
                type="time"
                value={showAt}
                onChange={e => setShowAt(e.target.value)}
                disabled={!enabled}
              />
            </label>
          </div>

          {sameTime && (
            <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px' }}>
              Hide aur Show ka time same nahi ho sakta.
            </div>
          )}
          {overnight && (
            <div style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' }}>
              Show time hide time se pehle hai — matlab donors {hideAt} se {showAt} tak (raat bhar) hidden rahenge.
            </div>
          )}
          {!sameTime && !overnight && enabled && (
            <div style={{ fontSize: 12, color: '#1e3a8a', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 10px', lineHeight: 1.55 }}>
              Donors roz <strong>{hideAt}</strong> se <strong>{showAt}</strong> IST tak hidden rahenge.
              <br />
              <strong>Save karne se abhi switch nahi badlega</strong> — agla change {nextWhen} <strong>{nextAt}</strong> IST pe {nextIsHide ? 'hide' : 'show'} hoga.
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={saving || (enabled && invalid)}
              onClick={() => onSave({ enabled, hideAt, showAt })}
            >
              {saving ? 'Saving…' : 'Save schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Compact summary tile used inside the Non-Connected Fresh modal.
function NcfSummaryTile({ label, value, color }) {
  return (
    <div style={{ minWidth: 82, background: '#fff', borderRadius: 8, padding: '8px 12px', textAlign: 'center', flex: '0 0 auto' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</div>
    </div>
  );
}

function ncfTimeSince(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (isNaN(days)) return '—';
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

// Pulls non-connected donors from fresh (FD) stations and lets the admin
// review & delete their fresh-data (new_data) records. Disposition history
// (assignments, donor logs, receipts) is preserved — only new_data is removed.
function NonConnectedFreshModal({ ngoId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [donors, setDonors] = useState([]);
  const [summary, setSummary] = useState({ total: 0, by_station: {}, by_category: {}, by_fro: {} });
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [stationOptions, setStationOptions] = useState([]);
  const [statusOptions, setStatusOptions] = useState([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStation, setFilterStation] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selected, setSelected] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingIds, setPendingIds] = useState([]);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDeleteResult(null);
    const params = [];
    if (ngoId && ngoId !== 'all') params.push(`ngo_id=${ngoId}`);
    if (filterCategory) params.push(`category=${encodeURIComponent(filterCategory)}`);
    if (filterStation) params.push(`station=${encodeURIComponent(filterStation)}`);
    if (filterStatus) params.push(`status=${encodeURIComponent(filterStatus)}`);
    const url = `/ngo-admin/non-connected-fresh${params.length ? '?' + params.join('&') : ''}`;

    apiGet(url).then(data => {
      if (cancelled) return;
      setDonors(Array.isArray(data.donors) ? data.donors : []);
      setSummary(data.summary || { total: 0, by_station: {}, by_category: {}, by_fro: {} });
      setCategoryOptions(Array.isArray(data.category_options) ? data.category_options : []);
      setStationOptions(Array.isArray(data.station_options) ? data.station_options : []);
      setStatusOptions(Array.isArray(data.status_options) ? data.status_options : []);
      setSelected([]);
    }).catch(err => {
      if (!cancelled) toast(err.message, 'error');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [ngoId, filterCategory, filterStation, filterStatus, refreshKey]);

  const selectedIds = new Set(selected);
  const allSelected = donors.length > 0 && selected.length === donors.length;

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    setSelected(allSelected ? [] : donors.map(d => d.donor_profile_id));
  };

  const openDeleteConfirm = (ids) => {
    if (ids.length === 0) return;
    setSelected(ids);
    setPendingIds(ids);
    setConfirmOpen(true);
    setPreview({ loading: true, rows: [], matched: 0, per_category: {}, truncated: false, error: null });
    apiPost('/ngo-admin/non-connected-fresh/delete?dry_run=true', {
      ngo_id: ngoId && ngoId !== 'all' ? ngoId : undefined,
      donor_profile_ids: ids,
      category: filterCategory || undefined,
    }).then(res => {
      setPreview({
        loading: false,
        rows: Array.isArray(res.rows) ? res.rows : [],
        matched: res.matched || 0,
        per_category: res.per_category || {},
        truncated: !!res.truncated,
        error: null,
      });
    }).catch(err => {
      setPreview(p => ({ ...p, loading: false, error: err.message }));
    });
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await apiPost('/ngo-admin/non-connected-fresh/delete', {
        ngo_id: ngoId && ngoId !== 'all' ? ngoId : undefined,
        donor_profile_ids: pendingIds,
        category: filterCategory || undefined,
      });
      setDeleteResult(res);
      if (res && res.message) toast(res.message, 'success');
      setRefreshKey(k => k + 1);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
      setPreview(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 960 }}>
        <div className="modal-head">
          <h3>Manage Non-Connected Fresh Data</h3>
          <button className="btn btn-sm btn-outline" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body" style={{ fontSize: 13 }}>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, background: '#fff' }}>
              <option value="">All Categories</option>
              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterStation} onChange={e => setFilterStation(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, background: '#fff' }}>
              <option value="">All Stations</option>
              {stationOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, background: '#fff' }}>
              <option value="">All Statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 }}>
              {loading ? 'Loading…' : `${donors.length} non-connected donor${donors.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {/* Summary */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <NcfSummaryTile label="Total" value={summary.total || 0} color="#dc2626" />
            {Object.entries(summary.by_category || {}).slice(0, 4).map(([k, v]) => (
              <NcfSummaryTile key={k} label={k.length > 10 ? k.slice(0, 10) : k} value={v} color="#6366f1" />
            ))}
            {(Object.keys(summary.by_fro || {}).length > 0) && (
              <div style={{ flex: '1 1 200px', minWidth: 170, background: '#fff', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 2 }}>Per FRO</div>
                {Object.entries(summary.by_fro).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '1px 0' }}>
                    <span style={{ fontWeight: 500 }}>{k}</span>
                    <span style={{ fontWeight: 700, color: '#6366f1', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Confirm dialog with data preview */}
          {confirmOpen && (
            <div style={{ background: '#fff7ed', border: '1px solid #fb923c', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, color: '#9a3412', fontSize: 14 }}>
                  {preview?.loading ? 'Fetching records…' : preview ? `Review: ${preview.matched} new_data record${preview.matched === 1 ? '' : 's'} to delete` : 'Confirm deletion'}
                </div>
                <button className="btn btn-sm btn-outline" onClick={() => { setConfirmOpen(false); setPreview(null); }}>Cancel</button>
              </div>

              {preview?.loading && (
                <div style={{ padding: 16, textAlign: 'center', color: '#9a3412' }}>Matching fresh-data records…</div>
              )}

              {preview?.error && (
                <p style={{ color: '#b91c1c', margin: '4px 0 0' }}>Error: {preview.error}</p>
              )}

              {preview && !preview.loading && !preview.error && (
                <>
                  {preview.matched === 0 ? (
                    <p style={{ margin: 0, color: '#166534', padding: '4px 0' }}>
                      No <code>new_data</code> rows found for the selection — nothing will be deleted.
                    </p>
                  ) : (
                    <>
                      <p style={{ margin: '0 0 10px', color: '#78350f', lineHeight: 1.5 }}>
                        {preview.truncated
                          ? <>Showing first <strong>{preview.rows.length}</strong> of <strong>{preview.matched}</strong> — <strong>ALL {preview.matched}</strong> fresh-data record{preview.matched === 1 ? '' : 's'} will be deleted.</>
                          : <>Exactly <strong>{preview.matched}</strong> fresh-data record{preview.matched === 1 ? '' : 's'} matched for deletion.</>
                        }
                        {' '}Disposition history (donor logs, FRO assignments, receipts, follow-ups) is <strong>preserved</strong>.
                      </p>

                      {Object.keys(preview.per_category).length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                          {Object.entries(preview.per_category).map(([k, v]) => (
                            <NcfSummaryTile key={k} label={k.length > 12 ? k.slice(0, 12) : k} value={v} color="#ea580c" />
                          ))}
                        </div>
                      )}

                      <div style={{ maxHeight: 280, overflowY: 'auto', borderRadius: 8, background: '#fff' }}>
                        <table className="nga-st" style={{ fontSize: 11.5 }}>
                          <thead>
                            <tr>
                              <th style={{ width: '6%' }}>ID</th>
                              <th style={{ width: '16%' }}>Name</th>
                              <th style={{ width: '12%' }}>Mobile</th>
                              <th style={{ width: '12%' }}>Category</th>
                              <th style={{ width: '10%' }}>Station</th>
                              <th style={{ width: '11%' }}>Status</th>
                              <th style={{ width: '14%' }}>NGO</th>
                              <th style={{ width: '10%' }}>Created</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.rows.map(r => (
                              <tr key={r.id}>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.id}</td>
                                <td style={{ fontWeight: 600 }}>{r.name || '—'}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.mobile_number}</td>
                                <td><span className="pill" style={{ fontSize: 10 }}>{String(r.data_category || r.category || '').trim() || '—'}</span></td>
                                <td style={{ fontWeight: 600 }}>{r.station || '—'}</td>
                                <td>{r.status || 'pending'}</td>
                                <td style={{ fontSize: 11, color: '#6b7280' }}>{r.ngo || '—'}</td>
                                <td style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>
                                  {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-outline" onClick={() => { setConfirmOpen(false); setPreview(null); }}>Cancel</button>
                        <button className="btn btn-sm" style={{ background: '#dc2626', color: '#fff' }} onClick={handleDelete} disabled={deleting}>
                          {deleting ? 'Deleting…' : `Confirm Delete ${preview.matched} Record${preview.matched === 1 ? '' : 's'}`}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {deleteResult && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12.5, color: '#166534' }}>
              <Check size={13} /> {deleteResult.message} {deleteResult.per_category && Object.keys(deleteResult.per_category).length > 0 && (
                <span>({Object.entries(deleteResult.per_category).map(([k, v]) => `${k}: ${v}`).join(', ')})</span>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-outline" onClick={toggleSelectAll} disabled={donors.length === 0}>
              {allSelected ? 'Clear All' : 'Select All'}
            </button>
            {selected.length > 0 && (
              <button className="btn btn-sm" style={{ background: '#dc2626', color: '#fff' }}
                onClick={() => openDeleteConfirm(selected)} disabled={deleting}>
                Delete Selected ({selected.length})
              </button>
            )}
            <button className="btn btn-sm btn-outline" style={{ color: '#b91c1c', borderColor: '#fca5a5' }}
              onClick={() => openDeleteConfirm(donors.map(d => d.donor_profile_id))}
              disabled={deleting || donors.length === 0}>
              Delete All ({donors.length})
            </button>
          </div>

          {/* Donor table */}
          {loading ? (
            <div className="loading" style={{ padding: 24 }}>Loading non-connected donors…</div>
          ) : donors.length === 0 ? (
            <div className="empty-state" style={{ padding: 20, textAlign: 'center' }}>
              <p style={{ color: '#16a34a', margin: 0 }}>No non-connected fresh-data donors found for the current filters.</p>
            </div>
          ) : (
            <div style={{ maxHeight: 380, overflowY: 'auto', borderRadius: 8, background: '#fff' }}>
              <table className="nga-st" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: '4%' }}></th>
                    <th style={{ width: '17%' }}>Donor</th>
                    <th style={{ width: '12%' }}>Mobile</th>
                    <th style={{ width: '12%' }}>Category</th>
                    <th style={{ width: '9%' }}>Station</th>
                    <th style={{ width: '13%' }}>Status</th>
                    <th style={{ width: '13%' }}>FRO</th>
                    <th style={{ width: '12%' }}>Last Contacted</th>
                  </tr>
                </thead>
                <tbody>
                  {donors.map(d => {
                    const isSel = selectedIds.has(d.donor_profile_id);
                    return (
                      <tr key={d.donor_profile_id} onClick={() => toggleSelect(d.donor_profile_id)}
                        style={{ background: isSel ? '#eff6ff' : 'transparent', cursor: 'pointer' }}>
                        <td style={{ padding: '6px 4px' }}>
                          <input type="checkbox" checked={isSel} readOnly aria-label="select" />
                        </td>
                        <td style={{ fontWeight: 600 }}>{d.name}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{d.mobile_number}</td>
                        <td>
                          <span className="pill" style={{ fontSize: 10, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.category || '—'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{d.station}</td>
                        <td>
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#fef2f2', color: '#dc2626', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {d.status}
                          </span>
                        </td>
                        <td>{d.fro_name}</td>
                        <td style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>{ncfTimeSince(d.last_contacted_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--ink-soft)', margin: '12px 0 0', lineHeight: 1.5 }}>
            Only the fresh-data (<code>new_data</code>) record is removed. FRO disposition history, donor logs, receipts and follow-ups remain in the database.
          </p>
        </div>
      </div>
    </div>
  );
}

// Rows per page in the donor list. A station can hold 400+ donors, so the table is
// paged rather than rendered whole — the same bound the dashboard station popup uses.
const DONOR_ROWS_PER_PAGE = 50;

// Relative "time since" for a donor's last contact, reusing the NCF modal's
// phrasing so both station dialogs read the same way.
function donorTimeSince(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

// Manually add ONE donor to a station (station row kebab → "Add donor").
// Hand-entered name + mobile instead of a spreadsheet; the backend reuses the
// profile if the number is known and creates the same single ACTIVE assignment
// the old-data upload would, on the station's FRO.
function AddDonorModal({ station, ngoList, defaultNgoId, onClose, onAdded }) {
  const ngoOptions = useMemo(
    () => (ngoList || []).filter(n => n && n.ngo_id).map(n => ({ id: String(n.ngo_id), name: n.ngo_name || '' })),
    [ngoList],
  );
  const defaultNgo = String(defaultNgoId || (ngoOptions[0]?.id ?? ''));
  const [activeNgo, setActiveNgo] = useState(defaultNgo);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const digits = mobile.replace(/\D/g, '');
  const mobileOk = digits.length === 10 || (digits.length === 12 && digits.startsWith('91')) || (digits.length === 11 && digits.startsWith('0'));
  const noNgo = ngoOptions.length === 0;
  const canSubmit = !noNgo && !!activeNgo && name.trim().length > 0 && mobileOk && !saving;
  const activeNgoName = ngoOptions.find(n => n.id === activeNgo)?.name || '';

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiPost(`/ngo-admin/stations/${encodeURIComponent(station)}/add-donor`, {
        name: name.trim(),
        mobile,
        ngo_id: activeNgo,
      });
      if (res?.message) toast(res.message, 'success');
      if (onAdded) onAdded(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not add donor');
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle = { fontSize: 13, padding: '7px 10px', borderRadius: 6, background: '#fff' };

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Add Donor — {station}</h3>
            {activeNgoName && <span className="pill pill-green">{activeNgoName}</span>}
          </div>
          <button className="btn btn-sm btn-outline" onClick={onClose} disabled={saving} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          {noNgo && (
            <div style={{ padding: '9px 12px', borderRadius: 6, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12.5, color: '#92400e' }}>
              <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}><TriangleAlert size={14} /> {station} is not linked to any NGO yet. Set its NGO first, then add donors.</span>
            </div>
          )}
          {ngoOptions.length > 1 && (
            <label className="field">
              NGO
              <select value={activeNgo} onChange={e => setActiveNgo(e.target.value)} style={fieldStyle} disabled={saving}>
                {ngoOptions.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>The station name is shared across NGOs — pick which one this donor belongs to.</span>
            </label>
          )}
          <label className="field">
            Donor Name
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ramesh Kumar"
              style={fieldStyle} autoFocus disabled={saving}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
          </label>
          <label className="field">
            Mobile Number
            <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="10-digit mobile"
              style={fieldStyle} inputMode="numeric" disabled={saving}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
            {mobile.trim() && !mobileOk && (
              <span style={{ fontSize: 11, color: '#b91c1c' }}>Enter a valid 10-digit mobile number.</span>
            )}
          </label>

          {error && (
            <div style={{ padding: '9px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12.5, color: '#991b1b' }}>
              <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}><TriangleAlert size={14} /> {error}</span>
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--ink-soft)', margin: 0, lineHeight: 1.5 }}>
            The donor is added to <strong>{station}</strong> and assigned to the station's FRO. A number already active in
            {' '}{activeNgoName || 'this NGO'} is refused — one active assignment per donor per NGO.
          </p>

          <div className="modal-actions">
            <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><UserPlus size={14} /> {saving ? 'Adding…' : 'Add Donor'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// On-screen counterpart to the station row's "Download Excel" action: shows the
// same donors-by-station dataset and lets an admin remove one.
//
// The removal exists to enforce the one-number-per-NGO rule. The DB holds a
// partial unique index (uq_fro_assignments_active_donor_ngo) allowing one ACTIVE
// assignment per (donor, ngo), so a number that shows up twice inside an NGO can
// only be cleared by retiring one of the two rows. Deleting frees it.
//
// Two things this must not do, and how they are handled:
//   - Delete a donor who has given money. The endpoint refuses those outright and
//     answers 409 with the reason per donor, so the confirm step surfaces them in
//     red and offers to run again over the remainder.
//   - Delete half a duplicate pair. The endpoint is all-or-nothing for the same
//     reason; the modal never presents a partial success as a complete one.
function StationDonorsModal({ station, ngoList, defaultNgoId, onClose, onChanged, onDownloadExcel, onAddDonor }) {
  const [loading, setLoading] = useState(true);
  const [donors, setDonors] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selected, setSelected] = useState([]);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  // Confirm flow. `preview` holds the dry-run answer: which rows go, which are
  // blocked and why. `blockedOnly` is the 409 case, where the modal keeps the
  // selection intact and offers a retry over just the deletable remainder.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState([]);
  const [preview, setPreview] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState([]);
  const [result, setResult] = useState(null);

  // ── NGO scope ────────────────────────────────────────────────────────────
  //
  // A station NAME is shared across NGOs - 'DH-5' is BOD-15 for BSCT, AOD-15 for
  // AFLF and MOD-15 for MANN - so one name can hold a completely separate set of
  // donors in each. The station row already shows one count pill per NGO
  // ("BSCT: 900  MANN: 754"), which is why opening the list used to disagree with
  // it: the list was asked for the station name alone and the endpoint unioned
  // every NGO, returning 1824.
  //
  // So the scope is explicit and defaults to a single NGO: the tab the admin is
  // currently looking at when that NGO owns this station, otherwise the station's
  // first NGO. "All NGOs" stays reachable but is opt-in, and when it is used the
  // table grows an NGO column so a combined list can never be misread as one
  // station's donors.
  const ngoOptions = useMemo(
    () => (ngoList || []).filter(n => n && n.ngo_id).map(n => ({ id: String(n.ngo_id), name: n.ngo_name || '' })),
    [ngoList],
  );
  const [activeNgo, setActiveNgo] = useState(() => String(defaultNgoId || ''));

  // Re-scope when the caller hands down a different default (a different station
  // row), but never stomp a choice the admin already made in this modal.
  useEffect(() => {
    if (defaultNgoId) setActiveNgo(String(defaultNgoId));
  }, [defaultNgoId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ station });
    if (activeNgo) params.set('ngo_id', activeNgo);
    apiGet(`/ngo-admin/donors-by-station?${params}`)
      .then(data => {
        if (cancelled) return;
        setDonors(Array.isArray(data) ? data : []);
        setSelected([]);
        setPage(1);
      })
      .catch(err => { if (!cancelled) toast(err.message, 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [station, activeNgo, refreshKey]);

  // A station's rows can number in the hundreds, so every filter runs over the
  // full list and only the page slice is rendered.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return donors.filter(d => {
      if (statusFilter && d.status !== statusFilter) return false;
      if (categoryFilter && String(d.data_category || '') !== categoryFilter) return false;
      if (!q) return true;
      return (
        String(d.donor_name || '').toLowerCase().includes(q) ||
        String(d.donor_mobile || '').includes(q) ||
        String(d.donor_mobile_2 || '').includes(q) ||
        String(d.donor_city || '').toLowerCase().includes(q) ||
        String(d.fro_name || '').toLowerCase().includes(q) ||
        String(d.data_category || '').toLowerCase().includes(q)
      );
    });
  }, [donors, search, statusFilter, categoryFilter]);

  const statusOptions = useMemo(
    () => [...new Set(donors.map(d => d.status).filter(Boolean))].sort(),
    [donors],
  );
  const categoryOptions = useMemo(
    () => [...new Set(donors.map(d => String(d.data_category || '').trim()).filter(Boolean))].sort(),
    [donors],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / DONOR_ROWS_PER_PAGE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * DONOR_ROWS_PER_PAGE;
    return filtered.slice(start, start + DONOR_ROWS_PER_PAGE);
  }, [filtered, page]);

  // Clamp rather than reset: changing a filter must not strand the admin on page 7
  // of a 2-page result.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);
  useEffect(() => { setPage(1); }, [search, statusFilter, categoryFilter]);

  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every(d => selectedIds.has(d.id));

  const toggle = (id) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const togglePage = () => {
    const pageIds = pageRows.map(d => d.id);
    setSelected(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return [...next];
    });
  };

  const clearSelection = () => {
    setSelected([]);
    setBlocked([]);
    setResult(null);
  };

  const openConfirm = (ids) => {
    if (ids.length === 0) return;
    setPendingIds(ids);
    setConfirmOpen(true);
    setBlocked([]);
    setResult(null);
    setPreview({ loading: true, deletable: [], totals: {}, notFound: 0 });
    apiPost('/ngo-admin/station-donors/delete?dry_run=true', { assignment_ids: ids })
      .then(res => {
        setPreview({
          loading: false,
          deletable: Array.isArray(res.deletable) ? res.deletable : [],
          totals: res.totals || {},
          notFound: res.not_found || 0,
        });
        // The dry run answers with the same guard as the real delete, so the
        // money-blocked rows are known BEFORE the admin is asked to confirm.
        // Surfacing them here means the confirm button is never a trap that
        // would come back 409 with nothing deleted.
        setBlocked(Array.isArray(res.blocked) ? res.blocked : []);
      })
      .catch(err => setPreview(p => ({ ...p, loading: false, error: err.message })));
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await apiPost('/ngo-admin/station-donors/delete', { assignment_ids: pendingIds });
      setResult(res);
      if (res?.message) toast(res.message, 'success');
      setSelected([]);
      setRefreshKey(k => k + 1);
      // The station row's donor pill is derived from a separate read, so let the
      // parent refresh it now rather than only on close.
      if (onChanged) onChanged();
    } catch (err) {
      // 409 carries the per-donor block list in the body (survives the throw as
      // err.data). Surface it instead of a bare toast, and keep the selection so
      // the admin can retry the remainder without re-ticking. This is the race
      // the dry run cannot cover: money recorded between preview and confirm.
      const blockedList = err?.data?.blocked;
      if (Array.isArray(blockedList) && blockedList.length > 0) {
        setBlocked(blockedList);
        setPreview(p => ({ ...(p || { deletable: [] }), loading: false, error: null }));
        toast(err.message, 'error');
      } else {
        toast(err.message, 'error');
      }
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  // Offered when the guard refuses part of the selection: re-run over just the
  // rows it allows, so the admin is not forced to untick the blocked donors by
  // hand. Derived from pendingIds, not the selection — the two differ when the
  // admin deleted a single row from its trash icon.
  const deleteRemainder = () => {
    const blockedSet = new Set(blocked.map(b => b.assignment_id));
    const remainder = pendingIds.filter(id => !blockedSet.has(id));
    if (remainder.length === 0) return;
    setSelected(remainder);
    openConfirm(remainder);
  };

  const close = () => {
    if (onChanged) onChanged();
    onClose();
  };

  const fieldStyle = { fontSize: 12, padding: '4px 8px', borderRadius: 6, background: '#fff' };
  const totalSelected = selected.length;
  const scopeIsUnion = !activeNgo;
  const activeNgoName = ngoOptions.find(n => n.id === activeNgo)?.name || '';

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Assigned Donors — {station}</h3>
            {activeNgoName && <span className="pill pill-green">{activeNgoName}</span>}
            {scopeIsUnion && <span className="pill pill-yellow">All NGOs combined</span>}
            <span className="pill pill-blue">{donors.length} donor{donors.length === 1 ? '' : 's'}</span>
          </div>
          <button className="btn btn-sm btn-outline" onClick={close} aria-label="Close"><X size={14} /></button>
        </div>

        <div className="modal-body" style={{ fontSize: 13 }}>
          {/* NGO scope. The count above is scoped to this choice, so it always
              matches the per-NGO pill on the station row it was opened from. */}


          {/* Filters + export */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 220px', minWidth: 180, border: '1px solid var(--line, #e5e7eb)', borderRadius: 8, padding: '4px 10px', background: '#fff' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name, mobile..."
                style={{ border: 'none', outline: 'none', flex: 1, fontSize: 12, fontFamily: 'inherit', background: 'transparent' }}
              />
            </div>

            <button className="btn btn-sm btn-outline" onClick={() => onDownloadExcel(activeNgo)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Download Excel">
              <Download size={13} />
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setUploadStation(station)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Upload Sheet">
              <Upload size={13} />
            </button>
            {onAddDonor && (
              <button className="btn btn-sm btn-outline" onClick={onAddDonor} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Add Donor">
                <UserPlus size={13} />
              </button>
            )}

          </div>



          {/* Success */}
          {result && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 12.5, color: '#166534' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={13} /> {result.message}</span>
              {result.totals && (
                <div style={{ fontSize: 11.5, marginTop: 3, opacity: .85 }}>
                  Removed {result.totals.logs || 0} log(s), {result.totals.schedules || 0} scheduled contact(s),
                  {' '}{result.totals.tickets || 0} rejected-lead ticket(s) and {result.totals.queue_rows || 0} queue row(s).
                </div>
              )}
            </div>
          )}

          {/* Confirm / block review */}
          {confirmOpen && (
            <div style={{ background: '#fff7ed', border: '1px solid #fb923c', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, color: '#9a3412', fontSize: 14 }}>
                  {preview?.loading ? 'Fetching records…'
                    : preview?.error ? 'Could not load preview'
                    : blocked.length > 0 ? `Blocked: ${blocked.length} of ${pendingIds.length} cannot be deleted`
                    : `Review: ${preview?.deletable?.length ?? 0} donor(s) will be removed`}
                </div>
                <button className="btn btn-sm btn-outline" onClick={() => { setConfirmOpen(false); setPreview(null); }}>Cancel</button>
              </div>

              {preview?.loading && <div style={{ padding: 14, textAlign: 'center', color: '#9a3412' }}>Matching records…</div>}
              {preview?.error && <p style={{ color: '#b91c1c', margin: 0 }}>Error: {preview.error}</p>}

              {/* Money guard refused part or all of the selection. */}
              {blocked.length > 0 && (
                <>
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, color: '#991b1b', fontSize: 12.5, marginBottom: 6 }}>
                      A donor with collected money or a linked receipt cannot be removed.
                    </div>
                    {blocked.map(b => (
                      <div key={b.assignment_id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#7f1d1d', padding: '2px 0' }}>
                        <XCircle size={13} />
                        <span style={{ fontWeight: 600 }}>{b.donor_name || 'Unknown'}</span>
                        {b.mobile_number ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>· {b.mobile_number}</span> : null}
                        <span style={{ opacity: .85 }}>— {b.reason}</span>
                      </div>
                    ))}
                    <p style={{ margin: '8px 0 0', fontSize: 11.5, color: '#991b1b' }}>
                      Nothing was deleted. These donors stay on the station.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button className="btn btn-sm btn-outline" onClick={() => { setConfirmOpen(false); setPreview(null); setBlocked([]); }}>Close</button>
                    {pendingIds.length > blocked.length && (
                      <button className="btn btn-sm" style={{ background: '#dc2626', color: '#fff' }}
                        onClick={deleteRemainder} disabled={deleting}>
                        Delete {pendingIds.length - blocked.length} remaining donor{pendingIds.length - blocked.length === 1 ? '' : 's'}
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Clean preview — nothing blocked. */}
              {blocked.length === 0 && preview && !preview.loading && !preview.error && (
                <>
                  {preview.deletable.length === 0 ? (
                    <p style={{ margin: 0, color: '#166534', padding: '4px 0' }}>
                      None of the selected assignments are still active on this station — nothing to delete.
                    </p>
                  ) : (
                    <>
                      <div style={{ maxHeight: 220, overflowY: 'auto', borderRadius: 8, background: '#fff' }}>
                        <table className="nga-st" style={{ fontSize: 11.5 }}>
                          <thead>
                            <tr>
                              <th style={{ width: '26%' }}>Donor</th>
                              <th style={{ width: '15%' }}>Mobile</th>
                              <th style={{ width: '13%' }}>Status</th>
                              <th style={{ width: '10%' }}>Logs</th>
                              <th style={{ width: '12%' }}>Schedules</th>
                              <th style={{ width: '12%' }}>Tickets</th>
                              <th style={{ width: '12%' }}>Queue</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.deletable.map(r => (
                              <tr key={r.assignment_id}>
                                <td style={{ fontWeight: 600 }}>
                                  {r.donor_name || '—'}
                                  {r.had_dnd_mark && (
                                    <span className="pill pill-yellow" style={{ fontSize: 9, marginLeft: 5 }} title="Active DND mark for this NGO — still suppressed after removal">DND</span>
                                  )}
                                </td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.mobile_number || '—'}</td>
                                <td>{dispositionLabelOf(r.status)}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.log_count}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.schedule_count}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.ticket_count}</td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.queue_count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p style={{ margin: '10px 0 0', color: '#78350f', lineHeight: 1.5 }}>
                        The station assignment, its disposition logs, scheduled contacts, rejected-lead tickets and queue rows will be
                        <strong> deleted</strong>. The donor profile and any receipts are left untouched.
                        {' '}This frees the number to be assigned again within this NGO.
                      </p>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-outline" onClick={() => { setConfirmOpen(false); setPreview(null); }}>Cancel</button>
                        <button className="btn btn-sm" style={{ background: '#dc2626', color: '#fff' }} onClick={handleDelete} disabled={deleting}>
                          {deleting ? 'Deleting…' : `Confirm Delete ${preview.deletable.length} Donor${preview.deletable.length === 1 ? '' : 's'}`}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Donor table */}
          {loading ? (
            <div className="loading" style={{ padding: 24 }}>Loading donors…</div>
          ) : donors.length === 0 ? (
            <div className="empty-state" style={{ padding: 20, textAlign: 'center' }}>
              <p style={{ color: 'var(--ink-soft)', margin: 0 }}>
                No donors are assigned to {station}{activeNgoName ? ` for ${activeNgoName}` : ''}.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: 20, textAlign: 'center' }}>
              <p style={{ color: 'var(--ink-soft)', margin: 0 }}>No donors match the current filters.</p>
            </div>
          ) : (
            <div className="sm-no-scrollbar" style={{ maxHeight: 400, overflowY: 'auto', borderRadius: 8, background: '#fff' }}>
              <table className="nga-st" style={{ fontSize: 12 }}>
                <thead>
                  <tr>

                    {/* NGO column only in the combined view: when scoped to one
                        NGO every row shares it, and when combined it is the only
                        thing that tells two same-named stations apart. */}
                    {scopeIsUnion && <th style={{ width: '8%' }}>NGO</th>}
                    <th style={{ width: '20%' }}>Donor</th>
                    <th style={{ width: '13%' }}>Mobile</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(d => {
                    const isSel = selectedIds.has(d.id);
                    const group = dispositionGroupOf(d.status);
                    return (
                      <tr key={d.id}>
                        {scopeIsUnion && (
                          <td style={{ fontSize: 11 }}>
                            <span className="pill" style={{ fontSize: 10 }}>{d.ngo_name || '—'}</span>
                          </td>
                        )}
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{d.donor_name || '—'}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {d.donor_mobile || '—'}
                          {d.donor_mobile_2 ? <div style={{ fontSize: 10.5, opacity: .7 }}>{d.donor_mobile_2}</div> : null}
                        </td>

                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                          <button className="btn btn-sm btn-outline" title={`Remove ${d.donor_name || 'donor'} from ${station}`}
                            aria-label={`Delete ${d.donor_name || 'donor'}`}
                            onClick={() => openConfirm([d.id])}
                            disabled={deleting}
                            style={{ color: '#b91c1c', borderColor: '#fca5a5', padding: '2px 6px' }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0 2px', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
              <span style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 }}>
                Page {page} of {totalPages}
              </span>
              <button className="btn btn-sm btn-outline" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
            </div>
          )}


        </div>
      </div>
    </div>
  );
}

// ─── High Tier ────────────────────────────────────────────────────────────
//
// High Tier is a third data bucket on the FRO panel's My Leads (alongside New
// and Old). This panel moves ONE source station's entire allotment into that
// bucket and splits it across the chosen target stations in a single shot.
//
// Nothing is left on the source: every lead is handed to a target. Equal mode
// divides as evenly as possible (remainder to the first stations); manual mode
// requires the per-station counts to add up to the exact total before the
// distribute button unlocks. The source station is emptied and its FRO is
// unassigned by the backend, so it can then be deleted.
function HighTierPanel({ stations, froWorkers, selectedNgoId, allNgos, onDistributed }) {
  const [sourceStation, setSourceStation] = useState('');
  const [mode, setMode] = useState('equal');
  const [selected, setSelected] = useState([]); // target station names, in pick order
  const [counts, setCounts] = useState({});      // manual mode: station -> string
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(false);

  // Live High Tier batches for this NGO (grouped by source station), so an admin
  // can see where each source's data went and bring a whole batch back.
  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [restoreBatch, setRestoreBatch] = useState(null);
  const [restoring, setRestoring] = useState(false);
  // Wrong-station fix-up: re-point ONE target station's slice of a live batch to
  // another station (D's 50 → E) without restoring the whole batch.
  const [moveBatch, setMoveBatch] = useState(null);
  const [moveFrom, setMoveFrom] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [moving, setMoving] = useState(false);

  const [localNgoId, setLocalNgoId] = useState(selectedNgoId);
  useEffect(() => { setLocalNgoId(selectedNgoId); }, [selectedNgoId]);
  const ngoId = localNgoId && localNgoId !== 'all' ? localNgoId : null;
  const ngo = allNgos.find(n => String(n.id) === String(ngoId));
  const ngoName = ngo?.name || 'this NGO';

  const countFor = (s) => Number(s?.donor_count?.[ngoId] || 0);
  const froNameOf = (id) => froWorkers.find(f => String(f.id) === String(id))?.name || null;

  const sourceRow = stations.find(s => s.station === sourceStation) || null;
  const total = sourceRow ? countFor(sourceRow) : 0;
  const targetCandidates = stations.filter(s => s.station !== sourceStation);

  // Equal split: base share for everyone, first `remainder` stations get one more.
  const n = selected.length;
  const base = n > 0 ? Math.floor(total / n) : 0;
  const remainder = n > 0 ? total % n : 0;
  const equalCountFor = (st) => {
    const idx = selected.indexOf(st);
    if (idx < 0) return 0;
    return base + (idx < remainder ? 1 : 0);
  };

  const manualSum = selected.reduce((sum, st) => sum + (parseInt(counts[st], 10) || 0), 0);
  const distributed = mode === 'equal' ? (n > 0 ? total : 0) : manualSum;
  const remaining = total - distributed;
  const canDistribute = !busy && !!ngoId && !!sourceStation && total > 0 && n > 0 && remaining === 0;

  const loadBatches = async () => {
    if (!ngoId) { setBatches([]); return; }
    setBatchesLoading(true);
    try {
      const res = await apiGet(`/ngo-admin/high-tier-batches?ngo_id=${encodeURIComponent(ngoId)}`);
      setBatches(Array.isArray(res?.batches) ? res.batches : []);
    } catch {
      setBatches([]);
    } finally {
      setBatchesLoading(false);
    }
  };

  useEffect(() => {
    loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ngoId]);

  if (!ngoId) {
    return (
      <div className="empty-state" style={{ padding: '36px 16px' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>
          Pick a specific NGO above to distribute High Tier data.
        </p>
      </div>
    );
  }

  const clearFeedback = () => { setResult(null); setError(null); setConfirming(false); };

  const toggleTarget = (st) => {
    clearFeedback();
    setSelected(prev => prev.includes(st) ? prev.filter(x => x !== st) : [...prev, st]);
  };

  const switchMode = (m) => {
    clearFeedback();
    // Seed manual counts from the equal split so the admin edits instead of
    // starting from a wall of empty boxes.
    if (m === 'manual' && mode === 'equal' && n > 0) {
      const seed = {};
      selected.forEach(st => { seed[st] = String(equalCountFor(st)); });
      setCounts(seed);
    }
    setMode(m);
  };

  const reseedEqual = () => {
    clearFeedback();
    const seed = {};
    selected.forEach(st => { seed[st] = String(equalCountFor(st)); });
    setCounts(seed);
  };

  const reset = () => {
    setSourceStation(''); setSelected([]); setCounts({}); setConfirming(false);
    setError(null); setResult(null);
  };

  const distribute = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiPost(
        `/ngo-admin/stations/${encodeURIComponent(sourceStation)}/high-tier-distribute`,
        {
          ngo_id: ngoId,
          mode,
          targets: selected.map(st => ({
            station: st,
            count: mode === 'equal' ? equalCountFor(st) : (parseInt(counts[st], 10) || 0),
          })),
        },
      );
      setResult(res);
      setSourceStation(''); setSelected([]); setCounts({}); setConfirming(false);
      loadBatches();
      if (onDistributed) onDistributed();
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (batch) => {
    setRestoring(true); setError(null);
    try {
      const res = await apiPost('/ngo-admin/high-tier-restore', { batch_id: batch.batch_id, ngo_id: ngoId });
      setResult(res);
      setRestoreBatch(null);
      await loadBatches();
      if (onDistributed) onDistributed();
    } catch (err) {
      setError(err.message);
      setRestoreBatch(null);
    } finally {
      setRestoring(false);
    }
  };

  // Destination choices for a slice move: any station except the one being moved
  // off and the batch's own source (going back to source is a Restore, and the
  // backend rejects it here too).
  const moveTargetOptions = (batch, from) => {
    const exclude = new Set([from, batch.source_station].filter(Boolean));
    const names = stations.map(s => s.station).filter(st => st && !exclude.has(st));
    return [...new Set(names)].sort((a, b) => String(a).localeCompare(String(b)));
  };

  const openMove = (batch) => {
    setError(null); setResult(null);
    setRestoreBatch(null);
    setMoveFrom(''); setMoveTo('');
    setMoveBatch(batch);
  };

  const doMove = async (batch) => {
    if (!moveFrom || !moveTo) return;
    setMoving(true); setError(null);
    try {
      const res = await apiPost('/ngo-admin/high-tier-move', {
        batch_id: batch.batch_id,
        ngo_id: ngoId,
        from_station: moveFrom,
        to_station: moveTo,
      });
      setResult(res);
      setMoveBatch(null); setMoveFrom(''); setMoveTo('');
      await loadBatches();
      if (onDistributed) onDistributed();
    } catch (err) {
      setError(err.message);
      setMoveBatch(null);
    } finally {
      setMoving(false);
    }
  };

  const modeTabStyle = (active) => ({
    padding: '5px 14px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
    fontFamily: 'inherit', cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink-soft)',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {result && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#166534' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Check size={14} color="#16a34a" />
            <strong>{result.message}</strong>
          </div>
          {Array.isArray(result.per_station) && result.per_station.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {result.per_station.map(p => (
                <span key={p.station} className="pill pill-blue">{p.station}: {p.count}</span>
              ))}
            </div>
          )}
          {result.source_fro_assigned === false && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#92400e' }}>
              {result.source_station} has no FRO assigned right now — the data is back on the station and will reach an FRO as soon as one is assigned.
            </div>
          )}
          {result.to_fro_assigned === false && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#92400e' }}>
              {result.to_station} has no FRO assigned right now — the data sits on the station and will reach an FRO as soon as one is assigned.
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c' }}>
          {error}
        </div>
      )}

      <div style={{ background: '#f8fafc', border: '1px solid var(--line, #e2e8f0)', borderRadius: 10, padding: '12px 16px', fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
        High Tier lives in its own bucket on the FRO panel — it never mixes with New or Old data.
        Pick a source station of <strong style={{ color: 'var(--ink)' }}>{ngoName}</strong>, choose how to split its
        full data, then distribute. The source station is emptied and its FRO is unassigned in one step.
      </div>

      {/* NGO selector (moved here so no top filter) */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--ink-soft)', marginBottom: 6 }}>NGO</label>
        <select value={localNgoId || ''} onChange={e => setLocalNgoId(e.target.value)} style={{ width: '100%', maxWidth: 320, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line, #e2e8f0)', fontFamily: 'inherit', background: '#fff' }}>
          {allNgos.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </div>

      {/* Step 1 — source */}
      <div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--ink-soft)', marginBottom: 6 }}>
          1. Source station ({ngoName})
        </label>
        <select
          value={sourceStation}
          onChange={e => { setSourceStation(e.target.value); setSelected([]); setCounts({}); clearFeedback(); }}
          style={{ width: '100%', maxWidth: 420, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line, #e2e8f0)', fontFamily: 'inherit', background: '#fff' }}
        >
          <option value="">-- Select source station --</option>
          {stations.filter(s => countFor(s) > 0).map(s => (
            <option key={s.station} value={s.station}>
              {s.station} — {countFor(s).toLocaleString('en-IN')} leads
              {s.fro_worker_id ? ` · FRO ${froNameOf(s.fro_worker_id) || '—'}` : ' · no FRO'}
            </option>
          ))}
        </select>
        {sourceStation && total === 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#b45309' }}>
            This station has no data to move.
          </p>
        )}
      </div>

      {sourceStation && total > 0 && (
        <>
          {/* Step 2 — mode */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--ink-soft)', marginBottom: 6 }}>
              2. Split mode
            </label>
            <div style={{ display: 'inline-flex', gap: 4, background: 'var(--bg)', borderRadius: 8, padding: 2 }}>
              <button style={modeTabStyle(mode === 'equal')} onClick={() => switchMode('equal')}>Equal split</button>
              <button style={modeTabStyle(mode === 'manual')} onClick={() => switchMode('manual')}>Manual counts</button>
            </div>
          </div>

          {/* Step 3 — targets */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--ink-soft)', marginBottom: 6 }}>
              3. Target stations ({n} selected)
            </label>
            {targetCandidates.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)' }}>
                No other stations available for {ngoName}.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
                {targetCandidates.map(s => {
                  const on = selected.includes(s.station);
                  const targetFro = s.fro_worker_id ? (froNameOf(s.fro_worker_id) || '—') : null;
                  return (
                    <div
                      key={s.station}
                      onClick={() => toggleTarget(s.station)}
                      style={{
                        border: `1px solid ${on ? 'var(--sage)' : 'var(--line, #e2e8f0)'}`,
                        background: on ? '#f0fdf4' : '#fff',
                        borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ fontSize: 13 }}>{s.station}</strong>
                        <span style={{ fontSize: 10.5, color: targetFro ? 'var(--ink-soft)' : '#b45309' }}>
                          {targetFro ? `FRO ${targetFro}` : 'No FRO'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>
                        {countFor(s).toLocaleString('en-IN')} existing
                      </div>
                      {on && (
                        <div style={{ marginTop: 6 }}>
                          {mode === 'equal' ? (
                            <span className="pill pill-blue">+{equalCountFor(s.station)}</span>
                          ) : (
                            <input
                              type="number" min="0" inputMode="numeric"
                              value={counts[s.station] ?? ''}
                              placeholder="0"
                              onClick={e => e.stopPropagation()}
                              onChange={e => { setCounts(prev => ({ ...prev, [s.station]: e.target.value })); clearFeedback(); }}
                              style={{ width: 100, fontSize: 12.5, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line, #e2e8f0)', fontFamily: 'inherit' }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 4 — summary + confirm */}
          {n > 0 && (
            <div style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 10, padding: '12px 16px', background: '#fff' }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
                <span>Total: <strong>{total.toLocaleString('en-IN')}</strong></span>
                <span>Distributed: <strong style={{ color: remaining === 0 ? '#16a34a' : '#b45309' }}>{distributed.toLocaleString('en-IN')}</strong></span>
                <span>Remaining: <strong style={{ color: remaining === 0 ? '#16a34a' : '#dc2626' }}>{remaining.toLocaleString('en-IN')}</strong></span>
              </div>

              {mode === 'manual' && (
                <button className="btn btn-sm btn-outline" style={{ marginTop: 10 }} onClick={reseedEqual} disabled={busy}>
                  Auto-split equally
                </button>
              )}

              {confirming ? (
                <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px' }}>
                  <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#92400e', lineHeight: 1.6 }}>
                    This moves all <strong>{total.toLocaleString('en-IN')}</strong> leads from <strong>{sourceStation}</strong> into
                    High Tier across {n} station{n === 1 ? '' : 's'}. The source station will be emptied and its FRO unassigned.
                    You can bring this batch back later from &quot;Active High Tier batches&quot; below.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={distribute} disabled={busy}>
                      {busy ? 'Distributing…' : 'Yes, distribute'}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" disabled={!canDistribute} onClick={() => setConfirming(true)}>
                    Review &amp; Distribute
                  </button>
                  <button className="btn btn-outline" onClick={reset} disabled={busy}>Reset</button>
                  {mode === 'manual' && remaining !== 0 && (
                    <span style={{ fontSize: 12, color: '#dc2626' }}>
                      Counts must add up to {total.toLocaleString('en-IN')} — {remaining.toLocaleString('en-IN')} left.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* High Tier management — every live batch for this NGO, grouped by source.
          Two sources can live in the same target station; each batch restores
          independently. */}
      <div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--ink-soft)', marginBottom: 6 }}>
          Active High Tier batches ({batches.length})
        </label>
        {batchesLoading ? (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</p>
        ) : batches.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)' }}>
            No High Tier data is currently distributed for {ngoName}.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {batches.map(b => (
              <div key={String(b.batch_id)} style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <div>
                    <strong style={{ fontSize: 13 }}>{b.source_station}</strong>
                    <span style={{ fontSize: 11, color: 'var(--ink-soft)', marginLeft: 8 }}>
                      {Number(b.total || 0).toLocaleString('en-IN')} leads from this source
                    </span>
                    {/* This batch's own yield for the current month, split per
                        target station in the pills below. Independent of the
                        Collected card — it is scoped to the batch, not the FRO. */}
                    <span style={{ fontSize: 11, fontWeight: 700, color: Number(b.collected_amount || 0) > 0 ? '#7c3aed' : 'var(--ink-soft)', marginLeft: 8 }}>
                      ₹{Number(b.collected_amount || 0).toLocaleString('en-IN')} collected (this month)
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                    {b.distributed_at ? new Date(b.distributed_at).toLocaleString('en-IN') : ''}
                  </div>
                </div>
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(b.targets || []).map(t => (
                    <span key={t.station} className="pill pill-blue" title="This month's collection from these leads">
                      {t.station}: {Number(t.count || 0).toLocaleString('en-IN')}
                      {Number(t.amount || 0) > 0 && (
                        <strong style={{ marginLeft: 5, color: '#7c3aed' }}>₹{Number(t.amount).toLocaleString('en-IN')}</strong>
                      )}
                    </span>
                  ))}
                </div>

                {restoreBatch && String(restoreBatch.batch_id) === String(b.batch_id) ? (
                  <div style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px' }}>
                    <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#92400e', lineHeight: 1.6 }}>
                      Bring all <strong>{Number(b.total || 0).toLocaleString('en-IN')}</strong> leads back to
                      <strong> {b.source_station}</strong>? They return to their original New/Old bucket. Data from
                      other sources stays where it is.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => doRestore(b)} disabled={restoring}>
                        {restoring ? 'Restoring…' : 'Yes, restore'}
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => setRestoreBatch(null)} disabled={restoring}>Cancel</button>
                    </div>
                  </div>
                ) : moveBatch && String(moveBatch.batch_id) === String(b.batch_id) ? (
                  <div style={{ marginTop: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 12px' }}>
                    <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#1e40af', lineHeight: 1.6 }}>
                      Move ONE station's whole share of this batch to another station. The rest of the batch stays
                      exactly where it is — no restore needed.
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select
                        value={moveFrom}
                        onChange={e => { setMoveFrom(e.target.value); setMoveTo(''); }}
                        style={{ fontSize: 12.5, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line, #e2e8f0)', fontFamily: 'inherit', background: '#fff' }}
                      >
                        <option value="">From station…</option>
                        {(b.targets || []).map(t => (
                          <option key={t.station} value={t.station}>
                            {t.station} — {Number(t.count || 0).toLocaleString('en-IN')} leads
                          </option>
                        ))}
                      </select>
                      <span style={{ color: 'var(--ink-soft)' }}>→</span>
                      <select
                        value={moveTo}
                        onChange={e => setMoveTo(e.target.value)}
                        disabled={!moveFrom}
                        style={{ fontSize: 12.5, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line, #e2e8f0)', fontFamily: 'inherit', background: '#fff' }}
                      >
                        <option value="">To station…</option>
                        {moveTargetOptions(b, moveFrom).map(st => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                      <button className="btn btn-primary btn-sm" onClick={() => doMove(b)} disabled={moving || !moveFrom || !moveTo}>
                        {moving ? 'Moving…' : 'Move'}
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => { setMoveBatch(null); setMoveFrom(''); setMoveTo(''); }} disabled={moving}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => { setError(null); setResult(null); setMoveBatch(null); setRestoreBatch(b); }}
                      disabled={busy || restoring || moving}
                    >
                      Restore to {b.source_station}
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => openMove(b)}
                      disabled={busy || restoring || moving}
                    >
                      Move a station's share
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function StationManagement() {
  const [stations, setStations] = useState([]);
  const [allNgos, setAllNgos] = useState([]);
  const [froWorkers, setFroWorkers] = useState([]);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newStation, setNewStation] = useState('');
  const [newStationNgo, setNewStationNgo] = useState('');
  const [adding, setAdding] = useState(false);
  const [editNgoStation, setEditNgoStation] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [returningId, setReturningId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [targetAmount, setTargetAmount] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => istMonthKey());
  const [selectedNgoId, setSelectedNgoId] = useState(null);
  const [ngoGroup, setNgoGroup] = useState(null);      // 'bsct' | 'aflf' | 'mann' | 'other' | null
  const [uploadStation, setUploadStation] = useState(null);
  const [stationTab, setStationTab] = useState('old');
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef(null);
  const [ncfOpen, setNcfOpen] = useState(false);
  // The station whose "View donor list" modal is open, held as { station, ngoList,
  // defaultNgoId } rather than a bare name. A station name is reused across NGOs
  // (DH-5 is BOD-15/AOD-15/MOD-15), so the modal needs to know WHICH of them the
  // admin clicked - without it the list unions them all and the count disagrees
  // with the per-NGO pill on the row.
  const [donorListTarget, setDonorListTarget] = useState(null);
  const [stationDetailTarget, setStationDetailTarget] = useState(null);
  const [addDonorTarget, setAddDonorTarget] = useState(null);
  // Temporary Data Access: which station's "Grant temporary access" modal is
  // open ({ station, ngoId, permanentFroId, permanentFroName, donorCount }).
  // Separate from editNgoStation/permanent-assignment state on purpose — the
  // grant flow must never route through the permanent FRO dropdown.
  const [tempAccessTarget, setTempAccessTarget] = useState(null);
  const [stacksModalTarget, setStacksModalTarget] = useState(null);
  const [allStacks, setAllStacks] = useState([]);
  // Live grants for the whole table: rendered as a per-station badge so the
  // admin SEES who currently has temporary access without leaving this page,
  // and can revoke it inline. Refetched after every grant/revoke.
  const [tempGrants, setTempGrants] = useState([]);
  const [revokeGrantTarget, setRevokeGrantTarget] = useState(null); // { grant, station }
  const [revokingGrant, setRevokingGrant] = useState(false);

  // ─── Hide Old Donors ──────────────────────────────────────────────────────
  // One global switch for the whole panel. When it is ON the field teams are
  // narrowed to the new (FD-*) stations: the old station's donors, their
  // follow-ups and their history are hidden from them, so they can only work
  // on the new data. Turning it off brings the old data straight back.
  const [hideOldDonors, setHideOldDonorsState] = useState(false);
  const [hidingOldDonors, setHidingOldDonors] = useState(false);
  // Daily time window on top of the manual switch: { enabled, hideAt, showAt,
  // lastWindow, usable }. Loaded with the switch so the header can say when the
  // next automatic flip is due.
  const [autoSchedule, setAutoSchedule] = useState(null);
  const [autoScheduleOpen, setAutoScheduleOpen] = useState(false);
  const [savingAutoSchedule, setSavingAutoSchedule] = useState(false);

  const loadHideOldDonors = () => {
    getHideOldDonors()
      .then(r => {
        setHideOldDonorsState(!!r?.hidden);
        // Older backends do not return `auto` — fall back to a disabled schedule
        // so the button renders as "Auto" instead of blowing up.
        setAutoSchedule(r?.auto || { enabled: false, hideAt: '10:00', showAt: '19:00', usable: false });
      })
      .catch(() => {
        setHideOldDonorsState(false); // feature unavailable → shown
        setAutoSchedule(null);
      });
  };

  const saveAutoSchedule = async ({ enabled, hideAt, showAt }) => {
    setSavingAutoSchedule(true);
    try {
      const res = await setHideOldDonorsSchedule({ enabled, hideAt, showAt });
      setAutoSchedule({
        enabled: !!res?.enabled,
        hideAt: res?.hideAt || hideAt,
        showAt: res?.showAt || showAt,
        lastWindow: res?.lastWindow ?? null,
        usable: !!res?.usable,
        nextChange: res?.nextChange || null,
      });
      if (typeof res?.hidden === 'boolean') setHideOldDonorsState(res.hidden);
      setAutoScheduleOpen(false);
      setMsg(res?.message || 'Auto-hide schedule saved.');
    } catch (e) {
      toast(e?.message || 'Could not save the auto-hide schedule', 'error');
    } finally {
      setSavingAutoSchedule(false);
    }
  };

  const toggleHideOldDonors = async () => {
    const next = !hideOldDonors;
    const question = next
      ? 'Hide old-station donors from the field teams?\n\nEvery FRO will be limited to the new (FD) stations. The old stations\' donors, their follow-ups and their history will not be visible to them until you turn this back on.'
      : 'Show old-station donors again?\n\nThe FROs assigned to the old stations will get their donors, follow-ups and history back.';
    if (!confirm(question)) return;
    setHidingOldDonors(true);
    try {
      const res = await setHideOldDonors(next);
      setHideOldDonorsState(!!res?.hidden);
      setMsg(res?.message || (next
        ? 'Old-station donors are now hidden from the field teams.'
        : 'Old-station donors are visible again.'));
    } catch (e) {
      toast(e?.message || 'Could not change the hide-old-donors setting', 'error');
    } finally {
      setHidingOldDonors(false);
    }
  };

  const loadTempGrants = () => {
    listTemporaryAccess()
      .then(rows => setTempGrants(Array.isArray(rows) ? rows : []))
      .catch(() => setTempGrants([])); // feature off (503) → simply no badges
  };

  // Live (ACTIVE or SCHEDULED) grants covering this station row's (station,
  // NGO) pair — what the badge shows and what revoke acts on. A row can
  // theoretically hold grants from multiple NGOs' scopes, so it returns a list.
  const liveGrantsFor = (s) => {
    const ngoId = ngoScopeForRow(s);
    return tempGrants.filter(g =>
      g.station === s.station
      && (g.computed_status === 'ACTIVE' || g.computed_status === 'SCHEDULED')
      && (!ngoId || !g.ngo_id || g.ngo_id === ngoId)
    );
  };

  const handleRevokeGrant = async () => {
    if (!revokeGrantTarget) return;
    setRevokingGrant(true);
    try {
      await revokeTemporaryAccess(revokeGrantTarget.grant.id, { reason: 'Revoked from station management' });
      setMsg(`Temporary access to ${revokeGrantTarget.station} revoked. ${revokeGrantTarget.grant.working_fro_name || 'The FRO'} no longer sees this station — completed work is untouched.`);
      setRevokeGrantTarget(null);
      loadTempGrants();
    } catch (e) {
      setMsg(`Revoke failed: ${e?.message || 'unknown error'}`);
    } finally {
      setRevokingGrant(false);
    }
  };

  // Resolve which NGO a station row means: the tab currently being viewed when
  // that NGO owns this station, else the row's first NGO. Falls back to null when
  // the station belongs to no NGO, which the endpoint treats as "no scope".
  const ngoScopeForRow = (s) => {
    const rowNgos = (s.ngos || []).filter(n => n && n.ngo_id);
    if (rowNgos.length === 0) return null;
    const preferred = selectedNgoId && selectedNgoId !== 'all' ? String(selectedNgoId) : null;
    const match = preferred ? rowNgos.find(n => String(n.ngo_id) === preferred) : null;
    return (match || rowNgos[0]).ngo_id;
  };

  useEffect(() => {
    if (!toolsOpen) return;
    const handler = (e) => { if (toolsRef.current && !toolsRef.current.contains(e.target)) setToolsOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [toolsOpen]);

  // Group NGOs: known tiers (bsct/aflf/mann) + anything else aggregates as "other".
  const groupOfName = (name) => {
    const k = String(name || '').trim().toLowerCase();
    return NGO_NAME_COLORS[k] ? k : 'other';
  };

  const ngoColor = (name) => NGO_NAME_COLORS[String(name || '').trim().toLowerCase()] || '#6b7280';

  // NGO tabs: bsct, aflf, mann (+ "other" only when such NGOs exist).
  const ngoTabs = [];
  const ngoGroupList = new Map();
  for (const n of allNgos) {
    const g = groupOfName(n.name);
    if (!ngoGroupList.has(g)) ngoGroupList.set(g, []);
    ngoGroupList.get(g).push(n);
  }
  if (ngoGroupList.has('bsct')) ngoTabs.push({ key: 'bsct', label: 'BSCT', id: ngoGroupList.get('bsct')[0].id });
  if (ngoGroupList.has('aflf')) ngoTabs.push({ key: 'aflf', label: 'AFLF', id: ngoGroupList.get('aflf')[0].id });
  if (ngoGroupList.has('mann')) ngoTabs.push({ key: 'mann', label: 'MANN', id: ngoGroupList.get('mann')[0].id });
  if (ngoGroupList.has('other')) ngoTabs.push({ key: 'other', label: 'Other', id: 'other' });

  const selectNgo = (id, group) => {
    setSelectedNgoId(id);
    setNgoGroup(group);
  };

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  useEffect(() => {
    loadTargets(selectedMonth);
  }, [selectedMonth]);

  const computeNextName = (existingStations) => {
    const nums = existingStations
      .map(s => {
        const m = s.station?.match(/^new_ucs-(\d+)$/i);
        return m ? parseInt(m[1], 10) : NaN;
      })
      .filter(n => !isNaN(n));
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `new_ucs-${max + 1}`;
  };

  const fetchTransfers = () => {
    apiGet('/ngo-admin/transfers').then(r => {
      setTransfers(Array.isArray(r) ? r : []);
    }).catch((err) => { console.error('Error:', err.message); });
  };

  const fetchData = (successMsg, month) => {
    const m = month || selectedMonth;
    const url = '/ngo-admin/stations';
    try {
      const cached = localStorage.getItem('ucs_stations_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        // Only trust the cache if it already carries the donor amount range
        // (newer payloads). Stale caches from before that field existed would
        // hide the range until the next fetch, so ignore them.
        if (Array.isArray(parsed) && parsed.some(s => s && (s.donor_amount_min != null || s.donor_amount_max != null))) {
          setStations(parsed); setLoading(false);
        }
      }
    } catch {}
    apiGet(url).then(s => {
      if (Array.isArray(s)) { setStations(s); try { localStorage.setItem('ucs_stations_cache', JSON.stringify(s)); } catch {} }
    }).catch(err => console.error('fetchData error:', err));
    apiGet('/ngo-admin/transfers').then(t => {
      setTransfers(Array.isArray(t) ? t : []);
    }).catch(err => console.error('fetchData transfers error:', err));
    loadTempGrants();
    const stacksNgo = selectedNgoId !== 'all' ? selectedNgoId : (ngoIds[0] || '');
    if (stacksNgo) {
      apiGet('/ngo-admin/stacks?ngo_id=' + stacksNgo).then(s => {
        setAllStacks(Array.isArray(s?.stacks) ? s.stacks : (Array.isArray(s) ? s : []));
      }).catch(() => setAllStacks([]));
    }
    const ngoParam = selectedNgoId !== 'all' ? '&ngo_id=' + selectedNgoId : '';
    apiGet('/ngo-admin/targets?month=' + m + ngoParam).then(t => {
      if (Array.isArray(t)) setTargets(t);
    }).catch((err) => { console.error('Error:', err.message); });
    if (successMsg) setMsg(successMsg);
  };

  const loadTargets = (month) => {
    const m = month || selectedMonth;
    const ngoParam = selectedNgoId !== 'all' ? '&ngo_id=' + selectedNgoId : '';
    apiGet('/ngo-admin/targets?month=' + m + ngoParam).then(t => {
      if (Array.isArray(t)) setTargets(t);
    }).catch((err) => { console.error('Error:', err.message); });
  };

  useEffect(() => {
    setLoading(true);
    try {
      const cached = localStorage.getItem('ucs_stations_cache');
      if (cached) { const parsed = JSON.parse(cached); if (Array.isArray(parsed) && parsed.length) { setStations(parsed); setLoading(false); } }
    } catch {}
    const m = istMonthKey();
    apiPost('/ngo-admin/ngos/ensure').catch(() => {}).then(() => {
      return Promise.all([
        apiGet('/ngo-admin/ngos/all'),
        apiGet('/ngo-admin/fro-workers'),
        apiGet('/ngo-admin/targets?month=' + m),
      ]);
    }).then(([n, f, t]) => {
      setAllNgos(Array.isArray(n) ? n : []);
      setFroWorkers(Array.isArray(f) ? f : []);
      if (Array.isArray(t)) setTargets(t);
      const ngoList = Array.isArray(n) ? n : [];
      if (ngoList.length > 0) {
        setSelectedNgoId(ngoList[0].id);
        setNgoGroup(groupOfName(ngoList[0].name));
      }
    }).catch(err => console.error('Initial load error:', err)).finally(() => setLoading(false));
    apiGet('/ngo-admin/transfers').then(t => {
      setTransfers(Array.isArray(t) ? t : []);
    }).catch(err => console.error('Initial transfers load error:', err));
    loadHideOldDonors();
  }, []);

  useEffect(() => {
    if (selectedNgoId) fetchData();
  }, [selectedNgoId]);

  const activeTransfers = transfers.filter(t => !t.returned);
  const historyTransfers = transfers.filter(t => t.returned);

  const groupBase = stations.filter(s => {
    if (!ngoGroup) return true;
    return groupOfName(s.ngos?.[0]?.ngo_name) === ngoGroup;
  });

  const stationCounts = {
    old: stations.filter(s => !isFreshStation(s.station)).length,
    new: stations.filter(s => isFreshStation(s.station)).length,
  };

  const filteredStations = stations.filter(s => {
    if (stationTab === 'new' && !isFreshStation(s.station)) return false;
    if (stationTab === 'old' && isFreshStation(s.station)) return false;
    const term = searchTerm.trim().toLowerCase();
    if (term && !(String(s.station).toLowerCase().includes(term) || String(s.fro_worker_name || '').toLowerCase().includes(term))) return false;
    return true;
  });

  // How many stations each FRO is currently assigned to (across all NGOs).
  // Shown as a badge beside the FRO's name so an admin can see at a glance
  // how many stations a person is sitting on (e.g. Mahima -> 3).
  const froStationCount = useMemo(() => {
    const map = {};
    for (const s of stations) {
      if (!s.fro_worker_id) continue;
      // Count only the stations of the kind the admin is currently looking at,
      // so the badge reflects "old stations" on the Old tab and "new stations"
      // on the New tab — not a combined total.
      if (stationTab === 'new' && !isFreshStation(s.station)) continue;
      if (stationTab === 'old' && isFreshStation(s.station)) continue;
      const id = String(s.fro_worker_id);
      map[id] = (map[id] || 0) + 1;
    }
    return map;
  }, [stations, stationTab]);

  const renderStationRow = (s, ngo) => {
    const ngoName = ngo?.name || s.ngos?.[0]?.ngo_name;
    const ngoCol = ngoColor(ngoName);
    const at = activeTransfers.find(t => t.station?.trim() === s.station?.trim());
    const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
    return (
      <tr key={`${ngo?.id || 'x'}-${s.station}`} style={{ borderBottom: '1px solid var(--line, #f1f5f9)', background: (!s.fro_worker_id && !s.fro_worker_name) ? `${ngoCol}14` : 'transparent' }}>
        <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14, letterSpacing: '.2px', cursor: 'pointer', color: 'var(--sage)' }} onClick={() => setDonorListTarget({ station: s.station, ngoList: s.ngos || [], defaultNgoId: ngoScopeForRow(s) })}>{s.station}</strong>
            {liveGrantsFor(s).filter(g => g.scope_type !== 'STATION_HIGH_TIER').map(g => (
              <span key={g.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <span
                  title={`Temporary access${g.working_fro_name ? ` — ${g.working_fro_name}` : ''} until ${fmtIstDateTime(g.expires_at)} IST.`}
                  style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  {g.working_fro_name || 'FRO'}
                </span>
                <button
                  onClick={() => setRevokeGrantTarget({ grant: g, station: s.station })}
                  style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', cursor: 'pointer', lineHeight: 1.5 }}
                >✕</button>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 9, color: 'var(--ink-soft)', marginTop: 0, lineHeight: 1.2 }}>
            {Number((s.donor_count?.[ngo?.id] || 0) + (s.high_tier_donor_count?.[ngo?.id] || 0)).toLocaleString('en-IN')} donor{Number((s.donor_count?.[ngo?.id] || 0) + (s.high_tier_donor_count?.[ngo?.id] || 0)) === 1 ? '' : 's'}
          </div>
          {/* amount range removed per request */}
          {at && (
            <div style={{ marginTop: 3, fontSize: 11, color: '#b45309', fontWeight: 600 }}>
              → {at.target_station}
            </div>
          )}
        </td>
        <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchableSelect
                options={froWorkers}
                value={s.fro_worker_id || ''}
                onChange={(val) => handleFroChange(s.station, val)}
                placeholder={s.fro_worker_id ? (w?.name || '--') : '+ Assign FRO'}
              />
            </div>
            {s.fro_worker_id && froStationCount[String(s.fro_worker_id)] >= 1 && (
              <span title={`${w?.name || 'This FRO'} is assigned to ${froStationCount[String(s.fro_worker_id)]} ${stationTab === 'new' ? 'new' : 'old'} station${froStationCount[String(s.fro_worker_id)] === 1 ? '' : 's'} (this tab).`}
                style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {froStationCount[String(s.fro_worker_id)]}
              </span>
            )}
            <button
              title="Grant temporary access"
              onClick={() => setTempAccessTarget({ station: s.station, ngoId: ngoScopeForRow(s), permanentFroId: s.fro_worker_id || null, permanentFroName: (froWorkers.find(w => w.id === s.fro_worker_id) || {}).name || null, donorCount: (ngoScopeForRow(s) && s.donor_count?.[ngoScopeForRow(s)]) || 0 })}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', flexShrink: 0 }}
            >
              <Unlink size={13} />
            </button>
            <button
              title="Manage donor stacks"
              onClick={() => setStacksModalTarget({ station: s.station, ngoId: ngoScopeForRow(s) })}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: (allStacks || []).some(st => st.station === s.station) ? '2px solid #16a34a' : '1px solid #bbf7d0', background: (allStacks || []).some(st => st.station === s.station) ? '#16a34a' : '#f0fdf4', color: (allStacks || []).some(st => st.station === s.station) ? '#fff' : '#166534', cursor: 'pointer', flexShrink: 0, fontSize: 12, fontWeight: 800 }}
            >
              S
            </button>
          </div>
        </td>

      </tr>
    );
  };

  // ngoId scopes the export to one NGO. Omitted, the endpoint unions every NGO
  // that uses this station NAME - which is a different number from the per-NGO
  // pill on the station row, so the caller always passes the NGO it means.
  const downloadStationExcel = async (stationName, ngoId) => {
    try {
      const params = new URLSearchParams({ station: stationName });
      if (ngoId) params.set('ngo_id', ngoId);
      const rows = await apiGet(`/ngo-admin/donors-by-station?${params}`);
      const data = (Array.isArray(rows) ? rows : []).map(r => ({
        DonorID: r.donor_id,
        Name: r.donor_name,
        Mobile: r.donor_mobile,
        Mobile2: r.donor_mobile_2,
        City: r.donor_city,
        Category: r.data_category,
        Amount: r.amount,
        Fro: r.fro_name,
        Status: r.status,
        Station: r.station,
        NGO: r.ngo_name || '',
        Notes: r.notes,
        LastContacted: r.last_contacted_at,
        NextFollowUp: r.next_follow_up,
        AssignedAt: r.assigned_at,
      }));
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Donors');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${stationName.replace(/[^a-z0-9_-]/gi, '_')}-donors.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const uploadStationTemp = async (stationName, file) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/ngo-admin/stations/${encodeURIComponent(stationName)}/upload-old-data`, { method: 'POST', body: fd, _prefix: 'ucs' });
      setMsg(`Temp upload processed for ${stationName}`);
      fetchData();
    } catch (err) {
      toast(`Temp upload failed: ${err.message}`, 'error');
    }
  };

  const downloadStationCsv = () => {};

  const handleAddStation = async (tempFile) => {
    if (!newStation.trim()) return;
    setAdding(true);
    try {
      await apiPost('/ngo-admin/stations', {
        station: newStation.trim(),
        ngo_id: newStationNgo || null,
      });
      if (tempFile) {
        await uploadStationTemp(newStation.trim(), tempFile);
      }
      setNewStationNgo('');
      const list = await apiGet('/ngo-admin/stations');
      if (Array.isArray(list)) {
        setStations(list);
        setNewStation(computeNextName(list));
      }
      setAddOpen(false);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleNgoChange = async (station, ngoId) => {
    try {
      await apiPut(`/ngo-admin/stations/${encodeURIComponent(station)}/update-ngos`, { ngo_id: ngoId });
      fetchData();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleFroChange = async (station, froWorkerId) => {
    const s = stations.find(st => st.station === station);
    if (!s) return;
    try {
      await apiPut(`/ngo-admin/stations/${encodeURIComponent(station)}/update-ngos`, {
        ngo_id: s.ngos[0]?.ngo_id || null,
        fro_worker_id: froWorkerId,
      });
      fetchData();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleReturnEarly = async (transferId) => {
    if (!confirm('Return these leads to the original station now?')) return;
    setReturningId(transferId);
    try {
      await apiPost(`/ngo-admin/transfers/${transferId}/return-early`);
      setTimeout(() => fetchData('Leads returned successfully'), 400);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setReturningId(null);
    }
  };

  const handleDeleteStation = async (station) => {
    if (!confirm(`Delete station "${station}"?`)) return;
    try {
      await apiDelete(`/ngo-admin/stations/${encodeURIComponent(station)}`);
      fetchData();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const openTarget = (s) => {
    const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
    if (!w) return;
    const t = targets.find(tg => tg.id === w.id);
    setEditTarget({ ...w, ngo_id: s.ngos?.[0]?.ngo_id || null });
    setTargetAmount(String(t?.target || ''));
  };

  const renderDonorPills = (s) => {
    const dc = s.donor_count;
    if (!dc) return <span className="pill pill-blue">0</span>;
    if (typeof dc === 'number') return <span className="pill pill-blue">{dc.toLocaleString('en-IN')}</span>;
    const parts = Object.entries(dc).map(([ngoId, cnt]) => {
      const ngo = allNgos.find(n => String(n.id) === String(ngoId));
      const name = ngo?.name || ngoId;
      return <span key={ngoId} className="pill pill-blue">{name}: {Number(cnt).toLocaleString('en-IN')}</span>;
    });
    return parts.length ? <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{parts}</span> : <span className="pill pill-blue">0</span>;
  };

  const renderPerformance = (s) => {
    const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
    const t = w ? targets.find(tg => tg.id === w.id) : null;
    const salary = w?.salary;
    const targetAmt = t?.target ?? 0;
    const source = t?.target_source;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 205 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, flexWrap: 'wrap' }}>
          <span>Target <strong>₹{Number(targetAmt || 0).toLocaleString('en-IN')}</strong></span>
          <SourcePill source={source} monthsEmployed={t?.months_employed} sourceMonth={t?.target_source_month} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)', display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Salary <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{salary != null ? '₹' + Number(salary).toLocaleString('en-IN') : '—'}</strong></span>
        </div>
      </div>
    );
  };

  return (
    <div className="station-mgmt-page" style={{ padding: 0, margin: 0 }}>
      <style>{`
        .nga-st { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .nga-st th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--ink-soft); padding: 8px 10px; border-bottom: 1px solid var(--line, #e2e8f0); white-space: nowrap; }
        .nga-st td { padding: 10px 10px; border-bottom: 1px solid var(--line, #e2e8f0); vertical-align: top; }
        .nga-st tbody tr:last-child td { border-bottom: none; }
        .nga-st tbody tr:hover { background: var(--bg, #f8fafc); }
        .nga-ngo-sub { display: none; }
        .nga-vselect { max-width: 100% !important; }
        @media (max-width: 1100px) {
          .nga-st .ng-nh { display: none; }
          .nga-ngo-sub { display: block; }
        }
        @media (max-width: 640px) {
          .nga-st { font-size: 12px; }
          .nga-st thead { display: none; }
          .nga-st, .nga-st tbody, .nga-st tr, .nga-st td { display: block; width: 100%; box-sizing: border-box; }
          .nga-st tr { border: 1px solid var(--line, #e2e8f0); border-radius: 10px; margin: 0 0 12px; padding: 28px 12px 10px; position: relative; background: #fff; }
          .nga-st tr:hover { background: #fff; }
          .nga-st td { border: none; padding: 2px 0; }
          .nga-st td[data-label]::before { content: attr(data-label); display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: var(--ink-soft); margin-bottom: 2px; }
          .nga-actions { position: absolute; top: 10px; right: 12px; }
          .nga-actions .nga-actions-inline { display: block; }
          .nga-actions .nga-actions-inline > * { margin-bottom: 6px; }
          .searchable-select { max-width: 100% !important; }
        }
      `}</style>

      {msg && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex' }}><Check size={14} color="#16a34a" /></span>
          <span>{msg}</span>
        </div>
      )}

      {/* NGO selector bar removed (moved into High Tier panel) */}
      {false && (
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--ink-soft)' }}>NGO</span>
        <select value={selectedNgoId} onChange={e => {
          const n = allNgos.find(x => String(x.id) === String(e.target.value));
          selectNgo(e.target.value === 'other' ? 'all' : e.target.value, n ? groupOfName(n.name) : (e.target.value === 'all' ? 'other' : 'other'));
        }} style={{ maxWidth: 260 }}>
          {allNgos.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        {selectedNgoId === 'all' && (
          <span className="pill pill-blue">All NGOs</span>
        )}
      </div>
      )}


      <div className="card" style={{ margin: 0, borderRadius: 0, boxShadow: 'none', border: 'none', height: '100%' }}>
        <div className="card-head" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          {/* Title / count / month */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {hideOldDonors && (
                <span
                  title="The field teams can only see the new (FD) stations right now."
                  style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <EyeOff size={12} /> Old donors hidden — FROs see only new data
                </span>
              )}
              {autoSchedule?.usable && (
                <span
                  title={`Flips itself daily at ${autoSchedule.hideAt} (hide) and ${autoSchedule.showAt} (show), IST.${autoSchedule.nextChange ? ` Next change: ${autoSchedule.nextChange.when === 'tomorrow' ? 'kal' : 'aaj'} ${autoSchedule.nextChange.at} → ${autoSchedule.nextChange.action}.` : ''}`}
                  style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Clock size={12} /> Auto {autoSchedule.hideAt}→{autoSchedule.showAt} IST
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Auto-hide window: opens the daily hide/show schedule. Shown
                  beside the manual switch because both write the same flag. */}
              <button
                onClick={() => setAutoScheduleOpen(true)}
                title={autoSchedule?.usable
                  ? `Auto-hide ON — donors stay hidden daily from ${autoSchedule.hideAt} to ${autoSchedule.showAt} IST. Click to change.`
                  : 'Set a daily window so the Hide Old Donors switch flips itself (e.g. hide 10:00, show 19:00).'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  borderRadius: 8, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                  background: autoSchedule?.usable ? '#eff6ff' : '#f8fafc',
                  color: autoSchedule?.usable ? '#1d4ed8' : 'var(--ink-soft)',
                  border: `1px solid ${autoSchedule?.usable ? '#bfdbfe' : 'var(--line, #e5e7eb)'}`,
                }}>
                <Clock size={13} />
                {autoSchedule?.usable
                  ? `Auto ${autoSchedule.hideAt}→${autoSchedule.showAt}`
                  : 'Auto hide'}
              </button>
              {/* Hide Old Donors: one global switch. ON → the field teams are
                  limited to the new (FD) stations; the old stations' donors,
                  follow-ups and history disappear from their panel. OFF → they
                  come straight back. */}
              <button
                onClick={toggleHideOldDonors}
                disabled={hidingOldDonors}
                title={hideOldDonors
                  ? 'Old-station donors are hidden from the field teams. Click to show them again.'
                  : 'Hide the old stations\' donors, follow-ups and history from the field teams so they only work on the new data.'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  borderRadius: 8, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: hidingOldDonors ? 'wait' : 'pointer',
                  background: hideOldDonors ? '#f0fdf4' : '#fef2f2',
                  color: hideOldDonors ? '#15803d' : '#b91c1c',
                  border: `1px solid ${hideOldDonors ? '#86efac' : '#fecaca'}`,
                  opacity: hidingOldDonors ? 0.6 : 1,
                }}>
                {hideOldDonors ? <Eye size={13} /> : <EyeOff size={13} />}
                {hidingOldDonors ? 'Working…' : hideOldDonors ? 'Show Old Donors' : 'Hide Old Donors'}
              </button>
            </div>
          </div>

          {/* NGO tabs */}
          {false && (
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', borderRadius: 8, padding: 2, flexWrap: 'wrap' }}>
              {ngoTabs.map(tab => (
                <button key={tab.key}
                  onClick={() => {
                    const list = ngoGroupList.get(tab.key) || [];
                    if (tab.key === 'other') selectNgo('all', 'other');
                    else selectNgo(list[0].id, tab.key);
                  }}
                  style={{
                    padding: '5px 14px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                    background: ngoGroup === tab.key ? 'var(--sage)' : 'transparent',
                    color: ngoGroup === tab.key ? '#fff' : 'var(--ink-soft)',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                  {tab.key !== 'other' && <span style={{ width: 7, height: 7, borderRadius: 99, background: NGO_NAME_COLORS[tab.key], display: 'inline-block' }} />}
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Station tabs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { key: 'old', label: 'Old', color: '#2563eb' },
              { key: 'new', label: 'New', color: '#16a34a' },
              { key: 'high-tier', label: 'High', color: '#ec4899' },
            ].map(tab => (
              <button key={tab.key} onClick={() => setStationTab(tab.key)}
                style={{
                  padding: '8px 20px', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                  background: stationTab === tab.key ? tab.color : '#f1f5f9',
                  color: stationTab === tab.key ? '#fff' : 'var(--ink-soft)',
                  boxShadow: stationTab === tab.key ? `0 4px 12px ${tab.color}44` : 'none',
                  transition: 'all .15s',
                }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search + primary actions (station list only) */}
          {stationTab !== 'high-tier' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 200, border: '1px solid var(--line, #e5e7eb)', borderRadius: 8, padding: '6px 10px', background: '#fff' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search FRO..." style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', background: 'transparent' }} />
            </div>

            <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              + Add Station
            </button>
          </div>
          )}
        </div>
      </div>


        <div className="card-pad">
          {stationTab === 'high-tier' ? (
            <HighTierPanel
              stations={stations}
              froWorkers={froWorkers}
              selectedNgoId={selectedNgoId}
              allNgos={allNgos}
              onDistributed={() => fetchData()}
            />
                    ) : loading ? (
            <div>
              <style>{`@keyframes skelPulse { 0% { opacity: .45; } 50% { opacity: 1; } 100% { opacity: .45; } } .skel { background: #e2e8f0; border-radius: 6px; animation: skelPulse 1.4s ease-in-out infinite; }`}</style>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[0,1,2].map(col => (
                  <div key={col} style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 0, overflow: 'hidden', background: '#fff' }}>
                    <div className="skel" style={{ height: 34, margin: 0, borderRadius: 0 }} />
                    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <div className="skel" style={{ height: 14, flex: 1 }} />
                          <div className="skel" style={{ height: 14, width: 90 }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (stationTab === 'old' || stationTab === 'new') ? (
            <>

            <StationNgoColumns
              stations={filteredStations}
              froWorkers={froWorkers}
              allNgos={allNgos}
              searchTerm={searchTerm}
              fresh={stationTab === 'new'}
              renderRow={renderStationRow}
            />
            </>
          ) : filteredStations.length === 0 ? (
            <div className="empty-state"><p>No {stationTab === 'new' ? 'NEW' : stationTab === 'old' ? 'OLD' : ''} stations found{searchTerm ? ` matching "${searchTerm}"` : ''}.</p></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="nga-st">
                <thead>
                  <tr>
                    <th style={{ width: '13%' }}>Station</th>
                    <th style={{ width: '8%' }}>NGO</th>
                    <th style={{ width: '20%' }}>FRO Name</th>
                    <th style={{ width: '13%' }}>Donors</th>

                    <th style={{ width: '10%', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStations.map((s, i) => {
                    const ngoName = s.ngos?.[0]?.ngo_name;
                    const ngoCol = ngoColor(ngoName);
                    const at = activeTransfers.find(t => t.station?.trim() === s.station?.trim());
                    const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
                    return (
                      <tr key={s.station} style={{ background: (!s.fro_worker_id && !s.fro_worker_name) ? `${ngoCol}14` : 'transparent' }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 15, letterSpacing: '.2px' }}>{s.station}</strong>

                          </div>
                          <span className="nga-ngo-sub" style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: ngoCol, marginTop: 2, textTransform: 'uppercase', letterSpacing: '.3px' }}>
                            {ngoName || 'No NGO'}
                          </span>
                          {at && (
                            <div style={{ marginTop: 3, fontSize: 11, color: '#b45309', fontWeight: 600 }}>
                              → {at.target_station}
                            </div>
                          )}
                          {liveGrantsFor(s).map(g => (
                            <div key={g.id} style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                              <span
                                title={`Temporary access${g.working_fro_name ? ` — ${g.working_fro_name}` : ''} until ${fmtIstDateTime(g.expires_at)} IST. Ownership unchanged: ${(froWorkers.find(fw => fw.id === s.fro_worker_id) || {}).name || 'the permanent FRO'} remains the permanent FRO.`}
                                style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                {g.working_fro_name || 'FRO'}
                              </span>
                              <button
                                onClick={() => setRevokeGrantTarget({ grant: g, station: s.station })}
                                title="Revoke this temporary access now"
                                aria-label="Revoke temporary access"
                                style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', cursor: 'pointer', lineHeight: 1.5 }}
                              >✕</button>
                            </div>
                          ))}
                        </td>
                        <td className="ng-nh">
                          <span onClick={() => setEditNgoStation(s.station)}
                            style={{ cursor: 'pointer', fontWeight: 700, fontSize: 12, color: ngoCol, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
                            {ngoName || <span style={{ color: '#9ca3af' }}>No NGO</span>}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <SearchableSelect
                                options={froWorkers}
                                value={s.fro_worker_id || ''}
                                onChange={(val) => handleFroChange(s.station, val)}
                                placeholder={s.fro_worker_id ? (w?.name || '--') : '+ Assign FRO'}
                              />
                            </div>
                            {s.fro_worker_id && froStationCount[String(s.fro_worker_id)] >= 1 && (
                              <span title={`${w?.name || 'This FRO'} is assigned to ${froStationCount[String(s.fro_worker_id)]} ${stationTab === 'new' ? 'new' : 'old'} station${froStationCount[String(s.fro_worker_id)] === 1 ? '' : 's'} (this tab).`}
                                style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                {froStationCount[String(s.fro_worker_id)]}
                              </span>
                            )}
                            <button
                              title="Grant temporary access"
                              onClick={() => setTempAccessTarget({ station: s.station, ngoId: ngoScopeForRow(s), permanentFroId: s.fro_worker_id || null, permanentFroName: (froWorkers.find(w => w.id === s.fro_worker_id) || {}).name || null, donorCount: (ngoScopeForRow(s) && s.donor_count?.[ngoScopeForRow(s)]) || 0 })}
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', flexShrink: 0 }}
                            >
                              <Unlink size={13} />
                            </button>
                          </div>
                        </td>
                        <td>
                          {renderDonorPills(s)}
                          {/* amount range removed per request */}
                        </td>

                        <td className="nga-actions">
                          <div className="nga-actions-inline" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                            <StationKebab
                              activeTransfer={at}
                              returningId={returningId}
                              onReturn={at ? handleReturnEarly : null}
                              onUpload={() => setUploadStation(s.station)}
                              onViewList={() => setDonorListTarget({
                                station: s.station,
                                ngoList: s.ngos || [],
                                defaultNgoId: ngoScopeForRow(s),
                              })}
                              onAddDonor={() => setAddDonorTarget({
                                station: s.station,
                                ngoList: s.ngos || [],
                                defaultNgoId: ngoScopeForRow(s),
                              })}
                              onDownload={() => downloadStationExcel(s.station, ngoScopeForRow(s))}
                              onTarget={() => openTarget(s)}
                              onGrantTempAccess={() => setTempAccessTarget({
                                station: s.station,
                                ngoId: ngoScopeForRow(s),
                                permanentFroId: s.fro_worker_id || null,
                                permanentFroName: (froWorkers.find(w => w.id === s.fro_worker_id) || {}).name || null,
                                // donor_count is a per-NGO map: { ngo_id: count }
                                donorCount: (ngoScopeForRow(s) && s.donor_count?.[ngoScopeForRow(s)]) || 0,
                              })}
                              onDelete={() => handleDeleteStation(s.station)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editTarget && (
        <div className="modal-overlay" onClick={() => setEditTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Set Target — {editTarget.name}</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setEditTarget(null)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Monthly Target Amount (₹)</label>
                <input type="number" value={targetAmount} onChange={e => setTargetAmount(e.target.value)} min="0" />
              </div>
              <div className="modal-actions">
                <button className="btn btn-outline" onClick={() => setEditTarget(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => {
                  if (!targetAmount) return;
                  try {
                    const month = selectedMonth;
                    await apiPost('/ngo-admin/targets', {
                      fro_worker_id: editTarget.id,
                      month,
                      target_amount: parseFloat(targetAmount),
                      ngo_id: editTarget.ngo_id,
                    });
                    setEditTarget(null);
                    loadTargets();
                  } catch (err) { toast(err.message, 'error'); }
                }} disabled={!targetAmount}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editNgoStation && (
        <div className="modal-overlay" onClick={() => setEditNgoStation(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <h3>Edit Station — {editNgoStation}</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setEditNgoStation(null)}><X size={14} /></button>
            </div>
            <div className="modal-body">
              <label className="field">
                Select NGO
                <select value={stations.find(s => s.station === editNgoStation)?.ngos[0]?.ngo_id || ''}
                  onChange={e => { handleNgoChange(editNgoStation, e.target.value); setEditNgoStation(null); }}>
                  <option value="">-- No NGO --</option>
                  {allNgos.map(n => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </label>
              <div className="modal-actions" style={{ marginTop: 12 }}>
                <button className="btn btn-outline" onClick={() => setEditNgoStation(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {uploadStation && (
        <OldDataUploadModal
          station={uploadStation}
          ngoId={selectedNgoId}
          onClose={() => setUploadStation(null)}
          onUploaded={() => { setUploadStation(null); fetchData('Old data uploaded successfully'); }}
        />
      )}

      {bulkRenameOpen && (
        <BulkRenameModal
          ngos={allNgos}
          stations={stations}
          defaultNgoId={selectedNgoId}
          onClose={() => setBulkRenameOpen(false)}
          onRenamed={() => { setBulkRenameOpen(false); fetchData('Stations renamed successfully'); }}
        />
      )}

      {addOpen && (
        <AddStationModal
          allNgos={allNgos}
          newStation={newStation}
          newStationNgo={newStationNgo}
          onChangeName={setNewStation}
          onChangeNgo={setNewStationNgo}
          adding={adding}
          onCreate={handleAddStation}
          onClose={() => setAddOpen(false)}
        />
      )}

      {autoScheduleOpen && (
        <AutoHideScheduleModal
          value={autoSchedule || undefined}
          saving={savingAutoSchedule}
          onSave={saveAutoSchedule}
          onClose={() => setAutoScheduleOpen(false)}
        />
      )}

      {ncfOpen && (
        <NonConnectedFreshModal
          ngoId={selectedNgoId}
          onClose={() => { setNcfOpen(false); fetchData(); }}
        />
      )}


      {donorListTarget && (
        <StationDonorsModal
          station={donorListTarget.station}
          ngoList={donorListTarget.ngoList}
          defaultNgoId={donorListTarget.defaultNgoId}
          onClose={() => setDonorListTarget(null)}
          // Deleting a donor changes the station's donor pill and counts, so
          // refetch the row underneath while the modal is still open.
          onChanged={() => fetchData()}
          onDownloadExcel={(ngoId) => downloadStationExcel(donorListTarget.station, ngoId)}
          onAddDonor={() => { setDonorListTarget(null); setAddDonorTarget({ station: donorListTarget.station, ngoList: donorListTarget.ngoList, defaultNgoId: donorListTarget.defaultNgoId }); }}
        />
      )}

      {addDonorTarget && (
        <AddDonorModal
          station={addDonorTarget.station}
          ngoList={addDonorTarget.ngoList}
          defaultNgoId={addDonorTarget.defaultNgoId}
          onClose={() => setAddDonorTarget(null)}
          // A new donor bumps the station's donor pill/count, so refresh the row.
          onAdded={() => fetchData()}
        />
      )}

      {tempAccessTarget && (
        <TemporaryAccessModal
          target={tempAccessTarget}
          existingGrants={liveGrantsFor({ station: tempAccessTarget.station, ngo_id: tempAccessTarget.ngoId })}
          onClose={() => setTempAccessTarget(null)}
          // Granting changes no station field on this page (ownership untouched),
          // but the temp-access badges must reflect the new/changed grant.
          onGranted={() => loadTempGrants()}
        />
      )}

      {stacksModalTarget && (
        <DonorStacksModal
          target={stacksModalTarget}
          froWorkers={froWorkers}
          onClose={() => setStacksModalTarget(null)}
          onGranted={() => loadTempGrants()}
        />
      )}

      {/* ── Revoke temporary access confirmation ── */}
      {revokeGrantTarget && (
        <div className="modal-overlay" onClick={() => !revokingGrant && setRevokeGrantTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 430 }}>
            <div className="modal-head">
              <h3>Revoke temporary access — {revokeGrantTarget.station}</h3>
              <button className="icon-btn" onClick={() => setRevokeGrantTarget(null)} aria-label="Close" disabled={revokingGrant}><X size={16} /></button>
            </div>
            <div style={{ padding: 16, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 10px' }}>
                <b>{revokeGrantTarget.grant.working_fro_name || 'The FRO'}</b> immediately loses access to <b>{revokeGrantTarget.station}</b> on
                their next request — the station disappears from their list and open pages will show a notice.
              </div>
              <div style={{ color: 'var(--ink-soft)' }}>
                Completed calls, dispositions, donations and receipts stay exactly where they are, and{' '}
                <b>{revokeGrantTarget.grant.permanent_fro_name || 'the permanent FRO'}</b> remains the permanent owner.
                You can grant access again at any time.
              </div>
            </div>
            <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setRevokeGrantTarget(null)} disabled={revokingGrant}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                disabled={revokingGrant}
                onClick={handleRevokeGrant}
              >{revokingGrant ? 'Revoking…' : 'Revoke now'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
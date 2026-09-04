import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/auth';
import { api } from '../../../api/auth';
import { toast } from '../../../components/Toast';
import { isFreshStation } from '../../../lib/stations';

const NGO_NAME_COLORS = {
  bsct: '#2563eb',
  aflf: '#16a34a',
  mann: '#ec4899',
};

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

function TransferDataModal({ station, sourceName, sourceCount, stations, onClose, onTransferred }) {
  const [targetStation, setTargetStation] = useState('');
  const [count, setCount] = useState(sourceCount);
  const [loading, setLoading] = useState(false);
  const maxCount = sourceCount;

  const availableStations = stations.filter(s => s.station !== station);

  const handleTransfer = async () => {
    if (!targetStation || count < 1) return;
    setLoading(true);
    try {
      await apiPost(`/ngo-admin/stations/${encodeURIComponent(station)}/transfer-data`, {
        target_station: targetStation,
        donor_count: count,
      });
      onClose();
      setTimeout(() => { if (onTransferred) onTransferred(); }, 600);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>Transfer Leads — {station}</h3>
          <button className="btn btn-sm btn-outline" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: '#6b7280', background: '#f9fafb', padding: '10px 12px', borderRadius: 6 }}>
            Source station: <strong>{station}</strong> — {sourceCount} leads (all statuses)
          </div>
          <label className="field">
            Number of leads to transfer
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setCount(Math.max(1, count - 5))} disabled={count <= 1}>−5</button>
              <button className="btn btn-outline btn-sm" onClick={() => setCount(Math.max(1, count - 1))} disabled={count <= 1}>−1</button>
              <input type="number" min={1} max={maxCount}
                value={count} onChange={e => setCount(Math.min(maxCount, Math.max(1, parseInt(e.target.value) || 1)))}
                style={{ width: 80, textAlign: 'center' }} />
              <button className="btn btn-outline btn-sm" onClick={() => setCount(Math.min(maxCount, count + 1))} disabled={count >= maxCount}>+1</button>
              <button className="btn btn-outline btn-sm" onClick={() => setCount(Math.min(maxCount, count + 5))} disabled={count >= maxCount}>+5</button>
            </div>
          </label>
          <label className="field">
            Transfer to station
            <select value={targetStation} onChange={e => setTargetStation(e.target.value)}>
              <option value="">-- Select Station --</option>
              {availableStations.map(s => (
                <option key={s.station} value={s.station}>{s.station}</option>
              ))}
            </select>
          </label>
          <div style={{ fontSize: 12, color: '#6b7280', background: '#f0fdf4', padding: '8px 12px', borderRadius: 6 }}>
            Leads transferred to target station (unassigned). Auto-return after 10 hours.
          </div>
          <div className="modal-actions">
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleTransfer}
              disabled={loading || !targetStation || count < 1}>
              {loading ? 'Transferring...' : `Transfer ${count} Leads`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
          <button className="btn btn-sm btn-outline" onClick={onClose}>✕</button>
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
              <strong style={{ fontSize: 14 }}>✓ {result.message}</strong><br />
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
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line, #e5e7eb)', fontSize: 13, cursor: 'pointer', background: '#fff', minHeight: 26, boxSizing: 'border-box', width: '100%' }}>
        <span style={{ color: value ? 'inherit' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: value ? 600 : 400 }}>
          {value || 'Pick station…'}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
      </div>

      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line, #e5e7eb)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 200, marginTop: 2, overflow: 'hidden' }}>
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
                        ? <span className="pill" style={{ background: '#f3f4f6', color: 'var(--ink-soft)', fontSize: 9 }}>✓ Queued</span>
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
          <button className="btn btn-sm btn-outline" onClick={onClose}>✕</button>
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
                        <span style={{ fontSize: 10, color: '#15803d', marginTop: 3 }}>✓ Planned code — {mOld} → {suggestion} for {ngoNameById(mNgoId)}</span>
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
                        <input value={rowFilter} onChange={e => setRowFilter(e.target.value)} placeholder="🔍 Filter station…"
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
                                  <span className="pill" style={{ background: '#f0fdf4', color: '#15803d', fontSize: 9, marginLeft: 6 }}>✓ planned</span>
                                )}
                              </span>
                              <button className="btn btn-sm btn-outline" onClick={() => removeRow(r)} style={{ fontSize: 10, padding: '2px 8px' }}>✕</button>
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
                      <span style={{ fontSize: 12 }}>⚠</span>
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
                          {busy ? '…' : '✕ Remove'}
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
                <strong>⚠ You are about to rename {rows.length} station{rows.length > 1 ? 's' : ''} on live data.</strong><br />
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
                <strong style={{ fontSize: 14 }}>✓ {result.applied} station{result.applied > 1 ? 's' : ''} renamed · old codes remaining: {result.post_verify?.old_codes_remaining ?? 0}</strong><br />
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
                          <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>{' '}
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
  const ref = useRef(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = options.filter(w =>
    !search || w.name?.toLowerCase().includes(search.toLowerCase()) || w.login_id?.toLowerCase().includes(search.toLowerCase())
  );

  const selected = options.find(w => w.id === value);

  return (
    <div ref={ref} style={{ position: 'relative', maxWidth: 200 }}>
      <div onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line, #e5e7eb)', fontSize: 13, cursor: 'pointer', background: '#fff', minHeight: 26 }}>
        <span style={{ color: selected ? 'inherit' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.name : (placeholder || '-- Select --')}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
      </div>

      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line, #e5e7eb)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 200, marginTop: 2, overflow: 'hidden' }}>
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
                {w.login_id && <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{w.login_id}</span>}
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
  const [transferData, setTransferData] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [returningId, setReturningId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [targetAmount, setTargetAmount] = useState('');
  const [editAchieved, setEditAchieved] = useState(null);
  const [achievedAmount, setAchievedAmount] = useState('');
  const [incentives, setIncentives] = useState([]);
  const [editIncentive, setEditIncentive] = useState(null);
  const [incentiveAmount, setIncentiveAmount] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedNgoId, setSelectedNgoId] = useState(null);
  const [uploadStation, setUploadStation] = useState(null);
  const [stationTab, setStationTab] = useState('all');
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false);

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
    const url = selectedNgoId === 'all' ? '/ngo-admin/stations' : `/ngo-admin/stations?ngo_id=${selectedNgoId}`;
    apiGet(url).then(s => {
      if (Array.isArray(s)) setStations(s);
    }).catch(err => console.error('fetchData error:', err));
    apiGet('/ngo-admin/transfers').then(t => {
      setTransfers(Array.isArray(t) ? t : []);
    }).catch(err => console.error('fetchData transfers error:', err));
    const ngoParam = selectedNgoId !== 'all' ? '&ngo_id=' + selectedNgoId : '';
    apiGet('/ngo-admin/targets?month=' + m + ngoParam).then(t => {
      if (Array.isArray(t)) setTargets(t);
    }).catch((err) => { console.error('Error:', err.message); });
    apiGet('/ngo-admin/incentives').then(r => {
      if (Array.isArray(r)) setIncentives(r);
    }).catch((err) => { console.error('Error:', err.message); });
    if (successMsg) setMsg(successMsg);
  };

  const loadTargets = (month) => {
    const m = month || selectedMonth;
    const ngoParam = selectedNgoId !== 'all' ? '&ngo_id=' + selectedNgoId : '';
    apiGet('/ngo-admin/targets?month=' + m + ngoParam).then(t => {
      if (Array.isArray(t)) setTargets(t);
    }).catch((err) => { console.error('Error:', err.message); });
    apiGet('/ngo-admin/incentives').then(r => {
      if (Array.isArray(r)) setIncentives(r);
    }).catch((err) => { console.error('Error:', err.message); });
  };

  useEffect(() => {
    setLoading(true);
    const m = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    apiPost('/ngo-admin/ngos/ensure').catch(() => {}).then(() => {
      return Promise.all([
        apiGet('/ngo-admin/ngos'),
        apiGet('/ngo-admin/fro-workers'),
        apiGet('/ngo-admin/targets?month=' + m),
        apiGet('/ngo-admin/incentives'),
      ]);
    }).then(([n, f, t, i]) => {
      setAllNgos(Array.isArray(n) ? n : []);
      setFroWorkers(Array.isArray(f) ? f : []);
      if (Array.isArray(t)) setTargets(t);
      if (Array.isArray(i)) setIncentives(i);
      const ngoList = Array.isArray(n) ? n : [];
      if (ngoList.length > 0) {
        setSelectedNgoId(ngoList[0].id);
      }
    }).catch(err => console.error('Initial load error:', err)).finally(() => setLoading(false));
    apiGet('/ngo-admin/transfers').then(t => {
      setTransfers(Array.isArray(t) ? t : []);
    }).catch(err => console.error('Initial transfers load error:', err));
  }, []);

  useEffect(() => {
    if (selectedNgoId) fetchData();
  }, [selectedNgoId]);

  const activeTransfers = transfers.filter(t => !t.returned);
  const historyTransfers = transfers.filter(t => t.returned);

  const filteredStations = stations.filter(s => {
    if (stationTab === 'fresh') return isFreshStation(s.station);
    if (stationTab === 'old') return !isFreshStation(s.station);
    return true;
  });

  const handleAddStation = async () => {
    if (!newStation.trim()) return;
    setAdding(true);
    try {
      await apiPost('/ngo-admin/stations', {
        station: newStation.trim(),
        ngo_id: newStationNgo || null,
      });
      setNewStationNgo('');
      const list = await apiGet('/ngo-admin/stations');
      if (Array.isArray(list)) {
        setStations(list);
        setNewStation(computeNextName(list));
      }
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

  return (
    <div>
      {msg && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>✓</span>
          <span>{msg}</span>
        </div>
      )}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3>Add Station</h3>
        </div>
        <div className="card-pad">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-row">
              <label className="field" style={{ flex: 1 }}>
                Station Name
                <input value={newStation} onChange={e => setNewStation(e.target.value)} />
              </label>
              <button className="btn btn-primary" onClick={handleAddStation} disabled={adding || !newStation.trim()} style={{ alignSelf: 'flex-end' }}>
                {adding ? 'Adding...' : 'Create'}
              </button>
            </div>
            <label className="field" style={{ marginBottom: 0, flex: 1 }}>
              NGO
              <select value={newStationNgo} onChange={e => setNewStationNgo(e.target.value)}>
                <option value="">-- Select NGO --</option>
                {allNgos.map(n => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3>Stations</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="count">{filteredStations.length} stations</span>
              <button className="btn btn-sm btn-outline" onClick={async () => {
                try {
                  const res = await apiPost('/ngo-admin/stations/seed', { ngo_id: selectedNgoId })
                  setMsg(res.message || 'Stations seeded')
                  fetchData()
                } catch (err) {
                  setMsg('Error: ' + err.message)
                }
              }} style={{ fontSize: 11 }}>
                Seed Default Stations
              </button>
              <button className="btn btn-sm btn-outline" onClick={async () => {
                try {
                  const res = await apiPost('/ngo-admin/stations/seed', { ngo_id: selectedNgoId, fresh: true })
                  setMsg(res.message || 'FD Stations seeded')
                  fetchData()
                } catch (err) {
                  setMsg('Error: ' + err.message)
                }
              }} style={{ fontSize: 11, color: '#1e40af', borderColor: '#93c5fd' }}>
                Seed FD Stations
              </button>
              <button className="btn btn-sm btn-outline" onClick={async () => {
                try {
                  const res = await apiPost('/ngo-admin/stations/cleanup', { ngo_id: selectedNgoId })
                  setMsg(res.message || 'Cleanup done')
                  fetchData()
                } catch (err) {
                  setMsg('Error: ' + err.message)
                }
              }} style={{ fontSize: 11, color: '#dc2626', borderColor: '#fca5a5' }}>
                Cleanup Orphaned
              </button>
              <button className="btn btn-sm btn-outline" onClick={() => setBulkRenameOpen(true)}
                style={{ fontSize: 11, color: '#b45309', borderColor: '#fdba74' }}>
                Bulk Rename
              </button>
              <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line, #e5e7eb)', width: 150 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', borderRadius: 8, padding: 2 }}>
            {allNgos.map(ngo => {
              const active = selectedNgoId === ngo.id;
              return (
                <button key={ngo.id} onClick={() => setSelectedNgoId(ngo.id)}
                  style={{ padding: '5px 14px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', background: active ? 'var(--sage)' : 'transparent', color: active ? '#fff' : 'var(--ink-soft)' }}>
                  {ngo.name}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', borderRadius: 8, padding: 2, marginTop: 4 }}>
            {[
              { key: 'all', label: 'All Stations' },
              { key: 'old', label: 'OLD Stations' },
              { key: 'fresh', label: 'FRESH Stations (FD)' },
            ].map(tab => (
              <button key={tab.key} onClick={() => setStationTab(tab.key)}
                style={{ padding: '4px 12px', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', background: stationTab === tab.key ? '#fff' : 'transparent', color: stationTab === tab.key ? 'var(--ink)' : 'var(--ink-soft)', boxShadow: stationTab === tab.key ? '0 1px 3px rgba(0,0,0,.1)' : 'none' }}>
                {tab.label}
                <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 400, opacity: .6 }}>
                  ({stationTab === tab.key ? filteredStations.length : stations.filter(s => tab.key === 'all' ? true : tab.key === 'fresh' ? isFreshStation(s.station) : !isFreshStation(s.station)).length})
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="card-pad">
          {loading ? (
            <div className="loading">Loading stations...</div>
          ) : filteredStations.length === 0 ? (
            <div className="empty-state"><p>No {stationTab === 'fresh' ? 'FRESH (FD)' : stationTab === 'old' ? 'OLD' : ''} stations found for this NGO.</p></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Station</th>
                  <th>NGOs</th>
                  <th>FRO Worker</th>
                  <th>Donors</th>
                  <th>Old Data</th>
                  <th>Salary</th>
                  <th>Target</th>
                  <th>Source</th>
                  <th>Achieved</th>
                  <th>Incentive</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredStations.map((s, i) => (
                  <tr key={s.station}>
                    <td>
                      <strong>{s.station}</strong>
                      {isFreshStation(s.station) && <span style={{ marginLeft: 4, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>FRESH</span>}
                      {(() => {
                        const at = activeTransfers.find(t => t.station?.trim() === s.station?.trim());
                        return at ? <span style={{ marginLeft: 6, fontSize: 13, color: '#b45309', fontWeight: 500 }}>→ {at.target_station}</span> : null;
                      })()}
                    </td>
                    <td>
                      <span onClick={() => setEditNgoStation(s.station)}
                        style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
                        {s.ngos.length > 0
                          ? s.ngos[0].ngo_name
                          : <span style={{ color: '#9ca3af' }}>No NGO</span>}
                      </span>
                    </td>
                    <td>
                      <SearchableSelect
                        options={froWorkers}
                        value={s.fro_worker_id || ''}
                        onChange={(val) => handleFroChange(s.station, val)}
                        placeholder="-- Select FRO --"
                      />
                    </td>
                    <td>
                      {(() => {
                        const dc = s.donor_count;
                        if (!dc) return <span className="pill pill-blue">0</span>;
                        if (typeof dc === 'number') return <span className="pill pill-blue">{dc}</span>;
                        // Per-NGO breakdown: { ngo_id: count }
                        const parts = Object.entries(dc).map(([ngoId, cnt]) => {
                          const ngo = allNgos.find(n => String(n.id) === String(ngoId));
                          const name = ngo?.name || ngoId;
                          return <span key={ngoId} style={{ marginRight: 6, fontWeight: 600 }}>{name}: {cnt}</span>;
                        });
                        return <span className="pill pill-blue" style={{ whiteSpace: 'nowrap' }}>{parts}</span>;
                      })()}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-outline" onClick={() => setUploadStation(s.station)}
                        style={{ fontSize: 10, whiteSpace: 'nowrap', color: 'var(--sage, #5B6B4E)' }}>
                        Upload
                      </button>
                    </td>
                    <td>
                      {(() => {
                        const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
                        return w ? <span>₹{Number(w.salary || 0).toLocaleString('en-IN')}</span> : <span style={{ color: '#9ca3af' }}>—</span>;
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
                        if (!w) return <span style={{ color: '#9ca3af' }}>—</span>;
                        const t = targets.find(tg => tg.id === w.id);
                        return <strong>₹{Number(t?.target || 0).toLocaleString('en-IN')}</strong>;
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
                        if (!w) return <span style={{ color: '#9ca3af' }}>—</span>;
                        const t = targets.find(tg => tg.id === w.id);
                        if (!t) return <span style={{ color: '#9ca3af' }}>—</span>;
                        return (
                          <>
                            {t?.target_source === 'auto_month1' && <span className="pill pill-yellow">Auto M1</span>}
                            {t?.target_source === 'auto_month2' && <span className="pill pill-yellow">Auto M2</span>}
                            {t?.target_source === 'auto_month3' && <span className="pill pill-yellow">Auto M3</span>}
                            {t?.target_source === 'manual' && <span className="pill pill-green">Manual</span>}
                            {t?.target_source === 'not_set' && <span className="pill pill-gray">Not Set</span>}
                          </>
                        );
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
                        if (!w) return <span style={{ color: '#9ca3af' }}>—</span>;
                        const t = targets.find(tg => tg.id === w.id);
                        const val = t?.achieved_target;
                        return val != null && val > 0
                          ? <strong>₹{Number(val).toLocaleString('en-IN')}</strong>
                          : <span style={{ color: '#9ca3af' }}>—</span>;
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
                        if (!w) return <span style={{ color: '#9ca3af' }}>—</span>;
                        const t = targets.find(tg => tg.id === w.id);
                        const manualInc = t?.incentive;
                        const inc = incentives.find(i => i.worker_id === w.id);
                        const autoInc = inc?.hasTarget ? inc.totalIncentive : null;
                        const displayVal = manualInc != null ? manualInc : autoInc;
                        const isManual = manualInc != null;
                        if (displayVal != null && displayVal > 0) {
                          return (
                            <strong style={{ color: isManual ? '#7c3aed' : '#059669' }}>
                              ₹{Number(displayVal).toLocaleString('en-IN')}
                              {isManual && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 4, color: '#7c3aed' }}>M</span>}
                            </strong>
                          );
                        }
                        return <span style={{ color: '#9ca3af' }}>{manualInc != null ? '0' : '—'}</span>;
                      })()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {(() => {
                          const at = activeTransfers.find(t => t.station === s.station);
                          return at ? (
                            <button className="btn btn-sm"
                              onClick={() => handleReturnEarly(at.id)}
                              disabled={returningId === at.id}
                              style={{ background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e' }}>
                              {returningId === at.id ? 'Returning...' : 'Return'}
                            </button>
                          ) : null;
                        })()}
                        {(() => {
                          const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
                          if (!w) return null;
                          const t = targets.find(tg => tg.id === w.id);
                          if (!t || t?.months_employed >= 3) {
                            return (
                              <button className="btn btn-sm btn-outline" onClick={() => { setEditTarget({ ...w, ngo_id: s.ngos?.[0]?.ngo_id || null }); setTargetAmount(String(t?.target || '')); }}>
                                {t?.target_source === 'manual' ? 'Edit' : 'Set'}
                              </button>
                            );
                          }
                          return <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>Auto</span>;
                        })()}
                        {(() => {
                          const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
                          if (!w) return null;
                          const t = targets.find(tg => tg.id === w.id);
                          return (
                            <button className="btn btn-sm btn-outline" onClick={() => { setEditAchieved({ ...w, ngo_id: s.ngos?.[0]?.ngo_id || null }); setAchievedAmount(String(t?.achieved_target || '')); }}>
                              {t?.achieved_target != null && t.achieved_target > 0 ? 'Edit Achv' : 'Set Achv'}
                            </button>
                          );
                        })()}
                        {(() => {
                          const w = froWorkers.find(fw => fw.id === s.fro_worker_id);
                          if (!w) return null;
                          const t = targets.find(tg => tg.id === w.id);
                          const inc = incentives.find(i => i.worker_id === w.id);
                          const autoVal = inc?.hasTarget ? inc.totalIncentive : 0;
                          return (
                            <button className="btn btn-sm btn-outline" onClick={() => {
                              setEditIncentive({ ...w, ngo_id: s.ngos?.[0]?.ngo_id || null });
                              setIncentiveAmount(String(t?.incentive != null ? t.incentive : autoVal || ''));
                            }} style={{ color: '#7c3aed' }}>
                              {t?.incentive != null ? 'Edit Incent' : 'Set Incent'}
                            </button>
                          );
                        })()}
                        <button className="btn btn-sm btn-outline" onClick={() => {
                          const fro = froWorkers.find(w => w.id === s.fro_worker_id);
                          setTransferData({
                            station: s.station,
                            sourceName: fro?.name || 'Unknown',
                            sourceCount: s.donor_count || 0,
                          });
                        }} style={{ color: 'var(--sage, #5B6B4E)' }}>
                          Transfer
                        </button>
                        <button className="btn btn-sm btn-outline" onClick={() => handleDeleteStation(s.station)}
                          style={{ color: 'var(--danger)' }}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editTarget && (
        <div className="modal-overlay" onClick={() => setEditTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Set Target — {editTarget.name}</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setEditTarget(null)}>✕</button>
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

      {editAchieved && (
        <div className="modal-overlay" onClick={() => setEditAchieved(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Set Achieved Target — {editAchieved.name}</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setEditAchieved(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Achieved Amount (₹)</label>
                <input type="number" value={achievedAmount} onChange={e => setAchievedAmount(e.target.value)} min="0" />
              </div>
              <div className="modal-actions">
                <button className="btn btn-outline" onClick={() => setEditAchieved(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => {
                  try {
                    const month = selectedMonth;
                    await apiPost('/ngo-admin/achieved-target', {
                      fro_worker_id: editAchieved.id,
                      month,
                      achieved_amount: parseFloat(achievedAmount) || 0,
                    });
                    setEditAchieved(null);
                    loadTargets();
                  } catch (err) { toast(err.message, 'error'); }
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editIncentive && (
        <div className="modal-overlay" onClick={() => setEditIncentive(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Set Incentive — {editIncentive.name}</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setEditIncentive(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Incentive Amount (₹)</label>
                <input type="number" value={incentiveAmount} onChange={e => setIncentiveAmount(e.target.value)} min="0" />
              </div>
              {(() => {
                const inc = incentives.find(i => i.worker_id === editIncentive.id);
                if (inc?.hasTarget && inc.totalIncentive > 0) {
                  return <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    Auto-calculated: ₹{Number(inc.totalIncentive).toLocaleString('en-IN')}
                    &nbsp;(AKI: ₹{Number(inc.akiPayout).toLocaleString('en-IN')} + 10%: ₹{Number(inc.monthlyIncentive).toLocaleString('en-IN')})
                  </div>;
                }
                return null;
              })()}
              <div className="modal-actions" style={{ marginTop: 16 }}>
                <button className="btn btn-outline" onClick={async () => {
                  try {
                    const month = selectedMonth;
                    await apiPost('/ngo-admin/incentive', {
                      fro_worker_id: editIncentive.id,
                      month,
                      incentive_amount: '',
                    });
                    setEditIncentive(null);
                    loadTargets();
                  } catch (err) { toast(err.message, 'error'); }
                }}>Clear</button>
                <button className="btn btn-outline" onClick={() => setEditIncentive(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => {
                  try {
                    const month = selectedMonth;
                    await apiPost('/ngo-admin/incentive', {
                      fro_worker_id: editIncentive.id,
                      month,
                      incentive_amount: parseFloat(incentiveAmount) || 0,
                    });
                    setEditIncentive(null);
                    loadTargets();
                  } catch (err) { toast(err.message, 'error'); }
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editNgoStation && (
        <div className="modal-overlay" onClick={() => setEditNgoStation(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <h3>Change NGO — {editNgoStation}</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setEditNgoStation(null)}>✕</button>
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

      {transferData && (
        <TransferDataModal
          station={transferData.station}
          sourceName={transferData.sourceName}
          sourceCount={transferData.sourceCount}
          stations={stations}
          onClose={() => setTransferData(null)}
            onTransferred={() => fetchData('Transfer successful')}
        />
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
    </div>
  );
}

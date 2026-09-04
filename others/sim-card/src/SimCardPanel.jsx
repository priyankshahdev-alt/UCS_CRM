import { useEffect, useRef, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useUcs } from './store';
import { SimProvider, useSim } from './store';
import { Icon } from './components';
import ToastContainer from './Toast';
import { SimFormModal, SimViewModal, ReplaceModal, SimHistoryModal } from './modals';
import { deleteSimCard, importSimCards } from './api';
import { toast } from './Toast';
import { exportToCSV, exportToExcel } from './helpers';
import * as XLSX from 'xlsx';
import './simCard.css';

import Dashboard from './Dashboard';
import Inventory from './Inventory';

const HEADER_MAP = {
  'mobile id': 'mobile_id', 'mobile id no': 'mobile_id', 'mobile id no.': 'mobile_id', 'mobile no': 'mobile_id', 'mobile': 'mobile_id',
  'calling mobile': 'calling_mobile',
  'device': 'device_model', 'device & model': 'device_model', 'device & model name': 'device_model', 'device model': 'device_model', 'model': 'device_model',
  'imei': 'imei', 'imei no': 'imei', 'imei no.': 'imei',
  'team': 'team', 'signature': 'signature', 'remark': 'signature',
  'sim card issue date': 'issue_date', 'issue date': 'issue_date',
  'auto expiry date': 'expiry_date', 'expiry date': 'expiry_date',
  'sim card status': 'status', 'status': 'status',
  'replacement count': 'replacement_count', 'sim card replacement count': 'replacement_count',
  'sim type': 'sim_type', 'sim_type': 'sim_type',
  'sim 1': 'sim_1', 'sim1': 'sim_1', 'sim 2': 'sim_2', 'sim2': 'sim_2',
  'sim 3': 'sim_3', 'sim3': 'sim_3', 'sim 4': 'sim_4', 'sim4': 'sim_4',
  'sim 5': 'sim_5', 'sim5': 'sim_5', 'sim 6': 'sim_6', 'sim6': 'sim_6',
  'sim 7': 'sim_7', 'sim7': 'sim_7', 'sim 8': 'sim_8', 'sim8': 'sim_8',
};

function normalizeDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  const s = String(v).trim();
  const num = Number(s);
  if (!isNaN(num) && /^\d+(\.\d+)?$/.test(s) && num > 1000 && num < 60000 && !s.includes('-')) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')}`;
  const m2 = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m2) return `${m2[3]}-${String(Number(m2[2])).padStart(2,'0')}-${String(Number(m2[1])).padStart(2,'0')}`;
  return s;
}

function ImportModal({ open, onClose, onDone }) {
  const { refresh } = useSim();
  const fileRef = useRef(null);
  const [valid, setValid] = useState([]);
  const [invalid, setInvalid] = useState([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const [fileName, setFileName] = useState('');
  const [importedIds, setImportedIds] = useState([]);
  const [deletingImported, setDeletingImported] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!open) return null;

  function reset() { setValid([]); setInvalid([]); setDone(false); setErr(''); setFileName(''); setImportedIds([]); setConfirmDelete(false); }

  function parseFile(file) {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
      setErr('Please upload .xlsx, .xls, or .csv'); return;
    }
    setErr('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
        const rows = json.map((r) => {
          const out = {};
          for (const key of Object.keys(r)) {
            const mapped = HEADER_MAP[key.toString().trim().toLowerCase()];
            if (mapped) out[mapped] = r[key];
          }
          out.issue_date = normalizeDate(out.issue_date);
          out.expiry_date = normalizeDate(out.expiry_date);
          return out;
        });
        const v = [], inv = [], seen = new Set();
        for (const r of rows) {
          const mobile = String(r.mobile_id || '').trim();
          const missingFields = [];
          if (!mobile) missingFields.push('Mobile ID');
          if (!String(r.device_model || '').trim()) missingFields.push('Device & Model');
          if (!String(r.imei || '').trim()) missingFields.push('IMEI');
          if (!r.issue_date) missingFields.push('Issue Date');
          if (!r.expiry_date) missingFields.push('Expiry Date');
          const dup = mobile && seen.has(mobile.toLowerCase());
          if (mobile) seen.add(mobile.toLowerCase());
          if (missingFields.length) inv.push({ ...r, reason: `Missing: ${missingFields.join(', ')}` });
          else if (dup) inv.push({ ...r, reason: 'Duplicate Mobile ID' });
          else v.push({ ...r, replacement_count: Number(r.replacement_count) || 0 });
        }
        setValid(v);
        setInvalid(inv);
      } catch (ex) { setErr('Failed to parse: ' + ex.message); }
    };
    reader.readAsArrayBuffer(file);
  }

  async function doImport() {
    if (!valid.length) { toast('No valid rows to import', 'error'); return; }
    setImporting(true);
    try {
      const res = await importSimCards(valid.map((r) => ({ ...r, status: r.status || 'Active' })));
      toast(res.message || 'Import complete', 'success');
      setImportedIds(Array.isArray(res.inserted) ? res.inserted : []);
      await refresh();
      setDone(true);
      onDone();
    } catch (e) { toast(e.message || 'Import failed', 'error'); }
    finally { setImporting(false); }
  }

  async function doDeleteImported() {
    if (!importedIds.length) return;
    setDeletingImported(true);
    try {
      await Promise.all(importedIds.map((id) => deleteSimCard(id)));
      await refresh();
      toast(`${importedIds.length} imported SIM card(s) removed`, 'success');
      reset();
    } catch (e) {
      toast(e.message || 'Failed to delete imported SIM cards. Please try again.', 'error');
      setConfirmDelete(false);
    } finally {
      setDeletingImported(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="modal-head">
          <h3>Import SIM Cards</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-body">
          {err && <div className="login-error" style={{ marginBottom: 12 }}>{err}</div>}
          {done ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="big">Import Complete</div>
              <div className="small" style={{ marginTop: 4 }}>{valid.length} SIM card(s) were added successfully to <b>{"All SIM Cards"}</b>.</div>
              {!confirmDelete ? (
                <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="sim-btn" onClick={reset}>Import Another File</button>
                  {importedIds.length > 0 && (
                    <button className="sim-btn danger" onClick={() => setConfirmDelete(true)} disabled={deletingImported}>
                      Delete Imported SIM(s)
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: 'var(--sim-ink)', marginBottom: 12 }}>
                    Delete {importedIds.length} imported SIM card(s)? This cannot be undone.
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button className="sim-btn" onClick={() => setConfirmDelete(false)} disabled={deletingImported}>Cancel</button>
                    <button className="sim-btn danger" onClick={doDeleteImported} disabled={deletingImported}>
                      {deletingImported ? 'Deleting...' : 'Yes, Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : valid.length > 0 ? (
            <div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <div className="sim-box" style={{ flex: 1, textAlign: 'center', boxShadow: 'none', background: 'var(--sim-green-soft)' }}>
                  <div className="num" style={{ color: 'var(--sim-green)' }}>{valid.length}</div>
                  <div className="title">Valid</div>
                </div>
                <div className="sim-box" style={{ flex: 1, textAlign: 'center', boxShadow: 'none', background: 'var(--sim-red-soft)' }}>
                  <div className="num" style={{ color: 'var(--sim-red)' }}>{invalid.length}</div>
                  <div className="title">Invalid</div>
                </div>
              </div>
              {invalid.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sim-red)', marginBottom: 6 }}>Rejected Rows</div>
                  {invalid.slice(0, 10).map((r, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--sim-ink-soft)', marginBottom: 2 }}>{r.mobile_id || '(no mobile)'} — {r.reason}</div>
                  ))}
                  {invalid.length > 10 && <div style={{ fontSize: 12, color: 'var(--sim-ink-soft)' }}>…and {invalid.length - 10} more</div>}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ fontSize: 14, color: 'var(--sim-ink-soft)', marginBottom: 16 }}>Upload an Excel or CSV file with SIM card data.</div>
                <label className="sim-btn primary" htmlFor="sim-import-file-input" style={{ cursor: 'pointer', display: 'inline-block' }}>
                  Choose File
                </label>
                &nbsp;
                {fileName && <span style={{ fontSize: 12, color: 'var(--sim-blue-dark)', fontWeight: 600 }}>{fileName}</span>}
                <input
                  id="sim-import-file-input"
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ position: 'absolute', width: 1, height: 1, clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', overflow: 'hidden', whiteSpace: 'nowrap' }}
                  onChange={(e) => { const f = e.target.files[0]; if (f) { setFileName(f.name); parseFile(f); } e.target.value = ''; }}
                />
              </div>
            </div>
          )}
        </div>
        {valid.length > 0 && !done && (
          <div className="modal-foot">
            <button className="sim-btn" onClick={reset}>Choose Different File</button>
            <button className="sim-btn primary" onClick={doImport} disabled={importing}>
              {importing ? 'Importing...' : `Import ${valid.length} Row(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteConfirmModal({ card, deleting, onClose, onConfirm }) {
  if (!card) return null;
  const label = card.mobile_id || card.sim_number || 'this item';
  return (
    <div className="modal-overlay dc-overlay" onClick={onClose}>
      <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dc-icon">
          <Icon name="trash" size={22} />
        </div>
        <div className="dc-title">Delete Notice?</div>
        <div className="dc-desc">
          Are you sure you want to delete <strong>&ldquo;{label}&rdquo;</strong>? This action cannot be undone.
        </div>
        <div className="dc-foot">
          <button className="dc-btn cancel" onClick={onClose} disabled={deleting}>Cancel</button>
          <button className="dc-btn delete" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

const NAV = [
  { id: 'dashboard', path: '/sim/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'inventory', path: '/sim/inventory', label: 'All SIM Cards', icon: 'simcard' },
];

const PAGE_META = {
  '/sim/dashboard': ['Sim Cards and Mobile Management', 'Sim Cards and Mobile Management', 'Manage SIM cards, devices, expiry dates and replacement records.'],
  '/sim/inventory': ['SIM Management', 'All SIM Cards', 'Complete list of every registered SIM card.'],
};

function PanelInner() {
  const { user, logout } = useUcs();
  const sim = useSim();
  const location = useLocation();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const [viewCard, setViewCard] = useState(null);
  const [replaceCard, setReplaceCard] = useState(null);
  const [historyCard, setHistoryCard] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteCard, setDeleteCard] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { sim.refresh(); /* eslint-disable-next-line */ }, []);

  const meta = PAGE_META[location.pathname] || PAGE_META['/sim/dashboard'];
  const initials = (user?.name || user?.login_id || 'U').toString().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  function openAdd() { setEditing(null); setFormKey((k) => k + 1); setFormOpen(true); }
  function openEdit(c) { setEditing(c); setFormKey((k) => k + 1); setFormOpen(true); }

  async function doDelete(c) {
    setDeleting(true);
    try {
      await deleteSimCard(c.id);
      sim.refresh();
      toast('SIM Card deleted successfully', 'success');
      setDeleteCard(null);
    } catch (e) {
      toast(e.message || 'Failed to delete SIM Card. Please try again.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaved() {
    setFormOpen(false); setEditing(null);
    try {
      await sim.refresh();
    } catch {
      // keep current state on error
    }
  }

  return (
    <div className="sim-app">
      <ToastContainer />
      <div className="sim-shell">
        <aside className="sim-sidebar">
          <div className="sim-brand">
            <div className="mark">SIM</div>
            <div><h1>Sim Cards</h1><span>And Mobile Management</span></div>
          </div>
          <div className="sim-side-label">SIM Management</div>
          <nav className="sim-nav">
            {NAV.map((n) => (
              <NavLink key={n.id + n.path} to={n.path} className={({ isActive }) => isActive ? 'active' : ''}>
                <Icon name={n.icon} size={16} /> <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sim-sidebar-footer">
            <div className="u">
              <div className="sim-avatar">{initials}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name || user?.login_id}</div>
                <div style={{ fontSize: 11, opacity: .7 }}>{user?.department || user?.role}</div>
              </div>
            </div>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </aside>

        <div className="sim-main">
          <header className="sim-topbar">
            <div>
              <div className="eyebrow">{meta[0]}</div>
              <h2>{meta[1]}</h2>
              <p>{meta[2]}</p>
            </div>
            <div className="sim-actions">
              <button className="sim-btn" onClick={() => setImportOpen(true)}>Import</button>
              <button className="sim-btn" onClick={() => exportToCSV(sim.cards)}>Export CSV</button>
              <button className="sim-btn" onClick={() => exportToExcel(sim.cards)}>Export</button>
            </div>
          </header>

          <div className="sim-content">
            <Routes>
              <Route index element={<Dashboard onAdd={openAdd} onView={setViewCard} onEdit={openEdit} onReplace={setReplaceCard} />} />
              <Route path="dashboard" element={<Dashboard onAdd={openAdd} onView={setViewCard} onEdit={openEdit} onReplace={setReplaceCard} />} />
              <Route path="inventory" element={<Inventory onAdd={openAdd} onView={setViewCard} onEdit={openEdit} onReplace={setReplaceCard} onDelete={(c) => setDeleteCard(c)} onHistory={setHistoryCard} />} />
              <Route path="*" element={<Navigate to="/sim/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </div>

      <SimFormModal key={formKey} open={formOpen} card={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={handleSaved} />
      <SimViewModal card={viewCard} open={!!viewCard} onClose={() => setViewCard(null)} onEdit={() => { if (viewCard) openEdit(viewCard); }} onReplace={() => { if (viewCard) { setReplaceCard(viewCard); setViewCard(null); } }} />
      <ReplaceModal card={replaceCard} open={!!replaceCard} onClose={() => setReplaceCard(null)} onDone={() => sim.refresh()} />
      <SimHistoryModal card={historyCard} open={!!historyCard} onClose={() => setHistoryCard(null)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => setImportOpen(false)} />
      <DeleteConfirmModal card={deleteCard} deleting={deleting} onClose={() => { if (!deleting) setDeleteCard(null); }} onConfirm={() => deleteCard && doDelete(deleteCard)} />
    </div>
  );
}

export default function SimCardPanel() {
  return (
    <SimProvider>
      <PanelInner />
    </SimProvider>
  );
}

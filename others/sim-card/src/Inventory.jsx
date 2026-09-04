import { useMemo, useState, useEffect } from 'react';
import { useSim } from './store';
import { Icon } from './components';
import { effectiveStatus, dayClass, daysLeft, formatDate, pillForStatus, SIM_STATUSES, SIM_TYPES } from './helpers';
import { bulkChangeStatus, bulkDelete } from './api';
import { toast } from './Toast';

const STATUS_FILTERS = ['All', 'Active', 'Expiring Soon', 'Expired', 'Replaced', 'Inactive'];
const EXPIRY_FILTERS = ['All', 'Expired', 'Within 7 Days', 'Within 28 Days', 'More than 28 Days'];
const SIM_NAME_FILTERS = ['Android', 'Nokia'];
const OWNER_UFS = ['UFS 1', 'UFS 2', 'UFS 3', 'UFS 4', 'UFS 5', 'Locker'];
const normOwner = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');
const SORTABLE = ['mobile_id', 'device_model', 'imei', 'status', 'team', 'signature', 'issue_date', 'expiry_date', 'days_left', 'sim_1', 'sim_2', 'replacement_count'];

const COLUMNS = [
  { key: 'mobile_id', label: 'Mobile ID No.' },
  { key: 'device_model', label: 'Device & Model Name' },
  { key: 'imei', label: 'IMEI No.' },
  { key: 'status', label: 'Sim Card Status' },
  { key: 'team', label: 'Team' },
  { key: 'signature', label: 'Owner' },
  { key: 'issue_date', label: 'Sim Card Issue Date' },
  { key: 'expiry_date', label: 'Auto Expiry Date' },
  { key: 'days_left', label: 'Sim Expiry Days Left', num: true },
  { key: 'sim_1', label: 'Sim 1' },
  { key: 'sim_2', label: 'Sim 2' },
  { key: 'replacement_count', label: 'Sim Card Repla. Count', num: true },
];

export default function Inventory({ onAdd, onView, onEdit, onReplace, onDelete, onHistory }) {
  const { cards, refresh } = useSim();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [owner, setOwner] = useState('All');
  const [remark, setRemark] = useState('All');
  const [team, setTeam] = useState('All');
  const [simType, setSimType] = useState('All');
  const [device, setDevice] = useState('All');
  const [simName, setSimName] = useState('All');
  const [expiry, setExpiry] = useState('All');
  const [sortKey, setSortKey] = useState('mobile_id');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [selected, setSelected] = useState({});
  const [showActions, setShowActions] = useState(null);

  const enriched = useMemo(() => cards.map((c) => ({ ...c, days_left: c.days_left !== undefined && c.days_left !== null ? c.days_left : daysLeft(c.expiry_date), _status: effectiveStatus(c) })), [cards]);

  const teams = useMemo(() => [...new Set(enriched.map((c) => c.team).filter(Boolean))].sort(), [enriched]);
  const devices = useMemo(() => [...new Set(enriched.map((c) => c.device_model).filter(Boolean))].sort(), [enriched]);
  const remarks = useMemo(() => [...new Set(enriched.map((c) => (c.signature || '').trim()).filter(Boolean))].sort(), [enriched]);

  useEffect(() => { setPage(1); }, [search, status, owner, remark, team, device, simName, expiry]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((c) =>
        (c.mobile_id || '').toLowerCase().includes(s) ||
        (c.device_model || '').toLowerCase().includes(s) ||
        (c.imei || '').toLowerCase().includes(s)
      );
    }
    if (status !== 'All') list = list.filter((c) => c._status === status);
    if (owner !== 'All') list = list.filter((c) => normOwner(c.team) === normOwner(owner));
    if (remark !== 'All') list = list.filter((c) => (c.signature || '').trim() === remark);
    if (team !== 'All') list = list.filter((c) => c.team === team);
    if (simType !== 'All') list = list.filter((c) => (c.sim_type || '').toLowerCase() === simType.toLowerCase());
    if (device !== 'All') list = list.filter((c) => c.device_model === device);
    if (simName === 'Nokia') {
      list = list.filter((c) => (c.mobile_id || '').toLowerCase().startsWith('ufrs'));
    } else if (simName !== 'All') {
      list = list.filter((c) => (c.mobile_id || '').toLowerCase().startsWith(simName.toLowerCase()));
    }
    if (expiry !== 'All') {
      list = list.filter((c) => {
        const d = c.days_left;
        if (expiry === 'Expired') return c._status === 'Expired';
        if (expiry === 'Within 7 Days') return d !== null && d >= 0 && d <= 7;
        if (expiry === 'Within 28 Days') return d !== null && d >= 0 && d <= 28;
        if (expiry === 'More than 28 Days') return d !== null && d > 28;
        return true;
      });
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        let va = a[sortKey], vb = b[sortKey];
        if (sortKey === 'days_left') { va = va === null ? Infinity : va; vb = vb === null ? Infinity : vb; }
        if (sortKey === 'status') { va = a.status; vb = b.status; }
        if (sortKey === 'issue_date' || sortKey === 'expiry_date') { va = va || '9999-12-31'; vb = vb || '9999-12-31'; }
        if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
        va = String(va ?? '').toLowerCase(); vb = String(vb ?? '').toLowerCase();
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return list;
  }, [enriched, search, status, owner, remark, team, simType, device, simName, expiry, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);
  const selectedCount = Object.values(selected).filter(Boolean).length;

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const toggleSelect = (id) => setSelected((p) => ({ ...p, [id]: !p[id] }));
  const toggleAll = () => {
    if (selectedCount === pageRows.length && selectedCount > 0) {
      const n = { ...selected }; pageRows.forEach((r) => delete n[r.id]); setSelected(n);
    } else {
      const n = { ...selected }; pageRows.forEach((r) => { n[r.id] = true; }); setSelected(n);
    }
  };
  const clearFilters = () => { setSearch(''); setStatus('All'); setOwner('All'); setRemark('All'); setTeam('All'); setSimType('All'); setDevice('All'); setSimName('All'); setExpiry('All'); setPage(1); };

  async function doBulkChange(statusVal) {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    try {
      await bulkChangeStatus(ids, statusVal);
      toast(`${ids.length} SIM card(s) updated`, 'success');
      setSelected({}); refresh();
    } catch (e) { toast(e.message || 'Failed', 'error'); }
  }

  async function doBulkDelete() {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected SIM card(s)? This cannot be undone.`)) return;
    try {
      await bulkDelete(ids);
      toast(`${ids.length} SIM card(s) deleted`, 'success');
      setSelected({}); refresh();
    } catch (e) { toast(e.message || 'Failed', 'error'); }
  }

  const handleDelete = (c) => {
    onDelete(c);
  };

  return (
    <div>
      <div className="toolbar">
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 10, color: 'var(--sim-ink-soft)', display: 'flex' }}><Icon name="search" size={15} /></span>
          <input className="sim-input search-input" placeholder="Search Mobile ID, Device, IMEI..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <select className="sim-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="sim-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="All">All Owners</option>
          {OWNER_UFS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="sim-select" value={remark} onChange={(e) => setRemark(e.target.value)}>
          <option value="All">All Remarks</option>
          {remarks.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="sim-select" value={simType} onChange={(e) => setSimType(e.target.value)}>
          <option value="All">All SIM Types</option>
          {SIM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="sim-select" value={device} onChange={(e) => setDevice(e.target.value)}>
          <option value="All">All Devices</option>
          {devices.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="sim-select" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
          {EXPIRY_FILTERS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="sim-btn ghost" onClick={clearFilters}>Clear Filters</button>
      </div>

      {selectedCount > 0 && (
        <div className="bulk-bar">
          <div style={{ fontSize: 13, fontWeight: 600 }}>Selected {selectedCount} SIM Cards</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="sim-btn" onClick={() => doBulkChange('Active')}>Mark Active</button>
            <button className="sim-btn" onClick={() => doBulkChange('Inactive')}>Mark Inactive</button>
            <button className="sim-btn danger" onClick={doBulkDelete}>Delete Selected</button>
            <button className="sim-btn ghost" onClick={() => setSelected({})}>Clear</button>
          </div>
        </div>
      )}

      <div className="sim-tabs" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {SIM_NAME_FILTERS.map((t) => (
          <button key={t} className={`sim-tab ${simName === t ? 'active' : ''}`} onClick={() => setSimName(t)}>{t}</button>
        ))}
      </div>

{filtered.length === 0 ? (
        <div className="sim-box empty-state">
          <div className="big">No SIM Cards Found</div>
          <div className="small">Adjust filters or add a new SIM card to get started.</div>
          <button className="sim-btn primary" onClick={onAdd}>+ Add SIM Card</button>
        </div>
      ) : (
        <div className="card-block">
          <div className="table-wrap">
            <table className="sim-table">
              <thead>
                <tr>
                  <th className="check-cell">
                    <input type="checkbox" checked={selectedCount === pageRows.length && selectedCount > 0} onChange={toggleAll} />
                  </th>
                  {COLUMNS.map((col) => {
                    const nokiaLabel = simName === 'Nokia' && (col.key === 'team' || col.key === 'signature') ? (col.key === 'team' ? 'Owner' : 'Remark') : col.label;
                    return (
                      <th key={col.key} className={SORTABLE.includes(col.key) ? `sortable ${col.num ? 'num' : ''}` : (col.num ? 'num' : '')} onClick={() => SORTABLE.includes(col.key) && toggleSort(col.key)}>
                        {nokiaLabel}
                        {col.key === sortKey && <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                      </th>
                    );
                  })}
                  {simName === 'Android' && <th>GB</th>}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => (
                  <tr key={c.id} className={selected[c.id] ? 'selected' : ''}>
                    <td className="check-cell"><input type="checkbox" checked={!!selected[c.id]} onChange={() => toggleSelect(c.id)} /></td>
                    {COLUMNS.map((col) => {
                      const v = c[col.key];
                      switch (col.key) {
                        case 'mobile_id':
                          return <td key={col.key} style={{ fontWeight: 600 }}>{c.mobile_id || '—'}</td>;
                        case 'status':
                          return <td key={col.key}><span className={`pill ${pillForStatus(c.status)}`}>{c.status || '—'}</span></td>;
                        case 'issue_date':
                        case 'expiry_date':
                          return <td key={col.key}>{formatDate(v)}</td>;
                        case 'days_left':
                          return <td key={col.key} className={`days-cell num ${dayClass(c.days_left)}`}>{c.days_left === null || c.days_left === undefined || Number.isNaN(c.days_left) ? '—' : `${c.days_left} days`}</td>;
                        case 'replacement_count':
                          return <td key={col.key} className="num">{c.replacement_count || 0}</td>;
                        default:
                          return <td key={col.key}>{v || '—'}</td>;
                      }
                    })}
                      {simName === 'Android' && <td>{c.gb || '—'}</td>}
                      <td>
                        <div className="cell-actions" style={{ gap: 4 }}>
                          <button className="mini-btn" onClick={() => onEdit(c)}>Edit</button>
                          <div className="kebab" style={{ position: 'relative' }}>
                            <button className="mini-btn" onClick={() => setShowActions(showActions === c.id ? null : c.id)}>⋯</button>
                            {showActions === c.id && (
                              <div className="kebab-menu">
                                {[['Add', () => onAdd()], ['View', () => onView(c)], ['Edit', () => onEdit(c)], ['Replace', () => onReplace(c)], ['History', () => onHistory && onHistory(c)], ['Delete', () => handleDelete(c)]].map(([label, fn]) => (
                                  <button key={label} className="kebab-item" style={{ color: label === 'Delete' ? 'var(--sim-red)' : 'inherit' }} onClick={() => { setShowActions(null); fn(); }}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--sim-ink-soft)' }}>
              <span>Showing {filtered.length === 0 ? 0 : start + 1}–{Math.min(start + perPage, filtered.length)} of {filtered.length} SIM Cards</span>
              <select className="sim-select" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} style={{ padding: '5px 8px' }}>
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} rows</option>)}
              </select>
            </div>
            <div className="pages">
              <button className="page-btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</button>
              {Array.from({ length: Math.min(pageCount, 7) }, (_, i) => {
                let p = i + 1;
                if (pageCount > 7) {
                  const half = Math.floor(6 / 2);
                  const maxLeft = safePage - half;
                  const maxRight = safePage + half;
                  if (maxRight > pageCount) p = pageCount - 6 + i;
                  else if (maxLeft < 1) p = 1 + i;
                  else p = maxLeft + i;
                }
                return p >= 1 && p <= pageCount ? (
                  <button key={p} className={`page-btn ${p === safePage ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                ) : null;
              })}
              <button className="page-btn" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>›</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

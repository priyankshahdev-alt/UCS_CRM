import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../api/auth'
import {
  Package, Boxes, IndianRupee, Banknote, UserCheck, CheckCircle2, Wrench, PackageX, SearchX, Search,
  SlidersHorizontal, Download, Upload, FileSpreadsheet, FileDown, Plus, X, Pencil, RotateCcw, History, MapPin,
  AlertTriangle, Clock, ShieldCheck, ShieldAlert, TrendingUp, BarChart3, ChevronDown, ChevronLeft,
  ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Building2, Monitor, Laptop, Smartphone, Phone,
  Lightbulb, Fan, Cctv, Armchair, Snowflake, Wind, Droplets, Plug, Network, Blinds, Server, HardDrive,
  Aperture, Guitar, ChefHat, Info, Sparkles, Loader2, RefreshCw, CalendarDays, ListChecks, Layers,
  BadgeCheck, Trash2, UserPlus, Cpu, CircuitBoard,
} from 'lucide-react'

/* ================= CONSTANTS & HELPERS ================= */
const MINT = '#2A6B45'
const MINT_DEEP = '#1E4D3D'
const MINT_SOFT = '#EAF7EE'

const CAT_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#d97706', '#65a30d', '#16a34a', '#0d9488', '#0891b2', '#6366f1', '#9333ea', '#f43f5e', '#64748b']
const CATEGORIES = ['Desktop', 'Laptop', 'Android Mobile', 'Nokia Mobile', 'Ceiling Lights', 'Ceiling Fan', 'Cameras', 'Furniture', 'Air Conditioner', 'Exhaust Fan', 'Office Chair', 'Water Tank', 'Office Equipment', 'Networking Switch', 'Blind Curtain', 'Server Desktop', 'External Hard Drive 2GB', 'External Hard Drive 5GB', 'Shooting Accessories', 'Guitar', 'Kitchen Equipment']
const LOCATIONS = ['Balcony', 'AFLF Cabin', 'MANN Cabin', 'BPO Cabin', 'Library Cabin', "Vocational Cabin", "Director's Cabin", "Director's Washroom", 'Kitchen', 'Reception Cabin', 'AFLF Staircase', 'BSCT Staircase']
const CONDITIONS = ['New', 'Good', 'Average', 'Damaged']
const CONDITION_COLORS = { New: '#16a34a', Good: '#0d9488', Average: '#d97706', Damaged: '#dc2626' }

const CAT_META = {
  'Desktop': Monitor, 'Laptop': Laptop, 'Android Mobile': Smartphone, 'Nokia Mobile': Phone,
  'Ceiling Lights': Lightbulb, 'Ceiling Fan': Fan, 'Cameras': Cctv, 'Furniture': Armchair,
  'Air Conditioner': Snowflake, 'Exhaust Fan': Wind, 'Office Chair': Armchair, 'Water Tank': Droplets,
  'Office Equipment': Plug, 'Networking Switch': Network, 'Blind Curtain': Blinds, 'Server Desktop': Server,
  'External Hard Drive 2GB': HardDrive, 'External Hard Drive 5GB': HardDrive, 'Shooting Accessories': Aperture,
  'Guitar': Guitar, 'Kitchen Equipment': ChefHat,
}
const catIcon = c => CAT_META[c] || Package
const catColor = c => CAT_COLORS[CATEGORIES.indexOf(c) % CAT_COLORS.length] || MINT
const isMachineAsset = c => c === 'Desktop' || c === 'Laptop' || c === 'Server Desktop'

const ITEM_SUGGESTIONS = {
  'Desktop': ['Desktop', 'Desktop Computer', 'Dell Desktop', 'HP Desktop', 'Lenovo Desktop', 'Acer Desktop'],
  'Laptop': ['Laptop', 'Dell Laptop', 'HP Laptop', 'Lenovo Laptop', 'Asus Laptop', 'MacBook'],
  'Android Mobile': ['Android Mobile', 'Smartphone', 'Samsung Galaxy', 'Redmi', 'Realme', 'Vivo', 'Oppo'],
  'Nokia Mobile': ['Nokia Mobile', 'Nokia 105', 'Nokia 110', 'Nokia 150', 'Keypad Phone'],
  'Ceiling Lights': ['Ceiling Lights', 'Kitchen Light', 'Washroom Light', 'Passage Light'],
  'Ceiling Fan': ['Ceiling Fan', 'Fan'],
  'Cameras': ['Cameras', 'Passage Camera', 'Wall Camera', 'DSLR Camera'],
  'Furniture': ['Office Sofa', 'Wooden Storage Cupboard', 'Metal Cupboard', 'Cupboard'],
  'Air Conditioner': ['Window A.C.', 'Split A.C.', 'Air Conditioner'],
  'Exhaust Fan': ['Washroom Exhaust Fan', 'Exhaust Fan'],
  'Office Chair': ['Office Chair', 'Wooden Chair', 'Plastic Chair', 'Chair'],
  'Water Tank': ['Water Tank'],
  'Office Equipment': ['Writing Board', 'Water Dispenser', 'Server Rack', 'Wall Photo Frame', 'Laptop Bags', 'Printer', 'Godrej Locker', 'Ganpati Idol'],
  'Networking Switch': ['Networking Switch', '24 Port Switch', '16 Port Switch'],
  'Blind Curtain': ['Blind Curtain', 'Curtain'],
  'Server Desktop': ['Server Desktop', 'Social Media Department'],
  'External Hard Drive 2GB': ['External Hard Drive 2GB', 'Admin Department'],
  'External Hard Drive 5GB': ['External Hard Drive 5GB', 'Social Media'],
  'Shooting Accessories': ['DSLR Camera', 'Flash', 'Camera Battery', 'Charger', 'Flash Battery with Charger', 'Phone Power Bank', 'Camera Cleaning Tool Kit', 'Card Reader', 'Tripod'],
  'Guitar': ['Guitar'],
  'Kitchen Equipment': ['Refrigerator', 'Gas Induction', 'R.O. Plant', 'Writing Board', 'Electric Hot Kettle', 'Water Dispenser', 'Coffee Machine', 'Oven', 'Server Rack', 'Water Jug'],
}

const STATUS_META = {
  available:   { label: 'Available',   bg: '#DBEAFE', text: '#1D4ED8', color: '#2563eb', order: 0, Icon: CheckCircle2 },
  assigned:    { label: 'Assigned',    bg: '#DCFCE7', text: '#15803D', color: '#16a34a', order: 1, Icon: UserCheck },
  repair:      { label: 'In Repair',   bg: '#FEF3C7', text: '#B45309', color: '#d97706', order: 2, Icon: Wrench },
  not_working: { label: 'Not Working', bg: '#FEE2E2', text: '#B91C1C', color: '#dc2626', order: 3, Icon: PackageX },
  lost:        { label: 'Lost',        bg: '#EDE9FE', text: '#6D28D9', color: '#7c3aed', order: 4, Icon: SearchX },
  scrapped:    { label: 'Scrapped',    bg: '#E5E7EB', text: '#374151', color: '#64748b', order: 5, Icon: Trash2 },
}

const money = v => `₹${Number(v || 0).toLocaleString('en-IN')}`
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const daysSince = d => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0
const daysUntil = d => d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null
const uq = a => Number(a?.quantity || 1) || 1
const aval = a => Number(a?.purchase_price || 0) * uq(a)
const locOf = a => a?.location || a?.department || ''

/* ================= HOOKS ================= */
function useCountUp(target, duration = 900) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf
    const t0 = performance.now()
    const step = t => {
      const p = Math.min(1, (t - t0) / duration)
      setV(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return v
}

function useEsc(onClose) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
}

/* ================= CSV EXPORT ================= */
const csvEscape = rows => '\uFEFF' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')

function downloadCSV(csv, name) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportAssets(assets) {
  const rows = [['ASSET REGISTER'], ['Generated', new Date().toLocaleString('en-IN')], []]
  rows.push(['Code', 'Name', 'Category', 'Location', 'Quantity', 'Team Leader', 'Owner Name', 'Brand', 'Model', 'Serial No', 'Hard Drive / SSD', 'RAM', 'Processor', 'Motherboard', 'Condition', 'Status', 'Assigned To', 'Purchase Date', 'Price', 'Warranty Expiry', 'SIM Number', 'Remarks'])
  assets.forEach(a => rows.push([
    a.code, a.name, a.category, locOf(a), uq(a), a.team_leader || '', a.owner_name || '',
    a.brand || '', a.model || '', a.serial_no || '',
    a.storage || '', a.ram || '', a.processor || '', a.motherboard || '',
    a.condition || '', STATUS_META[a.status]?.label || a.status, a.assigned_to_name || '',
    a.purchase_date || '', a.purchase_price || 0, a.warranty_expiry || '', a.sim_number || '', a.remarks || '',
  ]))
  downloadCSV(csvEscape(rows), `asset-register-${new Date().toISOString().slice(0, 10)}.csv`)
}

/* ================= SMALL PIECES ================= */
function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, 3600)
    return () => clearTimeout(t)
  }, [toast, onClose])
  if (!toast) return null
  const T = toast.type === 'error' ? AlertTriangle : toast.type === 'info' ? Info : CheckCircle2
  return (
    <div className={`arx-toast arx-toast-${toast.type || 'ok'}`} key={toast.id}>
      <T size={17} strokeWidth={2.2} />
      <span>{toast.msg}</span>
      <button onClick={onClose} aria-label="Dismiss"><X size={13} /></button>
    </div>
  )
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.available
  return (
    <span className="arx-badge" style={{ background: m.bg, color: m.text }}>
      <m.Icon size={12} strokeWidth={2.4} /> {m.label}
    </span>
  )
}

function SpecPop({ asset }) {
  const isM = isMachineAsset(asset.category)
  if (!isM) return null
  const pretty = [
    ['Hard Drive / SSD', asset.storage],
    ['RAM', asset.ram],
    ['Processor', asset.processor],
    ['Motherboard', asset.motherboard],
  ]
  const filled = pretty.filter(([, v]) => v && String(v).trim())
  return (
    <span className="arx-spec-wrap">
      <span className="arx-spec-trigger">{asset.name}</span>
      <span className="arx-spec-pop">
        <span className="arx-spec-title"><HardDrive size={11} /> Specifications</span>
        {filled.length === 0 ? (
          <span className="arx-spec-none">No specs recorded</span>
        ) : (
          filled.map(([k, v]) => (
            <span className="arx-spec-row" key={k}>
              <span className="arx-spec-k">{k}</span>
              <span className="arx-spec-v">{v}</span>
            </span>
          ))
        )}
      </span>
    </span>
  )
}

function StatCard({ icon: Icon, label, value, sub, tint, fg, onClick, active, delay = 0, isMoney }) {
  const v = useCountUp(value)
  return (
    <button type="button"
      className={`arx-kpi${active ? ' on' : ''}${onClick ? ' click' : ''}`}
      style={{ animationDelay: `${delay}ms`, ['--tint']: tint, ['--fg']: fg }}
      onClick={onClick}>
      <span className="arx-kpi-ico"><Icon size={19} strokeWidth={2.1} /></span>
      <span className="arx-kpi-label">{label}</span>
      <span className="arx-kpi-val">{isMoney ? money(Math.round(v)) : Math.round(v).toLocaleString('en-IN')}</span>
      {sub && <span className="arx-kpi-sub">{sub}</span>}
    </button>
  )
}
/* ================= CHARTS ================= */
function BarList({ rows, fmt, empty = 'No data yet' }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    setOn(false)
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)))
    return () => cancelAnimationFrame(t)
  }, [rows])
  if (rows.length === 0) return <p className="arx-muted arx-padt">{empty}</p>
  const max = Math.max(1, ...rows.map(r => r.value))
  const fmtV = fmt || (v => v.toLocaleString('en-IN'))
  return (
    <div className="arx-bars">
      {rows.map((r, i) => (
        <div key={r.label} className="arx-bar-row" style={{ animationDelay: `${i * 45}ms` }}>
          <span className="arx-bar-label" title={r.label}>{r.label}</span>
          <div className="arx-bar-mid">
            <div className="arx-bar-track">
              <div className="arx-bar-fill" style={{ width: on ? `${(r.value / max) * 100}%` : 0, background: r.color || MINT }} />
            </div>
            {r.sub && <span className="arx-bar-sub">{r.sub}</span>}
          </div>
          <span className="arx-bar-val">{fmtV(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

function Donut({ data, centerLabel, empty = 'No data yet' }) {
  const [on, setOn] = useState(false)
  const [hi, setHi] = useState(-1)
  useEffect(() => {
    const t = setTimeout(() => setOn(true), 80)
    return () => clearTimeout(t)
  }, [data])
  const live = data.filter(d => d.value > 0)
  const total = live.reduce((a, d) => a + d.value, 0)
  if (total === 0) return <p className="arx-muted arx-padt">{empty}</p>
  let before = 0
  const segs = live.map(d => { const pct = (d.value / total) * 100; const s = { ...d, pct, before }; before += pct; return s })
  const cur = hi >= 0 && segs[hi] ? segs[hi] : null
  return (
    <div className="arx-donut-wrap">
      <div className="arx-donut-box">
        <svg viewBox="0 0 120 120" className="arx-donut-svg">
          <g transform="rotate(-90 60 60)">
            <circle cx="60" cy="60" r="46" pathLength="100" fill="none" stroke="#eef3f1" strokeWidth="13" />
            {segs.map((s, i) => (
              <circle key={s.label} cx="60" cy="60" r="46" pathLength="100" fill="none"
                stroke={s.color} strokeWidth={hi === i ? 17 : 13}
                strokeDasharray={on ? `${Math.max(s.pct - 0.6, 0.4)} ${100 - s.pct + 0.6}` : '0 100'}
                strokeDashoffset={-s.before} strokeLinecap="butt"
                className="arx-seg" style={{ transitionDelay: `${i * 70}ms` }}
                onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(-1)} />
            ))}
          </g>
        </svg>
        <div className="arx-dcenter">
          <strong>{cur ? cur.value.toLocaleString('en-IN') : total.toLocaleString('en-IN')}</strong>
          <span>{cur ? cur.label : centerLabel}</span>
          {cur && <em>{cur.pct.toFixed(1)}%</em>}
        </div>
      </div>
      <div className="arx-dlegend">
        {segs.map((s, i) => (
          <button type="button" key={s.label} className={`arx-dleg-item${hi === i ? ' hot' : ''}`}
            onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(-1)}>
            <span className="arx-dleg-dot" style={{ background: s.color }} />
            <span className="arx-dleg-label">{s.label}</span>
            <span className="arx-dleg-val">{s.value}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ================= TABLE PIECES ================= */
function STh({ label, k, sortKey, sortDir, onSort, cls }) {
  const active = sortKey === k
  const IconEl = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th className={cls}>
      <button type="button" className={`arx-thb${active ? ' on' : ''}`}
        onClick={() => onSort(k, active && sortDir === 'asc' ? 'desc' : 'asc')}>
        {label}<IconEl size={12} strokeWidth={2.4} />
      </button>
    </th>
  )
}

function Pager({ page, setPage, total, pageSize, setPageSize }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const go = p => { if (p >= 1 && p <= totalPages && p !== page) setPage(p) }
  let start = Math.max(1, page - 2)
  let end = Math.min(totalPages, start + 4)
  start = Math.max(1, end - 4)
  const pages = []
  for (let i = start; i <= end; i++) pages.push(i)
  return (
    <div className="arx-pager">
      <div className="arx-pager-info">
        {total === 0 ? 'No results' : <>Showing <strong>{from}–{to}</strong> of <strong>{total.toLocaleString('en-IN')}</strong></>}
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} aria-label="Rows per page">
          <option value={20}>20 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
      </div>
      {totalPages > 1 && (
        <div className="arx-pager-btns">
          <button type="button" onClick={() => go(page - 1)} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
          {start > 1 && <span className="arx-pager-ell">…</span>}
          {pages.map(p => (
            <button type="button" key={p} className={p === page ? 'cur' : ''} onClick={() => go(p)}>{p}</button>
          ))}
          {end < totalPages && <span className="arx-pager-ell">…</span>}
          <button type="button" onClick={() => go(page + 1)} disabled={page === totalPages} aria-label="Next page"><ChevronRight size={15} /></button>
        </div>
      )}
    </div>
  )
}
/* ================= IMPORT EXCEL (Office Asset Register) ================= */
const SNAP_CODES = Object.fromEntries(CATEGORIES.map(c => [c, 1]))

function normalizeCode(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  return s.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ')
}

function ImportModal({ onClose, onImported, pushToast }) {
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef(null)
  useEsc(onClose)

  function handleFile(file) {
    if (!file) return
    setError(''); setResult(null); setFileName(file.name); setRows([])
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' })
        const out = []

        // New 22-column format detection: scan all sheets for header row
        let foundNewFormat = false
        for (const sn of wb.SheetNames) {
          const ws = wb.Sheets[sn]
          if (!ws) continue
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
          // Find header row: first row with 22+ cells starting with "Code"
          const headerIdx = data.findIndex(r => r && r.length >= 22 && r[0] === 'Code' && r[1] === 'Name')
          if (headerIdx < 0) continue
          foundNewFormat = true
          data.forEach((r, i) => {
            if (i <= headerIdx) return
            const code = normalizeCode(r[0])
            if (!code) return
            const cat = String(r[2] || '').trim()
            if (!SNAP_CODES[cat]) return
            out.push({
              _key: code,
              include: true,
              code,
              name: String(r[1] || '').trim() || cat,
              category: cat,
              location: String(r[3] || '').trim(),
              quantity: Number(r[4]) || 1,
              team_leader: String(r[5] || '').trim(),
              owner_name: String(r[6] || '').trim(),
              brand: String(r[7] || '').trim(),
              model: String(r[8] || '').trim(),
              serial_no: String(r[9] || '').trim(),
              storage: String(r[10] || '').trim(),
              ram: String(r[11] || '').trim(),
              processor: String(r[12] || '').trim(),
              motherboard: String(r[13] || '').trim(),
              condition: String(r[14] || '').trim() || 'New',
              status: String(r[15] || '').trim() || 'available',
              assigned_to_name: String(r[16] || '').trim(),
              purchase_date: String(r[17] || '').trim() || null,
              purchase_price: Number(r[18]) || null,
              warranty_expiry: String(r[19] || '').trim() || null,
              sim_number: String(r[20] || '').trim(),
              remarks: String(r[21] || '').trim(),
            })
          })
          break
        }

        // Legacy format: old Computer / Asset Register / Asset Register Import sheets
        if (!foundNewFormat) {
          const sheets = [
            { name: 'Computer', dataFrom: 1, descCol: 4, qtyCol: 5, teamLeaderCol: 3 },
            { name: 'Asset Register', dataFrom: 3, descCol: 3, qtyCol: 4 },
            { name: 'Asset Register Import', dataFrom: 1, descCol: 4, qtyCol: 5, teamLeaderCol: 3 },
          ]
          sheets.forEach(({ name, dataFrom, descCol, qtyCol, teamLeaderCol }) => {
            const ws = wb.Sheets[name]
            if (!ws) return
            const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
            data.forEach((r, i) => {
              if (i < dataFrom) return
              const loc = String(r[1] || '').trim().replace(/\s+$/, '')
              const cat = String(r[2] || '').trim()
              if (!SNAP_CODES[cat]) return
              const code = normalizeCode(r[0])
              const isMachine = code !== ''
              const desc = String(r[descCol] || '').trim()
              const qty = isMachine ? 1 : (Number(r[qtyCol]) || 1)
              const name = isMachine ? cat : (desc || cat)
              const dedupeKey = code || `${cat}||${loc}||${name}`
              out.push({
                _key: dedupeKey,
                include: true,
                code,
                name,
                category: cat,
                location: loc,
                team_leader: isMachine && teamLeaderCol != null ? String(r[teamLeaderCol] || '').trim() : '',
                quantity: qty,
                remarks: isMachine ? desc : '',
              })
            })
          })
        }

        setRows(out)
        if (out.length === 0) setError('No recognisable asset rows were found in this file. Expected sheets: Computer / Asset Register / Asset Register Import.')
      } catch (err) {
        setError('Could not parse the file: ' + err.message)
      }
    }
    reader.onerror = () => setError('Could not read the file. Please try again.')
    reader.readAsArrayBuffer(file)
  }

  const selected = rows.filter(r => r.include)
  const totalQty = selected.reduce((a, r) => a + (r.quantity || 1), 0)

  async function doImport() {
    if (selected.length === 0) return
    setImporting(true); setResult(null)
    try {
      const payload = selected.map(({ _key, include, ...row }) => ({ ...row, code: row.code || null, status: row.status || 'available' }))
      const res = await api('/assets/import?upsert=true', { method: 'POST', body: JSON.stringify({ rows: payload }) })
      setResult(res)
      const msg = [res.inserted ? `${res.inserted} imported` : '', res.updated ? `${res.updated} updated` : '', `${res.skipped?.length || 0} skipped`].filter(Boolean).join(', ')
      pushToast(msg || 'Import complete', 'ok')
      onImported()
    } catch (err) {
      setError('Import API call failed: ' + err.message)
      pushToast('Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="arx-overlay" onClick={onClose}>
      <div className="arx-modal arx-modal-lg" onClick={e => e.stopPropagation()}>
        <div className="arx-modal-head">
          <div className="arx-mhead-left">
            <span className="arx-micon mint"><FileSpreadsheet size={19} /></span>
            <div>
              <h3 className="arx-modal-title">Import from Excel</h3>
              <p className="arx-modal-sub">Office Asset Register · all categories</p>
            </div>
          </div>
          <button className="arx-close" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="arx-modal-body">
          <div
            className={`arx-drop${drag ? ' drag' : ''}${fileName ? ' filled' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }}>
            <input type="file" ref={fileRef} accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
            {fileName
              ? <><CheckCircle2 size={26} strokeWidth={2} className="arx-drop-ico ok" /><div><strong>{fileName}</strong><span>{rows.length} rows detected — click to change file</span></div></>
              : <><FileSpreadsheet size={26} strokeWidth={1.8} className="arx-drop-ico" /><div><strong>Drop your Excel file here</strong><span>or click to browse — .xlsx, .xls, .csv</span></div></>}
          </div>

          <p className="arx-note">
            <Info size={13} /> Rows with an <b>Asset ID</b> (Desktop / Laptop machines) become individual records; other rows become <b>quantity lines</b>. Already-imported rows are skipped automatically.
          </p>

          {error && <div className="arx-inline-alert danger"><AlertTriangle size={15} /> {error}</div>}
          {result && (
            <div className="arx-inline-alert ok">
              <CheckCircle2 size={15} />
              <span><b>{result.inserted || 0}</b> imported · <b>{result.updated || 0}</b> updated · <b>{result.skipped?.length || 0}</b> skipped · <b>{result.errors?.length || 0}</b> errors</span>
              {result.skipped?.length > 0 && <span className="arx-note-line">Skipped: {result.skipped.slice(0, 6).map(s => s.code).join(', ')}{result.skipped.length > 6 ? '…' : ''}</span>}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="arx-preview-wrap">
                <table className="arx-table">
                  <thead>
                    <tr>
                      <th className="arx-th-check">
                        <input type="checkbox" checked={selected.length === rows.length}
                          onChange={e => setRows(rows.map(r => ({ ...r, include: e.target.checked })))} />
                      </th>
                      <th>Code</th><th>Name</th><th>Category</th><th>Location</th><th>Qty</th><th>Team Leader</th><th>Owner Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r._key || i} className={r.include ? '' : 'dim'}>
                        <td className="arx-th-check">
                          <input type="checkbox" checked={r.include}
                            onChange={e => setRows(rows.map((x, xi) => xi === i ? { ...x, include: e.target.checked } : x))} />
                        </td>
                        <td className="arx-code">{r.code || '—'}</td>
                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                        <td>{r.category}</td>
                        <td>{r.location || '—'}</td>
                        <td>{r.quantity}</td>
                        <td>{r.team_leader || '—'}</td>
                        <td>{r.owner_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="arx-muted" style={{ fontSize: 12, margin: '10px 2px 0' }}>{selected.length} rows · {totalQty} units selected</p>
            </>
          )}
        </div>
        <div className="arx-modal-foot">
          <button className="arx-btn arx-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="arx-btn arx-btn-mint" disabled={importing || selected.length === 0} onClick={doImport}>
            {importing ? <><Loader2 size={15} className="arx-spin" /> Importing…</> : <><Upload size={15} /> Import {selected.length} assets</>}
          </button>
        </div>
      </div>
    </div>
  )
}
/* ================= ADD / EDIT ASSET MODAL ================= */
function Field({ label, icon: Icon, span, children }) {
  return (
    <div className={`arx-field${span ? ' arx-fspan' : ''}`}>
      <label className="arx-flabel">{label}</label>
      <div className={`arx-finput${Icon ? ' has-ico' : ''}`}>
        {Icon && <Icon size={15} strokeWidth={2} className="arx-fico" />}
        {children}
      </div>
    </div>
  )
}

function AssetFormModal({ initial, onClose, onSave }) {
  const [f, setF] = useState(() => {
    if (initial) return { ...initial, quantity: Number(initial.quantity || 1), location: initial.location || initial.department || '' }
    return {
      name: '', category: 'Desktop', brand: '', model: '', serial_no: '',
      location: '', quantity: 1, team_leader: '', condition: 'New', status: 'available',
      purchase_date: '', purchase_price: '', vendor: '', warranty_expiry: '',
      sim_number: '', sim_operator: '', sim_plan: '', remarks: '',
      storage: '', ram: '', processor: '', motherboard: '', owner_name: '',
    }
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const isSim = f.category === 'Android Mobile' || f.category === 'Nokia Mobile'
  const isMachine = f.category === 'Desktop' || f.category === 'Laptop' || f.category === 'Server Desktop'
  useEsc(onClose)

  return (
    <div className="arx-overlay" onClick={onClose}>
      <div className="arx-modal arx-modal-md" onClick={e => e.stopPropagation()}>
        <div className="arx-modal-head">
          <div className="arx-mhead-left">
            <span className="arx-micon mint">{initial ? <Pencil size={18} /> : <Plus size={19} />}</span>
            <div>
              <h3 className="arx-modal-title">{initial ? 'Edit Asset' : 'Add New Asset'}</h3>
              <p className="arx-modal-sub">{initial ? `${initial.code} · update details` : 'Register a new company asset'}</p>
            </div>
          </div>
          <button className="arx-close" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="arx-modal-body">
          <div className="arx-fsec"><span><Package size={13} /> Identity</span></div>
          <div className="arx-form-grid">
            <Field label="Asset Name *" icon={Pencil}>
              <input value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Dell Laptop" list="arx-item-suggestions" />
              <datalist id="arx-item-suggestions">
                {(ITEM_SUGGESTIONS[f.category] || []).map(item => <option key={item} value={item} />)}
              </datalist>
            </Field>
            <Field label="Category *" icon={Boxes}>
              <select value={f.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Brand / Company" icon={BadgeCheck}><input value={f.brand} onChange={e => set('brand', e.target.value)} placeholder="Dell, Samsung…" /></Field>
            <Field label="Model" icon={Monitor}><input value={f.model} onChange={e => set('model', e.target.value)} placeholder="Inspiron 15" /></Field>
            <Field label="Serial No / IMEI" icon={Layers}><input value={f.serial_no} onChange={e => set('serial_no', e.target.value)} /></Field>
            <Field label="Location" icon={MapPin}>
              <select value={f.location} onChange={e => set('location', e.target.value)}>
                <option value="">—</option>
                {LOCATIONS.map(d => <option key={d}>{d}</option>)}
              </select>
            </Field>
            {!isMachine && <Field label="Quantity" icon={Boxes}><input type="number" min="1" value={f.quantity} onChange={e => set('quantity', e.target.value)} /></Field>}
            {isMachine && <Field label="Team Leader (opt.)" icon={UserCheck}><input value={f.team_leader} onChange={e => set('team_leader', e.target.value)} placeholder="e.g. Anjana Vyas" /></Field>}
            <Field label="Owner Name" icon={UserCheck}><input value={f.owner_name} onChange={e => set('owner_name', e.target.value)} placeholder="e.g. Rajesh Kumar" /></Field>
            <Field label="Condition" icon={ShieldCheck}>
              <select value={f.condition} onChange={e => set('condition', e.target.value)}>
                {CONDITIONS.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          {isMachine && (
            <>
              <div className="arx-fsec"><span><HardDrive size={13} /> Specifications</span></div>
              <div className="arx-form-grid">
                <Field label="Hard Drive / SSD" icon={HardDrive}><input value={f.storage} onChange={e => set('storage', e.target.value)} placeholder="e.g. 512GB NVMe SSD" /></Field>
                <Field label="RAM" icon={Server}><input value={f.ram} onChange={e => set('ram', e.target.value)} placeholder="e.g. 16GB DDR4" /></Field>
                <Field label="Processor" icon={Cpu}><input value={f.processor} onChange={e => set('processor', e.target.value)} placeholder="e.g. Intel i7-12700H" /></Field>
                <Field label="Motherboard" icon={CircuitBoard}><input value={f.motherboard} onChange={e => set('motherboard', e.target.value)} placeholder="e.g. Dell 0T10XW" /></Field>
              </div>
            </>
          )}

          <div className="arx-fsec"><span><IndianRupee size={13} /> Purchase & Warranty</span></div>
          <div className="arx-form-grid">
            <Field label="Purchase Date" icon={CalendarDays}><input type="date" value={f.purchase_date} onChange={e => set('purchase_date', e.target.value)} /></Field>
            <Field label="Purchase Price (₹)" icon={IndianRupee}><input type="number" min="0" value={f.purchase_price} onChange={e => set('purchase_price', e.target.value)} placeholder="0" /></Field>
            <Field label="Vendor / Shop" icon={Building2}><input value={f.vendor} onChange={e => set('vendor', e.target.value)} /></Field>
            <Field label="Warranty Expiry" icon={ShieldCheck}><input type="date" value={f.warranty_expiry} onChange={e => set('warranty_expiry', e.target.value)} /></Field>
          </div>

          {isSim && (
            <>
              <div className="arx-fsec"><span><Smartphone size={13} /> SIM Details</span></div>
              <div className="arx-form-grid">
                <Field label="SIM Number (Mobile No.)" icon={Smartphone}><input value={f.sim_number} onChange={e => set('sim_number', e.target.value)} placeholder="98XXXXXXXX" /></Field>
                <Field label="Operator" icon={Phone}>
                  <select value={f.sim_operator} onChange={e => set('sim_operator', e.target.value)}>
                    <option value="">—</option><option>Jio</option><option>Airtel</option><option>Vi</option><option>BSNL</option>
                  </select>
                </Field>
                <Field label="Monthly Plan (₹)" icon={Banknote}><input type="number" min="0" value={f.sim_plan} onChange={e => set('sim_plan', e.target.value)} /></Field>
              </div>
            </>
          )}

          <div className="arx-form-grid" style={{ marginTop: 14 }}>
            <Field label="Remarks" icon={Info} span><input value={f.remarks} onChange={e => set('remarks', e.target.value)} placeholder="Optional notes…" /></Field>
          </div>
        </div>
        <div className="arx-modal-foot">
          <button className="arx-btn arx-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="arx-btn arx-btn-primary" disabled={!f.name.trim()} onClick={() => onSave(f)}>
            {initial ? <><CheckCircle2 size={15} /> Save Changes</> : <><Plus size={15} /> Add Asset</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ================= ACTION MODAL (assign / return / repair) ================= */
function ActionModal({ type, asset, workers, onClose, onDone }) {
  const [workerId, setWorkerId] = useState('')
  const [condition, setCondition] = useState(asset.condition || 'Good')
  const [shop, setShop] = useState('')
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  useEsc(onClose)

  const meta = {
    assign: { title: 'Assign Asset', icon: UserPlus, tint: 'mint' },
    return: { title: 'Return Asset', icon: RotateCcw, tint: 'teal' },
    repair: { title: 'Send to Repair', icon: Wrench, tint: 'amber' },
    repair_done: { title: 'Repair Complete', icon: CheckCircle2, tint: 'mint' },
  }[type]

  function submit() {
    if (type === 'assign') {
      const w = workers.find(x => String(x.id) === String(workerId))
      onDone({ status: 'assigned', assigned_to: workerId, assigned_to_name: w?.name || '', assigned_date: new Date().toISOString().slice(0, 10) },
        `Assigned to ${w?.name || 'worker'}${note ? ` — ${note}` : ''}`)
    } else if (type === 'return') {
      onDone({ status: 'available', assigned_to: null, assigned_to_name: '', condition },
        `Returned by ${asset.assigned_to_name || 'worker'} — condition: ${condition}${note ? ` — ${note}` : ''}`)
    } else if (type === 'repair') {
      onDone({ status: 'repair', repair_shop: shop, repair_cost: cost, repair_date: new Date().toISOString().slice(0, 10) },
        `Sent to repair — ${shop || 'shop'}${cost ? `, ${money(cost)}` : ''}${note ? ` — ${note}` : ''}`)
    } else if (type === 'repair_done') {
      onDone({ status: asset.assigned_to ? 'assigned' : 'available', condition, repair_shop: '', repair_date: null,
        total_repair_cost: Number(asset.total_repair_cost || 0) + Number(asset.repair_cost || 0) },
        `Repair complete — condition: ${condition}`)
    }
  }

  return (
    <div className="arx-overlay" onClick={onClose}>
      <div className="arx-modal arx-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="arx-modal-head">
          <div className="arx-mhead-left">
            <span className={`arx-micon ${meta.tint}`}><meta.icon size={18} /></span>
            <div>
              <h3 className="arx-modal-title">{meta.title}</h3>
              <p className="arx-modal-sub">{asset.code} · {asset.name}</p>
            </div>
          </div>
          <button className="arx-close" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="arx-modal-body">
          {type === 'assign' && (
            <Field label="Worker *" icon={UserCheck}>
              <select value={workerId} onChange={e => setWorkerId(e.target.value)}>
                <option value="">Select worker…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.name} {w.department ? `(${w.department})` : ''}</option>)}
              </select>
            </Field>
          )}
          {(type === 'return' || type === 'repair_done') && (
            <Field label="Condition Check" icon={ShieldCheck}>
              <select value={condition} onChange={e => setCondition(e.target.value)}>
                {CONDITIONS.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          )}
          {type === 'repair' && (
            <div className="arx-form-grid">
              <Field label="Repair Shop / Person" icon={Building2}><input value={shop} onChange={e => setShop(e.target.value)} placeholder="e.g. Sharma Computers" /></Field>
              <Field label="Estimated Cost (₹)" icon={IndianRupee}><input type="number" min="0" value={cost} onChange={e => setCost(e.target.value)} placeholder="0" /></Field>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Field label="Note (optional)" icon={Info}><input value={note} onChange={e => setNote(e.target.value)} placeholder="Add context for the history log…" /></Field>
          </div>
        </div>
        <div className="arx-modal-foot">
          <button className="arx-btn arx-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="arx-btn arx-btn-primary" disabled={type === 'assign' && !workerId} onClick={submit}>
            <CheckCircle2 size={15} /> Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
/* ================= ASSET DETAIL MODAL ================= */
function AssetDetailModal({ asset, onClose, onAction, onEdit, onScrap, onLost }) {
  const repairDays = asset.status === 'repair' ? daysSince(asset.repair_date) : 0
  const warrantyDays = daysUntil(asset.warranty_expiry)
  const totalRepair = Number(asset.total_repair_cost || 0) + (asset.status === 'repair' ? Number(asset.repair_cost || 0) : 0)
  const repairHeavy = asset.purchase_price && totalRepair > Number(asset.purchase_price) / 2
  const CIcon = catIcon(asset.category)
  useEsc(onClose)

  const kv = [
    ['Category', <span className="arx-kv-cat" style={{ color: catColor(asset.category) }}><CIcon size={14} /> {asset.category}</span>],
    ['Brand / Model', [asset.brand, asset.model].filter(Boolean).join(' ') || '—'],
    ['Serial No / IMEI', asset.serial_no ? <code>{asset.serial_no}</code> : '—'],
    ['Location', locOf(asset) || '—'],
    ...(uq(asset) > 1 ? [['Quantity', <>{uq(asset)} pcs <em className="arx-kv-note">(grouped line item)</em></>]] : []),
    ['Team Leader', asset.team_leader || '—'],
    ['Owner Name', asset.owner_name || '—'],
    ['Condition', asset.condition ? <span className="arx-cond" data-cond={asset.condition}>{asset.condition}</span> : '—'],
    ['Assigned To', asset.assigned_to_name ? <>{asset.assigned_to_name} <em className="arx-kv-note">since {fmtDate(asset.assigned_date)}</em></> : '—'],
    ['Purchase', <>{fmtDate(asset.purchase_date)} · {money(asset.purchase_price)}{asset.vendor ? ` · ${asset.vendor}` : ''}</>],
    ['Warranty', fmtDate(asset.warranty_expiry)],
    ...(isMachineAsset(asset.category) ? [
      ...(asset.storage ? [['Hard Drive / SSD', asset.storage]] : []),
      ...(asset.ram ? [['RAM', asset.ram]] : []),
      ...(asset.processor ? [['Processor', asset.processor]] : []),
      ...(asset.motherboard ? [['Motherboard', asset.motherboard]] : []),
    ] : []),
    ...(asset.sim_number ? [['SIM Number', <><code>{asset.sim_number}</code>{asset.sim_operator ? ` (${asset.sim_operator})` : ''}{asset.sim_plan ? ` · ${money(asset.sim_plan)}/month` : ''}</>]] : []),
    ...(asset.status === 'repair' ? [['Repair', <>{asset.repair_shop || '—'} · {money(asset.repair_cost)} · {repairDays} days</>]] : []),
    ...(totalRepair > 0 ? [['Total Repair Cost', money(totalRepair)]] : []),
    ...(asset.remarks ? [['Remarks', asset.remarks]] : []),
  ]

  return (
    <div className="arx-overlay" onClick={onClose}>
      <div className="arx-modal arx-modal-md" onClick={e => e.stopPropagation()}>
        <div className="arx-modal-head">
          <div className="arx-mhead-left">
            <span className="arx-micon" style={{ background: catColor(asset.category) + '18', color: catColor(asset.category) }}><CIcon size={20} /></span>
            <div>
              <h3 className="arx-modal-title">{asset.name}</h3>
              <p className="arx-modal-sub">
                <span className="arx-code" style={{ marginRight: 8 }}>{asset.code}</span>
                <StatusBadge status={asset.status} />
              </p>
            </div>
          </div>
          <button className="arx-close" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="arx-modal-body">
          {asset.status === 'repair' && repairDays > 30 && (
            <div className="arx-inline-alert danger"><AlertTriangle size={15} /> In repair for <b>{repairDays} days</b> — please follow up with the shop.</div>
          )}
          {warrantyDays !== null && warrantyDays > 0 && warrantyDays <= 30 && (
            <div className="arx-inline-alert warn"><Clock size={15} /> Warranty expires in <b>{warrantyDays} days</b> ({fmtDate(asset.warranty_expiry)}).</div>
          )}
          {repairHeavy && (
            <div className="arx-inline-alert warn"><Sparkles size={15} /> Total repair cost ({money(totalRepair)}) exceeds half the purchase price — consider replacing this asset.</div>
          )}

          <div className="arx-kv-grid">
            {kv.map(([k, v]) => (
              <div className="arx-kv" key={k}>
                <span className="arx-kv-k">{k}</span>
                <span className="arx-kv-v">{v}</span>
              </div>
            ))}
          </div>

          <div className="arx-actions">
            {(asset.status === 'available' || asset.status === 'not_working') && <button className="arx-btn arx-btn-mint" onClick={() => onAction('assign')}><UserPlus size={15} /> Assign</button>}
            {asset.status === 'assigned' && <button className="arx-btn arx-btn-teal" onClick={() => onAction('return')}><RotateCcw size={15} /> Return</button>}
            {(asset.status === 'available' || asset.status === 'assigned' || asset.status === 'not_working') && <button className="arx-btn arx-btn-amber" onClick={() => onAction('repair')}><Wrench size={15} /> Send to Repair</button>}
            {asset.status === 'repair' && <button className="arx-btn arx-btn-mint" onClick={() => onAction('repair_done')}><CheckCircle2 size={15} /> Repair Done</button>}
            <button className="arx-btn arx-btn-ghost" onClick={onEdit}><Pencil size={15} /> Edit</button>
            {asset.status !== 'lost' && <button className="arx-btn arx-btn-red" onClick={onLost}><SearchX size={15} /> Mark Lost</button>}
            {asset.status !== 'scrapped' && <button className="arx-btn arx-btn-red" onClick={onScrap}><Trash2 size={15} /> Scrap</button>}
          </div>

          <h4 className="arx-sub-title"><History size={13} /> History</h4>
          {(asset.history || []).length === 0 ? (
            <p className="arx-muted">No history yet — actions on this asset will appear here.</p>
          ) : (
            <div className="arx-tl">
              {[...asset.history].reverse().map((h, i) => (
                <div key={i} className="arx-tl-item" style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}>
                  <span className={`arx-tl-dot${i === 0 ? ' hot' : ''}`} />
                  <div>
                    <span className="arx-tl-text">{h.text}</span>
                    <span className="arx-tl-date"><Clock size={11} /> {fmtDate(h.date)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
/* ================= TABS BAR (measured sliding indicator) ================= */
function TabsBar({ tab, setTab }) {
  const wrapRef = useRef(null)
  const assetsRef = useRef(null)
  const reportsRef = useRef(null)
  const [ind, setInd] = useState({ left: 4, width: 0 })

  const update = useCallback(() => {
    const wrap = wrapRef.current
    const btn = (tab === 'reports' ? reportsRef : assetsRef).current
    if (!wrap || !btn) return
    const wb = wrap.getBoundingClientRect()
    const bb = btn.getBoundingClientRect()
    setInd({ left: bb.left - wb.left, width: bb.width })
  }, [tab])

  useEffect(() => {
    update()
    window.addEventListener('resize', update)
    let ro
    if (typeof ResizeObserver !== 'undefined' && wrapRef.current) {
      ro = new ResizeObserver(update)
      ro.observe(wrapRef.current)
    }
    return () => {
      window.removeEventListener('resize', update)
      if (ro) ro.disconnect()
    }
  }, [update])

  return (
    <div className="arx-tabs" role="tablist" ref={wrapRef}>
      <div className="arx-tab-ind" style={{ left: ind.left, width: ind.width, opacity: ind.width ? 1 : 0 }} />
      <button type="button" role="tab" ref={assetsRef} className={`arx-tab${tab === 'assets' ? ' on' : ''}`} onClick={() => setTab('assets')}><ListChecks size={14} /> Assets</button>
      <button type="button" role="tab" ref={reportsRef} className={`arx-tab${tab === 'reports' ? ' on' : ''}`} onClick={() => setTab('reports')}><BarChart3 size={14} /> Reports &amp; Analytics</button>
    </div>
  )
}

/* ================= MAIN PAGE ================= */
export default function AssetRegister() {
  const [assets, setAssets] = useState([])
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [offline, setOffline] = useState(false)
  const [q, setQ] = useState('')
  const [fCat, setFCat] = useState('all')
  const [fStatus, setFStatus] = useState('all')
  const [fLoc, setFLoc] = useState('all')
  const [fCond, setFCond] = useState('all')
  const [sortKey, setSortKey] = useState('code')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [tab, setTab] = useState('assets')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editAsset, setEditAsset] = useState(null)
  const [action, setAction] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [catView, setCatView] = useState('count')
  const [toast, setToast] = useState(null)
  const [lastSync, setLastSync] = useState('')

  const pushToast = useCallback((msg, type) => setToast({ msg, type, id: Date.now() }), [])

  const loadAssets = useCallback((silent) => {
    if (silent) setRefreshing(true)
    return api('/assets')
      .then(list => {
        setAssets(Array.isArray(list) ? list : list?.data || [])
        setOffline(false)
        setLastSync(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))
      })
      .catch(() => { setOffline(true); return null })
      .finally(() => { setLoading(false); setRefreshing(false) })
  }, [])

  useEffect(() => {
    loadAssets()
    api('/workers')
      .then(list => setWorkers(Array.isArray(list) ? list : list?.data || []))
      .catch(err => { console.error('Error:', err.message) })
  }, [loadAssets])

  useEffect(() => { setPage(1) }, [q, fCat, fStatus, fLoc, fCond, sortKey, sortDir, pageSize])

  const selected = assets.find(a => a.id === selectedId) || null

  /* ---- filtered + sorted list ---- */
  const filtered = useMemo(() => assets.filter(a => {
    if (fCat !== 'all' && a.category !== fCat) return false
    if (fStatus !== 'all' && String(a.status || 'available').toLowerCase() !== fStatus) return false
    if (fLoc !== 'all' && locOf(a) !== fLoc) return false
    if (fCond !== 'all' && a.condition !== fCond) return false
    if (q.trim()) {
      const s = q.trim().toLowerCase()
      return [a.code, a.name, a.brand, a.model, a.serial_no, a.assigned_to_name, a.sim_number, a.location, a.team_leader, a.owner_name]
        .some(v => (v || '').toLowerCase().includes(s))
    }
    return true
  }), [assets, q, fCat, fStatus, fLoc, fCond])

  const CMP = {
    code: (a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }),
    name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
    category: (a, b) => String(a.category || '').localeCompare(String(b.category || '')),
    location: (a, b) => locOf(a).localeCompare(locOf(b)),
    qty: (a, b) => uq(a) - uq(b),
    value: (a, b) => aval(a) - aval(b),
    status: (a, b) => (STATUS_META[a.status]?.order ?? 9) - (STATUS_META[b.status]?.order ?? 9),
    warranty: (a, b) => (daysUntil(a.warranty_expiry) ?? 1e9) - (daysUntil(b.warranty_expiry) ?? 1e9),
  }

  const sorted = useMemo(() => {
    const s = [...filtered]
    s.sort(CMP[sortKey] || CMP.code)
    return sortDir === 'desc' ? s.reverse() : s
  }, [filtered, sortKey, sortDir])

  /* ---- group filtered rows by category (total = sum of Qty) ---- */
  const groups = useMemo(() => {
    const map = new Map()
    sorted.forEach(a => {
      let g = map.get(a.category)
      if (!g) { g = { category: a.category, records: [] }; map.set(a.category, g) }
      g.records.push(a)
    })
    return [...map.values()].map(g => {
      const color = catColor(g.category)
      return {
        category: g.category, records: g.records, color,
        recs: g.records.length,
        units: g.records.reduce((s, a) => s + uq(a), 0),
        value: g.records.reduce((s, a) => s + aval(a), 0),
      }
    })
  }, [sorted])

  /* ---- paginate whole groups so a category never splits across pages ---- */
  const groupPages = useMemo(() => {
    const pages = []
    let cur = [], curCount = 0
    groups.forEach(g => {
      if (cur.length > 0 && curCount + g.records.length > pageSize) {
        pages.push(cur); cur = []; curCount = 0
      }
      cur.push(g); curCount += g.records.length
    })
    if (cur.length > 0) pages.push(cur)
    return pages.length === 0 ? [[]] : pages
  }, [groups, pageSize])

  const pageCount = groupPages.length
  const pageSafe = Math.min(page, pageCount)
  const pageGroups = groupPages[pageSafe - 1] || []

  /* ---- summary (filtered) ---- */
  const summary = useMemo(() => {
    const s = { total: sorted.length, assigned: 0, available: 0, repair: 0, not_working: 0, lost: 0, scrapped: 0, value: 0, units: 0, valuedCount: 0 }
    CATEGORIES.forEach(c => { s[c] = 0 })
    CONDITIONS.forEach(c => { s['cond_' + c] = 0 })
    sorted.forEach(a => {
      const st = String(a.status || 'available').toLowerCase()
      const qt = uq(a)
      if (s[st] !== undefined) s[st]++
      if (st !== 'scrapped' && st !== 'lost') {
        s.value += Number(a.purchase_price || 0) * qt
        s.units += qt
        if (Number(a.purchase_price || 0) > 0) s.valuedCount++
      }
      if (s[a.category] !== undefined) s[a.category] += qt
      if (a.condition && s['cond_' + a.condition] !== undefined) s['cond_' + a.condition] += qt
    })
    return s
  }, [sorted])

  const warrantySoon = useMemo(() => assets.filter(a => { const d = daysUntil(a.warranty_expiry); return d !== null && d > 0 && d <= 30 }), [assets])
  const longRepair = useMemo(() => assets.filter(a => a.status === 'repair' && daysSince(a.repair_date) > 30), [assets])

  const allLocations = useMemo(() => {
    const set = new Set(LOCATIONS)
    assets.forEach(a => { const l = locOf(a); if (l) set.add(l) })
    return [...set].sort()
  }, [assets])

  const locCounts = useMemo(() => {
    const m = {}
    sorted.forEach(a => { const l = locOf(a); if (l) m[l] = (m[l] || 0) + uq(a) })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [sorted])

  const catStats = useMemo(() => groups
    .map(g => ({ c: g.category, color: g.color, recs: g.recs, units: g.units, value: g.value }))
    .filter(x => x.recs > 0)
    .sort((a, b) => b.units - a.units), [groups])

  const condStats = useMemo(() => CONDITIONS.map(c => ({
    label: c, value: summary['cond_' + c] || 0, color: CONDITION_COLORS[c],
  })).filter(x => x.value > 0), [summary])

  const timelineStats = useMemo(() => {
    const m = {}
    sorted.forEach(a => { const y = a.purchase_date ? String(a.purchase_date).slice(0, 4) : 'Undated'; m[y] = (m[y] || 0) + uq(a) })
    return Object.entries(m)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([label, value]) => ({ label, value, color: MINT }))
  }, [sorted])

  const topValue = useMemo(() => [...sorted]
    .filter(a => a.status !== 'scrapped' && a.status !== 'lost' && Number(a.purchase_price || 0) > 0)
    .sort((a, b) => aval(b) - aval(a)).slice(0, 6), [sorted])

  const warrantyStats = useMemo(() => {
    let active = 0, expiring = 0, expired = 0, none = 0
    sorted.forEach(a => {
      const d = daysUntil(a.warranty_expiry)
      if (d === null) none++
      else if (d <= 0) expired++
      else if (d <= 30) expiring++
      else active++
    })
    return { active, expiring, expired, none }
  }, [sorted])

  const catBars = useMemo(() => catStats.map(x => (catView === 'value'
    ? { label: x.c, value: x.value, sub: `${x.units} units · ${x.recs} records`, color: x.color }
    : { label: x.c, value: x.units, sub: `${x.recs} records · ${money(x.value)}`, color: x.color })), [catStats, catView])

  const statusData = useMemo(() => Object.keys(STATUS_META).map(k => ({
    label: STATUS_META[k].label, value: summary[k] || 0, color: STATUS_META[k].color,
  })), [summary])

  const locBars = useMemo(() => locCounts.slice(0, 10).map(([l, n]) => ({ label: l, value: n, color: '#0d9488' })), [locCounts])

  const snapshotBars = useMemo(() => catStats.slice(0, 8).map(x => ({
    label: x.c, value: x.units, sub: `${x.recs} records · ${money(x.value)}`, color: x.color,
  })), [catStats])

  const onSort = (k, dir) => { setSortKey(k); setSortDir(dir) }

  const activeChips = useMemo(() => {
    const chips = []
    if (q.trim()) chips.push({ key: 'q', icon: Search, label: `"${q.trim()}"`, clear: () => setQ('') })
    if (fCat !== 'all') chips.push({ key: 'cat', icon: catIcon(fCat), label: fCat, clear: () => setFCat('all') })
    if (fStatus !== 'all') chips.push({ key: 'st', icon: STATUS_META[fStatus]?.Icon || Package, label: STATUS_META[fStatus]?.label || fStatus, clear: () => setFStatus('all') })
    if (fLoc !== 'all') chips.push({ key: 'loc', icon: MapPin, label: fLoc, clear: () => setFLoc('all') })
    if (fCond !== 'all') chips.push({ key: 'cond', icon: ShieldCheck, label: fCond, clear: () => setFCond('all') })
    return chips
  }, [q, fCat, fStatus, fLoc, fCond])

  const clearAll = () => { setQ(''); setFCat('all'); setFStatus('all'); setFLoc('all'); setFCond('all') }

  /* ---- helpers to update an asset (API + local fallback) ---- */
  function nextCode() {
    const max = assets.reduce((m, a) => {
      const n = parseInt(String(a.code || '').replace(/\D/g, ''), 10)
      return isNaN(n) ? m : Math.max(m, n)
    }, 0)
    return `AST-${String(max + 1).padStart(3, '0')}`
  }

  function addHistory(a, text) {
    return [...(a.history || []), { date: new Date().toISOString().slice(0, 10), text }]
  }

  function saveNew(form) {
    const asset = { ...form, id: `local-${Date.now()}`, code: nextCode(), status: form.status || 'available',
      history: [{ date: new Date().toISOString().slice(0, 10), text: 'Asset registered' }] }
    api('/assets', { method: 'POST', body: JSON.stringify(asset) })
      .then(saved => { setAssets(p => [...p, saved?.id ? saved : asset]); pushToast(`Asset ${asset.code} added`, 'ok') })
      .catch(() => { setAssets(p => [...p, asset]); pushToast('Saved locally — backend unreachable', 'info') })
    setShowAdd(false)
  }

  function saveEdit(form) {
    updateAsset(editAsset.id, form, 'Details updated')
    setEditAsset(null)
    pushToast('Asset details updated', 'ok')
  }

  function updateAsset(id, changes, historyText) {
    const current = assets.find(a => a.id === id)
    const newHistory = historyText && current ? addHistory(current, historyText) : current?.history || []
    setAssets(p => p.map(a => a.id === id
      ? { ...a, ...changes, history: newHistory }
      : a))
    api(`/assets/${id}`, { method: 'PUT', body: JSON.stringify({ ...changes, history: newHistory }) }).catch(err => console.warn('Save failed (offline?):', err.message))
  }

  function doAction(changes, historyText) {
    updateAsset(selected.id, changes, historyText)
    setAction(null)
    pushToast(historyText.split(' — ')[0], 'ok')
  }

  /* ---- report export ---- */
  function exportReport() {
    const rows = []
    const add = (...r) => rows.push(r)
    add(['ASSET REGISTER — ANALYSIS REPORT'])
    add(['Generated', new Date().toLocaleString('en-IN')])
    add([])
    add(['OVERVIEW'])
    add(['Metric', 'Value'])
    add(['Total records', summary.total])
    add(['Total units (active)', summary.units])
    add(['Active value', money(summary.value)])
    add(['Warranty expiring within 30 days', warrantySoon.length])
    add(['Assets in repair 30+ days', longRepair.length])
    add([])
    add(['STATUS BREAKDOWN'])
    add(['Status', 'Records'])
    Object.keys(STATUS_META).forEach(k => add([STATUS_META[k].label, summary[k] || 0]))
    add([])
    add(['CATEGORY BREAKDOWN'])
    add(['Category', 'Records', 'Units', 'Value'])
    catStats.forEach(x => add([x.c, x.recs, x.units, money(x.value)]))
    add([])
    add(['LOCATION BREAKDOWN'])
    add(['Location', 'Units'])
    locCounts.forEach(([l, n]) => add([l, n]))
    add([])
    add(['CONDITION BREAKDOWN'])
    add(['Condition', 'Units'])
    CONDITIONS.forEach(c => { if (summary['cond_' + c]) add([c, summary['cond_' + c]]) })
    add([])
    add(['WARRANTY EXPIRING WITHIN 30 DAYS'])
    add(['Code', 'Name', 'Warranty Expiry', 'Days Left'])
    warrantySoon.forEach(a => add([a.code, a.name, a.warranty_expiry || '', daysUntil(a.warranty_expiry)]))
    add([])
    add(['TOP HIGH-VALUE ASSETS (ACTIVE)'])
    add(['Code', 'Name', 'Category', 'Units', 'Value'])
    topValue.forEach(a => add([a.code, a.name, a.category, uq(a), money(aval(a))]))
    downloadCSV(csvEscape(rows), `asset-register-report-${new Date().toISOString().slice(0, 10)}.csv`)
    pushToast('Analysis report exported', 'ok')
  }
  return (
    <div className="sa-page arx-root" style={{ maxWidth: 1380, margin: '0 auto' }}>
      <style>{`
        .arx-root {
          --arx-ink: #101f19; --arx-ink2: #33453e; --arx-muted: #6c807a; --arx-soft: #93a6a0;
          --arx-mint: #2A6B45; --arx-mint2: #1E4D3D; --arx-mint-soft: #EAF7EE;
          --arx-line: #e2ebe7; --arx-card: #ffffff; --arx-track: #f0f5f3;
          font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
          color: var(--arx-ink);
        }
        .arx-root * { box-sizing: border-box; }
        .arx-muted { color: var(--arx-muted); font-size: 13px; line-height: 1.55; }
        .arx-padt { padding: 18px 4px; }
        @keyframes arxFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes arxPop { from { opacity: 0; transform: translateY(18px) scale(.965); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes arxRowIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes arxShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes arxSpin { to { transform: rotate(360deg); } }
        @keyframes arxToastIn { from { opacity: 0; transform: translate(-50%, 16px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes arxPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(42,107,69,.35); } 50% { box-shadow: 0 0 0 6px rgba(42,107,69,0); } }

        /* ---------- toolbar ---------- */
        .arx-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; animation: arxFadeUp .5s ease both; }
        .arx-tb { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .arx-tb-ico { width: 40px; height: 40px; border-radius: 12px; background: var(--arx-mint-soft); color: var(--arx-mint); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .arx-tb-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .arx-tb-sub { font-size: 12.5px; color: var(--arx-muted); font-weight: 600; line-height: 1.45; }
        .arx-tb-sync { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--arx-mint); font-weight: 700; }
        .arx-hbtns { display: flex; gap: 9px; flex-wrap: wrap; }

        /* ---------- buttons ---------- */
        .arx-btn { border: none; border-radius: 12px; padding: 10px 17px; font-size: 13px; font-weight: 650; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 7px; transition: transform .18s ease, box-shadow .18s ease, background .18s ease; color: var(--arx-ink); background: #f1f5f3; }
        .arx-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 18px -8px rgba(16,31,25,.28); }
        .arx-btn:active { transform: translateY(0) scale(.98); }
        .arx-btn:disabled { opacity: .38; cursor: not-allowed; transform: none; box-shadow: none; }
        .arx-btn svg { flex-shrink: 0; }
        .arx-btn-primary { background: linear-gradient(135deg, #1c2b25, #0f1b16); color: #fff; }
        .arx-btn-mint { background: linear-gradient(135deg, #37a06b, var(--arx-mint)); color: #fff; }
        .arx-btn-teal { background: linear-gradient(135deg, #14a08c, #0d8f8c); color: #fff; }
        .arx-btn-amber { background: linear-gradient(135deg, #f5a623, #dd8a06); color: #fff; }
        .arx-btn-red { background: #fef2f2; color: #dc2626; }
        .arx-btn-red:hover { background: #fee2e2; }
        .arx-btn-ghost { background: #f1f5f3; color: #33453e; }
        .arx-btn-ghost:hover { background: #e6eeeb; }
        .arx-spin { animation: arxSpin .8s linear infinite; }

        /* ---------- banner ---------- */
        .arx-banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: linear-gradient(135deg, #fef8ec, #fdf3dd); border: 1px solid #f3ddb0; border-radius: 14px; padding: 11px 18px; margin-bottom: 16px; font-size: 13px; color: #7c5a12; font-weight: 550; animation: arxFadeUp .5s ease both; }
        .arx-banner code { background: #fff; padding: 2px 9px; border-radius: 7px; font-size: 11.5px; border: 1px solid #f0e2c4; }

        /* ---------- KPI cards ---------- */
        .arx-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(178px, 1fr)); gap: 13px; margin-bottom: 18px; }
        .arx-kpi { text-align: left; border: 1px solid var(--arx-line); background: var(--arx-card); border-radius: 16px; padding: 16px 18px 14px; cursor: default; position: relative; overflow: hidden; animation: arxFadeUp .55s ease both; transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease; font-family: inherit; }
        .arx-kpi::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--tint, var(--arx-mint)); opacity: .9; }
        .arx-kpi::after { content: ''; position: absolute; inset: 0; background: radial-gradient(120% 90% at 100% 0%, var(--tint, var(--arx-mint)) 0%, transparent 55%); opacity: .07; pointer-events: none; }
        .arx-kpi.click { cursor: pointer; }
        .arx-kpi.click:hover { transform: translateY(-3px); box-shadow: 0 14px 30px -14px rgba(16,31,25,.35); }
        .arx-kpi.on { border-color: var(--fg, var(--arx-mint)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg, var(--arx-mint)) 18%, transparent); }
        .arx-kpi-ico { width: 38px; height: 38px; border-radius: 11px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--tint, var(--arx-mint)) 14%, #fff); color: var(--fg, var(--arx-mint)); margin-bottom: 10px; }
        .arx-kpi-label { display: block; font-size: 10.5px; font-weight: 750; text-transform: uppercase; letter-spacing: .8px; color: var(--arx-muted); }
        .arx-kpi-val { display: block; font-size: 26px; font-weight: 800; letter-spacing: -.6px; margin-top: 2px; color: var(--arx-ink); font-variant-numeric: tabular-nums; }
        .arx-kpi-sub { display: block; font-size: 11px; color: var(--arx-soft); font-weight: 550; margin-top: 3px; }

        /* ---------- tabs ---------- */
        .arx-tabs { position: relative; display: inline-flex; background: #eef3f1; border-radius: 13px; padding: 4px; margin-bottom: 18px; animation: arxFadeUp .5s ease both; }
        .arx-tab { position: relative; z-index: 1; border: none; background: transparent; padding: 9px 22px; font-size: 13px; font-weight: 700; color: var(--arx-muted); cursor: pointer; border-radius: 10px; display: inline-flex; align-items: center; gap: 7px; font-family: inherit; transition: color .2s ease; }
        .arx-tab.on { color: #fff; }
        .arx-tab-ind { position: absolute; z-index: 0; top: 4px; bottom: 4px; left: 4px; width: 0; opacity: 0; background: linear-gradient(135deg, var(--arx-mint), var(--arx-mint2)); border-radius: 10px; box-shadow: 0 6px 16px -6px rgba(42,107,69,.6); transition: left .32s cubic-bezier(.22,1,.36,1), width .32s cubic-bezier(.22,1,.36,1), opacity .2s ease; }

        /* ---------- status pills ---------- */
        .arx-pills { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 14px; scrollbar-width: thin; animation: arxFadeUp .5s ease both; }
        .arx-pill { border: 1px solid var(--arx-line); background: #fff; border-radius: 99px; padding: 7px 14px; font-size: 12.5px; font-weight: 650; color: var(--arx-ink2); cursor: pointer; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; font-family: inherit; transition: all .2s ease; }
        .arx-pill:hover { border-color: #c6d6cf; transform: translateY(-1px); }
        .arx-pill .n { background: #eef3f1; border-radius: 99px; padding: 1px 8px; font-size: 11px; font-weight: 750; color: var(--arx-muted); font-variant-numeric: tabular-nums; }
        .arx-pill.on { background: linear-gradient(135deg, #233a2f, #14231c); border-color: transparent; color: #fff; }
        .arx-pill.on .n { background: rgba(255,255,255,.18); color: #fff; }
        .arx-pill.zero { opacity: .45; }
        .arx-pill.zero:hover { transform: none; }

        /* ---------- name hover spec popover ---------- */
        .arx-spec-wrap { position: relative; display: inline-block; max-width: 100%; }
        .arx-spec-trigger { cursor: default; border-bottom: 1px dashed #c2d4cb; }
        .arx-spec-pop { position: absolute; z-index: 50; top: calc(100% + 8px); left: 0; min-width: 220px; max-width: 300px; background: #ffffff; border: 1.5px solid #d1d5db; border-radius: 12px; box-shadow: 0 8px 24px -4px rgba(16,31,25,.28), 0 2px 8px rgba(16,31,25,.12); padding: 10px 12px; opacity: 0; visibility: hidden; transform: translateY(-4px); transition: opacity .18s ease, transform .18s ease, visibility .18s; pointer-events: none; }
        .arx-spec-wrap:hover .arx-spec-pop { opacity: 1; visibility: visible; transform: translateY(0); }
        .arx-spec-title { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: var(--arx-mint); padding: 2px 2px 6px; border-bottom: 1px solid var(--arx-line); margin-bottom: 5px; }
        .arx-spec-row { display: flex; gap: 10px; align-items: baseline; padding: 4px 2px; }
        .arx-spec-row + .arx-spec-row { border-top: 1px dashed #edf3f0; }
        .arx-spec-k { flex: 0 0 108px; font-size: 11px; font-weight: 700; color: var(--arx-muted); }
        .arx-spec-v { font-size: 12px; color: var(--arx-ink); word-break: break-word; }
        .arx-spec-none { display: block; font-size: 11.5px; color: var(--arx-soft); padding: 4px 2px; }

        /* ---------- filter bar ---------- */
        .arx-fwrap { margin-bottom: 16px; animation: arxFadeUp .5s ease both; }
        .arx-fbar { display: flex; gap: 9px; flex-wrap: wrap; }
        .arx-search { position: relative; flex: 1 1 240px; min-width: 0; }
        .arx-search svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: var(--arx-soft); pointer-events: none; }
        .arx-search input { width: 100%; border: 1px solid var(--arx-line); border-radius: 12px; padding: 10px 14px 10px 38px; font-size: 13px; font-family: inherit; color: var(--arx-ink); background: #fff; outline: none; transition: border-color .2s, box-shadow .2s; }
        .arx-search input:focus { border-color: var(--arx-mint); box-shadow: 0 0 0 4px rgba(42,107,69,.12); }
        .arx-fbar select { border: 1px solid var(--arx-line); border-radius: 12px; padding: 10px 12px; font-size: 12.5px; font-family: inherit; color: var(--arx-ink2); background: #fff; outline: none; cursor: pointer; transition: border-color .2s, box-shadow .2s; font-weight: 600; }
        .arx-fbar select:focus { border-color: var(--arx-mint); box-shadow: 0 0 0 4px rgba(42,107,69,.12); }
        .arx-fmore { display: none; }
        .arx-fextra { display: contents; }
        .arx-chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 11px; }
        .arx-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--arx-mint-soft); color: var(--arx-mint); border: 1px solid #cfe7d8; border-radius: 99px; padding: 4px 7px 4px 11px; font-size: 12px; font-weight: 650; font-family: inherit; cursor: pointer; animation: arxPop .25s ease both; }
        .arx-chip button { border: none; background: transparent; color: inherit; cursor: pointer; display: flex; padding: 2px; border-radius: 99px; transition: background .15s; }
        .arx-chip button:hover { background: rgba(42,107,69,.14); }
        .arx-clear { border: none; background: transparent; color: var(--arx-muted); font-size: 12px; font-weight: 650; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 5px; }
        .arx-clear:hover { color: #dc2626; }

        /* ---------- cards & table ---------- */
        .arx-card { background: var(--arx-card); border: 1px solid var(--arx-line); border-radius: 18px; padding: 20px; box-shadow: 0 1px 2px rgba(16,31,25,.03), 0 8px 24px -14px rgba(16,31,25,.08); animation: arxFadeUp .55s ease both; }
        .arx-card-title { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; color: var(--arx-ink2); text-transform: uppercase; letter-spacing: 1px; margin: 0 0 14px; }
        .arx-card-title svg { color: var(--arx-mint); }
        .arx-twrap { overflow: auto; border-radius: 13px; border: 1px solid var(--arx-line); max-height: 620px; scrollbar-width: thin; }
        .arx-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .arx-table thead th { position: sticky; top: 0; z-index: 2; background: #f6faf8; text-align: left; padding: 0; font-size: 10.5px; font-weight: 800; color: var(--arx-muted); text-transform: uppercase; letter-spacing: .7px; white-space: nowrap; border-bottom: 1px solid var(--arx-line); }
        .arx-thb { border: none; background: transparent; font: inherit; color: inherit; text-transform: inherit; letter-spacing: inherit; padding: 12px 16px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; width: 100%; transition: color .15s; }
        .arx-thb:hover { color: var(--arx-mint); }
        .arx-thb.on { color: var(--arx-mint); }
        .arx-table td { padding: 12px 16px; border-bottom: 1px solid #f0f5f3; vertical-align: middle; color: var(--arx-ink2); white-space: nowrap; }
        .arx-table tbody tr { cursor: pointer; transition: background .15s ease; animation: arxRowIn .3s ease both; }
        .arx-table tbody tr:hover { background: #f4faf7; }
        .arx-table tbody tr:hover td:first-child { box-shadow: inset 3px 0 0 0 var(--arx-mint); }
        .arx-table tbody tr:last-child td { border-bottom: none; }
        .arx-table tbody tr.dim { opacity: .45; }
        .arx-code { font-weight: 750; color: #52655e; font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; font-size: 11.5px; letter-spacing: .2px; }
        .arx-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; padding: 4px 11px; border-radius: 99px; white-space: nowrap; letter-spacing: .2px; }
        .arx-qty { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; background: #eef3f1; color: #33453e; border-radius: 8px; padding: 3px 8px; font-size: 11.5px; font-weight: 750; font-variant-numeric: tabular-nums; }
        .arx-tcat { display: inline-flex; align-items: center; gap: 7px; }
        .arx-root .ci { width: 26px; height: 26px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }

        /* ---------- category group headers ---------- */
        .arx-table tbody tr.arx-ghead { cursor: pointer; animation: none; }
        .arx-table tbody tr.arx-ghead:hover td:first-child { box-shadow: none; }
        .arx-ghead td { padding: 0; }
        .arx-ghead-inner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 16px; background: color-mix(in srgb, var(--gcol, var(--arx-mint)) 9%, #f9fcfb); border-bottom: 1px solid var(--arx-line); border-top: 1px solid color-mix(in srgb, var(--gcol, var(--arx-mint)) 45%, transparent); transition: background .15s ease; }
        .arx-ghead:hover .arx-ghead-inner { background: color-mix(in srgb, var(--gcol, var(--arx-mint)) 15%, #fff); }
        .arx-ghead-name { display: inline-flex; align-items: center; gap: 8px; font-weight: 800; font-size: 12.5px; color: var(--arx-ink); letter-spacing: .3px; }
        .arx-ghead-tot { display: inline-flex; align-items: baseline; gap: 8px; }
        .arx-ghead-totval { font-size: 13px; font-weight: 800; color: var(--gcol, var(--arx-mint)); font-variant-numeric: tabular-nums; }
        .arx-ghead-totsub { font-size: 11px; font-weight: 650; color: var(--arx-muted); }
        .arx-mgroup { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 800; color: var(--arx-ink); padding: 6px 2px 2px; margin-top: 8px; border-top: 2px solid color-mix(in srgb, var(--mcol, var(--arx-mint)) 55%, transparent); }
        .arx-mgroup b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .arx-mgroup-tot { font-size: 11px; font-weight: 700; color: var(--arx-muted); white-space: nowrap; }
        .arx-mgroup-tot strong { color: var(--mcol, var(--arx-mint)); font-variant-numeric: tabular-nums; }

        /* ---------- totals bar ---------- */
        .arx-totals-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px; background: #f6faf8; border-top: 1px solid var(--arx-line); font-size: 12px; }
        .arx-totals-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px; border: 1px solid; background: #fff; font-weight: 600; }
        .arx-totals-chip .ci { width: 22px; height: 22px; border-radius: 6px; }
        .arx-totals-cat { color: var(--arx-muted); font-size: 11.5px; }
        .arx-totals-qty { font-weight: 800; font-variant-numeric: tabular-nums; }
        .arx-totals-grand { margin-left: auto; font-size: 12px; color: var(--arx-ink2); font-weight: 600; }

        /* ---------- mobile cards ---------- */
        .arx-mcards { display: none; grid-template-columns: 1fr; gap: 11px; }
        .arx-mcard { position: relative; text-align: left; border: 1px solid var(--arx-line); background: #fff; border-radius: 15px; padding: 14px 16px; cursor: pointer; font-family: inherit; transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; animation: arxFadeUp .4s ease both; }
        .arx-mcard:hover { transform: translateY(-2px); box-shadow: 0 12px 26px -14px rgba(16,31,25,.3); border-color: #cfe0d8; }
        .arx-mcard-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
        .arx-mcard-name { display: flex; align-items: center; gap: 9px; font-size: 14.5px; font-weight: 750; color: var(--arx-ink); }
        .arx-mcard-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 9px; font-size: 11.5px; color: var(--arx-muted); font-weight: 600; }
        .arx-mcard-meta span { display: inline-flex; align-items: center; gap: 5px; }
        .arx-mcard-meta svg { color: var(--arx-soft); }
        .arx-mchev { position: absolute; right: 14px; bottom: 14px; color: var(--arx-soft); }

        /* ---------- pager ---------- */
        .arx-pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 2px 2px; }
        .arx-pager-info { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--arx-muted); }
        .arx-pager-info select { border: 1px solid var(--arx-line); border-radius: 9px; padding: 5px 8px; font-size: 11.5px; font-family: inherit; color: var(--arx-ink2); background: #fff; cursor: pointer; font-weight: 650; }
        .arx-pager-btns { display: flex; align-items: center; gap: 5px; }
        .arx-pager-btns button { min-width: 31px; height: 31px; padding: 0 9px; border-radius: 9px; border: 1px solid var(--arx-line); background: #fff; color: var(--arx-ink2); font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-family: inherit; transition: all .15s ease; }
        .arx-pager-btns button:hover:not(:disabled) { border-color: var(--arx-mint); color: var(--arx-mint); }
        .arx-pager-btns button.cur { background: linear-gradient(135deg, var(--arx-mint), var(--arx-mint2)); border-color: transparent; color: #fff; }
        .arx-pager-btns button:disabled { opacity: .35; cursor: not-allowed; }
        .arx-pager-ell { color: var(--arx-soft); font-size: 12px; }

        /* ---------- bars & donut ---------- */
        .arx-bars { display: flex; flex-direction: column; gap: 11px; }
        .arx-bar-row { display: flex; align-items: center; gap: 12px; animation: arxFadeUp .45s ease both; }
        .arx-bar-label { width: 118px; font-size: 12px; font-weight: 650; color: var(--arx-ink2); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
        .arx-bar-mid { flex: 1; min-width: 0; }
        .arx-bar-track { height: 20px; background: var(--arx-track); border-radius: 99px; overflow: hidden; }
        .arx-bar-fill { height: 100%; border-radius: 99px; transition: width .8s cubic-bezier(.22,1,.36,1); opacity: .92; }
        .arx-bar-row:hover .arx-bar-fill { opacity: 1; filter: saturate(1.15); }
        .arx-bar-sub { display: block; font-size: 10.5px; color: var(--arx-soft); font-weight: 600; margin-top: 3px; }
        .arx-bar-val { width: 76px; font-size: 12.5px; font-weight: 800; color: var(--arx-ink); text-align: right; font-variant-numeric: tabular-nums; flex-shrink: 0; }
        .arx-donut-wrap { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
        .arx-donut-box { position: relative; width: 150px; height: 150px; flex-shrink: 0; }
        .arx-donut-svg { width: 100%; height: 100%; }
        .arx-seg { cursor: pointer; transition: stroke-dasharray .9s cubic-bezier(.22,1,.36,1), stroke-width .2s ease; }
        .arx-dcenter { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none; padding: 0 22px; }
        .arx-dcenter strong { font-size: 26px; font-weight: 800; letter-spacing: -.5px; color: var(--arx-ink); line-height: 1.05; font-variant-numeric: tabular-nums; }
        .arx-dcenter span { font-size: 10.5px; font-weight: 700; color: var(--arx-muted); text-transform: uppercase; letter-spacing: .6px; margin-top: 3px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .arx-dcenter em { font-style: normal; font-size: 11px; color: var(--arx-mint); font-weight: 750; margin-top: 2px; }
        .arx-dlegend { display: flex; flex-direction: column; gap: 7px; flex: 1; min-width: 150px; }
        .arx-dleg-item { display: flex; align-items: center; gap: 9px; font-size: 12.5px; color: var(--arx-ink2); font-weight: 600; background: transparent; border: 1px solid transparent; border-radius: 9px; padding: 5px 10px; cursor: default; font-family: inherit; transition: all .15s ease; text-align: left; }
        .arx-dleg-item.hot { background: #f3f8f6; border-color: var(--arx-line); transform: translateX(3px); }
        .arx-dleg-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .arx-dleg-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .arx-dleg-val { font-weight: 800; color: var(--arx-ink); font-variant-numeric: tabular-nums; }

        /* ---------- kv grid / timeline / actions ---------- */
        .arx-kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; margin: 6px 0 16px; }
        .arx-kv { display: flex; justify-content: space-between; gap: 12px; padding: 9px 2px; border-bottom: 1px dashed #e8f0ec; }
        .arx-kv-k { font-size: 10.5px; font-weight: 750; color: var(--arx-muted); text-transform: uppercase; letter-spacing: .5px; flex-shrink: 0; padding-top: 2px; }
        .arx-kv-v { font-size: 13px; color: var(--arx-ink); font-weight: 600; text-align: right; min-width: 0; word-break: break-word; }
        .arx-kv-v code { font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; font-size: 12px; background: #f2f7f5; padding: 2px 8px; border-radius: 7px; }
        .arx-kv-note { font-style: normal; color: var(--arx-soft); font-size: 11px; font-weight: 550; }
        .arx-kv-cat { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
        .arx-cond { display: inline-block; padding: 3px 11px; border-radius: 99px; font-size: 11.5px; font-weight: 750; background: #f2f7f5; color: var(--arx-ink2); }
        .arx-cond[data-cond="New"] { background: #DCFCE7; color: #15803D; }
        .arx-cond[data-cond="Good"] { background: #CCFBF1; color: #0F766E; }
        .arx-cond[data-cond="Average"] { background: #FEF3C7; color: #B45309; }
        .arx-cond[data-cond="Damaged"] { background: #FEE2E2; color: #B91C1C; }
        .arx-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 20px; }
        .arx-sub-title { display: flex; align-items: center; gap: 7px; margin: 0 0 12px; font-size: 12px; font-weight: 800; color: var(--arx-ink2); text-transform: uppercase; letter-spacing: 1px; }
        .arx-sub-title svg { color: var(--arx-mint); }
        .arx-tl { display: flex; flex-direction: column; gap: 0; position: relative; }
        .arx-tl::before { content: ''; position: absolute; left: 4.5px; top: 8px; bottom: 8px; width: 2px; background: #e4ede9; border-radius: 99px; }
        .arx-tl-item { display: flex; gap: 12px; align-items: flex-start; padding: 7px 0; animation: arxFadeUp .4s ease both; }
        .arx-tl-dot { width: 11px; height: 11px; border-radius: 50%; background: #cfe0d8; border: 2.5px solid #fff; box-shadow: 0 0 0 2px #e4ede9; margin-top: 4px; flex-shrink: 0; z-index: 1; }
        .arx-tl-dot.hot { background: var(--arx-mint); animation: arxPulse 2.2s ease infinite; }
        .arx-tl-text { display: block; font-size: 13px; color: var(--arx-ink); font-weight: 600; }
        .arx-tl-date { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--arx-soft); margin-top: 2px; font-weight: 600; }

        /* ---------- modals ---------- */
        .arx-overlay { position: fixed; inset: 0; z-index: 2100; background: rgba(12,24,19,.55); backdrop-filter: blur(7px); display: flex; align-items: center; justify-content: center; padding: 18px; animation: arxFadeIn .22s ease; }
        @keyframes arxFadeIn { from { opacity: 0; } to { opacity: 1; } }
        .arx-modal { background: #fff; border-radius: 20px; width: 100%; max-width: 640px; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 34px 90px -18px rgba(12,24,19,.5); animation: arxPop .3s cubic-bezier(.22,1,.36,1); }
        .arx-modal-lg { max-width: 900px; }
        .arx-modal-md { max-width: 700px; }
        .arx-modal-sm { max-width: 430px; }
        .arx-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 19px 24px; border-bottom: 1px solid #eef4f2; }
        .arx-mhead-left { display: flex; align-items: center; gap: 13px; min-width: 0; }
        .arx-micon { width: 42px; height: 42px; border-radius: 13px; display: flex; align-items: center; justify-content: center; background: var(--arx-mint-soft); color: var(--arx-mint); flex-shrink: 0; }
        .arx-micon.amber { background: #FEF3C7; color: #B45309; }
        .arx-micon.teal { background: #CCFBF1; color: #0F766E; }
        .arx-modal-title { margin: 0; font-size: 16.5px; font-weight: 800; color: var(--arx-ink); letter-spacing: -.2px; }
        .arx-modal-sub { margin: 2px 0 0; display: flex; align-items: center; font-size: 12px; color: var(--arx-muted); font-weight: 600; }
        .arx-close { border: none; background: #f1f5f3; border-radius: 10px; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #52655e; flex-shrink: 0; transition: all .18s ease; }
        .arx-close:hover { background: #e6eeeb; color: var(--arx-ink); transform: rotate(90deg); }
        .arx-modal-body { overflow-y: auto; padding: 20px 24px; scrollbar-width: thin; }
        .arx-modal-foot { display: flex; justify-content: flex-end; gap: 9px; padding: 16px 24px; border-top: 1px solid #eef4f2; background: #fbfdfc; }
        .arx-inline-alert { display: flex; align-items: flex-start; gap: 9px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 11px; padding: 10px 14px; margin-bottom: 10px; font-size: 12.5px; color: #991b1b; font-weight: 550; line-height: 1.45; }
        .arx-inline-alert svg { flex-shrink: 0; margin-top: 1px; }
        .arx-inline-alert.ok { background: var(--arx-mint-soft); border-color: #cfe7d8; color: var(--arx-mint); }
        .arx-inline-alert.warn { background: #fffbeb; border-color: #fde68a; color: #92400e; }
        .arx-note { display: flex; gap: 8px; align-items: flex-start; background: #f6faf8; border: 1px solid var(--arx-line); color: var(--arx-muted); border-radius: 11px; padding: 10px 14px; font-size: 12px; line-height: 1.5; margin: 14px 0; }
        .arx-note svg { flex-shrink: 0; margin-top: 1px; color: var(--arx-mint); }
        .arx-note-line { display: block; font-size: 11.5px; margin-top: 4px; opacity: .8; }

        /* ---------- form ---------- */
        .arx-fsec { display: flex; align-items: center; gap: 8px; margin: 4px 0 13px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: var(--arx-mint); }
        .arx-fsec::after { content: ''; flex: 1; height: 1px; background: var(--arx-line); }
        .arx-fsec span { display: inline-flex; align-items: center; gap: 6px; }
        .arx-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
        .arx-field { min-width: 0; }
        .arx-fspan { grid-column: 1 / -1; }
        .arx-flabel { display: block; font-size: 10.5px; font-weight: 750; color: var(--arx-muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
        .arx-finput { position: relative; }
        .arx-finput input, .arx-finput select { width: 100%; border: 1px solid var(--arx-line); border-radius: 11px; padding: 10px 13px; font-size: 13px; font-family: inherit; color: var(--arx-ink); background: #fff; outline: none; transition: border-color .2s, box-shadow .2s; }
        .arx-finput input:focus, .arx-finput select:focus { border-color: var(--arx-mint); box-shadow: 0 0 0 4px rgba(42,107,69,.12); }
        .arx-fico { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--arx-soft); pointer-events: none; }
        .arx-finput.has-ico input, .arx-finput.has-ico select { padding-left: 36px; }

        /* ---------- dropzone ---------- */
        .arx-drop { display: flex; align-items: center; gap: 15px; border: 2px dashed #cfdfd7; border-radius: 15px; padding: 20px 22px; cursor: pointer; background: #f9fcfb; transition: all .2s ease; }
        .arx-drop:hover { border-color: var(--arx-mint); background: var(--arx-mint-soft); }
        .arx-drop.drag { border-color: var(--arx-mint); background: var(--arx-mint-soft); transform: scale(1.01); box-shadow: 0 10px 26px -12px rgba(42,107,69,.4); }
        .arx-drop-ico { color: var(--arx-mint); flex-shrink: 0; }
        .arx-drop-ico.ok { color: #16a34a; }
        .arx-drop strong { display: block; font-size: 14px; font-weight: 750; color: var(--arx-ink); }
        .arx-drop span { display: block; font-size: 12px; color: var(--arx-muted); margin-top: 2px; }
        .arx-preview-wrap { overflow: auto; border-radius: 13px; border: 1px solid var(--arx-line); max-height: 300px; margin-top: 12px; }
        .arx-preview-wrap .arx-table td, .arx-preview-wrap .arx-table th { padding: 9px 13px; }
        .arx-preview-wrap thead th { position: sticky; top: 0; background: #f6faf8; }
        .arx-th-check { width: 34px; text-align: center; }
        .arx-th-check input { cursor: pointer; accent-color: var(--arx-mint); }

        /* ---------- toast / skeleton ---------- */
        .arx-toast { position: fixed; bottom: 26px; left: 50%; z-index: 2400; display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-radius: 13px; box-shadow: 0 16px 40px -12px rgba(12,24,19,.45); color: #fff; font-size: 13px; font-weight: 650; animation: arxToastIn .3s cubic-bezier(.22,1,.36,1); background: linear-gradient(135deg, #1c2b25, #0f1b16); max-width: min(92vw, 480px); }
        .arx-toast-ok { background: linear-gradient(135deg, #259d5b, var(--arx-mint)); }
        .arx-toast-error { background: linear-gradient(135deg, #ef4444, #b91c1c); }
        .arx-toast-info { background: linear-gradient(135deg, #0ea5e9, #0369a1); }
        .arx-toast button { border: none; background: rgba(255,255,255,.16); color: #fff; cursor: pointer; display: flex; padding: 4px; border-radius: 7px; }
        .arx-toast button:hover { background: rgba(255,255,255,.3); }
        .arx-skel { background: linear-gradient(90deg, #eef3f1, #e2ebe7, #eef3f1); background-size: 200% 100%; border-radius: 12px; animation: arxShimmer 1.4s ease infinite; }

        /* ---------- reports ---------- */
        .arx-reports { display: flex; flex-direction: column; gap: 16px; }
        .arx-rrow { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .arx-rrow-3 { grid-template-columns: 1.2fr 1fr 1fr; }
        .arx-wcards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
        .arx-wcard { border: 1px solid var(--arx-line); border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; transition: transform .2s ease, box-shadow .2s ease; animation: arxFadeUp .5s ease both; }
        .arx-wcard:hover { transform: translateY(-2px); box-shadow: 0 12px 26px -14px rgba(16,31,25,.28); }
        .arx-wcard .wi { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .arx-wcard .wn { font-size: 22px; font-weight: 800; letter-spacing: -.5px; line-height: 1; font-variant-numeric: tabular-nums; }
        .arx-wcard .wl { font-size: 11px; font-weight: 700; color: var(--arx-muted); text-transform: uppercase; letter-spacing: .5px; margin-top: 3px; }
        .arx-seg-toggle { display: inline-flex; background: #eef3f1; border-radius: 10px; padding: 3px; gap: 2px; }
        .arx-seg-toggle button { border: none; background: transparent; padding: 6px 13px; font-size: 11.5px; font-weight: 700; color: var(--arx-muted); border-radius: 8px; cursor: pointer; font-family: inherit; transition: all .2s ease; display: inline-flex; align-items: center; gap: 5px; }
        .arx-seg-toggle button.on { background: #fff; color: var(--arx-mint); box-shadow: 0 2px 8px -2px rgba(16,31,25,.2); }
        .arx-top-list { display: flex; flex-direction: column; gap: 8px; }
        .arx-top-item { display: flex; align-items: center; gap: 12px; border: 1px solid var(--arx-line); border-radius: 13px; padding: 10px 14px; cursor: pointer; background: #fff; font-family: inherit; text-align: left; transition: all .18s ease; animation: arxFadeUp .45s ease both; width: 100%; }
        .arx-top-item:hover { border-color: var(--arx-mint); transform: translateX(4px); background: #f7fbf9; }
        .arx-top-rank { width: 26px; height: 26px; border-radius: 8px; background: #eef3f1; color: var(--arx-muted); font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .arx-top-item:nth-child(1) .arx-top-rank { background: linear-gradient(135deg, #fbbf24, #d97706); color: #fff; }
        .arx-top-name { flex: 1; min-width: 0; }
        .arx-top-name b { display: block; font-size: 13px; font-weight: 700; color: var(--arx-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .arx-top-name span { font-size: 11px; color: var(--arx-soft); font-weight: 600; }
        .arx-top-val { font-size: 13.5px; font-weight: 800; color: var(--arx-mint); font-variant-numeric: tabular-nums; flex-shrink: 0; }
        .arx-btm { display: grid; grid-template-columns: 1.25fr 1fr; gap: 16px; margin-top: 16px; }
        .arx-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 42px 20px; text-align: center; }
        .arx-empty svg { color: #c9dad3; }
        .arx-empty p { margin: 0; color: var(--arx-muted); font-size: 13px; font-weight: 600; max-width: 380px; line-height: 1.5; }

        /* ---------- responsive ---------- */
        @media (max-width: 1080px) {
          .arx-rrow-3 { grid-template-columns: 1fr 1fr; }
          .arx-btm { grid-template-columns: 1fr; }
        }
        @media (max-width: 880px) {
          .arx-table .col-loc, .arx-table .col-tl { display: none; }
        }
        @media (max-width: 720px) {
          .arx-root { font-size: 13px; }
          .arx-tb-ico { width: 34px; height: 34px; border-radius: 10px; }
          .arx-tb-sub { font-size: 11.5px; }
          .arx-hbtns { width: 100%; }
          .arx-hbtns .arx-btn { flex: 1; justify-content: center; }
          .arx-tabs { width: 100%; }
          .arx-tabs .arx-tab { flex: 1; justify-content: center; }
          .arx-kpis { grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .arx-kpi-val { font-size: 22px; }
          .arx-twrap { display: none; }
          .arx-mcards { display: grid; }
          .arx-fmore { display: inline-flex; }
          .arx-fextra { display: none; flex-wrap: wrap; gap: 9px; width: 100%; animation: arxFadeUp .3s ease both; }
          .arx-fextra.open { display: flex; }
          .arx-fextra select { flex: 1 1 130px; }
          .arx-rrow { grid-template-columns: 1fr; }
          .arx-kv-grid { grid-template-columns: 1fr; }
          .arx-donut-wrap { justify-content: center; }
          .arx-bar-label { width: 92px; font-size: 11px; }
        }
        @media (max-width: 430px) {
          .arx-kpis { grid-template-columns: repeat(2, 1fr); }
          .arx-wcards { grid-template-columns: repeat(2, 1fr); }
          .arx-form-grid { grid-template-columns: 1fr; }
          .arx-modal-body, .arx-modal-head, .arx-modal-foot { padding-left: 16px; padding-right: 16px; }
          .arx-hbtns .arx-btn span.lbl { display: none; }
          .arx-hbtns .arx-btn { padding: 11px 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .arx-root *, .arx-root *::before, .arx-root *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
        }
      `}</style>

      {/* toolbar */}
      <div className="arx-header">
        <div className="arx-tb">
          <span className="arx-tb-ico"><Package size={17} strokeWidth={2.1} /></span>
          <div className="arx-tb-copy">
            <span className="arx-tb-sub">Complete company asset record — assignment, repair &amp; warranty tracking</span>
            {lastSync && <span className="arx-tb-sync"><CheckCircle2 size={11} /> Synced at {lastSync}</span>}
          </div>
        </div>
        <div className="arx-hbtns">
          <button className="arx-btn arx-btn-ghost" onClick={() => loadAssets(true)} disabled={refreshing} title="Refresh data">
            <RefreshCw size={15} className={refreshing ? 'arx-spin' : ''} /><span className="lbl">Refresh</span>
          </button>
          <button className="arx-btn arx-btn-ghost" onClick={() => { exportAssets(sorted); pushToast(`${sorted.length} assets exported to CSV`, 'ok') }}>
            <Download size={15} /><span className="lbl">Export CSV</span>
          </button>
          <button className="arx-btn arx-btn-mint" onClick={() => setShowImport(true)}>
            <FileSpreadsheet size={15} /><span className="lbl">Import Excel</span>
          </button>
          <button className="arx-btn arx-btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={15} /><span className="lbl">Add Asset</span>
          </button>
        </div>
      </div>

      {offline && !loading && (
        <div className="arx-banner">
          <AlertTriangle size={16} style={{ color: '#b45309', flexShrink: 0 }} />
          Backend is not reachable — the page is running in local mode.
          <code>GET/POST /api/assets</code>
          <code>POST /api/assets/import</code>
        </div>
      )}

      {/* alerts */}
      {(warrantySoon.length > 0 || longRepair.length > 0) && !loading && (
        <div className="arx-banner" style={{ background: 'linear-gradient(135deg,#fef2f2,#fff5f5)', borderColor: '#fecaca', color: '#7f1d1d' }}>
          <AlertTriangle size={16} style={{ color: '#dc2626', flexShrink: 0 }} />
          {warrantySoon.length > 0 && <span><b>{warrantySoon.length}</b> warranty expiring within 30 days ({warrantySoon.slice(0, 5).map(a => a.code).join(', ')}{warrantySoon.length > 5 ? '…' : ''})</span>}
          {longRepair.length > 0 && <span><b>{longRepair.length}</b> in repair for 30+ days ({longRepair.slice(0, 5).map(a => a.code).join(', ')}{longRepair.length > 5 ? '…' : ''})</span>}
          <button className="arx-btn arx-btn-ghost" style={{ marginLeft: 'auto', padding: '7px 14px', fontSize: 12 }} onClick={() => setTab('reports')}>
            View Reports <ChevronRight size={13} />
          </button>
        </div>
      )}

      {/* KPI summary cards */}
      <div className="arx-kpis">
        <StatCard icon={Package} label="Total Records" value={summary.total}
          sub={`${summary.units.toLocaleString('en-IN')} units · ${catStats.length} categories`} tint="#eef2ff" fg="#4f46e5" delay={0} />
        {(() => {
          const laptop = catStats.find(x => x.c === 'Laptop')
          const top = catStats.filter(x => x.c !== 'Laptop').slice(0, 4)
          const cards = laptop ? [laptop, ...top] : catStats.slice(0, 5)
          return cards.map((x, i) => (
            <StatCard key={x.c} icon={catIcon(x.c)} label={x.c} value={x.units}
              sub={`${x.recs} records`} tint={x.color + '15'} fg={x.color} delay={(i + 1) * 60}
              active={fCat === x.c} onClick={() => setFCat(fCat === x.c ? 'all' : x.c)} />
          ))
        })()}
      </div>

      {/* tabs */}
      <TabsBar tab={tab} setTab={setTab} />

      {tab === 'assets' && (<>
        {/* status pills */}
        <div className="arx-pills">
          <button type="button" className={`arx-pill${fStatus === 'all' ? ' on' : ''}`} onClick={() => setFStatus('all')}>
            <Package size={13} /> All Records <span className="n">{summary.total}</span>
          </button>
          {Object.entries(STATUS_META).map(([k, m]) => {
            const count = summary[k] || 0
            return (
              <button type="button" key={k} className={`arx-pill${fStatus === k ? ' on' : ''}${count === 0 ? ' zero' : ''}`}
                onClick={() => setFStatus(fStatus === k ? 'all' : k)}>
                <m.Icon size={13} /> {m.label} <span className="n">{count}</span>
              </button>
            )
          })}
        </div>

        {/* filter bar */}
        <div className="arx-fwrap">
          <div className="arx-fbar">
            <div className="arx-search">
              <Search size={15} />
              <input placeholder="Search code, name, location, team leader, serial, SIM, worker…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <button type="button" className={`arx-btn arx-btn-ghost arx-fmore`} onClick={() => setShowFilters(s => !s)}>
              <SlidersHorizontal size={14} /> Filters{activeChips.length > 0 ? ` (${activeChips.length})` : ''}
              <ChevronDown size={13} style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
            </button>
            {(() => {
              const sortVal = `${sortKey}-${sortDir}`
              const sortOpts = [
                { v: 'code-asc', l: 'Code A→Z' }, { v: 'code-desc', l: 'Code Z→A' },
                { v: 'name-asc', l: 'Name A→Z' }, { v: 'name-desc', l: 'Name Z→A' },
                { v: 'value-desc', l: 'Highest value' }, { v: 'value-asc', l: 'Lowest value' },
                { v: 'qty-desc', l: 'Most units' }, { v: 'qty-asc', l: 'Fewest units' },
                { v: 'status-asc', l: 'Group by status' }, { v: 'warranty-asc', l: 'Warranty ending soon' },
                { v: 'location-asc', l: 'Location A→Z' }, { v: 'category-asc', l: 'Category A→Z' },
              ]
              return (
                <select value={sortVal} onChange={e => { const [k, d] = e.target.value.split('-'); onSort(k, d) }} aria-label="Sort assets">
                  {!sortOpts.some(o => o.v === sortVal) && <option value={sortVal} hidden>Current sort</option>}
                  {sortOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              )
            })()}
            <div className={`arx-fextra${showFilters ? ' open' : ''}`}>
              <select value={fCat} onChange={e => setFCat(e.target.value)} aria-label="Filter by category">
                <option value="all">All Categories</option>
                {catStats.map(x => <option key={x.c} value={x.c}>{x.c} ({x.recs})</option>)}
              </select>
              <select value={fLoc} onChange={e => setFLoc(e.target.value)} aria-label="Filter by location">
                <option value="all">All Locations</option>
                {locCounts.map(([l, n]) => <option key={l} value={l}>{l} ({n})</option>)}
              </select>
              <select value={fCond} onChange={e => setFCond(e.target.value)} aria-label="Filter by condition">
                <option value="all">Any Condition</option>
                {CONDITIONS.map(c => <option key={c} value={c}>{c} ({summary['cond_' + c] || 0})</option>)}
              </select>
            </div>
          </div>
          {activeChips.length > 0 && (
            <div className="arx-chips">
              {activeChips.map(c => (
                <span className="arx-chip" key={c.key}>
                  <c.icon size={12} /> {c.label}
                  <button type="button" onClick={c.clear} aria-label={`Remove ${c.label} filter`}><X size={12} /></button>
                </span>
              ))}
              <button type="button" className="arx-clear" onClick={clearAll}><X size={12} /> Clear all</button>
            </div>
          )}
        </div>

        {/* inventory card */}
        <div className="arx-card">
          <h3 className="arx-card-title">
            <ListChecks size={14} /> Asset Inventory
            <span style={{ marginLeft: 'auto', fontWeight: 650, color: 'var(--arx-soft)', letterSpacing: 0, textTransform: 'none', fontSize: 11.5 }}>
              {sorted.length.toLocaleString('en-IN')} record{sorted.length !== 1 ? 's' : ''} · {summary.units.toLocaleString('en-IN')} units
            </span>
          </h3>
          {loading ? (
            <div>{[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="arx-skel" style={{ height: 38, marginBottom: 9 }} />)}</div>
          ) : sorted.length === 0 ? (
            <div className="arx-empty">
              <SearchX size={42} strokeWidth={1.5} />
              <p>{assets.length === 0
                ? 'No assets yet. Start by adding one, or import your Office Asset Register Excel file.'
                : 'No assets match these filters. Try adjusting or clearing them.'}</p>
              {assets.length === 0
                ? <button className="arx-btn arx-btn-mint" onClick={() => setShowAdd(true)}><Plus size={15} /> Add First Asset</button>
                : <button className="arx-btn arx-btn-ghost" onClick={clearAll}><X size={14} /> Clear Filters</button>}
            </div>
          ) : (<>
            <div className="arx-twrap">
              <table className="arx-table">
                <thead>
                  <tr>
                    <STh label="Code" k="code" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <STh label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <STh label="Category" k="category" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <STh label="Location" k="location" cls="col-loc" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <STh label="Qty" k="qty" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <th className="col-tl">Team Leader</th>
                    <th>Owner Name</th>
                    <th>Assigned To</th>
                    <STh label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {pageGroups.map(g => {
                    const GIcon = catIcon(g.category)
                    return (
                      <Fragment key={g.category}>
                        <tr className="arx-ghead" style={{ '--gcol': g.color }} onClick={() => setFCat(fCat === g.category ? 'all' : g.category)}>
                          <td colSpan={9}>
                            <span className="arx-ghead-inner">
                              <span className="arx-ghead-name">
                                <span className="ci" style={{ background: g.color + '18', color: g.color }}><GIcon size={14} /></span>
                                {g.category}
                              </span>
                              <span className="arx-ghead-tot">
                                <span className="arx-ghead-totval">Total {g.units.toLocaleString('en-IN')}</span>
                                <span className="arx-ghead-totsub">units · {g.recs} record{g.recs !== 1 ? 's' : ''}</span>
                              </span>
                            </span>
                          </td>
                        </tr>
                        {g.records.map((a, i) => {
                          const CIcon = catIcon(a.category)
                          return (
                            <tr key={a.id} style={{ animationDelay: `${Math.min(i, 14) * 25}ms` }} onClick={() => setSelectedId(a.id)}>
                              <td className="arx-code">{a.code}</td>
                              <td style={{ fontWeight: 700, color: 'var(--arx-ink)' }}>{isMachineAsset(a.category) ? <SpecPop asset={a} /> : a.name}</td>
                              <td>
                                <span className="arx-tcat">
                                  <span className="ci" style={{ background: catColor(a.category) + '16', color: catColor(a.category) }}><CIcon size={14} /></span>
                                  {a.category}
                                </span>
                              </td>
                              <td className="col-loc">{locOf(a) || '—'}</td>
                              <td><span className="arx-qty">{uq(a)}</span></td>
                              <td className="col-tl">{a.team_leader || '—'}</td>
                              <td>{a.owner_name || '—'}</td>
                              <td>{a.assigned_to_name || '—'}</td>
                              <td><StatusBadge status={a.status} /></td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="arx-mcards">
              {pageGroups.map(g => {
                const GIcon = catIcon(g.category)
                return (
                  <Fragment key={g.category}>
                    <div className="arx-mgroup" style={{ '--mcol': g.color }}>
                      <span className="ci" style={{ background: g.color + '18', color: g.color }}><GIcon size={13} /></span>
                      <b>{g.category}</b>
                      <span className="arx-mgroup-tot">Total <strong>{g.units.toLocaleString('en-IN')}</strong> units · {g.recs} record{g.recs !== 1 ? 's' : ''}</span>
                    </div>
                    {g.records.map((a, i) => {
                      const CIcon = catIcon(a.category)
                      return (
                        <button type="button" className="arx-mcard" key={a.id} style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }} onClick={() => setSelectedId(a.id)}>
                          <div className="arx-mcard-top">
                            <span className="arx-code">{a.code}</span>
                            <StatusBadge status={a.status} />
                          </div>
                          <div className="arx-mcard-name">
                            <span className="ci" style={{ background: catColor(a.category) + '16', color: catColor(a.category) }}><CIcon size={15} /></span>
                            {isMachineAsset(a.category) ? <SpecPop asset={a} /> : a.name}
                          </div>
                          <div className="arx-mcard-meta">
                            <span><MapPin size={12} /> {locOf(a) || '—'}</span>
                            <span><Boxes size={12} /> {uq(a)} {uq(a) > 1 ? 'units' : 'unit'}</span>
                            {a.team_leader && <span><UserCheck size={12} /> {a.team_leader}</span>}
                            {a.owner_name && <span><UserCheck size={12} /> {a.owner_name}</span>}
                            {a.assigned_to_name && <span><UserPlus size={12} /> {a.assigned_to_name}</span>}
                          </div>
                          <ChevronRight size={16} className="arx-mchev" />
                        </button>
                      )
                    })}
                  </Fragment>
                )
              })}
            </div>
            <Pager page={pageSafe} setPage={setPage} total={sorted.length} pageSize={pageSize} setPageSize={setPageSize} />
          </>)}
        </div>

        {/* bottom: activity + snapshot */}
        {!loading && assets.length > 0 && (
          <div className="arx-btm">
            <div className="arx-card">
              <h3 className="arx-card-title"><History size={14} /> Recent Activity</h3>
              <div className="arx-tl">
                {assets.flatMap(a => (a.history || []).map(h => ({ ...h, code: a.code, name: a.name })))
                  .sort((x, y) => new Date(y.date) - new Date(x.date))
                  .slice(0, 8)
                  .map((h, i) => (
                    <div key={i} className="arx-tl-item" style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}>
                      <span className={`arx-tl-dot${i === 0 ? ' hot' : ''}`} />
                      <div>
                        <span className="arx-tl-text">{h.code} — {h.text}</span>
                        <span className="arx-tl-date"><Clock size={11} /> {fmtDate(h.date)}</span>
                      </div>
                    </div>
                  ))}
                {assets.every(a => !(a.history || []).length) && <p className="arx-muted">No activity yet.</p>}
              </div>
            </div>
            <div className="arx-card">
              <h3 className="arx-card-title"><Boxes size={14} /> Category Snapshot</h3>
              <BarList rows={snapshotBars} empty="No categories yet" />
            </div>
          </div>
        )}
      </>)}

      {tab === 'reports' && (
        <div className="arx-reports">
          <div className="arx-card">
            <h3 className="arx-card-title"><ShieldCheck size={14} /> Warranty Health</h3>
            <div className="arx-wcards">
              {[
                { icon: ShieldCheck, n: warrantyStats.active, l: 'Active Warranty', bg: '#ecfdf5', fg: '#059669' },
                { icon: Clock, n: warrantyStats.expiring, l: 'Expiring ≤30 Days', bg: '#fffbeb', fg: '#d97706' },
                { icon: ShieldAlert, n: warrantyStats.expired, l: 'Expired', bg: '#fef2f2', fg: '#dc2626' },
                { icon: Info, n: warrantyStats.none, l: 'No Warranty Data', bg: '#f1f5f9', fg: '#475569' },
              ].map((w, i) => (
                <div key={w.l} className="arx-wcard" style={{ animationDelay: `${i * 60}ms` }}>
                  <span className="wi" style={{ background: w.bg, color: w.fg }}><w.icon size={19} /></span>
                  <div><div className="wn" style={{ color: w.fg }}>{w.n}</div><div className="wl">{w.l}</div></div>
                </div>
              ))}
            </div>
            {warrantySoon.length > 0 && (
              <div className="arx-inline-alert warn">
                <Clock size={15} />
                <span>
                  {warrantySoon.length} warranty{warrantySoon.length > 1 ? 'ies' : ''} expiring soon:
                  {warrantySoon.slice(0, 6).map(a => (
                    <button key={a.id} type="button" className="arx-chip" style={{ margin: '0 4px', cursor: 'pointer' }} onClick={() => setSelectedId(a.id)}>
                      <ShieldAlert size={12} /> {a.code}
                    </button>
                  ))}
                </span>
              </div>
            )}
          </div>

          <div className="arx-rrow">
            <div className="arx-card">
              <h3 className="arx-card-title">
                <BarChart3 size={14} /> Category Breakdown
                <span className="arx-seg-toggle" style={{ marginLeft: 'auto', letterSpacing: 0, textTransform: 'none' }}>
                  <button type="button" className={catView === 'count' ? 'on' : ''} onClick={() => setCatView('count')}><Boxes size={12} /> Units</button>
                  <button type="button" className={catView === 'value' ? 'on' : ''} onClick={() => setCatView('value')}><IndianRupee size={12} /> Value</button>
                </span>
              </h3>
              <BarList rows={catBars} fmt={catView === 'value' ? v => money(v) : undefined} empty="No categories yet" />
            </div>
            <div className="arx-card">
              <h3 className="arx-card-title"><TrendingUp size={14} /> Status Distribution</h3>
              <Donut data={statusData} centerLabel="Total Records" />
            </div>
          </div>

          <div className="arx-rrow">
            <div className="arx-card">
              <h3 className="arx-card-title"><MapPin size={14} /> Location Breakdown</h3>
              <BarList rows={locBars} empty="No locations recorded yet" />
            </div>
            <div className="arx-card">
              <h3 className="arx-card-title"><BadgeCheck size={14} /> Condition Breakdown</h3>
              <BarList rows={condStats} empty="No conditions recorded yet" />
            </div>
          </div>

          <div className="arx-rrow">
            <div className="arx-card">
              <h3 className="arx-card-title"><CalendarDays size={14} /> Purchase Timeline</h3>
              <BarList rows={timelineStats} empty="No purchase dates recorded yet" />
            </div>
            <div className="arx-card">
              <h3 className="arx-card-title"><TrendingUp size={14} /> High-Value Assets</h3>
              {topValue.length === 0 ? <p className="arx-muted arx-padt">No purchase prices recorded yet — add prices to see the most valuable assets.</p> : (
                <div className="arx-top-list">
                  {topValue.map((a, i) => {
                    const CIcon = catIcon(a.category)
                    return (
                      <button type="button" key={a.id} className="arx-top-item" style={{ animationDelay: `${i * 55}ms` }} onClick={() => setSelectedId(a.id)}>
                        <span className="arx-top-rank">{i + 1}</span>
                        <span className="arx-tcat"><span className="ci" style={{ background: catColor(a.category) + '16', color: catColor(a.category) }}><CIcon size={14} /></span></span>
                        <span className="arx-top-name"><b>{a.name}</b><span>{a.code} · {a.category}{uq(a) > 1 ? ` · ${uq(a)} pcs` : ''}</span></span>
                        <span className="arx-top-val">{money(aval(a))}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="arx-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <div>
              <h3 className="arx-card-title" style={{ marginBottom: 5 }}><FileDown size={14} /> Full Analysis Report</h3>
              <p className="arx-muted" style={{ margin: 0 }}>Overview, status, category, location, condition, warranty &amp; high-value breakdown — exported as CSV.</p>
            </div>
            <button className="arx-btn arx-btn-mint" onClick={exportReport}><FileDown size={15} /> Export Report</button>
          </div>
        </div>
      )}

      {/* modals */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => loadAssets(true)}
          pushToast={pushToast}
        />
      )}
      {showAdd && <AssetFormModal onClose={() => setShowAdd(false)} onSave={saveNew} />}
      {editAsset && <AssetFormModal initial={editAsset} onClose={() => setEditAsset(null)} onSave={saveEdit} />}
      {selected && !action && !editAsset && (
        <AssetDetailModal
          asset={selected}
          onClose={() => setSelectedId(null)}
          onAction={type => setAction({ type })}
          onEdit={() => setEditAsset(selected)}
          onLost={() => { updateAsset(selected.id, { status: 'lost' }, 'Marked as Lost'); pushToast(`${selected.code} marked as lost`, 'info') }}
          onScrap={() => { updateAsset(selected.id, { status: 'scrapped' }, 'Scrapped'); pushToast(`${selected.code} scrapped`, 'info') }}
        />
      )}
      {selected && action && (
        <ActionModal
          type={action.type}
          asset={selected}
          workers={workers}
          onClose={() => setAction(null)}
          onDone={doAction}
        />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

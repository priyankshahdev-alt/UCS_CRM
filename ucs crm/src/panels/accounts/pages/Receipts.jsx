import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { apiGet, apiPost, apiDelete, apiPatch } from '../api/auth'
import { Pencil } from 'lucide-react'
import { useRealtime } from '../../../hooks/useRealtime'
import { formatIndianCurrency, formatReceiptDate, generateReceiptPDF, downloadSinglePDF, downloadAllPDFs } from '../services/pdfGenerator'
import ReceiptTemplateManncar from '../components/ReceiptTemplateManncar'
import ReceiptTemplateAshray from '../components/ReceiptTemplateAshray'
import ReceiptTemplateBeingSevak from '../components/ReceiptTemplateBeingSevak'
import BulkProgressModal from '../components/BulkProgressModal'
import ConfirmBulkModal from '../components/ConfirmBulkModal'
import Toast from '../components/Toast'
import ReceiptHistory, { prepareImportRows } from './ReceiptHistory'
import { API_BASE as apiBase } from '../../../lib/apiBase'

const NGO_MAP = {
  bsct: { label: 'Being Sevak', comp: ReceiptTemplateBeingSevak, metaTemplate: 'bsct_receipt', metaLang: 'en' },
  mann: { label: 'Mann Care', comp: ReceiptTemplateManncar, metaTemplate: 'mann_receipt', metaLang: 'en' },
  aflf: { label: 'Ashray', comp: ReceiptTemplateAshray, metaTemplate: 'ashray_receipt', metaLang: 'en' },
}

function getNgoSettings(project) {
  const saved = localStorage.getItem('receipt_template_settings')
  const defaults = NGO_MAP[project] || NGO_MAP.bsct
  if (!saved) return defaults
  try {
    const overrides = JSON.parse(saved)
    const o = overrides[project]
    if (!o) return defaults
    return {
      label: defaults.label,
      comp: NGO_MAP[o.receiptDesign]?.comp || defaults.comp,
      metaTemplate: o.metaTemplate || defaults.metaTemplate,
      metaLang: o.metaLang || defaults.metaLang,
    }
  } catch { return defaults }
}

const TARGET_COLUMNS = [
  { key: 'Donor Name', aliases: ['Donor Name'] },
  { key: 'Address 1', aliases: ['Address 1', 'Address1'] },
  { key: 'PAN No.', aliases: ['PAN No.', 'PAN No', 'Pan No', 'Pan No.'] },
  { key: 'Email ID', aliases: ['Email ID', 'Email Id', 'Mail Id', 'Mail ID'] },
  { key: 'Mode of Payment (MOP)', aliases: ['Mode of Payment (MOP)', 'MOP', 'Payment Mode', 'Mode of Payment'] },
  { key: 'Payment ID No.', aliases: ['Payment ID No.', 'Payment Id No', 'Payment Id No.', 'Payment ID No'] },
  { key: 'Donor Bank Name', aliases: ['Donor Bank Name', 'Donor bank Name', 'Bank Name'] },
  { key: 'Amount', aliases: ['Amount'] },
  { key: 'Receipt No.', aliases: ['Receipt No.', 'Receipt No', 'Reciept No', 'Reciept No.'] },
  { key: 'Receipt Date', aliases: ['Receipt Date', 'Reciept Date', 'Donation Date'] },
  { key: 'Account Of', aliases: ['Account Of', 'Account of'] },
  { key: 'Mobile No.', aliases: ['Mobile No.', 'Mobile', 'Phone', 'Phone No.', 'Contact No.', 'Cell'] },
  { key: 'Project', aliases: ['Project', 'NGO', 'project_supported'] },
]

const MANDATORY = ['Donor Name', 'Amount', 'Receipt No.']
const PAGE_SIZE = 20

function normalize(str) {
  return str.toLowerCase().replace(/[\s.,()\-_]+/g, '')
}

function findColumn(target, headers) {
  const normTarget = normalize(target)
  for (const h of headers) { if (normalize(h) === normTarget) return h }
  for (const h of headers) { const nh = normalize(h); if (nh.includes(normTarget) || normTarget.includes(nh)) return h }
  return null
}

function matchColumns(headers) {
  const map = {}
  for (const col of TARGET_COLUMNS) {
    let m = headers.find(h => h === col.key)
    if (m) { map[col.key] = m; continue }
    for (const a of col.aliases) {
      m = headers.find(h => h === a) || headers.find(h => normalize(h) === normalize(a))
      if (m) break
    }
    if (!m) m = findColumn(col.key, headers)
    if (m) map[col.key] = m
  }
  return map
}

function isEmptyRow(row) {
  return TARGET_COLUMNS.every(col => !row[col.key] || String(row[col.key]).trim() === '')
}

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana',
  'Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur',
  'Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu',
  'Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands',
  'Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh',
  'Lakshadweep','Puducherry',
]

function parseAddressParts(raw) {
  if (!raw) return { address:'', city:'', state:'', pincode:'' }
  let addr = raw.trim()
  let pin = ''
  const pinMatch = addr.match(/(\d{6})\s*$/)
  if (pinMatch) { pin = pinMatch[1]; addr = addr.slice(0, pinMatch.index).trim().replace(/[,]+$/, '').trim() }
  const parts = addr.split(',').map(p => p.trim()).filter(Boolean)
  let foundState = '', foundCity = ''
  const stateLowerMap = {}
  INDIAN_STATES.forEach(s => { stateLowerMap[s.toLowerCase()] = s })
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].toLowerCase()
    if (stateLowerMap[part]) { foundState = stateLowerMap[part]; foundCity = parts[i - 1] || ''; break }
    for (const [ls, os] of Object.entries(stateLowerMap)) {
      if (part.startsWith(ls)) { foundState = os; foundCity = parts[i].slice(ls.length).trim().replace(/^[, ]+/, '') || parts[i - 1] || ''; break }
    }
    if (foundState) break
  }
  let cleanParts = [...parts].filter(p => p !== foundCity && p.toLowerCase() !== foundState.toLowerCase() && !p.includes(pin))
  return { address: cleanParts.join(', ') || raw, city: foundCity || '', state: foundState || '', pincode: pin || '' }
}

function ExcelUpload({ onDataLoaded }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const processFile = useCallback((file) => {
    setError(null); setLoading(true)
    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
      setError('Please upload a valid file (.xlsx, .xls, or .csv)'); setLoading(false); return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' })
        if (!jsonData || jsonData.length === 0) { setError('File is empty'); setLoading(false); return }
        const headers = Object.keys(jsonData[0])
        const columnMap = matchColumns(headers)
        const missing = TARGET_COLUMNS.filter(col => !columnMap[col.key]).map(col => col.key)
        if (missing.length > 0) { setError(`Required columns not found: ${missing.join(', ')}`); setLoading(false); return }
        const seen = new Set()
        const donors = jsonData.filter(r => !isEmptyRow(r)).map(row => {
          const entry = {}
          for (const col of TARGET_COLUMNS) entry[col.key] = String(row[columnMap[col.key]] ?? '').trim()
          const parsed = parseAddressParts(entry['Address 1'])
          const rawCity = String(row['City'] ?? row['city'] ?? '').trim()
          const rawState = String(row['State'] ?? row['state'] ?? '').trim()
          const rawPin = String(row['Pincode'] ?? row['pincode'] ?? row['Pin Code'] ?? '').trim()
          entry['City'] = parsed.city || rawCity || ''
          entry['State'] = parsed.state || rawState || ''
          entry['Pincode'] = parsed.pincode || rawPin || ''
          if (parsed.address && (parsed.city || parsed.state || parsed.pincode)) entry['Address 1'] = parsed.address
          if (MANDATORY.some(m => !entry[m])) entry._dataMissing = true
          const rn = entry['Receipt No.']
          entry._duplicate = rn ? seen.has(rn) : false
          if (rn && !entry._duplicate) seen.add(rn)
          if (!entry['Project']) entry['Project'] = 'bsct'
          if (!entry['Account Of']) entry['Account Of'] = 'Corpus'
          return entry
        })
        if (donors.length === 0) { setError('No valid rows found'); setLoading(false); return }
        onDataLoaded(donors)
      } catch { setError('Failed to parse file') }
      setLoading(false)
    }
    reader.onerror = () => { setError('Failed to read file'); setLoading(false) }
    reader.readAsArrayBuffer(file)
  }, [onDataLoaded])

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-pad">
        <div
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? '#5B6B4E' : '#d1d5db'}`,
            borderRadius: 12, padding: '40px 20px', textAlign: 'center',
            cursor: 'pointer', background: dragOver ? '#f0fdf4' : '#f9fafb',
            transition: 'all .2s',
          }}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files[0]; if (f) processFile(f); e.target.value = '' }} style={{ display:'none' }} />
          {loading ? (
            <div>
              <div style={{ width:32,height:32,border:'3px solid #e5e7eb',borderTopColor:'#5B6B4E',borderRadius:'50%',animation:'spin .6s linear infinite',margin:'0 auto 12px' }} />
              <p style={{ fontSize:14, color:'#6b7280' }}>Parsing file...</p>
            </div>
          ) : (
            <>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#5B6B4E" strokeWidth="1.5" style={{ marginBottom:12, opacity:.6 }}>
                <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p style={{ fontSize:14, fontWeight:600, color:'#374151', marginBottom:4 }}>Drag & drop your Excel/CSV file here</p>
              <p style={{ fontSize:12, color:'#9ca3af' }}>or click to browse &nbsp;·&nbsp; .xlsx .xls .csv</p>
            </>
          )}
        </div>
        {error && <p style={{ fontSize:13, color:'#dc2626', marginTop:8, padding:'8px 12px', background:'#fef2f2', borderRadius:8 }}>{error}</p>}
      </div>
    </div>
  )
}

const currency = n => n != null ? '\u20B9' + Number(n).toLocaleString('en-IN') : '\u2014';

export default function Receipts() {
  const [donors, setDonors] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [downloadSingle, setDownloadSingle] = useState(false)
  const [loading, setLoading] = useState(true)
  

  const [toast, setToast] = useState({ message:'', type:'', visible:false })
  const showToast = useCallback((type, msg) => setToast({ type, message:msg, visible:true }), [])
  const hideToast = useCallback(() => setToast(prev => ({ ...prev, visible:false })), [])

  const [bulkState, setBulkState] = useState({ active:false, total:0, sent:0, failed:0, currentBatch:0, totalBatches:0, results:[], previousBatches:[] })
  const cancelBulkRef = useRef(false)
  const [confirmBulk, setConfirmBulk] = useState({ visible:false, donorCount:0 })
  const [receiptPage, setReceiptPage] = useState(1)
  const [markingAllSent, setMarkingAllSent] = useState(false)
  const [markAllProgress, setMarkAllProgress] = useState({ completed: 0, total: 0 })
  const [ngoFilter, setNgoFilter] = useState('all')
  const [receiptSearch, setReceiptSearch] = useState('')
  const [goBackRow, setGoBackRow] = useState(null)
  const [goBackSubmitting, setGoBackSubmitting] = useState(false)

  const [uploadMode, setUploadMode] = useState('receipts')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')
  const [namesImporting, setNamesImporting] = useState(false)
  const [namesResult, setNamesResult] = useState(null)
  const [namesUploadProgress, setNamesUploadProgress] = useState(0)
  const [uploadNgoId, setUploadNgoId] = useState('')
  const [ngoOptions, setNgoOptions] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState('')
  const [deleteProgress, setDeleteProgress] = useState(0)
  const [showCleanModal, setShowCleanModal] = useState(false)
  const [cleanFrom, setCleanFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [cleanTo, setCleanTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [editingReceipt, setEditingReceipt] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [froWorkers, setFroWorkers] = useState([])
  const [confirmFroChange, setConfirmFroChange] = useState(false)
  const fileRef = useRef(null)
  const namesFileRef = useRef(null)
  const rtTimerRef = useRef(null)
  const CHUNK_SIZE = 100

  useEffect(() => {
    apiGet('/accounts/ngos').then(data => {
      const seen = new Set()
      setNgoOptions((Array.isArray(data) ? data : []).filter(n => {
        if (!n.id || seen.has(n.id)) return false
        seen.add(n.id)
        return true
      }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    apiGet('/accounts/receipts/fro-workers')
      .then(data => setFroWorkers(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const parseReceiptNo = (d) => {
    const v = String(d['Receipt No.'] || '').trim()
    const n = parseInt(v, 10)
    return isNaN(n) ? -1 : n
  }

  const filteredDonors = (() => {
    if (!donors) return donors
    let pool = ngoFilter === 'all' ? donors
      : donors.filter(d => (d['Project'] || 'bsct') === ngoFilter)
    if (receiptSearch.trim()) {
      const q = receiptSearch.trim().toLowerCase()
      pool = pool.filter(d => String(d['Receipt No.'] || '').toLowerCase().includes(q))
      pool.sort((a, b) => {
        const aExact = String(a['Receipt No.'] || '').toLowerCase() === q ? 0 : 1
        const bExact = String(b['Receipt No.'] || '').toLowerCase() === q ? 0 : 1
        if (aExact !== bExact) return aExact - bExact
        return parseReceiptNo(b) - parseReceiptNo(a)
      })
    } else {
      pool.sort((a, b) => parseReceiptNo(b) - parseReceiptNo(a))
    }
    return pool
  })()

  useEffect(() => { setReceiptPage(1) }, [ngoFilter, receiptSearch])

  const removeFromPending = useCallback((receiptId) => {
    setDonors(current => (current || []).filter(donor => donor.receipt_id !== receiptId))
    setSelectedId(prev => prev === receiptId ? null : prev)
    setPreviewRow(prev => prev?.receipt_id === receiptId ? null : prev)
  }, [])

  const loadPending = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await apiGet('/accounts/receipts/pending')
      const pending = (Array.isArray(data) ? data : []).filter(receipt => {
        const status = String(receipt.status || '').toLowerCase()
        return !receipt.sent && !receipt.whatsapp_sent && !receipt.is_sent && !['sent', 'delivered'].includes(status)
      })
      setDonors(pending)
    } catch (e) { console.error('Error:', e.message); }
    setLoading(false)
  }, [])

  useEffect(() => { loadPending() }, [loadPending])

  useEffect(() => { return () => clearTimeout(rtTimerRef.current) }, [])

  const refreshHistory = () => {
    window.dispatchEvent(new CustomEvent('ucs:receipts-refresh'))
  }

  const runImport = useCallback(async (rows, ngoIdForImport) => {
    if (!rows || rows.length === 0) return;
    setImporting(true);
    setImportResult(null);
    setUploadProgress(0);
    setUploadStatus('Reading file...');
    try {
      const chunks = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        chunks.push(rows.slice(i, i + CHUNK_SIZE));
      }
      let totalImported = 0, totalMatched = 0, totalUpgraded = 0, totalCreditedPending = 0, totalFailed = 0, failedFileUrl = null;
      for (let i = 0; i < chunks.length; i++) {
        setUploadStatus(`Importing ${Math.min((i+1)*CHUNK_SIZE, rows.length)} of ${rows.length} rows...`);
        const res = await apiPost('/accounts/receipts/import', { receipts: chunks[i], ngo_id: ngoIdForImport }, 300000);
        totalImported += res.imported || 0;
        totalMatched += res.matchedDonors || 0;
        totalUpgraded += res.upgraded || 0;
        totalCreditedPending += res.creditedPending || 0;
        totalFailed += res.failedCount || 0;
        if (res.failedFile && !failedFileUrl) failedFileUrl = res.failedFile;
        setUploadProgress(Math.round(((i + 1) / chunks.length) * 100));
      }
      setUploadProgress(100);
      setUploadStatus('');
      const rootUrl = apiBase.replace(/\/api\/?$/, '');
      const parts = [`${totalImported} receipts imported`];
      if (totalUpgraded > 0) parts.push(`${totalUpgraded} suspense receipts credited from re-upload`);
      if (totalCreditedPending > 0) parts.push(`${totalCreditedPending} pending claims auto-credited`);
      if (totalMatched > 0) parts.push(`${totalMatched} linked to donors`);
      if (totalFailed > 0) parts.push(`${totalFailed} failed`);
      setImportResult({ message: parts.join(', '), imported: totalImported, matchedDonors: totalMatched, failedCount: totalFailed, failedFile: failedFileUrl ? rootUrl + failedFileUrl : null });
      loadPending();
      refreshHistory();
    } catch (err) { alert('Import failed: ' + err.message); }
    finally { setImporting(false); setUploadProgress(0); setUploadStatus(''); }
  }, [loadPending]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!uploadNgoId) { alert('Please select the NGO for this upload first'); return; }
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) { alert('Please upload a valid Excel/CSV file'); return; }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
      const sourceRows = wb.SheetNames
        .map(sheetName => XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false }))
        .find(sheetRows => sheetRows.length > 0) || [];
      const rows = prepareImportRows(sourceRows);
      if (!rows || rows.length === 0) { alert('File is empty'); return; }
      await runImport(rows, uploadNgoId);
    } catch (err) { alert('Import failed: ' + err.message); }
  }, [uploadNgoId, runImport]);

  const handleNamesFile = useCallback(async (file) => {
    if (!file) return;
    if (!uploadNgoId) { alert('Please select the NGO for this upload first'); return; }
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) { alert('Please upload a valid Excel/CSV file'); return; }
    setNamesImporting(true);
    setNamesResult(null);
    setNamesUploadProgress(0);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
      const sourceRows = wb.SheetNames
        .map(sheetName => XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false }))
        .find(sheetRows => sheetRows.length > 0) || [];
      const rows = sourceRows
        .map(row => Object.fromEntries(Object.keys(row).map(k => [String(k).toLowerCase().replace(/[^a-z0-9]/g, ''), row[k]])))
        .map(row => ({ receipt_no: String(row.receiptno || '').trim(), donor_name: String(row.donorname || '').trim() }))
        .filter(r => r.receipt_no && r.donor_name);
      if (!rows || rows.length === 0) { alert('No rows with a Receipt No. and a donor name found'); return; }
      const chunks = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) chunks.push(rows.slice(i, i + CHUNK_SIZE));
      let updated = 0, notFound = 0;
      for (let i = 0; i < chunks.length; i++) {
        setNamesUploadProgress(Math.round((i / chunks.length) * 100));
        const res = await apiPost('/accounts/receipts/names-import', { rows: chunks[i], ngo_id: uploadNgoId }, 300000);
        updated += res.updated || 0;
        notFound += res.notFound || 0;
        setNamesUploadProgress(Math.round(((i + 1) / chunks.length) * 100));
      }
      setNamesResult({ message: `${updated} receipt${updated === 1 ? '' : 's'} updated${notFound > 0 ? `, ${notFound} receipt no. not found` : ''}` });
      loadPending();
      refreshHistory();
    } catch (err) { alert('Update failed: ' + err.message); }
    finally { setNamesImporting(false); setNamesUploadProgress(0); }
  }, [uploadNgoId, loadPending]);

  const handleCleanUp = async () => {
    setShowCleanModal(false);
    setDeleting(true);
    setDeleteStatus('Finding receipts...');
    setDeleteProgress(0);
    try {
      const { count: total } = await apiGet('/accounts/receipts/count');
      if (total === 0) { setDeleteStatus('No receipts to delete'); setTimeout(() => { setDeleting(false); setDeleteStatus(''); }, 800); return; }
      let deleted = 0, isFirst = true;
      const BATCH = 1000;
      while (true) {
        const res = await apiDelete(`/accounts/receipts?batch=${BATCH}${isFirst ? '&reverse=1' : ''}`);
        isFirst = false;
        if (!res.deleted || res.deleted === 0) break;
        deleted += res.deleted;
        setDeleteProgress(Math.round((Math.min(deleted, total) / total) * 100));
        setDeleteStatus(`Deleting ${Math.min(deleted, total)} of ${total} receipts...`);
      }
      setDeleteStatus(`Deleted ${total} receipts`);
      setTimeout(() => { setDeleting(false); setDeleteStatus(''); setDeleteProgress(0); }, 1500);
      loadPending(); refreshHistory();
    } catch (err) { alert('Clean up failed: ' + err.message); setDeleting(false); setDeleteStatus(''); setDeleteProgress(0); }
  };

  const handleCleanUpDate = async () => {
    if (!cleanFrom) { alert('Please choose a date to delete'); return; }
    const from = cleanFrom;
    const to = cleanTo || cleanFrom;
    if (to < from) { alert('"To" date must be on or after the "From" date'); return; }
    if (!window.confirm(`Delete all receipts from ${from}${to !== from ? ` to ${to}` : ''}? This cannot be undone.`)) return;
    setShowCleanModal(false);
    setDeleting(true);
    setDeleteStatus('Deleting receipts...');
    setDeleteProgress(0);
    try {
      const res = await apiDelete(`/accounts/receipts?from=${from}${to !== from ? `&to=${to}` : ''}`);
      const done = res?.deleted || 0;
      setDeleteProgress(100);
      setDeleteStatus(done > 0 ? `Deleted ${done} receipt${done !== 1 ? 's' : ''}` : 'No receipts found on this date');
      setTimeout(() => { setDeleting(false); setDeleteStatus(''); setDeleteProgress(0); }, 1500);
      loadPending(); refreshHistory();
    } catch (err) { alert('Clean up failed: ' + err.message); setDeleting(false); setDeleteStatus(''); setDeleteProgress(0); }
  };

  useRealtime('fro_donor_logs', {
    filter: 'action=eq.disposition',
    onInsert: () => { clearTimeout(rtTimerRef.current); rtTimerRef.current = setTimeout(() => loadPending(true), 400) },
    onUpdate: () => { clearTimeout(rtTimerRef.current); rtTimerRef.current = setTimeout(() => loadPending(true), 400) },
  })

  const getValidDonors = useCallback(() => {
    return filteredDonors ? filteredDonors.filter(d => { const m = String(d['Mobile No.'] || '').replace(/[^0-9]/g, ''); return m.length >= 10 }) : []
  }, [filteredDonors])

  const handleDownloadSingle = async () => {
    const donor = previewRow || (selectedId != null ? (donors || []).find(d => d.receipt_id === selectedId) : null) || null
    if (!donor) return
    setDownloadSingle(true)
    try {
      const sheet = previewBodyRef.current?.querySelector('[data-receipt-sheet]')
      if (!sheet) throw new Error('Receipt element not found')
      await downloadSinglePDF(sheet, donor, donor['Project'] || 'bsct')
    } catch (e) { alert('Failed to download PDF: ' + e.message) }
    setDownloadSingle(false)
  }

  const handlePrint = () => {
    const pw = window.open('', '_blank')
    if (!pw) { alert('Please allow pop-ups to print'); return }
    const sheet = previewBodyRef.current?.querySelector('[data-receipt-sheet]')
    if (!sheet) { alert('Receipt element not found'); return }
    pw.document.write(`<html><head><title>Donation Receipt</title><style>body{font-family:Arial,sans-serif;padding:20px}@media print{body{padding:0}}</style></head><body>${sheet.innerHTML}</body></html>`)
    pw.document.close(); pw.focus()
    setTimeout(() => pw.print(), 500)
  }

  const [sendingId, setSendingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [previewRow, setPreviewRow] = useState(null)
  const [previewedIds, setPreviewedIds] = useState(() => new Set())
  const previewBodyRef = useRef(null)
  const [previewScale, setPreviewScale] = useState(0.7)

  useLayoutEffect(() => {
    if (previewRow == null) return

    let frameId
    const updatePreviewScale = () => {
      const body = previewBodyRef.current
      const sheet = body?.querySelector('[data-receipt-sheet]') || body?.firstElementChild
      if (!body || !sheet) return

      const availableWidth = Math.max(240, body.clientWidth - 40)
      const availableHeight = Math.max(240, body.clientHeight - 40)
      const sheetWidth = Math.max(sheet.scrollWidth, sheet.getBoundingClientRect().width)
      const sheetHeight = Math.max(sheet.scrollHeight, sheet.getBoundingClientRect().height)
      const nextScale = Math.min(0.86, availableWidth / sheetWidth, availableHeight / sheetHeight)

      setPreviewScale(Math.max(0.4, Number.isFinite(nextScale) ? nextScale : 0.7))
    }

    frameId = requestAnimationFrame(updatePreviewScale)
    window.addEventListener('resize', updatePreviewScale)
    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updatePreviewScale)
    }
  }, [previewRow, donors])

  const updatePhone = (receiptId, val) => {
    setDonors(prev => (prev || []).map(d => d.receipt_id === receiptId ? { ...d, 'Mobile No.': val } : d))
  }

  const handleSendSingle = async (donor, receiptId) => {
    setSendingId(receiptId)
    try {
      if (!donor.receipt_id) throw new Error('This receipt is not eligible for sending')
      const receiptNo = donor['Receipt No.'] || 'N/A'
      const rawPhone = String(donor['Mobile No.'] || '').replace(/[^0-9]/g, '')
      const phone = rawPhone.length === 10 ? '91' + rawPhone : rawPhone.startsWith('0') && rawPhone.length === 11 ? '91' + rawPhone.slice(1) : rawPhone
      if (phone.length < 10) throw new Error('Invalid phone')
      const ngo = donor['Project'] || 'bsct'
      const tpl = getNgoSettings(ngo)

      let pdfBase64 = null
      const el = document.querySelector(`[data-receipt-batch="${donor.receipt_id}"]`)
      if (el) {
        const pdf = await generateReceiptPDF(el)
        pdfBase64 = pdf.output('datauristring').split(',')[1]
      }

      await apiPost('/whatsapp/send-direct', {
        to: phone, pdfBase64, receiptNo,
        donorName: donor['Donor Name'],
        amount: donor['Amount'],
        templateName: tpl.metaTemplate,
        templateLang: tpl.metaLang,
        project: ngo,
      })
      await apiPost('/accounts/receipts/mark-sent', { receiptId: donor.receipt_id })
      removeFromPending(donor.receipt_id)
      showToast('success', `Sent to ${donor['Donor Name']}`)
    } catch (e) {
      showToast('error', e.message)
    }
    setSendingId(null)
  }

  const handleSendAllWhatsApp = () => {
    const valid = getValidDonors()
    if (valid.length === 0) { showToast('error', 'No donors with valid mobile numbers'); return }
    setConfirmBulk({ visible:true, donorCount:valid.length })
  }

  const handleMarkAllSent = async () => {
    const receiptIds = [...new Set((filteredDonors || []).map(donor => donor.receipt_id).filter(Boolean))]
    if (receiptIds.length === 0) { showToast('error', 'No eligible pending receipts found'); return }
    if (!window.confirm(`Mark ${receiptIds.length} receipt${receiptIds.length === 1 ? '' : 's'} as sent? This will remove them from the pending queue without sending WhatsApp messages.`)) return

    // The API accepts a maximum of 50 receipt IDs per request. Batching prevents
    // the browser from flooding it with thousands of individual requests.
    const batches = []
    for (let index = 0; index < receiptIds.length; index += 50) batches.push(receiptIds.slice(index, index + 50))

    setMarkingAllSent(true)
    setMarkAllProgress({ completed: 0, total: receiptIds.length })
    const markedIds = []
    let failed = 0

    try {
      for (const batch of batches) {
        try {
          const result = await apiPost('/accounts/receipts/mark-sent', {
            receipt_ids: batch,
            delivery_channel: 'manual',
          })
          if (result?.success === false) throw new Error(result.message || 'Could not mark this batch as sent')

          // Use the server-confirmed IDs when available; older API deployments
          // only return success, in which case the whole successful batch is valid.
          markedIds.push(...(Array.isArray(result?.data?.receipt_ids) ? result.data.receipt_ids : batch))
        } catch (error) {
          console.error('Unable to mark receipt batch as sent:', error.message)
          failed += batch.length
        }
        setMarkAllProgress({ completed: markedIds.length + failed, total: receiptIds.length })
      }

      if (markedIds.length) {
        const markedIdSet = new Set(markedIds)
        setDonors(current => (current || []).filter(donor => !markedIdSet.has(donor.receipt_id)))
      }
      showToast(failed ? 'error' : 'success', failed
        ? `${markedIds.length} marked sent; ${failed} could not be updated.`
        : `${markedIds.length} receipts marked as sent`)
    } finally {
      setMarkingAllSent(false)
      setMarkAllProgress({ completed: 0, total: 0 })
    }
  }

  const handleGoBack = async () => {
    if (!goBackRow?.receipt_id || goBackSubmitting) return
    setGoBackSubmitting(true)
    try {
      await apiPost(`/accounts/receipts/${goBackRow.receipt_id}/undo`)
      removeFromPending(goBackRow.receipt_id)
      showToast('success', `Returned ${goBackRow['Donor Name'] || 'this receipt'} to Bank Audit`)
    } catch (error) {
      showToast('error', error.message || 'Could not undo this receipt')
    } finally {
      setGoBackSubmitting(false)
      setGoBackRow(null)
    }
  }

  const handleEditReceipt = async (d) => {
    setEditingReceipt(d)
    setEditForm({
      donor_name: d['Donor Name'] || '',
      donor_mobile: d['Mobile No.'] || '',
      address: d['Address 1'] || '',
      pan_number: d['PAN No.'] || '',
      email: d['Email ID'] || '',
      agent_name: d['Agent Name'] || '',
      mode: d['Mode of Payment (MOP)'] || '',
      account_of: d['Account Of'] || '',
    })
    setConfirmFroChange(false)
  }

  const handleSaveEdit = async () => {
    if (!editingReceipt) return
    const oldFro = (editingReceipt['Agent Name'] || '').trim()
    const newFro = (editForm.agent_name || '').trim()
    if (oldFro !== newFro && newFro !== '' && !confirmFroChange) {
      setConfirmFroChange(true)
      return
    }
    setEditSaving(true)
    try {
      await apiPatch(`/accounts/receipts/${editingReceipt.receipt_id}`, editForm)
      setEditingReceipt(null)
      setConfirmFroChange(false)
      loadPending()
    } catch (err) {
      alert('Failed to update receipt: ' + err.message)
    } finally {
      setEditSaving(false)
    }
  }

  const handleConfirmBulkSend = async () => {
    setConfirmBulk({ visible:false, donorCount:0 })
    const validDonors = getValidDonors()
    if (validDonors.length === 0) return
    const batches = []
    for (let i = 0; i < validDonors.length; i += 10) batches.push(validDonors.slice(i, i + 10))
    cancelBulkRef.current = false
    setBulkState({ active:true, total:validDonors.length, sent:0, failed:0, currentBatch:0, totalBatches:batches.length, results:[], previousBatches:[] })

    let totalSent = 0, totalFailed = 0
    const allErrors = []
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (cancelBulkRef.current) break
      const batch = batches[batchIdx]
      setBulkState(prev => ({ ...prev, currentBatch: batchIdx + 1, results: batch.map(d => ({ name: d['Donor Name'], status:'sending' })) }))

      const batchResults = await Promise.allSettled(batch.map(async (donor) => {
        if (!donor.receipt_id) throw new Error('This receipt is not eligible for sending')
        const receiptNo = donor['Receipt No.'] || 'N/A'
        const rawPhone = String(donor['Mobile No.'] || '').replace(/[^0-9]/g, '')
        const phone = rawPhone.length === 10 ? '91' + rawPhone : rawPhone.startsWith('0') && rawPhone.length === 11 ? '91' + rawPhone.slice(1) : rawPhone
        if (phone.length < 10) throw new Error('Invalid phone')
        const ngo = donor['Project'] || 'bsct'
        const tpl = getNgoSettings(ngo)

        let pdfBase64 = null
        const el = document.querySelector(`[data-receipt-batch="${donor.receipt_id}"]`)
        if (el) {
          const pdf = await generateReceiptPDF(el)
          pdfBase64 = pdf.output('datauristring').split(',')[1]
        }

        try {
          await apiPost('/whatsapp/send-direct', {
            to: phone, pdfBase64, receiptNo,
            donorName: donor['Donor Name'],
            amount: donor['Amount'],
            templateName: tpl.metaTemplate,
            templateLang: tpl.metaLang,
            project: ngo,
          })
          await apiPost('/accounts/receipts/mark-sent', { receiptId: donor.receipt_id })
        } catch (e) {
          console.error('WhatsApp send failed for', donor['Donor Name'], ':', e.message)
          allErrors.push(donor['Donor Name'] + ': ' + e.message)
          throw e
        }
      }))

      const batchSent = batchResults.filter(r => r.status === 'fulfilled').length
      const batchFailed = batchResults.filter(r => r.status === 'rejected').length
      totalSent += batchSent; totalFailed += batchFailed
      setBulkState(prev => ({
        ...prev, sent: totalSent, failed: totalFailed,
        results: batchResults.map((r, i) => ({ name: batch[i]['Donor Name'], status: r.status === 'fulfilled' ? 'sent' : 'failed', error: r.status === 'rejected' ? r.reason?.message : null })),
        previousBatches: [...prev.previousBatches, { batch: batchIdx + 1, sent: batchSent, failed: batchFailed }],
      }))
      const sentReceiptIds = batchResults
        .map((result, i) => result.status === 'fulfilled' ? batch[i].receipt_id : null)
        .filter(Boolean)
      if (sentReceiptIds.length) {
        setDonors(current => (current || []).filter(donor => !sentReceiptIds.includes(donor.receipt_id)))
      }
    }
    setBulkState(prev => ({ ...prev, active:false }))
    if (totalFailed > 0 && totalSent === 0 && allErrors.length > 0) {
      alert('All sends failed!\n\nFirst error:\n' + allErrors[0])
    }
    showToast(cancelBulkRef.current ? 'info' : 'success', cancelBulkRef.current ? `Cancelled. ${totalSent} sent, ${totalFailed} failed` : `Bulk send complete! ${totalSent} sent, ${totalFailed} failed`)
  }

  const currentDonor = selectedId != null ? (donors || []).find(d => d.receipt_id === selectedId) : (donors?.[0])
  const currentNgo = currentDonor?.['Project'] || 'bsct'
  const currentTpl = getNgoSettings(currentNgo)
  const TemplateComp = currentTpl.comp

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          onClick={() => setUploadOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', borderBottom: uploadOpen ? '1px solid var(--line)' : 'none' }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>Upload Receipts</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: uploadOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        {uploadOpen && (
        <div className="card-pad">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{uploadMode === 'names' ? 'Upload Names' : uploadMode === 'reupload' ? 'Reupload Receipts' : 'Upload Receipts'}</span>
              <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
                <button onClick={() => setUploadMode('receipts')} style={{ padding: '3px 10px', fontSize: 11, border: 'none', cursor: 'pointer', background: uploadMode === 'receipts' ? '#5B6B4E' : '#fff', color: uploadMode === 'receipts' ? '#fff' : '#374151', fontWeight: 600 }}>Receipts</button>
                <button onClick={() => setUploadMode('names')} style={{ padding: '3px 10px', fontSize: 11, border: 'none', cursor: 'pointer', background: uploadMode === 'names' ? '#5B6B4E' : '#fff', color: uploadMode === 'names' ? '#fff' : '#374151', fontWeight: 600 }}>Names</button>
                <button onClick={() => setUploadMode('reupload')} style={{ padding: '3px 10px', fontSize: 11, border: 'none', cursor: 'pointer', background: uploadMode === 'reupload' ? '#5B6B4E' : '#fff', color: uploadMode === 'reupload' ? '#fff' : '#374151', fontWeight: 600 }}>Reupload</button>
              </div>
            </div>
            <button style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }} onClick={() => setShowCleanModal(true)} title="Delete receipts by date range">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Delete by Date
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', flexShrink: 0 }}>NGO</label>
            <select
              value={uploadNgoId}
              onChange={e => setUploadNgoId(e.target.value)}
              style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, background: '#fff', color: '#111827' }}
            >
              <option value="">Select NGO for this upload...</option>
              {ngoOptions.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>
          {uploadMode === 'names' ? (
            <div
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleNamesFile(f) }}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => namesFileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? '#2563eb' : '#d1d5db'}`, borderRadius: 12, padding: '12px 20px', textAlign: 'center',
                cursor: 'pointer', background: dragOver ? '#eff6ff' : '#f9fafb', transition: 'all .2s',
              }}
            >
              <input ref={namesFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => { handleNamesFile(e.target.files[0]); e.target.value = '' }} style={{ display: 'none' }} />
              {namesImporting ? (
                <div style={{ padding: '8px 0' }}>
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                    <div style={{ width: 16, height: 16, border: '2px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin .6s linear infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: '#6b7280' }}>Updating donor names...</span>
                  </div>
                  <div style={{ width: '100%', maxWidth: 320, margin: '0 auto', height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${namesUploadProgress}%`, height: '100%', background: '#2563eb', borderRadius: 3, transition: 'width .3s ease' }} />
                  </div>
                  <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>{namesUploadProgress}%</p>
                </div>
              ) : (
                <>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.5" style={{ marginBottom: 4, opacity: .6 }}>
                    <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 1 }}>Drag & drop your Excel/CSV file to fix donor names</p>
                  <p style={{ fontSize: 10, color: '#9ca3af' }}>Uses the Receipt Name or Donor Name column, matched by Receipt No. &nbsp;·&nbsp; .xlsx .xls .csv</p>
                </>
              )}
            </div>
          ) : (
            <div
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? '#5B6B4E' : '#d1d5db'}`, borderRadius: 12, padding: '12px 20px', textAlign: 'center',
                cursor: 'pointer', background: dragOver ? '#f0fdf4' : '#f9fafb', transition: 'all .2s',
              }}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => { handleFile(e.target.files[0]); e.target.value = '' }} style={{ display: 'none' }} />
              {importing ? (
                <div style={{ padding: '8px 0' }}>
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                    <div style={{ width: 16, height: 16, border: '2px solid #e5e7eb', borderTopColor: '#5B6B4E', borderRadius: '50%', animation: 'spin .6s linear infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{uploadStatus || 'Importing...'}</span>
                  </div>
                  <div style={{ width: '100%', maxWidth: 320, margin: '0 auto', height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#5B6B4E', borderRadius: 3, transition: 'width .3s ease' }} />
                  </div>
                  <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>{uploadProgress}%</p>
                </div>
              ) : (
                <>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5B6B4E" strokeWidth="1.5" style={{ marginBottom: 4, opacity: .6 }}>
                    <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 1 }}>Drag & drop your Excel/CSV file here</p>
                  <p style={{ fontSize: 10, color: '#9ca3af' }}>or click to browse &nbsp;·&nbsp; .xlsx .xls .csv</p>
                </>
              )}
            </div>
          )}
          {deleting && (
            <div style={{ marginTop: 8, padding: '6px 0' }}>
              <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: '#6b7280' }}>{deleteStatus}</span>
              </div>
              <div style={{ width: '100%', maxWidth: 320, margin: '0 auto', height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${deleteProgress}%`, height: '100%', background: '#dc2626', borderRadius: 3, transition: 'width .3s ease' }} />
              </div>
              {deleteProgress > 0 && <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>{deleteProgress}%</p>}
            </div>
          )}
          {importResult && (
            <div style={{ fontSize: 12, color: '#059669', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <span>{importResult.message}{importResult.withBank != null ? ` (${importResult.withBank} with bank)` : ''}</span>
              {(importResult.failedCount > 0 && importResult.failedFile) && (
                <a href={importResult.failedFile} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: '#dc2626', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download failed rows
                </a>
              )}
            </div>
          )}
          {namesResult && (
            <div style={{ fontSize: 12, color: '#2563eb', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <span>{namesResult.message}</span>
            </div>
          )}
          <details style={{ marginTop: 8, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Expected columns</summary>
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', justifyContent: 'center' }}>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Donor Name</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Receipt No</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}> Amt </span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Receipt Date</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Time</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Mobile No.</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>MOP</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Mail Id</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Payment Id No.</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Received Bank</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Pan No</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Address-1</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Project Supported</span>
              <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>Donors Bank Name</span>
            </div>
            {uploadMode === 'names' && (
              <p style={{ marginTop: 6, fontSize: 10, color: '#2563eb', fontWeight: 600 }}>Names mode only needs: Receipt No + Receipt Name / Donor Name</p>
            )}
          </details>
        </div>
        )}
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-pad">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:8 }}>
            <div>
              <h3 style={{ margin:0, fontSize:15, fontWeight:600 }}>Verified receipts awaiting WhatsApp {filteredDonors ? <span style={{ fontSize:12, fontWeight:400, color:'#9ca3af' }}>({filteredDonors.length})</span> : <span className="sk" style={{ display:'inline-block', width:60, height:14, borderRadius:3, verticalAlign:'middle' }} />}</h3>
              <p style={{ margin:'3px 0 0', fontSize:11, color:'var(--ink-soft)' }}>Sent receipts are available only in Donors.</p>
            </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn btn-sm" style={{ background:'#059669', color:'#fff', border:'none' }}
                    onClick={handleSendAllWhatsApp}
                    disabled={bulkState.active || getValidDonors().length === 0 || !getValidDonors().every(v => previewedIds.has(v.receipt_id))}>
                    Send All ({getValidDonors().length})
                  </button>
                  <button className="btn btn-sm" style={{ background:'#2563eb', color:'#fff', border:'none' }}
                    onClick={handleMarkAllSent}
                    disabled={markingAllSent || !filteredDonors?.some(donor => donor.receipt_id)}>
                    {markingAllSent
                      ? `Updating ${markAllProgress.completed}/${markAllProgress.total}...`
                      : `Mark all sent (${filteredDonors?.filter(donor => donor.receipt_id).length || 0})`}
                  </button>
                </div>
              </div>
                <div style={{ display:'flex', gap:6, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
                  <input type="text" placeholder="Search receipt no..."
                    value={receiptSearch} onChange={e => setReceiptSearch(e.target.value)}
                    style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12, width:150, marginRight:4 }} />
                  {[{ k:'all', l:'All' }, ...Object.entries(NGO_MAP).map(([k, v]) => ({ k, l:v.label }))].map(tab => {
                    const count = tab.k === 'all' ? (donors?.length || 0)
                      : (donors || []).filter(d => (d['Project'] || 'bsct') === tab.k).length
                    return (
                      <button key={tab.k} className="btn btn-sm" onClick={() => setNgoFilter(tab.k)}
                        style={{ background: ngoFilter === tab.k ? '#5B6B4E' : '#f3f4f6', color: ngoFilter === tab.k ? '#fff' : '#374151', border:'none', fontWeight:600 }}>
                        {tab.l} <span style={{ fontSize:11, opacity:0.8 }}>({count})</span>
                      </button>
                    )
                  })}
                </div>
              <table className="table-wrap" style={{ width:'100%', fontSize:13 }}>
                <thead>
                  <tr>
                    <th>#</th><th>Donor Name</th><th>Amount</th><th>Receipt No.</th><th>Date</th><th>NGO</th><th>Mobile</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        <td><div className="sk" style={{ width:20, height:12, borderRadius:3 }} /></td>
                        <td><div className="sk" style={{ width:'55%', height:12, borderRadius:3 }} /></td>
                        <td><div className="sk" style={{ width:60, height:12, borderRadius:3 }} /></td>
                        <td><div className="sk" style={{ width:80, height:12, borderRadius:3 }} /></td>
                        <td><div className="sk" style={{ width:70, height:12, borderRadius:3 }} /></td>
                        <td><div className="sk" style={{ width:55, height:12, borderRadius:3 }} /></td>
                        <td><div className="sk" style={{ width:90, height:12, borderRadius:3 }} /></td>
                        <td><div className="sk" style={{ width:70, height:24, borderRadius:4 }} /></td>
                      </tr>
                    ))
                  ) : filteredDonors.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign:'center', padding:30, color:'var(--ink-soft)' }}>{ngoFilter === 'all' ? 'No pending receipts.' : `No pending receipts for ${NGO_MAP[ngoFilter]?.label || ngoFilter}.`}</td></tr>
                  ) : filteredDonors.slice((receiptPage - 1) * PAGE_SIZE, receiptPage * PAGE_SIZE).map((d, i) => {
                    const realIdx = (receiptPage - 1) * PAGE_SIZE + i;
                    const rowId = d.receipt_id;
                    return (
                    <tr key={rowId || realIdx} style={{ background: selectedId != null && selectedId === rowId ? '#f0fdf4' : undefined, cursor:'pointer' }}
                      onClick={() => setSelectedId(rowId)}>
                      <td>{realIdx + 1}</td>
                      <td style={{ fontWeight:500 }}>{d['Donor Name']}</td>
                      <td style={{ color:'#059669', fontWeight:600 }}>{formatIndianCurrency(d['Amount'])}</td>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{d['Receipt No.']}</td>
                      <td style={{ fontSize:12 }}>{formatReceiptDate(d['Receipt Date'])}</td>
                      <td>
                        {(() => {
                          const ng = d['Project'] || 'bsct'
                          const st = { bsct:{background:'#dbeafe',color:'#1d4ed8'}, aflf:{background:'#dcfce7',color:'#166534'}, mann:{background:'#fce7f3',color:'#be185d'} }[ng]
                            || { background:'#f3f4f6', color:'#374151' }
                          return <span style={{ display:'inline-block', padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:600, ...st }}>{NGO_MAP[ng]?.label || ng}</span>
                        })()}
                      </td>
                        <td style={{ fontSize:12, cursor:'pointer' }} onClick={e => { e.stopPropagation(); setEditingId(editingId === rowId ? null : rowId) }}>
                        {editingId === rowId ? (
                          <input className="field-input" type="tel" value={d['Mobile No.'] || ''} autoFocus
                            onChange={e => updatePhone(rowId, e.target.value)}
                            onBlur={() => setEditingId(null)}
                            onKeyDown={e => { if (e.key === 'Enter') setEditingId(null) }}
                            style={{ width:120, height:28, padding:'2px 6px', fontSize:12 }}
                            onClick={e => e.stopPropagation()} />
                        ) : d['Mobile No.'] || <span style={{ color:'#d1d5db' }}>Click to add</span>}
                      </td>
                      <td style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        {previewedIds.has(rowId) && (
                          <button className="btn btn-sm" style={{ fontSize:11, padding:'4px 10px', background:'#25D366', color:'#fff', border:'none' }}
                            onClick={e => { e.stopPropagation(); handleSendSingle(d, rowId) }}
                            disabled={sendingId === rowId}>
                            {sendingId === rowId ? '...' : 'Send'}
                          </button>
                        )}
                        <button className="btn btn-sm" style={{ fontSize:11, padding:'4px 6px', background:'#fff', color:'#6b7280', border:'1px solid #d1d5db', display:'flex', alignItems:'center', gap:4 }}
                          onClick={e => { e.stopPropagation(); handleEditReceipt(d) }}>
                          <Pencil size={11} strokeWidth={2} /> Edit
                        </button>
                        <button className="btn btn-sm" style={{ fontSize:11, padding:'4px 8px', background:'#fff', color:'#b45309', border:'1px solid #fcd34d' }}
                          onClick={e => { e.stopPropagation(); setGoBackRow(d) }}
                          title='Undo and return to Bank Audit'>
                          {'\u21a9 Go Back'}
                        </button>
                        <button className="btn btn-sm" style={{ fontSize:11, padding:'4px 10px' }}
                          onClick={e => { e.stopPropagation(); if (d.receipt_id) setPreviewedIds(prev => new Set(prev).add(d.receipt_id)); setPreviewRow(d) }}>Preview</button>
                      </td>
                    </tr>
                  )})}
                  {!loading && filteredDonors.length > 0 && (
                    <tr style={{ borderTop: '2px solid var(--sage)', background: '#F6F8F7', fontWeight: 700 }}>
                      <td style={{ padding: '9px 12px' }}>Total</td>
                      <td></td>
                      <td style={{ padding: '9px 12px', color: '#059669' }}>
                        {formatIndianCurrency(filteredDonors.reduce((s, d) => s + Number(d['Amount'] || 0), 0))}
                      </td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td style={{ padding: '9px 12px' }}>{filteredDonors.length} rows</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {filteredDonors && filteredDonors.length > PAGE_SIZE && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 0', borderTop:'1px solid var(--line)' }}>
                  <button className="btn btn-sm" disabled={receiptPage === 1} onClick={() => setReceiptPage(p => Math.max(1, p - 1))}>Prev</button>
                  <span style={{ fontSize:12, color:'var(--ink-soft)' }}>Page {receiptPage} of {Math.ceil(filteredDonors.length / PAGE_SIZE)} ({filteredDonors.length} records)</span>
                  <button className="btn btn-sm" disabled={receiptPage >= Math.ceil(filteredDonors.length / PAGE_SIZE)} onClick={() => setReceiptPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          </div>

          <ReceiptHistory />

          {donors && (<div style={{ position:'fixed', left:'-9999px', top:0, width:'1000px', opacity:0, pointerEvents:'none', zIndex:-1 }}>
            {donors.length <= 100 && donors.map((d, i) => {
              const ngo = d['Project'] || 'bsct'
              const tpl = getNgoSettings(ngo)
              const Comp = tpl.comp
              return <div key={d.receipt_id || i} data-receipt-batch={d.receipt_id}><Comp donor={d} project={ngo} /></div>
            })}
          </div>)}

          {previewRow && (
            <div className="modal-overlay" onClick={() => setPreviewRow(null)} style={{ zIndex:3000 }}>
              <div className="modal" style={{ width:'min(900px, calc(100vw - 40px))', maxWidth:900, height:'min(760px, calc(100vh - 40px))', maxHeight:'calc(100vh - 40px)', display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>
                <div className="modal-header" style={{ flexShrink:0 }}>
                  <h3 style={{ fontSize:15 }}>{previewRow['Donor Name']} — {getNgoSettings(previewRow['Project'] || 'bsct').label}</h3>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <button className="btn btn-primary btn-sm" onClick={handleDownloadSingle} disabled={downloadSingle}>
                      {downloadSingle ? 'Generating...' : 'Download PDF'}
                    </button>
                    <button className="btn btn-sm" onClick={handlePrint}>Print</button>
                    <button className="btn btn-sm" onClick={() => setPreviewRow(null)}>Close</button>
                  </div>
                </div>
                <div ref={previewBodyRef} className="modal-body" style={{ flex:1, minHeight:0, overflow:'auto', padding:20, display:'flex', alignItems:'flex-start', justifyContent:'center' }}>
                  {(() => {
                    const ngo = previewRow['Project'] || 'bsct'
                    const tpl = getNgoSettings(ngo)
                    const Comp = tpl.comp
                    return (
                      <div data-receipt style={{ display:'inline-block', zoom:previewScale }}>
                        <Comp donor={previewRow} project={ngo} />
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          )}

          {goBackRow && (
            <div className="modal-overlay" onClick={() => { setGoBackRow(null) }} style={{ zIndex:1000 }}>
              <div className="modal" style={{ maxWidth:440, width:'92%' }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3 style={{ fontSize:15 }}>{'\u21a9'} Undo Verification</h3>
                </div>
                <div className="modal-body">
                  <p style={{ margin:0, fontSize:14, fontWeight:600 }}>Return <span style={{ color:'var(--accent)' }}>{goBackRow['Donor Name'] || 'this receipt'}</span> to Bank Audit?</p>
                  <p style={{ margin:0, fontSize:12.5, color:'var(--ink-soft)', lineHeight:1.5 }}>
                    The receipt will be deleted, the receipt number freed, the donor totals reversed, and the bank audit entry (if any) reverted to unverified.
                  </p>
                  <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:4 }}>
                    <button className="btn btn-sm" onClick={() => { setGoBackRow(null) }}>Cancel</button>
                    <button className="btn btn-sm" style={{ background:'#d97706', color:'#fff', border:'none' }} onClick={handleGoBack} disabled={goBackSubmitting}>
                      {goBackSubmitting ? 'Undoing...' : 'Undo'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

      {editingReceipt && (
        <div className="modal-overlay" onClick={() => { setEditingReceipt(null); setConfirmFroChange(false); }} style={{ zIndex:4000 }}>
          <div className="modal" style={{ maxWidth:520, width:'90%', maxHeight:'85vh', overflow:'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize:15 }}>Edit Receipt — {editingReceipt['Receipt No.'] || 'No number'}</h3>
              <button onClick={() => { setEditingReceipt(null); setConfirmFroChange(false); }}
                style={{ border:'none', background:'#e5e7eb', color:'#374151', borderRadius:6, width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body" style={{ padding:20 }}>
              {confirmFroChange && (
                <div style={{ background:'#fef3c7', border:'1px solid #f59e0b', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#92400e' }}>
                  <strong>FRO Change Detected</strong><br />
                  Credit of {currency(editingReceipt['Amount'])} will be reversed from <strong>{editingReceipt['Agent Name'] || '\u2014'}</strong> and applied to <strong>{editForm.agent_name}</strong>.
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {[
                  { label:'Donor Name', key:'donor_name', colSpan:2 },
                  { label:'Mobile', key:'donor_mobile' },
                  { label:'Address', key:'address', colSpan:2, type:'textarea' },
                  { label:'PAN Number', key:'pan_number' },
                  { label:'Email', key:'email' },
                  { label:'FRO / Agent', key:'agent_name', type:'select' },
                  { label:'Mode', key:'mode', type:'mop' },
                  { label:'Account Of', key:'account_of' },
                ].map(({ label, key, colSpan, type }) => (
                  <label key={key} style={{ gridColumn:colSpan === 2 ? '1 / -1' : undefined, fontSize:11, color:'#6b7280', fontWeight:600, display:'flex', flexDirection:'column', gap:4 }}>
                    {label}
                    {type === 'select' ? (
                      <select value={editForm[key] || ''} onChange={e => setEditForm(f => ({ ...f, [key]:e.target.value }))}
                        style={{ padding:'7px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12, background:'#fff' }}>
                        <option value="">Not assigned</option>
                        {froWorkers.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                      </select>
                    ) : type === 'mop' ? (
                      <select value={editForm[key] || ''} onChange={e => setEditForm(f => ({ ...f, [key]:e.target.value }))}
                        style={{ padding:'7px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12, background:'#fff' }}>
                        <option value="">\u2014</option>
                        {['UPI','Google Pay','Freecharge','razorpay','online','PUM','Cheque','Paytm','Cash','Bank Transfer','NEFT','RTGS','others'].map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                        {editForm.mode && !['UPI','Google Pay','Freecharge','razorpay','online','PUM','Cheque','Paytm','Cash','Bank Transfer','NEFT','RTGS','others'].includes(editForm.mode) && (
                          <option value={editForm.mode}>{editForm.mode}</option>
                        )}
                      </select>
                    ) : type === 'textarea' ? (
                      <textarea value={editForm[key] || ''} onChange={e => setEditForm(f => ({ ...f, [key]:e.target.value }))}
                        rows={2} style={{ padding:'7px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12, resize:'vertical' }} />
                    ) : (
                      <input type={key === 'email' ? 'email' : 'text'} value={editForm[key] || ''} onChange={e => setEditForm(f => ({ ...f, [key]:e.target.value }))}
                        style={{ padding:'7px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12 }} />
                    )}
                  </label>
                ))}
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:18 }}>
                <button onClick={() => { setEditingReceipt(null); setConfirmFroChange(false); }}
                  style={{ padding:'7px 16px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  Cancel
                </button>
                <button onClick={handleSaveEdit} disabled={editSaving}
                  style={{ padding:'7px 16px', borderRadius:8, border:'none', background:confirmFroChange ? '#f59e0b' : '#059669', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', opacity:editSaving ? 0.6 : 1 }}>
                  {editSaving ? 'Saving...' : confirmFroChange ? 'Confirm & Save' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCleanModal && (
        <div className="modal-overlay" onClick={() => !deleting && setShowCleanModal(false)} style={{ zIndex:2000 }}>
          <div className="modal" style={{ maxWidth:400, width:'90%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize:15, margin:0 }}>Delete Receipts by Date</h3>
              <button className="btn btn-sm" onClick={() => setShowCleanModal(false)} disabled={deleting}>Cancel</button>
            </div>
            <div className="modal-body" style={{ padding:20 }}>
              <div style={{ display:'flex', gap:8, marginBottom:14 }}>
                <label style={{ flex:1, fontSize:11, color:'#6b7280', fontWeight:600 }}>
                  From
                  <input type="date" value={cleanFrom} onChange={e => setCleanFrom(e.target.value)}
                    disabled={deleting}
                    style={{ width:'100%', marginTop:4, padding:'7px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12 }} />
                </label>
                <label style={{ flex:1, fontSize:11, color:'#6b7280', fontWeight:600 }}>
                  To
                  <input type="date" value={cleanTo} onChange={e => setCleanTo(e.target.value)}
                    disabled={deleting}
                    style={{ width:'100%', marginTop:4, padding:'7px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12 }} />
                </label>
              </div>
              <p style={{ fontSize:13, color:'#374151', marginBottom:14, textAlign:'center' }}>
                This will permanently delete all receipts between <strong>{cleanFrom || '...'}</strong> and <strong>{cleanTo || cleanFrom || '...'}</strong>.
              </p>
              <p style={{ fontSize:12, color:'#9ca3af', marginBottom:4, textAlign:'center' }}>Donor donation history for affected donors will also be removed.</p>
              <p style={{ fontSize:12, color:'#9ca3af', marginBottom:16, textAlign:'center' }}>This action cannot be undone.</p>
              {deleting ? (
                <div style={{ textAlign:'center' }}>
                  <p style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>{deleteStatus}</p>
                  <div style={{ height:6, background:'#e5e7eb', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${deleteProgress}%`, background:'#dc2626', borderRadius:3, transition:'width .3s' }} />
                  </div>
                </div>
              ) : (
                <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                  <button className="btn btn-sm" onClick={() => setShowCleanModal(false)} style={{ padding:'6px 16px' }}>Cancel</button>
                  <button className="btn btn-sm" onClick={handleCleanUpDate}
                    style={{ background:'#dc2626', color:'#fff', border:'none', padding:'6px 16px' }}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmBulkModal visible={confirmBulk.visible} donorCount={confirmBulk.donorCount} projectName="" onConfirm={handleConfirmBulkSend} onCancel={() => setConfirmBulk({ visible:false, donorCount:0 })} />
      <BulkProgressModal visible={bulkState.active} total={bulkState.total} sent={bulkState.sent} failed={bulkState.failed} currentBatch={bulkState.currentBatch} totalBatches={bulkState.totalBatches} results={bulkState.results} previousBatches={bulkState.previousBatches} onCancel={() => { cancelBulkRef.current = true; setBulkState(prev => ({ ...prev, cancelled:true })) }} />
      <Toast message={toast.message} type={toast.type} visible={toast.visible} onClose={hideToast} />
    </div>
  )
}

import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { apiPost } from '../store'

// Sheet columns the Accounts panel accepts. Only "Member Name" is mandatory —
// every other header is matched loosely so real-world sheets (Member Name vs
// Name, Number vs Mobile No., ...) still import without hand-editing.
const COLUMNS = [
  { key: 'full_name', label: 'Member Name', required: true, type: 'text', width: 22, aliases: ['member name', 'membername', 'name of member', 'beneficiary name', 'full name', 'name', 'member'] },
  { key: 'mobile', label: 'Number', type: 'phone', width: 15, aliases: ['number', 'mobile number', 'mobile no', 'mobileno', 'mobile', 'phone number', 'phone no', 'phone', 'contact number', 'contact no', 'contact'] },
  { key: 'disability_percentage', label: '% of Disability', type: 'number', width: 12, aliases: ['of disability', 'disability percentage', 'disability percent', 'disability %', 'percent disability', 'percentage of disability', '% disability', 'disability'] },
  { key: 'disability_type', label: 'Type of Disability', type: 'text', width: 20, aliases: ['type of disability', 'disability type', 'type disability', 'disability category', 'nature of disability', 'disability'] },
  { key: 'alternate_mobile', label: 'Alternate Number', type: 'phone', width: 15, aliases: ['alternate number', 'alternate mobile', 'alternate mobile number', 'alternate no', 'alt number', 'alt mobile', 'secondary number', 'second number'] },
  { key: 'location', label: 'Location', type: 'text', width: 22, aliases: ['location', 'address', 'address line 1', 'village', 'area', 'place'] },
  { key: 'needed', label: 'Needed Type', type: 'text', width: 20, aliases: ['needed type', 'neededtype', 'type of need', 'need type', 'needed', 'requirement', 'requirement type', 'service needed', 'support needed'] },
  { key: 'ngo', label: 'NGO', type: 'text', width: 20, aliases: ['ngo', 'ngo name', 'ngo code', 'organisation', 'organization', 'serving ngo', 'assigned ngo'] },
  { key: 'state', label: 'State', type: 'text', width: 16, aliases: ['state', 'state name'] },
  { key: 'age', label: 'Age', type: 'number', width: 8, aliases: ['age', 'age in years', 'years'] },
  { key: 'date_of_birth', label: 'DOB', type: 'date', width: 14, aliases: ['dob', 'date of birth', 'dateofbirth', 'birth date', 'birthdate'] },
  { key: 'gender', label: 'Gender', type: 'text', width: 10, aliases: ['gender', 'sex'] },
]

const normHeader = (h) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// How many columns this header row names outright. Used to tell a real header
// row from a banner above it: "NGO member list 2026" loosely matches the word
// "member", but only a true header matches several columns exactly.
const exactMatchCount = (headers) => {
  const normalized = headers.map(normHeader)
  return COLUMNS.reduce((n, col) => n + (col.aliases.some((a) => normalized.includes(a)) ? 1 : 0), 0)
}

// Longest alias wins, so "needed type" is claimed before a bare "needed" and
// "alternate number" before a bare "number". Returns a column index per key.
const matchColumns = (headers) => {
  const map = {}
  const normalized = headers.map((h, i) => ({ i, n: normHeader(h) }))
  const taken = new Set()
  for (const col of COLUMNS) {
    const aliases = [...col.aliases].sort((a, b) => b.length - a.length)
    let hit = normalized.find((h) => aliases.includes(h.n))
    if (!hit) {
      for (const alias of aliases) {
        hit = normalized.find((h) => h.n.includes(alias))
        if (hit) break
      }
    }
    if (hit && !taken.has(hit.i)) {
      taken.add(hit.i)
      map[col.key] = hit.i
    }
  }
  return map
}

// Real sheets are messy: a cell can hold two numbers ("8268111557/ 9967777103")
// or a placeholder ("NA", "-", "0"). Pull the first genuine 10-digit number out
// of each cell and drop the placeholders, so one bad row no longer produces a
// mangled number that can collide with a different member.
const PLACEHOLDERS = new Set(['na', 'n/a', 'nil', 'none', 'null', 'undefined', '-', '--', '---', '0'])
const numbersIn = (v) => {
  const s = String(v ?? '').trim().replace(/\.0+$/, '') // "8928460119.0"
  if (!s || PLACEHOLDERS.has(s.toLowerCase())) return []
  const found = []
  for (const token of s.split(/[/,;|&\n\t]+|\s{2,}/)) {
    const digits = token.replace(/\D/g, '')
    if (digits.length >= 10) found.push(digits.slice(-10))
  }
  // Numbers written with single spaces ("98765 43210") or run together.
  if (found.length === 0) {
    const digits = s.replace(/\D/g, '')
    if (digits.length >= 10) found.push(digits.slice(0, 10))
  }
  return found
}

// Walks the worksheet cell by cell instead of using sheet_to_json, which
// counts blank rows as data (a 442-row file reported 484 members) and loses
// the real Excel row number. Empty rows are skipped and every surviving row
// keeps the sheet row it came from, so the report points at the right line.
const readSheet = (workbook) => {
  const ws = workbook.Sheets[workbook.SheetNames[0]]
  if (!ws || !ws['!ref']) return { headers: [], records: [] }
  const range = XLSX.utils.decode_range(ws['!ref'])

  const readCell = (r, c, type) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })]
    if (!cell || cell.v == null) return ''
    if (type === 'date') {
      if (cell.t === 'd' && cell.v instanceof Date) return cell.v.toISOString().slice(0, 10)
      if (cell.t === 'n' && Number.isFinite(cell.v) && cell.v > 20000 && cell.v < 60000) {
        const d = XLSX.SSF.parse_date_code(cell.v)
        if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
      }
    }
    // Raw value for numbers keeps long phone numbers free of display
    // formatting; display text otherwise.
    return String(cell.t === 'n' ? cell.v : (cell.w ?? cell.v)).trim()
  }

  const rowValues = (r) => {
    const out = []
    for (let c = range.s.c; c <= range.e.c; c++) out.push(readCell(r, c))
    return out
  }

  // Header = the row that names the most columns outright, so a title/banner
  // row above the real header does not shadow it. Falls back to the first row
  // with any content, which is what the error message reports.
  let headerRow = -1
  let headers = []
  let colMap = {}
  let bestScore = -1
  const scanTo = Math.min(range.e.r, range.s.r + 20)
  for (let r = range.s.r; r <= scanTo; r++) {
    const values = rowValues(r)
    if (!values.some(Boolean)) continue
    const map = matchColumns(values)
    if (map.full_name === undefined) continue
    const score = exactMatchCount(values)
    if (score > bestScore) {
      bestScore = score
      headerRow = r
      headers = values
      colMap = map
    }
  }
  if (headerRow < 0) {
    for (let r = range.s.r; r <= scanTo; r++) {
      const values = rowValues(r)
      if (values.some(Boolean)) { headerRow = r; headers = values; colMap = matchColumns(values); break }
    }
    if (headerRow < 0) return { headers: [], records: [] }
  }

  const records = []
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const values = rowValues(r)
    if (!values.some(Boolean)) continue

    const row = { _rowNumber: r + 1 }
    for (const col of COLUMNS) {
      row[col.key] = colMap[col.key] === undefined ? '' : values[colMap[col.key]]
    }
    // A row that is empty across every mapped column is sheet padding, not a
    // member - dropping it keeps the count equal to the file's row count.
    if (!COLUMNS.some((c) => row[c.key] !== '')) continue

    if (row.alternate_mobile === '' && row.mobile !== '') {
      const both = numbersIn(row.mobile)
      row.mobile = both[0] ?? ''
      row.alternate_mobile = both[1] ?? ''
    }
    row.mobile = numbersIn(row.mobile)[0] ?? ''
    row.alternate_mobile = numbersIn(row.alternate_mobile)[0] ?? ''
    row._valid = !!row.full_name
    records.push(row)
  }
  return { headers, records, colMap }
}

const STATUS_LABELS = {
  created: 'Member Added',
  updated: 'Member Updated',
  no_change: 'Already Complete',
  skipped: 'Skipped',
  error: 'Failed',
}

const STATUS_STYLES = {
  created: { background: '#dcfce7', color: '#166534' },
  updated: { background: '#dbeafe', color: '#1e40af' },
  no_change: { background: '#e5e7eb', color: '#374151' },
  skipped: { background: '#fef3c7', color: '#92400e' },
  error: { background: '#fee2e2', color: '#991b1b' },
}

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' },
  title: { fontSize: '20px', fontWeight: 700, color: 'var(--ink)', margin: 0 },
  sub: { fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px', maxWidth: '760px', lineHeight: 1.5 },
  card: { background: 'var(--card-bg)', boxShadow: 'var(--shadow)', borderRadius: 'var(--radius)', border: '1px solid var(--line)', overflow: 'hidden', marginBottom: '16px' },
  bar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '14px 16px', borderBottom: '1px solid var(--line)' },
  btn: { padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  input: { padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', fontSize: '13px', outline: 'none' },
  drop: { margin: '16px', border: '2px dashed var(--line)', borderRadius: 'var(--radius)', padding: '36px', textAlign: 'center', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  th: { padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid var(--line)', fontWeight: 600, color: 'var(--ink-soft)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--bg)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid var(--bg)', color: 'var(--ink)', whiteSpace: 'nowrap' },
  pill: (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: bg, color: fg, textTransform: 'uppercase' }),
  stat: { background: 'var(--bg)', borderRadius: 'var(--radius-sm)', padding: '10px 14px' },
}

const Chip = ({ value, label, color }) => (
  <div style={styles.stat}>
    <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--ink)' }}>{value}</div>
    <div style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
  </div>
)

const cell = (v) => {
  if (v == null || v === '') return '\u2014'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

export default function ImportMembers() {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [colMap, setColMap] = useState({})
  const [error, setError] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  const processFile = (file) => {
    setError(null); setResult(null); setRows([]); setColMap({}); setFileName(''); setParsing(true)
    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
      setError('Please upload a valid file (.xlsx, .xls, or .csv)'); setParsing(false); return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const { headers, records, colMap } = readSheet(workbook)
        if (headers.length === 0) { setError('File is empty'); setParsing(false); return }
        if (!records.length) { setError('No data rows found below the header'); setParsing(false); return }
        if (colMap.full_name === undefined) {
          setError(`Could not find a "Member Name" column. Detected headers: ${headers.filter(Boolean).join(', ')}`)
          setParsing(false); return
        }
        setRows(records)
        setColMap(Object.fromEntries(
          Object.entries(colMap).map(([k, i]) => [k, headers[i] || `column ${i + 1}`])
        ))
        setFileName(file.name)
      } catch { setError('Failed to parse file') }
      setParsing(false)
    }
    reader.onerror = () => { setError('Failed to read file'); setParsing(false) }
    reader.readAsArrayBuffer(file)
  }

  const downloadTemplate = () => {
    const example = [{
      'Member Name': 'Ram Kumar',
      'Number': '9876543210',
      '% of Disability': 60,
      'Type of Disability': 'Locomotor',
      'Alternate Number': '9123456780',
      'Location': 'Village Rampur, Block Sadar',
      'Needed Type': 'Wheelchair',
      'NGO': '',
      'State': 'Uttar Pradesh',
      'Age': 34,
      'DOB': '1992-04-18',
      'Gender': 'Male',
    }]
    const ws = XLSX.utils.json_to_sheet(example, { header: COLUMNS.map(c => c.label) })
    ws['!cols'] = COLUMNS.map((c) => ({ wch: c.width }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Members')
    XLSX.writeFile(wb, 'beneficiary_member_import_template.xlsx')
  }

  const handleImport = async () => {
    if (rows.length === 0 || importing) return
    setImporting(true); setError(null); setResult(null)
    try {
      const payload = rows
        .filter((r) => r._valid)
        .map((r) => {
          const o = { _rowNumber: r._rowNumber }
          for (const col of COLUMNS) o[col.key] = r[col.key]
          return o
        })
      const res = await apiPost('/beneficiaries/import/members', { rows: payload, file_name: fileName })
      setResult(res)
    } catch (e) {
      setError('Import failed: ' + (e.message || 'unknown error'))
    } finally {
      setImporting(false)
    }
  }

  const downloadReport = () => {
    const report = (result?.results || []).map((r) => ({
      'Excel Row': r.row,
      'Member Name': r.name || '',
      'Number': r.mobile || '',
      'Beneficiary Code': r.beneficiary_code || '',
      'Needed Type': r.needed || '',
      'NGO In Sheet': r.ngo || '',
      'NGO Assigned': r.ngo_name || '',
      Status: STATUS_LABELS[r.status] || r.status,
      Details: r.message || '',
      Warnings: (r.warnings || []).join('; '),
    }))
    const ws = XLSX.utils.json_to_sheet(report)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Import Report')
    XLSX.writeFile(wb, `member_import_report_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const readyCount = rows.filter((r) => r._valid).length
  const skippedCount = rows.length - readyCount
  const s = result?.summary
  const done = (s?.created ?? 0) + (s?.updated ?? 0)

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Import Members</h2>
          <div style={styles.sub}>
            Upload an Excel sheet to add members in bulk. Columns: <strong>Member Name</strong> (required), Number, % of Disability,
            Type of Disability, Alternate Number, Location, Needed Type, NGO, State, Age, DOB, Gender.
            A member already registered under the same number is updated with the missing details instead of being duplicated,
            and <em>Age</em> is converted to DOB when DOB is blank.
          </div>
        </div>
        <button onClick={downloadTemplate} style={{ ...styles.btn, background: 'var(--bg)', color: 'var(--ink)' }}>
          Download Template
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.bar}>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            {rows.length > 0
              ? <><strong style={{ color: 'var(--ink)' }}>{readyCount}</strong> of {rows.length} row(s) ready to import</>
              : 'No file loaded yet'}
          </div>
          {rows.length > 0 && (
            <button
              onClick={handleImport}
              disabled={importing || readyCount === 0}
              style={{
                ...styles.btn, marginLeft: 'auto',
                background: readyCount === 0 ? 'var(--bg)' : 'var(--sage)', color: readyCount === 0 ? 'var(--ink-soft)' : '#fff',
                cursor: readyCount === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {importing ? 'Importing...' : `Import ${readyCount} Member${readyCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
          onClick={() => fileRef.current?.click()}
          style={{
            ...styles.drop,
            borderColor: dragOver ? 'var(--sage)' : 'var(--line)',
            background: dragOver ? 'rgba(91,107,78,.06)' : 'transparent',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ color: 'var(--ink-soft)', marginBottom: 8 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {parsing ? 'Parsing...' : fileName || 'Drop Excel file here or click to browse'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
            .xlsx / .xls / .csv &middot; only the first sheet is read
          </div>
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
            onChange={(e) => { const f = e.target.files[0]; if (f) processFile(f); e.target.value = '' }}
            style={{ display: 'none' }}
          />
        </div>

        {error && (
          <div style={{ margin: '0 16px 14px', padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, margin: '0 16px 12px' }}>
              <Chip value={rows.length} label="Total Rows" />
              <Chip value={readyCount} label="Ready" color="#16a34a" />
              <Chip value={skippedCount} label="Missing Member Name" color={skippedCount ? '#dc2626' : 'var(--ink)'} />
            </div>

            <div style={{ margin: '0 16px 10px', fontSize: 11, color: 'var(--ink-soft)' }}>
              Mapped columns:{' '}
              {COLUMNS.filter((c) => colMap[c.key]).map((c) => `${c.label} \u2190 "${colMap[c.key]}"`).join(' \u00b7 ') || 'none'}
            </div>

            <div style={{ maxHeight: 340, overflow: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Row</th>
                    {COLUMNS.map((c) => <th key={c.key} style={styles.th}>{c.label}{c.required ? ' *' : ''}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r._rowNumber} style={!r._valid ? { background: '#fef2f2' } : undefined}>
                      <td style={{ ...styles.td, color: 'var(--ink-soft)' }}>{r._rowNumber}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} style={{ ...styles.td, fontFamily: c.type === 'phone' || c.type === 'number' || c.type === 'date' ? 'monospace' : undefined }}>
                          {cell(r[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {result && (
        <div style={styles.card}>
          <div style={styles.bar}>
            <div style={{ fontSize: 14, fontWeight: 700, color: done > 0 ? '#15803d' : '#b45309' }}>
              {done > 0
                ? `\u2713 Import finished \u2014 ${s.created} member(s) added, ${s.updated} existing member(s) updated`
                : 'Import finished \u2014 no member needed changes'}
            </div>
            <button onClick={downloadReport} style={{ ...styles.btn, marginLeft: 'auto', background: 'var(--bg)', color: 'var(--ink)' }}>
              Download Full Report
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, margin: '0 16px 12px' }}>
            <Chip value={s.created ?? 0} label="Members Added" color="#16a34a" />
            <Chip value={s.updated ?? 0} label="Members Updated" color="#1e40af" />
            <Chip value={s.no_change ?? 0} label="Already Complete" />
            <Chip value={(s.skipped ?? 0) + (s.errors ?? 0)} label="Skipped / Failed" color="#dc2626" />
          </div>

          <div style={{ maxHeight: 340, overflow: 'auto', margin: '0 16px 16px' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Row</th>
                  <th style={styles.th}>Member Name</th>
                  <th style={styles.th}>Number</th>
                  <th style={styles.th}>NGO</th>
                  <th style={styles.th}>Needed Type</th>
                  <th style={styles.th}>Code</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {(result.results || []).map((r, i) => (
                  <tr key={`${r.row}-${i}`} style={r.status === 'error' ? { background: '#fef2f2' } : undefined}>
                    <td style={{ ...styles.td, color: 'var(--ink-soft)' }}>{r.row}</td>
                    <td style={styles.td}>{r.name || '\u2014'}</td>
                    <td style={{ ...styles.td, fontFamily: 'monospace' }}>{r.mobile || '\u2014'}</td>
                    <td style={styles.td}>
                      {r.ngo_name || (r.ngo ? <span style={{ color: '#92400e' }}>{r.ngo} (not linked)</span> : '—')}
                    </td>
                    <td style={styles.td}>{r.needed || '—'}</td>
                    <td style={styles.td}>{r.beneficiary_code ? <code style={{ fontSize: 11, background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>{r.beneficiary_code}</code> : '\u2014'}</td>
                    <td style={styles.td}>
                      <span style={styles.pill(...(STATUS_STYLES[r.status] || ['var(--bg)', 'var(--ink-soft)']))}>
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </td>
                    <td style={{ ...styles.td, whiteSpace: 'normal' }}>
                      {r.message}
                      {r.warnings?.length > 0 && (
                        <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>{r.warnings.join(' \u00b7 ')}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

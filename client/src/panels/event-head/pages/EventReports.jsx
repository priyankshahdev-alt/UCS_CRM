import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchEvents, generateEventReport, generateAllEventsReport, generateNgoMonthlyReport, setMonthlyReportCardOrder, fetchWorkspaceNgos, uploadEventBanner, updateEvent, fetchEventBannerObjectUrl, fetchEventImageDataUrl, fetchMediaViewObjectUrl } from '../store'
import EventPosterReport from '../components/EventPosterReport'
import { exportPosterToPdf } from '../components/eventPosterPdf.jsx'

// Per-NGO brand theme (colors + logo) keyed by NGO code. Colors match the
// uploaded AFLF/BSCT/MANN report images.
const NGO_THEMES = {
  mann: {
    name: 'MANN',
    fullName: 'Mann Care Foundation',
    tagline: 'Mann Care Foundation',
    logo: '/logo/mann-logo.png',
    color: '#F42D92',
    colorDark: '#C23875',
    colorLight: '#FDE7F3',
    accent: '#F42D92',
    headingColor: '#C23875',
    footerBg: '#F42D92',
    banner: '/Letter%20Head%20MANN.png',
    contact: {
      phone: '+91 7039006300 / +91 7039006400',
      email: 'manncarefoundation@gmail.com',
      website: 'www.manncarefoundation.org',
      address: '1708, One World, S.V. Road, Near N.M. High School, Malad (West), Mumbai - 400064',
    },
    social: [],
  },
  bsct: {
    name: 'BSCT',
    fullName: 'Being Sevak Charitable Trust',
    tagline: 'Being Sevak Charitable Trust',
    logo: '/logo/beingsevak-logo.png',
    color: '#204E8C',
    colorDark: '#16365f',
    colorLight: '#EAF1FB',
    accent: '#FFC72C',
    headingColor: '#204E8C',
    footerBg: '#204E8C',
    banner: null,
    contact: {
      phone: '8879-035-035 / 8879-034-034',
      email: 'being.sevak@gmail.com',
      website: 'www.beingsevak.org',
      address: "401, 4th Floor, 'A' Wing, New Delite Apartment, Chandavarkar Lane, Borivali (West), Mumbai - 92.",
    },
    social: [],
  },
  aflf: {
    name: 'AFLF',
    fullName: 'Ashray For Life Foundation',
    tagline: 'Ray of Hope',
    logo: '/logo/aflf-logo.png',
    color: '#0E6BA8',
    colorDark: '#0A4E7D',
    colorLight: '#E6F4FB',
    accent: '#22D3EE',
    headingColor: '#DC2626',
    footerBg: '#0E6BA8',
    banner: '/Letter%20Head%20AFLF.png',
    contact: {
      phone: '9930028300 / 9930028200',
      email: 'ashray.foundation22@gmail.com',
      website: 'www.aflf.org',
      address: 'Unit - 218, 2nd Floor, Auris Galleria, New Link Road, Auris Serenity, Malad (West), Mumbai - 400064.',
    },
    social: [],
  },
}
const DEFAULT_THEME = {
  name: 'REPORT',
  fullName: 'Report',
  tagline: '',
  logo: null,
  color: '#0f172a',
  colorDark: '#0f172a',
  colorLight: '#e2e8f0',
  accent: '#0f172a',
  headingColor: '#0f172a',
  footerBg: '#0f172a',
  banner: null,
  contact: {},
  social: [],
}
const ngoTheme = (n) => {
  const code = String(n.code || '').toLowerCase()
  return NGO_THEMES[code] || DEFAULT_THEME
}
const codeForName = (name) => {
  const k = String(name || '').toLowerCase()
  if (k.includes('mann')) return 'mann'
  if (k.includes('aflf') || k.includes('ashray')) return 'aflf'
  if (k.includes('bsct') || k.includes('being')) return 'bsct'
  return ''
}

// Shown on an event card when the event has no photo (or its photo fails to
// load), so the card never renders an empty / "EVENT BANNER" text block.
const EVENT_PHOTO_PLACEHOLDER = '/event-placeholder.svg'

const REPORT_TYPES = [
  { id: 'summary', label: 'Event Summary' },
  { id: 'beneficiary', label: 'Beneficiary Report' },
  { id: 'material', label: 'Material Distribution Report' },
  { id: 'expense', label: 'Expense Report' },
  { id: 'asset', label: 'Asset Utilization Report' },
  { id: 'volunteer', label: 'Volunteer Report' },
  { id: 'csr', label: 'CSR Report' },
  { id: 'donor', label: 'Donor Report' },
  { id: 'impact', label: 'Impact Report' },
]

const COMPLETED = ['Completed']
const ALL_STATUS = ['Submitted', 'Submitted&', 'Pending Approval', 'Approval Pending', 'Completed', 'Draft', 'Approved', 'Rejected']

const isSubmitted = (s) => { const v = String(s || '').trim().toLowerCase(); return v === 'submitted' || v === 'submitted&' || v === 'pending approval' || v === 'approval pending' }

const STATUS_LABEL = { Completed: '✓ COMPLETED', Submitted: 'SUBMITTED', Approved: 'APPROVED', Rejected: 'REJECTED', Draft: 'DRAFT' }
const STATUS_COLOR = { Completed: '#16a34a', Submitted: '#2563eb', Approved: '#0ea5e9', Rejected: '#dc2626', Draft: '#f59e0b', Postponed: '#7c3aed', Cancelled: '#6b7280', Closed: '#4b5563' }

// The badge on a monthly-report programme card. The report lists only the
// programmes that were COMPLETED, so the badge says the same thing in words:
// a programme the head accepted is COMPLETED (green), one that is still
// waiting for the approval is PENDING APPROVAL (amber), one that was never
// sent is PENDING (amber). It used to be "Completed" only when the programme
// had a photo and "Pending" otherwise, which mislabelled every programme that
// was planned but not yet documented.
const REPORT_BADGE = {
  Approved: 'COMPLETED',
  Completed: 'COMPLETED',
  Submitted: 'PENDING APPROVAL',
  'Submitted&': 'PENDING APPROVAL',
  'Pending Approval': 'PENDING APPROVAL',
  'Approval Pending': 'PENDING APPROVAL',
  Draft: 'PENDING',
  Postponed: 'POSTPONED',
  Cancelled: 'CANCELLED',
  Rejected: 'REJECTED',
  Closed: 'CLOSED',
}
const BADGE_COLOR = {
  COMPLETED: '#16a34a',
  'PENDING APPROVAL': '#f59e0b',
  PENDING: '#f59e0b',
  POSTPONED: '#7c3aed',
  CANCELLED: '#6b7280',
  REJECTED: '#dc2626',
  CLOSED: '#4b5563',
}
const reportBadge = (ev) => {
  const st = String(ev?.status || '').trim()
  if (st && REPORT_BADGE[st]) return { text: REPORT_BADGE[st], color: BADGE_COLOR[REPORT_BADGE[st]] }
  if (ev?.image) return { text: 'COMPLETED', color: BADGE_COLOR.COMPLETED }
  return { text: 'PENDING', color: BADGE_COLOR.PENDING }
}

const money = (v) => (v == null || v === '' ? '—' : '₹' + Number(v).toLocaleString('en-IN'))
const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  if (isNaN(dt)) return String(d).slice(0, 10)
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
const fmtTime = (t) => {
  if (!t) return '—'
  const s = String(t)
  try {
    if (/^\d{1,2}:\d{2}$/.test(s)) {
      const [h, m] = s.split(':').map(Number)
      const am = h < 12
      return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`
    }
    return s
  } catch { return s }
}
const isImage = (u) => /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(String(u || ''))
const safe = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/* The event banner in the report header. When there is no banner (or it fails to
   load) this renders nothing at all — no placeholder bar — so the report header
   stays clean. */
function ReportBanner({ src, alt }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) return null
  return (
    <img
      src={src}
      alt={alt || 'banner'}
      onError={() => setFailed(true)}
      style={{ width: '100%', maxHeight: 320, objectFit: 'cover', display: 'block' }}
    />
  )
}

function SafeImg({ src, alt, height, radius = 8, fallback, fit = 'cover' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if ((!src || failed) && fallback) {
    return (
      <img
        src={fallback}
        alt={alt || ''}
        style={{ width: '100%', height, objectFit: fit, display: 'block', borderRadius: radius }}
      />
    )
  }
  if (!src || failed) {
    return (
      <div style={{
        width: '100%', height, borderRadius: radius, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 10, color: '#9ca3af', textAlign: 'center',
        background: '#f3f4f6', border: '1px dashed #d1d5db', padding: 4,
      }}>
        No image
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt || ''}
      onError={() => setFailed(true)}
      style={{ width: '100%', height, objectFit: fit, display: 'block', borderRadius: radius }}
    />
  )
}

/* A programme photo on a monthly-report card. The report PDF is rasterised with
   html2canvas, and the event head's S3 bucket is PRIVATE (its URLs 403 in a
   plain <img>, and a cross-origin <img> cannot be painted onto a canvas), so
   the photo is read back through the same-origin server proxy and rendered as
   a blob / data URL. That both SHOWS it and lets the PDF CAPTURE it. Falls back
   to the raw URL for public / legacy images. */
function ReportCardImage({ ev, height, radius = 0, fit = 'cover' }) {
  const raw = ev.image || ''
  const [src, setSrc] = useState(raw)
  useEffect(() => {
    let live = true
    let temp = ''
    if (!ev.image_event_id) { setSrc(raw); return }
    ; (async () => {
      try {
        const resolved = ev.image_kind === 'banner'
          ? await fetchEventBannerObjectUrl(ev.image_event_id)
          : await fetchEventImageDataUrl(ev.image_event_id, ev.image_index || 0, true)
        if (!live) { if (String(resolved).startsWith('blob:')) URL.revokeObjectURL(resolved); return }
        temp = resolved
        setSrc(resolved)
      } catch {
        if (live) setSrc(raw)
      }
    })()
    return () => { live = false; if (temp) { try { URL.revokeObjectURL(temp) } catch { /* already gone */ } } }
  }, [ev.image_event_id, ev.image_kind, ev.image_index, raw])
  return <SafeImg src={src || EVENT_PHOTO_PLACEHOLDER} alt="" height={height} radius={radius} fallback={EVENT_PHOTO_PLACEHOLDER} fit={fit} />
}

function Section({ title, children, right }) {
  return (
    <div style={{ margin: '20px 0', borderTop: '2px solid #e5e7eb', paddingTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

function KeyVal({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#1a1a2e', fontWeight: 500 }}>{value || '—'}</div>
    </div>
  )
}

function Table({ cols, rows }) {
  if (!rows || !rows.length) return <div style={{ color: '#9ca3af', fontSize: 13 }}>No records</div>
  return (
    <div className="eh-table-scroll" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 660 }}>
        <thead>
          <tr>
            {cols.map(c => <th key={c.key} style={{ textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid #d1d5db', background: '#f3f4f6', fontWeight: 700, color: '#374151', fontSize: 11, textTransform: 'uppercase' }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map(c => <td key={c.key} style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6', color: '#1a1a2e' }}>{c.render ? c.render(r) : r[c.key] != null ? String(r[c.key]) : '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Shared report-card chrome. All three NGO variants (BSCT navy/yellow,
// MANN pink, AFLF blue/cyan + red) render the same header, activity card
// and contact footer so the on-screen card and the PDF stay consistent.
// ─────────────────────────────────────────────────────────────
function ReportCardHeader({ logo, theme, ngoName, monthLabel, yearLabel, eventCount }) {
  return (
    <div style={{ background: theme.color, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderBottom: `4px solid ${theme.accent || theme.colorDark}` }}>
      {logo ? (
        <img src={logo} alt={ngoName} style={{ width: 52, height: 52, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 4 }} onError={e => { e.currentTarget.style.display = 'none' }} />
      ) : (
        <div style={{ width: 52, height: 52, borderRadius: 8, background: 'rgba(255,255,255,0.25)', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{String(theme.name || 'R').slice(0, 1)}</div>
      )}
      <div style={{ flex: 1, minWidth: 160 }}>
        {theme.tagline && <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.85, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{theme.tagline}</div>}
        <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: 0.5, color: '#fff' }}>{theme.fullName || ngoName}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.9)' }}>{eventCount} event{eventCount === 1 ? '' : 's'} this month</div>
      </div>
      <div style={{ textAlign: 'right', color: '#fff' }}>
        <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.85, fontWeight: 700 }}>MONTHLY REPORT CARD</div>
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase' }}>{monthLabel} {yearLabel}</div>
      </div>
    </div>
  )
}

const CARD_INPUT = { width: '100%', padding: '4px 6px', border: '1px solid var(--line, #d1d5db)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', color: '#1a1a2e', background: '#fff' }
const CARD_BTN = { padding: '3px 9px', border: '1px solid var(--line, #d1d5db)', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: '#fff', color: '#374151' }
const CARD_BTN_PRIMARY = { ...CARD_BTN, background: '#2036bd', borderColor: '#2036bd', color: '#fff' }
const dateInputValue = (d) => (d ? String(d).slice(0, 10) : '')
const weekdayOf = (d) => { if (!d) return null; const dt = new Date(String(d).slice(0, 10) + 'T00:00:00'); return isNaN(dt) ? null : dt.toLocaleDateString('en-US', { weekday: 'long' }) }

function CardMenuItem({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'transparent', fontSize: 12.5, color: '#1a1a2e', cursor: 'pointer', borderRadius: 6 }}
      onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >{children}</button>
  )
}

function ActivityCard({ ev, theme, big, wide, badge = true, onPatched }) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const localUrlRef = useRef('')
  const [bannerUrl, setBannerUrl] = useState('')
  const [bannerBust, setBannerBust] = useState(0)

  const evId = ev?.id
  const evBanner = ev?.banner || ''

  // Resolve the banner through the authenticated proxy (private-bucket S3 URLs
  // 403 in an <img>), falling back to the raw URL for public/legacy images.
  useEffect(() => {
    let cancelled = false
    let obj = ''
    if (!evId || !evBanner || !/^https?:/i.test(evBanner)) { setBannerUrl(evBanner); return }
    ; (async () => {
      try {
        obj = await fetchEventBannerObjectUrl(evId, bannerBust || undefined)
        if (cancelled) { URL.revokeObjectURL(obj); return }
        setBannerUrl(obj)
      } catch {
        if (!cancelled) setBannerUrl(evBanner)
      }
    })()
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj) }
  }, [evId, evBanner, bannerBust])

  useEffect(() => () => { if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current) }, [])

  if (!ev) return null
  const imgH = big ? 190 : (wide ? 150 : 132)
  const rounded = theme.name === 'AFLF'

  const closeMenus = () => { setMenuOpen(false) }
  const startEdit = (field) => {
    setErr('')
    setDraft(field === 'name' ? (ev.name || '') : dateInputValue(ev.date))
    setEditing(field)
    closeMenus()
  }
  const saveField = async (field) => {
    if (busy) return
    if (field === 'name' && !draft.trim()) { setErr('Name cannot be empty'); return }
    setBusy(true); setErr('')
    try {
      const payload = field === 'name' ? { name: draft.trim() } : { date: draft || null, day: weekdayOf(draft) }
      await updateEvent(ev.id, field === 'name' ? payload : { date: payload.date })
      onPatched && onPatched(ev.id, payload)
      setEditing('')
    } catch (e) {
      setErr(e.message || 'Could not save the change')
    } finally { setBusy(false) }
  }
  const onPickFile = async (file) => {
    if (!file || busy) return
    if (!String(file.type || '').startsWith('image/')) { setErr('Please choose a JPG, PNG or WebP image.'); return }
    setBusy(true); setErr('')
    try {
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current)
      const local = URL.createObjectURL(file)
      localUrlRef.current = local
      setBannerUrl(local)
      const fd = new FormData()
      fd.append('file', file, file.name)
      const res = await uploadEventBanner(fd)
      const url = (res && res.url) || ''
      if (!url) throw new Error('Upload finished but no image URL was returned.')
      await updateEvent(ev.id, { banner: url })
      onPatched && onPatched(ev.id, { banner: url })
      setBannerBust(Date.now())
    } catch (e) {
      setErr(e.message || 'Banner upload failed')
      setBannerUrl(evBanner)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="eh-activity-card" style={{
      display: 'flex', flexDirection: 'column', background: '#fff', height: '100%',
      border: `2px solid ${theme.accent || theme.colorLight}`,
      borderRadius: rounded ? 12 : 10, overflow: 'hidden',
      breakInside: 'avoid', pageBreakInside: 'avoid',
    }}>
      <div style={{ position: 'relative', width: '100%', height: imgH, background: '#f1f5f9', overflow: 'hidden', flexShrink: 0, borderRadius: rounded ? 10 : 0 }}>
        {ev.banner ? (
          <SafeImg src={bannerUrl || ev.banner} alt={ev.name} height="100%" radius={rounded ? 10 : 0} fallback={EVENT_PHOTO_PLACEHOLDER} />
        ) : (
          <SafeImg src={EVENT_PHOTO_PLACEHOLDER} alt={ev.name || 'Event photo'} height="100%" radius={rounded ? 10 : 0} />
        )}
        {badge && <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 700, color: '#fff', background: STATUS_COLOR[ev.status] || '#6b7280', borderRadius: 999, padding: '3px 9px', textTransform: 'uppercase' }}>{ev.status || '—'}</span>}

        <button
          type="button" title="Event actions" className="no-print" data-html2canvas-ignore="true"
          onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
          style={{ position: 'absolute', top: 8, left: 8, zIndex: 3, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(17,24,39,0.62)', color: '#fff', fontSize: 15, fontWeight: 700, lineHeight: '22px', cursor: 'pointer', padding: 0 }}
        >⋯</button>
        {menuOpen && (
          <div className="no-print" data-html2canvas-ignore="true" onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 36, left: 8, zIndex: 4, background: '#fff', border: '1px solid var(--line, #e5e7eb)', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.18)', padding: 4, minWidth: 176 }}>
            <CardMenuItem onClick={() => { closeMenus(); fileRef.current && fileRef.current.click() }}>🖼 Upload / Change Banner</CardMenuItem>
            <CardMenuItem onClick={() => startEdit('name')}>✏️ Edit Event Name</CardMenuItem>
            <CardMenuItem onClick={() => startEdit('date')}>📅 Edit Date</CardMenuItem>
            <CardMenuItem onClick={() => { closeMenus(); navigate('/event-head/events/' + ev.id) }}>👁 View Event Details</CardMenuItem>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => onPickFile(e.target.files && e.target.files[0])} />
      </div>
      <div style={{ padding: big ? '12px 14px' : '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {editing === 'name' ? (
          <div className="no-print" data-html2canvas-ignore="true">
            <input style={CARD_INPUT} value={draft} autoFocus onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveField('name'); if (e.key === 'Escape') setEditing('') }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
              <button type="button" style={CARD_BTN_PRIMARY} disabled={busy} onClick={() => saveField('name')}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" style={CARD_BTN} disabled={busy} onClick={() => { setEditing(''); setErr('') }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: big ? 15 : 13, fontWeight: 800, color: '#1a1a2e', lineHeight: 1.25 }}>{ev.name}</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
          {editing === 'date' ? (
            <div className="no-print" data-html2canvas-ignore="true" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" style={{ ...CARD_INPUT, width: 'auto' }} value={draft} autoFocus onChange={e => setDraft(e.target.value)} />
              <button type="button" style={CARD_BTN_PRIMARY} disabled={busy} onClick={() => saveField('date')}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" style={CARD_BTN} disabled={busy} onClick={() => { setEditing(''); setErr('') }}>Cancel</button>
            </div>
          ) : (
            <span>📅 {fmtDate(ev.date)}{ev.day ? ` · ${ev.day.split(' ')[0]}` : ''}</span>
          )}
          {ev.venue && <span>📍 {ev.venue}</span>}
        </div>
        {(ev.sector_name || ev.activity_name) && (
          <div style={{ fontSize: 11, color: '#4b5563', fontWeight: 600, lineHeight: 1.35 }}>
            🏷 {ev.sector_name && ev.activity_name ? `${ev.sector_name} · ${ev.activity_name}` : (ev.sector_name || ev.activity_name)}
          </div>
        )}
        {err && <div className="no-print" data-html2canvas-ignore="true" style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>{err}</div>}
      </div>
    </div>
  )
}

function ReportCardFooter({ theme, n, monthLabel, yearLabel }) {
  const c = theme.contact || {}
  const hasContact = c.phone || c.email || c.website || c.address
  return (
    <div style={{ borderTop: `3px solid ${theme.accent || theme.color}`, background: theme.colorLight, padding: '12px 16px' }}>
      {hasContact && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 11, color: theme.colorDark, fontWeight: 600 }}>
          {c.phone && <span>📞 {c.phone}</span>}
          {c.email && <span>✉️ {c.email}</span>}
          {c.website && <span>🌐 {c.website}</span>}
          {c.address && <span style={{ flexBasis: '100%' }}>📍 {c.address}</span>}
        </div>
      )}
      {(theme.social || []).length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 11, color: theme.colorDark, fontWeight: 600 }}>
          {theme.social.map((s, i) => <span key={i}>{s.label}: {s.handle}</span>)}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MANN-only "MONTH IN ACTION" mosaic layout.
// Featured hero + alternating large/small photo cells + a
// 3-column impact row. Every event cell shows its banner and
// all of its information.
// ─────────────────────────────────────────────────────────────
function MonthInActionLayout({ n, theme, monthLabel, yearLabel, cardRef, onPatched }) {
  const events = n.events || []

  // Every event renders through the shared ActivityCard so all three NGO
  // variants keep the same date / title / description / impact structure.
  const Cell = ({ e, big, badge }) => <ActivityCard ev={e} theme={theme} big={big} badge={badge} onPatched={onPatched} />

  return (
    <div ref={cardRef} className="eh-ngo-card" style={{ border: `2px solid ${theme.color}`, borderRadius: 14, overflow: 'hidden', background: '#fff', pageBreakInside: 'avoid' }}>
      <ReportCardHeader logo={n.logo || theme.logo} theme={theme} ngoName={n.ngo_name} monthLabel={monthLabel} yearLabel={yearLabel} eventCount={n.events_count} />

      <div style={{ padding: '16px 16px 8px' }}>
        {events.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13, padding: '8px 0 24px', textAlign: 'center' }}>No events for this month.</div>
        ) : (
          <>
            {/* Section title */}
            <div style={{ fontSize: 15, letterSpacing: 3, color: theme.color, fontWeight: 800, textAlign: 'center', textTransform: 'uppercase' }}>📸 Month in Action</div>
            <div style={{ fontSize: 11, letterSpacing: 2, color: '#6b7280', fontWeight: 600, textAlign: 'center', textTransform: 'uppercase' }}>Stories • People • Impact</div>
            <div style={{ width: 70, height: 3, background: theme.color, margin: '8px auto 14px', borderRadius: 2 }} />

            {/* 1 · Featured hero — large photo */}
            <div style={{ marginBottom: 12 }}>
              <Cell e={events[0]} big />
            </div>

            {/* 2 · Large then small */}
            {events[1] && (
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, marginBottom: 12 }}>
                <Cell e={events[1]} big />
                <Cell e={events[2]} />
              </div>
            )}

            {/* 3 · Small then large */}
            {events[3] && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 12, marginBottom: 12 }}>
                <Cell e={events[3]} />
                <Cell e={events[4]} big />
              </div>
            )}

            {/* 4 · People / Participation / Impact strip */}
            <div style={{ background: `linear-gradient(90deg, ${theme.color}, ${theme.colorDark})`, color: '#fff', textAlign: 'center', padding: '10px 12px', borderRadius: 8, fontSize: 12, fontWeight: 800, letterSpacing: 3, marginBottom: 12 }}>
              PEOPLE • PARTICIPATION • IMPACT
            </div>

            {/* 5 · 3-column impact row */}
            {(events[5] || events[6] || events[7]) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
                <Cell e={events[5]} />
                <Cell e={events[6]} />
                <Cell e={events[7]} />
              </div>
            )}

            {/* 6 · Any remaining events */}
            {events.length > 8 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {events.slice(8).map((e, i) => <Cell key={e.id ?? i} e={e} />)}
              </div>
            )}
          </>
        )}
      </div>

      <ReportCardFooter theme={theme} n={n} monthLabel={monthLabel} yearLabel={yearLabel} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// AFLF-only "GLIMPSES FROM THE FIELD" mosaic layout.
// Featured photo on the left (tall) with event cells around it,
// then rows of photo cells. Every event shows its banner and all
// of its information.
// ─────────────────────────────────────────────────────────────
function GlimpsesLayout({ n, theme, monthLabel, yearLabel, cardRef, onPatched }) {
  const events = n.events || []

  const Cell = ({ e, big, wide }) => <ActivityCard ev={e} theme={theme} big={big} wide={wide} onPatched={onPatched} />

  const ev = (i) => events[i]
  const rest = events.slice(11)

  return (
    <div ref={cardRef} className="eh-ngo-card" style={{ border: `2px solid ${theme.color}`, borderRadius: 14, overflow: 'hidden', background: '#fff', pageBreakInside: 'avoid' }}>
      <ReportCardHeader logo={n.logo || theme.logo} theme={theme} ngoName={n.ngo_name} monthLabel={monthLabel} yearLabel={yearLabel} eventCount={n.events_count} />

      <div style={{ padding: '16px 16px 8px' }}>
        {events.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13, padding: '8px 0 24px', textAlign: 'center' }}>No events for this month.</div>
        ) : (
          <>
            {/* Section title */}
            <div style={{ fontSize: 15, letterSpacing: 3, color: theme.color, fontWeight: 800, textAlign: 'center', textTransform: 'uppercase' }}>📸 Glimpses From The Field</div>
            <div style={{ width: 70, height: 3, background: theme.color, margin: '10px auto 14px', borderRadius: 2 }} />

            {/* Featured (left, tall) + right column (2, 3, 4) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12, marginBottom: 12 }}>
              <Cell e={ev(0)} big />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Cell e={ev(1)} wide />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flex: 1 }}>
                  <Cell e={ev(2)} />
                  <Cell e={ev(3)} />
                </div>
              </div>
            </div>

            {/* Row of three: 5, 6, 7 */}
            {(ev(4) || ev(5) || ev(6)) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
                <Cell e={ev(4)} />
                <Cell e={ev(5)} />
                <Cell e={ev(6)} />
              </div>
            )}

            {/* Row of two: 8, 9 */}
            {(ev(7) || ev(8)) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <Cell e={ev(7)} />
                <Cell e={ev(8)} />
              </div>
            )}

            {/* Row of three: 10, 11, 12 */}
            {(ev(9) || ev(10) || ev(11)) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
                <Cell e={ev(9)} />
                <Cell e={ev(10)} />
                <Cell e={ev(11)} />
              </div>
            )}

            {/* Any remaining events */}
            {rest.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {rest.map((e, i) => <Cell key={e.id ?? i} e={e} />)}
              </div>
            )}
          </>
        )}
      </div>

      <ReportCardFooter theme={theme} n={n} monthLabel={monthLabel} yearLabel={yearLabel} />
    </div>
  )
}

/* BSCT monthly "Report Card" template (/bsct.jpeg, 1131 x 1600 px).
   The artwork has 20 empty card slots (4 rows x 5 columns). Each slot is a
   yellow-bordered rounded card: a glass "photo window" on top and a navy text
   panel below. The slot coordinates below were measured from the image itself
   (top-left of the yellow border, in image pixels; slot size 203 x 274), so a
   programme card lands exactly on top of its slot. The columns drift a few
   pixels from row to row in the artwork, hence one x per slot rather than a
   fixed pitch. More than 20 programmes continue on a second template page. */
const BSCT_W = 1131
const BSCT_H = 1600
const BSCT_SLOT_W = 203
const BSCT_SLOT_H = 274
const BSCT_SLOTS = [
  [35, 250], [250, 250], [464, 250], [678, 250], [892, 250],
  [31, 546], [245, 546], [459, 546], [674, 546], [888, 546],
  [27, 841], [241, 841], [455, 841], [669, 841], [883, 841],
  [22, 1136], [236, 1136], [450, 1136], [667, 1136], [883, 1136],
]
const BSCT_PER_PAGE = BSCT_SLOTS.length
const BSCT_COLS = 5
const BSCT_ROWS = 4
const BSCT_ROW_PITCH = 295.33 // distance between two slot rows in the artwork
const BSCT_FOOT_H = 180       // the footer band of the artwork (image rows 1420-1600)
// Inside a slot (relative to the slot's top-left): 6px yellow border, photo
// window down to y=159, navy text panel from y=160 to the bottom border.
const BSCT_BORDER = 6
const BSCT_PHOTO_H = 153
const BSCT_TEXT_TOP = 158

const BSCT_HEAD_FONT = "Impact, 'Arial Narrow', 'Oswald', sans-serif"
const BSCT_NUM_FONT = "Georgia, 'Times New Roman', serif"
// Width of `text` at a 1px font size, measured with the real font stack, so the
// title and the footer count can be fitted to their space whatever font the
// machine ends up using (Impact is narrow, the fallback fonts are not).
function textEm(text, font, style = '800') {
  try {
    const c = textEm._c || (textEm._c = document.createElement('canvas'))
    const ctx = c.getContext('2d')
    ctx.font = `${style} 100px ${font}`
    return ctx.measureText(text).width / 100
  } catch { return String(text).length * 0.6 }
}

function useElWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = () => setW(el.getBoundingClientRect().width)
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

function BsctTemplatePage({ monthLabel, yearLabel, happyCount, rows, dragKey, overKey, startDrag, endDrag, dragOverCard, dropOnCard, dropAtEnd }) {
  const ref = useRef(null)
  const w = useElWidth(ref)
  // Everything inside a slot is designed in image pixels and scaled by k, so
  // the page looks the same at any on-screen width and in the exported PDF.
  const k = (w || BSCT_W) / BSCT_W
  const px = (n) => Math.round(n * k * 100) / 100
  // The page is only as tall as the rows that are really used: the footer band
  // moves up to sit right under the last row, so no empty space is left.
  const nRows = Math.max(1, Math.min(BSCT_ROWS, Math.ceil(rows.length / BSCT_COLS)))
  const cut = (BSCT_ROWS - nRows) * BSCT_ROW_PITCH
  const Hp = BSCT_H - cut
  const titleTxt = `${String(monthLabel || '').toUpperCase()} REPORT CARD ${yearLabel || ''}`.trim()
  // Fit the title to the ribbon (690px wide in the artwork) and the footer
  // line to the free space left of the count (590px).
  const titleFs = Math.min(56, 690 / Math.max(0.1, textEm(titleTxt, BSCT_HEAD_FONT)))
  // The count is whatever was typed in the "Happy Family count" box; a "+" is
  // added unless it already ends with one. Empty box = the line is left out.
  const typed = String(happyCount ?? '').trim()
  const countTxt = typed ? (typed.endsWith('+') ? typed : `${typed}+`) : ''
  const footW = 54 * textEm('HAPPY FAMILY', BSCT_HEAD_FONT) + 14 + 62 * textEm(countTxt, BSCT_NUM_FONT, 'italic 800')
  const footK = Math.min(1, 590 / Math.max(1, footW))
  const innerW = BSCT_SLOT_W - BSCT_BORDER * 2
  const innerH = BSCT_SLOT_H - BSCT_BORDER * 2
  return (
    <div
      ref={ref}
      className="bsct-page"
      style={{
        position: 'relative', width: '100%', aspectRatio: `${BSCT_W} / ${Hp}`,
         backgroundImage: "url('/bsct-blank.png')", backgroundSize: '100% auto', backgroundPosition: '0 0', backgroundRepeat: 'no-repeat',
        backgroundColor: '#fff', overflow: 'hidden',
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDrop={dropAtEnd}
    >
      {/* Footer band of the artwork (thanks line + contact bar), pinned to the
          bottom so it follows the last used row. */}
       <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${(BSCT_FOOT_H / Hp) * 100}%`, backgroundImage: "url('/bsct-blank.png')", backgroundRepeat: 'no-repeat', backgroundSize: `100% ${(BSCT_H / BSCT_FOOT_H) * 100}%`, backgroundPosition: '0 100%', pointerEvents: 'none' }} />
      {/* Title on the denim ribbon. The ribbon in /bsct-blank.jpg is empty, so
          the month and year come from the report that is being viewed. */}
      <div style={{ position: 'absolute', left: `${(285 / BSCT_W) * 100}%`, width: `${(723 / BSCT_W) * 100}%`, top: `${(80 / Hp) * 100}%`, height: `${(62 / Hp) * 100}%`, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{
          fontFamily: BSCT_HEAD_FONT, fontWeight: 800, color: '#FFF200', whiteSpace: 'nowrap',
          fontSize: px(titleFs), lineHeight: 1.1,
          textShadow: [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, -2], [-2, 2], [2, 2]].map(([a, b]) => `${px(a)}px ${px(b)}px 0 #0a1f44`).join(', ') + `, 0 ${px(3)}px ${px(4)}px rgba(0,0,0,0.35)`,
        }}>{titleTxt}</span>
      </div>
      {/* "HAPPY FAMILY <count>" in the footer, right aligned like the artwork */}
      {countTxt && (
        <div style={{ position: 'absolute', right: `${((BSCT_W - 1108) / BSCT_W) * 100}%`, top: `${((1446 - cut) / Hp) * 100}%`, height: `${(90 / Hp) * 100}%`, display: 'flex', alignItems: 'center', gap: px(14 * footK), whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          <span style={{ fontFamily: BSCT_HEAD_FONT, fontWeight: 800, fontSize: px(60 * footK), lineHeight: 1.1, color: '#2a6fc0' ,letterSpacing: '4px', }}>HAPPY FAMILY</span>
          <span style={{ fontFamily: BSCT_NUM_FONT, fontStyle: 'italic', fontWeight: 800, fontSize: px(62 * footK), lineHeight: 1.1, color: '#0f2547' }}>{countTxt}</span>
        </div>
      )}
      {rows.map((ev, i) => {
        const [sx, sy] = BSCT_SLOTS[i]
        const key = String(ev.id)
        const badge = reportBadge(ev)
        const d = ev.date ? new Date(String(ev.date).slice(0, 10) + 'T00:00:00') : null
        const dateTxt = d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'
        return (
          <div
            key={ev.id ?? i}
            className={`eh-report-card${dragKey === key ? ' dragging' : ''}${overKey === key ? ' drag-over' : ''}`}
            style={{
              position: 'absolute',
              left: `${(sx / BSCT_W) * 100}%`, top: `${(sy / Hp) * 100}%`,
              width: `${(BSCT_SLOT_W / BSCT_W) * 100}%`, height: `${(BSCT_SLOT_H / Hp) * 100}%`,
              // The page background is the artwork with every empty slot removed;
              // this slot gets its own frame cut out of the original artwork.
              backgroundImage: "url('/bsct.jpeg')", backgroundRepeat: 'no-repeat',
              backgroundSize: `${(BSCT_W / BSCT_SLOT_W) * 100}% ${(BSCT_H / BSCT_SLOT_H) * 100}%`,
              backgroundPosition: `${(sx / (BSCT_W - BSCT_SLOT_W)) * 100}% ${(sy / (BSCT_H - BSCT_SLOT_H)) * 100}%`,
              borderRadius: px(30),
            }}
            onDragOver={(e) => dragOverCard(key)(e)}
            onDrop={(e) => dropOnCard(key)(e)}
          >
            <div style={{ position: 'absolute', left: px(BSCT_BORDER), top: px(BSCT_BORDER), width: px(innerW), height: px(innerH), borderRadius: px(24), overflow: 'hidden' }}>
              {/* Photo window */}
              <div style={{ position: 'relative', height: px(BSCT_PHOTO_H), background: '#e5eef7', overflow: 'hidden' }}>
                <ReportCardImage ev={ev} height={px(BSCT_PHOTO_H)} radius={0} fit="cover" />
                 <span data-html2canvas-ignore={badge.text === 'COMPLETED' ? 'true' : undefined} style={{ position: 'absolute', top: px(10), right: px(12), fontSize: px(12), lineHeight: 1.2, fontWeight: 700, color: '#fff', background: badge.color, borderRadius: 999, padding: `${px(3)}px ${px(10)}px`, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{badge.text}</span>
                <span
                  className="eh-drag-handle no-print"
                  data-html2canvas-ignore="true"
                  draggable
                  onDragStart={startDrag(key)}
                  onDragEnd={endDrag}
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                >⠿</span>
              </div>
              {/* Text sits on the navy panel that is already part of the artwork */}
              <div style={{ position: 'absolute', left: px(10), right: px(10), top: px(BSCT_TEXT_TOP), bottom: px(6), overflow: 'hidden', color: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: px(6), marginBottom: px(4) }}>
                  <span style={{ background: '#FFC72C', color: '#16365f', borderRadius: px(6), padding: `${px(1)}px ${px(8)}px`, fontSize: px(13), lineHeight: 1.35, fontWeight: 800, whiteSpace: 'nowrap' }}>{dateTxt}</span>
                  <span style={{ fontSize: px(12), lineHeight: 1.3, color: '#dbe7f7', whiteSpace: 'nowrap' }}>{ev.day || ''}</span>
                </div>
                <div style={{ fontSize: px(15), lineHeight: `${px(18)}px`, fontWeight: 700, maxHeight: px(54), overflow: 'hidden', overflowWrap: 'anywhere' }}>
                  {ev.event_name || ev.festival || '—'}
                </div>
                {ev.venue && (
                  <div style={{ marginTop: px(3), fontSize: px(11.5), lineHeight: `${px(15)}px`, height: px(15), color: '#dbe7f7', whiteSpace: 'nowrap', overflow: 'hidden' }}>📍 {ev.venue}</div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* Monthly NGO card: the planner's SELECTED Festival / Day rows for the month,
   one line per programme (Date | Festival / Day | Programme | Beneficiary |
   Location). The report is driven by the planner, not by the events listing, so
   a programme is never dropped by event de-duplication and test / duplicate
   events never appear here.

   The programme cards can be dragged into a different order (the handle on the
   photo). The order is not kept in the browser - it is handed to the parent,
   which saves it in the database, so it survives a reload and is the same for
   everyone who opens the report. */
function FestivalProgrammeCard({ n, theme, monthLabel, yearLabel, happyCount, cardRef, onReorder }) {
  // Every programme of the month is listed, not only the photographed ones: a
  // programme that was planned and run but has no photo uploaded yet is still
  // a programme of that month. It carries the placeholder and the "Pending"
  // badge, so the grid matches the count in the card header — which used to
  // say "25 programmes" above a grid that showed only the photographed ones.
  const rows = (n.events || [])
  const headerBg = theme.color
  const bannerSrc = theme.name === 'BSCT' ? null : (n.banner || theme.banner)
  const rounded = theme.name === 'AFLF'
  // The card being dragged, and the card it is currently hovering over.
  const [dragKey, setDragKey] = useState(null)
  const [overKey, setOverKey] = useState(null)

  const startDrag = (key) => (e) => {
    setDragKey(key)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', '') } catch { /* some browsers throw */ }
  }
  const endDrag = () => { setDragKey(null); setOverKey(null) }
  const dragOverCard = (key) => (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overKey !== key) setOverKey(key)
  }
  // Dropping a card on another one puts it in that card's place.
  const dropOnCard = (key) => (e) => {
    e.preventDefault()
    // The grid around the cards drops a card at its end, so a drop on a card
    // must not also travel up to the grid.
    e.stopPropagation()
    const from = dragKey
    setDragKey(null)
    setOverKey(null)
    if (!from || from === key) return
    const keys = rows.map(r => String(r.id))
    const a = keys.indexOf(from)
    const b = keys.indexOf(key)
    if (a < 0 || b < 0) return
    const next = [...keys]
    next.splice(b, 0, next.splice(a, 1)[0])
    onReorder?.(next)
  }
  // Dropping on the empty space of the grid moves the card to the end.
  const dropAtEnd = (e) => {
    e.preventDefault()
    const from = dragKey
    setDragKey(null)
    setOverKey(null)
    if (!from) return
    const keys = rows.map(r => String(r.id))
    const a = keys.indexOf(from)
    if (a < 0 || a === keys.length - 1) return
    const next = [...keys]
    next.push(next.splice(a, 1)[0])
    onReorder?.(next)
  }
  // BSCT: the programmes are laid straight onto the report-card artwork, 20 per
  // template page, instead of the generic 5-column grid.
  if (theme.name === 'BSCT' && rows.length > 0) {
    const pages = []
    for (let i = 0; i < rows.length; i += BSCT_PER_PAGE) pages.push(rows.slice(i, i + BSCT_PER_PAGE))
    return (
      <div ref={cardRef} className="eh-ngo-card bsct-pages" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {pages.map((chunk, pi) => (
          <BsctTemplatePage
            key={pi}
            monthLabel={monthLabel}
            yearLabel={yearLabel}
            happyCount={happyCount}
            rows={chunk}
            dragKey={dragKey}
            overKey={overKey}
            startDrag={startDrag}
            endDrag={endDrag}
            dragOverCard={dragOverCard}
            dropOnCard={dropOnCard}
            dropAtEnd={dropAtEnd}
          />
        ))}
      </div>
    )
  }
  return (
    <div ref={cardRef} className="eh-ngo-card" style={{ border: `2px solid ${headerBg}`, borderRadius: 12, overflow: 'hidden', background: theme.name === 'BSCT' ? "url('/bsct.jpeg') center top / 100% auto no-repeat" : '#fff', minHeight: theme.name === 'BSCT' ? 990 : undefined, position: 'relative', pageBreakInside: 'avoid' }}>
      {theme.name !== 'BSCT' && <ReportCardHeader logo={n.logo || theme.logo} theme={theme} ngoName={n.ngo_name} monthLabel={monthLabel} yearLabel={yearLabel} eventCount={n.events_count} />}

      {/* Optional letterhead band */}
      {bannerSrc && (
        <div style={{ height: 84, background: '#f1f5f9', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `3px solid ${headerBg}` }}>
          <SafeImg src={bannerSrc} alt="" height={84} radius={0} />
        </div>
      )}

      <div style={{ padding: '14px 16px', marginTop: theme.name === 'BSCT' ? 210 : 0 }}>
        {rows.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>No completed programmes for this month.</div>
        ) : (
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={dropAtEnd}
          >
            {rows.map((ev, i) => {
              const key = String(ev.id)
              const badge = reportBadge(ev)
              return (
                <div
                  key={ev.id ?? i}
                  className={`eh-activity-card eh-report-card${dragKey === key ? ' dragging' : ''}${overKey === key ? ' drag-over' : ''}`}
                  style={{ border: `2px solid ${theme.accent || theme.colorLight}`, borderRadius: rounded ? 12 : 10, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
                  onDragOver={(e) => dragOverCard(key)(e)}
                  onDrop={(e) => dropOnCard(key)(e)}
                >
                  <div style={{ position: 'relative', height: 110, background: '#f1f5f9', borderRadius: rounded ? 10 : 0, overflow: 'hidden' }}>
                    <ReportCardImage ev={ev} height={130} radius={rounded ? 10 : 0} fit="cover" />
                     <span data-html2canvas-ignore={badge.text === 'COMPLETED' ? 'true' : undefined} style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 700, color: '#fff', background: badge.color, borderRadius: 999, padding: '3px 9px', textTransform: 'uppercase' }}>{badge.text}</span>

                    <span
                      className="eh-drag-handle no-print"
                      data-html2canvas-ignore="true"
                      draggable
                      onDragStart={startDrag(key)}
                      onDragEnd={endDrag}
                      title="Drag to reorder"
                      aria-label="Drag to reorder"
                    >⠿</span>
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ background: headerBg, color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                        {ev.date ? new Date(String(ev.date).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                      </span>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{ev.day || ''}</span>
                    </div>
                    {/* The event's own full name is the card title — the festival
                        it was planned on only stays as a small note underneath,
                        and only when the two are actually different. */}
                    <div style={{ fontSize: 13, fontWeight: 700, color: theme.headingColor, marginBottom: 4, overflowWrap: 'anywhere' }}>
                      {ev.event_name || ev.festival || '—'}
                    </div>
                    {/* {ev.event_name && ev.festival_name && ev.event_name !== ev.festival_name && (
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{ev.festival_name}</div>
                    )} */}
                    {ev.venue && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>📍 {ev.venue}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {theme.name !== 'BSCT' && <ReportCardFooter theme={theme} n={n} monthLabel={monthLabel} yearLabel={yearLabel} />}
    </div>
  )
}

/* Page-break planner for the monthly PDF. Given the raster y-ranges that must
   stay intact (event cards, header, footer) it returns the offsets at which a
   tall NGO card is cut into pages WITHOUT splitting any of those blocks. Every
   break lands in a gap between blocks; only a single block taller than a whole
   page is force-split, and even then it starts on a fresh page first. */
function computePageBreaks(intervals, totalPx, pagePx) {
  const total = Math.max(0, Math.round(totalPx))
  const page = Math.max(1, Math.round(pagePx))
  if (total <= page) return [0, total]
  const ranges = (intervals || [])
    .map(([a, b]) => [Math.max(0, Math.floor(a)), Math.min(total, Math.ceil(b))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  const merged = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  const contains = (p) => merged.find(([a, b]) => p > a && p < b) || null
  const breaks = [0]
  let y = 0
  let guard = 0
  while (y < total - 1 && guard++ < 10000) {
    const pageEnd = y + page
    if (pageEnd >= total) { breaks.push(total); break }
    let cut = pageEnd
    const hit = contains(pageEnd)
    if (hit) cut = hit[0] > y ? hit[0] : pageEnd
    if (cut <= y) cut = pageEnd
    breaks.push(cut)
    y = cut
  }
  if (breaks[breaks.length - 1] < total) breaks.push(total)
  return breaks
}

/* Render a DOM node to a downloaded A4 PDF. Used by the single-event ("daily")
   report and the all-events summary download buttons, which previously only
   called window.print() — that produced nothing on browsers/setups where the
   print CSS is not applied and could never save a file. This rasterises the
   report with html2canvas and slices it into A4 pages at the gaps between
   keep-together blocks (tables, the report header and the footer), reusing the
   same page-break planner as the monthly export. Assets (images/fonts) are
   awaited first so photos are not blank. */
async function exportElementToPdf(el, filename) {
  if (!el) throw new Error('Nothing to export — generate the report first.')
  const { default: html2canvas } = await import('html2canvas')
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pageW = 210
  const pageH = 297
  const margin = 8
  const contentW = pageW - margin * 2
  const contentH = pageH - margin * 2

  await Promise.all(
    [...el.querySelectorAll('img')].map(img =>
      img.complete
        ? Promise.resolve()
        : new Promise(resolve => { img.onload = () => resolve(); img.onerror = () => resolve() })
    )
  )
  await (document.fonts && document.fonts.ready)

  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 15000,
  })

  const pxPerMm = canvas.width / contentW
  const pageHeightPx = contentH * pxPerMm

  const elRect = el.getBoundingClientRect()
  const sc = canvas.width / (elRect.width || el.offsetWidth || canvas.width)
  const toPx = (r) => [(r.top - elRect.top) * sc, (r.bottom - elRect.top) * sc]
  const keepTogether = []
  try {
    for (const s of el.querySelectorAll('.eh-report-body, .eh-print-brand, .eh-print-footer')) {
      keepTogether.push(toPx(s.getBoundingClientRect()))
    }
    for (const t of el.querySelectorAll('table')) keepTogether.push(toPx(t.getBoundingClientRect()))
  } catch { /* measurement is best-effort; slicing still works */ }

  const breaks = computePageBreaks(keepTogether, canvas.height, pageHeightPx)
  for (let i = 0; i < breaks.length - 1; i++) {
    const start = Math.round(breaks[i])
    const end = Math.round(breaks[i + 1])
    if (end <= start) continue
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = end - start
    slice.getContext('2d').drawImage(canvas, 0, start, canvas.width, end - start, 0, 0, canvas.width, end - start)
    const sliceData = slice.toDataURL('image/jpeg', 0.95)
    const sliceHeightMm = (end - start) / pxPerMm
    if (i > 0) pdf.addPage()
    pdf.addImage(sliceData, 'JPEG', margin, margin, contentW, sliceHeightMm)
  }
  pdf.save(filename)
}

export default function EventReports({ initialMode = 'daily' } = {}) {
  // Deep link from an event's "Report" button: /event-head/reports?event=<id>.
  // The id is consumed once, right after the events list loads, so the event is
  // selected and its report generated without the user picking it again.
  const [searchParams] = useSearchParams()
  const requestedEventRef = useRef(searchParams.get('event') || '')
  const requestedHandledRef = useRef(false)
  // Set by the completion flow (…&autodownload=1) so the freshly completed
  // event's Daily Report PDF downloads as soon as it has rendered.
  const requestedAutodownloadRef = useRef(searchParams.get('autodownload') === '1')
  const autodownloadDoneRef = useRef(false)
  // Set by the completion flow (…&completed=1) so a confirmation toast shows
  // once when the report page opens after an event is marked Completed.
  const completedToastRef = useRef(searchParams.get('completed') === '1')
  const [toast, setToast] = useState('')

  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [reportType, setReportType] = useState('summary')
  const [reportData, setReportData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('Submitted')
  const [allData, setAllData] = useState(null)
  const [allLoading, setAllLoading] = useState(false)

  const [refreshing, setRefreshing] = useState(false)

  // The report screen has exactly TWO jobs, so it shows exactly two tabs:
  //   daily   → one event you created for a day, with a downloadable report
  //   monthly → every event of a chosen month, grouped by NGO
  // Keeping them behind a tab is the whole point: previously the daily picker,
  // the all-events summary and the monthly cards were stacked on one page, which
  // made it unclear where a single day's report came from.
  const [mode, setMode] = useState(initialMode)

  // ── Monthly Report state ──
  const now = new Date()
  const [monthlyMonth, setMonthlyMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))
  const [monthlyYear, setMonthlyYear] = useState(String(now.getFullYear()))
  const [monthlyNgo, setMonthlyNgo] = useState('')
  const [monthlyData, setMonthlyData] = useState(null)
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  // The number shown after "HAPPY FAMILY" on the BSCT report card. Typed by the
  // user and remembered in this browser; 4290 is the figure the artwork had.
  const [happyFamily, setHappyFamily] = useState(() => {
    try { const v = localStorage.getItem('bsct_happy_family'); return v == null ? '4290' : v } catch { return '4290' }
  })
  useEffect(() => { try { localStorage.setItem('bsct_happy_family', happyFamily) } catch { /* storage unavailable */ } }, [happyFamily])
  const [ngos, setNgos] = useState([])
  // The order the programme cards were dragged into, per NGO. The saved order
  // lives in the database; this is only the arrangement the user has just
  // made, so the cards, the PDF and the Excel / CSV all follow it at once.
  const [cardOrder, setCardOrder] = useState({})

  const loadEvents = () => {
    setRefreshing(true)
    fetchEvents().then(data => {
      const list = Array.isArray(data) ? data : []
      const now = new Date()
      const normalized = list.map(e => {
        const rawStatus = String(e.status || '').trim()
        const status = isSubmitted(rawStatus) ? 'Submitted' : (COMPLETED.includes(rawStatus) ? 'Completed' : ALL_STATUS.includes(rawStatus) ? rawStatus : 'Draft')
        let created = e.created_at || e.createdAt || null
        let isNew = false
        if (created) {
          const d = new Date(String(created).replace(' ', 'T'))
          if (!isNaN(d)) isNew = status === 'Submitted' && (now - d) / (1000 * 60 * 60 * 24) <= 7
        }
        return { ...e, status, status_new: isNew }
      })
      setEvents(normalized)
      const requested = requestedEventRef.current
      if (requested && !requestedHandledRef.current && normalized.some(e => String(e.id) === String(requested))) {
        requestedHandledRef.current = true
        // "All Events" so the deep-linked event is always present in the picker,
        // whatever its status (the default filter is Submitted only).
        setStatusFilter('')
        setSelectedEvent(String(requested))
        generate(requested)
      } else {
        setSelectedEvent(prev => prev || (normalized.find(e => e.status === 'Submitted')?.id) || '')
      }
    }).catch(e => console.error('EventReports fetchEvents:', e))
      .finally(() => setRefreshing(false))
  }

  // Apply an edit made on a monthly card to the loaded report, so the card,
  // the mosaic layouts and the PDF all reflect it without a full reload.
  const patchMonthlyEvent = (eventId, patch) => {
    setMonthlyData(prev => {
      if (!prev) return prev
      const ngos = (prev.ngos || []).map(n => ({
        ...n,
        events: (n.events || []).map(e => (String(e.id) === String(eventId) ? { ...e, ...patch } : e)),
      }))
      return { ...prev, ngos }
    })
  }

  useEffect(() => {
    loadEvents() /* eslint-disable-line react-hooks/exhaustive-deps */
    fetchWorkspaceNgos().then(list => setNgos(Array.isArray(list) ? list : [])).catch(() => setNgos([]))
    const onFocus = () => loadEvents() /* eslint-disable-line react-hooks/exhaustive-deps */
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const filteredEvents = events.filter(e => !statusFilter || (statusFilter === 'Submitted' ? isSubmitted(e.status) : String(e.status) === statusFilter))

  const generate = async (forceId) => {
    // Guard against a DOM/SyntheticEvent (e.g. a bare onClick={generate}
    // handler) being passed where an event id is expected — a non-primitive
    // id would otherwise be stringified into the URL as "[object Object]".
    const raw = (forceId != null && typeof forceId !== 'object') ? forceId : selectedEvent
    const id = raw == null ? '' : String(raw)
    if (!id) return
    setLoading(true)
    setReportData(null)
    try {
      const data = await generateEventReport(id, reportType)
      setReportData(data)
    } catch (err) { alert('Failed to generate report: ' + (err?.message || 'Unknown error')) }
    finally { setLoading(false) }
  }

  const generateAll = async () => {
    setAllLoading(true)
    setAllData(null)
    try {
      const data = await generateAllEventsReport({ status: statusFilter || undefined })
      setAllData(data)
    } catch (err) { alert('Failed to load all events summary') }
    finally { setAllLoading(false) }
  }

  const generateMonthly = async () => {
    setMonthlyLoading(true)
    setMonthlyData(null)
    // A new month is a new set of cards: the arrangement made in the previous
    // month must not leak into this one. The saved order comes back with the
    // report itself.
    setCardOrder({})
    try {
      const data = await generateNgoMonthlyReport({ month: monthlyMonth, year: monthlyYear, ngo_id: monthlyNgo || undefined })
      setMonthlyData(data)
    } catch (err) { alert('Failed to load monthly report') }
    finally { setMonthlyLoading(false) }
  }

  // The NGOs of the monthly report, with their programme cards in the order
  // they are arranged in. A card that is not in the saved order (a programme
  // added after the last drag) keeps its place at the end.
  const orderedNgos = useMemo(() => {
    const list = monthlyData?.ngos || []
    if (!list.length) return list
    return list.map(n => {
      const keys = cardOrder[String(n.ngo_id ?? '')]
      if (!keys || !keys.length) return n
      const events = n.events || []
      const byKey = new Map(events.map(ev => [String(ev.id), ev]))
      const wanted = keys.map(k => byKey.get(k)).filter(Boolean)
      if (!wanted.length) return n
      const used = new Set(wanted.map(ev => String(ev.id)))
      const rest = events.filter(ev => !used.has(String(ev.id)))
      return { ...n, events: [...wanted, ...rest] }
    })
  }, [monthlyData, cardOrder])

  // A programme card was dragged into a new place. The whole order of that
  // NGO is written to the database, so the arrangement is the same for
  // everyone who opens the report, and it survives a reload.
  const handleCardReorder = (ngoKey, visibleKeys) => {
    const ngo = (monthlyData?.ngos || []).find(n => String(n.ngo_id ?? '') === ngoKey)
    if (!ngo) return
    const all = ngo.events || []
    // EVERY programme card is draggable — the handle is on all of them — so the
    // order must be resolved against all of them. It used to be resolved
    // against the photographed cards only, which meant dragging a planned
    // programme (no photo yet) did nothing at all.
    const byKey = new Map(all.map(ev => [String(ev.id), ev]))
    const moved = visibleKeys.map(k => byKey.get(k)).filter(Boolean)
    // The dragged cards take the cards' own places in their new order; every
    // other card keeps the place it had.
    const slots = all.map((ev, i) => i)
    const next = [...all]
    slots.forEach((slot, k) => { if (moved[k]) next[slot] = moved[k] })
    const keys = next.map(ev => String(ev.id))
    setCardOrder(prev => ({ ...prev, [ngoKey]: keys }))
    setMonthlyReportCardOrder({
      month: Number(monthlyMonth),
      year: Number(monthlyYear),
      ngo_id: ngoKey,
      order: keys,
    }).catch(e => {
      console.error('EventReports save card order:', e)
      setToast('Could not save the new card order.')
      setTimeout(() => setToast(''), 4000)
    })
  }

  // Load the monthly report when the Monthly tab is opened, so its cards appear
  // without a click. It is deliberately NOT loaded on the Daily tab (or on page
  // open), so the day report is never buried under month cards.
  useEffect(() => {
    if (mode === 'monthly') generateMonthly() /* eslint-disable-line react-hooks/exhaustive-deps */
  }, [mode])

  const exportMonthlyCSV = () => {
    const rows = orderedNgos.flatMap(n => n.events.map(e => ({
      ngo: n.ngo_name, date: e.date, festival: e.festival, programme: e.programme, beneficiary: e.beneficiary, location: e.venue,
    })))
    const cols = [
      { key: 'ngo', label: 'NGO' },
      { key: 'date', label: 'Date' },
      { key: 'festival', label: 'Festival / Day' },
      { key: 'programme', label: 'Programme' },
      { key: 'beneficiary', label: 'Beneficiary' },
      { key: 'location', label: 'Location' },
    ]
    exportCSV(cols, rows, `monthly-report-${monthlyYear}-${monthlyMonth}.csv`)
  }

  const monthlyMonthLabel = monthlyData
    ? new Date(Number(monthlyData.year), Number(monthlyData.month) - 1, 1).toLocaleString('en-IN', { month: 'long' })
    : new Date(Number(monthlyYear), Number(monthlyMonth) - 1, 1).toLocaleString('en-IN', { month: 'long' })
  const monthlyYearLabel = monthlyData ? String(monthlyData.year) : String(monthlyYear)

  const exportMonthlyExcel = async () => {
    const XLSX = await import('xlsx-js-style')
    const rows = orderedNgos.flatMap(n => n.events.map(e => ({
      ngo: n.ngo_name, date: e.date || '', festival: e.festival || '', programme: e.programme || '',
      beneficiary: e.beneficiary || '', location: e.venue || '',
    })))
    const headers = ['NGO', 'Date', 'Festival / Day', 'Programme', 'Beneficiary', 'Location']
    const aoa = [headers, ...rows.map(r => [
      r.ngo, r.date, r.festival, r.programme, r.beneficiary, r.location,
    ])]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 30 }, { wch: 30 }, { wch: 20 }, { wch: 28 }]
    if (!ws['!rows']) ws['!rows'] = []
    ws['!rows'][0] = { hpt: 22 }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Monthly Report')
    XLSX.writeFile(wb, `monthly-report-${monthlyYearLabel}-${monthlyMonthLabel}.xlsx`)
  }

  const monthlyReportElRef = useRef(null)
  const ngoCardRefs = useRef({})
  const exportMonthlyPDF = async () => {
    const ngos = orderedNgos
    if (!ngos.length) return
    try {
      const { default: html2canvas } = await import('html2canvas')
      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageW = 210
      const pageH = 297
      const margin = 8
      const contentW = pageW - margin * 2
      const contentH = pageH - margin * 2

      // One NGO card per page block. Each card is captured on its own; a card
      // taller than one page is split at the gaps BETWEEN event cards, so no
      // event card is ever cut in half and pages never overlap.
      let firstPage = true
      let deleteInitialPage = false
      for (const n of ngos) {
        const el = ngoCardRefs.current[String(n.ngo_id)]
        if (!el) continue
        await Promise.all(
          [...el.querySelectorAll('img')].map(img =>
            img.complete
              ? Promise.resolve()
              : new Promise(resolve => {
                img.onload = () => resolve()
                img.onerror = () => resolve()
              })
          )
        )
        await (document.fonts && document.fonts.ready)
        // BSCT template pages: each one is a finished A4 poster, so it is
        // captured on its own and placed full-bleed (no margins, no slicing).
        const bsctPages = [...el.querySelectorAll('.bsct-page')]
        if (bsctPages.length) {
          for (const pg of bsctPages) {
            const pageCanvas = await html2canvas(pg, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, imageTimeout: 15000 })
            // The page is as tall as its used rows, so the PDF page is cut to
            // the same height (210mm wide) instead of leaving white space.
            const pgMm = Math.round(pageW * (pageCanvas.height / pageCanvas.width) * 100) / 100
            if (firstPage) deleteInitialPage = true
            pdf.addPage([pageW, pgMm], 'p')
            firstPage = false
            pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageW, pgMm)
          }
          continue
        }
        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          imageTimeout: 15000,
        })
        const pxPerMm = canvas.width / contentW
        const pageHeightPx = contentH * pxPerMm

        // Measure the blocks that must stay whole (theme header, footer and
        // every event card) relative to the NGO card, in raster pixels.
        const elRect = el.getBoundingClientRect()
        const sc = canvas.width / (elRect.width || el.offsetWidth || canvas.width)
        const toPx = (r) => [(r.top - elRect.top) * sc, (r.bottom - elRect.top) * sc]
        const keepTogether = []
        try {
          const kids = el.children
          if (kids.length) keepTogether.push(toPx(kids[0].getBoundingClientRect()))
          if (kids.length > 1) keepTogether.push(toPx(kids[kids.length - 1].getBoundingClientRect()))
          for (const c of el.querySelectorAll('.eh-activity-card')) keepTogether.push(toPx(c.getBoundingClientRect()))
        } catch { /* measurement is best-effort; slicing still works */ }

        const breaks = computePageBreaks(keepTogether, canvas.height, pageHeightPx)

        if (!firstPage) pdf.addPage()
        firstPage = false

        for (let i = 0; i < breaks.length - 1; i++) {
          const start = Math.round(breaks[i])
          const end = Math.round(breaks[i + 1])
          if (end <= start) continue
          const slice = document.createElement('canvas')
          slice.width = canvas.width
          slice.height = end - start
          const ctx = slice.getContext('2d')
          ctx.drawImage(canvas, 0, start, canvas.width, end - start, 0, 0, canvas.width, end - start)
          const sliceData = slice.toDataURL('image/jpeg', 0.95)
          const sliceHeightMm = (end - start) / pxPerMm
          if (i > 0) pdf.addPage()
          pdf.addImage(sliceData, 'JPEG', margin, margin, contentW, sliceHeightMm)
        }
      }
      if (deleteInitialPage) pdf.deletePage(1)
      pdf.save(`monthly-report-${monthlyYearLabel}-${monthlyMonthLabel}.pdf`)
    } catch (err) {
      console.error('exportMonthlyPDF error:', err)
      alert('Failed to generate monthly PDF')
    }
  }

  const ev = reportData?.event || {}
  const isCompleted = COMPLETED.includes(ev.status)

  // NGO branding for the daily report: same logo, name and colour as the NGO's
  // monthly card. Prefer the code/logo the API resolved; fall back to matching
  // the NGO name, then to a numeric code/id.
  const dailyCode = ev.ngo_code || codeForName(ev.ngo_name) || (ev.ngo_id != null ? String(ev.ngo_id) : '')
  const dailyTheme = ngoTheme({ code: dailyCode })
  const dailyLogo = ev.ngo_logo || dailyTheme.logo
  const dailyNgoName = ev.ngo_name || dailyTheme.fullName || 'Report'

  // DOM refs for the downloadable reports. The buttons below export these nodes
  // to a real PDF file instead of calling window.print().
  const singleReportRef = useRef(null)
  const allSummaryRef = useRef(null)
  const [pdfBusy, setPdfBusy] = useState('') // '' | 'single' | 'all'

  const safeFile = (s) => String(s || '').trim().replace(/[^\w\-]+/g, '_').slice(0, 60) || 'report'

  const downloadSinglePdf = async () => {
    if (pdfBusy) return
    setPdfBusy('single')
    try {
      await exportElementToPdf(singleReportRef.current, `${safeFile(ev.name)}-${reportType}-report.pdf`)
    } catch (err) {
      console.error('single report PDF:', err)
      alert('Failed to generate report PDF: ' + (err?.message || 'Unknown error'))
    } finally { setPdfBusy('') }
  }

  // ── Event poster (Being Sevak style one-page sheet) ──
  const posterRef = useRef(null)
  const [posterPhotos, setPosterPhotos] = useState([])
  const posterMedia = (reportData?.media || []).filter(m => isImage(m.url) || /^image/i.test(String(m.type || m.mime_type || ''))).slice(0, 6)
  const posterMediaKey = posterMedia.map(m => m.id || m.url).join('|')
  useEffect(() => {
    let live = true
    const made = []
      ; (async () => {
        const out = []
        for (const m of posterMedia) {
          let src = m.url || ''
          if (m.id && ev.id) {
            try { src = await fetchMediaViewObjectUrl(ev.id, m.id); made.push(src) } catch { /* fall back to the raw url */ }
          }
          out.push(src)
        }
        if (live) setPosterPhotos(out)
      })()
    return () => { live = false; made.forEach(u => { try { URL.revokeObjectURL(u) } catch { /* gone */ } }) }
  }, [posterMediaKey, ev.id]) /* eslint-disable-line react-hooks/exhaustive-deps */

  const posterTeam = (Array.isArray(reportData?.volunteers) ? reportData.volunteers : Array.isArray(ev.volunteers) ? ev.volunteers : [])
    .map(v => (typeof v === 'string' ? v : v?.name)).filter(Boolean)
  const isBsct = String(dailyTheme.name || '').toUpperCase() === 'BSCT'

  const downloadPosterPdf = async () => {
    if (pdfBusy) return
    setPdfBusy('poster')
    try {
      await exportPosterToPdf(posterRef.current, `${safeFile(ev.name)}-poster.pdf`, [
        ...posterPhotos, '/logo/sevak-logo.png', isBsct ? '/logo/bsct-logo.png' : '',
      ])
    } catch (err) {
      console.error('poster PDF:', err)
      alert('Failed to generate poster PDF: ' + (err?.message || 'Unknown error'))
    } finally { setPdfBusy('') }
  }

  // Auto-download the daily report once after completion. The data is already
  // saved server-side, so if the PDF export fails the report stays on screen and
  // the normal "Download PDF" button acts as the retry.
  useEffect(() => {
    if (!requestedAutodownloadRef.current || autodownloadDoneRef.current) return
    if (!reportData) return
    autodownloadDoneRef.current = true
    // Drop the flag from the URL so a refresh does not re-trigger a download.
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('autodownload')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    } catch { /* non-browser */ }
    // Photos resolve asynchronously; give the poster a moment to paint them.
    const t = setTimeout(() => { downloadPosterPdf() }, 1800)
    return () => clearTimeout(t)
  }, [reportData]) /* eslint-disable-line react-hooks/exhaustive-deps */

  // One-shot confirmation toast after an event is marked Completed.
  useEffect(() => {
    if (!completedToastRef.current) return
    completedToastRef.current = false
    setToast('Event marked as Completed. Daily report generated.')
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('completed')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    } catch { /* non-browser */ }
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [])

  const downloadAllPdf = async () => {
    if (pdfBusy) return
    setPdfBusy('all')
    try {
      await exportElementToPdf(allSummaryRef.current, `all-events-summary-${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (err) {
      console.error('all-events PDF:', err)
      alert('Failed to generate PDF: ' + (err?.message || 'Unknown error'))
    } finally { setPdfBusy('') }
  }

  const downloadBlob = (filename, content, mime) => {
    const b = new Blob([content], { type: mime })
    const url = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const exportJSON = () => downloadBlob(`report-${reportType}-${selectedEvent}.json`, JSON.stringify(reportData, null, 2), 'application/json')

  const exportCSV = (cols, rows, filename) => {
    const head = cols.map(c => c.label).join(',')
    const body = rows.map(r => cols.map(c => {
      let v = c.render ? c.render(r) : (r[c.key] != null ? String(r[c.key]) : '')
      v = String(v ?? '').replace(/,/g, ' ')
      return '"' + v + '"'
    }).join(',')).join('\n')
    downloadBlob(filename, head + '\n' + body, 'text/csv')
  }
  const exportAllCSV = (rows) => {
    const cols = [
      { key: 'name', label: 'Event' },
      { key: 'banner', label: 'Banner URL' },
      { key: 'ngo_name', label: 'NGO' },
      { key: 'sector_name', label: 'Sector' },
      { key: 'activity_name', label: 'Activity' },
      { key: 'date', label: 'Date' },
      { key: 'day', label: 'Day' },
      { key: 'start_time', label: 'Start' },
      { key: 'end_time', label: 'End' },
      { key: 'venue', label: 'Venue' },
      { key: 'status', label: 'Status' },
      { key: 'budget', label: 'Budget' },
    ]
    exportCSV(cols, rows, `all-events-summary-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const expenseCols = [
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'amount', label: 'Amount', render: r => money(r.amount) },
    { key: 'status', label: 'Status' },
  ]
  const attendanceCols = [
    { key: 'name', label: 'Name' },
    { key: 'role', label: 'Role' },
    { key: 'status', label: 'Status' },
  ]
  const distCols = [
    { key: 'beneficiary_name', label: 'Beneficiary' },
    { key: 'material', label: 'Material' },
    { key: 'quantity', label: 'Qty' },
  ]
  const checklistCols = [
    { key: 'label', label: 'Item' },
    { key: 'status', label: 'Status', render: r => (r.status ? '✓ Done' : 'Pending') },
    { key: 'notes', label: 'Notes' },
  ]
  const allCols = [
    { key: 'name', label: 'Event' },
    { key: 'banner_thumb', label: 'Banner', render: r => r.banner ? <SafeImg src={r.banner} alt="" height={32} radius={4} /> : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span> },
    { key: 'ngo_name', label: 'NGO' },
    { key: 'sector_name', label: 'Sector' },
    { key: 'activity_name', label: 'Activity' },
    { key: 'date', label: 'Date', render: r => fmtDate(r.date) },
    { key: 'day', label: 'Day' },
    { key: 'start_time', label: 'Start', render: r => fmtTime(r.start_time) },
    { key: 'end_time', label: 'End', render: r => fmtTime(r.end_time) },
    { key: 'venue', label: 'Venue' },
    { key: 'status', label: 'Status', render: r => <span style={{ color: STATUS_COLOR[r.status] || '#6b7280', fontWeight: 700 }}>{r.status}</span> },
    { key: 'budget', label: 'Budget', render: r => money(r.budget) },
  ]
  const mediaCols = [
    { key: 'title', label: 'Title', render: r => r.title || r.name || '—' },
    { key: 'media_type', label: 'Type', render: r => r.media_type || r.type || (isImage(r.url) ? 'Image' : '—') },
    { key: 'url', label: 'URL', render: r => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>View</a> : '—' },
  ]

  // Social-media publishing: never invent a date/time — blanks read as
  // "Not Uploaded" / "—" so an unpublished platform is obvious in the PDF.
  const socialPlatformLabel = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' }
  const socialStatusLabel = (s) => s === 'Uploaded' ? 'Uploaded' : s === 'Not Applicable' ? 'N/A' : 'Not Uploaded'
  const socialCols = [
    { key: 'platform', label: 'Platform', render: r => socialPlatformLabel[r.platform] || r.platform },
    { key: 'status', label: 'Status', render: r => socialStatusLabel(r.status) },
    { key: 'upload_date', label: 'Upload Date', render: r => (r.status === 'Uploaded' && r.upload_date) ? fmtDate(r.upload_date) : '—' },
    { key: 'upload_time', label: 'Upload Time', render: r => (r.status === 'Uploaded' && r.upload_time) ? fmtTime(r.upload_time) : '—' },
    { key: 'not_applicable_reason', label: 'Reason (Not Applicable)', render: r => r.not_applicable_reason || '—' },
  ]
  const socialRows = reportData?.social || []
  const socialResolved = socialRows.filter(s => s.status === 'Uploaded' || s.status === 'Not Applicable').length
  const showSocial = socialRows.length > 0 && (isCompleted || socialRows.some(s => s.status !== 'Pending'))

  const statusBadge = (s) => {
    const color = STATUS_COLOR[s] || '#6b7280'
    const label = STATUS_LABEL[s] || s
    return <span style={{ background: color, color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{label}</span>
  }

  const printHeader = (title, subtitle) => (
    <div className="eh-print-brand">
      <div style={{ fontSize: 20, fontWeight: 800, color: '#1a1a2e' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>}
    </div>
  )

  const printFooter = () => (
    <div className="eh-print-footer">
      Generated: {new Date().toLocaleString('en-IN')} · UCS CRM — Event Report · Confidential
    </div>
  )

  const selectStyle = { padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontSize: 13 }
  const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: '#6b7280', marginBottom: 4 }
  const tabStyle = (active) => ({
    padding: '9px 18px', borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active ? '#2036bd' : 'var(--line)'}`,
    background: active ? '#2036bd' : '#fff', color: active ? '#fff' : '#374151',
  })

  return (
    <>
      {toast && (
        <div className="no-print" style={{ position: 'fixed', top: 20, right: 20, zIndex: 3000, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderRadius: 12, background: '#065f46', color: '#fff', fontSize: 13.5, fontWeight: 600, boxShadow: '0 12px 34px rgba(0,0,0,0.22)' }}>
          <span>✓</span>{toast}
        </div>
      )}
      {/* ── Reporting header: the whole screen is these two report types ── */}
      <div className="eh-report-tabs no-print" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 18, margin: 0 }}>Reporting — Event Reports</h3>
        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 3 }}>
          Choose a report:
          <b> Daily</b> = one event you created for a single day, with its own downloadable report.
          <b> Monthly</b> = every event in a chosen month, grouped by NGO.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {/* <button type="button" onClick={() => setMode('daily')} style={tabStyle(mode === 'daily')}>📅 Daily Event Report</button> */}
          <button type="button" onClick={() => setMode('monthly')} style={tabStyle(mode === 'monthly')}>🗓 Monthly Report</button>
        </div>
      </div>

      {/* ── DAILY EVENT controls ── */}
      {mode === 'daily' && (
        <div className="card no-print" style={{ marginBottom: 16 }}>
          <div className="card-pad" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>Show</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
                <option value="">All Events</option>
                <option value="Submitted">Submitted only</option>
                <option value="Completed">Completed only</option>
                <option value="Draft">Draft only</option>
              </select>
            </div>
            <div style={{ flex: '1 1 300px', minWidth: 240 }}>
              <label style={labelStyle}>Pick the event (day) to report</label>
              <select
                value={selectedEvent}
                onChange={e => { const v = e.target.value; setSelectedEvent(v); if (v) generate(v); else setReportData(null) }}
                style={{ ...selectStyle, width: '100%' }}
              >
                <option value="">Select an event…</option>
                {[...filteredEvents].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || 0).map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {fmtDate(ev.date)} · {ev.name} · {ev.status}{ev.status_new ? ' · NEW' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Report type</label>
              <select value={reportType} onChange={e => { setReportType(e.target.value); setReportData(null) }} style={selectStyle}>
                {REPORT_TYPES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <button className="btn btn-sm" onClick={loadEvents} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '🔄 Refresh'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => generate()} disabled={!selectedEvent || loading}>
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>
      )}

      {/* ── MONTHLY controls ── */}
      {mode === 'monthly' && (
        <div className="card no-print" style={{ marginBottom: 16 }}>
          <div className="card-pad" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>Month</label>
              <select value={monthlyMonth} onChange={e => setMonthlyMonth(e.target.value)} style={selectStyle}>
                {Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, '0'); return <option key={m} value={m}>{new Date(2000, i, 1).toLocaleString('en-IN', { month: 'long' })}</option> })}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Year</label>
              <select value={monthlyYear} onChange={e => setMonthlyYear(e.target.value)} style={selectStyle}>
                {Array.from({ length: 5 }, (_, i) => { const y = String(now.getFullYear() - 2 + i); return <option key={y} value={y}>{y}</option> })}
              </select>
            </div>
            <div>
              <label style={labelStyle}>NGO</label>
              <select value={monthlyNgo} onChange={e => setMonthlyNgo(e.target.value)} style={selectStyle}>
                <option value="">All NGOs</option>
                {ngos.map(n => <option key={n.id ?? n.ngo_id} value={n.id ?? n.ngo_id}>{n.name || n.ngo_name || n.code || `NGO ${n.id ?? n.ngo_id}`}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Happy Family count (BSCT)</label>
              <input value={happyFamily} onChange={e => setHappyFamily(e.target.value)} placeholder="e.g. 4290" inputMode="numeric" maxLength={12} style={{ ...selectStyle, width: 150 }} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={generateMonthly} disabled={monthlyLoading}>
              {monthlyLoading ? 'Loading…' : 'Generate Monthly Report'}
            </button>
            {monthlyData && <>
              <button className="btn btn-sm" style={{ background: '#dc2626', color: '#fff', border: 'none' }} onClick={exportMonthlyPDF}>Download PDF</button>
              <button className="btn btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none' }} onClick={exportMonthlyExcel}>Download Excel</button>
              <button className="btn btn-sm" onClick={exportMonthlyCSV}>Download CSV</button>
            </>}
          </div>
        </div>
      )}

      {/* ═══ MONTHLY REPORT (per NGO) ═══ */}
      {mode === 'monthly' && (
        <div className="card" style={{ background: '#fff', marginBottom: 20 }}>
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3>Monthly Report <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>· by NGO</span></h3>
          </div>
          <div className="card-pad" style={{ paddingTop: 8 }}>
            {monthlyLoading && <div style={{ textAlign: 'center', padding: 24, color: 'var(--ink-soft)' }}>Loading monthly report…</div>}
            {!monthlyLoading && !monthlyData && (
              <div style={{ color: 'var(--ink-soft)', fontSize: 13, padding: 12 }}>
                Select a month{monthlyNgo ? ' and NGO' : ''} and click <b>Generate Monthly Report</b> to see per-NGO activity.
              </div>
            )}
            {!monthlyLoading && monthlyData && (
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                  <span style={{ background: '#eff6ff', color: '#1e40af', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600 }}>
                    {monthlyMonthLabel} {monthlyYearLabel}
                  </span>
                  <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>{monthlyData.summary.totalEvents} completed programme{monthlyData.summary.totalEvents === 1 ? '' : 's'}</span>
                  <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>{monthlyData.ngos.length} NGO{monthlyData.ngos.length === 1 ? '' : 's'}</span>
                  <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>Beneficiaries: {monthlyData.summary.totalBeneficiaries.toLocaleString('en-IN')}</span>
                  <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>Budget: {money(monthlyData.summary.totalBudget)}</span>
                </div>

                {monthlyData.summary.totalEvents === 0 && (
                  <div style={{ color: '#9ca3af', fontSize: 13, padding: 12, marginBottom: 12 }}>
                    No completed programmes for this month.
                    {Number(monthlyData.summary.selectedSuggestions || 0) < Number(monthlyData.summary.suggestions || 0) && (
                      <div style={{ marginTop: 6 }}>
                        {Number(monthlyData.summary.suggestions || 0) - Number(monthlyData.summary.selectedSuggestions || 0)} programme
                        {Number(monthlyData.summary.suggestions || 0) - Number(monthlyData.summary.selectedSuggestions || 0) === 1 ? ' was' : 's were'}
                        {' '}generated for this month but not selected yet — select them in <b>Suggest Programmes</b>, and once they are completed they will be listed here.
                      </div>
                    )}
                  </div>
                )}

                <div ref={monthlyReportElRef} style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 4 }}>
                  {orderedNgos.map(n => {
                    const nameCode = codeForName(n.ngo_name)
                    const rawCode = String(n.code || '').toLowerCase()
                    const code = nameCode || (['aflf', 'bsct', 'mann'].includes(rawCode) ? rawCode : '')
                    const theme = n.code ? ngoTheme(n) : ngoTheme({ ...n, code: nameCode || rawCode })
                    const cardRef = el => { ngoCardRefs.current[String(n.ngo_id)] = el }
                    const ngoKey = String(n.ngo_id ?? '')
                    return <FestivalProgrammeCard key={String(n.ngo_id)} cardRef={cardRef} n={n} theme={theme} code={code} monthLabel={monthlyMonthLabel} yearLabel={monthlyYearLabel} happyCount={happyFamily} onReorder={(keys) => handleCardReorder(ngoKey, keys)} />
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ DAILY EVENT REPORT (single event) ═══ */}
      {mode === 'daily' && reportData && (
        <div className="card" style={{ background: '#fff' }}>
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3>{REPORT_TYPES.find(r => r.id === reportType)?.label}</h3>
            <div className="eh-reports-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => downloadPosterPdf()} disabled={pdfBusy}>{pdfBusy ? 'Preparing…' : 'Download Poster PDF'}</button>
              <button className="btn btn-sm" onClick={() => downloadSinglePdf()} disabled={pdfBusy}>Download Full Report</button>
              <button className="btn btn-sm" onClick={exportJSON}>Export JSON</button>
              {reportType === 'expense' && <button className="btn btn-sm" onClick={() => exportCSV(expenseCols, reportData.expenses || [], `expenses-${ev.id}.csv`)}>Export CSV</button>}
            </div>
          </div>

          <div className="card-pad" style={{ paddingTop: 4 }}>
            {/* Off-screen poster used for the one-page poster PDF */}
            <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
              <EventPosterReport
                ref={posterRef}
                title={ev.name || ''}
                headline={ev.poster_headline || ev.name || ''}
                date={ev.date}
                description={ev.description || ''}
                venue={ev.venue || ''}
                tagline={ev.tagline || ev.slogan || ''}
                footerQuote={ev.footer_quote || ''}
                reportNo={ev.report_no || ''}
                brandName={isBsct ? 'Being Sevak' : (dailyTheme.fullName || dailyNgoName)}
                brandSub={isBsct ? 'Charitable Trust' : ''}
                teamMembers={posterTeam}
                photos={posterPhotos}
                logoUrl={dailyLogo || ''}
                sevakBanoImage="/logo/sevak-logo.png"
                brandImage={isBsct ? '/logo/bsct-logo.png' : ''}
              />
            </div>
            <div className="eh-print-root" ref={singleReportRef}>
              {/* ── NGO-BRANDED REPORT CARD (letterhead + banner + facts) ── */}
              <div
                className="eh-report-body"
                style={{ background: '#fff', border: '1px solid #e5e7eb', borderTop: `5px solid ${dailyTheme.color}`, borderRadius: 12, overflow: 'hidden' }}
              >
                {/* Letterhead: NGO identity (logo + name + colour) and report meta */}
                <div style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                  {dailyLogo ? (
                    <img src={dailyLogo} alt={dailyNgoName} style={{ width: 58, height: 58, objectFit: 'contain', background: '#fff', borderRadius: 10, border: '1px solid #eef0f4', padding: 5, flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none' }} />
                  ) : (
                    <div style={{ width: 58, height: 58, borderRadius: 10, background: dailyTheme.color, color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>{String(dailyTheme.name || dailyNgoName || 'R').slice(0, 1)}</div>
                  )}
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    {dailyTheme.tagline && <div style={{ fontSize: 10, letterSpacing: 2.2, fontWeight: 700, textTransform: 'uppercase', color: dailyTheme.color }}>{dailyTheme.tagline}</div>}
                    <div style={{ fontSize: 21, fontWeight: 900, color: '#1a1a2e', letterSpacing: 0.2, lineHeight: 1.2 }}>{dailyTheme.fullName || dailyNgoName}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{dailyNgoName}</div>
                  </div>
                  <div style={{ textAlign: 'right', paddingLeft: 18, borderLeft: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 10, letterSpacing: 2, fontWeight: 800, textTransform: 'uppercase', color: dailyTheme.color }}>Daily Event Report</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1a2e', marginTop: 4 }}>{fmtDate(ev.date)}</div>
                    {ev.day && <div style={{ fontSize: 11.5, color: '#6b7280' }}>{ev.day}</div>}
                  </div>
                </div>

                <div style={{ height: 4, background: dailyTheme.color }} />

                {/* Event banner (omitted cleanly when the event has none) */}
                {ev.banner && (
                  <div style={{ maxHeight: 320, overflow: 'hidden', lineHeight: 0 }}>
                    <ReportBanner src={ev.banner} alt={ev.name} />
                  </div>
                )}

                {/* Title + badges */}
                <div style={{ padding: '18px 22px 0' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', lineHeight: 1.25 }}>{ev.name || 'Event Report'}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    {ev.category && <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '3px 11px', fontSize: 11.5, fontWeight: 600 }}>{ev.category}</span>}
                    {ev.ngo_name && <span style={{ background: dailyTheme.color, color: '#fff', borderRadius: 999, padding: '3px 11px', fontSize: 11.5, fontWeight: 700 }}>{ev.ngo_name}</span>}
                    {statusBadge(isCompleted ? 'Completed' : ev.status)}
                  </div>
                </div>

                {/* Key facts */}
                <div style={{ padding: '16px 22px 22px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px 20px' }}>
                  <KeyVal label="Date" value={fmtDate(ev.date)} />
                  <KeyVal label="Day" value={ev.day ? ev.day.split(' ')[0] : '—'} />
                  <KeyVal label="Start Time" value={fmtTime(ev.start_time)} />
                  <KeyVal label="End Time" value={fmtTime(ev.end_time)} />
                  <KeyVal label="Venue" value={ev.venue} />
                  <KeyVal label="Sector" value={ev.sector_name} />
                  <KeyVal label="Activity" value={ev.activity_name} />
                  <KeyVal label="Budget" value={money(ev.budget)} />
                  <KeyVal label="Beneficiaries" value={ev.expected_beneficiaries || '—'} />
                </div>
              </div>

              {ev.description && (
                <Section title="About This Event">
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ev.description}</div>
                </Section>
              )}

              <Section title="Attendance" right={<span style={{ fontSize: 12, color: '#6b7280' }}>{reportData.attendance?.length || 0} records</span>}>
                <Table cols={attendanceCols} rows={reportData.attendance || []} />
              </Section>

              <Section title="Media / Images" right={<span style={{ fontSize: 12, color: '#6b7280' }}>{reportData.media?.length || 0} items</span>}>
                {(reportData.media || []).length > 0 ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginBottom: 14 }}>
                      {(reportData.media || []).filter(m => isImage(m.url)).map((m, i) => (
                        <a key={i} href={m.url} target="_blank" rel="noreferrer" title={m.title || m.name} style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb', display: 'block', background: '#f3f4f6' }}>
                          <SafeImg src={m.url} alt={m.title || m.name || 'media'} height={200} radius={0} />
                          {(m.title || m.name) && <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, padding: '8px 10px' }}>{m.title || m.name}</div>}
                        </a>
                      ))}
                    </div>
                    <Table cols={mediaCols} rows={reportData.media || []} />
                  </>
                ) : <div style={{ color: '#9ca3af', fontSize: 13 }}>No media records</div>}
              </Section>

              {showSocial && (
                <Section title="Social Media Publishing Report" right={<span style={{ fontSize: 12, color: '#6b7280' }}>{socialResolved} of {socialRows.length} resolved</span>}>
                  <Table cols={socialCols} rows={socialRows} />
                </Section>
              )}

              <Section title="Expenses" right={<span style={{ fontSize: 12, color: '#6b7280' }}>Total: {money((reportData.expenses || []).reduce((s, x) => s + (Number(x.amount) || 0), 0))}</span>}>
                <Table cols={expenseCols} rows={reportData.expenses || []} />
              </Section>

              <Section title="Material Distribution" right={<span style={{ fontSize: 12, color: '#6b7280' }}>{reportData.distributions?.length || 0} records</span>}>
                <Table cols={distCols} rows={reportData.distributions || []} />
              </Section>

              <Section title="Checklist">
                <Table cols={checklistCols} rows={reportData.checklist || []} />
              </Section>

              <ReportCardFooter theme={dailyTheme} n={{ ngo_name: dailyNgoName }} monthLabel="" yearLabel="" />
              {printFooter()}
            </div>
          </div>
        </div>
      )}

      {mode === 'daily' && !reportData && !loading && (
        <div className="card no-print">
          <div className="card-pad" style={{ textAlign: 'center', padding: 40, color: 'var(--ink-soft)' }}>
            Pick an event above to open its <b>daily report</b>, then use <b>Download PDF</b> to save it.
          </div>
        </div>
      )}

      <style>{`
        @page { margin: 10mm; }
        @media screen {
          .eh-print-brand { border-bottom: 3px solid #2036bd; padding-bottom: 10px; margin-bottom: 16px; }
          .eh-print-footer { margin-top: 20px; border-top: 1px solid #d1d5db; padding-top: 8px; text-align: right; color: #6b7280; font-size: 10px; }
          /* The Monthly Report's programme cards can be dragged into a new
             order. The handle sits on the photo, so it never shifts the card,
             and it is hidden from the PDF (data-html2canvas-ignore) and from
             the browser's own print (no-print). */
          .eh-drag-handle {
            position: absolute; top: 8px; left: 8px; z-index: 2;
            cursor: grab; user-select: none; -webkit-user-select: none;
            background: rgba(15, 23, 42, 0.55); color: #fff;
            border-radius: 6px; padding: 2px 6px; font-size: 12px; line-height: 1.1;
          }
          .eh-drag-handle:active { cursor: grabbing; }
          .eh-report-card.dragging { opacity: 0.45; }
          .eh-report-card.drag-over { outline: 2px dashed #2563eb; outline-offset: -3px; }
        }
        @media print {
          html, body { background:#fff !important; }

          /* Chrome is removed with display, not visibility. The old rule used
             'body * { visibility:hidden }', which still lays every box out, so
             the shell's own height produced pages of blank output around the
             report and the report landed on top of them. */
          .panel-event-head .sidebar,
          .panel-event-head .sidebar-overlay,
          .panel-event-head .topbar,
          .panel-event-head .user-menu,
          .panel-event-head .card-head,
          .no-print { display:none !important; }

          /* The shell is a fixed-height flex column whose content-body is a
             nested scroller; both clip printed output, so the chain is
             un-bounded here and the report flows as one document. */
          .panel-event-head .app,
          .panel-event-head .main,
          .panel-event-head .content-body {
            display:block !important; height:auto !important; max-height:none !important;
            min-height:0 !important; overflow:visible !important; flex:none !important;
          }
          .panel-event-head .content-body { padding:0 !important; }
          .panel-event-head .card { border:none !important; box-shadow:none !important; }
          .eh-print-root { position:static !important; width:auto !important; }

          /* The status pills and the banner header are colour blocks on a white
             page. Browsers drop backgrounds by default, so they printed
             white-on-white; this forces them to keep their fill. */
          * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }

          .eh-print-root thead { display:table-header-group; }
          .eh-print-root tr { page-break-inside:avoid; break-inside:avoid; }
          /* The screen-side scroll wrapper (width:100% + overflow-x:auto + the
             table's inline min-width) would clip wide tables on paper, so it is
             disabled for print; the table then flows across the page normally. */
          .eh-print-root .eh-table-scroll { overflow: visible !important; }
          .eh-print-root .eh-table-scroll table { min-width: 0 !important; }
          .eh-report-body, .eh-print-brand, .eh-print-footer {
            page-break-inside:avoid; break-inside:avoid;
          }
          /* Each NGO report card starts on its own page. The NGO card may flow
             across pages (it can be taller than one), but an individual event
             card is never split and the header/footer are never orphaned. */
          .eh-ngo-card { page-break-inside: auto; break-inside: auto; }
          .eh-ngo-card + .eh-ngo-card { page-break-before: always; break-before: page; }
          .eh-activity-card { page-break-inside: avoid; break-inside: avoid; }
          .eh-ngo-card > *:first-child { page-break-after: avoid; break-after: avoid; }
          .eh-ngo-card > *:last-child { page-break-before: avoid; break-before: avoid; }
        }
      `}</style>
    </>
  )
}
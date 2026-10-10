import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchEvents, generateEventReport, generateAllEventsReport, generateNgoMonthlyReport, fetchWorkspaceNgos, uploadEventBanner, updateEvent, fetchEventBannerObjectUrl } from '../store'

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
    banner: '/Letter%20Head%20BSCT%20(1).png',
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
const STATUS_COLOR = { Completed: '#16a34a', Submitted: '#2563eb', Approved: '#0ea5e9', Rejected: '#dc2626', Draft: '#f59e0b' }

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

const BANNER_FALLBACK = {
  width: '100%', height: 130,
  background: 'linear-gradient(135deg,#2036bd,#0ea5e9)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#fff', fontSize: 14, fontWeight: 700,
}

/* Every banner/media <img> in this file used onError={e => e.currentTarget.style.display='none'}.
   For the report header that left a black bar: the wrapper is background:#0f172a and the
   gradient fallback only rendered when there was no URL at all, so a URL that failed to
   load produced an empty void with no indication anything was wrong. A failed load now
   falls back to the same branded block used for "no banner". */
function ReportBanner({ src, alt }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) return <div style={BANNER_FALLBACK}>EVENT BANNER</div>
  return (
    <img
      src={src}
      alt={alt || 'banner'}
      onError={() => setFailed(true)}
      style={{ width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block' }}
    />
  )
}

function SafeImg({ src, alt, height, radius = 8 }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
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
      style={{ width: '100%', height, objectFit: 'cover', display: 'block', borderRadius: radius }}
    />
  )
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
    ;(async () => {
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
      border: `1.5px solid ${theme.accent || theme.colorLight}`,
      borderRadius: rounded ? 12 : 10, overflow: 'hidden',
      breakInside: 'avoid', pageBreakInside: 'avoid',
    }}>
      <div style={{ position: 'relative', width: '100%', height: imgH, background: '#f1f5f9', overflow: 'hidden', flexShrink: 0, borderRadius: rounded ? 10 : 0 }}>
        {ev.banner ? (
          <SafeImg src={bannerUrl || ev.banner} alt={ev.name} height="100%" radius={rounded ? 10 : 0} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: `linear-gradient(140deg, ${theme.color}, ${theme.colorDark})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, textAlign: 'center', padding: 8 }}>EVENT BANNER</div>
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

export default function EventReports() {
  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [reportType, setReportType] = useState('summary')
  const [reportData, setReportData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('Submitted')
  const [allData, setAllData] = useState(null)
  const [allLoading, setAllLoading] = useState(false)

  const [refreshing, setRefreshing] = useState(false)

  // ── Monthly Report state ──
  const now = new Date()
  const [monthlyMonth, setMonthlyMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))
  const [monthlyYear, setMonthlyYear] = useState(String(now.getFullYear()))
  const [monthlyNgo, setMonthlyNgo] = useState('')
  const [monthlyData, setMonthlyData] = useState(null)
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [ngos, setNgos] = useState([])

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
      setSelectedEvent(prev => prev || (normalized.find(e => e.status === 'Submitted')?.id) || '')
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
    const id = forceId || selectedEvent
    if (!id) return
    setLoading(true)
    setReportData(null)
    try {
      const data = await generateEventReport(id, reportType)
      setReportData(data)
    } catch (err) { alert('Failed to generate report') }
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
    try {
      const data = await generateNgoMonthlyReport({ month: monthlyMonth, year: monthlyYear, ngo_id: monthlyNgo || undefined })
      setMonthlyData(data)
    } catch (err) { alert('Failed to load monthly report') }
    finally { setMonthlyLoading(false) }
  }

  // Auto-load the monthly report (all NGOs) when the page opens, so the
  // report cards appear without a click. The Generate button below is kept
  // as a manual fallback.
  useEffect(() => {
    generateMonthly() /* eslint-disable-line react-hooks/exhaustive-deps */
  }, [])

  const exportMonthlyCSV = () => {
    const rows = (monthlyData?.ngos || []).flatMap(n => n.events.map(e => ({
      ngo: n.ngo_name, event: e.name, sector: e.sector_name, activity: e.activity_name,
      date: e.date, day: e.day, venue: e.venue, status: e.status, budget: e.budget,
    })))
    const cols = [
      { key: 'ngo', label: 'NGO' },
      { key: 'event', label: 'Event' },
      { key: 'sector', label: 'Sector' },
      { key: 'activity', label: 'Activity' },
      { key: 'date', label: 'Date' },
      { key: 'day', label: 'Day' },
      { key: 'venue', label: 'Venue' },
      { key: 'status', label: 'Status' },
      { key: 'budget', label: 'Budget', render: r => money(r.budget) },
    ]
    exportCSV(cols, rows, `monthly-report-${monthlyYear}-${monthlyMonth}.csv`)
  }

  const monthlyMonthLabel = monthlyData
    ? new Date(Number(monthlyData.year), Number(monthlyData.month) - 1, 1).toLocaleString('en-IN', { month: 'long' })
    : new Date(Number(monthlyYear), Number(monthlyMonth) - 1, 1).toLocaleString('en-IN', { month: 'long' })
  const monthlyYearLabel = monthlyData ? String(monthlyData.year) : String(monthlyYear)

  const exportMonthlyExcel = async () => {
    const XLSX = await import('xlsx-js-style')
    const rows = (monthlyData?.ngos || []).flatMap(n => n.events.map(e => ({
      ngo: n.ngo_name, event: e.name, sector: e.sector_name, activity: e.activity_name,
      date: e.date || '', day: e.day || '', venue: e.venue || '', status: e.status || '',
      beneficiaries: Number(e.beneficiaries) || 0, budget: Number(e.budget) || 0,
    })))
    const headers = ['NGO', 'Event', 'Sector', 'Activity', 'Date', 'Day', 'Venue', 'Status', 'Beneficiaries', 'Budget (₹)']
    const aoa = [headers, ...rows.map(r => [
      r.ngo, r.event, r.sector, r.activity, r.date, r.day, r.venue, r.status, r.beneficiaries, r.budget,
    ])]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 18 }, { wch: 26 }, { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 13 }, { wch: 12 }]
    if (!ws['!rows']) ws['!rows'] = []
    ws['!rows'][0] = { hpt: 22 }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Monthly Report')
    XLSX.writeFile(wb, `monthly-report-${monthlyYearLabel}-${monthlyMonthLabel}.xlsx`)
  }

  const monthlyReportElRef = useRef(null)
  const ngoCardRefs = useRef({})
  const exportMonthlyPDF = async () => {
    const ngos = monthlyData?.ngos || []
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
      pdf.save(`monthly-report-${monthlyYearLabel}-${monthlyMonthLabel}.pdf`)
    } catch (err) {
      console.error('exportMonthlyPDF error:', err)
      alert('Failed to generate monthly PDF')
    }
  }

  const ev = reportData?.event || {}
  const isCompleted = COMPLETED.includes(ev.status)

  const downloadPdf = () => {
    window.print()
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

  return (
    <>
      <div className="eh-reports-bar no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ fontSize: 16 }}>Event Reports <span style={{ fontWeight: 500, fontSize: 12, color: '#6b7280' }}>({filteredEvents.length} shown · {events.filter(e => e.status === 'Submitted').length} submitted)</span></h3>
        <div className="eh-reports-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setAllData(null) }} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
            <option value="Submitted">Submitted only</option>
            <option value="Completed">Completed only</option>
            <option value="">All Events</option>
            <option value="Draft">Draft only</option>
          </select>
          <select value={selectedEvent} onChange={e => { const v = e.target.value; setSelectedEvent(v); if (v) generate(v); else setReportData(null) }} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontSize: 13, maxWidth: 320 }}>
            <option value="">Select Event</option>
            {[...filteredEvents].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || 0).map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.name} · {ev.status}{ev.status_new ? ' · NEW' : ''}
              </option>
            ))}
          </select>
          <select value={reportType} onChange={e => { setReportType(e.target.value); setReportData(null) }} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
            {REPORT_TYPES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button className="btn btn-sm" onClick={loadEvents} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '🔄 Refresh'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={generate} disabled={!selectedEvent || loading}>
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
          <button className="btn btn-sm" onClick={generateAll} disabled={allLoading}>
            {allLoading ? 'Loading...' : 'All Events Summary'}
          </button>
        </div>
      </div>

      {/* ═══ ALL-EVENTS SUMMARY ═══ */}
      {allData && (
        <div className="card" style={{ background: '#fff', marginBottom: 20 }} id="eh-all-summary">
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3>All Events Summary Report <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>({allData.total || 0} events{statusFilter ? ` · ${statusFilter}` : ''})</span></h3>
            <div className="eh-reports-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={downloadPdf}>Download PDF</button>
              <button className="btn btn-sm" onClick={() => exportAllCSV(allData.events || [])}>Download CSV</button>
            </div>
          </div>
          <div className="card-pad" style={{ paddingTop: 4 }}>
            <div className="eh-print-root">
              {printHeader('All Events Summary')}
              <div style={{ contentVisibility: 'auto' }}>
                <Table cols={allCols} rows={allData.events || []} />
              </div>
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                <KeyVal label="Total Events" value={allData.total || 0} />
                <KeyVal label="Submitted" value={(allData.events || []).filter(e => isSubmitted(e.status)).length} />
                <KeyVal label="Completed" value={(allData.events || []).filter(e => e.status === 'Completed').length} />
                <KeyVal label="Total Budget" value={money((allData.events || []).reduce((s, e) => s + (Number(e.budget) || 0), 0))} />
              </div>
              {printFooter()}
            </div>
          </div>
        </div>
      )}
      {!allData && allLoading && <div className="card"><div className="card-pad" style={{ textAlign: 'center', padding: 30, color: 'var(--ink-soft)' }}>Loading all events summary…</div></div>}

      {/* ═══ MONTHLY REPORT (per NGO) ═══ */}
      <div className="card" style={{ background: '#fff', marginBottom: 20 }}>
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3>Monthly Report <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>· by NGO</span></h3>
          <div className="eh-reports-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={monthlyMonth} onChange={e => setMonthlyMonth(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
              {Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, '0'); return <option key={m} value={m}>{new Date(2000, i, 1).toLocaleString('en-IN', { month: 'long' })}</option> })}
            </select>
            <select value={monthlyYear} onChange={e => setMonthlyYear(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
              {Array.from({ length: 5 }, (_, i) => { const y = String(now.getFullYear() - 2 + i); return <option key={y} value={y}>{y}</option> })}
            </select>
            <select value={monthlyNgo} onChange={e => setMonthlyNgo(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
              <option value="">All NGOs</option>
              {ngos.map(n => <option key={n.id ?? n.ngo_id} value={n.id ?? n.ngo_id}>{n.name || n.ngo_name || n.code || `NGO ${n.id ?? n.ngo_id}`}</option>)}
            </select>
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
                <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>{monthlyData.summary.totalEvents} events</span>
                <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>{monthlyData.ngos.length} NGO{monthlyData.ngos.length === 1 ? '' : 's'}</span>
                <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>Beneficiaries: {monthlyData.summary.totalBeneficiaries.toLocaleString('en-IN')}</span>
                <span style={{ background: '#f3f4f6', color: '#374151', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>Budget: {money(monthlyData.summary.totalBudget)}</span>
              </div>

              {monthlyData.ngos.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13, padding: 12 }}>No events found for this month.</div>}

              <div ref={monthlyReportElRef} style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 4 }}>
                {monthlyData.ngos.map(n => {
                  const nameCode = codeForName(n.ngo_name)
                  const rawCode = String(n.code || '').toLowerCase()
                  const code = nameCode || (['aflf', 'bsct', 'mann'].includes(rawCode) ? rawCode : '')
                  const theme = n.code ? ngoTheme(n) : ngoTheme({ ...n, code: nameCode || rawCode })
                  const headerBg = theme.color
                  const logo = n.logo || theme.logo
                  const bannerSrc = n.banner || theme.banner
                  const cardRef = el => { ngoCardRefs.current[String(n.ngo_id)] = el }
                  if (code === 'mann') return <MonthInActionLayout key={String(n.ngo_id)} cardRef={cardRef} n={n} theme={theme} monthLabel={monthlyMonthLabel} yearLabel={monthlyYearLabel} onPatched={patchMonthlyEvent} />
                  if (code === 'aflf') return <GlimpsesLayout key={String(n.ngo_id)} cardRef={cardRef} n={n} theme={theme} monthLabel={monthlyMonthLabel} yearLabel={monthlyYearLabel} onPatched={patchMonthlyEvent} />
                  return (
                    <div key={String(n.ngo_id)} ref={cardRef} className="eh-ngo-card" style={{ border: `2px solid ${headerBg}`, borderRadius: 12, overflow: 'hidden', background: '#fff', pageBreakInside: 'avoid' }}>
                      <ReportCardHeader logo={logo} theme={theme} ngoName={n.ngo_name} monthLabel={monthlyMonthLabel} yearLabel={monthlyYearLabel} eventCount={n.events_count} />

                      {/* Optional letterhead band */}
                      {bannerSrc && (
                        <div style={{ height: 84, background: '#f1f5f9', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `3px solid ${headerBg}` }}>
                          <SafeImg src={bannerSrc} alt="" height={84} radius={0} />
                        </div>
                      )}

                      {/* Event photo cards — date, title, description, impact */}
                      <div style={{ padding: '14px 16px' }}>
                        {n.events.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>No events for this month.</div>}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
                          {n.events.map((ev, i) => <ActivityCard key={ev.id ?? i} ev={ev} theme={theme} onPatched={patchMonthlyEvent} />)}
                        </div>
                      </div>

                      <ReportCardFooter theme={theme} n={n} monthLabel={monthlyMonthLabel} yearLabel={monthlyYearLabel} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ SINGLE EVENT REPORT ═══ */}
      {reportData && (
        <div className="card" style={{ background: '#fff' }}>
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3>{REPORT_TYPES.find(r => r.id === reportType)?.label}</h3>
            <div className="eh-reports-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={downloadPdf}>Download PDF</button>
              <button className="btn btn-sm" onClick={exportJSON}>Export JSON</button>
              {reportType === 'expense' && <button className="btn btn-sm" onClick={() => exportCSV(expenseCols, reportData.expenses || [], `expenses-${ev.id}.csv`)}>Export CSV</button>}
            </div>
          </div>

          <div className="card-pad" style={{ paddingTop: 4 }}>
            <div className="eh-print-root">
              {printHeader(ev.name || 'Event Report', ev.ngo_name || '')}

              {/* REPORT HEADER */}
              <div className="eh-report-body" style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ position: 'relative', background: '#0f172a' }}>
                  <ReportBanner src={ev.banner} alt={ev.name} />
                </div>
                <div style={{ padding: 18, display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 260px' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#1a1a2e', marginBottom: 6 }}>{ev.name || 'Event Report'}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      {ev.ngo_name && <span style={{ background: '#2036bd', color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{ev.ngo_name}</span>}
                      {statusBadge(isCompleted ? 'Completed' : ev.status)}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: 13 }}>{ev.day || fmtDate(ev.date)}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, minWidth: 200 }}>
                    <KeyVal label="Date" value={fmtDate(ev.date)} />
                    <KeyVal label="Day" value={ev.day ? ev.day.split(' ')[0] : '—'} />
                    <KeyVal label="Sector" value={ev.sector_name} />
                    <KeyVal label="Activity" value={ev.activity_name} />
                    <KeyVal label="Venue" value={ev.venue} />
                    <KeyVal label="Budget" value={money(ev.budget)} />
                  </div>
                </div>
              </div>

              <Section title="Event Summary">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                  <KeyVal label="Start Time" value={fmtTime(ev.start_time)} />
                  <KeyVal label="End Time" value={fmtTime(ev.end_time)} />
                  <KeyVal label="Status" value={ev.status} />
                  <KeyVal label="Expected Beneficiaries" value={ev.expected_beneficiaries || '—'} />
                </div>
              </Section>

              <Section title="Attendance" right={<span style={{ fontSize: 12, color: '#6b7280' }}>{reportData.attendance?.length || 0} records</span>}>
                <Table cols={attendanceCols} rows={reportData.attendance || []} />
              </Section>

              <Section title="Media / Images" right={<span style={{ fontSize: 12, color: '#6b7280' }}>{reportData.media?.length || 0} items</span>}>
                {(reportData.media || []).length > 0 ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px,1fr))', gap: 10, marginBottom: 12 }}>
                      {(reportData.media || []).filter(m => isImage(m.url)).map((m, i) => (
                        <a key={i} href={m.url} target="_blank" rel="noreferrer" title={m.title || m.name} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb', display: 'block' }}>
                          <SafeImg src={m.url} alt={m.title || m.name || 'media'} height={90} />
                        </a>
                      ))}
                    </div>
                    <Table cols={mediaCols} rows={reportData.media || []} />
                  </>
                ) : <div style={{ color: '#9ca3af', fontSize: 13 }}>No media records</div>}
              </Section>

              <Section title="Expenses" right={<span style={{ fontSize: 12, color: '#6b7280' }}>Total: {money((reportData.expenses || []).reduce((s, x) => s + (Number(x.amount) || 0), 0))}</span>}>
                <Table cols={expenseCols} rows={reportData.expenses || []} />
              </Section>

              <Section title="Material Distribution" right={<span style={{ fontSize: 12, color: '#6b7280' }}>{reportData.distributions?.length || 0} records</span>}>
                <Table cols={distCols} rows={reportData.distributions || []} />
              </Section>

              <Section title="Checklist">
                <Table cols={checklistCols} rows={reportData.checklist || []} />
              </Section>

              {printFooter()}
            </div>
          </div>
        </div>
      )}

      {!reportData && !allData && !loading && !allLoading && <div className="card no-print"><div className="card-pad" style={{ textAlign: 'center', padding: 40, color: 'var(--ink-soft)' }}>Select an event and click Generate Report, or click All Events Summary.</div></div>}

      <style>{`
        @page { margin: 10mm; }
        @media screen {
          .eh-print-brand { border-bottom: 3px solid #2036bd; padding-bottom: 10px; margin-bottom: 16px; }
          .eh-print-footer { margin-top: 20px; border-top: 1px solid #d1d5db; padding-top: 8px; text-align: right; color: #6b7280; font-size: 10px; }
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
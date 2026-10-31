import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { PageHeader, Select, SearchInput, Badge, StatusPill, Empty } from '../components/ui.jsx'
import MonthlyCalendarView from '../components/planner/MonthlyCalendarView.jsx'
import { renderPosterToPdf } from '../components/eventPosterPdf.jsx'
import {
  fetchWorkspaceNgos,
  fetchSectors,
  fetchActivities,
  fetchCalendarEvents,
  createActivity,
  createEvent,
  uploadEventBanner,
  fetchEventImageDataUrl,
  updateEvent,
  deleteEvent,
  deleteActivity,
  updateActivity,
  suggestActivityPrograms,
  fetchPlannerSuggestions,
  setPlannerSuggestionSelected,
  fetchImportantDays,
  suggestFestivalPrograms,
  getFestivalSuggestions,
  setFestivalSuggestionSelected,
  getPlannerEventLinks,
  setPlannerEventLink,
  deletePlannerEventLink,
  getPlannerManualRows,
  savePlannerManualRow,
  deletePlannerManualRow,
  setFestivalSuggestionsBeneficiary,
  setFestivalSuggestionsLocation,
  mergeProgrammeRows,
  BENEFICIARY_CATEGORIES,
} from '../store.jsx'
import {
  fetchTaskAssignees,
  fetchTaskAssignments,
  fetchTaskMonthAssignments,
  createTaskAssignment,
  deleteTaskAssignment,
} from '../../../api/taskAssignments'
import { fetchReviewedDailyReports } from '../../../api/dailyReports'

/* ── Month helpers (local, so this page shares nothing with the Calendar) ── */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const pad2 = (n) => String(n).padStart(2, '0')

/** Never toISOString() here — IST midnight is the previous day in UTC. */
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

const currentMonthYmd = () => {
  const n = new Date()
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}`
}

const monthLabel = (ymd) => {
  const [y, m] = String(ymd).split('-')
  return `${MONTHS[Number(m) - 1]} ${y}`
}

/** [firstOfMonth, firstOfNextMonth) — the backend's end bound is exclusive. */
const monthBounds = (ymd) => {
  const [y, m] = String(ymd).split('-').map(Number)
  return [`${ymd}-01`, toYmd(new Date(y, m, 1))]
}

/** Every selectable day of the month: the user picks the date, not the AI. */
const daysInMonth = (ymd) => {
  const [y, m] = String(ymd).split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  return Array.from({ length: total }, (_, i) => `${ymd}-${pad2(i + 1)}`)
}

const shortDate = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return String(ymd || '')
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`
}

/* The team calls these NGOs by their codes (BSCT, AFLF, MANN), so codes win over
   the long registered names wherever a short label is needed. */
const ngoShortLabel = (n) =>
  String(n?.code || '').trim() || String(n?.name || '').trim() || 'NGO'

/* The closed vocabulary for the Add Activity dropdown and the Beneficiary
   filter, in a stable order. Shared with every other page that picks a
   category (Activities, Activity detail, Distribution) via the store, and
   mirrored by ACTIVITY_BENEFICIARY_GROUPS on the backend, so a value picked
   here is accepted on save. */
const BENEFICIARY_GROUPS = BENEFICIARY_CATEGORIES

/* The saved spelling of a category, or '' when the value is not in the closed
   list. Trimmed and case-insensitive so " women " and "Women" are the same
   category, and strict about membership so a stray legacy value cannot put an
   unknown category into the table and the filter. */
const canonicalBeneficiary = (value) => {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return ''
  return BENEFICIARY_GROUPS.find((g) => g.toLowerCase() === v) || ''
}

/* The group an activity serves: the category saved on the activity itself,
   and nothing else. There is deliberately no fallback to the NGO's fixed
   group — an activity nobody chose a category for shows blank and matches no
   category filter, so the filter, the search and the suggestion scoping can
   never report an audience nobody picked. Every read goes through this one
   function, so those three can never disagree. */
const activityBeneficiary = (a) => canonicalBeneficiary(a?.beneficiary_group) || ''

/* How many programmes each NGO is expected to run in a month. This is the one
   place the quota lives: change a number here and every card, the header total
   and the remaining count follow. Keyed by the NGO's short code, because that
   is how the team identifies an NGO.
   An NGO with no entry falls back to the smallest common quota rather than
   showing a target of 0, which would read as "already complete". */
const NGO_MONTHLY_TARGET = { bsct: 25, mann: 15, aflf: 20 }
const DEFAULT_MONTHLY_TARGET = 15

const ngoCodeKey = (n) => String(n?.code || '').trim().toLowerCase()

const monthlyTargetFor = (n) => NGO_MONTHLY_TARGET[ngoCodeKey(n)] ?? DEFAULT_MONTHLY_TARGET

/* Per-NGO brand used by the monthly PDF export. Keyed by the same short code
   the quota table uses, so a report page and its quota can never disagree.
   Logos live in /public/logo (same files Event Reports uses); the colours match
   each NGO's letter-head so the printed page reads as that NGO's report. */
const NGO_BRAND = {
  bsct: { name: 'BSCT', fullName: 'Being Sevak Charitable Trust', displayName: 'Being Sevak', sub: 'Charitable Trust', brandImage: '/logo/bsct-logo.png', logo: '/logo/beingsevak-logo.png', logoPlain: '/logo/beingsevak-logo-plain.png', color: '#204E8C', headingColor: '#204E8C', accent: '#FFC72C', colorLight: '#EAF1FB' },
  mann: { name: 'MANN', fullName: 'Mann Care Foundation', logo: '/logo/mann-logo.png', color: '#F42D92', headingColor: '#C23875', accent: '#F42D92', colorLight: '#FDE7F3' },
  aflf: { name: 'AFLF', fullName: 'Ashray For Life Foundation', logo: '/logo/aflf-logo.png', color: '#0E6BA8', headingColor: '#DC2626', accent: '#22D3EE', colorLight: '#E6F4FB' },
}
const DEFAULT_BRAND = { name: 'NGO', fullName: 'NGO', logo: '', color: '#2036bd', headingColor: '#2036bd', accent: '#2036bd', colorLight: '#eef0ff' }
/* Some NGO rows carry no code; fall back to matching the name so the brand
   (and its footer image) still resolves for "Being Sevak", "Mann", "Ashray". */
const brandKeyForName = (n) => {
  const s = `${n?.code || ''} ${n?.name || ''}`.toLowerCase()
  if (/bsct|being\s*sevak/.test(s)) return 'bsct'
  if (/mann/.test(s)) return 'mann'
  if (/aflf|ashray/.test(s)) return 'aflf'
  return ''
}
const ngoBrandFor = (n) => NGO_BRAND[ngoCodeKey(n)] || NGO_BRAND[brandKeyForName(n)] || { ...DEFAULT_BRAND, name: ngoShortLabel(n), fullName: n?.name || 'NGO' }

const capFirst = (s = '') => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

/* Card order follows the target table, so BSCT's bigger quota is read first and
   the cards do not reshuffle between NGOs or months. Anything not in the table
   (a new NGO, or one with no code) goes last, by name. */
const targetOrderFor = (n) => {
  const i = Object.keys(NGO_MONTHLY_TARGET).indexOf(ngoCodeKey(n))
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/* The NGO tab the planner opens on. BSCT is the NGO the team works in, so the
   page lands on its tab instead of a blank scope or on whichever row the ngos
   table happens to list first. Matched on the code the quota table keys by,
   then on the name — so a re-provisioned id never silently changes which tab
   opens. */
const defaultNgoId = (list) => {
  const pick = (list || []).find((n) => ngoCodeKey(n) === 'bsct')
    || (list || []).find((n) => /being\s*sevak/i.test(String(n?.name || '')))
  return String(pick?.id ?? (list || [])[0]?.id ?? '')
}

/* ── Report helpers (date-wise monthly planner download) ─────────────────── */

/* The report is date-wise, so it must NOT go through toISOString(): in IST,
   midnight of the 1st is the previous evening in UTC and every date would slip
   back a day. Takes the 'YYYY-MM-DD' string the API returns, so no Date object
   is built from it at all. */
const reportDate = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return String(ymd || '')
  return `${pad2(d)}-${MONTHS[m - 1].slice(0, 3)}-${y}`
}

/* ── Report layout ─────────────────────────────────────────────────────────
   The file answers one question: "what did I decide for this month?". So it is
   built from the user's selections, not from the calendar:
     · one row per programme they planned, with the AI suggestion they chose for
       that programme;
     · a quota line per NGO (target / done / remaining);
     · a closing block for selections they have not scheduled yet.
   The on-screen preview, the Excel sheet and the PDF are all rendered from the
   single buildMonthlyReport() result below, so the three can never disagree. */
const REPORT_HEADERS = ['Date', 'Day', 'Activity', 'Programme', 'Status', 'AI Suggested Programme']

/* The monthly-planner grid download. Each downloadable unit is one selected AI
   festival programme, so the columns answer "what is this date's festival, who
   serves it, and what programme did I pick for them?". Sector and Activity were
   dropped because the grid itself does not carry them — the export matches the
   on-screen columns. */
const FESTIVAL_REPORT_HEADERS = ['Date', 'Day', 'Festival/Important Day', 'NGO', 'Beneficiary', 'AI Suggested Programme', 'Location', 'Status']

/* Marks an activity the user ticked for this download. A tick rather than a word
   so the eye can find the chosen ones down a column, and it survives being copied
   into a spreadsheet cell. */
const REPORT_TICK = '✓'

/* Joined as \n so Excel and the PDF each show one programme per line instead of
   clipping the longest title. */
const reportSuggestionCell = (s) => {
  if (!s) return '—'
  const extra = [s.priority ? `Priority: ${s.priority}` : '', s.objective ? `Objective: ${s.objective}` : '']
    .filter(Boolean)
    .join('\n')
  return extra ? `${s.title}\n${extra}` : s.title
}

/* ── Shared pieces ──────────────────────────────────────────────────────── */

const LABEL = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--eh-ink-soft)' }

/* ── Festival selection is SESSION-ONLY (deliberately NOT persisted) ────────
   Every reload of this planner starts fresh: no restored AI ticks, no restored
   typed programmes, no restored checkboxes and no restored download count.
   The typed programme and the "Other suggestions" clear flag live in React
   state only — nothing goes to localStorage, sessionStorage or the URL, and
   even the selection bits the server still holds for a suggestion are ignored
   on load. That is by request: the screen must always begin with nothing
   chosen. */

/* "date::festival" — the exact identity the suggestion grouping uses, so a
   manual programme and an AI idea for the same row always meet on one key. */
const festivalKeyOf = (s) => `${String(s?.observance_date || '').slice(0, 10)}::${String(s?.festival || '')}`

/* The durable row → event links are stored per NGO, so their map key prefixes
   the row key with the row's NGO. BSCT and MANN may both plan the same festival
   on the same date: without this, creating MANN's event made BSCT's row offer a
   Download for it and the Monthly Report printed MANN's photo as BSCT's
   "Completed". An unknown NGO is '' — the same value the server stores. */
const linkMapKey = (key, ngo) => `${ngo != null && ngo !== '' ? String(ngo) : ''}::${key}`

/* Self-contained scrollbar styling for the modal bodies.
   Deliberately NOT .eh-scroll: that rule lives in calendar.css, which belongs to
   the Calendar page. Depending on it here would make this page's scrollbars
   break silently if that stylesheet is ever moved. */
const SCROLLBAR_CSS = `
.ap-scroll { scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: #b9bcd0 #eef0f7; }
.ap-scroll::-webkit-scrollbar { width: 11px; height: 11px; }
.ap-scroll::-webkit-scrollbar-track { background: #eef0f7; border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
.ap-scroll::-webkit-scrollbar-thumb { background: #b9bcd0; border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
.ap-scroll::-webkit-scrollbar-thumb:hover { background: #9498b0; background-clip: padding-box; }
.ap-spin { animation: ap-spin 0.8s linear infinite; }
@keyframes ap-spin { to { transform: rotate(360deg); } }
`

/* AI programme urgency, mapped to a badge tone: the loudest for Urgent and
   Critical, amber for High, then quiet blue and grey. */
const PRIORITY_TONE = { Urgent: 'danger', Critical: 'danger', High: 'warn', Medium: 'primary', Low: 'muted' }

/* Social Monthly Planner · content-team deliverables. Each programme the Social
   panel plans is split into these deliverables, and the "Team member" column
   assigns ONE Social member per deliverable. `defaultName` is only a soft
   default: the dropdown preselects the roster member whose name matches it, so
   Shital sees who normally does what and can still override it per programme.
   The value saved to the server is the exact label. */
const CONTENT_TYPES = [
  { value: 'Banner', label: 'Banner', defaultName: 'Tanvi' },
  { value: 'YouTube Video', label: 'YouTube Video', defaultName: 'Ganesh' },
  { value: 'Instagram Reels', label: 'Instagram Reels', defaultName: 'Sachin' },
  { value: 'Instagram Photos', label: 'Instagram Photos', defaultName: 'Rehan' },
  { value: 'Captions & Heading', label: 'Captions & Heading', defaultName: 'Shital' },
]

/* Scoped styling for the Monthly Planner festival grid (`.eh-fest-grid`). Kept
   local to ActivityPlanner.jsx so the four-source calendar's other pages in
   event-head are untouched. Rules only restyle/space the table — the row data,
   heading, export and behaviour logic are not involved. */
const FEST_GRID_CSS = `
.eh-fest-grid { width: 100%; min-width: 980px; table-layout: fixed; border-collapse: separate; border-spacing: 0; background: #fff; border: 1px solid #E3E6F2; }
.eh-fest-grid thead th { position: sticky; top: 0; z-index: 5; padding: 10px 14px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; text-align: left; color: var(--eh-ink-soft, #6f6c86); background: #f3f2fb; border-bottom: 2px solid #d9d5f0; border-right: 1px solid #E3E6F2; white-space: nowrap; }
.eh-fest-grid thead th:last-child { border-right: none; }
.eh-fest-grid td { padding: 11px 14px; font-size: 13px; line-height: 1.3; color: var(--eh-ink, #1f2430); border-right: 1px solid #E3E6F2; vertical-align: middle; }
.eh-fest-grid td:last-child { border-right: none; }
.eh-fest-grid td.dd { font-weight: 700; font-size: 12.5px; white-space: nowrap; }
.eh-fest-grid td.plain { color: var(--eh-ink-faint, #a09db4); font-size: 12.5px; }
.eh-fest-grid .ff-name { display: block; font-weight: 700; font-size: 14px; color: var(--eh-ink, #1f2430); }
.eh-fest-grid .ff-type { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 11px; font-weight: 600; color: var(--eh-ink-soft, #6f6c86); }
.eh-fest-grid .ff-event { display: flex; align-items: baseline; gap: 6px; margin-top: 7px; padding: 5px 8px; border-radius: 8px; background: var(--eh-tint-1, #f0eefb); font-size: 12px; font-weight: 600; line-height: 1.35; color: var(--eh-ink, #1f2430); overflow-wrap: anywhere; }
.eh-fest-grid .ff-event-lbl { flex: none; font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--eh-primary, #6c5ce7); }
.eh-fest-grid .ff-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--eh-primary, #6c5ce7); }
.eh-fest-grid .ng-pill { display: inline-flex; padding: 3px 10px; border-radius: 999px; background: var(--eh-tint-1, #f0eefb); border: 1px solid var(--eh-line-strong, #ddd9f0); font-size: 11.5px; font-weight: 700; color: var(--eh-ink, #1f2430); white-space: nowrap; }
.eh-fest-grid td.bn { font-size: 13px; }
.eh-fest-grid .ai-title { display: block; font-weight: 600; font-size: 13.5px; color: var(--eh-ink, #1f2430); }
.eh-fest-grid .ai-badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
.eh-fest-grid td.ai.nowrap { white-space: nowrap; }
.eh-fest-grid td.sel { text-align: center; }
.eh-fest-grid td.sel input { width: 16px; height: 16px; margin: 0; vertical-align: middle; accent-color: var(--eh-primary, #6c5ce7); cursor: pointer; }
.eh-fest-grid td.sel input:disabled { cursor: wait; }
.eh-fest-grid td.dd, .eh-fest-grid td.ff, .eh-fest-grid td.ng, .eh-fest-grid td.bn, .eh-fest-grid td.lc { border-bottom: none; }
.eh-fest-grid div.lc { display: flex; flex-direction: column; gap: 6px; }
.eh-fest-grid input.lc { display: block; width: 100%; box-sizing: border-box; padding: 6px 9px; font-family: inherit; font-size: 12.5px; color: var(--eh-ink, #1f2430); background: #fff; border: 1px solid var(--eh-line, #d1d5db); border-radius: 9px; outline: none; transition: border-color .15s, box-shadow .15s; }
.eh-fest-grid input.lc:focus { border-color: var(--eh-primary, #2036bd); box-shadow: 0 0 0 3px rgba(32, 54, 189, .12); }
.eh-fest-grid input.lc:disabled { background: #f7f7fb; cursor: wait; }
.eh-fest-grid td.divider { border-top: 2px solid #d9d5f0; }
.eh-fest-grid tbody tr:first-child td.divider { border-top: none; }
.eh-fest-grid td.subline { border-bottom: 1px solid #E3E6F2; }
.eh-fest-grid tr.sel-row:hover td.ai, .eh-fest-grid tr.sel-row:hover td.sel { background: #faf9ff; }
.eh-fest-grid tr.sel-row.sel td.ai, .eh-fest-grid tr.sel-row.sel td.sel { background: var(--eh-tint-1, #f0eefb); }
.eh-fest-grid tr.sel-row.sel td.ai { box-shadow: inset 3px 0 0 var(--eh-primary, #6c5ce7); }
.eh-fest-grid .sug-sec-label { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--eh-ink-soft, #6f6c86); margin-bottom: 6px; }
.eh-fest-grid .sug-pick { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--eh-primary, #2036bd); border-radius: 9px; background: var(--eh-tint-1, #eef0ff); font: inherit; font-size: 13.5px; font-weight: 700; color: var(--eh-ink, #1f2430); cursor: pointer; text-align: left; max-width: 100%; transition: background .15s; }
.eh-fest-grid .sug-pick:hover { background: #e2e8ff; }
.eh-fest-grid .sug-check { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: var(--eh-primary, #2036bd); color: #fff; font-size: 11px; font-weight: 900; flex: none; line-height: 1; }
.eh-fest-grid .sug-check-lg { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: var(--eh-primary, #2036bd); color: #fff; font-size: 12px; font-weight: 900; line-height: 1; }
  .eh-fest-grid .sug-lg-btn { border: none; padding: 0; cursor: pointer; font: inherit; transition: opacity .15s; }
  .eh-fest-grid .sug-lg-btn:hover { opacity: .72; }
  .eh-fest-grid .sug-lg-btn:disabled { cursor: default; opacity: .5; }
.eh-fest-grid .fest-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.eh-fest-grid .tm-stack { display: flex; flex-direction: column; gap: 7px; }
.eh-fest-grid .tm-row { display: flex; flex-direction: column; gap: 2px; }
.eh-fest-grid .tm-lbl { font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--eh-ink-soft, #6f6c86); }
.eh-fest-grid select.tm-sel { width: 100%; min-width: 0; box-sizing: border-box; padding: 5px 8px; font-size: 11.5px; border-radius: 8px; }
.eh-fest-grid textarea.fest-manual { display: block; width: 100%; min-height: 52px; resize: vertical; padding: 8px 10px; font-family: inherit; font-size: 13px; line-height: 1.35; color: var(--eh-ink, #1f2430); background: #fff; border: 1px solid var(--eh-line, #d1d5db); border-radius: 8px; outline: none; box-sizing: border-box; transition: border-color .15s, box-shadow .15s; }
.eh-fest-grid textarea.fest-manual:focus { border-color: var(--eh-primary, #2036bd); box-shadow: 0 0 0 3px rgba(32, 54, 189, .12); }
.eh-fest-grid textarea.fest-manual:disabled { background: #f7f7fb; cursor: wait; }
.eh-fest-grid .fest-manual-hint { margin-top: 5px; font-size: 11.5px; color: var(--eh-ink-soft, #6f6c86); }
.eh-fest-grid .sug-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
`

function ModalShell({ title, subtitle, onClose, children, footer, width = 640 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,35,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}
    >
      <div style={{ width: '100%', maxWidth: width, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--eh-line)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--eh-ink)' }}>{title}</h3>
            {subtitle && <div style={{ fontSize: 12, color: 'var(--eh-ink-soft)', marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button className="eh-btn eh-btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {/* minHeight:0 is load-bearing — without it the body never scrolls. */}
        <div className="ap-scroll" style={{ padding: 18, overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '13px 18px', borderTop: '1px solid var(--eh-line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={LABEL}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--eh-ink-faint)' }}>{hint}</span>}
    </label>
  )
}

/* The festival grid's Beneficiary cell: a real dropdown, not a label. What is
   chosen here is who the AI is aimed at the next time that festival's
   programmes are generated — the closed category list, one option per
   category, and nothing else can be typed in. */
function FestivalBeneficiarySelect({ value, disabled, title, onChange }) {
  return (
    <select
      className="eh-select"
      value={value}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', minWidth: 0, padding: '7px 9px', fontSize: 12.5, borderRadius: 9 }}
    >
      <option value="">Select a category…</option>
      {BENEFICIARY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}

/* The festival grid's NGO cell: an editable dropdown per row, so a single
   festival can be pointed at a different NGO than the page-wide pick. The value
   is the row's NGO id ('' = not chosen yet). */
function FestivalNgoSelect({ ngos, value, disabled, title, onChange }) {
  return (
    <select
      className="eh-select"
      value={value}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', minWidth: 0, padding: '7px 9px', fontSize: 12.5, borderRadius: 9 }}
    >
      <option value="">Select an NGO…</option>
      {ngos.map((n) => <option key={n.id} value={String(n.id)}>{ngoShortLabel(n)}</option>)}
    </select>
  )
}

/* The grid's Location cell: where this festival's programme happens, one place
   per block. The dropdown lists ONLY the in-scope NGO's known locations — pick
   BSCT and you see the Being Sevak Charitable Trust spots, MANN shows Mann's,
   AFLF shows Ashray's — and "Other…" reveals a free-text box to type any
   location manually. On "All NGOs" scope every NGO's spots are offered together
   (there is no single owner to filter by). A custom place is saved on
   blur/Enter (never per keystroke), and a value typed earlier still shows as
   "Other…" with the stored text after a reload. */
const OTHER_LOCATION = '__other__'
const NGO_LOCATION_GROUPS = [
  {
    code: 'bsct', label: 'Being Sevak Charitable Trust', list: [
      'Ganpat Patil Nagar',
      'Patel Nagar near Priyansh School',
      'Satabdi Hospital',
      'Dahisar Bridge',
      'Gorai Fast Gali',
      'Poisar Raghulila Mall',
    ],
  },
  {
    code: 'mann', label: 'Mann Care Foundation', list: [
      'Kandivali West opp Satabdi Hospital',
      'Kandivali West Railway Track',
      'Borivali Bhagwati BMC Hospital',
    ],
  },
  {
    code: 'aflf', label: 'Ashray For Life Foundation', list: [
      'Malad East near Malad Station',
      'Gorai Slum Gutam Nagar',
    ],
  },
]

const ngoLocationCode = (n) => String(n?.code || '').trim().toLowerCase()
/* With a single NGO in scope its locations alone are offered; on "All NGOs"
   there is no owner to filter by, so every NGO's spots are listed. */
const ngoLocationList = (n) => {
  if (!n) return NGO_LOCATION_GROUPS.flatMap((g) => g.list)
  return NGO_LOCATION_GROUPS.find((g) => g.code === ngoLocationCode(n))?.list || []
}

function FestivalLocationSelect({ value, list, disabled, title, onChange }) {
  const isCustom = Boolean(value) && !list.includes(value)
  const [showOther, setShowOther] = useState(isCustom)
  const [draft, setDraft] = useState(isCustom ? String(value) : '')
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
  const selectValue = isCustom || showOther ? OTHER_LOCATION : (value || '')
  const showingInput = selectValue === OTHER_LOCATION
  const lastValue = useRef(value)
  useEffect(() => {
    const custom = Boolean(value) && !list.includes(value)
    if (custom) {
      setShowOther(true)
      if (String(value) !== draftRef.current) {
        setDraft(String(value))
      }
    } else if (!value) {
      setShowOther(false)
      setDraft('')
    } else if (list.includes(value)) {
      setShowOther(false)
      setDraft('')
    }
    lastValue.current = value
  }, [value, list])
  const commitDraft = () => {
    const next = (draftRef.current || '').trim().slice(0, 200)
    if (next === String(value || '').trim()) {
      setDraft(next)
      return
    }
    setDraft(next)
    if (!next) {
      setShowOther(false)
      if (value) onChange('')
      return
    }
    onChange(next)
  }
  return (
    <div className="lc">
      <select
        className="eh-select"
        value={selectValue}
        disabled={disabled}
        title={title}
        onChange={(e) => {
          const v = e.target.value
          if (v === OTHER_LOCATION) {
            setShowOther(true)
            setDraft(isCustom ? String(value) : draft)
          } else {
            setShowOther(false)
            setDraft('')
            onChange(v)
          }
        }}
        style={{ width: '100%', minWidth: 0, padding: '7px 9px', fontSize: 12.5, borderRadius: 9 }}
      >
        <option value="">Select a location…</option>
        {list.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
        <option value={OTHER_LOCATION}>Other… (type a location)</option>
      </select>
      {showingInput && (
        <input
          type="text"
          className="lc"
          value={draft}
          disabled={disabled}
          placeholder="Type the location…"
          autoFocus
          onChange={(e) => {
            setDraft(e.target.value)
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitDraft()
              e.currentTarget.blur()
            }
          }}
        />
      )}
    </div>
  )
}

/* ── Step 3 · Add Activity (NGO-wise) ────────────────────────────────────── */

function AddActivityModal({ ngos, ngo, sectors, month, onClose, onSaved }) {
  const [name, setName] = useState('')
  // The NGO this activity is added under, chosen from the tab row at the top of
  // the modal. Starts on the NGO already in scope on the page (or the first
  // known NGO), so the common case needs no click.
  const [pickedNgoId, setPickedNgoId] = useState(() => {
    if (ngo?.id) return String(ngo.id)
    return Array.isArray(ngos) && ngos.length ? String(ngos[0].id) : ''
  })
  const pickedNgo = useMemo(
    () => ngos.find((n) => String(n.id) === String(pickedNgoId)) || null,
    [ngos, pickedNgoId]
  )
  const [sectorId, setSectorId] = useState('')
  const [description, setDescription] = useState('')
  // Which category this activity serves, picked from the closed dropdown. Empty
  // is allowed (the form does not have to claim an audience), but anything typed
  // must be one of the BENEFICIARY_GROUPS values — canonicalBeneficiary on save
  // enforces that so an unknown value never reaches the backend.
  const [beneficiaryGroup, setBeneficiaryGroup] = useState('')
  const chosenGroup = canonicalBeneficiary(beneficiaryGroup)
  // Whether this activity belongs in the monthly download. On by default here
  // because someone adding an activity has already decided it matters; the tick on
  // the activity row is where it gets changed. It is still a real choice, so it is
  // shown rather than assumed.
  const [inReport, setInReport] = useState(true)
  // Optional. Empty means "just register the activity"; a day means "and run its
  // first programme on that date".
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Only days of the month on screen, so the programme it creates always lands
  // in this month's counts and download rather than somewhere invisible.
  const days = useMemo(() => daysInMonth(month), [month])

  const submit = async () => {
    if (!pickedNgo) return setError('Choose an NGO first.')
    if (!name.trim()) return setError('Activity name is required.')
    if (!sectorId) return setError('Choose a sector for the activity.')
    setBusy(true); setError('')

    const activityName = name.trim()
    const desc = description.trim() || null

    let created
    try {
      const payload = {
        name: activityName,
        sector_id: Number(sectorId),
        ngo_id: pickedNgo.id,
        description: desc,
        // The group this activity serves. The backend drops the field when
        // migration 168 has not been applied, so this can never block the save.
        beneficiary_group: chosenGroup || null,
        // Same guard for migration 169: an unapplied migration drops the field
        // rather than failing the save, and the tick on the row shows the truth.
        in_report: inReport,
      }
      created = await createActivity(payload)
    } catch (e) {
      setBusy(false)
      return setError(e?.message || 'Could not save the activity.')
    }

    if (!date) {
      setBusy(false)
      return onSaved({ activity: created, programme: null })
    }

    // The programme is a second record, created only after the activity exists.
    // activity_ids is what links the two, and it is also what lets the monthly
    // report show this event's AI suggestions.
    try {
      const programme = await createEvent({
        name: activityName,
        ngo_id: pickedNgo.id,
        sector_id: Number(sectorId),
        activity_ids: created?.id ? [created.id] : [],
        date,
        status: 'Draft',
        description: desc,
      })
      setBusy(false)
      onSaved({ activity: created, programme, date })
    } catch (e) {
      // Never imply the whole thing failed: the activity is already saved.
      setBusy(false)
      onSaved({
        activity: created,
        programme: null,
        programmeError: `saved the activity, but could not schedule its programme on ${shortDate(date)} — ${e?.message || 'please try again'}`,
      })
    }
  }

  return (
    <ModalShell
      title="Add Activity"
      subtitle={pickedNgo ? `New activity for ${pickedNgo.name}` : 'New activity'}
      onClose={onClose}
      footer={
        <>
          <button className="eh-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="eh-btn eh-btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : date ? 'Save & Schedule' : 'Save Activity'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* NGO tabs: one tab per NGO. Clicking a tab is what selects the NGO —
            there is no separate dropdown, so "which NGO" is answered in one
            place. */}
        <Field label="NGO">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ngos.map((n) => {
              const on = String(n.id) === String(pickedNgoId)
              return (
                <button
                  key={n.id}
                  type="button"
                  className="eh-btn eh-btn-sm"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => { setPickedNgoId(String(n.id)); setSectorId('') }}
                  style={on ? { background: 'var(--eh-primary)', borderColor: 'var(--eh-primary)', color: '#fff', fontWeight: 700 } : undefined}
                >
                  {ngoShortLabel(n)}
                </button>
              )
            })}
          </div>
        </Field>

        {!pickedNgo && (
          <div style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--eh-warn-soft, #fff8e1)', color: 'var(--eh-ink)', fontSize: 13 }}>
            Pick an NGO above before adding an activity.
          </div>
        )}

        <Field label="Sector" hint="Every activity must belong to exactly one sector.">
          <Select value={sectorId} onChange={setSectorId}>
            <option value="">Select a sector…</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>

        <Field label="Activity name" hint="E.g. Computer Literacy Training">
          <input
            className="eh-select"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What does this NGO do under this sector?"
          />
        </Field>

        {/* Always visible: this is where the activity's beneficiary category is
            chosen. One closed list, no NGO-derived suggestion and no tick-box —
            empty simply means no category has been picked yet. */}
        <Field
          label="Beneficiary category"
          hint={chosenGroup
            ? `AI programme suggestions will be aimed at ${chosenGroup}.`
            : 'Pick who this activity serves from the list.'}
        >
          <Select
            value={beneficiaryGroup}
            onChange={setBeneficiaryGroup}
          >
            <option value="">Select a category…</option>
            {BENEFICIARY_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Field>

        <Field
          label="First programme date (optional)"
          hint={`Any day of ${monthLabel(month)}. Leave empty to just register the activity.`}
        >
          <Select value={date} onChange={setDate}>
            <option value="">Do not schedule yet</option>
            {days.map((d) => <option key={d} value={d}>{shortDate(d)}</option>)}
          </Select>
        </Field>

        <Field label="Description (optional)">
          <textarea
            className="eh-select"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short note about the beneficiaries and the aim."
          />
        </Field>

        {/* The same tick the activity row carries, asked at the moment the decision
            is easiest. */}
        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 9, padding: '11px 13px',
            border: `1px solid ${inReport ? 'var(--eh-primary)' : 'var(--eh-line)'}`,
            borderRadius: 12, background: inReport ? 'var(--eh-primary-soft)' : 'transparent',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={inReport}
            onChange={(e) => setInReport(e.target.checked)}
            style={{ width: 16, height: 16, marginTop: 1, cursor: 'pointer', accentColor: 'var(--eh-primary)' }}
          />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--eh-ink)' }}>
              Include in the monthly download
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--eh-ink-soft)' }}>
              Only ticked activities are listed in the downloaded file. Leave this on if this is part of
              what {pickedNgo?.name || 'the NGO'} reports every month.
            </span>
          </span>
        </label>

        {error && (
          <div style={{ padding: '10px 13px', borderRadius: 12, background: 'var(--eh-danger-soft)', color: 'var(--eh-danger)', fontSize: 13 }}>{error}</div>
        )}
      </div>
    </ModalShell>
  )
}

/* ── AI programme suggestions for one activity ──────────────────────────── */

/* Renders inline under the activity row that asked for it — no modal, so the
   activity list stays visible while ideas are read, ticked or discarded. */
export function SuggestionPanel({ activity, ngo, month, onClose, onPlan, refreshRev = 0, onSelectionChange }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(() => new Set())
  // Ticks live server-side; this is only the optimistic mirror of them.
  const [selected, setSelected] = useState(() => new Set())
  const generatedRef = useRef('')

  const run = useCallback(async () => {
    setLoading(true)
    try {
      const res = await suggestActivityPrograms({ activityId: activity.id, ngoId: ngo?.id, month })
      setData(res)
      setDismissed(new Set())
      // Newly returned rows carry their own is_selected, so ticks that were
      // already saved survive regenerating the batch.
      setSelected(new Set((res?.suggestions || []).filter((s) => s?.is_selected).map((s) => Number(s.id))))
      // The batch may have changed which ideas exist, so the page re-reads its
      // own selected list rather than reporting a stale one.
      onSelectionChange?.()
    } catch (e) {
      setData({ suggestions: [], observances: [], ai: { available: false, reason: e?.message || 'Could not reach the server.' } })
    } finally {
      setLoading(false)
    }
  }, [activity?.id, ngo?.id, month])

  const monthNum = Number(String(month).split('-')[1])
  const yearNum = Number(String(month).split('-')[0])

  /* Reopening the panel restores what the user ticked last time, so selecting
     ideas is not lost by closing the panel or reloading the page.
     refreshRev is bumped after a suggestion is converted into a programme,
     which ticks it server-side — the mirror has to re-read or the box would
     show unticked while the report already contains it. */
  useEffect(() => {
    let alive = true
    fetchPlannerSuggestions({ ngo_id: ngo?.id, activity_id: activity?.id, month: monthNum, year: yearNum })
      .then((list) => {
        if (!alive) return
        const rows = Array.isArray(list) ? list : []
        setSelected(new Set(rows.filter((s) => s?.is_selected).map((s) => Number(s.id))))
        // Surface the month's already-stored suggestions automatically, so changing
        // the month shows that month's ideas without a manual re-run.
        if (rows.length) {
          setData((prev) => prev || {
            suggestions: rows.map((r) => ({
              id: r.id,
              title: r.title,
              format: r.format,
              priority: r.priority,
              audience: r.audience,
              duration: r.duration,
              objective: r.objective,
              rationale: r.rationale,
              materials: Array.isArray(r.materials) ? r.materials : [],
              is_selected: Boolean(r.is_selected),
              suggested_event_id: r.suggested_event_id ?? null,
              activity_id: r.activity_id,
              batch_no: r.batch_no,
            })),
            observances: [],
            ai: { available: true, model: null, provider: null, dates_from_ai: false, truncated: false },
          })
        } else {
          // No stored ideas for this month yet — generate them automatically so
          // switching the month surfaces that month's suggestions.
          const key = `${activity?.id}-${month}`
          if (generatedRef.current !== key) {
            generatedRef.current = key
            run()
          }
        }
      })
      .catch(() => { /* keep whatever is on screen */ })
    return () => { alive = false }
  }, [activity?.id, ngo?.id, monthNum, yearNum, refreshRev])

  const toggleSelected = async (s) => {
    if (!s?.id) return
    const id = Number(s.id)
    const next = !selected.has(id)
    setSelected((prev) => {
      const c = new Set(prev)
      if (next) c.add(id); else c.delete(id)
      return c
    })
    try {
      await setPlannerSuggestionSelected(id, next)
      /* Tell the page. The report's AI column reads the page's own selected
         list, not this panel's mirror, so without this a tick made here is
         invisible to the download until the month or NGO changes. */
      onSelectionChange?.()
    } catch (e) {
      // Roll back so the tick never lies about what the server has stored.
      setSelected((prev) => {
        const c = new Set(prev)
        if (next) c.delete(id); else c.add(id)
        return c
      })
    }
  }

  const ai = data?.ai
  // Keep the server-side index alongside each card so dismissing one does not
  // shift the others' identity.
  const cards = (data?.suggestions || [])
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !dismissed.has(i))

  const observances = data?.observances || []

  return (
    <div style={{ border: '1px solid var(--eh-line)', borderRadius: 12, padding: '12px 14px', background: 'var(--eh-tint-1)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--eh-ink)' }}>
          Programme suggestions · {activity.name}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--eh-ink-faint)' }}>
          {monthLabel(month)}{ngo ? ` · ${ngoShortLabel(ngo)}` : ''}
        </span>
        <button className="eh-btn eh-btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button className="eh-btn eh-btn-primary" onClick={run} disabled={loading}>
            {loading ? 'Asking AI… (this can take 10–60s)' : data ? 'Suggest again' : 'Suggest programmes'}
          </button>
          {activity.sector_name && <Badge tone="secondary">{activity.sector_name}</Badge>}
          {ai?.model && <Badge tone="muted">{ai.model}</Badge>}
        </div>

        {/* Real festival dates for the month, straight from the reference
            calendar. The model reads these as themes and can never emit a date. */}
        {observances.length > 0 && (
          <div style={{ border: '1px solid var(--eh-line)', borderRadius: 12, padding: '11px 13px' }}>
            <div style={{ ...LABEL, marginBottom: 7 }}>Observances in {monthLabel(month)}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {observances.map((o, k) => (
                <span key={`${o.date}-${o.name}-${k}`} style={{ fontSize: 11, fontWeight: 600, background: 'var(--eh-tint-1)', borderRadius: 6, padding: '3px 7px', color: 'var(--eh-ink)' }}>
                  {shortDate(o.date)} · {o.name}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--eh-ink-faint)', marginTop: 7 }}>
              ✓ Verified dates · from the reference calendar, not AI
            </div>
          </div>
        )}

        {loading && (
          <div style={{ fontSize: 13, color: 'var(--eh-ink-soft)' }}>
            Reading {activity.name} and the month&apos;s festivals, then asking the model for programme ideas…
          </div>
        )}

        {!loading && ai && !ai.available && (
          <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--eh-warn-soft, #fff8e1)', color: 'var(--eh-ink)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <b>AI suggestions are unavailable.</b>
            <span style={{ color: 'var(--eh-ink-soft)' }}>{ai.reason}</span>
            <span style={{ color: 'var(--eh-ink-soft)' }}>
              You can still plan this activity by hand — use “Add programme” on its row.
            </span>
          </div>
        )}

        {!loading && ai?.available && cards.length === 0 && (
          <Empty icon="✦">
            {ai.truncated
              ? 'The model ran out of room before returning a usable idea. Try again.'
              : 'No suggestions came back for this activity. Try again, or plan it by hand.'}
          </Empty>
        )}

        {!loading && ai?.available && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--eh-ink-faint)' }}>
            <span>✦ Suggested programmes — AI ideas, you pick what to plan</span>
            {ai.truncated && <Badge tone="warn">Response was cut short — these may not be all the ideas</Badge>}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cards.map(({ s, i }) => (
            <div key={`${i}-${s.title}`} style={{ border: '1px solid var(--eh-line)', borderLeft: '3px solid var(--eh-secondary)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--eh-ink)' }}>{s.title}</span>
                {s.format && <Badge tone="primary">{s.format}</Badge>}
                {s.priority && <Badge tone={s.priority === 'Urgent' || s.priority === 'High' ? 'warn' : 'muted'}>{s.priority}</Badge>}
              </div>
              {(s.audience || s.duration) && (
                <div style={{ fontSize: 12, color: 'var(--eh-ink-soft)' }}>
                  {[s.audience ? `Target group: ${s.audience}` : '', s.duration ? `Duration: ${s.duration}` : ''].filter(Boolean).join(' · ')}
                </div>
              )}
              {s.objective && (
                <div style={{ fontSize: 12.5, color: 'var(--eh-ink)' }}>
                  <b style={{ fontWeight: 700 }}>Objective: </b>{s.objective}
                </div>
              )}
              {s.rationale && (
                <div style={{ fontSize: 12, color: 'var(--eh-ink-soft)' }}>
                  <b style={{ fontWeight: 700 }}>Why: </b>{s.rationale}
                </div>
              )}
              {s.materials?.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--eh-ink-soft)' }}>
                  <b style={{ fontWeight: 700 }}>Materials: </b>{s.materials.join(', ')}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="eh-btn eh-btn-primary eh-btn-sm" onClick={() => onPlan(s)} title="Save this as a real programme in the month. It stays ticked, so the download lists it under that event.">
                  Add as programme
                </button>
                <button
                  className="eh-btn eh-btn-sm"
                  onClick={() => setDismissed((prev) => new Set(prev).add(i))}
                >
                  Dismiss
                </button>
                {/* Ticking feeds the downloadable monthly report. Saved as a
                    programme instead? That option is right beside it. */}
                <label
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto',
                    fontSize: 12, fontWeight: 600, cursor: s?.id ? 'pointer' : 'not-allowed',
                    color: selected.has(Number(s?.id)) ? 'var(--eh-success)' : 'var(--eh-ink-soft)',
                  }}
                  title={s?.id ? 'Include this suggestion in the downloaded monthly report' : 'Save this batch first, then you can include it in the report'}
                >
                  <input
                    type="checkbox"
                    checked={s?.id ? selected.has(Number(s.id)) : false}
                    disabled={!s?.id}
                    onChange={() => toggleSelected(s)}
                    style={{ width: 15, height: 15, cursor: s?.id ? 'pointer' : 'not-allowed', accentColor: 'var(--eh-primary)' }}
                  />
                  Include in report
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Turn a suggestion (or a blank slate) into a real programme ──────────── */

/* One programme on one date. */
export function PlanModal({ entry, ngo, month, onClose, onSaved }) {
  const { activity, suggestion } = entry
  const days = useMemo(() => daysInMonth(month), [month])

  const [name, setName] = useState(suggestion?.title || activity?.name || '')
  const [date, setDate] = useState(entry?.date || days[0] || '')
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('13:00')
  const [venue, setVenue] = useState('')
  const [status, setStatus] = useState('Draft')
  const [priority, setPriority] = useState(suggestion?.priority || 'Medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const description = [
    `Planned for ${monthLabel(month)}.`,
    activity ? `Activity: ${activity.name}.` : '',
    suggestion?.audience ? `Target group: ${suggestion.audience}.` : '',
    suggestion?.duration ? `Duration: ${suggestion.duration}.` : '',
    suggestion?.objective || '',
    suggestion?.rationale || '',
    suggestion?.materials?.length ? `Materials: ${suggestion.materials.join(', ')}.` : '',
    suggestion ? 'Suggested by AI — review before submitting.' : '',
  ].filter(Boolean).join('\n')

  const submit = async () => {
    if (!name.trim()) return setError('Programme name is required.')
    if (!date) return setError('Choose a date.')
    if (startTime && endTime && endTime < startTime) return setError('End time must be after start time.')
    setBusy(true); setError('')
    try {
      const event = await createEvent({
        name: name.trim(),
        ngo_id: ngo?.id ?? activity?.ngo_id ?? null,
        sector_id: activity?.sector_id ?? null,
        activity_ids: activity?.id ? [activity.id] : [],
        date,
        start_time: startTime || null,
        end_time: endTime || null,
        venue: venue.trim() || null,
        description: description || null,
        status,
        priority,
        category: suggestion?.format || null,
      })
      /* Record which programme this idea became, in the same write as the tick.
         Without the link the report can only guess from the shared activity and
         prints the idea against the wrong programme. */
      if (suggestion?.id && event?.id) {
        try {
          await setPlannerSuggestionSelected(Number(suggestion.id), true, Number(event.id))
        } catch {
          // The programme is saved either way; only the report's AI column is
          // less precise, which must not fail the save.
        }
      }
      onSaved({ suggestion, programmes: [event], lastDate: date })
    } catch (e) {
      setError(e?.message || 'Could not create the programme.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={suggestion ? 'Plan Programme' : 'Add Programme'}
      subtitle={`${monthLabel(month)}${ngo ? ` · ${ngo.name}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button className="eh-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="eh-btn eh-btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : status === 'Draft' ? 'Save Draft' : 'Create Programme'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Programme name">
          <input className="eh-select" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Date" hint="You pick the day — the AI only suggests the programme.">
            <Select value={date} onChange={setDate}>
              {days.map((d) => <option key={d} value={d}>{shortDate(d)}</option>)}
            </Select>
          </Field>
          <Field label="Venue">
            <input className="eh-select" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Start time">
            <input className="eh-select" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End time">
            <input className="eh-select" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={setStatus}>
              <option value="Draft">Draft</option>
              <option value="Submitted">Submitted</option>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={setPriority}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </Select>
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={LABEL}>Activity</span>
          <Badge tone="secondary">{activity?.name || '—'}</Badge>
          {activity?.sector_name && <span style={{ fontSize: 11, color: 'var(--eh-ink-faint)' }}>{activity.sector_name}</span>}
        </div>

        {suggestion && (
          <div style={{ border: '1px dashed var(--eh-line)', borderRadius: 12, padding: '11px 13px', fontSize: 12, color: 'var(--eh-ink-soft)', whiteSpace: 'pre-wrap' }}>
            {description}
          </div>
        )}

        {error && (
          <div style={{ padding: '10px 13px', borderRadius: 12, background: 'var(--eh-danger-soft)', color: 'var(--eh-danger)', fontSize: 13 }}>{error}</div>
        )}
      </div>
    </ModalShell>
  )
}

/* ── Event Detail Sheet (PDF) ────────────────────────────────────────────────
   The download the Social head gets once the event is created: an A4 detail
   sheet branded with the NGO's logo/colour — Title, Date, NGO, Activity,
   Beneficiary, Venue, Description and the 4–6 uploaded images. Built straight
   with jsPDF (vector text + images), so the same-origin /logo asset and the
   picked image data-URLs embed without a DOM capture. */
const pickFileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('Could not read the image.'))
  reader.readAsDataURL(file)
})

/* Map the legacy "Event Detail Sheet" args onto the new EventPosterReport
   template, so the Monthly Planner downloads the same "Being Sevak" poster that
   Event Reports produces. Extra fields the new template supports (tagline,
   footer quote, report no.) are not collected by the planner's create form, so
   they stay blank. */
const posterPropsFromSheetArgs = ({ name, date, ngoLabel, activityName, venue, description, slogan, tagline, images, brand } = {}) => ({
  title: name || '',
  headline: name || '',
  date,
  description: description || '',
  venue: venue || '',
  tagline: tagline || activityName || '',
  slogan: slogan || '',
  footerQuote: '',
  reportNo: '',
  brandName: brand?.displayName || brand?.fullName || ngoLabel || 'NGO',
  brandSub: brand?.sub || '',
  teamMembers: [],
  photos: images || [],
  logoUrl: brand?.logo || '',
  sevakBanoImage: '/logo/sevak-logo.png',
  brandImage: brand?.brandImage || '',
})

/* Download the event poster (new EventPosterReport template) for the given
   sheet args. Rendered off-screen and captured with html2canvas into a
   one-page A4 PDF (see components/eventPosterPdf.jsx). */
async function downloadEventPoster(args = {}) {
  const safe = String(args.name || 'event').replace(/[^A-Za-z0-9-_]+/g, '_').slice(0, 40)
  await renderPosterToPdf(posterPropsFromSheetArgs(args), `event-${safe}${args.date ? '-' + args.date : ''}.pdf`)
}

/* ── Create / Edit the real event from a done programme ──────────────────────
   Shown from the "Team member" cell once ALL five deliverables of a planned
   programme are Done (the Social head accepted each member's report). Prefills
   the programme's name, its PLANNED date and NGO so the head only reviews and
   confirms; venue + description + 4–6 images are filled here. Saving creates a
   Draft event (linked to the selected suggestion) and downloads the branded
   Event Detail Sheet PDF.
   The row's Edit button reopens this SAME form with the existing event's values
   loaded into it, so a correction is typed into the form that captured it — not
   into a second, different screen. Only the save target changes: update the
   event that is already linked to the row instead of creating a new one. */
export function CreateEventFromProgrammeModal({ entry, ngos, activities, onClose, onSaved }) {
  const isEdit = Boolean(entry?.editing)
  const [name, setName] = useState(entry?.name || '')
  const [date] = useState(entry?.date || '')
  const [ngoId, setNgoId] = useState(entry?.ngoId ? String(entry.ngoId) : '')
  const [venue, setVenue] = useState(entry?.location || '')
  const [description, setDescription] = useState(entry?.description || '')
  const [slogan, setSlogan] = useState(entry?.slogan || '')
  const [tagline, setTagline] = useState(entry?.tagline || '')
  const [images, setImages] = useState(entry?.images || [])
  const [uploadingImages, setUploadingImages] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ngo = useMemo(() => ngos.find((n) => String(n.id) === String(ngoId)) || null, [ngos, ngoId])

  // The suggestion's activity (when there is one) owns the sector, so the event
  // is created against the exact NGO ➜ Sector ➜ Activity the programme belongs
  // to. A typed programme has no activity; Draft needs none. An edit falls back
  // to the activity already on the event, so saving it back never clears the
  // event's sector just because its suggestion is no longer selected.
  const activity = useMemo(
    () => activities.find((a) => String(a.id) === String(entry?.activityId || entry?.suggestion?.activity_id)) || null,
    [activities, entry],
  )

  const onPickImages = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const room = 6 - images.length
    if (room <= 0) { setError('Maximum 6 images.'); return }
    const picked = files.slice(0, room).filter((f) => f.type.startsWith('image/'))
    if (!picked.length) { setError('Please choose image files (JPG / PNG / WebP).'); return }
    setUploadingImages(true)
    setError('')
    // Each image is uploaded to S3 (only the URL is later saved on the event);
    // its local data URL is kept for the PDF built in this session.
    const added = await Promise.all(picked.map(async (f) => {
      const dataUrl = await pickFileToDataUrl(f).catch(() => '')
      const fd = new FormData()
      fd.append('file', f, f.name)
      try {
        const res = await uploadEventBanner(fd)
        const url = res?.url || ''
        return url ? { name: f.name, url, dataUrl } : null
      } catch {
        return null
      }
    }))
    const ok = added.filter(Boolean)
    setUploadingImages(false)
    if (!ok.length) { setError('Could not upload the images. Please try again.'); return }
    if (ok.length < picked.length) setError('Some images could not be uploaded. Please try again.')
    setImages((cur) => [...cur, ...ok].slice(0, 6))
  }

  const removeImage = (i) => setImages((cur) => cur.filter((_, idx) => idx !== i))

  /* The default (cover) photo is simply the first image of the array, so both
     the Event Detail Sheet and the Monthly Report agree on which photo leads.
     Promoting a photo to index 0 reorders the array. */
  const setDefaultImage = (i) => setImages((cur) => {
    if (i <= 0 || i >= cur.length) return cur
    return [cur[i], ...cur.filter((_, idx) => idx !== i)]
  })

  const submit = async () => {
    if (!name.trim()) return setError('Event name is required.')
    if (!ngoId) return setError('Choose an NGO.')
    if (!date) return setError('This programme has no planned date.')
    if (uploadingImages) return setError('Please wait for the images to finish uploading.')
    // Create must capture a full photo set (4–6). An edit only has to keep what
    // the event already has, so a name/venue correction is never blocked by a
    // photo count the user is not changing.
    if (images.length < (isEdit ? 1 : 4)) return setError(isEdit ? 'Keep at least 1 photo.' : 'Please upload at least 4 images (4–6).')
    if (images.length > 6) return setError('Please upload at most 6 images.')
    setBusy(true); setError('')
    try {
      const payload = {
        name: name.trim(),
        ngo_id: ngoId,
        sector_id: activity?.sector_id ?? null,
        activity_ids: activity?.id ? [Number(activity.id)] : [],
        date,
        venue: venue.trim() || null,
        description: description.trim() || null,
        slogan: slogan.trim() || null,
        tagline: tagline.trim() || null,
        // Saved in display order: the ★ default photo is always images[0], which is
        // what the Monthly Report (and every other report) shows as its cover photo.
        images: images.map((im) => im.url),
      }
      // Same form, same payload — only the target differs: a brand new Draft, or
      // the event this row is already linked to.
      const event = isEdit
        ? await updateEvent(entry.eventId, payload)
        : await createEvent({ ...payload, status: 'Draft' })
      // The row's own suggestion must point at the event, so the Monthly
      // Report can show the name the event was saved under. This runs on an
      // edit too: a renamed event is still the same programme, and without it
      // the row would keep pointing at nothing (or at an older event) and the
      // report would fall back to the festival name.
      if (entry?.suggestion?.id && event?.id) {
        try {
          await setFestivalSuggestionSelected(Number(entry.suggestion.id), true, Number(event.id))
        } catch {
          // The event is created either way; only the planner link is less precise.
        }
      }
      // Hand the created event back to the planner immediately, so the row's
      // "Download" button appears without waiting for the PDF to finish. The
      // PDF is still built below and cached when it is ready.
      onSaved({ key: entry?.key, event, pdf: null, ngoId, editing: isEdit, suggestion: entry?.suggestion })
      // The detail sheet is the download the head asked for. A PDF failure must
      // never lose the event that was already created. The same payload is handed
      // back to the planner so the row's "Download" button can re-issue it later.
      const pdfArgs = {
        name: name.trim(),
        date,
        ngoLabel: ngo?.name || '',
        activityName: activity?.name || '',
        beneficiary: entry?.beneficiary || '',
        venue: venue.trim(),
        description: description.trim(),
        slogan: slogan.trim(),
        tagline: tagline.trim(),
        images: images.map((im) => im.dataUrl || im.url),
        brand: ngoBrandFor(ngo),
      }
      try {
        await downloadEventPoster(pdfArgs)
      } catch (pdfErr) {
        console.error('Event detail PDF failed', pdfErr)
      }
      // Event already handed back to the planner above; the PDF is cached on demand.
    } catch (e) {
      setError(e?.message || (isEdit ? 'Could not save the changes.' : 'Could not create the event.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={isEdit ? 'Edit Event' : 'Create Event'}
      subtitle={isEdit ? 'Correct the details already saved for this programme' : 'All five deliverables are done — turn this programme into an event'}
      onClose={() => { if (!busy) onClose() }}
      width={600}
      footer={
        <>
          <button className="eh-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="eh-btn eh-btn-primary" onClick={submit} disabled={busy || uploadingImages}>
            {busy ? (isEdit ? 'Saving…' : 'Creating…') : uploadingImages ? 'Uploading…' : (isEdit ? 'Save Changes & Download' : 'Create Event & Download')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Event name">
          <input className="eh-select" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Field label="Date (planned)" hint="From the planner — the day this programme is planned for.">
            <input className="eh-select" value={date ? shortDate(date) : '—'} readOnly disabled />
          </Field>
          <Field label="Venue" hint="Optional">
            <input className="eh-select" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Community hall" />
          </Field>
          <Field label="NGO" hint={ngoId ? 'From the planner row — fixed for this event.' : 'Required — this row has no NGO yet.'}>
            <FestivalNgoSelect
              ngos={ngos}
              value={ngoId}
              // Locked to the NGO the planner row already carries, so the form
              // uses what the row selected instead of asking again. Only a row
              // that carries none leaves it open — otherwise the save would be
              // permanently blocked with no way to answer it.
              disabled={Boolean(ngoId)}
              title={ngoId ? 'The NGO is taken from this planner row and cannot be changed here' : 'Choose the NGO this programme belongs to'}
              onChange={setNgoId}
            />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={LABEL}>Activity</span>
          <Badge tone="secondary">{activity?.name || '—'}</Badge>
        </div>
        <Field label="Description" hint="Optional — printed on the Event Detail Sheet.">
          <textarea
            className="fest-manual"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the event is about…"
          />
        </Field>
        <Field label="Distributed Item">
          <input
            className="eh-select"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Enter item name (e.g., Ration Kit, Clothes, Stationery Kit)"
          />
        </Field>
        <Field label="Slogan" hint="Optional — printed on the poster above the Sevak Bano strip.">
          <input
            className="eh-select"
            value={slogan}
            onChange={(e) => setSlogan(e.target.value)}
            placeholder="e.g. Serving Selfless Service"
          />
        </Field>
        <Field label="Photos" hint={isEdit ? 'Keep or change the photos — stored on S3, printed on the Event Detail Sheet. The ★ one is the cover shown on the Monthly Report.' : 'Upload 4 to 6 images — stored on S3, printed on the Event Detail Sheet. The ★ one is the cover shown on the Monthly Report.'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label className="eh-btn eh-btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: (images.length >= 6 || uploadingImages) ? 'not-allowed' : 'pointer', opacity: (images.length >= 6 || uploadingImages) ? 0.5 : 1 }}>
                {uploadingImages ? 'Uploading…' : '+ Add images'}
                <input type="file" accept="image/*" multiple disabled={images.length >= 6 || uploadingImages} onChange={onPickImages} style={{ display: 'none' }} />
              </label>
              <span style={{ fontSize: 12, color: images.length >= 4 ? 'var(--eh-success, #16a34a)' : 'var(--eh-ink-soft)' }}>
                {uploadingImages ? 'Uploading images to S3…' : `${images.length} / 6 selected ${images.length < (isEdit ? 1 : 4) ? (isEdit ? '(min 1)' : '(min 4)') : ''}`}
              </span>
            </div>
            {images.length > 0 && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
                  {images.map((im, i) => (
                    <div
                      key={`${im.name}-${i}`}
                      style={{
                        position: 'relative', borderRadius: 8, overflow: 'hidden',
                        border: i === 0 ? '2px solid var(--eh-primary, #4f46e5)' : '1px solid var(--eh-line-strong, #ddd9f0)',
                      }}
                    >
                      <img src={im.dataUrl || im.url} alt={im.name} style={{ width: '100%', height: 62, objectFit: 'cover', display: 'block' }} />
                      {i === 0 && (
                        <span
                          title="Default image — shown on the Monthly Report"
                          style={{ position: 'absolute', left: 2, bottom: 2, background: 'var(--eh-primary, #4f46e5)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 999, pointerEvents: 'none' }}
                        >★ Default</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setDefaultImage(i)}
                        title="Set as default image (Monthly Report)"
                        aria-label="Set as default image"
                        style={{
                          position: 'absolute', top: 2, right: 24, border: 'none', borderRadius: 6,
                          background: i === 0 ? 'var(--eh-primary, #4f46e5)' : 'rgba(0,0,0,.55)',
                          color: '#fff', fontSize: 11, lineHeight: 1, padding: '3px 6px', cursor: i === 0 ? 'default' : 'pointer',
                        }}
                      >★</button>
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        title="Remove"
                        style={{ position: 'absolute', top: 2, right: 2, border: 'none', borderRadius: 6, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 11, lineHeight: 1, padding: '3px 6px', cursor: 'pointer' }}
                      >✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--eh-ink-soft, #6b7280)' }}>
                  ★ Default image is shown on the Monthly Report and leads the Event Detail Sheet.
                </div>
              </>
            )}
          </div>
        </Field>
        {error && (
          <div style={{ padding: '10px 13px', borderRadius: 12, background: 'var(--eh-danger-soft)', color: 'var(--eh-danger)', fontSize: 13 }}>{error}</div>
        )}
      </div>
    </ModalShell>
  )
}

/* ── Assign a task to a Social team member ──────────────────────────────── */

/* Reached from the "Assign Task" button, which the Social panel turns on by
   mounting this planner with the `taskAssignment` prop (the Event Manager does
   not). The manager picks a member of the Social roster and a day of the month
   on screen; the task then shows read-only on that member's Daily Report for
   the date, and stays removable here. */
function AssignTaskModal({ month, onClose, onNotify }) {
  const [assignees, setAssignees] = useState([])
  const [date, setDate] = useState(() => {
    const today = toYmd(new Date())
    return today.slice(0, 7) === String(month).slice(0, 7) ? today : `${month}-01`
  })
  const [form, setForm] = useState({ assignee_id: '', title: '', description: '' })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetchTaskAssignees()
      .then((r) => { if (alive) setAssignees(r?.employees || []) })
      .catch((e) => onNotify?.(e?.message || 'Could not load the Social team.'))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadRows = useCallback((d) => {
    setLoading(true)
    fetchTaskAssignments(d)
      .then((r) => setRows(r?.created_by_me || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadRows(date) }, [date, loadRows])

  const save = async () => {
    if (busy) return
    const member = assignees.find((a) => String(a.id) === form.assignee_id)
    if (!member) return onNotify?.('Choose a team member.')
    if (!form.title.trim()) return onNotify?.('Enter a task title.')
    setBusy(true)
    try {
      await createTaskAssignment({
        assignee_id: String(member.id),
        assignee_name: member.name,
        task_date: date,
        title: form.title.trim(),
        description: form.description.trim(),
      })
      setForm({ assignee_id: '', title: '', description: '' })
      loadRows(date)
      onNotify?.('Task assigned.')
    } catch (e) {
      onNotify?.(e?.message || 'Could not assign the task.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    try {
      await deleteTaskAssignment(id)
      setRows((list) => list.filter((r) => String(r.id) !== String(id)))
    } catch (e) {
      onNotify?.(e?.message || 'Could not remove the task.')
    }
  }

  return (
    <ModalShell title="Assign Task" subtitle={`Social team · ${monthLabel(month)}`} onClose={onClose} width={620}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Team member">
          <Select value={form.assignee_id} onChange={(v) => setForm({ ...form, assignee_id: v })}>
            <option value="">Select a member…</option>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>

        <Field label="Date" hint="Any day of the month on screen — it shows on that day's Daily Report.">
          <Select value={date} onChange={setDate}>
            {daysInMonth(month).map((d) => <option key={d} value={d}>{shortDate(d)}</option>)}
          </Select>
        </Field>

        <Field label="Task">
          <input
            className="eh-select"
            value={form.title}
            placeholder="What should they do?"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
          />
        </Field>

        <Field label="Details (optional)">
          <textarea
            className="eh-select"
            rows={3}
            value={form.description}
            placeholder="Brief, deliverables, links…"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>

        <div>
          <div style={{ ...LABEL, marginBottom: 8 }}>Assigned · {shortDate(date)}</div>
          {loading && <div style={{ fontSize: 12, color: 'var(--eh-ink-soft)' }}>Loading…</div>}
          {!loading && rows.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--eh-ink-soft)' }}>Nothing assigned for this date yet.</div>
          )}
          {!loading && rows.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderTop: '1px solid var(--eh-line)', padding: '8px 0' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--eh-ink)' }}>{t.title}</div>
                {t.description && <div style={{ fontSize: 12, color: 'var(--eh-ink-soft)', marginTop: 2 }}>{t.description}</div>}
                <div style={{ fontSize: 11, color: 'var(--eh-ink-faint)', marginTop: 2 }}>To {t.assignee_name}</div>
              </div>
              <button className="eh-btn eh-btn-sm" onClick={() => remove(t.id)} title="Remove task">✕</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="eh-btn eh-btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Assigning…' : 'Assign task'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function ActivityPlanner({ taskAssignment = false }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialMonth = searchParams.get('month') || currentMonthYmd()
  const [ngos, setNgos] = useState([])
  const [sectors, setSectors] = useState([])
  // Resolved to BSCT once the NGO list arrives (see defaultNgoId) — the tabs
  // have nothing to highlight before that, and an empty scope is the honest
  // state until the list says which tab to land on.
  const [ngoId, setNgoId] = useState('')
  const [month, setMonth] = useState(() => initialMonth)
  useEffect(() => {
    const m = searchParams.get('month')
    if (m && m !== month) setMonth(m)
  }, [searchParams])
  const [sectorFilter, setSectorFilter] = useState('')
  const [beneficiaryFilter, setBeneficiaryFilter] = useState('')
  const [search, setSearch] = useState('')

  const [activities, setActivities] = useState([])
  const [loadingActs, setLoadingActs] = useState(false)
  const [actsError, setActsError] = useState('')

  const [monthEvents, setMonthEvents] = useState([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [eventsError, setEventsError] = useState('')

  const [toast, setToast] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  // The "Assign Task" modal — only reachable when the Social panel mounts this
  // planner with `taskAssignment`.
  const [assignOpen, setAssignOpen] = useState(false)
  // The row whose "Edit" was clicked — the SAME Create Event form, reopened
  // with the existing event's values loaded into it, so a correction is typed
  // into the form that first captured the data.
  const [editEntry, setEditEntry] = useState(null)
  const [suggestFor, setSuggestFor] = useState(null)
  // The activity just added from this page. Rows are grouped by sector and
  // sorted by name, so without this a new activity lands wherever the alphabet
  // puts it and the user cannot see what they just created.
  const [justAddedId, setJustAddedId] = useState(null)
  // Day of the programme just scheduled, so the calendar link can open on it.
  const [lastScheduled, setLastScheduled] = useState('')
  // { activity, planned } — the row whose Delete was clicked. `planned` is the
  // month's events on that activity, so the confirmation can name what goes.
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // True while a tick is being written, so the boxes cannot be double-toggled into
  // two contradictory saves.
  const [tickBusy, setTickBusy] = useState(false)
  // Bumped after a suggestion is converted into a programme, so the open panel
  // re-reads its ticks from the server instead of showing a stale box.
  const [suggestRev, setSuggestRev] = useState(0)
  // { activity, suggestion } — an object, not a bare suggestion, so "Add
  // programme" with no suggestion is still a distinct, openable state.
  const [planEntry, setPlanEntry] = useState(null)

  // Task assignment (Social panel only): the Social roster for the per-programme
  // dropdowns, and the month's assignments keyed "date::label::contentType" so a
  // programme's deliverable (Banner, YouTube Video, …) shows its member again
  // after a reload.
  const [team, setTeam] = useState([])
  const [taskMap, setTaskMap] = useState({})
  // Set of `${reporter_id}::${date}` the Social head has ACCEPTED for the month.
  // A planned deliverable is shown done/green only when its reporter's report for
  // that day is in here — the member's own "done" never turns the cell green.
  const [acceptedDays, setAcceptedDays] = useState(() => new Set())
  // The done programme whose "Create Event" button was clicked (prefills the
  // modal), and the rows whose event was created THIS session — so a row
  // without a stored suggestion to link to still hides its button at once.
  // Both are keyed "ngo::date::festival": a row's NGO is part of its identity,
  // so MANN creating an event never hides BSCT's row button.
  const [createdKeys, setCreatedKeys] = useState(() => new Set())
  // Payload of the Event Detail Sheet for each row whose event was created THIS
  // session, so its "Download" button can re-issue the same PDF (no second event).
  // Same NGO-scoped key as createdKeys, so a row never re-issues another NGO's sheet.
  const [pdfCache, setPdfCache] = useState(() => new Map())
  // The month's durable row → event links, keyed "ngo::date::festival" and loaded
  // from the server, so a completed row's "Download" button survives a reload and
  // shows on every device — not just the tab that created it.
  const [plannerLinkMap, setPlannerLinkMap] = useState({})
  // The event each planner row produced, with the name it was saved under. The
  // Festival / Day column shows it, so a name changed in the Create / Edit form
  // is visible on the row that owns it. Keyed like the row → event links
  // ("ngo::date::festival") — two NGOs may plan the same festival on one date.
  const [rowEventNames, setRowEventNames] = useState({})

  const [year, setYear] = useState(() => new Date().getFullYear())
  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear()
    return Array.from({ length: 7 }, (_, i) => now - 3 + i)
  }, [])

  /* Keep the "YYYY-MM" string in step with the Month / Year selects. */
  const setMonthPart = (part, value) => {
    const [y, m] = month.split('-')
    const next = part === 'year' ? `${value}-${m}` : `${y}-${pad2(Number(value) + 1)}`
    setMonth(next)
    setYear(Number(next.split('-')[0]))
  }

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2800) }

  const ngo = useMemo(() => ngos.find((n) => String(n.id) === String(ngoId)) || null, [ngos, ngoId])

  /* The tab bar shows only the NGOs this planner is actually for — the three
     with a monthly quota. The workspace NGO list reaches every Event Head user
     and carries every NGO in it (plus placeholder rows with no code), and
     rendering those produced a row of stray tabs beside BSCT / MANN / AFLF.
     The tab currently selected is always kept, so a scope can never disappear
     from its own bar while it is the one in use. */
  const plannerTabNgos = useMemo(
    () => ngos.filter((n) => NGO_MONTHLY_TARGET[ngoCodeKey(n)] || String(n.id) === String(ngoId)),
    [ngos, ngoId],
  )

  useEffect(() => {
    fetchWorkspaceNgos()
      .then((l) => {
        const list = Array.isArray(l) ? l : []
        setNgos(list)
        // Land on BSCT's tab. A tab the user already clicked (or a scope that
        // still matches) is never overridden, so a late response cannot yank
        // the page away from a choice made while it loaded.
        setNgoId((cur) => {
          const wanted = searchParams.get('ngo')
          if (wanted && list.some((n) => String(n.id) === String(wanted))) return String(wanted)
          return (cur && list.some((n) => String(n.id) === String(cur))) ? String(cur) : defaultNgoId(list)
        })
      })
      .catch(() => setNgos([]))
    fetchSectors().then((l) => setSectors(Array.isArray(l) ? l : [])).catch(() => setSectors([]))
  }, [])

  /* Task assignment (Social panel only): the roster fills the per-programme
     dropdowns, and the month's assignments are re-read whenever the month
     changes or after a change, so the grid never shows a stale member. */
  useEffect(() => {
    if (!taskAssignment) return
    fetchTaskAssignees()
      .then((r) => setTeam(Array.isArray(r?.employees) ? r.employees : []))
      .catch((e) => {
        console.error('Task assignees load failed', e)
        setTeam([])
      })
  }, [taskAssignment])

  const loadMonthTasks = useCallback(async () => {
    if (!taskAssignment) { setTaskMap({}); setAcceptedDays(new Set()); return }
    // The days the work was actually finished on. They can sit in another month
    // than the one on screen (a task planned for last month, finished today),
    // and the head's acceptance lands on THAT day — so they are asked for by
    // name, not left to the month filter.
    const doneDays = []
    try {
      const r = await fetchTaskMonthAssignments(month)
      const map = {}
      const days = new Set()
      for (const a of (r?.assignments || [])) {
        map[`${a.task_date}::${a.title}::${a.content_type || ''}`] = a
        const done = String(a.completed_date || '').slice(0, 10)
        if (done) days.add(done)
      }
      setTaskMap(map)
      doneDays.push(...days)
    } catch {
      setTaskMap({})
    }
    try {
      const r = await fetchReviewedDailyReports('social', month, doneDays)
      const set = new Set()
      for (const a of (r?.accepted || [])) set.add(`${a.reporter_id}::${a.report_date}`)
      setAcceptedDays(set)
    } catch {
      setAcceptedDays(new Set())
    }
  }, [taskAssignment, month])

  useEffect(() => { loadMonthTasks() }, [loadMonthTasks])

  /* The head accepts a report in the Approvals screen, which is often another
     tab. Coming back to the planner re-reads the month's acceptances, so the
     deliverable that was just signed off turns green straight away instead of
     waiting for a month change. */
  useEffect(() => {
    if (!taskAssignment) return undefined
    const onFocus = () => { loadMonthTasks() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [taskAssignment, loadMonthTasks])

  /* The roster member whose name matches a deliverable's soft default (Tanvi for
     Banner, Ganesh for YouTube Video, …), so the dropdown is pre-filled with who
     normally does what. Empty when nobody on the roster matches — the dropdown
     then simply starts Unassigned. */
  const defaultMemberId = (contentType) => {
    return ''
  }

  /* Change who handles one deliverable of a programme. Clearing the select
     removes that deliverable's assignment; picking a member (re)creates one, so
     the member sees it on their Daily Report for that day. */
  const assignRow = async (date, label, contentType, assigneeId) => {
    const key = `${date}::${label}::${contentType || ''}`
    const existing = taskMap[key]
    try {
      if (existing && String(existing.assignee_id) === String(assigneeId)) return
      if (existing) {
        await deleteTaskAssignment(existing.id)
        setTaskMap((m) => { const next = { ...m }; delete next[key]; return next })
      }
      if (!assigneeId) return
      const member = team.find((t) => String(t.id) === String(assigneeId))
      if (!member) return
      const res = await createTaskAssignment({
        assignee_id: String(member.id),
        assignee_name: member.name,
        task_date: date,
        title: label,
        content_type: contentType,
        description: '',
      })
      const row = res?.assignment || { id: res?.id, task_date: date, title: label, assignee_id: String(member.id), assignee_name: member.name, content_type: contentType }
      setTaskMap((m) => ({ ...m, [key]: row }))
    } catch (e) {
      showToast(e?.message || 'Could not update the assignment.')
      loadMonthTasks()
    }
  }

  // Preselect when there is only one NGO, so a single-NGO Event Head lands on a
  // usable page instead of the cross-NGO overview.
  useEffect(() => {
    if (!ngoId && ngos.length === 1) setNgoId(String(ngos[0].id))
  }, [ngos, ngoId])

  /* "All NGOs" is a real choice, not an empty state: with no ngoId both
     endpoints drop the filter and return every row, which is what the
     cross-NGO totals, the overview and the all-NGO report are built from. */
  const loadActivities = useCallback(() => {
    setLoadingActs(true); setActsError('')
    fetchActivities(ngoId ? { ngo_id: ngoId } : {})
      .then((l) => setActivities(Array.isArray(l) ? l : []))
      .catch((e) => { setActivities([]); setActsError(e?.message || 'Could not load activities.') })
      .finally(() => setLoadingActs(false))
  }, [ngoId])

  const loadMonthEvents = useCallback(() => {
    const [start, end] = monthBounds(month)
    setLoadingEvents(true)
    setEventsError('')
    fetchCalendarEvents({ start, end, ngoId })
      .then((l) => setMonthEvents(Array.isArray(l) ? l : []))
      .catch((e) => { setMonthEvents([]); setEventsError(e?.message || 'Could not load programmes.') })
      .finally(() => setLoadingEvents(false))
  }, [ngoId, month])

  /* The month's durable row → event links. Loaded whole (no NGO filter) and keyed
     "ngo::date::festival": the row's NGO is part of its identity, because BSCT
     and MANN may both plan the same festival on the same date and each must keep
     its own event. */
  const loadPlannerLinks = useCallback(() => {
    const [start, end] = monthBounds(month)
    getPlannerEventLinks({ start, end })
      .then((list) => {
        const map = {}
        for (const l of (Array.isArray(list) ? list : [])) {
          const k = linkMapKey(
            `${String(l?.observance_date || '').slice(0, 10)}::${String(l?.festival ?? '')}`,
            l?.ngo_id,
          )
          map[k] = l
          const fest = String(l?.festival ?? '')
          const dt = String(l?.observance_date || '').slice(0, 10)
          if (fest && dt && l?.ngo_id != null && String(l.ngo_id) !== '') {
            setFestNgo((cur) => ({ ...cur, [`${dt}::${fest}`]: String(l.ngo_id) }))
          }
        }
        setPlannerLinkMap(map)
      })
       .catch(() => setPlannerLinkMap({}))
   }, [month])

   /* Re-read the month's events and durable planner links when the tab regains
      focus, so an event created elsewhere (e.g. the Monthly Report) shows its
      Download button here without a manual month change. */
   useEffect(() => {
     const onFocus = () => { loadMonthEvents(); loadPlannerLinks() }
     window.addEventListener('focus', onFocus)
     return () => window.removeEventListener('focus', onFocus)
   }, [loadMonthEvents, loadPlannerLinks])

  /* Monthly target "Done" is counted from the month's own event feed (see
     eventsByNgo below), not from the monthly report endpoint. That endpoint's
     events_count is the number of TICKED planner suggestions — and this planner
     deliberately clears every tick on screen at load while the server keeps
     them, so it could report BSCT at "25 of 25 done" for a month that only ran
     two or three programmes. The report call is not needed for the quota any
     more. */

  useEffect(() => { loadActivities() }, [loadActivities])
  useEffect(() => { loadMonthEvents() }, [loadMonthEvents])
  useEffect(() => { loadPlannerLinks() }, [loadPlannerLinks])

  /* ── Festival view of the month ──────────────────────────────────────────
     The grid shows every date of the chosen month, matched against the
     country's important days (Calendarific when the key is configured,
     otherwise the curated + fixed international lists). Its job is to match a
     festival/day to a beneficiary NGO and pick programmes for it — so unlike
     the rows above, this grid is date-wise, not activity-wise. */

  const [importantDays, setImportantDays] = useState([])
  const [festivalError, setFestivalError] = useState('')
  const [festivalSuggestions, setFestivalSuggestions] = useState([])
  // `key` = "date::festival". Held as an object so a re-run can be told apart
  // from the day that started it, while the grid disables only that row.
  const [festGenerating, setFestGenerating] = useState(null)
  const [festBusy, setFestBusy] = useState(false)
  // Pending beneficiary choice per festival, keyed "date::festival". A festival
  // with stored suggestions keeps showing the category they were generated for
  // until the user picks another; the new choice reaches the server the next
  // time that festival's programmes are generated.
  const [festBenef, setFestBenef] = useState({})
  // Pending location choice per festival, keyed "date::festival" — mirrors
  // festBenef exactly: the new place shows at once, reaches the server when the
  // festival's rows exist, and is never auto-filled (a row starts on
  // "Select a location…" and shows only what the user picks).
  const [festLoc, setFestLoc] = useState({})
  /* Festivals whose suggestion block is open THIS session, keyed
     "date::festival". Stored suggestions are never auto-opened: a reload or a
     navigation back starts every row collapsed on its "✦ Suggest programmes"
     button, so asking the AI is always one click away. Everything decided in
     this page lasts this session only — a reload starts it untouched. */
  const [festOpen, setFestOpen] = useState(() => new Set())
  /* The user's own programme per festival and the "cleared" flag per festival.
     Session-only by request: a reload starts them empty and they are NEVER
     written to localStorage, sessionStorage or the URL. */
  const [festManual, setFestManual] = useState(() => ({}))
  const [festCleared, setFestCleared] = useState(() => new Set())
  // Per-row NGO overrides — the NGO column is an editable dropdown, so one
  // festival row can be pointed at a different NGO than the page-wide pick.
  // Keyed by the same "date::festival" key the row itself uses.
  const [festNgo, setFestNgo] = useState(() => ({}))
  /* Extra programme rows the user added with "+ Add another programme", so one
     date can carry more than one programme. Session-only; each entry is the
     unique suffix of a "date::+#suffix" key. */
  const [festExtra, setFestExtra] = useState(() => ({}))
  /* The date the toolbar's single "+ Add another programme" button adds under,
     chosen from a dropdown of the month's days. */
  const [extraRowDate, setExtraRowDate] = useState(() => `${currentMonthYmd()}-01`)

  const loadImportantDays = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    fetchImportantDays({ year: y, month: m, scope: 'all' })
      .then((d) => {
        const list = Array.isArray(d?.days) ? d.days : Array.isArray(d?.observances) ? d.observances : []
        setImportantDays(list)
        if (d && d.ok === false) setFestivalError(d.error || '')
      })
      .catch(() => { setImportantDays([]); setFestivalError('Could not load the festival calendar.') })
  }, [month])

  // Days are a property of the month alone, so they reload on month change but
  // not on NGO change. Errors are cleared at the top, so a stale "could not
  // load" never lingers once a month loads fine.
  useEffect(() => { setFestivalError(''); loadImportantDays() }, [loadImportantDays])

  /* The suggestions already stored for this month. Loaded for EVERY NGO (no
     ngo_id filter) because the NGO column is now editable per row — a row may be
     pointed at any NGO, so its stored ideas have to be available. Each row reads
     only its own NGO's rows (see rowSuggestionsFor), so the NGOs never mix. */
  const loadFestivalSuggestions = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    getFestivalSuggestions({ month: m, year: y })
      .then((l) => {
        const list = Array.isArray(l) ? l : []
        /* A reload starts this planner FRESH. The suggestions themselves load
           normally from the API, but their stored selection bit is ignored —
           every radio is unchecked, every block collapses, the download count
           starts at zero. Nothing a previous session picked is restored.
           Choosing during THIS session re-ticks the row in state (and calls
           the save endpoint as before); the next reload resets the screen. */
        setFestivalSuggestions(list.map((s) => ({ ...s, is_selected: false })))
      })
      .catch(() => setFestivalSuggestions([]))
  }, [month, ngoId])

  useEffect(() => { loadFestivalSuggestions() }, [loadFestivalSuggestions])

  /* A new NGO has its own stored suggestions and its own default group, so a
     pending choice made under the previous NGO must not leak into it. An open
     block belongs to the NGO it was generated for — every row collapses back
     to its button, so switching NGO or month always starts fresh. */
  useEffect(() => { setFestBenef({}) }, [ngoId])
  useEffect(() => { setFestLoc({}) }, [ngoId])
  useEffect(() => { setFestOpen(new Set()) }, [ngoId, month])
  useEffect(() => { setFestExtra({}) }, [ngoId, month])
  useEffect(() => { setExtraRowDate(`${month}-01`) }, [month])
  /* Restore the typed/manual rows for this NGO + month from the server. Loaded
     rows are merged over what is already in memory, so a slow load can never
     wipe text the user is typing right now. */
  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    let cancelled = false
    getPlannerManualRows({ month: m, year: y, ngo_id: ngoId || '' })
      .then((rows) => {
        if (cancelled) return
        const prefix = `${ngoId || 'all'}|${month}|`
        setFestManual((cur) => {
          const next = { ...cur }
          for (const r of rows) {
            const date = String(r?.observance_date || '').slice(0, 10)
            const festival = String(r?.festival ?? '')
            next[`${prefix}${date}::${festival}`] = {
              text: String(r?.body_text || ''),
              selected: Boolean(r?.is_selected),
              ...(r?.mode ? { mode: r.mode } : {}),
              ...(r?.name ? { name: String(r.name) } : {}),
            }
          }
          return next
        })
        setFestExtra((cur) => {
          const next = { ...cur }
          for (const r of rows) {
            const festival = String(r?.festival ?? '')
            if (!festival.startsWith('+')) continue
            const date = String(r?.observance_date || '').slice(0, 10)
            const list = next[date] || []
            if (!list.includes(festival)) next[date] = [...list, festival]
          }
          return next
        })
        setFestNgo((cur) => {
          const next = { ...cur }
          for (const r of rows) {
            const rowNgo = String(r?.row_ngo_id || '')
            if (!rowNgo) continue
            const date = String(r?.observance_date || '').slice(0, 10)
            next[`${date}::${String(r?.festival ?? '')}`] = rowNgo
          }
          return next
        })
        setFestBenef((cur) => {
          const next = { ...cur }
          for (const r of rows) {
            if (r?.beneficiary == null) continue
            const date = String(r?.observance_date || '').slice(0, 10)
            next[`${date}::${String(r?.festival ?? '')}`] = String(r.beneficiary)
          }
          return next
        })
        setFestLoc((cur) => {
          const next = { ...cur }
          for (const r of rows) {
            if (r?.location == null) continue
            const date = String(r?.observance_date || '').slice(0, 10)
            next[`${date}::${String(r?.festival ?? '')}`] = String(r.location)
          }
          return next
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [month, ngoId])
  /* Every selectable day of the month, a festival-less date included. */
  const festivalDates = useMemo(() => daysInMonth(month), [month])

  /* Important days bucketed by date, so one day can list several festivals.
     Sorted by name so a given date always reads the same. */
  const observancesByDate = useMemo(() => {
    const map = {}
    for (const o of importantDays) {
      const d = String(o?.date || '').slice(0, 10)
      if (!d) continue
      if (!map[d]) map[d] = []
      map[d].push(o)
    }
    for (const d in map) map[d].sort((a, b) => String(a.name).localeCompare(String(b.name)))
    return map
  }, [importantDays])

  /* Suggestions grouped by the date::festival pair that created them, so each
     festival shows its own generated list with no cross-NGO mixing. */
  const festivalSuggestionsByKey = useMemo(() => {
    const map = {}
    for (const s of festivalSuggestions) {
      const key = `${String(s.observance_date || '').slice(0, 10)}::${String(s.festival || '')}`
      if (key === '::') continue
      if (!map[key]) map[key] = []
      map[key].push(s)
    }
    return map
  }, [festivalSuggestions])

  /* The stored manual entries of the NGO + month on screen, re-keyed to plain
     "date::festival" so they line up with festivalSuggestionsByKey exactly. */
  const scopedManualPrefix = `${ngoId || 'all'}|${month}|`
  const scopedManual = useMemo(() => {
    const out = {}
    for (const k in festManual) {
      if (k.startsWith(scopedManualPrefix)) out[k.slice(scopedManualPrefix.length)] = festManual[k]
    }
    return out
  }, [festManual, scopedManualPrefix])

  /* The manual row's export value in one place: selected AND actually typed,
     so an emptied textarea can never claim a slot in the download. */
  const manualExportText = useCallback(
    (key) => {
      const e = scopedManual[key]
      const text = String(e?.text || '').trim()
      return e?.selected && text ? text : ''
    },
    [scopedManual]
  )

  /* A manual planner row survives a reload: the typed programme, the event name
     and the "+ Add another programme" rows are written to the server as they
     change, then loaded back below. The row's identity is (date, festival, NGO
     scope), exactly like the durable row -> event link. */
  const manualKeyParts = useCallback((key) => {
    const sep = String(key || '').indexOf('::')
    return {
      date: String(sep >= 0 ? key.slice(0, sep) : key).slice(0, 10),
      festival: sep >= 0 ? key.slice(sep + 2) : '',
    }
  }, [])

  const persistManualRow = useCallback((key, override = {}) => {
    if (!key) return Promise.resolve(null)
    const [y, m] = month.split('-').map(Number)
    const { date, festival } = manualKeyParts(key)
    const entry = { ...(scopedManual[key] || {}), ...override }
    const scopeNgo = ngoId || ''
    const getRowNgo = () => {
      if (override.row_ngo_id !== undefined && override.row_ngo_id !== null && override.row_ngo_id !== '') return override.row_ngo_id
      if (festNgo[key]) return festNgo[key]
      try {
        return typeof rowNgoId === 'function' ? rowNgoId(key) : ''
      } catch {
        return ''
      }
    }
    const rowNgo = getRowNgo()
    const isExtra = festival.startsWith('+')
    const name = String(override.name !== undefined ? override.name : (entry.name || ''))
    const body = String(override.text !== undefined ? override.text : (entry.text || ''))
    const selected = override.selected !== undefined ? Boolean(override.selected) : Boolean(entry.selected)
    const mode = override.mode !== undefined ? (override.mode ? String(override.mode) : null) : (entry.mode ? String(entry.mode) : null)
    const beneficiary = override.beneficiary !== undefined ? override.beneficiary : (entry.beneficiary !== undefined ? entry.beneficiary : (festBenef[key] || null))
    const location = override.location !== undefined ? override.location : (entry.location !== undefined ? entry.location : (festLoc[key] || null))
    // A normal festival row with nothing typed and no tick needs no stored row.
    // An extra row is kept even while empty: its existence IS the row.
    if (!isExtra && !name && !body && !selected && !mode && !beneficiary && !location) {
      return deletePlannerManualRow({ observance_date: date, festival, ngo_id: scopeNgo }).catch(() => null)
    }
    return savePlannerManualRow({
      month: m,
      year: y,
      observance_date: date,
      festival,
      ngo_id: scopeNgo,
      row_ngo_id: rowNgo,
      name,
      body_text: body,
      is_selected: selected,
      mode,
      beneficiary,
      location,
    }).catch(() => null)
  }, [month, ngoId, scopedManual, festNgo, festBenef, festLoc, manualKeyParts])

  const deleteManualRow = useCallback((key) => {
    const { date, festival } = manualKeyParts(key)
    return deletePlannerManualRow({ observance_date: date, festival, ngo_id: ngoId || '' }).catch(() => null)
  }, [ngoId, manualKeyParts])

  const extraRowsByDate = useMemo(() => {
    const out = {}
    const add = (date, festival) => {
      if (!date || !String(festival || '').startsWith('+')) return
      const list = out[date] || []
      if (!list.includes(festival)) out[date] = [...list, festival]
    }
    for (const key of Object.keys(scopedManual)) {
      const sep = key.indexOf('::')
      if (sep < 0) continue
      add(key.slice(0, sep), key.slice(sep + 2))
    }
    for (const date of Object.keys(festExtra)) {
      for (const festival of festExtra[date] || []) add(date, festival)
    }
    return out
  }, [scopedManual, festExtra])

  /* A festival the user already decided about (an AI tick or a typed programme)
     opens itself, so "what is in the download?" is answered on screen without a
     click. The merge only ever ADDS keys: a block the user opened but has not
     decided anything in yet is never closed behind their back. */
  useEffect(() => {
    setFestOpen((cur) => {
      let changed = false
      const next = new Set(cur)
      for (const s of festivalSuggestions) {
        if (!s?.is_selected) continue
        const k = festivalKeyOf(s)
        if (!next.has(k)) { next.add(k); changed = true }
      }
      for (const k in scopedManual) {
        if (manualExportText(k) && !next.has(k)) { next.add(k); changed = true }
      }
      return changed ? next : cur
    })
  }, [festivalSuggestions, scopedManual, manualExportText])

  /* One entry per festival that reaches the download: a typed programme
     replaces its festival's selected AI idea (never sits beside it), so the
     counter on screen always equals the rows the file will list. */
  const selectedFestivalCount = useMemo(() => {
    const manualKeys = new Set(Object.keys(scopedManual).filter((k) => {
      const e = scopedManual[k]
      return Boolean(e?.selected) && Boolean(String(e.text || '').trim())
    }))
    const ai = festivalSuggestions.filter((s) => s.is_selected && !manualKeys.has(festivalKeyOf(s))).length
    return ai + manualKeys.size
  }, [festivalSuggestions, scopedManual])

  /* "Monthly target reached" popup. Fires when the selections for download
     cross the in-scope NGO's quota (BSCT 25, AFLF 20, MANN 15 — monthlyTargetFor)
     — ONCE per NGO + month. In "All NGOs" the count can't be attributed to one
     quota, so it stays quiet there. Nothing is persisted: a reload forgets it. */
  const [targetPopup, setTargetPopup] = useState(null)
  const [targetPopupSeen, setTargetPopupSeen] = useState('')
  useEffect(() => {
    if (targetPopup || !ngo) return
    if (selectedFestivalCount < monthlyTargetFor(ngo)) return
    const seenKey = `${ngo.id}::${month}`
    if (targetPopupSeen === seenKey) return
    setTargetPopupSeen(seenKey)
    setTargetPopup({
      label: ngoShortLabel(ngo),
      name: ngo.name,
      count: selectedFestivalCount,
      target: monthlyTargetFor(ngo),
    })
  }, [selectedFestivalCount, ngo, month, targetPopup, targetPopupSeen])

  /* The NGO column is an editable dropdown per row. A row's NGO is: the user's
     explicit pick for that row, else the page-wide NGO, else the NGO the row's
     stored suggestions already belong to. Rows read only their own NGO's stored
     ideas, so BSCT, MANN and AFLF never mix in one block. */
  const rowNgoId = useCallback((key) => {
    if (festNgo[key]) return String(festNgo[key])
    if (ngoId) return String(ngoId)
    const stored = (festivalSuggestionsByKey[key] || []).find((s) => s.ngo_id)
    return stored ? String(stored.ngo_id) : ''
  }, [festNgo, ngoId, festivalSuggestionsByKey])

  const rowNgo = useCallback(
    (key) => ngos.find((n) => String(n.id) === rowNgoId(key)) || null,
    [ngos, rowNgoId]
  )

  const rowSuggestionsFor = useCallback(
    (key) => (festivalSuggestionsByKey[key] || []).filter((s) => String(s.ngo_id ?? '') === rowNgoId(key)),
    [festivalSuggestionsByKey, rowNgoId]
  )

  /* Changing a row's NGO abandons the Beneficiary / Location picked for the
     previous NGO (they were that NGO's), so the row starts clean for the new
     one. Any AI idea already ticked for the old NGO is unticked too (on screen
     and on the server) — otherwise it would sit hidden in the grid yet still
     reach the download under the old NGO. Stored ideas are never deleted, only
     the selection is dropped. */
  const changeRowNgo = (key, value) => {
    const prevId = rowNgoId(key)
    setFestNgo((cur) => ({ ...cur, [key]: value }))
    setFestBenef((cur) => { const next = { ...cur }; delete next[key]; return next })
    setFestLoc((cur) => { const next = { ...cur }; delete next[key]; return next })
    if (String(key).slice(String(key).indexOf('::') + 2).startsWith('+')) {
      persistManualRow(key, { row_ngo_id: value })
    }
    if (prevId && String(value) !== String(prevId)) {
      const stale = (festivalSuggestionsByKey[key] || [])
        .filter((s) => s.is_selected && String(s.ngo_id ?? '') === prevId)
      if (stale.length) {
        const ids = new Set(stale.map((s) => s.id))
        setFestivalSuggestions((list) => list.map((x) => (ids.has(x.id) ? { ...x, is_selected: false } : x)))
        stale.forEach((s) => setFestivalSuggestionSelected(s.id, false).catch(() => null))
      }
    }
  }

  /* The category a festival row's dropdown shows, and the value sent when that
     festival's programmes are generated: the user's pending choice first, then
     the category the stored suggestions were actually generated with (so a
     reload keeps showing the truth). Never auto-filled from the NGO — the row
     starts on "Select a category…" and shows only what the user picks, so the
     grid never claims an audience nobody chose. */
  const festivalBeneficiaryFor = useCallback((key) => {
    if (festBenef[key]) return festBenef[key]
    const stored = rowSuggestionsFor(key).map((s) => s.beneficiary).find(Boolean)
    return stored || ''
  }, [festBenef, rowSuggestionsFor])

  /* Changing the row's Beneficiary dropdown. The pending choice shows at once,
     and when the festival already has stored suggestions the server copy is
     updated too — so the grid, the dropdown's fallback after a reload and the
     Excel/PDF Beneficiary column all show exactly what was picked, even if the
     user never regenerates. A failed save rolls the row back to what the
     server holds: a category that looks chosen but exports as the old one is
     worse than an honest error. */
  const handleFestivalBeneficiary = async (key, value) => {
    const prevFor = festivalBeneficiaryFor(key)
    setFestBenef((cur) => ({ ...cur, [key]: value }))
    let ownerId = ''
    try { ownerId = typeof rowNgoId === 'function' ? (rowNgoId(key) || festNgo[key] || '') : (festNgo[key] || '') } catch { ownerId = festNgo[key] || '' }
    const stored = rowSuggestionsFor(key)
    const isExtra = String(key.split('::')[1] || '').startsWith('+')
    // Always persist to manual rows so first selection saves
    persistManualRow(key, { beneficiary: value, row_ngo_id: ownerId })
    if (isExtra) {
      console.log('persist beneficiary extra', key, value)
    }
    if (!stored.length || !ownerId) {
      return // nothing stored yet — the choice travels with the next generation
    }
    const [date, ...rest] = key.split('::')
    const festival = rest.join('::')
    const [y, m] = month.split('-').map(Number)
    try {
      await setFestivalSuggestionsBeneficiary({ month: m, year: y, ngo_id: ownerId, date, festival, beneficiary: value })
      setFestivalSuggestions((list) => list.map((x) => (
        String(x.observance_date || '').slice(0, 10) === date && String(x.festival || '') === festival && String(x.ngo_id ?? '') === ownerId
          ? { ...x, beneficiary: value }
          : x
      )))
    } catch (e) {
      setFestBenef((cur) => ({ ...cur, [key]: prevFor }))
      showToast(e?.message || 'Could not save the beneficiary category.')
    }
  }

  /* The place a festival row's Location cell shows: the user's pending choice
     first, then the spot the stored suggestions actually carry, so a reload
     keeps showing the truth. Never read from anywhere else — a row starts on
     "Select a location…" and every shown place was picked or typed. */
  const festivalLocationFor = useCallback((key) => {
    if (festLoc[key]) return festLoc[key]
    const stored = rowSuggestionsFor(key).map((s) => s.location).find(Boolean)
    return stored || ''
  }, [festLoc, rowSuggestionsFor])

  /* Changing the row's Location dropdown / "Other…" box. Mirrors the
     Beneficiary handler: the pending choice shows at once, and when the
     festival already has stored suggestions the server copy is updated too —
     so the grid, the value after a reload and the Excel/PDF Location column
     all show exactly what was picked, even if the user never regenerates. The
     NGO is the one in scope, or the one the stored suggestions actually belong
     to on "All NGOs". A failed save rolls the row back to what the server
     holds. */
  const handleFestivalLocation = async (key, value) => {
    const prevFor = festivalLocationFor(key)
    setFestLoc((cur) => ({ ...cur, [key]: value }))
    const stored = rowSuggestionsFor(key)
    const isExtra = String(key.split('::')[1] || '').startsWith('+')
    let ownerNgoId = ''
    try { ownerNgoId = typeof rowNgoId === 'function' ? (rowNgoId(key) || stored[0]?.ngo_id || festNgo[key] || '') : (stored[0]?.ngo_id || festNgo[key] || '') } catch { ownerNgoId = stored[0]?.ngo_id || festNgo[key] || '' }
    // Always persist to manual rows so first selection saves immediately
    persistManualRow(key, { location: value, row_ngo_id: ownerNgoId })
    if (isExtra) {
      console.log('persist location extra', key, value)
    }
    if (!stored.length) {
      return // nothing stored yet — the choice travels with the next generation
    }
    if (!ownerNgoId) return
    const [date, ...rest] = key.split('::')
    const festival = rest.join('::')
    const [y, m] = month.split('-').map(Number)
    try {
      await setFestivalSuggestionsLocation({ month: m, year: y, ngo_id: ownerNgoId, date, festival, location: value })
      setFestivalSuggestions((list) => list.map((x) => (
        String(x.observance_date || '').slice(0, 10) === date && String(x.festival || '') === festival && String(x.ngo_id ?? '') === String(ownerNgoId)
          ? { ...x, location: value || null }
          : x
      )))
    } catch (e) {
      setFestLoc((cur) => ({ ...cur, [key]: prevFor }))
      showToast(e?.message || 'Could not save the location.')
    }
  }

  /* Generates a day's programmes for one NGO, aimed at the category chosen in
     that row's Beneficiary dropdown. Nothing runs while the dropdown is empty:
     the programmes must be aimed at a category the user actually picked, never
     at the NGO's own group by default. The server accepts only the closed
     category vocabulary, so a bad value can never reach the model. Selections
     are saved per suggestion, so re-running a day never resets a tick. */
  const suggestFestival = async (date, festivalName) => {
    const key = `${date}::${festivalName}`
    setFestivalError('')
    const rowId = rowNgoId(key)
    if (!rowId) {
      setFestivalError('Pick an NGO for this row to generate festival programmes for it.')
      return
    }
    if (!festivalBeneficiaryFor(key)) {
      setFestivalError('Pick a Beneficiary category for this festival first.')
      return
    }
    if (festGenerating?.key === key) return
    setFestGenerating({ key })
    try {
      const res = await suggestFestivalPrograms({
        month, date, festival: festivalName, ngo_id: rowId, sector_id: sectorFilter || null,
        beneficiary_group: festivalBeneficiaryFor(key) || null,
        // Keep the block's chosen place on the freshly generated rows.
        location: festivalLocationFor(key) || null,
      })
      const added = Array.isArray(res?.suggestions) ? res.suggestions : []
      if (added.length) {
        const [y, m] = month.split('-').map(Number)
        const fresh = await getFestivalSuggestions({ month: m, year: y, ngo_id: rowId }).catch(() => [])
        // `fresh` is this NGO's whole month, so replace ALL of that NGO's rows
        // (across festivals) and keep every other NGO's rows untouched.
        const forNgoId = (x) => String(x.ngo_id ?? '') === String(rowId)
        setFestivalSuggestions((cur) => [
          ...cur.filter((x) => !forNgoId(x)),
          ...(Array.isArray(fresh) ? fresh : []),
        ])
        // Open this festival's block so the fresh batch is on screen — the
        // only time a block opens by itself, and only for the row that asked.
        setFestOpen((cur) => new Set(cur).add(key))
        // Fresh ideas are meant to be picked from: leave manual-only mode so
        // the new batch is offered as options again.
        updateFestivalManual(key, { mode: false })
        persistManualRow(key, { mode: false })
        showToast(`${added.length} programme${added.length === 1 ? '' : 's'} suggested for ${shortDate(date)} · ${festivalName}.`)
      } else if (res?.ai && res.ai.available === false) {
        setFestivalError(res.ai.reason || 'AI suggestions are not available on this server yet.')
      } else {
        setFestivalError('No programmes could be generated for this day.')
      }
    } catch (e) {
      setFestivalError(e?.message || 'Could not generate festival programmes.')
    } finally {
      setFestGenerating((cur) => (cur?.key === key ? null : cur))
    }
  }

  /* ── One choice per festival ────────────────────────────────────────────── */

  /* Choosing an AI idea: this festival's group flips to exactly that one
     suggestion (radio behaviour), every other idea of the same festival + NGO
     is unticked in the same save, and a typed programme stops being the export
     pick — its text is kept, only the override is dropped. The screen updates
     first; a failed save puts everything back and says so. */
  const selectFestivalSuggestion = async (s) => {
    if (festBusy) return
    const key = festivalKeyOf(s)
    const sameGroup = (x) => festivalKeyOf(x) === key && String(x.ngo_id ?? '') === String(s.ngo_id ?? '')
    const others = (festivalSuggestionsByKey[key] || []).filter((x) => sameGroup(x) && Number(x.id) !== Number(s.id) && x.is_selected)
    const prevList = festivalSuggestions
    const prevManual = festManual
    setFestBusy(true); setFestivalError('')
    setFestivalSuggestions((list) => list.map((x) => (sameGroup(x) ? { ...x, is_selected: Number(x.id) === Number(s.id) } : x)))
    setFestManual((cur) => {
      const fk = `${scopedManualPrefix}${key}`
      const next = { ...cur }
      // Picking an idea leaves manual-only mode, and stops it being the export.
      if (next[fk]?.mode || next[fk]?.selected) {
        next[fk] = { ...next[fk], mode: false, selected: false }
      }
      return next
    })
    try {
      await Promise.all([
        setFestivalSuggestionSelected(s.id, true),
        ...others.map((x) => setFestivalSuggestionSelected(x.id, false)),
      ])
    } catch (e) {
      setFestivalSuggestions(prevList)
      setFestManual(prevManual)
      showToast(e?.message || 'Could not save the selection.')
    } finally {
      setFestBusy(false)
    }
  }

  /* Clicking the ✓ selected suggestion again puts every idea of that festival
     back on the table: only this tick is removed — never a delete — and a typed
     programme (if any) is left exactly as it was. */
  const unselectFestivalSuggestion = async (s) => {
    if (festBusy) return
    const prevList = festivalSuggestions
    setFestBusy(true)
    setFestivalSuggestions((list) => list.map((x) => (Number(x.id) === Number(s.id) ? { ...x, is_selected: false } : x)))
    // Leaving the choice means "show me the options" — never stay hidden in
    // manual-only mode. The typed text and its tick are untouched.
    updateFestivalManual(festivalKeyOf(s), { mode: false })
    try {
      await setFestivalSuggestionSelected(s.id, false)
    } catch (e) {
      setFestivalSuggestions(prevList)
      showToast(e?.message || 'Could not save the selection.')
    } finally {
      setFestBusy(false)
    }
  }

  /* The typed programme lives in React state only, so the AI suggestions
     behind it are never changed in the database. */
  const updateFestivalManual = (key, patch) => {
    setFestManual((cur) => {
      const fk = `${scopedManualPrefix}${key}`
      const had = cur[fk]
      const merged = { text: '', selected: false, ...(had || {}), ...patch }
      // Nothing real behind it yet (no typed text, no tick, no manual-only
      // intent, no event name) — write nothing, so an accidental focus never
      // pollutes state.
      if (!had && !merged.text && !merged.selected && !merged.mode && !merged.name) return cur
      return { ...cur, [fk]: merged }
    })
  }

  /* "Clear Suggestions": hides the Other-suggestions block for this festival
     for the rest of the session. Pure UI state — the stored suggestions stay
     in the database exactly as they are. */
  const clearOtherSuggestions = (key) => {
    const fk = `${scopedManualPrefix}${key}`
    setFestCleared((cur) => {
      if (cur.has(fk)) return cur
      const next = new Set(cur)
      next.add(fk)
      return next
    })
  }

  /* "Clear all AI suggestions": every ticked idea in THIS session is unticked
     on screen at once, and the same save endpoint each radio uses is called in
     the background so the unticking sticks (until the next reload, which starts
     fresh anyway). Nothing is deleted — only the selection is dropped. */
  const clearAllFestivalSelections = () => {
    const selected = festivalSuggestions.filter((s) => s.is_selected)
    if (!selected.length) return
    setFestivalSuggestions((list) => list.map((x) => ({ ...x, is_selected: false })))
    selected.forEach((s) => setFestivalSuggestionSelected(s.id, false).catch(() => null))
  }

  /* Bucket the month's events by activity id so each row can show what it
     already has. The calendar feed returns an activities[] array per event,
     which is all the matching this needs — no per-activity request. */
  const plannedByActivity = useMemo(() => {
    const map = new Map()
    for (const ev of monthEvents) {
      const p = ev.extendedProps || {}
      const title = String(ev.title || '').split(' · ')[0]
      for (const a of (p.activities || [])) {
        const key = String(a.id)
        if (!map.has(key)) map.set(key, [])
        map.get(key).push({ id: ev.id, title, date: String(p.date || '').slice(0, 10), status: p.status })
      }
    }
    return map
  }, [monthEvents])

  const rows = useMemo(() => {
    let list = activities
    if (sectorFilter) list = list.filter((a) => String(a.sector_id) === String(sectorFilter))
    if (beneficiaryFilter) {
      const want = beneficiaryFilter.trim().toLowerCase()
      list = list.filter((a) => activityBeneficiary(a).toLowerCase() === want)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((a) => [a.name, a.sector_name, activityBeneficiary(a), a.description].filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    return list
  }, [activities, sectorFilter, beneficiaryFilter, search])

  /* Grouped through a Map rather than by comparing against the previous row:
     activities arrive in created_at order, so one sector used to be split into
     two headers. Sectors and the activities inside them are both sorted, so the
     same month always reads in the same order. */
  const bySector = useMemo(() => {
    const map = new Map()
    for (const a of rows) {
      const key = a.sector_name || 'Uncategorised'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(a)
    }
    // Sector, then name — but the activity just added leads its own sector, and
    // that sector leads the list, so a new row is the first thing on screen.
    return [...map.entries()]
      .sort((x, y) => {
        const xNew = x[1].some((a) => String(a.id) === String(justAddedId)) ? 0 : 1
        const yNew = y[1].some((a) => String(a.id) === String(justAddedId)) ? 0 : 1
        if (xNew !== yNew) return xNew - yNew
        return x[0].localeCompare(y[0])
      })
      .map(([key, list]) => ({
        key,
        rows: [...list].sort((x, y) => {
          if (String(x.id) === String(justAddedId)) return -1
          if (String(y.id) === String(justAddedId)) return 1
          return String(x.name || '').localeCompare(String(y.name || ''))
        }),
      }))
  }, [rows, justAddedId])

  /* Programmes actually run this month, per NGO: the month's event feed grouped
     by the NGO carried on each event. This is the same source the Monthly Report
     blocks count from (report.blocks[].done), so the card's "Done" can never
     disagree with the file it summarises — and targetTotals is summed from these
     cards, so the headline cannot drift from them either.

     Counting this from the monthly report endpoint was the bug: its events_count
     is the number of TICKED planner suggestions, and this planner clears every
     tick on screen when it loads while the server keeps them — which is how
     BSCT read "25 of 25 done" for a month that only ran two or three
     programmes. */
  const eventsByNgo = useMemo(() => {
    const map = new Map()
    for (const ev of monthEvents) {
      const p = ev.extendedProps || {}
      const id = String(p.ngoId ?? p.ngo_id ?? ev?.ngo_id ?? '')
      if (!id || id === 'null' || id === 'undefined') continue
      map.set(id, (map.get(id) || 0) + 1)
    }
    return map
  }, [monthEvents])

  /* Progress against each NGO's monthly quota.

     Built from the workspace NGO list, not from the monthly report's rows: that
     endpoint only returns an NGO that already has an event in the month, so an
     NGO with nothing planned yet would have no card at all instead of a
     readable 0 of 15.

     The cards follow the NGO dropdown rather than always listing everybody:
     picking BSCT shows BSCT's quota alone, "All NGOs" shows all three. The
     ngos table also holds rows that are not one of the three planning NGOs
     (a placeholder with no code), and on "All NGOs" those are dropped — a
     "0 of 15" card for a row that is not really an NGO is noise. Picked
     explicitly it still gets a card, because then it is the user's choice and
     an empty panel would be worse. */
  const ngoTargets = useMemo(() => ngos
    .filter((n) => ngo ? String(n.id) === String(ngo.id) : !!NGO_MONTHLY_TARGET[ngoCodeKey(n)])
    .map((n) => {
      const planned = eventsByNgo.get(String(n.id)) || 0
      const target = monthlyTargetFor(n)
      return {
        ngo: n,
        label: ngoShortLabel(n),
        target,
        planned,
        remaining: Math.max(0, target - planned),
        over: Math.max(0, planned - target),
        pct: target > 0 ? Math.min(100, Math.round((planned / target) * 100)) : 0,
      }
    })
    .sort((a, b) => targetOrderFor(a.ngo) - targetOrderFor(b.ngo)
      || a.label.localeCompare(b.label)), [ngos, eventsByNgo, ngo])

  /* The header line: the quotas in view added up, next to what has been
     planned. Summed from ngoTargets so the headline can never drift from the
     cards below it, and named after the scope so it reads the same way as the
     cards do. */
  const targetTotals = useMemo(() => ngoTargets.reduce(
    (t, r) => ({ target: t.target + r.target, planned: t.planned + r.planned }),
    { target: 0, planned: 0 },
  ), [ngoTargets])

  /* ── Selected AI suggestions for this NGO + month. Fetched for the report
        only, so the download reflects every tick the user made across all
        activities, not just the ones on screen. */
  const [selectedSuggestions, setSelectedSuggestions] = useState([])
  // The off-screen node the PDF export captures. Kept in the normal flow (not
  // display:none) because html2canvas renders nothing for hidden nodes.
  const reportRef = useRef(null)
  const [downloading, setDownloading] = useState('')
  const [sheetBusy, setSheetBusy] = useState('')
  // Row whose Edit is loading its event photos for the form. Separate from
  // sheetBusy so the two buttons never share one label.
  const [editLoadingKey, setEditLoadingKey] = useState('')

  /* No early return for "All NGOs": the report is downloadable from that scope
       too, and its AI column has to be filled from every NGO's ticked ideas. An
       empty ngo_id is dropped from the query, which is exactly the "all" case. */
  const loadSelectedSuggestions = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    return fetchPlannerSuggestions({ ngo_id: ngoId, month: m, year: y, selected_only: true })
      .then((l) => setSelectedSuggestions(Array.isArray(l) ? l : []))
      .catch(() => setSelectedSuggestions([]))
  }, [ngoId, month])

  useEffect(() => { loadSelectedSuggestions() }, [loadSelectedSuggestions])

  /* The ticked ideas that belong to the beneficiary in the filter.
     "All beneficiaries" is the unfiltered list, so the report still covers every
     decision the user has made. Picking a group narrows both the day rows and
     the "to be scheduled" list to that group, so the filter and the AI column
     can never describe different sets. */
  const scopedSuggestions = useMemo(() => {
    if (!beneficiaryFilter) return selectedSuggestions
    const want = beneficiaryFilter.trim().toLowerCase()
    const byId = new Map(activities.map((a) => [String(a.id), a]))
    return selectedSuggestions.filter((s) => {
      const a = byId.get(String(s?.activity_id))
      if (!a) return false
      return activityBeneficiary(a).toLowerCase() === want
    })
  }, [selectedSuggestions, activities, beneficiaryFilter])

  /* Suggestions indexed three ways, because a programme is linked to an idea in
     three different ways depending on how it was made:
       byEvent  — the idea recorded which programme it became (suggested_event_id)
       byTitle  — the programme was named after the idea, which is what happens to
                  the extra dates when one idea is planned on several days
       byActivity— neither of the above, so the idea belongs to that activity's
                  programmes but cannot be pinned to one of them
     The first two are exact; only the third is a guess, and it is the last
     resort. Guessing by activity alone is what made one idea appear on every
     programme of the activity. */
  /* Whether every activity on screen is already ticked. Drives the one bulk button
     in the section header, and is computed from the visible rows rather than from
     the NGO-wide total, so an active filter cannot make the button describe the
     wrong action. */
  const allShownTicked = rows.length > 0 && rows.every((a) => a.in_report === true)

  /* The activities the user has ticked for the download. This is the only rule
     that decides what the file contains - screen filters (sector, search,
     beneficiary) are for finding rows, not for editing the file. */
  const tickedActivityIds = useMemo(
    () => new Set(activities.filter((a) => a.in_report).map((a) => Number(a.id))),
    [activities]
  )

  const suggestionIndex = useMemo(() => {
    const byEvent = new Map()
    const byTitle = new Map()
    const byActivity = new Map()
    const norm = (v) => String(v ?? '').trim().toLowerCase()
    for (const s of scopedSuggestions) {
      const evId = Number(s?.suggested_event_id)
      if (Number.isFinite(evId) && evId > 0) {
        if (!byEvent.has(evId)) byEvent.set(evId, s)
      }
      const title = norm(s?.title)
      if (title) {
        const key = `${Number(s?.activity_id) || 0}::${title}`
        if (!byTitle.has(key)) byTitle.set(key, s)
      }
      const actId = Number(s?.activity_id)
      if (Number.isFinite(actId) && actId > 0) {
        if (!byActivity.has(actId)) byActivity.set(actId, [])
        byActivity.get(actId).push(s)
      }
    }
    return { byEvent, byTitle, byActivity, norm }
  }, [scopedSuggestions])

  /* One entry per programme the user planned, grouped by NGO. This is the single
     source the preview, the Excel sheet and the PDF all render. */
  const report = useMemo(() => {
    const nameByActivity = new Map(activities.map((a) => [Number(a.id), a]))
    const ngoById = new Map(ngos.map((n) => [String(n.id), n]))
    const { byEvent, byTitle, byActivity, norm } = suggestionIndex

    const rows = []
    for (const ev of monthEvents) {
      const p = ev.extendedProps || {}
      const date = String(p.date || '').slice(0, 10)
      if (!date) continue
      const acts = (Array.isArray(p.activities) ? p.activities : []).filter((a) => a?.name)
      const evId = Number(ev?.id)
      const title = String(ev?.title || '').split(' · ')[0].trim()

      let suggestion = Number.isFinite(evId) ? byEvent.get(evId) : null
      // No recorded link: an idea planned on several dates shares its name with
      // every one of them, so the name identifies it exactly.
      if (!suggestion) {
        for (const a of acts) {
          const hit = byTitle.get(`${Number(a.id) || 0}::${norm(title)}`)
          if (hit) { suggestion = hit; break }
        }
      }
      rows.push({
        eventId: evId,
        date,
        dateLabel: reportDate(date),
        weekday: new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
        ngoId: p.ngoId ?? p.ngo_id ?? ev?.ngo_id ?? null,
        ngoLabel: ngoShortLabel(ngoById.get(String(p.ngoId ?? p.ngo_id ?? ev?.ngo_id ?? '')) || null),
        activityIds: acts.map((a) => Number(a.id)).filter((n) => Number.isFinite(n)),
        // A programme can belong to several activities, and flattening them into
        // one string is what made the file unreadable. Each is marked instead:
        // ticked ones are what the user chose, the rest are named so nothing
        // disappears silently.
        activity: acts.length
          ? acts.map((a) => (tickedActivityIds.has(Number(a.id))
            ? `${REPORT_TICK} ${a.name}`
            : `${a.name} (not selected)`)).join('\n')
          : '—',
        // Only a programme with at least one ticked activity is in the download.
        included: acts.some((a) => tickedActivityIds.has(Number(a.id))),
        programme: title || '—',
        status: String(ev?.status || p.status || '—'),
        suggestion: suggestion
          ? {
            id: suggestion.id,
            title: suggestion.title,
            priority: suggestion.priority || '',
            objective: suggestion.objective || '',
            materials: suggestion.materials || [],
          }
          : null,
      })
    }
    rows.sort((a, b) => (a.date === b.date ? a.programme.localeCompare(b.programme) : a.date.localeCompare(b.date)))

    /* An idea with no programme of its own is still a decision the user made, so
        it is listed rather than dropped — but only when it genuinely has no
        programme. Anything sitting on a row above is already accounted for.
    
        An idea belonging to an unticked activity is not in the download: the file
        answers "the activities I chose", and an idea for an activity that was not
        chosen is not part of it. They are counted, so the omission is visible. */
    const placedSuggestionIds = new Set(rows.map((r) => Number(r.suggestion?.id)).filter(Boolean))
    const pendingAll = scopedSuggestions
      .filter((s) => !placedSuggestionIds.has(Number(s?.id)))
      .map((s) => ({
        id: s.id,
        title: s.title,
        priority: s.priority || '',
        objective: s.objective || '',
        materials: s.materials || [],
        activity: nameByActivity.get(Number(s?.activity_id))?.name || '—',
        activityId: Number(s?.activity_id),
        ngoLabel: ngoShortLabel(nameByActivity.get(Number(s?.activity_id))
          ? ngoById.get(String(nameByActivity.get(Number(s?.activity_id)).ngo_id))
          : null),
      }))
    const pending = pendingAll.filter((s) => tickedActivityIds.has(s.activityId))
    const suggestionsLeftOut = pendingAll.length - pending.length

    /* One block per NGO, taken from the NGOs actually in scope rather than from the
       quota cards. The cards deliberately hide NGOs with no quota entry, but a
       hidden card must not remove that NGO's programmes from the file — and
       reading the cards' own shape (which nests the NGO under `ngo`) is what
       previously matched every block against `undefined` and produced a report
       with no rows and no dates at all. */
    const scopeNgos = ngo ? [ngo] : ngos
    const inScope = (a) => !ngo || String(a?.ngo_id ?? '') === String(ngo.id)

    /* The named list the file leads with: which activities were ticked, and how
       much each one contributed this month. Without this the reader has to infer
       the selection from the rows, which is the guesswork being removed. */
    const selectedActivities = activities
      .filter((a) => a.in_report && inScope(a))
      .map((a) => ({
        id: Number(a.id),
        name: a.name,
        ngoLabel: ngoShortLabel(ngoById.get(String(a.ngo_id)) || null),
        programmes: rows.filter((r) => r.included && r.activityIds.includes(Number(a.id))).length,
      }))
      .sort((x, y) => (x.ngoLabel === y.ngoLabel ? x.name.localeCompare(y.name) : x.ngoLabel.localeCompare(y.ngoLabel)))

    const blocks = scopeNgos.map((n) => {
      const allRows = rows.filter((r) => String(r.ngoId) === String(n.id))
      const target = monthlyTargetFor(n)
      const done = allRows.length
      return {
        key: String(n.id),
        label: ngoShortLabel(n),
        name: n.name,
        target,
        // Quota counts programmes added, which is the rule it has always been, so
        // it must not move because a tick changed. What the file lists is counted
        // separately, or the two numbers look like they contradict each other.
        done,
        inReport: allRows.filter((r) => r.included).length,
        remaining: Math.max(0, target - done),
        over: Math.max(0, done - target),
        rows: allRows.filter((r) => r.included),
      }
    })

    /* Anything whose NGO is not in the loaded list (deleted NGO, or a row the
       workspace query did not return) still belongs in the file, collected into
       one trailing block instead of silently vanishing. */
    const claimed = new Set(blocks.map((b) => b.key))
    const orphans = rows.filter((r) => !claimed.has(String(r.ngoId)))
    if (orphans.length) {
      blocks.push({
        key: 'other',
        label: 'Other',
        name: 'Programmes whose NGO is not in the list',
        target: orphans.length,
        done: orphans.length,
        inReport: orphans.filter((r) => r.included).length,
        remaining: 0,
        over: 0,
        rows: orphans.filter((r) => r.included),
      })
    }

    const activitiesInScope = activities.filter(inScope)

    return {
      blocks,
      pending,
      selectedActivities,
      suggestionsLeftOut,
      /* Stated up front so the file can open by saying what it is, rather than the
         reader having to work it out from an empty table. */
      nothingSelected: selectedActivities.length === 0,
      activitiesInScope: activitiesInScope.length,
      totals: {
        target: blocks.reduce((s, b) => s + b.target, 0),
        done: blocks.reduce((s, b) => s + b.done, 0),
        remaining: blocks.reduce((s, b) => s + b.remaining, 0),
        over: blocks.reduce((s, b) => s + b.over, 0),
        inReport: blocks.reduce((s, b) => s + b.inReport, 0),
      },
    }
  }, [monthEvents, activities, ngos, ngo, suggestionIndex, scopedSuggestions, tickedActivityIds])

  const reportRows = report.blocks.flatMap((b) => b.rows)
  const unlinkedSuggestions = report.pending

  const reportMeta = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const label = `${MONTHS[m - 1]} ${y}`
    const code = String(ngo?.code || ngo?.id || 'all-ngos').replace(/[^A-Za-z0-9_-]/g, '')
    return {
      label,
      code,
      base: `monthly-planner-${code}-${MONTHS[m - 1]}-${y}`,
      ngoName: ngo?.name || 'All NGOs',
    }
  }, [month, ngo])

  /* The three planning NGOs, always in the same order, for the monthly PDF:
     one page each regardless of the NGO picked on screen — the file is the
     month's report for the whole team, not just the current filter. Any
     workspace NGO without a quota entry is not a planning NGO and is left out. */
  const reportNgos = useMemo(() => ngos
    .filter((n) => !!NGO_MONTHLY_TARGET[ngoCodeKey(n)])
    .sort((a, b) => targetOrderFor(a) - targetOrderFor(b) || ngoShortLabel(a).localeCompare(ngoShortLabel(b))),
    [ngos])

  /* The off-screen preview the PDF captures, and the row cache both downloads
     render from. Set together by prepareFestivalExport so the Excel file, the
     PDF and the counter describe the same selection. */
  const [festivalRows, setFestivalRows] = useState([])
  const [festivalRowsNgo, setFestivalRowsNgo] = useState('')
  const [festivalRowsLabel, setFestivalRowsLabel] = useState('')
  const [festivalRowsStamp, setFestivalRowsStamp] = useState('')

  /* The download mirrors what the grid shows: the selections made THIS
     session. Nothing from a previous session is restored after a reload —
     stored server ticks are ignored here too, so the file can never revive a
     choice the page started fresh without. A typed programme replaces its
     festival's selected AI idea in the file, so every festival contributes at
     most ONE row. Rows are sorted by date then festival and passed through the
     shared mergeProgrammeRows normaliser. The export row shape is unchanged. */
  const buildFestivalExportRows = useCallback(() => {
    const sel = festivalSuggestions.filter((s) => s.is_selected)
    const ngoById = new Map(ngos.map((n) => [String(n.id), n]))
    const manualText = (k) => {
      const e = scopedManual[k]
      const t = String(e?.text || '').trim()
      return e?.selected ? t : ''
    }
    const rows = sel
      .filter((s) => !manualText(festivalKeyOf(s)))
      .map((s) => {
        const n = ngoById.get(String(s.ngo_id))
        const observed = String(s.observance_date || '')
        return {
          date: observed,
          dateLabel: shortDate(observed),
          weekday: observed ? new Date(`${observed}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : '—',
          festival: s.festival || '—',
          ngoLabel: ngoShortLabel(n),
          beneficiary: s.beneficiary || '—',
          location: s.location || '—',
          programme: s.title || '—',
          status: s.suggested_event_id ? 'Scheduled' : 'Draft',
        }
      })
    /* The typed programmes: same row shape, Status always Draft, NGO/beneficiary
       read from the same row the grid shows so the file matches the screen. */
    for (const k of Object.keys(scopedManual)) {
      const e = scopedManual[k]
      const text = manualText(k)
      if (!text) continue
      const d = k.slice(0, 10)
      /* The "No important day" rows are keyed "date::" (no festival), so the
         Festival column reads the user's typed event name — or the row's own
         "No important day" label when they never named it. */
      const festival = (k.includes('::') ? k.slice(k.indexOf('::') + 2) : '')
        || e?.name || 'No important day'
      rows.push({
        date: d,
        dateLabel: shortDate(d),
        weekday: d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : '—',
        festival: festival || '—',
        ngoLabel: rowNgo(k) ? ngoShortLabel(rowNgo(k)) : '—',
        beneficiary: rowSuggestionsFor(k).map((s) => s.beneficiary).find(Boolean) || festBenef[k] || '—',
        location: rowSuggestionsFor(k).map((s) => s.location).find(Boolean) || festLoc[k] || '—',
        programme: text,
        status: 'Draft',
      })
    }
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      return String(a.festival || '').localeCompare(String(b.festival || ''))
    })
    /* Rule 8: final validation/deduplication before Excel/PDF generation.
       mergeProgrammeRows collapses several programmes of the SAME festival onto
       its ONE row; distinct festivals sharing a date stay separate rows and
       each of them repeats the date and weekday — two festivals on one date
       print that date twice in the file, exactly as the grid shows it. */
    const merged = mergeProgrammeRows(rows, ['date', 'festival', 'ngoLabel', 'beneficiary', 'location'])
      .map((r) => ({ ...r, title: r.programme }))
    return merged
  }, [festivalSuggestions, ngos, scopedManual, festivalSuggestionsByKey, festBenef, festLoc, ngo, rowNgo, rowSuggestionsFor])

  /* ── Monthly PDF: one branded page per NGO ──────────────────────────────────
     The PDF is a report for the whole team, so unlike the on-screen grid it is
     NOT limited to the picked NGO. It reads every NGO's SELECTED programmes for
     the month straight from the server (selected_only), which is where a tick
     is persisted the moment it is made — so a page carries BSCT's, MANN's and
     AFLF's programmes even while the screen shows one of them. A typed manual
     programme (session-only, tied to the NGO in scope) replaces that festival's
     selected AI idea on its NGO's page, exactly as the grid shows it. */
  const [reportPages, setReportPages] = useState([])
  const [reportStamp, setReportStamp] = useState('')
  const ngoPageRefs = useRef({})

  const buildNgoReportPages = useCallback(async () => {
    const [y, m] = month.split('-').map(Number)
    let stored = []
    try {
      const res = await getFestivalSuggestions({ month: m, year: y, selected_only: true })
      stored = (Array.isArray(res) ? res : []).filter((s) => s.is_selected)
    } catch { stored = [] }

    const ngoById = new Map(ngos.map((n) => [String(n.id), n]))
    // Pre-fetch banner images as blob URLs via the authenticated proxy so
    // html2canvas can render them (raw S3 URLs fail CORS in the capture).
    const bannerByEvent = new Map()
    await Promise.all(monthEvents.map(async (ev) => {
      const id = String(ev?.id)
      const raw = ev?.extendedProps?.banner || null
      if (!raw) { bannerByEvent.set(id, null); return }
      try {
        const blobUrl = await fetchEventBannerObjectUrl(ev.id)
        bannerByEvent.set(id, blobUrl)
      } catch {
        bannerByEvent.set(id, raw)
      }
    }))
    const manualText = (k) => {
      const e = scopedManual[k]
      return e?.selected ? String(e?.text || '').trim() : ''
    }

    const rows = []
    for (const s of stored) {
      const key = festivalKeyOf(s)
      // A typed programme for the row's own NGO wins over that festival's AI idea.
      if (manualText(key) && String(s.ngo_id) === rowNgoId(key)) continue
      const observed = String(s.observance_date || '').slice(0, 10)
      const evId = Number(s.suggested_event_id)
      rows.push({
        ngoId: s.ngo_id,
        ngoLabel: ngoShortLabel(ngoById.get(String(s.ngo_id))),
        date: observed,
        dateLabel: shortDate(observed),
        weekday: observed ? new Date(`${observed}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : '—',
        festival: s.festival || '—',
        beneficiary: s.beneficiary || '—',
        location: s.location || '—',
        programme: s.title || '—',
        status: s.suggested_event_id ? 'Scheduled' : 'Draft',
        image: Number.isFinite(evId) ? (bannerByEvent.get(String(evId)) || null) : null,
      })
    }
    // Pull manual rows for every planning NGO so the PDF is not limited to the
    // NGO currently selected on screen (the previous code only read the current
    // tab's rows).
    const manualRowsAll = []
    for (const n of reportNgos) {
      try {
        const res = await getPlannerManualRows({ month: m, year: y, ngo_id: n.id })
        const list = Array.isArray(res) ? res : (res?.rows || [])
        for (const r of list) manualRowsAll.push({ ngo: n, row: r })
      } catch { /* skip */ }
    }
    for (const { ngo: n, row: r } of manualRowsAll) {
      const festivalKey = String(r?.festival || '')
      const festival = festivalKey && !festivalKey.startsWith('+')
        ? festivalKey
        : (String(r?.name || '').trim() || 'No important day')
      const programme = String(r?.body_text || r?.name || '').trim()
      if (!programme) continue
      const d = String(r?.observance_date || '').slice(0, 10)
      rows.push({
        ngoId: r?.row_ngo_id || r?.ngo_id || n.id,
        ngoLabel: ngoShortLabel(n),
        date: d,
        dateLabel: shortDate(d),
        weekday: d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : '—',
        festival,
        beneficiary: String(r?.beneficiary || '—'),
        location: String(r?.location || '—'),
        programme,
        status: 'Draft',
        image: null,
      })
    }

    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      return String(a.festival || '').localeCompare(String(b.festival || ''))
    })
    // Deduplicate within each NGO: several programmes of one festival collapse
    // onto that festival's single row; ngoId is part of the key so pages never
    // borrow another NGO's programmes.
    const merged = mergeProgrammeRows(rows, ['ngoId', 'date', 'festival', 'beneficiary', 'location'])

    return reportNgos.map((n) => {
      const ngoRows = merged.filter((r) => String(r.ngoId) === String(n.id))
      return {
        ngo: n,
        brand: ngoBrandFor(n),
        target: monthlyTargetFor(n),
        count: ngoRows.length,
        rows: ngoRows,
      }
    })
  }, [month, ngos, ngo, scopedManual, monthEvents, festivalSuggestionsByKey, festBenef, festLoc, reportNgos, rowNgo, rowNgoId, rowSuggestionsFor, importantDays])


  /* Loads the cut-down rows once, mirrors them into state (which the off-screen
     preview renders and the PDF captures), and waits two frames so the freshly
     committed DOM is what html2canvas sees. Returns the rows for Excel. */
  const prepareFestivalExport = async () => {
    const rows = await buildFestivalExportRows()
    setFestivalRows(rows)
    setFestivalRowsNgo(reportMeta.ngoName)
    setFestivalRowsLabel(reportMeta.label)
    setFestivalRowsStamp(new Date().toLocaleString('en-IN'))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return rows
  }

  const downloadExcel = async () => {
    if (!reportMeta.base) return
    setDownloading('excel')
    try {
      const XLSX = await import('xlsx-js-style')
      const headers = FESTIVAL_REPORT_HEADERS
      const thin = { style: 'thin', color: { rgb: 'D5D9E4' } }
      const headerStyle = {
        font: { bold: true, sz: 11, color: { rgb: '1F2430' } },
        fill: { fgColor: { rgb: 'E8ECF6' } },
        border: { top: thin, bottom: thin, left: thin, right: thin },
        alignment: { vertical: 'center', wrapText: true },
      }
      const bodyStyle = { font: { sz: 11, color: { rgb: '1F2430' } }, alignment: { vertical: 'top', wrapText: true } }

      /* One row per selected programme, freshly read, sorted by date then
         festival — the file and the "N programmes selected" counter can never
         disagree because both are counts over the same selected set. */
      const rows = await prepareFestivalExport()

      const aoa = [
        ['Monthly Planner — Festival Programmes'],
        ['NGO', festivalRowsNgo],
        ['Month', festivalRowsLabel],
        ['Generated', festivalRowsStamp],
        ['Selected programmes', `${rows.length}`],
        [],
        headers,
      ]
      for (const r of rows) {
        aoa.push([r.dateLabel, r.weekday, r.festival, r.ngoLabel, r.beneficiary, r.title, r.location, r.status])
      }
      if (!rows.length) {
        aoa.push([`No programmes selected. Choose an AI suggestion or tick your own Write Manually programme in the Activities grid, then download again — only the selected programme of each festival is listed.`])
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa)

      const titleCell = ws['A1']
      if (titleCell) titleCell.s = { font: { bold: true, sz: 14, color: { rgb: '1F2430' } } }
      // Header row sits at 6 (0-based), directly under the metadata block.
      for (let c = 0; c < headers.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 6, c })
        if (ws[addr]) ws[addr].s = headerStyle
      }
      for (let r = 7; r < aoa.length; r++) {
        for (let c = 0; c < headers.length; c++) {
          const addr = XLSX.utils.encode_cell({ r, c })
          if (ws[addr]) ws[addr].s = bodyStyle
        }
      }

      ws['!cols'] = [{ wch: 11 }, { wch: 9 }, { wch: 26 }, { wch: 9 }, { wch: 20 }, { wch: 60 }, { wch: 24 }, { wch: 10 }]
      ws['!rows'] = []
      ws['!rows'][0] = { hpt: 22 }
      for (let r = 7; r < aoa.length; r++) ws['!rows'][r] = { hpt: 64 }

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Festival Programmes')
      XLSX.writeFile(wb, `${reportMeta.base}.xlsx`)
    } catch (e) {
      console.error('downloadExcel error:', e)
      setToast('Could not build the Excel report.')
    } finally {
      setDownloading('')
    }
  }

  /* Mirrors the three NGO pages into state (which the off-screen preview below
     renders and the PDF captures), and waits two frames so the freshly committed
     DOM is what html2canvas sees. */
  const prepareNgoReportPages = async () => {
    const pages = await buildNgoReportPages()
    setReportPages(pages)
    setReportStamp(new Date().toLocaleString('en-IN'))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return pages
  }

  /* The PDF is one A4 LANDSCAPE page per NGO (BSCT, MANN, AFLF), each captured
     from its own off-screen card so a page break only ever falls between NGOs.
     A card taller than one page is sliced across as few pages as possible. */
  const downloadPdf = async () => {
    setDownloading('pdf')
    try {
      const allPages = await prepareNgoReportPages()
      const pages = ngoId
        ? allPages.filter((p) => String(p.ngo?.id) === String(ngoId))
        : allPages
      if (!pages.some((p) => p.rows.length)) {
        setToast('Nothing to export — select a suggestion or write a programme first.')
        setDownloading('')
        return
      }
      const { default: html2canvas } = await import('html2canvas')
      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF('l', 'mm', 'a4')
      const pageW = 297, pageH = 210, margin = 8
      const contentW = pageW - margin * 2
      const contentH = pageH - margin * 2

      let firstPage = true
      for (const p of pages) {
        const el = ngoPageRefs.current[String(p.ngo.id)]
        if (!el) continue
        // Wait for logos/banners and webfonts, or the capture misses them.
        await Promise.all(
          [...el.querySelectorAll('img')].map((img) =>
            img.complete ? null : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve })
          )
        )
        await (document.fonts && document.fonts.ready)
        const canvas = await html2canvas(el, { scale: 3, useCORS: true, backgroundColor: '#ffffff', logging: false, imageTimeout: 15000 })
        const imgData = canvas.toDataURL('image/png')
        const pxPerMm = canvas.width / contentW
        const pageHeightPx = contentH * pxPerMm
        const cardHeightMm = canvas.height / pxPerMm

        if (!firstPage) pdf.addPage()
        firstPage = false

        if (cardHeightMm <= contentH) {
          // Centre the page on the landscape sheet.
          const y = margin + (contentH - cardHeightMm) / 2
          pdf.addImage(imgData, 'PNG', margin, y, contentW, 0)
        } else {
          let heightLeft = canvas.height
          let position = margin
          pdf.addImage(imgData, 'PNG', margin, position, contentW, 0)
          heightLeft -= pageHeightPx
          while (heightLeft > 0) {
            position -= contentH
            pdf.addPage()
            pdf.addImage(imgData, 'PNG', margin, position, contentW, 0)
            heightLeft -= pageHeightPx
          }
        }
      }
      pdf.save(`${reportMeta.base}.pdf`)
    } catch (e) {
      console.error('downloadPdf error:', e)
      setToast('Could not build the PDF report.')
    } finally {
      setDownloading('')
    }
  }

  /* The modal reports what it managed to save: an activity on its own, an
     activity plus its first programme, or an activity whose programme failed. */
  const onActivityAdded = ({ activity, programme, programmeError, date } = {}) => {
    setAddOpen(false)
    loadActivities()
    if (programme) {
      // A new event changes this month's counts and the report, so reload both.
      loadMonthEvents()
      loadNgoStats()
      showToast(`Activity “${activity?.name}” added and its programme scheduled on ${shortDate(date)} — it is on the calendar for ${monthLabel(month)}.`)
    } else {
      showToast(programmeError
        ? `Activity “${activity?.name}” ${programmeError}`
        : `Activity “${activity?.name}” added.`)
    }
    /* Straight into suggestions, which is the point of adding one from here —
       whether or not a first programme date was given. Opening the panel used to
       be skipped whenever a date was picked, so the most complete path through
       the form was the one that ended with no suggestions. */
    /* Remember the day the new programme landed on, so "View in Calendar" can
       jump straight to it instead of opening on whatever month it feels like.
       Taken from the form's own date rather than the response, which need not
       carry it, and dropped unless it belongs to the month on screen: the link
       always pairs one month with one date, and a date from another month would
       silently override the month. */
    const landed = String(date || programme?.date || '').slice(0, 10)
    setLastScheduled(landed.startsWith(`${month}-`) ? landed : '')
    // The NGO the activity was actually filed under. The modal's tab row owns
    // NGO selection now, so this follows the saved record rather than the page's
    // page-wide NGO pick (which may be "All NGOs").
    const addedNgo = ngos.find((n) => String(n.id) === String(activity?.ngo_id)) || ngo
    if (addedNgo && activity?.id) {
      setJustAddedId(activity.id)
      setSuggestFor({
        ...activity,
        // The panel reads the activity row, and sector_name is only attached by
        // the activities feed — the create response does not carry it.
        sector_name: activity.sector_name
          || sectors.find((s) => String(s.id) === String(activity.sector_id))?.name
          || null,
      })
    }
    /* The row leads the list only while it is the new one. A later reload (a
       sector change, a search) drops it back into alphabetical order. */
    if (activity?.id) setTimeout(() => setJustAddedId((cur) => (String(cur) === String(activity.id) ? null : cur)), 12000)
  }

  /* The tick that decides what the download contains. Applied to the page first so
   the report and the preview move with the click, then saved; if the save fails
   the row goes back to what the server actually holds, because a tick that looks
   done but was not stored is worse than no tick. */
  const setActivityInReport = async (list, next) => {
    const targets = Array.isArray(list) ? list : [list]
    const ids = new Set(targets.map((a) => String(a?.id)).filter(Boolean))
    if (!ids.size) return
    const before = activities.filter((a) => ids.has(String(a.id)))
    setActivities((cur) => cur.map((a) => (ids.has(String(a.id)) ? { ...a, in_report: next } : a)))
    setTickBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((a) => updateActivity(a.id, { in_report: next }))
      )
      const failed = results.filter((r) => r.status === 'rejected')
      // The server's own answer wins for every row that came back, so a row the
      // database refused cannot drift from what the next reload will show.
      const saved = results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value)
      if (saved.length) {
        const byId = new Map(saved.map((a) => [String(a.id), a]))
        setActivities((cur) => cur.map((a) => (byId.has(String(a.id)) ? { ...a, ...byId.get(String(a.id)) } : a)))
      }
      if (failed.length) {
        setActivities((cur) => cur.map((a) => (ids.has(String(a.id))
          ? { ...a, in_report: before.find((b) => String(b.id) === String(a.id))?.in_report === true }
          : a)))
        showToast(failed[0].reason?.message || 'Could not save the download selection.')
      } else {
        const what = next ? 'Included in the download' : 'Removed from the download'
        showToast(targets.length === 1 ? `${before[0]?.name || 'Activity'}: ${what.toLowerCase()}.` : `${targets.length} activities: ${what.toLowerCase()}.`)
      }
    } catch (e) {
      setActivities((cur) => cur.map((a) => (ids.has(String(a.id))
        ? { ...a, in_report: before.find((b) => String(b.id) === String(a.id))?.in_report === true }
        : a)))
      showToast(e?.message || 'Could not save the download selection.')
    } finally {
      setTickBusy(false)
    }
  }

  /* `suggestion` is set when the programme came from an AI idea rather than from
     the row's own "Add programme" button. */
  const afterPlanned = ({ suggestion, programmes = [], failed = [], lastDate } = {}) => {
    setPlanEntry(null)
    loadMonthEvents()
    loadNgoStats()
    setSuggestRev((v) => v + 1)
    // The report reads the page's own selected list, so it has to be re-read
    // after any change to what is ticked or linked.
    loadSelectedSuggestions()
    // Remember where the new programmes landed, so "View in Calendar" opens on
    // that day instead of wherever the calendar was left.
    const landed = String(lastDate || '').slice(0, 10)
    if (landed.startsWith(`${month}-`)) setLastScheduled(landed)

    const n = programmes.length
    const parts = []
    if (n > 0) parts.push(n === 1 ? '1 programme added' : `${n} programmes added`)
    if (suggestion) parts.push('kept in the report')
    if (failed.length) parts.push(`${failed.length} could not be saved`)
    if (parts.length) showToast(`${parts.join(' · ')}.`)
  }

  const monthName = monthLabel(month).split(' ')[0]

  /* Deletes the activity and reloads everything its absence changes: the
     activity list, this month's events (they lose the link), the counts and the
     ticked suggestions. `planned` is only what is on screen for this month —
     the server may unlink events in other months too, which is why the
     confirmation says "programmes" and not "programmes this month". */
  const confirmDelete = async () => {
    if (!deleteTarget?.activity?.id) return
    setDeleteBusy(true); setDeleteError('')
    const name = deleteTarget.activity.name
    try {
      await deleteActivity(deleteTarget.activity.id)
      setDeleteTarget(null)
      if (String(suggestFor?.id) === String(deleteTarget.activity.id)) setSuggestFor(null)
      setJustAddedId((cur) => (String(cur) === String(deleteTarget.activity.id) ? null : cur))
      loadActivities()
      loadMonthEvents()
      loadNgoStats()
      loadSelectedSuggestions()
      showToast(`Activity “${name}” deleted.`)
    } catch (e) {
      setDeleteError(e?.message || 'Could not delete the activity.')
    } finally {
      setDeleteBusy(false)
    }
  }

  /* The "Team member" cell — only in the Social panel's planner
     (`taskAssignment`). Rendered once per programme block with one dropdown per
     content-team deliverable (Banner, YouTube Video, Instagram Reels, Instagram
     Photos, Captions & Heading), so WHO does WHAT for the programme is set right
     on the row. Each dropdown defaults to the person who normally handles that
     deliverable and saves to the server on change. */
  // const taskCell = (date, label, rowSpan) => {
  //   if (!taskAssignment) return null
  //   return (
  //     <td key="tm" className="divider" rowSpan={rowSpan} style={{ verticalAlign: 'top', paddingTop: 8 }}>
  //       <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
  //         {CONTENT_TYPES.map((ct) => {
  //           const row = taskMap[`${date}::${label}::${ct.value}`]
  //           const value = row ? String(row.assignee_id) : ''
  //           return (
  //             <div key={ct.value} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
  //               <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--eh-ink-soft)', letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>{ct.label}</div>
  //               <select
  //                 className="eh-select"
  //                 value={value}
  //                 disabled={festBusy || (!team.length && !row)}
  //                 title={row ? `${ct.label} · ${row.assignee_name}` : (team.length ? `Who handles ${ct.label} for this programme` : 'No team members available to assign')}
  //                 onChange={(e) => assignRow(date, label, ct.value, e.target.value)}
  //                 style={{ flex: 1, minWidth: 0, padding: '3px 6px', fontSize: 11, borderRadius: 6, boxSizing: 'border-box' }}
  //               >
  //                 <option value="">Unassigned</option>
  //                 {team.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
  //               </select>
  //             </div>
  //           )
  //         })}
  //       </div>
  //     </td>
  //   )
  // }
  /* The programme name a row will create/scheduled its event under: the selected
     AI suggestion, else a linked suggestion, else the typed programme, else the
     festival name. Shared by the create modal and the "already scheduled?" check
     so both always agree on the event's name. */
  const programmeNameForKey = (key, label) => {
    const sugg = key ? rowSuggestionsFor(key) : []
    const named = sugg.find((s) => s.is_selected) || sugg.find((s) => Number(s.suggested_event_id) > 0) || null
    const manual = scopedManual[key]
    const typed = String(manual?.text || '').trim().split('\n')[0]
    return String(named?.title || typed || (manual?.name || '').trim() || label || 'Programme').trim()
  }

  /* The date a row's event is created on — the selected suggestion's own date
     when it has one, else the programme's day. Shared so the "already
     scheduled?" match lines up with what was actually stored. */
  const programmeDateForKey = (key, date) => {
    const sugg = key ? rowSuggestionsFor(key).find((s) => s.is_selected) : null
    return String(sugg?.observance_date || date || (key || '').slice(0, 10)).slice(0, 10)
  }

  /* A programme row must produce at most ONE event. Events created before the
     durable link existed carry no planner link, so they are recognised by
     matching the programme's name + date + NGO against the month's events.
     The richest match (most photos) wins. This is what lets the row show
     "Download" instead of "Create Event" and blocks a duplicate. */
  const findExistingPlannedEvent = (key, date, label) => {
    if (!key) return null
    const name = String(programmeNameForKey(key, label) || '').trim().toLowerCase()
    if (!name) return null
    const d = programmeDateForKey(key, date)
    const ngo = String(rowNgoId(key) || '')
    const found = monthEvents.filter((ev) => {
      const p = ev?.extendedProps || {}
      const evName = String(ev?.title || '').split(' · ')[0].trim().toLowerCase()
      const evDate = String(p.date || '').slice(0, 10)
      const evNgo = String(p.ngoId || '')
      if (evName !== name || evDate !== d) return false
      if (ngo) {
        // Never credit another NGO's event to this row. An event that carries
        // no NGO of its own only counts when the month's feed was already
        // fetched for this page's NGO — the server then vouches for it. On
        // "All NGOs" an unscoped event is not evidence for any one row.
        if (evNgo) return evNgo === ngo
        return Boolean(ngoId)
      }
      return true
    })
    if (!found.length) return null
    return found.sort((a, b) => ((b?.extendedProps?.images?.length || 0) - (a?.extendedProps?.images?.length || 0)))[0]
  }

  /* The event a planner row already produced. Found through the durable row link
     recorded when the event was created (survives a refresh and other devices),
     falling back to the older suggestion-level link (suggested_event_id), and
     then to a name + date + NGO match for events that predate the link feature.
     The row offers the download only once its event was genuinely created through
     the planner — never because some unrelated event happens to share a date,
     name or NGO. */
  const findScheduledEvent = (key, date, label) => {
    const link = findDurableLink(key)
    const linkedId = link
      ? link.event_id
      : (key ? rowSuggestionsFor(key).find((s) => Number(s.suggested_event_id) > 0)?.suggested_event_id : null)
    if (linkedId) return monthEvents.find((ev) => String(ev?.id) === String(linkedId)) || null
    return findExistingPlannedEvent(key, date, label)
  }

  // Resolve the durable row → event link for a programme row. The link is
  // ngo-scoped in storage, but a row can still find a link that was saved
  // under a different NGO (e.g. the event was created from the Monthly Report
  // with the event's own NGO): fall back to a date + festival match across
  // all stored links, ignoring the NGO, so the Download button still appears.
  const findDurableLink = (key) => {
    if (!key) return null
    const exact = plannerLinkMap[linkMapKey(key, rowNgoId(key))]
    if (exact) return exact
    const sep = key.indexOf('::')
    const date = (sep >= 0 ? key.slice(0, sep) : key).slice(0, 10)
    const festival = (sep >= 0 ? key.slice(sep + 2) : '').trim().toLowerCase()
    if (!date || !festival) return null
    for (const l of Object.values(plannerLinkMap || {})) {
      const ld = String(l?.observance_date || '').slice(0, 10)
      const lf = String(l?.festival || '').trim().toLowerCase()
      if (ld === date && lf === festival) return l
    }
    return null
  }

  // Only a DURABLE planner link (row → event, created via the Daily Report
  // "Create Event" flow or loaded from the server) counts as "already
  // scheduled" for the Download button. A suggestion-level suggested_event_id
  // is deliberately NOT enough: ideas can gain one through other flows (e.g.
  // Plan Programme) without the row ever owning a downloadable event sheet,
  // which surfaced Download buttons before the head created the event. The
  // name+date+NGO fallback is also excluded here.
  const findLinkedScheduledEvent = (key, date, label) => {
    if (!key) return null
    const link = findDurableLink(key)
    const linkedId = link ? link.event_id : null
    if (!linkedId) return null
    return monthEvents.find((ev) => String(ev?.id) === String(linkedId)) || null
  }
  const deleteScheduledProgramme = async (key, date, label) => {
    const ev = findScheduledEvent(key, date, label)
    if (!ev?.id) { showToast('No saved event to delete.'); return }
    if (!window.confirm(`Delete event "${ev.title || label}"? This cannot be undone.`)) return
    try {
      await deleteEvent(ev.id)
       setMonthEvents((prev) => prev.filter((e) => String(e?.id) !== String(ev.id)))
       const lk = linkMapKey(key, rowNgoId(key))
       setCreatedKeys((cur) => { const next = new Set(cur); next.delete(lk); return next })
       setRowEventNames((cur) => { const next = { ...cur }; delete next[lk]; return next })
       setPdfCache((cur) => { const next = new Map(cur); next.delete(lk); return next })
       setPlannerLinkMap((cur) => { const next = { ...cur }; delete next[lk]; return next })
       // Remove the durable row → event link on the server too, otherwise the
       // Monthly Report keeps showing this event as an "extra" card.
       const delObs = String(key || '').slice(0, (key || '').indexOf('::') >= 0 ? (key || '').indexOf('::') : (key || '').length).slice(0, 10)
       const delFest = (key || '').includes('::') ? String(key).slice(String(key).indexOf('::') + 2) : ''
       deletePlannerEventLink({ observance_date: delObs || String(ev?.extendedProps?.date || '').slice(0, 10), festival: delFest, ngo_id: rowNgoId(key) || ev?.extendedProps?.ngoId || ev?.extendedProps?.ngo_id }).catch(() => {})
       // Drop the programme from the Monthly Report too: unselect any suggestion
       // that pointed at this event so the report no longer lists it.
       const linkedSuggs = (key ? rowSuggestionsFor(key) : []).filter((s) =>
         Number(s?.suggested_event_id) === Number(ev.id) || Boolean(s?.is_selected)
       )
       linkedSuggs.forEach((s) => { if (s?.id) setFestivalSuggestionSelected(Number(s.id), false).catch(() => {}) })
      showToast('Event deleted.')
    } catch (e) {
      showToast(e?.message || 'Could not delete event.')
    }
  }

  /* Is this row one of the month's FESTIVAL rows (its Festival / Day cell shows
     a festival) rather than a manual row (the cell holds an editable event
     name)? The two are told apart by the festival list of that date. */
  const isFestivalRow = (key) => {
    if (!key) return false
    const sep = key.indexOf('::')
    if (sep < 0) return false
    const name = key.slice(sep + 2)
    if (!name) return false
    return (observancesByDate[key.slice(0, sep)] || []).some((o) => String(o?.name) === name)
  }

  /* The name of the event a planner row produced. The map written the moment the
     event was created or renamed wins — so a name changed in the Create / Edit
     form shows on the row right away — and the month's event feed is the
     fallback for an event made on another device or in an earlier session.
     The calendar feed carries the name inside the title ("name · NGO"), so the
     title is split the same way the rest of the planner does it. */
  const rowEventName = (key, date, label) => {
    if (!key) return ''
    const stored = rowEventNames[linkMapKey(key, rowNgoId(key))]
    if (stored?.name) return stored.name
    const ev = findScheduledEvent(key, date, label)
    return String(ev?.title || '').split(' · ')[0].trim()
  }

  /* The row's Edit button reopens the Create Event form with the linked event's
     own values loaded into it, so the head corrects the record in the same place
     it was typed. `editing` is what flips the form's save target from
     createEvent to updateEvent; the event id stays on the entry.
     The photos keep their S3 URLs in `url` (what gets saved back) and gain a
     local `dataUrl` only for the in-form preview / PDF raster, read through the
     server proxy so a cross-origin fetch cannot taint the canvas. */
  const openEditEvent = async (key, date, label) => {
    const ev = findScheduledEvent(key, date, label)
    if (!ev?.id) return
    const p = ev.extendedProps || {}
    const sugg = key ? rowSuggestionsFor(key).find((s) => s.is_selected) || null : null
    const evActs = Array.isArray(p.activities) ? p.activities : []
    const rawImages = Array.isArray(p.images) ? p.images : []
    const images = []
    for (let i = 0; i < rawImages.length; i++) {
      const u = String(rawImages[i] || '')
      if (!u) continue
      let dataUrl = ''
      if (u.startsWith('data:')) dataUrl = u
      else { try { dataUrl = await fetchEventImageDataUrl(ev.id, i, true) } catch { /* preview falls back to the URL */ } }
      images.push({ name: `photo-${i + 1}`, url: u, dataUrl })
    }
    setEditEntry({
      editing: true,
      eventId: ev.id,
      key,
      date: String(p.date || programmeDateForKey(key, date) || '').slice(0, 10),
      name: String(ev.title || '').split(' · ')[0].trim() || programmeNameForKey(key, label),
      ngoId: String(rowNgoId(key) || p.ngoId || ''),
      location: p.venue || festivalLocationFor(key) || '',
      description: p.description || '',
      slogan: p.slogan || '',
      tagline: p.tagline || '',
      beneficiary: sugg?.beneficiary || festBenef[key] || '',
      suggestion: sugg,
      activityId: evActs[0]?.id || '',
      images,
    })
  }

  /* "+ Add another programme": adds a fresh programme ROW under this date, so a
     day can carry more than one programme. Seeded with the row's NGO so the new
     row starts on the same NGO. Session-only, like the other row decisions. */
  const addExtraRow = (date, key) => {
    const suffix = `+${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1296).toString(36)}`
    const extraKey = `${date}::${suffix}`
    const seed = key ? rowNgoId(key) : ''
    setFestExtra((cur) => ({ ...cur, [date]: [...(cur[date] || []), suffix] }))
    if (seed) setFestNgo((cur) => ({ ...cur, [extraKey]: String(seed) }))
    persistManualRow(extraKey, { row_ngo_id: seed || '' })
  }
  const removeExtraRow = (date, key) => {
    setFestExtra((cur) => ({ ...cur, [date]: (cur[date] || []).filter((s) => `${date}::${s}` !== key) }))
    setFestNgo((cur) => { const n = { ...cur }; delete n[key]; return n })
    setFestBenef((cur) => { const n = { ...cur }; delete n[key]; return n })
    setFestLoc((cur) => { const n = { ...cur }; delete n[key]; return n })
    deleteManualRow(key)
  }
  /* A user-added programme row: same columns as every other row, with an
     editable name in the Festival / Day column, an NGO that starts on the row it
     was added from, and a ✕ that removes it. */
  const festExtraRow = (date, key) => {
    const manual = scopedManual[key]
    const manualChecked = Boolean(manual?.selected)
    return (
      <tr key={key} className={`sel-row${manualChecked ? ' sel' : ''}`}>
        <td className="dd divider">{shortDate(date)}</td>
        <td className="ff divider" style={{ whiteSpace: 'normal' }}>
          <input
            className="eh-input"
            value={manual?.name || rowEventName(key, date, '') || ''}
            disabled={festBusy}
            placeholder="Event name (e.g. Community kitchen drive)…"
            title="Name this programme — it is what the downloads call it"
            onChange={(e) => updateFestivalManual(key, { name: e.target.value })}
            onBlur={() => persistManualRow(key)}
            style={{ width: '100%', minWidth: 0, marginTop: 5, padding: '7px 9px', fontSize: 12.5, borderRadius: 9, boxSizing: 'border-box', color: 'var(--eh-ink, #1f2430)' }}
          />
          <button
            className="eh-btn eh-btn-sm"
            style={{ marginTop: 6 }}
            disabled={festBusy}
            title="Remove this programme row"
            onClick={() => removeExtraRow(date, key)}
          >
            ✕ Remove row
          </button>
        </td>
        <td className="ng divider">
          <FestivalNgoSelect
            ngos={ngos}
            value={rowNgoId(key)}
            disabled={festBusy}
            title="Which NGO this programme belongs to"
            onChange={(v) => changeRowNgo(key, v)}
          />
        </td>
        <td className="bn divider">
          <FestivalBeneficiarySelect
            value={festivalBeneficiaryFor(key)}
            disabled={festBusy || festGenerating !== null}
            title="Who this programme is aimed at"
            onChange={(v) => handleFestivalBeneficiary(key, v)}
          />
        </td>
        <td className="ai divider">
          <div className="sug-sec-label">Write manually</div>
          <textarea
            className="fest-manual"
            rows={2}
            value={manual?.text || ''}
            disabled={festBusy}
            placeholder="Type your own programme for this row…"
            title="Your own programme for this row"
            onChange={(e) => updateFestivalManual(key, { text: e.target.value })}
            onBlur={() => persistManualRow(key)}
          />
        </td>
        <td className="lc divider">
          <FestivalLocationSelect
            key={`loc-extra-${key}`}
            value={festivalLocationFor(key)}
            list={ngoLocationList(rowNgo(key))}
            disabled={festBusy || festGenerating !== null}
            title="Where this event happens"
            onChange={(v) => handleFestivalLocation(key, v)}
          />
        </td>
        <td className="sel divider">
          <input
            type="checkbox"
            checked={manualChecked}
            disabled={festBusy}
            title={manualChecked ? 'Included in the download. Untick to leave it out.' : 'Include this programme in the download.'}
            onChange={(e) => {
              updateFestivalManual(key, { selected: e.target.checked })
              persistManualRow(key, { selected: e.target.checked })
            }}
          />
        </td>
        {taskCell(date, (manual?.name || '').trim() || 'Programme', 1, key)}
      </tr>
    )
  }

  /* After the event is created — or edited with the same form — remember the row
     (so Create Event never returns) and cache the sheet it just downloaded,
     refresh the month's tasks and calendar so the change shows, and say so. The
     row → event link is also saved server-side so the Download button survives a
     reload / other device. Re-running it for an edit is safe: the row already
     exists in both maps and the link row is upserted on its own key. */
  const afterEventCreated = ({ key, event, pdf, ngoId, editing, suggestion } = {}) => {
    if (key) {
      // The row's NGO, resolved once: it decides which row owns this record.
      const linkNgo = ngoId || event?.ngo_id || rowNgoId(key) || ''
      const rowKey = linkMapKey(key, linkNgo)
      setCreatedKeys((cur) => { const next = new Set(cur); next.add(rowKey); return next })
      if (pdf) setPdfCache((cur) => new Map(cur).set(rowKey, pdf))
      if (event?.id) {
        const sep = key.indexOf('::')
        const observance_date = (sep >= 0 ? key.slice(0, sep) : key).slice(0, 10)
        const festival = sep >= 0 ? key.slice(sep + 2) : ''
        /* The name the event was SAVED under — a name changed in the Create /
           Edit form is the one the Festival / Day column has to show. It is
           written under the row's own NGO as well, so the row still finds it
           when the event was created for an NGO the row had not stored yet. */
        const savedName = String(event?.name || '').trim()
        if (savedName) {
          setRowEventNames((cur) => {
            const next = { ...cur, [rowKey]: { id: event.id, name: savedName } }
            const ownKey = linkMapKey(key, rowNgoId(key))
            if (ownKey !== rowKey) next[ownKey] = { id: event.id, name: savedName }
            return next
          })
          /* A manual row carries its event name in the Festival / Day cell —
             keep that cell in step with the name the event was saved under. */
          if (!isFestivalRow(key)) {
            updateFestivalManual(key, { name: savedName })
            persistManualRow(key, { name: savedName })
          }
        }
        const link = {
          observance_date,
          festival,
          ngo_id: linkNgo || null,
          event_id: event.id,
        }
         setPlannerLinkMap((cur) => ({ ...cur, [rowKey]: link }))
         if (linkNgo) setFestNgo((cur) => ({ ...cur, [key]: String(linkNgo) }))
         setPlannerEventLink(link).catch(() => {
           // The event exists either way; only the cross-device link is missing.
         })
      }
    }
    if (suggestion?.id && event?.id) {
      setFestivalSuggestions((list) => list.map((s) => String(s.id) === String(suggestion.id) ? { ...s, suggested_event_id: event.id } : s))
    }
    showToast(event?.name ? `Event “${event.name}” ${editing ? 'updated' : 'created'}.` : (editing ? 'Event updated.' : 'Event created.'))
    loadMonthTasks()
    loadMonthEvents()
  }

  /* Re-issue a row's Event Detail Sheet. Uses the sheet built at creation time
     when this tab still has it; otherwise rebuilds it from the stored event (its
     images live on the event), so the download works after a refresh too. */
  const downloadEventSheet = async (key, date, label) => {
    if (sheetBusy === key) return
    setSheetBusy(key)
    try {
      // The row's NGO decides which cached sheet and which link belong to it —
      // two NGOs can share a date + festival, and one must never read the
      // other's sheet or overwrite the other's link.
      const rowKey = linkMapKey(key, rowNgoId(key))
      let args = pdfCache.get(rowKey)
      const ev = findScheduledEvent(key, date, label)
      // Persist the durable row link the first time a pre-existing event (created
      // before the link feature) is recognised for this programme, so the row keeps
      // offering "Download" on every device and can never create a duplicate.
      if (ev?.id && key && !plannerLinkMap[rowKey]) {
        const link = {
          observance_date: programmeDateForKey(key, date),
          festival: key.includes('::') ? key.slice(key.indexOf('::') + 2) : '',
          ngo_id: rowNgoId(key) || ev?.extendedProps?.ngoId || null,
          event_id: ev.id,
        }
        setPlannerLinkMap((cur) => ({ ...cur, [rowKey]: link }))
        setPlannerEventLink(link).catch(() => {})
      }
      if (!args) {
        const p = ev?.extendedProps || {}
        const sugg = key ? rowSuggestionsFor(key) : []
        const linked = sugg.find((s) => s.is_selected) || sugg.find((s) => Number(s.suggested_event_id) > 0) || null
        const ngo = ngos.find((n) => String(n.id) === String(rowNgoId(key) || p.ngoId || p.ngo_id || '')) || null
        const actIds = (Array.isArray(p.activities) ? p.activities : []).map((a) => Number(a.id))
        const activity = activities.find((a) => actIds.includes(Number(a.id))) || null
        // Images are stored on S3 as URLs; the PDF needs bytes, so each is read
        // back through the server proxy (avoids a cross-origin browser fetch).
        // Legacy inline data URLs are used as-is.
        const rawImages = Array.isArray(p.images) ? p.images : []
        const images = []
        for (let i = 0; i < rawImages.length; i++) {
          const u = String(rawImages[i] || '')
          if (!u) continue
          if (u.startsWith('data:')) { images.push(u); continue }
          try { images.push(ev?.id ? await fetchEventImageDataUrl(ev.id, i, true) : u) }
          catch { /* skip an image that will not load */ }
        }
        args = {
          name: String(ev?.title || '').split(' · ')[0].trim() || programmeNameForKey(key, label),
          date: String(p.date || date || '').slice(0, 10),
          ngoLabel: ngo?.name || '',
          activityName: activity?.name || '',
          beneficiary: sugg.map((s) => s.beneficiary).find(Boolean) || festBenef[key] || '',
          venue: p.venue || '',
          description: p.description || '',
          slogan: p.slogan || '',
          tagline: p.tagline || '',
          images,
          brand: ngoBrandFor(ngo),
        }
      }
      if (!args) { showToast('Nothing to download yet.'); return }
      await downloadEventPoster(args)
    } catch (e) {
      console.error('Event sheet download failed', e)
      showToast('Could not download the sheet.')
    } finally {
      setSheetBusy('')
    }
  }

  const taskCell = (date, label, rowSpan, key) => {
  if (!taskAssignment) return null
  // Green only when the Social head accepted that member's report for the day
  // the WORK was done — a member's own "done" never turns the planner green. A
  // programme can be done on a day other than its own, so the completion day is
  // matched too.
  const deliverableDone = (row) => {
    if (!row) return false
    const doneDay = String(row.completed_date || '').slice(0, 10)
    return acceptedDays.has(`${row.assignee_id}::${date}`) ||
      (doneDay && acceptedDays.has(`${row.assignee_id}::${doneDay}`))
  }
  // All five deliverables green means the programme is ready, but the event is
  // created only from the Daily Report. Until an event exists for this row, the
  // cell must not show the Done / Download state.
  const TEST_LABELS = new Set(['demo', 'dem0', 'test', 'werwer'])
  const deliverableRows = CONTENT_TYPES.map((ct) => taskMap[`${date}::${label}::${ct.value}`])
  const allDone = !TEST_LABELS.has(String(label || '').trim().toLowerCase()) &&
    deliverableRows.length === CONTENT_TYPES.length && deliverableRows.every(deliverableDone)
  const alreadyScheduled = Boolean(key && createdKeys.has(linkMapKey(key, rowNgoId(key)))) ||
    Boolean(findLinkedScheduledEvent(key, date, label)) ||
    (allDone && Boolean(findExistingPlannedEvent(key, date, label)))
  return (
    <td key="tm" className="divider" rowSpan={rowSpan} style={{ verticalAlign: 'top', padding: '8px 10px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Once all five are done the green Done rows are dropped — the cell
            carries just the action: create the event, or download its sheet
            again if the file is needed later. */}
        {!alreadyScheduled && !allDone && CONTENT_TYPES.map((ct) => {
          const row = taskMap[`${date}::${label}::${ct.value}`]
          const value = row ? String(row.assignee_id) : ''
          const done = deliverableDone(row)
          // The work is finished but the head has not accepted the report for the
          // completion day yet — say so, otherwise the cell just looks stuck.
          const doneDay = String(row?.completed_date || '').slice(0, 10)
          const awaiting = !done && doneDay ? ` · awaiting approval of ${doneDay}` : ''
          return (
            <label
              key={ct.value}
              title={row ? `${ct.label} · ${row.assignee_name}${done ? ' · Done' : awaiting}` : `Assign ${ct.label}`}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 7,
                padding: '5px 8px', borderRadius: 8, cursor: done ? 'default' : 'pointer',
                border: `1px solid ${done ? 'var(--eh-success, #16a34a)' : awaiting ? '#f2c14e' : row ? 'var(--eh-line-strong, #ddd9f0)' : '#EEF0F7'}`,
                background: done ? 'var(--eh-success-soft, #e7f6ec)' : row ? 'var(--eh-tint-1, #f0eefb)' : '#fff',
              }}
            >
              <span
                style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: done ? 'var(--eh-success, #16a34a)' : awaiting ? '#f59e0b' : row ? 'var(--eh-primary, #6c5ce7)' : '#d5d8e6',
                }}
              />
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: done ? 'var(--eh-success, #16a34a)' : 'var(--eh-ink-soft)', whiteSpace: 'nowrap' }}>
                {ct.label}
              </span>
              <span
                style={{
                  marginLeft: 'auto', fontSize: 12, minWidth: 0, textAlign: 'right',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontWeight: row ? 700 : 400,
                  color: done ? 'var(--eh-success, #16a34a)' : row ? 'var(--eh-ink)' : 'var(--eh-ink-faint)',
                }}
              >
                {done ? '✓ Done' : row ? row.assignee_name : '+ Assign'}
              </span>
              {/* Once the head has accepted the member's report for this day the
                  deliverable is Done, so the dropdown is replaced by the green
                  Done state — there is nothing left to reassign. */}
              {!done && (
                <select
                  value={value}
                  disabled={festBusy || (!team.length && !row)}
                  onChange={(e) => assignRow(date, label, ct.value, e.target.value)}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                >
                  <option value="">Unassigned</option>
                  {team.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                </select>
              )}
            </label>
          )
        })}
        {!alreadyScheduled && allDone && (
          <div
            style={{ marginTop: 6, padding: '8px 10px', borderRadius: 10, background: '#f8fafc', color: 'var(--eh-ink-soft)', fontSize: 11.5, lineHeight: 1.45 }}
            title="Events are created from the Daily Report once all five deliverables are done"
          >
            Event not created yet. Create it from the Daily Report.
          </div>
        )}
        {alreadyScheduled && (
          /* Both actions share one line — stacked full-width buttons pushed the
             Edit below the cell's edge on narrow columns. */
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              className="eh-btn"
              style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', padding: '8px 6px', borderRadius: 10, fontSize: 12.5, background: '#e5e7eb', color: '#374151', border: 'none', cursor: sheetBusy === key ? 'wait' : 'pointer', opacity: sheetBusy === key ? 0.75 : 1 }}
              title="Download this event's detail sheet (photos included)"
              disabled={sheetBusy === key}
              onClick={() => downloadEventSheet(key, date, label)}
            >
              {sheetBusy === key ? '…' : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
            </button>
            <button
              className="eh-btn"
              style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', padding: '8px 6px', borderRadius: 10, fontSize: 12.5, background: '#dbeafe', color: '#1e40af', border: 'none', cursor: editLoadingKey === key ? 'wait' : 'pointer', opacity: editLoadingKey === key ? 0.75 : 1 }}
              title="Edit this event in the same form it was created with"
              disabled={editLoadingKey === key}
              onClick={() => {
                if (editLoadingKey === key) return
                setEditLoadingKey(key)
                openEditEvent(key, date, label).finally(() => setEditLoadingKey(''))
              }}
            >
              {editLoadingKey === key ? '…' : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}
            </button>
            <button
              className="eh-btn"
              style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'center', padding: '8px 6px', borderRadius: 10, fontSize: 12.5, background: '#fee2e2', color: '#991b1b', border: 'none', cursor: 'pointer' }}
              title="Delete this event"
              onClick={() => deleteScheduledProgramme(key, date, label)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        )}
      </div>
    </td>
  )
}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{SCROLLBAR_CSS}</style>
      <PageHeader
        title="Monthly Planner"
        subtitle={`Plan activities NGO-wise, month-wise · ${monthLabel(month)}`}
         actions={
          <>
            {taskAssignment && (
              <button
                className="eh-btn"
                onClick={() => setAssignOpen(true)}
                title="Assign a task to a Social team member — it shows on their Daily Report"
                style={{ marginRight: 8 }}
              >
                Assign Task
              </button>
            )}
            <button
              className="eh-btn"
              onClick={downloadExcel}
              disabled={downloading === 'excel'}
              title={`Selected festival programmes for ${reportMeta.ngoName}, ${monthLabel(month)} — as Excel`}
            >
              {downloading === 'excel' ? 'Building…' : 'Download Excel'}
            </button>
            <button
              className="eh-btn"
              onClick={downloadPdf}
              disabled={downloading === 'pdf'}
              title={`Selected festival programmes for ${reportMeta.ngoName}, ${monthLabel(month)} — as PDF`}
            >
              {downloading === 'pdf' ? 'Building…' : 'Download PDF'}
            </button>
          </>
        }
      />

      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-pad" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          {/* NGO tabs: the planner's own NGOs only (BSCT / MANN / AFLF), not
              every row the workspace returns — "other" NGOs rendered as stray
              tabs beside them. One tab per NGO, none for "All NGOs" — the tabs
              ARE the scope. BSCT is the one that comes selected, resolved from
              the NGO list as it loads (defaultNgoId), so the page opens on the
              tab the team works in rather than on an empty pick. */}
          {plannerTabNgos.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%' }}>
              {plannerTabNgos.map((n) => {
                const on = String(n.id) === String(ngoId)
                return (
                  <button
                    key={n.id}
                    type="button"
                    className="eh-btn eh-btn-sm"
                    aria-pressed={on}
                    onClick={() => { setNgoId(String(n.id)); setSectorFilter(''); setBeneficiaryFilter(''); setSearch('') }}
                    style={on ? { background: 'var(--eh-primary)', borderColor: 'var(--eh-primary)', color: '#fff', fontWeight: 700 } : undefined}
                  >
                    {ngoShortLabel(n)}
                  </button>
                )
              })}
            </div>
          )}

          <Field label="Month">
            <div style={{ display: 'flex', gap: 8 }}>
              <Select value={Number(month.split('-')[1]) - 1} onChange={(v) => setMonthPart('month', v)} style={{ minWidth: 120 }}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </Select>
              <Select value={year} onChange={(v) => setMonthPart('year', v)} style={{ minWidth: 90 }}>
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </div>
          </Field>

          <SearchInput value={search} onChange={setSearch} placeholder="Search activities…" style={{ flex: '1 1 180px', minWidth: 160 }} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
      </div>

      {toast && (
        <div style={{ padding: '11px 16px', borderRadius: 12, background: 'var(--eh-success-soft)', color: 'var(--eh-success)', fontSize: 13, fontWeight: 600 }}>{toast}</div>
      )}

      {/* How each NGO is tracking against its monthly quota. One card per NGO,
          always all of them: an NGO with nothing planned this month must still
          show a readable "0 of 15" instead of disappearing, because "no card"
          reads as "nothing to do" rather than "not started".
          The Activities card stays beside it — activities are what can be
          planned, the quota is what has been planned, and the two answer
          different questions. */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div
          className="card-pad"
          style={{ padding: '13px 15px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={LABEL}>Monthly target</span>
            <span style={{ fontSize: 12, color: 'var(--eh-ink-faint)' }}>{monthLabel(month)}</span>
          </div>
          {/* Totals summed from the cards below, so the headline can never
              disagree with the rows it summarises. Names the same scope the
              cards are showing: the picked NGO, or all three. */}
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--eh-ink-soft)' }}>
            {loadingEvents
              ? 'Loading counts…'
              : `${ngo ? ngoShortLabel(ngo) : 'All NGOs'} — ${targetTotals.planned} of ${targetTotals.target} done · ${Math.max(0, targetTotals.target - targetTotals.planned)} remaining`}
          </span>
        </div>

        <div className="card-pad" style={{ paddingTop: 0, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {/* Activities are what can be planned; the quota cards below are what
              has been planned. No NGO label here: the quota card beside it and
              the Activities section header already name the NGO in scope, and
              repeating it three times on one screen is what made this hard to
              read. */}
          <div
            className="card"
            style={{ marginBottom: 0, flex: '1 1 150px', minWidth: 150 }}
            title="activities that can be planned this month"
          >
            <div className="card-pad" style={{ padding: '13px 15px' }}>
              <div style={LABEL}>Activities</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--eh-ink)' }}>{activities.length}</div>
            </div>
          </div>

          {ngoTargets.map((r) => {
            const over = r.over > 0
            const met = !over && r.remaining === 0
            // Green once the quota is met, amber while still short, amber-strong
            // when the month has overshot it.
            const bar = over ? '#b45309' : met ? 'var(--eh-success)' : 'var(--eh-primary)'
            return (
              <div
                key={String(r.ngo.id)}
                className="card"
                style={{ marginBottom: 0, flex: '1 1 220px', minWidth: 200 }}
                title={`${r.ngo.name} — ${r.planned} of ${r.target} programmes planned for ${monthLabel(month)}`}
              >
                <div className="card-pad" style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.04em', color: 'var(--eh-primary)' }}>
                    {r.label}
                  </div>

                  {/* The headline: how many of the quota are planned. */}
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--eh-ink)', lineHeight: 1.1 }}>
                    {loadingEvents ? '…' : r.planned}
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--eh-ink-faint)' }}> of {r.target}</span>
                  </div>

                  {/* Bar plus its own caption, so the fill is never read on its
                      own. Hidden while loading rather than drawn empty, which
                      would look like a real 0 before the counts arrive. */}
                  {!loadingEvents && (
                    <>
                      <div style={{ height: 8, borderRadius: 999, background: 'var(--eh-surface-2, #eef0f7)', overflow: 'hidden' }}>
                        <div style={{ width: `${r.pct}%`, height: '100%', borderRadius: 999, background: bar, transition: 'width .25s' }} />
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: over ? '#9a8200' : 'var(--eh-ink-faint)' }}>
                        {over ? `over target by ${r.over}` : met ? 'target met' : `${r.pct}% of target planned`}
                      </div>
                    </>
                  )}

                  {/* The three numbers spelled out, in the words the plan uses. */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                    {[
                      { label: 'Target', value: r.target, color: 'var(--eh-ink-soft)' },
                      { label: 'Done', value: r.planned, color: 'var(--eh-success)' },
                      { label: 'Remaining', value: r.remaining, color: r.remaining ? '#9a8200' : 'var(--eh-success)' },
                    ].map((s) => (
                      <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 11.5, color: 'var(--eh-ink-soft)' }}>{s.label}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: s.color }}>
                          {loadingEvents ? '…' : s.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-pad" style={{ padding: '13px 15px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={LABEL}>Activities</span>
          <span style={{ fontSize: 12, color: 'var(--eh-ink-faint)' }}>{reportMeta.ngoName} · {monthLabel(month)}</span>
          {/* The tick decides what the download contains, so the count is stated
              here rather than left to be discovered in the file. */}
          {selectedFestivalCount > 0 && (
            <span style={{ fontSize: 12, color: 'var(--eh-success)', fontWeight: 700 }}>
              {selectedFestivalCount} programme{selectedFestivalCount === 1 ? '' : 's'} selected for download
            </span>
          )}
          {festivalSuggestions.some((s) => s.is_selected) && (
            <button
              className="eh-btn eh-btn-sm"
              disabled={festBusy}
              title="Untick every AI suggestion — each festival starts back from its suggestions list. Nothing is deleted."
              onClick={clearAllFestivalSelections}
            >
              Clear all AI suggestions
            </button>
          )}
          {/* One common way to add an extra programme row, instead of repeating
              the button on every row: choose the day, then add. */}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--eh-ink-faint)' }}>Date</span>
            <Select value={extraRowDate} onChange={setExtraRowDate} style={{ width: 140 }} disabled={festBusy}>
              {festivalDates.map((d) => <option key={d} value={d}>{shortDate(d)}</option>)}
            </Select>
            <button
              className="eh-btn eh-btn-sm"
              disabled={festBusy || !extraRowDate}
              title="Add a new programme row under the date chosen"
              onClick={() => addExtraRow(extraRowDate)}
            >
              + Add another programme
            </button>
          </span>
        </div>

        {festivalError && (
          <div style={{ margin: '0 15px 15px', padding: '11px 14px', borderRadius: 12, background: 'var(--eh-danger-soft)', color: 'var(--eh-danger)', fontSize: 13 }}>{festivalError}</div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <style>{FEST_GRID_CSS}</style>
          <table className="eh-fest-grid">
            <colgroup>
              <col style={{ width: '6%' }} />
              <col style={{ width: taskAssignment ? '16%' : '21%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: taskAssignment ? '13%' : '16%' }} />
              <col style={{ width: taskAssignment ? '18%' : '29%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '5%' }} />
              {taskAssignment && <col style={{ width: '21%' }} />}
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Festival / Day</th>
                <th>NGO</th>
                <th>Beneficiary</th>
                <th>AI Suggestion</th>
                <th>Location</th>
                <th>Select</th>
                {taskAssignment && <th>Team member</th>}
              </tr>
            </thead>
            <tbody>
              {festivalDates.map((date) => {
                const obs = observancesByDate[date] || []
                const rows = []
                if (!obs.length) {
                  /* No festival falls on this date — but sometimes a date still
                     needs an event, so the row is a manual entry rather than a
                     dead "No important day" label. Same parts as the ✍ Write
                     Manually row: a name for the event, the programme text, the
                     Beneficiary + Location dropdowns and the ✓ that carries the
                     date into the download. Session-only, keyed "date::". */
                  const key = `${date}::`
                  const manual = scopedManual[key]
                  const manualChecked = Boolean(manual?.selected)
                  const on = manualExportText(key)
                  rows.push(
                    <tr key={date} className={`sel-row${manualChecked ? ' sel' : ''}`}>
                      <td className="dd divider">{shortDate(date)}</td>
                      <td className="ff divider" style={{ whiteSpace: 'normal' }}>
                        <div className="sug-sec-label">No important day</div>
                        <input
                          className="eh-input"
                          value={manual?.name || rowEventName(key, date, '') || ''}
                          disabled={festBusy}
                          placeholder="Event name (e.g. Community kitchen drive)…"
                          title="Name the event you are planning for this date — it is what the downloads call it"
                          onChange={(e) => updateFestivalManual(key, { name: e.target.value })}
                          onBlur={() => persistManualRow(key)}
                          style={{ width: '100%', minWidth: 0, marginTop: 5, padding: '7px 9px', fontSize: 12.5, borderRadius: 9, boxSizing: 'border-box', color: 'var(--eh-ink, #1f2430)' }}
                        />
                      </td>
                      <td className="ng divider">
                        <FestivalNgoSelect
                          ngos={ngos}
                          value={rowNgoId(key)}
                          disabled={festBusy}
                          title="Which NGO this date's event belongs to"
                          onChange={(v) => changeRowNgo(key, v)}
                        />
                      </td>
                      <td className="bn divider">
                        <FestivalBeneficiarySelect
                          value={festivalBeneficiaryFor(key)}
                          disabled={festBusy || festGenerating !== null}
                          title="Who this date's event is aimed at"
                          onChange={(v) => handleFestivalBeneficiary(key, v)}
                        />
                      </td>
                      <td className="ai divider">
                        <div className="sug-sec-label">Write manually</div>
                        <textarea
                          className="fest-manual"
                          rows={2}
                          value={manual?.text || ''}
                          disabled={festBusy}
                          placeholder="Type your own programme for this date…"
                          title="Your own programme for this date"
                          onChange={(e) => updateFestivalManual(key, { text: e.target.value })}
                          onBlur={() => persistManualRow(key)}
                        />
                        {manualChecked && !on && (
                          <div className="fest-manual-hint">Type your programme above — an empty box exports nothing.</div>
                        )}
                        {manualChecked && on && (
                          <div className="fest-manual-hint">This date is exported with the programme you typed.</div>
                        )}
                      </td>
                      <td className="lc divider">
                        <FestivalLocationSelect
                          key={`loc-${key}`}
                          value={festivalLocationFor(key)}
                          list={ngoLocationList(rowNgo(key))}
                          disabled={festBusy || festGenerating !== null}
                          title="Where this date's event happens"
                          onChange={(v) => handleFestivalLocation(key, v)}
                        />
                      </td>
                      <td className="sel divider">
                        <input
                          type="checkbox"
                          checked={manualChecked}
                          disabled={festBusy}
                          title={manualChecked ? 'This date is in the download. Untick to leave it out.' : 'Include this date’s programme in the download.'}
                          onChange={(e) => {
                            updateFestivalManual(key, { selected: e.target.checked })
                            persistManualRow(key, { selected: e.target.checked })
                          }}
                        />
                      </td>
                      {taskCell(date, (manual?.name || '').trim() || 'Programme', 1, key)}
                    </tr>
                  )
                }
                // Each festival is one block and carries its OWN date cell: a
                // date that holds 2-3 festivals prints the same date beside
                // every one of them (double rows allowed), while festival name,
                // NGO and beneficiary span their block and the choices live in
                // the AI SUGGESTION + SELECT columns:
                //   · nothing decided yet → one radio row per AI idea, then the
                //     Write Manually row;
                //   · one chosen → SELECTED SUGGESTION (✓), the OTHER
                //     SUGGESTIONS block (until it is cleared), Write Manually;
                //   · collapsed → one action row.
                /* The festival, and — once the row owns an event — the name that
                   event was saved under. A name changed in the Create / Edit
                   form therefore shows up here, in the Festival / Day column,
                   right below the festival it belongs to. */
                const festivalCell = (o, key) => {
                  const evName = rowEventName(key, date, o.name)
                  return (
                    <>
                      <span className="ff-name">{o.name}</span>
                      {o.type && <span className="ff-type"><span className="ff-dot" />{capFirst(o.type)}</span>}
                      {evName && evName !== o.name && (
                        <span className="ff-event" title={`Event name — “${evName}”`}>
                          <span className="ff-event-lbl">Event</span>
                          {evName}
                        </span>
                      )}
                    </>
                  )
                }
                rows.push(...obs.map((o) => {
                  const key = `${date}::${o.name}`
                  // Only THIS row's NGO's stored ideas — the editable NGO column
                  // decides the owner, so NGOs never mix inside a block.
                  const sugg = rowSuggestionsFor(key)
                  const open = festOpen.has(key)
                  const chosen = sugg.find((s) => Boolean(s.is_selected)) || null
                  const manual = scopedManual[key]
                  const manualChecked = Boolean(manual?.selected)
                  const manualOn = Boolean(manualExportText(key))
                  const cleared = festCleared.has(`${scopedManualPrefix}${key}`)
                  const othersVisible = Boolean(chosen) && sugg.length > 1 && !cleared
                  // The Write Manually row owns the block once it is clicked:
                  // opened from ✍ or entered from its own row, it is shown
                  // ALONE — no AI list, no radios. "← Show AI suggestions" or a
                  // regeneration brings the ideas back.
                  const manualOnly = Boolean(manual?.mode)
                  const rowCount = manualOnly
                    ? 1
                    : chosen
                      ? 1 + (othersVisible ? 1 : 0) + 1
                      : sugg.length + 1
                  const trs = []

                  if (!open) {
                    // Nothing decided in yet (or nothing stored) — one slim
                    // action row: pick the beneficiary category, then generate
                    // aimed at it, or skip the AI entirely and write a
                    // programme yourself.
                    trs.push(
                      <tr key={`${key}-g`}>
                        <td className="dd divider">{shortDate(date)}</td>
                        <td className="ff divider">{festivalCell(o, key)}</td>
                        <td className="ng divider">
                          <FestivalNgoSelect
                            ngos={ngos}
                            value={rowNgoId(key)}
                            disabled={festBusy}
                            title="Which NGO this festival's programme belongs to"
                            onChange={(v) => changeRowNgo(key, v)}
                          />
                        </td>
                        <td className="bn divider">
                          <FestivalBeneficiarySelect
                            value={festivalBeneficiaryFor(key)}
                            disabled={festBusy || festGenerating !== null}
                            title="Who the AI should aim this festival's programmes at"
        onChange={(v) => { handleFestivalBeneficiary(key, v) }}
                          />
                        </td>
                        <td className="ai divider">
                          <div className="fest-actions">
                            <button
                              className="eh-btn eh-btn-sm"
                              disabled={festBusy || festGenerating !== null}
                              title={`Type your own programme for ${o.name} instead of asking the AI`}
                              onClick={() => {
                                // Manual mode: open the row with ONLY the textarea
                                // — any stored AI ideas are not offered here.
                                updateFestivalManual(key, { mode: true })
                                setFestOpen((cur) => new Set(cur).add(key))
                              }}
                            >
                              ✍ Write Manually
                            </button>
                          </div>
                        </td>
                        <td className="lc divider">
                            <FestivalLocationSelect
                              key={`loc-${key}`}
                              value={festivalLocationFor(key)}
                              list={ngoLocationList(rowNgo(key))}
                              disabled={festBusy || festGenerating !== null}
                              title={`Where ${o.name}’s programme happens — one place per festival`}
        onChange={(v) => { handleFestivalLocation(key, v) }}
                            />
                        </td>
                        <td className="sel divider" />
                        {taskCell(date, o.name, 1, key)}
                      </tr>
                    )
                    return trs
                  }

                  /* The block's leading cells: the date (one copy per festival, so two
                     festivals on the same date print the date twice), festival,
                     NGO, and beneficiary + the generate button. Called exactly
                     ONCE — by the block's first row. The Location cell is the
                     fifth one that spans the block, but it must sit between the
                     per-row AI suggestion and per-row Select cells in column
                     order, so the row builders render it themselves (see
                     locationSharedCell below). */
                  const sharedCells = () => {
                    const cells = []
                    cells.push(
                      <td key="d" className="dd divider" rowSpan={rowCount}>{shortDate(date)}</td>,
                      <td key="f" className="ff divider" rowSpan={rowCount}>{festivalCell(o, key)}</td>,
                      <td key="n" className="ng divider" rowSpan={rowCount}>
                        <FestivalNgoSelect
                          ngos={ngos}
                          value={rowNgoId(key)}
                          disabled={festBusy}
                          title="Which NGO this festival's programme belongs to"
                          onChange={(v) => changeRowNgo(key, v)}
                        />
                      </td>,
                      <td key="b" className="bn divider" rowSpan={rowCount}>
                        <FestivalBeneficiarySelect
                          value={festivalBeneficiaryFor(key)}
                          disabled={festBusy || festGenerating !== null}
                          title="Who the AI should aim this festival's programmes at. Change it, then run Suggest again to regenerate."
                          onChange={(v) => handleFestivalBeneficiary(key, v)}
                        />
                      </td>,
                    )
                    return cells
                  }

                  /* The Location cell, rendered by the row builders AFTER the AI
                     cell and BEFORE the Select cell. rowSpan keeps it one place
                     per festival block; following rows in the block simply omit
                     it and the grid slots stay aligned. */
                  const locationSharedCell = () => (
                    <td key="l" className="lc divider" rowSpan={rowCount}>
                      <FestivalLocationSelect
                        key={`loc-${key}`}
                        value={festivalLocationFor(key)}
                        list={ngoLocationList(rowNgo(key))}
                        disabled={festBusy || festGenerating !== null}
                        title={`Where ${o.name}’s programme happens — one place per festival`}
                        onChange={(v) => handleFestivalLocation(key, v)}
                      />
                    </td>
                  )

                  /* Dividers: the first row of the block gets the top rule,
                     every row but the last gets the lighter one between ideas. */
                  const pairCls = (i, n) => ({
                    ai: `ai${i === 0 ? ' divider' : ''}${i < n - 1 ? ' subline' : ''}`,
                    sel: `sel${i === 0 ? ' divider' : ''}${i < n - 1 ? ' subline' : ''}`,
                  })

                  /* The Write Manually row: a textarea and its own ✓ box — the
                     tick says "export my text for this festival". It sits at the
                     bottom of every open block, chosen in or not. */
                  const manualRow = (i, n) => {
                    const c = pairCls(i, n)
                    return (
                      <tr key={`${key}-manual`} className={`sel-row${manualChecked ? ' sel' : ''}`}>
                        {i === 0 ? sharedCells() : null}
                        <td className={c.ai}>
                          <div className="sug-sec-label">Write manually</div>
                          <textarea
                            className="fest-manual"
                            rows={2}
                            value={manual?.text || ''}
                            disabled={festBusy}
                            placeholder="Type your own program…"
                            title="Your own programme for this festival"
                            onFocus={() => {
                              // Clicking into Write Manually hides the AI list
                              // at once — this row is what the user chose.
                              if (!manual?.mode) updateFestivalManual(key, { mode: true })
                            }}
                            onChange={(e) => updateFestivalManual(key, { text: e.target.value })}
                            onBlur={() => persistManualRow(key)}
                          />
                          {manualChecked && manualOn && (
                            <div className="fest-manual-hint">
                              {manualOnly
                                ? chosen
                                  ? 'Your programme is exported instead of this festival’s selected AI suggestion (hidden while you write).'
                                  : 'Your programme is exported for this festival.'
                                : chosen
                                  ? 'Your programme is exported instead of the AI suggestion above.'
                                  : 'Your programme is exported for this festival.'}
                            </div>
                          )}
                          {manualChecked && !manualOn && (
                            <div className="fest-manual-hint">Type your programme in the box above — an empty box exports nothing.</div>
                          )}
                          {/* Manual-only view: a way back to the stored ideas
                              without paying for a regeneration. */}
                          {manualOnly && sugg.length > 0 && (
                            <button
                              className="eh-btn eh-btn-sm"
                              style={{ marginTop: 6 }}
                              disabled={festBusy}
                              title="Show the stored AI suggestions as options again"
                              onClick={() => {
                                updateFestivalManual(key, { mode: false })
                                persistManualRow(key, { mode: false })
                              }}
                            >
                              ← Show AI suggestions
                            </button>
                          )}
                        </td>
                        {i === 0 ? locationSharedCell() : null}
                        <td className={c.sel}>
                          <input
                            type="checkbox"
                            checked={manualChecked}
                            disabled={festBusy}
                            title={manualChecked ? 'Your programme is in the download. Untick to leave it out.' : 'Export your own programme for this festival instead of the AI suggestion.'}
                            onChange={(e) => {
                              const patch = { selected: e.target.checked }
                              // Ticking it means "my programme wins" — the AI
                              // ideas step out of view while that is true.
                              if (e.target.checked && !manual?.mode) patch.mode = true
                              updateFestivalManual(key, patch)
                              persistManualRow(key, patch)
                            }}
                          />
                        </td>
                        {i === 0 ? taskCell(date, o.name, rowCount, key) : null}
                      </tr>
                    )
                  }

                  // MANUAL-ONLY: one row, just the textarea + its ✓ box. The AI
                  // ideas stay stored but are not offered here, no matter
                  // whether one of them is already chosen.
                  if (manualOnly) {
                    trs.push(manualRow(0, rowCount))
                    return trs
                  }

                  if (!chosen) {
                    // NOTHING CHOSEN — every AI idea is one radio option, so
                    // exactly one can end up selected, then Write Manually.
                    sugg.forEach((s, si) => {
                      const c = pairCls(si, rowCount)
                      const cells = si === 0 ? sharedCells() : []
                      cells.push(
                        <td key="a" className={c.ai}>
                          <span className="ai-title">{s.title || '—'}</span>
                          {(s.format || s.priority) && (
                            <span className="ai-badges">
                              {s.format && <Badge tone="primary">{s.format}</Badge>}
                              {s.priority && <Badge tone={PRIORITY_TONE[s.priority] || 'muted'}>{s.priority}</Badge>}
                            </span>
                          )}
                        </td>,
                        ...(si === 0 ? [locationSharedCell()] : []),
                        <td key="c" className={c.sel}>
                          <input
                            type="radio"
                            name={`fest-${key}-${s.ngo_id ?? 'x'}`}
                            checked={Boolean(s.is_selected)}
                            disabled={festBusy}
                            title={`Choose “${s.title}” for this festival`}
                            onChange={() => selectFestivalSuggestion(s)}
                          />
                        </td>,
                        ...(si === 0 ? [taskCell(date, o.name, rowCount, key)] : []),
                      )
                      trs.push(<tr key={String(s.id)} className={`sel-row${s.is_selected ? ' sel' : ''}`}>{cells}</tr>)
                    })
                    trs.push(manualRow(sugg.length, rowCount))
                    return trs
                  }

                  // ONE CHOSEN — show only it, with a checked ✓. The other
                  // ideas are gone from this view; the small block below lets
                  // the user clear them away for good (UI only — nothing is
                  // deleted from the server).
                  {
                    const c0 = pairCls(0, rowCount)
                    const cells = sharedCells()
                    cells.push(
                      <td key="a" className={c0.ai}>
                        <div className="sug-sec-label">Selected suggestion</div>
                        <button
                          className="sug-pick"
                          disabled={festBusy}
                          title="Click to unselect — all suggestions come back as options"
                          onClick={() => unselectFestivalSuggestion(chosen)}
                        >
                          <span className="sug-check">✓</span>
                          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{chosen.title || '—'}</span>
                        </button>
                        {(chosen.format || chosen.priority) && (
                          <span className="ai-badges">
                            {chosen.format && <Badge tone="primary">{chosen.format}</Badge>}
                            {chosen.priority && <Badge tone={PRIORITY_TONE[chosen.priority] || 'muted'}>{chosen.priority}</Badge>}
                          </span>
                        )}
                      </td>,
                      locationSharedCell(),
                      <td key="c" className={c0.sel}>
                        <button
                          className="sug-check-lg sug-lg-btn"
                          disabled={festBusy}
                          title="Click to unselect — all suggestions come back as options"
                          onClick={() => unselectFestivalSuggestion(chosen)}
                        >✓</button>
                      </td>,
                      taskCell(date, o.name, rowCount, key),
                    )
                    trs.push(<tr key={`sel-${chosen.id}`} className="sel-row sel">{cells}</tr>)

                    if (othersVisible) {
                      const c1 = pairCls(1, rowCount)
                      trs.push(
                        <tr key={`${key}-others`} className="sel-row">
                          <td className={c1.ai}>
                            <div className="sug-sec-label">Other suggestions</div>
                            <button
                              className="eh-btn eh-btn-sm"
                              disabled={festBusy}
                              title="Hide the unselected suggestions for this festival — they stay saved, only this block goes away"
                              onClick={() => clearOtherSuggestions(key)}
                            >
                              Clear Suggestions
                            </button>
                          </td>
                          <td className={c1.sel} />
                        </tr>
                      )
                    }
                    trs.push(manualRow(rowCount - 1, rowCount))
                    return trs
                  }
                }))
                for (const suffix of (extraRowsByDate[date] || [])) {
                  rows.push(festExtraRow(date, `${date}::${suffix}`))
                }
                
                return rows
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Off-screen preview. The Excel sheet reads festivalRows (set by
        prepareFestivalExport); the PDF captures these three NGO pages (set by
        prepareNgoReportPages). One A4-landscape card per NGO, always all three,
        so a page break in the PDF only ever falls between NGOs. */}
      {(() => {
        const pageHeaders = ['Date', 'Day', 'Festival / Important Day', 'Beneficiary', 'Programme', 'Location', 'Status']
        const hasImages = reportPages.some((p) => p.rows.some((r) => r.image))
        return (
          <div
            ref={reportRef}
            aria-hidden="true"
            style={{ position: 'absolute', left: '-10000px', top: 0, fontFamily: 'inherit' }}
          >
            {reportPages.map((p) => {
              const b = p.brand
              return (
                <div
                  key={String(p.ngo.id)}
                  ref={(el) => { ngoPageRefs.current[String(p.ngo.id)] = el }}
                  style={{ width: 1122, boxSizing: 'border-box', background: '#fff', padding: 22, margin: '0 0 24px', color: '#1F2430' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 12, marginBottom: 12 }}>
                    {(b.logoPlain || b.logo) && (
                      <img
                        src={b.logoPlain || b.logo}
                        alt=""
                        crossOrigin="anonymous"
                        style={{ height: 88, maxWidth: 210, objectFit: 'contain', flexShrink: 0 }}
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 19, fontWeight: 800, color: b.headingColor, lineHeight: 1.15 }}>{b.fullName}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3 }}>Monthly Planner · {monthLabel(month)}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: b.color, lineHeight: 1 }}>
                        {p.count}<span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}> / {p.target}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 4 }}>Programmes planned</div>
                    </div>
                  </div>

                  {p.rows.length ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
                      <thead>
                        <tr>
                          {hasImages && <th style={{ border: '1px solid #D5D9E4', background: b.colorLight, padding: '4px 6px' }} />}
                          {pageHeaders.map((h) => (
                            <th key={h} style={{ border: '1px solid #D5D9E4', background: b.colorLight, padding: '5px 7px', textAlign: 'left', fontWeight: 700, color: b.headingColor }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {p.rows.map((r, i) => (
                          <tr key={`${r.dateLabel}-${r.festival}-${i}`} style={{ background: i % 2 ? '#F7F8FC' : '#fff', breakInside: 'avoid' }}>
                            {hasImages && (
                              <td style={{ border: '1px solid #D5D9E4', padding: '3px 6px' }}>
                                {r.image
                                  ? <img src={r.image} alt="" crossOrigin="anonymous" style={{ width: 46, height: 32, objectFit: 'contain', display: 'block' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                                  : <span style={{ color: '#B7BCCB' }}>—</span>}
                              </td>
                            )}
                            <td style={{ border: '1px solid #D5D9E4', padding: '5px 7px', whiteSpace: 'nowrap', fontWeight: 600 }}>{r.dateLabel}</td>
                            <td style={{ border: '1px solid #D5D9E4', padding: '5px 7px' }}>{r.weekday}</td>
                            <td style={{ border: '1px solid #D5D9E4', padding: '5px 7px' }}>{r.festival}</td>
                            <td style={{ border: '1px solid #D5D9E4', padding: '5px 7px' }}>{r.beneficiary}</td>
                            <td style={{ border: '1px solid #D5D9E4', padding: '5px 7px', fontWeight: 600 }}>{r.programme}</td>
                            <td style={{ border: '1px solid #D5D9E4', padding: '5px 7px' }}>{r.location}</td>
                            <td style={{ border: '1px solid #D5D9E4', padding: '5px 7px' }}>{r.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ fontSize: 11, color: '#8A5A00', background: '#FFF7E6', border: '1px solid #F0D9A8', borderRadius: 8, padding: '8px 10px' }}>
                      No programmes planned for {monthLabel(month)}. Choose an AI suggestion or write your own programme in the Activities grid for this NGO, then download again.
                    </div>
                  )}

                  <div style={{ borderTop: `2px solid ${b.accent}`, marginTop: 12, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6B7280' }}>
                    <span>{b.fullName} · Monthly Planner</span>
                    <span>Generated: {reportStamp}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {addOpen && (
        <AddActivityModal
          ngos={ngos}
          ngo={ngo}
          sectors={sectors}
          month={month}
          onClose={() => setAddOpen(false)}
          onSaved={onActivityAdded}
        />
      )}

      {assignOpen && (
        <AssignTaskModal
          month={month}
          onClose={() => setAssignOpen(false)}
          onNotify={showToast}
        />
      )}

      {planEntry && (
        <PlanModal
          entry={planEntry}
          ngo={planEntry?.ngo || ngo}
          month={month}
          onClose={() => setPlanEntry(null)}
          onSaved={afterPlanned}
        />
      )}

      {/* Same form, reopened with the row's existing event loaded into it. */}
      {editEntry && (
        <CreateEventFromProgrammeModal
          entry={editEntry}
          ngos={ngos}
          activities={activities}
          onClose={() => setEditEntry(null)}
          onSaved={(res) => {
            const rowKey = editEntry?.key
            setEditEntry(null)
            // The planner row owns the row → event link and it never moves; an
            // edit changes the EVENT's fields only, so the link is re-saved
            // under the row's NGO no matter what the form changed.
            afterEventCreated({ ...res, key: rowKey, ngoId: rowNgoId(rowKey) || res.ngoId })
          }}
        />
      )}

      {deleteTarget && (
        <ModalShell
          title="Delete activity"
          subtitle={deleteTarget.activity.name}
          width={520}
          onClose={() => { if (!deleteBusy) { setDeleteTarget(null); setDeleteError('') } }}
          footer={
            <>
              <button className="eh-btn" onClick={() => { setDeleteTarget(null); setDeleteError('') }} disabled={deleteBusy}>Cancel</button>
              <button
                className="eh-btn eh-btn-primary"
                style={{ background: 'var(--eh-danger)', borderColor: 'var(--eh-danger)' }}
                onClick={confirmDelete}
                disabled={deleteBusy}
              >
                {deleteBusy ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: 'var(--eh-ink)' }}>
            <p style={{ margin: 0 }}>
              This permanently deletes <b>{deleteTarget.activity.name}</b>. This cannot be undone.
            </p>
            {/* Say what goes with it, so the count is a decision and not a surprise. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span>
                <b>{(deleteTarget.planned || []).length}</b> programme{(deleteTarget.planned || []).length === 1 ? '' : 's'} planned in {monthLabel(month)} will stay on the calendar, but will no longer be linked to this activity.
              </span>
              <span>The activity’s AI suggestions will be deleted with it.</span>
            </div>
            {deleteError && (
              <div style={{ padding: '10px 13px', borderRadius: 12, background: 'var(--eh-danger-soft)', color: 'var(--eh-danger)' }}>{deleteError}</div>
            )}
          </div>
        </ModalShell>
      )}

      {targetPopup && (
        <ModalShell
          title="Monthly target reached"
          subtitle={`${targetPopup.label} · ${monthLabel(month)}`}
          width={460}
          onClose={() => setTargetPopup(null)}
          footer={
            <button className="eh-btn eh-btn-primary" onClick={() => setTargetPopup(null)}>OK</button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: 'var(--eh-ink)' }}>
            <p style={{ margin: 0 }}>
              <b>{targetPopup.count}</b> programme{targetPopup.count === 1 ? '' : 's'} selected for download —
              that reaches <b>{targetPopup.label}</b>'s monthly target of <b>{targetPopup.target}</b>.
            </p>
            <p style={{ margin: 0 }}>Keep going, or download what is already selected.</p>
          </div>
        </ModalShell>
      )}
    </div>
  )
}

import { jsPDF } from 'jspdf'

// Daily Event Planning Form — native vector PDF (portrait A4).
//
// Mirrors the Create Event screen (the "Daily Event Planning Form") for a single
// saved event: Programme Details, Volunteer Requirement, Beneficiary Details,
// the Distribution / Service table and Additional Requirements. Built the same
// way as reelsPdf.mjs — a pure layout pass (layoutEventPlanningPages) feeds a
// draw pass (buildEventPlanningPdf) so pagination can be unit-tested with no
// jsPDF instance. Long values and the distribution table flow line/row-by-row
// across pages so nothing ever overflows the page. jspdf is imported here and
// this module is only ever imported lazily from the UI, keeping it out of the
// main bundle.

export const PAGE_W = 210
export const PAGE_H = 297
const ML = 14
const MR = 14
const MT = 16
const MB = 16
export const CONTENT_W = PAGE_W - ML - MR
const LIMIT = PAGE_H - MB
const GAP = 4

const PT = 0.3528
const lineH = (fs) => fs * PT * 1.32
const charW = (fs) => fs * PT * 0.5
const LY = lineH(9.5)

const INK = [31, 36, 48]
const MUT = [107, 114, 128]
const LINE = [213, 217, 228]
const HEAD_FILL = [232, 236, 246]
const BAND = [246, 247, 249]

function wrapText(text, maxW, fs) {
  const s = String(text ?? '')
  const chars = Math.max(1, Math.floor(maxW / charW(fs)))
  const words = s.split(/\s+/).filter(Boolean)
  if (!words.length) return ['\u2014']
  const out = []
  let cur = ''
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w
    if (cand.length <= chars) {
      cur = cand
      continue
    }
    if (cur) out.push(cur)
    if (w.length > chars) {
      let rest = w
      while (rest.length > chars) {
        out.push(rest.slice(0, chars))
        rest = rest.slice(chars)
      }
      cur = rest
    } else cur = w
  }
  if (cur) out.push(cur)
  return out
}

const dash = (v) => {
  const s = String(v ?? '').trim()
  return s || '\u2014'
}

function dateLabel(v) {
  const s = String(v || '').slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return dash(v)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${m[3]}-${months[Number(m[2]) - 1]}-${m[1]}`
}

// Assigned volunteers grouped by team, as { label, value } paragraphs.
function volunteerGroups(volunteers) {
  const list = Array.isArray(volunteers) ? volunteers : []
  const namesOf = (team) => list.filter(v => (v.team === 'Management' ? 'Management' : 'Volunteer') === team).map(v => v.name).filter(Boolean)
  const groups = []
  const vols = namesOf('Volunteer')
  const mgmt = namesOf('Management')
  if (vols.length) groups.push({ label: 'Volunteer', value: vols.join(', ') })
  if (mgmt.length) groups.push({ label: 'Management', value: mgmt.join(', ') })
  if (!groups.length) groups.push({ label: 'Assigned', value: '' })
  return groups
}

function distributionRows(planning) {
  const items = Array.isArray(planning?.distribution_items) ? planning.distribution_items : []
  const colW = [14, 92, CONTENT_W - 14 - 92]
  const header = ['Sr. No', 'Item / Service', 'Quantity Required']
  const rows = items.map((r, i) => {
    const cells = [String(i + 1), dash(r.item), dash(r.qty)]
    const lines = cells.map((c, ci) => wrapText(c, colW[ci] - 6, 8.5))
    const h = Math.max(...lines.map(l => l.length)) * lineH(8.5) + 5
    return { cells, lines, h }
  })
  return { colW, header, rows }
}

export function layoutEventPlanningPages(ev) {
  const event = ev || {}
  const planning = event.planning || {}
  const pages = [[]]
  let page = 0
  let y = MT

  const finishPage = () => {
    pages.push([])
    page += 1
    y = MT
  }
  const place = (entry, h, gap = GAP) => {
    if (gap && y > MT) y += gap
    if (y + h > LIMIT + 0.05) finishPage()
    entry.pageNo = page
    entry.yTop = y
    entry.yBot = y + h
    pages[page].push(entry)
    y += h
    return entry
  }
  const addEntry = (entry, h) => place(entry, h, GAP)

  const secHead = (text) => addEntry({ kind: 'secHead', text }, lineH(11) + 3)

  // Flow a labelled key/value row across pages if it is taller than a page.
  const addKvRow = (label, value, labelW, valueW) => {
    let lines = wrapText(dash(value), valueW, 9.5)
    let first = true
    while (lines.length) {
      const maxLines = Math.floor((LIMIT - y - 7) / LY)
      if (maxLines < 1) { finishPage(); continue }
      const take = lines.slice(0, maxLines)
      const h = take.length * LY + 7
      const e = { kind: 'kvRow', label: first ? label : '', lines: take, labelW, valueW }
      e.pageNo = page; e.yTop = y; e.yBot = y + h
      pages[page].push(e); y += h
      lines = lines.slice(maxLines)
      first = false
      if (lines.length) finishPage()
    }
  }

  // Flow a labelled names row (Volunteer/Management) across pages.
  const addNameRow = (label, value) => {
    let lines = wrapText(dash(value), CONTENT_W - 16, 9.5)
    let first = true
    while (lines.length) {
      const maxLines = Math.floor((LIMIT - y - 6) / LY)
      if (maxLines < 1) { finishPage(); continue }
      const take = lines.slice(0, maxLines)
      const h = take.length * LY + 6
      const e = { kind: 'nameRow', label: first ? label : '', lines: take }
      e.pageNo = page; e.yTop = y; e.yBot = y + h
      pages[page].push(e); y += h
      lines = lines.slice(maxLines)
      first = false
      if (lines.length) finishPage()
    }
  }

  const generated = new Date().toLocaleString()

  addEntry(
    {
      kind: 'header',
      title: 'Daily Event Planning Form',
      subtitle: dash(event.name),
      generated,
    },
    lineH(15) + lineH(9.5) + lineH(8) + 8
  )

  const labelW = 52
  const valueW = CONTENT_W - labelW - 10

  // 1 · Program Details ------------------------------------------------------
  secHead('1 \u00b7 PROGRAM DETAILS')
  addKvRow('Name of NGO', event.ngo_name || event.ngo, labelW, valueW)
  addKvRow('Title', event.name, labelW, valueW)
  addKvRow('Date', dateLabel(event.date), labelW, valueW)
  addKvRow('Location Decided', event.venue, labelW, valueW)
  addKvRow('Sector', event.sector_name, labelW, valueW)
  addKvRow('Activity', event.activity_name, labelW, valueW)
  addKvRow('Category', event.category, labelW, valueW)
  addKvRow('Priority', event.priority, labelW, valueW)

  // 2 · Volunteer Requirement ------------------------------------------------
  secHead('2 \u00b7 VOLUNTEER REQUIREMENT')
  addKvRow('Number Required', planning.volunteers_required, labelW, valueW)

  secHead('Assigned Volunteers')
  for (const g of volunteerGroups(event.volunteers)) addNameRow(g.label, g.value)

  // 3 · Beneficiary Details --------------------------------------------------
  secHead('3 \u00b7 BENEFICIARY DETAILS')
  addKvRow('Categories', Array.isArray(planning.beneficiary_categories) && planning.beneficiary_categories.length
    ? planning.beneficiary_categories.join(', ')
    : '', labelW, valueW)
  addKvRow('Number Required', event.expected_beneficiaries, labelW, valueW)

  // 4 · Distribution / Service Details --------------------------------------
  // The table flows row-by-row so a long list splits across pages cleanly,
  // repeating the column header at the top of each continuation page.
  secHead('4 \u00b7 DISTRIBUTION / SERVICE DETAILS')
  const dist = distributionRows(planning)
  const headerRowH = lineH(9) + 5
  place({ kind: 'tableHead', colW: dist.colW, header: dist.header, headerRowH, continued: false }, headerRowH, 0)

  const placeRow = (entry, h) => {
    entry.pageNo = page
    entry.yTop = y
    entry.yBot = y + h
    pages[page].push(entry)
    y += h
  }

  if (!dist.rows.length) {
    place({ kind: 'tableEmpty' }, lineH(9.5) + 6, 0)
  } else {
    for (const r of dist.rows) {
      if (y + r.h > LIMIT + 0.05) {
        finishPage()
        placeRow({ kind: 'tableHead', colW: dist.colW, header: dist.header, headerRowH, continued: true }, headerRowH)
      }
      placeRow({ kind: 'tableRow', colW: dist.colW, cells: r.cells, lines: r.lines }, r.h)
    }
  }

  // 5 · Additional Requirements ---------------------------------------------
  secHead('5 \u00b7 ADDITIONAL REQUIREMENTS')
  addKvRow('Special Requirements', planning.special_requirements, labelW, valueW)
  addKvRow('Organizer', event.organizer, labelW, valueW)
  addKvRow('Event Manager', event.event_manager, labelW, valueW)
  addKvRow('Coordinator', event.coordinator, labelW, valueW)

  return pages
}

const setColor = (doc, c) => doc.setTextColor(c[0], c[1], c[2])

function drawEntry(doc, entry) {
  if (entry.kind === 'header') {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    setColor(doc, INK)
    doc.text(entry.title, ML, entry.yTop + 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    setColor(doc, MUT)
    doc.text(entry.subtitle, ML, entry.yTop + 6 + lineH(15) + 2.5)
    doc.setFontSize(8)
    doc.text(`Generated: ${entry.generated}`, ML, entry.yTop + 6 + lineH(15) + lineH(9.5) + 5)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.line(ML, entry.yTop + 19, ML + CONTENT_W, entry.yTop + 19)
    return
  }

  if (entry.kind === 'secHead') {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    setColor(doc, INK)
    doc.text(entry.text, ML, entry.yTop + 5)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.25)
    doc.line(ML, entry.yTop + 7, ML + CONTENT_W, entry.yTop + 7)
    return
  }

  if (entry.kind === 'kvRow') {
    const h = entry.yBot - entry.yTop
    doc.setFillColor(...BAND)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.rect(ML, entry.yTop, entry.labelW, h, 'FD')
    doc.rect(ML + entry.labelW, entry.yTop, entry.valueW, h)
    if (entry.label) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      setColor(doc, INK)
      doc.text(String(entry.label).slice(0, 40), ML + 4, entry.yTop + 4.5)
    }
    doc.setFont('helvetica', 'normal')
    setColor(doc, INK)
    entry.lines.forEach((ln, k) => doc.text(ln, ML + entry.labelW + 4, entry.yTop + 4.5 + k * LY))
    return
  }

  if (entry.kind === 'paragraph') {
    let top = entry.yTop
    if (entry.caption) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      setColor(doc, MUT)
      doc.text(entry.caption, ML, entry.yTop + 4.5)
      top = entry.yTop + lineH(9.5)
    }
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.rect(ML, top, CONTENT_W, entry.yBot - top)
    doc.setFont('helvetica', 'normal')
    setColor(doc, INK)
    entry.lines.forEach((ln, k) => doc.text(ln, ML + 4, top + 4.2 + k * LY))
    return
  }

  if (entry.kind === 'nameRow') {
    let firstX = ML + 4
    if (entry.label) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      setColor(doc, INK)
      doc.text(`${entry.label}:`, ML, entry.yTop + 4.5)
      firstX = ML + Math.max(doc.getTextWidth('Management: '), doc.getTextWidth('Volunteer: ')) + 5
    }
    doc.setFont('helvetica', 'normal')
    setColor(doc, INK)
    entry.lines.forEach((ln, k) => doc.text(ln, k === 0 ? firstX : ML + 4, entry.yTop + 4.5 + k * LY))
    return
  }

  if (entry.kind === 'tableHead') {
    doc.setFillColor(...HEAD_FILL)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    let x = ML
    entry.colW.forEach((w, i) => {
      doc.rect(x, entry.yTop, w, entry.headerRowH, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      setColor(doc, INK)
      doc.text(entry.header[i], x + 3, entry.yTop + 4.5)
      x += w
    })
    return
  }

  if (entry.kind === 'tableRow') {
    const ly = lineH(8.5)
    let x = ML
    entry.cells.forEach((c, i) => {
      doc.setDrawColor(...LINE)
      doc.setLineWidth(0.3)
      doc.rect(x, entry.yTop, entry.colW[i], entry.yBot - entry.yTop)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      setColor(doc, INK)
      entry.lines[i].forEach((ln, k) => doc.text(ln, x + 3, entry.yTop + 4.2 + k * ly))
      x += entry.colW[i]
    })
    return
  }

  if (entry.kind === 'tableEmpty') {
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.rect(ML, entry.yTop, CONTENT_W, entry.yBot - entry.yTop)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    setColor(doc, MUT)
    doc.text('No distribution / service items recorded.', ML + 3, entry.yTop + 5)
    return
  }
}

export function buildEventPlanningPdf(event) {
  const pages = layoutEventPlanningPages(event)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  for (let p = 0; p < pages.length; p++) {
    if (p > 0) doc.addPage()
    pages[p].forEach((entry) => drawEntry(doc, entry))
  }
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    setColor(doc, MUT)
    doc.text(`Page ${i} of ${n}`, PAGE_W - MR, PAGE_H - 6, { align: 'right' })
  }
  return doc
}

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEventPlanningPdf, layoutEventPlanningPages, PAGE_H } from '../src/panels/event-head/components/eventPlanningPdf.mjs'

const LIMIT = PAGE_H - 16

const countEntries = (pages, kind) => pages.reduce((n, pg) => n + pg.filter((e) => e.kind === kind).length, 0)
const allEntries = (pages) => pages.flat()

function baseEvent(over = {}) {
  return {
    id: 1,
    name: 'Diwali distribution — Sector 8',
    date: '2026-11-08',
    start_time: '10:00',
    end_time: '14:00',
    venue: 'Community Hall, Sector 8',
    ngo_name: 'Being Sevak Charitable Trust',
    sector_name: 'Food Distribution',
    activity_name: 'Grocery Kit Distribution',
    category: 'Distribution',
    priority: 'High',
    description: 'Distribute grocery kits to 120 families across two shifts.',
    expected_beneficiaries: 120,
    organizer: 'Aman Verma',
    event_manager: 'Riya Sharma',
    coordinator: 'Neha Gupta',
    volunteers: [
      { name: 'Amit Kumar', team: 'Volunteer', ngo: 'BSCT' },
      { name: 'Sunil Yadav', team: 'Volunteer', ngo: 'BSCT' },
      { name: 'Pooja Singh', team: 'Management', ngo: 'BSCT' },
    ],
    planning: {
      volunteers_required: 10,
      volunteer_role: 'Packing and handing out kits',
      beneficiary_categories: ['Underprivileged Families', 'Children'],
      distribution_items: [
        { item: 'Grocery Kit', qty: '120', remarks: 'Rice, dal, oil, flour' },
        { item: 'Sweets Box', qty: '120', remarks: 'Diwali special' },
        { item: 'Mask Pack', qty: '120', remarks: '' },
      ],
      special_requirements: 'Two tables and a shade canopy for the stall.',
    },
    ...over,
  }
}

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  PASS  ${msg}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${msg}`)
  }
}

function validate(pages, label, expect = {}) {
  console.log(`\n[${label}] pages: ${pages.length}`)
  assert(pages.length >= 1, `${label}: at least 1 page`)
  assert(pages.every((pg) => pg.length > 0), `${label}: no empty pages`)
  assert(pages[0][0].kind === 'header', `${label}: header on page 1`)

  const numberedHeads = allEntries(pages).filter((e) => e.kind === 'secHead' && /^\d+ ·/.test(e.text)).map((e) => e.text)
  assert(
    numberedHeads.join('|') === '1 · PROGRAM DETAILS|2 · VOLUNTEER REQUIREMENT|3 · BENEFICIARY DETAILS|4 · DISTRIBUTION / SERVICE DETAILS|5 · ADDITIONAL REQUIREMENTS',
    `${label}: section headings in order (got ${numberedHeads.join(', ')})`
  )
  assert(allEntries(pages).some((e) => e.kind === 'secHead' && e.text === 'Assigned Volunteers'), `${label}: Assigned Volunteers heading present`)

  const paraCaps = allEntries(pages).filter((e) => e.kind === 'paragraph' && e.caption)
  assert(paraCaps.length === 0, `${label}: no description block`)

  const kvLabels = allEntries(pages).filter((e) => e.kind === 'kvRow' && e.label).map((e) => e.label)
  assert(
    kvLabels.join('|') === 'Name of NGO|Title|Date|Location Decided|Sector|Activity|Category|Priority|Number Required|Categories|Number Required|Special Requirements|Organizer|Event Manager|Coordinator',
    `${label}: key/value rows correct (got ${kvLabels.join(', ')})`
  )

  const tableHeads = allEntries(pages).filter((e) => e.kind === 'tableHead')
  assert(tableHeads.filter((e) => !e.continued).length === 1, `${label}: distribution table heading appears once`)

  const tableRows = allEntries(pages).filter((e) => e.kind === 'tableRow')
  if (expect.distRows != null) {
    assert(tableRows.length === expect.distRows, `${label}: table has ${expect.distRows} item rows (got ${tableRows.length})`)
    assert(expect.distRows === 0 ? countEntries(pages, 'tableEmpty') === 1 : countEntries(pages, 'tableEmpty') === 0, `${label}: empty-table placeholder correct`)
  }
  if (expect.volGroups != null) {
    const names = allEntries(pages).filter((e) => e.kind === 'nameRow' && e.label)
    assert(names.length === expect.volGroups, `${label}: assigned-volunteer groups = ${expect.volGroups} (got ${names.length})`)
  }

  const overflow = allEntries(pages).filter((e) => e.yTop < 15 || e.yBot > LIMIT + 0.05)
  assert(overflow.length === 0, `${label}: no entry exceeds page bounds (found ${overflow.map((e) => e.kind).join(',')})`)

  const empty = allEntries(pages).filter((e) => (e.kind === 'kvRow' || e.kind === 'paragraph' || e.kind === 'nameRow')).filter((e) => !e.lines.length || e.lines.every((l) => !String(l).trim()))
  assert(empty.length === 0, `${label}: no text block wrapped to nothing`)
}

const scenarios = [
  ['empty', baseEvent({
    name: '', venue: '', ngo_name: '', sector_name: '', activity_name: '', category: '', priority: '',
    description: '', expected_beneficiaries: null, organizer: '', event_manager: '', coordinator: '',
    volunteers: [], planning: {},
  }), { distRows: 0, volGroups: 1 }],
  ['filled', baseEvent(), { distRows: 3, volGroups: 2 }],
  ['long-content', baseEvent({
    description: 'A very long description '.repeat(80),
    special_requirements: 'Requirement '.repeat(60),
    volunteers: Array.from({ length: 40 }, (_, i) => ({ name: `Volunteer Number ${i + 1}`, team: i % 5 === 0 ? 'Management' : 'Volunteer', ngo: 'BSCT' })),
    planning: {
      volunteers_required: 40,
      volunteer_role: 'Long role description '.repeat(6),
      beneficiary_categories: ['Visually Impaired', 'Children', 'Senior Citizens', 'Women', 'Underprivileged Families', 'Persons with Disabilities', 'Others'],
      distribution_items: Array.from({ length: 30 }, (_, i) => ({ item: `Item ${i + 1}`, qty: String((i + 1) * 10), remarks: 'Remarks for item '.repeat(3) })),
      special_requirements: 'Special '.repeat(80),
    },
  }), { distRows: 30, volGroups: 2 }],
]

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), 'out')
mkdirSync(outDir, { recursive: true })

for (const [name, event, expect] of scenarios) {
  const pages = layoutEventPlanningPages(event)
  validate(pages, name, expect)
  const doc = buildEventPlanningPdf(event)
  assert(doc.getNumberOfPages() === pages.length, `${name}: rendered page count ${doc.getNumberOfPages()} matches layout ${pages.length}`)
  const buf = Buffer.from(doc.output('arraybuffer'))
  assert(buf.length > 2000, `${name}: produced a real PDF (${buf.length} bytes)`)
  writeFileSync(resolve(outDir, `event-planning-${name}.pdf`), buf)
}

// Stress: a single event whose wrapped content must span several pages.
{
  const heavy = baseEvent({
    description: 'x'.repeat(4000),
    planning: {
      volunteers_required: 999,
      volunteer_role: 'y'.repeat(2000),
      beneficiary_categories: ['Children'],
      distribution_items: Array.from({ length: 80 }, (_, i) => ({ item: `z`.repeat(200), qty: '10', remarks: 'r'.repeat(200) })),
      special_requirements: 'w'.repeat(4000),
    },
  })
  const pages = layoutEventPlanningPages(heavy)
  console.log(`\n[stress] pages: ${pages.length}`)
  assert(pages.length >= 3, `stress: content overflows at least 3 pages (got ${pages.length})`)
  assert(pages.every((p) => p.length > 0), 'stress: no empty page')
  const overflow = allEntries(pages).filter((e) => e.yTop < 15 || e.yBot > LIMIT + 0.05)
  assert(overflow.length === 0, `stress: no entry exceeds page bounds (found ${overflow.map((e) => e.kind).join(',')})`)
  assert(allEntries(pages).filter((e) => e.kind === 'tableRow').length === 80, 'stress: all 80 table rows laid out')
  const doc = buildEventPlanningPdf(heavy)
  assert(doc.getNumberOfPages() === pages.length, 'stress: page counts match')
  writeFileSync(resolve(outDir, 'event-planning-stress.pdf'), Buffer.from(doc.output('arraybuffer')))
}

console.log(`\nPDF test results: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
console.log(`Wrote sample PDFs to: ${outDir}`)
process.exit(failures === 0 ? 0 : 1)

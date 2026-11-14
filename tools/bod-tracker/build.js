#!/usr/bin/env node
/**
 * UCS Collection Report — workbook generator.
 *
 * Builds a six-sheet, print-ready report from live CRM receipts:
 *   1. Report Summary      NGO-wise collection + station attribution
 *   2. BOD Contribution Tracker  Month x BOD 1..18 with formula totals
 *   3. BOD Summary         per-BOD annual totals, share, rank + chart
 *   4. Monthly Summary     month totals + trend chart
 *   5. Station Collection  OLD vs NEW station codes, NGO by NGO
 *   6. BSCT Reconciliation why the report total and the station total differ
 *
 * Usage:
 *   node tools/bod-tracker/build.js 2026
 *   node tools/bod-tracker/build.js 2026 --as-of 2026-10-31
 *   node tools/bod-tracker/build.js 2026 --include-voided
 *   node tools/bod-tracker/build.js --blank
 */
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = path.join(__dirname, '..', '..', 'backend');
const ExcelJS = require(path.join(BACKEND, 'node_modules', 'exceljs'));

const OUT = path.join(__dirname, '..', '..', 'BOD-Monthly-Contribution-Tracker.xlsx');

const TRACKER = 'BOD Contribution Tracker';
const BOD_COUNT = 18;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Tracker layout
const HEADER_ROW = 4;
const FIRST_MONTH_ROW = 5;
const LAST_MONTH_ROW = FIRST_MONTH_ROW + MONTHS.length - 1; // 16
const SPACER_ROW = LAST_MONTH_ROW + 1;                      // 17
const TOTAL_ROW = LAST_MONTH_ROW + 2;                       // 18
const MONTH_COL = 1;
const FIRST_BOD_COL = 2;
const LAST_BOD_COL = FIRST_BOD_COL + BOD_COUNT - 1;         // S
const TOTAL_COL = LAST_BOD_COL + 1;                         // T

const INR = '[>=10000000]"₹"##\\,##\\,##\\,##0;[>=100000]"₹"##\\,##\\,##0;"₹"##,##0';

const NAVY = 'FF1F3864';
const NAVY_MID = 'FF2E5496';
const NAVY_LIGHT = 'FFDCE6F1';
const GREY_HEAD = 'FFEDF1F7';
const BAND = 'FFF7F9FC';
const BORDER = 'FFD9D9D9';

const thin = { style: 'thin', color: { argb: BORDER } };
const box = { top: thin, bottom: thin, left: thin, right: thin };

const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const col = (index) => {
  let s = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

function istToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const WHERE_SCOPE = `
  r.receipt_no IS NOT NULL
  AND r.receipt_date >= $1::date
  AND r.receipt_date <= $2::date`;

async function fetchAll(year, dateTo, { includeVoided = false } = {}) {
  const dotenv = require(path.join(BACKEND, 'node_modules', 'dotenv'));
  dotenv.config({ path: path.join(BACKEND, '.env') });
  const { Pool } = require(path.join(BACKEND, 'node_modules', 'pg'));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 20000,
  });

  const params = [`${year}-01-01`, dateTo];
  const voidFilter = includeVoided ? '' : 'AND r.voided_at IS NULL';

  try {
    // 1. Month x BOD station, for the tracker grid.
    const bodMonthly = await pool.query(
      `SELECT to_char(r.receipt_date,'MM') AS m,
              coalesce(fa.station, dp.station) AS st,
              SUM(r.amount) AS amt,
              count(*)::int AS n
         FROM receipts r
         LEFT JOIN fro_donor_logs l ON l.id = r.log_id
         LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
         LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
        WHERE r.receipt_date >= $1::date AND r.receipt_date <= $2::date
          ${voidFilter}
          AND coalesce(fa.station, dp.station) ~ '^BOD-[0-9]+$'
        GROUP BY 1,2`,
      params
    );

    // 2. Project bucket x station owner, matching the Collection Report exactly.
    const matrix = await pool.query(
      `WITH scoped AS (
         SELECT r.amount,
                coalesce(fa.station, dp.station) AS station,
                CASE
                  WHEN lower(btrim(coalesce(r.agent_name,''))) IN ('suspense','na','') THEN 'suspense'
                  WHEN lower(btrim(coalesce(r.agent_name,''))) = 'library' THEN 'library'
                  WHEN lower(btrim(coalesce(r.agent_name,''))) = 'pg' THEN 'pg'
                  ELSE lower(btrim(coalesce(r.project_id,'')))
                END AS proj
           FROM receipts r
           LEFT JOIN fro_donor_logs l ON l.id = r.log_id
           LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
           LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
          WHERE ${WHERE_SCOPE}
       )
       SELECT proj,
              CASE
                WHEN station ~ '^(BOD|BFD)-[0-9]+$' THEN 'BSCT'
                WHEN station ~ '^(AOD|AFD)-[0-9]+$' THEN 'AFLF'
                WHEN station ~ '^(MOD|MFD)-[0-9]+$' THEN 'MANN'
                WHEN station IS NULL THEN 'No station'
                ELSE 'Free text'
              END AS station_side,
              count(*)::int AS receipts,
              SUM(amount) AS amount
         FROM scoped
        GROUP BY 1,2`,
      params
    );

    // 3. Station-level detail (old and new families).
    const stations = await pool.query(
      `SELECT coalesce(fa.station, dp.station) AS station,
              count(*)::int AS receipts,
              SUM(r.amount) AS amount
         FROM receipts r
         LEFT JOIN fro_donor_logs l ON l.id = r.log_id
         LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
         LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
        WHERE ${WHERE_SCOPE}
          AND coalesce(fa.station, dp.station) ~ '^(BOD|BFD|AOD|AFD|MOD|MFD)-[0-9]+$'
        GROUP BY 1`,
      params
    );

    // 4. Month totals for every bucket (drives the monthly summary).
    const monthly = await pool.query(
      `SELECT to_char(r.receipt_date,'MM') AS m,
              count(*)::int AS receipts,
              SUM(r.amount) AS amount
         FROM receipts r
        WHERE ${WHERE_SCOPE}
        GROUP BY 1`,
      params
    );

    // 5. The tracker is BOD-only and excludes voided receipts, so the report
    //    needs an explicit bridge or the two totals look contradictory.
    const ties = await pool.query(
      `WITH z AS (
         SELECT r.amount, r.receipt_no, r.voided_at,
                coalesce(fa.station, dp.station) AS st
           FROM receipts r
           LEFT JOIN fro_donor_logs l ON l.id = r.log_id
           LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
           LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
          WHERE r.receipt_date >= $1::date AND r.receipt_date <= $2::date
       )
       SELECT
         COALESCE(SUM(amount) FILTER (WHERE st ~ '^BOD-[0-9]+$' AND receipt_no IS NOT NULL), 0) AS bod_numbered,
         COALESCE(SUM(amount) FILTER (WHERE st ~ '^BOD-[0-9]+$' AND receipt_no IS NULL), 0) AS bod_unnumbered,
         COALESCE(SUM(amount) FILTER (WHERE st ~ '^BOD-[0-9]+$' AND voided_at IS NOT NULL), 0) AS bod_voided,
         COALESCE(SUM(amount) FILTER (WHERE st ~ '^BFD-[0-9]+$' AND receipt_no IS NOT NULL), 0) AS bfd_numbered
       FROM z`,
      params
    );

    return {
      bodMonthly: bodMonthly.rows,
      matrix: matrix.rows,
      stations: stations.rows,
      monthly: monthly.rows,
      ties: ties.rows[0] || {},
    };
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Shared styling helpers
// ---------------------------------------------------------------------------
function titleBar(ws, lastCol, title, subtitle) {
  ws.mergeCells(`A1:${col(lastCol)}1`);
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { name: 'Calibri', size: 17, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 32;

  if (subtitle) {
    ws.mergeCells(`A2:${col(lastCol)}2`);
    const s = ws.getCell('A2');
    s.value = subtitle;
    s.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF404040' } };
    s.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    // Merged width varies per sheet, so grow the row with the text instead of
    // clipping the second line.
    const lines = Math.max(1, Math.ceil(subtitle.length / 90));
    ws.getRow(2).height = Math.max(22, lines * 14 + 8);
  }
}

function sectionHeading(ws, row, text, lastCol, span = 1) {
  ws.mergeCells(`${col(span)}${row}:${col(lastCol)}${row}`);
  const c = ws.getCell(col(span) + row);
  c.value = text;
  c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1F3864' } };
  c.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(row).height = 22;
}

function headerRow(ws, row, labels, widths) {
  labels.forEach((label, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = label;
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = {
      vertical: 'middle',
      wrapText: true,
      horizontal: i === 0 || widths?.[i] === 'text' ? 'left' : 'right',
      indent: i === 0 || widths?.[i] === 'text' ? 1 : 0,
    };
    c.border = box;
  });
  ws.getRow(row).height = 26;
}

function fillRow(ws, row, values, opts = {}) {
  values.forEach((value, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = value;
    c.font = {
      name: 'Calibri',
      size: opts.size || 10,
      bold: !!opts.bold,
      color: { argb: opts.color || 'FF262626' },
      italic: !!opts.italic,
    };
    c.alignment = {
      vertical: 'middle',
      horizontal: i === 0 || opts.textCols?.includes(i) ? 'left' : 'right',
      indent: i === 0 || opts.textCols?.includes(i) ? 1 : 0,
      wrapText: !!opts.wrap,
    };
    if (opts.numFmt?.[i]) c.numFmt = opts.numFmt[i];
    if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
    c.border = box;
  });
  ws.getRow(row).height = opts.height || 20;
}

// ---------------------------------------------------------------------------
// Sheet 1 — Report Summary
// ---------------------------------------------------------------------------
function addSummarySheet(ws, data, year, dateTo) {
  const BUCKETS = [
    { key: 'bsct', label: 'BSCT' },
    { key: 'aflf', label: 'AFLF' },
    { key: 'mann', label: 'MANN' },
    { key: 'pg', label: 'PG' },
    { key: 'library', label: 'Library' },
    { key: 'suspense', label: 'Suspense' },
  ];
  const SIDES = ['BSCT', 'AFLF', 'MANN', 'No station', 'Free text'];
  const cell = (proj, side) => {
    const hit = data.matrix.find((r) => r.proj === proj && r.station_side === side);
    return { amount: hit ? Number(hit.amount) || 0 : 0, receipts: hit ? Number(hit.receipts) : 0 };
  };

  const rows = BUCKETS.map((b) => ({
    ...b,
    amount: SIDES.reduce((s, side) => s + cell(b.key, side).amount, 0),
    receipts: SIDES.reduce((s, side) => s + cell(b.key, side).receipts, 0),
  }));
  const grand = rows.reduce((s, r) => s + r.amount, 0);
  const grandCount = rows.reduce((s, r) => s + r.receipts, 0);

  titleBar(ws, 5, `Collection Report — ${year}`, `Period: 1 Jan ${year} – ${prettyDate(dateTo)}  ·  Numbered receipts  ·  Voided receipts included (same basis as Accounts > Collection Report)`);
  ws.columns = [{ width: 32 }, { width: 20 }, { width: 14 }, { width: 12 }, { width: 48 }];

  sectionHeading(ws, 4, 'Collection by NGO / bucket', 5);
  headerRow(ws, 5, ['Bucket', 'Collection', 'Receipts', '% Share', 'Note'], [null, null, null, null, 'text']);
  rows.forEach((r, i) => {
    fillRow(ws, 6 + i, [
      r.label,
      Math.round(r.amount),
      r.receipts,
      grand ? r.amount / grand : 0,
      i === 0 ? 'Donation programme (BOD / BFD stations)' : i === 5 ? 'Agent-based bucket, not a project' : '',
    ], {
      numFmt: [null, INR, '#,##0', '0.0%', null],
      textCols: [0, 4],
      fill: i % 2 ? BAND : null,
    });
  });
  const totalRow = 6 + rows.length;
  fillRow(ws, totalRow, ['Total', Math.round(grand), grandCount, 1, ''], {
    bold: true,
    numFmt: [null, INR, '#,##0', '0.0%', null],
    textCols: [0, 4],
    fill: NAVY_LIGHT,
  });

  // Station attribution — how much of that money can be tied to a station.
  const start = totalRow + 2;
  sectionHeading(ws, start, 'Station attribution — can the money be traced to a station?', 5);
  headerRow(ws, start + 1, ['Station family', 'Collection', 'Receipts', '% of total', 'Meaning'], [null, null, null, null, 'text']);

  const stationRows = [
    { label: 'Old stations (BOD / AOD / MOD)', sides: ['BSCT', 'AFLF', 'MANN'], note: 'Pre-rename codes; BOD columns in this workbook are these.' },
    { label: 'No station at all', sides: ['No station'], note: 'Donor not linked to an assignment or a profile station.' },
    { label: 'Free-text station', sides: ['Free text'], note: 'Station field holds a place name or shorthand, not a code.' },
  ];

  const sideTotals = SIDES.map((side) => ({
    side,
    amount: rows.reduce((s, b) => s + cell(b.key, side).amount, 0),
    receipts: rows.reduce((s, b) => s + cell(b.key, side).receipts, 0),
  }));
  const oldSum = sideTotals.filter((s) => ['BSCT', 'AFLF', 'MANN'].includes(s.side));

  let r = start + 2;
  for (const sr of stationRows) {
    const amount = sr.sides.reduce((s, side) => s + (sideTotals.find((x) => x.side === side)?.amount || 0), 0);
    const receipts = sr.sides.reduce((s, side) => s + (sideTotals.find((x) => x.side === side)?.receipts || 0), 0);
    fillRow(ws, r++, [sr.label, Math.round(amount), receipts, grand ? amount / grand : 0, sr.note], {
      numFmt: [null, INR, '#,##0', '0.0%', null],
      textCols: [0, 4],
      wrap: true,
      height: 30,
    });
  }

  // Old vs new split, since the workbook only tracks the old BOD codes.
  let oldStationTotal = 0;
  let newStationTotal = 0;
  let oldStationCount = 0;
  let newStationCount = 0;
  for (const s of data.stations) {
    const code = String(s.station || '');
    const isOld = /^(BOD|AOD|MOD)-/.test(code);
    if (isOld) {
      oldStationTotal += Number(s.amount) || 0;
      oldStationCount += Number(s.receipts) || 0;
    } else {
      newStationTotal += Number(s.amount) || 0;
      newStationCount += Number(s.receipts) || 0;
    }
  }

  const start2 = r + 1;
  sectionHeading(ws, start2, 'Old vs new station codes (all NGOs)', 5);
  headerRow(ws, start2 + 1, ['Group', 'Collection', 'Receipts', '% of total', 'Codes'], [null, null, null, null, 'text']);
  fillRow(ws, start2 + 2, ['Old stations', Math.round(oldStationTotal), oldStationCount, grand ? oldStationTotal / grand : 0, 'BOD-n, AOD-n, MOD-n'], {
    numFmt: [null, INR, '#,##0', '0.0%', null],
    textCols: [0, 4],
    fill: BAND,
  });
  fillRow(ws, start2 + 3, ['New stations', Math.round(newStationTotal), newStationCount, grand ? newStationTotal / grand : 0, 'BFD-n, AFD-n, MFD-n'], {
    numFmt: [null, INR, '#,##0', '0.0%', null],
    textCols: [0, 4],
  });
  fillRow(ws, start2 + 4, ['Total on coded stations', Math.round(oldStationTotal + newStationTotal), oldStationCount + newStationCount, grand ? (oldStationTotal + newStationTotal) / grand : 0, ''], {
    bold: true,
    numFmt: [null, INR, '#,##0', '0.0%', null],
    textCols: [0, 4],
    fill: NAVY_LIGHT,
  });

  return { grand, grandCount };
}

// ---------------------------------------------------------------------------
// Sheet 2 — BOD Contribution Tracker (the editable grid)
// ---------------------------------------------------------------------------
function addTrackerSheet(ws) {
  titleBar(ws, TOTAL_COL, 'BOD Monthly Contribution Tracker');

  ws.getCell('A2').value = 'Financial Year:';
  ws.getCell('A2').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1F3864' } };
  ws.getCell('A2').alignment = { horizontal: 'right', vertical: 'middle' };
  const fy = ws.getCell('B2');
  fy.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  fy.border = { bottom: { style: 'medium', color: { argb: 'FFBF9000' } } };
  fy.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells('B2:C2');
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 6;

  const header = ws.getRow(HEADER_ROW);
  header.height = 30;
  const labels = [{ text: 'Month', c: MONTH_COL, a: 'left' }];
  for (let i = 0; i < BOD_COUNT; i++) labels.push({ text: `BOD ${i + 1}`, c: FIRST_BOD_COL + i, a: 'center' });
  labels.push({ text: 'Monthly Total', c: TOTAL_COL, a: 'center' });
  for (const h of labels) {
    const c = header.getCell(h.c);
    c.value = h.text;
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: h.a, vertical: 'middle', wrapText: true, indent: h.a === 'left' ? 1 : 0 };
    c.border = box;
  }

  for (let i = 0; i < MONTHS.length; i++) {
    const rowNumber = FIRST_MONTH_ROW + i;
    const row = ws.getRow(rowNumber);
    row.height = 22;
    const shaded = i % 2 === 1;

    const mc = row.getCell(MONTH_COL);
    mc.value = MONTHS[i];
    mc.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1F3864' } };
    mc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY_HEAD } };
    mc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    mc.border = box;

    for (let b = 0; b < BOD_COUNT; b++) {
      const c = row.getCell(FIRST_BOD_COL + b);
      c.numFmt = INR;
      c.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      c.border = box;
      if (shaded) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    }

    const tc = row.getCell(TOTAL_COL);
    const range = `${col(FIRST_BOD_COL)}${rowNumber}:${col(LAST_BOD_COL)}${rowNumber}`;
    tc.value = { formula: `IF(SUM(${range})=0,"",SUM(${range}))` };
    tc.numFmt = INR;
    tc.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1F3864' } };
    tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_LIGHT } };
    tc.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    tc.border = { top: thin, bottom: thin, right: thin, left: { style: 'medium', color: { argb: 'FF8EA9DB' } } };
  }

  ws.getRow(SPACER_ROW).height = 8;
  const total = ws.getRow(TOTAL_ROW);
  total.height = 26;

  const yl = total.getCell(MONTH_COL);
  yl.value = 'Yearly Total';
  yl.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  yl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  yl.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  yl.border = box;

  for (let b = 0; b < BOD_COUNT; b++) {
    const cIdx = FIRST_BOD_COL + b;
    const c = total.getCell(cIdx);
    const range = `${col(cIdx)}${FIRST_MONTH_ROW}:${col(cIdx)}${LAST_MONTH_ROW}`;
    c.value = { formula: `IF(SUM(${range})=0,"",SUM(${range}))` };
    c.numFmt = INR;
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1F3864' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_LIGHT } };
    c.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    c.border = {
      top: { style: 'medium', color: { argb: 'FF8EA9DB' } },
      bottom: { style: 'double', color: { argb: 'FF8EA9DB' } },
      left: thin,
      right: thin,
    };
  }

  const g = total.getCell(TOTAL_COL);
  const allRange = `${col(FIRST_BOD_COL)}${FIRST_MONTH_ROW}:${col(LAST_BOD_COL)}${LAST_MONTH_ROW}`;
  g.value = { formula: `IF(SUM(${allRange})=0,"",SUM(${allRange}))` };
  g.numFmt = INR;
  g.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  g.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  g.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
  g.border = {
    top: { style: 'medium', color: { argb: 'FF8EA9DB' } },
    bottom: { style: 'double', color: { argb: 'FF8EA9DB' } },
    left: { style: 'medium', color: { argb: 'FF8EA9DB' } },
    right: thin,
  };

  const notes = [
    ['Instructions', ''],
    ['1. Enter the contribution amount under the correct BOD, in the correct month row.', ''],
    ['2. Enter only numbers, e.g. 12000. Do not type ₹, commas or spaces.', ''],
    ['3. Monthly and yearly totals calculate automatically — do not type in the shaded total cells.', ''],
    ['4. The Summary sheets update automatically whenever an amount changes.', ''],
  ];
  notes.forEach((line, i) => {
    const rowNumber = TOTAL_ROW + 2 + i;
    const c = ws.getCell(`A${rowNumber}`);
    c.value = line[0];
    c.font = i === 0
      ? { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1F3864' } }
      : { name: 'Calibri', size: 10, color: { argb: 'FF404040' } };
    c.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.mergeCells(`A${rowNumber}:H${rowNumber}`);
    ws.getRow(rowNumber).height = i === 0 ? 20 : 16;
  });

  ws.dataValidations.add(`${col(FIRST_BOD_COL)}${FIRST_MONTH_ROW}:${col(LAST_BOD_COL)}${LAST_MONTH_ROW}`, {
    type: 'decimal',
    operator: 'between',
    formulae: [0, 999999999],
    allowBlank: true,
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Invalid contribution',
    error: 'Enter a number only (no ₹ sign or commas). Amount cannot be negative or more than 99,99,99,999.',
    showInputMessage: true,
    promptTitle: 'Contribution amount',
    prompt: 'Type the amount in rupees, e.g. 12000',
  });

  ws.getColumn(MONTH_COL).width = 14;
  for (let b = 0; b < BOD_COUNT; b++) ws.getColumn(FIRST_BOD_COL + b).width = 13;
  ws.getColumn(TOTAL_COL).width = 18;
  ws.autoFilter = `A${HEADER_ROW}:${col(TOTAL_COL)}${LAST_MONTH_ROW}`;
}

// ---------------------------------------------------------------------------
// Sheet 3 — BOD Summary
// ---------------------------------------------------------------------------
function addBodSummarySheet(ws) {
  titleBar(ws, 5, 'BOD-wise Annual Contribution', 'Every figure here is a formula that reads the BOD Contribution Tracker sheet — edit an amount there and this updates by itself.');
  ws.columns = [{ width: 30 }, { width: 22 }, { width: 12 }, { width: 10 }, { width: 52 }];

  sectionHeading(ws, 4, 'Annual contribution per BOD', 5);
  headerRow(ws, 5, ['BOD', 'Annual Contribution', '% Share', 'Rank', 'Remark'], [null, null, null, null, 'text']);

  const first = 6;
  const last = first + BOD_COUNT - 1; // 23
  for (let i = 0; i < BOD_COUNT; i++) {
    const row = first + i;
    const src = `${col(FIRST_BOD_COL + i)}${TOTAL_ROW}`;
    fillRow(ws, row, [
      `BOD ${i + 1}`,
      { formula: `IFERROR('${TRACKER}'!${src},0)` },
      { formula: `IF($B$${last + 1}=0,0,B${row}/$B$${last + 1})` },
      { formula: `IF(B${row}=0,"",RANK(B${row},$B$${first}:$B$${last}))` },
      '',
    ], {
      numFmt: [null, INR, '0.0%', '0', null],
      textCols: [0, 4],
      fill: i % 2 ? BAND : null,
    });
  }

  const totalRow = last + 1;
  fillRow(ws, totalRow, ['GRAND TOTAL', { formula: `SUM(B${first}:B${last})` }, { formula: `SUM(C${first}:C${last})` }, '', ''], {
    bold: true,
    numFmt: [null, INR, '0.0%', null, null],
    textCols: [0, 4],
    fill: NAVY_LIGHT,
  });

  const kpiStart = totalRow + 2;
  sectionHeading(ws, kpiStart, 'Key figures', 5);
  headerRow(ws, kpiStart + 1, ['Measure', 'Value', '', '', 'Reads'], [null, null, null, null, 'text']);

  const LOWEST = `SMALL($B$${first}:$B$${last},COUNTIF($B$${first}:$B$${last},0)+1)`;

  const kpis = [
    ['Highest contributing BOD', { formula: `IF(MAX(B${first}:B${last})=0,"",INDEX(A${first}:A${last},MATCH(MAX(B${first}:B${last}),B${first}:B${last},0)))` }, 'The BOD with the largest yearly total'],
    ['Highest amount', { formula: `MAX(B${first}:B${last})` }, 'Largest yearly total in rupees'],
    // SMALL + COUNTIF(0) instead of MINIFS: MINIFS is Office 365 only and shows
    // #NAME? on older Excel builds.
    ['Lowest contributing BOD', { formula: `IF(COUNTIF(B${first}:B${last},">0")=0,"",INDEX(A${first}:A${last},MATCH(${LOWEST},B${first}:B${last},0)))` }, 'Ignores BODs with zero, so it names a real contributor'],
    ['Lowest amount', { formula: `IF(COUNTIF(B${first}:B${last},">0")=0,"",${LOWEST})` }, 'Smallest non-zero yearly total'],
    ['Average per BOD', { formula: `IFERROR(AVERAGEIF(B${first}:B${last},">0"),0)` }, 'Average of BODs that contributed something'],
    ['BODs who contributed', { formula: `COUNTIF(B${first}:B${last},">0")` }, 'Out of 18'],
    ['Total annual contribution', { formula: `B${totalRow}` }, 'Same as the grand total above'],
  ];

  kpis.forEach((k, i) => {
    const row = kpiStart + 2 + i;
    const isMoney = ['Highest amount', 'Lowest amount', 'Average per BOD', 'Total annual contribution'].includes(k[0]);
    fillRow(ws, row, [k[0], 0, '', '', k[2]], {
      numFmt: [null, isMoney ? INR : '0', null, null, null],
      textCols: [0, 4],
      fill: i % 2 ? BAND : null,
    });
    const valueCell = ws.getCell(row, 2);
    valueCell.value = { formula: k[1].formula };
    valueCell.numFmt = isMoney ? INR : 'General';
    valueCell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    valueCell.font = { name: 'Calibri', size: 10, color: { argb: 'FF262626' } };
  });

  // Chart anchor area (chart is added by the post-processing step).
  const chartTop = kpiStart + kpis.length + 3;
  sectionHeading(ws, chartTop, 'BOD-wise annual contribution (chart)', 5);
  ws.getRow(chartTop + 1).height = 240;

  return { first, last, totalRow, chartTop };
}

// ---------------------------------------------------------------------------
// Sheet 4 — Monthly Summary
// ---------------------------------------------------------------------------
function addMonthlySummarySheet(ws, monthlyRows) {
  titleBar(ws, 4, 'Monthly Contribution Summary', 'Totals are formulas linked to the BOD Contribution Tracker sheet; receipt counts come from the receipts table.');
  ws.columns = [{ width: 16 }, { width: 22 }, { width: 14 }, { width: 26 }];

  sectionHeading(ws, 4, 'Month-wise collection', 4, 1);
  headerRow(ws, 5, ['Month', 'Total Contribution', 'Receipts', 'Note'], [null, null, null, 'text']);

  const receiptsByMonth = {};
  for (const r of monthlyRows) receiptsByMonth[parseInt(r.m, 10)] = Number(r.receipts) || 0;

  const first = 6;
  for (let i = 0; i < 12; i++) {
    const row = first + i;
    fillRow(ws, row, [
      MONTHS[i],
      { formula: `IFERROR('${TRACKER}'!T${FIRST_MONTH_ROW + i},0)` },
      receiptsByMonth[i + 1] || 0,
      '',
    ], {
      numFmt: [null, INR, '#,##0', null],
      textCols: [0, 3],
      fill: i % 2 ? BAND : null,
    });
  }
  const totalRow = first + 12;
  fillRow(ws, totalRow, ['GRAND TOTAL', { formula: `SUM(B${first}:B${totalRow - 1})` }, { formula: `SUM(C${first}:C${totalRow - 1})` }, ''], {
    bold: true,
    numFmt: [null, INR, '#,##0', null],
    textCols: [0, 3],
    fill: NAVY_LIGHT,
  });

  const chartTop = totalRow + 2;
  sectionHeading(ws, chartTop, 'Monthly contribution trend (chart)', 4, 1);
  ws.getRow(chartTop + 1).height = 220;

  return { chartTop };
}

// ---------------------------------------------------------------------------
// Sheet 5 — Station Collection (old vs new)
// ---------------------------------------------------------------------------
function addStationSheet(ws, stations) {
  titleBar(ws, 5, 'Station-wise Collection', 'Old codes (BOD/AOD/MOD) and new codes (BFD/AFD/MFD), NGO by NGO. BOD rows link to the tracker; other rows are a snapshot of coded receipts.');

  const NGO_OF = { BOD: 'BSCT', BFD: 'BSCT', AOD: 'AFLF', AFD: 'AFLF', MOD: 'MANN', MFD: 'MANN' };
  const ERA_OF = { BOD: 'OLD', AOD: 'OLD', MOD: 'OLD', BFD: 'NEW', AFD: 'NEW', MFD: 'NEW' };

  const list = stations.map((s) => {
    const code = String(s.station || '');
    const prefix = code.split('-')[0];
    return {
      code,
      num: parseInt(code.split('-')[1], 10),
      ngo: NGO_OF[prefix],
      era: ERA_OF[prefix],
      amount: Math.round(Number(s.amount) || 0),
      receipts: Number(s.receipts) || 0,
    };
  }).filter((s) => s.ngo);

  const ngoTotals = { BSCT: 0, AFLF: 0, MANN: 0 };
  for (const s of list) ngoTotals[s.ngo] += s.amount;

  ws.columns = [{ width: 22 }, { width: 10 }, { width: 8 }, { width: 20 }, { width: 12 }, { width: 14 }];
  let row = 4;

  const block = (era, title) => {
    sectionHeading(ws, row, title, 6, 1);
    row += 1;
    headerRow(ws, row, ['Station', 'NGO', 'Era', 'Collection', 'Receipts', '% of NGO'], [null, null, null, null, null, null]);
    row += 1;

    const startRow = row;
    let eraTotal = 0;
    let eraCount = 0;

    for (const ngo of ['BSCT', 'AFLF', 'MANN']) {
      const rowsForNgo = list.filter((s) => s.era === era && s.ngo === ngo).sort((a, b) => a.num - b.num);
      if (!rowsForNgo.length) continue;

      const ngoHeaderRow = row;
      fillRow(ws, row, [ngo, '', '', '', '', ''], { bold: true, fill: NAVY_LIGHT, textCols: [0, 1, 2, 3, 4, 5] });
      row += 1;

      for (const s of rowsForNgo) {
        const isBod = s.code.startsWith('BOD-');
        const value = isBod
          ? { formula: `IFERROR('${TRACKER}'!${col(FIRST_BOD_COL + s.num - 1)}${TOTAL_ROW},0)` }
          : s.amount;
        fillRow(ws, row, [s.code, s.ngo, era, value, s.receipts, ngoTotals[ngo] ? s.amount / ngoTotals[ngo] : 0], {
          numFmt: [null, null, null, INR, '#,##0', '0.0%'],
          textCols: [0, 1, 2],
        });
        eraTotal += s.amount;
        eraCount += s.receipts;
        row += 1;
      }
      // NGO subtotal within this era
      const ngoEraTotal = rowsForNgo.reduce((t, s) => t + s.amount, 0);
      const ngoEraCount = rowsForNgo.reduce((t, s) => t + s.receipts, 0);
      fillRow(ws, row, [`${ngo} ${era} total`, '', '', ngoEraTotal, ngoEraCount, ngoTotals[ngo] ? ngoEraTotal / ngoTotals[ngo] : 0], {
        bold: true,
        numFmt: [null, null, null, INR, '#,##0', '0.0%'],
        textCols: [0, 1, 2],
        fill: BAND,
      });
      row += 1;
    }

    fillRow(ws, row, [`${era} stations total`, '', '', eraTotal, eraCount, ''], {
      bold: true,
      numFmt: [null, null, null, INR, '#,##0', null],
      textCols: [0, 1, 2],
      fill: NAVY_LIGHT,
    });
    row += 2;
  };

  block('OLD', 'OLD STATIONS — pre-rename codes');
  block('NEW', 'NEW STATIONS — current codes');

  sectionHeading(ws, row, 'Grand total on coded stations', 6, 1);
  row += 1;
  headerRow(ws, row, ['Group', 'NGO', 'Era', 'Collection', 'Receipts', 'Share'], [null, null, null, null, null, null]);
  row += 1;

  const grandCoded = list.reduce((s, x) => s + x.amount, 0);
  const grandCount = list.reduce((s, x) => s + x.receipts, 0);
  for (const ngo of ['BSCT', 'AFLF', 'MANN']) {
    const amount = ngoTotals[ngo] || 0;
    const count = list.filter((s) => s.ngo === ngo).reduce((t, s) => t + s.receipts, 0);
    fillRow(ws, row++, [ngo, '', '', amount, count, grandCoded ? amount / grandCoded : 0], {
      numFmt: [null, null, null, INR, '#,##0', '0.0%'],
      textCols: [0, 1, 2],
    });
  }
  fillRow(ws, row, ['All coded stations', '', '', grandCoded, grandCount, 1], {
    bold: true,
    numFmt: [null, null, null, INR, '#,##0', '0.0%'],
    textCols: [0, 1, 2],
    fill: NAVY_LIGHT,
  });
}

// ---------------------------------------------------------------------------
// Sheet 6 — BSCT reconciliation
// ---------------------------------------------------------------------------
function addReconciliationSheet(ws2, data, year, dateTo) {
  const matrix = data.matrix;
  const ties = data.ties;

  const SIDES = ['BSCT', 'AFLF', 'MANN', 'No station', 'Free text'];
  const cell = (proj, side) => {
    const hit = matrix.find((r) => r.proj === proj && r.station_side === side);
    return { amount: hit ? Math.round(Number(hit.amount) || 0) : 0, receipts: hit ? Number(hit.receipts) : 0 };
  };
  const projects = [...new Set(matrix.map((r) => r.proj))];

  const reportBsct = SIDES.reduce((s, x) => s + cell('bsct', x).amount, 0);
  const reportBsctCount = SIDES.reduce((s, x) => s + cell('bsct', x).receipts, 0);
  const bsctOnBsct = cell('bsct', 'BSCT');
  const bsctElsewhere = reportBsct - bsctOnBsct.amount;
  const bsctElsewhereCount = reportBsctCount - bsctOnBsct.receipts;
  const otherOnBsctAmount = projects
    .filter((p) => p !== 'bsct')
    .reduce((s, p) => s + cell(p, 'BSCT').amount, 0);
  const otherOnBsctCount = projects
    .filter((p) => p !== 'bsct')
    .reduce((s, p) => s + cell(p, 'BSCT').receipts, 0);
  const stationTotal = bsctOnBsct.amount + otherOnBsctAmount;
  const diff = reportBsct - stationTotal;

  ws2.columns = [{ width: 46 }, { width: 18 }, { width: 12 }, { width: 62 }];
  titleBar(ws2, 4, 'BSCT Collection Reconciliation', `Period: 1 Jan ${year} – ${prettyDate(dateTo)} (as of today) · Numbered receipts · Voided receipts included (same basis as Accounts > Collection Report)`);

  const heading = (row, text) => {
    const c = ws2.getCell(`A${row}`);
    c.value = text;
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1F3864' } };
    c.alignment = { vertical: 'middle' };
    ws2.getRow(row).height = 22;
  };

  const dataRow = (row, values, opts = {}) => {
    const desc = String(values[3] ?? '');
    const lines = Math.max(1, Math.ceil(desc.length / 72));
    const autoHeight = Math.max(20, lines * 14 + 6);
    values.forEach((value, i) => {
      const c = ws2.getCell(row, i + 1);
      c.value = value;
      c.font = { name: 'Calibri', size: 10, bold: !!opts.bold, color: { argb: opts.color || 'FF262626' } };
      if (i === 1) c.numFmt = INR;
      if (i === 2) c.numFmt = '#,##0';
      c.alignment = {
        vertical: 'middle',
        horizontal: i === 0 || i === 3 ? 'left' : 'right',
        wrapText: i === 3,
        indent: i === 0 || i === 3 ? 1 : 0,
      };
      c.border = box;
      if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
    });
    ws2.getRow(row).height = opts.height || autoHeight;
  };

  heading(4, '1. Why the Collection Report and the station tracker disagree');
  headerRow(ws2, 5, ['Item', 'Amount', 'Receipts', 'What it means'], [null, null, null, 'text']);
  dataRow(6, ['A. Collection Report — BSCT', reportBsct, reportBsctCount, 'Money booked under project BSCT. Counted by NGO, not by station.']);
  dataRow(7, ['B. BSCT money on BOD/BFD stations', bsctOnBsct.amount, bsctOnBsct.receipts, 'BSCT receipt AND the donor belongs to a BSCT station. This is the part the monthly tracker shows.']);
  dataRow(8, ['C. BSCT money on other stations / no station', bsctElsewhere, bsctElsewhereCount, 'BSCT receipt, but the donor sits on an AFLF or MANN station, or on no station at all. Breakdown in section 2.']);
  dataRow(9, ["D. Other NGOs' money on BOD/BFD stations", otherOnBsctAmount, otherOnBsctCount, 'AFLF / MANN / Library receipts whose donor happens to be on a BSCT station. Breakdown in section 3.'], { fill: BAND });
  dataRow(10, ['Station total — BOD/BFD (all projects)  =  B + D', stationTotal, bsctOnBsct.receipts + otherOnBsctCount, 'What the monthly tracker adds up to across all 18 BOD columns.'], { bold: true, fill: NAVY_LIGHT });
  dataRow(11, ['Difference: A − station total  =  C − D', diff, '', 'Explained fully by C minus D. No money is missing.'], { bold: true, fill: NAVY_LIGHT });

  heading(13, '2. Where BSCT money sits when it is not on a BOD/BFD station');
  headerRow(ws2, 14, ['Sits on', 'Amount', 'Receipts', 'Reason'], [null, null, null, 'text']);
  let r2 = 15;
  for (const side of SIDES.filter((x) => x !== 'BSCT')) {
    const c = cell('bsct', side);
    if (!c.amount) continue;
    const reason = side === 'No station'
      ? 'Donor is not linked to any station — neither an assignment nor a profile station.'
      : side === 'Free text'
        ? 'Station column holds a place name or shorthand instead of a station code.'
        : `Donor is assigned to a ${side} station, but the receipt is booked under project BSCT.`;
    dataRow(r2++, [side, c.amount, c.receipts, reason]);
  }
  dataRow(r2, ['Total = C', bsctElsewhere, bsctElsewhereCount, ''], { bold: true, fill: NAVY_LIGHT });

  const start3 = r2 + 2;
  heading(start3, "3. Which other projects' money sits on BOD/BFD stations");
  headerRow(ws2, start3 + 1, ['Project', 'Amount', 'Receipts', 'Note'], [null, null, null, 'text']);
  let r3 = start3 + 2;
  const otherProjects = projects
    .filter((x) => x !== 'bsct')
    .map((p) => ({ p, ...cell(p, 'BSCT') }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  for (const row of otherProjects) {
    dataRow(r3++, [row.p.toUpperCase(), row.amount, row.receipts, 'Project differs from the station the donor is assigned to.']);
  }
  dataRow(r3, ['Total = D', otherOnBsctAmount, otherOnBsctCount, ''], { bold: true, fill: NAVY_LIGHT });

  const start4 = r3 + 2;
  const bodNumbered = Math.round(Number(ties.bod_numbered) || 0);
  const bodUnnumbered = Math.round(Number(ties.bod_unnumbered) || 0);
  const bodVoided = Math.round(Number(ties.bod_voided) || 0);
  const bfdNumbered = Math.round(Number(ties.bfd_numbered) || 0);
  const trackerTotal = bodNumbered + bodUnnumbered - bodVoided;

  heading(start4, '4. How the BOD sheet ties to this table');
  headerRow(ws2, start4 + 1, ['Line', 'Amount', '', 'Note'], [null, null, null, 'text']);
  let r4 = start4 + 2;
  dataRow(r4++, ['BOD stations, numbered receipts, voided included', bodNumbered, '', 'Same population as the Collection Report.'], { fill: BAND });
  dataRow(r4++, ['+ Receipts without a receipt number', bodUnnumbered, '', 'Not in the report (it only counts numbered receipts), but the tracker counts them.']);
  dataRow(r4++, ['− Voided receipts', -bodVoided, '', 'The tracker excludes voided receipts; the report includes them.']);
  dataRow(r4++, ['= Monthly tracker grand total (Sheet 2)', trackerTotal, '', 'Should equal cell T18 on the BOD Contribution Tracker sheet.'], { bold: true, fill: NAVY_LIGHT });
  dataRow(r4++, ['BFD (new BSCT stations) — not in the tracker', bfdNumbered, '', 'The tracker covers the 18 old BOD stations only; BFD money is separate.'], { fill: BAND });

  const start5 = r4 + 1;
  heading(start5, '5. In plain words');
  const pct = (v) => `${((v / (reportBsct || 1)) * 100).toFixed(1)}%`;
  const noStation = cell('bsct', 'No station');
  const notes = [
    'Two different questions are being counted. The Collection Report asks "which NGO was this receipt booked under?" (project_id). The station tracker asks "which station does this donor belong to?" (the assignment, falling back to the donor profile).',
    `A receipt can belong to project BSCT while its donor sits on an AOD or MOD station — that money is real and collected (${rupee(bsctElsewhere)} of BSCT money, ${pct(bsctElsewhere)}), but it will never appear under a BOD column.`,
    `The reverse also happens: ${rupee(otherOnBsctAmount)} from other projects sits on BOD/BFD stations, which is why a station-only total reads higher than the BSCT share of those same stations.`,
    `${rupee(noStation.amount)} of BSCT money (${pct(noStation.amount)}) has no station at all — ${noStation.receipts.toLocaleString('en-IN')} receipts not linked to any assignment or profile station. Fixing those is what closes most of the gap.`,
    'Voided receipts are included in sections 1–3 because the Collection Report includes them; section 4 removes them so the number matches the BOD sheet exactly.',
  ];
  notes.forEach((text, i) => {
    const row = start5 + 1 + i;
    ws2.mergeCells(`A${row}:D${row}`);
    const c = ws2.getCell(`A${row}`);
    c.value = `${i + 1}. ${text}`;
    c.font = { name: 'Calibri', size: 10, color: { argb: 'FF262626' } };
    c.alignment = { vertical: 'top', wrapText: true, indent: 1 };
    ws2.getRow(row).height = 44;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const blank = args.includes('--blank');
  const includeVoided = args.includes('--include-voided');
  const year = Number(args.find((a) => /^\d{4}$/.test(a))) || new Date().getFullYear();
  const asOf = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || istToday();

  let data = {
    bodMonthly: [],
    matrix: [],
    stations: [],
    monthly: [],
    ties: {},
  };

  if (!blank) {
    try {
      data = await fetchAll(year, asOf, { includeVoided });
      console.error('Data loaded.');
    } catch (err) {
      console.warn(`Report data unavailable (${err.message}) — building an empty workbook.`);
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'UCS CRM';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Order matters: this is the tab order the reader sees.
  const summaryWs = workbook.addWorksheet('Report Summary', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 } },
  });

  const trackerWs = workbook.addWorksheet(TRACKER, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: HEADER_ROW, activeCell: 'B5', showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
    },
    headerFooter: { oddFooter: '&L&BOD Monthly Contribution Tracker&RPage &P of &N' },
  });

  const bodSummaryWs = workbook.addWorksheet('BOD Summary', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 } },
  });

  const monthlyWs = workbook.addWorksheet('Monthly Summary', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 } },
  });

  const stationWs = workbook.addWorksheet('Station Collection', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 } },
  });

  const reconWs = workbook.addWorksheet('BSCT Reconciliation', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 } },
  });

  const summary = addSummarySheet(summaryWs, data, year, asOf);
  addTrackerSheet(trackerWs);
  addBodSummarySheet(bodSummaryWs);
  addMonthlySummarySheet(monthlyWs, data.monthly);
  addStationSheet(stationWs, data.stations);
  addReconciliationSheet(reconWs, data, year, asOf);

  // Prefill the tracker with live amounts (unless --blank).
  if (!blank && data.bodMonthly.length) {
    const grid = MONTHS.map(() => Array(BOD_COUNT).fill(0));
    for (const r of data.bodMonthly) {
      const mi = parseInt(r.m, 10) - 1;
      const bi = parseInt(String(r.st).split('-')[1], 10) - 1;
      if (mi >= 0 && mi < 12 && bi >= 0 && bi < BOD_COUNT) grid[mi][bi] += Math.round(Number(r.amt) || 0);
    }
    let filled = 0;
    for (let mi = 0; mi < 12; mi++) {
      for (let bi = 0; bi < BOD_COUNT; bi++) {
        if (grid[mi][bi] > 0) {
          trackerWs.getCell(FIRST_MONTH_ROW + mi, FIRST_BOD_COL + bi).value = grid[mi][bi];
          filled++;
        }
      }
    }
    trackerWs.getCell('B2').value = year;
    console.error(`Prefilled ${filled} tracker cells.`);
  }

  // Workbook-level polish: tab colours, active sheet.
  summaryWs.properties.tabColor = { argb: NAVY };
  trackerWs.properties.tabColor = { argb: 'FF2E75B6' };
  bodSummaryWs.properties.tabColor = { argb: 'FF548235' };
  monthlyWs.properties.tabColor = { argb: 'FF548235' };
  stationWs.properties.tabColor = { argb: 'FFBF8F00' };
  reconWs.properties.tabColor = { argb: 'FFC00000' };
  workbook.views = [{ activeTab: 0 }];

  const written = await writeWithRetry(workbook, OUT);
  if (!written) return;

  console.log(`Wrote ${OUT}`);
  console.log(`Sheets: ${workbook.worksheets.map((w) => w.name).join(' | ')}`);

  // Charts cannot be written by ExcelJS; Excel adds them in one pass.
  try {
    const script = path.join(__dirname, 'add-charts.ps1');
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', OUT], {
      stdio: 'inherit',
      timeout: 180000,
    });
  } catch (err) {
    console.warn(`Charts skipped: ${err.message}`);
  }

  return summary;
}

async function writeWithRetry(workbook, out) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await workbook.xlsx.writeFile(out);
      return true;
    } catch (err) {
      if (err.code !== 'EBUSY') throw err;
      if (attempt === 5) {
        console.error(`\n${path.basename(out)} is open in Excel.`);
        console.error('Close it and run this script again — no changes were written.');
        process.exitCode = 1;
        return false;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return false;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

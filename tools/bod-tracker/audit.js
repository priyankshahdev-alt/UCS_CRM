const path = require('path');
const backend = require('path').resolve(__dirname, '../../backend');
const dotenv = require(path.join(backend, 'node_modules/dotenv'));
dotenv.config({ path: path.join(backend, '.env') });
const { Pool } = require(path.join(backend, 'node_modules/pg'));
const ExcelJS = require(path.join(backend, 'node_modules/exceljs'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  max: 1,
});

const WHERE = `
  r.receipt_date >= '2026-01-01' AND r.receipt_date < '2027-01-01'
  AND r.voided_at IS NULL
  AND coalesce(fa.station, dp.station) ~ '^BOD-[0-9]+$'`;

async function main() {
  const q = async (label, sql) => {
    const r = await pool.query(sql);
    console.log(`\n== ${label} ==`);
    r.rows.forEach((x) => console.log('  ' + Object.values(x).join(' | ')));
  };

  // The gap between my strict audit and the build.
  await q('Assignment exists but its station is NULL (falls back to donor profile)', `
    SELECT count(*) AS n, SUM(r.amount) AS amt, count(DISTINCT dp.station) AS stations
      FROM receipts r
      LEFT JOIN fro_donor_logs l ON l.id = r.log_id
      LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
      LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
     WHERE ${WHERE} AND fa.id IS NOT NULL AND fa.station IS NULL`);

  // Authoritative per-month/station matrix, using the SAME resolution rule the
  // dashboard card uses.
  const { rows } = await pool.query(`
    SELECT to_char(r.receipt_date AT TIME ZONE 'Asia/Kolkata','MM') AS m,
           coalesce(fa.station, dp.station) AS st,
           SUM(r.amount) AS amt,
           COUNT(*)::int AS n
      FROM receipts r
      LEFT JOIN fro_donor_logs l ON l.id = r.log_id
      LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
      LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
     WHERE ${WHERE}
     GROUP BY 1,2`);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const db = MONTHS.map(() => Array(18).fill(0));
  const counts = MONTHS.map(() => Array(18).fill(0));
  for (const row of rows) {
    const mi = parseInt(row.m, 10) - 1;
    const bi = parseInt(String(row.st).split('-')[1], 10) - 1;
    if (mi >= 0 && mi < 12 && bi >= 0 && bi < 18) {
      db[mi][bi] += Math.round(Number(row.amt) || 0);
      counts[mi][bi] += Number(row.n) || 0;
    }
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(require('path').resolve(__dirname, '../../BOD-Monthly-Contribution-Tracker.xlsx'));
  const ws = wb.getWorksheet(1);

  let mismatches = 0;
  let dbTotal = 0;
  let xlTotal = 0;
  for (let m = 0; m < 12; m++) {
    for (let b = 0; b < 18; b++) {
      const dbv = db[m][b];
      const raw = ws.getCell(5 + m, 2 + b).value;
      const xlv = typeof raw === 'number' ? raw : 0;
      dbTotal += dbv;
      xlTotal += xlv;
      if (dbv !== xlv) {
        mismatches++;
        console.log(`MISMATCH ${MONTHS[m]} BOD${b + 1}: db=${dbv} xlsx=${xlv} diff=${xlv - dbv}`);
      }
    }
  }

  console.log(`\n=== CELL-LEVEL RECONCILIATION ===`);
  console.log(`Cells checked : 216`);
  console.log(`Mismatches    : ${mismatches}`);
  console.log(`DB total      : ${dbTotal.toLocaleString('en-IN')}`);
  console.log(`XLSX total    : ${xlTotal.toLocaleString('en-IN')}`);
  console.log(`MATCH         : ${dbTotal === xlTotal}`);

  const receiptCount = counts.flat().reduce((s, v) => s + v, 0);
  console.log(`\nReceipts represented: ${receiptCount.toLocaleString('en-IN')}`);

  const monthly = db.map((row) => row.reduce((s, v) => s + v, 0));
  console.log('Monthly totals (DB):');
  monthly.forEach((v, i) => console.log(`  ${MONTHS[i]}: ${v.toLocaleString('en-IN')}`));
  console.log(`  SUM: ${monthly.reduce((s, v) => s + v, 0).toLocaleString('en-IN')}`);

  await pool.end();
}

main();

/**
 * BSCT-only reconciliation: Accounts > Collection Report vs Station-wise Collection.
 *
 * The report buckets a receipt by project_id ('bsct') unless the agent says
 * suspense/library/pg; the station card buckets by station prefix. This script
 * rebuilds both sides over the SAME date window and explains every rupee of the
 * difference, so the sheet can carry a descriptive note instead of an unexplained
 * mismatch.
 */
const path = require('path');
const backend = require('path').resolve(__dirname, '../../backend');
const dotenv = require(path.join(backend, 'node_modules/dotenv'));
dotenv.config({ path: path.join(backend, '.env') });
const { Pool } = require(path.join(backend, 'node_modules/pg'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  max: 1,
});

const DATE_FROM = '2026-01-01';
const DATE_TO = '2026-11-14'; // matches the report window the user pasted

const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

async function main() {
  // Exactly the report's population: numbered receipts, inclusive dates, and
  // (per accountsController) no voided filter.
  const sql = `
    WITH scoped AS (
      SELECT r.id,
             r.amount,
             r.project_id,
             r.agent_name,
             r.voided_at,
             r.receipt_no,
             coalesce(fa.station, dp.station) AS station,
             CASE
               WHEN lower(btrim(coalesce(r.agent_name,''))) IN ('suspense','na','') THEN 'suspense'
               WHEN lower(btrim(coalesce(r.agent_name,''))) = 'library' THEN 'library'
               WHEN lower(btrim(coalesce(r.agent_name,''))) = 'pg' THEN 'pg'
               ELSE lower(btrim(coalesce(r.project_id,'')))
             END AS report_bucket
        FROM receipts r
        LEFT JOIN fro_donor_logs l ON l.id = r.log_id
        LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
        LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
       WHERE r.receipt_no IS NOT NULL
         AND r.receipt_date >= $1 AND r.receipt_date <= $2
    )
    SELECT report_bucket,
           CASE
             WHEN station ~ '^BOD-[0-9]+$' THEN 'BOD (old BSCT)'
             WHEN station ~ '^BFD-[0-9]+$' THEN 'BFD (new BSCT)'
             WHEN station ~ '^AOD-[0-9]+$' THEN 'AOD (old AFLF)'
             WHEN station ~ '^AFD-[0-9]+$' THEN 'AFD (new AFLF)'
             WHEN station ~ '^MOD-[0-9]+$' THEN 'MOD (old MANN)'
             WHEN station ~ '^MFD-[0-9]+$' THEN 'MFD (new MANN)'
             WHEN station IS NULL THEN 'no station (null)'
             ELSE 'non-station text (' || station || ')'
           END AS station_family,
           count(*) AS receipts,
           SUM(amount) AS amount,
           count(*) FILTER (WHERE voided_at IS NOT NULL) AS voided_receipts,
           SUM(amount) FILTER (WHERE voided_at IS NOT NULL) AS voided_amount
      FROM scoped
     GROUP BY 1,2
     ORDER BY 1,4 DESC`;

  const { rows } = await pool.query(sql, [DATE_FROM, DATE_TO]);

  const byBucket = {};
  let total = 0;
  let totalReceipts = 0;
  for (const r of rows) {
    byBucket[r.report_bucket] = byBucket[r.report_bucket] || { receipts: 0, amount: 0 };
    byBucket[r.report_bucket].receipts += Number(r.receipts);
    byBucket[r.report_bucket].amount += Number(r.amount || 0);
    total += Number(r.amount || 0);
    totalReceipts += Number(r.receipts);
  }

  console.log(`=== REPORT REPLICA (${DATE_FROM} to ${DATE_TO}, numbered receipts, voided included) ===`);
  console.log(`  Total: ${rupee(total)}  |  ${totalReceipts.toLocaleString('en-IN')} receipts`);
  Object.entries(byBucket)
    .sort((a, b) => b[1].amount - a[1].amount)
    .forEach(([k, v]) => console.log(`  ${k.padEnd(10)} ${rupee(v.amount).padStart(16)}  ${String(v.receipts).padStart(6)} receipts`));

  const bsct = byBucket.bsct || { receipts: 0, amount: 0 };
  console.log(`\n=== BSCT BUCKET vs STATION ATTRIBUTION ===`);
  console.log(`  Report BSCT total: ${rupee(bsct.amount)}  (${bsct.receipts.toLocaleString('en-IN')} receipts)`);

  const bsctRows = rows.filter((r) => r.report_bucket === 'bsct');
  let attributed = 0;
  let attributedReceipts = 0;
  console.log('\n  Where that BSCT money sits, by station family:');
  for (const r of bsctRows.sort((a, b) => Number(b.amount) - Number(a.amount))) {
    const isBsctStation = r.station_family.startsWith('BOD') || r.station_family.startsWith('BFD');
    if (isBsctStation) { attributed += Number(r.amount); attributedReceipts += Number(r.receipts); }
    console.log(`    ${isBsctStation ? '+' : ' '} ${r.station_family.padEnd(34)} ${rupee(r.amount).padStart(15)}  ${String(r.receipts).padStart(6)} rcts` +
      (Number(r.voided_receipts) ? `  (voided: ${rupee(r.voided_amount)}, ${r.voided_receipts})` : ''));
  }

  const diff = bsct.amount - attributed;
  console.log(`\n  Attributed to BOD/BFD stations: ${rupee(attributed)}  (${attributedReceipts.toLocaleString('en-IN')} receipts)`);
  console.log(`  Unattributed BSCT money       : ${rupee(diff)}  (${(bsct.receipts - attributedReceipts).toLocaleString('en-IN')} receipts)`);

  // The unattributed part is what a BOD-only sheet can never show. Break it down
  // so the descriptive note can say WHY, not just "other".
  const detail = await pool.query(`
    WITH scoped AS (
      SELECT r.amount, r.agent_name, r.project_id,
             coalesce(fa.station, dp.station) AS station
        FROM receipts r
        LEFT JOIN fro_donor_logs l ON l.id = r.log_id
        LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
        LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
       WHERE r.receipt_no IS NOT NULL
         AND r.receipt_date >= $1 AND r.receipt_date <= $2
         AND lower(btrim(coalesce(r.agent_name,''))) NOT IN ('suspense','na','library','pg')
         AND lower(btrim(coalesce(r.project_id,''))) = 'bsct'
    )
    SELECT CASE
             WHEN station IS NULL THEN 'no station anywhere (not linked to any assignment or profile)'
             ELSE 'carries a non-BOD station code: ' || station
           END AS reason,
           count(*) AS receipts,
           SUM(amount) AS amount
      FROM scoped
     WHERE station IS NULL OR station !~ '^(BOD|BFD)-[0-9]+$'
     GROUP BY 1 ORDER BY 3 DESC LIMIT 12`, [DATE_FROM, DATE_TO]);

  console.log('\n  Unattributed detail:');
  detail.rows.forEach((r) => console.log(`    ${r.reason.padEnd(62)} ${rupee(r.amount).padStart(14)}  ${r.receipts}`));

  await pool.end();
}

main();

/**
 * How the "BSCT" number in the Collection Report is built.
 * Same bucketing rule as accountsController.bucketReceipt():
 *   agent_name = suspense / NA / '' -> suspense
 *   agent_name = library / pg        -> that bucket
 *   otherwise                        -> lower(project_id)
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

const FROM = '2026-01-01';
const TO = '2026-11-14';
const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const pct = (v, t) => ((v / t) * 100).toFixed(1) + '%';

const SCOPE = `
  WHERE r.receipt_no IS NOT NULL
    AND r.receipt_date >= $1::date
    AND r.receipt_date <= $2::date`;

const BSCT_ONLY = `
  AND lower(btrim(coalesce(r.agent_name,''))) NOT IN ('suspense','na','library','pg')
  AND lower(btrim(coalesce(r.project_id,''))) = 'bsct'`;

async function main() {
  const q = async (label, sql) => {
    const r = await pool.query(sql, [FROM, TO]);
    console.log(`\n${label}`);
    r.rows.forEach((x) => console.log('  ' + Object.values(x).join('  |  ')));
    return r.rows;
  };

  const total = (await pool.query(
    `SELECT count(*)::int n, SUM(r.amount) amt FROM receipts r ${SCOPE} ${BSCT_ONLY}`,
    [FROM, TO]
  )).rows[0];
  const T = Number(total.amt);
  console.log(`BSCT bucket total: ${rupee(T)}  ·  ${Number(total.n).toLocaleString('en-IN')} receipts`);

  console.log('\n=== 1. BY STATION FAMILY (who owns the station the donor sits on) ===');
  const fam = await pool.query(
    `SELECT CASE
              WHEN coalesce(fa.station,dp.station) ~ '^(BOD|BFD)-[0-9]+$' THEN 'BSCT stations (BOD/BFD)'
              WHEN coalesce(fa.station,dp.station) ~ '^(AOD|AFD)-[0-9]+$' THEN 'AFLF stations (AOD/AFD)'
              WHEN coalesce(fa.station,dp.station) ~ '^(MOD|MFD)-[0-9]+$' THEN 'MANN stations (MOD/MFD)'
              WHEN coalesce(fa.station,dp.station) IS NULL THEN 'No station on record'
              ELSE 'Free-text station value'
            END fam,
            count(*)::int n, SUM(r.amount) amt
       FROM receipts r
       LEFT JOIN fro_donor_logs l ON l.id = r.log_id
       LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
       LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
       ${SCOPE} ${BSCT_ONLY}
      GROUP BY 1 ORDER BY 3 DESC`,
    [FROM, TO]
  );
  for (const row of fam.rows) {
    console.log(`  ${row.fam.padEnd(30)} ${rupee(row.amt).padStart(15)}  ${String(row.n).padStart(6)} rcts  ${pct(Number(row.amt), T)}`);
  }

  console.log('\n=== 2. BY MONTH ===');
  const mon = await pool.query(
    `SELECT to_char(r.receipt_date,'Mon YYYY') m, count(*)::int n, SUM(r.amount) amt
       FROM receipts r ${SCOPE} ${BSCT_ONLY}
      GROUP BY date_trunc('month', r.receipt_date), 1
      ORDER BY date_trunc('month', r.receipt_date)`,
    [FROM, TO]
  );
  for (const row of mon.rows) {
    console.log(`  ${row.m.padEnd(10)} ${rupee(row.amt).padStart(15)}  ${String(row.n).padStart(6)} rcts  ${pct(Number(row.amt), T)}`);
  }

  console.log('\n=== 3. BY PAYMENT MODE (top 10) ===');
  const mode = await pool.query(
    `SELECT coalesce(nullif(btrim(mode),''),'(blank)') md, count(*)::int n, SUM(r.amount) amt
       FROM receipts r ${SCOPE} ${BSCT_ONLY}
      GROUP BY 1 ORDER BY 3 DESC LIMIT 10`,
    [FROM, TO]
  );
  for (const row of mode.rows) {
    console.log(`  ${row.md.padEnd(18)} ${rupee(row.amt).padStart(15)}  ${String(row.n).padStart(6)} rcts  ${pct(Number(row.amt), T)}`);
  }

  console.log('\n=== 4. TOP 10 BOD STATIONS INSIDE BSCT ===');
  const top = await pool.query(
    `SELECT coalesce(fa.station,dp.station) st, count(*)::int n, SUM(r.amount) amt
       FROM receipts r
       LEFT JOIN fro_donor_logs l ON l.id = r.log_id
       LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
       LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
       ${SCOPE} ${BSCT_ONLY}
        AND coalesce(fa.station,dp.station) ~ '^(BOD|BFD)-[0-9]+$'
      GROUP BY 1 ORDER BY 3 DESC LIMIT 10`,
    [FROM, TO]
  );
  for (const row of top.rows) {
    console.log(`  ${row.st.padEnd(8)} ${rupee(row.amt).padStart(15)}  ${String(row.n).padStart(6)} rcts`);
  }

  console.log('\n=== 5. THE FORMULA, WRITTEN OUT ===');
  const famMap = {};
  for (const r of fam.rows) famMap[r.fam] = Number(r.amt);
  const onBsct = famMap['BSCT stations (BOD/BFD)'] || 0;
  const onAflf = famMap['AFLF stations (AOD/AFD)'] || 0;
  const onMann = famMap['MANN stations (MOD/MFD)'] || 0;
  const noStation = famMap['No station on record'] || 0;
  const freeText = famMap['Free-text station value'] || 0;
  console.log(`  BSCT total = on BSCT stations + on AFLF stations + on MANN stations + no station + free text`);
  console.log(`  ${rupee(T)} = ${rupee(onBsct)} + ${rupee(onAflf)} + ${rupee(onMann)} + ${rupee(noStation)} + ${rupee(freeText)}`);
  console.log(`  check: ${rupee(onBsct + onAflf + onMann + noStation + freeText)}`);

  await pool.end();
}

main();

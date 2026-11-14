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

async function main() {
  const { rows } = await pool.query(`
    SELECT r.receipt_no,
           r.donor_name,
           r.amount,
           to_char(r.receipt_date,'DD-Mon-YYYY') AS receipt_date,
           to_char(r.voided_at AT TIME ZONE 'Asia/Kolkata','DD-Mon-YYYY HH24:MI') AS voided_at,
           r.void_reason,
           coalesce(fa.station, dp.station) AS station
      FROM receipts r
      LEFT JOIN fro_donor_logs l ON l.id = r.log_id
      LEFT JOIN fro_assignments fa ON fa.id = l.assignment_id
      LEFT JOIN donor_profiles dp ON dp.id = r.donor_id
     WHERE r.receipt_date >= '2026-01-01' AND r.receipt_date < '2027-01-01'
       AND r.voided_at IS NOT NULL
       AND coalesce(fa.station, dp.station) ~ '^BOD-[0-9]+$'
     ORDER BY r.voided_at`);

  console.log('=== 2026 BOD voided receipts ===');
  rows.forEach((r) => {
    console.log(`  ${r.receipt_no || '(no number)'} | ${r.donor_name} | ₹${Number(r.amount).toLocaleString('en-IN')} | ` +
      `receipt ${r.receipt_date} | voided ${r.voided_at} | ${r.station}`);
    console.log(`     reason: ${r.void_reason || '(none recorded)'}`);
  });

  const t = await pool.query(`
    SELECT count(*) AS total_voided,
           sum(amount) AS total_amount,
           count(*) FILTER (WHERE void_reason IS NULL OR void_reason = '') AS no_reason
      FROM receipts WHERE voided_at IS NOT NULL`);
  console.log('\n=== All-time voided ===');
  console.log(`  ${t.rows[0].total_voided} receipts, ₹${Number(t.rows[0].total_amount || 0).toLocaleString('en-IN')}, ` +
    `${t.rows[0].no_reason} without a reason`);

  const reasons = await pool.query(`
    SELECT coalesce(nullif(void_reason,''),'(none)') AS reason, count(*) AS n, sum(amount) AS amt
      FROM receipts WHERE voided_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
  console.log('\n  Top void reasons:');
  reasons.rows.forEach((r) => console.log(`    ${r.reason} | ${r.n} | ₹${Number(r.amt || 0).toLocaleString('en-IN')}`));

  await pool.end();
}

main();

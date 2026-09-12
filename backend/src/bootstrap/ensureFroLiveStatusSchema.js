import db from '../config/db.js';

// fro_live_status gains "work as" context: when an operator (abc) is assigned
// to work another FRO's stations (cbd), the live status row for the target FRO
// records who is actually operating it. Reruns safely on every boot via
// ADD COLUMN IF NOT EXISTS.
export async function ensureFroLiveStatusSchema() {
  try {
    await db._pool.query(`ALTER TABLE fro_live_status ADD COLUMN IF NOT EXISTS work_as_operator_id uuid`);
    await db._pool.query(`ALTER TABLE fro_live_status ADD COLUMN IF NOT EXISTS work_as_operator_name text`);
  } catch (error) {
    throw error;
  }
}

export default ensureFroLiveStatusSchema;
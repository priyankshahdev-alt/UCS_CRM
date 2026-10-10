import db from '../config/db.js';

// Bronze/Silver/Gold milestone tiers for a lead-incentive range. A range with
// at least one active tier runs in "tier mode" (see leadIncentiveService).

export const getTiersBySlab = async (slabId) => {
  const { data, error } = await db
    .from('incentive_slab_tiers')
    .select('*')
    .eq('slab_id', slabId)
    .order('order_index', { ascending: true });
  if (error) throw error;
  return data || [];
};

// All tiers for the given slab ids, keyed by slab id (active first).
export const getTiersForSlabs = async (slabIds) => {
  const ids = (slabIds || []).filter(Boolean);
  const map = {};
  if (ids.length === 0) return map;
  const { data, error } = await db
    .from('incentive_slab_tiers')
    .select('*')
    .in('slab_id', ids)
    .order('order_index', { ascending: true });
  if (error) throw error;
  for (const t of data || []) {
    if (!map[t.slab_id]) map[t.slab_id] = [];
    map[t.slab_id].push(t);
  }
  return map;
};

export const getAllTiers = async () => {
  const { data, error } = await db
    .from('incentive_slab_tiers')
    .select('*')
    .order('order_index', { ascending: true });
  if (error) throw error;
  return data || [];
};

// Replace a range's full tier set. The UI always submits the complete list, so
// a delete-then-insert keeps it simple and order-correct.
export const setSlabTiers = async (slabId, tiers) => {
  const rows = (tiers || [])
    .filter(t => t && t.tier_key)
    .map((t, i) => ({
      slab_id: slabId,
      tier_key: String(t.tier_key).toLowerCase(),
      label: t.label || null,
      order_index: Number.isFinite(Number(t.order_index)) ? Number(t.order_index) : i,
      target_amount: Number(t.target_amount) || 0,
      prize_amount: Number(t.prize_amount) || 0,
      is_active: t.is_active !== false,
      updated_at: new Date().toISOString(),
    }));

  const { error: delErr } = await db
    .from('incentive_slab_tiers')
    .delete()
    .eq('slab_id', slabId);
  if (delErr) throw delErr;

  if (rows.length === 0) return [];
  const { data, error } = await db
    .from('incentive_slab_tiers')
    .insert(rows)
    .select();
  if (error) throw error;
  return data || [];
};

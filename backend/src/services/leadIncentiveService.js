import db, { sql } from '../config/db.js';
import { getActiveSlabs, getAllSlabAssignments, getStoppedSlabIds } from '../models/incentiveSlabModel.js';
import { getSettings } from '../models/incentiveSettingsModel.js';
import { getTargetsForWorkersMonth, getLatestTargetsBeforeMonthForWorkers } from '../models/froTargetModel.js';
import { getActiveSalaryByWorkers } from '../models/salaryModel.js';
import { resolveMonthlyTarget } from './froMonthlyTarget.js';
import { istMonthBounds, istDateString } from '../utils/ist.js';
import { getTiersForSlabs } from '../models/incentiveSlabTierModel.js';
import {
  getAnnouncementByDateAndSlab,
  insertAnnouncement,
} from '../models/leadChampionModel.js';

// Recipients for champion announcement: FROs, Accounts, HR, Admin, Super Admin.
const RECIPIENT_SQL = `
  SELECT id FROM workers
  WHERE is_active = true
    AND (
      lower(coalesce(department, '')) IN ('fro', 'accounts', 'hr', 'admin', 'ngo admin')
      OR lower(coalesce(role, '')) IN ('super_admin', 'admin')
    )
`;

const sendNotificationLogs = async (rows) => {
  if (!rows || rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await db.from('notification_log').insert(chunk);
    if (error) console.error('[lead champion] notification insert:', error.message);
  }
};

const fmtMoney = (n) => Number(n || 0).toLocaleString('en-IN');

const fmtRange = (slab) =>
  slab ? `₹${fmtMoney(slab.min_amount)} – ₹${fmtMoney(slab.max_amount)}` : 'Range';

const tierLabelOf = (t) =>
  t?.label || (t?.tier_key ? String(t.tier_key).charAt(0).toUpperCase() + String(t.tier_key).slice(1) : 'Tier');

// Active tiers for a range, ascending by target amount (ties broken by order).
function activeTiersFor(slab, tiersBySlab) {
  const rows = slab ? (tiersBySlab?.[slab.id] || []) : [];
  return rows
    .filter(t => t.is_active !== false)
    .slice()
    .sort((a, b) =>
      (Number(a.target_amount) - Number(b.target_amount)) ||
      ((Number(a.order_index) || 0) - (Number(b.order_index) || 0)));
}

// A range runs in "tier mode" when it has at least one active tier; otherwise it
// keeps the legacy single-winner STOP-AFTER-WIN behaviour.
function isTierMode(slab, tiersBySlab) {
  return activeTiersFor(slab, tiersBySlab).length > 0;
}

// Kth-highest target milestone reached + the verified_at at which each tier was
// first crossed, computed from a FRO's in-window leads (ascending by time).
function computeTierProgress(leads, tiers) {
  const sortedTiers = (tiers || []).slice().sort((a, b) => Number(a.target_amount) - Number(b.target_amount));
  const asc = (leads || []).slice().sort((a, b) => new Date(a.verified_at) - new Date(b.verified_at));
  let running = 0;
  let ti = 0;
  const crossTimes = {};
  for (const l of asc) {
    running += Number(l.amount) || 0;
    while (ti < sortedTiers.length && running >= Number(sortedTiers[ti].target_amount)) {
      crossTimes[sortedTiers[ti].tier_key] = l.verified_at;
      ti++;
    }
  }
  let reachedTier = null;
  for (const t of sortedTiers) {
    if (running >= Number(t.target_amount)) reachedTier = t;
  }
  return { total: running, reachedTier, crossTimes };
}

// Query: all active FRO workers
const ACTIVE_FROS_SQL = `
  SELECT id, name FROM workers
  WHERE is_active = true AND lower(coalesce(department, '')) = 'fro'
  ORDER BY name
`;

// Query: verified lead_done logs for a FRO on a specific date
// Uses verified_at as the counting date (when accounts verified it)
const FRO_LEADS_SQL = `
  SELECT
    id,
    donor_id,
    amount_collected,
    verified_at,
    created_at,
    transaction_datetime
  FROM fro_donor_logs
  WHERE fro_worker_id = $1
    AND action = 'disposition'
    AND disposition_detail = 'lead_done'
    AND accounts_status = 'verified'
    AND verified_at >= $2
    AND verified_at < $3
  ORDER BY verified_at DESC
`;

// Determine which slab a FRO's target falls into
function getSlabForTarget(target, slabs) {
  const t = Number(target) || 0;
  for (const slab of slabs) {
    if (t >= Number(slab.min_amount) && t < Number(slab.max_amount)) {
      return slab;
    }
  }
  // If target exceeds all slabs, use the last (highest) slab
  if (slabs.length > 0 && t >= Number(slabs[slabs.length - 1].min_amount)) {
    return slabs[slabs.length - 1];
  }
  // Fallback: first slab
  return slabs[0] || null;
}

// Resolve every FRO's monthly target for the month containing `date` through the
// SAME resolver the Teams → FRO Targets screen uses (manual → auto →
// carried-forward). This is why an FRO who shows a target there is now bucketed
// into the matching incentive range instead of always landing in the first slab.
//
// The old code read only the current month's manual fro_monthly_targets row with
// a UTC-derived month key, so it returned 0 for auto (first three months) and
// carried-forward FROs and broke outright on workers holding one row per NGO.
// Returns a Map of worker id -> target amount.
async function buildFroTargetMap(fros, date) {
  const map = new Map();
  const rows = (fros || []).filter(f => f && f.id);
  if (rows.length === 0) return map;

  const month = istMonthBounds(new Date(`${date}T00:00:00Z`)).month; // 'YYYY-MM-01'
  const ids = rows.map(f => f.id);
  const [currentRows, priorRows, salaryByWorker] = await Promise.all([
    getTargetsForWorkersMonth(ids, month),
    getLatestTargetsBeforeMonthForWorkers(ids, month),
    getActiveSalaryByWorkers(ids),
  ]);

  const refDate = new Date(`${month}T00:00:00Z`);
  for (const f of rows) {
    const key = String(f.id);
    const salaryRow = salaryByWorker.get(f.id);
    const resolved = resolveMonthlyTarget({
      joiningDate: f.created_at,
      salary: salaryRow ? Number(salaryRow.salary || 0) : 0,
      currentRow: currentRows.get(key) || null,
      priorRow: priorRows.get(key) || null,
      refDate,
    });
    map.set(key, Number(resolved.target) || 0);
  }
  return map;
}

// Resolve the FRO's competition range: an admin-assigned slab (via ⚙️ Configure)
// wins; otherwise the FRO falls into a range automatically from their monthly
// target (existing behavior for unassigned FROs).
function resolveFroSlab(froId, target, slabs, assignMap, slabById) {
  const assignedId = assignMap[froId];
  if (assignedId && slabById[assignedId]) return { slab: slabById[assignedId], target };
  return { slab: getSlabForTarget(target, slabs), target };
}

// Calculate lead incentive for a single FRO on a given date, within their slab.
// `slab` decides the qualify amount + per-lead reward + slab bonus.
// `stopAt` (optional ISO) clamps the competition window to a fixed time — used
// for STOP-AFTER-WIN so a range's competition truly ENDS the moment a winner
// hits the target: any leads verified after that time stop counting for everyone.
async function calculateFroLeadIncentive(froId, date, slabs, settings, { target, slab, stopAt }) {
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(date);
  endDate.setHours(23, 59, 59, 999);

  // Competition window (like "Sir ka Incentive"): only leads verified between
  // the range's started_at and ended_at count toward rewards. NULL started_at =
  // not started yet (nothing counts); NULL ended_at = runs to end of day.
  let winStart = startDate;
  let winEnd = endDate;
  if (slab && slab.started_at) {
    const s = new Date(slab.started_at);
    if (s.getTime() > winStart.getTime()) winStart = s;
  }
  if (slab && slab.ended_at) {
    const e = new Date(slab.ended_at);
    if (e.getTime() < winEnd.getTime()) winEnd = e;
  }
  // STOP-AFTER-WIN: once there's a winner, the range's competition is over — no
  // lead verified after the winner's winning hit counts for anyone.
  if (stopAt) {
    const s = new Date(stopAt);
    if (s.getTime() < winEnd.getTime()) winEnd = s;
  }
  // No start time yet = this range's competition has not begun → nothing counts
  // (matches the UI "empty = not started" and the FRO live view hiding it).
  if (slab && !slab.started_at) {
    return {
      target: target != null ? target : 0,
      slab,
      total_leads: 0,
      qualified_leads: 0,
      total_amount: 0,
      lead_incentive: 0,
      slab_bonus: 0,
      leads: [],
    };
  }
  // Window fully outside the day (e.g. not yet started, or ended before day) → nothing counts.
  if (winStart.getTime() >= winEnd.getTime()) {
    return {
      target: target != null ? target : 0,
      slab,
      total_leads: 0,
      qualified_leads: 0,
      total_amount: 0,
      lead_incentive: 0,
      slab_bonus: 0,
      leads: [],
    };
  }

  // Fetch verified leads within the day & competition window
  const { data: leads } = await db
    .from('fro_donor_logs')
    .select('id, donor_id, amount_collected, verified_at')
    .eq('fro_worker_id', froId)
    .eq('action', 'disposition')
    .eq('disposition_detail', 'lead_done')
    .eq('accounts_status', 'verified')
    .gte('verified_at', winStart.toISOString())
    .lte('verified_at', winEnd.toISOString())
    .order('verified_at', { ascending: false });

  const allLeads = leads || [];
  // Flat-prize model: EVERY verified lead counts toward the day's collection —
  // there is no per-lead minimum (even a ₹10 lead counts). The only threshold a
  // range has is amount_to_win: the total day collection that first reaches it
  // wins the range's flat prize (incentive_amount). Per-lead math is gone.
  const totalAmount = allLeads.reduce((sum, l) => sum + (Number(l.amount_collected) || 0), 0);

  return {
    target: target != null ? target : 0,
    slab,
    total_leads: allLeads.length,
    qualified_leads: allLeads.length,
    total_amount: totalAmount,
    lead_incentive: 0,
    slab_bonus: 0,
    leads: allLeads.map(l => ({
      id: l.id,
      donor_id: l.donor_id,
      amount: Number(l.amount_collected) || 0,
      qualified: true,
      verified_at: l.verified_at,
    })),
  };
}

// Get full daily summary for all FROs. Each range runs its own competition:
// - Legacy mode (no active tiers): champion = the FRO (competing in that range)
//   who FIRST gets a verified lead ≥ amount_to_win → STOP-AFTER-WIN, flat prize.
// - Tier mode (has active tiers): the race continues through the window; at
//   window end each tier gets exactly one winner = highest collected amount,
//   ties broken by whoever crossed that tier's target first.
export const getDailySummary = async (date) => {
  const [slabs, settings, frosResult, assignments] = await Promise.all([
    getActiveSlabs(),
    getSettings(),
    db.from('workers').select('id, name, created_at').eq('is_active', true).ilike('department', 'fro').order('name'),
    getAllSlabAssignments(),
  ]);

  const fros = frosResult.data || [];
  const slabById = {};
  for (const s of slabs || []) slabById[s.id] = s;
  const assignMap = {};
  for (const a of assignments || []) assignMap[a.fro_worker_id] = a.slab_id;

  const tiersBySlab = await getTiersForSlabs((slabs || []).map(s => s.id));
  const targetMap = await buildFroTargetMap(fros, date);
  const results = [];
  const pool = {}; // slabId -> Set of competing FRO ids

  for (const fro of fros) {
    const target = targetMap.get(String(fro.id)) || 0;
    const { slab } = resolveFroSlab(fro.id, target, slabs, assignMap, slabById);
    const calc = await calculateFroLeadIncentive(fro.id, date, slabs, settings, { target, slab });
    results.push({
      fro_id: fro.id,
      fro_name: fro.name,
      target: target != null ? target : 0,
      slab,
      total_leads: calc.total_leads,
      qualified_leads: calc.qualified_leads,
      total_amount: calc.total_amount,
      lead_incentive: calc.lead_incentive,
      slab_bonus: calc.slab_bonus,
      champion_bonus: 0,
      tier_bonus: 0,
      reached_tier: null,
      tier_mode: slab ? isTierMode(slab, tiersBySlab) : false,
      total_incentive: calc.lead_incentive + calc.slab_bonus,
      _leads: calc.leads,
      _slab_id: slab ? slab.id : null,
    });
    if (slab) {
      if (!pool[slab.id]) pool[slab.id] = new Set();
      pool[slab.id].add(fro.id);
    }
  }

  const legacySlabs = (slabs || []).filter(s => !isTierMode(s, tiersBySlab));
  const tierSlabs = (slabs || []).filter(s => isTierMode(s, tiersBySlab));

  // ── Legacy mode: first to cross amount_to_win (STOP-AFTER-WIN) ──
  const findLegacyWinners = () => {
    const winnersBySlab = {};
    for (const slab of legacySlabs) {
      const competing = pool[slab.id];
      if (!competing || competing.size === 0) continue;
      const winAt = slab && slab.amount_to_win != null ? Number(slab.amount_to_win) : 1500;

      let winner = null;
      for (const r of results) {
        if (!r._slab_id || r._slab_id !== slab.id) continue;
        const asc = (r._leads || [])
          .slice()
          .sort((a, b) => new Date(a.verified_at) - new Date(b.verified_at));
        let running = 0;
        let hit = null;
        for (const l of asc) {
          running += Number(l.amount) || 0;
          if (running >= winAt) {
            hit = { verified_at: l.verified_at, crossing: running, crossedBy: Number(l.amount) || 0, leadId: l.id };
            break;
          }
        }
        if (hit && (!winner || new Date(hit.verified_at) < new Date(winner.theAt))) {
          winner = {
            fro: r,
            at: hit.verified_at,
            crossingAmount: hit.crossing,
            hitAmount: hit.crossedBy,
            leadId: hit.leadId,
            theAt: hit.verified_at,
          };
        }
      }

      if (!winner || winner.at == null) continue;
      winnersBySlab[slab.id] = winner;
    }
    return winnersBySlab;
  };

  // STOP-AFTER-WIN: clamp the window to the legacy winner's hit time, then re-find.
  const winnersBySlab = findLegacyWinners();
  for (const slab of legacySlabs) {
    const winner = winnersBySlab[slab.id];
    if (!winner) continue;
    for (const r of results) {
      if (String(r._slab_id) !== String(slab.id)) continue;
      const calc = await calculateFroLeadIncentive(r.fro_id, date, slabs, settings, {
        target: r.target,
        slab,
        stopAt: winner.at,
      });
      r.total_leads = calc.total_leads;
      r.qualified_leads = calc.qualified_leads;
      r.total_amount = calc.total_amount;
      r.lead_incentive = calc.lead_incentive;
      r.slab_bonus = calc.slab_bonus;
      r.total_incentive = calc.lead_incentive + calc.slab_bonus;
      r._leads = calc.leads;
    }
  }
  const finalWinners = findLegacyWinners();

  // Prize assignment (legacy): the range's incentive_amount goes onto its champion.
  for (const slab of legacySlabs) {
    const winner = finalWinners[slab.id];
    if (!winner) continue;
    const prize = Number(slab.incentive_amount) || 0;
    for (const r of results) {
      if (String(r._slab_id) !== String(slab.id)) continue;
      const isChamp = String(r.fro_id) === String(winner.fro.fro_id);
      r.lead_incentive = 0;
      r.champion_bonus = 0;
      r.slab_bonus = isChamp ? prize : 0;
      r.total_incentive = isChamp ? prize : 0;
    }
  }

  // ── Tier mode: per-tier winner (highest amount, tie → earliest cross) ──
  const nowMs = Date.now();
  const tierWinners = []; // final winners only (once the window has closed)
  const tierLeadersBySlab = {}; // slabId -> { is_final, leaders[] } (always live)
  for (const slab of tierSlabs) {
    const tiers = activeTiersFor(slab, tiersBySlab);
    const members = results.filter(r => String(r._slab_id) === String(slab.id));
    let winEnd = new Date(date);
    winEnd.setHours(23, 59, 59, 999);
    if (slab.ended_at) {
      const e = new Date(slab.ended_at);
      if (e.getTime() < winEnd.getTime()) winEnd = e;
    }
    const isFinal = nowMs >= winEnd.getTime();

    const pools = {}; // tier_key -> [{ r, total, crossAt }]
    for (const r of members) {
      const prog = computeTierProgress(r._leads, tiers);
      r.total_amount = prog.total;
      r.reached_tier = prog.reachedTier ? prog.reachedTier.tier_key : null;
      if (prog.reachedTier) {
        const k = prog.reachedTier.tier_key;
        (pools[k] = pools[k] || []).push({ r, total: prog.total, crossAt: prog.crossTimes[k] || null });
      }
    }

    const leaders = [];
    for (const t of tiers) {
      const poolt = pools[t.tier_key] || [];
      let best = null;
      for (const p of poolt) {
        if (!best) { best = p; continue; }
        if (p.total > best.total) { best = p; continue; }
        if (p.total === best.total) {
          const ct = p.crossAt ? new Date(p.crossAt).getTime() : Infinity;
          const cb = best.crossAt ? new Date(best.crossAt).getTime() : Infinity;
          if (ct < cb) best = p;
        }
      }
      leaders.push({
        tier_key: t.tier_key,
        label: tierLabelOf(t),
        target_amount: Number(t.target_amount) || 0,
        prize_amount: Number(t.prize_amount) || 0,
        leader: best ? {
          fro_id: best.r.fro_id,
          fro_name: best.r.fro_name,
          amount: best.total,
          cross_time: best.crossAt,
        } : null,
      });
      if (best && isFinal) {
        tierWinners.push({ slab, tier: t, total: best.total, crossAt: best.crossAt, fro: best.r });
      }
    }
    tierLeadersBySlab[slab.id] = { is_final: isFinal, leaders };
  }

  // Assign tier prizes to the final winner of each tier; all other tier-mode
  // rows keep ₹0 (reaching a tier ≠ winning it).
  const winnerKey = new Set(tierWinners.map(w => `${w.slab.id}|${w.tier.tier_key}|${w.fro.fro_id}`));
  for (const slab of tierSlabs) {
    const tiers = activeTiersFor(slab, tiersBySlab);
    for (const r of results) {
      if (String(r._slab_id) !== String(slab.id)) continue;
      r.lead_incentive = 0;
      r.slab_bonus = 0;
      r.champion_bonus = 0;
      r.tier_bonus = 0;
      r.total_incentive = 0;
      for (const t of tiers) {
        if (r.reached_tier === t.tier_key && winnerKey.has(`${slab.id}|${t.tier_key}|${r.fro_id}`)) {
          const prize = Number(t.prize_amount) || 0;
          r.tier_bonus = prize;
          r.slab_bonus = prize;
          r.total_incentive = prize;
        }
      }
    }
  }

  const champions = [];
  for (const slab of legacySlabs) {
    const winner = finalWinners[slab.id];
    if (!winner) continue;
    const prize = Number(slab.incentive_amount) || 0;
    champions.push({
      slab_id: slab.id,
      slab_label: fmtRange(slab),
      amount_to_win: slab && slab.amount_to_win != null ? Number(slab.amount_to_win) : 1500,
      tier_key: null,
      tier_label: null,
      tier_target: null,
      tier_mode: false,
      fro_id: winner.fro.fro_id,
      fro_name: winner.fro.fro_name,
      hit_lead_id: winner.leadId,
      hit_amount: winner.hitAmount,
      crossing_amount: winner.crossingAmount,
      hit_at: winner.at,
      qualified_leads: winner.fro.qualified_leads,
      total_amount: winner.fro.total_amount,
      lead_incentive: 0,
      slab_bonus: prize,
      champion_bonus: 0,
      total_incentive: prize,
    });
  }
  for (const w of tierWinners) {
    const prize = Number(w.tier.prize_amount) || 0;
    champions.push({
      slab_id: w.slab.id,
      slab_label: fmtRange(w.slab),
      amount_to_win: null,
      tier_key: w.tier.tier_key,
      tier_label: tierLabelOf(w.tier),
      tier_target: Number(w.tier.target_amount) || 0,
      tier_mode: true,
      fro_id: w.fro.fro_id,
      fro_name: w.fro.fro_name,
      hit_lead_id: null,
      hit_amount: null,
      crossing_amount: w.total,
      hit_at: w.crossAt,
      qualified_leads: w.fro.qualified_leads,
      total_amount: w.fro.total_amount,
      lead_incentive: 0,
      slab_bonus: prize,
      champion_bonus: 0,
      total_incentive: prize,
    });
  }
  champions.sort((a, b) => new Date(a.hit_at || 0) - new Date(b.hit_at || 0));

  // Sort final results by total_incentive descending (strip internal fields).
  results.sort((a, b) => b.total_incentive - a.total_incentive);
  const frosOut = results.map(({ _leads, _slab_id, ...rest }) => rest);

  // Tier config + live leaders per range, for the leaderboard (works mid-race).
  const tiersOut = {};
  for (const slab of tierSlabs) {
    const tiers = activeTiersFor(slab, tiersBySlab);
    const info = tierLeadersBySlab[slab.id] || { is_final: false, leaders: [] };
    tiersOut[slab.id] = {
      is_final: info.is_final,
      tiers: tiers.map(t => ({
        tier_key: t.tier_key,
        label: tierLabelOf(t),
        order_index: Number(t.order_index) || 0,
        target_amount: Number(t.target_amount) || 0,
        prize_amount: Number(t.prize_amount) || 0,
      })),
      leaders: info.leaders,
    };
  }

  return {
    date,
    slabs,
    settings,
    fros: frosOut,
    champions,
    tiers: tiersOut,
  };
};

// Get single FRO detail with individual leads
export const getFroDetail = async (froId, date) => {
  const [slabs, settings, froResult, assignments] = await Promise.all([
    getActiveSlabs(),
    getSettings(),
    db.from('workers').select('id, name, created_at').eq('id', froId).maybeSingle(),
    getAllSlabAssignments(),
  ]);

  if (!froResult.data) return null;

  const slabById = {};
  for (const s of slabs || []) slabById[s.id] = s;
  const assignMap = {};
  for (const a of assignments || []) assignMap[a.fro_worker_id] = a.slab_id;

  const targetMap = await buildFroTargetMap([froResult.data], date);
  const target = targetMap.get(String(froId)) || 0;
  const { slab } = resolveFroSlab(froId, target, slabs, assignMap, slabById);
  const calc = await calculateFroLeadIncentive(froId, date, slabs, settings, { target, slab });

  // Flat model: the range's flat prize (incentive_amount) lands only on the
  // day's champion of the FRO's range — everything else stays ₹0.
  let slabBonus = 0;
  let totalIncentive = 0;
  let tierBonus = 0;
  let reachedTier = null;
  let tierInfo = null;
  try {
    const summary = await getDailySummary(date);
    const champ = (summary.champions || []).find(c => String(c.fro_id) === String(froId));
    const myRow = (summary.fros || []).find(f => String(f.fro_id) === String(froId));
    if (champ && (!slab || String(champ.slab_id) === String(slab.id))) {
      slabBonus = Number(champ.slab_bonus || 0);
      totalIncentive = Number(champ.total_incentive || 0);
    }
    tierBonus = Number(myRow?.tier_bonus || 0);
    reachedTier = myRow?.reached_tier || null;
    tierInfo = slab ? ((summary.tiers || {})[String(slab.id)] || null) : null;
  } catch (e) {
    console.error('[lead fro detail] champion check:', e?.message);
  }

  // Enrich leads with donor names + mobile
  const leadIds = calc.leads.map(l => l.donor_id).filter(Boolean);
  let donorMap = {};
  if (leadIds.length > 0) {
    const { data: donors } = await db
      .from('donor_profiles')
      .select('id, name, mobile_number')
      .in('id', leadIds);
    for (const d of donors || []) {
      donorMap[d.id] = { name: d.name, mobile: d.mobile_number };
    }
  }

  const enrichedLeads = calc.leads.map(l => ({
    ...l,
    donor_name: donorMap[l.donor_id]?.name || 'Unknown',
    donor_mobile: donorMap[l.donor_id]?.mobile || null,
  }));

  return {
    fro_id: froId,
    fro_name: froResult.data.name,
    date,
    target: calc.target,
    slab: calc.slab,
    amount_to_win: slab?.amount_to_win != null ? Number(slab.amount_to_win) : 1500,
    total_leads: calc.total_leads,
    qualified_leads: calc.qualified_leads,
    total_amount: calc.total_amount,
    lead_incentive: 0,
    slab_bonus: slabBonus,
    champion_bonus: 0,
    tier_bonus: tierBonus,
    total_incentive: totalIncentive,
    tier_mode: !!(tierInfo && tierInfo.tiers.length),
    reached_tier: reachedTier,
    tiers_final: tierInfo ? tierInfo.is_final : false,
    tiers: tierInfo ? tierInfo.tiers : [],
    tier_leaders: tierInfo ? tierInfo.leaders : [],
    leads: enrichedLeads,
  };
};

// All announced range champions for a date (one row per range), for FRO display.
export const getCurrentChampions = async (date) => {
  let q = db
    .from('lead_champion_announcements')
    .select('*')
    .order('created_at', { ascending: true });
  if (date) q = q.eq('announcement_date', date);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

// FRO-facing daily leaderboard: every active range's standings, the per-range
// champion (with photos) and whether the competition has any activity today.
// `includeWon` (admin view) keeps ranges that already have a champion visible so
// the admin strip still shows the live competition + winner management.
export const getFroRanks = async (date, { includeWon = false } = {}) => {
  const summary = await getDailySummary(date);
  const fros = summary.fros || [];
  const champions = summary.champions || [];
  let slabs = summary.slabs || [];
  const settings = summary.settings || {};

  // Ranges whose live competition was stopped by an admin for this date are
  // hidden from the FRO-facing leaderboard (corner card + big popup). Standings
  // stay computed for the admin summary/history, only the live view is cleared.
  const stopped = await getStoppedSlabIds();
  const stoppedForDate = new Set(
    (stopped || [])
      .filter(s => String(s.stopped_date).slice(0, 10) === String(date).slice(0, 10))
      .map(s => s.id),
  );
  if (stoppedForDate.size > 0) {
    slabs = slabs.filter(s => !stoppedForDate.has(s.id));
  }

  // Only RANGES WHOSE COMPETITION IS LIVE appear on the FRO leaderboard: a range
  // needs a started_at in the past and (if it has an ended_at) an ended_at still
  // in the future. Not-started and already-ended ranges are invisible to FROs.
  const nowMs = Date.now();
  slabs = slabs.filter(s => {
    if (!s.started_at) return false;
    if (new Date(s.started_at).getTime() > nowMs) return false;
    if (s.ended_at && new Date(s.ended_at).getTime() <= nowMs) return false;
    return true;
  });

  const ids = [...new Set(fros.map(f => f.fro_id))];
  const photoMap = {};
  if (ids.length > 0) {
    const { data: ws } = await db.from('workers').select('id, photo_url').in('id', ids);
    for (const w of ws || []) photoMap[w.id] = w.photo_url || null;
  }

  const champBySlab = {};
  for (const c of champions) champBySlab[c.slab_id] = c;
  const tiersBySlab = summary.tiers || {};
  const isTierSlab = (slabId) => !!tiersBySlab[slabId];

  // STOP-AFTER-WIN: a LEGACY range whose competition already produced a winner is
  // immediately removed from the FRO-facing live leaderboard. Tier-mode ranges
  // never stop mid-race — they keep racing and only settle at window end, so they
  // stay visible until their own window closes.
  if (!includeWon) {
    slabs = slabs.filter(s => isTierSlab(s.id) || !champBySlab[s.id]);
  }

  // Final tier winners keyed slab|fro -> tier_label (for member badges).
  const tierWinnerByKey = {};
  for (const c of champions) {
    if (c.tier_mode) tierWinnerByKey[`${c.slab_id}|${c.fro_id}`] = c.tier_label;
  }

  const ranges = [];
  for (const slab of slabs) {
    const members = fros
      .filter(f => f.slab && f.slab.id === slab.id)
      .sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0))
      .map(f => ({
        fro_id: f.fro_id,
        fro_name: f.fro_name,
        photo_url: photoMap[f.fro_id] || null,
        target: f.target || 0,
        qualified_leads: f.qualified_leads || 0,
        total_amount: f.total_amount || 0,
        lead_incentive: f.lead_incentive || 0,
        slab_bonus: f.slab_bonus || 0,
        champion_bonus: f.champion_bonus || 0,
        tier_bonus: f.tier_bonus || 0,
        reached_tier: f.reached_tier || null,
        total_incentive: f.total_incentive || 0,
        is_winner: !!((champBySlab[slab.id] && champBySlab[slab.id].fro_id === f.fro_id)
          || tierWinnerByKey[`${slab.id}|${f.fro_id}`]),
        won_tier_label: tierWinnerByKey[`${slab.id}|${f.fro_id}`] || null,
      }));
    if (members.length === 0) continue;

    const champ = champBySlab[slab.id];
    const tierInfo = tiersBySlab[slab.id] || null;
    ranges.push({
      slab_id: slab.id,
      slab_label: fmtRange(slab),
      amount_to_win: slab?.amount_to_win != null ? Number(slab.amount_to_win) : 1500,
      incentive_amount: Number(slab.incentive_amount) || 0,
      tier_mode: !!tierInfo,
      tiers_final: tierInfo ? tierInfo.is_final : false,
      tiers: tierInfo ? tierInfo.tiers : [],
      tier_leaders: tierInfo ? tierInfo.leaders : [],
      champion: champ ? {
        ...champ,
        photo_url: photoMap[champ.fro_id] || null,
      } : null,
      fros: members,
    });
  }

  const visibleChampions = champions.filter(c => !stoppedForDate.has(c.slab_id));
  const has_activity = visibleChampions.length > 0
    || fros.some(f => (f.qualified_leads || 0) > 0 && f.slab && !stoppedForDate.has(f.slab.id));
  const championsWithPhoto = visibleChampions.map(c => ({ ...c, photo_url: photoMap[c.fro_id] || null }));

  return { date, has_activity, ranges, champions: championsWithPhoto };
};

// Admin stops a range's live competition for a date: removes the range from the
// FRO-facing leaderboard for that date, deletes any today announcements for it,
// and clears the rule/winner popups (notification_log) sent to every panel so the
// competition is truly gone from all sides. The slab itself stays configured.
export const stopSlabCompetition = async ({ slabId, date, userId }) => {
  const targetDate = date || new Date().toISOString().slice(0, 10);

  // 1) Remove today's announcement rows for this range (champion banner/history).
  const { data: removed, error: delErr } = await db
    .from('lead_champion_announcements')
    .delete()
    .eq('announcement_date', targetDate)
    .eq('slab_id', slabId)
    .select('id');
  if (delErr) throw delErr;

  // 2) Drop the rule-update popups (single-range + all-ranges) sent to FROs.
  try {
    await db.from('notification_log').delete()
      .eq('type', 'lead_rule_update')
      .or(`reference_id.eq.${slabId},reference_id.eq.all-ranges`);
  } catch (e) { console.error('[lead rules stop] clear popups:', e?.message); }

  // 3) Drop champion notification rows for the removed announcements.
  const removedIds = (removed || []).map(r => String(r.id));
  if (removedIds.length > 0) {
    try {
      await db.from('notification_log').delete()
        .eq('type', 'lead_champion')
        .in('reference_id', removedIds);
    } catch (e) { console.error('[lead rules stop] clear banners:', e?.message); }
  }

  // 4) Mark the range stopped for this date so the FRO live view hides it.
  const { data: slab, error: updErr } = await db
    .from('incentive_slabs')
    .update({ stopped_date: targetDate, updated_at: new Date().toISOString() })
    .eq('id', slabId)
    .select()
    .single();
  if (updErr) throw updErr;

  return {
    ok: true,
    slab_id: slabId,
    stopped_date: targetDate,
    removed_announcements: removedIds.length,
    stoppedBy: userId || null,
    slab,
  };
};

// Admin stops ALL live range competitions for a date. Same behaviour as
// stopSlabCompetition but applied to every active range at once.
export const stopAllSlabsCompetition = async ({ date, userId }) => {
  const targetDate = date || new Date().toISOString().slice(0, 10);

  const { data: slabs } = await db
    .from('incentive_slabs')
    .select('id')
    .eq('is_active', true);
  const activeIds = (slabs || []).map(s => s.id);

  // 1) Remove every today announcement row.
  const { data: removed, error: delErr } = await db
    .from('lead_champion_announcements')
    .delete()
    .eq('announcement_date', targetDate)
    .select('id');
  if (delErr) throw delErr;

  // 2) Drop all rule-update popups (all-ranges + every single-range reference).
  try {
    const popupIds = [...activeIds.map(id => String(id)), 'all-ranges'];
    await db.from('notification_log').delete()
      .eq('type', 'lead_rule_update')
      .in('reference_id', popupIds);
  } catch (e) { console.error('[lead rules stop all] clear popups:', e?.message); }

  // 3) Drop champion notification rows for the removed announcements.
  const removedIds = (removed || []).map(r => String(r.id));
  if (removedIds.length > 0) {
    try {
      await db.from('notification_log').delete()
        .eq('type', 'lead_champion')
        .in('reference_id', removedIds);
    } catch (e) { console.error('[lead rules stop all] clear banners:', e?.message); }
  }

  // 4) Mark every active range stopped for this date.
  let updatedRecs = [];
  if (activeIds.length > 0) {
    const { data: updated, error: updErr } = await db
      .from('incentive_slabs')
      .update({ stopped_date: targetDate, updated_at: new Date().toISOString() })
      .eq('is_active', true)
      .in('id', activeIds)
      .select();
    if (updErr) throw updErr;
    updatedRecs = updated || [];
  }

  return {
    ok: true,
    stopped_date: targetDate,
    stopped_slabs: activeIds.length,
    removed_announcements: removedIds.length,
    stoppedBy: userId || null,
    slabs: updatedRecs,
  };
};

// Admin announces the range winners for a date. Locks each range's first-hitter
// into a snapshot row and broadcasts a notification per winner to every panel.
export const announceChampion = async ({ date, message, userId }) => {
  const targetDate = date || new Date().toISOString().slice(0, 10);

  const summary = await getDailySummary(targetDate);
  const winners = summary.champions || [];
  if (winners.length === 0) {
    return { error: 'No range winners yet for this date — no FRO has hit a range target' };
  }

  const inserted = [];
  const slabs = await getActiveSlabs();
  const slabById = {};
  for (const s of slabs || []) slabById[String(s.id)] = s;
  for (const w of winners) {
    const existing = await getAnnouncementByDateAndSlab(targetDate, w.slab_id, w.tier_key || null);
    if (existing) continue;
    const slab = slabById[String(w.slab_id)] || {};
    const row = await insertAnnouncement({
      announcement_date: targetDate,
      slab_id: w.slab_id,
      slab_label: w.slab_label,
      started_at: slab.started_at || null,
      ended_at: slab.ended_at || null,
      fro_worker_id: w.fro_id,
      fro_name: w.fro_name,
      total_leads: w.qualified_leads || 0,
      qualified_leads: w.qualified_leads || 0,
      total_amount: w.total_amount || 0,
      lead_incentive: w.lead_incentive || 0,
      slab_bonus: w.slab_bonus || 0,
      champion_bonus: w.champion_bonus || 0,
      total_incentive: w.total_incentive || 0,
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
      announced_by: userId || null,
      tier_key: w.tier_key || null,
      tier_label: w.tier_label || null,
      tier_target: w.tier_target != null ? w.tier_target : null,
    });
    inserted.push(row);
  }

  if (inserted.length > 0) {
    // Broadcast to all recipients via notification_log (one per winner).
    try {
      const recipients = await sql(RECIPIENT_SQL);
      if (recipients && recipients.length > 0) {
        const notifs = [];
        for (const ann of inserted) {
          const tierBit = ann.tier_label ? ` · ${ann.tier_label}` : '';
          const title = `🏆 Champion (${ann.slab_label || 'Range'}${tierBit}): ${ann.fro_name}`;
          const body = message && String(message).trim()
            ? String(message).trim()
            : (ann.tier_label
              ? `${ann.fro_name} won the ${ann.tier_label} tier (₹${fmtMoney(ann.tier_target)} target) in ${ann.slab_label || 'range'} on ${targetDate}! 🎉`
              : `${ann.fro_name} was first to hit the ${ann.slab_label || 'range'} target on ${targetDate}! 🎉`);
          for (const r of recipients) {
            notifs.push({ worker_id: r.id, type: 'lead_champion', title, body, reference_id: String(ann.id) });
          }
        }
        await sendNotificationLogs(notifs);
      }
    } catch (e) {
      console.error('[lead champion] notify:', e.message);
    }
  }

  return { announcements: inserted };
};

// FRO ids competing in ONE slab: explicit admin assignments win, everyone else
// falls in by monthly target bucket — the exact resolution the leaderboard
// uses, so only that range's FROs ever get its popups.
async function froIdsInSlab(slabId, activeSlabs) {
  const { data: froRows } = await db
    .from('workers')
    .select('id, created_at')
    .eq('is_active', true)
    .ilike('department', 'fro');
  if (!froRows || froRows.length === 0) return [];

  const assignments = await getAllSlabAssignments();
  const assignedSlab = {};
  for (const a of assignments || []) {
    if (a && a.fro_worker_id) assignedSlab[a.fro_worker_id] = a.slab_id;
  }

  const targetMap = await buildFroTargetMap(froRows, istDateString());

  const inSlab = [];
  for (const f of froRows) {
    const a = assignedSlab[f.id];
    if (a) {
      if (String(a) === String(slabId)) inSlab.push(f.id);
      continue;
    }
    const t = targetMap.get(String(f.id)) || 0;
    const bucket = getSlabForTarget(t, activeSlabs);
    if (bucket && String(bucket.id) === String(slabId)) inSlab.push(f.id);
  }
  return inSlab;
}

// Broadcast lead rule updates as notification_log rows of type
// 'lead_rule_update', which the FRO app surfaces as a side popup.
// - Single range ({ slab }): ONLY that range's FROs get the popup. Other
//   ranges are never disturbed. (Winner announcements still go to everyone.)
// - Apply-all ({ slabs }, no slab): every FRO gets ONE combined popup listing
//   every active range with the new common value.
export const notifyRangeRuleChange = async ({ slab, slabs }) => {
  const { data: froRows } = await db
    .from('workers')
    .select('id')
    .eq('is_active', true)
    .ilike('department', 'fro');
  const fros = froRows || [];
  if (fros.length === 0) return 0;

  const activeSlabs = slabs && slabs.length ? slabs : (await getActiveSlabs());

  // Apply-all: one combined popup per FRO covering every range.
  if (!slab && activeSlabs.length > 0) {
    const tiersMap = await getTiersForSlabs(activeSlabs.map(s => s.id));
    const body = activeSlabs
      .map(s => {
        const base = `₹${fmtMoney(s.min_amount)} – ₹${fmtMoney(s.max_amount)}`;
        const tiers = (tiersMap[s.id] || [])
          .filter(t => t.is_active !== false)
          .sort((a, b) => Number(a.target_amount) - Number(b.target_amount));
        if (tiers.length > 0) {
          return `${base}: ${tiers.map(t => `${tierLabelOf(t)} ₹${fmtMoney(t.target_amount)}→₹${fmtMoney(t.prize_amount)}`).join(' · ')}`;
        }
        return `${base}: Win on ₹${fmtMoney(s.amount_to_win)} collected · Prize ₹${fmtMoney(s.incentive_amount)}`;
      })
      .join('\n');
    const rows = fros.map(({ id: worker_id }) => ({
      worker_id,
      type: 'lead_rule_update',
      title: '📢 All Lead Ranges Updated',
      body,
      reference_id: 'all-ranges',
    }));
    await sendNotificationLogs(rows);
    return rows.length;
  }

  // Single range: only the FROs competing in it are told.
  if (!slab || !slab.id) return 0;
  const rangeLabel = `₹${fmtMoney(slab.min_amount)} – ₹${fmtMoney(slab.max_amount)}`;
  const amountToWin = slab.amount_to_win != null ? Number(slab.amount_to_win) : 1500;
  const prize = Number(slab.incentive_amount) || 0;
  const tiersMap = await getTiersForSlabs([slab.id]);
  const activeTiers = (tiersMap[slab.id] || [])
    .filter(t => t.is_active !== false)
    .sort((a, b) => Number(a.target_amount) - Number(b.target_amount));
  const body = activeTiers.length > 0
    ? `${rangeLabel}: Milestone prizes — ${activeTiers.map(t => `${tierLabelOf(t)}: collect ₹${fmtMoney(t.target_amount)} → win ₹${fmtMoney(t.prize_amount)}`).join(', ')}\nRace runs till the range ends; highest collection wins each tier.`
    : `${rangeLabel}: Win on ₹${fmtMoney(amountToWin)} collected · Prize ₹${fmtMoney(prize)}\nEvery verified lead counts. First FRO to reach ₹${fmtMoney(amountToWin)} in total today wins this range's prize!`;

  const ids = await froIdsInSlab(slab.id, activeSlabs);
  const rows = ids.map(worker_id => ({
    worker_id,
    type: 'lead_rule_update',
    title: '📢 Your Lead Range Updated',
    body,
    reference_id: String(slab.id),
  }));
  await sendNotificationLogs(rows);
  return rows.length;
};
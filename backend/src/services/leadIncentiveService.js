import db, { sql } from '../config/db.js';
import { getActiveSlabs } from '../models/incentiveSlabModel.js';
import { getSettings } from '../models/incentiveSettingsModel.js';
import {
  getAnnouncementByDate,
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

// Get FRO's monthly target (manual fro_monthly_targets takes priority, then incentive_targets)
async function getFroTarget(froId, month) {
  // Try fro_monthly_targets first (manual, NGO-admin set)
  const { data: froData } = await db
    .from('fro_monthly_targets')
    .select('target_amount')
    .eq('fro_worker_id', froId)
    .eq('month', month)
    .maybeSingle();
  if (froData && Number(froData.target_amount) > 0) {
    return Number(froData.target_amount);
  }

  // Fallback to incentive_targets (auto-generated)
  const { data: incData } = await db
    .from('incentive_targets')
    .select('target_amount')
    .eq('worker_id', froId)
    .eq('month', month)
    .maybeSingle();
  if (incData && Number(incData.target_amount) > 0) {
    return Number(incData.target_amount);
  }

  return 0;
}

// Calculate lead incentive for a single FRO on a given date
async function calculateFroLeadIncentive(froId, date, slabs, settings) {
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(date);
  endDate.setHours(23, 59, 59, 999);

  // Get month string for target lookup (YYYY-MM-01)
  const monthDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const monthStr = monthDate.toISOString().slice(0, 10);

  // Fetch FRO's target and determine slab
  const target = await getFroTarget(froId, monthStr);
  const slab = getSlabForTarget(target, slabs);

  // Fetch verified leads for this date
  const { data: leads } = await db
    .from('fro_donor_logs')
    .select('id, donor_id, amount_collected, verified_at')
    .eq('fro_worker_id', froId)
    .eq('action', 'disposition')
    .eq('disposition_detail', 'lead_done')
    .eq('accounts_status', 'verified')
    .gte('verified_at', startDate.toISOString())
    .lte('verified_at', endDate.toISOString())
    .order('verified_at', { ascending: false });

  const allLeads = leads || [];
  // Per-range rules: each slab/range carries its own Minimum Lead Amount and
  // ₹ per Qualified Lead. Fall back to the old global settings if missing.
  const minLead = slab && slab.min_lead_amount != null
    ? Number(slab.min_lead_amount)
    : (Number(settings.min_lead_amount) || 300);
  const leadRate = slab && slab.lead_rate != null
    ? Number(slab.lead_rate)
    : (Number(settings.lead_rate) || 20);

  // Filter qualified leads (amount >= range's min_lead_amount)
  const qualifiedLeads = allLeads.filter(l => Number(l.amount_collected) >= minLead);
  const totalAmount = qualifiedLeads.reduce((sum, l) => sum + (Number(l.amount_collected) || 0), 0);

  const leadIncentive = qualifiedLeads.length * leadRate;
  const slabBonus = slab ? Number(slab.incentive_amount) || 0 : 0;

  return {
    target,
    slab,
    total_leads: allLeads.length,
    qualified_leads: qualifiedLeads.length,
    total_amount: totalAmount,
    lead_incentive: leadIncentive,
    slab_bonus: slabBonus,
    leads: allLeads.map(l => ({
      id: l.id,
      donor_id: l.donor_id,
      amount: Number(l.amount_collected) || 0,
      qualified: Number(l.amount_collected) >= minLead,
      verified_at: l.verified_at,
    })),
  };
}

// Get full daily summary for all FROs
export const getDailySummary = async (date) => {
  const [slabs, settings, frosResult] = await Promise.all([
    getActiveSlabs(),
    getSettings(),
    db.from('workers').select('id, name').eq('is_active', true).ilike('department', 'fro').order('name'),
  ]);

  const fros = frosResult.data || [];
  const results = [];

  for (const fro of fros) {
    const calc = await calculateFroLeadIncentive(fro.id, date, slabs, settings);
    results.push({
      fro_id: fro.id,
      fro_name: fro.name,
      ...calc,
      slab_bonus: calc.slab_bonus,
      champion_bonus: 0,
      total_incentive: calc.lead_incentive + calc.slab_bonus,
    });
  }

  // Determine champion: FRO with highest total_amount from qualified leads
  const sorted = [...results].sort((a, b) => b.total_amount - a.total_amount);
  const champion = sorted[0] && sorted[0].total_amount > 0 ? sorted[0] : null;

  if (champion) {
    champion.champion_bonus = settings.champion_bonus;
    champion.total_incentive += settings.champion_bonus;
  }

  // Sort final results by total_incentive descending
  results.sort((a, b) => b.total_incentive - a.total_incentive);

  return {
    date,
    slabs,
    settings,
    fros: results,
    champion: champion ? {
      fro_id: champion.fro_id,
      fro_name: champion.fro_name,
      total_amount: champion.total_amount,
      bonus: settings.champion_bonus,
    } : null,
  };
};

// Get single FRO detail with individual leads
export const getFroDetail = async (froId, date) => {
  const [slabs, settings, froResult] = await Promise.all([
    getActiveSlabs(),
    getSettings(),
    db.from('workers').select('id, name').eq('id', froId).maybeSingle(),
  ]);

  if (!froResult.data) return null;

  const calc = await calculateFroLeadIncentive(froId, date, slabs, settings);

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
    total_leads: calc.total_leads,
    qualified_leads: calc.qualified_leads,
    total_amount: calc.total_amount,
    lead_incentive: calc.lead_incentive,
    slab_bonus: calc.slab_bonus,
    champion_bonus: 0,
    total_incentive: calc.lead_incentive + calc.slab_bonus,
    leads: enrichedLeads,
  };
};

// Get the current/latest champion announcement for FRO-facing display.
export const getCurrentChampion = async (date) => {
  let q = db
    .from('lead_champion_announcements')
    .select('*')
    .order('announcement_date', { ascending: false })
    .limit(1);
  if (date) q = q.eq('announcement_date', date);
  const { data, error } = await q;
  if (error) throw error;
  return (data && data[0]) || null;
};

// Admin announces the champion for a date. Locks the current top FRO into a
// snapshot and broadcasts a notification to every panel.
export const announceChampion = async ({ date, message, userId }) => {
  const targetDate = date || new Date().toISOString().slice(0, 10);

  // Refuse if already announced for this date.
  const existing = await getAnnouncementByDate(targetDate);
  if (existing) {
    return { error: 'Champion already announced for this date' };
  }

  const summary = await getDailySummary(targetDate);
  const champion = summary.champion;
  if (!champion) {
    return { error: 'No leads found for this date to announce' };
  }

  const settings = summary.settings;
  const froRow = summary.fros.find(f => f.fro_id === champion.fro_id);

  const announcement = await insertAnnouncement({
    announcement_date: targetDate,
    fro_worker_id: champion.fro_id,
    fro_name: champion.fro_name,
    total_leads: froRow?.total_leads || 0,
    qualified_leads: froRow?.qualified_leads || 0,
    total_amount: champion.total_amount,
    lead_incentive: froRow?.lead_incentive || 0,
    slab_bonus: froRow?.slab_bonus || 0,
    champion_bonus: settings.champion_bonus,
    total_incentive: froRow ? froRow.total_incentive : champion.total_amount,
    message: typeof message === 'string' && message.trim() ? message.trim() : null,
    announced_by: userId || null,
  });

  // Broadcast to all recipients via notification_log.
  try {
    const rows = await sql(RECIPIENT_SQL);
    if (rows && rows.length > 0) {
      const title = `🏆 Champion: ${champion.fro_name}`;
      const body = message && String(message).trim()
        ? String(message).trim()
        : `${champion.fro_name} collected ₹${fmtMoney(champion.total_amount)} from ${froRow?.qualified_leads || 0} qualified leads → total incentive ₹${fmtMoney(announcement.total_incentive)}! 🎉`;
      await sendNotificationLogs(rows.map(r => ({
        worker_id: r.id,
        type: 'lead_champion',
        title,
        body,
        reference_id: String(announcement.id),
      })));
    }
  } catch (e) {
    console.error('[lead champion] notify:', e.message);
  }

  return { announcement };
};

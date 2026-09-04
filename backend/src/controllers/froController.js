import db from '../config/db.js';
import { getWorkerById, getWorkerBySession } from '../models/workerModel.js';
import { enrichDonorProfileFromReceipt } from '../models/bankAuditModel.js';
import { findAutoMatches } from '../services/autoMatchService.js';
import { getActiveSalaryByWorker } from '../models/salaryModel.js';
import {
  batchCreateAssignments,
  findAssignmentById,
  updateAssignmentStatus,
  getDashboardStats,
  createScheduledContact,
  completeAllScheduledByAssignment,
  getScheduledByAssignment,
} from '../models/froAssignmentModel.js';
import { getTargetByWorker } from '../models/froTargetModel.js';
import {
  createDonorLog,
  ensureLogSequenceHealth,
  findDispositionLogToday,
  updateDonorLog,
  findLogsByDonorAndWorker,
  findLogsByAssignment,
  getTotalCollectedByWorker,
  getCollectedByNgo,
  getTotalCollectedByAssignment,
  getTotalCollectedByDonorAndWorker,
  getVerifiedCollection,
  getUnverifiedCollection,
  getDailyCollectionByWorker,
  COLLECTION_DATE_OR,
  logCollectionDate,
  paymentDiscriminant,
  inRange,
} from '../models/froDonorLogModel.js';
import { getAchievements } from '../models/dailyAchievementModel.js';
import { getDayName, calculateAKI, getMonthsEmployed, getAKISlabs } from '../utils/incentive.js';
import { istDayBounds, istDateString, firstOfNextMonthIstUtc, startOfNextIstDayUtc } from '../utils/ist.js';
import { reconcileQueue, getNextQueueRow, markShown, markDisposed, countQueueRows, cycleKey, getActiveQueueRows, clearActiveRowsNotIn, classifyDisposition, removeFromQueue } from '../models/workQueueModel.js';

async function findOrCreateAssignment(donorId, workerId, ngoId) {
  // 1) Worker already owns an active assignment for this donor (and ngo).
  let query = db
    .from('fro_assignments')
    .select('id, station')
    .eq('donor_id', donorId)
    .eq('fro_worker_id', workerId)
    .not('status', 'eq', 'reassigned');
  if (ngoId) query = query.eq('ngo_id', ngoId);
  const { data: existing } = await query.maybeSingle();
  if (existing) return existing;

  // 2) Resolve ngo from the donor profile when the caller did not pass one.
  if (!ngoId) {
    const { data: donor } = await db
      .from('donor_profiles')
      .select('ngo')
      .eq('id', donorId)
      .single();
    if (!donor) return null;
    const { data: ngo } = await db
      .from('ngos')
      .select('id')
      .eq('name', donor.ngo)
      .maybeSingle();
    ngoId = ngo?.id || null;
  }
  if (!ngoId) return null;

  // 3) Claim an unassigned lead (fro_worker_id is null) for this ngo.
  const { data: unassigned } = await db
    .from('fro_assignments')
    .select('id, station')
    .eq('donor_id', donorId)
    .is('fro_worker_id', null)
    .eq('ngo_id', ngoId)
    .not('status', 'eq', 'reassigned')
    .maybeSingle();
  if (unassigned) {
    await db
      .from('fro_assignments')
      .update({ fro_worker_id: workerId, assigned_at: new Date().toISOString() })
      .eq('id', unassigned.id);
    return unassigned;
  }

  // 4) Claim the donor's existing assignment for this ngo when it falls in the
  //    worker's (station, ngo) scope and the current owner no longer covers
  //    that scope (orphaned rows left behind by staff changes). Creating a new
  //    row instead would violate fro_assignments' unique (donor_id, ngo_id)
  //    constraint, and reassigning from an active co-worker would steal it.
  const { data: myStationRows } = await db
    .from('fro_station_assignments')
    .select('station, ngo_id')
    .eq('fro_worker_id', workerId);
  const scopePairs = new Set((myStationRows || [])
    .filter(s => s.ngo_id && s.station)
    .map(s => `${s.station}|${s.ngo_id}`));
  if (scopePairs.size > 0) {
    const { data: candidates } = await db
      .from('fro_assignments')
      .select('id, station, fro_worker_id')
      .eq('donor_id', donorId)
      .eq('ngo_id', ngoId)
      .not('status', 'eq', 'reassigned')
      .limit(20);
    for (const c of candidates || []) {
      if (!c.fro_worker_id || c.fro_worker_id === workerId) continue;
      if (!scopePairs.has(`${c.station}|${ngoId}`)) continue;
      const { data: ownerScope } = await db
        .from('fro_station_assignments')
        .select('id')
        .eq('fro_worker_id', c.fro_worker_id)
        .eq('station', c.station)
        .eq('ngo_id', ngoId)
        .limit(1);
      if (!ownerScope || ownerScope.length === 0) {
        await db
          .from('fro_assignments')
          .update({ fro_worker_id: workerId, assigned_at: new Date().toISOString() })
          .eq('id', c.id);
        return { id: c.id, station: c.station };
      }
    }
  }

  // 5) Create the worker's own row (only possible when no (donor_id, ngo_id)
  //    row exists yet).
  //
  // Ghost-row guard: a (donor_id, ngo_id) pair must resolve to exactly ONE
  // fro_assignments row, otherwise a donor can surface twice (or flip tabs via
  // a batch_type=NULL row) and re-add "already handled" leads. Before INSERTing
  // a fresh row, reuse ANY existing row for this (donor_id, ngo_id) that falls
  // in the worker's (station, ngo) scope — even one stamped reassigned/owned by
  // another FRO who no longer covers that scope — instead of duplicating it.
  if (ngoId != null) {
    const { data: anyRows } = await db
      .from('fro_assignments')
      .select('id, station, fro_worker_id')
      .eq('donor_id', donorId)
      .eq('ngo_id', ngoId)
      .limit(20);
    for (const c of (anyRows || [])) {
      if (myStationRows && scopePairs.size > 0 && scopePairs.has(`${c.station}|${ngoId}`)) {
        // This row is already inside the worker's scope; claim it if it isn't
        // already theirs (e.g. an orphan/reassigned row left by a staff change).
        if (!c.fro_worker_id || c.fro_worker_id === workerId) {
          if (c.fro_worker_id !== workerId) {
            await db
              .from('fro_assignments')
              .update({ fro_worker_id: workerId, assigned_at: new Date().toISOString() })
              .eq('id', c.id);
          }
          return { id: c.id, station: c.station };
        }
      }
    }
  }

  const myStation = (myStationRows || []).find(s => s.ngo_id === ngoId);
  const { data: created } = await db
    .from('fro_assignments')
    .insert({ donor_id: donorId, fro_worker_id: workerId, ngo_id: ngoId, status: 'pending', station: myStation?.station || null, assigned_at: new Date().toISOString() })
    .select('id, station')
    .single();
  if (created) return created;

  // 6) Re-query fallback (e.g., concurrent create).
  const { data: retry } = await db
    .from('fro_assignments')
    .select('id, station')
    .eq('donor_id', donorId)
    .eq('fro_worker_id', workerId)
    .not('status', 'eq', 'reassigned')
    .maybeSingle();
  return retry;
}

// Scope guard: does this FRO hold an active assignment for the donor? Used to
// block IDOR reads/writes on donors outside the worker's assigned scope.
async function getFroAssignment(donorId, workerId, ngoId) {
  let query = db
    .from('fro_assignments')
    .select('id, ngo_id')
    .eq('donor_id', donorId)
    .eq('fro_worker_id', workerId)
    .not('status', 'eq', 'reassigned');
  if (ngoId) query = query.eq('ngo_id', ngoId);
  const { data } = await query.maybeSingle();
  return data || null;
}

async function getMyStationNames(workerId) {
  const { data: stationAssigns, error } = await db
    .from('fro_station_assignments')
    .select('station')
    .eq('fro_worker_id', workerId);
  if (error) throw error;
  return (stationAssigns || []).map(s => s.station);
}

// Station restriction for impersonated ("work as") sessions: when the token
// carries act_stations, the operator may only touch those (ngo_id, station)
// pairs — every data surface funnels through getMyStationScope below.
export function froActPairs(req) {
  const u = req?.user;
  if (!u?.impersonation || !Array.isArray(u.act_stations)) return null;
  return u.act_stations.length > 0 ? u.act_stations : null;
}

async function getMyStationScope(workerId, restrictPairs = null) {
  const { data: stationAssigns, error } = await db
    .from('fro_station_assignments')
    .select('station, ngo_id')
    .eq('fro_worker_id', workerId);
  if (error) throw error;
  let scope = (stationAssigns || []).map(s => ({ station: s.station, ngo_id: s.ngo_id }));
  if (restrictPairs && restrictPairs.length > 0) {
    const allowed = new Set(restrictPairs.map(p => `${p?.ngo_id ?? ''}|${String(p?.station ?? '').trim()}`));
    scope = scope.filter(s => allowed.has(`${s.ngo_id ?? ''}|${String(s.station).trim()}`));
  }
  const stationNames = scope.map(s => s.station);
  const allowedNgoIds = [...new Set(scope.map(s => s.ngo_id).filter(Boolean))];
  return { scope, stationNames, allowedNgoIds };
}

function withStationNgoPairs(queryBuilder, scope, stationCol = 'station', ngoCol = 'ngo_id') {
  if (!scope || scope.length === 0) return queryBuilder;
  const validPairs = scope.filter(s => s.ngo_id && s.station);
  if (validPairs.length === 0) return queryBuilder;
  const stations = [...new Set(validPairs.map(s => s.station))];
  queryBuilder = queryBuilder.in(stationCol, stations);
  const pairs = validPairs.map(s => `and(${stationCol}.eq.${s.station},${ngoCol}.eq.${s.ngo_id})`);
  queryBuilder = queryBuilder.or(pairs.join(','));
  return queryBuilder;
}

// Defense-in-depth: withStationNgoPairs applies the strict (station, ngo_id) pair
// filter at SQL level for all columns, but callers that join through an embedded
// resource (e.g. fro_donor_logs -> fro_assignments) also enforce it here in JS so
// other NGOs' donors in the same station can never leak into the response.
function filterByScope(rows, scope, getPair) {
  const pairs = new Set(scope.filter(s => s.station && s.ngo_id).map(s => `${s.station}|${s.ngo_id}`));
  if (pairs.size === 0) return rows || [];
  return (rows || []).filter(r => pairs.has(getPair(r)));
}

async function chunkedInQuery(ids, queryFn, chunkSize = 1000) {
  const allData = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await queryFn(chunk);
    if (error) throw error;
    if (data) allData.push(...data);
  }
  return allData;
}

// Fetches donation evidence for the worker's assignments. Logs are matched by
// assignment_id (fro_assignments.ngo_id already reflects the NGO the worker is
// allocated to); imported receipts are matched by (donor_id, project_id) where
// project_id = the NGO name lowercased — so a donation only counts toward the
// exact NGO the FRO holds the donor in, never leaking across NGOs. The "current
// period" flag is sized to the donor's frequency (monthly / quarterly /
// half_yearly / yearly / one_time) and dated from the actual donation date
// (transaction_datetime -> verified_at -> created_at), not the log's created_at.
// Returns per-assignment sets (keyed by assignment id) plus per-(donor, project)
// receipt sets so callers can build NGO-scoped flags and row totals.
async function fetchScopedDonationEvidence({ assignments, donorIds, projectSet, oneYearAgo }) {
  const assignmentIds = (assignments || []).map(a => a.id);
  const assignmentDonorMap = new Map();
  for (const a of assignments || []) assignmentDonorMap.set(a.id, a.donor_id);

  const logRows = (assignmentIds && assignmentIds.length > 0)
    ? await chunkedInQuery(assignmentIds, chunk => {
        let q = db
          .from('fro_donor_logs')
          .select('assignment_id, accounts_status, action, disposition_detail, created_at, transaction_datetime, verified_at')
          .in('assignment_id', chunk)
          .gte('created_at', oneYearAgo);
        return q;
      })
    : [];

  const receiptRows = (donorIds && donorIds.length > 0 && projectSet && projectSet.length > 0)
    ? await chunkedInQuery(donorIds, chunk =>
        db
          .from('receipts')
          .select('donor_id, project_id, receipt_date')
          .in('donor_id', chunk)
          .in('project_id', projectSet)
      )
    : [];

  const donorTypeMap = {};
  if (donorIds && donorIds.length > 0) {
    const profiles = await chunkedInQuery(donorIds, chunk =>
      db.from('donor_profiles').select('id, donor_type, donation_frequency').in('id', chunk)
    );
    for (const p of profiles || []) donorTypeMap[p.id] = p.donor_type || p.donation_frequency || '';
  }

  const activeAssignmentIds = new Set();
  const periodDonatedAssignmentIds = new Set();
  const periodVerifiedAssignmentIds = new Set();
  const verifiedAssignmentIds = new Set();

  const sinceDate = new Date(oneYearAgo);
  const now = new Date();

  for (const l of logRows || []) {
    const isDonation = l.action === 'donation';
    const isLeadDoneVerified = l.disposition_detail === 'lead_done' && l.accounts_status === 'verified';
    if (!isDonation && !isLeadDoneVerified) continue;
    activeAssignmentIds.add(l.assignment_id);
    if (l.accounts_status === 'verified') verifiedAssignmentIds.add(l.assignment_id);
    const donorId = assignmentDonorMap.get(l.assignment_id);
    const periodStart = periodStartForType(donorTypeMap[donorId] || '', now);
    const donationDate = new Date(l.transaction_datetime || l.verified_at || l.created_at);
    if (!isNaN(donationDate) && donationDate >= periodStart) {
      periodDonatedAssignmentIds.add(l.assignment_id);
      if (l.accounts_status === 'verified') periodVerifiedAssignmentIds.add(l.assignment_id);
    }
  }

  const receiptPairs = new Set();
  const receiptRecentPairs = new Set();
  const receiptPeriodPairs = new Set();
  for (const r of receiptRows || []) {
    const key = `${r.donor_id}|${(r.project_id || '').toLowerCase()}`;
    receiptPairs.add(key);
    if (r.receipt_date) {
      const d = new Date(r.receipt_date);
      if (d >= sinceDate) receiptRecentPairs.add(key);
      if (d >= periodStartForType(donorTypeMap[r.donor_id] || '', now)) receiptPeriodPairs.add(key);
    }
  }

  return {
    activeAssignmentIds,
    periodDonatedAssignmentIds,
    periodVerifiedAssignmentIds,
    verifiedAssignmentIds,
    receiptPairs,
    receiptRecentPairs,
    receiptPeriodPairs,
  };
}

// Start of the current donation window for a donor's frequency. Defaults to the
// current calendar month for monthly/unknown donors.
function periodStartForType(type, now = new Date()) {
  const t = (type || '').toLowerCase();
  if (t === 'quarterly') {
    const q = Math.floor(now.getMonth() / 3);
    return new Date(now.getFullYear(), q * 3, 1, 0, 0, 0, 0);
  }
  if (t === 'half_yearly') {
    return new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1, 0, 0, 0, 0);
  }
  if (t === 'yearly') {
    return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  }
  if (t === 'one_time') {
    return new Date(2000, 0, 1, 0, 0, 0, 0);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function getMonthRange(dateStr) {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function calculateAutoTarget(salary, monthsEmployed) {
  if (monthsEmployed <= 0) return salary * 1;
  if (monthsEmployed === 1) return salary * 2.5;
  if (monthsEmployed === 2) return salary * 3;
  return null;
}

const STATUS_PRIORITY = [
  'pending',
  'contacted',
  'follow_up',
  'scheduled',
  'busy', 'ringing', 'call_waiting', 'switched_off', 'out_of_coverage', 'unreachable', 'wrong_number', 'invalid_number', 'rejected', 'temporary_network_issue', 'voicemail',
  'visit_donate',
  'will_donate_online',
  'promise_to_pay',
  'payment_pending',
  'already_donated',
  'email_sent', 'whatsapp_sent',
  'not_interested', 'not_interested_now', 'dnd', 'wrong_person',
  'language_barrier',
  'transferred_senior',
  'query_complaint',
  'receipt_request',
  'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'call_disconnected',
  'lead_done',
  'donation_collected',
];

export const getDashboard = async (req, res) => {
  try {
    const workerId = req.user.id;

    // Count donors by this FRO's stations (from fro_assignments)
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    let totalDonors = 0;
    let assignedByNgo = {};
    let assignedByStation = {};
    let assignedByType = {};
    if (stationNames.length > 0) {
      const { data: assignedRows } = await withStationNgoPairs(
        db
          .from('fro_assignments')
          .select('donor_id, ngo_id, station, batch_type')
          .in('station', stationNames)
          .not('status', 'eq', 'reassigned'),
        myScope
      );
      const rows = assignedRows || [];
      totalDonors = new Set(rows.map(a => a.donor_id)).size;
      for (const row of rows) {
        if (row.ngo_id) assignedByNgo[row.ngo_id] = (assignedByNgo[row.ngo_id] || 0) + 1;
        if (row.station) assignedByStation[row.station] = (assignedByStation[row.station] || 0) + 1;
        const type = row.batch_type || 'unknown';
        assignedByType[type] = (assignedByType[type] || 0) + 1;
      }
    }
    const ngoIds = Object.keys(assignedByNgo).filter(Boolean);
    const ngoMap = {};
    if (ngoIds.length > 0) {
      const { data: ngos } = await db.from('ngos').select('id, name').in('id', ngoIds);
      for (const n of ngos || []) ngoMap[n.id] = n.name;
    }
    const assignedData = {
      byNgo: Object.entries(assignedByNgo).map(([id, count]) => ({ ngo_id: id, ngo_name: ngoMap[id] || 'Unknown', count })),
      byStation: Object.entries(assignedByStation).map(([station, count]) => ({ station, count })),
      byType: Object.entries(assignedByType).map(([type, count]) => ({ type, count })),
    };

    const stats = await getDashboardStats(workerId);
    stats.total = totalDonors;
    const worker = await getWorkerBySession(req.user);
    if (!worker) return res.status(404).json({ message: 'Worker not found' });
    const salary = await getActiveSalaryByWorker(workerId);
    const currentSalary = salary ? parseFloat(salary.salary) : 0;

    const now = new Date();
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const monthStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
    const monthEnd = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();
    const monthStr = now.toISOString().slice(0, 7) + '-01';
    const creditWorkerId = req.user.impersonation && req.user.imposter_id ? req.user.imposter_id : workerId;

    const collected = await getTotalCollectedByWorker(creditWorkerId, monthStart, monthEnd);

    const joinedAt = new Date(worker.created_at);
    const monthDiff = (now.getFullYear() - joinedAt.getFullYear()) * 12 + (now.getMonth() - joinedAt.getMonth());
    const monthsEmployed = monthDiff + (now.getDate() >= joinedAt.getDate() ? 0 : -1);

    let target;
    let targetSource;
    const manualTarget = await getTargetByWorker(workerId, monthStr);
    const autoTarget = calculateAutoTarget(currentSalary, monthsEmployed);
    if (autoTarget !== null) {
      target = autoTarget;
      targetSource = monthsEmployed <= 0 ? 'month1' : monthsEmployed === 1 ? 'month2' : 'month3';
    } else {
      target = manualTarget ? parseFloat(manualTarget.target_amount) : 0;
      targetSource = manualTarget ? 'manual' : 'not_set';
    }

    const achieved_target = manualTarget?.achieved_target != null ? parseFloat(manualTarget.achieved_target) : null;

    const todayStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0));
    const todayEnd = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 23, 59, 59, 999));

    const verifiedMonth = await getVerifiedCollection(creditWorkerId, monthStart, monthEnd);
    const unverifiedMonth = await getUnverifiedCollection(creditWorkerId, monthStart, monthEnd);
    const verifiedToday = await getVerifiedCollection(creditWorkerId, todayStart.toISOString(), todayEnd.toISOString());
    const unverifiedToday = await getUnverifiedCollection(creditWorkerId, todayStart.toISOString(), todayEnd.toISOString());

    const fyYear = istNow.getUTCMonth() < 3 ? istNow.getUTCFullYear() - 1 : istNow.getUTCFullYear();
    const fyStart = new Date(fyYear, 3, 1);

    const [
      monthlyConnectedRes, dailyConnectedRes, dailyDonationsRes, totalDonationsRes, assignmentsRes,
      leadDoneAllRes, fyDonorsRes, todayDonorsRes, monthDonorsRes,
    ] = stationNames.length > 0
      ? await Promise.all([
          withStationNgoPairs(db.from('fro_donor_logs').select('donor_id, fro_assignments!inner(station, ngo_id)').in('fro_assignments.station', stationNames).gte('created_at', monthStart).lte('created_at', monthEnd), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
          withStationNgoPairs(db.from('fro_donor_logs').select('donor_id, fro_assignments!inner(station, ngo_id)').in('fro_assignments.station', stationNames).gte('created_at', todayStart.toISOString()).lte('created_at', todayEnd.toISOString()), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
          withStationNgoPairs(db.from('fro_donor_logs').select('amount_collected, action, disposition_detail, accounts_status, created_at, transaction_datetime, verified_at, fro_assignments!inner(station, ngo_id)').in('fro_assignments.station', stationNames).or(COLLECTION_DATE_OR(todayStart.toISOString(), todayEnd.toISOString())), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
          withStationNgoPairs(db.from('fro_donor_logs').select('amount_collected, fro_assignments!inner(station, ngo_id)').in('fro_assignments.station', stationNames).or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified)'), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
          withStationNgoPairs(db.from('fro_assignments').select('status, donor_id').in('station', stationNames).not('status', 'eq', 'reassigned'), myScope),
          withStationNgoPairs(db.from('fro_donor_logs').select('donor_id, created_at, fro_assignments!inner(station, ngo_id)').in('fro_assignments.station', stationNames).eq('action', 'disposition').eq('disposition_detail', 'lead_done').eq('accounts_status', 'verified'), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
          withStationNgoPairs(db.from('fro_donor_logs').select('donor_id, created_at, fro_assignments!inner(station, ngo_id)').in('fro_assignments.station', stationNames).or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified)').gte('created_at', fyStart.toISOString()), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
          withStationNgoPairs(db.from('fro_donor_logs').select('donor_id, fro_assignments!inner(station, ngo_id)').in('fro_assignments.station', stationNames).or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified)').gte('created_at', todayStart.toISOString()).lte('created_at', todayEnd.toISOString()), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
          withStationNgoPairs(db.from('fro_donor_logs').select('donor_id, fro_assignments!inner(station, ngo_id)').in('fro_assignments.station', stationNames).or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified)').gte('created_at', monthStart).lte('created_at', monthEnd), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

    const pairOf = l => `${l.fro_assignments?.station}|${l.fro_assignments?.ngo_id}`;
    monthlyConnectedRes.data = filterByScope(monthlyConnectedRes.data, myScope, pairOf);
    dailyConnectedRes.data = filterByScope(dailyConnectedRes.data, myScope, pairOf);
    dailyDonationsRes.data = filterByScope(dailyDonationsRes.data, myScope, pairOf);
    totalDonationsRes.data = filterByScope(totalDonationsRes.data, myScope, pairOf);
    leadDoneAllRes.data = filterByScope(leadDoneAllRes.data, myScope, pairOf);
    fyDonorsRes.data = filterByScope(fyDonorsRes.data, myScope, pairOf);
    todayDonorsRes.data = filterByScope(todayDonorsRes.data, myScope, pairOf);
    monthDonorsRes.data = filterByScope(monthDonorsRes.data, myScope, pairOf);

    const connectedStatuses = new Set(['contacted', 'donation_collected', 'lead_done', 'done', 'follow_up', 'scheduled', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'callback']);
    const donorInfo = new Map();
    for (const a of assignmentsRes.data || []) {
      if (!donorInfo.has(a.donor_id)) {
        donorInfo.set(a.donor_id, { connected: false });
      }
      if (a.status !== 'reassigned' && connectedStatuses.has(a.status)) {
        donorInfo.get(a.donor_id).connected = true;
      }
    }
    let dataUsed = 0, dataUnused = 0;
    for (const [, d] of donorInfo) {
      if (d.connected) dataUsed++;
      else dataUnused++;
    }

    const monthlyDonorIds = new Set((monthlyConnectedRes.data || []).map(l => l.donor_id).filter(Boolean));
    const dailyDonorIds = new Set((dailyConnectedRes.data || []).map(l => l.donor_id).filter(Boolean));
    const todayISO = todayStart.toISOString();
    const todayEndISO = todayEnd.toISOString();
    let dailyDonations = 0;
    for (const l of dailyDonationsRes.data || []) {
      if (!inRange(logCollectionDate(l), todayISO, todayEndISO)) continue;
      dailyDonations += parseFloat(l.amount_collected || 0);
    }
    let totalDonations = 0;
    for (const l of totalDonationsRes.data || []) totalDonations += parseFloat(l.amount_collected || 0);

    // New donors: first lead_done per donor
    const earliestLeadDone = {};
    for (const log of leadDoneAllRes.data || []) {
      if (!earliestLeadDone[log.donor_id] || log.created_at < earliestLeadDone[log.donor_id]) {
        earliestLeadDone[log.donor_id] = log.created_at;
      }
    }
    const todayStr = todayStart.toISOString();
    const todayEndStr = todayEnd.toISOString();
    const newDonorsToday = Object.entries(earliestLeadDone)
      .filter(([_, date]) => date >= todayStr && date <= todayEndStr).length;
    const newDonorsMonthly = Object.entries(earliestLeadDone)
      .filter(([_, date]) => date >= monthStart && date <= monthEnd).length;

    // Reactivated: donors who donated in period but had no donation in FY before the period
    const fyBeforeTodayDonors = new Set();
    const fyBeforeMonthDonors = new Set();
    for (const log of fyDonorsRes.data || []) {
      if (log.created_at < todayStr) fyBeforeTodayDonors.add(log.donor_id);
      if (log.created_at < monthStart) fyBeforeMonthDonors.add(log.donor_id);
    }
    const todayDonorSet = new Set((todayDonorsRes.data || []).map(l => l.donor_id).filter(Boolean));
    const monthDonorSet = new Set((monthDonorsRes.data || []).map(l => l.donor_id).filter(Boolean));
    const reactivatedToday = [...todayDonorSet].filter(id => !fyBeforeTodayDonors.has(id)).length;
    const reactivatedMonthly = [...monthDonorSet].filter(id => !fyBeforeMonthDonors.has(id)).length;

    // FRO-specific reactivations: donors THIS worker reactivated (donated today/month but no prior donation in FY).
    // Own-money rule: match on the log's collector only. Cross-FRO verifications reuse
    // another FRO's assignment, so station-pair scoping used to hide them here.
    let froReactivatedToday = 0, froReactivatedMonthly = 0;
    {
      // Get donations by this FRO worker today
      const { data: froTodayDonors } = await db
        .from('fro_donor_logs')
        .select('donor_id')
        .eq('fro_worker_id', workerId)
        .or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified)')
        .gte('created_at', todayStart.toISOString())
        .lte('created_at', todayEnd.toISOString());

      const { data: froMonthDonors } = await db
        .from('fro_donor_logs')
        .select('donor_id')
        .eq('fro_worker_id', workerId)
        .or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified)')
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd);

      const { data: froFyDonors } = await db
        .from('fro_donor_logs')
        .select('donor_id, created_at')
        .eq('fro_worker_id', workerId)
        .or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified)')
        .gte('created_at', fyStart.toISOString());

      const todayStr = todayStart.toISOString();
      const fyBeforeTodayDonorsSet = new Set();
      const fyBeforeMonthDonorsSet = new Set();
      for (const log of froFyDonors || []) {
        if (log.created_at < todayStr) fyBeforeTodayDonorsSet.add(log.donor_id);
        if (log.created_at < monthStart) fyBeforeMonthDonorsSet.add(log.donor_id);
      }

      const froTodayDonorSet = new Set((froTodayDonors || []).map(l => l.donor_id).filter(Boolean));
      const froMonthDonorSet = new Set((froMonthDonors || []).map(l => l.donor_id).filter(Boolean));
      froReactivatedToday = [...froTodayDonorSet].filter(id => !fyBeforeTodayDonorsSet.has(id)).length;
      froReactivatedMonthly = [...froMonthDonorSet].filter(id => !fyBeforeMonthDonorsSet.has(id)).length;
    }

    // Active donors: those who donated within the last 1 year
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const donorsWithRecentDonations = stationNames.length > 0
      ? filterByScope(
          (await withStationNgoPairs(
            db
              .from('fro_donor_logs')
              .select('donor_id, fro_assignments!inner(station, ngo_id)')
              .in('fro_assignments.station', stationNames)
              .or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified)')
              .gte('created_at', oneYearAgo.toISOString()),
            myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'
          )).data || [],
          myScope,
          l => `${l.fro_assignments?.station}|${l.fro_assignments?.ngo_id}`
        )
      : [];

    const activeDonorIds = new Set(donorsWithRecentDonations.map(d => d.donor_id).filter(Boolean));
    let activeDonors = 0, inactiveDonors = 0;
    for (const [donorId] of donorInfo) {
      if (activeDonorIds.has(donorId)) activeDonors++;
      else inactiveDonors++;
    }

    const { data: myAtt } = await db
      .from('attendance')
      .select('status')
      .eq('worker_id', workerId)
      .eq('date', todayStart.toISOString().slice(0, 10))
      .maybeSingle();
    const is_punched_in = myAtt && (myAtt.status === 'present' || myAtt.status === 'late');

    return res.json({
      worker: {
        is_active: worker.is_active !== false,
        is_punched_in,
      },
      target: {
        amount: target,
        source: targetSource,
        collected,
        achieved: achieved_target,
        salary: currentSalary,
        months_employed: monthsEmployed,
      },
      stats,
      connected: {
        monthly: monthlyDonorIds.size,
        daily: dailyDonorIds.size,
      },
      donations: {
        daily: dailyDonations,
        total: totalDonations,
        new_donors: {
          today: newDonorsToday,
          monthly: newDonorsMonthly,
        },
      },
      reactivations: {
        today: reactivatedToday,
        monthly: reactivatedMonthly,
        fro_today: froReactivatedToday,
        fro_monthly: froReactivatedMonthly,
      },
      donors: {
        active: activeDonors,
        inactive: inactiveDonors,
      },
      verification: {
        month: {
          verified: { amount: verifiedMonth.amount, count: verifiedMonth.count },
          unverified: { amount: unverifiedMonth.amount, count: unverifiedMonth.count },
        },
        today: {
          verified: { amount: verifiedToday.amount, count: verifiedToday.count },
          unverified: { amount: unverifiedToday.amount, count: unverifiedToday.count },
        },
      },
      data: {
        used: dataUsed,
        unused: dataUnused,
      },
      assignedData,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// List this month's collections for the "Collected" card modal.
// Own-money rule: every fro_donor_logs row credited to this worker (fro_worker_id)
// is THEIR collection, regardless of which (station, ngo) assignment the donor sits
// in — cross-FRO manual verifies, work-as and receipt auto-credits reuse another
// FRO's assignment, so filtering by the assignment pair used to hide them here.
// Rows whose assignment belongs to another FRO, or whose NGO is outside this
// worker's access, are grouped under the "Others" tab; the rest keep their real
// NGO tab. For work-as rows the owning FRO's identity is masked so the operator
// cannot tell which FRO the donor belonged to.
// Supports optional ?ngo_id= query param to return only that tab's rows.
export const getMyCollections = async (req, res) => {
  try {
    const workerId = req.user.id;
    const worker = await getWorkerBySession(req.user);
    if (!worker) return res.status(404).json({ message: 'Worker not found' });
    const { scope: myScope, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    const ngoFilter = (req.query.ngo_id && allowedNgoIds.includes(req.query.ngo_id)) ? req.query.ngo_id : null;

    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    let monthStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
    const lastDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 0)).getUTCDate();
    let monthEnd = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), lastDay, 23, 59, 59, 999)).toISOString();

    const creditWorkerName = req.user.impersonation && req.user.imposter_name ? String(req.user.imposter_name).trim() : (worker.name || '').trim();
    const workerName = creditWorkerName;
    let monthStartDay = monthStart.slice(0, 10);
    let monthEndDay = monthEnd.slice(0, 10);

    const monthParam = String(req.query.month || '').trim();
    if (monthParam && monthParam !== 'current') {
      let y;
      let m;
      if (monthParam === 'prev' || monthParam === 'last' || monthParam === 'previous') {
        const d = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1));
        d.setUTCMonth(d.getUTCMonth() - 1);
        y = d.getUTCFullYear();
        m = d.getUTCMonth();
      } else {
        const mt = /^(\d{4})-(\d{2})$/.exec(monthParam);
        if (!mt) return res.status(400).json({ message: 'Invalid month. Use YYYY-MM, "current", or "prev".' });
        y = Number(mt[1]);
        m = Number(mt[2]) - 1;
      }
      if (!(y >= 2000 && y <= 2100 && m >= 0 && m <= 11)) {
        return res.status(400).json({ message: 'Invalid month' });
      }
      const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const end = new Date(Date.UTC(y, m, lastDay, 23, 59, 59, 999));
      monthStartDay = start.toISOString().slice(0, 10);
      monthEndDay = end.toISOString().slice(0, 10);
      monthStart = start.toISOString();
      monthEnd = end.toISOString();
    }

    const { data: receipts, error } = await db
      .from('receipts')
      .select('id, donor_id, amount, project_id, receipt_date, receipt_no, agent_name, payment_id, donor_name, donor_mobile, mode')
      .ilike('agent_name', workerName)
      .gte('receipt_date', monthStartDay)
      .lte('receipt_date', monthEndDay);
    if (error) throw error;

    const { data: allNgos } = await db.from('ngos').select('id, name');
    const normProj = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    const projToNgo = new Map();
    for (const [canon, aliases] of Object.entries(NGO_PROJECT_ALIASES)) {
      const ngoRow = (allNgos || []).find((n) => {
        const nn = normProj(n.name);
        return nn === canon || nn.includes(canon) || aliases.some((a) => normProj(a) === nn);
      });
      if (!ngoRow) continue;
      projToNgo.set(normProj(canon), ngoRow);
      for (const a of aliases) projToNgo.set(normProj(a), ngoRow);
    }
    for (const n of allNgos || []) {
      const k = normProj(n.name);
      if (k && !projToNgo.has(k)) projToNgo.set(k, n);
    }

    const ngoMap = {};
    for (const s of myScope) {
      if (s.ngo_id && !ngoMap[s.ngo_id]) ngoMap[s.ngo_id] = null;
    }
    const ngoIds = Object.keys(ngoMap);
    if (ngoIds.length > 0) {
      const { data: ngoRows } = await db.from('ngos').select('id, name').in('id', ngoIds);
      for (const n of ngoRows || []) ngoMap[n.id] = n.name;
    }

    const seen = new Set();
    const collections = [];
    for (const r of receipts || []) {
      const amount = parseFloat(r.amount || 0);
      if (amount <= 0) continue;

      const dedupKey = `${r.receipt_no || ''}|${r.donor_id || ''}|${amount}|${r.receipt_date || ''}|${r.payment_id || ''}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      let tabNgoId = null;
      let tabNgoName = null;
      if (r.project_id) {
        const ngoRow = projToNgo.get(normProj(r.project_id)) || null;
        if (ngoRow) { tabNgoId = ngoRow.id; tabNgoName = ngoRow.name; }
      }
      if (!tabNgoId) {
        tabNgoId = allowedNgoIds[0] || allNgos[0]?.id || null;
        tabNgoName = allNgos?.find((n) => n.id === tabNgoId)?.name || null;
      }
      if (tabNgoId && !Object.prototype.hasOwnProperty.call(ngoMap, tabNgoId)) ngoMap[tabNgoId] = tabNgoName;
      if (ngoFilter && tabNgoId !== ngoFilter) continue;

      collections.push({
        id: r.id,
        donor_id: r.donor_id,
        donor_name: r.donor_name || 'Unknown',
        donor_mobile: r.donor_mobile || '',
        amount_collected: amount,
        collected_at: r.receipt_date || null,
        ngo_id: tabNgoId,
        ngo_name: tabNgoName,
        receipt_no: r.receipt_no != null ? String(r.receipt_no) : null,
        owner_worker_id: workerId,
        owner_name: workerName,
        is_work_as: false,
      });
    }

    collections.sort((a, b) => new Date(b.collected_at || 0) - new Date(a.collected_at || 0));

    const ngos = Object.entries(ngoMap).map(([id, name]) => ({ id, name: name || 'Unknown' }));

    return res.json({
      month: monthStart.slice(0, 7),
      collections,
      ngos,
      ngoMap,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── Suspense receipts (this month only) + claims ────────────
// IST current-month bounds shared by the suspense endpoints.
function currentMonthBoundsIST() {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(new Date().getTime() + istOffset);
  const monthStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0, 0));
  const lastDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 0)).getUTCDate();
  const monthEnd = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), lastDay, 23, 59, 59, 999));
  return { month: monthStart.toISOString().slice(0, 7), monthStart: monthStart.toISOString().slice(0, 10), monthEnd: monthEnd.toISOString().slice(0, 10) };
}

// Every project_id value a receipt can legitimately carry for an NGO. Mirrors
// the keyword classification the accounts bank-audit page uses (matchesNgo), so
// a FRO assigned to 'MANN' also sees receipts whose project_id is spelled as
// 'manncar' or 'mann care' alongside the canonical 'mann' series.
const NGO_PROJECT_ALIASES = {
  bsct: ['bsct', 'beingsevak', 'being sevak', 'sevak'],
  mann: ['mann', 'manncar', 'mann care'],
  aflf: ['aflf', 'ashray'],
};

async function myProjectSet(workerId, restrictPairs = null) {
  const { allowedNgoIds } = await getMyStationScope(workerId, restrictPairs);
  if (allowedNgoIds.length === 0) return [];
  const { data: ngos } = await db.from('ngos').select('id, name').in('id', allowedNgoIds);
  const names = (ngos || []).map(n => n.name.toLowerCase()).filter(Boolean);
  const aliases = new Set();
  for (const n of names) {
    aliases.add(n);
    const byKey = NGO_PROJECT_ALIASES[n];
    if (byKey) byKey.forEach(a => aliases.add(a));
  }
  return [...aliases];
}

export const getSuspenseReceipts = async (req, res) => {
  try {
    const workerId = req.user.id;
    // Suspense is a shared pool: every FRO sees their assigned NGO AND all
    // other NGOs' unclaimed receipts here (NGO pills on the frontend filter).
    const { month } = currentMonthBoundsIST();

    const { data: entries, error: eErr } = await db
      .from('bank_audit_entries')
      .select('id, receipt_id, receipt_no, payer_name, amount, transaction_date, payment_time, project_id, payment_id, check_id, source_id, agent_name, verify_fro_worker_id')
      .eq('status', 'unverified')
      .is('matched_lead_log_id', null);
    if (eErr) throw eErr;

    const receiptLinked = (entries || []).filter(e => e.receipt_id);
    const receiptIds = [...new Set(receiptLinked.map(e => e.receipt_id))];
    let receiptMap = {};
    if (receiptIds.length > 0) {
      const { data: receipts } = await db
        .from('receipts')
          .select('id, log_id, donor_name, donor_mobile, amount, receipt_date, receipt_time, project_id')
        .in('id', receiptIds);
      for (const r of (receipts || [])) receiptMap[r.id] = r;
    }

    const pool = receiptLinked.map(e => {
      const r = receiptMap[e.receipt_id] || {};
      // Receipt already linked to a lead (credited to an FRO) — skip.
      if (r.log_id) return null;
      return {
        id: e.receipt_id,
        entry_id: e.id,
        receipt_no: e.receipt_no || r.receipt_no || null,
        donor_name: r.donor_name || e.payer_name || null,
        donor_mobile: r.donor_mobile || null,
        amount: r.amount || e.amount,
        receipt_date: r.receipt_date || e.transaction_date,
        receipt_time: r.receipt_time || e.payment_time,
        project_id: r.project_id || e.project_id,
        payment_id: e.payment_id || null,
        has_receipt: true,
        // Only an explicit Accounts assignment (manual-verify save) parks an
        // entry as "waiting for receipt number". A missing receipt number alone
        // must NOT block claiming: rejected/unlinked receipts and bank-statement
        // imports create numberless suspense receipts, and numbers are allocated
        // automatically at claim/verify time.
        waiting_receipt_no: !!e.verify_fro_worker_id,
      };
    }).filter(Boolean);

    for (const e of entries || []) {
      if (e.receipt_id) continue;
      pool.push({
        id: `entry-${e.id}`,
        entry_id: e.id,
        receipt_no: e.receipt_no || null,
        donor_name: e.payer_name || null,
        donor_mobile: null,
        amount: e.amount,
        receipt_date: e.transaction_date,
        receipt_time: e.payment_time,
        project_id: e.project_id,
        payment_id: e.payment_id || null,
        has_receipt: false,
        waiting_receipt_no: !!e.verify_fro_worker_id,
      });
    }

    const poolIds = pool.filter(r => r.has_receipt).map(r => r.id);
    let claims = [];
    if (poolIds.length > 0) {
      const { data: c, error: cErr } = await db
        .from('receipt_claims')
        .select('receipt_id, fro_worker_id, status')
        .in('receipt_id', poolIds);
      if (cErr) throw cErr;
      claims = c || [];
    }

    const claimCountByReceipt = {};
    const myClaimStatusByReceipt = {};
    for (const cl of claims) {
      claimCountByReceipt[cl.receipt_id] = (claimCountByReceipt[cl.receipt_id] || 0) + 1;
      if (cl.fro_worker_id === workerId && !myClaimStatusByReceipt[cl.receipt_id]) {
        myClaimStatusByReceipt[cl.receipt_id] = cl.status;
      }
    }

    const result = pool.map(r => ({
      id: r.id,
      receipt_no: r.receipt_no,
      donor_name: r.donor_name,
      donor_mobile: r.donor_mobile,
      amount: parseFloat(r.amount || 0),
      receipt_date: r.receipt_date,
      receipt_time: r.receipt_time,
      project_id: r.project_id,
      payment_id: r.payment_id || null,
      kind: r.has_receipt ? 'entry' : 'no_receipt',
      waiting_receipt_no: r.waiting_receipt_no || false,
      _bank_audit_entry_id: r.entry_id,
      claim_count: claimCountByReceipt[r.id] || 0,
      my_claim_status: myClaimStatusByReceipt[r.id] || null,
    }));

    return res.json({ month, receipts: result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Search the FRO's own receipt history (any linked or past receipts in their
// project scope) by donor name/mobile so the suspense claim modal can auto-fill
// donor details even when the donor has no profile inside the FRO's station
// scope. donor_id is intentionally left null: these rows are a fallback for
// donors the normal in-scope search misses, and passing a linked id would hit
// the "allotted donors only" guard on claim; the claim then resolves/creates
// the profile through the normal name-based path.
export const searchSuspenseDonors = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);

    const projectSet = await myProjectSet(workerId, froActPairs(req));
    if (projectSet.length === 0) return res.json([]);

    const term = `%${q.trim()}%`;
    const { data: receipts, error } = await db
      .from('receipts')
      .select('id, donor_id, donor_name, donor_mobile, pan_number, address, email, project_id, receipt_date')
      .in('project_id', projectSet)
      .or(`donor_mobile.ilike.${term},donor_name.ilike.${term}`)
      .order('receipt_date', { ascending: false })
      .limit(25);
    if (error) throw error;
    if (!receipts || receipts.length === 0) return res.json([]);

    // Resolve city from linked donor profiles for a richer auto-fill.
    const linkedIds = [...new Set(receipts.map(r => r.donor_id).filter(Boolean))];
    const cityById = {};
    if (linkedIds.length > 0) {
      const { data: profiles } = await db
        .from('donor_profiles')
        .select('id, city')
        .in('id', linkedIds);
      for (const p of (profiles || [])) cityById[p.id] = p.city;
    }

    const seen = new Set();
    const result = [];
    for (const r of receipts) {
      const mobile = (r.donor_mobile || '').replace(/\D/g, '');
      const key = r.donor_id ? `id:${r.donor_id}` : `mob:${mobile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        donor_id: null,
        donor_name: r.donor_name || '',
        donor_mobile: r.donor_mobile || '',
        donor_city: cityById[r.donor_id] || '',
        donor_address: r.address || '',
        donor_pan: r.pan_number || '',
        donor_email: r.email || '',
        project_id: r.project_id || '',
        source: 'receipt',
      });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Best-effort: when an FRO claims a suspense receipt, write the donor details
// they provided (prefilled from their donor pick, editable) onto the linked
// bank_audit_entries row so the Accounts Bank Audit card shows them right after
// the claim, before Accounts verifies. Never blocks the claim if the entry
// lookup/write fails.
const linkClaimDonorToAuditEntry = async (receiptId, donorId, details) => {
  if (!receiptId || !donorId) return;
  const fill = {};
  const mobile = (details?.donor_mobile || '').trim();
  const email = (details?.donor_email || '').trim();
  const pan = (details?.donor_pan || '').trim();
  const city = (details?.donor_city || '').trim();
  const address = (details?.donor_address || '').trim();
  if (mobile) fill.donor_mobile = mobile;
  if (email) fill.donor_email = email;
  if (pan) fill.donor_pan = pan;
  if (city) fill.donor_city = city;
  if (address) fill.donor_address_1 = address;
  if (Object.keys(fill).length === 0) return;
  fill.donor_id = donorId;
  try {
    const { data: entries } = await db
      .from('bank_audit_entries')
      .select('id')
      .eq('receipt_id', receiptId);
    for (const entry of (entries || [])) {
      await db.from('bank_audit_entries').update(fill).eq('id', entry.id);
    }
  } catch (e) {
    console.error('Link claim donor to audit entry failed:', e.message);
  }
};

// Find the bank audit entry that represents the same money as a claimed
// suspense receipt (matched by payment id, falling back to receipt_id). The
// entry — not the FRO's claim input or the receipt's own fields — is the
// source of truth for the money's UPI id and transaction date, so its values
// drive the pending lead created by the claim.
const findClaimAuditEntry = async (receipt, claimUpiId = '') => {
  if (!receipt?.id) return null;
  const paymentId = String(receipt.payment_id || '').trim();
  const typedUpi = String(claimUpiId || '').trim();
  try {
    if (paymentId || typedUpi) {
      const key = paymentId || typedUpi;
      const { rows } = await db._pool.query(
        `SELECT * FROM bank_audit_entries
         WHERE upper(trim(coalesce(payment_id, ''))) = upper($1)
         ORDER BY (status = 'verified') ASC, (matched_lead_log_id IS NOT NULL) ASC, id ASC
         LIMIT 1`,
        [key]
      );
      if (rows?.[0]) return rows[0];
    }
    const { data } = await db
      .from('bank_audit_entries')
      .select('*')
      .eq('receipt_id', receipt.id)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch (e) {
    console.error('Suspense claim audit entry lookup failed:', e.message);
    return null;
  }
};

// Link the claimed money's audit entry to the pending lead so the audit shows
// the money once (with the claim pill) instead of a separate unlinked entry.
// Never relinks an entry that is already verified or matched to a different
// lead; never blocks the claim if the link fails.
const linkClaimAuditEntry = async (entry, receiptId, logId, workerId, donorId, workerName) => {
  if (!entry?.id) return;
  if (entry.status === 'verified') return;

  const alreadyLinkedToDifferentLog = entry.matched_lead_log_id != null && String(entry.matched_lead_log_id) !== String(logId);

  const patch = {
    updated_at: new Date().toISOString(),
    agent_name: workerName || null,
  };

  if (!alreadyLinkedToDifferentLog) {
    patch.receipt_id = receiptId;
    patch.matched_lead_log_id = logId;
    patch.match_status = 'matched';
    patch.match_source = 'manual';
    patch.matched_by = workerId;
    patch.matched_at = new Date().toISOString();
    patch.donor_id = donorId || entry.donor_id || null;
    if (!entry.match_no) {
      try {
        const { rows } = await db._pool.query("SELECT nextval('bank_audit_match_no_seq') AS n");
        patch.match_no = 'MTCH-' + String(rows[0].n).padStart(6, '0');
      } catch (e) { console.error('Match no allocation failed:', e.message); }
    }
  }

  try {
    await db.from('bank_audit_entries').update(patch).eq('id', entry.id);
  } catch (e) {
    console.error('Suspense claim audit entry link failed:', e.message);
  }
};

export const claimSuspenseReceipt = async (req, res) => {
  try {
    const workerId = req.user.id;
    // When working-as another FRO, the collection credit goes to the operator
    // (imposter) while donor/assignment ownership stays with the impersonated FRO.
    const creditWorkerId = req.user.impersonation && req.user.imposter_id != null ? req.user.imposter_id : workerId;
    const creditWorkerName = req.user.impersonation && req.user.imposter_name ? req.user.imposter_name : req.user.name;
    const rawId = (req.params.receiptId || '').trim();
    const { donor_id, donor_name, donor_mobile, donor_city, donor_email, donor_pan, donor_address, upi_transaction_id, transaction_datetime, notes, screenshot_url } = req.body || {};
    let donorId = donor_id ? parseInt(donor_id, 10) : null;
    const explicitDonor = donorId !== null;
    let donorName = (donor_name || '').trim();
    if (!donorId && !donorName) return res.status(400).json({ message: 'Select a donor to claim this receipt' });

    const projectSet = await myProjectSet(workerId, froActPairs(req));

    // Handle entry-XXX IDs (bank audit entries without a linked receipt):
    // auto-create a suspense receipt and link it, then continue the normal
    // claim flow so the FRO can claim raw bank-audit rows.
    // If THIS request authors a brand-new suspense receipt but the claim fails
    // later, track it so the failure path can roll it back and keep the entry
    // fully claimable (not stuck as "Waiting for receipt number").
    let createdReceiptId = null;
    let rollbackEntryId = null;
    let receiptId = parseInt(rawId, 10);
    if (!receiptId && rawId.startsWith('entry-')) {
      const entryId = parseInt(rawId.slice(6), 10);
      if (!entryId) return res.status(400).json({ message: 'Invalid entry ID' });
      const { data: entry, error: eErr } = await db
        .from('bank_audit_entries')
        .select('id, amount, transaction_date, payment_time, project_id, payer_name, receipt_no, receipt_id')
        .eq('id', entryId)
        .single();
      if (eErr || !entry) return res.status(404).json({ message: 'Bank audit entry not found' });
      if (entry.receipt_id) {
        // Already linked — just continue with that receipt
        receiptId = entry.receipt_id;
      } else {
        // Create a minimal suspense receipt from the entry data
        const receiptDate = entry.transaction_date || new Date().toISOString().slice(0, 10);
        const { data: newReceipt, error: crErr } = await db
          .from('receipts')
          .insert({
            project_id: entry.project_id || 'bsct',
            amount: entry.amount || 0,
            receipt_date: receiptDate,
            receipt_time: entry.payment_time || null,
            donor_name: donorName || entry.payer_name || null,
            payment_id: entry.payment_id || null,
            agent_name: creditWorkerName || null,
          })
          .select('id, donor_id, log_id, project_id, receipt_date, receipt_time, amount, donor_name, donor_mobile, payment_id, mode, pan_number, address, email, bank_payer_name')
          .single();
        if (crErr || !newReceipt) return res.status(500).json({ message: 'Failed to create receipt from bank entry: ' + (crErr?.message || 'unknown') });
        createdReceiptId = newReceipt.id;
        rollbackEntryId = entryId;
        // Link the entry to the new receipt
        try {
          await db.from('bank_audit_entries').update({ receipt_id: newReceipt.id, receipt_no: entry.receipt_no || null }).eq('id', entryId);
        } catch (e) { console.error('Failed to link bank entry to new receipt:', e.message); }
        receiptId = newReceipt.id;
      }
    }
    if (!receiptId) return res.status(400).json({ message: 'Receipt ID is required' });

    const { data: receipt, error: rErr } = await db
      .from('receipts')
      .select('id, donor_id, log_id, project_id, receipt_date, receipt_time, amount, donor_name, donor_mobile, payment_id, mode, pan_number, address, email, bank_payer_name')
      .eq('id', receiptId)
      .single();
    if (rErr || !receipt) return res.status(404).json({ message: 'Receipt not found' });

    // Detect "receipt_sent" entries: receipt has a donor but no log (no FRO assigned).
    const isReceiptSent = receipt.donor_id != null && receipt.log_id == null;
    if (!isReceiptSent) {
      if (receipt.donor_id) return res.status(409).json({ message: 'This receipt is already linked to a donor' });
      if (receipt.log_id) return res.status(409).json({ message: 'This receipt has already been claimed' });
    }

    // For receipt_sent entries, pre-fill the donor from the receipt so the FRO
    // sees the existing donor but can override if the bank name was wrong.
    if (isReceiptSent && !donorId) {
      donorId = receipt.donor_id;
      donorName = receipt.donor_name || donorName;
    }

    // FROs may claim any suspense receipt whenever they want (no current-month
    // restriction): the pool lists unverified entries from any month, so the
    // claim must accept them too.

    // Best-effort real-donor resolution: when the FRO supplies a UPI
    // transaction id, match it against collected leads (preferring this FRO's
    // own) so the claim links to the canonical donor profile even when the
    // bank spells the payer's name differently. No match is fine — the claim
    // falls through to the normal pick/create below.
    const claimUpiId = (upi_transaction_id || '').trim();
    if (claimUpiId) {
      let upiLogs = [];
      try {
        const { rows } = await db._pool.query(
          `SELECT id, donor_id, fro_worker_id, transaction_datetime
           FROM fro_donor_logs
           WHERE upper(trim(upi_transaction_id)) = upper(trim($1))
             AND donor_id IS NOT NULL
           ORDER BY (fro_worker_id = $2) DESC, created_at DESC`,
          [claimUpiId, workerId]
        );
        upiLogs = rows || [];
      } catch (e) {
        console.error('Suspense claim UPI donor lookup failed:', e.message);
      }
      if (upiLogs.length > 0) {
        let matchLog = upiLogs[0];
        if (transaction_datetime) {
          const claimDate = new Date(transaction_datetime).toDateString();
          const sameDay = upiLogs.find(l =>
            l.transaction_datetime && new Date(l.transaction_datetime).toDateString() === claimDate
          );
          if (sameDay) matchLog = sameDay;
        }
        const { data: upiDonor } = await db
          .from('donor_profiles')
          .select('id, name')
          .eq('id', matchLog.donor_id)
          .maybeSingle();
        if (upiDonor) {
          donorId = upiDonor.id;
          donorName = upiDonor.name;
        }
      }
    }

    // Resolve the donor: prefer an explicit donor_id (selected from the FRO's
    // own donor search); otherwise resolve by name (create a profile if none
    // matches) so the claimed receipt and its pending lead can be linked.
    if (donorId) {
      const { data: found, error: dErr } = await db
        .from('donor_profiles')
        .select('id, name')
        .eq('id', donorId)
        .single();
      if (dErr || !found) throw Object.assign(new Error('Donor not found'), { status: 404 });
      donorName = found.name;
      // Update the existing donor profile with any edits the FRO made in the
      // claim form so Lead Verification shows the latest data.
      const donorUpdate = {};
      if (donor_name) donorUpdate.name = donor_name;
      if (donor_mobile) donorUpdate.mobile_number = donor_mobile;
      if (donor_city) donorUpdate.city = donor_city;
      if (donor_email) donorUpdate.email = donor_email;
      if (donor_pan) donorUpdate.pan_number = donor_pan;
      if (donor_address) donorUpdate.address_1 = donor_address;
      if (Object.keys(donorUpdate).length > 0) {
        donorUpdate.updated_at = new Date().toISOString();
        await db.from('donor_profiles').update(donorUpdate).eq('id', donorId);
      }
    } else {
      const { data: existingDonor } = await db
        .from('donor_profiles')
        .select('id')
        .ilike('name', donorName)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingDonor) {
        donorId = existingDonor.id;
      } else if (donor_mobile) {
        const { data: mobDonor } = await db
          .from('donor_profiles')
          .select('id')
          .eq('mobile_number', donor_mobile)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (mobDonor) {
          donorId = mobDonor.id;
        } else {
          const { data: createdDonor, error: donorErr } = await db
            .from('donor_profiles')
            .insert({
              name: donorName,
              mobile_number: donor_mobile || `NOCELL-${Date.now()}`,
              city: donor_city || null,
              email: donor_email || null,
              pan_number: donor_pan || null,
              address_1: donor_address || null,
              project_supported: receipt.project_id,
            })
            .select()
            .single();
          if (donorErr) throw donorErr;
          donorId = createdDonor.id;
        }
      } else {
        const { data: createdDonor, error: donorErr } = await db
          .from('donor_profiles')
          .insert({
            name: donorName,
            mobile_number: `NOCELL-${Date.now()}-${workerId}`,
            city: donor_city || null,
            email: donor_email || null,
            pan_number: donor_pan || null,
            address_1: donor_address || null,
            project_supported: receipt.project_id,
          })
          .select()
          .single();
        if (donorErr) throw donorErr;
        donorId = createdDonor.id;
      }
    }

    const { data: resolvedDonor } = await db
      .from('donor_profiles')
      .select('name')
      .eq('id', donorId)
      .maybeSingle();
    const claimedDonorName = resolvedDonor?.name || donorName || 'a donor';

    // Pull the receipt's real money data onto the lead so the pending lead in
    // Lead Verification is already filled: UPI txn id, MOP, sender, PAN. The
    // FRO's explicit claim input always wins; the receipt fills the rest.
    const effectiveUpi = ((upi_transaction_id || '').trim()) || receipt.payment_id || null;
    const effectiveMode = (receipt.mode || '').trim() || null;
    const effectiveFrom = (receipt.bank_payer_name || receipt.donor_name || '').trim() || null;
    const effectivePan = (receipt.pan_number || '').trim() || null;

    try { await enrichDonorProfileFromReceipt(donorId, receipt); }
    catch (e) { console.error('Failed to enrich donor profile from suspense receipt:', e.message); }

    // Only allow claiming for a donor allotted to this FRO's station scope
    // (enforced for donors selected from the FRO's own donor search).
    if (explicitDonor) {
      const { scope: myScope, stationNames } = await getMyStationScope(workerId, froActPairs(req));
      if (stationNames.length > 0) {
        const scopePairs = new Set((myScope || []).filter(s => s.ngo_id && s.station).map(s => `${s.station}|${s.ngo_id}`));
        const { data: donorAssignments } = await db
          .from('fro_assignments')
          .select('id, station, ngo_id')
          .eq('donor_id', donorId)
          .not('status', 'eq', 'reassigned');
        const hasScoped = (donorAssignments || []).some(a => scopePairs.has(`${a.station}|${a.ngo_id}`));
        if (!hasScoped) throw Object.assign(new Error('You can only claim receipts for your allotted donors'), { status: 403 });
      }
    }

    const txDateTime = transaction_datetime
      ? new Date(transaction_datetime).toISOString()
      : (receipt.receipt_date
          ? (receipt.receipt_time
              ? new Date(`${receipt.receipt_date}T${receipt.receipt_time}`).toISOString()
              : new Date(receipt.receipt_date).toISOString())
          : null);

    // The bank audit entry for this money is the source of truth for the lead's
    // UPI id and transaction date: whatever the FRO typed or the receipt
    // carries, the audit entry's values win. The entry is also linked to the
    // claim so the audit shows this money once (with the claim) instead of a
    // separate unlinked entry. The FRO-typed UPI id is part of the lookup so
    // the entry is found even when the receipt has no payment_id/receipt_id.
    const auditEntry = await findClaimAuditEntry(receipt, claimUpiId);
    const auditUpi = auditEntry?.payment_id ? String(auditEntry.payment_id).trim() : null;
    const auditFrom = auditEntry?.payer_name ? String(auditEntry.payer_name).trim() : null;
    const auditMode = auditEntry?.mode || (auditEntry?.payment_id ? 'UPI' : (auditEntry?.check_id ? 'Cheque' : 'Bank Transfer'));
    const auditTxn = auditEntry?.transaction_date
      ? (() => {
          const d = String(auditEntry.transaction_date);
          const datePart = d.includes('T') ? d.slice(0, 10) : d;
          return auditEntry.payment_time ? `${datePart}T${auditEntry.payment_time}` : datePart;
        })()
      : null;

    const finalUpi = auditUpi || effectiveUpi;
    const finalFrom = auditFrom || effectiveFrom;
    const finalMode = auditMode || effectiveMode;
    const finalTxn = auditTxn || txDateTime;

    // Make the receipt's own payment_id point at the audit entry's id so the
    // receipt <-> entry link is durable for future lookups.
    if (auditUpi && !receipt.payment_id) {
      try {
        await db.from('receipts').update({ payment_id: auditUpi }).eq('id', receipt.id);
        receipt.payment_id = auditUpi;
      } catch (e) { console.error('Failed to backfill receipt payment id from audit entry:', e.message); }
    }

    // Dedup removed: each claimed receipt now creates its own lead in Lead
    // Verification so accounts sees every payment separately.

    // Resolve the receipt's project_id to an ngo_id first — the assignment must
    // match the receipt's NGO, not just any prior assignment for this donor.
    const { data: ngoRow } = await db
      .from('ngos')
      .select('id, name')
      .ilike('name', receipt.project_id)
      .maybeSingle();
    const receiptNgoId = ngoRow?.id || null;
    if (!receiptNgoId) throw Object.assign(new Error('Could not resolve the NGO for this receipt'), { status: 400 });

    // Attach to the donor's open assignment owned by THIS claiming FRO for THIS
    // NGO (or open a fresh one) so the created lead shows up in Lead Verification
    // and credits the claimant — never another worker's or another NGO's assignment.
    const { data: assignment } = await db
      .from('fro_assignments')
      .select('id, fro_worker_id')
      .eq('donor_id', donorId)
      .eq('fro_worker_id', workerId)
      .eq('ngo_id', receiptNgoId)
      .neq('status', 'reassigned')
      .maybeSingle();

    let assignmentId = assignment?.id;
    if (!assignmentId) {
      const { scope: claimScope } = await getMyStationScope(workerId, froActPairs(req));
      const scopeRow = (claimScope || []).find(s => s.ngo_id === receiptNgoId);
      const { data: created, error: asgErr } = await db
        .from('fro_assignments')
        .insert({
          donor_id: donorId,
          fro_worker_id: workerId,
          ngo_id: receiptNgoId,
          station: scopeRow?.station || null,
          status: 'lead_done',
          assigned_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (asgErr) throw asgErr;
      assignmentId = created.id;
    }

    // Never collide with an explicit-id row from a data migration/import: keep
    // the id sequence ahead of the table's max id before this insert.
    await ensureLogSequenceHealth();

    const { data: log, error: logErr } = await db
      .from('fro_donor_logs')
      .insert({
        assignment_id: assignmentId,
        donor_id: donorId,
        fro_worker_id: creditWorkerId,
        action: 'disposition',
        disposition_detail: 'lead_done',
        amount_collected: receipt.amount,
        accounts_status: 'pending',
        payment_screenshot_url: screenshot_url || null,
        remark: notes || null,
        upi_transaction_id: finalUpi,
        payment_mode: finalMode,
        payment_from: finalFrom,
        pan_number: effectivePan,
        transaction_datetime: finalTxn,
        created_by: creditWorkerId,
      })
      .select()
      .single();
    if (logErr) throw logErr;

    const { error: updErr } = await db.from('receipts').update({ log_id: log.id, agent_name: creditWorkerName }).eq('id', receiptId);
    if (updErr) throw updErr;

    await linkClaimDonorToAuditEntry(receiptId, donorId, { donor_mobile, donor_city, donor_email, donor_pan, donor_address });
    await linkClaimAuditEntry(auditEntry, receiptId, log.id, creditWorkerId, donorId, creditWorkerName);

    // For receipt_sent entries, transition the bank_audit_entry status from
    // "receipt_sent" → "unverified" and stamp the claiming FRO's name so
    // Accounts sees it as a normal pending lead.
    if (isReceiptSent && auditEntry?.id) {
      try {
        await db.from('bank_audit_entries').update({
          status: 'unverified',
          agent_name: creditWorkerName || null,
          updated_at: new Date().toISOString(),
        }).eq('id', auditEntry.id);
      } catch (e) { console.error('Failed to update receipt_sent audit entry:', e.message); }
    }

    try {
      const { data: accounts } = await db.from('users').select('id').in('role', ['accounts', 'super_admin']);
      for (const u of (accounts || [])) {
        await db.from('notification_log').insert({
          worker_id: u.id,
          type: 'claim_requested',
          title: 'Suspense Claim',
          body: `${creditWorkerName || 'An FRO'} claimed ${receipt.donor_name || 'a receipt'} of \u20B9${Number(receipt.amount || 0).toLocaleString('en-IN')} — pending in Lead Verification.`,
          sent_at: new Date().toISOString(),
        });
      }
    } catch (e) { console.error('Claim notification error:', e.message); }

    findAutoMatches().catch((err) => console.error('Auto-match after suspense claim failed:', err.message));

    return res.status(201).json({ message: `Claimed for ${claimedDonorName} — pending in Lead Verification`, log_id: log.id });
  } catch (error) {
    // If THIS request authored a brand-new suspense receipt for an entry- claim
    // but the claim failed, undo it so the bank-audit entry returns to a fully
    // claimable suspense row (not stuck as "Waiting for receipt number"). Only
    // touches the receipt and the entry-link created in this request.
    if (rollbackEntryId != null && createdReceiptId != null) {
      try {
        await db.from('bank_audit_entries')
          .update({ receipt_id: null, receipt_no: null, updated_at: new Date().toISOString() })
          .eq('id', rollbackEntryId);
        await db.from('receipts').delete().eq('id', createdReceiptId);
      } catch (e) { console.error('Rollback of failed suspense claim receipt failed:', e.message); }
    }
    return res.status(error.status || 500).json({ message: error.message });
  }
};

// OR-groups matching donations / verified lead-dones on their ACTUAL collection
// date (imported receipts carry the real date in transaction_datetime; verified
// lead-dones count on verified_at), falling back to created_at — mirrors
// logCollectionDate(). Flat form (no nested or()) for the query builder.
const REACTIVATED_DATE_OR = (s, e) =>
  `and(action.eq.donation,created_at.gte.${s}${e ? `,created_at.lte.${e}` : ''}),` +
  `and(action.eq.donation,transaction_datetime.gte.${s}${e ? `,transaction_datetime.lte.${e}` : ''}),` +
  `and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified,verified_at.gte.${s}${e ? `,verified_at.lte.${e}` : ''})`;

export const getReactivatedDonors = async (req, res) => {
  try {
    const workerId = req.user.id;
    const period = req.query.period === 'month' ? 'month' : 'today';
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json([]);

    const nowUtc = new Date();
    const todayStart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 0, 0, 0, 0));
    const todayEnd = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 23, 59, 59, 999));
    const fyYear = nowUtc.getMonth() < 3 ? nowUtc.getUTCFullYear() - 1 : nowUtc.getUTCFullYear();
    const fyStart = new Date(Date.UTC(fyYear, 3, 1));
    const monthStart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() + 1, 0, 23, 59, 59, 999));

    const periodStart = period === 'month' ? monthStart.toISOString() : todayStart.toISOString();
    const periodEnd = period === 'month' ? monthEnd.toISOString() : todayEnd.toISOString();
    const fyBeforeEnd = period === 'month' ? monthStart.toISOString() : todayStart.toISOString();

    const [periodDonorsRes, fyDonorsRes] = await Promise.all([
      withStationNgoPairs(db.from('fro_donor_logs')
        .select('donor_id, amount_collected, created_at, transaction_datetime, verified_at, donor_profiles!inner(name, mobile_number), fro_assignments!inner(station, ngo_id)')
        .in('fro_assignments.station', stationNames)
        .or(REACTIVATED_DATE_OR(periodStart, periodEnd)), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
      withStationNgoPairs(db.from('fro_donor_logs')
        .select('donor_id, created_at, transaction_datetime, verified_at, fro_assignments!inner(station, ngo_id)')
        .in('fro_assignments.station', stationNames)
        .or(REACTIVATED_DATE_OR(fyStart.toISOString())), myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'),
    ]);

    const periodLogs = filterByScope(periodDonorsRes.data, myScope, l => `${l.fro_assignments?.station}|${l.fro_assignments?.ngo_id}`);
    const fyLogs = filterByScope(fyDonorsRes.data, myScope, l => `${l.fro_assignments?.station}|${l.fro_assignments?.ngo_id}`);

    const fyBeforePeriodDonors = new Set();
    for (const log of fyLogs || []) {
      if (logCollectionDate(log) && logCollectionDate(log) < fyBeforeEnd) fyBeforePeriodDonors.add(log.donor_id);
    }

    const seen = new Set();
    const donors = [];
    for (const log of periodLogs || []) {
      const collectedAt = logCollectionDate(log);
      if (!log.donor_id || fyBeforePeriodDonors.has(log.donor_id) || seen.has(log.donor_id)) continue;
      if (!inRange(collectedAt, periodStart, periodEnd)) continue;
      seen.add(log.donor_id);
      donors.push({
        donor_id: log.donor_id,
        donor_name: log.donor_profiles?.name || 'Unknown',
        donor_mobile: log.donor_profiles?.mobile_number || '',
        amount: parseFloat(log.amount_collected || 0),
        date: collectedAt,
      });
    }

    donors.sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.json({ donors, count: donors.length, period });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const NOT_CONNECTED_STATUSES = ['busy', 'ringing', 'call_waiting', 'unreachable', 'switched_off', 'out_of_coverage', 'wrong_number', 'invalid_number', 'rejected', 'temporary_network_issue', 'voicemail'];
const CONNECTED_STATUSES = ['contacted', 'donation_collected', 'lead_done', 'done', 'follow_up', 'scheduled', 'callback', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected'];

export const getMyDonors = async (req, res) => {
  try {
    const workerId = req.user.id;
    const statusFilter = req.query.status;
    const statusGroup = req.query.status_group;

    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));

    let effectiveScope = myScope;
    let effectiveStations = stationNames;
    if (req.query.ngo_id && allowedNgoIds.includes(req.query.ngo_id)) {
      effectiveScope = myScope.filter(s => s.ngo_id === req.query.ngo_id);
      effectiveStations = effectiveScope.map(s => s.station);
    }

    const limit = parseInt(req.query.limit, 10);
    const offset = parseInt(req.query.offset, 10);
    let assignments = null;

    // Primary: ALL available leads in the FRO's assigned (station, ngo) scope.
    // Scoped by station/ngo pair (NOT by fro_worker_id) so the FRO sees their
    // full station allotment even when individual assignment rows carry a null
    // or otherwise un-stamped fro_worker_id. Safe because each (ngo, station)
    // maps to exactly one FRO in fro_station_assignments; already-worked /
    // disposed / terminal leads are filtered out downstream by baseFiltered so
    // only unclaimed, available rows surface in the queue.
    if (effectiveStations.length > 0) {
      let query = db
        .from('fro_assignments')
        .select('*, ngos(name)')
        .in('station', effectiveStations)
        .not('status', 'eq', 'reassigned');
      query = withStationNgoPairs(query, effectiveScope);

      if (req.query.station) {
        query = query.eq('station', req.query.station);
        effectiveScope = effectiveScope.filter(s => s.station === req.query.station);
        effectiveStations = [req.query.station];
      }

      if (statusGroup === 'not_connected') {
        query = query.in('status', NOT_CONNECTED_STATUSES);
      } else if (statusGroup === 'connected') {
        query = query.in('status', CONNECTED_STATUSES);
      } else if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      let { data, error: qErr } = await query;
      if (qErr) {
        console.error('getMyDonors main query error for worker', workerId, ':', qErr.message, '| stations:', effectiveStations, '| scope:', JSON.stringify(effectiveScope));
        try {
          query = db.from('fro_assignments').select('*, ngos(name)').in('station', effectiveStations).not('status', 'eq', 'reassigned');
          query = withStationNgoPairs(query, effectiveScope);
          const { data: retry, error: retryErr } = await query;
          if (retryErr) {
            console.error('getMyDonors retry query also failed for worker', workerId, ':', retryErr.message);
          }
          data = retry || [];
        } catch (retryEx) {
          console.error('getMyDonors retry exception for worker', workerId, ':', retryEx.message);
          data = [];
        }
      }
      assignments = data || [];
      // Robust new/old filter: handle legacy rows where batch_type is NULL.
      // New = batch_type new_data OR (null + is_new != false); Old = batch_type old_data OR (null + is_new == false)
      if (req.query.new_only === 'true') {
        assignments = assignments.filter(a => a.batch_type === 'new_data' || (a.batch_type == null && a.is_new !== false));
      } else if (req.query.old_only === 'true') {
        assignments = assignments.filter(a => a.batch_type === 'old_data' || (a.batch_type == null && a.is_new === false));
      }
    }

    // NO fallback. The FRO must only ever be served donors strictly within
    // their assigned (station, ngo_id) scope. If the assigned-scope query above
    // returns nothing, the queue is simply empty — we never pull in leads from
    // other stations or NGOs as a "claimable pool", because that would expose
    // donors outside the FRO's allotment.
    if (!assignments || assignments.length === 0) return res.json([]);

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const projectSet = [...new Set(assignments.map(a => (a.ngos?.name ? a.ngos.name.toLowerCase() : null)).filter(Boolean))];
    const evidence = await fetchScopedDonationEvidence({
      assignments,
      donorIds: [...new Set(assignments.map(a => a.donor_id))],
      projectSet,
      oneYearAgo: oneYearAgo.toISOString(),
    });

    let donorIds = [...new Set(assignments.map(a => a.donor_id))];

    if (req.query.verified_only === 'true' && donorIds.length > 0) {
      assignments = assignments.filter(a => evidence.verifiedAssignmentIds.has(a.id));
      donorIds = [...new Set(assignments.map(a => a.donor_id))];
    }
    const donors = await chunkedInQuery(donorIds, chunk =>
      db.from('donor_profiles').select('*').in('id', chunk)
    );

    const donorMap = {};
    for (const d of donors || []) donorMap[d.id] = d;

    const assignmentIds = assignments.map(a => a.id);
    const schedules = await chunkedInQuery(assignmentIds, chunk =>
      db.from('fro_scheduled_contacts').select('*').in('assignment_id', chunk).eq('is_completed', false)
    );

    const scheduleMap = {};
    for (const s of schedules || []) {
      if (!scheduleMap[s.assignment_id]) {
        scheduleMap[s.assignment_id] = s;
      }
    }

    // NGO-scoped flags: logs belong to the worker's assignments (which carry
    // the NGO) and receipts are matched by (donor_id, project_id) where
    // project_id = the NGO name lowercased. A donation only counts toward the
    // exact NGO the worker holds the donor in — never leaking across NGOs.
    const projectOf = a => (a.ngos?.name ? a.ngos.name.toLowerCase() : '');
    const activeSet = new Set();
    const monthDonatedSet = new Set();
    const monthVerifiedSet = new Set();
    const hasScopedSet = new Set();
    for (const a of assignments) {
      const pair = `${a.donor_id}|${projectOf(a)}`;
      if (evidence.activeAssignmentIds.has(a.id) || evidence.receiptRecentPairs.has(pair)) activeSet.add(a.id);
      if (evidence.periodDonatedAssignmentIds.has(a.id) || evidence.receiptPeriodPairs.has(pair)) monthDonatedSet.add(a.id);
      if (evidence.periodVerifiedAssignmentIds.has(a.id) || evidence.receiptPeriodPairs.has(pair)) monthVerifiedSet.add(a.id);
      if (evidence.activeAssignmentIds.has(a.id) || evidence.receiptPairs.has(pair)) hasScopedSet.add(a.id);
    }

    // Filter by active/inactive status
    if (req.query.active_only === 'true') {
      assignments = assignments.filter(a => activeSet.has(a.id));
      donorIds = [...new Set(assignments.map(a => a.donor_id))];
    } else if (req.query.inactive_only === 'true') {
      assignments = assignments.filter(a => !activeSet.has(a.id));
      donorIds = [...new Set(assignments.map(a => a.donor_id))];
    }

    // Sort assignments so completed/connected statuses come before pending
    // (dedup picks the first occurrence)
    if (req.query.verified_only === 'true') {
      const statusOrder = ['donation_collected', 'lead_done', 'follow_up', 'scheduled', 'contacted', 'callback', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'pending', 'busy', 'ringing', 'call_waiting', 'switched_off', 'out_of_coverage', 'unreachable', 'wrong_number', 'invalid_number', 'rejected', 'temporary_network_issue', 'voicemail'];
      const statusRank = {};
      for (let i = 0; i < statusOrder.length; i++) statusRank[statusOrder[i]] = i;
      assignments.sort((a, b) => (statusRank[a.status] ?? 999) - (statusRank[b.status] ?? 999));
    }

    let result = [];
    const seen = new Set();
    for (const a of assignments || []) {
      const d = donorMap[a.donor_id];
      if (!d) continue;
      const key = `${a.donor_id}-${a.ngo_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = scheduleMap[a.id];
      const rawStatus = a.status || 'pending';
      // Only donation_collected should reset to pending across a donation
      // period boundary (so a recurring donor reappears to be collected again).
      // lead_done / done are terminal dispositions — once the FRO closes the
      // lead they must stay hidden, otherwise disposed leads come back again.
      const staleDoneStatus = rawStatus === 'donation_collected' && !monthDonatedSet.has(a.id);
      // A donor who has already donated in the current period has nothing left
      // to collect — drop them out of the workable (pending/not-connected) pool
      // so they stop reappearing at the top of the FRO stack. Uses monthDonatedSet
      // (verified or not) so the status matches the "already donated" banner.
      const workableStatuses = new Set(['pending', 'busy', 'ringing', 'call_waiting', 'switched_off', 'out_of_coverage', 'unreachable', 'wrong_number', 'invalid_number', 'rejected', 'temporary_network_issue', 'voicemail', 'incoming_out']);
      const displayStatus = staleDoneStatus
        ? 'pending'
        : (monthDonatedSet.has(a.id) && workableStatuses.has(rawStatus) ? 'donation_collected' : rawStatus);
      result.push({
        id: a.donor_id,
        donor_id: a.donor_id,
        assignment_id: a.id,
        ngo_id: a.ngo_id,
        ngo_name: a.ngos?.name || 'Unknown',
        station: a.station || '',
        donor_mobile: d.mobile_number || '',
        donor_name: d.name || 'Unknown',
        donor_city: d.city || '',
        donor_address: d.address_1 || '',
        donor_amount: hasScopedSet.has(a.id) ? (d.amount || 0) : 0,
        donor_email: d.email || '',
        donor_pan: d.pan_number || '',
        donor_project: d.project_supported || '',
        donor_dob: d.birth_date || '',
        donor_type: d.donor_type || '',
        donation_count: hasScopedSet.has(a.id) ? (d.donation_count || 0) : 0,
        total_donated: hasScopedSet.has(a.id) ? (d.total_amount || 0) : 0,
        last_donation_date: hasScopedSet.has(a.id) ? (d.last_donation_date || null) : null,
        first_donation_date: hasScopedSet.has(a.id) ? (d.first_donation_date || null) : null,
        donor_frequency: d.donation_frequency || '',
        has_donated_current_fy: activeSet.has(a.id),
        has_donated_current_month: monthDonatedSet.has(a.id),
        has_verified_donation_current_month: monthVerifiedSet.has(a.id),
        is_active: activeSet.has(a.id),
        status: staleDoneStatus ? 'pending' : rawStatus,
        notes: a.notes || null,
        last_contacted_at: a.last_contacted_at || null,
        next_follow_up: a.next_follow_up || null,
        assigned_at: a.assigned_at || null,
        is_new: a.is_new !== false,
        batch_type: a.batch_type || null,
        next_scheduled_at: s?.scheduled_at || null,
        is_overdue: s ? new Date(s.scheduled_at) < new Date() : false,
        schedule_id: s?.id || null,
        schedule_notes: s?.notes || null,
      });
    }

    // Aggregate all NGO names per donor (since dedup by donor_id loses NGO info)
    const donorNgos = {};
    for (const a of assignments || []) {
      if (!donorNgos[a.donor_id]) donorNgos[a.donor_id] = [];
      const ngoName = a.ngos?.name;
      if (ngoName && !donorNgos[a.donor_id].includes(ngoName)) {
        donorNgos[a.donor_id].push(ngoName);
      }
    }
    for (const r of result) {
      r.ngo_names = donorNgos[r.donor_id] || [r.ngo_name];
    }

    // Attach latest accounts_status from fro_donor_logs (for verified_only view)
    if (req.query.verified_only === 'true' && result.length > 0) {
      const donorIdsForStatus = result.map(r => r.donor_id);
      const statusLogs = await chunkedInQuery(donorIdsForStatus, chunk =>
        db.from('fro_donor_logs').select('donor_id, accounts_status, created_at').in('donor_id', chunk)
          .in('accounts_status', ['verified', 'rejected', 'pending'])
      );
      statusLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const latestStatus = {};
      for (const log of statusLogs) {
        if (!latestStatus[log.donor_id]) latestStatus[log.donor_id] = log.accounts_status;
      }
      for (const r of result) {
        r.accounts_status = latestStatus[r.donor_id] || r.status;
      }
    }

    // --- Period filter ---
    const periodFilter = req.query.period;
    if (periodFilter && periodFilter !== 'all' && donorIds.length > 0) {
      let periodCutoff;
      const now = new Date();
      if (periodFilter === 'today') {
        const d = new Date(); d.setHours(0, 0, 0, 0);
        periodCutoff = d.toISOString();
      } else if (periodFilter === 'monthly') {
        periodCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      } else if (periodFilter === 'sixmonths') {
        periodCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
      } else if (periodFilter === 'yearly') {
        periodCutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      }
      if (periodCutoff) {
        const periodActivity = await chunkedInQuery(donorIds, chunk =>
          db.from('fro_donor_logs').select('donor_id').in('donor_id', chunk)
            .not('action', 'eq', 'note')
            .gte('created_at', periodCutoff)
        );
        const periodDonorIds = new Set(periodActivity.map(l => l.donor_id));
        result = result.filter(r => periodDonorIds.has(r.donor_id));
      }
    }

    // --- Ordering logic ---
    // 1. New leads (is_new === true)
    // 2. Not connected (status in NOT_CONNECTED_STATUSES or 'pending')
    // 3. Connected (status in CONNECTED_STATUSES, excluding lead_done)
    // 4. Lead done from previous months (hidden for rest of current month)
    // 5. Ringing — always sinks to the very end of the queue

    const now = new Date();
    const nowISO = now.toISOString();

    // Retryable not-connected: shown at tail of FIFO for rework, not permanently hidden.
    const RETRYABLE_NOT_CONNECTED_DETAILS = new Set([
      'ringing', 'unreachable', 'busy', 'out_of_coverage', 'voicemail', 'call_waiting', 'switched_off',
    ]);
    // Permanent hide for terminal not-connected dispositions (wrong_number, invalid, etc.).
    // Retryable ones above are excluded here — they go to tail instead.
    const NOT_CONNECTED_DISPOSITION_DETAILS = new Set([
      'wrong_number', 'invalid_number', 'invalid',
      'rejected', 'temporary_network_issue', 'incoming_out',
    ]);
    const MONEY_DONE_STATUSES = new Set([
      'donation_collected', 'done', 'lead_done', 'visit_donate',
      'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated',
    ]);
    const TERMINAL_DISPOSITIONS = new Set([
      'not_interested', 'not_interested_now', 'dnd', 'wrong_person', 'not_possible', 'language_barrier',
      'call_disconnected', 'email_sent', 'whatsapp_sent', 'transferred_senior',
      'query_complaint', 'receipt_request', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents',
    ]);
    const notConnectedForeverIds = new Set();
    const terminalForeverIds = new Set();
    if (donorIds.length > 0) {
      const recentLogs = await chunkedInQuery(donorIds, chunk =>
        db.from('fro_donor_logs').select('donor_id, disposition_detail, created_at')
          .in('donor_id', chunk)
          .eq('action', 'disposition')
          .order('created_at', { ascending: false })
      );
      const seenEver = new Set();
      for (const log of recentLogs) {
        if (!seenEver.has(log.donor_id)) {
          seenEver.add(log.donor_id);
          if (NOT_CONNECTED_DISPOSITION_DETAILS.has(log.disposition_detail)) {
            notConnectedForeverIds.add(log.donor_id);
          }
          if (TERMINAL_DISPOSITIONS.has(log.disposition_detail)) {
            terminalForeverIds.add(log.donor_id);
          }
        }
      }
    }

    // ─── Same-day suppression (per worker + current work scope) ──────────────
    // Business rule: if the donor already has ANY disposition TODAY (IST) for
    // THIS worker, it must not be selectable again today — even for a retryable
    // disposition (ringing/busy). Tomorrow, retryability is recalculated by the
    // existing rules. Scoped to fro_worker_id (this worker) so disposing a donor
    // under FRO-1 never blocks it for FRO-2.
    const disposedTodayIds = new Set();
    if (donorIds.length > 0) {
      const { start, end } = istDayBounds();
      const todayLogs = await chunkedInQuery(donorIds, chunk =>
        db.from('fro_donor_logs')
          .select('donor_id')
          .in('donor_id', chunk)
          .eq('fro_worker_id', workerId)
          .gte('created_at', start.toISOString())
          .lt('created_at', end.toISOString())
      );
      for (const log of todayLogs) disposedTodayIds.add(log.donor_id);
    }

    const SCHEDULE_CALLBACK_DISPOSITIONS = new Set([
      'scheduled', 'callback', 'follow_up', 'office_visit_scheduled', 'program_visit_scheduled',
    ]);

    // Statuses that are a hard "never work this donor again" so they must NEVER
    // be workable, independent of whether the matching disposition log was
    // captured. (Terminal connected dispositions like email_sent / query_complaint
    // may still need follow-up, so they are NOT excluded by status here — they are
    // already hidden via terminalForeverIds when a log exists.)
    const HARD_TERMINAL_STATUSES = new Set([
      'not_interested', 'not_interested_now', 'dnd', 'wrong_person', 'not_possible',
      'language_barrier', 'call_disconnected',
      'wrong_number', 'invalid_number', 'invalid', 'rejected', 'temporary_network_issue', 'incoming_out',
    ]);

    let baseFiltered;
    if (req.query.verified_only === 'true') {
      baseFiltered = null;
    } else {
      baseFiltered = result.filter(r => {
        // Same-day suppression (primary): if this donor already has ANY
        // disposition today (IST) for this worker, it must not appear again in
        // any queue view today — even for a retryable disposition (ringing/busy).
        // Scoped per worker so it never blocks the donor for another FRO.
        if (disposedTodayIds.has(r.donor_id)) return false;
        // Status is authoritative for hard-terminal dispositions: a donor already
        // marked not_interested / dnd / wrong_person / not_possible / wrong_number
        // etc. must NOT be workable even if its disposition log wasn't captured —
        // otherwise it leaks into the work queue and reappears.
        if (HARD_TERMINAL_STATUSES.has(r.status)) return false;
        if (r.hidden_until && new Date(r.hidden_until) > now) return false;
        if (MONEY_DONE_STATUSES.has(r.status) && !r.hidden_until) return false;
        if (SCHEDULE_CALLBACK_DISPOSITIONS.has(r.status)) return false;
        if (terminalForeverIds.has(r.donor_id)) return false;
        if (notConnectedForeverIds.has(r.donor_id) && !MONEY_DONE_STATUSES.has(r.status)) return false;
        return true;
      });
    }
    let filtered = baseFiltered === null ? result : baseFiltered;

    const isNewAssignment = (r) => r.batch_type === 'new_data' || (r.batch_type == null && r.is_new !== false);
    const groupOf = (r) => {
      const isRetryable = RETRYABLE_NOT_CONNECTED_DETAILS.has(r.status);
      const isNew = isNewAssignment(r);
      if (isRetryable) return isNew ? 2 : 3;
      if (isNew) return 0;
      return 1;
    };

    filtered.sort((a, b) => {
      const groupA = groupOf(a);
      const groupB = groupOf(b);
      if (groupA !== groupB) return groupA - groupB;
      const dateA = a.assigned_at ? new Date(a.assigned_at) : new Date(0);
      const dateB = b.assigned_at ? new Date(b.assigned_at) : new Date(0);
      return dateA - dateB;
    });

    // ─── Backend-authoritative current donor (controlled queue) ──────────────
    // When queue_current=true the backend reconciles the ordered workable donor
    // list into work_queue and hands back exactly ONE donor (the next one the
    // FRO should work), plus durable progress. The front-end never chooses the
    // next donor itself — no client-side skip/reorder, so a lead already worked
    // can never reappear.
    if (req.query.queue_current === 'true') {
      try {
        const operatorId = req.user.impersonation && req.user.imposter_id != null ? req.user.imposter_id : null;
        const queueTab = req.query.new_only === 'true' ? 'new' : 'old';
        const queueStation = req.query.station && req.query.station !== 'all' ? req.query.station : null;
        const donorObjs = filtered.map(r => ({ donor_id: r.donor_id, ngo_id: r.ngo_id, id: r.donor_id }));
        await reconcileQueue({ workerId, operatorId, donors: donorObjs, station: queueStation, tab: queueTab });
        await clearActiveRowsNotIn({ workerId, donorIds: donorObjs.map(o => o.donor_id), station: queueStation, tab: queueTab });
        const activeRows = await getActiveQueueRows({ workerId, station: queueStation, tab: queueTab });
        const byId = new Map(filtered.map(r => [r.donor_id, r]));

        // The cursor is STRICTLY FORWARD — no wrap-around, never `% length`, never
        // `idx<0 → idx=0`. `filtered` already excludes every donor with a
        // disposition today for this worker (see baseFiltered), and the disposed
        // donor is no longer in donorObjs, so `getActiveQueueRows` returns only
        // DONORS STILL ELIGIBLE TODAY for this scope. The next donor is therefore
        // simply the LOWEST-position remaining active row.
        //
        //   activeRows are ordered by stable position ASC. After A→RINGING:
        //     activeRows = [B,C,D], serve B → C → D → (empty) -> QUEUE COMPLETE.
        //   There is no valid path back to an earlier donor within the same day.
        let next = null;
        if (activeRows.length > 0) {
          next = activeRows[0];
        }

        const totalActive = activeRows.length;
        if (!next || !byId.has(next.donor_id)) {
          console.log('queue_current: cycle exhausted for worker', workerId, 'station', queueStation, 'tab', queueTab, 'active', totalActive);
          return res.json({ donor: null, position: -1, total: totalActive, cycle_key: cycleKey({ ngoId: null, station: queueStation, tab: queueTab }), done: true });
        }
        const r = byId.get(next.donor_id);
        await markShown({ workerId, donorId: next.donor_id, ngoId: next.ngo_id, station: queueStation, tab: queueTab, position: next.position });
        return res.json({
          donor: r,
          position: next.position,
          total: totalActive,
          cycle_key: cycleKey({ ngoId: null, station: queueStation, tab: queueTab }),
          done: false,
          queue_status: next.status,
        });
      } catch (queueErr) {
        console.error('queue_current error for worker', workerId, ':', queueErr.message);
        // Fall back to the plain list behaviour so the FRO does not dead-end.
        return res.json({ donors: filtered, total: filtered.length });
      }
    }

    const total = filtered.length;
    let page = filtered;
    if (Number.isFinite(limit) && limit > 0) {
      const start = (Number.isFinite(offset) && offset > 0) ? offset : 0;
      page = filtered.slice(start, start + limit);
    }

    if (total === 0 && assignments && assignments.length > 0) {
      console.warn('getMyDonors EMPTY after filters for worker', workerId,
        '| raw_assignments:', assignments.length,
        '| new_only:', req.query.new_only, '| old_only:', req.query.old_only,
        '| ngo_id:', req.query.ngo_id || 'all',
        '| station:', req.query.station || 'all',
        '| not_connected_forever:', notConnectedForeverIds.size,
        '| result_before_hide:', result.length);
    }

    return res.json({ donors: page, total });
  } catch (error) {
    console.error('getMyDonors error for worker', req.user?.id, ':', error.message, error.stack);
    return res.status(500).json({ message: error.message });
  }
};

export const getTransferredLeads = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json([]);

    let effectiveScope = myScope;
    let effectiveStations = stationNames;
    if (req.query.ngo_id && allowedNgoIds.includes(req.query.ngo_id)) {
      effectiveScope = myScope.filter(s => s.ngo_id === req.query.ngo_id);
      effectiveStations = effectiveScope.map(s => s.station);
    }

    let txQuery = db
      .from('fro_assignments')
      .select('*, ngos(name)')
      .in('station', effectiveStations)
      .is('fro_worker_id', null)
      .not('status', 'eq', 'reassigned')
      .limit(200);
    txQuery = withStationNgoPairs(txQuery, effectiveScope);
    const { data: assignments } = await txQuery;

    if (!assignments || assignments.length === 0) return res.json([]);

    const donorIds = [...new Set(assignments.map(a => a.donor_id))];
    const { data: donors } = await db
      .from('donor_profiles')
      .select('*')
      .in('id', donorIds);

    const donorMap = {};
    for (const d of donors || []) donorMap[d.id] = d;

    const assignmentIds = assignments.map(a => a.id);
    const { data: schedules } = await db
      .from('fro_scheduled_contacts')
      .select('*')
      .in('assignment_id', assignmentIds)
      .eq('is_completed', false);

    const scheduleMap = {};
    for (const s of schedules || []) {
      if (!scheduleMap[s.assignment_id]) scheduleMap[s.assignment_id] = s;
    }

    const projectSet = [...new Set(assignments.map(a => (a.ngos?.name ? a.ngos.name.toLowerCase() : null)).filter(Boolean))];
    const scopedReceiptPairs = new Set();
    if (donorIds.length > 0 && projectSet.length > 0) {
      const { data: scopedReceipts } = await db
        .from('receipts')
        .select('donor_id, project_id')
        .in('donor_id', donorIds)
        .in('project_id', projectSet);
      for (const r of scopedReceipts || []) {
        scopedReceiptPairs.add(`${r.donor_id}|${(r.project_id || '').toLowerCase()}`);
      }
    }

    const result = [];
    const seen = new Set();
    for (const a of assignments || []) {
      const d = donorMap[a.donor_id];
      if (!d) continue;
      const key = `${a.donor_id}-${a.ngo_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = scheduleMap[a.id];
      const pair = `${a.donor_id}|${a.ngos?.name ? a.ngos.name.toLowerCase() : ''}`;
      const hasScoped = scopedReceiptPairs.has(pair);
      result.push({
        id: a.donor_id,
        donor_id: a.donor_id,
        assignment_id: a.id,
        ngo_id: a.ngo_id,
        ngo_name: a.ngos?.name || 'Unknown',
        station: a.station || '',
        donor_mobile: d.mobile_number || '',
        donor_name: d.name || 'Unknown',
        donor_city: d.city || '',
        donor_address: d.address_1 || '',
        donor_amount: hasScoped ? (d.amount || 0) : 0,
        donor_email: d.email || '',
        donor_pan: d.pan_number || '',
        donor_project: d.project_supported || '',
        donor_dob: d.birth_date || '',
        donor_type: d.donor_type || '',
        donation_count: hasScoped ? (d.donation_count || 0) : 0,
        total_donated: hasScoped ? (d.total_amount || 0) : 0,
        status: a.status || 'pending',
        notes: a.notes || null,
        last_contacted_at: a.last_contacted_at || null,
        next_follow_up: a.next_follow_up || null,
        assigned_at: a.assigned_at || null,
        is_new: a.is_new !== false,
        next_scheduled_at: s?.scheduled_at || null,
        is_overdue: s ? new Date(s.scheduled_at) < new Date() : false,
        schedule_id: s?.id || null,
        schedule_notes: s?.notes || null,
      });
    }

    return res.json(result);
  } catch (error) {
    console.error('getTransferredLeads error for worker', req.user?.id, ':', error.message);
    return res.status(500).json({ message: error.message });
  }
};

export const updateDonorStatus = async (req, res) => {
  try {
    const workerId = req.user.id;
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const { status, notes, next_follow_up, ngo_id } = req.body;
    if (!status) return res.status(400).json({ message: 'status is required' });

    let assignment = await findOrCreateAssignment(donorId, workerId, ngo_id);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

    // Fill in station if missing (old rows created before station tracking)
    if (!assignment.station && ngo_id) {
      const { data: sa } = await db
        .from('fro_station_assignments')
        .select('station')
        .eq('fro_worker_id', workerId)
        .eq('ngo_id', ngo_id)
        .maybeSingle();
      if (sa?.station) {
        await db.from('fro_assignments').update({ station: sa.station }).eq('id', assignment.id);
        assignment.station = sa.station;
      }
    }

    const updates = { status, last_contacted_at: new Date().toISOString() };
    if (notes !== undefined) updates.notes = notes;
    if (next_follow_up !== undefined) updates.next_follow_up = next_follow_up;

    const result = await updateAssignmentStatus(assignment.id, updates);
    return res.json({ message: 'Status updated', data: result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateDonorType = async (req, res) => {
  try {
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const { donor_type, ngo_id } = req.body;
    const validTypes = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time'];
    if (!donor_type || !validTypes.includes(donor_type)) {
      return res.status(400).json({ message: 'donor_type must be one of: monthly, quarterly, yearly, one_time' });
    }

    const assignment = await getFroAssignment(donorId, req.user.id, ngo_id);
    if (!assignment) return res.status(403).json({ message: 'Access denied' });

    const { data, error } = await db
      .from('donor_profiles')
      .update({ donor_type })
      .eq('id', donorId)
      .select('id, donor_type')
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ message: 'Donor not found' });
      throw error;
    }

    return res.json({ message: 'Donor type updated', data });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorLogs = async (req, res) => {
  try {
    const workerId = req.user.id;
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const { ngo_id } = req.query;

    let assignment = null;
    if (ngo_id) {
      const { data } = await db
        .from('fro_assignments')
        .select('id, ngo_id')
        .eq('donor_id', donorId)
        .eq('fro_worker_id', workerId)
        .eq('ngo_id', ngo_id)
        .not('status', 'eq', 'reassigned')
        .maybeSingle();
      assignment = data;
    }
    if (!assignment) {
      const { data } = await db
        .from('fro_assignments')
        .select('id, ngo_id')
        .eq('donor_id', donorId)
        .eq('fro_worker_id', workerId)
        .not('status', 'eq', 'reassigned')
        .maybeSingle();
      assignment = data;
    }

    let logs = [];
    let totalCollected = 0;
    let nextSchedule = null;
    if (assignment) {
      logs = await findLogsByAssignment(assignment.id);
      totalCollected = await getTotalCollectedByAssignment(assignment.id);
      nextSchedule = await getScheduledByAssignment(assignment.id);
    }

    let receipts = [];
    if (assignment) {
      let project = null;
      if (assignment.ngo_id) {
        const { data: ngo } = await db
          .from('ngos')
          .select('name')
          .eq('id', assignment.ngo_id)
          .maybeSingle();
        project = ngo?.name ? ngo.name.toLowerCase() : null;
      }
      if (project) {
        const { data: scopedReceipts } = await db
          .from('receipts')
          .select('*, fro_donor_logs!receipts_log_id_fkey(transaction_datetime)')
          .eq('donor_id', donorId)
          .eq('project_id', project)
          .order('receipt_date', { ascending: false });
        receipts = scopedReceipts || [];
      }
    }

    if (receipts && receipts.length > 0) {
      const receiptLogs = receipts.map(r => {
        const linkedLog = Array.isArray(r.fro_donor_logs) ? r.fro_donor_logs[0] : r.fro_donor_logs;
        const receiptDate = r.receipt_date || linkedLog?.transaction_datetime || r.created_at;
        return {
          id: `receipt_${r.id}`,
          assignment_id: assignment?.id || null,
          amount_collected: parseFloat(r.amount || 0),
          payment_mode: r.mode || '—',
          mode: r.mode || '—',
          accounts_status: 'verified',
          created_at: receiptDate,
          upi_transaction_id: r.payment_id || null,
          payment_id: r.payment_id || null,
          receipt_no: r.receipt_no || null,
          donor_name: r.donor_name || null,
          project_id: r.project_id || null,
          action: 'donation',
          transaction_datetime: receiptDate,
          verified_at: receiptDate,
          agent_name: r.agent_name || null,
        };
      });
      if (assignment) {
        const nonDonationLogs = logs.filter(l => l.action !== 'donation' && !(l.disposition_detail === 'lead_done' && l.accounts_status === 'verified'));
        logs = [...nonDonationLogs, ...receiptLogs];
        logs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      } else {
        logs = receiptLogs;
      }
      totalCollected = receipts.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    }

    // Resolve collector names so the UI can show "Collected by <name>" — the
    // collector may differ from the assignment owner (work-as donations).
    const collectorIds = [...new Set((logs || []).map((l) => l.fro_worker_id).filter(Boolean))];
    const { data: collectors } = collectorIds.length > 0
      ? await db.from('workers').select('id, name').in('id', collectorIds)
      : { data: [] };
    const collectorMap = {};
    for (const w of collectors || []) collectorMap[w.id] = w.name;
    for (const l of logs || []) {
      // Hide the collector's identity from the impersonated FRO. The log's
      // fro_worker_id is the person who actually collected (which differs from
      // the requester when working as another FRO), so only reveal the name
      // when the requester is the collector themselves.
      if (l.fro_worker_id != null && l.fro_worker_id === workerId) {
        l.fro_worker_name = collectorMap[l.fro_worker_id] || null;
      } else {
        l.fro_worker_name = null;
      }
    }

    return res.json({ logs, total_collected: totalCollected, next_schedule: nextSchedule });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const MONEY_TERMINAL_STATUSES = new Set(['done', 'lead_done', 'donation_collected']);

// A donor whose assignment is already money-terminal is no longer workable for
// this worker in this cycle; opening it again is a duplicate/out-of-order save.
function isDisposedForWorker(assignment, detail) {
  if (!assignment) return false;
  if (assignment.status === 'reassigned') return true;
  if (!MONEY_TERMINAL_STATUSES.has(assignment.status)) return false;
  // Re-submitting the exact same money disposition is a duplicate; submitting a
  // different disposition onto a closed money lead is out-of-order.
  if (assignment.status === 'lead_done' || assignment.status === 'done') return true;
  return false;
}

export const createDonorLogHandler = async (req, res) => {
  try {
    const workerId = req.user.id;
    // When working-as another FRO, the collection credit goes to the operator
    // (imposter) while the donor/assignment stays with the impersonated FRO.
    const creditWorkerId = req.user.impersonation && req.user.imposter_id != null ? req.user.imposter_id : workerId;
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const { action, notes, outcome, amount_collected, disposition_category, disposition_detail, scheduled_at, payment_screenshot_url, pan_number, donor_address, donor_dob, ngo_id, project_name, remark, upi_transaction_id, transaction_datetime } = req.body;

    if (!action) return res.status(400).json({ message: 'action is required' });
    const allowedActions = ['call', 'visit', 'message', 'follow_up', 'donation', 'note', 'disposition'];
    if (!allowedActions.includes(action)) return res.status(400).json({ message: `Invalid action. Must be one of: ${allowedActions.join(', ')}` });

    const assignment = await findOrCreateAssignment(donorId, workerId, ngo_id);
    if (!assignment) return res.status(404).json({ message: 'Donor not found or no NGO assigned' });

    const logData = {
      assignment_id: assignment.id,
      donor_id: donorId,
      fro_worker_id: creditWorkerId,
      action,
      notes: notes || null,
      outcome: outcome || null,
      amount_collected: amount_collected || null,
      disposition_category: disposition_category || null,
      disposition_detail: disposition_detail || null,
      scheduled_at: scheduled_at || null,
      payment_screenshot_url: payment_screenshot_url || null,
      pan_number: pan_number || null,
      remark: remark || null,
      upi_transaction_id: upi_transaction_id || null,
      transaction_datetime: (() => {
        if (!transaction_datetime) return null;
        const d = new Date(transaction_datetime);
        return isNaN(d.getTime()) ? null : d.toISOString();
      })(),
      accounts_status: null,
      created_by: creditWorkerId,
    };

    if (action === 'disposition' && disposition_detail === 'lead_done') {
      logData.accounts_status = 'pending';
    }

    // ─── Atomic, duplicate-safe disposition ──────────────────────────────────
    // The whole save (log insert + assignment status update + donor profile
    // update + queue update) runs in ONE transaction so a partial failure can
    // never leave a log without its status (or vice-versa). A per-assignment
    // advisory xact lock serializes concurrent saves (two tabs / double-click)
    // so only one wins; the DB unique index uq_fro_donor_logs_same_day_disp is
    // the final backstop against duplicate same-day disposition rows.
    const retryable = classifyDisposition(disposition_detail).retryable;
    const terminalQueued = action === 'disposition' && disposition_detail && !retryable;

    const result = await db.transaction(async () => {
      await db._pool.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['dispose:' + assignment.id]);

      // Guard: do not let a worker re-open or duplicate a money-closed lead.
      if (action === 'disposition' && isDisposedForWorker(assignment, disposition_detail)) {
        const err = new Error('This lead is already closed (donation collected / done). Refresh to see the next donor.');
        err.code = 'LEAD_CLOSED';
        throw err;
      }

      // Same-day disposition dedup: re-saving the same detail (e.g. ringing, busy,
      // not_possible) for the same assignment refreshes today's row instead of
      // inserting a new timeline entry. Money events (done / lead_done) always insert.
      const MONEY_DETAILS = new Set(['done', 'lead_done']);
      let log;
      if (action === 'disposition' && disposition_detail && !MONEY_DETAILS.has(disposition_detail)) {
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const existing = await findDispositionLogToday(assignment.id, creditWorkerId, disposition_detail, dayStart.toISOString());
        if (existing) {
          log = await updateDonorLog(existing.id, {
            notes: logData.notes,
            outcome: logData.outcome,
            amount_collected: logData.amount_collected,
            disposition_category: logData.disposition_category,
            scheduled_at: logData.scheduled_at,
            payment_screenshot_url: logData.payment_screenshot_url,
            pan_number: logData.pan_number,
            remark: logData.remark,
            upi_transaction_id: logData.upi_transaction_id,
            transaction_datetime: logData.transaction_datetime,
            created_at: new Date().toISOString(),
          });
        } else {
          log = await createDonorLog(logData);
        }
      } else {
        log = await createDonorLog(logData);
      }

      // Any logged interaction means the worker attempted this donor — clear
      // the NEW flag so it stops counting/pinning as fresh data.
      await db.from('fro_assignments').update({ is_new: false }).eq('id', assignment.id);

      // Update donor profile fields if provided
      const updateFields = {};
      if (donor_address) updateFields.address_1 = donor_address;
      if (donor_dob) updateFields.birth_date = donor_dob;
      if (project_name) updateFields.project_supported = project_name;
      if (Object.keys(updateFields).length > 0) {
        await db.from('donor_profiles').update(updateFields).eq('id', donorId);
      }

      const now = new Date().toISOString();

      if (action === 'donation') {
        await updateAssignmentStatus(assignment.id, {
          status: 'donation_collected',
          last_contacted_at: now,
          hidden_until: firstOfNextMonthIST(),
        });
      } else if (action === 'disposition' && disposition_detail) {
        await completeAllScheduledByAssignment(assignment.id);

        const statusFromDetail = dispositionDetailToStatus(disposition_detail);
        const statusUpdates = { status: statusFromDetail, last_contacted_at: now };

        if (['scheduled', 'office_visit_scheduled', 'program_visit_scheduled', 'callback'].includes(disposition_detail) && scheduled_at) {
          await createScheduledContact({
            assignment_id: assignment.id,
            scheduled_at,
            notes: notes || null,
            created_by: workerId,
          });
          statusUpdates.next_follow_up = istDateString(scheduled_at);
        }

        if (outcome && outcome.startsWith('next_date:')) {
          statusUpdates.next_follow_up = outcome.replace('next_date:', '').trim();
        }

        statusUpdates.hidden_until = computeHiddenUntil(disposition_detail, scheduled_at);
        await updateAssignmentStatus(assignment.id, statusUpdates);
      } else if (action === 'call' || action === 'visit') {
        await updateAssignmentStatus(assignment.id, {
          status: 'contacted',
          last_contacted_at: now,
        });
      }

      // Reflect the disposition on the controlled queue: terminal dispositions
      // mark the donor DISPOSED across all the worker's active queues (gone, so
      // it can never reappear); retryable not-connected (ringing/busy) stay
      // active so the same donor can be reworked next time.
      if (action === 'disposition' && disposition_detail) {
        try {
          await markDisposed({
            workerId,
            donorId,
            disposed: terminalQueued,
          });
        } catch (queueErr) {
          console.warn('work_queue status update skipped for assignment', assignment.id, ':', queueErr.message);
        }
      }

      // DND: remove the FRO's station + agent assignment entirely so the lead
      // stops appearing in this FRO's list and can never be re-enqueued. Deletes
      // the assignment row and its associated logs / scheduled contacts (mirrors
      // the manual deleteAssignment cleanup) and hard-removes the donor from the
      // work_queue (which has no public FK cascade to fro_assignments). The
      // donor profile / receipts / donations are left untouched. Runs inside the
      // same transaction so a partial failure rolls back atomically.
      if (action === 'disposition' && disposition_detail === 'dnd') {
        try {
          const { data: rmLogs } = await db.from('fro_donor_logs').select('id').eq('assignment_id', assignment.id);
          const rmLogIds = (rmLogs || []).map(l => l.id);
          if (rmLogIds.length > 0) {
            await db.from('rejected_lead_tickets').delete().in('fro_donor_log_id', rmLogIds);
            await db.from('fro_donor_logs').delete().in('id', rmLogIds);
          }
          await db.from('fro_scheduled_contacts').delete().eq('assignment_id', assignment.id);
          await db.from('fro_assignments').delete().eq('id', assignment.id);
          await removeFromQueue({ workerId, donorId });
        } catch (dndErr) {
          console.error('Failed to fully remove DND assignment', assignment.id, ':', dndErr.message);
        }
      }

      // If this assignment had a rejected lead ticket, resolve it
      try {
        const { data: logs } = await db
          .from('fro_donor_logs')
          .select('id')
          .eq('assignment_id', assignment.id)
          .eq('accounts_status', 'rejected')
          .limit(1);
        if (logs && logs.length > 0) {
          const rejectedLogIds = logs.map(l => l.id);
          await db
            .from('rejected_lead_tickets')
            .update({ status: 'resolved' })
            .in('fro_donor_log_id', rejectedLogIds)
            .eq('status', 'pending_review');
        }
      } catch (err) {
        console.error('Failed to resolve rejected lead ticket:', err.message);
      }

      return log;
    });

    return res.json({ message: 'Log entry created', data: result });
  } catch (error) {
    if (error && error.code === 'LEAD_CLOSED') {
      return res.status(409).json({ message: error.message });
    }
    if (error && error.code === '23505') {
      // Duplicate same-day disposition prevented by the DB unique index — the
      // save already happened; treat as idempotent success so the front-end
      // advances rather than erroring repeatedly.
      console.warn('duplicate same-day disposition suppressed:', error.message);
      return res.status(200).json({ message: 'Already logged — duplicate suppressed', data: null });
    }
    return res.status(500).json({ message: error.message });
  }
};

export const getRejectedLeads = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));

    if (stationNames.length === 0) return res.json([]);

    const { data: tickets, error } = await db
      .from('rejected_lead_tickets')
      .select('*')
      .eq('fro_worker_id', workerId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    const data = tickets || [];

    // Enrich with donor_id from fro_donor_logs
    const logIds = data.map(t => t.fro_donor_log_id).filter(Boolean);
    const donorMap = {};
    if (logIds.length > 0) {
      const { data: logs } = await db
        .from('fro_donor_logs')
        .select('id, fro_assignments!inner(donor_id, ngo_id, donor_profiles!inner(mobile_number))')
        .in('id', logIds);
      for (const log of logs || []) {
        donorMap[log.id] = {
          donor_id: log.fro_assignments?.donor_id,
          ngo_id: log.fro_assignments?.ngo_id,
          donor_mobile: log.fro_assignments?.donor_profiles?.mobile_number || '',
        };
      }
    }

    const result = data.map(t => {
      const info = donorMap[t.fro_donor_log_id] || {};
      return { ...t, donor_id: info.donor_id, donor_mobile: info.donor_mobile, ngo_id: info.ngo_id || t.ngo_id };
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const uploadPaymentScreenshot = async (req, res) => {
  try {
    const { file_base64, mime_type } = req.body;

    if (!file_base64) {
      return res.status(400).json({ message: 'File data is required' });
    }

    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    const contentType = mime_type || 'image/jpeg';
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      return res.status(400).json({ message: `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` });
    }
    const buffer = Buffer.from(file_base64, 'base64');
    const ext = contentType.split('/')[1] || 'jpg';
    const fileName = `payment_screenshots/${req.user.id}_${Date.now()}.${ext}`;

    let { data: uploadData, error: uploadError } = await db.storage
      .from('worker-documents')
      .upload(fileName, buffer, { contentType, upsert: true });

    if (uploadError) {
      if (uploadError.message?.includes('bucket')) {
        const { error: bucketError } = await db.storage.createBucket('worker-documents', { public: true });
        if (bucketError) {
          return res.status(500).json({ message: 'Failed to create storage bucket: ' + bucketError.message });
        }
        const { data: retryData, error: retryError } = await db.storage
          .from('worker-documents')
          .upload(fileName, buffer, { contentType, upsert: true });
        if (retryError) {
          return res.status(500).json({ message: 'Upload failed: ' + retryError.message });
        }
        uploadData = retryData;
      } else {
        return res.status(500).json({ message: 'Upload failed: ' + uploadError.message });
      }
    }

    const { data: publicUrlData } = db.storage
      .from('worker-documents')
      .getPublicUrl(fileName);

    const fileUrl = publicUrlData?.publicUrl;
    if (!fileUrl) return res.status(500).json({ message: 'Failed to get file URL' });

    return res.json({ message: 'Screenshot uploaded', file_url: fileUrl });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

function dispositionDetailToStatus(detail) {
  const map = {
    busy: 'busy',
    ringing: 'ringing',
    call_waiting: 'call_waiting',
    unreachable: 'unreachable',
    switched_off: 'switched_off',
    out_of_coverage: 'out_of_coverage',
    wrong_number: 'wrong_number',
    invalid: 'invalid_number',
    invalid_number: 'invalid_number',
    rejected: 'rejected',
    temporary_network_issue: 'temporary_network_issue',
    voicemail: 'voicemail',
    incoming_out: 'incoming_out',
    lead_done: 'lead_done',
    done: 'done',
    scheduled: 'scheduled',
    callback: 'callback',
    office_visit_scheduled: 'scheduled',
    program_visit_scheduled: 'scheduled',
    visit_donate: 'visit_donate',
    will_donate_online: 'will_donate_online',
    promise_to_pay: 'promise_to_pay',
    payment_pending: 'payment_pending',
    already_donated: 'already_donated',
    email_sent: 'email_sent',
    whatsapp_sent: 'whatsapp_sent',
    csr_inquiry: 'csr_inquiry',
    wants_80g_details: 'wants_80g_details',
    wants_trust_documents: 'wants_trust_documents',
    not_interested_now: 'not_interested_now',
    not_interested: 'not_interested',
    language_barrier: 'language_barrier',
    transferred_senior: 'transferred_senior',
    query_complaint: 'query_complaint',
    receipt_request: 'receipt_request',
    dnd: 'dnd',
    wrong_person: 'wrong_person',
    not_possible: 'not_possible',
    call_disconnected: 'call_disconnected',
  };
  return map[detail] || 'contacted';
}

const SCHEDULE_DISPOSITIONS = new Set([
  'scheduled', 'callback', 'office_visit_scheduled', 'program_visit_scheduled',
]);

function firstOfNextMonthIST() {
  return firstOfNextMonthIstUtc();
}

function computeHiddenUntil(dispositionDetail, scheduledAt) {
  if (SCHEDULE_DISPOSITIONS.has(dispositionDetail) && scheduledAt) {
    return new Date(scheduledAt);
  }
  // Only unanswered calls are automatically retryable, from the next IST day.
  const RETRYABLE_NEXT_DAY = new Set([
    'busy', 'ringing', 'call_waiting', 'switched_off', 'out_of_coverage',
    'unreachable', 'voicemail',
  ]);
  if (RETRYABLE_NEXT_DAY.has(dispositionDetail)) {
    return startOfNextIstDayUtc();
  }
  return firstOfNextMonthIST();
}

export const scheduleContact = async (req, res) => {
  try {
    const workerId = req.user.id;
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const { scheduled_at, notes, ngo_id } = req.body;
    if (!scheduled_at) return res.status(400).json({ message: 'scheduled_at is required' });
    if (isNaN(new Date(scheduled_at).getTime())) return res.status(400).json({ message: 'scheduled_at must be a valid date' });

    const assignment = await findOrCreateAssignment(donorId, workerId, ngo_id);
    if (!assignment) return res.status(404).json({ message: 'Donor not found' });

    // Clear any existing pending schedules
    await completeAllScheduledByAssignment(assignment.id);

    const contact = await createScheduledContact({
      assignment_id: assignment.id,
      scheduled_at,
      notes: notes || null,
      created_by: workerId,
    });

    await updateAssignmentStatus(assignment.id, {
      status: 'scheduled',
      last_contacted_at: new Date().toISOString(),
      next_follow_up: istDateString(scheduled_at),
    });

    return res.json({ message: 'Contact scheduled', data: contact });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getMyTarget = async (req, res) => {
  try {
    const workerId = req.user.id;
    const worker = await getWorkerBySession(req.user);
    if (!worker) return res.status(404).json({ message: 'Worker not found' });
    const salary = await getActiveSalaryByWorker(workerId);
    const currentSalary = salary ? parseFloat(salary.salary) : 0;

    const now = new Date();
    const monthStr = now.toISOString().slice(0, 7) + '-01';
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const joinedAt = new Date(worker.created_at);
    const monthDiff = (now.getFullYear() - joinedAt.getFullYear()) * 12 + (now.getMonth() - joinedAt.getMonth());
    const monthsEmployed = monthDiff + (now.getDate() >= joinedAt.getDate() ? 0 : -1);

    let target;
    let targetSource;
    const manualTarget = await getTargetByWorker(workerId, monthStr);
    const autoTarget = calculateAutoTarget(currentSalary, monthsEmployed);
    if (autoTarget !== null) {
      target = autoTarget;
      targetSource = 'auto';
    } else {
      target = manualTarget ? parseFloat(manualTarget.target_amount) : 0;
      targetSource = manualTarget ? 'manual' : 'not_set';
    }

    const achieved_target = manualTarget?.achieved_target != null ? parseFloat(manualTarget.achieved_target) : null;

    const { allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    const creditWorkerId = req.user.impersonation && req.user.imposter_id ? req.user.imposter_id : workerId;
    const collected = await getTotalCollectedByWorker(creditWorkerId, monthStart, monthEnd);
    const collectedByNgo = await getCollectedByNgo(creditWorkerId, monthStart, monthEnd, allowedNgoIds);

    // Resolve NGO names for the breakdown
    const collectedNgoIds = Object.keys(collectedByNgo).filter(id => id !== 'others');
    const collectedNgoMap = {};
    if (collectedNgoIds.length > 0) {
      const { data: ngoRows } = await db.from('ngos').select('id, name').in('id', collectedNgoIds);
      for (const n of ngoRows || []) collectedNgoMap[n.id] = n.name;
    }
    const collected_by_ngo = Object.entries(collectedByNgo).map(([id, amount]) => ({
      ngo_id: id,
      ngo_name: id === 'others' ? 'Others' : (collectedNgoMap[id] || 'Unknown'),
      amount,
    })).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount);

    const stats = await getDashboardStats(workerId);

    // Incentive calculation
    let incentive = {
      totalAKI: 0,
      akiPayout: 0,
      monthlyIncentive: 0,
      totalIncentive: 0,
      targetMet: false,
      isNewJoiner: monthsEmployed <= 3,
      akiPerDay: [],
      totalCollectionAKI: 0,
    };
    try {
      const ranges = await getAKISlabs();
      const achievements = await getAchievements(creditWorkerId, monthStart, monthEnd);
      const monthlyAchievement = achievements.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
      const dailyCollection = await getDailyCollectionByWorker(creditWorkerId, monthStart, monthEnd);
      const akiPerDay = Object.entries(dailyCollection || {})
        .map(([date, collection]) => ({
          date,
          collection,
          dayName: getDayName(date),
          aki: calculateAKI(collection, getDayName(date), ranges),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const totalCollectionAKI = akiPerDay.reduce((sum, r) => sum + r.aki, 0);
      const totalAKI = achievements.reduce((sum, r) => {
        return sum + calculateAKI(parseFloat(r.amount || 0), getDayName(r.date), ranges);
      }, 0);
      const monthlyTargetMet = target > 0 && monthlyAchievement >= target;
      if (monthlyTargetMet) {
        const akiPayout = incentive.isNewJoiner ? totalAKI : Math.round(totalAKI / 2);
        const monthlyIncentive = Math.round((monthlyAchievement - target) * 0.1);
        incentive = { totalAKI, akiPayout, monthlyIncentive, totalIncentive: akiPayout + monthlyIncentive, targetMet: true, isNewJoiner: incentive.isNewJoiner, akiPerDay, totalCollectionAKI };
      } else {
        incentive.totalAKI = totalAKI;
        incentive.akiPerDay = akiPerDay;
        incentive.totalCollectionAKI = totalCollectionAKI;
      }
    } catch (err) { console.error('Incentive calculation error:', err); }

    return res.json({
      month: monthStr,
      target,
      target_source: targetSource,
      collected,
      collected_by_ngo: collected_by_ngo,
      achieved_target,
      remaining: Math.max(0, target - collected),
      salary: currentSalary,
      months_employed: monthsEmployed,
      stats,
      incentive,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getMyStations = async (req, res) => {
  try {
    const workerId = req.user.id;
    const actPairs = froActPairs(req);
    const { data: stations, error } = await db
      .from('fro_station_assignments')
      .select('station, ngo_id, ngos(name)')
      .eq('fro_worker_id', workerId)
      .order('station', { ascending: true });
    if (error) throw error;
    let mapped = (stations || []).map(s => ({
      station: s.station,
      ngo_id: s.ngo_id,
      ngo_name: s.ngos?.name || null,
    }));
    // Acting session: narrow dropdown to claimed stations only (e.g. DH-1 not FD-1)
    if (actPairs && actPairs.length > 0) {
      const allowed = new Set(actPairs.map(p => `${p.ngo_id ?? ''}|${String(p.station ?? '').trim()}`));
      mapped = mapped.filter(s => allowed.has(`${s.ngo_id ?? ''}|${String(s.station ?? '').trim()}`));
    }
    return res.json(mapped);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getFroScheduled = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json([]);

    const { data: contacts, error } = await withStationNgoPairs(
      db
        .from('fro_scheduled_contacts')
        .select('*, fro_assignments!inner(id, donor_id, ngo_id, station, ngos(name))')
        .eq('is_completed', false)
        .in('fro_assignments.station', stationNames)
        .order('scheduled_at', { ascending: true }),
      myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'
    );

    if (error) throw error;

    const scopedContacts = filterByScope(contacts, myScope, c => `${c.fro_assignments?.station}|${c.fro_assignments?.ngo_id}`);

    const donorIds = [...new Set((scopedContacts || []).map(c => c.fro_assignments?.donor_id).filter(Boolean))];
    const { data: donors } = donorIds.length > 0
      ? await db.from('donor_profiles').select('id, name, mobile_number').in('id', donorIds)
      : { data: [] };
    const donorMap = {};
    for (const d of donors || []) donorMap[d.id] = d;

    const seen = new Set();
    const result = [];
    for (const c of scopedContacts || []) {
      const a = c.fro_assignments;
      if (!a) continue;
      const d = donorMap[a.donor_id];
      const key = `${a.donor_id}-${a.ngo_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        id: a.donor_id,
        ngo_id: a.ngo_id,
        donor_name: d?.name || 'Unknown',
        donor_mobile: d?.mobile_number || '',
        scheduled_at: c.scheduled_at,
        schedule_id: c.id,
        schedule_notes: c.notes,
        assignment_id: a.id,
      });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getFroCallbacks = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json([]);

    const { data: assignments, error } = await withStationNgoPairs(
      db
        .from('fro_assignments')
        .select('*')
        .in('station', stationNames)
        .in('status', ['follow_up', 'callback']),
      myScope
    );

    if (error) throw error;

    const assignmentIds = (assignments || []).map(a => a.id);
    const [donorsRes, schedulesRes] = await Promise.all([
      db.from('donor_profiles').select('id, name, mobile_number')
        .in('id', [...new Set(assignments.map(a => a.donor_id).filter(Boolean))]),
      assignmentIds.length > 0
        ? db.from('fro_scheduled_contacts').select('assignment_id, scheduled_at').in('assignment_id', assignmentIds).eq('is_completed', false)
        : { data: [] },
    ]);

    const donorMap = {};
    for (const d of donorsRes.data || []) donorMap[d.id] = d;
    const scheduleMap = {};
    for (const s of schedulesRes.data || []) {
      if (!scheduleMap[s.assignment_id]) scheduleMap[s.assignment_id] = s.scheduled_at;
    }

    const seen = new Set();
    const result = [];
    for (const a of assignments || []) {
      const d = donorMap[a.donor_id];
      if (!d) continue;
      const key = `${a.donor_id}-${a.ngo_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        id: a.donor_id,
        ngo_id: a.ngo_id,
        donor_name: d.name || 'Unknown',
        donor_mobile: d.mobile_number || '',
        scheduled_at: scheduleMap[a.id] || null,
        status: a.status,
        next_follow_up: a.next_follow_up,
        assignment_id: a.id,
      });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Open money-promise leads for the worker: money intent was expressed but not yet
// collected, so the FRO can keep following up. Only uncollected/available
// assignments are returned (disposed/terminal/collected rows are excluded by
// their status not being in the set). Sorted by next follow-up / due date (oldest
// first) so the most-overdue promise surfaces first.
export const getFroPromises = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json([]);

    const { data: assignments, error } = await withStationNgoPairs(
      db
        .from('fro_assignments')
        .select('*')
        .in('station', stationNames)
        .in('status', ['promise_to_pay', 'payment_pending', 'will_donate_online', 'visit_donate', 'whatsapp_sent']),
      myScope
    );

    if (error) throw error;

    const assignmentIds = (assignments || []).map(a => a.id);
    const [donorsRes, schedulesRes] = await Promise.all([
      db.from('donor_profiles').select('id, name, mobile_number')
        .in('id', [...new Set(assignments.map(a => a.donor_id).filter(Boolean))]),
      assignmentIds.length > 0
        ? db.from('fro_scheduled_contacts').select('assignment_id, scheduled_at').in('assignment_id', assignmentIds).eq('is_completed', false)
        : { data: [] },
    ]);

    const donorMap = {};
    for (const d of donorsRes.data || []) donorMap[d.id] = d;
    const scheduleMap = {};
    for (const s of schedulesRes.data || []) {
      if (!scheduleMap[s.assignment_id]) scheduleMap[s.assignment_id] = s.scheduled_at;
    }

    const seen = new Set();
    const result = [];
    for (const a of assignments || []) {
      const d = donorMap[a.donor_id];
      if (!d) continue;
      const key = `${a.donor_id}-${a.ngo_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        id: a.donor_id,
        ngo_id: a.ngo_id,
        donor_name: d.name || 'Unknown',
        donor_mobile: d.mobile_number || '',
        scheduled_at: scheduleMap[a.id] || null,
        due_date: a.next_follow_up || scheduleMap[a.id] || null,
        status: a.status,
        next_follow_up: a.next_follow_up,
        assignment_id: a.id,
      });
    }
    result.sort((x, y) => {
      const tx = x.due_date ? new Date(x.due_date).getTime() : Infinity;
      const ty = y.due_date ? new Date(y.due_date).getTime() : Infinity;
      return tx - ty;
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getMyHistory = async (req, res) => {
  try {
    const workerId = req.user.id;
    // Own-actions history: every log recorded by this FRO, regardless of which
    // (station, ngo) assignment the donor belongs to — cross-FRO verifications
    // reuse the original owner's assignment, so pair-scoping hid them here.
    const { data: logs, error } = await db
      .from('fro_donor_logs')
      .select('*, fro_assignments!inner(fro_worker_id, donor_id, station, ngo_id, ngos!left(name))')
      .eq('fro_worker_id', workerId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const donorIds = [...new Set((logs || []).map(l => l.donor_id).filter(Boolean))];
    const { data: donors } = donorIds.length > 0
      ? await db.from('donor_profiles').select('id, name, mobile_number').in('id', donorIds)
      : { data: [] };
    const donorMap = {};
    for (const d of donors || []) donorMap[d.id] = d;

    const result = (logs || []).map(l => {
      const d = donorMap[l.donor_id] || {};
      return {
        id: l.id,
        donor_id: l.donor_id,
        donor_name: d.name || 'Unknown',
        donor_mobile: d.mobile_number || '',
        action: l.action,
        disposition_category: l.disposition_category,
        disposition_detail: l.disposition_detail,
        notes: l.notes,
        amount_collected: l.amount_collected,
        created_at: l.created_at,
        outcome: l.outcome,
        accounts_status: l.accounts_status,
        ngo_id: l.fro_assignments?.ngo_id || null,
        ngo_name: l.fro_assignments?.ngos?.name || null,
      };
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const requestData = async (req, res) => {
  try {
    const workerId = req.user.id;
    const ngoId = req.user.ngo_id;
    const { message } = req.body;
    const trimmed = message ? message.trim() : '';
    if (!trimmed) return res.status(400).json({ message: 'Message is required' });
    if (trimmed.length > 2000) return res.status(400).json({ message: 'Message too long (max 2000 characters)' });

    const { data, error } = await db
      .from('fro_data_requests')
      .insert([{ fro_worker_id: workerId, message: trimmed, status: 'pending', ngo_id: req.user.ngo_id || null }])
      .select()
      .single();
    if (error) throw error;

    return res.json({ message: 'Request sent successfully', data });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getMyDataRequests = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { data, error } = await db
      .from('fro_data_requests')
      .select('*')
      .eq('fro_worker_id', workerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getFollowUps = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json([]);

    const { start: todayStart, end: todayEnd } = istDayBounds();

    const { data: contacts, error } = await withStationNgoPairs(
      db
        .from('fro_scheduled_contacts')
        .select('*, fro_assignments!inner(id, donor_id, ngo_id, station,  ngos(name))')
        .eq('is_completed', false)
        .in('fro_assignments.station', stationNames)
        .gte('scheduled_at', todayStart.toISOString())
        .lte('scheduled_at', todayEnd.toISOString())
        .order('scheduled_at', { ascending: true }),
      myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'
    );

    if (error) throw error;

    const scopedContacts = filterByScope(contacts, myScope, c => `${c.fro_assignments?.station}|${c.fro_assignments?.ngo_id}`);

    const donorIds = [...new Set((scopedContacts || []).map(c => c.fro_assignments?.donor_id).filter(Boolean))];
    const { data: donors } = donorIds.length > 0
      ? await db.from('donor_profiles').select('id, name, mobile_number').in('id', donorIds)
      : { data: [] };
    const donorMap = {};
    for (const d of donors || []) donorMap[d.id] = d;

    const now = new Date();
    const result = (scopedContacts || []).map(c => {
      const a = c.fro_assignments;
      const d = donorMap[a?.donor_id] || {};
      return {
        id: c.id,
        donor_id: a?.donor_id,
        ngo_id: a?.ngo_id,
        ngo_name: a?.ngos?.name || '',
        donor_name: d.name || 'Unknown',
        donor_mobile: d.mobile_number || '',
        scheduled_at: c.scheduled_at,
        notes: c.notes,
        assignment_id: a?.id,
        is_overdue: new Date(c.scheduled_at) < now,
      };
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getLeadStats = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json({ new_donors: 0, new_amount: 0, existing_donors: 0, existing_amount: 0 });

    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const monthStart = month + '-01';
    const monthEndDate = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0);
    const monthEnd = monthEndDate.toISOString().slice(0, 10) + 'T23:59:59.999Z';

    const { data: logs, error } = await withStationNgoPairs(
      db
        .from('fro_donor_logs')
        .select('donor_id, amount_collected, fro_assignments!inner(id, station, donor_id, ngo_id)')
        .eq('action', 'donation')
        .in('fro_assignments.station', stationNames)
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd),
      myScope, 'fro_assignments.station', 'fro_assignments.ngo_id'
    );

    if (error) throw error;

    const scopedLogs = filterByScope(logs, myScope, l => `${l.fro_assignments?.station}|${l.fro_assignments?.ngo_id}`);

    const donorIds = [...new Set((scopedLogs || []).map(l => l.donor_id).filter(Boolean))];
    const { data: existingDonations } = donorIds.length > 0
      ? await db
          .from('fro_donor_logs')
          .select('donor_id, amount_collected')
          .in('donor_id', donorIds)
          .eq('action', 'donation')
          .lt('created_at', monthStart)
      : { data: [] };

    const existingSet = new Set((existingDonations || []).map(e => e.donor_id));

    let newDonors = 0, newAmount = 0, existingDonors = 0, existingAmount = 0;
    const donorAmounts = new Map();
    for (const l of scopedLogs || []) {
      const did = l.donor_id;
      const amount = parseFloat(l.amount_collected) || 0;
      donorAmounts.set(did, (donorAmounts.get(did) || 0) + amount);
    }
    for (const [did, amount] of donorAmounts) {
      if (existingSet.has(did)) {
        existingDonors++;
        existingAmount += amount;
      } else {
        newDonors++;
        newAmount += amount;
      }
    }

    return res.json({ new_donors: newDonors, new_amount: newAmount, existing_donors: existingDonors, existing_amount: existingAmount });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getMonthlyDonors = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json([]);

    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const monthStart = month + '-01';
    const monthEndDate = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0);
    const monthEnd = monthEndDate.toISOString().slice(0, 10) + 'T23:59:59.999Z';

    const { data: assignments, error } = await withStationNgoPairs(
      db
        .from('fro_assignments')
        .select('*, donor_profiles!inner(id, name, mobile_number, amount, total_amount, donation_count, city), ngos(name)')
        .in('station', stationNames)
        .not('status', 'eq', 'reassigned'),
      myScope
    );

    if (error) throw error;
    if (!assignments || assignments.length === 0) return res.json([]);

    const projectSet = [...new Set(assignments.map(a => (a.ngos?.name ? a.ngos.name.toLowerCase() : null)).filter(Boolean))];
    const donorIds = [...new Set(assignments.map(a => a.donor_id).filter(Boolean))];

    // Per-(donor, NGO) donation aggregates: a receipt only counts toward the
    // exact NGO it was given to, so shared donors never see another NGO's money.
    const scopedStats = new Map();
    if (donorIds.length > 0 && projectSet.length > 0) {
      const { data: scopedReceipts } = await chunkedInQuery(donorIds, chunk =>
        db
          .from('receipts')
          .select('donor_id, project_id, amount')
          .in('donor_id', chunk)
          .in('project_id', projectSet)
      );
      for (const r of scopedReceipts || []) {
        const statsKey = `${r.donor_id}|${(r.project_id || '').toLowerCase()}`;
        const cur = scopedStats.get(statsKey) || { count: 0, total: 0, max: 0 };
        const amt = Number(r.amount) || 0;
        cur.count += 1;
        cur.total += amt;
        if (amt > cur.max) cur.max = amt;
        scopedStats.set(statsKey, cur);
      }
    }

    const { data: existingDonations } = await db
      .from('fro_donor_logs')
      .select('donor_id')
      .in('donor_id', donorIds)
      .eq('action', 'donation')
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd);

    const alreadyDone = new Set((existingDonations || []).map(l => l.donor_id));

    const seen = new Set();
    const result = [];
    for (const a of assignments || []) {
      const key = `${a.donor_id}-${a.ngo_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = a.donor_profiles;
      if (!d || alreadyDone.has(d.id)) continue;
      const statsKey = `${d.id}|${a.ngos?.name ? a.ngos.name.toLowerCase() : ''}`;
      const stats = scopedStats.get(statsKey);
      if (!stats || stats.count < 3) continue;
      result.push({
        donor_id: d.id,
        ngo_id: a.ngo_id,
        ngo_name: a.ngos?.name || '',
        donor_name: d.name || 'Unknown',
        donor_mobile: d.mobile_number || '',
        donor_city: d.city || '',
        amount: stats.max || 0,
        total_donated: stats.total || 0,
        donation_count: stats.count || 0,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorHistory = async (req, res) => {
  try {
    const workerId = req.user.id;
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const period = req.query.period || 'monthly';
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json({ donor: null, logs: [] });

    const now = new Date();
    let startDate;
    if (period === 'financial_year') {
      const year = now.getFullYear();
      startDate = now.getMonth() < 3 ? `${year - 1}-04-01` : `${year}-04-01`;
    } else {
      startDate = now.toISOString().slice(0, 7) + '-01';
    }

    const { data: checkAccess } = await withStationNgoPairs(
      db
        .from('fro_assignments')
        .select('id, ngo_id, ngos(name)')
        .eq('donor_id', donorId)
        .in('station', stationNames)
        .not('status', 'eq', 'reassigned'),
      myScope
    );
    if (!checkAccess || checkAccess.length === 0) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const assignmentIds = checkAccess.map(a => a.id);
    const projectSet = [...new Set(checkAccess.map(a => (a.ngos?.name ? a.ngos.name.toLowerCase() : null)).filter(Boolean))];

    const { data: logs, error } = await db
      .from('fro_donor_logs')
      .select('*')
      .in('assignment_id', assignmentIds)
      .gte('created_at', startDate)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const { data: donors } = await db
      .from('donor_profiles')
      .select('id, name, mobile_number, amount, total_amount, donation_count, city, pan_number, email, address_1, donor_type')
      .eq('id', donorId)
      .maybeSingle();

    // Also fetch receipts linked directly via donor_id (imported receipts),
    // scoped to the (donor, NGO) assignments the worker holds for this donor.
    let receipts = [];
    if (projectSet.length > 0) {
      const { data: scopedReceipts } = await db
        .from('receipts')
        .select('*')
        .eq('donor_id', donorId)
        .in('project_id', projectSet)
        .order('receipt_date', { ascending: false });
      receipts = scopedReceipts || [];
    }

    // Resolve collector names ("Collected by <name>") on the logs.
    const collectorIds = [...new Set((logs || []).map((l) => l.fro_worker_id).filter(Boolean))];
    const { data: collectors } = collectorIds.length > 0
      ? await db.from('workers').select('id, name').in('id', collectorIds)
      : { data: [] };
    const collectorMap = {};
    for (const w of collectors || []) collectorMap[w.id] = w.name;
    for (const l of logs || []) {
      if (l.fro_worker_id != null && l.fro_worker_id === workerId) {
        l.fro_worker_name = collectorMap[l.fro_worker_id] || null;
      } else {
        l.fro_worker_name = null;
      }
    }

    return res.json({ donor: donors || null, logs: logs || [], receipts: receipts || [] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateLiveStatus = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { status, current_donor_name, current_donor_id, today_calls, today_talk_seconds, today_skipped, today_idle_seconds, today_break_seconds, on_break, break_type } = req.body;

    if (status && !['online', 'idle', 'on_call', 'break', 'offline'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be one of: online, idle, on_call, break, offline' });
    }
    const numericFields = { today_calls, today_talk_seconds, today_skipped, today_idle_seconds, today_break_seconds };
    for (const [key, val] of Object.entries(numericFields)) {
      if (val !== undefined && (typeof val !== 'number' || val < 0 || !Number.isFinite(val))) {
        return res.status(400).json({ message: `${key} must be a non-negative number` });
      }
    }

    const payload = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (current_donor_name !== undefined) payload.current_donor_name = current_donor_name;
    if (current_donor_id !== undefined) payload.current_donor_id = current_donor_id;
    if (today_calls !== undefined) payload.today_calls = today_calls;
    if (today_talk_seconds !== undefined) payload.today_talk_seconds = today_talk_seconds;
    if (today_skipped !== undefined) payload.today_skipped = today_skipped;
    if (today_idle_seconds !== undefined) payload.today_idle_seconds = today_idle_seconds;
    if (today_break_seconds !== undefined) payload.today_break_seconds = today_break_seconds;
    if (on_break !== undefined) payload.on_break = on_break;
    if (break_type !== undefined) payload.break_type = break_type;

    if (status === 'on_call' && current_donor_name) {
      payload.call_started_at = new Date().toISOString();
    }
    if (status === 'idle' || status === 'online') {
      payload.call_started_at = null;
    }
    if (status === 'break') {
      payload.break_started_at = new Date().toISOString();
      payload.on_break = true;
    }

    const { error } = await db
      .from('fro_live_status')
      .upsert({ worker_id: workerId, ...payload }, { onConflict: 'worker_id' });
    if (error) throw error;

    return res.json({ message: 'Status updated' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── Progress Save/Restore ──────────────────────────────────────

export const getMyProgress = async (req, res) => {
  try {
    const { data } = await db
      .from('fro_live_status')
      .select('new_donor_id, old_donor_id, new_donor_index, old_donor_index, data_tab, current_batch_id, station')
      .eq('worker_id', req.user.id)
      .maybeSingle();
    return res.json(data || {});
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const saveMyProgress = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { new_donor_id, old_donor_id, new_donor_index, old_donor_index, data_tab, current_batch_id, station } = req.body;
    const payload = {
      current_batch_id: current_batch_id || null,
      station: station || null,
      updated_at: new Date().toISOString(),
    };
    // data_tab is optional: it is ONLY written when explicitly provided (a manual
    // tab switch). An auto-fallback Old<->New shunt omits it, so the FRO's saved
    // tab is never overwritten by an automatic switch. The *_id/_index fields are
    // written independently of data_tab so the worked tab's position is always
    // persisted regardless of which one data_tab points at.
    if (data_tab !== undefined && data_tab) payload.data_tab = data_tab;
    if (new_donor_id !== undefined) payload.new_donor_id = new_donor_id || null;
    if (new_donor_index !== undefined) payload.new_donor_index = new_donor_index ?? null;
    if (old_donor_id !== undefined) payload.old_donor_id = old_donor_id || null;
    if (old_donor_index !== undefined) payload.old_donor_index = old_donor_index ?? null;

    await db
      .from('fro_live_status')
      .upsert({ worker_id: workerId, ...payload }, { onConflict: 'worker_id' });
    return res.json({ message: 'Progress saved' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getLiveStatuses = async (req, res) => {
  try {
    let query = db
      .from('fro_live_status')
      .select('*, workers!inner(id, name, login_id, ngo_id, is_active, department)')
      .order('updated_at', { ascending: false });

    const { ngo_id: filterNgoId, fro_id: filterFroId } = req.query;
    if (filterFroId) {
      query = query.eq('worker_id', filterFroId);
    }
    if (filterNgoId && filterNgoId !== 'all') {
      query = query.eq('workers.ngo_id', filterNgoId);
    } else if (req.user.ngo_id && req.user.role !== 'super_admin' && !filterFroId) {
      query = query.eq('workers.ngo_id', req.user.ngo_id);
    }

    const { data: liveStatuses, error } = await query;
    if (error) throw error;
    if (!liveStatuses || liveStatuses.length === 0) return res.json([]);

    const workerIds = liveStatuses.map(ls => ls.worker_id);
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + istOffset);
    const todayStr = istNow.toISOString().slice(0, 10);
    const todayStart = new Date(Date.UTC(istNow.getFullYear(), istNow.getMonth(), istNow.getDate(), 0, 0, 0, 0)).toISOString();
    const todayEnd = new Date(Date.UTC(istNow.getFullYear(), istNow.getMonth(), istNow.getDate(), 23, 59, 59, 999)).toISOString();

    const [ngoData, attendanceData, collectionData, assignmentData] = await Promise.all([
      db
        .from('worker_ngo_allocations')
        .select('worker_id, ngos(name)')
        .in('worker_id', workerIds),
      db
        .from('attendance')
        .select('worker_id, status')
        .eq('date', todayStr)
        .in('worker_id', workerIds),
      db
        .from('fro_donor_logs')
        .select('amount_collected, fro_worker_id, action, disposition_detail, accounts_status, created_at, verified_at')
        .in('fro_worker_id', workerIds)
        .or(
          `and(action.eq.donation,created_at.gte.${todayStart},created_at.lte.${todayEnd}),` +
          `and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified,verified_at.gte.${todayStart},verified_at.lte.${todayEnd}),` +
          `and(disposition_detail.eq.done,action.eq.disposition,created_at.gte.${todayStart},created_at.lte.${todayEnd})`
        ),
      db
        .from('fro_assignments')
        .select('fro_worker_id, status')
        .in('fro_worker_id', workerIds),
    ]);

    const ngoMap = {};
    (ngoData.data || []).forEach(a => {
      if (a.ngos?.name) ngoMap[a.worker_id] = a.ngos.name;
    });

    const punchedInSet = new Set();
    (attendanceData.data || []).forEach(a => {
      if (a.status === 'present' || a.status === 'late') punchedInSet.add(a.worker_id);
    });

    const collectionMap = {};
    (collectionData.data || []).forEach(log => {
      const wid = log.fro_worker_id;
      if (wid) collectionMap[wid] = (collectionMap[wid] || 0) + parseFloat(log.amount_collected || 0);
    });

    const statsMap = {};
    (assignmentData.data || []).forEach(a => {
      if (!statsMap[a.fro_worker_id]) {
        statsMap[a.fro_worker_id] = { total: 0, contacted: 0, donation_collected: 0, follow_up: 0 };
      }
      const s = statsMap[a.fro_worker_id];
      s.total++;
      const status = (a.status || '').toLowerCase();
      if (['contacted', 'donation_collected', 'follow_up', 'scheduled', 'callback', 'lead_done', 'done', 'payment_pending', 'already_donated', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'not_interested', 'not_interested_now', 'dnd', 'wrong_person', 'call_disconnected'].includes(status)) {
        s.contacted++;
      }
      if (status === 'donation_collected' || status === 'lead_done' || status === 'done') {
        s.donation_collected++;
      }
      if (status === 'follow_up') {
        s.follow_up++;
      }
    });

    const result = liveStatuses.map(ls => {
      const stats = statsMap[ls.worker_id] || { total: 0, contacted: 0, donation_collected: 0, follow_up: 0 };
      const dataUsed = stats.contacted + stats.donation_collected;
      const totalActive = (ls.today_talk_seconds || 0) + (ls.today_idle_seconds || 0);
      const productivity = totalActive > 0 ? Math.round(((ls.today_talk_seconds || 0) / totalActive) * 100) : null;

      return {
        id: ls.id,
        worker_id: ls.worker_id,
        status: ls.status,
        current_donor_name: ls.current_donor_name,
        current_donor_id: ls.current_donor_id,
        call_started_at: ls.call_started_at,
        break_started_at: ls.break_started_at,
        on_break: ls.on_break,
        break_type: ls.break_type,
        worker: {
          name: ls.workers?.name || 'Unknown',
          login_id: ls.workers?.login_id || '',
          ngo_id: ls.workers?.ngo_id,
          ngo_name: ngoMap[ls.worker_id] || '',
          is_active: ls.workers?.is_active !== false,
          is_punched_in: punchedInSet.has(ls.worker_id),
          department: ls.workers?.department || '',
        },
        performance: {
          today_calls: ls.today_calls || 0,
          today_talk_seconds: ls.today_talk_seconds || 0,
          today_skipped: ls.today_skipped || 0,
          today_idle_seconds: ls.today_idle_seconds || 0,
          today_break_seconds: ls.today_break_seconds || 0,
          today_collection: collectionMap[ls.worker_id] || 0,
          total_data: stats.total,
          data_used: dataUsed,
          data_unused: stats.total - dataUsed,
          data_usage_pct: stats.total > 0 ? Math.round((dataUsed / stats.total) * 100) : 0,
          productivity_pct: productivity,
        },
        computed: {
          call_duration_seconds: ls.status === 'on_call' && ls.call_started_at
            ? Math.floor((Date.now() - new Date(ls.call_started_at).getTime()) / 1000) : null,
          break_duration_seconds: ls.status === 'break' && ls.break_started_at
            ? Math.floor((Date.now() - new Date(ls.break_started_at).getTime()) / 1000) : null,
          is_long_break: (ls.today_break_seconds || 0) > 3600,
          last_seen: ls.updated_at,
        },
        updated_at: ls.updated_at,
      };
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const searchDonors = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { q, disposed } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);

    const searchTerm = `%${q.trim()}%`;

    // Disposed-only mode: return donors this FRO has already dispositioned.
    // FRO dispositions are written to fro_donor_logs (not donor_logs), and the
    // "disposed leads of today also" requirement means today's dispositions
    // must show up too. All dispositions (today + past) are returned, enriched
    // with station + latest disposition detail.
    if (disposed === 'true') {
      const { data: disposedLogs, error: logErr } = await db
        .from('fro_donor_logs')
        .select('donor_id, assignment_id, disposition_detail, disposition_category, created_at')
        .eq('fro_worker_id', workerId)
        .eq('action', 'disposition')
        .order('created_at', { ascending: false });
      if (logErr) throw logErr;

      const disposedDonorIds = [...new Set((disposedLogs || []).map(l => l.donor_id).filter(Boolean))];
      if (disposedDonorIds.length === 0) return res.json([]);

      const { data: donors, error } = await db
        .from('donor_profiles')
        .select('id, name, mobile_number, city, amount, total_amount, donation_count, email, pan_number, address_1, birth_date, project_supported, last_donation_date, first_donation_date, donor_type')
        .in('id', disposedDonorIds)
        .or(`name.ilike.${searchTerm},mobile_number.ilike.${searchTerm}`)
        .limit(20);
      if (error) throw error;
      if (!donors || donors.length === 0) return res.json([]);

      const matchedIds = donors.map(d => d.id);

      const { scope: myScope, stationNames } = await getMyStationScope(workerId, froActPairs(req));
      const scopePairs = new Set((myScope || []).filter(s => s.ngo_id && s.station).map(s => `${s.station}|${s.ngo_id}`));

      const { data: assignments } = await db
        .from('fro_assignments')
        .select('*, ngos!inner(name)')
        .in('donor_id', matchedIds)
        .in('station', stationNames)
        .not('status', 'eq', 'reassigned');

      const scopedAssignments = (assignments || []).filter(a => scopePairs.has(`${a.station}|${a.ngo_id}`));

      // Latest disposition per donor (from the same fro_donor_logs source so
      // today's dispositions — including lead_done/donation — are included).
      const latestDispMap = {};
      for (const dl of disposedLogs || []) {
        if (matchedIds.includes(dl.donor_id) && !latestDispMap[dl.donor_id]) {
          latestDispMap[dl.donor_id] = dl;
        }
      }

      const result = [];
      const seen = new Set();
      for (const d of donors) {
        const matchingAssignments = scopedAssignments.filter(a => a.donor_id === d.id);
        for (const a of matchingAssignments) {
          const key = `${d.id}-${a.ngo_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const disp = latestDispMap[d.id];
          result.push({
            donor_id: d.id,
            ngo_id: a.ngo_id,
            ngo_name: a.ngos?.name || 'Unknown',
            assignment_id: a.id,
            station: a.station || '',
            batch_type: a.batch_type || '',
            donor_name: d.name || 'Unknown',
            donor_mobile: d.mobile_number || '',
            donor_city: d.city || '',
            donor_amount: d.amount || 0,
            donor_email: d.email || '',
            donor_pan: d.pan_number || '',
            donor_project: d.project_supported || '',
            donor_dob: d.birth_date || '',
            donor_type: d.donor_type || '',
            donor_address: d.address_1 || '',
            donation_count: d.donation_count || 0,
            total_donated: d.total_amount || 0,
            has_donated_current_month: false,
            has_verified_donation_current_month: false,
            status: 'disposed',
            disposition_detail: disp?.disposition_detail || '',
            disposition_category: disp?.disposition_category || '',
            disposed_at: disp?.created_at || null,
          });
        }
      }
      return res.json(result);
    }

    // Default: search all donors in scope (not disposed-filtered)
    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json([]);

    const { data: donorIdsFromStation } = await db
      .from('fro_assignments')
      .select('donor_id, ngo_id, station')
      .in('station', stationNames)
      .not('status', 'eq', 'reassigned');

    const scopePairs = new Set((myScope || []).filter(s => s.ngo_id && s.station).map(s => `${s.station}|${s.ngo_id}`));
    const donorIdsInScope = [...new Set(
      (donorIdsFromStation || [])
        .filter(a => scopePairs.has(`${a.station}|${a.ngo_id}`))
        .map(a => a.donor_id)
        .filter(Boolean)
    )];
    if (donorIdsInScope.length === 0) return res.json([]);

    const { data: donors, error } = await db
      .from('donor_profiles')
      .select('id, name, mobile_number, city, amount, total_amount, donation_count, email, pan_number, address_1, birth_date, project_supported, last_donation_date, first_donation_date, donor_type')
      .in('id', donorIdsInScope)
      .or(`name.ilike.${searchTerm},mobile_number.ilike.${searchTerm}`)
      .limit(20);

    if (error) throw error;
    if (!donors || donors.length === 0) return res.json([]);

    const matchedIds = donors.map(d => d.id);

    const { data: assignments, error: asgnError } = await db
      .from('fro_assignments')
      .select('*, ngos!inner(name)')
      .in('donor_id', matchedIds)
      .in('station', stationNames)
      .not('status', 'eq', 'reassigned');
    if (asgnError) throw asgnError;

    const scopedAssignments = (assignments || []).filter(a => scopePairs.has(`${a.station}|${a.ngo_id}`));

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const projectSet = [...new Set(scopedAssignments.map(a => (a.ngos?.name ? a.ngos.name.toLowerCase() : null)).filter(Boolean))];
    const evidence = await fetchScopedDonationEvidence({
      assignments: scopedAssignments,
      donorIds: matchedIds,
      projectSet,
      oneYearAgo: oneYearAgo.toISOString(),
    });

    const result = [];
    const seen = new Set();
    for (const d of donors) {
      const matchingAssignments = scopedAssignments.filter(a => a.donor_id === d.id);
      if (matchingAssignments.length === 0) continue;
      for (const a of matchingAssignments) {
        const key = `${d.id}-${a.ngo_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pair = `${a.donor_id}|${a.ngos?.name ? a.ngos.name.toLowerCase() : ''}`;
        const hasScoped = evidence.activeAssignmentIds.has(a.id) || evidence.receiptPairs.has(pair);
        const donatedThisPeriod = evidence.periodDonatedAssignmentIds.has(a.id) || evidence.receiptPeriodPairs.has(pair);
        const rawStatus = a.status || 'pending';
        // Same policy as getMyDonors: only donation_collected resets across a
        // period boundary; lead_done/done are terminal and stay hidden.
        const staleDoneStatus = rawStatus === 'donation_collected' && !donatedThisPeriod;
        const workableStatuses = new Set(['pending', 'busy', 'ringing', 'call_waiting', 'switched_off', 'out_of_coverage', 'unreachable', 'wrong_number', 'invalid_number', 'rejected', 'temporary_network_issue', 'voicemail', 'incoming_out']);
        const displayStatus = staleDoneStatus
          ? 'pending'
          : (donatedThisPeriod && workableStatuses.has(rawStatus) ? 'donation_collected' : rawStatus);
        result.push({
          donor_id: d.id,
          ngo_id: a.ngo_id,
          ngo_name: a.ngos?.name || 'Unknown',
          assignment_id: a.id,
          station: a.station || '',
          batch_type: a.batch_type || '',
          donor_name: d.name || 'Unknown',
          donor_mobile: d.mobile_number || '',
          donor_city: d.city || '',
          donor_amount: hasScoped ? (d.amount || 0) : 0,
          donor_email: d.email || '',
          donor_pan: d.pan_number || '',
          donor_project: d.project_supported || '',
          donor_dob: d.birth_date || '',
          donor_type: d.donor_type || '',
          donor_address: d.address_1 || '',
          donation_count: hasScoped ? (d.donation_count || 0) : 0,
          total_donated: hasScoped ? (d.total_amount || 0) : 0,
          has_donated_current_month: donatedThisPeriod,
          has_verified_donation_current_month: evidence.periodVerifiedAssignmentIds.has(a.id) || evidence.receiptPeriodPairs.has(pair),
        status: displayStatus,
        });
      }
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getMyDisposedLeads = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { station: stationFilter, ngo_id: ngoFilter } = req.query;

    const { data: disposedLogs, error: logErr } = await db
      .from('fro_donor_logs')
      .select('donor_id, assignment_id, disposition_detail, disposition_category, created_at')
      .eq('fro_worker_id', workerId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (logErr) throw logErr;
    if (!disposedLogs || disposedLogs.length === 0) return res.json([]);

    const disposedDonorIds = [...new Set(disposedLogs.map(l => l.donor_id).filter(Boolean))];
    if (disposedDonorIds.length === 0) return res.json([]);

    const { scope: myScope, stationNames } = await getMyStationScope(workerId, froActPairs(req));
    const scopePairs = new Set((myScope || []).filter(s => s.ngo_id && s.station).map(s => `${s.station}|${s.ngo_id}`));

    let effectiveStations = stationNames;
    let effectiveScope = myScope;
    if (stationFilter && stationFilter !== 'all') {
      effectiveStations = [stationFilter];
      effectiveScope = (myScope || []).filter(s => s.station === stationFilter);
    }
    if (ngoFilter) {
      effectiveScope = effectiveScope.filter(s => String(s.ngo_id) === String(ngoFilter));
      effectiveStations = [...new Set(effectiveScope.map(s => s.station))];
    }
    if (effectiveStations.length === 0 && disposedDonorIds.length > 0) {
      // No stations — nothing in scope
      return res.json([]);
    }

    const { data: donors, error } = await db
      .from('donor_profiles')
      .select('id, name, mobile_number, city, amount, total_amount, donation_count, email, pan_number, address_1, birth_date, project_supported, last_donation_date, first_donation_date, donor_type')
      .in('id', disposedDonorIds)
      .limit(500);
    if (error) throw error;
    if (!donors || donors.length === 0) return res.json([]);

    const matchedIds = donors.map(d => d.id);

    const donorMap = {};
    for (const d of donors) donorMap[d.id] = d;

    let assignmentQuery = db
      .from('fro_assignments')
      .select('*, ngos!inner(name)')
      .in('donor_id', matchedIds)
      .in('station', effectiveStations.length > 0 ? effectiveStations : stationNames)
      .not('status', 'eq', 'reassigned');
    assignmentQuery = withStationNgoPairs(assignmentQuery, effectiveScope.length > 0 ? effectiveScope : myScope);
    const { data: assignments } = await assignmentQuery;
    const scopedAssignments = (assignments || []).filter(a => {
      const pair = `${a.station}|${a.ngo_id}`;
      return scopePairs.has(pair) || effectiveScope.some(s => s.station === a.station && String(s.ngo_id) === String(a.ngo_id));
    });

    const latestDispMap = {};
    for (const dl of disposedLogs || []) {
      if (matchedIds.includes(dl.donor_id) && !latestDispMap[dl.donor_id]) {
        latestDispMap[dl.donor_id] = dl;
      }
    }

    const result = [];
    const seen = new Set();
    for (const d of donors) {
      const matchingAssignments = scopedAssignments.filter(a => a.donor_id === d.id);
      // If no scoped assignment found, still show entry using log-derived info
      const assignmentsToUse = matchingAssignments.length > 0 ? matchingAssignments : [{ id: latestDispMap[d.id]?.assignment_id, donor_id: d.id, ngo_id: null, station: '', ngos: { name: 'Unknown' }, batch_type: '' }];
      for (const a of assignmentsToUse) {
        const key = `${d.id}-${a.ngo_id || 'na'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const disp = latestDispMap[d.id];
        result.push({
          donor_id: d.id,
          ngo_id: a.ngo_id,
          ngo_name: a.ngos?.name || 'Unknown',
          assignment_id: a.id,
          station: a.station || '',
          batch_type: a.batch_type || '',
          donor_name: d.name || 'Unknown',
          donor_mobile: d.mobile_number || '',
          donor_city: d.city || '',
          donor_amount: d.amount || 0,
          donor_email: d.email || '',
          donor_pan: d.pan_number || '',
          donor_project: d.project_supported || '',
          donor_dob: d.birth_date || '',
          donor_type: d.donor_type || '',
          donor_address: d.address_1 || '',
          donation_count: d.donation_count || 0,
          total_donated: d.total_amount || 0,
          has_donated_current_month: false,
          has_verified_donation_current_month: false,
          status: 'disposed',
          disposition_detail: disp?.disposition_detail || '',
          disposition_category: disp?.disposition_category || '',
          disposed_at: disp?.created_at || null,
        });
      }
    }
    // Already ordered by disposedLogs desc via map insertion, but ensure sort
    result.sort((a, b) => new Date(b.disposed_at || 0) - new Date(a.disposed_at || 0));
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getFullDonorHistory = async (req, res) => {
  try {
    const workerId = req.user.id;
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const ngoId = parseInt(req.query.ngo_id) || null;
    const unlockAll = req.query.unlock_all === 'true';

    const { scope: myScope, stationNames, allowedNgoIds } = await getMyStationScope(workerId, froActPairs(req));
    if (stationNames.length === 0) return res.json({ donor: null, logs: [] });

    const { data: donor } = await db
      .from('donor_profiles')
      .select('id, name, mobile_number, amount, total_amount, donation_count, city, pan_number, email, address_1, birth_date, project_supported, last_donation_date, first_donation_date, donor_type')
      .eq('id', donorId)
      .maybeSingle();

    let query = db
      .from('fro_assignments')
      .select('id, ngo_id, ngos(name)')
      .eq('donor_id', donorId)
      .in('station', stationNames)
      .not('status', 'eq', 'reassigned');
    query = withStationNgoPairs(query, myScope);
    if (ngoId) query = query.eq('ngo_id', ngoId);

    const { data: assignments } = await query;
    if (!assignments || assignments.length === 0) return res.json({ donor, logs: [] });

    const assignmentIds = assignments.map(a => a.id);
    const projectSet = [...new Set(assignments.map(a => (a.ngos?.name ? a.ngos.name.toLowerCase() : null)).filter(Boolean))];

    let logsQuery = db
      .from('fro_donor_logs')
      .select('*')
      .in('assignment_id', assignmentIds)
      .order('created_at', { ascending: false });

    if (!unlockAll) {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      logsQuery = logsQuery.gte('created_at', twoYearsAgo.toISOString());
    }

    const { data: logs, error } = await logsQuery;
    if (error) throw error;

    // Also fetch receipts linked directly via donor_id (imported receipts),
    // scoped to the (donor, NGO) assignments the worker holds for this donor.
    let receipts = [];
    if (projectSet.length > 0) {
      const { data: scopedReceipts } = await db
        .from('receipts')
        .select('*')
        .eq('donor_id', donorId)
        .in('project_id', projectSet)
        .order('receipt_date', { ascending: false });
      receipts = scopedReceipts || [];
    }

    // Resolve collector names ("Collected by <name>") on the logs.
    const collectorIds = [...new Set((logs || []).map((l) => l.fro_worker_id).filter(Boolean))];
    const { data: collectors } = collectorIds.length > 0
      ? await db.from('workers').select('id, name').in('id', collectorIds)
      : { data: [] };
    const collectorMap = {};
    for (const w of collectors || []) collectorMap[w.id] = w.name;
    for (const l of logs || []) {
      // Hide the collector's identity from the impersonated FRO (work-as).
      if (l.fro_worker_id != null && l.fro_worker_id === workerId) {
        l.fro_worker_name = collectorMap[l.fro_worker_id] || null;
      } else {
        l.fro_worker_name = null;
      }
    }

    return res.json({ donor: donor || null, logs: logs || [], receipts: receipts || [] });
  } catch (error) {
    console.error('getFullDonorHistory error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

export const updateDonorFrequency = async (req, res) => {
  try {
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const { frequency, ngo_id } = req.body;
    const allowed = ['monthly', 'quarterly', 'yearly', 'one_time'];
    if (!frequency || !allowed.includes(frequency)) {
      return res.status(400).json({ message: `Frequency must be one of: ${allowed.join(', ')}` });
    }
    const assignment = await getFroAssignment(donorId, req.user.id, ngo_id);
    if (!assignment) return res.status(403).json({ message: 'Access denied' });
    const { data, error } = await db
      .from('donor_profiles')
      .update({ donation_frequency: frequency })
      .eq('id', donorId)
      .select('donation_frequency')
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorDonations = async (req, res) => {
  try {
    const workerId = req.user.id;
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const { ngo_id, period = 'this_year' } = req.query;

    let assignment = null;
    if (ngo_id) {
      const { data } = await db
        .from('fro_assignments')
        .select('id, ngo_id')
        .eq('donor_id', donorId)
        .eq('fro_worker_id', workerId)
        .eq('ngo_id', ngo_id)
        .not('status', 'eq', 'reassigned')
        .maybeSingle();
      assignment = data;
    } else {
      const { data } = await db
        .from('fro_assignments')
        .select('id, ngo_id')
        .eq('donor_id', donorId)
        .eq('fro_worker_id', workerId)
        .not('status', 'eq', 'reassigned')
        .limit(1)
        .maybeSingle();
      assignment = data;
    }
    if (!assignment) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let project = null;
    if (assignment.ngo_id) {
      const { data: ngo } = await db
        .from('ngos')
        .select('name')
        .eq('id', assignment.ngo_id)
        .maybeSingle();
      project = ngo?.name ? ngo.name.toLowerCase() : null;
    }

    const now = new Date();
    let startDate;
    let endDate;
    if (period === 'monthly') {
      startDate = now.toISOString().slice(0, 7) + '-01';
    } else if (period === 'yearly') {
      startDate = now.getFullYear() + '-01-01';
    } else if (period === 'all') {
      startDate = null;
    } else if (period === 'this_year') {
      const year = now.getFullYear();
      startDate = now.getMonth() < 3 ? `${year - 1}-04-01` : `${year}-04-01`;
    } else if (period?.startsWith('fy_')) {
      const parts = period.split('_');
      startDate = `${parts[1]}-04-01`;
      endDate = `${parts[2]}-03-31`;
    } else {
      startDate = now.toISOString().slice(0, 7) + '-01';
    }

    let query = db
      .from('fro_donor_logs')
      .select('*')
      .eq('assignment_id', assignment.id)
      .or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition)')
      .order('created_at', { ascending: false });

    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate + 'T23:59:59Z');
    }

    const { data: logs, error } = await query;
    if (error) throw error;

    const countedLogIds = new Set((logs || []).map(l => l.id));

    let receiptQuery = db
      .from('receipts')
      .select('*, fro_donor_logs!receipts_log_id_fkey(transaction_datetime)')
      .eq('donor_id', donorId)
      .order('receipt_date', { ascending: false });
    if (project) receiptQuery = receiptQuery.eq('project_id', project);

    if (startDate) {
      receiptQuery = receiptQuery.or(`receipt_date.gte.${startDate},receipt_date.is.null`);
    } else {
      receiptQuery = receiptQuery.or('receipt_date.gte.2000-01-01,receipt_date.is.null');
    }
    if (endDate) {
      receiptQuery = receiptQuery.lte('receipt_date', endDate);
    }

    const { data: receipts } = await receiptQuery;

    const donations = (logs || []).map(l => ({
      date: l.transaction_datetime || l.verified_at || l.created_at,
      amount: l.amount_collected || 0,
      mode: l.payment_mode || null,
      status: l.action === 'donation' ? 'verified' : (l.accounts_status || 'pending'),
      upi_transaction_id: l.upi_transaction_id || null,
      receipt_no: l.receipt_no || null,
    }));

    // A receipt linked to a log already counted above (verified lead_done or
    // donation action) represents the same donation — skip it to avoid doubles.
    const receiptDonations = (receipts || [])
      .filter(r => r.log_id == null || !countedLogIds.has(r.log_id))
      .map(r => ({
      date: r.receipt_date || (Array.isArray(r.fro_donor_logs) ? r.fro_donor_logs[0] : r.fro_donor_logs)?.transaction_datetime || r.created_at,
      amount: r.amount || 0,
      mode: r.mode || null,
      status: 'verified',
      upi_transaction_id: r.upi_transaction_id || null,
      receipt_no: r.receipt_no || null,
    }));

    const all = [...donations, ...receiptDonations];
    all.sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.json(all);
  } catch (error) {
    console.error('getDonorDonations error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorReceipts = async (req, res) => {
  try {
    const donorId = parseInt(req.params.id, 10);
    if (isNaN(donorId)) return res.status(400).json({ message: 'Invalid donor ID' });
    const ngoId = req.query.ngo_id;
    if (!ngoId) return res.status(400).json({ message: 'ngo_id is required' });

    const assignment = await getFroAssignment(donorId, req.user.id, ngoId);
    if (!assignment) return res.status(403).json({ message: 'Access denied' });

    const { data: ngo } = await db
      .from('ngos')
      .select('name')
      .eq('id', ngoId)
      .maybeSingle();
    const project = ngo?.name ? ngo.name.toLowerCase() : null;

    let receipts = [];
    if (project) {
      const { data, error } = await db
        .from('receipts')
        .select('*')
        .eq('donor_id', donorId)
        .eq('project_id', project)
        .order('receipt_date', { ascending: false });
      if (error) throw error;
      receipts = data || [];
    }

    const totalAmount = receipts.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

    return res.json({
      receipts: receipts || [],
      count: receipts?.length || 0,
      totalAmount,
    });
  } catch (error) {
    console.error('getDonorReceipts error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

import db, { sql } from '../config/db.js';
import { getDonorByMobile } from '../models/donorProfileModel.js';
import { getWorkerById } from '../models/workerModel.js';
import { getActiveSalaryByWorker } from '../models/salaryModel.js';
import { getUserNgoAccess } from '../models/userNgoAccessModel.js';
import { updateNewDataStatusByNgoAndMobiles } from '../models/newDataModel.js';
import {
  batchCreateAssignments,
  findAssignmentsByNgo,
  getStationDispositionStats,
  getDonorsByStationAndStatus,
  createTemporaryTransfer,
  reverseTransfer,
} from '../models/froAssignmentModel.js';
import {
  upsertStationAssignment,
  createStation,
  getStationAssignmentsByNgo,
  deleteStationAssignment,
  getStationAssignmentByNgoAndStation,
} from '../models/froStationAssignmentModel.js';
import { upsertTarget, getTargetsByNgo, getTargetByWorker, updateAchievedTarget, updateIncentive } from '../models/froTargetModel.js';
import { getTotalCollectedByWorker, getVerifiedCollection, getUnverifiedCollection, getBatchCollectionStats } from '../models/froDonorLogModel.js';
import { getWorkersByNgo } from '../models/workerNgoAllocationModel.js';
import { getDayName, calculateAKI, getMonthsEmployed, getAKISlabs } from '../utils/incentive.js';

async function getFroWorkersByNgo(ngoId) {
  const workerIds = await getWorkersByNgo(ngoId);

  const conditions = [`ngo_id.eq.${ngoId}`];
  if (workerIds.length > 0) {
    conditions.push(`id.in.(${workerIds.join(',')})`);
  }

  const { data, error } = await db
    .from('workers')
    .select('*')
    .eq('department', 'FRO')
    .or(conditions.join(','));

  if (error) throw error;

  const seen = new Set();
  return (data || []).filter(w => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });
}

async function getUserNgoIds(user) {
  const access = await getUserNgoAccess(user.id);
  const ids = access.map(a => a.ngo_id).filter(Boolean);
  if (ids.length > 0) return ids;
  if (user.ngo_id) return [user.ngo_id];
  return [];
}

const _rCache = new Map();
const cacheGet = (key, ttlMs) => {
  const e = _rCache.get(key);
  if (e && Date.now() - e.t < ttlMs) return e.v;
  if (e) _rCache.delete(key);
  return undefined;
};
const cacheSet = (key, v) => {
  if (_rCache.size > 300) {
    const now = Date.now();
    for (const [k, e] of _rCache) if (now - e.t > 120000) _rCache.delete(k);
  }
  _rCache.set(key, { v, t: Date.now() });
};
const CONNECTED_STATUSES = [
  'contacted', 'donation_collected', 'lead_done', 'done', 'follow_up', 'scheduled',
  'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated',
  'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents',
  'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request',
  'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'callback',
];

export const getDonors = async (req, res) => {
  try {
    const { search, from_date, to_date, page: pageStr, page_size } = req.query;
    const page = Math.max(1, parseInt(pageStr) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(page_size) || 50));
    const offset = (page - 1) * limit;
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) ngoNames.push(ngo.name);
      if (req.user.ngo_id) ngoIds.push(req.user.ngo_id);
    }

    const { ngo_id: filterNgoId } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        const name = ngoNames[idx];
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
        ngoNames.splice(0, ngoNames.length, name);
      }
    }

    if (ngoNames.length === 0) return res.json({ data: [], pagination: { page, pageSize: limit, total: 0, totalPages: 0 } });

    let baseQuery = db.from('donor_profiles').select('*').in('ngo', ngoNames).order('last_donation_date', { ascending: false, nullsLast: true });

    if (from_date) baseQuery = baseQuery.gte('last_donation_date', from_date);
    if (to_date) baseQuery = baseQuery.lte('last_donation_date', to_date);
    if (search) {
      const q = `%${search}%`;
      baseQuery = baseQuery.or(`name.ilike.${q},mobile_number.ilike.${q},city.ilike.${q}`);
    }

    const { data: allData, error } = await baseQuery;
    if (error) throw error;

    const groups = {};
    for (const d of allData || []) {
      const key = d.mobile_number || `no-mobile-${d.id}`;
      if (!groups[key]) {
        groups[key] = { ...d, ngos: [d.ngo], donor_ids: [d.id], total_amount_all: Number(d.total_amount || d.amount || 0), records: 1 };
      } else {
        if (!groups[key].ngos.includes(d.ngo)) groups[key].ngos.push(d.ngo);
        if (!groups[key].donor_ids.includes(d.id)) groups[key].donor_ids.push(d.id);
        groups[key].total_amount_all += Number(d.total_amount || d.amount || 0);
        groups[key].records += 1;
        if (new Date(d.last_donation_date || 0) > new Date(groups[key].last_donation_date || 0)) {
          groups[key].name = d.name;
          groups[key].city = d.city;
          groups[key].last_donation_date = d.last_donation_date;
        }
      }
    }

    const grouped = Object.values(groups);
    grouped.sort((a, b) => new Date(b.last_donation_date || 0) - new Date(a.last_donation_date || 0));

    // FRO credit map: which FRO(s) hold collected credit for each donor profile
    const allGroupedDonorIds = grouped.flatMap(g => g.donor_ids || []);
    const froCreditMap = {};
    if (allGroupedDonorIds.length > 0) {
      const { data: creditLogs } = await db
        .from('fro_donor_logs')
        .select('donor_id, fro_worker_id, amount_collected')
        .in('donor_id', allGroupedDonorIds)
        .gt('amount_collected', 0);
      const workerIds = [...new Set((creditLogs || []).map(l => l.fro_worker_id).filter(Boolean))];
      const workerNames = {};
      if (workerIds.length > 0) {
        const { data: workers } = await db.from('workers').select('id, name').in('id', workerIds);
        for (const w of workers || []) workerNames[w.id] = w.name;
      }
      for (const l of creditLogs || []) {
        if (l.fro_worker_id == null) continue;
        if (!froCreditMap[l.donor_id]) froCreditMap[l.donor_id] = {};
        if (!froCreditMap[l.donor_id][l.fro_worker_id]) {
          froCreditMap[l.donor_id][l.fro_worker_id] = { fro_id: l.fro_worker_id, fro_name: workerNames[l.fro_worker_id] || 'Unknown', amount: 0 };
        }
        froCreditMap[l.donor_id][l.fro_worker_id].amount += Number(l.amount_collected) || 0;
      }
    }

    const total = grouped.length;
    const paginatedSlice = grouped.slice(offset, offset + limit);

    const allDonorIds = paginatedSlice.flatMap(g => g.donor_ids || []);
    let latestTxMap = {};
    if (allDonorIds.length > 0) {
      try {
        const { data: assignments } = await db
          .from('fro_assignments')
          .select('id, donor_id')
          .in('donor_id', allDonorIds);
        const assignIds = (assignments || []).map(a => a.id);
        if (assignIds.length > 0) {
          const { data: logs } = await db
            .from('fro_donor_logs')
            .select('amount_collected, created_at, assignment_id')
            .in('assignment_id', assignIds)
            .not('amount_collected', 'is', null)
            .order('created_at', { ascending: false });
          const assignToDonor = {};
          for (const a of assignments || []) assignToDonor[a.id] = a.donor_id;
          for (const log of logs || []) {
            const did = assignToDonor[log.assignment_id];
            if (did && (latestTxMap[did] == null)) {
              latestTxMap[did] = {
                amount: Number(log.amount_collected) || 0,
                date: log.created_at?.slice(0, 10),
              };
            }
          }
        }
      } catch (err) { console.error('Failed to fetch latest transactions:', err.message); }
    }

    const paginatedData = paginatedSlice.map(d => {
      let best = { amount: 0, date: null };
      for (const did of (d.donor_ids || [])) {
        const entry = latestTxMap[did];
        if (entry && (!best.date || entry.date > best.date)) best = entry;
      }
      const froAgg = {};
      for (const did of (d.donor_ids || [])) {
        for (const fc of Object.values(froCreditMap[did] || {})) {
          if (!froAgg[fc.fro_id]) froAgg[fc.fro_id] = { fro_id: fc.fro_id, fro_name: fc.fro_name, amount: 0 };
          froAgg[fc.fro_id].amount += fc.amount;
        }
      }
      const fro_credits = Object.values(froAgg).sort((a, b) => b.amount - a.amount);
      return {
        ...d,
        amount: d.total_amount_all,
        total_amount: d.total_amount_all,
        last_transaction_amount: best.amount,
        last_transaction_date: best.date,
        ngo_list: d.ngos,
        fro_credits,
        fro_names: fro_credits.map(f => f.fro_name),
      };
    });

    if (req.query.paginated === 'true') {
      return res.json({ data: paginatedData, pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) } });
    }
    return res.json(paginatedData);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorCreditLogs = async (req, res) => {
  try {
    const { donorId } = req.params;
    const numId = parseInt(donorId, 10);
    let donorIds = [];
    if (!isNaN(numId)) {
      const { data: donor } = await db.from('donor_profiles').select('id').eq('id', numId).maybeSingle();
      if (donor) donorIds = [donor.id];
    } else {
      const { data: donors } = await db.from('donor_profiles').select('id').eq('mobile_number', donorId);
      donorIds = (donors || []).map(d => d.id);
    }
    if (donorIds.length === 0) return res.json([]);

    const { data, error } = await db
      .from('fro_donor_logs')
      .select(`
        id, amount_collected, action, disposition_detail, accounts_status,
        created_at, fro_worker_id, assignment_id,
        workers!fro_donor_logs_fro_worker_id_fkey(id, name),
        fro_assignments(ngo_id, station)
      `)
      .in('donor_id', donorIds)
      .gt('amount_collected', 0)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return res.json((data || []).map(l => ({
      id: l.id,
      amount: Number(l.amount_collected) || 0,
      collected_at: l.created_at,
      collector_name: l.workers?.name || 'Unknown',
      fro_worker_id: l.fro_worker_id,
      accounts_status: l.accounts_status,
      action: l.action,
      disposition_detail: l.disposition_detail,
      assignment_id: l.assignment_id,
      ngo_id: l.fro_assignments?.ngo_id || null,
      station: l.fro_assignments?.station || null,
    })));
  } catch (error) {
    console.error('getDonorCreditLogs error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

export const transferDonorCredit = async (req, res) => {
  try {
    const { logId } = req.params;
    const { target_fro_worker_id } = req.body || {};
    if (!target_fro_worker_id) {
      return res.status(400).json({ message: 'target_fro_worker_id is required' });
    }

    const targetId = parseInt(target_fro_worker_id, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ message: 'Invalid target FRO' });
    }

    let target;
    try {
      target = await getWorkerById(targetId);
    } catch (e) {
      return res.status(400).json({ message: 'Target FRO worker not found' });
    }

    const numLogId = parseInt(logId, 10);
    if (isNaN(numLogId)) {
      return res.status(400).json({ message: 'Invalid log id' });
    }

    const { data: log, error: logErr } = await db
      .from('fro_donor_logs')
      .select('id, donor_id, fro_worker_id, amount_collected')
      .eq('id', numLogId)
      .maybeSingle();
    if (logErr) throw logErr;
    if (!log) return res.status(404).json({ message: 'Credit log not found' });
    if (!log.amount_collected || Number(log.amount_collected) <= 0) {
      return res.status(400).json({ message: 'This log has no collectible credit' });
    }
    if (log.fro_worker_id === targetId) {
      return res.status(409).json({ message: 'Credit already belongs to this FRO' });
    }

    const { error: updErr } = await db
      .from('fro_donor_logs')
      .update({ fro_worker_id: targetId })
      .eq('id', numLogId);
    if (updErr) throw updErr;

    return res.json({
      message: `Credit of ₹${Number(log.amount_collected).toLocaleString('en-IN')} moved to ${target.name || 'the selected FRO'}`,
      log_id: numLogId,
      amount_moved: Number(log.amount_collected),
      target_fro_worker_id: targetId,
    });
  } catch (error) {
    console.error('transferDonorCredit error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorDetail = async (req, res) => {
  try {
    const { mobile } = req.params;
    const profile = await getDonorByMobile(mobile);
    if (!profile) {
      return res.status(404).json({ message: 'Donor not found' });
    }

    const { data: donations, error } = await db
      .from('new_data')
      .select('*')
      .eq('mobile_number', mobile)
      .order('transaction_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;

    return res.json({ profile, donations: donations || [] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getAccessibleNgos = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const seen = new Set();
    const ngos = access.map(a => ({ id: a.ngo_id, name: a.ngo_name })).filter(n => {
      if (!n.id || seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
    return res.json(ngos);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const STANDARD_NGOS = [
  { name: 'BSCT', code: 'BSCT' },
  { name: 'AFLF', code: 'AFLF' },
  { name: 'MANN', code: 'MANN' },
];

export const ensureStandardNgos = async (_req, res) => {
  try {
    const { data: existing } = await db.from('ngos').select('id, name');
    const nameSet = new Set((existing || []).map(n => n.name));
    const missing = STANDARD_NGOS.filter(n => !nameSet.has(n.name));
    let created = [];
    for (const ngo of missing) {
      const { data, error } = await db.from('ngos').insert({ name: ngo.name, code: ngo.code, is_active: true }).select('id, name').single();
      if (!error && data) created.push(data);
    }
    const { data: all } = await db.from('ngos').select('id, name');
    return res.json({ created: created.length, ngos: all || [] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getFroWorkers = async (req, res) => {
  try {
    const ngoIds = await getUserNgoIds(req.user);
    const allWorkers = [];
    for (const ngoId of ngoIds) {
      const workers = await getFroWorkersByNgo(ngoId);
      allWorkers.push(...workers);
    }
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });

    const workerIds = froWorkers.map(w => w.id);
    let allocMap = {};
    if (workerIds.length > 0) {
      const { data: allAllocs } = await db
        .from('worker_ngo_allocations')
        .select('worker_id, ngo_id')
        .in('worker_id', workerIds);
      for (const a of allAllocs || []) {
        if (!allocMap[a.worker_id]) allocMap[a.worker_id] = [];
        allocMap[a.worker_id].push(a.ngo_id);
      }
    }

    const result = await Promise.all(froWorkers.map(async (w) => {
      const salary = await getActiveSalaryByWorker(w.id);
      return {
        id: w.id,
        name: w.name,
        login_id: w.login_id,
        email: w.email,
        phone: w.phone,
        gender: w.gender,
        department: w.department,
        is_active: w.is_active,
        created_at: w.created_at,
        salary: salary ? parseFloat(salary.salary) : 0,
        salary_from_month: salary ? salary.from_month : null,
        allocated_ngo_ids: allocMap[w.id] || [],
      };
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};



export const getAssignments = async (req, res) => {
  try {
    const ngoIds = await getUserNgoIds(req.user);
    const { status, worker_id } = req.query;
    const allAssignments = [];
    for (const ngoId of ngoIds) {
      const assignments = await findAssignmentsByNgo(ngoId, { status, worker_id });
      allAssignments.push(...assignments);
    }
    const seen = new Set();
    const unique = allAssignments.filter(a => { const k = a.id; if (seen.has(k)) return false; seen.add(k); return true; });

    const result = unique.map(a => ({
      id: a.id,
      donor_id: a.donor_id,
      donor_mobile: a.donor_profiles?.mobile_number || '',
      donor_name: a.donor_profiles?.name || 'Unknown',
      donor_city: a.donor_profiles?.city || '',
      donor_amount: a.donor_profiles?.amount || 0,
      fro_worker_id: a.fro_worker_id,
      fro_name: a.workers?.name || 'Unknown',
      status: a.status,
      notes: a.notes,
      last_contacted_at: a.last_contacted_at,
      next_follow_up: a.next_follow_up,
      assigned_at: a.assigned_at,
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};



export const setTarget = async (req, res) => {
  try {
    const { fro_worker_id, month, target_amount, ngo_id } = req.body;
    const ngoIds = await getUserNgoIds(req.user);
    const ngoId = ngo_id && ngoIds.some(id => String(id) === String(ngo_id)) ? ngo_id : ngoIds[0];

    if (!fro_worker_id || !month || target_amount === undefined) {
      return res.status(400).json({ message: 'fro_worker_id, month, and target_amount are required' });
    }
    if (!ngoId) {
      return res.status(400).json({ message: 'No NGO assigned to your account' });
    }

    const worker = await getWorkerById(fro_worker_id);
    if (!worker) {
      return res.status(404).json({ message: 'Worker not found' });
    }

    const salary = await getActiveSalaryByWorker(fro_worker_id);
    const currentSalary = salary ? parseFloat(salary.salary) : 0;
    const joinedAt = new Date(worker.created_at);
    const targetMonth = new Date(month + '-01');
    const monthsEmployed = (targetMonth.getFullYear() - joinedAt.getFullYear()) * 12
      + (targetMonth.getMonth() - joinedAt.getMonth());

    let finalTarget = target_amount;
    let isAuto = false;
    if (monthsEmployed < 3) {
      if (monthsEmployed <= 0) finalTarget = currentSalary * 1;
      else if (monthsEmployed === 1) finalTarget = currentSalary * 2.5;
      else finalTarget = currentSalary * 3;
      isAuto = true;
    }

    const result = await upsertTarget({
      fro_worker_id,
      ngo_id: ngoId,
      month: month + '-01',
      target_amount: finalTarget,
      set_by: req.user.id,
    });

    return res.json({
      message: isAuto
        ? `Auto-calculated target set for month ${monthsEmployed + 1}: ₹${finalTarget.toLocaleString('en-IN')}`
        : 'Target set successfully',
      data: result,
      auto_target: isAuto,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getTargets = async (req, res) => {
  try {
    const ngoIds = await getUserNgoIds(req.user);
    const { month, ngo_id } = req.query;
    const targetMonth = month ? month + '-01' : new Date().toISOString().slice(0, 7) + '-01';

    const filterNgoIds = ngo_id && ngoIds.some(id => String(id) === String(ngo_id))
      ? [ngo_id]
      : ngoIds;

    const allWorkers = [];
    for (const ngoId of filterNgoIds) {
      const workers = await getFroWorkersByNgo(ngoId);
      allWorkers.push(...workers);
    }
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });

    const allManualTargets = [];
    for (const ngoId of filterNgoIds) {
      const targets = await getTargetsByNgo(ngoId, targetMonth);
      allManualTargets.push(...targets);
    }
    const manualMap = {};
    const achievedMap = {};
    const incentiveMap = {};
    for (const t of allManualTargets) {
      manualMap[t.fro_worker_id] = parseFloat(t.target_amount);
      achievedMap[t.fro_worker_id] = t.achieved_target != null ? parseFloat(t.achieved_target) : null;
      incentiveMap[t.fro_worker_id] = t.incentive != null ? parseFloat(t.incentive) : null;
    }

    const result = await Promise.all(froWorkers.map(async (w) => {
      const salary = await getActiveSalaryByWorker(w.id);
      const currentSalary = salary ? parseFloat(salary.salary) : 0;
      const joinedAt = new Date(w.created_at);
      const targetDate = new Date(targetMonth);
      const monthsEmployed = (targetDate.getFullYear() - joinedAt.getFullYear()) * 12
        + (targetDate.getMonth() - joinedAt.getMonth());

      let target;
      let targetSource;
      if (monthsEmployed < 3) {
        if (monthsEmployed <= 0) { target = currentSalary * 1; targetSource = 'auto_month1'; }
        else if (monthsEmployed === 1) { target = currentSalary * 2.5; targetSource = 'auto_month2'; }
        else { target = currentSalary * 3; targetSource = 'auto_month3'; }
      } else {
        target = manualMap[w.id] || 0;
        targetSource = manualMap[w.id] ? 'manual' : 'not_set';
      }

      return {
        id: w.id,
        name: w.name,
        login_id: w.login_id,
        salary: currentSalary,
        joined_at: w.created_at,
        months_employed: monthsEmployed,
        target,
        target_source: targetSource,
        manual_target: manualMap[w.id] || null,
        achieved_target: achievedMap[w.id] || null,
        incentive: incentiveMap[w.id] || null,
      };
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDailyTarget = async (req, res) => {
  try {
    const { data: worker } = await db
      .from('workers')
      .select('daily_collection_target')
      .eq('id', req.user.id)
      .maybeSingle();
    return res.json({ daily_target: worker ? Number(worker.daily_collection_target) || 0 : 0 });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDashboard = async (req, res) => {
  try {
    const dashCacheKey = `dash:${req.user.id}:${req.query.ngo_id || 'all'}`;
    if (req.query.fresh !== '1') {
      const cached = cacheGet(dashCacheKey, 60000);
      if (cached) return res.json(cached);
    }
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) ngoNames.push(ngo.name);
      if (req.user.ngo_id) ngoIds.push(req.user.ngo_id);
    }

    const { ngo_id: filterNgoId } = req.query;
    const origNgoNames = [...ngoNames];
    const origNgoIds = [...ngoIds];

    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        ngoNames.splice(0, ngoNames.length, ngoNames[idx]);
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
      }
    }

    const allWorkers = (await Promise.all(ngoIds.map(ngoId => getFroWorkersByNgo(ngoId)))).flat();
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });

    let totalDonorCount = 0;
    if (ngoNames.length > 0) {
      const donorCountRows = await sql(
        'SELECT COUNT(DISTINCT mobile_number) AS c FROM new_data WHERE ngo = ANY($1) AND mobile_number IS NOT NULL',
        [ngoNames]
      );
      totalDonorCount = parseInt(donorCountRows[0] ? donorCountRows[0].c : 0, 10) || 0;
    }

    const assignmentAgg = ngoIds.length > 0
      ? await sql(
          `SELECT donor_id,
                  BOOL_OR(status <> 'reassigned') AS has_active,
                  BOOL_OR(status = 'donation_collected') AS has_collected,
                  BOOL_OR(status <> 'reassigned' AND status = ANY($2)) AS connected,
                  array_agg(DISTINCT fro_worker_id) FILTER (WHERE fro_worker_id IS NOT NULL) AS worker_ids
           FROM fro_assignments
           WHERE ngo_id = ANY($1)
           GROUP BY donor_id`,
          [ngoIds, CONNECTED_STATUSES]
        )
      : [];
    const collectedDonorCount = assignmentAgg.filter(a => a.has_collected).length;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    const achievedMap = {};
    const allTargets = (await Promise.all(ngoIds.map(ngoId => getTargetsByNgo(ngoId, monthStr)))).flat();
    for (const t of allTargets) {
      if (t.achieved_target != null) achievedMap[t.fro_worker_id] = parseFloat(t.achieved_target);
    }

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    // Batch all collection stats in a single query
    const workerIds = froWorkers.map(w => w.id);
    const batchStats = await getBatchCollectionStats(workerIds, monthStart, monthEnd, todayStart.toISOString(), todayEnd.toISOString(), ngoIds);

    let monthCollection = 0;
    for (const w of froWorkers) {
      const actual = batchStats.monthCollection[w.id] || 0;
      const achieved = achievedMap[w.id];
      monthCollection += (achieved != null && achieved > 0) ? achieved : actual;
    }

    // Data used / unused — per unique donor
    let assignedCount = 0, dataUsed = 0, dataUnused = 0;
    for (const a of assignmentAgg) {
      if (!a.has_active) continue;
      assignedCount++;
      if (a.connected) dataUsed++;
      else dataUnused++;
    }

    // Active donors: those who donated within the last 1 year
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const donorsWithRecentDonations = ngoIds.length > 0
      ? (await db
          .from('fro_donor_logs')
          .select('donor_id, fro_assignments!inner(ngo_id)')
          .in('fro_assignments.ngo_id', ngoIds)
          .or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified),and(disposition_detail.eq.done,action.eq.disposition)')
          .gte('created_at', oneYearAgo.toISOString())).data || []
      : [];

    const activeDonorIds = new Set(donorsWithRecentDonations.map(d => d.donor_id).filter(Boolean));
    let activeDonors = 0, inactiveDonors = 0;
    for (const a of assignmentAgg) {
      if (!a.has_active) continue;
      if (activeDonorIds.has(a.donor_id)) activeDonors++;
      else inactiveDonors++;
    }

    let todayCollection = 0;
    for (const w of froWorkers) {
      todayCollection += batchStats.todayCollection[w.id] || 0;
    }

    let verifiedMonthAmount = 0, verifiedMonthCount = 0;
    let unverifiedMonthAmount = 0, unverifiedMonthCount = 0;
    let verifiedTodayAmount = 0, verifiedTodayCount = 0;
    let unverifiedTodayAmount = 0, unverifiedTodayCount = 0;
    for (const w of froWorkers) {
      const vm = batchStats.verifiedMonth[w.id] || { amount: 0, count: 0 };
      verifiedMonthAmount += vm.amount; verifiedMonthCount += vm.count;
      const um = batchStats.unverifiedMonth[w.id] || { amount: 0, count: 0 };
      unverifiedMonthAmount += um.amount; unverifiedMonthCount += um.count;
      const vt = batchStats.verifiedToday[w.id] || { amount: 0, count: 0 };
      verifiedTodayAmount += vt.amount; verifiedTodayCount += vt.count;
      const ut = batchStats.unverifiedToday[w.id] || { amount: 0, count: 0 };
      unverifiedTodayAmount += ut.amount; unverifiedTodayCount += ut.count;
    }

    // Reactivation metrics (same logic as FRO dashboard, scoped by NGO)
    const fyYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    const fyStart = new Date(fyYear, 3, 1);

    const [fyDonorsRes, todayDonorsRes, monthDonorsRes] = ngoIds.length > 0
      ? await Promise.all([
          db.from('fro_donor_logs').select('donor_id, created_at, fro_assignments!inner(ngo_id)')
            .in('fro_assignments.ngo_id', ngoIds)
            .or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified),and(disposition_detail.eq.done,action.eq.disposition)')
            .gte('created_at', fyStart.toISOString()),
          db.from('fro_donor_logs').select('donor_id, fro_assignments!inner(ngo_id)')
            .in('fro_assignments.ngo_id', ngoIds)
            .or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified),and(disposition_detail.eq.done,action.eq.disposition)')
            .gte('created_at', todayStart.toISOString())
            .lte('created_at', todayEnd.toISOString()),
          db.from('fro_donor_logs').select('donor_id, fro_assignments!inner(ngo_id)')
            .in('fro_assignments.ngo_id', ngoIds)
            .or('action.eq.donation,and(disposition_detail.eq.lead_done,action.eq.disposition,accounts_status.eq.verified),and(disposition_detail.eq.done,action.eq.disposition)')
            .gte('created_at', monthStart)
            .lte('created_at', monthEnd),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

    const todayStr = todayStart.toISOString();
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

    // Attendance metrics
    const activeFroIds = froWorkers.filter(w => w.is_active !== false).map(w => w.id);
    let workersPresent = 0, workersAbsent = 0, workersLate = 0;
    if (activeFroIds.length > 0) {
      const { data: attendanceData } = await db
        .from('attendance')
        .select('status')
        .eq('date', todayStr)
        .in('worker_id', activeFroIds);
      workersPresent = (attendanceData || []).filter(a => a.status === 'present').length;
      workersLate = (attendanceData || []).filter(a => a.status === 'late').length;
      workersAbsent = (attendanceData || []).filter(a => a.status === 'absent').length;
    }
    const activeFroCount = froWorkers.filter(w => w.is_active !== false).length;
    const attendancePct = activeFroCount > 0 ? Math.round(((workersPresent + workersLate) / activeFroCount) * 1000) / 10 : 0;

    const assignedWorkerIds = new Set();
    for (const a of assignmentAgg) for (const id of a.worker_ids || []) assignedWorkerIds.add(id);
    const assignedFroCount = assignedWorkerIds.size;

    const ngoIdToName = {};
    for (const a of access) ngoIdToName[a.ngo_id] = a.ngo_name;
    if (req.user.ngo_id && !ngoIdToName[req.user.ngo_id]) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) ngoIdToName[req.user.ngo_id] = ngo.name;
    }

    let stationsPerNgo = {};
    if (origNgoIds.length > 0) {
      const { data: stationAssigns } = await db
        .from('fro_station_assignments')
        .select('ngo_id')
        .in('ngo_id', origNgoIds);
      for (const sa of stationAssigns || []) {
        const name = ngoIdToName[sa.ngo_id] || 'Unknown';
        stationsPerNgo[name] = (stationsPerNgo[name] || 0) + 1;
      }
    }

    let daily_target = 0;
    const { data: workerRec } = await db
      .from('workers')
      .select('daily_collection_target')
      .eq('id', req.user.id)
      .maybeSingle();
    if (workerRec) daily_target = Number(workerRec.daily_collection_target) || 0;

    let monthly_target = 0;
    const currentMonthStr = now.toISOString().slice(0, 7) + '-01';
    if (origNgoIds.length > 0) {
      const { data: mTargets } = await db
        .from('fro_monthly_targets')
        .select('target_amount')
        .in('ngo_id', origNgoIds)
        .eq('month', currentMonthStr);
      if (mTargets && mTargets.length > 0) {
        monthly_target = mTargets.reduce((sum, t) => sum + (parseFloat(t.target_amount) || 0), 0);
      }
    }
    if (!monthly_target && daily_target > 0) {
      monthly_target = daily_target * 26;
    }

    const noMarkCount = Math.max(0, activeFroCount - workersPresent - workersLate - workersAbsent);

    const payload = {
      ngos: origNgoNames,
      period: {
        month: now.toISOString().slice(0, 7),
        today: todayStr,
      },
      summary: {
        donors: {
          total: totalDonorCount,
          assigned: assignedCount,
          assigned_pct: totalDonorCount > 0 ? Math.round((assignedCount / totalDonorCount) * 100) : 0,
          collected: collectedDonorCount,
          active: activeDonors,
          inactive: inactiveDonors,
        },
        collection: {
          month: {
            total: monthCollection,
            verified: { amount: verifiedMonthAmount, count: verifiedMonthCount },
            unverified: { amount: unverifiedMonthAmount, count: unverifiedMonthCount },
          },
          today: {
            total: todayCollection,
            verified: { amount: verifiedTodayAmount, count: verifiedTodayCount },
            unverified: { amount: unverifiedTodayAmount, count: unverifiedTodayCount },
          },
          daily_target,
          monthly_target,
        },
        reactivations: {
          today: reactivatedToday,
          month: reactivatedMonthly,
        },
      },
      workers: {
        fro: {
          total: froWorkers.length,
          active: activeFroCount,
          with_assignments: assignedFroCount,
          assignment_coverage_pct: activeFroCount > 0 ? Math.round((assignedFroCount / activeFroCount) * 100) : 0,
        },
        attendance: {
          present: workersPresent,
          late: workersLate,
          absent: workersAbsent,
          no_mark: noMarkCount,
          pct: attendancePct,
        },
      },
      assignments: {
        total: assignedCount,
        data_connected: dataUsed,
        data_unconnected: dataUnused,
        connect_rate_pct: assignedCount > 0 ? Math.round((dataUsed / assignedCount) * 100) : 0,
      },
      stations_per_ngo: stationsPerNgo,
    };
    cacheSet(dashCacheKey, payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getFroWiseCollection = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) ngoNames.push(ngo.name);
      if (req.user.ngo_id) ngoIds.push(req.user.ngo_id);
    }

    const allWorkers = (await Promise.all(ngoIds.map(ngoId => getFroWorkersByNgo(ngoId)))).flat();
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });

    const period = req.query.period || 'month';
    const now = new Date();
    let startDate, endDate;

    if (period === 'today') {
      startDate = new Date(); startDate.setHours(0, 0, 0, 0);
      endDate = new Date(); endDate.setHours(23, 59, 59, 999);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const achievedMap = {};
    if (period === 'month') {
      const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
      const allTargets = (await Promise.all(ngoIds.map(ngoId => getTargetsByNgo(ngoId, monthStr)))).flat();
      for (const t of allTargets) {
        if (t.achieved_target != null) achievedMap[t.fro_worker_id] = parseFloat(t.achieved_target);
      }
    }

    const workerAmounts = await Promise.all(froWorkers.map(w =>
      getTotalCollectedByWorker(w.id, startDate.toISOString(), endDate.toISOString())
    ));
    const result = froWorkers.map((w, i) => {
      const amount = workerAmounts[i];
      const achieved = achievedMap[w.id];
      return {
        fro_id: w.id,
        fro_name: w.name || w.login_id || 'Unknown',
        collection_amount: achieved != null && achieved > 0 ? achieved : amount,
        ...(achieved != null && achieved > 0 ? { is_achieved: true } : {}),
      };
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getFroPerformance = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    let ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames.push(ngo.name); ngoIds.push(req.user.ngo_id); }
    }

    const { ngo_id: filterNgoId } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) { ngoIds.splice(0, ngoIds.length, ngoIds[idx]); }
    }

    if (ngoIds.length === 0) return res.json([]);

    const allWorkers = (await Promise.all(ngoIds.map(ngoId => getFroWorkersByNgo(ngoId)))).flat();
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });

    const period = req.query.period || 'month';
    const now = new Date();
    let startDate, endDate;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    if (period === 'today') {
      startDate = todayStart;
      endDate = todayEnd;
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const workerIds = froWorkers.map(w => w.id);
    const batchStats = await getBatchCollectionStats(workerIds, startDate.toISOString(), endDate.toISOString(), todayStart.toISOString(), todayEnd.toISOString(), ngoIds);

    const todayStr = now.toISOString().slice(0, 10);
    const attendanceMap = {};
    if (workerIds.length > 0) {
      if (period === 'today') {
        const { data: att } = await db.from('attendance').select('worker_id, status').eq('date', todayStr).in('worker_id', workerIds);
        for (const a of att || []) attendanceMap[a.worker_id] = a.status === 'present' || a.status === 'late' ? 100 : a.status === 'absent' ? 0 : null;
      } else {
        const monthStr = startDate.toISOString().slice(0, 7);
        const endStr = endDate.toISOString().slice(0, 10);
        const { data: att } = await db.from('attendance').select('worker_id, status').gte('date', monthStr + '-01').lte('date', endStr).in('worker_id', workerIds);
        const counts = {};
        for (const a of att || []) {
          if (!counts[a.worker_id]) counts[a.worker_id] = { present: 0, total: 0 };
          counts[a.worker_id].total++;
          if (a.status === 'present' || a.status === 'late') counts[a.worker_id].present++;
        }
        for (const [wid, c] of Object.entries(counts)) {
          attendanceMap[wid] = c.total > 0 ? Math.round((c.present / c.total) * 1000) / 10 : null;
        }
      }
    }

    const liveStatusMap = {};
    if (workerIds.length > 0) {
      const { data: live } = await db.from('fro_live_status').select('fro_worker_id, today_talk_seconds').in('fro_worker_id', workerIds);
      for (const l of live || []) liveStatusMap[l.fro_worker_id] = l.today_talk_seconds || 0;
    }

    const { data: faRows } = await db
      .from('fro_assignments')
      .select('status, fro_worker_id')
      .in('ngo_id', ngoIds);
    const connectedStatuses = new Set(['contacted', 'donation_collected', 'lead_done', 'done', 'follow_up', 'scheduled', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'callback']);
    const workerAssignments = {};
    for (const a of faRows || []) {
      if (a.status === 'reassigned') continue;
      if (!workerAssignments[a.fro_worker_id]) workerAssignments[a.fro_worker_id] = { connected: 0, total: 0 };
      workerAssignments[a.fro_worker_id].total++;
      if (connectedStatuses.has(a.status)) workerAssignments[a.fro_worker_id].connected++;
    }

    const performance = froWorkers.map(w => {
      const bs = batchStats;
      const coll = period === 'today' ? (bs.todayCollection[w.id] || 0) : (bs.monthCollection[w.id] || 0);
      const leads = period === 'today'
        ? (bs.verifiedToday[w.id]?.count || 0) + (bs.unverifiedToday[w.id]?.count || 0)
        : (bs.verifiedMonth[w.id]?.count || 0) + (bs.unverifiedMonth[w.id]?.count || 0);
      const talkSec = period === 'today' ? (liveStatusMap[w.id] || 0) : 0;
      const wa = workerAssignments[w.id] || { connected: 0, total: 0 };
      const attPct = attendanceMap[w.id] != null ? attendanceMap[w.id] : null;
      return {
        fro_id: w.id,
        fro_name: w.name || w.login_id || 'Unknown',
        collection_amount: coll,
        lead_done_count: leads,
        avg_talk_seconds: talkSec,
        data_used: wa.connected,
        data_total: wa.total,
        attendance_pct: attPct,
      };
    });

    const maxColl = Math.max(...performance.map(p => p.collection_amount), 1);
    const maxLeads = Math.max(...performance.map(p => p.lead_done_count), 1);
    const maxTalk = Math.max(...performance.map(p => p.avg_talk_seconds), 1);
    const maxData = Math.max(...performance.map(p => p.data_used), 1);

    const isSingleWorker = performance.length <= 1;
    const scored = performance.map(p => ({
      ...p,
      score: isSingleWorker
        ? Math.round((
            (p.collection_amount > 0 ? 0.4 : 0) +
            (p.lead_done_count > 0 ? 0.25 : 0) +
            (p.avg_talk_seconds > 0 ? 0.1 : 0) +
            (p.data_used > 0 ? 0.1 : 0) +
            ((p.attendance_pct != null && p.attendance_pct > 0) ? 0.15 : 0)
          ) * 100) / 100
        : Math.round((
            (p.collection_amount / maxColl) * 0.30 +
            (p.lead_done_count / maxLeads) * 0.25 +
            (p.avg_talk_seconds / maxTalk) * 0.15 +
            (p.data_used / maxData) * 0.15 +
            ((p.attendance_pct != null ? p.attendance_pct : 0) / 100) * 0.15
          ) * 100) / 100,
    }));

    scored.sort((a, b) => a.score - b.score);
    return res.json(scored.slice(0, 6));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const setAchievedTarget = async (req, res) => {
  try {
    const { fro_worker_id, month, achieved_amount, ngo_id } = req.body;
    const ngoIds = await getUserNgoIds(req.user);
    const ngoId = ngo_id && ngoIds.some(id => String(id) === String(ngo_id)) ? ngo_id : ngoIds[0];

    if (!fro_worker_id || !month || achieved_amount === undefined) {
      return res.status(400).json({ message: 'fro_worker_id, month, and achieved_amount are required' });
    }
    if (!ngoId) {
      return res.status(400).json({ message: 'No NGO assigned to your account' });
    }

    const result = await updateAchievedTarget(fro_worker_id, ngoId, month + '-01', parseFloat(achieved_amount) || 0);

    return res.json({ message: 'Achieved target saved successfully', data: result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const setIncentive = async (req, res) => {
  try {
    const { fro_worker_id, month, incentive_amount, ngo_id } = req.body;
    const ngoIds = await getUserNgoIds(req.user);
    const ngoId = ngo_id && ngoIds.some(id => String(id) === String(ngo_id)) ? ngo_id : ngoIds[0];

    if (!fro_worker_id || !month) {
      return res.status(400).json({ message: 'fro_worker_id and month are required' });
    }
    if (!ngoId) {
      return res.status(400).json({ message: 'No NGO assigned to your account' });
    }

    const amount = incentive_amount != null && incentive_amount !== '' ? parseFloat(incentive_amount) : null;
    const result = await updateIncentive(fro_worker_id, ngoId, month + '-01', amount);

    return res.json({ message: 'Incentive saved successfully', data: result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ---- Accounts Panel ----

export const getAccountsPending = async (req, res) => {
  try {
    const { status } = req.query;
    const statusFilter = status || 'pending';

    const { data, error } = await db
      .from('fro_donor_logs')
      .select(`
        id, action, disposition_category, disposition_detail, amount_collected,
        payment_screenshot_url, accounts_status, pan_number, notes, remark, created_at,
        assignment_id, fro_worker_id,
        fro_assignments!inner(
          id,
          donor_id,
          fro_worker_id,
          status,
          donor_profiles!inner(id, name, mobile_number, city, pan_number),
          workers!inner(id, name, login_id)
        ),
        workers!fro_donor_logs_fro_worker_id_fkey(id, name, login_id)
      `)
      .eq('action', 'disposition')
      .eq('disposition_detail', 'lead_done')
      .eq('accounts_status', statusFilter)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const result = (data || []).map(r => ({
      log_id: r.id,
      amount: r.amount_collected,
      screenshot_url: r.payment_screenshot_url,
      accounts_status: r.accounts_status,
      pan_number: r.pan_number,
      notes: r.notes,
      remark: r.remark,
      created_at: r.created_at,
      assignment_id: r.assignment_id,
      assignment_status: r.fro_assignments?.status || 'lead_done',
      donor_id: r.fro_assignments?.donor_id,
      donor_name: r.fro_assignments?.donor_profiles?.name || 'Unknown',
      donor_mobile: r.fro_assignments?.donor_profiles?.mobile_number || '',
      donor_city: r.fro_assignments?.donor_profiles?.city || '',
      donor_pan: r.fro_assignments?.donor_profiles?.pan_number || '',
      worker_id: r.fro_worker_id,
      worker_name: r.workers?.name || 'Unknown',
      worker_login: r.workers?.login_id || '',
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const verifyLeadDone = async (req, res) => {
  try {
    const { logId } = req.params;
    const { pan_number, notes } = req.body;
    const ngoIds = await getUserNgoIds(req.user);

    const { data: logs, error: logError } = await db
      .from('fro_donor_logs')
      .select('*, fro_assignments!inner(id, fro_worker_id, donor_id, status, ngo_id, donor_profiles!inner(id, name, mobile_number))')
      .eq('id', logId)
      .limit(1);

    if (logError || !logs || logs.length === 0) {
      return res.status(404).json({ message: 'Log entry not found' });
    }
    const log = logs[0];

    const assignmentNgoId = log.fro_assignments?.ngo_id;
    if (assignmentNgoId && !ngoIds.includes(Number(assignmentNgoId))) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (log.accounts_status !== 'pending') {
      return res.status(400).json({ message: `This lead has already been ${log.accounts_status || 'processed'}` });
    }

    const assignmentId = log.fro_assignments?.id;
    if (!assignmentId) {
      return res.status(400).json({ message: 'Associated assignment not found' });
    }

    // Update log: verified (atomic check via .eq('accounts_status', 'pending'))
    const { data: updatedLog, error: updateLogError } = await db
      .from('fro_donor_logs')
      .update({
        accounts_status: 'verified',
        verified_at: new Date().toISOString(),
        verified_by: req.user.id,
        pan_number: pan_number || log.pan_number || null,
        notes: notes || log.notes || null,
      })
      .eq('id', logId)
      .eq('accounts_status', 'pending')
      .select('id');

    if (updateLogError) throw updateLogError;
    if (!updatedLog || updatedLog.length === 0) {
      return res.status(400).json({ message: 'This lead has already been processed (concurrent request)' });
    }

    // Update assignment: donation_collected
    const { error: updateAsgnError } = await db
      .from('fro_assignments')
      .update({
        status: 'donation_collected',
        last_contacted_at: new Date().toISOString(),
      })
      .eq('id', assignmentId);

    if (updateAsgnError) throw updateAsgnError;

    return res.json({ message: 'Lead verified, amount added to target' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ---- Station Management ----

export const getStations = async (req, res) => {
  try {
    const { ngo_id } = req.query;

    let targetNgoIds;
    if (ngo_id) {
      targetNgoIds = [ngo_id];
    } else {
      const access = await getUserNgoAccess(req.user.id);
      targetNgoIds = access.map(a => a.ngo_id).filter(Boolean);
      if (targetNgoIds.length === 0 && req.user.ngo_id) {
        targetNgoIds.push(req.user.ngo_id);
      }
      if (targetNgoIds.length === 0) return res.json([]);
    }

    // Get all station assignments (including unassigned)
    const assignments = await getStationAssignmentsByNgo(targetNgoIds, true);

    // Get donor counts per station from fro_assignments (deduplicated by donor_id)
    const { data: faData, error: faErr } = await db
      .from('fro_assignments')
      .select('donor_id, station, ngo_id, fro_worker_id, assigned_at')
      .in('ngo_id', targetNgoIds)
      .not('station', 'is', null)
      .not('status', 'eq', 'reassigned')
      .order('assigned_at', { ascending: false });

    if (faErr) throw faErr;

    // Build total donor count per station PER NGO and per-FRO count
    const totalDonorCount = {}; // { station: { ngo_id: count } }
    const froDonorCount = {};
    const seen = new Set();
    for (const d of faData || []) {
      if (seen.has(d.donor_id)) continue;
      seen.add(d.donor_id);
      const s = d.station.trim();
      if (!totalDonorCount[s]) totalDonorCount[s] = {};
      totalDonorCount[s][d.ngo_id] = (totalDonorCount[s][d.ngo_id] || 0) + 1;
      if (d.fro_worker_id) {
        const key = `${s}_${d.fro_worker_id}`;
        froDonorCount[key] = (froDonorCount[key] || 0) + 1;
      }
    }

    const ngoIdToName = {};
    if (ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', ngo_id).single();
      if (ngo) ngoIdToName[ngo_id] = ngo.name;
    } else {
      const access = await getUserNgoAccess(req.user.id);
      for (const a of access) {
        ngoIdToName[a.ngo_id] = a.ngo_name;
      }
      if (req.user.ngo_id && !ngoIdToName[req.user.ngo_id]) {
        const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
        if (ngo) ngoIdToName[req.user.ngo_id] = ngo.name;
      }
    }

    // Group by station name — one row per station
    const stationMap = {};

    for (const a of assignments) {
      const s = a.station.trim();
      if (!stationMap[s]) {
        stationMap[s] = {
          station: s,
          ngos: [],
          fro_worker_id: a.fro_worker_id || null,
          fro_worker_name: a.workers?.name || null,
        };
      }
      stationMap[s].ngos.push({
        ngo_id: a.ngo_id,
        ngo_name: ngoIdToName[a.ngo_id] || 'Unknown',
        assignment_id: a.id,
      });
      // Update FRO if this assignment has one (first non-null wins)
      if (!stationMap[s].fro_worker_id && a.fro_worker_id) {
        stationMap[s].fro_worker_id = a.fro_worker_id;
        stationMap[s].fro_worker_name = a.workers?.name || null;
      }
    }

    // Also add stations from donor_profiles not in fro_station_assignments
    for (const s of Object.keys(totalDonorCount)) {
      if (!stationMap[s]) {
        stationMap[s] = {
          station: s,
          ngos: [],
          fro_worker_id: null,
          fro_worker_name: null,
        };
      }
    }

    const result = Object.values(stationMap).map(s => ({
      ...s,
      donor_count: totalDonorCount[s.station] || {}, // { ngo_id: count }
      fro_donor_count: s.fro_worker_id ? (froDonorCount[`${s.station}_${s.fro_worker_id}`] || 0) : 0,
    }));

    result.sort((a, b) => {
      const parseStation = (s) => {
        const idx = s.lastIndexOf('-');
        if (idx === -1) return [s, 0];
        const prefix = s.slice(0, idx);
        const num = parseInt(s.slice(idx + 1), 10);
        return [prefix, isNaN(num) ? 0 : num];
      };
      const [pA, nA] = parseStation(a.station);
      const [pB, nB] = parseStation(b.station);
      if (pA !== pB) return pA.localeCompare(pB);
      return nA - nB;
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const saveStationAssignment = async (req, res) => {
  try {
    const { station, fro_worker_id } = req.body;
    if (!station) {
      return res.status(400).json({ message: 'station is required' });
    }

    const trimmedStation = station.trim();
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames.push(ngo.name); ngoIds.push(req.user.ngo_id); }
    }

    let ngoId;
    if (ngoNames.length > 0) {
      const { data: donorStation } = await db
        .from('donor_profiles')
        .select('ngo')
        .eq('station', trimmedStation)
        .in('ngo', ngoNames)
        .limit(1)
        .maybeSingle();

      if (donorStation) {
        const idx = ngoNames.indexOf(donorStation.ngo);
        if (idx !== -1) ngoId = ngoIds[idx];
      }
    }

    if (!ngoId) ngoId = ngoIds[0] || req.user.ngo_id || null;
    if (!ngoId) return res.status(400).json({ message: 'No NGO assigned to your account' });

    const result = await upsertStationAssignment(fro_worker_id || null, ngoId, trimmedStation, req.user.id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const removeStationAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    const ngoIds = await getUserNgoIds(req.user);
    const { data: existing } = await db
      .from('fro_station_assignments')
      .select('ngo_id')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return res.status(404).json({ message: 'Station assignment not found' });
    if (!ngoIds.includes(existing.ngo_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    await deleteStationAssignment(id);
    return res.json({ message: 'Station assignment removed' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const removeStationByName = async (req, res) => {
  try {
    const { station } = req.params;
    if (!station) return res.status(400).json({ message: 'Station name is required' });
    const { ngo_id } = req.query;
    const ngoIds = await getUserNgoIds(req.user);

    const delNgoId = ngo_id || null;
    if (delNgoId && !ngoIds.some(id => String(id) === String(delNgoId))) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let delQuery = db
      .from('fro_station_assignments')
      .delete()
      .eq('station', station.trim());
    if (delNgoId) {
      delQuery = delQuery.eq('ngo_id', delNgoId);
    } else {
      delQuery = delQuery.in('ngo_id', ngoIds);
    }

    const { error } = await delQuery;
    if (error) throw error;

    return res.json({ message: 'Station deleted' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const createStationHandler = async (req, res) => {
  try {
    const { station, ngo_id } = req.body;
    if (!station) {
      return res.status(400).json({ message: 'station name is required' });
    }
    const ngoIds = await getUserNgoIds(req.user);
    if (ngo_id && !ngoIds.some(id => String(id) === String(ngo_id))) {
      return res.status(403).json({ message: 'Access denied for this NGO' });
    }

    const stationName = station.trim();

    const { data: existing } = await db
      .from('fro_station_assignments')
      .select('id')
      .eq('station', stationName)
      .eq('ngo_id', ngo_id || null)
      .maybeSingle();
    if (existing) {
      return res.json({ message: 'already exists' });
    }

    const { data, error } = await db
      .from('fro_station_assignments')
      .insert([{ station: stationName, ngo_id: ngo_id || null, assigned_by: req.user.id }])
      .select();
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateStationNgos = async (req, res) => {
  try {
    const { station } = req.params;
    const { ngo_id, fro_worker_id } = req.body;

    const access = await getUserNgoAccess(req.user.id);
    const allowedNgoIds = new Set(access.map(a => a.ngo_id));

    // Verify the NGO is accessible
    const validNgoId = ngo_id && allowedNgoIds.has(ngo_id) ? ngo_id : null;

    // Upsert single assignment (avoids delete-then-insert race condition)
    const { error: upsertErr } = await db
      .from('fro_station_assignments')
      .upsert({
        station: station.trim(),
        ngo_id: validNgoId,
        assigned_by: req.user.id,
        fro_worker_id: fro_worker_id || null,
      }, { onConflict: 'station,ngo_id' });
    if (upsertErr) throw upsertErr;

    return res.json({ message: 'Station updated' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const reassignStationFro = async (req, res) => {
  try {
    const { id } = req.params;
    const { fro_worker_id } = req.body;
    if (!fro_worker_id) {
      return res.status(400).json({ message: 'fro_worker_id is required' });
    }

    const access = await getUserNgoAccess(req.user.id);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);
    const ngoId = ngoIds[0] || req.user.ngo_id;
    if (!ngoId) return res.status(400).json({ message: 'No NGO assigned' });

    // Get station info
    const { data: stationAssign } = await db
      .from('fro_station_assignments')
      .select('station')
      .eq('id', id)
      .single();
    if (!stationAssign) return res.status(404).json({ message: 'Station assignment not found' });

    // Update station assignment
    await upsertStationAssignment(fro_worker_id, ngoId, stationAssign.station, req.user.id);

    // Reassign donors in this station
    const { reassignStationDonors } = await import('../models/froAssignmentModel.js');
    const newAssignments = await reassignStationDonors(ngoId, stationAssign.station, fro_worker_id, req.user.id);

    return res.json({
      message: `Station reassigned. ${newAssignments.length} donors assigned to new FRO.`,
      count: newAssignments.length,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getStationStats = async (req, res) => {
  try {
    const stationCacheKey = `stn:${req.user.id}:${req.query.ngo_id || 'all'}:${req.query.from || ''}:${req.query.to || ''}`;
    if (req.query.fresh !== '1') {
      const cached = cacheGet(stationCacheKey, 60000);
      if (cached) return res.json(cached);
    }
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames.push(ngo.name); ngoIds.push(req.user.ngo_id); }
    }

    const { ngo_id: filterNgoId, from, to } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        ngoNames.splice(0, ngoNames.length, ngoNames[idx]);
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
      }
    }

    if (ngoIds.length === 0) return res.json({ stations: {}, summary: {} });

    const stationMap = {};

    const allStats = await Promise.all(ngoIds.map(ngoId => getStationDispositionStats(ngoId, from, to)));
    for (const stats of allStats) {
      for (const [station, statuses] of Object.entries(stats)) {
        if (!stationMap[station]) stationMap[station] = {};
        for (const [status, count] of Object.entries(statuses)) {
          stationMap[station][status] = (stationMap[station][status] || 0) + count;
        }
      }
    }

    const summaryRows = await sql(
      `SELECT status, COUNT(*) AS c
       FROM (SELECT DISTINCT donor_id, status FROM fro_assignments WHERE ngo_id = ANY($1) AND station IS NOT NULL AND status <> 'reassigned') t
       GROUP BY status`,
      [ngoIds]
    );
    const summary = {};
    for (const r of summaryRows) summary[r.status] = parseInt(r.c, 10) || 0;

    // Get all stations for this NGO (including empty ones)
    const stationAssigns = await getStationAssignmentsByNgo(ngoIds);
    for (const sa of stationAssigns) {
      if (!stationMap[sa.station]) {
        stationMap[sa.station] = {};
      }
    }

    const stationPayload = { stations: stationMap, summary };
    cacheSet(stationCacheKey, stationPayload);
    return res.json(stationPayload);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};



export const getDonorsByStation = async (req, res) => {
  try {
    const { station, status } = req.query;
    if (!station) {
      return res.status(400).json({ message: 'station query param is required' });
    }

    const access = await getUserNgoAccess(req.user.id);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoIds.length === 0 && req.user.ngo_id) {
      ngoIds.push(req.user.ngo_id);
    }

    if (ngoIds.length === 0) {
      return res.json([]);
    }

    const allDonors = [];
    for (const ngoId of ngoIds) {
      const donors = await getDonorsByStationAndStatus(ngoId, station, status || null);
      allDonors.push(...donors);
    }

    const seen = new Set();
    const unique = allDonors.filter(a => { const k = a.donor_id; if (seen.has(k)) return false; seen.add(k); return true; });

    const result = unique.map(a => ({
      id: a.id,
      donor_id: a.donor_id,
      donor_mobile: a.donor_profiles?.mobile_number || '',
      donor_mobile_2: a.donor_profiles?.mobile_2 || '',
      donor_name: a.donor_profiles?.name || 'Unknown',
      donor_city: a.donor_profiles?.city || '',
      data_category: a.donor_profiles?.data_category || '',
      amount: a.donor_profiles?.amount || 0,
      fro_worker_id: a.fro_worker_id,
      fro_name: a.workers?.name || 'Unassigned',
      status: a.status,
      station: a.station || '',
      notes: a.notes || '',
      last_contacted_at: a.last_contacted_at,
      next_follow_up: a.next_follow_up,
      assigned_at: a.assigned_at,
      raw_data: a.donor_profiles?.raw_data || null,
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorsByFro = async (req, res) => {
  try {
    const { fro_worker_id, status, period } = req.query;
    if (!fro_worker_id) {
      return res.status(400).json({ message: 'fro_worker_id query param is required' });
    }
    const access = await getUserNgoAccess(req.user.id);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);
    if (ngoIds.length === 0 && req.user.ngo_id) ngoIds.push(req.user.ngo_id);
    if (ngoIds.length === 0) return res.json([]);

    if (period && period !== 'all') {
      const now = new Date();
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      let startDate, endDate;
      if (period === 'today') {
        startDate = todayStart; endDate = todayEnd;
      } else if (period === 'week') {
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
        startDate = weekStart; endDate = todayEnd;
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      }

      const { data: logs, error: logErr } = await db
        .from('fro_donor_logs')
        .select('donor_id, disposition_detail, created_at')
        .eq('fro_worker_id', fro_worker_id)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      if (logErr) throw logErr;

      const donorIds = [...new Set((logs || []).map(l => l.donor_id).filter(Boolean))];
      if (donorIds.length === 0) return res.json([]);

      let query = db
        .from('fro_assignments')
        .select('*, donor_profiles(*), workers!fro_assignments_fro_worker_id_fkey(id, name, login_id)')
        .in('ngo_id', ngoIds)
        .eq('fro_worker_id', fro_worker_id)
        .not('status', 'eq', 'reassigned')
        .in('donor_id', donorIds);

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;

      const logStatusMap = {};
      for (const l of logs || []) {
        if (!logStatusMap[l.donor_id]) logStatusMap[l.donor_id] = l.disposition_detail;
      }

      const result = (data || []).map(a => ({
        id: a.id,
        donor_id: a.donor_id,
        donor_mobile: a.donor_profiles?.mobile_number || '',
        donor_name: a.donor_profiles?.name || 'Unknown',
        donor_city: a.donor_profiles?.city || '',
        status: a.status,
        call_status: logStatusMap[a.donor_id] || a.status,
        station: a.station || '',
        notes: a.notes || '',
        next_follow_up: a.next_follow_up,
        assigned_at: a.assigned_at,
      }));

      return res.json(result);
    }

    let query = db
      .from('fro_assignments')
      .select('*, donor_profiles(*), workers!fro_assignments_fro_worker_id_fkey(id, name, login_id)')
      .in('ngo_id', ngoIds)
      .eq('fro_worker_id', fro_worker_id)
      .not('status', 'eq', 'reassigned');

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const result = (data || []).map(a => ({
      id: a.id,
      donor_id: a.donor_id,
      donor_mobile: a.donor_profiles?.mobile_number || '',
      donor_name: a.donor_profiles?.name || 'Unknown',
      donor_city: a.donor_profiles?.city || '',
      status: a.status,
      station: a.station || '',
      notes: a.notes || '',
      next_follow_up: a.next_follow_up,
      assigned_at: a.assigned_at,
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getNewData = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    let ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    let ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames = [ngo.name]; ngoIds = [req.user.ngo_id]; }
    }

    const { ngo_id: filterNgoId, page: pageStr, per_page: perPageStr, category: categoryFilter } = req.query;
    const pageNum = Math.max(1, parseInt(pageStr) || 1);
    const perPage = Math.min(5000, Math.max(10, parseInt(perPageStr) || 500));
    const normalizedCategory = categoryFilter ? String(categoryFilter).trim() : '';

    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        const name = ngoNames[idx];
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
        ngoNames.splice(0, ngoNames.length, name);
      }
    }

    if (ngoNames.length === 0) {
      return res.json({ unassigned: [], ngo_data: [], total: 0, page: pageNum, per_page: perPage });
    }

    // 1. new_data for admin's NGOs that are still pending conversion
    const FETCH_LIMIT = 25000;
    const { data: importedRows, error: iErr } = await db
      .from('new_data')
      .select('name, mobile_number, category, data_category, amount, created_at, ngo')
      .in('ngo', ngoNames)
      .not('mobile_number', 'is', null)
      .or('status.eq.pending,status.is.null')
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT);

    if (iErr) throw iErr;

    let unassigned = [];
    if (importedRows && importedRows.length > 0) {
      const latest = {};
      for (const row of importedRows) {
        const key = `${row.mobile_number}||${row.ngo}`;
        if (!latest[key]) latest[key] = row;
      }
      const entries = Object.values(latest);

      // Safety check: exclude only if donor_profile exists FOR THE SAME NGO (per-NGO isolation)
      // Group mobiles by NGO, then check donor_profiles with ngo filter
      const mobilesByNgo = {};
      for (const e of entries) {
        if (!mobilesByNgo[e.ngo]) mobilesByNgo[e.ngo] = [];
        mobilesByNgo[e.ngo].push(e.mobile_number);
      }

      const existingMobilesByNgo = {};
      const BATCH_SIZE = 500;
      for (const [ngo, mobiles] of Object.entries(mobilesByNgo)) {
        const existingMobiles = new Set();
        const batchQueries = [];
        for (let i = 0; i < mobiles.length; i += BATCH_SIZE) {
          const batch = mobiles.slice(i, i + BATCH_SIZE);
          batchQueries.push(
            db.from('donor_profiles').select('mobile_number').in('mobile_number', batch).eq('ngo', ngo)
          );
        }
        const batchResults = await Promise.allSettled(batchQueries);
        for (const r of batchResults) {
          if (r.status === 'fulfilled' && r.value.data) {
            r.value.data.forEach(p => existingMobiles.add(p.mobile_number));
          }
        }
        existingMobilesByNgo[ngo] = existingMobiles;
      }

      unassigned = entries.filter(e => !existingMobilesByNgo[e.ngo]?.has(e.mobile_number));
    }

    // 2. NGO's donor_profiles not yet FRO-assigned
    let ngoData = [];
    const { data: ngoProfiles, error: npErr } = await db
      .from('donor_profiles')
      .select('id, name, mobile_number, category, data_category, amount, first_imported_at, ngo')
      .in('ngo', ngoNames)
      .order('first_imported_at', { ascending: false });

    if (npErr) throw npErr;

    if (ngoProfiles && ngoProfiles.length > 0) {
      const profileIds = ngoProfiles.map(p => p.id);
      const { data: froAsgn } = await db
        .from('fro_assignments')
        .select('donor_id')
        .in('donor_id', profileIds);

      const assignedIds = new Set(froAsgn ? froAsgn.map(a => a.donor_id) : []);
      ngoData = ngoProfiles.filter(p => !assignedIds.has(p.id)).map(p => ({
        ...p,
        created_at: p.first_imported_at,
      }));
    }

    // Helper to extract category name from a record
    const getRowCategory = (r) => String(r?.data_category || r?.category || '').trim();

    // Category-wise filter (by data_category or category, case-insensitive)
    if (normalizedCategory) {
      unassigned = unassigned.filter(e => getRowCategory(e).toLowerCase() === normalizedCategory.toLowerCase());
      ngoData = ngoData.filter(e => getRowCategory(e).toLowerCase() === normalizedCategory.toLowerCase());
    }

    // Distinct data categories for the filter dropdown (across new_data + donor_profiles, NGO-scoped)
    const categorySet = new Set();
    const { data: newDataCats } = await db
      .from('new_data')
      .select('data_category, category')
      .in('ngo', ngoNames)
      .or('status.eq.pending,status.is.null');
    for (const c of newDataCats || []) {
      const cat = getRowCategory(c);
      if (cat) categorySet.add(cat);
    }
    const { data: profileCats } = await db
      .from('donor_profiles')
      .select('data_category, category')
      .in('ngo', ngoNames);
    for (const c of profileCats || []) {
      const cat = getRowCategory(c);
      if (cat) categorySet.add(cat);
    }
    const categoryOptions = [...categorySet].sort((a, b) => a.localeCompare(b));

    const total = unassigned.length;
    const start = (pageNum - 1) * perPage;
    const pagedUnassigned = unassigned.slice(start, start + perPage);

    return res.json({ unassigned: pagedUnassigned, ngo_data: ngoData, category_options: categoryOptions, total, page: pageNum, per_page: perPage });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};



export const distributeNewData = async (req, res) => {
  try {
    const { stations: selectedStations, ngo_id: filterNgoId, category } = req.body;
    const normalizedCategory = category ? String(category).trim() : '';
    let access = await getUserNgoAccess(req.user.id);
    let ngoEntries = access.map(a => ({ ngoId: a.ngo_id, ngoName: a.ngo_name })).filter(e => e.ngoId);
    if (ngoEntries.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) ngoEntries.push({ ngoId: req.user.ngo_id, ngoName: ngo.name });
    }
    // Filter to specific NGO if provided (match by ID or name)
    if (filterNgoId) {
      ngoEntries = ngoEntries.filter(e => String(e.ngoId) === String(filterNgoId) || String(e.ngoName).toLowerCase() === String(filterNgoId).toLowerCase());
    }
    if (ngoEntries.length === 0) {
      return res.json({ message: 'No NGO assigned to your account', count: 0 });
    }
    console.log('--- distributeNewData start ---');
    console.log('ngoEntries:', JSON.stringify(ngoEntries), normalizedCategory ? `category: ${normalizedCategory}` : 'all categories');

    let totalAssigned = 0;
    let totalConverted = 0;
    let skippedNgos = [];
    const messages = [];

    for (const { ngoId, ngoName } of ngoEntries) {
      try {
      const batchId = crypto.randomUUID();
      console.log(`[${ngoName}] === Processing NGO: ${ngoName} (id=${ngoId}) ===`);
      // Step 1: Create donor_profiles from new_data (fetch ALL rows, paginated)
      const PAGE = 10000;
      let importedRows = [];
      let offset = 0;
      for (;;) {
        let query = db
          .from('new_data')
          .select('name, mobile_number, category, amount, data_category')
          .eq('ngo', ngoName)
          .not('mobile_number', 'is', null)
          .or('status.eq.pending,status.is.null')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false });

        if (normalizedCategory) {
          query = query.or(`data_category.eq.${normalizedCategory},category.eq.${normalizedCategory}`);
        }

        const { data, error } = await query.range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        importedRows = importedRows.concat(data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }
      console.log(`[${ngoName}] importedRows count:`, importedRows.length, normalizedCategory ? `(category: ${normalizedCategory})` : '');

      let newProfileIds = [];
      let allMobiles = [];
      if (importedRows && importedRows.length > 0) {
        const latest = {};
        for (const row of importedRows) {
          if (!latest[row.mobile_number]) latest[row.mobile_number] = row;
        }
        const mobiles = Object.keys(latest);

        // Batch existing profile check to avoid 414, run in parallel
        const existingMap = {};
        const BATCH = 500;
        const batchQueries = [];
        for (let i = 0; i < mobiles.length; i += BATCH) {
          const batch = mobiles.slice(i, i + BATCH);
          batchQueries.push(
            db.from('donor_profiles').select('id, mobile_number').in('mobile_number', batch)
          );
        }
        const batchResults = await Promise.allSettled(batchQueries);
        for (const r of batchResults) {
          if (r.status === 'fulfilled' && r.value.data) {
            for (const p of r.value.data) existingMap[p.mobile_number] = p.id;
          }
        }

        const toInsert = [];
        for (const mobile of mobiles) {
          if (!existingMap[mobile]) {
            const row = latest[mobile];
            toInsert.push({
              mobile_number: mobile,
              name: row.name || null,
              category: row.category || '',
              amount: parseFloat(row.amount) || 0,
              total_amount: parseFloat(row.amount) || 0,
              donation_count: 1,
              ngo: ngoName,
              data_category: row.data_category || normalizedCategory || null,
            });
          }
        }

        if (toInsert.length > 0) {
          let allProfiles = [];
          for (let i = 0; i < toInsert.length; i += 500) {
            const batch = toInsert.slice(i, i + 500);
            const { data: newProfiles } = await db
              .from('donor_profiles')
              .insert(batch)
              .select('id');
            if (newProfiles) allProfiles = allProfiles.concat(newProfiles);
          }
          newProfileIds = allProfiles.map(p => p.id);
          totalConverted += toInsert.length;
          messages.push(`${toInsert.length} new donors converted to profiles (${ngoName})`);
        }
        allMobiles = mobiles;
      }

      // Step 2: Determine which stations to use
      const stationAssigns = await getStationAssignmentsByNgo([ngoId]);
      console.log(`[${ngoName}] stationAssigns:`, stationAssigns.length, stationAssigns.map(s => s.station).join(', '), 'fro_ids:', stationAssigns.map(s => s.fro_worker_id).join(','));

      let targetStations;
      if (selectedStations && selectedStations.length > 0) {
        targetStations = stationAssigns.filter(sa => selectedStations.includes(sa.station));
        console.log(`[${ngoName}] filtered by selectedStations:`, targetStations.length);
      } else {
        targetStations = stationAssigns;
      }

      // If no stations exist, auto-create U-stations based on active FROs
      if (targetStations.length === 0) {
        const allFroWorkers = await getFroWorkersByNgo(ngoId);
        const activeWorkers = allFroWorkers.filter(w => w.is_active !== false);
        console.log(`[${ngoName}] no stations, FRO workers:`, activeWorkers.length);
        if (activeWorkers.length === 0) {
          console.log(`[${ngoName}] SKIP — no active FRO workers`);
          skippedNgos.push(ngoName);
          continue;
        }
        for (let i = 0; i < activeWorkers.length; i++) {
          await upsertStationAssignment(activeWorkers[i].id, ngoId, `U-${i + 1}`, req.user.id);
        }
        targetStations = await getStationAssignmentsByNgo([ngoId]);
      }

      if (targetStations.length === 0) {
        console.log(`[${ngoName}] SKIP — targetStations still empty`);
        skippedNgos.push(ngoName);
        continue;
      }
      console.log(`[${ngoName}] targetStations:`, targetStations.length, targetStations.map(s => s.station).join(', '));

      // Step 3: Find unassigned donor profiles for this NGO
      let existingProfileIds = [];
      if (allMobiles.length > 0) {
        const BATCH = 500;
        const batchQueries = [];
        for (let i = 0; i < allMobiles.length; i += BATCH) {
          const batch = allMobiles.slice(i, i + BATCH);
          batchQueries.push(
            db.from('donor_profiles').select('id').in('mobile_number', batch)
          );
        }
        const batchResults = await Promise.allSettled(batchQueries);
        for (const r of batchResults) {
          if (r.status === 'fulfilled' && r.value.data) {
            existingProfileIds.push(...r.value.data.map(p => p.id));
          }
        }
      }
      const allIds = [...new Set([...newProfileIds, ...existingProfileIds])];
      console.log(`[${ngoName}] newProfileIds:`, newProfileIds.length, 'existingProfileIds:', existingProfileIds.length, 'allIds:', allIds.length);
      if (allIds.length === 0) { console.log(`[${ngoName}] SKIP — allIds empty`); continue; }

      const { data: froAsgn } = await db
        .from('fro_assignments')
        .select('donor_id')
        .in('donor_id', allIds)
        .eq('ngo_id', ngoId)
        .not('status', 'eq', 'reassigned');

      const assignedSet = new Set(froAsgn ? froAsgn.map(a => a.donor_id) : []);
      const hasFdStations = selectedStations && selectedStations.some(s => /^(?:[BAM]?)FD-/i.test(String(s || '')));

      let idsToAssign;
      if (hasFdStations && assignedSet.size > 0) {
        // Fresh data FD distribution: reassign ALL donors, mark existing as reassigned
        const assignedIds = allIds.filter(id => assignedSet.has(id));
        console.log(`[${ngoName}] Reassigning ${assignedIds.length} existing donors to FD stations`);
        for (let i = 0; i < assignedIds.length; i += 500) {
          const batch = assignedIds.slice(i, i + 500);
          await db.from('fro_assignments')
            .update({ status: 'reassigned', updated_at: new Date().toISOString() })
            .in('donor_id', batch)
            .eq('ngo_id', ngoId)
            .not('status', 'eq', 'reassigned');
        }
        idsToAssign = allIds;
      } else {
        // Old station distribution: skip already-assigned donors
        idsToAssign = allIds.filter(id => !assignedSet.has(id));
      }

      console.log(`[${ngoName}] alreadyAssigned:`, assignedSet.size, 'idsToAssign:', idsToAssign.length);
      if (idsToAssign.length === 0) { console.log(`[${ngoName}] SKIP — all already assigned`); continue; }

      // Step 4: Assign stations round-robin to donors
      const shuffled = [...idsToAssign];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const base = Math.floor(shuffled.length / targetStations.length);
      const remainder = shuffled.length % targetStations.length;

      const stationNames = targetStations.map(sa => sa.station);
      const stationFroMap = {};
      for (const sa of targetStations) {
        stationFroMap[sa.station] = sa.fro_worker_id;
      }

      const donorStationMap = {};
      let donorIdx = 0;
      for (let i = 0; i < targetStations.length; i++) {
        const count = base + (i < remainder ? 1 : 0);
        for (let j = 0; j < count; j++) {
          donorStationMap[shuffled[donorIdx++]] = stationNames[i];
        }
      }

      // Step 5: Create FRO assignments for each donor (with station, even if no FRO)
      const newAssignments = [];
      for (const [donorId, station] of Object.entries(donorStationMap)) {
        const workerId = stationFroMap[station];
        newAssignments.push({
          donor_id: parseInt(donorId),
          fro_worker_id: workerId || null,
          ngo_id: ngoId,
          station: station,
          status: 'pending',
          assigned_at: new Date().toISOString(),
          batch_id: batchId,
          batch_type: 'new_data',
        });
      }

      if (newAssignments.length > 0) {
        console.log(`[${ngoName}] creating ${newAssignments.length} fro_assignments`);
        await batchCreateAssignments(newAssignments);
        totalAssigned += newAssignments.length;
        // Mark as converted only AFTER assignments succeed
        if (allMobiles.length > 0) {
          await updateNewDataStatusByNgoAndMobiles(ngoName, allMobiles, 'converted');
        }
        console.log(`[${ngoName}] batchCreateAssignments OK`);
      } else {
        console.log(`[${ngoName}] no newAssignments to create`);
      }

      const stationCounts = {};
      for (const st of Object.values(donorStationMap)) {
        stationCounts[st] = (stationCounts[st] || 0) + 1;
      }
      const perStation = Object.entries(stationCounts)
        .map(([st, cnt]) => `${cnt} → ${st}`)
        .join(', ');
      messages.push(`Distributed ${Object.keys(donorStationMap).length} donors${normalizedCategory ? ` [Category: ${normalizedCategory}]` : ''}: ${perStation} (${ngoName})`);
      console.log(`[${ngoName}] DONE — ${Object.keys(donorStationMap).length} donors distributed`);
      } catch (err) {
        console.error(`[${ngoName}] distribution error:`, err.message);
        messages.push(`Error for ${ngoName}: ${err.message}`);
      }
    }

    console.log('--- distributeNewData end ---');
    console.log('messages:', messages.join('; '));
    console.log('skippedNgos:', skippedNgos);
    let finalMessage = messages.join('; ');
    if (skippedNgos.length > 0) {
      finalMessage += `; ${skippedNgos.join(', ')} skipped (no stations).`;
    }

    if (totalConverted === 0 && totalAssigned === 0) {
      return res.json({ message: 'No unassigned data found for your NGOs', count: 0 });
    }
    return res.json({ message: finalMessage, count: totalAssigned, converted: totalConverted });
  } catch (error) {
    console.error('distributeNewData ERROR:', error);
    return res.status(500).json({ message: error.message });
  }
};

export const cleanupNewData = async (req, res) => {
  try {
    let access = await getUserNgoAccess(req.user.id);
    let ngoEntries = access.map(a => ({ ngoId: a.ngo_id, ngoName: a.ngo_name })).filter(e => e.ngoId);
    if (ngoEntries.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) ngoEntries.push({ ngoId: req.user.ngo_id, ngoName: ngo.name });
    }
    const { ngo_id: filterNgoId, category } = req.body;
    const normalizedCategory = category ? String(category).trim() : '';
    if (filterNgoId) {
      ngoEntries = ngoEntries.filter(e => String(e.ngoId) === String(filterNgoId) || String(e.ngoName).toLowerCase() === String(filterNgoId).toLowerCase());
    }
    if (ngoEntries.length === 0) {
      return res.json({ message: 'No NGO assigned to your account', deleted: 0 });
    }

    let totalDeleted = 0;
    const messages = [];

    for (const { ngoName } of ngoEntries) {
      // Only delete undistributed records (status is null or pending)
      let ngoDeleted = 0;

      // Delete where status IS NULL
      let q1 = db
        .from('new_data')
        .delete({ count: 'exact' })
        .eq('ngo', ngoName)
        .is('status', null);
      if (normalizedCategory) {
        q1 = q1.or(`data_category.eq.${normalizedCategory},category.eq.${normalizedCategory}`);
      }
      const r1 = await q1;
      if (r1.error) {
        messages.push(`Error (null) for ${ngoName}: ${r1.error.message}`);
      } else {
        ngoDeleted += r1.count || 0;
      }

      // Delete where status = 'pending'
      let q2 = db
        .from('new_data')
        .delete({ count: 'exact' })
        .eq('ngo', ngoName)
        .eq('status', 'pending');
      if (normalizedCategory) {
        q2 = q2.or(`data_category.eq.${normalizedCategory},category.eq.${normalizedCategory}`);
      }
      const r2 = await q2;
      if (r2.error) {
        messages.push(`Error (pending) for ${ngoName}: ${r2.error.message}`);
      } else {
        ngoDeleted += r2.count || 0;
      }

      if (ngoDeleted > 0 || (!r1.error && !r2.error)) {
        totalDeleted += ngoDeleted;
        messages.push(`${ngoDeleted} undistributed records deleted (${ngoName})${normalizedCategory ? ` [Category: ${normalizedCategory}]` : ''}`);
      }
    }

    return res.json({
      message: messages.join('; ') || 'No data to cleanup',
      deleted: totalDeleted,
    });
  } catch (error) {
    console.error('cleanupNewData ERROR:', error);
    return res.status(500).json({ message: error.message });
  }
};

export const resetFreshData = async (req, res) => {
  try {
    let access = await getUserNgoAccess(req.user.id);
    let ngoEntries = access.map(a => ({ ngoId: a.ngo_id, ngoName: a.ngo_name })).filter(e => e.ngoId);
    if (ngoEntries.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) ngoEntries.push({ ngoId: req.user.ngo_id, ngoName: ngo.name });
    }
    const { ngo_id: filterNgoId } = req.body;
    if (filterNgoId) {
      ngoEntries = ngoEntries.filter(e => String(e.ngoId) === String(filterNgoId) || String(e.ngoName).toLowerCase() === String(filterNgoId).toLowerCase());
    }
    if (ngoEntries.length === 0) {
      return res.json({ message: 'No NGO assigned to your account', deleted: 0 });
    }

    let totalDeleted = 0;
    const messages = [];

    for (const { ngoId, ngoName } of ngoEntries) {
      let ngoFroDeleted = 0;
      let ngoDataDeleted = 0;

      // Step 1: Delete fro_assignments on FD stations for this NGO
      const { count: froCount, error: froErr } = await db
        .from('fro_assignments')
        .delete({ count: 'exact' })
        .eq('ngo_id', ngoId)
        .like('station', 'FD-%');
      if (froErr) {
        messages.push(`FRO error for ${ngoName}: ${froErr.message}`);
      } else {
        ngoFroDeleted = froCount || 0;
      }

      // Step 2: Delete ALL new_data rows for this NGO (distributed + undistributed)
      const { count: dataCount, error: dataErr } = await db
        .from('new_data')
        .delete({ count: 'exact' })
        .eq('ngo', ngoName);
      if (dataErr) {
        messages.push(`Data error for ${ngoName}: ${dataErr.message}`);
      } else {
        ngoDataDeleted = dataCount || 0;
      }

      totalDeleted += ngoFroDeleted + ngoDataDeleted;
      messages.push(`${ngoName}: ${ngoFroDeleted} FD assignments removed, ${ngoDataDeleted} new_data deleted`);
    }

    return res.json({
      message: messages.join('; ') || 'No fresh data to reset',
      deleted: totalDeleted,
    });
  } catch (error) {
    console.error('resetFreshData ERROR:', error);
    return res.status(500).json({ message: error.message });
  }
};

export const getAlerts = async (req, res) => {
  try {
    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.json({ alerts: [] });

    const { ngo_id: filterNgoId } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
      }
    }

    const results = [];
    const workerNameMap = {};
    const allWorkerIds = new Set();

    for (const ngoId of ngoIds) {
      const workers = await getFroWorkersByNgo(ngoId);
      for (const w of workers) {
        workerNameMap[w.id] = w.name || 'Unknown';
        allWorkerIds.add(w.id);
      }
    }

    if (allWorkerIds.size > 0) {
      const { data: requests } = await db
        .from('fro_data_requests')
        .select('*')
        .in('fro_worker_id', [...allWorkerIds])
        .order('created_at', { ascending: false })
        .limit(100);
      if (requests) {
        for (const r of requests) {
          results.push({
            id: `dr_${r.id}`,
            type: 'data_request',
            title: 'Data Request',
            description: r.message,
            fro_name: workerNameMap[r.fro_worker_id] || 'Unknown',
            created_at: r.created_at,
            acknowledged: r.status !== 'pending',
          });
        }
      }
    }

    try {
      const { data: alerts } = await db
        .from('alerts')
        .select('*')
        .in('ngo_id', ngoIds)
        .order('created_at', { ascending: false })
        .limit(100);
      if (alerts) results.push(...alerts);
    } catch (err) { console.error('Failed to fetch alerts:', err.message); }

    results.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    return res.json({ alerts: results.slice(0, 100) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getRejectedLeads = async (req, res) => {
  try {
    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.json([]);

    const { ngo_id: filterNgoId } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
      }
    }

    let data = [];
    try {
      const result = await db
        .from('rejected_lead_tickets')
        .select('*')
        .in('ngo_id', ngoIds)
        .order('created_at', { ascending: false })
        .limit(200);
      if (result.error) throw result.error;
      data = result.data || [];
    } catch (dbErr) {
      console.error('rejected_lead_tickets query failed:', dbErr.message);
      return res.json([]);
    }

    const workerIds = [...new Set(data.map(t => t.fro_worker_id).filter(Boolean))];
    const workerMap = {};
    if (workerIds.length > 0) {
      const { data: workers, error: wErr } = await db.from('workers').select('id, name').in('id', workerIds);
      if (wErr) { console.error('workers query failed:', wErr.message); }
      else if (workers) for (const w of workers) workerMap[w.id] = w.name;
    }

    const result = data.map(t => ({ ...t, fro_name: workerMap[t.fro_worker_id] || 'Unknown' }));
    return res.json(result);
  } catch (error) {
    console.error('getRejectedLeads error:', error);
    return res.status(500).json({ message: error.message });
  }
};

export const acknowledgeRejectedLead = async (req, res) => {
  try {
    const { id } = req.params;
    const ngoIds = await getUserNgoIds(req.user);

    let ticket;
    try {
      const result = await db
        .from('rejected_lead_tickets')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (result.error) throw result.error;
      ticket = result.data;
    } catch (dbErr) {
      console.error('rejected_lead_tickets query failed:', dbErr.message);
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (!ngoIds.includes(ticket.ngo_id)) return res.status(403).json({ message: 'Access denied' });

    await db
      .from('rejected_lead_tickets')
      .update({ status: 'acknowledged', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
      .eq('id', id);

    return res.json({ message: 'Ticket acknowledged' });
  } catch (error) {
    console.error('acknowledgeRejectedLead error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

export const acknowledgeAlert = async (req, res) => {
  try {
    const rawId = req.params.id;
    const ngoIds = await getUserNgoIds(req.user);

    if (typeof rawId === 'string' && rawId.startsWith('dr_')) {
      const realId = parseInt(rawId.replace('dr_', ''));
      const { data: reqData, error: reqErr } = await db
        .from('fro_data_requests')
        .select('id, fro_worker_id')
        .eq('id', realId)
        .maybeSingle();
      if (reqErr || !reqData) return res.status(404).json({ message: 'Request not found' });

      const { data: worker } = await db
        .from('workers')
        .select('ngo_id')
        .eq('id', reqData.fro_worker_id)
        .maybeSingle();
      if (!worker || !ngoIds.includes(worker.ngo_id)) return res.status(403).json({ message: 'Access denied' });

      await db.from('fro_data_requests').update({ status: 'acknowledged' }).eq('id', realId);
      return res.json({ message: 'Request acknowledged' });
    }

    const alertId = parseInt(rawId);
    const { data: alert } = await db
      .from('alerts')
      .select('ngo_id')
      .eq('id', alertId)
      .maybeSingle();

    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    if (!ngoIds.includes(alert.ngo_id)) return res.status(403).json({ message: 'Access denied' });

    const { error } = await db
      .from('alerts')
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq('id', alertId);

    if (error) throw error;
    return res.json({ message: 'Alert acknowledged' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const { page: pageStr, page_size } = req.query;
    const pg = Math.max(1, parseInt(pageStr) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(page_size) || 20));
    const offset = (pg - 1) * limit;

    const numId = parseInt(id);
    let donor;
    if (!isNaN(numId)) {
      const { data } = await db.from('donor_profiles').select('id, mobile_number').eq('id', numId).maybeSingle();
      donor = data;
    }
    if (!donor) {
      const { data } = await db.from('donor_profiles').select('id, mobile_number').eq('mobile_number', id).maybeSingle();
      donor = data;
    }
    if (!donor) return res.json({ data: [], pagination: { page: pg, pageSize: limit, total: 0, totalPages: 0 } });

    const [donationsRes, receiptsRes, importRes] = await Promise.all([
      db.from('fro_donor_logs')
        .select('id, amount_collected, payment_mode, accounts_status, created_at, action, disposition_detail, notes, fro_assignments!inner(donor_id)')
        .eq('fro_assignments.donor_id', donor.id)
        .gt('amount_collected', 0)
        .order('created_at', { ascending: false }),
      db.from('receipts')
        .select('id, amount, receipt_no, mode, created_at')
        .eq('donor_mobile', donor.mobile_number)
        .order('created_at', { ascending: false }),
      db.from('new_data')
        .select('id, amount, transaction_date, category, bank_donor_name, created_at')
        .eq('mobile_number', donor.mobile_number)
        .order('created_at', { ascending: false }),
    ]);

    const mapStatus = (s) => {
      if (s === 'verified') return 'verified';
      if (s === 'pending') return 'pending';
      return 'imported';
    };

    const transactions = [
      ...(donationsRes.data || []).map(d => ({
        date: d.created_at, type: 'Donation', amount: d.amount_collected || 0,
        ref: String(d.id), mode: d.payment_mode || d.disposition_detail || d.action,
        status: mapStatus(d.accounts_status), source: 'FRO Log',
      })),
      ...(receiptsRes.data || []).map(r => ({
        date: r.created_at, type: 'Receipt', amount: r.amount || 0,
        ref: r.receipt_no || `REC-${r.id}`, mode: r.mode || '',
        status: 'verified', source: 'Receipt',
      })),
      ...(importRes.data || []).map(n => ({
        date: n.created_at || n.transaction_date, type: 'Import', amount: n.amount || 0,
        ref: String(n.id), mode: n.category || n.bank_donor_name || '',
        status: 'imported', source: 'Import',
      })),
    ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    const seen = new Set();
    const unique = transactions.filter(t => {
      const key = `${t.date?.slice(0, 10)}-${t.amount}-${t.mode}-${t.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const total = unique.length;
    const paginated = unique.slice(offset, offset + limit);
    return res.json({
      data: paginated,
      pagination: { page: pg, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDataRequests = async (req, res) => {
  try {
    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.json([]);

    const { data, error } = await db
      .from('fro_data_requests')
      .select('*, workers(name, login_id)')
      .in('ngo_id', ngoIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const result = (data || []).map(r => ({
      id: r.id,
      fro_worker_id: r.fro_worker_id,
      worker_name: r.workers?.name || 'Unknown',
      worker_login: r.workers?.login_id || '',
      message: r.message,
      status: r.status,
      admin_response: r.admin_response,
      created_at: r.created_at,
      resolved_at: r.resolved_at,
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const resolveDataRequest = async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const ngoIds = await getUserNgoIds(req.user);

    const { data: request } = await db
      .from('fro_data_requests')
      .select('ngo_id')
      .eq('id', requestId)
      .maybeSingle();

    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (!ngoIds.includes(request.ngo_id)) return res.status(403).json({ message: 'Access denied' });

    const { response } = req.body;
    const { error } = await db
      .from('fro_data_requests')
      .update({
        status: 'resolved',
        admin_response: response || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (error) throw error;
    return res.json({ message: 'Request resolved' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const CONNECTED_DISPOSITIONS = ['contacted', 'lead_done', 'done', 'donation_collected', 'follow_up', 'scheduled', 'callback', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected'];
const NOT_CONNECTED_DISPOSITIONS = ['busy', 'ringing', 'call_waiting', 'unreachable', 'switched_off', 'out_of_coverage', 'wrong_number', 'invalid', 'invalid_number', 'rejected', 'temporary_network_issue', 'voicemail'];

export const masterSearch = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ donors: [], fros: [], stations: [] });

    const term = `%${q.trim()}%`;
    const ngoIds = await getUserNgoIds(req.user);
    const ngoFilter = ngoIds.length > 0 ? ngoIds : null;

    const [donorsRes, frosRes, stationsRes] = await Promise.all([
      // Search donors
      (async () => {
        let query = db
          .from('donor_profiles')
          .select('id, name, mobile_number, city, amount, total_amount, donation_count, pan_number, email, address_1, birth_date, project_supported, last_donation_date')
          .or(`name.ilike.${term},mobile_number.ilike.${term},pan_number.ilike.${term},city.ilike.${term}`)
          .limit(15);
        if (ngoFilter) {
          const { data: ngoDonors } = await db
            .from('fro_assignments')
            .select('donor_id')
            .in('ngo_id', ngoFilter)
            .not('status', 'eq', 'reassigned');
          const ids = [...new Set((ngoDonors || []).map(d => d.donor_id).filter(Boolean))];
          if (ids.length > 0) query = query.in('id', ids);
          else return [];
        }
        const { data } = await query;
        return data || [];
      })(),
      // Search FRO workers
      (async () => {
        let query = db
          .from('workers')
          .select('id, name, login_id, ngo_id, is_active, created_at, ngos!left(name)')
          .eq('department', 'FRO')
          .or(`name.ilike.${term},login_id.ilike.${term}`)
          .limit(10);
        if (ngoFilter) {
          query = query.in('ngo_id', ngoFilter);
        }
        const { data } = await query;
        return data || [];
      })(),
      // Search stations
      (async () => {
        try {
          let query = db
            .from('fro_station_assignments')
            .select('station, ngo_id, fro_worker_id, workers!left(name, login_id)')
            .ilike('station', term)
            .limit(10);
          if (ngoFilter) {
            const { data: ngoStations } = await db
              .from('fro_station_assignments')
              .select('station')
              .in('ngo_id', ngoFilter);
            const stationNames = [...new Set((ngoStations || []).map(s => s.station).filter(Boolean))];
            if (stationNames.length > 0) query = query.in('station', stationNames);
            else return [];
          }
          const { data, error } = await query;
          if (error) {
            // Fallback: query without workers join if FK fails
            const { data: fallback } = await db
              .from('fro_station_assignments')
              .select('station, ngo_id, fro_worker_id')
              .ilike('station', term)
              .limit(10);
            return (fallback || []).map(s => ({ ...s, workers: null }));
          }
          return data || [];
        } catch {
          return [];
        }
      })(),
    ]);

    // Enrich donors with FRO/station assignment info
    let donors = donorsRes;
    if (donors.length > 0) {
      const donorIds = donors.map(d => d.id);
      const { data: assignments } = await db
        .from('fro_assignments')
        .select('donor_id, ngo_id, station, status, workers!left(name, login_id)')
        .in('donor_id', donorIds)
        .not('status', 'eq', 'reassigned');
      const asgnMap = {};
      for (const a of assignments || []) {
        if (!asgnMap[a.donor_id]) asgnMap[a.donor_id] = [];
        asgnMap[a.donor_id].push(a);
      }
      donors = donors.map(d => ({
        ...d,
        assignments: asgnMap[d.id] || [],
      }));
    }

    // Enrich stations with donor count
    let stations = stationsRes;
    if (stations.length > 0) {
      const stationNames = [...new Set(stations.map(s => s.station).filter(Boolean))];
      const { data: counts } = await db
        .from('fro_assignments')
        .select('station, id', { count: 'exact', head: false })
        .in('station', stationNames)
        .not('status', 'eq', 'reassigned');
      const countMap = {};
      for (const c of counts || []) {
        countMap[c.station] = (countMap[c.station] || 0) + 1;
      }
      stations = stations.map(s => ({
        ...s,
        donor_count: countMap[s.station] || 0,
      }));
    }

    return res.json({ donors, fros: frosRes, stations });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getCallAnalytics = async (req, res) => {
  try {
    const { ngo_id, station, fro_id, from, to } = req.query;
    const ngoIds = await getUserNgoIds(req.user);
    const effectiveNgoId = ngo_id || (ngoIds.length === 1 ? ngoIds[0] : null);

    const fromDate = from || new Date(new Date().setHours(0,0,0,0)).toISOString();
    const toDate = to || new Date().toISOString();

    // Build base filter
    let logQuery = db
      .from('fro_donor_logs')
      .select('*, fro_assignments!inner(donor_id, ngo_id, station, fro_worker_id), workers!fro_donor_logs_fro_worker_id_fkey(name, login_id)')
      .gte('created_at', fromDate)
      .lte('created_at', toDate);

    if (effectiveNgoId) {
      logQuery = logQuery.eq('fro_assignments.ngo_id', effectiveNgoId);
    } else if (ngoIds.length > 0) {
      logQuery = logQuery.in('fro_assignments.ngo_id', ngoIds);
    }
    if (station) logQuery = logQuery.eq('fro_assignments.station', station);
    if (fro_id) logQuery = logQuery.eq('fro_worker_id', fro_id);

    const { data: logs, error } = await logQuery;
    if (error) throw error;

    const connected = (logs || []).filter(l => CONNECTED_DISPOSITIONS.includes(l.disposition_detail));
    const notConnected = (logs || []).filter(l => NOT_CONNECTED_DISPOSITIONS.includes(l.disposition_detail));
    const totalTalkSeconds = (logs || []).reduce((s, l) => s + (parseInt(l.call_duration_seconds) || 0), 0);

    // Per FRO breakdown
    const froMap = {};
    for (const l of logs || []) {
      const wid = l.fro_worker_id;
      if (!wid) continue;
      if (!froMap[wid]) {
        froMap[wid] = {
          fro_worker_id: wid,
          fro_name: l.workers?.name || 'Unknown',
          login_id: l.workers?.login_id || '',
          total: 0, connected: 0, not_connected: 0, talk_seconds: 0,
        };
      }
      froMap[wid].total++;
      if (CONNECTED_DISPOSITIONS.includes(l.disposition_detail)) froMap[wid].connected++;
      if (NOT_CONNECTED_DISPOSITIONS.includes(l.disposition_detail)) froMap[wid].not_connected++;
      froMap[wid].talk_seconds += parseInt(l.call_duration_seconds) || 0;
    }

    // Per station breakdown
    const stationMap = {};
    for (const l of logs || []) {
      const st = l.fro_assignments?.station;
      if (!st) continue;
      if (!stationMap[st]) {
        stationMap[st] = { station: st, total: 0, connected: 0, not_connected: 0 };
      }
      stationMap[st].total++;
      if (CONNECTED_DISPOSITIONS.includes(l.disposition_detail)) stationMap[st].connected++;
      if (NOT_CONNECTED_DISPOSITIONS.includes(l.disposition_detail)) stationMap[st].not_connected++;
    }

    // Per disposition breakdown
    const dispMap = {};
    for (const l of logs || []) {
      const d = l.disposition_detail || 'unknown';
      if (!dispMap[d]) dispMap[d] = 0;
      dispMap[d]++;
    }

    // Daily trend
    const dailyMap = {};
    for (const l of logs || []) {
      const day = l.created_at?.slice(0, 10) || 'unknown';
      if (!dailyMap[day]) dailyMap[day] = { date: day, connected: 0, not_connected: 0, total: 0 };
      dailyMap[day].total++;
      if (CONNECTED_DISPOSITIONS.includes(l.disposition_detail)) dailyMap[day].connected++;
      if (NOT_CONNECTED_DISPOSITIONS.includes(l.disposition_detail)) dailyMap[day].not_connected++;
    }

    return res.json({
      summary: {
        total_calls: (logs || []).length,
        connected: connected.length,
        not_connected: notConnected.length,
        connection_rate: (logs || []).length > 0 ? Math.round((connected.length / (logs || []).length) * 100) + '%' : '0%',
        total_talk_seconds: totalTalkSeconds,
        total_talk_time: `${Math.floor(totalTalkSeconds / 3600)}h ${Math.floor((totalTalkSeconds % 3600) / 60)}m`,
        avg_call_duration: (logs || []).length > 0
          ? `${Math.floor(totalTalkSeconds / (logs || []).length / 60)}m ${Math.round((totalTalkSeconds / (logs || []).length) % 60)}s`
          : '0m 0s',
      },
      by_fro: Object.values(froMap).sort((a, b) => b.total - a.total),
      by_station: Object.values(stationMap).sort((a, b) => b.total - a.total),
      by_disposition: Object.entries(dispMap).map(([disposition, count]) => ({ disposition, count })).sort((a, b) => b.count - a.count),
      daily_trend: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ---- Station Transfers ----

export const transferStationData = async (req, res) => {
  try {
    const { station } = req.params;
    const { target_station, donor_count } = req.body;
    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.status(400).json({ message: 'No NGO assigned' });

    if (!target_station || !donor_count) {
      return res.status(400).json({ message: 'target_station and donor_count are required' });
    }

    const { data: sourceAssigns } = await db
      .from('fro_station_assignments')
      .select('fro_worker_id, ngo_id')
      .in('ngo_id', ngoIds)
      .eq('station', station.trim())
      .not('fro_worker_id', 'is', null)
      .limit(1);

    const sourceAssign = sourceAssigns?.[0];
    if (!sourceAssign) {
      return res.status(400).json({ message: 'No FRO assigned to source station' });
    }

    if (target_station.trim() === station.trim()) {
      return res.status(400).json({ message: 'Target station must be different from source station' });
    }

    const autoReturnAt = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
    const result = await createTemporaryTransfer(
      sourceAssign.fro_worker_id, ngoIds,
      station.trim(), target_station.trim(), donor_count, autoReturnAt, req.user.id
    );

    return res.json({
      message: `Transferred ${result.transferred} donors to ${target_station}`,
      transfer: result.transfer,
      transferred: result.transferred,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const returnTransferEarly = async (req, res) => {
  try {
    const { id } = req.params;
    const ngoIds = await getUserNgoIds(req.user);
    const { data: transfer } = await db.from('fro_transfers').select('ngo_id').eq('id', id).maybeSingle();
    if (transfer && transfer.ngo_id && !ngoIds.some(id => String(id) === String(transfer.ngo_id))) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const count = await reverseTransfer(id);
    return res.json({
      message: `Returned ${count} donors to original FRO`,
      returned: count,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getTransferHistory = async (req, res) => {
  try {
    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.json([]);

    const { data: transfers, error } = await db
      .from('fro_transfers')
      .select('*')
      .in('ngo_id', ngoIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const froIds = [...new Set((transfers || []).map(t => t.source_fro_worker_id).filter(Boolean))];
    let froNameMap = {};
    if (froIds.length > 0) {
      const { data: workers } = await db
        .from('workers')
        .select('id, name')
        .in('id', froIds);
      for (const w of workers || []) froNameMap[w.id] = w.name;
    }

    const result = (transfers || []).map(t => ({
      id: t.id,
      station: t.station,
      target_station: t.target_station,
      donor_count: t.donor_count,
      donor_ids: t.donor_ids || [],
      source_fro_name: froNameMap[t.source_fro_worker_id] || 'Unknown',
      auto_return_at: t.auto_return_at,
      returned: !!t.returned,
      returned_at: t.returned_at,
      created_at: t.created_at,
    }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getTransferDonors = async (req, res) => {
  try {
    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.json([]);

    const { id } = req.params;

    const { data: transfer, error: tErr } = await db
      .from('fro_transfers')
      .select('*')
      .eq('id', id)
      .in('ngo_id', ngoIds)
      .single();

    if (tErr || !transfer) {
      return res.status(404).json({ message: 'Transfer not found' });
    }

    const donorIds = transfer.donor_ids || [];

    if (donorIds.length === 0) return res.json([]);

    // Fetch donor details from donors table (or new_data table as fallback)
    const { data: donors } = await db
      .from('donor_profiles')
      .select('id, name, mobile_number, pan_number')
      .in('id', donorIds);

    if (donors && donors.length > 0) {
      return res.json(donors);
    }

    // Fallback: try new_data table
    const { data: newDonors } = await db
      .from('new_data')
      .select('id, name, mobile, status')
      .in('id', donorIds);

    const fallback = (newDonors || []).map(d => ({
      id: d.id, name: d.name, mobile: d.mobile, lead_status: d.status,
    }));

    return res.json(fallback);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getIncentives = async (req, res) => {
  try {
    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.json([]);

    const allWorkers = [];
    for (const ngoId of ngoIds) {
      const workers = await getFroWorkersByNgo(ngoId);
      allWorkers.push(...workers);
    }

    const workerIds = allWorkers.map(w => w.id);
    if (workerIds.length === 0) return res.json([]);

    const offset = 5.5 * 60 * 60 * 1000;
    const ist = new Date(Date.now() + offset);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const startDate = `${y}-${m}-01`;
    const lastDay = new Date(Date.UTC(y, parseInt(m), 0)).getUTCDate();
    const endDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;

    const ranges = await getAKISlabs();

    const { data: allAchievements } = await db
      .from('daily_achievements')
      .select('*')
      .in('worker_id', workerIds)
      .gte('date', startDate)
      .lte('date', endDate);

    const achievementsByWorker = {};
    if (allAchievements) {
      for (const a of allAchievements) {
        if (!achievementsByWorker[a.worker_id]) achievementsByWorker[a.worker_id] = [];
        achievementsByWorker[a.worker_id].push(a);
      }
    }

    const { data: incentiveTargets } = await db
      .from('incentive_targets')
      .select('*')
      .in('worker_id', workerIds)
      .eq('month', startDate);

    const targetByWorker = {};
    if (incentiveTargets) {
      for (const t of incentiveTargets) {
        targetByWorker[t.worker_id] = t;
      }
    }

    const results = [];
    for (const worker of allWorkers) {
      const workerAchs = achievementsByWorker[worker.id] || [];
      const monthlyAchievement = workerAchs.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);

      const target = targetByWorker[worker.id];
      if (!target) {
        results.push({
          worker_id: worker.id,
          name: worker.name,
          totalIncentive: 0,
          akiPayout: 0,
          monthlyIncentive: 0,
          monthlyAchievement,
          monthlyTarget: 0,
          hasTarget: false,
        });
        continue;
      }

      const monthlyTarget = parseFloat(target.target_amount);
      const totalAKI = workerAchs.reduce((sum, r) => {
        const dayName = getDayName(r.date);
        return sum + calculateAKI(parseFloat(r.amount), dayName, ranges);
      }, 0);

      const monthsEmployed = getMonthsEmployed(worker.created_at);
      const isNewJoiner = monthsEmployed <= 3;
      const monthlyTargetMet = monthlyAchievement >= monthlyTarget;

      let akiPayout = 0;
      let monthlyIncentive = 0;
      let totalIncentive = 0;

      if (monthlyTargetMet) {
        const overage = monthlyAchievement - monthlyTarget;
        monthlyIncentive = Math.round(overage * 0.1);
        akiPayout = isNewJoiner ? totalAKI : Math.round(totalAKI / 2);
        totalIncentive = akiPayout + monthlyIncentive;
      }

      results.push({
        worker_id: worker.id,
        name: worker.name,
        totalIncentive,
        akiPayout,
        monthlyIncentive,
        monthlyAchievement,
        monthlyTarget,
        totalAKI,
        hasTarget: true,
      });
    }

    return res.json(results);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getVerificationFroWise = async (req, res) => {
  try {
    const { status, period } = req.query;
    if (!status || !period) {
      return res.status(400).json({ message: 'status and period are required' });
    }
    if (!['verified', 'unverified'].includes(status)) {
      return res.status(400).json({ message: 'status must be verified or unverified' });
    }
    if (!['month', 'today'].includes(period)) {
      return res.status(400).json({ message: 'period must be month or today' });
    }

    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.json([]);

    const allWorkers = (await Promise.all(ngoIds.map(ngoId => getFroWorkersByNgo(ngoId)))).flat();

    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });
    if (froWorkers.length === 0) return res.json([]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const startDate = period === 'month' ? monthStart : todayStart.toISOString();
    const endDate = period === 'month' ? monthEnd : todayEnd.toISOString();

    const collectionFn = status === 'verified' ? getVerifiedCollection : getUnverifiedCollection;

    const results = await Promise.all(froWorkers.map(async (w) => {
      const { amount, count } = await collectionFn(w.id, startDate, endDate);
      return { fro_id: w.id, fro_name: w.name, amount, count };
    }));

    return res.json(results);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ---- Donor CRM ----

export const listLeads = async (req, res) => {
  try {
    const { search, status, from_date, to_date, page: pageStr, page_size } = req.query;
    const page = Math.max(1, parseInt(pageStr) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(page_size) || 50));
    const offset = (page - 1) * limit;

    // Only show telecaller-created leads (not recruiter leads)
    const { data: telecallerUsers } = await db
      .from('users')
      .select('id')
      .eq('role', 'telecaller');
    const telecallerIds = (telecallerUsers || []).map(u => u.id);
    if (telecallerIds.length === 0) {
      return res.json({ data: [], pagination: { page, pageSize: limit, total: 0, totalPages: 0 } });
    }

    let countQuery = db.from('leads').select('id', { count: 'exact', head: true }).in('created_by', telecallerIds);
    let dataQuery = db.from('leads').select('*, users(name)').in('created_by', telecallerIds).order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    if (status) { countQuery = countQuery.eq('status', status); dataQuery = dataQuery.eq('status', status); }
    if (from_date) { countQuery = countQuery.gte('created_at', from_date + 'T00:00:00'); dataQuery = dataQuery.gte('created_at', from_date + 'T00:00:00'); }
    if (to_date) { countQuery = countQuery.lte('created_at', to_date + 'T23:59:59'); dataQuery = dataQuery.lte('created_at', to_date + 'T23:59:59'); }

    if (search) {
      const q = `%${search}%`;
      countQuery = countQuery.or(`name.ilike.${q},phone.ilike.${q},email.ilike.${q}`);
      dataQuery = dataQuery.or(`name.ilike.${q},phone.ilike.${q},email.ilike.${q}`);
    }

    const [{ count }, { data, error }] = await Promise.all([countQuery, dataQuery]);
    if (error) throw error;

    const total = count || 0;
    return res.json({
      data: data || [],
      pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const createLead = async (req, res) => {
  try {
    const { name, mobile, email, address, city, state, pan, aadhaar, birthday, anniversary, language, notes } = req.body;
    if (!name || !mobile) {
      return res.status(400).json({ message: 'Name and mobile are required' });
    }

    const { data, error } = await db
      .from('leads')
      .insert({
        name,
        phone: mobile,
        email: email || null,
        notes: [address, city, state, pan, aadhaar, birthday, anniversary, language].filter(Boolean).join(' | ') || null,
        created_by: req.user.id,
        source: 'admin',
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const importLeads = async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const file = req.files.file;

    const XLSX = await import('xlsx');
    const workbook = XLSX.read(file.data, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const leads = rows.map(row => ({
      name: row.name || row.Name || '',
      phone: String(row.mobile || row.Mobile || row.phone || row.Phone || ''),
      email: row.email || row.Email || null,
      created_by: req.user.id,
      source: 'import',
      status: 'pending',
    })).filter(l => l.name && l.phone);

    if (leads.length === 0) {
      return res.status(400).json({ message: 'No valid leads found in file' });
    }

    const { data, error } = await db.from('leads').insert(leads).select();
    if (error) throw error;

    return res.json({ message: `${leads.length} leads imported`, count: leads.length, data });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const assignLeads = async (req, res) => {
  try {
    const { lead_ids, fro_worker_id } = req.body;
    if (!lead_ids || !lead_ids.length || !fro_worker_id) {
      return res.status(400).json({ message: 'lead_ids array and fro_worker_id are required' });
    }

    const { data: leads, error: lErr } = await db
      .from('leads')
      .select('id, phone, name')
      .in('id', lead_ids);
    if (lErr) throw lErr;

    const now = new Date().toISOString();
    const assignments = leads.map(lead => ({
      lead_id: lead.id,
      fro_worker_id: parseInt(fro_worker_id),
      assigned_by: req.user.id,
      assigned_at: now,
      status: 'assigned',
    }));

    const { error: aErr } = await db.from('lead_assignments').insert(assignments);
    if (aErr) throw aErr;

    await db.from('leads').update({ status: 'assigned', assigned_to: parseInt(fro_worker_id) }).in('id', lead_ids);

    return res.json({ message: `${leads.length} leads assigned`, count: leads.length });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const transferLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { target_fro_worker_id, target_station } = req.body;
    if (!target_fro_worker_id && !target_station) {
      return res.status(400).json({ message: 'target_fro_worker_id or target_station required' });
    }

    const ngoIds = await getUserNgoIds(req.user);
    const { data: lead } = await db.from('leads').select('id').eq('id', id).maybeSingle();
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const updateData = {};
    if (target_fro_worker_id) updateData.assigned_to = parseInt(target_fro_worker_id);
    if (target_station) updateData.station = target_station;
    updateData.status = 'transferred';

    const { error } = await db.from('leads').update(updateData).eq('id', id);
    if (error) throw error;

    return res.json({ message: 'Lead transferred successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getLeadHistory = async (req, res) => {
  try {
    const { lead_id } = req.query;
    const ngoIds = await getUserNgoIds(req.user);

    let query = db
      .from('lead_assignments')
      .select('*, leads(name, phone, assigned_to), workers!fro_worker_id(name, ngo_id)')
      .order('assigned_at', { ascending: false });

    if (lead_id) query = query.eq('lead_id', lead_id);

    const { data, error } = await query;
    if (error) throw error;

    const result = (data || [])
      .filter(h => {
        if (ngoIds.length === 0) return true;
        const workerNgo = h.workers?.ngo_id;
        const leadAssignedTo = h.leads?.assigned_to;
        if (workerNgo && ngoIds.includes(Number(workerNgo))) return true;
        return false;
      })
      .map(h => ({
        id: h.id,
        lead_id: h.lead_id,
        lead_name: h.leads?.name || 'Unknown',
        lead_phone: h.leads?.phone || '',
        fro_name: h.workers?.name || 'Unknown',
        assigned_by: h.assigned_by,
        status: h.status || 'assigned',
        assigned_at: h.assigned_at,
      }));

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDuplicateLeads = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);
    if (ngoIds.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) ngoNames.push(ngo.name);
    }
    if (ngoNames.length === 0) return res.json([]);

    const { data, error } = await db
      .from('donor_profiles')
      .select('id, name, mobile_number, city, amount, last_donation_date, pan_number')
      .in('ngo', ngoNames)
      .order('mobile_number');

    if (error) throw error;

    const grouped = {};
    for (const d of data || []) {
      const key = d.mobile_number || d.name || 'unknown';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(d);
    }

    const duplicates = Object.values(grouped).filter(g => g.length > 1);
    return res.json(duplicates);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getFullDonorDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id);
    const ngoIds = await getUserNgoIds(req.user);

    let profile;
    const { data: donor, error } = await db
      .from('donor_profiles')
      .select('*')
      .eq('id', numId)
      .single();

    if (error || !donor) {
      const { data: mobileDonor } = await db
        .from('donor_profiles')
        .select('*')
        .eq('mobile_number', id)
        .maybeSingle();
      if (!mobileDonor) return res.status(404).json({ message: 'Donor not found' });
      profile = mobileDonor;
    } else {
      profile = donor;
    }

    const { data: accessCheck } = await db
      .from('fro_assignments')
      .select('id')
      .eq('donor_id', profile.id)
      .in('ngo_id', ngoIds)
      .not('status', 'eq', 'reassigned')
      .limit(1);
    if (!accessCheck || accessCheck.length === 0) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { data: donations } = await db
      .from('fro_donor_logs')
      .select('*, fro_assignments!inner(donor_id)')
      .eq('fro_assignments.donor_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50);

    return res.json({ profile, donations: donations || [] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorReceipts = async (req, res) => {
  try {
    const { id } = req.params;
    const ngoIds = await getUserNgoIds(req.user);

    let donorMobile;
    const numId = parseInt(id);
    if (!isNaN(numId)) {
      const { data: donor } = await db.from('donor_profiles').select('mobile_number, ngo').eq('id', numId).maybeSingle();
      if (donor) {
        donorMobile = donor.mobile_number;
        if (ngoIds.length > 0 && donor.ngo) {
          const { data: ngo } = await db.from('ngos').select('name').eq('id', ngoIds[0]).maybeSingle();
          if (ngo && donor.ngo !== ngo.name && !ngoIds.includes(Number(donor.ngo))) {
            return res.status(403).json({ message: 'Access denied' });
          }
        }
      }
    } else {
      donorMobile = id;
    }

    if (!donorMobile) return res.json([]);

    const { data, error } = await db
      .from('receipts')
      .select('*')
      .eq('donor_mobile', donorMobile)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDonorFollowups = async (req, res) => {
  try {
    const { id } = req.params;
    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.json([]);

    let donorId;
    const numId = parseInt(id);
    if (!isNaN(numId)) {
      const { data: fa } = await db
        .from('fro_assignments')
        .select('id, ngo_id')
        .eq('donor_id', numId)
        .maybeSingle();
      if (fa && ngoIds.includes(fa.ngo_id)) donorId = fa.id;
    }

    if (!donorId) return res.json([]);

    const { data, error } = await db
      .from('fro_scheduled_contacts')
      .select('*, workers!created_by(name)')
      .eq('assignment_id', donorId)
      .order('scheduled_at', { ascending: false });

    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const createFollowup = async (req, res) => {
  try {
    const { donor_id, fro_worker_id, scheduled_at, notes } = req.body;
    if (!donor_id || !scheduled_at) {
      return res.status(400).json({ message: 'donor_id and scheduled_at are required' });
    }

    const ngoIds = await getUserNgoIds(req.user);
    const { data: assignment } = await db
      .from('fro_assignments')
      .select('id, ngo_id')
      .eq('donor_id', donor_id)
      .maybeSingle();

    if (!assignment) {
      return res.status(400).json({ message: 'No assignment found for this donor' });
    }
    if (assignment.ngo_id && !ngoIds.some(id => String(id) === String(assignment.ngo_id))) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { data, error } = await db
      .from('fro_scheduled_contacts')
      .insert({
        assignment_id: assignment.id,
        scheduled_at: scheduled_at,
        notes: notes || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getFroSummary = async (req, res) => {
  try {
    const froId = req.params.id;
    if (!froId) return res.status(400).json({ message: 'Invalid FRO ID' });

    const ngoIds = await getUserNgoIds(req.user);
    if (ngoIds.length === 0) return res.status(403).json({ message: 'Access denied' });

    const { data: worker } = await db
      .from('workers')
      .select('id, ngo_id')
      .eq('id', froId)
      .maybeSingle();
    if (!worker || !ngoIds.includes(worker.ngo_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const [logsRes, asgnRes] = await Promise.all([
      db
        .from('fro_donor_logs')
        .select('amount_collected, disposition_detail, action, accounts_status, created_at, call_duration_seconds')
        .eq('fro_worker_id', froId)
        .gte('created_at', todayStart.toISOString())
        .lte('created_at', todayEnd.toISOString()),
      db
        .from('fro_assignments')
        .select('status')
        .eq('fro_worker_id', froId)
        .not('status', 'eq', 'reassigned'),
    ]);

    const logs = logsRes.data || [];
    const assignments = asgnRes.data || [];

    const todayCollection = logs.reduce((s, l) => {
      const amt = parseFloat(l.amount_collected || 0);
      if (l.action === 'donation') return s + amt;
      if (l.action === 'disposition' && (l.disposition_detail === 'lead_done' || l.disposition_detail === 'done')) return s + amt;
      return s;
    }, 0);

    const talkSeconds = logs.reduce((s, l) => s + (parseInt(l.call_duration_seconds) || 0), 0);

    const dispositionBreakdown = {};
    for (const l of logs) {
      const d = l.disposition_detail || 'unknown';
      dispositionBreakdown[d] = (dispositionBreakdown[d] || 0) + 1;
    }

    const statusBreakdown = {};
    for (const a of assignments) {
      statusBreakdown[a.status] = (statusBreakdown[a.status] || 0) + 1;
    }

    return res.json({
      todayCollection,
      todayCalls: logs.length,
      talkSeconds,
      dispositionBreakdown,
      totalAssigned: assignments.length,
      statusBreakdown,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const DEFAULT_STATION_NAMES = ['ND-1','ND-2','ND-3','ND-4','ND-5','ND-6','ND-7','ND-8','DH-1','DH-2','DH-3','DH-4','DH-5','DH-6','DH-7','DH-8','DH-9','DH-10','DH-11','DH-12','DH-13','DH-14'];
const FRESH_STATION_NAMES = Array.from({ length: 23 }, (_, i) => `FD-${i + 1}`);
const STATION_NAMES = process.env.STATION_NAMES
  ? process.env.STATION_NAMES.split(',').map(s => s.trim())
  : DEFAULT_STATION_NAMES;

export const seedStations = async (req, res) => {
  try {
    const { ngo_id, fresh } = req.body || {};
    const stationList = fresh ? FRESH_STATION_NAMES : STATION_NAMES;

    let ngoEntries;
    if (ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name, id').eq('id', ngo_id).single();
      if (!ngo) return res.status(400).json({ message: 'NGO not found' });
      ngoEntries = [{ ngoId: ngo.id, ngoName: ngo.name }];
    } else {
      const access = await getUserNgoAccess(req.user.id);
      ngoEntries = access.map(a => ({ ngoId: a.ngo_id, ngoName: a.ngo_name })).filter(e => e.ngoId);
      if (ngoEntries.length === 0 && req.user.ngo_id) {
        const { data: ngo } = await db.from('ngos').select('name, id').eq('id', req.user.ngo_id).single();
        if (ngo) ngoEntries.push({ ngoId: ngo.id, ngoName: ngo.name });
      }
    }

    if (!ngoEntries || ngoEntries.length === 0) {
      return res.status(400).json({ message: 'No NGOs found' });
    }

    let totalCreated = 0;
    const results = [];
    for (const { ngoId, ngoName } of ngoEntries) {
      let created = 0;
      for (const station of stationList) {
        const existing = await getStationAssignmentByNgoAndStation(ngoId, station);
        if (!existing) {
          await createStation(ngoId, station, req.user.id);
          created++;
        }
      }
      totalCreated += created;
      results.push({ ngo: ngoName, created });
    }

    return res.json({ message: `${totalCreated} stations created`, details: results });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const cleanupOrphanedStations = async (req, res) => {
  try {
    const { ngo_id } = req.body || {};
    const access = await getUserNgoAccess(req.user.id);
    const allowedNgoIds = new Set(access.map(a => a.ngo_id).filter(Boolean));

    let targetNgoIds;
    if (ngo_id) {
      if (![...allowedNgoIds].some(id => String(id) === String(ngo_id))) {
        return res.status(403).json({ message: 'You do not have access to this NGO' });
      }
      targetNgoIds = [ngo_id];
    } else {
      targetNgoIds = [...allowedNgoIds];
    }

    const { data: orphaned, error: fetchErr } = await db
      .from('fro_station_assignments')
      .select('id, station, ngo_id')
      .in('ngo_id', targetNgoIds)
      .is('fro_worker_id', null);

    if (fetchErr) throw fetchErr;

    if (!orphaned || orphaned.length === 0) {
      return res.json({ message: 'No orphaned stations found', deleted: 0 });
    }

    const ids = orphaned.map(r => r.id);
    const { error: delErr } = await db
      .from('fro_station_assignments')
      .delete()
      .in('id', ids);

    if (delErr) throw delErr;

    return res.json({
      message: `${ids.length} orphaned station(s) deleted`,
      deleted: ids.length,
      stations: orphaned.map(r => ({ station: r.station, ngo_id: r.ngo_id })),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const uploadOldData = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const XLSX = await import('xlsx');
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ message: 'No sheets found in file' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ message: 'No data found in file' });
    }

    const access = await getUserNgoAccess(req.user.id);
    const ngoEntries = access.map(a => ({ ngoId: a.ngo_id, ngoName: a.ngo_name })).filter(e => e.ngoId);
    if (ngoEntries.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name, id').eq('id', req.user.ngo_id).single();
      if (ngo) ngoEntries.push({ ngoId: ngo.id, ngoName: ngo.name });
    }
    if (ngoEntries.length === 0) {
      return res.status(400).json({ message: 'No NGOs assigned to your account' });
    }

    const bodyDataCategory = req.body.data_category || null;

    const normalizedRows = rows.map(row => ({
      mobile: String(row.moblie || row.Moblie || row.MOBLIE || row.mobile || row.Mobile || row.mobile_number || row.MobileNumber || row['Mobile Number'] || row['Mobile No'] || row['Moblie No'] || row['MOBLIE No'] || '').trim(),
      name: String(row.name || row.Name || row['Donor Name'] || row.donor_name || row.donorname || '').trim(),
      amount: parseFloat(row.amount || row.Amount || row.donation_amount || row.DonationAmount || 0) || 0,
      city: String(row.city || row.City || row.city_name || row.CityName || '').trim(),
      station: String(row.station || row.Station || row.station_name || row.StationName || '').trim().toUpperCase(),
      data_category: String(row['Data Category'] || row['Data category'] || row.data_category || bodyDataCategory || '').trim() || null,
    })).filter(r => r.mobile && r.station);

    const validStations = new Set(STATION_NAMES);
    const batchId = crypto.randomUUID();
    let createdProfiles = 0;
    let createdAssignments = 0;
    let skippedDuplicate = 0;
    let invalidStation = 0;
    const errors = [];

    for (const row of normalizedRows) {
      if (!validStations.has(row.station)) {
        invalidStation++;
        errors.push(`Invalid station "${row.station}" for mobile ${row.mobile}`);
        continue;
      }

      // Upsert donor_profile
      const { data: existingProfile } = await db
        .from('donor_profiles')
        .select('id')
        .eq('mobile_number', row.mobile)
        .maybeSingle();

      let donorId;
      if (existingProfile) {
        donorId = existingProfile.id;
        const updateFields = {};
        if (row.name) updateFields.name = row.name;
        if (row.city) updateFields.city = row.city;
        if (row.data_category) updateFields.data_category = row.data_category;
        if (Object.keys(updateFields).length > 0) {
          await db.from('donor_profiles').update(updateFields).eq('id', donorId);
        }
      } else {
        const { data: newProfile } = await db
          .from('donor_profiles')
          .insert([{ mobile_number: row.mobile, name: row.name || null, amount: row.amount, total_amount: row.amount, donation_count: 1, city: row.city || null, data_category: row.data_category || null }])
          .select('id')
          .single();
        if (newProfile) {
          donorId = newProfile.id;
          createdProfiles++;
        }
      }
      if (!donorId) continue;

      // Create assignment per NGO
      for (const { ngoId, ngoName } of ngoEntries) {
        const { data: existingAsgn } = await db
          .from('fro_assignments')
          .select('id')
          .eq('donor_id', donorId)
          .eq('ngo_id', ngoId)
          .not('status', 'eq', 'reassigned')
          .maybeSingle();

        if (existingAsgn) {
          skippedDuplicate++;
          continue;
        }

        const stationAssign = await getStationAssignmentByNgoAndStation(ngoId, row.station);

        const { error: asgnErr } = await db
          .from('fro_assignments')
          .insert([{
            donor_id: donorId,
            fro_worker_id: stationAssign?.fro_worker_id || null,
            ngo_id: ngoId,
            station: row.station,
            status: 'pending',
            assigned_at: new Date().toISOString(),
            batch_id: batchId,
            batch_type: 'old_data',
          }]);
        if (asgnErr) {
          errors.push(`Failed to create assignment for ${row.mobile} in ${ngoName}: ${asgnErr.message}`);
        } else {
          createdAssignments++;
        }
      }
    }

    return res.json({
      message: `${createdAssignments} assignments created across ${ngoEntries.length} NGO(s)`,
      total_rows: normalizedRows.length,
      created_profiles: createdProfiles,
      created_assignments: createdAssignments,
      skipped_duplicate_assignments: skippedDuplicate,
      invalid_stations: invalidStation,
      ngo_count: ngoEntries.length,
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const uploadOldDataForStation = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const station = req.params.station?.trim().toUpperCase();
    if (!station) {
      return res.status(400).json({ message: 'Station is required' });
    }

    const XLSX = await import('xlsx');
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ message: 'No sheets found in file' });
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });

    if (rawRows.length === 0) {
      return res.status(400).json({ message: 'No data found in file' });
    }

    // Find the actual header row (contains "Sr. No." or "Donor Name" or "Mobile")
    let headerIdx = -1;
    let headerRow = null;
    const headerKeywords = ['sr.no', 'sr no', 'sr.', 'donor name', 'mobile', 'agent name'];
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const row = rawRows[i].map(c => String(c).toLowerCase().trim());
      if (headerKeywords.some(k => row.some(c => c.includes(k)))) {
        headerIdx = i;
        headerRow = rawRows[i];
        break;
      }
    }
    if (headerIdx < 0) {
      return res.status(400).json({ message: 'Could not find header row. Ensure file has Sr. No., Donor Name, or Mobile column.' });
    }

    // Parse rows after header as objects using headerRow as keys
    const rows = [];
    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const firstVal = String(row[0] || '').trim();
      if (!firstVal || firstVal === '') continue; // skip empty rows
      const obj = {};
      for (let j = 0; j < headerRow.length; j++) {
        const key = String(headerRow[j] || '').trim();
        if (key) obj[key] = row[j] != null ? String(row[j]).trim() : '';
      }
      if (Object.keys(obj).length > 0) rows.push(obj);
    }

    if (rows.length === 0) {
      return res.status(400).json({ message: 'No data rows found after header' });
    }

    const access = await getUserNgoAccess(req.user.id);
    let ngoEntries = access.map(a => ({ ngoId: a.ngo_id, ngoName: a.ngo_name })).filter(e => e.ngoId);
    if (ngoEntries.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name, id').eq('id', req.user.ngo_id).single();
      if (ngo) ngoEntries.push({ ngoId: ngo.id, ngoName: ngo.name });
    }

    // Filter by selected NGO if provided
    const { ngo_id } = req.body;
    const bodyDataCategory = req.body.data_category || null;
    if (ngo_id) {
      ngoEntries = ngoEntries.filter(e => String(e.ngoId) === String(ngo_id));
    }

    if (ngoEntries.length === 0) {
      return res.status(400).json({ message: 'No NGOs assigned to your account or selected NGO not found' });
    }

    const normalizedRows = rows.map(row => ({
      mobile: String(row.Mobile || row.mobile || row['Max of Mobile no.'] || row['Mobile No'] || row['Mobile Number'] || row['Mobile no'] || row.mobile_number || row['Max of Mobile no'] || '').trim(),
      name: String(row['Donor Name'] || row['Donor name'] || row['donor name'] || row['donor_name'] || row.Name || row.name || '').trim(),
      amount: parseFloat(row['Max of Amt'] || row['Max Amt'] || row.amount || row.Amount || row['Max of amt'] || 0) || 0,
      city: String(row.City || row.city || '').trim(),
      mobile_2: String(row['Max of Mobile no.2'] || row['Mobile 2'] || row['Mobile No 2'] || row.mobile_2 || '').trim(),
      data_category: String(row['Data Category'] || row['Data category'] || row.data_category || '').trim() || bodyDataCategory || null,
      agent_name: String(row['Agent Name'] || row['Agent name'] || row['agent name'] || row.agent_name || row.fro_name || '').trim(),
      raw_data: row,
    })).filter(r => r.mobile);

    let createdProfiles = 0;
    let createdAssignments = 0;
    let skippedDuplicate = 0;
    const errors = [];
    const now = new Date().toISOString();
    const batchId = crypto.randomUUID();

    // Batch 1: Get existing profiles by mobile
    const mobiles = normalizedRows.map(r => r.mobile);
    const { data: existingProfiles } = await db
      .from('donor_profiles')
      .select('id, mobile_number')
      .in('mobile_number', mobiles);
    const existingMobiles = new Set((existingProfiles || []).map(p => p.mobile_number));

    // Batch 2: Insert new profiles (all fields), Upsert existing profiles (safe fields only)
    const toInsert = [];
    const toUpdate = [];
    for (const row of normalizedRows) {
      if (existingMobiles.has(row.mobile)) {
        toUpdate.push({ mobile_number: row.mobile, name: row.name || null, city: row.city || null, mobile_2: row.mobile_2 || null, data_category: row.data_category || null, raw_data: row.raw_data });
      } else {
        toInsert.push({ mobile_number: row.mobile, name: row.name || null, amount: row.amount, total_amount: row.amount, donation_count: 1, city: row.city || null, mobile_2: row.mobile_2 || null, data_category: row.data_category || null, raw_data: row.raw_data });
      }
    }

    let donorIds = [];
    const profileMap = {};
    for (const p of existingProfiles || []) profileMap[p.mobile_number] = p.id;

    if (toInsert.length > 0) {
      const { data: newP } = await db.from('donor_profiles').insert(toInsert).select('id, mobile_number');
      for (const p of newP || []) {
        profileMap[p.mobile_number] = p.id;
        donorIds.push(p.id);
        createdProfiles++;
      }
    }
    if (toUpdate.length > 0) {
      const { data: updP } = await db.from('donor_profiles').upsert(toUpdate, { onConflict: 'mobile_number' }).select('id, mobile_number');
      for (const p of updP || []) {
        if (!profileMap[p.mobile_number]) profileMap[p.mobile_number] = p.id;
        donorIds.push(p.id);
      }
    }
    donorIds = [...new Set(donorIds)];

    // Batch 3: Get existing assignments for all donor+ngo combos
    const existingAssignmentKeys = new Set();
    if (donorIds.length > 0) {
      for (const { ngoId } of ngoEntries) {
        const { data: existingAsgns } = await db
          .from('fro_assignments')
          .select('donor_id')
          .eq('ngo_id', ngoId)
          .in('donor_id', donorIds)
          .not('status', 'eq', 'reassigned');
        for (const a of existingAsgns || []) {
          existingAssignmentKeys.add(`${a.donor_id}-${ngoId}`);
        }
      }
    }

    // Batch 4: Get station assignments
    const stationAssignMap = {};
    for (const { ngoId } of ngoEntries) {
      const sa = await getStationAssignmentByNgoAndStation(ngoId, station);
      stationAssignMap[ngoId] = sa?.fro_worker_id || null;
    }

    // Batch 5: Create missing assignments
    const assignmentsToInsert = [];
    for (const did of donorIds) {
      for (const { ngoId, ngoName } of ngoEntries) {
        if (existingAssignmentKeys.has(`${did}-${ngoId}`)) {
          skippedDuplicate++;
          continue;
        }
        assignmentsToInsert.push({ donor_id: did, fro_worker_id: stationAssignMap[ngoId], ngo_id: ngoId, station, status: 'pending', assigned_at: now, batch_id: batchId, batch_type: 'old_data' });
      }
    }
    if (assignmentsToInsert.length > 0) {
      const { error: batchErr } = await db.from('fro_assignments').insert(assignmentsToInsert);
      if (batchErr) errors.push(`Batch insert error: ${batchErr.message}`);
      else createdAssignments = assignmentsToInsert.length;
    }

    return res.json({
      message: `${createdAssignments} assignments created for station ${station} (${ngoEntries.map(e => e.ngoName).join(', ')})`,
      total_rows: normalizedRows.length,
      created_profiles: createdProfiles,
      created_assignments: createdAssignments,
      skipped_duplicate_assignments: skippedDuplicate,
      ngo_count: ngoEntries.length,
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDataOverview = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    let ngoEntries = access.map(a => ({ ngoId: a.ngo_id, ngoName: a.ngo_name })).filter(e => e.ngoId);
    if (ngoEntries.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('id, name').eq('id', req.user.ngo_id).maybeSingle();
      if (ngo) ngoEntries.push({ ngoId: ngo.id, ngoName: ngo.name });
    }

    const { ngo_id: filterNgoId } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      ngoEntries = ngoEntries.filter(e => String(e.ngoId) === String(filterNgoId));
    }
    if (ngoEntries.length === 0) return res.json([]);

    const minimal = req.query.minimal === 'true';
    const perStationLimit = Math.min(500, Math.max(1, parseInt(req.query.per_station) || 100));

    const result = [];
    for (const { ngoId, ngoName } of ngoEntries) {
      const [stationAssignsRes, assignmentsRes] = await Promise.all([
        db.from('fro_station_assignments')
          .select('id, station, fro_worker_id, workers!fro_station_assignments_fro_worker_id_fkey(id, name)')
          .eq('ngo_id', ngoId)
          .order('station', { ascending: true }),
        db.from('fro_assignments')
          .select('id, donor_id, station, fro_worker_id, status, batch_type, is_new, assigned_at, ngo_id')
          .eq('ngo_id', ngoId)
          .not('status', 'eq', 'reassigned'),
      ]);
      if (stationAssignsRes.error) throw stationAssignsRes.error;

      const stationRows = stationAssignsRes.data || [];
      const assignments = assignmentsRes.data || [];

      const workerNameMap = {};
      for (const sa of stationRows) {
        const wid = sa.fro_worker_id;
        if (wid && !workerNameMap[wid]) workerNameMap[wid] = sa.workers?.name || 'Unknown';
      }
      const stationIdMap = {};
      for (const sa of stationRows) stationIdMap[sa.station] = sa.id;

      const buckets = {};
      const getFro = (wid) => wid || 'UNASSIGNED';
      for (const a of assignments) {
        const froKey = getFro(a.fro_worker_id);
        if (!buckets[froKey]) buckets[froKey] = { new: {}, old: {} };
        const side = a.batch_type === 'new_data' ? 'new' : 'old';
        const st = a.station || 'UNKNOWN';
        if (!buckets[froKey][side][st]) buckets[froKey][side][st] = [];
        buckets[froKey][side][st].push(a);
      }

      let donorIds = [];
      if (!minimal) donorIds = [...new Set(assignments.map(a => a.donor_id).filter(Boolean))];

      const donorMap = {};
      if (!minimal && donorIds.length > 0) {
        const { data: donors } = await db.from('donor_profiles')
          .select('id, name, mobile_number, amount, city')
          .in('id', donorIds);
        for (const d of donors || []) donorMap[d.id] = d;
      }

      const knownFroIds = new Set(Object.keys(workerNameMap));
      const froKeys = new Set([...Object.keys(buckets), ...knownFroIds]);

      const froAssignments = [];
      for (const froKey of froKeys) {
        const isUnassigned = froKey === 'UNASSIGNED';
        const froId = isUnassigned ? null : froKey;
        const froName = isUnassigned ? 'Unassigned' : (workerNameMap[froKey] || 'Unknown');
        const buildSide = (side) => {
          const stationBuckets = (buckets[froKey] && buckets[froKey][side]) || {};
          const stations = Object.keys(stationBuckets).sort();
          return stations.map(st => {
            const list = stationBuckets[st] || [];
            const data = minimal ? [] : list.slice(0, perStationLimit).map(a => {
              const d = donorMap[a.donor_id] || {};
              return {
                id: a.id,
                assignment_id: a.id,
                donor_id: a.donor_id,
                name: d.name || 'Unknown',
                mobile: d.mobile_number || '',
                amount: d.amount || 0,
                city: d.city || '',
                status: a.status || 'pending',
                is_new: a.is_new !== false,
                batch_type: a.batch_type || null,
                assigned_at: a.assigned_at || null,
              };
            });
            return {
              stationId: stationIdMap[st] || null,
              stationName: st,
              count: list.length,
              data,
            };
          });
        };
        froAssignments.push({
          froId,
          froName,
          new: { stations: buildSide('new') },
          old: { stations: buildSide('old') },
        });
      }

      result.push({ ngoId, ngoName, froAssignments });
    }

    return res.json(result);
  } catch (error) {
    console.error('getDataOverview error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// ==================== NEW DASHBOARD APIs ====================

// Combined TL Dashboard Summary
export const getTLDashboard = async (req, res) => {
  try {
    const tlCacheKey = `tl:${req.user.id}:${req.query.ngo_id || 'all'}`;
    if (req.query.fresh !== '1') {
      const cached = cacheGet(tlCacheKey, 15000);
      if (cached) return res.json(cached);
    }
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames.push(ngo.name); ngoIds.push(req.user.ngo_id); }
    }

    const { ngo_id: filterNgoId } = req.query;
    const origNgoNames = [...ngoNames];
    const origNgoIds = [...ngoIds];

    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        ngoNames.splice(0, ngoNames.length, ngoNames[idx]);
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
      }
    }

    if (ngoIds.length === 0) return res.json({ 
      kpis: { total_fros: 0, calling: 0, idle: 0, offline: 0, total_calls: 0, connected: 0, interested: 0, received_amount: 0, followups_due: 0, target_pct: 0 },
      funnel: [],
      hourly: [],
      top_performers: [],
      bottom_performers: [],
      idle_alerts: []
    });

    // Get all FRO workers
    const allWorkers = (await Promise.all(ngoIds.map(ngoId => getFroWorkersByNgo(ngoId)))).flat();
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });
    const workerIds = froWorkers.map(w => w.id);

    const now = new Date();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    // 1. Live status counts (use the detailed query from later)
    const { data: liveStatus } = await db.from('fro_live_status').select('fro_worker_id, status, today_talk_seconds, today_idle_seconds, updated_at').in('fro_worker_id', workerIds);
    const calling = (liveStatus || []).filter(s => s.status === 'on_call').length;
    const idle = (liveStatus || []).filter(s => s.status === 'idle').length;
    const online = (liveStatus || []).filter(s => s.status === 'online').length;
    const offline = froWorkers.length - calling - idle - online;

    // 2. Call analytics for today
    const { data: callLogs } = await db
      .from('fro_donor_logs')
      .select('disposition_detail, accounts_status, amount_collected, fro_assignments!inner(ngo_id)')
      .in('fro_assignments.ngo_id', ngoIds)
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString());

    const connectedStatuses = new Set([
      'donation_collected', 'promise_to_pay', 'lead_done', 'done',
      'visit_donate', 'will_donate_online', 'payment_pending', 'already_donated',
      'pending', 'contacted', 'follow_up', 'scheduled',
      'email_sent', 'whatsapp_sent', 'csr_inquiry',
      'wants_80g_details', 'wants_trust_documents'
    ]);
    const interestedStatuses = new Set(['lead_done', 'donation_collected', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending']);

    const totalCalls = (callLogs || []).length;
    const connected = (callLogs || []).filter(l => connectedStatuses.has(l.disposition_detail)).length;
    const interested = (callLogs || []).filter(l => interestedStatuses.has(l.disposition_detail)).length;
    const receivedAmount = (callLogs || []).filter(l => l.accounts_status === 'verified').reduce((sum, l) => sum + parseFloat(l.amount_collected || 0), 0);

    // 3. Follow-ups due
    const { data: followups } = await db
      .from('fro_assignments')
      .select('id, next_follow_up')
      .in('ngo_id', ngoIds)
      .not('status', 'in', '("reassigned", "donation_collected")')
      .not('next_follow_up', 'is', null);
    const followupsDue = (followups || []).filter(f => f.next_follow_up && new Date(f.next_follow_up) <= todayEnd).length;

    // 4. Target achievement
    const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    const { data: targets } = await db.from('fro_targets').select('target_amount, achieved_target').in('ngo_id', ngoIds).eq('month', monthStr);
    const totalTarget = (targets || []).reduce((sum, t) => sum + parseFloat(t.target_amount || 0), 0);
    const totalAchieved = (targets || []).reduce((sum, t) => sum + parseFloat(t.achieved_target || 0), 0);
    const targetPct = totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : 0;

    // 5. Donation Funnel
    const { data: funnelAssignments } = await db.from('fro_assignments').select('donor_id').in('ngo_id', ngoIds).neq('status', 'reassigned');
    const assignedDonorIds = new Set((funnelAssignments || []).map(a => a.donor_id).filter(Boolean));
    
    const { data: funnelLogs } = await db
      .from('fro_donor_logs')
      .select('donor_id, disposition_detail, accounts_status, fro_assignments!inner(ngo_id)')
      .in('fro_assignments.ngo_id', ngoIds);

    const calledDonorIds = new Set((funnelLogs || []).map(l => l.donor_id).filter(Boolean));
    const connectedDonorIds = new Set((funnelLogs || []).filter(l => connectedStatuses.has(l.disposition_detail)).map(l => l.donor_id).filter(Boolean));
    const interestedDonorIds = new Set((funnelLogs || []).filter(l => interestedStatuses.has(l.disposition_detail)).map(l => l.donor_id).filter(Boolean));
    const receivedDonorIds = new Set((funnelLogs || []).filter(l => l.accounts_status === 'verified').map(l => l.donor_id).filter(Boolean));

    const funnel = [
      { stage: 'Assigned', count: assignedDonorIds.size, pct: 100 },
      { stage: 'Called', count: calledDonorIds.size, pct: assignedDonorIds.size > 0 ? Math.round((calledDonorIds.size / assignedDonorIds.size) * 100) : 0 },
      { stage: 'Connected', count: connectedDonorIds.size, pct: assignedDonorIds.size > 0 ? Math.round((connectedDonorIds.size / assignedDonorIds.size) * 100) : 0 },
      { stage: 'Interested', count: interestedDonorIds.size, pct: assignedDonorIds.size > 0 ? Math.round((interestedDonorIds.size / assignedDonorIds.size) * 100) : 0 },
      { stage: 'Received', count: receivedDonorIds.size, pct: assignedDonorIds.size > 0 ? Math.round((receivedDonorIds.size / assignedDonorIds.size) * 100) : 0 },
    ];

    // 6. Hourly Performance
    const { data: hourlyLogs } = await db
      .from('fro_donor_logs')
      .select('created_at, disposition_detail, accounts_status, amount_collected, fro_assignments!inner(ngo_id)')
      .in('fro_assignments.ngo_id', ngoIds)
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString());

    const hourlyMap = {};
    for (let h = 9; h <= 20; h++) {
      const hourStr = `${String(h).padStart(2, '0')}:00-${String(h+1).padStart(2, '0')}:00`;
      hourlyMap[hourStr] = { hour: hourStr, calls: 0, connected: 0, interested: 0, donations: 0, amount: 0 };
    }

    for (const l of hourlyLogs || []) {
      const hour = new Date(l.created_at).getHours();
      if (hour < 9 || hour > 20) continue;
      const hourStr = `${String(hour).padStart(2, '0')}:00-${String(hour+1).padStart(2, '0')}:00`;
      if (!hourlyMap[hourStr]) continue;
      hourlyMap[hourStr].calls++;
      if (connectedStatuses.has(l.disposition_detail)) hourlyMap[hourStr].connected++;
      if (interestedStatuses.has(l.disposition_detail)) hourlyMap[hourStr].interested++;
      if (l.accounts_status === 'verified') {
        hourlyMap[hourStr].donations++;
        hourlyMap[hourStr].amount += parseFloat(l.amount_collected || 0);
      }
    }
    const hourly = Object.values(hourlyMap);

    // 7. FRO Performance for Top/Bottom
    const batchStats = await getBatchCollectionStats(workerIds, monthStart, monthEnd, todayStart.toISOString(), todayEnd.toISOString(), ngoIds);
    
    const { data: faRows } = await db
      .from('fro_assignments')
      .select('status, fro_worker_id')
      .in('ngo_id', ngoIds)
      .neq('status', 'reassigned');

    const workerAssignments = {};
    for (const a of faRows || []) {
      if (!workerAssignments[a.fro_worker_id]) workerAssignments[a.fro_worker_id] = { connected: 0, total: 0 };
      workerAssignments[a.fro_worker_id].total++;
      if (connectedStatuses.has(a.status)) workerAssignments[a.fro_worker_id].connected++;
    }

    // Live status map for status/idle (use liveStatus from earlier)
    const liveStatusMap = {};
    for (const ls of liveStatus || []) {
      liveStatusMap[ls.fro_worker_id] = ls;
    }

    // Claim status per FRO
    const { data: claimLogs } = await db
      .from('fro_donor_logs')
      .select('fro_worker_id, accounts_status, fro_assignments!inner(ngo_id)')
      .in('fro_assignments.ngo_id', ngoIds)
      .in('fro_worker_id', workerIds);
    
    const claimStatusMap = {};
    for (const log of claimLogs || []) {
      if (!claimStatusMap[log.fro_worker_id]) {
        claimStatusMap[log.fro_worker_id] = { pending: 0, verified: 0, rejected: 0 };
      }
      if (log.accounts_status === 'pending') claimStatusMap[log.fro_worker_id].pending++;
      else if (log.accounts_status === 'verified') claimStatusMap[log.fro_worker_id].verified++;
      else if (log.accounts_status === 'rejected') claimStatusMap[log.fro_worker_id].rejected++;
    }

    // Actual call counts per FRO (for today, week, and month)
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const { data: callCountLogs } = await db
      .from('fro_donor_logs')
      .select('fro_worker_id, created_at, disposition_detail, fro_assignments!inner(ngo_id)')
      .in('fro_assignments.ngo_id', ngoIds)
      .in('fro_worker_id', workerIds)
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd);
    
    const callCounts = {};
    for (const log of callCountLogs || []) {
      if (!callCounts[log.fro_worker_id]) {
        callCounts[log.fro_worker_id] = {
          month: 0, today: 0, week: 0,
          monthConnected: 0, todayConnected: 0, weekConnected: 0,
          monthInterested: 0, todayInterested: 0, weekInterested: 0,
          connectedStatuses_month: {},
          connectedStatuses_today: {},
          connectedStatuses_week: {},
        };
      }
      callCounts[log.fro_worker_id].month++;
      const isToday = new Date(log.created_at) >= todayStart && new Date(log.created_at) <= todayEnd;
      const isWeek = new Date(log.created_at) >= weekStart && new Date(log.created_at) <= todayEnd;
      if (isToday) callCounts[log.fro_worker_id].today++;
      if (isWeek) callCounts[log.fro_worker_id].week++;
      if (connectedStatuses.has(log.disposition_detail)) {
        const ds = log.disposition_detail;
        callCounts[log.fro_worker_id].monthConnected++;
        callCounts[log.fro_worker_id].connectedStatuses_month[ds] = (callCounts[log.fro_worker_id].connectedStatuses_month[ds] || 0) + 1;
        if (isToday) {
          callCounts[log.fro_worker_id].todayConnected++;
          callCounts[log.fro_worker_id].connectedStatuses_today[ds] = (callCounts[log.fro_worker_id].connectedStatuses_today[ds] || 0) + 1;
        }
        if (isWeek) {
          callCounts[log.fro_worker_id].weekConnected++;
          callCounts[log.fro_worker_id].connectedStatuses_week[ds] = (callCounts[log.fro_worker_id].connectedStatuses_week[ds] || 0) + 1;
        }
      }
      if (interestedStatuses.has(log.disposition_detail)) {
        callCounts[log.fro_worker_id].monthInterested++;
        if (isToday) callCounts[log.fro_worker_id].todayInterested++;
        if (isWeek) callCounts[log.fro_worker_id].weekInterested++;
      }
    }

    // Station info per FRO
    const { data: froStationData } = await db
      .from('fro_station_assignments')
      .select('fro_worker_id, station')
      .in('ngo_id', ngoIds);
    const froStationMap = {};
    for (const row of froStationData || []) {
      if (row.fro_worker_id && row.station) {
        if (!froStationMap[row.fro_worker_id]) froStationMap[row.fro_worker_id] = [];
        if (!froStationMap[row.fro_worker_id].includes(row.station)) {
          froStationMap[row.fro_worker_id].push(row.station);
        }
      }
    }

    const performance = froWorkers.map(w => {
      const bs = batchStats;
      const coll = bs.monthCollection[w.id] || 0;
      const leads = (bs.verifiedMonth[w.id]?.count || 0) + (bs.unverifiedMonth[w.id]?.count || 0);
      const wa = workerAssignments[w.id] || { connected: 0, total: 0 };
      const conversion = wa.total > 0 ? Math.round((wa.connected / wa.total) * 1000) / 10 : 0;
      const target = (targets || []).find(t => t.fro_worker_id === w.id);
      const targetAmt = target ? parseFloat(target.target_amount) : 0;
      const achievedAmt = target ? parseFloat(target.achieved_target || 0) : coll;
      const targetPct = targetAmt > 0 ? Math.round((achievedAmt / targetAmt) * 100) : 0;

      const ls = liveStatusMap[w.id] || {};
      const claims = claimStatusMap[w.id] || { pending: 0, verified: 0, rejected: 0 };
      const idleMinutes = ls.updated_at ? Math.floor((now - new Date(ls.updated_at)) / 60000) : 0;

      return {
        fro_id: w.id,
        fro_name: w.name || w.login_id || 'Unknown',
        fro_login_id: w.login_id || '',
        calls: callCounts[w.id]?.month || 0,
        calls_today: callCounts[w.id]?.today || 0,
        calls_week: callCounts[w.id]?.week || 0,
        connected: callCounts[w.id]?.monthConnected || 0,
        connected_today: callCounts[w.id]?.todayConnected || 0,
        connected_week: callCounts[w.id]?.weekConnected || 0,
        interested: callCounts[w.id]?.monthInterested || 0,
        interested_today: callCounts[w.id]?.todayInterested || 0,
        interested_week: callCounts[w.id]?.weekInterested || 0,
        connectedStatuses: callCounts[w.id]?.connectedStatuses_month || {},
        connectedStatuses_today: callCounts[w.id]?.connectedStatuses_today || {},
        connectedStatuses_week: callCounts[w.id]?.connectedStatuses_week || {},
        connectedStatuses_month: callCounts[w.id]?.connectedStatuses_month || {},
        stations: froStationMap[w.id] || [],
        receivedDonors: leads,
        receivedAmount: coll,
        receivedAmount_today: bs.todayCollection[w.id] || 0,
        receivedAmount_week: bs.weekCollection[w.id] || 0,
        targetPct: targetPct,
        target_amount: targetAmt,
        target_pct: targetPct,
        status: ls.status || 'offline',
        idleMinutes: idleMinutes,
        claims_pending: claims.pending,
        claims_verified: claims.verified,
        claims_rejected: claims.rejected,
        data_connected: wa.connected,
        data_total: wa.total,
        conversion_pct: conversion,
        collection_amount: coll,
        collection_amount_today: bs.todayCollection[w.id] || 0,
        collection_amount_week: bs.weekCollection[w.id] || 0,
        lead_done_count: leads,
      };
    });

    const topByAmount = [...performance].sort((a, b) => b.collection_amount - a.collection_amount).slice(0, 5);
    const topByDonors = [...performance].sort((a, b) => b.lead_done_count - a.lead_done_count).slice(0, 5);
    const topByConv = [...performance].filter(p => p.data_total > 0).sort((a, b) => b.conversion_pct - a.conversion_pct).slice(0, 5);
    const bottomByTarget = [...performance].filter(p => p.target_amount > 0).sort((a, b) => a.target_pct - b.target_pct).slice(0, 5);

    // 8. Idle Alerts (15 min no activity)
    const { data: idleFros } = await db
      .from('fro_live_status')
      .select('fro_worker_id, status, updated_at, today_talk_seconds, today_idle_seconds')
      .in('fro_worker_id', workerIds)
      .in('status', ['online', 'idle']);
    
    const idleAlerts = (idleFros || [])
      .filter(f => {
        const lastUpdate = new Date(f.updated_at);
        return (now - lastUpdate) > 15 * 60 * 1000;
      })
      .map(f => {
        const fro = froWorkers.find(w => w.id === f.fro_worker_id);
        const idleMinutes = Math.floor((now - new Date(f.updated_at)) / 60000);
        return {
          fro_id: f.fro_worker_id,
          fro_name: fro?.name || 'Unknown',
          idle_minutes: idleMinutes,
          last_activity: f.updated_at,
          status: f.status,
        };
      });

    const tlPayload = {
      kpis: {
        total_fros: froWorkers.length,
        calling,
        idle,
        offline,
        total_calls: totalCalls,
        connected,
        interested,
        received_amount: receivedAmount,
        followups_due: followupsDue,
        target_pct: targetPct,
      },
      funnel,
      hourly,
      performance,  // Add full performance array for telecaller table
      top_performers: {
        amount: topByAmount,
        donors: topByDonors,
        conversion: topByConv,
      },
      bottom_performers: {
        target: bottomByTarget,
      },
      idle_alerts: idleAlerts,
    };
    cacheSet(tlCacheKey, tlPayload);
    return res.json(tlPayload);
  } catch (error) {
    console.error('getTLDashboard error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// Donation Funnel
export const getDonationFunnel = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames.push(ngo.name); ngoIds.push(req.user.ngo_id); }
    }

    const { ngo_id: filterNgoId } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        ngoNames.splice(0, ngoNames.length, ngoNames[idx]);
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
      }
    }

    if (ngoIds.length === 0) return res.json([]);

    const connectedStatuses = new Set(['contacted', 'lead_done', 'done', 'donation_collected', 'follow_up', 'scheduled', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'callback']);
    const interestedStatuses = new Set(['lead_done', 'donation_collected', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending']);

    const allFunnel = [];
    for (const ngoId of ngoIds) {
      const { data: assignments } = await db.from('fro_assignments').select('donor_id').eq('ngo_id', ngoId).neq('status', 'reassigned');
      const assignedDonorIds = new Set((assignments || []).map(a => a.donor_id).filter(Boolean));
      
      const { data: logs } = await db.from('fro_donor_logs').select('donor_id, disposition_detail, accounts_status, fro_assignments!inner(ngo_id)').eq('fro_assignments.ngo_id', ngoId);
      
      const calledDonorIds = new Set((logs || []).map(l => l.donor_id).filter(Boolean));
      const connectedDonorIds = new Set((logs || []).filter(l => connectedStatuses.has(l.disposition_detail)).map(l => l.donor_id).filter(Boolean));
      const interestedDonorIds = new Set((logs || []).filter(l => interestedStatuses.has(l.disposition_detail)).map(l => l.donor_id).filter(Boolean));
      const receivedDonorIds = new Set((logs || []).filter(l => l.accounts_status === 'verified').map(l => l.donor_id).filter(Boolean));

      allFunnel.push({
        ngo_id: ngoId,
        stages: [
          { stage: 'Assigned', count: assignedDonorIds.size, pct: 100 },
          { stage: 'Called', count: calledDonorIds.size, pct: assignedDonorIds.size > 0 ? Math.round((calledDonorIds.size / assignedDonorIds.size) * 100) : 0 },
          { stage: 'Connected', count: connectedDonorIds.size, pct: assignedDonorIds.size > 0 ? Math.round((connectedDonorIds.size / assignedDonorIds.size) * 100) : 0 },
          { stage: 'Interested', count: interestedDonorIds.size, pct: assignedDonorIds.size > 0 ? Math.round((interestedDonorIds.size / assignedDonorIds.size) * 100) : 0 },
          { stage: 'Received', count: receivedDonorIds.size, pct: assignedDonorIds.size > 0 ? Math.round((receivedDonorIds.size / assignedDonorIds.size) * 100) : 0 },
        ],
      });
    }

    return res.json(allFunnel);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Hourly Performance
export const getHourlyPerformance = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames.push(ngo.name); ngoIds.push(req.user.ngo_id); }
    }

    const { ngo_id: filterNgoId, date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const todayStart = new Date(targetDate); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(targetDate); todayEnd.setHours(23, 59, 59, 999);

    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        ngoNames.splice(0, ngoNames.length, ngoNames[idx]);
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
      }
    }

    if (ngoIds.length === 0) return res.json([]);

    const connectedStatuses = new Set(['contacted', 'lead_done', 'done', 'donation_collected', 'follow_up', 'scheduled', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'callback']);
    const interestedStatuses = new Set(['lead_done', 'donation_collected', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending']);

    const { data: logs } = await db
      .from('fro_donor_logs')
      .select('created_at, disposition_detail, accounts_status, amount_collected, fro_assignments!inner(ngo_id)')
      .in('fro_assignments.ngo_id', ngoIds)
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString());

    const hourlyMap = {};
    for (let h = 9; h <= 20; h++) {
      const hourStr = `${String(h).padStart(2, '0')}:00-${String(h+1).padStart(2, '0')}:00`;
      hourlyMap[hourStr] = { hour: hourStr, calls: 0, connected: 0, interested: 0, donations: 0, amount: 0 };
    }

    for (const l of logs || []) {
      const hour = new Date(l.created_at).getHours();
      if (hour < 9 || hour > 20) continue;
      const hourStr = `${String(hour).padStart(2, '0')}:00-${String(hour+1).padStart(2, '0')}:00`;
      if (!hourlyMap[hourStr]) continue;
      hourlyMap[hourStr].calls++;
      if (connectedStatuses.has(l.disposition_detail)) hourlyMap[hourStr].connected++;
      if (interestedStatuses.has(l.disposition_detail)) hourlyMap[hourStr].interested++;
      if (l.accounts_status === 'verified') {
        hourlyMap[hourStr].donations++;
        hourlyMap[hourStr].amount += parseFloat(l.amount_collected || 0);
      }
    }

    return res.json(Object.values(hourlyMap));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Follow-ups
export const getFollowups = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames.push(ngo.name); ngoIds.push(req.user.ngo_id); }
    }

    const { ngo_id: filterNgoId, bucket, date } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        ngoNames.splice(0, ngoNames.length, ngoNames[idx]);
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
      }
    }

    if (ngoIds.length === 0) return res.json([]);

    const now = new Date();
    const istDateOf = (value) => {
      const d = new Date(value);
      if (isNaN(d.getTime())) return null;
      return new Date(d.getTime() + ((5 * 60) + 30) * 60000).toISOString().slice(0, 10);
    };
    const todayStr = istDateOf(now);
    const tomorrowStr = istDateOf(now.getTime() + 24 * 60 * 60 * 1000);
    const daywiseDate = date ? String(date).slice(0, 10) : null;

    // IST week (Mon–Sun) + month boundaries for the week/month buckets
    const istNow = new Date(now.getTime() + ((5 * 60) + 30) * 60000);
    const mondayOffset = (istNow.getUTCDay() + 6) % 7;
    const mondayStr = istDateOf(now.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
    const sundayStr = istDateOf(now.getTime() + (6 - mondayOffset) * 24 * 60 * 60 * 1000);
    const monthStr = (todayStr || '').slice(0, 7);

    let query = db
      .from('fro_assignments')
      .select(`
        id, status, next_follow_up, fro_worker_id, donor_id,
        workers!fro_assignments_fro_worker_id_fkey(name),
        donor_profiles!inner(name, mobile_number)
      `)
      .in('ngo_id', ngoIds)
      .not('status', 'in', '("reassigned", "donation_collected")')
      .not('next_follow_up', 'is', null)
      .order('next_follow_up', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    // Day-wise mode: return records due / scheduled for one day, tagged
    // follow_up or callback (callback = donor asked for a call-back or has an
    // incomplete scheduled contact that day). No double counting.
    if (daywiseDate) {
      const assignments = data || [];
      const ids = assignments.map(a => a.id);
      const scheduleMap = {};
      if (ids.length > 0) {
        const { data: sched, error: schedErr } = await db
          .from('fro_scheduled_contacts')
          .select('assignment_id, scheduled_at')
          .in('assignment_id', ids)
          .eq('is_completed', false);
        if (schedErr) throw schedErr;
        for (const s of sched || []) {
          if (!scheduleMap[s.assignment_id]) scheduleMap[s.assignment_id] = s.scheduled_at;
        }
      }

      const callbackStatuses = new Set(['callback', 'scheduled', 'office_visit_scheduled', 'program_visit_scheduled', 'visit_donate']);
      const results = [];
      for (const f of assignments) {
        const scheduled_at = scheduleMap[f.id] || null;
        const scheduledDay = scheduled_at ? istDateOf(scheduled_at) : null;
        const assignedDay = f.next_follow_up ? String(f.next_follow_up).slice(0, 10) : null;
        if (assignedDay !== daywiseDate && scheduledDay !== daywiseDate) continue;

        const isCallback = callbackStatuses.has(f.status) || scheduledDay === daywiseDate;
        results.push({
          assignment_id: f.id,
          assignmentId: f.id,
          telecaller: f.workers?.name || 'Unknown',
          fro_worker_id: f.fro_worker_id,
          donor_name: f.donor_profiles?.name || 'Unknown',
          mobile: f.donor_profiles?.mobile_number || '',
          followup_date: f.next_follow_up,
          scheduled_at,
          status: f.status || null,
          type: isCallback ? 'callback' : 'follow_up',
        });
      }

      results.sort((a, b) => {
        if ((a.telecaller || '') !== (b.telecaller || '')) return (a.telecaller || '').localeCompare(b.telecaller || '');
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return (a.donor_name || '').localeCompare(b.donor_name || '');
      });
      return res.json(results);
    }

    // Existing bucket mode — every row gets a primary date bucket plus optional
    // week/month membership, and a callback/follow_up type (same rules as day-wise).
    const idsForBuckets = (data || []).map(a => a.id);
    const scheduleMap = {};
    if (idsForBuckets.length > 0) {
      const { data: sched, error: schedErr } = await db
        .from('fro_scheduled_contacts')
        .select('assignment_id, scheduled_at')
        .in('assignment_id', idsForBuckets)
        .eq('is_completed', false);
      if (schedErr) throw schedErr;
      for (const s of sched || []) {
        if (!scheduleMap[s.assignment_id]) scheduleMap[s.assignment_id] = s.scheduled_at;
      }
    }

    const monthPrefix = (d) => String(d).slice(0, 7);
    const callbackStatuses = new Set(['callback', 'scheduled', 'office_visit_scheduled', 'program_visit_scheduled', 'visit_donate']);

    const followups = (data || []).map(f => {
      const nd = f.next_follow_up ? String(f.next_follow_up).slice(0, 10) : null;
      const buckets = [];
      if (!nd) buckets.push('future');
      else if (nd < todayStr) buckets.push('overdue');
      else if (nd === todayStr) buckets.push('today');
      else if (nd === tomorrowStr) buckets.push('tomorrow');
      else buckets.push('future');
      if (nd && nd >= mondayStr && nd <= sundayStr) buckets.push('week');
      if (nd && monthPrefix(nd) === monthStr) buckets.push('month');

      const scheduled_at = scheduleMap[f.id] || null;
      const scheduledDay = scheduled_at ? istDateOf(scheduled_at) : null;
      const isCallback = callbackStatuses.has(f.status) || (nd && scheduledDay === nd);

      return {
        assignment_id: f.id,
        assignmentId: f.id,
        telecaller: f.workers?.name || 'Unknown',
        fro_worker_id: f.fro_worker_id,
        donor_name: f.donor_profiles?.name || 'Unknown',
        mobile: f.donor_profiles?.mobile_number || '',
        expected_amount: 0, // Would need additional query
        followup_date: f.next_follow_up,
        scheduled_at,
        status: f.status || null,
        type: isCallback ? 'callback' : 'follow_up',
        bucket: buckets[0],
        buckets,
      };
    });

    if (bucket) {
      const filtered = followups.filter(f => (f.buckets || [f.bucket]).includes(bucket));
      filtered.sort((a, b) => {
        if ((a.telecaller || '') !== (b.telecaller || '')) return (a.telecaller || '').localeCompare(b.telecaller || '');
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return (a.donor_name || '').localeCompare(b.donor_name || '');
      });
      return res.json(filtered);
    }
    return res.json(followups);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const reassignFollowup = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { new_fro_worker_id, new_followup_date } = req.body;
    
    const ngoIds = await getUserNgoIds(req.user);
    const { data: existing } = await db.from('fro_assignments').select('ngo_id').eq('id', assignmentId).maybeSingle();
    if (!existing || !ngoIds.includes(existing.ngo_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updates = {};
    if (new_fro_worker_id) updates.fro_worker_id = new_fro_worker_id;
    if (new_followup_date) updates.next_follow_up = new_followup_date;
    
    const { error } = await db.from('fro_assignments').update(updates).eq('id', assignmentId);
    if (error) throw error;

    return res.json({ message: 'Follow-up reassigned successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateFollowupDate = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { followup_date } = req.body;
    
    const ngoIds = await getUserNgoIds(req.user);
    const { data: existing } = await db.from('fro_assignments').select('ngo_id').eq('id', assignmentId).maybeSingle();
    if (!existing || !ngoIds.includes(existing.ngo_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { error } = await db.from('fro_assignments').update({ next_follow_up: followup_date }).eq('id', assignmentId);
    if (error) throw error;

    return res.json({ message: 'Follow-up date updated' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Idle Alerts
export const getIdleAlerts = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoIds.length === 0 && req.user.ngo_id) {
      ngoIds.push(req.user.ngo_id);
    }

    const { ngo_id: filterNgoId } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
    }

    if (ngoIds.length === 0) return res.json([]);

    const allWorkers = (await Promise.all(ngoIds.map(ngoId => getFroWorkersByNgo(ngoId)))).flat();
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });
    const workerIds = froWorkers.map(w => w.id);

    const now = new Date();
    const { data: idleFros } = await db
      .from('fro_live_status')
      .select('fro_worker_id, status, updated_at, today_talk_seconds, today_idle_seconds')
      .in('fro_worker_id', workerIds)
      .in('status', ['online', 'idle']);
    
    const idleAlerts = (idleFros || [])
      .filter(f => (now - new Date(f.updated_at)) > 15 * 60 * 1000)
      .map(f => {
        const fro = froWorkers.find(w => w.id === f.fro_worker_id);
        return {
          fro_id: f.fro_worker_id,
          fro_name: fro?.name || 'Unknown',
          idle_minutes: Math.floor((now - new Date(f.updated_at)) / 60000),
          last_activity: f.updated_at,
          status: f.status,
        };
      });

    return res.json(idleAlerts);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Top/Bottom Performers
export const getTopPerformers = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames.push(ngo.name); ngoIds.push(req.user.ngo_id); }
    }

    const { ngo_id: filterNgoId } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) {
        ngoNames.splice(0, ngoNames.length, ngoNames[idx]);
        ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
      }
    }

    if (ngoIds.length === 0) return res.json({ amount: [], donors: [], conversion: [] });

    const allWorkers = (await Promise.all(ngoIds.map(ngoId => getFroWorkersByNgo(ngoId)))).flat();
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });
    const workerIds = froWorkers.map(w => w.id);

    const monthStr = new Date().toISOString().slice(0, 7) + '-01';
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const batchStats = await getBatchCollectionStats(workerIds, monthStart, monthEnd, todayStart.toISOString(), todayEnd.toISOString(), ngoIds);
    
    const { data: faRows } = await db
      .from('fro_assignments')
      .select('status, fro_worker_id')
      .in('ngo_id', ngoIds)
      .neq('status', 'reassigned');

    const connectedStatuses = new Set(['contacted', 'lead_done', 'done', 'donation_collected', 'follow_up', 'scheduled', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'callback']);
    const workerAssignments = {};
    for (const a of faRows || []) {
      if (!workerAssignments[a.fro_worker_id]) workerAssignments[a.fro_worker_id] = { connected: 0, total: 0 };
      workerAssignments[a.fro_worker_id].total++;
      if (connectedStatuses.has(a.status)) workerAssignments[a.fro_worker_id].connected++;
    }

    const { data: targets } = await db.from('fro_targets').select('fro_worker_id, target_amount, achieved_target').in('ngo_id', ngoIds).eq('month', monthStr);

    const performance = froWorkers.map(w => {
      const bs = batchStats;
      const coll = bs.monthCollection[w.id] || 0;
      const leads = bs.monthCollection[w.id] ? (bs.verifiedMonth[w.id]?.count || 0) + (bs.unverifiedMonth[w.id]?.count || 0) : 0;
      const wa = workerAssignments[w.id] || { connected: 0, total: 0 };
      const conversion = wa.total > 0 ? Math.round((wa.connected / wa.total) * 1000) / 10 : 0;
      const target = (targets || []).find(t => t.fro_worker_id === w.id);
      const targetAmt = target ? parseFloat(target.target_amount) : 0;
      const achievedAmt = target ? parseFloat(target.achieved_target || 0) : coll;
      const targetPct = targetAmt > 0 ? Math.round((achievedAmt / targetAmt) * 100) : 0;
      
      return {
        fro_id: w.id,
        fro_name: w.name || w.login_id || 'Unknown',
        collection_amount: coll,
        lead_done_count: leads,
        data_connected: wa.connected,
        data_total: wa.total,
        conversion_pct: conversion,
        target_amount: targetAmt,
        target_pct: targetPct,
      };
    }).filter(p => p.collection_amount > 0 || p.lead_done_count > 0 || p.data_total > 0);

    const topByAmount = [...performance].sort((a, b) => b.collection_amount - a.collection_amount).slice(0, 5);
    const topByDonors = [...performance].sort((a, b) => b.lead_done_count - a.lead_done_count).slice(0, 5);
    const topByConv = [...performance].filter(p => p.data_total > 0).sort((a, b) => b.conversion_pct - a.conversion_pct).slice(0, 5);

    return res.json({
      amount: topByAmount,
      donors: topByDonors,
      conversion: topByConv,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getBottomPerformers = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoIds.length === 0 && req.user.ngo_id) {
      ngoIds.push(req.user.ngo_id);
    }

    const { ngo_id: filterNgoId } = req.query;
    if (filterNgoId && filterNgoId !== 'all') {
      const idx = ngoIds.findIndex(id => String(id) === String(filterNgoId));
      if (idx !== -1) ngoIds.splice(0, ngoIds.length, ngoIds[idx]);
    }

    if (ngoIds.length === 0) return res.json({ target: [] });

    const allWorkers = (await Promise.all(ngoIds.map(ngoId => getFroWorkersByNgo(ngoId)))).flat();
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });
    const workerIds = froWorkers.map(w => w.id);

    const monthStr = new Date().toISOString().slice(0, 7) + '-01';
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const batchStats = await getBatchCollectionStats(workerIds, monthStart, monthEnd, todayStart.toISOString(), todayEnd.toISOString(), ngoIds);
    
    const { data: faRows } = await db
      .from('fro_assignments')
      .select('status, fro_worker_id')
      .in('ngo_id', ngoIds)
      .neq('status', 'reassigned');

    const connectedStatuses = new Set(['contacted', 'lead_done', 'done', 'donation_collected', 'follow_up', 'scheduled', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'callback']);
    const workerAssignments = {};
    for (const a of faRows || []) {
      if (!workerAssignments[a.fro_worker_id]) workerAssignments[a.fro_worker_id] = { connected: 0, total: 0 };
      workerAssignments[a.fro_worker_id].total++;
      if (connectedStatuses.has(a.status)) workerAssignments[a.fro_worker_id].connected++;
    }

    const { data: targets } = await db.from('fro_targets').select('fro_worker_id, target_amount, achieved_target').in('ngo_id', ngoIds).eq('month', monthStr);

    const performance = froWorkers.map(w => {
      const bs = batchStats;
      const coll = bs.monthCollection[w.id] || 0;
      const wa = workerAssignments[w.id] || { connected: 0, total: 0 };
      const target = (targets || []).find(t => t.fro_worker_id === w.id);
      const targetAmt = target ? parseFloat(target.target_amount) : 0;
      const achievedAmt = target ? parseFloat(target.achieved_target || 0) : coll;
      const targetPct = targetAmt > 0 ? Math.round((achievedAmt / targetAmt) * 100) : 0;
      
      return {
        fro_id: w.id,
        fro_name: w.name || w.login_id || 'Unknown',
        collection_amount: coll,
        target_pct: targetPct,
      };
    }).filter(p => p.target_amount > 0);

    const bottomByTarget = [...performance].sort((a, b) => a.target_pct - b.target_pct).slice(0, 5);

    return res.json({ target: bottomByTarget });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Assigned Data - Station Performance
export const getAssignedData = async (req, res) => {
  try {
    const access = await getUserNgoAccess(req.user.id);
    const ngoNames = access.map(a => a.ngo_name).filter(Boolean);
    const ngoIds = access.map(a => a.ngo_id).filter(Boolean);

    if (ngoNames.length === 0 && req.user.ngo_id) {
      const { data: ngo } = await db.from('ngos').select('name').eq('id', req.user.ngo_id).single();
      if (ngo) { ngoNames.push(ngo.name); ngoIds.push(req.user.ngo_id); }
    }

    const { ngo_id: filterNgoId, period, from, to } = req.query;
    let targetNgoIds = filterNgoId && filterNgoId !== 'all' ? [filterNgoId] : ngoIds;
    if (targetNgoIds.length === 0) return res.json({ summary: {}, stations: [] });

    const now = new Date();
    let startDate, endDate;
    if (period === 'today') {
      startDate = new Date(); startDate.setHours(0, 0, 0, 0);
      endDate = new Date(); endDate.setHours(23, 59, 59, 999);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (from && to) {
      startDate = new Date(from);
      endDate = new Date(to);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    // Get station stats with dispositions
    const { data: stationStats } = await db.rpc('get_station_disposition_stats', {
      p_ngo_id: targetNgoIds[0],
      p_from: startISO,
      p_to: endISO,
    });

    // Get station assignments for FRO/NGO info
    const { data: stationAssigns } = await db
      .from('fro_station_assignments')
      .select('station, ngo_id, fro_worker_id, workers!left(name)')
      .in('ngo_id', targetNgoIds);

    // Get NGO names
    const { data: ngos } = await db.from('ngos').select('id, name').in('id', targetNgoIds);
    const ngoMap = Object.fromEntries((ngos || []).map(n => [n.id, n.name]));

    // Get donor counts per station
    const { data: donorCounts } = await db
      .from('fro_assignments')
      .select('donor_id, station, ngo_id, fro_worker_id')
      .in('ngo_id', targetNgoIds)
      .not('station', 'is', null)
      .not('status', 'eq', 'reassigned');

    const connectedStatuses = new Set(['contacted', 'lead_done', 'done', 'donation_collected', 'follow_up', 'scheduled', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending', 'already_donated', 'email_sent', 'whatsapp_sent', 'csr_inquiry', 'wants_80g_details', 'wants_trust_documents', 'language_barrier', 'transferred_senior', 'query_complaint', 'receipt_request', 'not_interested_now', 'not_interested', 'dnd', 'wrong_person', 'call_disconnected', 'callback']);
    const nonConnectedStatuses = new Set(['busy', 'ringing', 'call_waiting', 'unreachable', 'switched_off', 'out_of_coverage', 'wrong_number', 'invalid', 'invalid_number', 'rejected', 'temporary_network_issue', 'voicemail']);
    const leadDoneStatuses = new Set(['donation_collected', 'lead_done', 'done']);

    const stationMap = {};
    for (const row of stationStats || []) {
      const station = row.station || 'Unassigned';
      if (!stationMap[station]) {
        stationMap[station] = { station, donors: 0, connected: 0, non_connected: 0, lead_done: 0, ngos: [], fro_name: null };
      }
      const status = row.status;
      const count = parseInt(row.count, 10);
      stationMap[station].donors += count;
      if (connectedStatuses.has(status)) stationMap[station].connected += count;
      if (nonConnectedStatuses.has(status)) stationMap[station].non_connected += count;
      if (leadDoneStatuses.has(status)) stationMap[station].lead_done += count;
    }

    // Add NGO and FRO info
    for (const sa of stationAssigns || []) {
      if (stationMap[sa.station]) {
        if (!stationMap[sa.station].ngos.includes(sa.ngo_id)) {
          stationMap[sa.station].ngos.push(sa.ngo_id);
        }
        if (sa.fro_worker_id && !stationMap[sa.station].fro_name) {
          stationMap[sa.station].fro_name = sa.workers?.name || 'Unknown';
        }
      }
    }

    // Add stations that only exist in assignments but not in stats
    for (const dc of donorCounts || []) {
      if (!stationMap[dc.station]) {
        stationMap[dc.station] = { station: dc.station, donors: 0, connected: 0, non_connected: 0, lead_done: 0, ngos: [], fro_name: null };
      }
      if (!stationMap[dc.station].ngos.includes(dc.ngo_id)) {
        stationMap[dc.station].ngos.push(dc.ngo_id);
      }
    }

    const result = Object.values(stationMap).map(s => ({
      station: s.station,
      donors: s.donors,
      connected: s.connected,
      non_connected: s.non_connected,
      lead_done: s.lead_done,
      ngos: s.ngos.map(id => ({ id, name: ngoMap[id] })),
      fro_name: s.fro_name,
    }));

    // Summary
    const summary = {
      total_stations: result.length,
      total_donors: result.reduce((sum, s) => sum + s.donors, 0),
      total_connected: result.reduce((sum, s) => sum + s.connected, 0),
      total_non_connected: result.reduce((sum, s) => sum + s.non_connected, 0),
      total_lead_done: result.reduce((sum, s) => sum + s.lead_done, 0),
    };

    return res.json({ summary, stations: result });
  } catch (error) {
    console.error('getAssignedData error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// Restore wrong cross-FRO assignments: find fro_assignments where station IS NULL
// and the donor has another assignment with station IS NOT NULL for the same ngo_id.
export const restoreWrongAssignments = async (req, res) => {
  try {
    // Find all assignments with station NULL (manually created, potentially wrong)
    const { data: nullStationAsns } = await db
      .from('fro_assignments')
      .select('id, donor_id, fro_worker_id, ngo_id, station, status')
      .is('station', null)
      .not('status', 'eq', 'reassigned');

    if (!nullStationAsns || nullStationAsns.length === 0) {
      return res.json({ restored: 0, details: [] });
    }

    const details = [];
    let restoredCount = 0;

    for (const asn of nullStationAsns) {
      // Check if this donor has another assignment with station for the same ngo_id
      const { data: correctAsns } = await db
        .from('fro_assignments')
        .select('id, fro_worker_id, station')
        .eq('donor_id', asn.donor_id)
        .eq('ngo_id', asn.ngo_id)
        .not('id', 'eq', asn.id)
        .not('status', 'eq', 'reassigned')
        .not('station', 'is', null);

      if (correctAsns && correctAsns.length > 0) {
        // This is a wrong assignment — delete it and its fro_donor_logs
        const { data: logs } = await db
          .from('fro_donor_logs')
          .select('id, amount_collected')
          .eq('assignment_id', asn.id);

        // Delete fro_donor_logs first
        if (logs && logs.length > 0) {
          await db.from('fro_donor_logs').delete().eq('assignment_id', asn.id);
        }

        // Delete the wrong assignment
        await db.from('fro_assignments').delete().eq('id', asn.id);

        restoredCount++;
        details.push({
          assignment_id: asn.id,
          donor_id: asn.donor_id,
          fro_worker_id: asn.fro_worker_id,
          ngo_id: asn.ngo_id,
          logs_deleted: logs?.length || 0,
          correct_assignment_id: correctAsns[0]?.id,
        });
      }
    }

    return res.json({ restored: restoredCount, details });
  } catch (error) {
    console.error('restoreWrongAssignments error:', error.message);
    return res.status(500).json({ message: error.message });
  }
};

// FRO-level Hourly Performance
export const getFroHourlyPerformance = async (req, res) => {
  try {
    const { ngo_id, from, to } = req.query;
    const ngoIds = await getUserNgoIds(req.user);
    const effectiveNgoId = ngo_id || (ngoIds.length === 1 ? ngoIds[0] : null);

    let fromDate, toDate;
    if (from) {
      fromDate = from.includes('T') ? from : `${from}T00:00:00.000Z`;
    } else {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      fromDate = d.toISOString();
    }
    if (to) {
      toDate = to.includes('T') ? to : `${to}T23:59:59.999Z`;
    } else {
      toDate = new Date().toISOString();
    }

    let logQuery = db
      .from('fro_donor_logs')
      .select('created_at, disposition_detail, accounts_status, amount_collected, fro_worker_id, fro_assignments!inner(ngo_id), workers!fro_donor_logs_fro_worker_id_fkey(id, name, login_id)')
      .gte('created_at', fromDate)
      .lte('created_at', toDate);

    if (effectiveNgoId) {
      logQuery = logQuery.eq('fro_assignments.ngo_id', effectiveNgoId);
    } else if (ngoIds.length > 0) {
      logQuery = logQuery.in('fro_assignments.ngo_id', ngoIds);
    }

    const { data: logs, error } = await logQuery;
    if (error) throw error;

    const connectedStatuses = new Set([
      'donation_collected', 'promise_to_pay', 'lead_done', 'done',
      'visit_donate', 'will_donate_online', 'payment_pending', 'already_donated',
      'pending', 'contacted', 'follow_up', 'scheduled',
      'email_sent', 'whatsapp_sent', 'csr_inquiry',
      'wants_80g_details', 'wants_trust_documents'
    ]);
    const interestedStatuses = new Set(['lead_done', 'donation_collected', 'visit_donate', 'will_donate_online', 'promise_to_pay', 'payment_pending']);

    // Build FRO-hourly map
    const froHourlyMap = {};
    for (const l of logs || []) {
      const wid = l.fro_worker_id;
      if (!wid) continue;
      const wname = l.workers?.name || 'Unknown';
      const wlogin = l.workers?.login_id || '';
      const hour = new Date(l.created_at).getHours();
      if (hour < 9 || hour > 20) continue;
      const hourStr = `${String(hour).padStart(2, '0')}:00-${String(hour+1).padStart(2, '0')}:00`;

      const key = `${wid}|${hourStr}`;
      if (!froHourlyMap[key]) {
        froHourlyMap[key] = {
          fro_worker_id: wid,
          fro_name: wname,
          fro_login_id: wlogin,
          hour: hourStr,
          calls: 0,
          connected: 0,
          interested: 0,
          donations: 0,
          amount: 0,
        };
      }
      froHourlyMap[key].calls++;
      if (connectedStatuses.has(l.disposition_detail)) froHourlyMap[key].connected++;
      if (interestedStatuses.has(l.disposition_detail)) froHourlyMap[key].interested++;
      if (l.accounts_status === 'verified') {
        froHourlyMap[key].donations++;
        froHourlyMap[key].amount += parseFloat(l.amount_collected || 0);
      }
    }

    // Ensure all active FROs are represented across working hours
    const targetNgos = effectiveNgoId ? [effectiveNgoId] : ngoIds;
    const allWorkers = (await Promise.all(targetNgos.map(nId => getFroWorkersByNgo(nId)))).flat();
    const seen = new Set();
    const froWorkers = allWorkers.filter(w => { const k = w.id; if (seen.has(k)) return false; seen.add(k); return true; });

    const allHours = Array.from({ length: 12 }, (_, i) => 
      `${String(9+i).padStart(2, '0')}:00-${String(10+i).padStart(2, '0')}:00`
    );

    for (const w of froWorkers) {
      for (const h of allHours) {
        const key = `${w.id}|${h}`;
        if (!froHourlyMap[key]) {
          froHourlyMap[key] = {
            fro_worker_id: w.id,
            fro_name: w.name || w.login_id || 'Unknown',
            fro_login_id: w.login_id || '',
            hour: h,
            calls: 0,
            connected: 0,
            interested: 0,
            donations: 0,
            amount: 0,
          };
        }
      }
    }

    const result = Object.values(froHourlyMap)
      .sort((a, b) => {
        if (a.fro_name !== b.fro_name) return a.fro_name.localeCompare(b.fro_name);
        return a.hour.localeCompare(b.hour);
      });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ---------------------------------------------------------------------------
// BULK STATION RENAME
//
// Rewrites a station code in place across every table that stores it, scoped
// per NGO so one old code can become different new codes per NGO (e.g.
// M-2 -> BOD-1 / AOD-1 / MOD-1). Rows are only relabelled — donors stay
// assigned to the same FRO, NGO and status; nothing is moved or deleted.
// Old codes are erased everywhere and the mapping is preserved in
// station_rename_log.
//
// Body: { renames: [{ ngo_name, old_station, new_station }], dry_run, confirm }
//   dry_run (default true)  -> validate + per-table affected counts, no writes
//   dry_run false + confirm -> apply everything inside ONE transaction with a
//                              post-verify (any leftover old code rolls back)
//
// donor_profiles rows whose old code is shared across multiple NGOs (NGO
// attribution is ambiguous there) are skipped and reported — their
// fro_assignments are still renamed correctly per NGO.
// ---------------------------------------------------------------------------

let _renameLogTableReady = false;
async function ensureStationRenameLogTable() {
  if (_renameLogTableReady) return;
  await sql(`
    CREATE TABLE IF NOT EXISTS station_rename_log (
      id             bigserial PRIMARY KEY,
      ngo_id         uuid,
      ngo_name       text,
      old_station    text NOT NULL,
      new_station    text NOT NULL,
      counts         jsonb NOT NULL DEFAULT '{}',
      skipped_donors integer NOT NULL DEFAULT 0,
      performed_by   text,
      performed_at   timestamptz NOT NULL DEFAULT now(),
      batch_id       uuid
    )`);
  // Self-heal installs created before batch_id existed (e.g. production).
  await sql(`ALTER TABLE station_rename_log ADD COLUMN IF NOT EXISTS batch_id uuid`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_station_rename_log_ngo_time ON station_rename_log(ngo_id, performed_at DESC)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_station_rename_log_old_station ON station_rename_log(old_station)`);
  await sql(`CREATE INDEX IF NOT EXISTS idx_station_rename_log_batch ON station_rename_log(batch_id)`);
  _renameLogTableReady = true;
}

// Per-table affected-row counts for all valid rows in one query each, via
// unnest arrays: (ord, ngo_id, old_station).
async function countRenameImpact(okRows) {
  if (okRows.length === 0) return new Map();
  const ords = okRows.map((_, i) => i);
  const ngoIds = okRows.map(r => r.ngo_id);
  const olds = okRows.map(r => r.old_station);
  const params = [ords, ngoIds, olds];
  // ngo_id columns are NOT uniform across these tables (some uuid, some text —
  // they predate the tracked migrations), so compare as text everywhere.
  const unnest = 'unnest($1::int[], $2::text[], $3::text[]) AS t(ord, ngo_id, station)';

  const [reg, assign, transfer, queue, sessions] = await Promise.all([
    sql(`SELECT t.ord, COUNT(x.id)::int AS cnt FROM ${unnest}
         LEFT JOIN fro_station_assignments x ON x.ngo_id::text = t.ngo_id AND x.station = t.station
         GROUP BY t.ord`, params),
    sql(`SELECT t.ord, COUNT(x.id)::int AS cnt FROM ${unnest}
         LEFT JOIN fro_assignments x ON x.ngo_id::text = t.ngo_id AND x.station = t.station
         GROUP BY t.ord`, params),
    sql(`SELECT t.ord, COUNT(x.id)::int AS cnt FROM ${unnest}
         LEFT JOIN fro_transfers x ON x.ngo_id::text = t.ngo_id AND (x.station = t.station OR x.target_station = t.station)
         GROUP BY t.ord`, params),
    sql(`SELECT t.ord, COUNT(x.id)::int AS cnt FROM ${unnest}
         LEFT JOIN work_queue x ON x.ngo_id::text = t.ngo_id AND x.station = t.station
         GROUP BY t.ord`, params),
    sql(`SELECT t.ord, COUNT(x.id)::int AS cnt FROM ${unnest}
         LEFT JOIN work_as_sessions x
           ON x.stations @> jsonb_build_array(jsonb_build_object('ngo_id', t.ngo_id, 'station', t.station))
         GROUP BY t.ord`, params),
  ]);

  const byOrd = (list) => {
    const m = new Map();
    for (const r of list) m.set(r.ord, r.cnt);
    return m;
  };
  const regM = byOrd(reg), assignM = byOrd(assign), transferM = byOrd(transfer);
  const queueM = byOrd(queue), sessM = byOrd(sessions);

  const counts = new Map();
  okRows.forEach((r, i) => {
    counts.set(i, {
      fro_station_assignments: regM.get(i) || 0,
      fro_assignments: assignM.get(i) || 0,
      fro_transfers: transferM.get(i) || 0,
      work_queue: queueM.get(i) || 0,
      work_as_sessions: sessM.get(i) || 0,
    });
  });
  return counts;
}

// Donor-profile classification per DISTINCT old station code, computed BEFORE
// the assignments are renamed (the NGO attribution comes from fro_assignments
// rows that still carry the old code). Returns:
//   Map<oldStation, [{ id, name, ngos: string[] | null }]>
async function classifyDonorProfiles(oldStations) {
  if (oldStations.length === 0) return new Map();
  const rows = await sql(
    `SELECT dp.id, dp.name, dp.station,
            (SELECT array_agg(DISTINCT fa.ngo_id::text)
               FROM fro_assignments fa
              WHERE fa.donor_id = dp.id AND fa.station = dp.station) AS ngos
       FROM donor_profiles dp
      WHERE dp.station = ANY($1::text[])`,
    [oldStations]
  );
  const byStation = new Map();
  for (const r of rows) {
    if (!byStation.has(r.station)) byStation.set(r.station, []);
    byStation.get(r.station).push({ id: r.id, name: r.name, ngos: r.ngos || null });
  }
  return byStation;
}

export const bulkRenameStations = async (req, res) => {
  try {
    const renames = Array.isArray(req.body?.renames) ? req.body.renames : null;
    const dryRun = req.body?.dry_run !== false;
    const confirmed = req.body?.confirm === true;

    if (!renames || renames.length === 0) {
      return res.status(400).json({ message: 'No renames provided' });
    }
    if (renames.length > 500) {
      return res.status(400).json({ message: 'Too many renames (max 500 per batch)' });
    }
    if (!dryRun && !confirmed) {
      return res.status(400).json({ message: 'Confirmation required: send confirm: true to apply' });
    }

    // ---- Normalize input -------------------------------------------------
    const rows = renames.map(r => ({
      ngo_name: String(r?.ngo_name ?? '').trim(),
      old_station: String(r?.old_station ?? '').trim(),
      new_station: String(r?.new_station ?? '').trim(),
    }));
    for (const r of rows) {
      if (!r.ngo_name || !r.old_station || !r.new_station) {
        return res.status(400).json({ message: 'Each rename needs ngo_name, old_station and new_station' });
      }
      if (r.old_station === r.new_station) {
        return res.status(400).json({ message: `old_station and new_station must differ (${r.old_station})` });
      }
    }

    // ---- Resolve NGO names -> ids ----------------------------------------
    const ngoNames = [...new Set(rows.map(r => r.ngo_name.toLowerCase()))];
    const ngoRows = await sql(`SELECT id, name FROM ngos WHERE lower(name) = ANY($1::text[])`, [ngoNames]);
    const ngoByName = new Map(ngoRows.map(n => [n.name.toLowerCase(), n]));
    const missing = ngoNames.filter(n => !ngoByName.has(n));
    if (missing.length > 0) {
      return res.status(400).json({ message: `Unknown NGO(s): ${missing.join(', ')}` });
    }

    // ---- Access: every NGO in the batch must be accessible to the caller --
    const isSuperAdmin = req.user?.role === 'super_admin';
    if (!isSuperAdmin) {
      const allowed = new Set((await getUserNgoIds(req.user)).map(String));
      for (const n of ngoNames) {
        if (!allowed.has(String(ngoByName.get(n).id))) {
          return res.status(403).json({ message: `Access denied for NGO ${ngoByName.get(n).name}` });
        }
      }
    }

    // ---- Validate against the live station registry -----------------------
    const involvedNgoIds = [...new Set(ngoRows.map(n => String(n.id)))];
    const registry = await sql(
      `SELECT ngo_id::text AS ngo_id, station FROM fro_station_assignments WHERE ngo_id::text = ANY($1::text[])`,
      [involvedNgoIds]
    );
    const registryKeys = new Set(registry.map(s => `${s.ngo_id}|${s.station}`));

    const results = rows.map(r => {
      const ngo = ngoByName.get(r.ngo_name.toLowerCase());
      return {
        ngo_name: ngo.name,
        ngo_id: ngo.id,
        old_station: r.old_station,
        new_station: r.new_station,
      };
    });

    // All (ngo, old) pairs in the batch — used to detect chained renames
    // (A -> B while B itself is being renamed), which are not allowed.
    const oldKeys = new Set(results.map(r => `${r.ngo_id}|${r.old_station}`));
    const seenOld = new Set();
    const seenNew = new Set();
    for (const r of results) {
      const oldKey = `${r.ngo_id}|${r.old_station}`;
      const newKey = `${r.ngo_id}|${r.new_station}`;
      r.status = 'ok';
      r.reason = null;
      if (!registryKeys.has(oldKey)) {
        r.status = 'old_not_found'; r.reason = `Station "${r.old_station}" is not registered for ${r.ngo_name}`;
      } else if (registryKeys.has(newKey)) {
        r.status = oldKeys.has(newKey) ? 'chain' : 'new_taken';
        r.reason = oldKeys.has(newKey)
          ? `"${r.new_station}" is itself being renamed — chained renames are not allowed`
          : `Station "${r.new_station}" already exists for ${r.ngo_name}`;
      } else if (seenOld.has(oldKey)) {
        r.status = 'duplicate'; r.reason = `Duplicate rename for ${r.ngo_name} ${r.old_station}`;
      } else if (seenNew.has(newKey)) {
        r.status = 'duplicate'; r.reason = `Duplicate target "${r.new_station}" for ${r.ngo_name}`;
      }
      if (r.status === 'ok') { seenOld.add(oldKey); seenNew.add(newKey); }
    }

    const okRows = results.filter(r => r.status === 'ok');
    const ready = okRows.length > 0 && results.every(r => r.status === 'ok');

    // ---- DRY RUN: counts only, no writes ----------------------------------
    if (dryRun) {
      const impact = await countRenameImpact(okRows);
      const oldStations = [...new Set(okRows.map(r => r.old_station))];
      const donorMap = await classifyDonorProfiles(oldStations);
      // Claim logic mirrors the apply path: a profile is renamable when it is
      // attributable to exactly one NGO that has a rename row for that code.
      // Donors owned by another NGO in the same batch (shared old codes, e.g.
      // M-2 for all three NGOs) are NOT ambiguous — that NGO's row renames them.
      const ngosByOld = new Map();
      for (const r of okRows) {
        if (!ngosByOld.has(r.old_station)) ngosByOld.set(r.old_station, new Set());
        ngosByOld.get(r.old_station).add(String(r.ngo_id));
      }
      okRows.forEach((r) => {
        const c = impact.get(results.indexOf(r)) || {};
        const donors = donorMap.get(r.old_station) || [];
        const batchNgos = ngosByOld.get(r.old_station) || new Set();
        const claimed = (d) => !!(d.ngos && d.ngos.length === 1 && batchNgos.has(d.ngos[0]));
        r.counts = {
          ...c,
          donor_profiles_renamable: donors.filter(d => claimed(d) && d.ngos[0] === String(r.ngo_id)).length,
          donor_profiles_ambiguous: donors.filter(d => !claimed(d)).length,
        };
      });
      return res.json({ dry_run: true, ready, rows: results });
    }

    if (okRows.length === 0) {
      return res.status(400).json({ message: 'No valid renames to apply — fix the flagged rows and retry' });
    }
    if (!ready) {
      return res.status(400).json({ message: 'Cannot apply while some renames are flagged — remove the flagged rows and retry' });
    }

    // ---- APPLY: one transaction, all-or-nothing ---------------------------
    const performedBy = String(req.user?.email || req.user?.id || 'unknown');
    const batchId = crypto.randomUUID();
    const summary = await db.transaction(async () => {
      await ensureStationRenameLogTable();

      const ngoIds = okRows.map(r => r.ngo_id);
      const olds = okRows.map(r => r.old_station);
      const news = okRows.map(r => r.new_station);
      const upd = [ngoIds, olds, news];
      const unnestUpd = 'unnest($1::text[], $2::text[], $3::text[]) AS t(ngo_id, old_station, new_station)';

      // Donor classification must run BEFORE assignments are renamed.
      const oldStations = [...new Set(olds)];
      const donorMap = await classifyDonorProfiles(oldStations);
      // ngoId|oldStation -> newStation, for the work_as_sessions rewrite.
      const renameByKey = new Map(okRows.map(r => [`${r.ngo_id}|${r.old_station}`, r.new_station]));
      // Which NGOs have a rename row for a given old station code.
      const ngosByOld = new Map();
      for (const r of okRows) {
        if (!ngosByOld.has(r.old_station)) ngosByOld.set(r.old_station, new Set());
        ngosByOld.get(r.old_station).add(String(r.ngo_id));
      }

      // (a) Station registry
      const regIds = await sql(
        `UPDATE fro_station_assignments x
            SET station = t.new_station
           FROM ${unnestUpd}
          WHERE x.ngo_id::text = t.ngo_id AND x.station = t.old_station
          RETURNING x.id`, upd);
      // (b) Donor assignments (also drives the FRO queue)
      const assignIds = await sql(
        `UPDATE fro_assignments x
            SET station = t.new_station
           FROM ${unnestUpd}
          WHERE x.ngo_id::text = t.ngo_id AND x.station = t.old_station
          RETURNING x.id`, upd);
      // (c) Transfer history — both columns, independently scoped
      const tFrom = await sql(
        `UPDATE fro_transfers x
            SET station = t.new_station
           FROM ${unnestUpd}
          WHERE x.ngo_id::text = t.ngo_id AND x.station = t.old_station
          RETURNING x.id`, upd);
      const tTo = await sql(
        `UPDATE fro_transfers x
            SET target_station = t.new_station
           FROM ${unnestUpd}
          WHERE x.ngo_id::text = t.ngo_id AND x.target_station = t.old_station
          RETURNING x.id`, upd);
      const transferIds = new Set([...tFrom.map(x => x.id), ...tTo.map(x => x.id)]);
      // (d) Work queue — station + the cycle_key station segment
      //     (cycle_key format: `${ngo|all}:${station|all}:${tab}:${month}`)
       const queueIds = await sql(
         `UPDATE work_queue x
             SET station = t.new_station,
                 cycle_key = replace(x.cycle_key, ':' || t.old_station || ':', ':' || t.new_station || ':')
            FROM ${unnestUpd}
          WHERE x.ngo_id::text = t.ngo_id AND x.station = t.old_station
          RETURNING x.id`, upd);
      // (e) Active work-as (acting FRO) sessions — rewrite the jsonb pairs
      const allSessions = await sql(`SELECT id, stations FROM work_as_sessions WHERE stations != '[]'::jsonb`);
      let sessionsUpdated = 0;
      for (const s of allSessions) {
        let changed = false;
        const pairs = (Array.isArray(s.stations) ? s.stations : []).map(p => {
          const key = `${String(p?.ngo_id ?? '')}|${String(p?.station ?? '').trim()}`;
          const target = renameByKey.get(key);
          if (target && target !== p.station) { changed = true; return { ...p, station: target }; }
          return p;
        });
        if (!changed) continue;
        await sql(`UPDATE work_as_sessions SET stations = $1::jsonb WHERE id = $2`, [JSON.stringify(pairs), s.id]);
        sessionsUpdated++;
      }
      // (f) Donor profiles — only where the NGO attribution is unambiguous
      const skippedDonors = [];
      for (const [station, donors] of donorMap) {
        for (const d of donors) {
          const batchNgos = ngosByOld.get(station) || new Set();
          if (d.ngos && d.ngos.length === 1 && batchNgos.has(d.ngos[0])) continue; // claimed by its NGO's row
          let reason;
          if (!d.ngos || d.ngos.length === 0) reason = 'no NGO assignment';
          else if (d.ngos.length > 1) reason = 'assignments under multiple NGOs';
          else reason = 'no rename row for its NGO';
          skippedDonors.push({ donor_id: d.id, name: d.name, station, reason });
        }
      }
      const donorUpdates = [];
      for (const r of okRows) {
        const donors = donorMap.get(r.old_station) || [];
        const mine = donors
          .filter(d => d.ngos && d.ngos.length === 1 && d.ngos[0] === String(r.ngo_id))
          .map(d => d.id);
        if (mine.length === 0) { donorUpdates.push({ ...r, updated_donors: 0 }); continue; }
        const updated = await sql(
          `UPDATE donor_profiles SET station = $1 WHERE id = ANY($2::int[]) RETURNING id`,
          [r.new_station, mine]
        );
        donorUpdates.push({ ...r, updated_donors: updated.length });
      }
      // (g) Audit log — one row per applied rename
      for (const r of okRows) {
        const donors = donorMap.get(r.old_station) || [];
        const ambiguousForRow = donors.filter(
          d => d.ngos && d.ngos.length > 1 && d.ngos.includes(String(r.ngo_id))
        ).length;
        const du = donorUpdates.find(u => u.ngo_id === r.ngo_id && u.old_station === r.old_station);
        const counts = {
          fro_station_assignments: regIds.length,
          fro_assignments: assignIds.length,
          fro_transfers: transferIds.size,
          work_queue: queueIds.length,
          work_as_sessions: sessionsUpdated,
          donor_profiles: du ? du.updated_donors : 0,
        };
        await sql(
          `INSERT INTO station_rename_log (ngo_id, ngo_name, old_station, new_station, counts, skipped_donors, performed_by, batch_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
          [r.ngo_id, r.ngo_name, r.old_station, r.new_station, JSON.stringify(counts), ambiguousForRow, performedBy, batchId]
        );
      }
      // NOTE: regIds/assignIds/queueIds lengths above are batch totals; the
      // audit rows repeat them per-row on purpose — each log entry records
      // the full batch impact for its (ngo, old -> new) mapping.

      // (h) Post-verify: scoped old codes must be gone from every table.
      //     Any leftover throws, which rolls the whole transaction back.
      const checkPairs = [ngoIds, olds];
      const unnestChk = 'unnest($1::text[], $2::text[]) AS t(ngo_id, station)';
      const checks = [
        ['fro_station_assignments', `SELECT COUNT(*)::int AS cnt FROM fro_station_assignments x JOIN ${unnestChk} ON x.ngo_id::text = t.ngo_id AND x.station = t.station`],
        ['fro_assignments', `SELECT COUNT(*)::int AS cnt FROM fro_assignments x JOIN ${unnestChk} ON x.ngo_id::text = t.ngo_id AND x.station = t.station`],
        ['fro_transfers.station', `SELECT COUNT(*)::int AS cnt FROM fro_transfers x JOIN ${unnestChk} ON x.ngo_id::text = t.ngo_id AND x.station = t.station`],
        ['fro_transfers.target_station', `SELECT COUNT(*)::int AS cnt FROM fro_transfers x JOIN ${unnestChk} ON x.ngo_id::text = t.ngo_id AND x.target_station = t.station`],
        ['work_queue', `SELECT COUNT(*)::int AS cnt FROM work_queue x JOIN ${unnestChk} ON x.ngo_id::text = t.ngo_id AND x.station = t.station`],
      ];
      for (const [label, query] of checks) {
        const [{ cnt }] = await sql(query, checkPairs);
        if (cnt > 0) throw new Error(`Post-verify failed: ${cnt} row(s) still carry an old code in ${label} — rolling back`);
      }
      // donor_profiles leftovers must be exactly the intentionally skipped ones
      const [{ cnt: profileLeft }] = await sql(
        `SELECT COUNT(*)::int AS cnt FROM donor_profiles WHERE station = ANY($1::text[])`, [oldStations]
      );
      if (profileLeft !== skippedDonors.length) {
        throw new Error(`Post-verify failed: ${profileLeft} donor profile(s) still carry an old code, expected ${skippedDonors.length} — rolling back`);
      }
      // Informational: rows with a NULL ngo_id keep old codes (pre-existing
      // orphans / all-station queue cycles); the queue rebuilds these itself.
      const [unscoped] = await sql(
        `SELECT
           (SELECT COUNT(*)::int FROM fro_assignments WHERE ngo_id IS NULL AND station = ANY($1::text[])) AS assignments,
           (SELECT COUNT(*)::int FROM fro_transfers WHERE ngo_id IS NULL AND (station = ANY($1::text[]) OR target_station = ANY($1::text[]))) AS transfers,
           (SELECT COUNT(*)::int FROM work_queue WHERE ngo_id IS NULL AND station = ANY($1::text[])) AS queue`,
        [oldStations]
      );

      return {
        applied: okRows.length,
        batch_id: batchId,
        rows: donorUpdates,
        totals: {
          fro_station_assignments: regIds.length,
          fro_assignments: assignIds.length,
          fro_transfers: transferIds.size,
          work_queue: queueIds.length,
          work_as_sessions: sessionsUpdated,
        },
        skipped_donors: skippedDonors,
        post_verify: { old_codes_remaining: 0, unscoped_old_rows: unscoped },
      };
    });

    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Rename history for the bulk-rename revert UI: the last 20 applied batches,
// grouped by batch_id (rows logged before batch_id existed fall back to
// single-entry groups). Scoped to the caller's NGO access.
export const getStationRenameLog = async (req, res) => {
  try {
    await ensureStationRenameLogTable();

    const isSuperAdmin = req.user?.role === 'super_admin';
    let scopeSql = '';
    let params = [];
    if (!isSuperAdmin) {
      const allowed = (await getUserNgoIds(req.user)).map(String);
      if (allowed.length === 0) return res.json([]);
      scopeSql = 'WHERE ngo_id::text = ANY($1::text[])';
      params = [allowed];
    }

    const batches = await sql(
      `SELECT COALESCE(batch_id::text, 'legacy-' || id::text) AS batch_id,
              max(performed_at) AS performed_at,
              max(performed_by) AS performed_by,
              json_agg(json_build_object('ngo_name', ngo_name, 'old_station', old_station, 'new_station', new_station) ORDER BY id) AS entries,
              sum((counts->>'fro_assignments')::int)::int AS donor_assignments,
              sum(skipped_donors)::int AS skipped_donors
         FROM station_rename_log
         ${scopeSql}
        GROUP BY 1
        ORDER BY max(performed_at) DESC
        LIMIT 20`,
      params
    );
    return res.json(batches);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

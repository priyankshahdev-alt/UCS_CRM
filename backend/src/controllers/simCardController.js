import {
  createSimCard,
  getAllSimCards,
  getSimCardById,
  updateSimCard,
  deleteSimCard,
  createReplacement,
  getAllReplacements,
  getReplacementsBySimCard,
  deleteReplacementsBySimCard,
  bulkInsertSimCards,
  createSimCardHistory,
  getSimCardHistory,
} from '../models/simCardModel.js';

export const SIM_STATUSES = ['Active', 'Expiring Soon', 'Expired', 'Replaced', 'Inactive'];

export const requiredFields = [
  'mobile_id',
];

const alwaysPresentFields = [
  'mobile_id', 'device_model', 'imei', 'team', 'signature', 'ngo', 'sim_type', 'gb',
  'sim_1', 'sim_2', 'sim_3', 'sim_4', 'sim_5', 'sim_6', 'sim_7', 'sim_8',
  'sim_9', 'sim_10', 'sim_11', 'sim_12', 'sim_13', 'sim_14', 'sim_15', 'sim_16', 'sim_17', 'sim_18', 'sim_19', 'sim_20',
];

function clean(data) {
  const c = { ...data };
  delete c.id;
  delete c.created_at;
  delete c.updated_at;
  alwaysPresentFields.forEach((k) => {
    if (c[k] === undefined || c[k] === null) c[k] = '';
    if (c[k] === '') c[k] = null;
  });
  ['issue_date', 'expiry_date'].forEach((k) => {
    if (c[k] === undefined || c[k] === null) c[k] = null;
    if (c[k] === '') c[k] = null;
  });
  if (c.replacement_count === undefined || c.replacement_count === null || c.replacement_count === '') {
    c.replacement_count = 0;
  }
  if (c.replacement_count) c.replacement_count = Number(c.replacement_count) || 0;
  return c;
}

export function computeExpiry(expiryDate, today = new Date()) {
  if (!expiryDate) {
    return { daysLeft: null, dcStatus: 'Inactive' };
  }
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const end = new Date(`${expiryDate}T00:00:00`).getTime();
  const days = Math.round((end - start) / 86400000);
  if (days > 30) return { daysLeft: days, dcStatus: 'Active' };
  if (days >= 8) return { daysLeft: days, dcStatus: 'Expiring Soon' };
  if (days >= 1) return { daysLeft: days, dcStatus: 'Expiring Soon' };
  return { daysLeft: days, dcStatus: 'Expired' };
}

function finalStatus(card, expiry) {
  const base = (card.status || 'Active').trim();
  if (base === 'Replaced') return 'Replaced';
  if (base === 'Inactive') return 'Inactive';
  return expiry.dcStatus;
}

export const addSimCard = async (req, res) => {
  try {
    const body = clean(req.body);
    if (requiredFields.some((f) => !body[f] || !String(body[f]).trim())) {
      return res.status(400).json({ message: 'Required fields are missing' });
    }
    const { daysLeft, dcStatus } = computeExpiry(body.expiry_date);
    body.status = finalStatus({ status: body.status || 'Active' }, { daysLeft, dcStatus });
    body.replacement_count = Number(body.replacement_count) || 0;
    body.created_by = req.user?.login_id || req.user?.id || req.user?.name || null;
    if (body.status === 'Inactive' && body.expiry_date && !body.status) body.status = 'Inactive';
    const sim = await createSimCard(body);
    return res.status(201).json({ message: 'SIM card added', sim, daysLeft });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const listSimCards = async (req, res) => {
  try {
    const cards = await getAllSimCards();
    const now = new Date();
    const withMeta = cards.map((c) => {
      const storedDaysLeft = c.days_left !== null && c.days_left !== undefined ? c.days_left : null;
      const { daysLeft, dcStatus } = computeExpiry(c.expiry_date, now);
      const status = finalStatus(c, { daysLeft, dcStatus });
      return { ...c, days_left: storedDaysLeft !== null ? storedDaysLeft : daysLeft, derived_status: status };
    });
    return res.json(withMeta);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getSimCard = async (req, res) => {
  try {
    const sim = await getSimCardById(req.params.id);
    if (!sim) return res.status(404).json({ message: 'SIM card not found' });
    const storedDaysLeft = sim.days_left !== null && sim.days_left !== undefined ? sim.days_left : null;
    const { daysLeft } = computeExpiry(sim.expiry_date);
    return res.json({ ...sim, days_left: storedDaysLeft !== null ? storedDaysLeft : daysLeft });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const patchSimCard = (body) => {
  const patch = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (k === 'id' || k === 'created_at' || k === 'updated_at') continue;
    if (v === '' || v === null || v === undefined) continue;
    patch[k] = v;
  }
  return patch;
};

export const editSimCard = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.mobile_id || !String(body.mobile_id).trim()) {
      return res.status(400).json({ message: 'Mobile ID No. is required' });
    }
    const writable = {};
    const nonNullableText = ['mobile_id', 'device_model', 'imei', 'team', 'signature', 'ngo'];
    for (const [k, v] of Object.entries(body || {})) {
      if (k === 'id' || k === 'created_at' || k === 'updated_at') continue;
      if (nonNullableText.includes(k)) {
        writable[k] = v === null || v === undefined ? null : String(v);
        if (writable[k] === '') writable[k] = null;
        continue;
      }
      if (v === undefined) continue;
      writable[k] = v === '' || v === null ? null : v;
    }
    const patch = writable;

    let daysLeft = null;
    if ('expiry_date' in patch) {
      const computed = computeExpiry(patch.expiry_date);
      daysLeft = computed.daysLeft;
      if (patch.status === null || patch.status === undefined) {
        patch.status = finalStatus({ status: 'Active' }, computed);
      } else {
        patch.status = finalStatus({ status: patch.status }, computed);
      }
    }
    const beforeSim = await getSimCardById(req.params.id);
    if (!beforeSim) {
      return res.status(404).json({ message: 'SIM card not found' });
    }
    const changedCols = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'updated_at') continue;
      const prev = beforeSim[k] ?? null;
      const newVal = v ?? null;
      if (String(prev) !== String(newVal)) {
        changedCols[k] = { old: prev, new: newVal };
      }
    }
    const sim = await updateSimCard(req.params.id, patch);
    if (Object.keys(changedCols).length > 0) {
      const changedBy = req.user?.login_id || req.user?.name || req.user?.id || null;
      try {
        await createSimCardHistory({
          sim_card_id: beforeSim.id,
          changed_by: changedBy,
          changed_cols: changedCols,
          before_data: beforeSim,
          after_data: { ...beforeSim, ...patch },
        });
      } catch (e) {
        // history write failure should not block the update
      }
    }
    return res.json({ message: 'SIM card updated', sim, daysLeft });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const historyForSim = async (req, res) => {
  try {
    const history = await getSimCardHistory(req.params.id);
    return res.json(history);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const removeSimCard = async (req, res) => {
  try {
    await deleteReplacementsBySimCard(req.params.id);
    await deleteSimCard(req.params.id);
    return res.json({ message: 'SIM card deleted' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const replaceSimCard = async (req, res) => {
  try {
    const sim = await getSimCardById(req.params.id);
    if (!sim) return res.status(404).json({ message: 'SIM card not found' });
    const { new_sim, replacement_date, reason, new_expiry_date } = req.body;
    if (!new_sim || !String(new_sim).trim()) {
      return res.status(400).json({ message: 'New SIM number is required' });
    }
    const oldSim = sim.sim_1 || sim.mobile_id || '';
    const rep = await createReplacement({
      sim_card_id: sim.id,
      replacement_date: replacement_date || new Date().toISOString().slice(0, 10),
      old_sim: oldSim,
      new_sim: String(new_sim).trim(),
      device: sim.device_model || null,
      reason: reason || '',
      new_expiry_date: new_expiry_date || sim.expiry_date,
      changed_by: req.user?.login_id || req.user?.name || req.user?.id || null,
    });
    const nextCount = (Number(sim.replacement_count) || 0) + 1;
    const updates = {
      sim_1: String(new_sim).trim(),
      replacement_count: nextCount,
      status: 'Active',
    };
    if (new_expiry_date) updates.expiry_date = new_expiry_date;
    const updated = await updateSimCard(sim.id, { ...updates, expiry_date: new_expiry_date || sim.expiry_date });
    const { daysLeft } = computeExpiry(updates.expiry_date);
    return res.status(200).json({ message: 'SIM card replaced', sim: updated, replacement: rep, daysLeft });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const listReplacements = async (req, res) => {
  try {
    const reps = await getAllReplacements();
    return res.json(reps);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const replaceHistoryForSim = async (req, res) => {
  try {
    const reps = await getReplacementsBySimCard(req.params.id);
    return res.json(reps);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateStatusBulk = async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No SIM cards selected' });
    }
    if (!SIM_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    let updated = 0;
    for (const id of ids) {
      await updateSimCard(id, { status });
      updated += 1;
    }
    return res.json({ message: `${ids.length} SIM card(s) updated`, updated });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const deleteBulk = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No SIM cards selected' });
    }
    for (const id of ids) {
      await deleteReplacementsBySimCard(id);
      await deleteSimCard(id);
    }
    return res.json({ message: `${ids.length} SIM card(s) deleted` });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const importSimCards = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'No rows to import' });
    }
    const valid = [];
    const invalid = [];
    const usedMobile = new Set();
    for (const raw of rows) {
      const row = clean(raw);
      const missing = requiredFields.filter((f) => !row[f] || !String(row[f]).trim());
      const dup = row.mobile_id ? usedMobile.has(String(row.mobile_id).trim()) : false;
      if (dup) usedMobile.add(String(row.mobile_id).trim());
      if (missing.length > 0 || dup) {
        invalid.push({ row, reason: missing.length ? `Missing: ${missing.join(', ')}` : 'Duplicate Mobile ID' });
        continue;
      }
      if (row.mobile_id) usedMobile.add(String(row.mobile_id).trim());
      const { daysLeft, dcStatus } = computeExpiry(row.expiry_date);
      row.status = row.status && SIM_STATUSES.includes(row.status) ? row.status : (row.status || 'Active');
      row.status = finalStatus({ status: row.status }, { daysLeft, dcStatus });
      row.replacement_count = Number(row.replacement_count) || 0;
      row.created_by = req.user?.login_id || req.user?.name || null;
      valid.push(row);
    }
    const inserted = valid.length ? await bulkInsertSimCards(valid) : [];
    return res.status(201).json({
      message: `Imported ${inserted.length} SIM card(s)`,
      valid: inserted.length,
      invalid: invalid.length,
      invalidRows: invalid,
      inserted: (inserted || []).map((r) => r.id).filter(Boolean),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

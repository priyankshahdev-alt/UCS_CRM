import {
  getSettings,
  updateSettings,
} from '../models/incentiveSettingsModel.js';
import {
  getAllSlabs,
  createSlab,
  updateSlab,
  deleteSlab,
} from '../models/incentiveSlabModel.js';
import {
  getDailySummary,
  getFroDetail,
  getCurrentChampion,
  announceChampion,
} from '../services/leadIncentiveService.js';

// ─── Settings ──────────────────────────────────────────────

export async function getSettingsHandler(req, res) {
  try {
    const settings = await getSettings();
    return res.json(settings);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function updateSettingsHandler(req, res) {
  try {
    const { lead_rate, min_lead_amount, champion_bonus } = req.body || {};
    const updated = await updateSettings({ lead_rate, min_lead_amount, champion_bonus });
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// ─── Slabs CRUD ────────────────────────────────────────────

export async function listSlabsHandler(req, res) {
  try {
    const slabs = await getAllSlabs();
    return res.json(slabs);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function createSlabHandler(req, res) {
  try {
    const { min_amount, max_amount, incentive_amount } = req.body || {};
    if (min_amount === undefined || max_amount === undefined) {
      return res.status(400).json({ message: 'min_amount and max_amount are required' });
    }
    if (Number(min_amount) >= Number(max_amount)) {
      return res.status(400).json({ message: 'min_amount must be less than max_amount' });
    }

    // Check for overlapping slabs
    const existing = await getAllSlabs();
    const overlap = existing.find(s =>
      s.is_active &&
      Number(min_amount) < Number(s.max_amount) &&
      Number(max_amount) > Number(s.min_amount)
    );
    if (overlap) {
      return res.status(400).json({
        message: `Overlap with existing slab ₹${Number(overlap.min_amount).toLocaleString('en-IN')} – ₹${Number(overlap.max_amount).toLocaleString('en-IN')}`,
      });
    }

    const slab = await createSlab({
      min_amount: Number(min_amount),
      max_amount: Number(max_amount),
      incentive_amount: Number(incentive_amount) || 0,
    });
    return res.status(201).json(slab);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function updateSlabHandler(req, res) {
  try {
    const { min_amount, max_amount, incentive_amount } = req.body || {};
    if (min_amount === undefined || max_amount === undefined) {
      return res.status(400).json({ message: 'min_amount and max_amount are required' });
    }
    if (Number(min_amount) >= Number(max_amount)) {
      return res.status(400).json({ message: 'min_amount must be less than max_amount' });
    }

    // Check overlap excluding self
    const existing = await getAllSlabs();
    const overlap = existing.find(s =>
      s.is_active &&
      s.id !== req.params.id &&
      Number(min_amount) < Number(s.max_amount) &&
      Number(max_amount) > Number(s.min_amount)
    );
    if (overlap) {
      return res.status(400).json({
        message: `Overlap with existing slab ₹${Number(overlap.min_amount).toLocaleString('en-IN')} – ₹${Number(overlap.max_amount).toLocaleString('en-IN')}`,
      });
    }

    const slab = await updateSlab(req.params.id, {
      min_amount: Number(min_amount),
      max_amount: Number(max_amount),
      incentive_amount: Number(incentive_amount) || 0,
    });
    if (!slab) return res.status(404).json({ message: 'Slab not found' });
    return res.json(slab);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function deleteSlabHandler(req, res) {
  try {
    const slab = await deleteSlab(req.params.id);
    if (!slab) return res.status(404).json({ message: 'Slab not found' });
    return res.json({ ok: true, id: slab.id });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// ─── Lead Summary ──────────────────────────────────────────

export async function dailySummaryHandler(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const summary = await getDailySummary(date);
    return res.json(summary);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function froDetailHandler(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const detail = await getFroDetail(req.params.id, date);
    if (!detail) return res.status(404).json({ message: 'FRO not found' });
    return res.json(detail);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// Get the current/announced champion (FRO-facing, any role).
export async function currentChampionHandler(req, res) {
  try {
    const date = req.query.date || null;
    const champion = await getCurrentChampion(date);
    return res.json({ announcement: champion });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// Admin declares today's champion. Locks snapshot + notifies all panels.
export async function announceChampionHandler(req, res) {
  try {
    const { date, message } = req.body || {};
    const result = await announceChampion({ date, message, userId: req.user?.id });
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    return res.status(201).json(result);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

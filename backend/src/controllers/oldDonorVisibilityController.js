// ─── Hide Old Donors (admin switch) ──────────────────────────────────────────
//
// GET  /api/ngo-admin/hide-old-donors            → { hidden, auto }
// PUT  /api/ngo-admin/hide-old-donors            → body { hidden: boolean } → { hidden }
// PUT  /api/ngo-admin/hide-old-donors/schedule   → body { enabled, hideAt, showAt } → { ...schedule }
//
// One global switch that hides every OLD-station donor from the field teams.
// Enforcement lives in the FRO read paths (see services/oldDonorVisibility.js
// and the scope filter in controllers/froController.js); this controller only
// owns the on/off state, the optional daily time window
// (services/oldDonorAutoSchedule.js) and the cache invalidation that goes with
// a flip.

import {
  isOldDonorsHidden,
  setOldDonorsHidden,
  bustFroCaches,
} from '../services/oldDonorVisibility.js';
import {
  saveAutoSchedule,
  isScheduleUsable,
  getNextChange,
  getAutoScheduleStatus,
} from '../services/oldDonorAutoSchedule.js';

// Kept as a named export so older imports keep working.
export const getHideOldDonors = async (req, res) => {
  try {
    const auto = await getAutoScheduleStatus();
    return res.json({ hidden: auto.hidden, auto });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const setHideOldDonors = async (req, res) => {
  try {
    const body = req.body || {};
    // Accept `hidden`, `value` or `hide_old_donors` so the client does not
    // have to care about the field name.
    const raw = body.hidden ?? body.value ?? body.hide_old_donors;
    const hidden = raw === true || raw === 'true' || raw === 1 || raw === '1';
    await setOldDonorsHidden(hidden);
    bustFroCaches();
    return res.json({
      hidden,
      message: hidden
        ? 'Old-station donors are now hidden from the field teams. They can only work on the new (FD) stations.'
        : 'Old-station donors are visible again to the field teams.',
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── Daily time window ───────────────────────────────────────────────────────
// { enabled, hideAt: 'HH:MM', showAt: 'HH:MM', lastWindow, usable, insideWindow }
export const getHideOldDonorsSchedule = async (req, res) => {
  try {
    return res.json(await getAutoScheduleStatus());
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const setHideOldDonorsSchedule = async (req, res) => {
  try {
    const body = req.body || {};
    const saved = await saveAutoSchedule({
      enabled: body.enabled,
      hideAt: body.hideAt ?? body.hide_at,
      showAt: body.showAt ?? body.show_at,
    });

    // Deliberately NO immediate flip here: saving a schedule only schedules it.
    // Flipping on save is what made "hide at 14:00" hide donors at 13:37.
    const hidden = await isOldDonorsHidden();
    const usable = isScheduleUsable(saved);
    const next = getNextChange(saved);

    return res.json({
      ...saved,
      usable,
      hidden,
      nextChange: next,
      message: usable
        ? `Auto-hide set — next change: ${next?.when === 'tomorrow' ? 'kal' : 'aaj'} ${next?.at} IST pe ${next?.action === 'hide' ? 'hide' : 'show'}.`
        : 'Auto-hide is OFF — the Hide Old Donors button is manual again.',
    });
  } catch (error) {
    const status = /HH:MM|same/i.test(error.message) ? 400 : 500;
    return res.status(status).json({ message: error.message });
  }
};

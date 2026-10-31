// ─── Hide Old Donors: automatic time window ──────────────────────────────────
// The admin switch in services/oldDonorVisibility.js is manual. This service
// adds the optional schedule on top of it: every day at `hideAt` the switch is
// turned ON, and every day at `showAt` it is turned OFF again — both in IST.
//
// Boundaries win, the manual button still works in between.
// The scheduler only acts when the window membership CHANGES (it remembers the
// last window it applied in `lastWindow`). That is what makes a manual flip
// survive until the next boundary instead of being reverted on the next
// one-minute tick: flipping the button by hand does not touch `lastWindow`, so
// the next scheduled transition re-asserts the schedule and nothing before it
// does.
//
// Config lives in the `settings` table as one JSON row so the whole schedule is
// read/written atomically - same table as the switch itself, no schema change.
//
// Robustness: the schedule is cached in memory so the per-minute cron never
// blocks on the DB (a down/slow DB would otherwise make node-cron skip ticks).
// DB calls are wrapped in a short timeout and fail open. A boot-time reconcile
// re-syncs the switch after a restart.

import cron from 'node-cron';
import { getSetting, upsertSetting } from '../models/settingsModel.js';
import { makeNonOverlap } from '../utils/noOverlap.js';
import {
  isOldDonorsHidden,
  setOldDonorsHidden,
  bustFroCaches,
} from './oldDonorVisibility.js';

export const AUTO_SCHEDULE_KEY = 'hide_old_donors_auto';

const DEFAULT_HIDE_AT = '10:00';
const DEFAULT_SHOW_AT = '19:00';
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Cap every DB call the scheduler makes so a slow/down DB can never block the
// event loop (which is what made node-cron skip ticks before).
const DB_TIMEOUT_MS = 3000;

const cronJobs = [];
let running = false;

// In-memory cache of the schedule so the per-minute tick never hits the DB.
let cachedConfig = null;
let cacheLoaded = false;

// IST is UTC+5:30 with no DST, so shifting the clock and reading the UTC fields
// is exact — the same trick froAutoLogoutScheduler.js uses.
const istNow = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000);

const istMinutesOfDay = (d = istNow()) => d.getUTCHours() * 60 + d.getUTCMinutes();

const isValidHHMM = (v) => typeof v === 'string' && HHMM_RE.test(v.trim());

const toMinutes = (hhmm) => {
  if (!isValidHHMM(hhmm)) return null;
  const [h, m] = hhmm.trim().split(':').map(Number);
  return h * 60 + m;
};

const defaultConfig = () => ({
  enabled: false,
  hideAt: DEFAULT_HIDE_AT,
  showAt: DEFAULT_SHOW_AT,
  // Which window the scheduler last applied: true = "hidden" window,
  // false = "visible" window, null = never applied (force a reconcile).
  lastWindow: null,
});

const parseStored = (raw) => {
  if (!raw) return defaultConfig();
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return defaultConfig();
    }
  }
  if (!obj || typeof obj !== 'object') return defaultConfig();
  const cfg = defaultConfig();
  if (obj.enabled === true || obj.enabled === 'true' || obj.enabled === 1 || obj.enabled === '1') cfg.enabled = true;
  if (isValidHHMM(obj.hideAt)) cfg.hideAt = obj.hideAt.trim();
  if (isValidHHMM(obj.showAt)) cfg.showAt = obj.showAt.trim();
  if (obj.lastWindow === true) cfg.lastWindow = true;
  else if (obj.lastWindow === false) cfg.lastWindow = false;
  else cfg.lastWindow = null;
  return cfg;
};

const withTimeout = (promise, ms = DB_TIMEOUT_MS) =>
  Promise.race([
    Promise.resolve(promise),
    new Promise((_, rej) => setTimeout(() => rej(new Error('db-timeout')), ms)),
  ]);

/**
 * The window is invalid when both times are identical — it would never
 * transition, so treat it as "no schedule".
 */
export const isScheduleUsable = (cfg) =>
  !!cfg && cfg.enabled === true && toMinutes(cfg.hideAt) !== toMinutes(cfg.showAt);

/**
 * Is `nowMinutes` (IST minutes past midnight) inside the hide window?
 * Handles the overnight case (hideAt > showAt) where the window wraps
 * past midnight.
 */
export const isInHideWindow = (nowMinutes, hideAt, showAt) => {
  const hide = toMinutes(hideAt);
  const show = toMinutes(showAt);
  if (hide == null || show == null || hide === show) return false;
  if (hide < show) return nowMinutes >= hide && nowMinutes < show;
  // Wraps midnight: 20:00 → 08:00 hides from 20:00 to 23:59 and 00:00 to 07:59.
  return nowMinutes >= hide || nowMinutes < show;
};

const loadConfig = async () => {
  try {
    const raw = await withTimeout(getSetting(AUTO_SCHEDULE_KEY));
    const cfg = parseStored(raw);
    cachedConfig = cfg;
    cacheLoaded = true;
    return cfg;
  } catch (e) {
    console.warn('[hide-old-donors] auto schedule read failed, using cached/default:', e?.message || String(e));
    if (!cachedConfig) cachedConfig = defaultConfig();
    cacheLoaded = true;
    return cachedConfig;
  }
};

export const getAutoSchedule = async () => {
  if (cacheLoaded && cachedConfig) return cachedConfig;
  return loadConfig();
};

/**
 * Persist a partial config. The current window membership is recorded as
 * `lastWindow` so the per-minute tick does NOT treat the save itself as a
 * transition: saving a schedule must never flip the switch now, only at the
 * next real boundary (e.g. "hide at 14:00" hides at 14:00, not at 13:37).
 */
export const saveAutoSchedule = async (patch = {}) => {
  const current = await getAutoSchedule();
  const next = { ...current };

  if (patch.enabled !== undefined) {
    next.enabled = patch.enabled === true || patch.enabled === 'true' || patch.enabled === 1 || patch.enabled === '1';
  }
  if (patch.hideAt !== undefined) {
    if (!isValidHHMM(patch.hideAt)) throw new Error('hideAt must be a valid HH:MM time');
    next.hideAt = String(patch.hideAt).trim();
  }
  if (patch.showAt !== undefined) {
    if (!isValidHHMM(patch.showAt)) throw new Error('showAt must be a valid HH:MM time');
    next.showAt = String(patch.showAt).trim();
  }
  if (next.enabled && toMinutes(next.hideAt) === toMinutes(next.showAt)) {
    throw new Error('Hide time and show time cannot be the same');
  }

  next.lastWindow = isScheduleUsable(next)
    ? isInHideWindow(istMinutesOfDay(), next.hideAt, next.showAt)
    : null;

  // DB write is best-effort + time-boxed: a slow/down DB must not block the
  // save or the response. The in-memory cache is updated either way so the UI
  // keeps working and the cron keeps ticking.
  try {
    await withTimeout(upsertSetting(AUTO_SCHEDULE_KEY, JSON.stringify(next)));
  } catch (e) {
    console.warn('[hide-old-donors] auto schedule write failed (cache updated):', e?.message || String(e));
  }
  cachedConfig = next;
  cacheLoaded = true;
  return next;
};

/**
 * When is the next automatic flip, relative to `nowMs`? Used by the admin UI
 * so "save" can honestly say "agla change: aaj 14:00 pe" instead of appearing
 * to do nothing.
 */
export const getNextChange = (cfg, nowMs = Date.now()) => {
  if (!isScheduleUsable(cfg)) return null;
  const now = istMinutesOfDay(new Date(nowMs + 5.5 * 60 * 60 * 1000));
  const hide = toMinutes(cfg.hideAt);
  const show = toMinutes(cfg.showAt);

  const untilHide = (hide - now + 1440) % 1440 || 1440;
  const untilShow = (show - now + 1440) % 1440 || 1440;
  const isHide = untilHide <= untilShow;
  const inMinutes = isHide ? untilHide : untilShow;
  return {
    action: isHide ? 'hide' : 'show',
    at: isHide ? cfg.hideAt : cfg.showAt,
    inMinutes,
    when: inMinutes < 1440 ? 'today' : 'tomorrow',
  };
};

/**
 * Reconcile the switch with the schedule. Applies only when the window
 * membership differs from the last one applied (or when `force` is set, which
 * the "save schedule" path uses).
 *
 * Returns a small report instead of throwing — a scheduler that dies on one bad
 * row would never come back. Reads come from the in-memory cache, so a down DB
 * never blocks the per-minute tick.
 */
export async function runOldDonorAutoSchedule({ force = false, nowMs = Date.now() } = {}) {
  const cfg = await getAutoSchedule();
  if (!isScheduleUsable(cfg)) return { applied: false, reason: 'schedule-disabled', config: cfg };

  const nowMinutes = istMinutesOfDay(new Date(nowMs + 5.5 * 60 * 60 * 1000));
  const desired = isInHideWindow(nowMinutes, cfg.hideAt, cfg.showAt);

  if (!force && cfg.lastWindow === desired) {
    return { applied: false, reason: 'no-transition', hidden: desired, config: cfg };
  }

  // Flip the switch (time-boxed so a down DB can't stall the tick).
  try {
    await withTimeout(setOldDonorsHidden(desired), DB_TIMEOUT_MS);
  } catch (e) {
    console.warn('[hide-old-donors] switch flip failed:', e?.message || String(e));
    return { applied: false, reason: 'db-error', hidden: desired, config: cfg };
  }
  bustFroCaches();
  // lastWindow is written after the switch so a crash between the two makes the
  // next tick retry the same transition rather than silently skipping it.
  const updated = { ...cfg, lastWindow: desired };
  cachedConfig = updated;
  cacheLoaded = true;
  try {
    await withTimeout(upsertSetting(AUTO_SCHEDULE_KEY, JSON.stringify(updated)), DB_TIMEOUT_MS);
  } catch (e) {
    console.warn('[hide-old-donors] lastWindow write failed:', e?.message || String(e));
  }

  console.log(`[hide-old-donors] auto schedule → ${desired ? 'HIDDEN' : 'VISIBLE'} (hide ${cfg.hideAt} / show ${cfg.showAt} IST)`);
  return { applied: true, hidden: desired, config: updated };
}

/**
 * Current state for the admin UI: the stored config plus what the switch
 * actually is right now, so the panel can say "auto hid them at 10:00".
 */
export async function getAutoScheduleStatus() {
  const cfg = await getAutoSchedule();
  let hidden = false;
  try {
    hidden = await withTimeout(isOldDonorsHidden(), DB_TIMEOUT_MS);
  } catch {
    hidden = false;
  }
  return {
    ...cfg,
    usable: isScheduleUsable(cfg),
    hidden,
    // True when the switch is ON because the window says so rather than
    // because an admin pressed the button outside a window.
    insideWindow: isScheduleUsable(cfg)
      ? isInHideWindow(istMinutesOfDay(), cfg.hideAt, cfg.showAt)
      : false,
    nextChange: getNextChange(cfg),
  };
}

function start() {
  if (running) return;
  running = true;
  const runNoOverlap = makeNonOverlap('hide old donors auto schedule', runOldDonorAutoSchedule);
  // Every minute: a boundary is at most 60s late, and the run is a couple of
  // settings reads unless a transition is actually due.
  // recoverMissedExecutions re-runs a tick that was skipped (e.g. the process
  // was busy/suspended) so a boundary is never silently lost.
  cronJobs.push(cron.schedule('* * * * *', () => runNoOverlap().catch(() => {}), { recoverMissedExecutions: true }));
  console.log('Scheduled: per-minute hide-old-donors window check');
}

function stop() {
  for (const job of cronJobs) job.stop();
  cronJobs.length = 0;
  running = false;
  console.log('Hide-old-donors auto schedule stopped');
}

start();

export { start, stop };

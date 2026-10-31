// ─── Hide Old Donors ──────────────────────────────────────────────────────────
// One global admin switch (NGO admin -> Station Management) that hides every
// OLD-station donor from the field teams.
//
// When it is ON the FROs are narrowed to the FRESH (FD-*) stations only, so the
// old station's donors, their follow-ups, their scheduled calls, their
// callbacks, their promises and their history all disappear from the FRO
// panel at once. When it is OFF everything comes back exactly as it was.
//
// The state lives in the `settings` key/value table - the same place the
// incentive rules live (see controllers/akiSettingsController.js) - so there is
// no schema change to apply.
//
// Reads are memoised for a few seconds because the flag is consulted on the
// hottest read path in the app (My Leads), and the admin expects the switch to
// take effect immediately, not on the next deploy. The in-process cache is
// dropped the moment the switch is flipped; the short TTL is what covers the
// (currently theoretical) multi-process case.

import redis from '../config/redis.cjs';
import { cacheDelPrefix } from '../utils/ttlCache.js';
import { getSetting, upsertSetting } from '../models/settingsModel.js';

export const HIDE_OLD_DONORS_KEY = 'hide_old_donors';

// Every FRO-facing cached payload is prefixed "fro:" (dash/target/search/
// donors/receipts), and the only Redis tier under the FRO namespace is the
// My Leads list. Both are dropped on a flip so nobody keeps looking at a donor
// list that was built before the switch moved.
const FRO_CACHE_PREFIX = 'fro:';
const FRO_DONORS_REDIS_PREFIX = 'v1:fro:donors:';

/**
 * Drop every cached FRO payload that was built while the switch was in its old
 * position. Called on a manual flip (controller) and on an automatic one
 * (services/oldDonorAutoSchedule.js) so both paths behave identically.
 */
export const bustFroCaches = () => {
  cacheDelPrefix(FRO_CACHE_PREFIX);
  redis.delByPrefix(FRO_DONORS_REDIS_PREFIX).catch(() => { });
};

// Short enough that a flip is picked up by any process within a couple of
// seconds, long enough that the hot donor-list path does not hit the DB on
// every request.
const CACHE_TTL_MS = 5000;

let cache = { value: false, at: 0 };

const parse = (raw) => raw === true || raw === '1' || raw === 'true';

/**
 * Is the "hide old donors" switch currently ON?
 *
 * Fails OPEN: if the settings read errors (table missing, DB blip) the switch
 * is reported as OFF. Hiding every donor in the field because a settings read
 * hiccupped would be a far worse failure than briefly showing old data, and
 * the admin can always flip the switch again.
 */
export const isOldDonorsHidden = async () => {
  const now = Date.now();
  if (now - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const raw = await getSetting(HIDE_OLD_DONORS_KEY);
    const value = parse(raw);
    cache = { value, at: now };
    return value;
  } catch (e) {
    console.warn('[hide-old-donors] settings read failed, treating as visible:', e?.message || String(e));
    cache = { value: false, at: now };
    return false;
  }
};

/**
 * Flip the switch. Returns the new state.
 */
export const setOldDonorsHidden = async (hidden) => {
  const value = !!hidden;
  await upsertSetting(HIDE_OLD_DONORS_KEY, value ? '1' : '0');
  cache = { value, at: Date.now() };
  return value;
};

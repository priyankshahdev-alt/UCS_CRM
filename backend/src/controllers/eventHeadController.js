import crypto from 'crypto';
import * as EventHead from '../models/eventHeadModel.js';
import { parseActivitySheet, parseEventSheet, canonicalizeSector, normalizeName, isCampaignName } from '../utils/activitySheet.js';
import db, { getTableColumns } from '../config/db.js';
import { openStoredObject } from '../services/mediaProxy.js';
import groq from '../config/groq.js';
import {
  availableYears, allThemes, SUPPORTED_LUNAR_YEARS,
} from '../utils/observances.js';
import { generateSuggestionJson, aiSuggestionsConfigured } from '../utils/aiSuggestions.js';
import {
  ACTIVITY_SUGGESTION_LIMIT,
  buildActivityProgramPrompt,
  buildFestivalProgramPrompt,
  isMonthYmd,
  monthEndExclusive,
  monthFirstDay,
  parseActivityProgramSuggestions,
  parseFestivalProgramSuggestions,
  canonicalActivityBeneficiary,
  ACTIVITY_BENEFICIARY_GROUPS,
} from '../utils/activityProgramPrompt.js';
import { getAllHolidays } from '../models/holidayModel.js';
import { getMergedObservancesInRange, findObservanceForDate } from '../utils/observanceMerge.js';

// ngo_id is deliberately NOT coerced to a number: ngos.id may be a UUID, so it
// must pass through unchanged as a string. sector_id / activity_id are always
// SERIAL ints and stay in the numeric list.
const numericFields = ['budget', 'expected_beneficiaries', 'amount', 'quantity', 'purchase_cost', 'cost', 'opening_stock', 'received', 'issued', 'balance', 'available_qty', 'issued_qty', 'damaged_qty', 'kilometer_reading', 'sector_id', 'activity_id'];
const sanitize = (data) => {
  const clean = { ...data };
  for (const k of Object.keys(clean)) {
    if (clean[k] === '' || clean[k] === null || clean[k] === undefined) {
      clean[k] = null;
    } else if (numericFields.includes(k)) {
      const num = Number(clean[k]);
      clean[k] = isNaN(num) ? null : num;
    }
  }
  return clean;
};

/* The beneficiary category is picked from the UI's closed dropdown, but this is
   an API: a value outside the vocabulary would store fine and then read back as
   blank (every report canonicalises on read), so the save would look successful
   and show nothing. Refuse instead — the same rule as in_report below. Empty is
   the honest "no category" and stores as null. */
const canonicalBeneficiaryFields = (fields) => {
  if (!Object.prototype.hasOwnProperty.call(fields, 'beneficiary_group')) return fields;
  const canonical = canonicalActivityBeneficiary(fields.beneficiary_group);
  if (!canonical && fields.beneficiary_group) {
    const err = new Error(`beneficiary_group must be one of: ${ACTIVITY_BENEFICIARY_GROUPS.join(', ')}`);
    err.status = 400;
    throw err;
  }
  return { ...fields, beneficiary_group: canonical || null };
};

// Event Head workspace shows ALL NGOs to every event-head user; the NGO,
// sector and activity lists are no longer restricted to the user's own NGO.
const ownNgoId = (req) => {
  return null;
};

// Static fallback for pickEventColumns, used only when the information_schema
// query itself fails. Mirrors migration 071 plus the ALTERs in 072 and 115.
// Without this the fallback branch below would throw a ReferenceError and 500
// every event write.
const EVENT_COLUMNS = new Set([
  'name', 'category', 'activity_name', 'ngo_id', 'sector_id', 'activity_id',
  'date', 'start_time', 'end_time', 'venue', 'gps_location', 'district', 'state',
  'organizer', 'event_manager', 'coordinator', 'csr_partner', 'donor',
  'funding_source', 'expected_beneficiaries', 'budget', 'description', 'notes',
  'status', 'approval_status', 'priority', 'banner', 'created_by', 'volunteers',
  'images', 'slogan', 'tagline',
]);

// Only pass through columns that actually exist on event_head_events. The live
// DB is the source of truth (it may lag the codebase's full column set), so we
// query real columns once per request and drop anything else. A static fallback
// keeps the write working even if the schema query itself fails.
const eventColumnsCache = { instant: null, ts: 0 };
const getEventColumns = async () => {
  if (eventColumnsCache.instant && Date.now() - eventColumnsCache.ts < 60000) return eventColumnsCache.instant;
  let cols;
  try { cols = await getTableColumns('event_head_events'); } catch { cols = null; }
  if (cols && cols.length) { eventColumnsCache.instant = cols; eventColumnsCache.ts = Date.now(); return cols; }
  return null;
};
const pickEventColumns = async (obj) => {
  const real = await getEventColumns();
  const out = {};
  for (const k of Object.keys(obj || {})) {
    if (real ? real.includes(k) : EVENT_COLUMNS.has(k)) out[k] = obj[k];
  }
  return out;
};

// Load NGO/Sector/Activity lookup maps once, shared by event views.
const buildEventContextMaps = async () => {
  const [ngos, sectors, activities, inactiveVolunteers] = await Promise.all([
    EventHead.getAllEventHeadNgos().catch(() => []),
    EventHead.getAllEventHeadSectors().catch(() => []),
    EventHead.getAllActivities().catch(() => []),
    EventHead.getInactiveVolunteerKeys().catch(() => null),
  ]);
  const ngoMap = {}; for (const n of ngos) ngoMap[n.id] = n.name || n.code;
  const ngoCodeMap = {}; for (const n of ngos) ngoCodeMap[n.id] = (n.code || n.name || '').toLowerCase();
  const sectorMap = {}; for (const s of sectors) sectorMap[s.id] = s.name;
  const activityMap = {}; for (const a of activities) activityMap[a.id] = a.name;
  return { ngos, ngoMap, ngoCodeMap, sectorMap, activityMap, inactiveVolunteers };
};

// NGO branding (letter-head banner + logo) used by BOTH the daily (single event)
// and monthly reports, so an event's report always carries its NGO's logo, name
// and letter-head exactly like the on-screen NGO card.
const NGO_HEADER_BANNERS = {
  mann: '/Letter%20Head%20MANN.png',
  'mann care': '/Letter%20Head%20MANN.png',
  'mann care foundation': '/Letter%20Head%20MANN.png',
  aflf: '/Letter%20Head%20AFLF.png',
  'ashray for life foundation': '/Letter%20Head%20AFLF.png',
bsct: null,
    beingsevak: null,
};
const NGO_LOGOS = {
  mann: '/logo/mann-logo.png',
  aflf: '/logo/aflf-logo.png',
  bsct: '/logo/beingsevak-logo.png',
};
const ngoHeaderBannerFor = (name, code) => {
  const k = String(name || code || '').trim().toLowerCase();
  if (NGO_HEADER_BANNERS[k]) return NGO_HEADER_BANNERS[k];
  for (const key of Object.keys(NGO_HEADER_BANNERS)) {
    if (k.includes(key)) return NGO_HEADER_BANNERS[key];
  }
  return null;
};
const ngoLogoFor = (code) => (code ? (NGO_LOGOS[code] || `/logo/${code}-logo.png`) : null);

// Load activities for a set of events from the join table (falling back to the
// primary activity_id so legacy single-activity events still resolve).
const loadActivitiesForEvents = async (events, activityMap) => {
  const map = {};
  for (const e of events) {
    if (e.id == null) continue;
    const joinActivities = await EventHead.getEventHeadActivityIds(e.id).catch(() => []);
    let ids = joinActivities.length ? joinActivities : (e.activity_id != null ? [Number(e.activity_id)] : []);
    ids = [...new Set(ids.filter(id => id != null))];
    map[e.id] = ids.map(id => ({
      id,
      name: activityMap[id] || (String(id) === String(e.activity_id) ? e.activity_name : null) || null,
    })).filter(a => a.name);
  }
  return map;
};

// Drop Voluntary entries for people the HR panel has marked inactive (absconded,
// offboarded, resigned, ...), so a volunteer removed in HR stops showing on the
// events they had been assigned to.
//
// Only "Volunteer" entries are considered — Management names come from the HR
// employees file, not the workers table, so they are never touched. An entry is
// only removed when it positively matches an inactive worker, by id when the
// picker saved one and otherwise by normalised name. Names that match no worker
// are left as they are.
const pruneInactiveVolunteers = (volunteers, inactive) => {
  if (!Array.isArray(volunteers) || !volunteers.length) return volunteers;
  if (!inactive || (!inactive.ids?.size && !inactive.names?.size)) return volunteers;
  const key = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return volunteers.filter((v) => {
    if (!v || v.team === 'Management') return true;
    if (v.id != null && inactive.ids.has(String(v.id))) return false;
    if (v.name && inactive.names.has(key(v.name))) return false;
    return true;
  });
};

// Write the pruned volunteer list back so an event's stored selection stops
// naming people who have since been marked inactive in HR. Silently skipped
// when nothing changed, and never allowed to break the surrounding request.
const persistVolunteerCleanup = async (event, ctx) => {
  try {
    if (!event || event.id == null) return;
    const before = Array.isArray(event.volunteers) ? event.volunteers : [];
    const after = pruneInactiveVolunteers(before, ctx.inactiveVolunteers);
    if (after === before || after.length === before.length) return;
    event.volunteers = after;
    await EventHead.updateEventHeadEvent(event.id, { volunteers: after });
  } catch (e) {
    console.warn('volunteer cleanup skipped for event', event && event.id, '-', e.message || e);
  }
};

/* The ★ default (cover) photo of an event is simply the first photo uploaded with
   it (the Create Event modal keeps the chosen default at images[0]). Events with
   no photos — and older events with none — return null. */
const eventDefaultImage = (ev) => {
  const imgs = Array.isArray(ev && ev.images) ? ev.images : [];
  const hit = imgs.find(u => u && String(u).indexOf('http') === 0);
  return hit || null;
};

const enrichEvent = (ev, ctx) => ({
  ...ev,
  ngo_name: ev.ngo_id ? ctx.ngoMap[ev.ngo_id] || null : null,
  sector_name: ev.sector_id ? ctx.sectorMap[ev.sector_id] || null : null,
  activity_name: ev.activity_id ? ctx.activityMap[ev.activity_id] || null : null,
  volunteers: pruneInactiveVolunteers(ev.volunteers, ctx.inactiveVolunteers),
});

// Async enrichment that also attaches the activities[] array (multi-activity).
const enrichEvents = async (events, ctx) => {
  if (!events || !events.length) return [];
  const actMap = await loadActivitiesForEvents(events, ctx.activityMap);
  return events.map(ev => ({
    ...enrichEvent(ev, ctx),
    activities: actMap[ev.id] || (ev.activity_id != null ? [{ id: ev.activity_id, name: ctx.activityMap[ev.activity_id] || ev.activity_name || null }].filter(a => a.name) : []),
  }));
};

// Normalize an event's activity selections: accepts either a single `activity_id`
// (legacy) or an array `activity_ids` (multi-activity). Returns the resolved ids.
const resolveActivityIds = (body) => {
  let ids = [];
  if (Array.isArray(body.activity_ids)) ids = ids.concat(body.activity_ids);
  else if (body.activity_id != null) ids.push(body.activity_id);
  return [...new Set(ids.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0))];
};

// Validate the event's NGO ➜ Sector ➜ Activity relationship.
// An activity belongs to exactly one sector, and either to one NGO or to "All NGOs".
// A draft is explicitly allowed to be incomplete: only the event name and its NGO
// are mandatory, so "Save Draft" can be pressed before the sector is chosen. The
// client must opt in by sending status: 'Draft' — a normal create (no status sent)
// still has to satisfy every requirement.
const validateEventRelations = async (body) => {
  const isDraft = body.status === 'Draft';
  const missing = [];
  if (!body.name) missing.push('event name');
  if (!body.ngo_id) missing.push('NGO');
  if (!isDraft && !body.sector_id) missing.push('sector');
  if (missing.length) return { error: { message: `Required fields missing: ${missing.join(', ')}` } };

  const activityIds = resolveActivityIds(body);
  const activities = await Promise.all(activityIds.map(id => EventHead.getActivityById(id)));
  for (const activity of activities) {
    if (!activity) return { error: { message: 'Selected activity does not exist' } };
    if (String(activity.sector_id) !== String(body.sector_id)) {
      return { error: { message: 'Selected sector does not belong to the selected activity' } };
    }
    if (activity.ngo_id != null && String(activity.ngo_id) !== String(body.ngo_id)) {
      return { error: { message: 'Selected activity does not belong to the selected NGO' } };
    }
  }
  return { activities };
};

const validateEventTimes = (body) => {
  if (body.start_time && body.end_time && String(body.end_time) < String(body.start_time)) {
    return { message: 'End time must be after start time' };
  }
  return null;
};

// ─── EVENTS ───
export const createEventHandler = async (req, res) => {
  try {
    const body = sanitize(req.body);
    const relation = await validateEventRelations(body);
    if (relation.error) return res.status(400).json({ message: relation.error.message });
    const timeErr = validateEventTimes(body);
    if (timeErr) return res.status(400).json({ message: timeErr.message });
    const activityIds = resolveActivityIds(body);
    const insert = { ...(await pickEventColumns(body)), activity_id: activityIds.length ? Number(activityIds[0]) : null, created_by: String(req.user.id), status: body.status || 'Draft', approval_status: body.approval_status || 'Draft' };
    delete insert.activity_ids;
    const event = await EventHead.createEventHeadEvent(insert);
    if (activityIds.length) await EventHead.setEventHeadActivities(event.id, activityIds);
    const ctx = await buildEventContextMaps();
    return res.status(201).json((await enrichEvents([event], ctx))[0]);
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ message: 'NGO, sector or activity reference does not exist' });
    console.error('createEventHandler error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listEventHeadEvents = async (req, res) => {
  try {
    const ngo_id = ownNgoId(req) || req.query.ngo_id;
    const { sector_id, activity_id, status, month, year } = req.query;
    const filters = { ngo_id, sector_id, activity_id, status, month, year };
    const events = await EventHead.getAllEventHeadEvents(filters);
    const ctx = await buildEventContextMaps();
    const enriched = await enrichEvents(events, ctx);
    // Attach a lightweight social-media publishing summary (e.g. 2/3) for the
    // events-list badge; absent for events with no tracking yet.
    const summary = await EventHead.getSocialSummaryByEvents(events.map(e => e.id)).catch(() => ({}));
    return res.json(enriched.map(ev => {
      const s = summary[ev.id];
      return s ? { ...ev, social_completed: s.completed, social_total: s.total } : ev;
    }));
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const getEventHeadEvent = async (req, res) => {
  try {
    const event = await EventHead.getEventHeadEventById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const ctx = await buildEventContextMaps();
    return res.json((await enrichEvents([event], ctx))[0]);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const updateEventHeadEvent = async (req, res) => {
  try {
    const body = sanitize(req.body);
    const activityIds = resolveActivityIds(body);
    // Only validate when the relation fields are being set (existing events may lack them).
    if (body.ngo_id && body.sector_id && activityIds.length) {
      const relation = await validateEventRelations(body);
      if (relation.error) return res.status(400).json({ message: relation.error.message });
    } else if (activityIds.length) {
      for (const id of activityIds) {
        const activity = await EventHead.getActivityById(id);
        if (!activity) return res.status(400).json({ message: 'Selected activity does not exist' });
        if (body.sector_id && String(activity.sector_id) !== String(body.sector_id)) {
          return res.status(400).json({ message: 'Selected sector does not belong to the selected activity' });
        }
      }
    }
    const timeErr = validateEventTimes(body);
    if (timeErr) return res.status(400).json({ message: timeErr.message });
    const updates = { ...(await pickEventColumns(body)) };
    delete updates.activity_ids;
    if (activityIds.length) updates.activity_id = Number(activityIds[0]);
    const event = await EventHead.updateEventHeadEvent(req.params.id, updates);
    if (activityIds.length) await EventHead.setEventHeadActivities(event.id, activityIds);
    const ctx = await buildEventContextMaps();
    // Persist the cleanup too, so the stored list self-heals instead of only
    // being hidden on read. Best effort: a failure here must not fail the save.
    await persistVolunteerCleanup(event, ctx);
    return res.json((await enrichEvents([event], ctx))[0]);
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ message: 'NGO, sector or activity reference does not exist' });
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const deleteEventHeadEvent = async (req, res) => {
  try {
    const result = await EventHead.deleteEventHeadEvent(req.params.id);
    return res.json(result);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// Bulk cleanup of events matching NGO + activity-name + date range. Used to
// remove generic sheet-imported events (e.g. BSCT "Awareness Campaign" rows)
// before loading the real per-NGO calendar data. Scope-limited: caller must
// provide at least one filter.
export const cleanupEvents = async (req, res) => {
  try {
    const { ngo_id, activity_name, start, end } = req.body || {};
    if (!ngo_id && !activity_name) {
      return res.status(400).json({ message: 'Provide at least one of ngo_id or activity_name to scope the cleanup.' });
    }

    let activityIds = null;
    if (activity_name) {
      const activities = await EventHead.getAllActivities().catch(() => []);
      const q = String(activity_name).toLowerCase();
      activityIds = new Set(
        (activities || [])
          .filter(a => String(a.name || '').toLowerCase().includes(q))
          .map(a => Number(a.id))
      );
    }

    const events = await EventHead.getEventHeadEventsByRange({ ngo_id, start, end });
    const targets = events.filter(ev => {
      if (activityIds && activityIds.size && !activityIds.has(Number(ev.activity_id))) return false;
      if (ngo_id && ev.ngo_id != null && String(ev.ngo_id) !== String(ngo_id)) return false;
      return true;
    });

    const removed = await EventHead.deleteEventHeadEventsBulk(targets.map(t => t.id));
    return res.json({ removed, matched: targets.length });
  } catch (error) {
    console.error('cleanupEvents error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const updateEventHeadStatus = async (req, res) => {
  try {
    const { status } = sanitize(req.body);
    // A direct status edit must not bypass completion: the social-media rule is
    // enforced here too, so a raw API call behaves exactly like the UI.
    if (status === 'Completed') {
      const stored = await EventHead.getSocialTracking(req.params.id).catch(() => []);
      const problems = socialProblems(mergeSocialDefaults(stored));
      if (problems.length) {
        return res.status(400).json({
          message: 'Complete the Social Media Publishing details for every platform before marking this event Completed.',
          problems,
        });
      }
    }
    const event = await EventHead.updateEventHeadEvent(req.params.id, { status });
    return res.json(event);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const getEventHeadDashboard = async (req, res) => {
  try {
    const dash = await EventHead.getEventHeadDashboard();
    return res.json(dash);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

const pad2 = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const NOT_HAPPENING = ['Cancelled', 'Postponed'];

// Ledger of the existing Event Head workflow states that genuinely need attention.
// Built only from reliably-determinable fields — no invented report/approval system.
const ATTENTION_LABELS = {
  overdue: 'Approved but overdue — mark completed',
  approval: 'Pending approval',
  draft: 'Draft — not submitted yet',
  info: 'Missing venue or start time',
};

export const getEventHeadDashboardStats = async (req, res) => {
  try {
    const ngo_id = ownNgoId(req) || req.query.ngo_id;
    const { sector_id, activity_id, month, year } = req.query;
    const base = { ngo_id, sector_id, activity_id, month, year };

    // core = full filter set (drives KPIs + today/upcoming/week/month lists).
    // byNgo = filter set minus NGO (drives the per-NGO breakdown).
    // sectorSummary = ngo + month/year only (drives the per-sector breakdown).
    const scope = ownNgoId(req);
    const [core, byNgo, sectorSummary, sectors, activities, ngos, ctx] = await Promise.all([
      EventHead.getEventHeadDashboardEvents(base),
      EventHead.getEventHeadDashboardEvents({ sector_id, activity_id, month, year }),
      EventHead.getEventHeadDashboardEvents({ ngo_id, month, year }),
      EventHead.getAllEventHeadSectors(),
      EventHead.getAllActivities(),
      EventHead.getAllEventHeadNgos(),
      buildEventContextMaps(),
    ]);

    const now = new Date();
    const todayStr = toYmd(now);
    const weekDay = (now.getDay() + 6) % 7;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekDay);
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const inRange = (e, start, end) => !!e.date && e.date >= toYmd(start) && e.date < toYmd(end);
    const NOT_UPCOMING_STATUS = ['Cancelled', 'Postponed', 'Completed', 'Rejected', 'Closed'];
    const isUpcoming = (e) => !!e.date && e.date >= todayStr && !NOT_UPCOMING_STATUS.includes(e.status);
    const isToday = (e) => e.date === todayStr && !NOT_HAPPENING.includes(e.status);
    const byDate = (a, b) => (a.date || '').localeCompare(b.date || '');
    const byTime = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.start_time || '').localeCompare(b.start_time || '');
    const enrich = (ev) => enrichEvent(ev, ctx);

    const todayEvents = core.filter(isToday).sort(byTime);
    const upcomingEvents = core.filter(isUpcoming).sort(byDate);
    const weekEvents = core.filter(e => isUpcoming(e) && inRange(e, weekStart, weekEnd)).sort(byDate);
    const inMonth = core.filter(e => inRange(e, monthStart, monthEnd));

    const ngoCounts = {};
    for (const e of byNgo) if (e.ngo_id != null) ngoCounts[e.ngo_id] = (ngoCounts[e.ngo_id] || 0) + 1;
    const scopedNgos = scope ? ngos.filter(n => String(n.id) === scope) : ngos;
    const events_by_ngo = scopedNgos.map(n => ({
      ngo_id: n.id,
      ngo_name: n.name || n.code,
      count: ngoCounts[n.id] || 0,
    }));

    const sectorEventCounts = {};
    for (const e of sectorSummary) if (e.sector_id != null) sectorEventCounts[e.sector_id] = (sectorEventCounts[e.sector_id] || 0) + 1;
    const sectorActivityCounts = {};
    for (const a of activities) {
      if (ngo_id && a.ngo_id != null && String(a.ngo_id) !== String(ngo_id)) continue;
      if (a.sector_id == null) continue;
      sectorActivityCounts[a.sector_id] = (sectorActivityCounts[a.sector_id] || 0) + 1;
    }
    const events_by_sector = sectors
      .filter(s => s.is_active !== false)
      .map(s => ({
        ...s,
        activity_count: sectorActivityCounts[s.id] || 0,
        event_count: sectorEventCounts[s.id] || 0,
      }));

    const activityIdx = {};
    for (const a of activities) activityIdx[a.id] = a;
    const upcomingCounts = {};
    const nextDates = {};
    for (const e of upcomingEvents) {
      if (e.activity_id == null) continue;
      upcomingCounts[e.activity_id] = (upcomingCounts[e.activity_id] || 0) + 1;
      if (!nextDates[e.activity_id] || e.date < nextDates[e.activity_id]) nextDates[e.activity_id] = e.date;
    }
    const activities_with_upcoming_events = Object.keys(upcomingCounts)
      .map((activityId) => {
        const a = activityIdx[activityId];
        const ngoName = a && a.ngo_id != null ? (ctx.ngoMap[a.ngo_id] || null) : (a ? 'All NGOs' : null);
        return {
          activity_id: Number(activityId),
          activity_name: a ? a.name : null,
          sector_id: a ? a.sector_id : null,
          sector_name: a && a.sector_id != null ? (ctx.sectorMap[a.sector_id] || null) : null,
          ngo_id: a ? a.ngo_id : null,
          ngo_name: ngoName,
          upcoming_count: upcomingCounts[activityId],
          next_event_date: nextDates[activityId],
        };
      })
      .filter(x => x.activity_name)
      .sort((p, q) => (p.next_event_date || '').localeCompare(q.next_event_date || ''));

    const attention = [];
    for (const e of core) {
      if (e.status === 'Draft') {
        attention.push({ ...e, attention_type: 'draft', attention_reason: ATTENTION_LABELS.draft });
      } else if (e.status === 'Submitted') {
        attention.push({ ...e, attention_type: 'approval', attention_reason: ATTENTION_LABELS.approval });
      } else if (e.status === 'Approved' && e.date && e.date < todayStr) {
        attention.push({ ...e, attention_type: 'overdue', attention_reason: ATTENTION_LABELS.overdue });
      } else if (isUpcoming(e) && (!e.venue || !e.start_time)) {
        attention.push({ ...e, attention_type: 'info', attention_reason: ATTENTION_LABELS.info });
      }
    }
    const attentionRank = { overdue: 0, info: 1, approval: 2, draft: 3 };
    attention.sort((a, b) => attentionRank[a.attention_type] - attentionRank[b.attention_type] || byDate(a, b));

    const kpis = {
      total_events: core.length,
      upcoming_events: upcomingEvents.length,
      today_events: todayEvents.length,
      completed_events: core.filter(e => e.status === 'Completed').length,
      budget_total: core.reduce((s, e) => s + (+e.budget || 0), 0),
      beneficiaries_total: core.reduce((s, e) => s + (+e.expected_beneficiaries || 0), 0),
    };

    return res.json({
      generated_at: new Date().toISOString(),
      filters: base,
      kpis,
      this_week: { count: weekEvents.length, events: weekEvents.slice(0, 10).map(enrich) },
      this_month: {
        total: inMonth.length,
        upcoming: inMonth.filter(isUpcoming).length,
        completed: inMonth.filter(e => e.status === 'Completed').length,
      },
      events_by_ngo,
      events_by_sector,
      activities_with_upcoming_events,
      today_events: todayEvents.slice(0, 12).map(enrich),
      upcoming_events: upcomingEvents.slice(0, 8).map(enrich),
      attention: attention.slice(0, 10).map(enrich),
    });
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const getEventHeadEventsByMonth = async (req, res) => {
  try {
    const ngo_id = ownNgoId(req) || null;
    const events = await EventHead.getEventHeadEventsByMonth(req.params.month, req.params.year, ngo_id);
    return res.json(events);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// FullCalendar endpoint: returns FullCalendar-compatible events within a visible
// date range, supporting start/end + NGO/Sector/Activity/Status/Year filters.
export const getEventHeadCalendar = async (req, res) => {
  try {
    const { start, end, year, status } = req.query;
    const ngo_id = ownNgoId(req) || req.query.ngoId || req.query.ngo_id;
    const sector_id = req.query.sectorId || req.query.sector_id;
    const activity_id = req.query.activityId || req.query.activity_id;
    const events = await EventHead.getEventHeadEventsByRange({ start, end, ngo_id, sector_id, activity_id, status, year });
    const ctx = await buildEventContextMaps();
    const enriched = await enrichEvents(events, ctx);
    return res.json(enriched.map(e => {
      const day = String(e.date || '').slice(0, 10);
      const st = (e.start_time || '').slice(0, 5) || '00:00';
      const en = (e.end_time || '').slice(0, 5) || '00:00';
      const hasTime = Boolean(e.start_time || e.end_time);
      return {
        id: String(e.id),
        title: (e.name || 'Untitled Event') + (e.ngo_name ? ` · ${e.ngo_name}` : ''),
        start: hasTime ? `${day}T${st}` : day,
        end: hasTime ? `${day}T${en}` : day,
        allDay: !hasTime,
        extendedProps: {
          id: e.id,
          ngoId: e.ngo_id,
          ngoName: e.ngo_name || null,
          sectorId: e.sector_id,
          sectorName: e.sector_name || null,
          activities: e.activities || [],
          status: e.status || null,
          priority: e.priority || null,
          venue: e.venue || null,
          description: e.description || e.notes || null,
          slogan: e.slogan || null,
          tagline: e.tagline || null,
          date: e.date || null,
          startTime: e.start_time || null,
          endTime: e.end_time || null,
          banner: e.banner || null,
          images: Array.isArray(e.images) ? e.images : [],
        },
      };
    }));
  } catch (error) {
    console.error('getEventHeadCalendar error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const getEventHeadEventsByNgo = async (req, res) => {
  try {
    const ngoId = ownNgoId(req) || req.params.ngoId;
    const events = await EventHead.getEventHeadEventsByNgo(ngoId);
    return res.json(events);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const getEventHeadEventsByState = async (req, res) => {
  try {
    const events = await EventHead.getEventHeadEventsByState(req.params.state);
    return res.json(events);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const submitEventHeadApproval = async (req, res) => {
  try {
    const event = await EventHead.updateEventHeadEvent(req.params.id, { status: 'Submitted', approval_status: 'Submitted' });
    return res.json(event);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const approveEventHeadEvent = async (req, res) => {
  try {
    const event = await EventHead.updateEventHeadEvent(req.params.id, { status: 'Approved', approval_status: 'Approved' });
    return res.json(event);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const rejectEventHeadEvent = async (req, res) => {
  try {
    const event = await EventHead.updateEventHeadEvent(req.params.id, { status: 'Rejected', approval_status: 'Rejected' });
    return res.json(event);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── ASSETS ───
export const createAsset = async (req, res) => {
  try {
    const asset = await EventHead.createAsset(sanitize(req.body));
    return res.status(201).json(asset);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listAssets = async (req, res) => {
  try {
    const assets = await EventHead.getAllAssets();
    return res.json(assets);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const getAsset = async (req, res) => {
  try {
    const asset = await EventHead.getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    return res.json(asset);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const editAsset = async (req, res) => {
  try {
    const asset = await EventHead.updateAsset(req.params.id, sanitize(req.body));
    return res.json(asset);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const removeAsset = async (req, res) => {
  try {
    const result = await EventHead.deleteAsset(req.params.id);
    return res.json(result);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const issueAssetItem = async (req, res) => {
  try {
    const asset = await EventHead.issueAsset(req.params.id, sanitize(req.body).quantity);
    return res.json(asset);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const returnAssetItem = async (req, res) => {
  try {
    const asset = await EventHead.returnAsset(req.params.id);
    return res.json(asset);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const getAssetUtilization = async (req, res) => {
  try {
    const data = await EventHead.getAllAssets();
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── MATERIALS ───
export const createMaterial = async (req, res) => {
  try {
    const material = await EventHead.createMaterial(sanitize(req.body));
    return res.status(201).json(material);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listMaterials = async (req, res) => {
  try {
    const materials = await EventHead.getAllMaterials();
    return res.json(materials);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const editMaterial = async (req, res) => {
  try {
    const material = await EventHead.updateMaterial(req.params.id, sanitize(req.body));
    return res.json(material);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const removeMaterial = async (req, res) => {
  try {
    const result = await EventHead.deleteMaterial(req.params.id);
    return res.json(result);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const getMaterialStock = async (req, res) => {
  try {
    const stock = await EventHead.getMaterialStock();
    return res.json(stock);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const adjustMaterialStock = async (req, res) => {
  try {
    const material = await EventHead.adjustMaterialStock(req.params.id, sanitize(req.body).adjustment);
    return res.json(material);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── DISTRIBUTIONS ───
export const createDistribution = async (req, res) => {
  try {
    const dist = await EventHead.createDistribution(req.params.eventId, sanitize(req.body));
    return res.status(201).json(dist);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listDistributions = async (req, res) => {
  try {
    const dists = await EventHead.getDistributionsByEvent(req.params.eventId);
    return res.json(dists);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── BENEFICIARIES ───
export const listBeneficiaries = async (req, res) => {
  try {
    const beneficiaries = await EventHead.getAllDistributions();
    return res.json(beneficiaries);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const createBeneficiary = async (req, res) => {
  try {
    return res.json({ message: 'Beneficiary created' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── VOLUNTEERS ───
export const createVolunteer = async (req, res) => {
  try {
    const volunteer = await EventHead.createVolunteer(sanitize(req.body));
    return res.status(201).json(volunteer);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listVolunteers = async (req, res) => {
  try {
    const volunteers = await EventHead.getAllVolunteers();
    return res.json(volunteers);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listVolunteerPeople = async (req, res) => {
  try {
    const people = await EventHead.getVolunteerPeople();
    return res.json(people);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// Today's attendance for the Voluntary section. Read-only and deliberately
// non-fatal: a failure here must not take the Create New Event form down, so the
// picker renders exactly as it did before, just without status badges.
export const listVolunteerAttendance = async (req, res) => {
  try {
    const attendance = await EventHead.getVolunteerAttendanceToday();
    return res.json(attendance);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const editVolunteer = async (req, res) => {
  try {
    const volunteer = await EventHead.updateVolunteer(req.params.id, sanitize(req.body));
    return res.json(volunteer);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── EXPENSES ───
export const createExpense = async (req, res) => {
  try {
    const expense = await EventHead.createExpense(req.params.eventId, sanitize(req.body));
    return res.status(201).json(expense);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listExpenses = async (req, res) => {
  try {
    const expenses = await EventHead.getExpensesByEvent(req.params.eventId);
    return res.json(expenses);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const removeExpense = async (req, res) => {
  try {
    const result = await EventHead.deleteExpense(req.params.eventId, req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── VEHICLES ───
export const createVehicle = async (req, res) => {
  try {
    const vehicle = await EventHead.createVehicle(sanitize(req.body));
    return res.status(201).json(vehicle);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listVehicles = async (req, res) => {
  try {
    const vehicles = await EventHead.getAllVehicles();
    return res.json(vehicles);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const assignVehicle = async (req, res) => {
  try {
    const vehicle = await EventHead.assignVehicle(sanitize(req.body));
    return res.status(201).json(vehicle);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── MEDIA ───
// Event media lives in the upstream (production) bucket when those credentials
// are configured, otherwise fall back to the active/legacy account.
const eventStorage = () => (
  process.env.UPSTREAM_S3_BUCKET
    ? db.storage.from('upstream', 'event')
    : db.storage.from('event')
);

// Upload a memory-backed multer file to the S3 "event" folder
// (<S3_BUCKET>/event/<file>) and return its public URL.
const uploadEventFile = async (file) => {
  const ext = (file.originalname && '.' + String(file.originalname).split('.').pop()) || '';
  const key = `event/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext.replace(/[^a-z0-9.]/gi, '').slice(0, 12)}`;
  const { data, error } = await eventStorage().upload(key, file.buffer, { contentType: file.mimetype });
  if (error) throw new Error('Upload to S3 failed: ' + error.message);
  const { data: urlData } = eventStorage().getPublicUrl(key);
  const { data: previewData } = await eventStorage().presignDownload(key, 3600);
  return {
    url: urlData?.publicUrl || `event/${key}`,
    previewUrl: previewData?.url || null,
    key,
  };
};
const normalizeMedia = (m) => ({
  ...m,
  title: m.title || m.name || null,
  description: m.description || null,
  media_type: m.media_type || categorizeMedia(m) || null,
  year: m.year != null ? Number(m.year) : null,
  size: m.size != null ? Number(m.size) : null,
  uploaded_by: m.uploaded_by || null,
});
const categorizeMedia = (m) => {
  const type = String(m.type || '').toLowerCase();
  const url = String(m.url || '').toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(url)) return 'Photo';
  if (type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/.test(url)) return 'Video';
  if (type.includes('pdf') || /\.pdf$/i.test(url)) return 'Document';
  if (/\.(docx?|xlsx?|pptx?|txt|csv)$/.test(url)) return 'Document';
  return 'Other';
};
const pickMediaMeta = (body, file, s3Url = null) => {
  const clean = sanitize(body);
  const size = file?.size != null ? Number(file.size) : (clean.size != null ? Number(clean.size) : null);
  const meta = {
    name: file?.originalname || clean.name || clean.title || `${Date.now()}`,
    url: clean.url || s3Url || `/uploads/${file?.filename || ''}`,
    type: file?.mimetype || clean.type || clean.media_type || null,
    title: clean.title || file?.originalname || clean.name || null,
    description: clean.description || null,
    media_type: clean.media_type || null,
    year: clean.year != null ? Number(clean.year) : null,
  };
  if (size != null && !Number.isNaN(size)) meta.size = size;
  return meta;
};
export const uploadEventBanner = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const { url, previewUrl, key } = await uploadEventFile(req.file);
    return res.json({ url, previewUrl, key });
  } catch (error) {
    console.error('uploadEventBanner error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const uploadMedia = async (req, res) => {
  try {
    // multer.fields() yields req.files = { file: [...], files: [...] };
    // multer.single() yields req.file. Collect all uploaded files either way.
    const uploaded = [];
    if (Array.isArray(req.files)) uploaded.push(...req.files);
    else if (req.files && typeof req.files === 'object') {
      for (const k of Object.keys(req.files)) uploaded.push(...(req.files[k] || []));
    }
    if (uploaded.length > 0) {
      const saved = [];
      for (const f of uploaded) {
        const { url } = await uploadEventFile(f);
        saved.push(await EventHead.createMedia(req.params.eventId, pickMediaMeta({ ...req.body, name: f.originalname }, f, url)));
      }
      return res.status(201).json(saved.map(normalizeMedia));
    }
    if (req.file) {
      const { url } = await uploadEventFile(req.file);
      const media = await EventHead.createMedia(req.params.eventId, pickMediaMeta(req.body, req.file, url));
      return res.status(201).json(normalizeMedia(media));
    }
    // No file — allow creating a media record by URL only (documents/other).
    const media = await EventHead.createMedia(req.params.eventId, pickMediaMeta(req.body, null));
    return res.status(201).json(normalizeMedia(media));
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── SOCIAL MEDIA TRACKING ───
// Instagram / Facebook / YouTube publishing details captured when an event is
// completed. Stored one row per (event_id, platform); the completion rule is
// enforced here so a direct API call cannot bypass the UI.
const SOCIAL_PLATFORMS = EventHead.SOCIAL_PLATFORMS || ['instagram', 'facebook', 'youtube'];
const SOCIAL_STATUSES = ['Pending', 'Uploaded', 'Not Applicable'];

const normalizePlatform = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'ig' || s === 'insta') return 'instagram';
  if (s === 'fb') return 'facebook';
  if (s === 'yt') return 'youtube';
  return s;
};

// Coerce whatever the client sent into one sanitised row per platform. Uploaded
// platforms keep their link/date/time/proof; Not Applicable keeps its reason;
// everything else collapses to Pending with all fields cleared, so a platform
// that is downgraded never keeps stale publishing data.
const sanitizeSocialRows = (input) => {
  const byPlatform = {};
  const collect = (r = {}) => {
    const platform = normalizePlatform(r.platform);
    if (platform) byPlatform[platform] = r;
  };
  if (Array.isArray(input)) input.forEach(collect);
  else if (input && typeof input === 'object') {
    for (const k of Object.keys(input)) {
      const v = input[k];
      if (v && typeof v === 'object') collect({ ...v, platform: v.platform || k });
    }
  }
  return SOCIAL_PLATFORMS.map(platform => {
    const r = byPlatform[platform] || {};
    const status = SOCIAL_STATUSES.includes(String(r.status || '').trim()) ? String(r.status).trim() : 'Pending';
    const uploaded = status === 'Uploaded';
    const na = status === 'Not Applicable';
    return {
      platform,
      status,
      url: uploaded && r.url ? String(r.url).trim() : null,
      content_type: uploaded && r.content_type ? String(r.content_type).trim() : null,
      upload_date: uploaded && r.upload_date ? String(r.upload_date).trim().slice(0, 10) : null,
      upload_time: uploaded && r.upload_time ? String(r.upload_time).trim().slice(0, 8) : null,
      proof_url: uploaded && r.proof_url ? String(r.proof_url).trim() : null,
      not_applicable_reason: na && r.not_applicable_reason ? String(r.not_applicable_reason).trim() : null,
    };
  });
};

// The completion rule: Uploaded needs an upload date + upload time;
// Not Applicable needs a reason. Returns a list of { platform, message }.
const socialProblems = (rows) => {
  const problems = [];
  for (const r of rows) {
    if (r.status === 'Uploaded') {
      if (!r.upload_date) problems.push({ platform: r.platform, message: 'Upload date is required' });
      else if (!r.upload_time) problems.push({ platform: r.platform, message: 'Upload time is required' });
    } else if (r.status === 'Not Applicable') {
      if (!r.not_applicable_reason) problems.push({ platform: r.platform, message: 'A reason is required when marked Not Applicable' });
    } else {
      problems.push({ platform: r.platform, message: 'Mark this platform Uploaded or Not Applicable' });
    }
  }
  return problems;
};

// Merge stored rows over defaults so the client always receives all three
// platforms (Pending when nothing has been saved yet).
const mergeSocialDefaults = (rows) => {
  const byPlatform = {};
  for (const r of rows || []) byPlatform[normalizePlatform(r.platform)] = r;
  return SOCIAL_PLATFORMS.map(platform => {
    const r = byPlatform[platform] || {};
    return {
      platform,
      status: SOCIAL_STATUSES.includes(r.status) ? r.status : 'Pending',
      url: r.url || null,
      content_type: r.content_type || null,
      upload_date: r.upload_date || null,
      upload_time: r.upload_time || null,
      proof_url: r.proof_url || null,
      not_applicable_reason: r.not_applicable_reason || null,
    };
  });
};

export const getEventSocial = async (req, res) => {
  try {
    const rows = await EventHead.getSocialTracking(req.params.eventId);
    return res.json({ platforms: mergeSocialDefaults(rows) });
  } catch (error) {
    console.error('getEventSocial error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// Save without completing — lets the author fill the form in pieces while the
// event keeps its current status.
export const saveEventSocial = async (req, res) => {
  try {
    const rows = sanitizeSocialRows(req.body && req.body.platforms != null ? req.body.platforms : req.body);
    const saved = await EventHead.upsertSocialTracking(req.params.eventId, rows);
    return res.json({ platforms: mergeSocialDefaults(saved) });
  } catch (error) {
    console.error('saveEventSocial error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// Mark completed: validates every platform server-side, persists the tracking
// and flips the status in one request. Idempotent — completing again just
// re-saves the same rows.
export const completeEventHandler = async (req, res) => {
  try {
    const event = await EventHead.getEventHeadEventById(req.params.eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const rows = sanitizeSocialRows(req.body && req.body.platforms != null ? req.body.platforms : req.body);
    const problems = socialProblems(rows);
    if (problems.length) {
      return res.status(400).json({
        message: 'Cannot mark this event Completed — finish the Social Media Publishing details for every platform first.',
        problems,
      });
    }
    const saved = await EventHead.upsertSocialTracking(req.params.eventId, rows);
    const updated = event.status === 'Completed'
      ? event
      : await EventHead.updateEventHeadEvent(req.params.eventId, { status: 'Completed' });
    return res.json({ event: updated, platforms: mergeSocialDefaults(saved) });
  } catch (error) {
    console.error('completeEventHandler error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const uploadSocialProof = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const { url } = await uploadEventFile(req.file);
    return res.json({ url });
  } catch (error) {
    console.error('uploadSocialProof error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listMedia = async (req, res) => {
  try {
    const media = await EventHead.getMediaByEvent(req.params.eventId);
    return res.json((media || []).map(normalizeMedia));
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listMediaByNgo = async (req, res) => {
  try {
    const ngoId = ownNgoId(req) || req.params.ngoId;
    if (!ngoId) return res.status(400).json({ message: 'NgoId is required' });
    const media = await EventHead.getMediaByNgo(ngoId);
    return res.json((media || []).map(m => {
      const norm = normalizeMedia(m);
      const ev = m.event_head_events;
      if (ev) {
        norm.event_id = ev.id != null ? ev.id : norm.event_id;
        norm.event_name = ev.name || null;
        norm.event_date = ev.date || null;
      }
      return norm;
    }));
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const replaceMedia = async (req, res) => {
  try {
    const existing = await EventHead.getMediaById(req.params.eventId, req.params.id);
    if (!existing) return res.status(404).json({ message: 'Media not found' });
    const clean = sanitize(req.body);
    const updates = {};
    if (req.file) {
      const { url } = await uploadEventFile(req.file);
      updates.url = clean.url || url;
      if (req.file.mimetype) updates.type = req.file.mimetype;
      updates.name = req.file.originalname || clean.name || existing.name;
      if (req.file.size != null) updates.size = Number(req.file.size);
    }
    if (clean.title != null) updates.title = clean.title;
    if (clean.description != null) updates.description = clean.description;
    if (clean.media_type != null) updates.media_type = clean.media_type;
    if (clean.year != null) updates.year = Number(clean.year);
    if (clean.uploaded_by != null) updates.uploaded_by = clean.uploaded_by;
    const media = await EventHead.updateMedia(req.params.eventId, req.params.id, updates);
    return res.json(normalizeMedia(media));
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const removeMedia = async (req, res) => {
  try {
    const result = await EventHead.deleteMedia(req.params.eventId, req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Download a media file as an attachment. Media lives on a cross-origin
// S3/Supabase public URL; fetching it server-side avoids browser CORS and
// lets us stream it back with Content-Disposition: attachment so the client
// saves the file instead of opening it in a new tab.
const asciiSafeFilename = (s) => String(s || '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\\r\n]/g, '_').slice(0, 180) || 'download';
const utf8Filename = (s) => String(s || '').replace(/["\\\r\n]/g, '_').slice(0, 180) || 'download';

const S3_OBJECT_URL_RE = /^https?:\/\/[^/]*amazonaws\.com\/(.+?)(?:\?.*)?$/i;
const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', pdf: 'application/pdf',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
const mimeForName = (name) => EXT_MIME[String(name || '').split('.').pop().toLowerCase()] || null;
const s3FileNameFromUrl = (url) => {
  const m = S3_OBJECT_URL_RE.exec(String(url || ''));
  if (!m) return null;
  let key = m[1];
  try { key = decodeURIComponent(key); } catch { }
  return key.startsWith('event/') ? key.slice('event/'.length) : null;
};
async function readEventObject(url) {
  try {
    const obj = await openStoredObject(url);
    if (obj && obj.body) {
      const chunks = [];
      for await (const chunk of obj.body) chunks.push(chunk);
      return { buffer: Buffer.concat(chunks), contentType: obj.contentType };
    }
  } catch { /* fall through */ }
  const fileName = s3FileNameFromUrl(url);
  if (fileName) {
    const { data, error } = await eventStorage().download(fileName);
    if (!error && data) return { buffer: data, contentType: mimeForName(fileName) };
  }
  const remote = await fetch(url, { redirect: 'follow' });
  if (!remote.ok) throw Object.assign(new Error('Failed to retrieve the file.'), { status: 502 });
  return { buffer: Buffer.from(await remote.arrayBuffer()), contentType: remote.headers.get('content-type') || mimeForName(url) };
}

export const downloadMedia = async (req, res) => {
  try {
    const media = await EventHead.getMediaById(req.params.eventId, req.params.id);
    if (!media) return res.status(404).json({ message: 'Media not found' });
    if (!media.url || /^(youtu|instagram|facebook)/i.test(String(media.url)) || String(media.url).indexOf('http') !== 0) {
      return res.status(400).json({ message: 'This media has no downloadable file (it is a social link).' });
    }
    const { buffer, contentType } = await readEventObject(media.url);
    const base = asciiSafeFilename(media.title || media.name || media.url.split('/').pop());
    res.setHeader('Content-Type', contentType || media.type || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store, no-cache');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiSafeFilename(base)}"; filename*=UTF-8''${encodeURIComponent(utf8Filename(base))}`);
    return res.send(buffer);
  } catch (error) {
    console.error('eventHeadController downloadMedia error:', error.message || error);
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const viewMedia = async (req, res) => {
  try {
    const media = await EventHead.getMediaById(req.params.eventId, req.params.id);
    if (!media) return res.status(404).json({ message: 'Media not found' });
    if (!media.url || /^(youtu|instagram|facebook)/i.test(String(media.url)) || String(media.url).indexOf('http') !== 0) {
      return res.status(400).json({ message: 'This media has no viewable file (it is a social link).' });
    }
    const { buffer, contentType } = await readEventObject(media.url);
    res.setHeader('Content-Type', contentType || media.type || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(buffer);
  } catch (error) {
    console.error('eventHeadController viewMedia error:', error.message || error);
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const viewEventBanner = async (req, res) => {
  try {
    const event = await EventHead.getEventHeadEventById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    let banner = event.banner;
    // Older events may store the banner only as a media row (media_type
    // 'Banner'), not in the event's banner column — fall back to that.
    if (!banner || String(banner).indexOf('http') !== 0) {
      try {
        const rows = await EventHead.getBannerMediaByEvents([event.id]);
        const hit = (rows || []).find(r => r && r.url && String(r.url).indexOf('http') === 0);
        if (hit) banner = hit.url;
      } catch { /* ignore fallback errors */ }
    }
    // Most events never have a banner column: the ★ default photo uploaded with
    // the event (images[0]) is what every report shows as the cover photo.
    if (!banner || String(banner).indexOf('http') !== 0) {
      banner = eventDefaultImage(event) || banner;
    }
    if (!banner || String(banner).indexOf('http') !== 0) {
      return res.status(404).json({ message: 'This event has no banner image.' });
    }
    const { buffer, contentType } = await readEventObject(banner);
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(buffer);
  } catch (error) {
    console.error('eventHeadController viewEventBanner error:', error.message || error);
    return res.status(error.status || 500).json({ message: error.message });
  }
};

// Stream one image from an event's `images` array through the server, so the
// planner's Event Detail Sheet can embed an S3-hosted image without a
// cross-origin browser fetch. The index addresses the stored row; no
// caller-supplied URL is ever followed.
export const viewEventImage = async (req, res) => {
  try {
    const event = await EventHead.getEventHeadEventById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const images = Array.isArray(event.images) ? event.images : [];
    const index = Number(req.params.index);
    const url = Number.isInteger(index) && index >= 0 ? images[index] : null;
    if (!url || typeof url !== 'string') return res.status(404).json({ message: 'Image not found' });
    // Legacy rows hold the bytes inline as a data URL; return them with no fetch.
    const dataUrl = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(url);
    if (dataUrl) {
      const mime = dataUrl[1] || 'image/jpeg';
      const buf = dataUrl[2] ? Buffer.from(dataUrl[3], 'base64') : Buffer.from(decodeURIComponent(dataUrl[3]));
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.send(buf);
    }
    const { buffer, contentType } = await readEventObject(url);
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(buffer);
  } catch (error) {
    console.error('eventHeadController viewEventImage error:', error.message || error);
    return res.status(error.status || 500).json({ message: error.message });
  }
};

// ─── ATTENDANCE ───
export const createAttendance = async (req, res) => {
  try {
    const att = await EventHead.createAttendance(req.params.eventId, sanitize(req.body));
    return res.status(201).json(att);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const listAttendance = async (req, res) => {
  try {
    const attendance = await EventHead.getAttendanceByEvent(req.params.eventId);
    return res.json(attendance);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── CHECKLIST ───
export const getChecklist = async (req, res) => {
  try {
    const items = await EventHead.getChecklistByEvent(req.params.eventId);
    return res.json(items);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const updateChecklistItem = async (req, res) => {
  try {
    const item = await EventHead.upsertChecklistItem(req.params.eventId, { id: req.params.itemId, ...sanitize(req.body) });
    return res.json(item);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const createChecklistItem = async (req, res) => {
  try {
    const item = await EventHead.createChecklistItem(req.params.eventId, sanitize(req.body));
    return res.status(201).json(item);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── PARTNERS ───
export const listPartners = async (req, res) => {
  try {
    const partners = await EventHead.getAllPartners();
    return res.json(partners);
  } catch (error) {
    return res.json([]);
  }
};

// ─── DONORS ───
export const listDonors = async (req, res) => {
  try {
    const donors = await EventHead.getAllDonors();
    return res.json(donors);
  } catch (error) {
    return res.json([]);
  }
};

// ─── REPORTS ───
export const generateEventReport = async (req, res) => {
  try {
    const event = await EventHead.getEventHeadEventById(req.params.eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const expenses = await EventHead.getExpensesByEvent(req.params.eventId);
    const attendance = await EventHead.getAttendanceByEvent(req.params.eventId);
    const media = await EventHead.getMediaByEvent(req.params.eventId);
    const checklist = await EventHead.getChecklistByEvent(req.params.eventId);
    const distributions = await EventHead.getDistributionsByEvent(req.params.eventId);
    const socialRows = await EventHead.getSocialTracking(req.params.eventId).catch(() => []);

    const { ngoMap, ngoCodeMap, sectorMap, activityMap } = await buildEventContextMaps();
    const activitiesList = await EventHead.getAllActivities().catch(() => []);
    const activityById = {}; for (const a of activitiesList) activityById[a.id] = a;
    const evActivity = event.activity_id != null ? activityById[event.activity_id] : null;

    const day = event.date ? new Date(String(event.date).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : null;

    // Resolve the event's NGO branding so the daily report shows the same logo,
    // name and colour as that NGO's monthly card.
    const ngoName = event.ngo_id != null ? ngoMap[event.ngo_id] || null : null;
    const ngoCode = event.ngo_id != null ? String(ngoCodeMap[event.ngo_id] || '') : '';
    const ngoIdBanner = Array.isArray(media) ? (media.find(m => m.media_type === 'Banner') || {}).url || null : null;

    const enrichedEvent = {
      ...event,
      ngo_name: ngoName,
      ngo_code: ngoCode,
      ngo_logo: ngoLogoFor(ngoCode),
      ngo_banner: ngoHeaderBannerFor(ngoName, ngoCode),
      sector_name: event.sector_id != null ? sectorMap[event.sector_id] || null : null,
      activity_name: evActivity ? evActivity.name : (event.activity_id != null ? activityMap[event.activity_id] || null : null),
      banner: event.banner || (evActivity ? evActivity.banner || null : null) || ngoIdBanner || eventDefaultImage(event),
      day,
    };

    const report = { event: enrichedEvent, expenses, attendance, media, checklist, distributions, social: mergeSocialDefaults(socialRows), generated_at: new Date() };
    return res.json(report);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── ALL-EVENTS SUMMARY REPORT ───
export const generateAllEventsReport = async (req, res) => {
  try {
    const ngo_id = ownNgoId(req) || req.query.ngo_id || undefined;
    const { status, month, year } = req.query;
    const events = await EventHead.getAllEventHeadEvents({ ngo_id, status, month, year });
    const ctx = await buildEventContextMaps();
    const enriched = await enrichEvents(events, ctx);
    // Fetch Banner media rows for all events to fill missing banners
    const eventIds = enriched.map(e => e.id).filter(Boolean);
    const bannerRows = await EventHead.getBannerMediaByEvents(eventIds);
    const bannerMap = {};
    for (const row of bannerRows) {
      if (!bannerMap[row.event_id]) bannerMap[row.event_id] = row.url;
    }
    const rows = enriched.map(e => ({
      id: e.id,
      name: e.name,
      ngo_name: e.ngo_name || null,
      sector_name: e.sector_name || null,
      activity_name: e.activity_name || null,
      date: e.date || null,
      day: e.date ? new Date(String(e.date).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : null,
      start_time: e.start_time || null,
      end_time: e.end_time || null,
      venue: e.venue || null,
      status: e.status || null,
      budget: e.budget != null ? Number(e.budget) : null,
      banner: e.banner || bannerMap[e.id] || eventDefaultImage(e),
    }));
    return res.json({ events: rows, total: rows.length, generated_at: new Date() });
  } catch (error) {
    console.error('generateAllEventsReport error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── NGO MONTHLY REPORT ───
// The five deliverables a planner cell holds. The Monthly Planner paints a
// cell green only when ALL of them are finished and the head accepted the
// member's report for that day; the report reads the same rule so the two
// screens never disagree about the same month.
const PLANNER_CONTENT_TYPES = [
  'Banner', 'YouTube Video', 'Instagram Reels', 'Instagram Photos', 'Captions & Heading',
];

/* Which planner cells (day + festival) the team has finished, read straight
   from the two tables the planner itself reads:
     - `task_assignments` — one row per deliverable, with the day the work was
       really done (`completed_date`);
     - `daily_reports`   — the member's report, `review_status = accepted` when
       the Social head signed it off.

   A deliverable counts as done when the member finished it AND the head
   accepted that member's report for the planned day or for the completion
   day. A cell is finished when all five deliverables are done.

   Returns a map "YYYY-MM-DD::festival" → { done, total, allDone }. A database
   that was never migrated for these columns simply has no finished cell — the
   report then falls back to the event's own status. */
const loadPlannerDoneCells = async (month, year) => {
  const cells = new Map();
  try {
    const taskCols = await getTableColumns('task_assignments');
    const reportCols = await getTableColumns('daily_reports');
    if (!taskCols.includes('completed_date') || !reportCols.includes('review_status')) return cells;
    const mm = String(Number(month)).padStart(2, '0');
    const monthKey = `${year}-${mm}`;
    const start = `${monthKey}-01`;
    const end = monthEndExclusive(monthKey);
    const tasksQuery = db.from('task_assignments')
      .select('task_date, title, content_type, assignee_id, completed_date')
      .eq('panel', 'social')
      .gte('task_date', start).lt('task_date', end);
    const tasksRes = await tasksQuery;
    const taskDays = [...new Set((tasksRes?.data || [])
      .map(t => String(t.task_date || '').slice(0, 10))
      .filter(Boolean))];
    const completedDays = [...new Set((tasksRes?.data || [])
      .map(t => String(t.completed_date || '').slice(0, 10))
      .filter(Boolean))];
    const reportDays = [...new Set([...taskDays, ...completedDays])];
    // Accepted reports may land on the completion day, which can sit in a
    // different month than the task itself. Query those days too, so a
    // programme finished in another month still counts as done here.
    let reportsQuery = db.from('daily_reports')
      .select('reporter_id, report_date')
      .eq('panel', 'social')
      .eq('review_status', 'accepted');
    if (reportDays.length) {
      reportsQuery = reportsQuery.in('report_date', reportDays);
    } else {
      reportsQuery = reportsQuery.gte('report_date', start).lt('report_date', end);
    }
    const reportsRes = await reportsQuery;
    if (tasksRes?.error) throw tasksRes.error;
    if (reportsRes?.error) throw reportsRes.error;
    const accepted = new Set((reportsRes?.data || [])
      .map(r => `${r.reporter_id}::${String(r.report_date || '').slice(0, 10)}`));
    const TEST_TITLES = new Set(['demo', 'dem0', 'test', 'werwer']);
    const groups = new Map();
    for (const t of (tasksRes?.data || [])) {
      const title = String(t.title || '').trim().toLowerCase();
      if (TEST_TITLES.has(title)) continue;
      const day = String(t.task_date || '').slice(0, 10);
      const key = `${day}::${String(t.title || '').trim()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    for (const [key, rows] of groups) {
      const day = key.split('::')[0];
      let done = 0;
      for (const r of rows) {
        const doneDay = String(r.completed_date || '').slice(0, 10);
        if (!doneDay) continue;
        const who = String(r.assignee_id || '');
        if (accepted.has(`${who}::${day}`) || accepted.has(`${who}::${doneDay}`)) done += 1;
      }
      cells.set(key, {
        done,
        total: rows.length,
        allDone: rows.length === PLANNER_CONTENT_TYPES.length && done === PLANNER_CONTENT_TYPES.length,
      });
    }
  } catch (error) {
    console.error('[monthly-report] planner done cells failed:', error.message);
  }
  return cells;
};

// Groups events by NGO for a selected month/year and returns a per-NGO KPI
// summary (event counts, submitted/completed, beneficiaries, budget). Supports
// an optional ngo_id filter so the UI can show "All NGOs" or a single NGO.
export const generateNgoMonthlyReport = async (req, res) => {
  try {
    const month = String(req.query.month || '').trim();
    const year = String(req.query.year || '').trim();
    const ngo_id = ownNgoId(req) || req.query.ngo_id || undefined;

    if (!month || !year) {
      return res.status(400).json({ message: 'month and year are required' });
    }

    const ctx = await buildEventContextMaps();

    // The Monthly Report lists what the Monthly Planner actually planned for the
    // month: its SELECTED Festival / Day rows, one row per programme. The raw
    // event listing is deliberately NOT used — it also carries test, demo and
    // duplicate events that were never planned in the planner, and its
    // ngo+name+date dedupe collapses rows the planner still wants listed.
    const festRows = await EventHead.getFestivalSuggestions({
      month, year, ngo_id, selected_only: true,
    }).catch(() => []);

    // Photos for the planner rows. A programme shows the photo of the event it
    // was turned into, resolved (in order) through suggested_event_id, the
    // durable planner link (date + festival + NGO), then a name+date+NGO match —
    // with the uploaded banner first and the event's ★ default photo (images[0])
    // after it. Rows with no linked event simply carry no photo. Every step is
    // scoped to the row's own NGO, so a row is never credited with another
    // NGO's event — the report's "Completed" badge is exactly this photo.
    const events = await EventHead.getAllEventHeadEvents({ ngo_id, month, year }).catch(() => []);
    const eventById = new Map(events.map(e => [String(e.id), e]));
    const eventByNameDate = new Map();
    for (const e of events) {
      const k = `${e.ngo_id != null ? String(e.ngo_id) : ''}|${String(e.date || '').slice(0, 10)}|${String(e.name || '').trim().toLowerCase()}`;
      if (!eventByNameDate.has(k)) eventByNameDate.set(k, e);
    }
    // The month's events per NGO + day, and the events a row has already
    // claimed. A row that no link points at can still find the event that was
    // made for it on that day (a typed programme is never saved as a row, and
    // an older event can lose its link), and two rows never share one event.
    const eventsByNgoDate = new Map();
    for (const e of events) {
      const k = `${e.ngo_id != null ? String(e.ngo_id) : ''}|${String(e.date || '').slice(0, 10)}`;
      if (!eventsByNgoDate.has(k)) eventsByNgoDate.set(k, []);
      eventsByNgoDate.get(k).push(e);
    }
    const claimedEventIds = new Set();
    const includedEventIds = new Set();
    const eventBannerMap = {};
    try {
      const bannerRows = await EventHead.getBannerMediaByEvents(events.map(e => e.id).filter(Boolean));
      for (const row of bannerRows) {
        if (!eventBannerMap[row.event_id]) eventBannerMap[row.event_id] = row.url;
      }
    } catch { /* banners are optional */ }
    const mm = String(Number(month)).padStart(2, '0');
    const next = new Date(Number(year), Number(month), 1);
    const links = await EventHead.getPlannerEventLinks({
      ngo_id,
      start: `${year}-${mm}-01`,
      end: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`,
    }).catch(() => []);
    // Drop stale / demo links so they never resurface as report cards. A link
    // whose event no longer exists (or is a demo) is removed both here and in
    // the store, and the in-memory list is filtered so this report is clean.
    const staleLinks = (Array.isArray(links) ? links : []).filter((l) => {
      const ev = eventById.get(String(l?.event_id));
      if (!ev) return true;
      return String(ev?.name || '').toLowerCase().includes('demo');
    });
    for (const l of staleLinks) {
      EventHead.deletePlannerEventLink({
        observance_date: l?.observance_date,
        festival: l?.festival,
        ngo_id: l?.ngo_id,
      }).catch(() => {});
    }
    const cleanLinks = (Array.isArray(links) ? links : []).filter((l) => !staleLinks.includes(l));
    // Keyed by NGO as well as date + festival: BSCT and MANN may both plan the
    // same festival on the same date, and one NGO's event must never resolve
    // onto the other's row (which is what showed a MANN programme as completed
    // under BSCT). A link with no NGO is stored as '' and only ever matches a
    // row that also has none.
    const linkMap = new Map(cleanLinks.map(l => [
      `${String(l.ngo_id ?? '')}|${String(l.observance_date).slice(0, 10)}|${String(l.festival || '').trim()}`,
      l.event_id,
    ]));
    const linkedEventIds = new Set([...linkMap.values()].map(v => String(v)));
    // The event a planner row was turned into. Resolved in the same order the
    // photo is: the suggestion's own link, then the durable planner link
    // (date + festival + NGO), then a name+date+NGO match for events that
    // predate the link feature, and finally the one event the NGO has on that
    // day that no other row has claimed — a programme typed into the planner
    // is never saved as a row, so it has no link of its own. Every step is
    // scoped to the row's own NGO, so a row is never credited with another
    // NGO's event, and an event is only ever credited to one row.
    const linkedEventFor = (ngoId, date, festival, suggestedId, programme) => {
      const f = String(festival || '').trim();
      const ngoKey = ngoId != null && ngoId !== '' ? String(ngoId) : '';
      const evId = suggestedId != null ? suggestedId : linkMap.get(`${ngoKey}|${date}|${f}`);
      let linked = evId != null ? eventById.get(String(evId)) : null;
      if (!linked) linked = eventByNameDate.get(`${ngoKey}|${date}|${f.toLowerCase()}`);
      if (!linked) {
        const sameDay = (eventsByNgoDate.get(`${ngoKey}|${date}`) || [])
          .filter(e => !claimedEventIds.has(String(e.id)));
        if (sameDay.length === 1) {
          linked = sameDay[0];
        } else if (sameDay.length > 1) {
          // More than one event that day: the one whose name speaks of the
          // festival or of the planned programme wins, else the newest.
          const prog = String(programme || '').trim().toLowerCase();
          const fl = f.toLowerCase();
          linked = sameDay.find(e => {
            const n = String(e.name || '').trim().toLowerCase();
            return (fl && n.includes(fl)) || (prog && n.includes(prog));
          }) || sameDay.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
        }
      }
      if (linked) claimedEventIds.add(String(linked.id));
      return linked || null;
    };
    const imageForEvent = (linked) => {
      if (!linked) return { url: null };
      // The caller needs to know WHICH event photo this is, because the event
      // head's bucket is private: the browser must read it back through the
      // authenticated proxy, both to show it and to rasterise it into the PDF.
      const banner = eventBannerMap[String(linked.id)];
      if (banner) return { url: banner, event_id: linked.id, kind: 'banner', index: 0 };
      const photo = eventDefaultImage(linked);
      return photo ? { url: photo, event_id: linked.id, kind: 'photo', index: 0 } : { url: null };
    };

    /* The report shows what was actually COMPLETED — nothing else.
       An event that is still a Draft (created but never sent), Submitted
       (waiting for the head's approval), Rejected, Postponed or Cancelled was
       not finished, so it does not belong on the report card. "Approved" and
       "Completed" are the two states that mean the programme was carried out
       and accepted. */
    const COMPLETE_STATUS = ['completed', 'approved'];
    const isComplete = (e) => COMPLETE_STATUS.includes(String(e?.status || '').trim().toLowerCase());

    /* …but a programme can also be finished without its event being approved
       yet, and the Monthly Planner is where the team sees that: a cell turns
       green once all FIVE deliverables carry a completion day and the Social
       head accepted the member's daily report for that day. The planner also
       turns such a programme into a real event (that is the "Create Event"
       button it offers). So the report must not stop at the event's status —
       a programme the planner counts as done belongs on the report, otherwise
       the two screens disagree about the same month (the planner shows the
       work finished, the report shows nothing at all).

       Both signals are read from the same tables the planner reads:
       `task_assignments` (the five deliverables) and `daily_reports` (the
       head's acceptance). The cell key is "day::festival" — the same key the
       planner's own grid uses. */
    // A programme the planner counts as finished is COMPLETED for the report,
    // even while its event record is still a Draft waiting for the head's
    // approval — the work is what the report is about.
    const plannerCells = await loadPlannerDoneCells(month, year);
     const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/[.\s]+$/g, '').replace(/\s+/g, ' ');
     const plannerDoneCell = (date, festival) => {
       const d = String(date || '').slice(0, 10);
       const f = String(festival || '').trim();
       const c = plannerCells.get(`${d}::${f}`);
       if (c && c.allDone) return true;
       // Tolerate trailing punctuation / whitespace differences between the
       // event name and the planner task title.
       for (const [k, v] of plannerCells) {
         if (!v || !v.allDone) continue;
         const [kd, kf] = k.split('::');
         if (kd !== d) continue;
         if (normalizeName(kf) === normalizeName(f)) return true;
       }
       return false;
     };

    // Manual ("Write Manually") rows for this month/NGO. They carry their own
    // programme text and survive a reload, so they belong on the report too.
    const manualRows = await EventHead.getPlannerManualRows({
      month, year, ngo_id: ngo_id != null ? String(ngo_id) : '',
    }).catch(() => []);

    // Merge the report's data sources so the report mirrors the Monthly Planner's
    // completed/downloadable rows: selected festival suggestions PLUS durable
    // planner links (rows whose event was created) PLUS manual programmes.
    // Dedup by ngo_id|date|festival so a row is never listed twice.
    const coveredKeys = new Set(
      (Array.isArray(festRows) ? festRows : []).map((f) =>
        `${f.ngo_id != null ? String(f.ngo_id) : 'unknown'}|${String(f.observance_date || '').slice(0, 10)}|${String(f.festival || '').trim()}`
      )
    );
    const reportRows = [...(Array.isArray(festRows) ? festRows : [])];

    for (const l of (Array.isArray(cleanLinks) ? cleanLinks : [])) {
      const lk = `${l.ngo_id != null ? String(l.ngo_id) : 'unknown'}|${String(l.observance_date || '').slice(0, 10)}|${String(l.festival || '').trim()}`;
      if (coveredKeys.has(lk)) continue;
      coveredKeys.add(lk);
      const ev = eventById.get(String(l.event_id));
      reportRows.push({
        id: `link-${l.id}`,
        ngo_id: l.ngo_id,
        observance_date: l.observance_date,
        festival: l.festival,
        title: ev?.name || l.festival || null,
        activity_name: null,
        sector_name: null,
        beneficiary: null,
        location: ev?.venue || null,
        suggested_event_id: l.event_id,
        source: 'link',
      });
    }

    for (const mr of (Array.isArray(manualRows) ? manualRows : [])) {
      const mk = `${mr.row_ngo_id != null && mr.row_ngo_id !== '' ? String(mr.row_ngo_id) : (mr.ngo_id != null ? String(mr.ngo_id) : 'unknown')}|${String(mr.observance_date || '').slice(0, 10)}|${String(mr.festival || mr.name || '').trim()}`;
      if (coveredKeys.has(mk)) continue;
      const prog = String(mr.body_text || mr.name || '').trim();
      if (!prog) continue;
      if (!mr.is_selected) continue;
      coveredKeys.add(mk);
      reportRows.push({
        id: `manual-${mr.id}`,
        ngo_id: mr.row_ngo_id != null && mr.row_ngo_id !== '' ? mr.row_ngo_id : mr.ngo_id,
        observance_date: mr.observance_date,
        festival: mr.festival || mr.name || null,
        title: prog,
        activity_name: null,
        sector_name: null,
        beneficiary: mr.beneficiary || null,
        location: mr.location || null,
        suggested_event_id: null,
        source: 'manual',
      });
    }

    const byNgo = new Map();
    // Seed a card for every report NGO (BSCT / MANN / AFLF) up front, so an NGO
    // with no planner-created events this month still shows its (blank) card
    // instead of vanishing from the report.
    const REPORT_NGO_KEYS = ['bsct', 'aflf', 'mann'];
    const seedNgoCard = (ngoId, name, code) => {
      const id = ngoId != null ? String(ngoId) : 'unknown';
      if (byNgo.has(id)) return byNgo.get(id);
      const c = String(code || (ctx.ngoCodeMap ? ctx.ngoCodeMap[ngoId] : '') || '').toLowerCase();
      const ngoName = name || ctx.ngoMap[ngoId] || `NGO ${ngoId || ''}`.trim();
      const row = {
        ngo_id: ngoId != null ? ngoId : null,
        ngo_name: ngoName,
        code: c,
        logo: ngoLogoFor(c),
        banner: ngoHeaderBannerFor(ngoName, ngoName),
        events_count: 0,
        submitted: 0,
        completed: 0,
        pending: 0,
        beneficiaries: 0,
        budget: 0,
        events: [],
      };
      byNgo.set(id, row);
      return row;
    };
    for (const n of (ctx.ngos || [])) {
      const key = String(n.code || n.name || '').toLowerCase();
      if (!REPORT_NGO_KEYS.some(k => key.includes(k))) continue;
      if (ngo_id && String(n.id) !== String(ngo_id)) continue;
      seedNgoCard(n.id, n.name, n.code);
    }
    for (const f of reportRows) {
      const id = f.ngo_id != null ? String(f.ngo_id) : 'unknown';
      const code = ctx.ngoCodeMap ? (ctx.ngoCodeMap[f.ngo_id] || '') : '';
      seedNgoCard(f.ngo_id, ctx.ngoMap[f.ngo_id], code);
      const row = byNgo.get(id);
      const d = f.observance_date ? String(f.observance_date).slice(0, 10) : null;
      // The event this row was turned into, resolved ONCE so the card's title
      // and its photo can never come from two different events.
      const linked = linkedEventFor(f.ngo_id, d, f.festival, f.suggested_event_id, f.title || f.activity_name);
      // A planned row reaches the report only when the programme was actually
      // FINISHED, and nothing about it is still waiting:
      //   - the event it became is approved / completed (the head signed the
      //     event off), OR
      //   - the planner has this cell finished: all five deliverables carry a
      //     completion day and the head accepted the member's daily report for
      //     it — the planner's own green "Done" — and there is no event record
      //     waiting for approval.
      // A row whose event is still Draft / Submitted is work waiting for the
      // head's approval, not a finished programme, so it stays off the report
      // until it is approved. A row that is only a plan does not belong here
      // either.
      const cellDone = plannerDoneCell(d, f.festival);
      // Mirror the Monthly Planner's Download button: a row shows Download when
      // it owns a durable link (event created for it) OR it is all-done and an
      // event matches it (name+date+NGO). Keep the two in sync here.
      const fromLink = f.source === 'link';
      if (!fromLink && !(cellDone && linked)) continue;
      const img = imageForEvent(linked);
      const eventName = String(linked?.name || '').trim();
      row.events_count += 1;
      row.events.push({
        id: f.id,
        name: eventName || f.festival || null,
        festival: eventName || f.festival || null,
        event_name: eventName || null,
        festival_name: f.festival || null,
        programme: f.title || f.activity_name || null,
        beneficiary: f.beneficiary || null,
        date: d,
        day: d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : null,
        sector_name: f.sector_name || null,
        activity_name: f.activity_name || null,
        venue: f.location || null,
        status: isComplete(linked) ? (linked?.status || null) : 'completed',
        budget: null,
        beneficiaries: 0,
        image: img.url || null,
        image_event_id: img.event_id || null,
        image_kind: img.kind || null,
        image_index: img.index || 0,
         banner: null,
       });
        if (linked?.id != null) includedEventIds.add(String(linked.id));
      }

      // Final pass: any event for this month/NGO that has not yet been credited
      // to a row (no planner link / no selected suggestion pointed at it) still
      // reaches the report when the programme was actually completed — either
      // the event is approved/completed, or the planner marks the cell done.
      // This keeps the report in step with the Monthly Planner's Download buttons.
      for (const ev of (Array.isArray(events) ? events : [])) {
        if (includedEventIds.has(String(ev.id))) continue;
        if (String(ev?.name || '').toLowerCase().includes('demo')) continue;
        const evDate = String(ev?.date || '').slice(0, 10);
        const cellDone = plannerDoneCell(evDate, ev?.name);
        if (!isComplete(ev) && !cellDone) continue;
        const id = ev.ngo_id != null ? String(ev.ngo_id) : 'unknown';
        const code = ctx.ngoCodeMap ? (ctx.ngoCodeMap[ev.ngo_id] || '') : '';
        seedNgoCard(ev.ngo_id, ctx.ngoMap ? ctx.ngoMap[ev.ngo_id] : null, code);
        const row = byNgo.get(id);
        if (!row) continue;
        const img = imageForEvent(ev);
        row.events_count += 1;
        row.events.push({
          id: `event-${ev.id}`,
          name: String(ev.name || '').trim() || null,
          festival: String(ev.name || '').trim() || null,
          event_name: String(ev.name || '').trim() || null,
          festival_name: null,
          programme: String(ev.name || '').trim() || null,
          beneficiary: null,
          date: evDate,
          day: evDate ? new Date(evDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : null,
          sector_name: null,
          activity_name: null,
          venue: ev.venue || null,
          status: isComplete(ev) ? (ev.status || null) : 'completed',
          budget: null,
          beneficiaries: 0,
          image: img.url || null,
          image_event_id: img.event_id || null,
          image_kind: img.kind || null,
          image_index: img.index || 0,
          banner: null,
          source: 'event',
        });
        includedEventIds.add(String(ev.id));
      }

      const ngos = [...byNgo.values()]
      .map(n => ({ ...n, budget: Math.round(n.budget) }))
      .sort((a, b) => a.ngo_name.localeCompare(b.ngo_name));

    // The ideas the head TICKED in "Suggest Programmes" are the same decision
    // the festival grid rows are — "this programme is planned for this month" —
    // but they live in their own table, so the report never saw them and a
    // ticked idea was invisible here. An idea reaches the report only when the
    // programme it became was actually completed; an idea that is still a plan
    // (or that has no event at all) stays out, exactly like a pending festival
    // row does.
    const planRows = await EventHead.getPlannerSuggestions({ ngo_id, month, year, selected_only: true }).catch(() => []);
    const planAll = await EventHead.getPlannerSuggestions({ ngo_id, month, year }).catch(() => []);
    const titleKey = (t) => String(t || '').trim().toLowerCase();
    for (const p of planRows) {
      // Skip suggestion-level cards: report mirrors festival rows / Download buttons.
      continue;
      const id = p.ngo_id != null ? String(p.ngo_id) : 'unknown';
      const code = ctx.ngoCodeMap ? (ctx.ngoCodeMap[p.ngo_id] || '') : '';
      seedNgoCard(p.ngo_id, ctx.ngoMap[p.ngo_id], code);
      const row = byNgo.get(id);
      const title = String(p.title || '').trim();
      // The event this idea became. It is listed when the programme was
      // finished: the event is approved / completed.
      const linked = p.event_id != null ? eventById.get(String(p.event_id)) : null;
      if (!isComplete(linked)) continue;
      if ((row.events || []).some((e) => titleKey(e.programme) === titleKey(title))) continue;
      const d = (p.event_date ? String(p.event_date).slice(0, 10) : null)
        || (linked?.date ? String(linked.date).slice(0, 10) : null);
      const img = imageForEvent(linked);
      row.events_count += 1;
      row.events.push({
        id: `plan-${p.id}`,
        name: String(linked?.name || '').trim() || title || null,
        festival: String(linked?.name || '').trim() || title || null,
        event_name: String(linked?.name || '').trim() || title || null,
        festival_name: null,
        programme: title || null,
        beneficiary: p.beneficiary_group || null,
        date: d,
        day: d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : null,
        sector_name: null,
        activity_name: ctx.activityMap ? (ctx.activityMap[p.activity_id] || null) : null,
        venue: linked?.venue || null,
        status: isComplete(linked) ? (linked?.status || null) : 'completed',
        budget: null,
        beneficiaries: 0,
        image: img.url || null,
        image_event_id: img.event_id || null,
        image_kind: img.kind || null,
        image_index: img.index || 0,
        banner: null,
        source: 'suggestion',
      });
    }

    // A completed programme is listed even when no planned row covers it: a
    // programme typed into the planner is never saved as a row, and an event
    // whose link was overwritten has no row of its own either. Without this the
    // event — and the name it was saved under — would simply be missing from
    // the month.
    //
    // Listed when the programme was finished: the event is approved /
    // completed. A plain DRAFT event nobody finished anything on, a Submitted
    // one still waiting for the head's approval, and Postponed / Cancelled /
    // Rejected never happened — none of them belongs on a report of what was
    // done. So the report is a record of what was COMPLETED, not a plan of
    // what is to be done.
    // One programme of one NGO on one day. The name is part of the key because
    // an NGO can run two festivals on the same day and they are two programmes.
    const programmeKey = (e) => {
      const ngo = e.ngo_id != null ? String(e.ngo_id) : '';
      const d = e.date ? String(e.date).slice(0, 10) : '';
      const n = String(e.name || '').trim().toLowerCase();
      return n ? `${ngo}|${d}|${n}` : '';
    };
    // The same programme saved twice (same NGO, date and name) is one
    // programme — the second row is a duplicate, not a second programme.
    const listedProgrammes = new Set();
    for (const n of ngos) {
      const ngoKey = String(n.ngo_id ?? '');
      const extras = events
        .filter(() => false) // report mirrors the planner rows only
        .filter(e => {
          const k = programmeKey(e);
          if (!k) return true;
          if (listedProgrammes.has(k)) return false;
          listedProgrammes.add(k);
          return true;
        })
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
       if (!extras.length) continue;
       for (const e of extras) {
         const id = e.ngo_id != null ? String(e.ngo_id) : 'unknown';
         const code = ctx.ngoCodeMap ? (ctx.ngoCodeMap[e.ngo_id] || '') : '';
         seedNgoCard(e.ngo_id, ctx.ngoMap[e.ngo_id], code);
       }
       const extraCards = extras.map(e => {
        const d = e.date ? String(e.date).slice(0, 10) : null;
        const img = imageForEvent(e);
        return {
          id: `event-${e.id}`,
          name: String(e.name || '').trim() || null,
          festival: String(e.name || '').trim() || null,
          event_name: String(e.name || '').trim() || null,
          festival_name: null,
          programme: null,
          beneficiary: null,
          date: d,
          day: d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : null,
          sector_name: null,
          activity_name: e.activity_name || null,
          venue: e.venue || null,
          status: isComplete(e) ? (e.status || null) : 'completed',
          budget: null,
          beneficiaries: 0,
          image: img.url || null,
          image_event_id: img.event_id || null,
          image_kind: img.kind || null,
          image_index: img.index || 0,
          banner: null,
        };
      });
      // Keep the card in date order: the planned rows are already sorted by
      // their observance date, so the extra cards slot into that sequence.
      const planned = n.events.slice();
      const merged = [];
      let i = 0;
      for (const card of extraCards) {
        while (i < planned.length && String(planned[i].date || '') <= String(card.date || '')) {
          merged.push(planned[i]);
          i += 1;
        }
        merged.push(card);
      }
      while (i < planned.length) { merged.push(planned[i]); i += 1; }
      n.events = merged;
      n.events_count = n.events.length;
    }

    const totalEvents = ngos.reduce((s, n) => s + n.events_count, 0);
    const totalBudget = ngos.reduce((s, n) => s + n.budget, 0);
    const totalBeneficiaries = ngos.reduce((s, n) => s + n.beneficiaries, 0);
    // How many ideas the month holds and how many of them the head selected.
    // The difference is the reason a month can come up empty while the planner
    // is full of ideas, so the report says it out loud instead of showing a
    // blank card.
    const suggestions = planAll.length;
    const selectedSuggestions = planRows.length;

    // The order the Social head arranged the programme cards in (drag and
    // drop). It is a presentation choice, but it is stored in the database so
    // it survives a reload and is the same for everyone who opens the report.
    // A card without a stored position keeps its default order and sits after
    // the arranged ones, so a programme added after the last drag is still
    // listed.
    let savedOrder = [];
    try {
      savedOrder = await EventHead.getReportCardOrder({ month, year });
    } catch {
      /* The order table may not exist yet (a database that was never migrated
         for it). The report must still load - it just falls back to the
         default order. */
    }
    const orderByNgo = new Map();
    for (const o of savedOrder) {
      const ngoKey = String(o.ngo_id ?? '');
      if (!orderByNgo.has(ngoKey)) orderByNgo.set(ngoKey, new Map());
      orderByNgo.get(ngoKey).set(String(o.card_key), Number(o.position));
    }
    for (const n of ngos) {
      const pos = orderByNgo.get(String(n.ngo_id ?? ''));
      if (!pos || !pos.size) continue;
      n.events = n.events
        .map((ev, i) => ({ ev, i, p: pos.has(String(ev.id)) ? pos.get(String(ev.id)) : null }))
        .sort((a, b) => {
          const pa = a.p == null ? Number.MAX_SAFE_INTEGER : a.p;
          const pb = b.p == null ? Number.MAX_SAFE_INTEGER : b.p;
          return pa - pb || a.i - b.i;
        })
        .map(x => x.ev);
    }

    return res.json({
      month: Number(month),
      year: Number(year),
      ngo_id: ngo_id || null,
      ngos,
      summary: { totalEvents, totalBudget, totalBeneficiaries, suggestions, selectedSuggestions },
      generated_at: new Date(),
    });
  } catch (error) {
    console.error('generateNgoMonthlyReport error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

/* Saves the order the programme cards were dragged into, for one month and one
   NGO. The whole order of that NGO is replaced, so a card that left the report
   cannot leave a stale position behind. The report itself comes back in the
   saved order, so there is no separate read for it. */
export const setMonthlyReportCardOrder = async (req, res) => {
  try {
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ message: 'month (1-12) is required' });
    }
    if (!Number.isInteger(year) || year < 2000) {
      return res.status(400).json({ message: 'year is required' });
    }
    if (!Array.isArray(req.body?.order)) {
      return res.status(400).json({ message: 'order (array of card keys) is required' });
    }
    if (req.body.order.length > 500) {
      return res.status(400).json({ message: 'order has too many cards' });
    }
    const order = req.body.order.map(k => String(k ?? '').trim());
    if (order.some(k => !k)) {
      return res.status(400).json({ message: 'order contains an empty card key' });
    }
    const ngoId = req.body?.ngo_id != null && req.body.ngo_id !== '' ? String(req.body.ngo_id) : '';
    const saved = await EventHead.setReportCardOrder({
      month,
      year,
      ngo_id: ngoId,
      order,
      updated_by: req.user?.id ?? req.user?.email ?? null,
    });
    return res.json({ order: saved });
  } catch (error) {
    console.error('setMonthlyReportCardOrder error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── APPROVALS LIST ───
export const listApprovals = async (req, res) => {
  try {
    const events = await EventHead.getAllEventHeadEvents();
    return res.json(events);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── NGO CONTEXT (read-only for the Event Head workspace) ───
export const listEventHeadNgos = async (req, res) => {
  try {
    const ngos = await EventHead.getAllEventHeadNgos();
    const scope = ownNgoId(req);
    return res.json(scope ? ngos.filter(n => String(n.id) === scope) : ngos);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── SECTORS ───
export const listSectors = async (req, res) => {
  try {
    const ngo_id = ownNgoId(req) || req.query.ngo_id;
    const [sectors, activityCounts, eventCounts] = await Promise.all([
      EventHead.getAllEventHeadSectors(),
      EventHead.getSectorActivityCounts(ngo_id),
      EventHead.getSectorEventCounts(ngo_id),
    ]);
    const enriched = sectors.map(s => ({
      ...s,
      activity_count: activityCounts[s.id] || 0,
      event_count: eventCounts[s.id] || 0,
    }));
    return res.json(enriched);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const createSector = async (req, res) => {
  try {
    const clean = sanitize(req.body);
    if (!String(clean.name || '').trim()) return res.status(400).json({ message: 'Sector name is required' });
    const sector = await EventHead.createEventHeadSector({ name: clean.name, description: clean.description });
    return res.status(201).json(sector);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── ACTIVITIES ───
export const listActivities = async (req, res) => {
  try {
    const ngo_id = ownNgoId(req) || req.query.ngo_id;
    const { sector_id } = req.query;
    const [activities, ngos, sectors, eventCounts] = await Promise.all([
      EventHead.getAllActivities({ ngo_id, sector_id }),
      EventHead.getAllEventHeadNgos().catch(() => []),
      EventHead.getAllEventHeadSectors().catch(() => []),
      EventHead.getActivityEventCounts(),
    ]);
    const ngoNames = {}; for (const n of ngos) ngoNames[n.id] = n.name || n.code;
    const sectorNames = {}; for (const s of sectors) sectorNames[s.id] = s.name;
    const enriched = activities.map(a => ({
      ...a,
      ngo_name: a.ngo_id ? ngoNames[a.ngo_id] || null : 'All NGOs',
      sector_name: sectorNames[a.sector_id],
      event_count: eventCounts[a.id] || 0,
    }));
    return res.json(enriched);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const getActivity = async (req, res) => {
  try {
    const activity = await EventHead.getActivityById(req.params.id);
    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    const [ngo, sectors, eventCounts, events] = await Promise.all([
      EventHead.getEventHeadNgoById(activity.ngo_id),
      EventHead.getAllEventHeadSectors().catch(() => []),
      EventHead.getActivityEventCounts(),
      EventHead.getAllEventHeadEvents().catch(() => []),
    ]);
    const sector = sectors.find(s => s.id === activity.sector_id) || null;
    const activityEvents = (events || []).filter(e => e.activity_id === activity.id)
      .map(e => ({ id: e.id, name: e.name, date: e.date, status: e.status, venue: e.venue }));
    return res.json({
      ...activity,
      ngo_name: activity.ngo_id ? (ngo ? ngo.name || ngo.code : null) : 'All NGOs',
      sector_name: sector ? sector.name : null,
      sector_description: sector ? sector.description : null,
      event_count: eventCounts[activity.id] || 0,
      events: activityEvents,
    });
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const createActivity = async (req, res) => {
  try {
    const body = sanitize(req.body);
    const name = String(body.name || '').trim();
    if (!name || !body.sector_id) {
      return res.status(400).json({ message: 'Activity name and sector are required' });
    }
    const activity = await EventHead.createActivity(canonicalBeneficiaryFields({
      ...body,
      name,
      created_by: String(req.user.id || ''),
      status: body.status || 'Active',
    }));
    return res.status(201).json(activity);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'An activity with this name already exists for this NGO' });
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── ACTIVITIES SHEET IMPORT / EXPORT ───
// Upload an Excel/CSV sheet of the user's NGO activities; rows go straight
// into the DB under each activity's NGO catalog (per-sector). When the sheet
// carries its own "NGO" column (e.g. the combined BSCT/MANN/AFLF team sheet),
// each row is assigned to the NGO named in that column. Otherwise the activity
// is assigned to the NGO selected in the dropdown / passed as ngo_code.
export const importActivities = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    const ngos = await EventHead.getAllEventHeadNgos();
    let defaultNgo = null;
    const code = String(req.body.ngo_code || '').trim().toUpperCase();
    if (code) defaultNgo = ngos.find(n => String(n.code || n.name || '').toUpperCase() === code);
    if (!defaultNgo && req.body.ngo_id) defaultNgo = ngos.find(n => String(n.id) === String(req.body.ngo_id));

    const ngoByCode = new Map();
    for (const n of ngos) ngoByCode.set(String(n.code || n.name || '').toUpperCase(), n);
    const normNgoKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const ngoByKey = new Map();
    for (const n of ngos) ngoByKey.set(normNgoKey(n.code || n.name), n);

    const { rows, hasNgoColumn } = parseActivitySheet(file.buffer);
    if (!rows.length) return res.status(400).json({ message: 'No activities found in the sheet' });

    const sectors = await EventHead.getAllEventHeadSectors();
    const sectorNames = sectors.map(s => s.name);
    const sectorByName = new Map(sectors.map(s => [s.name, s.id]));

    const prepared = [];
    const skippedCampaigns = new Set();
    const unknownSectors = new Map();
    const unknownNgos = new Map();
    const sectorCounts = {};
    const ngoCounts = {};
    const seen = new Set();
    let rowsParsed = 0;

    for (const row of rows) {
      const name = normalizeName(row.name);
      if (!name) continue;
      rowsParsed++;

      // Resolve the target NGO. Prefer a per-row NGO column when present;
      // otherwise fall back to the single NGO selected in the dropdown.
      let ngo;
      if (hasNgoColumn && row.ngoLabel) {
        ngo = ngoByKey.get(normNgoKey(row.ngoLabel)) || ngoByCode.get(String(row.ngoLabel).toUpperCase());
        if (!ngo) {
          unknownNgos.set(row.ngoLabel, (unknownNgos.get(row.ngoLabel) || 0) + 1);
          continue;
        }
      } else {
        ngo = defaultNgo;
      }
      if (!ngo) return res.status(404).json({ message: `NGO not found. Use BSCT, MANN or AFLF.` });

      if (isCampaignName(name)) { skippedCampaigns.add(name); continue; }
      const canonical = canonicalizeSector(row.sectorLabel, sectorNames);
      const sectorId = sectorByName.get(canonical);
      if (!sectorId) {
        unknownSectors.set(row.sectorLabel, (unknownSectors.get(row.sectorLabel) || 0) + 1);
        continue;
      }
      const key = `${ngo.id}\u0000${sectorId}\u0000${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      prepared.push({
        ngo_id: ngo.id,
        sector_id: sectorId,
        name,
        description: `Imported from sheet for ${ngo.code || ngo.name}`,
        status: 'Active',
        created_by: String(req.user.id || ''),
      });
      sectorCounts[canonical] = (sectorCounts[canonical] || 0) + 1;
      ngoCounts[String(ngo.id)] = (ngoCounts[String(ngo.id)] || 0) + 1;
    }

    const inserted = await EventHead.insertActivitiesBulk(prepared);

    const perNgo = Object.entries(ngoCounts).map(([ngoId, count]) => {
      const n = ngos.find(x => String(x.id) === String(ngoId));
      return { ngo: n ? (n.code || n.name) : `NGO ${ngoId}`, count };
    });

    return res.json({
      ngo: { id: defaultNgo ? defaultNgo.id : null, code: defaultNgo ? (defaultNgo.code || defaultNgo.name) : '—', name: defaultNgo ? defaultNgo.name : '—' },
      ngo_from_file: !!hasNgoColumn,
      per_ngo: perNgo,
      sheet: file.originalname,
      rows_parsed: rowsParsed,
      inserted: inserted.length,
      skipped_existing: prepared.length - inserted.length,
      skipped_campaigns: [...skippedCampaigns],
      unknown_sectors: [...unknownSectors.entries()].map(([label, count]) => ({ sector: label, count })),
      unknown_ngos: [...unknownNgos.entries()].map(([label, count]) => ({ ngo: label, count })),
      sectors: Object.entries(sectorCounts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([sector_name, count]) => ({ sector_name, count })),
    });
  } catch (error) {
    if (error && error.message && /Could not find|NGO/.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    console.error('importActivities error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── EVENTS SHEET IMPORT / EXPORT ───
// Upload an Excel/CSV sheet of the user's NGO events; each row becomes an event
// in the DB, linked to the right NGO / Sector / Activity. Activities are matched
// by name inside the resolved sector (NGO-specific first, then "All NGOs").
export const importEvents = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    const ngos = await EventHead.getAllEventHeadNgos();
    let defaultNgo = null;
    const code = String(req.body.ngo_code || '').trim().toUpperCase();
    if (code) defaultNgo = ngos.find(n => String(n.code || n.name || '').toUpperCase() === code);
    if (!defaultNgo && req.body.ngo_id) defaultNgo = ngos.find(n => String(n.id) === String(req.body.ngo_id));

    // All-NGO mode: one sheet is imported for every event-head NGO at once
    // (BSCT + MANN + AFLF) so the user doesn't upload the same file 3 times.
    const allNgos = String(req.body.all_ngos || '').toLowerCase() === '1' || code === 'ALL';

    // Parse as an events sheet. If the sheet has NO "Event Name" and "Date"
    // column but DOES have "Sector" + "Activity / Project", it is actually an
    // activities catalog sheet (the MANN/AFLF/BSCT activity sheets the team
    // uploads). Route that to the activities import so the uploaded rows
    // populate the activity catalog instead of failing with an opaque error.
    let rows;
    let sheetFormat = null;
    try {
      const parsed = parseEventSheet(file.buffer);
      rows = parsed.rows;
      sheetFormat = parsed.format || 'date';
    } catch (eventParseErr) {
      try {
        const act = parseActivitySheet(file.buffer);
        if (act.rows && act.rows.length) {
          // Activities sheet — needs a single NGO to scope the catalog.
          if (allNgos) {
            return res.status(400).json({ message: "This sheet is an Activity catalog (Sector / Activity columns, no Event Name or Date). Activity catalogs apply to a single NGO, so pick one NGO (BSCT / MANN / AFLF) - 'All NGOs' is only for event sheets." });
          }
          const actCode = String(req.body.ngo_code || '').trim().toUpperCase();
          const actNgo = (actCode && ngos.find(n => String(n.code || n.name || '').toUpperCase() === actCode))
            || (req.body.ngo_id && ngos.find(n => String(n.id) === String(req.body.ngo_id)));
          if (!actNgo || !(actNgo.code || actNgo.name)) {
            return res.status(400).json({ message: 'This sheet is an Activity catalog (Sector / Activity columns, no Event Name or Date). Please select the NGO (MANN / AFLF / BSCT) in the dropdown above and upload again.' });
          }
          return importActivities(req, res);
        }
      } catch (_) { /* not an activities sheet either — fall through */ }
      throw eventParseErr;
    }
    if (!rows.length) return res.status(400).json({ message: 'No events found in the sheet' });

    const [sectors, activities] = await Promise.all([
      EventHead.getAllEventHeadSectors(),
      EventHead.getAllActivities().catch(() => []),
    ]);
    const sectorNames = sectors.map(s => s.name);
    const sectorByName = new Map(sectors.map(s => [s.name, s.id]));

    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const activityIdx = new Map(); // key "sectorId|ngoId|normName"
    const activityNames = new Map(); // key "sectorId|normName" -> array
    for (const a of activities || []) {
      const key = `${a.sector_id}|${a.ngo_id == null ? '' : a.ngo_id}|${norm(a.name)}`;
      activityIdx.set(key, a);
      const nk = `${a.sector_id}|${norm(a.name)}`;
      if (!activityNames.has(nk)) activityNames.set(nk, []);
      activityNames.get(nk).push(a);
    }

    const resolveActivity = (sectorId, ngoId, label) => {
      const nk = `${sectorId}|${norm(label)}`;
      const candidates = activityNames.get(nk) || [];
      if (ngoId != null) {
        const hit = candidates.find(a => String(a.ngo_id) === String(ngoId));
        if (hit) return hit;
      }
      const all = candidates.find(a => a.ngo_id == null);
      if (all) return all;
      return activityIdx.get(`${sectorId}|${ngoId == null ? '' : ngoId}|${norm(label)}`) || null;
    };

    const normNgoKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const ngoByKey = new Map();
    for (const n of ngos) ngoByKey.set(normNgoKey(n.code || n.name), n);

    const prepared = [];
    const skipped = { no_date: [], unknown_activity: [], unknown_sector: [], unknown_ngo: [], missing_activity: [], dup: [] };
    const seen = new Set();
    let parsed = 0;

    // Catalog sheets need to find-or-create the activity each event belongs to.
    const activityKey = (ngoId, sectorId, name) => `${ngoId}|${sectorId}|${String(name || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const existingActivityByKey = new Map();
    for (const a of activities || []) {
      const k = activityKey(a.ngo_id, a.sector_id, a.name);
      if (!existingActivityByKey.has(k)) existingActivityByKey.set(k, a);
    }
    const createdActivities = new Map(); // key -> row to bulk-insert
    const createdActivityId = new Map(); // key -> id (filled after insert)

    const resolveNgos = (label) => {
      if (allNgos) return ngos;
      let ngo = defaultNgo;
      if (label) ngo = ngoByKey.get(normNgoKey(label)) || defaultNgo;
      return ngo ? [ngo] : [];
    };

    for (const row of rows) {
      if (!row.name) continue;
      parsed++;

      // ── Catalog sheet: NGO | Sector | Activity | Event (builds All-Events cascade) ──
      if (row.format === 'catalog') {
        const canonical = canonicalizeSector(row.sectorLabel, sectorNames);
        const sectorId = sectorByName.get(canonical);
        if (!sectorId) { skipped.unknown_sector.push(`${row.name} (${row.sectorLabel || 'no sector'})`); continue; }
        const actName = normalizeName(row.activityLabel);
        if (!actName) { skipped.missing_activity.push(row.name); continue; }

        let na = null;
        if (row.ngoLabel) na = ngoByKey.get(normNgoKey(row.ngoLabel));
        if (!na) { skipped.unknown_ngo.push(`${row.name} (${row.ngoLabel || 'no NGO'})`); continue; }

        const key = activityKey(na.id, sectorId, actName);
        const activity = existingActivityByKey.get(key);
        if (!activity && !createdActivities.has(key)) {
          createdActivities.set(key, { ngo_id: na.id, sector_id: sectorId, name: actName, status: 'Active', created_by: String(req.user.id || '') });
        }

        const dedupeKey = `${na.id}|${sectorId}|${key}|${norm(row.name)}|catalog`;
        if (seen.has(dedupeKey)) { skipped.dup.push(row.name); continue; }
        seen.add(dedupeKey);

        prepared.push({
          name: row.name,
          date: null,
          ngo_id: na.id,
          sector_id: sectorId,
          activity_id: activity ? activity.id : null,
          _actKey: activity ? null : key,
          venue: row.venue,
          start_time: row.startTime,
          end_time: row.endTime,
          status: 'Approved',
          approval_status: 'Approved',
          budget: row.budget,
          expected_beneficiaries: row.expectedBeneficiaries,
          created_by: String(req.user.id || ''),
        });
        continue;
      }

      // ── Date-driven sheet: NGO | Event | Date | Day  (calendar)  or  legacy format ──
      const ngoList = resolveNgos(row.ngoLabel);
      if (!ngoList.length) { skipped.unknown_ngo.push(`${row.name} (${row.ngoLabel || 'no NGO'})`); continue; }

      if (!row.date) { skipped.no_date.push(row.name); continue; }

      const canonical = canonicalizeSector(row.sectorLabel, sectorNames);
      const sectorId = row.sectorLabel ? sectorByName.get(canonical) : null;
      if (row.sectorLabel && !sectorId) { skipped.unknown_sector.push(`${row.name} (${row.sectorLabel})`); continue; }

      for (const ngo of ngoList) {
        const activity = row.activityLabel && sectorId ? resolveActivity(sectorId, ngo.id, row.activityLabel) : null;
        if (row.activityLabel && !activity) skipped.unknown_activity.push(`${row.name} (${row.activityLabel})`);

        const dedupeKey = `${ngo.id}|${sectorId || 'none'}|${activity ? activity.id : 'none'}|${row.date}|${norm(row.name)}`;
        if (seen.has(dedupeKey)) { skipped.dup.push(row.name); continue; }
        seen.add(dedupeKey);

        prepared.push({
          name: row.name,
          date: row.date,
          ngo_id: ngo.id,
          sector_id: sectorId,
          activity_id: activity ? activity.id : null,
          venue: row.venue,
          start_time: row.startTime,
          end_time: row.endTime,
          status: row.status,
          approval_status: row.status === 'Approved' ? 'Approved' : 'Draft',
          budget: row.budget,
          expected_beneficiaries: row.expectedBeneficiaries,
          created_by: String(req.user.id || ''),
        });
      }
    }

    // Insert newly-created catalog activities and backfill their ids into events.
    let newActivityCount = 0;
    if (createdActivities.size) {
      const acts = await EventHead.insertActivitiesBulk([...createdActivities.values()]);
      for (const a of acts || []) createdActivityId.set(activityKey(a.ngo_id, a.sector_id, a.name), a.id);
      newActivityCount = (acts || []).length;
      for (const p of prepared) {
        if (p._actKey && createdActivityId.has(p._actKey)) p.activity_id = createdActivityId.get(p._actKey);
        delete p._actKey;
      }
    }

    const inserted = await EventHead.insertEventHeadEventsBulk(prepared);

    const perNgo =
      Object.values(prepared.reduce((acc, p) => {
        if (!acc[p.ngo_id]) acc[p.ngo_id] = { ngo_id: p.ngo_id, count: 0 };
        acc[p.ngo_id].count++;
        return acc;
      }, {}));
    const withCode = perNgo.map(pn => {
      const n = ngos.find(n => String(n.id) === String(pn.ngo_id));
      return { code: n ? (n.code || n.name) : pn.ngo_id, count: pn.count };
    });
    const insertedByNgo =
      Object.values(inserted.reduce((acc, p) => {
        if (!acc[p.ngo_id]) acc[p.ngo_id] = { ngo_id: p.ngo_id, count: 0 };
        acc[p.ngo_id].count++;
        return acc;
      }, {}));

    return res.json({
      ngo: defaultNgo ? { id: defaultNgo.id, code: defaultNgo.code || defaultNgo.name, name: defaultNgo.name } : null,
      all_ngos: allNgos || null,
      format: sheetFormat || 'date',
      activities_created: newActivityCount,
      sheet: file.originalname,
      rows_parsed: parsed,
      inserted: inserted.length,
      inserted_by_ngo: insertedByNgo.map(ib => {
        const n = ngos.find(n => String(n.id) === String(ib.ngo_id));
        return { code: n ? (n.code || n.name) : ib.ngo_id, count: ib.count };
      }),
      per_ngo: withCode,
      skipped: {
        missing_date: skipped.no_date.length,
        unknown_activity: skipped.unknown_activity.length,
        unknown_sector: skipped.unknown_sector.length,
        unknown_ngo: skipped.unknown_ngo.length,
        missing_activity: skipped.missing_activity.length,
        duplicates: skipped.dup.length,
      },
      skipped_details: {
        no_date: skipped.no_date.slice(0, 20),
        unknown_activity: skipped.unknown_activity.slice(0, 20),
        unknown_sector: skipped.unknown_sector.slice(0, 20),
        unknown_ngo: skipped.unknown_ngo.slice(0, 20),
        missing_activity: skipped.missing_activity.slice(0, 20),
        dup: skipped.dup.slice(0, 20),
      },
    });
  } catch (error) {
    if (error && error.message && /Could not find|NGO/.test(error.message)) {
      return res.status(400).json({ message: error.message });
    }
    console.error('importEvents error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// Export events to an Excel sheet honoring the current filters.
export const exportEvents = async (req, res) => {
  try {
    const { ngo_id, sector_id, activity_id, status, month, year } = req.query;
    const events = await EventHead.getAllEventHeadEvents({ ngo_id, sector_id, activity_id, status, month, year });
    const ctx = await buildEventContextMaps();
    const rows = events.map(ev => enrichEvent(ev, ctx));

    const aoa = [
      ['Event Name', 'NGO', 'Sector', 'Activity', 'Date', 'Start Time', 'End Time', 'Venue', 'Status', 'Budget', 'Expected Beneficiaries'],
    ];
    for (const e of rows) {
      aoa.push([
        e.name || '',
        e.ngo_name || '',
        e.sector_name || '',
        e.activity_name || '',
        (e.date || '').slice(0, 10),
        e.start_time ? String(e.start_time).slice(0, 5) : '',
        e.end_time ? String(e.end_time).slice(0, 5) : '',
        e.venue || '',
        e.status || '',
        e.budget != null ? Number(e.budget) : '',
        e.expected_beneficiaries != null ? Number(e.expected_beneficiaries) : '',
      ]);
    }

    const XLSX = (await import('xlsx')).default;
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Events');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="events.xlsx"');
    return res.send(buf);
  } catch (error) {
    console.error('exportEvents error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// Export the NGO's activity catalog back to an Excel sheet. Omit ngo to get
// every NGO's activities (with the NGO column filled in).
export const exportActivities = async (req, res) => {
  try {
    const { ngo_id, ngo_code } = req.query;
    const ngos = await EventHead.getAllEventHeadNgos().catch(() => []);
    let ngo = null;
    if (ngo_id) ngo = ngos.find(n => String(n.id) === String(ngo_id));
    else if (ngo_code) ngo = ngos.find(n => String(n.code || n.name || '').toUpperCase() === String(ngo_code).toUpperCase());
    if (ngo_id && !ngo) return res.status(404).json({ message: 'NGO not found' });

    const [activities, sectors] = await Promise.all([
      EventHead.getAllActivities(ngo ? { ngo_id: ngo.id } : {}),
      EventHead.getAllEventHeadSectors().catch(() => []),
    ]);
    const sectorName = new Map(sectors.map(s => [s.id, s.name]));
    const ngoLabel = ngo ? (ngo.code || ngo.name) : 'All NGOs';

    const data = (activities || [])
      .filter(a => a.name)
      .sort((a, b) => String(a.sector_id || '').localeCompare(String(b.sector_id || '')) || String(a.name).localeCompare(String(b.name)))
      .map(a => ({
        'Sector': sectorName.get(a.sector_id) || '',
        'Activity or Project': a.name,
        'NGO': ngoLabel,
      }));

    const XLSX = (await import('xlsx')).default;
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ 'Sector': '', 'Activity or Project': '', 'NGO': ngoLabel }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Activities');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safe = String(ngoLabel).replace(/[^A-Za-z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="activities_${safe}.xlsx"`);
    return res.send(buf);
  } catch (error) {
    console.error('exportActivities error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const updateActivity = async (req, res) => {
  try {
    const existing = await EventHead.getActivityById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Activity not found' });
    const body = sanitize(req.body);
    const updates = canonicalBeneficiaryFields({ ...body });
    if (updates.name !== undefined) updates.name = String(updates.name || '').trim();
    if (updates.name !== undefined && !updates.name) return res.status(400).json({ message: 'Activity name cannot be empty' });
    // "Include in my download" is the user's decision about what the monthly file
    // contains, so losing it silently would be worse than refusing: the tick would
    // look saved and the download would quietly keep ignoring it.
    if (Object.prototype.hasOwnProperty.call(updates, 'in_report')
      && !(await EventHead.activityColumnExists('in_report'))) {
      return res.status(400).json({ message: 'This server cannot store the download selection yet. Apply migration 169_event_head_activity_in_report.sql, then tick the activity again.' });
    }
    const activity = await EventHead.updateActivity(req.params.id, updates);
    return res.json(activity);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'An activity with this name already exists for this NGO' });
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const deleteActivity = async (req, res) => {
  try {
    const existing = await EventHead.getActivityById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Activity not found' });
    // Events stay; they just lose this activity. Reported back so the UI can say
    // so before deleting, rather than after.
    const eventsCount = await EventHead.countActivityEvents(req.params.id);
    await EventHead.deleteActivity(req.params.id);
    return res.json({ message: 'Activity deleted', events_affected: eventsCount });
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    // The existence check above can lose a race with another delete, so a
    // missing row here is still a 404 and not a server fault.
    if (error.message === 'Activity not found') return res.status(404).json({ message: error.message });
    return res.status(500).json({ message: error.message });
  }
};

export const setActivityStatus = async (req, res) => {
  try {
    const { status } = sanitize(req.body);
    if (!['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({ message: 'status must be Active or Inactive' });
    }
    const existing = await EventHead.getActivityById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Activity not found' });
    const activity = await EventHead.updateActivity(req.params.id, { status });
    return res.json(activity);
  } catch (error) {
    console.error('eventHeadController error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── AI SPELLING SUGGESTIONS (Create Event) ───
// Raises corrected spellings for free-text fields typed in the event-head
// "Create New Event" panel, so the team always types the right word. Uses the
// existing GROQ integration. Falls back to no suggestions if no GROQ key.
const SPELLING_MODEL = process.env.GROQ_SPELLING_MODEL || 'openai/gpt-oss-120b';

export const suggestEventSpelling = async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.fields) ? req.body.fields : [];
    const fields = raw
      .map((f) => ({ key: String(f?.key || '').trim(), value: String(f?.value || '').trim() }))
      .filter((f) => f.key && f.value);

    if (!fields.length) return res.json({ suggestions: {} });

    // No GROQ key configured → gracefully return nothing; the UI shows a note.
    if (!process.env.GROQ_API_KEY) return res.json({ suggestions: {} });

    const list = fields.map((f) => `${f.key}: ${f.value}`).join('\n');
    const prompt = [
      'You are a careful spelling checker for an event-creation form.',
      'Below is a list of field values typed by a user (format: "fieldKey: value").',
      '',
      'For each fieldKey, decide whether the typed text contains a CLEAR spelling,',
      'punctuation or simple grammar mistake. Fix ONLY clear mistakes.',
      '',
      'Rules:',
      '- Fix ONLY clear spelling, punctuation and simple grammar mistakes.',
      '- Do NOT rewrite correct text, add words, invent content, or change meaning.',
      '- Keep proper nouns, brands, names, numbers, URLs and locations as-is unless clearly misspelled.',
      '- Capitalise words that are proper nouns (places, names) naturally.',
      '- Only include a fieldKey if the corrected text is actually different from the typed value.',
      '',
      'Return a JSON object where each key is a fieldKey and the value is an object:',
      '{ "corrected": "<the corrected text>", "reason": "<short, human explanation of the fix>" }',
      '',
      'Do not be overly strict: also fix ANY obvious English spelling mistake you are confident about.',
      '',
      'Fields:',
      list,
    ].join('\n');

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'You return strict JSON only. No markdown, no commentary, no code fences.' },
        { role: 'user', content: prompt },
      ],
      model: SPELLING_MODEL,
      max_tokens: 1200,
      temperature: 0.3,
    });

    const text = (completion.choices?.[0]?.message?.content || '').trim();
    let parsed = {};
    try {
      // Strip possible code fences before JSON.parse.
      const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {};
    }

    const suggestions = {};
    for (const f of fields) {
      const entry = parsed[f.key];
      const corrected = typeof entry === 'object' && entry !== null
        ? String(entry.corrected ?? '').trim()
        : String(entry ?? '').trim();
      const reason = typeof entry === 'object' && entry !== null
        ? String(entry.reason ?? '').trim()
        : 'looks like it may be spelled differently';
      if (corrected && corrected !== f.value) {
        suggestions[f.key] = { corrected, reason };
      }
    }

    return res.json({ suggestions });
  } catch (error) {
    console.error('suggestEventSpelling error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── AI SECTOR ACTIVITY SUGGESTIONS (Activities page) ───
// Recommends typical NGO program/activity names for a selected sector.
const ACTIVITY_MODEL = process.env.GROQ_ACTIVITY_MODEL || 'openai/gpt-oss-20b';

export const suggestSectorActivities = async (req, res) => {
  try {
    const sectorName = String(req.body?.sector_name || '').trim();
    if (!sectorName) return res.status(400).json({ message: 'sector_name is required' });
    const existing = Array.isArray(req.body?.existing) ? req.body.existing.map(String).filter(Boolean) : [];

    if (!process.env.GROQ_API_KEY) return res.json({ suggestions: [] });

    const existingHint = existing.length
      ? `The sector already has: ${existing.join(', ')}. Do NOT repeat these.`
      : '';
    const prompt = [
      `Recommend 8 typical NGO program/activity names suitable for the sector "${sectorName}".`,
      'These are activity names the team might create for events under this sector.',
      'Return a strict JSON array of strings (optionally with a short non-numeric suffix removed).',
      '- Properly spelled, concise, descriptive program names (e.g. "Community Health Camp", "Computer Literacy Training").',
      '- No numbering, no bullet prefixes, no extra fields.',
      existingHint,
      'No markdown, no commentary.',
    ].filter(Boolean).join('\n');

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'You return strict JSON only. No markdown, no commentary.' },
        { role: 'user', content: prompt },
      ],
      model: ACTIVITY_MODEL,
      max_tokens: 400,
      temperature: 0.4,
    });

    const text = (completion.choices?.[0]?.message?.content || '').trim();
    let arr = [];
    try {
      const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    } catch {
      arr = [];
    }

    const seen = new Set(existing.map(s => s.toLowerCase()));
    const suggestions = [];
    for (const s of arr) {
      const name = String(s ?? '').replace(/^[\d.\-)\s]+/, '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push(name);
    }

    return res.json({ suggestions: suggestions.slice(0, 8) });
  } catch (error) {
    console.error('suggestSectorActivities error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── Calendar · important days, festivals & observances (Calendar page) ──────
// RELIABILITY: the dates come from utils/observances.js, which is deterministic
// (fixed month/day rules + explicit per-year rows + computed weekday rules).
// No AI model is involved in producing, correcting or validating a date here.
// Operator-managed `holidays` rows are merged on top so a correction can be
// made from the UI without a redeploy.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayYmd = () => new Date().toISOString().slice(0, 10);
const addDaysYmd = (s, n) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

// Never let a bad range produce a 24-hour query or an unbounded scan.
const DEFAULT_RANGE_DAYS = 62;
const MAX_RANGE_DAYS = 800;

// The `holidays` table is an optional overlay on the deterministic calendar. When
// the database is unreachable every attempt costs a full TCP/connect timeout, so
// the calendar would sit on "Loading…" for ~20s on every month change. Shorten
// the fuse and remember the outcome: after a few failures we stop trying for a
// few minutes and serve the curated list, which is the part that actually
// matters for correctness.
const HOLIDAY_FETCH_TIMEOUT_MS = 2500;
const HOLIDAY_FAILURE_BUDGET = 3;
const HOLIDAY_COOLDOWN_MS = 5 * 60 * 1000;
const holidayOverlay = { failures: 0, retryAfter: 0, cached: null, cachedAt: 0 };
const HOLIDAY_CACHE_TTL_MS = 10 * 60 * 1000;

const getHolidaysCached = async () => {
  if (holidayOverlay.cached && Date.now() - holidayOverlay.cachedAt < HOLIDAY_CACHE_TTL_MS) {
    return holidayOverlay.cached;
  }
  if (Date.now() < holidayOverlay.retryAfter) return [];   // in cooldown, skip the wait

  let timer;
  try {
    const rows = await Promise.race([
      getAllHolidays(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('holidays query timed out')), HOLIDAY_FETCH_TIMEOUT_MS); }),
    ]);
    holidayOverlay.failures = 0;
    holidayOverlay.retryAfter = 0;
    holidayOverlay.cached = Array.isArray(rows) ? rows : [];
    holidayOverlay.cachedAt = Date.now();
    return holidayOverlay.cached;
  } catch (e) {
    holidayOverlay.failures += 1;
    if (holidayOverlay.failures >= HOLIDAY_FAILURE_BUDGET) {
      holidayOverlay.retryAfter = Date.now() + HOLIDAY_COOLDOWN_MS;
      console.warn(`listCalendarObservances: holiday overlay disabled for ${HOLIDAY_COOLDOWN_MS / 1000}s after ${holidayOverlay.failures} failures (${e.message || e})`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
};

export const listCalendarObservances = async (req, res) => {
  try {
    const scopeRaw = String(req.query.scope || 'all').toLowerCase();
    const scope = ['all', 'worldwide', 'india'].includes(scopeRaw) ? scopeRaw : 'all';

    const end = DATE_RE.test(String(req.query.end || '')) ? String(req.query.end) : addDaysYmd(todayYmd(), DEFAULT_RANGE_DAYS);
    const start = DATE_RE.test(String(req.query.start || '')) ? String(req.query.start) : addDaysYmd(end, -DEFAULT_RANGE_DAYS);
    if (end <= start) return res.status(400).json({ message: 'end must be after start' });

    const days = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
    if (days > MAX_RANGE_DAYS) {
      return res.status(400).json({ message: `Date range too large — request at most ${MAX_RANGE_DAYS} days` });
    }

    // All four deterministic sources in one merge — the curated reference
    // calendar + operator `holidays` rows + the fixed international-days list +
    // Calendarific (India's festivals/national days, dated for any year). The
    // overlay and the API are bonus layers: a DB failure or a Calendarific
    // outage degrades to the rows above without breaking or delaying anything.
    // The shared helper filters by scope itself, so this endpoint returns
    // exactly what /api/important-days shows for the same range.
    const holidays = await getHolidaysCached();
    const observances = await getMergedObservancesInRange(start, end, { holidays, scope });

    // byDate lets the client render a day cell without re-grouping.
    const byDate = {};
    for (const o of observances) (byDate[o.date] ||= []).push(o);

    return res.json({
      start,
      end,
      scope,
      available_years: availableYears(),
      lunar_years: SUPPORTED_LUNAR_YEARS,
      themes: allThemes(),
      count: observances.length,
      observances,
      by_date: byDate,
      // Tells the UI it can trust these dates and label them accordingly.
      reliability: {
        dates_source: 'curated-reference-calendar',
        ai_generated_dates: false,
        lunar_rows: observances.filter((o) => o.precision === 'lunar').length,
        calendarific: {
          available: Boolean(process.env.CALENDARIFIC_API_KEY),
          sources: 'india festivals/national days + worldwide/UN observances',
        },
      },
    });
  } catch (error) {
    console.error('listCalendarObservances error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── Important Days calendar (GET /api/important-days) ──────────────────────
// The single endpoint the frontend calendar grid and "Important Days" side
// panel fetch. It merges FOUR sources into one list, each row tagged with a
// `type` of 'india' or 'international':
//   1. the curated reference calendar (observances.js) — deterministic
//   2. operator-managed `holidays` rows (optional overlay, graceful on DB
//      failure)
//   3. the fixed international days list (importantDays.js) — deterministic,
//      ships with the deploy, needs no API
//   4. Calendarific (India festivals/national days + worldwide/UN observance
//      days) — cached once per country+year on disk and in memory
// Curated/DB rows win on exact date+name duplicates; merges are append-only.
// `scope` mirrors the UI toggle: 'all' | 'worldwide' | 'india'.

const pad2M = (n) => String(n).padStart(2, '0');
const importantDayType = (o) => (o.scope === 'worldwide' ? 'international' : 'india');

export const listImportantDays = async (req, res) => {
  try {
    const scopeRaw = String(req.query.scope || 'all').toLowerCase();
    const scope = ['all', 'worldwide', 'india'].includes(scopeRaw) ? scopeRaw : 'all';
    const yearNum = Number(req.query.year);
    const monthNum = Number(req.query.month);

    // Explicit start/end wins; otherwise derive the month range from year+month
    // (default: the current month so ?year=&month= is enough to test quickly).
    let start;
    let end;
    if (DATE_RE.test(String(req.query.start || '')) && DATE_RE.test(String(req.query.end || ''))) {
      start = String(req.query.start);
      end = String(req.query.end);
    } else {
      const y = Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2200 ? yearNum : new Date().getFullYear();
      const m = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12 ? monthNum : new Date().getMonth() + 1;
      start = `${y}-${pad2M(m)}-01`;
      const next = m === 12 ? new Date(y + 1, 0, 1) : new Date(y, m, 1);
      end = `${next.getFullYear()}-${pad2M(next.getMonth() + 1)}-01`;
    }
    if (end <= start) return res.status(400).json({ message: 'end must be after start' });

    const spanDays = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
    if (spanDays > MAX_RANGE_DAYS) {
      return res.status(400).json({ message: `Date range too large — request at most ${MAX_RANGE_DAYS} days` });
    }

    // All four sources (curated + holidays overlay + fixed international days +
    // Calendarific) merged in the shared util, so the grid and the festival
    // suggestion validator can never disagree about what a real day is.
    const holidays = await getHolidaysCached();
    const allRows = await getMergedObservancesInRange(start, end, { holidays, scope });

    const days = allRows
      .map((o) => ({
        date: o.date,
        type: importantDayType(o),
        name: o.name,
        kind: o.kind,
        scope: o.scope,
        source: o.source || 'curated',
        precision: o.precision || 'fixed',
        note: o.note || null,
        themes: Array.isArray(o.themes) ? o.themes : [],
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

    const byDate = {};
    for (const d of days) (byDate[d.date] ||= []).push(d);

    return res.json({
      year: Number(start.slice(0, 4)),
      month: Number(start.slice(5, 7)),
      scope,
      start,
      end,
      count: days.length,
      india: days.filter((d) => d.type === 'india').length,
      international: days.filter((d) => d.type === 'international').length,
      days,
      by_date: byDate,
      available_years: availableYears(),
      lunar_years: SUPPORTED_LUNAR_YEARS,
      themes: allThemes(),
      reliability: {
        dates_source: 'curated + international reference days + calendarific (no AI)',
        ai_generated_dates: false,
        lunar_rows: days.filter((o) => o.precision === 'lunar').length,
        calendarific: {
          available: Boolean(process.env.CALENDARIFIC_API_KEY),
          sources: 'india festivals/national days + worldwide/UN observances',
        },
      },
    });
  } catch (error) {
    console.error('listImportantDays error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── Calendar · AI program suggestions for one day (Calendar page) ──────────
// Gemini is used for IDEA GENERATION ONLY. The date and the observance it is
// anchored to are supplied by this server from the deterministic calendar above
// and are echoed back verbatim — the model is explicitly told it has no say
// over dates and its output is scrubbed of any date it tries to invent.
const SUGGESTION_FORMATS = ['Health Camp', 'Awareness Drive', 'Distribution', 'Workshop', 'Celebration', 'Screening Camp', 'Training', 'Community Meeting', 'Sports / Cultural Event', 'Fundraising / CSR Event'];
const SUGGESTION_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

/* How many suggestions a day is allowed to yield. Both the Create Event form and
   the calendar modal read this one endpoint, so they share the cap. */
const SUGGESTION_LIMIT = 10;

/* Render the client's real activities as an id -> name table for the prompt, so
   the model can only ever choose an activity that actually exists. Truncated to
   40 entries: beyond that the list itself starts eating the token budget, and the
   model's alternatives all collapse onto the same handful anyway. */
const activityOptionsBlock = (activityById, max = 40) => {
  const rows = [];
  for (const { id, name } of activityById.values()) {
    rows.push(`  id=${id} | ${name}`);
    if (rows.length >= max) break;
  }
  return rows.join('\n');
};

/** Drop any field the model tried to use to smuggle in a date. */
function stripModelDates(s) {
  const out = {};
  for (const [k, v] of Object.entries(s || {})) {
    if (/^(date|day|when|event_?date|scheduled_?on|year|month|day_?of_?week)$/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/* Exact match first, then a "contains" match so a model writing "SUPER-URGENT"
   still lands on "Urgent" rather than silently becoming "Medium". Always
   resolves to a value from the controlled vocabulary above. */
const matchEnum = (value, allowed, fallback) => {
  const v = String(value || '').trim().toLowerCase();
  if (v.length < 3) return fallback;
  return allowed.find((a) => a.toLowerCase() === v)
    || allowed.find((a) => v.includes(a.toLowerCase()) || a.toLowerCase().includes(v))
    || fallback;
};

/* Resolves a model-supplied activity reference against the activity list the
   client actually sent (real, existing activities for this NGO/sector).

   Returns { id, name } for a genuine match, or null. This is what stops the
   failure mode where a model invents an activity string like "Health Camp" when
   the org already has "Community Health Camp" — the Create Event form then
   preselects the exact existing activity instead of fuzzy-matching a name.

   `byId` is keyed case-insensitively on String(id) so a model echoing the id as
   a number, a string, or with whitespace still resolves. `aid` is the short key
   used by the token-budget-conscious prompt; the long aliases are still accepted
   so an older or Gemini answer with `activity_id` keeps working. */
const resolveActivity = (raw, byId) => {
  if (!byId || byId.size === 0) return null;
  const candidates = [raw?.aid, raw?.activity_id, raw?.activityId, raw?.activity_name_id];
  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    const hit = byId.get(String(c).trim().toLowerCase());
    if (hit) return hit;
  }
  return null;
};

const cleanSuggestion = (raw, dateYmd, activityById) => {
  const s = stripModelDates(raw || {});
  // Long keys take precedence; the single letters are the compact aliases the
  // prompt uses to stay inside the provider's per-minute output budget.
  const title = String(s.title || s.name || s.t || '').replace(/^[\d.\-)\s]+/, '').trim().slice(0, 120);
  if (!title) return null;
  const format = matchEnum(s.format ?? s.f, SUGGESTION_FORMATS, 'Awareness Drive');
  const priority = matchEnum(s.priority ?? s.p, SUGGESTION_PRIORITIES, 'Medium');
  // A verified existing activity always wins over the model's own wording.
  const real = resolveActivity(raw, activityById);
  return {
    title,
    activityId: real ? real.id : null,
    activityName: real ? real.name : String(s.activityName || s.activity_name || s.a || '').trim().slice(0, 120) || title,
    format,
    priority,
    audience: String(s.audience || s.beneficiaries || s.u || '').trim().slice(0, 160) || null,
    duration: String(s.duration || s.d || '').trim().slice(0, 60) || null,
    objective: String(s.objective || s.aim || s.goal || s.o || '').trim().slice(0, 240) || null,
    rationale: String(s.rationale || s.why || s.reason || s.r || '').trim().slice(0, 400) || null,
    materials: Array.isArray(s.materials || s.m)
      ? (s.materials || s.m).map((m) => String(m || '').trim().slice(0, 60)).filter(Boolean).slice(0, 6)
      : [],
    // Anchored server-side. The model never supplies this.
    date: dateYmd,
  };
};

/** Turn an AI transport failure into something an Event Head can act on.
 *
 *  Raw provider JSON (and the request URL, which carries the key) never leaks.
 *
 *  CLASSIFIES PER PROVIDER, NOT ON THE CONCATENATED STRING. Each failed attempt
 *  is judged on its own message, then the verdicts are ranked. Concatenating
 *  first is a real bug: with Gemini denied (403) and Groq merely rate-limited
 *  (429), the merged text matches the 403 pattern and the user is told access was
 *  "denied" when the only thing standing in the way is a per-minute token budget
 *  that clears on its own in a minute. Ranking matters because a retryable
 *  problem should never be reported as a permanent one.
 *
 *  A 403 is described as a *project access* problem, deliberately NOT as a bad
 *  key: a denied Gemini project still authenticates fine — GET /v1beta/models
 *  returns 200 with the same key while every generateContent call is refused with
 *  403 "Your project has been denied access." Telling the user the key is
 *  "not authorised" sends an admin rotating a perfectly valid key and never
 *  finds the real cause. */
const classifyAiAttempt = (message) => {
  const m = String(message || '');
  if (/not configured on this server|not set on the server/i.test(m)) return 'unconfigured';
  // Groq's free tier refuses oversized requests up front with 429
  // rate_limit_exceeded, which is a budget problem, not an access problem.
  if (/HTTP 429|rate_limit_exceeded|rate limited|RESOURCE_EXHAUSTED|output tokens per minute|OTPM/i.test(m)) return 'ratelimited';
  if (/HTTP 5\d\d|UNAVAILABLE|overloaded|fetch failed|ENOTFOUND|ETIMEDOUT|ECONN|network|socket hang up/i.test(m)) return 'unreachable';
  if (/no usable JSON/i.test(m)) return 'unreadable';
  if (/HTTP 401|HTTP 400|API_KEY_INVALID|invalid.*key/i.test(m)) return 'badkey';
  if (/HTTP 403|PERMISSION_DENIED|permission denied|denied access/i.test(m)) return 'denied';
  return 'unknown';
};

const userSafeAiReason = (error) => {
  const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
  if (!attempts.length) {
    return classifyAiAttempt(error?.message) === 'unconfigured'
      ? 'AI suggestions are not configured on this server.'
      : 'The AI provider did not respond as expected.';
  }

  const byKind = new Map();
  for (const a of attempts) {
    const kind = classifyAiAttempt(a?.message);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(a?.provider).filter(Boolean);
  }
  const named = (k) => [...new Set(byKind.get(k) || [])].join(' and ');

  // Most actionable first: something that clears by waiting outranks something
  // that needs an admin, which outranks a generic unknown failure.
  if (byKind.has('ratelimited')) {
    return `${named('ratelimited')} hit its rate limit. Wait a moment and try again.`;
  }
  if (byKind.has('denied')) {
    return `${named('denied')} denied this project's access. The key itself is valid — an admin needs to restore generation access on the provider side.`;
  }
  if (byKind.has('badkey')) {
    return `${named('badkey')} rejected the API key. Ask an admin to check it.`;
  }
  if (byKind.has('unreachable')) {
    return `${named('unreachable')} could not be reached. Try again shortly.`;
  }
  if (byKind.has('unreadable')) {
    return `${named('unreadable')} replied in a format this app could not read. Try again.`;
  }
  if (byKind.has('unconfigured')) {
    return 'AI suggestions are not configured on this server.';
  }
  const who = [...new Set(attempts.map((a) => a?.provider).filter(Boolean))].join(' and ');
  return `${who || 'The AI provider'} did not respond as expected.`;
};

export const suggestDayPrograms = async (req, res) => {
  try {
    const dateYmdReq = String(req.body?.date || '').slice(0, 10);
    if (!DATE_RE.test(dateYmdReq)) return res.status(400).json({ message: 'date is required as YYYY-MM-DD' });

    // Server-resolved context — the client cannot override these. All four
    // deterministic sources (curated + operator holidays + fixed international
    // days + Calendarific) via the shared merge, so the day plan the model
    // reasons about is the same calendar the page displays.
    const scopeRaw = String(req.body?.scope || 'all').toLowerCase();
    const scope = ['all', 'worldwide', 'india'].includes(scopeRaw) ? scopeRaw : 'all';
    const holidays = await getHolidaysCached();
    const scoped = await getMergedObservancesInRange(dateYmdReq, addDaysYmd(dateYmdReq, 1), { holidays, scope });
    const sectorName = String(req.body?.sector_name || '').slice(0, 120) || null;
    const sectorId = String(req.body?.sector_id || '').slice(0, 60) || null;

    // Real activities the client actually has for this NGO/sector. Keyed
    // case-insensitively on String(id) so a model may echo the id as a number or
    // a string. Only used to *validate* the model's activity choice — the id is
    // never trusted blindly, and an unmatched id falls back to free text.
    const activityById = new Map();
    if (Array.isArray(req.body?.activity_options)) {
      for (const a of req.body.activity_options) {
        if (!a || typeof a !== 'object') continue;
        const id = a.id ?? a.activity_id;
        const name = String(a.name ?? a.activity_name ?? '').trim().slice(0, 120);
        if (id === undefined || id === null || !name) continue;
        activityById.set(String(id).trim().toLowerCase(), { id, name });
      }
    }
    const activityNames = [...new Set([...activityById.values()].map((a) => a.name))];

    const context = {
      date: dateYmdReq,
      observances: scoped.map((o) => ({ name: o.name, scope: o.scope, kind: o.kind, themes: o.themes, note: o.note })),
      ngoName: String(req.body?.ngo_name || '').slice(0, 120) || null,
      sectors: Array.isArray(req.body?.sectors) ? req.body.sectors.map((s) => String(s).slice(0, 80)).filter(Boolean).slice(0, 15) : [],
      activities: Array.isArray(req.body?.activities) ? req.body.activities.map((a) => String(a).slice(0, 80)).filter(Boolean).slice(0, 30) : activityNames.slice(0, 30),
      existingTitles: Array.isArray(req.body?.existing_titles) ? req.body.existing_titles.map((t) => String(t).slice(0, 100)).filter(Boolean).slice(0, 40) : [],
    };

    // No provider → still return the reliable calendar context so the UI can show
    // the day, just without AI ideas. Matches the house style of the other
    // AI endpoints (200 + empty suggestions, never a 500).
    if (!aiSuggestionsConfigured()) {
      return res.json({
        date: dateYmdReq,
        observances: scoped,
        suggestions: [],
        ai: { available: false, reason: 'AI suggestions are not configured on this server' },
      });
    }

    const dayLabel = new Date(`${dateYmdReq}T00:00:00Z`).toUTCString().slice(0, 16);
    const themeList = Array.from(new Set(scoped.flatMap((o) => o.themes || [])));

    // The activity table is emitted as PROSE before the JSON template. Putting it
    // inside the example would require a `/* */` comment in the sample JSON, which
    // is invalid and which models reproduce verbatim into their answer.
    const activityBrief = activityById.size
      ? [
          '',
          'For EVERY suggestion, "aid" must be the id of one of THESE existing activities and "a" must be that activity\'s name copied exactly. Never invent an activity that is not on this list:',
          activityOptionsBlock(activityById),
        ].join('\n')
      : [
          '',
          'No existing-activity list was supplied. Set "aid" to null and choose a sensible "a" for each suggestion.',
        ].join('\n');

    // The JSON object template, with short keys. Emitted once, as prose about
    // repeating it, never with a `/* */` marker inside the sample — comments are
    // invalid JSON and models reproduce them verbatim into their answer.
    const objectTemplate = activityById.size
      ? `  { "t": "Word1 Word2 Word3 Word4 Word5", "aid": ${[...activityById.values()][0]?.id ?? 'null'}, "a": "${([...activityById.values()][0]?.name ?? 'Activity').replace(/"/g, '')}", "f": "${SUGGESTION_FORMATS[0]}", "p": "Medium", "u": "Five words here now", "d": "Half day", "o": "Ten words of objective text at most here.", "r": "Ten words of rationale text at most here.", "m": ["Two words","Three words"] }`
      : `  { "t": "Word1 Word2 Word3 Word4 Word5", "aid": null, "a": "A short activity name", "f": "${SUGGESTION_FORMATS[0]}", "p": "Medium", "u": "Five words here now", "d": "Half day", "o": "Ten words of objective text at most here.", "r": "Ten words of rationale text at most here.", "m": ["Two words","Three words"] }`;

    const prompt = [
      'You plan programmes for a disability-focused Indian NGO. Suggest day-wise programme ideas that build on a specific occasion.',
      '',
      `The date is ${dateYmdReq} (${dayLabel}). THIS DATE IS ALREADY CONFIRMED BY THE ORGANISATION — do not state, change, second-guess or re-derive it, and do not output any date field.`,
      scoped.length
        ? `The occasion on this day is: ${scoped.map((o) => `${o.name} [${o.scope}/${o.kind}]`).join('; ')}. Build every idea on THIS occasion — that is the whole point of the request.`
        : 'There is no registered occasion on this day, so do NOT pretend there is one. Propose genuinely useful community-service programmes for an ordinary working day instead, drawn from the sector below.',
      themeList.length ? `Relevant themes: ${themeList.join(', ')}.` : '',
      context.ngoName ? `The NGO is ${context.ngoName}.` : '',
      sectorName ? `Sector: "${sectorName}".` : '',
      context.sectors.length ? `Its sectors are: ${context.sectors.join('; ')}.` : '',
      activityBrief,
      '',
      `HARD REQUIREMENT: the "suggestions" array must contain EXACTLY ${SUGGESTION_LIMIT} objects. Count as you write: 1, 2, 3, ${Array.from({ length: SUGGESTION_LIMIT - 3 }, (_, i) => i + 4).join(', ')}. Never stop early. Never return fewer.`,
      `All ${SUGGESTION_LIMIT} must be DIFFERENT ideas. Vary the activity, the format and the audience between them.`,
      context.existingTitles.length ? `Do not repeat these already-scheduled programmes: ${context.existingTitles.join('; ')}.` : '',
      '',
      `HARD TOKEN BUDGET: all ${SUGGESTION_LIMIT} objects together share about 950 output tokens, so every field must be tiny. Measured: verbose fields yield only 6 objects before the response is cut mid-JSON. Word caps, strictly:`,
      't <= 5 words | u <= 5 words | o <= 10 words | r <= 10 words | m = exactly 2 items, each <= 3 words',
      'f and p must be copied verbatim from the lists below. No emoji. No markdown. No prose outside the JSON.',
      '',
      `f must be one of: ${SUGGESTION_FORMATS.join(' | ')}`,
      `p must be one of: ${SUGGESTION_PRIORITIES.join(' | ')}`,
      '',
      'Return ONLY a JSON object of this exact shape, no markdown, no commentary:',
      '{ "suggestions": [',
      objectTemplate,
      `  , then the same object repeated until there are exactly ${SUGGESTION_LIMIT} of them, with no comma after the last one`,
      '] }',
    ].filter(Boolean).join('\n');

    let parsed = null;
    let usedModel = null;
    let usedProvider = null;
    let truncated = false;
    try {
      const result = await generateSuggestionJson(prompt, { temperature: 0.6, maxOutputTokens: 4096 });
      parsed = result?.value ?? null;
      usedModel = result?.model || null;
      usedProvider = result?.provider || null;
      truncated = result?.truncated === true;
    } catch (error) {
      // AI is an enhancement, not the point of the endpoint: the verified
      // calendar for the day is still correct, so degrade instead of failing the
      // request. Matches the no-provider branch above and the other AI endpoints.
      console.error('suggestDayPrograms: all AI providers failed:', error.message || error);
      return res.json({
        date: dateYmdReq,
        observances: scoped,
        suggestions: [],
        ai: { available: false, reason: userSafeAiReason(error) },
      });
    }

    const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const seen = new Set(context.existingTitles.map((t) => t.toLowerCase()));
    const out = [];
    for (const raw of rawList) {
      const s = cleanSuggestion(raw, dateYmdReq, activityById);
      if (!s) continue;
      const key = s.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= SUGGESTION_LIMIT) break;
    }

    return res.json({
      date: dateYmdReq,
      observances: scoped,
      suggestions: out,
      // truncated=true means the provider hit its output-token ceiling and the
      // remainder was cut. Whatever came back is complete and usable; the client
      // says so rather than implying these are all the ideas there are.
      ai: { available: true, model: usedModel, provider: usedProvider, dates_from_ai: false, truncated, requested: SUGGESTION_LIMIT },
    });
  } catch (error) {
    console.error('suggestDayPrograms error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── MONTHLY PLANNER: ACTIVITY-DRIVEN PROGRAMME SUGGESTIONS ───
// The Monthly Planner picks an NGO, a month and an activity, then asks the model
// what programmes that activity should run that month. This is the counterpart to
// suggestDayPrograms above, which works the other way round (a day drives the
// ideas). Two differences that matter:
//
//   * The activity is resolved from the DB here, so it never has to be echoed
//     back. The model cannot invent an activity, and cannot disagree with us
//     about which one is being planned.
//   * Nothing date-shaped reaches the client. Dates come from the reference
//     calendar only, and the planner assigns them when the user commits.
//
// The prompt, the parser and the month helpers all live in
// utils/activityProgramPrompt.js so they can be unit tested without a database.
export const suggestActivityPrograms = async (req, res) => {
  try {
    const month = String(req.body?.month || '').trim();
    if (!isMonthYmd(month)) {
      return res.status(400).json({ message: 'month is required as YYYY-MM' });
    }

    // activity_id is a SERIAL int. ngo_id is deliberately left as a string
    // because ngos.id may be a UUID (see the numericFields note above).
    const activityId = Number(req.body?.activity_id);
    if (!Number.isInteger(activityId) || activityId <= 0) {
      return res.status(400).json({ message: 'activity_id is required' });
    }
    const ngoIdRaw = req.body?.ngo_id;
    const ngoId = ngoIdRaw === undefined || ngoIdRaw === null || ngoIdRaw === '' ? null : String(ngoIdRaw);

    // ── Resolve the activity server-side. Its name is the only thing the model
    //    is told, so it must never come from the request body.
    const activity = await EventHead.getActivityById(activityId);
    if (!activity) return res.status(404).json({ message: 'Activity not found' });

    // An activity with a null ngo_id is shared across NGOs; anything else must
    // belong to the requested NGO. Without this a client could pair one NGO with
    // another NGO's activity and get confidently wrong suggestions.
    const activityNgoId = activity.ngo_id === null || activity.ngo_id === undefined ? null : String(activity.ngo_id);
    if (ngoId && activityNgoId && activityNgoId !== ngoId) {
      return res.status(400).json({ message: 'That activity does not belong to the selected NGO' });
    }

    const [sectors, ngoRow] = await Promise.all([
      EventHead.getAllEventHeadSectors().catch(() => []),
      ngoId ? EventHead.getEventHeadNgoById(ngoId).catch(() => null) : Promise.resolve(null),
    ]);
    const sectorRow = (sectors || []).find((s) => String(s.id) === String(activity.sector_id));
    const sectorName = sectorRow?.name || null;

    // ── Real observance dates for the month. Deterministic, never AI-generated:
    // all four sources (curated + operator holidays + fixed international days +
    // Calendarific) through the same merge the calendar grid reads, so the model
    // never plans against a narrower calendar than the planner shows.
    const scopeRaw = String(req.body?.scope || 'all').toLowerCase();
    const scope = ['all', 'worldwide', 'india'].includes(scopeRaw) ? scopeRaw : 'all';
    const first = monthFirstDay(month);
    const endExclusive = monthEndExclusive(month);
    const holidays = await getHolidaysCached();
    const observances = await getMergedObservancesInRange(first, endExclusive, { holidays, scope });

    // ── Programmes this NGO already has in the month, so the model avoids them.
    const existingTitles = [];
    if (ngoId) {
      const inRange = await EventHead.getEventHeadEventsByRange({ start: first, end: endExclusive, ngo_id: ngoId })
        .catch(() => []);
      for (const ev of inRange || []) {
        const t = String(ev?.name || '').trim();
        if (t) existingTitles.push(t.slice(0, 100));
      }
    }

// Who this activity serves: only the group that was actually chosen when the
// activity was created. There is deliberately no fallback to the NGO's fixed
// group here - a beneficiary that was never specified must not be invented for
// the model, or the ideas come back aimed at a group nobody picked. No group
// simply means the prompt carries no beneficiary line at all.
const beneficiaryGroup = canonicalActivityBeneficiary(activity.beneficiary_group) || null;

    const payload = {
      month,
      ngo_id: ngoId,
      ngo_name: ngoRow?.name || null,
      activity: { id: activity.id, name: activity.name, sector_id: activity.sector_id, sector_name: sectorName, beneficiary_group: beneficiaryGroup },
      observances: (observances || []).map((o) => ({ date: o.date, name: o.name, scope: o.scope, kind: o.kind })),
      suggestions: [],
    };

    // No provider → still return the resolved activity and the month's real
    // observances so the panel can render everything except the ideas. Matches
    // the house style of the other AI endpoints: 200 + empty, never a 500.
    if (!aiSuggestionsConfigured()) {
      return res.json({ ...payload, ai: { available: false, reason: 'AI suggestions are not configured on this server' } });
    }

    const prompt = buildActivityProgramPrompt({
      activityName: activity.name,
      ngoName: ngoRow?.name,
      // The short code plus the group the NGO serves, so the ideas are aimed at
      // this beneficiary group instead of coming back generic. Both are
      // optional: an NGO with no code, and therefore no known group, simply
      // drops the line.
      ngoCode: ngoRow?.code,
      beneficiaryGroup,
      sectorName,
      monthYmd: month,
      observances: payload.observances,
      existingTitles,
    });

    let parsed = null;
    let usedModel = null;
    let usedProvider = null;
    let truncated = false;
    try {
      const result = await generateSuggestionJson(prompt, { temperature: 0.6, maxOutputTokens: 4096 });
      parsed = result?.value ?? null;
      usedModel = result?.model || null;
      usedProvider = result?.provider || null;
      truncated = result?.truncated === true;
    } catch (error) {
      // Same reasoning as the day flow: the resolved activity and the verified
      // observance dates are still correct, so degrade instead of failing.
      console.error('suggestActivityPrograms: all AI providers failed:', error.message || error);
      return res.json({ ...payload, ai: { available: false, reason: userSafeAiReason(error) } });
    }

    const suggestions = parseActivityProgramSuggestions(parsed, {
      activityName: activity.name,
      activityId: activity.id,
      existingTitles,
    });

    // ── Persist the generated batch so the Monthly Planner's tick boxes
    // survive re-opening the modal or a page reload. Existing selections are
    // never clobbered (onConflict + ignoreDuplicates). Always re-read to return
    // real ids.
    let persisted = [];
    try {
      const [y, m] = String(month).split('-').map(Number);
      persisted = await EventHead.savePlannerSuggestions({
        ngo_id: ngoId,
        activity_id: activityId,
        month: Number.isFinite(m) ? m : month,
        year: Number.isFinite(y) ? y : null,
        batch_no: 1,
        suggestions,
        created_by: req.user?.username || req.user?.email || null,
      });
    } catch (persistErr) {
      // Suggestions should still be returned to the UI even if persistence is
      // temporarily unavailable (e.g. DB unreachable). Do not fail the call.
      console.error('suggestActivityPrograms: failed to persist suggestions:', persistErr.message || persistErr);
      persisted = [];
    }

    // Prefer persisted rows (they include id + is_selected). Fall back to the
    // freshly-parsed suggestions if persistence returned nothing.
    const returnedSuggestions = persisted.length
      ? persisted.map((r) => ({
          id: r.id,
          title: r.title,
          format: r.format,
          priority: r.priority,
          audience: r.audience,
          duration: r.duration,
          objective: r.objective,
          rationale: r.rationale,
          materials: Array.isArray(r.materials) ? r.materials : [],
          is_selected: Boolean(r.is_selected),
          suggested_event_id: r.suggested_event_id ?? null,
          activity_id: r.activity_id,
          batch_no: r.batch_no,
        }))
      : suggestions;

    return res.json({
      ...payload,
      suggestions: returnedSuggestions,
      ai: {
        available: true,
        model: usedModel,
        provider: usedProvider,
        // Stated explicitly because this endpoint never asks the model for dates.
        dates_from_ai: false,
        truncated,
        requested: ACTIVITY_SUGGESTION_LIMIT,
      },
    });
  } catch (error) {
    console.error('suggestActivityPrograms error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── PLANNER SUGGESTIONS (Monthly Planner: stored AI ideas) ───
export const getPlannerSuggestions = async (req, res) => {
  try {
    const { ngo_id, activity_id, month, year, batch_no, selected_only } = req.query;
    const monthStr = String(month || '').trim();
    const [yPart, mPart] = monthStr.includes('-') ? monthStr.split('-') : [year, month];
    const yNum = yPart ? Number(yPart) : (year ? Number(year) : undefined);
    const mNum = mPart ? Number(mPart) : (month && !monthStr.includes('-') ? Number(month) : undefined);
    const list = await EventHead.getPlannerSuggestions({
      ngo_id: ngo_id || undefined,
      activity_id: activity_id ? Number(activity_id) : undefined,
      month: Number.isFinite(mNum) ? mNum : undefined,
      year: Number.isFinite(yNum) ? yNum : undefined,
      batch_no: batch_no ? Number(batch_no) : undefined,
      selected_only: selected_only === 'true' || selected_only === true,
    });
    return res.json({ suggestions: list });
  } catch (error) {
    console.error('getPlannerSuggestions error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const setPlannerSuggestionSelected = async (req, res) => {
  try {
    const id = Number(req.params?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'id is required' });
    }
    const is_selected = Boolean(req.body?.is_selected);
    // Optional link to the programme this idea became. Written with the tick so
    // the monthly report can attribute the idea to that one programme.
    const row = await EventHead.setPlannerSuggestionSelected(id, is_selected, req.body?.suggested_event_id);
    return res.json({ suggestion: row });
  } catch (error) {
    console.error('setPlannerSuggestionSelected error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── MONTHLY PLANNER: FESTIVAL-DRIVEN PROGRAMME SUGGESTIONS ───
// The Activities grid picks one NGO and a month, lists every real festival/day
// (from the shared four-source merge), and asks the model for several useful
// programmes per festival. This is deliberately NOT anchored to a single
// activity: the unit of generation is (festival/day × NGO), and the
// beneficiary group comes from the row's own dropdown — the client sends it
// from the closed ACTIVITY_BENEFICIARY_GROUPS vocabulary only, so BSCT/MANN/AFLF
// data can never be mixed and a value outside the list is refused outright.
// With no dropdown value nothing is stored and the prompt carries no
// beneficiary line: the NGO's fixed group is never invented as a default, so
// the grid, the exports and the reports only ever show a category somebody
// actually picked.
//
// The festival + date are validated against the same merged calendar the grid
// renders, so the model cannot be fed a made-up occasion.
export const suggestFestivalPrograms = async (req, res) => {
  try {
    const month = String(req.body?.month || '').trim();
    if (!isMonthYmd(month)) {
      return res.status(400).json({ message: 'month is required as YYYY-MM' });
    }

    const date = String(req.body?.date || '').trim();
    if (!DATE_RE.test(date) || date.slice(0, 7) !== month) {
      return res.status(400).json({ message: 'date must be a YYYY-MM-DD inside the selected month' });
    }
    const festival = String(req.body?.festival || '').trim();
    if (!festival) {
      return res.status(400).json({ message: 'festival is required' });
    }

    const ngoIdRaw = req.body?.ngo_id;
    const ngoId = ngoIdRaw === undefined || ngoIdRaw === null || ngoIdRaw === '' ? null : String(ngoIdRaw);
    if (!ngoId) {
      return res.status(400).json({ message: 'Pick a single NGO to generate festival programmes' });
    }

    // No AI can be aimed at a beneficiary that does not exist. The row's
    // dropdown sends one category from the closed vocabulary; anything else is
    // refused rather than silently rewritten. Empty means nobody picked a
    // category: nothing is stored and the prompt drops the beneficiary line —
    // never the NGO's own group by default.
    const requestedRaw = req.body?.beneficiary_group;
    let requestedGroup = '';
    if (requestedRaw !== undefined && requestedRaw !== null && String(requestedRaw).trim() !== '') {
      requestedGroup = canonicalActivityBeneficiary(requestedRaw);
      if (!requestedGroup) {
        return res.status(400).json({ message: `beneficiary_group must be one of: ${ACTIVITY_BENEFICIARY_GROUPS.join(', ')}` });
      }
    }
    const ngoRow = await EventHead.getEventHeadNgoById(ngoId).catch(() => null);
    if (!ngoRow) return res.status(404).json({ message: 'NGO not found' });
    const beneficiaryGroup = requestedGroup || null;

    // Optional free-text location (the row's Location cell — a known spot from
    // the client's per-NGO list, or anything typed under "Other…"). Carried so
    // freshly generated suggestions keep the place the block already had, the
    // same way beneficiary_group is carried; the model re-aligns every stored
    // row of the festival to it, exactly as it re-applies the beneficiary.
    const location = String(req.body?.location || '').trim().slice(0, 200) || null;

    // Optional sector only provides flavour; it never picks the beneficiary.
    const sectorIdRaw = req.body?.sector_id;
    const sectorId = sectorIdRaw === undefined || sectorIdRaw === null || sectorIdRaw === '' ? null : Number(sectorIdRaw);
    let sectorName = null;
    if (Number.isInteger(sectorId) && sectorId > 0) {
      const sectors = await EventHead.getAllEventHeadSectors().catch(() => []);
      sectorName = (sectors || []).find((s) => String(s.id) === String(sectorId))?.name || null;
    }

    // Optional activity id (nullable now) — validated if the client sends one.
    let activityId = null;
    let activityName = null;
    if (req.body?.activity_id !== undefined && req.body?.activity_id !== null && req.body?.activity_id !== '') {
      const aid = Number(req.body.activity_id);
      if (!Number.isInteger(aid) || aid <= 0) {
        return res.status(400).json({ message: 'activity_id must be a positive integer' });
      }
      const activity = await EventHead.getActivityById(aid);
      if (!activity) return res.status(404).json({ message: 'Activity not found' });
      const activityNgoId = activity.ngo_id === null || activity.ngo_id === undefined ? null : String(activity.ngo_id);
      if (activityNgoId && activityNgoId !== ngoId) {
        return res.status(400).json({ message: 'That activity does not belong to the selected NGO' });
      }
      activityId = aid;
      activityName = String(activity.name || '').trim();
    }

    // ── Validate the festival against the REAL merged calendar for the month.
    const first = monthFirstDay(month);
    const endExclusive = monthEndExclusive(month);
    const holidays = await getHolidaysCached();
    const merged = await getMergedObservancesInRange(first, endExclusive, { holidays, scope: 'all' });
    const observance = findObservanceForDate(merged, date, festival);
    if (!observance) {
      return res.status(400).json({ message: `"${festival}" is not a registered festival/important day on ${date} this month` });
    }

    // ── Programmes this NGO already has in the month, so the model avoids them.
    const existingTitles = [];
    const inRange = await EventHead.getEventHeadEventsByRange({ start: first, end: endExclusive, ngo_id: ngoId })
      .catch(() => []);
    for (const ev of inRange || []) {
      const t = String(ev?.name || '').trim();
      if (t) existingTitles.push(t.slice(0, 100));
    }

    // ── Plus the ideas already stored for THIS festival. Without them a
    //    "Suggest again" after a reload hands the model the same occasion and
    //    it happily repeats what is already on screen — the upsert then
    //    dedupes every title away and nothing visibly happens. Listed here the
    //    model is asked for genuinely new programmes instead, and the parser
    //    de-dupes against the same list as a second line of defence.
    const alreadyStored = await EventHead.getFestivalSuggestions({
      ngo_id: ngoId, month: Number(month.slice(5, 7)), year: Number(month.slice(0, 4)),
      date, festival: observance.name,
    }).catch(() => []);
    for (const s of alreadyStored || []) {
      const t = String(s?.title || '').trim();
      if (t) existingTitles.push(t.slice(0, 100));
    }

    const dateLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    const payload = {
      month,
      date,
      festival: observance.name,
      ngo_id: ngoId,
      ngo_name: ngoRow?.name || null,
      ngo_code: ngoRow?.code || null,
      beneficiary: beneficiaryGroup,
      sector_name: sectorName,
      activity_id: activityId,
      activity_name: activityName,
      suggestions: [],
    };

    if (!aiSuggestionsConfigured()) {
      return res.json({ ...payload, ai: { available: false, reason: 'AI suggestions are not configured on this server' } });
    }

    const prompt = buildFestivalProgramPrompt({
      festivalName: observance.name,
      dateLabel,
      ngoName: ngoRow?.name,
      ngoCode: ngoRow?.code,
      beneficiaryGroup,
      sectorName,
      monthYmd: month,
      existingTitles,
    });

    let parsed = null;
    let usedModel = null;
    let usedProvider = null;
    let truncated = false;
    try {
      const result = await generateSuggestionJson(prompt, { temperature: 0.6, maxOutputTokens: 4096 });
      parsed = result?.value ?? null;
      usedModel = result?.model || null;
      usedProvider = result?.provider || null;
      truncated = result?.truncated === true;
    } catch (error) {
      console.error('suggestFestivalPrograms: all AI providers failed:', error.message || error);
      return res.json({ ...payload, ai: { available: false, reason: userSafeAiReason(error) } });
    }

    const suggestions = parseFestivalProgramSuggestions(parsed, {
      existingTitles,
      limit: ACTIVITY_SUGGESTION_LIMIT,
    });

    // ── Persist so ticks survive reload. Re-runs never reset existing ticks.
    let persisted = [];
    try {
      const [y, m] = String(month).split('-').map(Number);
      persisted = await EventHead.saveFestivalSuggestions({
        ngo_id: ngoId,
        activity_id: activityId,
        month: Number.isFinite(m) ? m : month,
        year: Number.isFinite(y) ? y : null,
        observance_date: date,
        festival: observance.name,
        beneficiary: beneficiaryGroup,
        location,
        sector_name: sectorName,
        activity_name: activityName,
        batch_no: 1,
        suggestions,
        created_by: req.user?.username || req.user?.email || null,
      });
    } catch (persistErr) {
      console.error('suggestFestivalPrograms: failed to persist suggestions:', persistErr.message || persistErr);
      persisted = [];
    }

    // Prefer persisted rows (they include id + is_selected). Fall back to the
    // freshly-parsed suggestions if persistence returned nothing.
    const returnedSuggestions = persisted.length
      ? persisted.map((r) => ({
          id: r.id,
          title: r.title,
          format: r.format,
          priority: r.priority,
          audience: r.audience,
          duration: r.duration,
          objective: r.objective,
          rationale: r.rationale,
          materials: Array.isArray(r.materials) ? r.materials : [],
          is_selected: Boolean(r.is_selected),
          suggested_event_id: r.suggested_event_id ?? null,
          ngo_id: r.ngo_id,
          activity_id: r.activity_id,
          beneficiary: r.beneficiary,
          location: r.location ?? null,
          sector_name: r.sector_name,
          activity_name: r.activity_name,
          observance_date: r.observance_date,
          festival: r.festival,
          batch_no: r.batch_no,
        }))
      : suggestions;

    return res.json({
      ...payload,
      suggestions: returnedSuggestions,
      ai: {
        available: true,
        model: usedModel,
        provider: usedProvider,
        // Stated explicitly because this endpoint never asks the model for dates.
        dates_from_ai: false,
        truncated,
        requested: ACTIVITY_SUGGESTION_LIMIT,
      },
    });
  } catch (error) {
    console.error('suggestFestivalPrograms error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

// ─── FESTIVAL SUGGESTIONS (Monthly Planner: stored festival AI ideas) ───
export const getFestivalSuggestions = async (req, res) => {
  try {
    const { ngo_id, date, festival, selected_only } = req.query;
    const monthStr = String(req.query.month || '').trim();
    const [yPart, mPart] = monthStr.includes('-') ? monthStr.split('-') : [req.query.year, req.query.month];
    const yNum = yPart ? Number(yPart) : undefined;
    const mNum = mPart ? Number(mPart) : undefined;
    const list = await EventHead.getFestivalSuggestions({
      ngo_id: ngo_id || undefined,
      month: Number.isFinite(mNum) ? mNum : undefined,
      year: Number.isFinite(yNum) ? yNum : undefined,
      date: date || undefined,
      festival: festival || undefined,
      selected_only: selected_only === 'true' || selected_only === true,
    });
    return res.json({ suggestions: list });
  } catch (error) {
    console.error('getFestivalSuggestions error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const setFestivalSuggestionSelected = async (req, res) => {
  try {
    const id = Number(req.params?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'id is required' });
    }
    const is_selected = Boolean(req.body?.is_selected);
    const row = await EventHead.setFestivalSuggestionSelected(id, is_selected, req.body?.suggested_event_id);
    return res.json({ suggestion: row });
  } catch (error) {
    console.error('setFestivalSuggestionSelected error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

/* The planner's durable row → created-event links for a month. A row is
   identified by its date and festival name; the link is what keeps a completed
   row's Download button on every device after a reload. */
export const getPlannerEventLinks = async (req, res) => {
  try {
    const { start, end, ngo_id } = req.query;
    if (!start || !end) return res.status(400).json({ message: 'start and end are required' });
    const links = await EventHead.getPlannerEventLinks({ start, end, ngo_id: ngo_id || undefined });
    return res.json({ links });
  } catch (error) {
    console.error('getPlannerEventLinks error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

/* Records that a planner row produced an event. Idempotent per row: calling it
   again for the same (date, festival) just points the row at the event. */
export const setPlannerEventLink = async (req, res) => {
  try {
    const observance_date = String(req.body?.observance_date || '').trim();
    const festival = String(req.body?.festival ?? '');
    const event_id = Number(req.body?.event_id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observance_date)) {
      return res.status(400).json({ message: 'observance_date (YYYY-MM-DD) is required' });
    }
    if (!Number.isInteger(event_id) || event_id <= 0) {
      return res.status(400).json({ message: 'event_id is required' });
    }
    const row = await EventHead.upsertPlannerEventLink({
      observance_date,
      festival,
      ngo_id: req.body?.ngo_id ?? null,
      event_id,
      created_by: req.user?.id ?? req.user?.email ?? null,
    });
    return res.json({ link: row });
  } catch (error) {
    console.error('setPlannerEventLink error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const deletePlannerEventLink = async (req, res) => {
  try {
    const observance_date = String(req.body?.observance_date || req.query?.observance_date || '').trim();
    const festival = String(req.body?.festival ?? req.query?.festival ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observance_date)) {
      return res.status(400).json({ message: 'observance_date (YYYY-MM-DD) is required' });
    }
    await EventHead.deletePlannerEventLink({
      observance_date,
      festival,
      ngo_id: req.body?.ngo_id ?? req.query?.ngo_id ?? null,
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('deletePlannerEventLink error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

/* The planner's typed/manual rows for one month and NGO scope. These carry the
   "Write manually" programme text, the row's event name and the extra rows
   added with "+ Add another programme", so they survive a reload. */
export const getPlannerManualRows = async (req, res) => {
  try {
    const month = Number(req.query?.month);
    const year = Number(req.query?.year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
      return res.status(400).json({ message: 'month (1-12) and year are required' });
    }
    const rows = await EventHead.getPlannerManualRows({
      month,
      year,
      ngo_id: String(req.query?.ngo_id ?? ''),
    });
    return res.json({ rows });
  } catch (error) {
    console.error('getPlannerManualRows error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const savePlannerManualRow = async (req, res) => {
  try {
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    const observance_date = String(req.body?.observance_date || '').trim();
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
      return res.status(400).json({ message: 'month (1-12) and year are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observance_date)) {
      return res.status(400).json({ message: 'observance_date (YYYY-MM-DD) is required' });
    }
    if (Number(observance_date.slice(5, 7)) !== month) {
      return res.status(400).json({ message: 'observance_date must fall in the requested month' });
    }
    const row = await EventHead.upsertPlannerManualRow({
      month,
      year,
      observance_date,
      festival: String(req.body?.festival ?? ''),
      ngo_id: req.body?.ngo_id ?? '',
      row_ngo_id: req.body?.row_ngo_id ?? '',
      name: req.body?.name ?? '',
      body_text: req.body?.body_text ?? '',
      is_selected: req.body?.is_selected,
      mode: req.body?.mode ?? null,
      beneficiary: req.body?.beneficiary ?? null,
      location: req.body?.location ?? null,
      created_by: req.user?.id ?? req.user?.email ?? null,
    });
    return res.json({ row });
  } catch (error) {
    console.error('savePlannerManualRow error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const deletePlannerManualRow = async (req, res) => {
  try {
    const observance_date = String(req.query?.observance_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observance_date)) {
      return res.status(400).json({ message: 'observance_date (YYYY-MM-DD) is required' });
    }
    await EventHead.deletePlannerManualRow({
      observance_date,
      festival: String(req.query?.festival ?? ''),
      ngo_id: req.query?.ngo_id ?? '',
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('deletePlannerManualRow error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

/* Saves the planner's Beneficiary dropdown choice onto every stored suggestion
   of one festival, so the grid, the post-reload fallback and the Excel/PDF
   export all show the category the user actually picked — even when they never
   regenerate. The value is validated against the closed vocabulary here, so an
   unknown category can never be stored or exported. */
export const setFestivalSuggestionsBeneficiary = async (req, res) => {
  try {
    const { ngo_id, festival } = req.body || {};
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    const date = String(req.body?.date || '').trim();
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
      return res.status(400).json({ message: 'month (1-12) and year are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'date (YYYY-MM-DD) is required' });
    if (Number(date.slice(5, 7)) !== month) {
      return res.status(400).json({ message: 'date must be inside the given month' });
    }
    if (!String(festival || '').trim()) return res.status(400).json({ message: 'festival is required' });
    if (ngo_id === undefined || ngo_id === null || ngo_id === '') {
      return res.status(400).json({ message: 'ngo_id is required' });
    }
    const beneficiary = canonicalActivityBeneficiary(req.body?.beneficiary) || null;
    // Stored rows carry ngo_id exactly as suggestFestivalPrograms wrote it —
    // a string — so it is passed through uncoerced or the .eq() would miss.
    const ngoKey = String(ngo_id);

    const updated = await EventHead.setFestivalSuggestionsBeneficiary({
      ngo_id: ngoKey,
      month,
      observance_date: date,
      festival: String(festival).trim(),
      beneficiary,
    });

    const suggestions = await EventHead.getFestivalSuggestions({
      ngo_id: ngoKey,
      month,
      year,
      date,
      festival: String(festival).trim(),
    }).catch(() => []);
    return res.json({ updated, beneficiary, suggestions });
  } catch (error) {
    console.error('setFestivalSuggestionsBeneficiary error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

/* Saves the planner's Location dropdown choice onto every stored suggestion of
   one festival, so the grid, the post-reload fallback, the Excel/PDF export and
   the Calendar report all show the place the user actually picked — even when
   they never regenerate. Unlike Beneficiary the value is free text — a known
   location from the client's per-NGO list, or anything typed under "Other…" —
   so it is trimmed and bounded here rather than validated against a closed
   vocabulary, and an empty choice clears the stored spot. */
export const setFestivalSuggestionsLocation = async (req, res) => {
  try {
    const { ngo_id, festival } = req.body || {};
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    const date = String(req.body?.date || '').trim();
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
      return res.status(400).json({ message: 'month (1-12) and year are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'date (YYYY-MM-DD) is required' });
    if (Number(date.slice(5, 7)) !== month) {
      return res.status(400).json({ message: 'date must be inside the given month' });
    }
    if (!String(festival || '').trim()) return res.status(400).json({ message: 'festival is required' });
    if (ngo_id === undefined || ngo_id === null || ngo_id === '') {
      return res.status(400).json({ message: 'ngo_id is required' });
    }
    const location = String(req.body?.location || '').trim().slice(0, 200) || null;
    // Stored rows carry ngo_id exactly as suggestFestivalPrograms wrote it —
    // a string — so it is passed through uncoerced or the .eq() would miss.
    const ngoKey = String(ngo_id);

    const updated = await EventHead.setFestivalSuggestionsLocation({
      ngo_id: ngoKey,
      month,
      observance_date: date,
      festival: String(festival).trim(),
      location,
    });

    const suggestions = await EventHead.getFestivalSuggestions({
      ngo_id: ngoKey,
      month,
      year,
      date,
      festival: String(festival).trim(),
    }).catch(() => []);
    return res.json({ updated, location, suggestions });
  } catch (error) {
    console.error('setFestivalSuggestionsLocation error:', error.message || error);
    return res.status(500).json({ message: error.message });
  }
};

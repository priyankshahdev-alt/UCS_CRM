import crypto from 'crypto';
import cron from 'node-cron';
import db from '../config/db.js';

// ---------------------------------------------------------------------------
// Meta (Facebook / Instagram) Ads — Graph API client + insight cache.
//
// Config is read at call time, never at module load: index.js imports routes
// before dotenv.config() runs, and this module is reachable from those routes.
// A module-level read would capture undefined and make every call look
// unconfigured even though the .env is correct.
//
// Lead capture (webhook + polling) lives in metaLeadIngestService.js. This file
// owns the Marketing API side: accounts, campaigns, insights, form discovery.
// ---------------------------------------------------------------------------

const GRAPH_BASE = 'https://graph.facebook.com';
export const META_LEAD_SOURCE = 'Meta Lead Ad';
export const META_NGOS = ['BSCT', 'AFLF', 'MANN'];

// New forms are named with the NGO as a token: "abc_bsct", "bcd_mann",
// "Mission_Vidhya_AFLF". Token match only, so "manner_test" does not become
// MANN. The fallback is used by the explicit auto-map action, not by discovery.
export function ngoFromName(name, fallback = '') {
  const tokens = String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.includes('bsct')) return 'BSCT';
  if (tokens.includes('aflf')) return 'AFLF';
  if (tokens.includes('mann')) return 'MANN';
  if (tokens.includes('beingsevak') || tokens.join(' ').includes('being sevak')) return 'BSCT';
  return fallback ? String(fallback).trim().toUpperCase() : '';
}

const nameCache = new Map();

export function normalizeAdAccountId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^act_/i, '');
}

export function getMetaConfig() {
  return {
    appId: process.env.META_ADS_APP_ID || process.env.WHATSAPP_APP_ID || '',
    appSecret: process.env.META_ADS_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '',
    accessToken: process.env.META_ADS_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '',
    verifyToken: process.env.META_ADS_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || '',
    apiVersion: process.env.META_ADS_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v23.0',
    adAccountId: normalizeAdAccountId(process.env.META_ADS_AD_ACCOUNT_ID || ''),
  };
}

export function isMetaAdsConfigured() {
  const cfg = getMetaConfig();
  return Boolean(cfg.accessToken && cfg.appSecret);
}

export function isMetaLeadCaptureConfigured() {
  const cfg = getMetaConfig();
  return Boolean(cfg.accessToken);
}

export function isMetaInsightsConfigured() {
  const cfg = getMetaConfig();
  return Boolean(cfg.accessToken && cfg.adAccountId);
}

// What the /api/webhooks/meta endpoint needs before Meta will accept the
// subscription. Kept pure so the panel can show a checklist instead of the
// first symptom being a silent 403 on Meta's side.
export function webhookChecklist(cfg = getMetaConfig()) {
  return {
    access_token: Boolean(cfg.accessToken),
    app_secret: Boolean(cfg.appSecret),
    verify_token: Boolean(cfg.verifyToken),
    signature_enforced: Boolean(cfg.appSecret),
  };
}

// Accepts ids, comma separated strings or Page URLs (from Meta dashboard) and
// returns unique numeric ids. Anything else is ignored rather than throwing:
// a malformed entry must not stop the other pages from being subscribed.
export function normalizePageIds(values) {
  const list = Array.isArray(values) ? values : [values];
  const out = new Set();
  for (const value of list) {
    for (const part of String(value == null ? '' : value).split(/[\s,]+/)) {
      const match = /(\d{6,})/.exec(part);
      if (match) out.add(match[1]);
    }
  }
  return [...out];
}

export function ngoToAccount(ngo) {
  const name = String(ngo || '').trim().toUpperCase();
  return META_NGOS.includes(name) ? name.toLowerCase() : '';
}

export function verifyMetaSignature(rawBody, signatureHeader, secret = getMetaConfig().appSecret) {
  if (!secret) return false;
  const provided = String(signatureHeader || '').trim();
  if (!provided) return false;
  const match = /^sha256=([0-9a-f]+)$/i.exec(provided);
  if (!match) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex');
  const a = Buffer.from(match[1], 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.length > 10 && digits.startsWith('0')) return digits.replace(/^0+/, '');
  return digits;
}

export function mapLeadFields(lead = {}) {
  const fields = {};
  for (const f of Array.isArray(lead.field_data) ? lead.field_data : []) {
    const key = String(f?.name || '').trim().toLowerCase();
    if (!key) continue;
    const values = (Array.isArray(f.values) ? f.values : [])
      .map((v) => String(v ?? '').trim())
      .filter(Boolean);
    if (!values.length) continue;
    fields[key] = values.join(', ');
  }
  const pick = (...keys) => {
    for (const key of keys) {
      if (fields[key]) return fields[key];
    }
    return '';
  };
  // Custom forms rename their fields freely ("WhatsApp No.", "Contact Number").
  // A fuzzy fallback keeps those leads from arriving with no phone at all.
  const fuzzy = (needles, exclude = []) => {
    for (const [key, value] of Object.entries(fields)) {
      if (exclude.some((x) => key.includes(x))) continue;
      if (needles.some((needle) => key.includes(needle))) return value;
    }
    return '';
  };
  const firstName = pick('first_name', 'first name', 'firstname');
  const lastName = pick('last_name', 'last name', 'lastname');
  let name = pick('full_name', 'full name', 'name')
    || [firstName, lastName].filter(Boolean).join(' ');
  if (!name) name = fuzzy(['name'], ['first', 'last', 'user', 'page']);
  const rawPhone = pick(
    'phone_number', 'phone', 'phone no', 'mobile', 'mobile_number',
    'whatsapp_number', 'whatsapp', 'contact_number', 'contact',
  ) || fuzzy(['phone', 'mobile', 'whatsapp', 'contact']);
  const email = pick('email', 'email_address', 'e-mail') || fuzzy(['email']);
  const city = pick('city', 'town', 'location') || fuzzy(['city', 'town']);
  return { name: name.trim(), phone: normalizePhone(rawPhone), rawPhone, email: email.trim(), city: city.trim(), fields };
}

export function metaLeadCount(actions) {
  if (!Array.isArray(actions)) return 0;
  // Only on-Facebook lead-form actions: pixel/website "leads" are a different
  // funnel and inflate a campaign that also runs a lead form.
  const wanted = ['lead', 'onsite_conversion.lead_grouped'];
  const values = actions
    .filter((a) => wanted.includes(String(a?.action_type || '')))
    .map((a) => Number(a?.value) || 0);
  if (!values.length) return 0;
  return Math.max(...values);
}

// All custom answers for one lead, keyed by the question name exactly as Meta
// returned it. The Graph payload is the source of truth; the notes column is the
// fallback for webhook deliveries, where the event row stores only the lead id
// (the enriched field_data lives on the lead record's notes instead).
export function leadAnswers(payload, notes = '') {
  const answers = {};
  const fields = Array.isArray(payload?.field_data) ? payload.field_data : [];
  for (const field of fields) {
    const key = String(field?.name || '').trim();
    if (!key) continue;
    const values = (Array.isArray(field.values) ? field.values : [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    if (values.length) answers[key] = values.join(', ');
  }

  if (!Object.keys(answers).length) {
    for (const line of String(notes || '').split('\n')) {
      const match = /^([^:[\]]{2,80}):\s*(.+)$/.exec(line.trim());
      if (match) answers[match[1].trim()] = match[2].trim();
    }
  }
  return answers;
}

const isoDate = (d) => d.toISOString().slice(0, 10);

export function metaDateRange(days = 30) {
  const span = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const until = new Date();
  const since = new Date(until.getTime() - (span - 1) * 86400000);
  return { since: isoDate(since), until: isoDate(until), days: span };
}

async function graphRequest(path, params = {}, { method = 'GET', body, token } = {}) {
  const cfg = getMetaConfig();
  const accessToken = token || cfg.accessToken;
  if (!accessToken) {
    throw new Error('Meta access token not configured (META_ADS_ACCESS_TOKEN)');
  }
  const url = new URL(`${GRAPH_BASE}/${cfg.apiVersion}/${String(path).replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set('access_token', accessToken);

  const options = { method };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    options.signal = AbortSignal.timeout(20000);
  }

  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const message = json?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`Meta API: ${message}`);
    err.status = res.status;
    err.meta = json?.error || null;
    throw err;
  }
  return json;
}

async function paginate(path, params, { pages = 5, token } = {}) {
  const out = [];
  let after = null;
  for (let i = 0; i < pages; i += 1) {
    const res = await graphRequest(path, { ...params, ...(after ? { after } : {}) }, { token });
    out.push(...(Array.isArray(res.data) ? res.data : []));
    after = res?.paging?.cursors?.after || null;
    if (!res?.paging?.next || !after) break;
  }
  return out;
}

async function cachedName(objectId) {
  if (!objectId) return '';
  if (nameCache.has(objectId)) return nameCache.get(objectId);
  try {
    const res = await graphRequest(objectId, { fields: 'name' });
    const name = res?.name || '';
    nameCache.set(objectId, name);
    return name;
  } catch {
    nameCache.set(objectId, '');
    return '';
  }
}

export async function listMetaAdAccounts() {
  const res = await graphRequest('me/adaccounts', {
    fields: 'id,account_id,name,account_status,currency,timezone_name',
    limit: 100,
  });
  return Array.isArray(res.data) ? res.data : [];
}

// ---------------------------------------------------------------------------
// Webhook plumbing.
//
// The endpoint itself (GET verify + POST leadgen) is in metaAdsController. What
// lives here is the other half of the handshake: Meta only delivers a Page's
// leadgen notifications once this app is installed on that Page and subscribed
// to the field. That is a Graph call, not a dashboard-only toggle, so the panel
// can do it without anyone hunting through Graph API Explorer.
// ---------------------------------------------------------------------------

// Cheap token probe used by the panel before it stores a credential: one call,
// no Page required. Returns the identity behind the token so the UI can show
// "connected as <name>" instead of just "saved".
export async function verifyMetaToken() {
  const res = await graphRequest('me', { fields: 'id,name' });
  return { id: res?.id ? String(res.id) : '', name: res?.name || '' };
}

export async function listMetaPages() {
  const pages = await paginate('me/accounts', {
    fields: 'id,name,tasks',
    limit: 100,
  }, { pages: 5 });
  return pages.map((p) => ({
    id: String(p.id),
    name: p.name || String(p.id),
    tasks: Array.isArray(p.tasks) ? p.tasks : [],
  }));
}

// A Page-scoped Graph call (subscribed_apps, leadgen_forms) rejects a system
// user token with "(#210) A page access token is required". The page token is
// obtainable from me/accounts with the same system user token, so fetch it once
// per call and use it for the Page edge.
async function pageAccessToken(pageId) {
  const id = normalizePageIds(pageId)[0];
  if (!id) throw new Error(`Invalid Page id: ${pageId}`);
  const res = await graphRequest('me/accounts', { fields: 'id,access_token', limit: 100 });
  const page = (Array.isArray(res.data) ? res.data : [])
    .find((p) => String(p?.id) === String(id));
  if (!page?.access_token) {
    throw new Error(`No Page access token for ${id} — assign the Page to the system user`);
  }
  return page.access_token;
}

// Apps currently installed on the Page, with the fields each one subscribed to.
export async function listPageWebhookSubscriptions(pageId) {
  const token = await pageAccessToken(pageId);
  const res = await graphRequest(`${normalizePageIds(pageId)[0]}/subscribed_apps`, {}, { token });
  return Array.isArray(res.data) ? res.data : [];
}

export async function subscribePageWebhook(pageId) {
  const id = normalizePageIds(pageId)[0];
  if (!id) throw new Error(`Invalid Page id: ${pageId}`);
  const token = await pageAccessToken(id);
  // Query params (not a JSON body): the subscribed_apps edge reads them from
  // the request string on both versions this code targets.
  return graphRequest(`${id}/subscribed_apps`, { subscribed_fields: 'leadgen' }, { method: 'POST', token });
}

export async function unsubscribePageWebhook(pageId) {
  const id = normalizePageIds(pageId)[0];
  if (!id) throw new Error(`Invalid Page id: ${pageId}`);
  const token = await pageAccessToken(id);
  return graphRequest(`${id}/subscribed_apps`, {}, { method: 'DELETE', token });
}


export async function fetchCampaigns() {
  const cfg = getMetaConfig();
  if (!cfg.adAccountId) throw new Error('Meta ad account not configured (META_ADS_AD_ACCOUNT_ID)');
  return paginate(`act_${cfg.adAccountId}/campaigns`, {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time',
    limit: 200,
  }, { pages: 5 });
}

export async function fetchLeadDetails(leadgenId) {
  const data = await graphRequest(leadgenId, {
    fields: 'id,created_time,field_data,form_id,page_id,platform,ad_id,adset_id,campaign_id,is_organic',
  });
  if (data?.campaign_id && !data.campaign_name) {
    data.campaign_name = await cachedName(data.campaign_id);
  }
  if (data?.form_id && !data.form_name) {
    data.form_name = await cachedName(data.form_id);
  }
  return data;
}

export async function fetchFormLeads(formId, { sinceUnix } = {}) {
  return paginate(`${formId}/leads`, {
    fields: 'id,created_time,field_data,form_id,page_id,platform,ad_id,adset_id,campaign_id,is_organic',
    limit: 100,
    since: sinceUnix,
  }, { pages: 10 });
}

export async function discoverMetaForms() {
  const cfg = getMetaConfig();
  if (!cfg.accessToken) return [];

  // Forms sit under a Page, but the ad-account edge is also exposed and is the
  // fastest path when the token is a system-user token. Try it first, then fall
  // back to walking the Pages the token can see.
  const rows = [];
  if (cfg.adAccountId) {
    try {
      rows.push(...await paginate(`act_${cfg.adAccountId}/leadgen_forms`, {
        fields: 'id,name,page_id,status,created_time',
        limit: 200,
      }, { pages: 5 }));
    } catch (e) {
      console.warn('Meta ad-account forms edge failed:', e?.message || e);
    }
  }

  if (!rows.length) {
    let pages = [];
    try {
      pages = await paginate('me/accounts', {
        fields: 'id,name,access_token',
        limit: 100,
      }, { pages: 5 });
    } catch (e) {
      console.warn('Meta pages lookup failed:', e?.message || e);
    }
    for (const page of pages) {
      if (!page?.id) continue;
      try {
        const token = page.access_token || undefined;
        const forms = await paginate(`${page.id}/leadgen_forms`, {
          fields: 'id,name,page_id,status,created_time',
          limit: 200,
        }, { pages: 5, token });
        rows.push(...forms.map((f) => ({ ...f, page_id: f.page_id || page.id })));
      } catch (e) {
        console.warn(`Meta page forms lookup failed (${page.id}):`, e?.message || e);
      }
    }
  }

  const byId = new Map();
  for (const r of rows) {
    if (!r?.id) continue;
    byId.set(String(r.id), {
      form_id: String(r.id),
      form_name: r.name || null,
      page_id: r.page_id ? String(r.page_id) : null,
    });
  }
  const payload = [...byId.values()];
  if (!payload.length) return [];

  const { error } = await db
    .from('meta_lead_forms')
    .upsert(payload, { onConflict: 'form_id' });
  if (error) throw error;

  // A form named "abc_bsct" is mapped on discovery. `ngo is null` keeps a
  // manual mapping authoritative: discovery never overwrites a human choice.
  for (const form of payload) {
    const guessed = ngoFromName(form.form_name);
    if (!guessed) continue;
    await db._pool
      .query(
        `update meta_lead_forms
            set ngo = $2, account = $3, updated_at = now()
          where form_id = $1 and (ngo is null or ngo = '')`,
        [form.form_id, guessed, ngoToAccount(guessed)],
      )
      .catch(() => {});
  }

  return payload;
}

export async function fetchAccountInsights({ days = 30 } = {}) {
  const cfg = getMetaConfig();
  if (!cfg.adAccountId) throw new Error('Meta ad account not configured (META_ADS_AD_ACCOUNT_ID)');
  const range = metaDateRange(days);
  return paginate(`act_${cfg.adAccountId}/insights`, {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,objective,spend,impressions,clicks,reach,ctr,cpc,cpm,actions,date_start,date_stop',
    time_increment: 1,
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    limit: 500,
  }, { pages: 10 });
}

export async function fetchCampaignInsights(campaignId, { days = 30 } = {}) {
  const range = metaDateRange(days);
  const res = await graphRequest(`${campaignId}/insights`, {
    fields: 'campaign_id,campaign_name,objective,spend,impressions,clicks,reach,ctr,cpc,cpm,actions,date_start,date_stop',
    time_increment: 1,
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    limit: 500,
  });
  return Array.isArray(res.data) ? res.data : [];
}

function normalizeInsightRow(row) {
  const campaignId = row?.campaign_id ? String(row.campaign_id) : '';
  const dateStart = row?.date_start ? String(row.date_start).slice(0, 10) : '';
  if (!campaignId || !dateStart) return null;
  return {
    campaign_id: campaignId,
    date_start: dateStart,
    campaign_name: row.campaign_name || null,
    objective: row.objective || null,
    spend: Number(row.spend) || 0,
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
    reach: Number(row.reach) || 0,
    ctr: Number(row.ctr) || 0,
    cpc: Number(row.cpc) || 0,
    cpm: Number(row.cpm) || 0,
    meta_leads: metaLeadCount(row.actions),
  };
}

async function crmLeadsByCampaignDay(sinceDate) {
  const { rows } = await db._pool.query(
    `select meta_campaign_id as campaign_id,
            to_char(created_at, 'YYYY-MM-DD') as date_start,
            count(*)::int as c
       from leads
      where meta_campaign_id is not null
        and created_at >= $1::date
      group by 1, 2`,
    [sinceDate],
  );
  const map = new Map();
  for (const r of rows) map.set(`${r.campaign_id}|${r.date_start}`, Number(r.c) || 0);
  return map;
}

export async function syncInsights({ days = 30 } = {}) {
  const range = metaDateRange(days);
  const rows = await fetchAccountInsights({ days: range.days });
  const normalized = rows.map(normalizeInsightRow).filter(Boolean);
  const crm = await crmLeadsByCampaignDay(range.since);

  const payload = normalized.map((r) => ({
    ...r,
    crm_leads: crm.get(`${r.campaign_id}|${r.date_start}`) || 0,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    const { error } = await db
      .from('meta_campaign_insights_daily')
      .upsert(chunk, { onConflict: 'campaign_id,date_start' });
    if (error) throw error;
  }

  await setSyncState('insights', {
    days: range.days,
    since: range.since,
    until: range.until,
    rows: payload.length,
  });
  return { ok: true, synced: payload.length, ...range };
}

export async function getSyncState(key) {
  const { data } = await db
    .from('meta_ads_sync_state')
    .select('*')
    .eq('key', key)
    .maybeSingle();
  return data || null;
}

export async function setSyncState(key, detail = {}) {
  const { error } = await db
    .from('meta_ads_sync_state')
    .upsert({ key, last_run_at: new Date().toISOString(), detail }, { onConflict: 'key' });
  if (error) throw error;
}

async function insightsRows({ days = 30, campaignId = null } = {}) {
  const span = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const params = [span];
  let where = `date_start >= current_date - ($1::int - 1)`;
  if (campaignId) {
    params.push(String(campaignId));
    where += ` and campaign_id = $2`;
  }
  const { rows } = await db._pool.query(
    `select campaign_id, date_start::text as date_start, campaign_name, objective,
            spend, impressions, clicks, reach, ctr, cpc, cpm, meta_leads, crm_leads
       from meta_campaign_insights_daily
      where ${where}
      order by date_start asc`,
    params,
  );
  return rows.map((r) => ({
    ...r,
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    reach: Number(r.reach) || 0,
    ctr: Number(r.ctr) || 0,
    cpc: Number(r.cpc) || 0,
    cpm: Number(r.cpm) || 0,
    meta_leads: Number(r.meta_leads) || 0,
    crm_leads: Number(r.crm_leads) || 0,
  }));
}

function totalsOf(rows) {
  const totals = {
    spend: 0, impressions: 0, clicks: 0, reach: 0, meta_leads: 0, crm_leads: 0,
  };
  for (const r of rows) {
    totals.spend += r.spend;
    totals.impressions += r.impressions;
    totals.clicks += r.clicks;
    totals.reach += r.reach;
    totals.meta_leads += r.meta_leads;
    totals.crm_leads += r.crm_leads;
  }
  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  totals.cpl = totals.meta_leads > 0 ? totals.spend / totals.meta_leads : 0;
  totals.crm_cpl = totals.crm_leads > 0 ? totals.spend / totals.crm_leads : 0;
  return totals;
}

export async function getInsightsSummary({ days = 30 } = {}) {
  const range = metaDateRange(days);
  const rows = await insightsRows({ days: range.days });
  const byDate = new Map();
  for (const r of rows) {
    const cur = byDate.get(r.date_start) || {
      date: r.date_start, spend: 0, impressions: 0, clicks: 0, meta_leads: 0, crm_leads: 0,
    };
    cur.spend += r.spend;
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.meta_leads += r.meta_leads;
    cur.crm_leads += r.crm_leads;
    byDate.set(r.date_start, cur);
  }
  return {
    ...range,
    totals: totalsOf(rows),
    series: [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };
}

export async function getCampaignPerformance({ days = 30 } = {}) {
  const range = metaDateRange(days);
  const { rows } = await db._pool.query(
    `select campaign_id,
            max(campaign_name) as campaign_name,
            max(objective) as objective,
            sum(spend) as spend,
            sum(impressions) as impressions,
            sum(clicks) as clicks,
            sum(reach) as reach,
            sum(meta_leads) as meta_leads,
            sum(crm_leads) as crm_leads
       from meta_campaign_insights_daily
      where date_start >= current_date - ($1::int - 1)
      group by campaign_id`,
    [range.days],
  );
  return rows.map((r) => {
    const spend = Number(r.spend) || 0;
    const impressions = Number(r.impressions) || 0;
    const clicks = Number(r.clicks) || 0;
    const metaLeads = Number(r.meta_leads) || 0;
    const crmLeads = Number(r.crm_leads) || 0;
    return {
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name || r.campaign_id,
      objective: r.objective || null,
      spend,
      impressions,
      clicks,
      reach: Number(r.reach) || 0,
      meta_leads: metaLeads,
      crm_leads: crmLeads,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpl: metaLeads > 0 ? spend / metaLeads : 0,
      crm_cpl: crmLeads > 0 ? spend / crmLeads : 0,
    };
  }).sort((a, b) => b.spend - a.spend);
}

export async function getMetaFunnel({ days = 30 } = {}) {
  const summary = await getInsightsSummary({ days });
  const range = metaDateRange(days);
  let placedLeads = 0;
  try {
    const { rows } = await db._pool.query(
      `select count(*)::int as c
         from leads l
        where l.source = $1
          and l.created_at >= $2::date
          and exists (
            select 1 from fro_assignments a
             where a.notes like '%[Lead:' || l.id::text || ']%'
          )`,
      [META_LEAD_SOURCE, range.since],
    );
    placedLeads = Number(rows[0]?.c) || 0;
  } catch {
    placedLeads = 0;
  }
  return {
    ...range,
    impressions: summary.totals.impressions,
    clicks: summary.totals.clicks,
    meta_leads: summary.totals.meta_leads,
    crm_leads: summary.totals.crm_leads,
    placed_leads: placedLeads,
  };
}

let insightsSchedulerStarted = false;

export function startMetaInsightsSync() {
  if (insightsSchedulerStarted) return;
  if (!isMetaInsightsConfigured()) return;
  insightsSchedulerStarted = true;

  cron.schedule('*/45 * * * *', () => {
    syncInsights({ days: 30 }).catch((e) => {
      console.error('Meta insights sync failed:', e?.message || e);
    });
  });

  setTimeout(() => {
    syncInsights({ days: 30 }).catch((e) => {
      console.error('Meta insights initial sync failed:', e?.message || e);
    });
  }, 30000);
}

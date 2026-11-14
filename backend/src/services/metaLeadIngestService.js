import cron from 'node-cron';
import db from '../config/db.js';
import {
  META_LEAD_SOURCE,
  fetchFormLeads,
  fetchLeadDetails,
  discoverMetaForms,
  getMetaConfig,
  isMetaLeadCaptureConfigured,
  mapLeadFields,
  ngoToAccount,
  setSyncState,
} from './metaAdsService.js';

// ---------------------------------------------------------------------------
// Meta Lead Ads → CRM inbox.
//
// A lead arrives once via webhook and may be fetched again by the poller when a
// delivery is missed. Both paths funnel through ingestMetaLead(), which relies
// on the unique partial index on leads.meta_lead_id as the final duplicate
// guard. The inbox row is plain `leads` data (source 'Meta Lead Ad'), so the
// existing SS pipeline — [Account:] tag → materializeReplyLead() → donor +
// fro_assignments — keeps working without a parallel data model.
//
// Placement stays manual on purpose: the admin reviews the inbox and presses
// "Add to station" exactly like a WhatsApp reply.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const labelOf = (key) => String(key)
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (c) => c.toUpperCase());

const SKIP_ANSWER_FIELDS = new Set([
  'full_name', 'full name', 'name', 'first_name', 'first name', 'firstname',
  'last_name', 'last name', 'lastname', 'phone_number', 'phone', 'phone no',
  'mobile', 'mobile_number', 'whatsapp_number', 'whatsapp', 'contact_number',
  'contact', 'email', 'email_address', 'e-mail',
]);

export function buildMetaLeadNotes(leadData = {}, mapping = null) {
  const mapped = mapLeadFields(leadData);
  const lines = [`[Meta Lead: ${leadData.id || ''}]`];
  if (leadData.platform) lines.push(`[Platform: ${leadData.platform}]`);
  const campaign = leadData.campaign_name || leadData.campaign_id;
  if (campaign) lines.push(`[Campaign: ${campaign}]`);
  const form = leadData.form_name || leadData.form_id;
  if (form) lines.push(`[Form: ${form}]`);
  const account = mapping?.account || ngoToAccount(mapping?.ngo);
  if (account) lines.push(`[Account: ${account}]`);

  for (const [key, value] of Object.entries(mapped.fields)) {
    if (SKIP_ANSWER_FIELDS.has(key)) continue;
    lines.push(`${labelOf(key)}: ${value}`);
  }
  return lines.join('\n');
}

async function resolveMapping(formId) {
  if (!formId) return null;
  const { data } = await db
    .from('meta_lead_forms')
    .select('form_id, form_name, page_id, ngo, account, active')
    .eq('form_id', String(formId))
    .maybeSingle();
  return data || null;
}

async function writeEvent(data, { status, error = null, leadId = null, payload = null } = {}) {
  try {
    await db.from('meta_lead_events').upsert({
      meta_lead_id: String(data.id),
      form_id: data.form_id ? String(data.form_id) : null,
      page_id: data.page_id ? String(data.page_id) : null,
      platform: data.platform || null,
      campaign_id: data.campaign_id ? String(data.campaign_id) : null,
      campaign_name: data.campaign_name || null,
      ad_id: data.ad_id ? String(data.ad_id) : null,
      adset_id: data.adset_id ? String(data.adset_id) : null,
      ...(payload ? { payload } : {}),
      status,
      error,
      lead_id: leadId,
      processed_at: status === 'processing' ? null : new Date().toISOString(),
    }, { onConflict: 'meta_lead_id' });
  } catch (e) {
    console.error('meta_lead_events write failed:', e?.message || e);
  }
}

export async function ingestMetaLead(leadgenId, { payload = null, source = 'webhook' } = {}) {
  const id = String(leadgenId || '').trim();
  if (!id) return { ok: false, reason: 'missing leadgen id' };

  // A duplicate event row is only written the first time this lead id is seen.
  // The 5-minute poller re-reads the same 7 days on every run; without this
  // guard each pass rewrote a delivered lead's status to "duplicate" and made
  // the delivery log unreadable.
  const alreadyLogged = async () => {
    const { data } = await db
      .from('meta_lead_events')
      .select('meta_lead_id')
      .eq('meta_lead_id', id)
      .maybeSingle();
    return Boolean(data);
  };

  const { data: existing } = await db
    .from('leads')
    .select('id, name, phone, meta_lead_id')
    .eq('meta_lead_id', id)
    .maybeSingle();
  if (existing) {
    if (!(await alreadyLogged())) {
      await writeEvent({ id, ...(payload || {}) }, { status: 'duplicate', leadId: existing.id, payload });
    }
    return { ok: true, duplicate: true, lead: existing, source };
  }

  let data = payload;
  if (!data?.field_data) {
    try {
      data = await fetchLeadDetails(id);
    } catch (e) {
      console.error('Meta lead fetch failed:', id, e?.message || e);
      await writeEvent({ id, ...(payload || {}) }, { status: 'error', error: e?.message || String(e), payload });
      return { ok: false, reason: e?.message || 'fetch failed' };
    }
  }
  if (!data) return { ok: false, reason: 'empty lead payload' };
  data.id = String(data.id || id);

  const mapping = await resolveMapping(data.form_id);
  const fields = mapLeadFields(data);
  const notes = buildMetaLeadNotes(data, mapping);
  const name = fields.name
    || (fields.phone ? `Meta ${fields.phone.slice(-4)}` : 'Meta Lead');

  const metaCreatedAt = data.created_time ? new Date(data.created_time) : null;
  const validCreatedAt = metaCreatedAt && !Number.isNaN(metaCreatedAt.getTime()) ? metaCreatedAt : null;

  const record = {
    name,
    phone: fields.phone || null,
    email: fields.email || null,
    source: META_LEAD_SOURCE,
    status: 'new',
    notes,
    created_by: null,
    created_by_name: 'Meta Lead Ads',
    meta_lead_id: data.id,
    meta_platform: data.platform || null,
    meta_campaign_id: data.campaign_id ? String(data.campaign_id) : null,
    meta_campaign_name: data.campaign_name || null,
    meta_form_id: data.form_id ? String(data.form_id) : null,
    // Keep the campaign-day attribution honest even when the polling fallback
    // picks the lead up hours after the webhook should have delivered it.
    ...(validCreatedAt ? { created_at: validCreatedAt } : {}),
  };

  const { data: created, error } = await db
    .from('leads')
    .insert(record)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raced } = await db
        .from('leads')
        .select('id, name, phone, meta_lead_id')
        .eq('meta_lead_id', data.id)
        .maybeSingle();
      if (!(await alreadyLogged())) {
        await writeEvent(data, { status: 'duplicate', leadId: raced?.id || null, payload });
      }
      return { ok: true, duplicate: true, lead: raced || null, source };
    }
    console.error('Meta lead insert failed:', error.message);
    await writeEvent(data, { status: 'error', error: error.message, payload });
    return { ok: false, reason: error.message };
  }

  await writeEvent(data, {
    status: mapping?.ngo ? 'ingested' : 'unmapped',
    leadId: created.id,
    payload,
  });

  return {
    ok: true,
    lead: created,
    mapped: Boolean(mapping?.ngo),
    unmapped: !mapping?.ngo,
    source,
  };
}

export async function processMetaWebhookPayload(body = {}) {
  const jobs = [];
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'leadgen') continue;
      const value = change.value || {};
      if (!value.leadgen_id) continue;
      jobs.push({
        leadgenId: value.leadgen_id,
        payload: {
          id: String(value.leadgen_id),
          form_id: value.form_id ? String(value.form_id) : null,
          page_id: value.page_id ? String(value.page_id) : null,
          ad_id: value.ad_id ? String(value.ad_id) : null,
          adset_id: value.adgroup_id ? String(value.adgroup_id) : null,
          created_time: value.created_time || null,
        },
      });
    }
  }

  let ingested = 0;
  let duplicates = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await ingestMetaLead(job.leadgenId, { payload: job.payload, source: 'webhook' });
      if (result.duplicate) duplicates += 1;
      else if (result.ok) ingested += 1;
      else failed += 1;
    } catch (e) {
      failed += 1;
      console.error('Meta webhook ingest failed:', job.leadgenId, e?.message || e);
    }
  }
  return { received: jobs.length, ingested, duplicates, failed };
}

export async function pollMetaLeadForms({ sinceDays = 7 } = {}) {
  if (!isMetaLeadCaptureConfigured()) {
    return { ok: false, skipped: true, reason: 'Meta access token not configured' };
  }

  let { data: forms, error } = await db
    .from('meta_lead_forms')
    .select('form_id, form_name, ngo, active')
    .eq('active', true);
  if (error) throw error;

  if (!forms?.length) {
    try {
      await discoverMetaForms();
      const retry = await db.from('meta_lead_forms').select('form_id, form_name, ngo, active').eq('active', true);
      forms = retry.data || [];
    } catch (e) {
      console.error('Meta form discovery failed:', e?.message || e);
      forms = [];
    }
  }

  const sinceUnix = Math.floor((Date.now() - Math.max(1, sinceDays) * 86400000) / 1000);
  let scanned = 0;
  let ingested = 0;
  let duplicates = 0;
  let failed = 0;
  const errors = [];

  for (const form of forms || []) {
    try {
      const leads = await fetchFormLeads(form.form_id, { sinceUnix });
      for (const lead of leads) {
        scanned += 1;
        const result = await ingestMetaLead(lead.id, {
          payload: { ...lead, id: String(lead.id) },
          source: 'poll',
        });
        if (result.duplicate) duplicates += 1;
        else if (result.ok) ingested += 1;
        else failed += 1;
      }
    } catch (e) {
      failed += 1;
      if (errors.length < 3) errors.push(`${form.form_id}: ${e?.message || e}`);
      console.error(`Meta form poll failed (${form.form_id}):`, e?.message || e);
    }
    // Marketing API rate limits: a small pause between forms keeps a poll of
    // several forms comfortably inside the per-app budget.
    await sleep(250);
  }

  await setSyncState('leads', {
    forms: forms?.length || 0,
    scanned,
    ingested,
    duplicates,
    failed,
    since_days: Math.max(1, sinceDays),
  }).catch(() => {});

  return {
    ok: true,
    forms: forms?.length || 0,
    scanned,
    ingested,
    duplicates,
    failed,
    errors,
  };
}

let pollerStarted = false;

export function startMetaLeadPoller() {
  if (pollerStarted) return;
  if (!isMetaLeadCaptureConfigured()) return;
  pollerStarted = true;

  cron.schedule('*/5 * * * *', () => {
    pollMetaLeadForms({ sinceDays: 7 }).catch((e) => {
      console.error('Meta lead poll failed:', e?.message || e);
    });
  });

  setTimeout(() => {
    pollMetaLeadForms({ sinceDays: 7 }).catch((e) => {
      console.error('Meta lead initial poll failed:', e?.message || e);
    });
  }, 20000);
}

// Exported for diagnostics/tests without touching the network.
export function metaConfigSnapshot() {
  const cfg = getMetaConfig();
  return {
    apiVersion: cfg.apiVersion,
    adAccountId: cfg.adAccountId,
    hasToken: Boolean(cfg.accessToken),
    hasAppSecret: Boolean(cfg.appSecret),
    hasVerifyToken: Boolean(cfg.verifyToken),
  };
}

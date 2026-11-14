import db from '../config/db.js';
import {
  META_LEAD_SOURCE,
  META_NGOS,
  discoverMetaForms,
  fetchCampaignInsights,
  fetchCampaigns,
  getCampaignPerformance,
  getInsightsSummary,
  getMetaConfig,
  getMetaFunnel,
  getSyncState,
  isMetaAdsConfigured,
  isMetaInsightsConfigured,
  isMetaLeadCaptureConfigured,
  listMetaAdAccounts as fetchAdAccounts,
  listMetaPages,
  listPageWebhookSubscriptions,
  metaLeadCount,
  metaDateRange,
  ngoToAccount,
  normalizePageIds,
  ngoFromName,
  leadAnswers,
  setSyncState,
  subscribePageWebhook,
  syncInsights,
  verifyMetaSignature,
  verifyMetaToken,
  webhookChecklist,
} from '../services/metaAdsService.js';
import {
  META_CONFIG_FIELDS,
  applyMetaEnvPatch,
  getMetaConfigView,
  persistMetaConfig,
} from '../services/metaAdsConfigStore.js';
import {
  pollMetaLeadForms,
  processMetaWebhookPayload,
} from '../services/metaLeadIngestService.js';

const daysOf = (value, fallback = 30) => Math.min(Math.max(parseInt(value, 10) || fallback, 1), 365);

async function collectStatus() {
  const cfg = getMetaConfig();
  const configured = isMetaAdsConfigured();
  const checks = {
    token: Boolean(cfg.accessToken),
    app_secret: Boolean(cfg.appSecret),
    verify_token: Boolean(cfg.verifyToken),
    ad_account: Boolean(cfg.adAccountId),
  };

  let counts = { forms: 0, mapped_forms: 0, leads: 0, leads_7d: 0 };
  try {
    const { rows } = await db._pool.query(
      `select
         (select count(*)::int from meta_lead_forms) as forms,
         (select count(*)::int from meta_lead_forms where ngo is not null and ngo <> '') as mapped_forms,
         (select count(*)::int from leads where source = $1) as leads,
         (select count(*)::int from leads where source = $1 and created_at >= now() - interval '7 days') as leads_7d`,
      [META_LEAD_SOURCE],
    );
    if (rows[0]) counts = rows[0];
  } catch {
    // Schema not applied yet — the status endpoint must still answer.
  }

  const [leadSync, insightSync] = await Promise.all([
    getSyncState('leads').catch(() => null),
    getSyncState('insights').catch(() => null),
  ]);

  // Webhook health: a checklist plus the last delivery, because "webhook not
  // working" is almost always one of those two things. Both are read from the
  // local meta_lead_events table, so this stays fast and never calls Graph.
  const webhook = {
    ...webhookChecklist(cfg),
    callback_path: '/api/webhooks/meta',
    last_event: null,
    counts: { total: 0, ingested: 0, unmapped: 0, duplicate: 0, error: 0, last_24h: 0 },
  };
  try {
    const { rows } = await db._pool.query(
      `select
         count(*)::int as total,
         count(*) filter (where status in ('ingested', 'processing'))::int as ingested,
         count(*) filter (where status = 'unmapped')::int as unmapped,
         count(*) filter (where status = 'duplicate')::int as duplicate,
         count(*) filter (where status = 'error')::int as error,
         count(*) filter (where received_at >= now() - interval '24 hours')::int as last_24h,
         max(received_at) as last_received_at
       from meta_lead_events`,
    );
    if (rows[0]) {
      const { last_received_at: lastReceivedAt, ...counts } = rows[0];
      webhook.counts = counts;
      webhook.last_event = lastReceivedAt || null;
    }
  } catch {
    // Schema not applied yet — the status endpoint must still answer.
  }

  const insightsReady = isMetaInsightsConfigured();
  return {
    connected: insightsReady || checks.token,
    configured,
    lead_capture: checks.token,
    insights: insightsReady,
    webhook,
    api_version: cfg.apiVersion,
    ad_account_id: cfg.adAccountId || null,
    checks,
    counts,
    lead_sync: leadSync,
    insight_sync: insightSync,
    message: configured
      ? (checks.ad_account ? 'Meta Ads connected' : 'Add an ad account id for campaigns and insights. Lead capture works without it.')
      : 'Meta Ads is not connected. Save an access token and app secret in the Meta connection panel.',
  };
}

export async function metaAdsStatus(req, res) {
  try {
    return res.json(await collectStatus());
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function listMetaAdAccounts(req, res) {
  try {
    if (!isMetaAdsConfigured()) return res.json([]);
    const accounts = await fetchAdAccounts();
    return res.json(accounts);
  } catch (e) {
    console.error('Meta ad accounts failed:', e?.message || e);
    return res.json([]);
  }
}

export async function listMetaCampaigns(req, res) {
  try {
    const days = daysOf(req.query.days);
    const perf = await getCampaignPerformance({ days });
    const perfBy = new Map(perf.map((p) => [String(p.campaign_id), p]));

    let graphCampaigns = [];
    if (isMetaInsightsConfigured()) {
      try {
        graphCampaigns = await fetchCampaigns();
      } catch (e) {
        console.error('Meta campaigns fetch failed:', e?.message || e);
      }
    }

    if (graphCampaigns.length) {
      return res.json(graphCampaigns.map((c) => {
        const p = perfBy.get(String(c.id)) || {};
        return {
          id: c.id,
          campaign_id: String(c.id),
          campaign_name: c.name || p.campaign_name || String(c.id),
          name: c.name || p.campaign_name || String(c.id),
          status: c.status || null,
          objective: c.objective || p.objective || null,
          daily_budget: c.daily_budget || null,
          lifetime_budget: c.lifetime_budget || null,
          start_time: c.start_time || null,
          stop_time: c.stop_time || null,
          spend: p.spend || 0,
          impressions: p.impressions || 0,
          clicks: p.clicks || 0,
          reach: p.reach || 0,
          meta_leads: p.meta_leads || 0,
          crm_leads: p.crm_leads || 0,
          ctr: p.ctr || 0,
          cpc: p.cpc || 0,
          cpl: p.cpl || 0,
          crm_cpl: p.crm_cpl || 0,
        };
      }));
    }

    return res.json(perf.map((p) => ({
      ...p,
      id: p.campaign_id,
      name: p.campaign_name,
      status: null,
    })));
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function getMetaCampaignInsights(req, res) {
  try {
    const days = daysOf(req.query.days);
    const campaignId = req.params.id;

    if (isMetaInsightsConfigured()) {
      try {
        const raw = await fetchCampaignInsights(campaignId, { days });
        const rows = raw.map((r) => ({
          date: r.date_start,
          spend: Number(r.spend) || 0,
          impressions: Number(r.impressions) || 0,
          clicks: Number(r.clicks) || 0,
          reach: Number(r.reach) || 0,
          ctr: Number(r.ctr) || 0,
          cpc: Number(r.cpc) || 0,
          cpm: Number(r.cpm) || 0,
          leads: metaLeadCount(r.actions),
        }));
        const totals = rows.reduce((acc, r) => {
          acc.spend += r.spend;
          acc.impressions += r.impressions;
          acc.clicks += r.clicks;
          acc.reach += r.reach;
          acc.leads += r.leads;
          return acc;
        }, { spend: 0, impressions: 0, clicks: 0, reach: 0, leads: 0 });
        return res.json({ campaign_id: campaignId, rows, totals });
      } catch (e) {
        console.error('Meta campaign insights failed:', e?.message || e);
      }
    }

    const range = metaDateRange(days);
    const { rows } = await db._pool.query(
      `select date_start::text as date, spend, impressions, clicks, reach, ctr, cpc, cpm, meta_leads, crm_leads
         from meta_campaign_insights_daily
        where campaign_id = $1 and date_start >= $2::date
        order by date_start asc`,
      [campaignId, range.since],
    );
    return res.json({
      campaign_id: campaignId,
      rows: rows.map((r) => ({
        ...r,
        spend: Number(r.spend) || 0,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        reach: Number(r.reach) || 0,
        ctr: Number(r.ctr) || 0,
        cpc: Number(r.cpc) || 0,
        cpm: Number(r.cpm) || 0,
        leads: Number(r.meta_leads) || 0,
      })),
      cached: true,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function getMetaInsightsSummary(req, res) {
  try {
    return res.json(await getInsightsSummary({ days: daysOf(req.query.days) }));
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function getMetaFunnelHandler(req, res) {
  try {
    return res.json(await getMetaFunnel({ days: daysOf(req.query.days) }));
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function syncMetaInsights(req, res) {
  try {
    if (!isMetaInsightsConfigured()) {
      return res.status(400).json({ message: 'Meta Ads is not configured with an ad account id' });
    }
    const result = await syncInsights({ days: daysOf(req.body?.days ?? req.query.days) });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function syncMetaLeads(req, res) {
  try {
    const result = await pollMetaLeadForms({ sinceDays: daysOf(req.body?.sinceDays, 7) });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function listMetaForms(req, res) {
  try {
    if (String(req.query.refresh || '') === '1' && isMetaLeadCaptureConfigured()) {
      await discoverMetaForms().catch((e) => {
        console.error('Meta form discovery failed:', e?.message || e);
      });
    }
    const { data, error } = await db
      .from('meta_lead_forms')
      .select('*')
      .order('form_name', { ascending: true });
    if (error) throw error;
    return res.json((data || []).map((f) => ({ ...f, mapped: Boolean(f.ngo) })));
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

async function remapFormLeads(formId, account) {
  const { rows } = await db._pool.query(
    'select id, notes from leads where meta_form_id = $1',
    [String(formId)],
  );
  let changed = 0;
  for (const row of rows) {
    const cleaned = String(row.notes || '')
      .split('\n')
      .filter((line) => !/^\[Account:\s*[^\]]*\]$/i.test(line.trim()))
      .join('\n')
      .trim();
    const next = account ? `${cleaned}${cleaned ? '\n' : ''}[Account: ${account}]` : cleaned;
    if (next !== (row.notes || '')) {
      await db._pool.query('update leads set notes = $2 where id = $1', [row.id, next]);
      changed += 1;
    }
  }
  return changed;
}

export async function saveMetaForm(req, res) {
  try {
    const formId = String(req.body?.form_id || '').trim();
    if (!formId) return res.status(400).json({ message: 'form_id is required' });

    const rawNgo = String(req.body?.ngo || '').trim().toUpperCase();
    const ngo = META_NGOS.includes(rawNgo) ? rawNgo : null;
    if (req.body?.ngo && !ngo) {
      return res.status(400).json({ message: `ngo must be one of ${META_NGOS.join(', ')}` });
    }
    const account = ngoToAccount(ngo);
    const active = req.body?.active === undefined ? true : Boolean(req.body.active);

    const payload = {
      form_id: formId,
      ngo,
      account,
      active,
      updated_at: new Date().toISOString(),
    };
    if (req.body?.form_name !== undefined) payload.form_name = req.body.form_name || null;
    if (req.body?.page_id !== undefined) payload.page_id = req.body.page_id || null;

    const { data, error } = await db
      .from('meta_lead_forms')
      .upsert(payload, { onConflict: 'form_id' })
      .select()
      .single();
    if (error) throw error;

    const remapped = await remapFormLeads(formId, account);
    return res.json({ ...data, mapped: Boolean(ngo), remapped });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function deleteMetaForm(req, res) {
  try {
    const formId = String(req.params.formId || '').trim();
    if (!formId) return res.status(400).json({ message: 'form_id is required' });
    const { data, error } = await db
      .from('meta_lead_forms')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('form_id', formId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Form not found' });
    return res.json({ ...data, mapped: Boolean(data.ngo) });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// ---- Config (database backed) ---------------------------------------------

export async function getMetaAdsConfig(req, res) {
  try {
    return res.json(await getMetaConfigView());
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// Saves the credential into `settings` and applies it to the running process.
// A token is verified against Graph BEFORE it is persisted, so a typo can never
// replace a working configuration.
export async function saveMetaAdsConfig(req, res) {
  try {
    const body = req.body || {};
    const patch = {};
    for (const key of META_CONFIG_FIELDS) {
      if (body[key] !== undefined) {
        patch[key] = body[key];
        continue;
      }
      const alias = key.replace('META_ADS_', '').toLowerCase();
      if (body[alias] !== undefined) patch[key] = body[alias];
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ message: `Send at least one of: ${META_CONFIG_FIELDS.join(', ')}` });
    }

    if (patch.META_ADS_PAGE_ID !== undefined && String(patch.META_ADS_PAGE_ID).trim()) {
      patch.META_ADS_PAGE_ID = normalizePageIds(patch.META_ADS_PAGE_ID).join(',');
    }
    if (patch.META_ADS_API_VERSION !== undefined && String(patch.META_ADS_API_VERSION).trim()) {
      const version = String(patch.META_ADS_API_VERSION).trim();
      if (!/^v\d{1,3}\.\d{1,2}$/.test(version)) {
        return res.status(400).json({ message: 'META_ADS_API_VERSION must look like v23.0' });
      }
      patch.META_ADS_API_VERSION = version;
    }

    const previous = {};
    for (const key of Object.keys(patch)) previous[key] = process.env[key];

    applyMetaEnvPatch(patch);

    let verification = null;
    const tokenTouched = patch.META_ADS_ACCESS_TOKEN !== undefined;
    const tokenCleared = tokenTouched && !String(patch.META_ADS_ACCESS_TOKEN).trim();
    if (tokenTouched && !tokenCleared) {
      try {
        const who = await verifyMetaToken();
        verification = { ok: true, ...who };
      } catch (e) {
        // Roll the in-memory value back: a token Meta rejected must never reach
        // the poller that is about to be started below.
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        return res.status(400).json({
          message: `Meta rejected the access token: ${e?.message || e}`,
          verification: { ok: false, error: e?.message || String(e) },
        });
      }
    }

    await persistMetaConfig(patch);

    // If the token was absent at boot the schedulers returned early; now that it
    // exists they must be started without waiting for a restart.
    await Promise.all([
      import('../services/metaLeadIngestService.js')
        .then((m) => m.startMetaLeadPoller?.())
        .catch(() => {}),
      import('../services/metaAdsService.js')
        .then((m) => m.startMetaInsightsSync?.())
        .catch(() => {}),
    ]);

    return res.json({
      ok: true,
      saved: Object.keys(patch),
      verification,
      config: await getMetaConfigView(),
      status: await collectStatus(),
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// Fills `ngo` for every form that has no mapping yet, from the form name token
// (abc_bsct → BSCT) and then the configured default. Manual mappings are never
// touched. Leads already ingested from a form get the [Account:] tag backfilled.
export async function autoMapMetaForms(req, res) {
  try {
    const requested = String(req.body?.fallback || '').trim().toUpperCase();
    const fallback = META_NGOS.includes(requested)
      ? requested
      : (META_NGOS.includes(String(process.env.META_ADS_DEFAULT_NGO || '').trim().toUpperCase())
        ? String(process.env.META_ADS_DEFAULT_NGO).trim().toUpperCase()
        : 'BSCT');

    const { data: forms, error } = await db
      .from('meta_lead_forms')
      .select('form_id, form_name, ngo');
    if (error) throw error;

    const results = [];
    for (const form of forms || []) {
      if (form.ngo) continue; // a human mapping always wins
      const ngo = ngoFromName(form.form_name, fallback);
      if (!ngo) continue;
      const account = ngoToAccount(ngo);
      const { error: updateError } = await db
        .from('meta_lead_forms')
        .update({ ngo, account, updated_at: new Date().toISOString() })
        .eq('form_id', form.form_id);
      if (updateError) {
        results.push({ form_id: form.form_id, ok: false, error: updateError.message });
        continue;
      }
      const remapped = await remapFormLeads(form.form_id, account).catch(() => 0);
      results.push({
        form_id: form.form_id,
        form_name: form.form_name || '',
        ngo,
        account,
        remapped,
        ok: true,
      });
    }

    return res.json({
      ok: true,
      fallback,
      mapped: results.filter((r) => r.ok).length,
      leads_updated: results.reduce((sum, r) => sum + (r.remapped || 0), 0),
      results,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// ---- Lead log (panel) ------------------------------------------------------

// One row per captured Meta lead, with the custom form answers flattened so the
// panel can show what the CSV export shows: state, association choice, inbox
// link. Filters are optional and additive.
export async function listMetaLeads(req, res) {
  try {
    const days = daysOf(req.query.days, 30);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const platform = String(req.query.platform || '').trim().toLowerCase();
    const formId = String(req.query.form_id || '').trim();
    const q = String(req.query.q || '').trim();

    const params = [days];
    let where = `l.source = 'Meta Lead Ad' and l.created_at >= now() - ($1::int || ' days')::interval`;
    if (platform) {
      params.push(platform);
      where += ` and lower(coalesce(l.meta_platform, '')) = $${params.length}`;
    }
    if (formId) {
      params.push(formId);
      where += ` and l.meta_form_id = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      where += ` and (l.name ilike $${params.length} or l.email ilike $${params.length} or l.phone like $${params.length})`;
    }
    params.push(limit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const { rows } = await db._pool.query(
      `select l.id, l.name, l.phone, l.email, l.notes, l.meta_platform, l.meta_form_id,
              l.meta_campaign_id, l.meta_campaign_name, l.meta_lead_id, l.created_at,
              f.form_name, f.ngo, f.account, e.payload,
              count(*) over()::int as total
         from leads l
         left join meta_lead_forms f on f.form_id = l.meta_form_id
         left join meta_lead_events e on e.meta_lead_id = l.meta_lead_id
        where ${where}
        order by l.created_at desc
        limit $${limitParam} offset $${offsetParam}`,
      params,
    );

    const answerOf = (answers, needle) => {
      const key = Object.keys(answers).find((k) => k.toLowerCase().includes(needle));
      return key ? answers[key] : '';
    };

    return res.json({
      total: rows[0]?.total || 0,
      rows: rows.map((r) => {
        const answers = leadAnswers(r.payload, r.notes);
        return {
          id: r.id,
          name: r.name || '',
          phone: r.phone || '',
          email: r.email || '',
          platform: r.meta_platform || '',
          form_id: r.meta_form_id || '',
          form_name: r.form_name || '',
          campaign_id: r.meta_campaign_id || r.payload?.campaign_id || '',
          campaign_name: r.meta_campaign_name || '',
          ad_id: r.payload?.ad_id || '',
          is_organic: r.payload?.is_organic == null
            ? null
            : String(r.payload.is_organic).toLowerCase() === 'true',
          state: answerOf(answers, 'state'),
          interest: answerOf(answers, 'associate'),
          inbox_url: answers.inbox_url || answerOf(answers, 'inbox'),
          ngo: r.ngo || '',
          answers,
          created_at: r.created_at,
        };
      }),
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// ---- Webhook (public) ------------------------------------------------------

export async function getMetaWebhookEvents(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    // Re-polls used to rewrite every row to "duplicate"; the ingest guard stops
    // that now, but old rows remain, so duplicates are hidden unless asked for.
    const includeDuplicates = String(req.query.include_duplicates || '') === '1';
    const { rows } = await db._pool.query(
      `select meta_lead_id, form_id, page_id, platform, campaign_id, campaign_name,
              status, error, lead_id, received_at, processed_at
         from meta_lead_events
        ${includeDuplicates ? '' : `where status <> 'duplicate'`}
        order by received_at desc
        limit $1`,
      [limit],
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

// Which Page(s) this app is installed on, and whether `leadgen` is subscribed.
// `subscribed: null` means Graph could not be asked (token/permission), which is
// different from "not subscribed" and must not be shown as a red cross.
export async function listMetaWebhookPages(req, res) {
  try {
    const cfg = getMetaConfig();
    if (!cfg.accessToken) {
      return res.json({ pages: [], app_id: cfg.appId || null, note: 'Meta access token not configured' });
    }

    let pages = [];
    let graphError = null;
    try {
      pages = await listMetaPages();
    } catch (e) {
      graphError = e?.message || String(e);
    }

    if (!pages.length) {
      const { rows } = await db._pool.query(
        `select distinct page_id from meta_lead_forms where page_id is not null and page_id <> ''`,
      );
      pages = rows.map((r) => ({ id: String(r.page_id), name: `Page ${r.page_id}`, tasks: [] }));
    }

    const out = [];
    for (const page of pages) {
      let apps = null;
      try {
        apps = await listPageWebhookSubscriptions(page.id);
      } catch {
        apps = null;
      }
      const installed = (apps || []).map((a) => ({
        id: String(a?.id || ''),
        name: a?.name || '',
        fields: Array.isArray(a?.subscribed_fields) ? a.subscribed_fields.map(String) : [],
      }));
      // `subscribed: null` means Graph could not be asked. `leadgen` is true if
      // ANY installed app receives the field — the configured app id may be a
      // different app (WhatsApp fallback), so it cannot be the only signal.
      out.push({
        ...page,
        subscribed: apps === null ? null : installed.length > 0,
        subscribed_fields: installed.flatMap((a) => a.fields),
        leadgen: installed.some((a) => a.fields.includes('leadgen')),
        apps: installed,
        app_match: cfg.appId ? installed.some((a) => a.id === String(cfg.appId)) : null,
      });
    }

    return res.json({ pages: out, app_id: cfg.appId || null, graph_error: graphError });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function subscribeMetaWebhook(req, res) {
  try {
    const cfg = getMetaConfig();
    if (!cfg.accessToken) {
      return res.status(400).json({ message: 'Meta access token not configured (META_ADS_ACCESS_TOKEN)' });
    }

    // Page resolution order: explicit request → env → pages already mapped to a
    // form → every Page the token can see. The dashboard's "Subscribe" toggle
    // only sets the field; the app still has to be installed on the Page.
    let pageIds = normalizePageIds(req.body?.page_ids ?? req.body?.page_id ?? '');
    if (!pageIds.length) pageIds = normalizePageIds(process.env.META_ADS_PAGE_ID || '');
    if (!pageIds.length) {
      const { rows } = await db._pool.query(
        `select distinct page_id from meta_lead_forms where page_id is not null and page_id <> ''`,
      );
      pageIds = normalizePageIds(rows.map((r) => r.page_id));
    }
    if (!pageIds.length) {
      try {
        pageIds = normalizePageIds((await listMetaPages()).map((p) => p.id));
      } catch {
        pageIds = [];
      }
    }
    if (!pageIds.length) {
      return res.status(400).json({
        message: 'No Page found. Pass page_ids, set META_ADS_PAGE_ID, or load forms from Meta first.',
      });
    }

    const results = [];
    for (const pageId of pageIds) {
      try {
        const result = await subscribePageWebhook(pageId);
        results.push({ page_id: pageId, ok: true, result });
      } catch (e) {
        results.push({ page_id: pageId, ok: false, error: e?.message || String(e) });
      }
    }

    const subscribed = results.filter((r) => r.ok).length;
    await setSyncState('webhook', {
      pages: pageIds.length,
      subscribed,
      fields: ['leadgen'],
      callback_path: '/api/webhooks/meta',
    }).catch(() => {});

    return res.json({
      ok: subscribed > 0,
      subscribed,
      attempted: pageIds.length,
      results,
      checklist: webhookChecklist(cfg),
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export function verifyMetaAdsWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = getMetaConfig().verifyToken;
  if (mode === 'subscribe' && expected && token === expected) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden');
}

export async function metaAdsWebhookEntry(req, res) {
  const cfg = getMetaConfig();
  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  if (cfg.appSecret) {
    const signature = req.headers['x-hub-signature-256'];
    if (!verifyMetaSignature(rawBody, signature)) {
      return res.status(401).json({ received: false });
    }
  }

  // Meta retries any webhook that takes too long. Acknowledge immediately and
  // fetch the lead from Graph in the background (Graph calls can take seconds).
  res.status(200).json({ received: true });
  setImmediate(() => {
    processMetaWebhookPayload(req.body || {}).catch((e) => {
      console.error('Meta webhook processing failed:', e?.message || e);
    });
  });
}

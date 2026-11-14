import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/auth';
import { API_BASE } from '../../../lib/apiBase';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

const NGOS = ['BSCT', 'AFLF', 'MANN'];
const NETWORKS = { BSCT: 'SS-BSCT', AFLF: 'SS-AFLF', MANN: 'SS-MANN' };

const n = (v) => Number(v) || 0;
const num = (v) => n(v).toLocaleString('en-IN');
const money = (v) => `₹${n(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (v) => `${n(v).toFixed(2)}%`;
const rate = (a, b) => (n(b) > 0 ? n(a) / n(b) : 0);

const safeGet = (path, fallback) => apiGet(path).catch(() => fallback);

// Editable credential fields. Verify token is deliberately absent: it stays in
// .env because it is a value we publish into Meta's dashboard.
const CONFIG_FIELDS = [
  {
    key: 'META_ADS_ACCESS_TOKEN',
    label: 'Access token',
    secret: true,
    required: true,
    hint: 'System user token with leads_retrieval. Starts with EAA… — not the CAPI dataset token.',
  },
  {
    key: 'META_ADS_APP_SECRET',
    label: 'App secret',
    secret: true,
    required: true,
    hint: 'Meta App → App settings → Basic → App secret.',
  },
  {
    key: 'META_ADS_APP_ID',
    label: 'App ID',
    advanced: true,
    hint: 'Only used to tell which app is installed on the Page.',
  },
  {
    key: 'META_ADS_AD_ACCOUNT_ID',
    label: 'Ad account id',
    advanced: true,
    hint: 'Only for spend and campaign insights. Lead capture works without it.',
  },
  {
    key: 'META_ADS_PAGE_ID',
    label: 'Page id',
    advanced: true,
    hint: 'Needed by "Subscribe Page" when Page discovery is unavailable.',
  },
  {
    key: 'META_ADS_API_VERSION',
    label: 'API version',
    advanced: true,
    hint: 'Leave v23.0 unless Meta requires another version.',
  },
];

const SOURCE_LABEL = {
  database: 'saved',
  env: '.env',
  whatsapp_fallback: 'WhatsApp fallback',
  missing: 'not set',
};

function sourceTone(info) {
  if (!info) return { color: '#5B6070', bg: '#eef1f7' };
  if (info.source === 'database' || info.source === 'env') return { color: '#0B6B3A', bg: '#dcfce7' };
  if (info.source === 'whatsapp_fallback') {
    // A WhatsApp token/app secret is a real value but the wrong one for lead
    // retrieval, so it must not look like a success.
    return info.key === 'META_ADS_APP_ID' || info.key === 'META_ADS_API_VERSION'
      ? { color: '#5B6070', bg: '#eef1f7' }
      : { color: '#b45309', bg: '#fef3c7' };
  }
  return { color: '#b91c1c', bg: '#fef2f2' };
}

function ConfigField({ field, info, value, onChange }) {
  const tone = sourceTone(info);
  const placeholder = info?.masked || info?.value || '';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#1C1E21' }}>
        {field.label}
        {field.required && <span style={{ color: '#b91c1c' }}>*</span>}
        <span style={{
          marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.2,
          color: tone.color, background: tone.bg, padding: '2px 7px', borderRadius: 999,
          textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>
          {SOURCE_LABEL[info?.source] || 'unknown'}
        </span>
      </span>
      <input
        className="wa-input"
        type={field.secret ? 'password' : 'text'}
        autoComplete="off"
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '8px 10px',
          border: '1px solid #D7DBE5', borderRadius: 8, fontSize: 12.5,
          background: '#fff', color: '#1C1E21', fontFamily: 'inherit',
        }}
      />
      <span style={{ fontSize: 10.5, color: '#5B6070', lineHeight: 1.35 }}>{field.hint}</span>
    </label>
  );
}

function Card({ title, value, sub, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(20,30,60,.10)', borderTop: `3px solid ${color || '#0866FF'}` }}>
      <div style={{ fontSize: 11.5, color: '#5B6070', fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#1C1E21', marginTop: 4 }}>{value}</div>
      {sub !== undefined && <div style={{ fontSize: 11, color: '#5B6070', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function BarRow({ label, value, max, color, caption }) {
  const width = max > 0 ? Math.max(2, Math.round((n(value) / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#5B6070', fontWeight: 600 }}>{label}</span>
        <span style={{ color: '#1C1E21', fontWeight: 800 }}>{caption ?? num(value)}</span>
      </div>
      <div style={{ height: 8, background: '#eef1f7', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${width}%`, background: color, borderRadius: 999 }} />
      </div>
    </div>
  );
}

const INTEREST_LABEL = {
  make_a_donation: 'Donation',
  'csr_/_corporate_partnership': 'CSR / Corporate',
  learn_more_about_our_ngo: 'NGO info',
};

const prettyInterest = (value) => String(value || '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean)
  .map((part) => INTEREST_LABEL[part] || part.replace(/_/g, ' ').replace(/\s+/g, ' ').trim())
  .join(' · ');

const prettyDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
};

const PLATFORM_STYLE = {
  fb: { label: 'Facebook', color: '#0866FF', bg: '#eff4ff' },
  ig: { label: 'Instagram', color: '#be185d', bg: '#fdf2f8' },
};

const AVATAR_COLORS = [
  { bg: '#dbeafe', fg: '#1d4ed8' },
  { bg: '#ede9fe', fg: '#6d28d9' },
  { bg: '#d1fae5', fg: '#047857' },
  { bg: '#ffe4e6', fg: '#be123c' },
  { bg: '#cffafe', fg: '#0e7490' },
  { bg: '#fef3c7', fg: '#b45309' },
];

const initialsOf = (name) => String(name || '?')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0].toUpperCase())
  .join('');

export default function MetaAdsTab() {
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [summary, setSummary] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [forms, setForms] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [webhookPages, setWebhookPages] = useState([]);
  const [webhookEvents, setWebhookEvents] = useState([]);
  const [metaConfig, setMetaConfig] = useState(null);
  const [configDraft, setConfigDraft] = useState({});
  const [savingConfig, setSavingConfig] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [leadRows, setLeadRows] = useState([]);
  const [leadTotal, setLeadTotal] = useState(0);
  const [leadFilters, setLeadFilters] = useState({ days: 30, platform: '', form_id: '', q: '' });
  const [leadQuery, setLeadQuery] = useState('');
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadPage, setLeadPage] = useState(1);
  const [showWebhookLog, setShowWebhookLog] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [adAccounts, setAdAccounts] = useState([]);
  const [findingAccounts, setFindingAccounts] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [newForm, setNewForm] = useState({ form_id: '', ngo: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [st, cm, sm, fn, fm, wp, mc] = await Promise.all([
        safeGet('/meta-ads/status', null),
        safeGet(`/meta-ads/campaigns?days=${days}`, []),
        safeGet(`/meta-ads/insights/summary?days=${days}`, null),
        safeGet(`/meta-ads/funnel?days=${days}`, null),
        safeGet('/meta-ads/forms', []),
        safeGet('/meta-ads/webhook/pages', { pages: [] }),
        safeGet('/meta-ads/config', null),
      ]);
      setStatus(st);
      setCampaigns(Array.isArray(cm) ? cm : []);
      setSummary(sm);
      setFunnel(fn);
      setForms(Array.isArray(fm) ? fm : []);
      setWebhookPages(Array.isArray(wp?.pages) ? wp.pages : []);
      setMetaConfig(mc);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const f of Array.isArray(fm) ? fm : []) {
          next[f.form_id] = {
            ngo: f.ngo || '',
            active: f.active !== false,
            form_name: f.form_name || '',
            page_id: f.page_id || '',
          };
        }
        return next;
      });
    } catch (e) {
      setError(e?.message || 'Could not load Meta Ads');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const loadLeads = useCallback(async () => {
    setLeadLoading(true);
    try {
      const params = new URLSearchParams({ days: String(leadFilters.days), limit: '200' });
      if (leadFilters.platform) params.set('platform', leadFilters.platform);
      if (leadFilters.form_id) params.set('form_id', leadFilters.form_id);
      if (leadFilters.q) params.set('q', leadFilters.q);
      const res = await safeGet(`/meta-ads/leads?${params.toString()}`, { rows: [], total: 0 });
      setLeadRows(Array.isArray(res?.rows) ? res.rows : []);
      setLeadTotal(Number(res?.total) || 0);
    } finally {
      setLeadLoading(false);
    }
  }, [leadFilters]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  // The delivery log is a diagnostic, not the main view: it loads on demand and
  // hides duplicate rows unless the operator asks for them.
  const loadWebhookEvents = useCallback(async () => {
    const suffix = showDuplicates ? '&include_duplicates=1' : '';
    const rows = await safeGet(`/meta-ads/webhook/events?limit=10${suffix}`, []);
    setWebhookEvents(Array.isArray(rows) ? rows : []);
  }, [showDuplicates]);

  useEffect(() => { loadWebhookEvents(); }, [loadWebhookEvents]);

  const totals = summary?.totals || {};
  const series = useMemo(() => (Array.isArray(summary?.series) ? summary.series : []).map((r) => ({
    date: String(r.date || '').slice(5),
    spend: n(r.spend),
    meta_leads: n(r.meta_leads),
    crm_leads: n(r.crm_leads),
  })), [summary]);

  const runAction = async (label, path, body = {}) => {
    if (busy) return;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      const res = await apiPost(path, body);
      if (label === 'leads') {
        setNotice(`Lead sync: ${res.ingested || 0} new, ${res.duplicates || 0} already present, ${res.failed || 0} failed.`);
      } else if (label === 'insights') {
        setNotice(`Insights synced for ${res.synced || 0} campaign-day rows.`);
      } else {
        setNotice('Done');
      }
      await load();
      await loadLeads();
    } catch (e) {
      setError(e?.message || 'Action failed');
    } finally {
      setBusy('');
    }
  };

  const saveForm = async (form) => {
    const draft = drafts[form.form_id] || {};
    setBusy(`form:${form.form_id}`);
    setError('');
    setNotice('');
    try {
      const res = await apiPost('/meta-ads/forms', {
        form_id: form.form_id,
        form_name: draft.form_name ?? form.form_name,
        page_id: draft.page_id ?? form.page_id,
        ngo: draft.ngo || '',
        active: draft.active !== false,
      });
      setNotice(`Saved ${form.form_name || form.form_id}${res.remapped ? ` — updated ${res.remapped} lead(s)` : ''}.`);
      const fresh = await safeGet('/meta-ads/forms', []);
      setForms(Array.isArray(fresh) ? fresh : []);
      const st = await safeGet('/meta-ads/status', null);
      if (st) setStatus(st);
    } catch (e) {
      setError(e?.message || 'Could not save form');
    } finally {
      setBusy('');
    }
  };

  const addForm = async () => {
    const formId = newForm.form_id.trim();
    if (!formId || busy) return;
    setBusy('form:new');
    setError('');
    setNotice('');
    try {
      const res = await apiPost('/meta-ads/forms', {
        form_id: formId,
        ngo: newForm.ngo || '',
        active: true,
      });
      setNotice(`Mapped ${formId}${res.remapped ? ` — updated ${res.remapped} lead(s)` : ''}.`);
      setNewForm({ form_id: '', ngo: '' });
      await load();
    } catch (e) {
      setError(e?.message || 'Could not map form');
    } finally {
      setBusy('');
    }
  };

  const updateFormMapping = async (form, patch) => {
    if (busy) return;
    setBusy(`form:${form.form_id}`);
    setError('');
    setNotice('');
    try {
      await apiPost('/meta-ads/forms', {
        form_id: form.form_id,
        form_name: form.form_name || '',
        page_id: form.page_id || '',
        ngo: patch.ngo !== undefined ? patch.ngo : (form.ngo || ''),
        active: patch.active !== undefined ? patch.active : form.active !== false,
      });
      const fresh = await safeGet('/meta-ads/forms', []);
      setForms(Array.isArray(fresh) ? fresh : []);
      setDrafts((prev) => ({ ...prev, [form.form_id]: { ...(prev[form.form_id] || {}), ...patch } }));
      setNotice(`Updated ${form.form_name || form.form_id}.`);
      const freshStatus = await safeGet('/meta-ads/status', null);
      if (freshStatus) setStatus(freshStatus);
      await loadLeads();
    } catch (e) {
      setError(e?.message || 'Could not update the form');
    } finally {
      setBusy('');
    }
  };

  const saveConfig = async () => {
    const payload = {};
    for (const [key, value] of Object.entries(configDraft)) {
      if (String(value || '').trim()) payload[key] = String(value).trim();
    }
    if (!Object.keys(payload).length) {
      setError('Enter at least one value — an empty form is not saved.');
      return;
    }
    setSavingConfig(true);
    setError('');
    setNotice('');
    try {
      const res = await apiPost('/meta-ads/config', payload);
      setMetaConfig(res.config || null);
      setConfigDraft({});
      setNotice(res.verification?.ok
        ? `Saved. Token verified as ${res.verification.name || res.verification.id}.`
        : 'Saved. Polling and the webhook now use this credential.');
      await load();
    } catch (e) {
      setError(e?.message || 'Could not save Meta credentials');
    } finally {
      setSavingConfig(false);
    }
  };

  const subscribeWebhook = async () => {
    if (busy) return;
    setBusy('webhook');
    setError('');
    setNotice('');
    try {
      const res = await apiPost('/meta-ads/webhook/subscribe', {});
      const failed = Array.isArray(res.results) ? res.results.filter((r) => !r.ok) : [];
      if (res.subscribed) {
        setNotice(`Page subscribed to leadgen (${res.subscribed}/${res.attempted}). Meta will now deliver leads directly.`);
      } else {
        setError('No Page could be subscribed. Enter the Page id manually (META_ADS_PAGE_ID) or check the token\'s pages_manage_metadata permission.');
      }
      if (failed.length) {
        setError(failed.map((f) => `Page ${f.page_id}: ${f.error}`).join(' · '));
      }
      await load();
    } catch (e) {
      setError(e?.message || 'Could not subscribe the Page');
    } finally {
      setBusy('');
    }
  };

  const autoMapForms = async () => {
    if (busy) return;
    setBusy('auto-map');
    setError('');
    setNotice('');
    try {
      const res = await apiPost('/meta-ads/forms/auto-map', {});
      setNotice(`Auto-mapped ${res.mapped || 0} form(s); ${res.leads_updated || 0} lead(s) tagged. Fallback: ${res.fallback}.`);
      await load();
      await loadLeads();
    } catch (e) {
      setError(e?.message || 'Auto-map failed');
    } finally {
      setBusy('');
    }
  };

  const findAdAccounts = async () => {
    setFindingAccounts(true);
    setError('');
    setNotice('');
    try {
      const list = await apiGet('/meta-ads/ad-accounts');
      const rows = Array.isArray(list) ? list : [];
      setAdAccounts(rows);
      if (!rows.length) {
        setError('This token cannot see any ad account. Assign one to the system user in Business Settings, then retry.');
      } else if (rows.length === 1) {
        const only = rows[0];
        setConfigDraft((prev) => ({ ...prev, META_ADS_AD_ACCOUNT_ID: only.account_id || only.id }));
        setNotice(`Found ${only.name || only.id}. Press Save connection to use it.`);
      } else {
        setNotice(`Found ${rows.length} ad accounts. Choose one below, then save.`);
      }
    } catch (e) {
      setError(e?.message || 'Could not list ad accounts');
    } finally {
      setFindingAccounts(false);
    }
  };

  const exportLeadsCsv = () => {
    if (!leadRows.length) return;
    const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const header = ['created_time', 'name', 'phone', 'email', 'platform', 'state', 'interest', 'form', 'campaign', 'ngo', 'inbox_url', 'lead_id'];
    const lines = [header.join(',')];
    for (const r of leadRows) {
      lines.push([
        r.created_at, r.name, r.phone, r.email, r.platform, r.state || '', r.interest || '',
        r.form_name || r.form_id, r.campaign_name || r.campaign_id, r.ngo || '', r.inbox_url || '', r.id,
      ].map(escape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meta-leads-${leadFilters.days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const header = ['Campaign', 'Status', 'Spend', 'Impressions', 'Clicks', 'Meta leads', 'CRM leads', 'CTR %', 'CPC', 'CPL'];
    const rows = campaigns.map((c) => [
      c.campaign_name || c.name || c.campaign_id,
      c.status || '',
      n(c.spend),
      n(c.impressions),
      n(c.clicks),
      n(c.meta_leads),
      n(c.crm_leads),
      n(c.ctr).toFixed(2),
      n(c.cpc).toFixed(2),
      n(c.cpl).toFixed(2),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meta-ads-campaigns-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const configured = Boolean(status?.configured);
  const insightsReady = Boolean(status?.insights);
  const connectionOpen = showConnection || !configured;
  const leadStats = useMemo(() => {
    const todayKey = new Date().toDateString();
    let today = 0;
    let facebook = 0;
    let instagram = 0;
    for (const lead of leadRows) {
      const created = lead.created_at ? new Date(lead.created_at) : null;
      if (created && created.toDateString() === todayKey) today += 1;
      if (lead.platform === 'fb') facebook += 1;
      else if (lead.platform === 'ig') instagram += 1;
    }
    return { total: leadRows.length, today, facebook, instagram };
  }, [leadRows]);
  const hasAccount = Boolean(status?.checks?.ad_account);
  const webhook = status?.webhook || {};
  const callbackUrl = `${API_BASE}/webhooks/meta`;
  const webhookChecks = [
    ['Access token', webhook.access_token],
    ['App secret', webhook.app_secret],
    ['Verify token', webhook.verify_token],
    ['Signature enforced', webhook.signature_enforced],
  ];
  const PAGE_SIZE = 10;
  const pageCount = Math.max(1, Math.ceil(leadTotal / PAGE_SIZE));
  const safePage = Math.min(Math.max(leadPage, 1), pageCount);
  const pagedLeads = leadRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const leadCountByForm = useMemo(() => {
    const map = new Map();
    for (const lead of leadRows) map.set(lead.form_id, (map.get(lead.form_id) || 0) + 1);
    return map;
  }, [leadRows]);

  const routeForms = useMemo(() => forms
    .map((form) => ({ ...form, leads: leadCountByForm.get(form.form_id) || 0 }))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 6), [forms, leadCountByForm]);

  const campaignRows = useMemo(() => {
    if (campaigns.length) return campaigns;
    const map = new Map();
    for (const lead of leadRows) {
      const id = lead.campaign_id || 'unknown';
      const row = map.get(id) || {
        campaign_id: id,
        campaign_name: lead.campaign_name || '',
        meta_leads: 0,
        crm_leads: 0,
      };
      row.meta_leads += 1;
      row.crm_leads += 1;
      map.set(id, row);
    }
    return [...map.values()];
  }, [campaigns, leadRows]);

  const fbPct = leadStats.total ? Math.round((leadStats.facebook / leadStats.total) * 1000) / 10 : 0;
  const igPct = leadStats.total ? Math.round((leadStats.instagram / leadStats.total) * 1000) / 10 : 0;
  const funnelMax = Math.max(
    funnel?.impressions || 0,
    funnel?.clicks || 0,
    funnel?.meta_leads || 0,
    funnel?.crm_leads || 0,
    funnel?.placed_leads || 0,
    1,
  );
  const mappedForms = Number(status?.counts?.mapped_forms) || 0;
  const totalForms = Number(status?.counts?.forms) || 0;
  const routePct = totalForms ? Math.round((mappedForms / totalForms) * 100) : 0;
  const unmappedLeads = leadRows.filter((lead) => !lead.ngo).length;

  const funnelSteps = [
    { label: 'Creative impressions', value: funnel?.impressions || 0, color: '#93c5fd', note: insightsReady ? 'Meta reported' : 'Needs an ad account' },
    { label: 'Ad clicks', value: funnel?.clicks || 0, color: '#60a5fa', note: funnel?.clicks ? `${pct(rate(funnel.clicks, funnel.impressions) * 100)} CTR` : '—' },
    { label: 'Meta lead submits', value: funnel?.meta_leads || leadStats.total, color: '#2563eb', note: `${leadStats.total} ingested` },
    { label: 'CRM webhook ingestion', value: leadStats.total, color: '#059669', note: `${leadStats.today} today` },
    { label: 'Placed in SS station', value: funnel?.placed_leads || 0, color: '#4f46e5', note: 'Operator reviewed' },
  ];

  const card = {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    boxShadow: '0 1px 3px rgba(15,23,42,.05)',
  };
  const sectionTitle = { fontSize: 15, fontWeight: 800, color: '#0b1c30', letterSpacing: -0.2 };
  const sectionSub = { fontSize: 11.5, color: '#64748b', marginTop: 2 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, padding: '16px 18px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: '#eff4ff', color: '#0050cd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
            M
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={sectionTitle}>Campaign operations &amp; performance</span>
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                color: configured ? '#047857' : '#b45309',
                background: configured ? '#ecfdf5' : '#fffbeb',
                border: `1px solid ${configured ? '#a7f3d0' : '#fde68a'}`,
              }}>
                {configured ? 'Live syncing' : 'Not connected'}
              </span>
            </div>
            <div style={sectionSub}>
              {status?.message || 'Checking Meta connection…'} · 5-minute polling fallback on top of the webhook
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="wa-select" style={{ width: 118 }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button className="wa-btn wa-btn-outline" onClick={() => runAction('leads', '/meta-ads/leads/sync', { sinceDays: 7 })} disabled={!!busy || !status?.lead_capture}>
            {busy === 'leads' ? 'Syncing…' : 'Sync leads'}
          </button>
          <button className="wa-btn wa-btn-outline" onClick={() => runAction('insights', '/meta-ads/insights/sync', { days })} disabled={!!busy || !hasAccount}>
            {busy === 'insights' ? 'Syncing…' : 'Sync insights'}
          </button>
          <button className="wa-btn wa-btn-outline" onClick={load} disabled={loading || !!busy}>Refresh</button>
          <button className="wa-btn wa-btn-primary" onClick={exportLeadsCsv} disabled={!leadRows.length}>Export CSV</button>
        </div>
      </div>

      <div style={{ borderRadius: 16, padding: 18, color: '#fff', background: 'linear-gradient(90deg,#1e3a8a,#312e81)', display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            ⚡
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>Webhook endpoint</span>
              {webhookChecks.map(([label, ok]) => (
                <span key={label} style={{
                  fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                  background: ok ? 'rgba(16,185,129,.18)' : 'rgba(248,113,113,.18)',
                  color: ok ? '#a7f3d0' : '#fecaca',
                  border: `1px solid ${ok ? 'rgba(16,185,129,.4)' : 'rgba(248,113,113,.4)'}`,
                }}>
                  {ok ? '✓' : '✗'} {label}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 11 }}>
              <code style={{ background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.12)', padding: '3px 8px', borderRadius: 6, color: '#dbeafe' }}>
                POST {callbackUrl}
              </code>
              <span style={{ color: '#c7d2fe' }}>
                {webhookPages[0]?.name || 'No Page'} · {webhookPages[0]?.leadgen ? 'leadgen subscribed' : 'not subscribed'}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'right', fontSize: 11, color: '#c7d2fe' }}>
            <div style={{ fontWeight: 700, color: '#fff' }}>{num(unmappedLeads)} unmapped · {num(status?.webhook?.counts?.error)} errors</div>
            <div>{num(status?.webhook?.counts?.duplicate)} duplicates filtered</div>
          </div>
          {!webhookPages[0]?.leadgen && (
            <button className="wa-btn" onClick={subscribeWebhook} disabled={!!busy || !status?.lead_capture} style={{ background: '#fff', color: '#1e3a8a', border: '1px solid #fff' }}>
              {busy === 'webhook' ? 'Subscribing…' : 'Subscribe Page'}
            </button>
          )}
          <button className="wa-btn" onClick={() => setShowWebhookLog((v) => !v)} style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.25)' }}>
            {showWebhookLog ? 'Hide log' : 'Delivery log'}
          </button>
        </div>
      </div>

      {showWebhookLog && (
        <div style={{ ...card, padding: 14 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b', marginBottom: 8 }}>
            <input type="checkbox" checked={showDuplicates} onChange={(e) => setShowDuplicates(e.target.checked)} />
            include duplicates
          </label>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Lead id', 'Status', 'Platform', 'Form', 'Received'].map((heading) => (
                    <th key={heading} style={{ textAlign: 'left', padding: '7px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .3, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {webhookEvents.map((event) => (
                  <tr key={event.meta_lead_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '7px 8px', color: '#64748b', fontFamily: 'monospace' }}>{event.meta_lead_id}</td>
                    <td style={{ padding: '7px 8px', fontWeight: 700, color: event.status === 'error' ? '#b91c1c' : event.status === 'ingested' ? '#047857' : '#b45309' }} title={event.error || ''}>
                      {event.status}{event.error ? ' ⓘ' : ''}
                    </td>
                    <td style={{ padding: '7px 8px' }}>{event.platform || '—'}</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'monospace', color: '#64748b' }}>{event.form_id || '—'}</td>
                    <td style={{ padding: '7px 8px', color: '#64748b' }}>{event.received_at ? new Date(event.received_at).toLocaleString('en-IN') : '—'}</td>
                  </tr>
                ))}
                {!webhookEvents.length && (
                  <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>No deliveries logged yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div style={{ ...card, padding: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#64748b' }}>Leads captured</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: '#0b1c30', letterSpacing: -1 }}>{num(leadStats.total)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: 999 }}>
              last {leadFilters.days}d
            </span>
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
            <span>● {num(leadStats.today)} received today</span>
            <span>{num(totalForms)} forms tracked</span>
          </div>
        </div>

        <div style={{ ...card, padding: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#64748b' }}>Platform split</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#0866ff' }}>{num(leadStats.facebook)} <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>FB</span></span>
            <span style={{ color: '#cbd5e1' }}>/</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#db2777' }}>{num(leadStats.instagram)} <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>IG</span></span>
          </div>
          <div style={{ marginTop: 12, height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex', background: '#f1f5f9' }}>
            <div style={{ width: `${fbPct}%`, background: '#0866ff' }} />
            <div style={{ width: `${igPct}%`, background: 'linear-gradient(90deg,#ec4899,#f59e0b)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginTop: 6, color: '#64748b' }}>
            <span style={{ color: '#1d4ed8', fontWeight: 700 }}>Facebook {fbPct}%</span>
            <span style={{ color: '#be185d', fontWeight: 700 }}>Instagram {igPct}%</span>
          </div>
        </div>

        <div style={{ ...card, padding: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#64748b' }}>Cost per lead</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: '#0b1c30', letterSpacing: -1 }}>{insightsReady ? money(totals.cpl) : '—'}</span>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>/ lead</span>
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#64748b' }}>
            {insightsReady
              ? <>Spend {money(totals.spend)} · {num(totals.clicks)} clicks</>
              : <>Assign an ad account to load spend and CPL</>}
          </div>
        </div>

        <div style={{ ...card, padding: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: '#64748b' }}>NGO route efficiency</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: '#0b1c30', letterSpacing: -1 }}>{routePct}%</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: 999 }}>
              {num(mappedForms)} / {num(totalForms)} mapped
            </span>
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9', fontSize: 11, color: unmappedLeads ? '#b45309' : '#047857', fontWeight: 600 }}>
            {unmappedLeads ? `${num(unmappedLeads)} lead(s) still unmapped` : '0 orphan leads — every lead has an NGO tag'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 7fr) minmax(280px, 5fr)', gap: 16 }}>
        <div style={{ ...card, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
            <div>
              <div style={{ ...sectionTitle, fontSize: 14 }}>Spend vs inbound leads</div>
              <div style={sectionSub}>{insightsReady ? `Meta spend ${money(totals.spend)} against captured leads` : 'Lead-only view — spend appears once an ad account is connected'}</div>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, fontWeight: 600 }}>
              <span style={{ color: '#1d4ed8' }}>● Spend</span>
              <span style={{ color: '#047857' }}>● Leads</span>
            </div>
          </div>
          {series.length ? (
            <div style={{ width: '100%', height: 240, marginTop: 12 }}>
              <ResponsiveContainer>
                <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar yAxisId="left" dataKey="spend" name="Spend" fill="#0050cd" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="meta_leads" name="Meta leads" stroke="#059669" strokeWidth={2.5} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="crm_leads" name="CRM leads" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ padding: '36px 0', textAlign: 'center', color: '#64748b', fontSize: 12 }}>
              No daily spend yet. Press <b>Sync insights</b> after assigning an ad account.
            </div>
          )}
          <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 10, paddingTop: 8, fontSize: 10.5, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
            <span>Attribution: 7-day click / 1-day view</span>
            <span>Meta insights refresh every 45 min</span>
          </div>
        </div>

        <div style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
            <div>
              <div style={{ ...sectionTitle, fontSize: 14 }}>Lead funnel</div>
              <div style={sectionSub}>Impressions down to SS station placement</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {funnelSteps.map((step, index) => {
              const width = Math.max(step.value > 0 ? 6 : 0, Math.round((step.value / funnelMax) * 100));
              return (
                <div key={step.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
                    <span style={{ color: '#334155', fontWeight: 600 }}>{index + 1}. {step.label}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0b1c30' }}>{num(step.value)}</span>
                  </div>
                  <div style={{ height: 8, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${width}%`, height: '100%', background: step.color, borderRadius: 999 }} />
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, textAlign: 'right' }}>{step.note}</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#64748b' }}>
            <span>Meta → CRM: <b style={{ color: '#047857' }}>{leadStats.total ? '100%' : '—'}</b></span>
            <span>Placed: <b style={{ color: '#4f46e5' }}>{num(funnel?.placed_leads || 0)}</b></span>
          </div>
        </div>
      </div>

      <div style={{ ...card, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...sectionTitle, fontSize: 14 }}>Form → NGO routing</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: 999 }}>
                {num(mappedForms)} live bindings
              </span>
            </div>
            <div style={sectionSub}>A lead from a mapped form inherits the [Account:] tag and an SS station suggestion.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="wa-btn wa-btn-outline" onClick={async () => {
              setBusy('form:refresh');
              setError('');
              try {
                const fresh = await apiGet('/meta-ads/forms?refresh=1');
                setForms(Array.isArray(fresh) ? fresh : []);
                setNotice('Form list refreshed from Meta.');
              } catch (e) {
                setError(e?.message || 'Could not refresh forms');
              } finally {
                setBusy('');
              }
            }} disabled={!!busy || !status?.lead_capture}>
              {busy === 'form:refresh' ? 'Refreshing…' : 'Fetch forms'}
            </button>
            <button className="wa-btn wa-btn-primary" onClick={autoMapForms} disabled={!!busy || !status?.lead_capture}>
              {busy === 'auto-map' ? 'Mapping…' : 'Auto-map'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
          <input
            className="wa-input"
            style={{ flex: '1 1 240px', minWidth: 200 }}
            placeholder="Meta form id"
            value={newForm.form_id}
            onChange={(e) => setNewForm((prev) => ({ ...prev, form_id: e.target.value }))}
          />
          <select
            className="wa-select"
            style={{ width: 190 }}
            value={newForm.ngo}
            onChange={(e) => setNewForm((prev) => ({ ...prev, ngo: e.target.value }))}
          >
            <option value="">Choose NGO</option>
            {NGOS.map((ngo) => <option key={ngo} value={ngo}>{ngo} → {NETWORKS[ngo]}</option>)}
          </select>
          <button className="wa-btn wa-btn-primary" onClick={addForm} disabled={!!busy || !newForm.form_id.trim()}>
            {busy === 'form:new' ? 'Mapping…' : 'Bind route'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {routeForms.map((form) => {
            const draft = drafts[form.form_id] || {};
            const active = draft.active !== false;
            return (
              <div key={form.form_id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: 'linear-gradient(180deg,#fff,#fafbfe)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0b1c30', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={form.form_name || form.form_id}>
                        {form.form_name || '(unnamed form)'}
                      </span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: form.ngo ? '#1d4ed8' : '#b45309', background: form.ngo ? '#eff6ff' : '#fffbeb', border: `1px solid ${form.ngo ? '#bfdbfe' : '#fde68a'}`, padding: '1px 6px', borderRadius: 999 }}>
                        {form.ngo || 'unmapped'}
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#94a3b8', marginTop: 2 }}>{form.form_id}</div>
                  </div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }} title={active ? 'Active' : 'Paused'}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => updateFormMapping(form, { active: e.target.checked })}
                      disabled={!!busy}
                      style={{ width: 16, height: 16 }}
                    />
                  </label>
                </div>
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span style={{ color: '#64748b' }}>Leads: <b style={{ color: '#0b1c30' }}>{num(form.leads)}</b></span>
                  <select
                    className="wa-select"
                    value={form.ngo || ''}
                    onChange={(e) => updateFormMapping(form, { ngo: e.target.value })}
                    disabled={!!busy}
                    style={{ width: 108, padding: '2px 6px', fontSize: 11 }}
                  >
                    <option value="">Unmapped</option>
                    {NGOS.map((ngo) => <option key={ngo} value={ngo}>{ngo}</option>)}
                  </select>
                  <span style={{ color: active ? '#047857' : '#94a3b8', fontWeight: 600 }}>● {active ? 'Active' : 'Paused'}</span>
                </div>
              </div>
            );
          })}
          {!routeForms.length && (
            <div style={{ padding: 18, textAlign: 'center', color: '#64748b', fontSize: 12 }}>No forms loaded yet. Press <b>Fetch forms</b>.</div>
          )}
        </div>
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...sectionTitle, fontSize: 14 }}>Campaign performance</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#475569', background: '#f1f5f9', padding: '2px 8px', borderRadius: 999 }}>
              {campaignRows.length} campaign(s)
            </span>
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {insightsReady ? 'Live attribution and cost ratios' : 'Lead counts only — spend needs an ad account'}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860, fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Campaign', 'Status', 'Spend', 'Impressions', 'Clicks', 'Meta leads', 'CRM leads', 'CPL', 'CTR'].map((heading) => (
                  <th key={heading} style={{ textAlign: heading === 'Campaign' ? 'left' : 'right', padding: '9px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaignRows.map((row) => (
                <tr key={row.campaign_id || row.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px', maxWidth: 280 }}>
                    <div style={{ fontWeight: 700, color: '#0b1c30', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.campaign_name || row.name || `Campaign ${row.campaign_id || row.id}`}
                    </div>
                    <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8' }}>{row.campaign_id || row.id}</div>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: 999 }}>
                      {String(row.status || 'active').toLowerCase()}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{row.spend != null ? money(row.spend) : '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{row.impressions != null ? num(row.impressions) : '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{row.clicks != null ? num(row.clicks) : '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{num(row.meta_leads)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#047857' }}>{num(row.crm_leads)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{row.cpl ? money(row.cpl) : '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{row.ctr ? pct(row.ctr) : '—'}</td>
                </tr>
              ))}
              {!campaignRows.length && (
                <tr><td colSpan={9} style={{ padding: 18, textAlign: 'center', color: '#64748b' }}>No campaigns yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...sectionTitle, fontSize: 14 }}>Lead ingestion stream</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '2px 8px', borderRadius: 999 }}>
                {num(leadTotal)} records
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="wa-btn wa-btn-outline" onClick={loadLeads} disabled={leadLoading}>Refresh</button>
              <button className="wa-btn wa-btn-outline" onClick={exportLeadsCsv} disabled={!leadRows.length}>Export CSV</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
            <select className="wa-select" style={{ width: 120 }} value={leadFilters.days} onChange={(e) => { setLeadPage(1); setLeadFilters((prev) => ({ ...prev, days: Number(e.target.value) })); }}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <select className="wa-select" style={{ width: 140 }} value={leadFilters.platform} onChange={(e) => { setLeadPage(1); setLeadFilters((prev) => ({ ...prev, platform: e.target.value })); }}>
              <option value="">All platforms</option>
              <option value="fb">Facebook</option>
              <option value="ig">Instagram</option>
            </select>
            <select className="wa-select" style={{ width: 210 }} value={leadFilters.form_id} onChange={(e) => { setLeadPage(1); setLeadFilters((prev) => ({ ...prev, form_id: e.target.value })); }}>
              <option value="">All forms</option>
              {forms.map((form) => <option key={form.form_id} value={form.form_id}>{form.form_name || form.form_id}</option>)}
            </select>
            <input
              className="wa-input"
              style={{ flex: '1 1 220px', minWidth: 180 }}
              placeholder="Search name, phone or email"
              value={leadQuery}
              onChange={(e) => setLeadQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setLeadPage(1); setLeadFilters((prev) => ({ ...prev, q: leadQuery.trim() })); } }}
            />
            <button className="wa-btn wa-btn-primary" onClick={() => { setLeadPage(1); setLeadFilters((prev) => ({ ...prev, q: leadQuery.trim() })); }}>Search</button>
            <span style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#94a3b8', marginLeft: 'auto' }}>
              showing {pagedLeads.length} of {num(leadTotal)}
            </span>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040, fontSize: 12 }}>
            <colgroup>
              <col style={{ width: 120 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Received', 'Lead', 'Platform', 'Contact', 'State', 'Interest', 'Campaign', 'NGO', 'Inbox'].map((heading) => (
                  <th key={heading} style={{ textAlign: 'left', padding: '9px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedLeads.map((lead, index) => {
                const avatar = AVATAR_COLORS[index % AVATAR_COLORS.length];
                const platform = PLATFORM_STYLE[lead.platform] || { label: lead.platform || '—', color: '#475569', bg: '#f1f5f9' };
                return (
                  <tr key={lead.id} style={{ borderTop: index === 0 ? 'none' : '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', color: '#64748b', fontFamily: 'monospace', fontSize: 10.5, whiteSpace: 'nowrap' }}>{prettyDate(lead.created_at)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 28, height: 28, borderRadius: 999, background: avatar.bg, color: avatar.fg, fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {initialsOf(lead.name)}
                        </span>
                        <span style={{ fontWeight: 700, color: '#0b1c30', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.name}>
                          {lead.name || '(no name)'}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: platform.color, background: platform.bg, padding: '2px 8px', borderRadius: 999 }}>{platform.label}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {lead.phone
                        ? <a href={`tel:${lead.phone}`} style={{ display: 'block', color: '#0050cd', fontWeight: 600, fontFamily: 'monospace', fontSize: 11.5 }}>{lead.phone}</a>
                        : <span style={{ color: '#94a3b8' }}>—</span>}
                      {lead.email ? (
                        <span style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.email}>{lead.email}</span>
                      ) : null}
                    </td>
                    <td style={{ padding: '10px 12px', textTransform: 'uppercase', fontWeight: 600, color: '#475569', fontSize: 11 }}>{lead.state || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 10.5, background: '#f1f5f9', color: '#334155', padding: '2px 7px', borderRadius: 6 }}>{prettyInterest(lead.interest) || '—'}</span>
                    </td>
                    <td style={{ padding: '10px 12px', maxWidth: 200 }}>
                      <div style={{ fontWeight: 600, color: '#0b1c30', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.form_name || lead.form_id}>
                        {lead.form_name || lead.form_id || '—'}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8' }}>{lead.campaign_id || ''}</div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {lead.ngo
                        ? <span style={{ fontSize: 10.5, fontWeight: 800, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: 999 }}>{lead.ngo}</span>
                        : <span style={{ fontSize: 10.5, fontWeight: 700, color: '#b45309' }}>unmapped</span>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {lead.inbox_url ? (
                        <a href={lead.inbox_url} target="_blank" rel="noreferrer" className="wa-btn wa-btn-outline" style={{ padding: '3px 8px', fontSize: 10.5, textDecoration: 'none' }}>Open</a>
                      ) : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
              {!pagedLeads.length && (
                <tr><td colSpan={9} style={{ padding: 22, textAlign: 'center', color: '#64748b' }}>{leadLoading ? 'Loading leads…' : 'No leads for these filters.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: '#64748b' }}>
          <span style={{ fontFamily: 'monospace' }}>
            {leadTotal ? `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, leadTotal)} of ${num(leadTotal)}` : '0 leads'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="wa-btn wa-btn-outline" onClick={() => setLeadPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} style={{ padding: '3px 10px', fontSize: 11 }}>Previous</button>
            <span style={{ fontWeight: 700, color: '#0b1c30' }}>{safePage} / {pageCount}</span>
            <button className="wa-btn wa-btn-outline" onClick={() => setLeadPage((p) => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount} style={{ padding: '3px 10px', fontSize: 11 }}>Next</button>
          </div>
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (!savingConfig && !busy) saveConfig(); }}
        style={{ ...card, padding: 18 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div style={{ ...sectionTitle, fontSize: 14 }}>Meta connection</div>
            <div style={sectionSub}>
              Access token and app secret live in the database (like WhatsApp accounts). The verify token stays in .env.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="wa-btn wa-btn-outline" onClick={() => setShowConnection((v) => !v)}>
              {showConnection ? 'Hide' : 'Edit'}
            </button>
            <button type="submit" className="wa-btn wa-btn-primary" disabled={savingConfig || !!busy}>
              {savingConfig ? 'Saving…' : 'Save connection'}
            </button>
          </div>
        </div>

        {connectionOpen && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 14 }}>
              {CONFIG_FIELDS.filter((f) => !f.advanced).map((field) => (
                <ConfigField
                  key={field.key}
                  field={field}
                  info={metaConfig?.fields?.[field.key.toLowerCase()]}
                  value={configDraft[field.key]}
                  onChange={(v) => setConfigDraft((prev) => ({ ...prev, [field.key]: v }))}
                />
              ))}
            </div>

            <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 14, paddingTop: 10 }}>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: '#0050cd' }}
              >
                {showAdvanced ? '− Hide optional settings' : '+ Optional settings (ad account, page id, API version)'}
              </button>

              {showAdvanced && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                    {CONFIG_FIELDS.filter((f) => f.advanced).map((field) => (
                      <ConfigField
                        key={field.key}
                        field={field}
                        info={metaConfig?.fields?.[field.key.toLowerCase()]}
                        value={configDraft[field.key]}
                        onChange={(v) => setConfigDraft((prev) => ({ ...prev, [field.key]: v }))}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                    <button type="button" className="wa-btn wa-btn-outline" onClick={findAdAccounts} disabled={findingAccounts || !status?.lead_capture}>
                      {findingAccounts ? 'Searching…' : 'Find ad accounts'}
                    </button>
                    {adAccounts.length > 1 && (
                      <select
                        className="wa-select"
                        style={{ minWidth: 240 }}
                        value={configDraft.META_ADS_AD_ACCOUNT_ID || ''}
                        onChange={(e) => setConfigDraft((prev) => ({ ...prev, META_ADS_AD_ACCOUNT_ID: e.target.value }))}
                      >
                        <option value="">Choose ad account…</option>
                        {adAccounts.map((account) => (
                          <option key={account.id} value={account.account_id || account.id}>
                            {account.name || account.id} ({account.account_id || account.id})
                          </option>
                        ))}
                      </select>
                    )}
                    <span style={{ fontSize: 10.5, color: '#94a3b8' }}>Needs the ad account assigned to the system user in Business Settings.</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{
              marginTop: 12, padding: '8px 10px', borderRadius: 8,
              background: metaConfig?.verify_token_in_env ? '#f8fafc' : '#fef2f2',
              fontSize: 11, color: metaConfig?.verify_token_in_env ? '#64748b' : '#b91c1c',
            }}>
              Verify token is read from <code>.env</code> only ({metaConfig?.verify_token_in_env ? 'currently set ✓' : 'missing ✗'}) — it is the value you paste into Meta's webhook form.
            </div>
          </>
        )}
      </form>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: '9px 13px', fontSize: 12.5, fontWeight: 600 }}>{error}</div>
      )}
      {notice && (
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', borderRadius: 10, padding: '9px 13px', fontSize: 12.5, fontWeight: 600 }}>{notice}</div>
      )}
    </div>
  );
}

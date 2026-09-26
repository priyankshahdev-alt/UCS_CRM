export const SIM_STATUSES = ['Active', 'Expiring Soon', 'Expired', 'Replaced', 'Inactive'];

export const SIM_TYPES = ['Prepaid', 'Postpaid'];

export const MAX_SIM_SLOTS = 20;

export const SIM_SLOTS = Array.from({ length: MAX_SIM_SLOTS }, (_, i) => i + 1);

export const FORM_FIELDS = [
  { key: 'mobile_id', label: 'Mobile ID No.', type: 'text' },
  { key: 'device_model', label: 'Device & Model Name', type: 'text' },
  { key: 'imei', label: 'IMEI No.', type: 'text' },
  { key: 'team', label: 'Team', type: 'text' },
  { key: 'signature', label: 'Signature', type: 'text' },
  { key: 'sim_1', label: 'SIM 1', type: 'text' },
  { key: 'sim_2', label: 'SIM 2', type: 'text' },
  { key: 'sim_3', label: 'SIM 3', type: 'text' },
  { key: 'sim_4', label: 'SIM 4', type: 'text' },
  { key: 'sim_5', label: 'SIM 5', type: 'text' },
  { key: 'sim_6', label: 'SIM 6', type: 'text' },
  { key: 'sim_7', label: 'SIM 7', type: 'text' },
  { key: 'sim_8', label: 'SIM 8', type: 'text' },
  { key: 'sim_9', label: 'SIM 9', type: 'text' },
  { key: 'sim_10', label: 'SIM 10', type: 'text' },
  { key: 'sim_11', label: 'SIM 11', type: 'text' },
  { key: 'sim_12', label: 'SIM 12', type: 'text' },
  { key: 'sim_13', label: 'SIM 13', type: 'text' },
  { key: 'sim_14', label: 'SIM 14', type: 'text' },
  { key: 'sim_15', label: 'SIM 15', type: 'text' },
  { key: 'sim_16', label: 'SIM 16', type: 'text' },
  { key: 'sim_17', label: 'SIM 17', type: 'text' },
  { key: 'sim_18', label: 'SIM 18', type: 'text' },
  { key: 'sim_19', label: 'SIM 19', type: 'text' },
  { key: 'sim_20', label: 'SIM 20', type: 'text' },
];

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysLeft(expiryDate) {
  if (!expiryDate) return null;
  const today = new Date(todayStr() + 'T00:00:00');
  const end = new Date(`${expiryDate}T00:00:00`);
  return Math.round((end - today) / 86400000);
}

export function effectiveStatus(card) {
  const base = card.status || 'Active';
  if (base === 'Replaced') return base;
  const dl = card.expiry_date ? daysLeft(card.expiry_date) : (card.days_left !== undefined && card.days_left !== null ? card.days_left : null);
  if (dl === null) return base === 'Active' ? 'Active' : 'Inactive';
  if (dl < 0) return 'Expired';
  if (base === 'Inactive') return base;
  if (base === 'Expired') return base;
  if (dl > 5) return 'Active';
  return 'Expiring Soon';
}

export function dayClass(dl) {
  if (dl === null || dl === undefined || Number.isNaN(dl)) return 'days-neutral';
  if (dl > 30) return 'days-good';
  if (dl >= 8) return 'days-warn';
  if (dl >= 1) return 'days-urgent';
  return 'days-expired';
}

export function dayLabel(dl) {
  if (dl === null || dl === undefined || Number.isNaN(dl)) return '—';
  if (dl < 0) return 'Expired';
  if (dl === 0) return 'Today';
  return `${dl} days`;
}

export function pillForStatus(status) {
  const map = {
    Active: 'pill-active',
    'Expiring Soon': 'pill-expiring',
    Expired: 'pill-expired',
    Replaced: 'pill-replaced',
    Inactive: 'pill-inactive',
    'No Sim': 'pill-inactive',
  };
  return map[status] || 'pill-neutral';
}

export function formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  if (!y || !m || !day) return d;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[Number(m) - 1]} ${y}`;
}

export const EXPORT_COLUMNS = [
  'Mobile ID No.',
  'Device & Model Name',
  'IMEI No.',
  'Sim Card Status',
  'Team',
  'Remark',
  'Sim Card Issue Date',
  'Auto Expiry Date',
  'Sim Expiry Days Left',
  'Sim 1',
  'Sim 2',
  'NGO 1',
  'W1 Number',
  'NGO 2',
  'W2 Number',
  'NGO 3',
  'W3 Number',
  'NGO 4',
  'W4 Number',
  'Sim 3',
  'Sim 4',
  'Sim Card Repla. Count',
];

export const ANDROID_EXPORT_COLUMNS = [
  'Mobile ID No.',
  'GB',
  'Device & Model Name',
  'IMEI No.',
  'Team',
  'NGO',
  'W1 Number',
  'NGO',
  'W2 Number',
  'NGO',
  'W3 Number',
  'NGO',
  'W4 Number',
];

export function androidExportRow(c) {
  return [
    c.mobile_id || '',
    c.gb || '',
    c.device_model || '',
    c.imei || '',
    c.team || '',
    c.w1_name || '',
    c.sim_1 || '',
    c.w2_name || '',
    c.sim_2 || '',
    c.w3_name || '',
    c.sim_3 || '',
    c.w4_name || '',
    c.sim_4 || '',
  ];
}

export const NOKIA_EXPORT_COLUMNS = [
  'Mobile ID No.',
  'Calling Mobile',
  'Device & Model Name',
  'IMEI No.',
  'Sim Card Status',
  'Team',
  'Remark',
  'Sim Card Issue Date',
  'Auto Expiry Date',
  'Sim Expiry Days Left',
  'Sim 1',
  'Sim 2',
  'Sim Card Repla. Count',
];

export function nokiaExportRow(c) {
  return [
    c.mobile_id || '',
    c.calling_mobile || '',
    c.device_model || '',
    c.imei || '',
    c.status || '',
    c.team || '',
    c.remark || '',
    formatDate(c.issue_date),
    formatDate(c.expiry_date),
    c.days_left === null || c.days_left === undefined || Number.isNaN(c.days_left) ? '—' : `${c.days_left} days`,
    c.sim_1 || '',
    c.sim_2 || '',
    c.replacement_count || 0,
  ];
}

function baseRow(c) {
  return [
    c.mobile_id || '',
    c.device_model || '',
    c.imei || '',
    c.status || '',
    c.team || '',
    c.signature || '',
    c.issue_date || '',
    c.expiry_date || '',
    c.days_left !== undefined && c.days_left !== null ? c.days_left : daysLeft(c.expiry_date),
    c.sim_1 || '',
    c.sim_2 || '',
    c.w1_name || '',
    c.sim_1 || '',
    c.w2_name || '',
    c.sim_2 || '',
    c.w3_name || '',
    c.sim_3 || '',
    c.w4_name || '',
    c.sim_4 || '',
    c.sim_3 || '',
    c.sim_4 || '',
    c.replacement_count || 0,
  ];
}

function buildColumns(columns) {
  return columns ? [...columns] : [...EXPORT_COLUMNS];
}

function buildRow(c, row) {
  return row ? row(c) : baseRow(c);
}

export function toExportRow(c) {
  return buildRow(c);
}


function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function exportToCSV(cards, columns, row) {
  const header = buildColumns(columns);
  const rows = [header, ...cards.map((c) => buildRow(c, row))];
  const csv = rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  downloadBlob('\ufeff' + csv, `sim-cards-${todayStr()}.csv`, 'text/csv;charset=utf-8;');
}

export function exportToExcel(cards, columns, row) {
  const xml = buildSpreadsheetXml(cards, columns, row);
  downloadBlob(xml, `sim-cards-${todayStr()}.xls`, 'application/vnd.ms-excel');
}

export function exportSimTemplate() {
  const xml = buildSpreadsheetXml([]);
  downloadBlob(xml, `sim-card-template.xls`, 'application/vnd.ms-excel');
  const csv = EXPORT_COLUMNS.join(',');
  downloadBlob('\ufeff' + csv, `sim-card-template.csv`, 'text/csv;charset=utf-8;');
}

function xmlEscape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSpreadsheetXml(cards, columns, row) {
  const header = buildColumns(columns);
  const rows = cards.map((c) => buildRow(c, row));
  const all = [header, ...rows];
  const body = all.map((r) => {
    const cells = r.map((v) => `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`).join('');
    return `<Row>${cells}</Row>`;
  }).join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="SIM Cards">
 <Table>${body}</Table>
 </Worksheet>
</Workbook>`;
}

// ---------------------------------------------------------------------------
// Nokia / Android number history
// ---------------------------------------------------------------------------
// A card is exactly one brand, decided by its Mobile ID, using the same rules
// as the list filters in SimSection.jsx and Inventory.jsx:
//   ufrs...                     -> Nokia
//   "android <n>"               -> Android
//   "android whatsapp <n>"      -> companion row, hidden from every list
export function simBrandOf(mobileId) {
  const id = String(mobileId || '').toLowerCase().trim();
  if (id.startsWith('ufrs')) return 'Nokia';
  if (id.startsWith('android whatsapp')) return '';
  if (id.startsWith('android ')) return 'Android';
  return '';
}

export const SIM_BRAND_FILTERS = ['All', 'Nokia', 'Android'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function historyValue(v) {
  if (v === null || v === undefined || v === '') return 'Blank';
  return String(v);
}

function historyAction(oldV, newV) {
  const oldEmpty = oldV === null || oldV === undefined || String(oldV).trim() === '';
  const newEmpty = newV === null || newV === undefined || String(newV).trim() === '';
  if (oldEmpty && !newEmpty) return 'Added';
  if (!oldEmpty && newEmpty) return 'Removed';
  return 'Updated';
}

function historyTime(value) {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Flattens audit rows into one entry per changed SIM slot, newest first.
// Only sim_N columns are kept: this view answers "which number changed", so
// edits to team/status/expiry and friends are intentionally left out.
export function numberHistoryEntries(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r) continue;
    const cols = r.changed_cols && typeof r.changed_cols === 'object' ? r.changed_cols : null;
    if (!cols) continue;
    const card = r.sim_cards && typeof r.sim_cards === 'object' ? r.sim_cards : {};
    for (const [key, change] of Object.entries(cols)) {
      if (!/^sim_\d+$/.test(key)) continue;
      const oldV = change && typeof change === 'object' ? change.old : change;
      const newV = change && typeof change === 'object' ? change.new : change;
      out.push({
        key: `${r.id}-${key}`,
        changed_at: r.changed_at,
        changed_by: r.changed_by || '',
        mobile_id: card.mobile_id || '',
        device_model: card.device_model || '',
        slot: key.slice(4),
        old: historyValue(oldV),
        new: historyValue(newV),
        action: historyAction(oldV, newV),
      });
    }
  }
  out.sort((a, b) => historyTime(b.changed_at) - historyTime(a.changed_at));
  return out;
}

// Buckets entries into month groups, newest month first. Entries with an
// unreadable changed_at keep their data and collect in a trailing group
// instead of being dropped.
export function groupEntriesByMonth(entries) {
  const groups = new Map();
  for (const e of entries || []) {
    const dt = new Date(e.changed_at);
    const valid = Number.isFinite(dt.getTime());
    const key = valid ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : 'unknown';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: valid ? `${MONTH_NAMES[dt.getMonth()]} ${dt.getFullYear()}` : 'Date unknown',
        entries: [],
      });
    }
    groups.get(key).entries.push(e);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === 'unknown') return 1;
    if (b.key === 'unknown') return -1;
    return b.key.localeCompare(a.key);
  });
}

// The period filter, in one place: the label the chip shows and how far back it
// reaches. Adding an option (12m, 2y, ...) is a single line here - the cutoff
// math and the row filter both read from this.
export const HISTORY_PERIODS = [
  { value: 'all', label: 'All Time', months: null },
  { value: '6m', label: '6 Month', months: 6 },
  { value: '3m', label: '3 Month', months: 3 },
];

export function historyPeriod(range) {
  return HISTORY_PERIODS.find((p) => p.value === range) || HISTORY_PERIODS[0];
}

// Period value -> YYYY-MM-DD cutoff, or null for all time.
// The day is clamped to the target month's length: d.setMonth() on the 31st
// would overflow (31 Feb -> 3 Mar) and silently shorten the window by a month.
export function historyRangeFrom(range) {
  const months = historyPeriod(range).months;
  if (!months) return null;
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), lastDay));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

const BRAND_ORDER = ['Nokia', 'Android', 'Other'];

// Applies a period option to already-loaded entries. The full history is kept
// in memory and narrowed here, so switching periods costs no request.
export function filterEntriesByRange(entries, range) {
  const from = historyRangeFrom(range);
  if (!from) return entries || [];
  const cutoff = new Date(`${from}T00:00:00`).getTime();
  if (!Number.isFinite(cutoff)) return entries || [];
  return (entries || []).filter((e) => {
    const t = new Date(e.changed_at).getTime();
    return !Number.isFinite(t) || t >= cutoff;
  });
}

// Splits entries into one section per brand, each holding its own month groups,
// so a Nokia row can never sit under an Android heading. Brands come out in a
// fixed order; months inside each stay newest first.
export function groupEntriesByBrand(entries, selectedBrand = 'All') {
  const buckets = new Map();
  for (const e of entries || []) {
    const of = simBrandOf(e.mobile_id) || 'Other';
    if (selectedBrand !== 'All' && of !== selectedBrand) continue;
    if (!buckets.has(of)) buckets.set(of, []);
    buckets.get(of).push(e);
  }
  return [...buckets.entries()]
    .sort((a, b) => {
      const ia = BRAND_ORDER.indexOf(a[0]);
      const ib = BRAND_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(([name, list]) => ({
      brand: name,
      key: name,
      label: name,
      total: list.length,
      months: groupEntriesByMonth(list),
    }));
}

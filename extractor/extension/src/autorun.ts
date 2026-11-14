/**
 * Auto-run queue: turn a short list of searches into capture jobs.
 *
 * Pure helpers only — the runner lives in background.ts so there is exactly one
 * place that owns tabs. Nothing here talks to the network or to Chrome.
 */

export type AutoSite = 'google_maps' | 'bing_search' | 'custom';

export type AutoJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface AutoJob {
  id: string;
  site: AutoSite;
  /** Human readable, e.g. "dentist in Mumbai". */
  label: string;
  url: string;
  status: AutoJobStatus;
  /** Rows the API actually accepted for this page. */
  rows: number;
  /** Rows from this page that carried a phone number when captured. */
  phones: number;
  duplicates: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AutoRunSettings {
  /** How many times to scroll the results panel before stopping capture. */
  scrollSteps: number;
  /** Wait after the page reports "complete" so a SPA can render its results. */
  settleMs: number;
  /** Gap between two pages, so a site is not hammered. */
  gapMs: number;
  /** Google Maps hides phones in the list, so visit each card's detail panel. */
  deepMaps: boolean;
  /** true = focus each tab (reliable), false = keep working in background. */
  activeTab: boolean;
  /** Stop the run once this many phone numbers have been collected (0 = no target). */
  targetPhones: number;
  /** When true, ask the backend AI for new search queries when the queue empties or target not met. */
  aiGenerate: boolean;
  /** How many new queries to request per AI batch. */
  aiBatchSize: number;
}

export interface AutoRunState {
  status: 'idle' | 'running' | 'paused' | 'done' | 'stopped';
  jobs: AutoJob[];
  /** Next job to run. Completed jobs before this index are never re-run. */
  index: number;
  settings: AutoRunSettings;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
  currentTabId: number | null;
}

export const AUTO_MAX_JOBS = 30;
export const AUTO_MAX_SCROLLS = 60;
export const AUTO_MIN_SCROLLS = 0;
export const AUTO_MIN_GAP_MS = 4000;
export const AUTO_MAX_GAP_MS = 60_000;
export const AUTO_DEFAULT_SCROLLS = 40;
export const AUTO_DEFAULT_GAP_MS = 8000;
/**
 * Upper bound for the Google Maps detail walk. A long result list can expose
 * 300+ places; each one is opened to read its phone, so this is the ceiling on
 * how much work a single Maps job can queue.
 */
export const AUTO_MAPS_DETAIL_MAX = 300;
/** Fixed waits: page load, then a second settle after the last scroll. */
export const AUTO_PAGE_SETTLE_MS = 2500;
export const AUTO_SCROLL_PAUSE_MS = 1400;

const SITE_LABELS: Record<AutoSite, string> = {
  google_maps: 'Google Maps',
  bing_search: 'Bing search',
  custom: 'Custom URL'
};

export function siteLabel(site: AutoSite): string {
  return SITE_LABELS[site] ?? site;
}

export function isAutoSite(value: unknown): value is AutoSite {
  return value === 'google_maps' || value === 'bing_search' || value === 'custom';
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

/**
 * Build the search URL for the supported, deterministic sources.
 * Facebook, Instagram and Justdial are deliberately absent: they need a login
 * or change their URL scheme per city, so a guessed URL would just waste a tab.
 * Use the "Custom URL" mode for those — paste the exact search page.
 */
export function buildSearchUrl(site: AutoSite, query: string, region: string): string {
  const term = region ? `${query} in ${region}` : query;
  if (site === 'google_maps') {
    return `https://www.google.com/maps/search/${encodeURIComponent(term)}?hl=en`;
  }
  if (site === 'bing_search') {
    return `https://www.bing.com/search?q=${encodeURIComponent(term)}&count=30`;
  }
  return query;
}

/** Custom URLs may carry {q} and {region} placeholders. */
export function expandCustomUrl(line: string, query: string, region: string): string {
  return line
    .replace(/\{q\}/gi, encodeURIComponent(query))
    .replace(/\{region\}/gi, encodeURIComponent(region));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ParseResult {
  jobs: AutoJob[];
  /** Lines that were rejected, with the reason. Never silently dropped. */
  errors: string[];
}

/**
 * The region box accepts several places at once: `Mumbai, Pune` queues one
 * search per region instead of the single confusing query
 * "dentist in Mumbai, Pune". Duplicates are dropped so a repeated city cannot
 * waste a job slot.
 */
export function splitRegions(value: string): string[] {
  const seen = new Set<string>();
  const regions: string[] = [];
  for (const part of value.split(/[,\n;]+/)) {
    const region = part.trim().replace(/\s+/g, ' ');
    if (region.length === 0) continue;
    const key = region.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    regions.push(region.slice(0, 60));
  }
  return regions;
}

/**
 * One search per line.
 * - Google Maps / Bing: `dentist` or `dentist | Pune` (per-line region override).
 * - Custom: a full http(s) URL, or `query | url` with {q} / {region} placeholders.
 *
 * A line without an override runs once for every region in the region box, so
 * "dentist" + "Mumbai, Pune" becomes two jobs.
 */
export function parseJobLines(raw: string, site: AutoSite, region: string): ParseResult {
  const jobs: AutoJob[] = [];
  const errors: string[] = [];
  const regionList = splitRegions(region);
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  let dropped = 0;
  const pushJob = (label: string, url: string): void => {
    if (jobs.length >= AUTO_MAX_JOBS) {
      dropped += 1;
      return;
    }
    jobs.push(makeJob(site, label, url));
  };

  for (const line of lines) {
    if (site === 'custom') {
      // Accept either a plain URL or `query | url` so placeholders are useful.
      const separator = line.indexOf('|');
      const query = separator >= 0 ? line.slice(0, separator).trim() : '';
      const template = (separator >= 0 ? line.slice(separator + 1) : line).trim();
      const customRegions = regionList.length > 0 ? regionList : [''];
      const seenUrls = new Set<string>();
      let badUrl = false;

      for (const target of customRegions) {
        const url = expandCustomUrl(template, query, target);
        if (!isHttpUrl(url)) {
          badUrl = true;
          break;
        }
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        pushJob(
          query.length > 0
            ? target
              ? `${query} · ${target}`
              : query
            : url.slice(0, 80),
          url
        );
      }

      if (badUrl) errors.push(`"${line.slice(0, 60)}" is not an http(s) URL.`);
      continue;
    }

    const [rawQuery, ...rawRegionParts] = line.split('|');
    const query = (rawQuery ?? '').trim();
    if (query.length < 2) {
      errors.push(`"${line.slice(0, 60)}" is too short to search.`);
      continue;
    }

    // A per-line override replaces the region box for that line.
    const override = rawRegionParts.join('|').trim();
    const targets = override.length > 0 ? splitRegions(override) : regionList;
    if (targets.length === 0) {
      pushJob(query, buildSearchUrl(site, query, ''));
      continue;
    }

    for (const target of targets) {
      pushJob(target ? `${query} · ${target}` : query, buildSearchUrl(site, query, target));
    }
  }

  if (dropped > 0) {
    errors.push(
      `Only the first ${AUTO_MAX_JOBS} searches were queued; ${dropped} more did not fit. Run them after this batch.`
    );
  }

  return { jobs, errors };
}

function makeJob(site: AutoSite, label: string, url: string): AutoJob {
  return {
    id: crypto.randomUUID(),
    site,
    label: label.slice(0, 120),
    url,
    status: 'pending',
    rows: 0,
    phones: 0,
    duplicates: 0,
    error: null,
    startedAt: null,
    finishedAt: null
  };
}

/**
 * Append Settings keywords to the multiline search box: one per line, blanks
 * dropped, duplicates ignored (case-insensitive), existing lines kept first.
 */
export function mergeKeywordLines(
  current: string,
  keywords: string[]
): { text: string; added: number } {
  const existing = current
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const seen = new Set(existing.map((line) => line.toLowerCase()));
  const added: string[] = [];

  for (const raw of keywords) {
    const keyword = raw.trim();
    if (keyword.length === 0) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(keyword);
  }

  return { text: [...existing, ...added].join('\n'), added: added.length };
}

export function summarizeRun(state: AutoRunState): string {
  const done = state.jobs.filter((job) => job.status === 'done').length;
  const failed = state.jobs.filter((job) => job.status === 'failed').length;
  const rows = state.jobs.reduce((total, job) => total + job.rows, 0);
  const phones = state.jobs.reduce((total, job) => total + job.phones, 0);
  const target = state.settings.targetPhones;
  const pages = state.jobs.length;
  const parts = [
    `${done} of ${pages} page${pages === 1 ? '' : 's'} captured`,
    `${failed} failed`,
    `${rows} row${rows === 1 ? '' : 's'} saved`,
    `${phones} number${phones === 1 ? '' : 's'} found`,
  ];
  // Never let a short run look like it met the target, but also never claim the
  // queue ended while it is still opening pages.
  if (target > 0) {
    if (phones >= target) {
      parts.push(`target ${target} reached`);
    } else if (state.status === 'running') {
      parts.push(`target ${target} not reached yet (${phones} so far)`);
    } else if (state.status === 'paused') {
      parts.push(`target ${target} not reached (paused at ${phones})`);
    } else if (state.status === 'stopped') {
      parts.push(`target ${target} not reached (stopped at ${phones})`);
    } else {
      parts.push(`target ${target} not reached (queue ended at ${phones})`);
    }
  }
  return parts.join(' · ');
}

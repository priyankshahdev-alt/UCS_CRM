/**
 * UCS capture service worker.
 *
 * The only component that talks to the API. Holds one capture session per tab,
 * batches rows, and reports real counts back to the side panel. Failures are
 * surfaced, never swallowed into a fake "success".
 *
 * It also owns the auto-run queue: one job = one search page. The worker opens
 * the page, waits, scrolls, captures, closes the tab, then moves on. The queue
 * is persisted, so if Chrome kills this worker mid-run the run comes back as
 * "paused" instead of silently pretending to continue.
 */

import {
  AUTO_MAPS_DETAIL_MAX,
  AUTO_MAX_GAP_MS,
  AUTO_MAX_JOBS,
  AUTO_MAX_SCROLLS,
  AUTO_MIN_GAP_MS,
  AUTO_MIN_SCROLLS,
  AUTO_PAGE_SETTLE_MS,
  AUTO_SCROLL_PAUSE_MS,
  AUTO_DEFAULT_GAP_MS,
  AUTO_DEFAULT_SCROLLS,
  clampNumber,
  isAutoSite,
  parseJobLines,
  summarizeRun
} from './autorun';
import type { AutoJob, AutoRunSettings, AutoRunState } from './autorun';

interface CapturedRow {
  name: string;
  phone: string | null;
  website: string | null;
  email: string | null;
  address: string | null;
  categoryLabel: string | null;
}

interface TabSession {
  tabId: number;
  sessionId: string;
  startedAt: string;
  sourceUrl: string;
  sourceName: string;
  buffer: CapturedRow[];
  sent: number;
  rejected: number;
  duplicates: number;
  withPhone: number;
  lastError: string | null;
  flushing: boolean;
  batchCounter: number;
}

interface PublicState {
  active: boolean;
  tabId: number | null;
  sessionStartedAt: string | null;
  sent: number;
  rejected: number;
  duplicates: number;
  withPhone: number;
  lastError: string | null;
  apiBaseUrl: string;
  hasToken: boolean;
  sourceHost: string | null;
}

/** Counts survive the session so a Stop still reports what was saved. */
interface CountSnapshot {
  startedAt: string;
  sourceHost: string;
  sent: number;
  rejected: number;
  duplicates: number;
  withPhone: number;
  lastError: string | null;
}

interface StopOutcome extends PublicState {
  /** Rows still held locally because the API could not be reached. */
  pending: number;
}

/** Thrown internally when the user stops a run or resumes from a new token. */
class AutoCancelled extends Error {
  constructor() {
    super('Auto-run cancelled.');
    this.name = 'AutoCancelled';
  }
}

interface ExtractorConfig {
  apiBase?: string;
  token?: string;
}

/**
 * Injected by the CRM package builder: `config.js` is prepended to this worker
 * via `importScripts` so a downloaded package already knows the API base and
 * the user's token. Loading the source folder by hand leaves this undefined and
 * the side panel's settings card is the way in.
 */
const INJECTED_CONFIG =
  (globalThis as { UCS_EXTRACTOR_CONFIG?: ExtractorConfig }).UCS_EXTRACTOR_CONFIG || {};

const DEFAULT_API_BASE = (INJECTED_CONFIG.apiBase || 'http://localhost:5000').replace(/\/+$/, '');
const DEFAULT_TOKEN = typeof INJECTED_CONFIG.token === 'string' ? INJECTED_CONFIG.token : '';
const MAX_ROWS_PER_POST = 50;
const PENDING_KEY = 'pendingCaptureQueue';

interface BatchResult {
  accepted: number;
  updated: number;
  duplicatesIgnored: number;
  rejected: number;
  rejections?: Array<{ row: number; reason: string }>;
}

interface PendingBatch {
  batchId: string;
  sessionId: string;
  sourceUrl: string;
  sourceName: string;
  rows: CapturedRow[];
}const MAX_BUFFER = 2000;
const AUTO_STORAGE_KEY = 'autoRun';
const AUTO_JOB_TIMEOUT_MS = 45_000;
/**
 * Maps place pages are read in this many tabs at once. Three keeps Google from
 * treating the walk as a scrape while cutting the phone pass to roughly a
 * third of the sequential time.
 */
const MAPS_READ_CONCURRENCY = 3;

const sessions = new Map<number, TabSession>();
const lastCounts = new Map<number, CountSnapshot>();
const autoTabs = new Set<number>();
/**
 * Maps jobs hold their rows until the phone pass has run, so a place is saved
 * once with its phone instead of twice (list row, then detail row).
 */
const holdFlushTabs = new Set<number>();
let apiBaseUrl = DEFAULT_API_BASE;
let authToken = DEFAULT_TOKEN;

let autoState: AutoRunState | null = null;
let autoLoopToken = 0;
let autoWake: (() => void) | null = null;
let keepAliveTimer: number | null = null;

async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(['apiBaseUrl', 'token']);
    const baseValue = stored['apiBaseUrl'];
    const tokenValue = stored['token'];
    apiBaseUrl =
      typeof baseValue === 'string' && baseValue.trim().length > 0
        ? baseValue.replace(/\/+$/, '')
        : DEFAULT_API_BASE;
    authToken =
      typeof tokenValue === 'string' && tokenValue.trim().length > 0
        ? tokenValue.trim()
        : DEFAULT_TOKEN;
  } catch {
    apiBaseUrl = DEFAULT_API_BASE;
    authToken = DEFAULT_TOKEN;
  }
}

const settingsReady = loadSettings();
void settingsReady.catch(() => {
  apiBaseUrl = DEFAULT_API_BASE;
  authToken = DEFAULT_TOKEN;
});

// Rows held from an earlier job (API outage, browser restart) are posted as
// soon as the worker wakes, and retried while it stays alive.
void settingsReady
  .then(() => retryPendingBatches())
  .catch(() => {});
setInterval(() => {
  void retryPendingBatches();
}, 60_000);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Sleep that a Stop can cut short. Only one wait can be interrupted at a time,
 * which is fine because the queue is strictly sequential.
 */
function autoSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      if (autoWake === finish) autoWake = null;
      resolve();
    };
    const timer = setTimeout(finish, ms);
    autoWake = finish;
  });
}

function interruptAutoSleep(): void {
  autoWake?.();
}

function startKeepAlive(): void {
  if (keepAliveTimer !== null) return;
  // MV3 workers are killed after ~30 s idle. A cheap extension API call resets
  // that timer while a queue is running (the wait for a slow page can be longer).
  keepAliveTimer = setInterval(() => {
    void chrome.runtime.getPlatformInfo().catch(() => {
      // Nothing to do; the run is persisted and can be resumed.
    });
  }, 20_000);
}

function stopKeepAlive(): void {
  if (keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// Make clicking the toolbar icon open this extension's side panel.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Older Chrome versions may not support this behavior; the panel can still
  // be opened manually from the browser's side-panel menu.
});

function publicState(tabId: number | null): PublicState {
  const session = tabId !== null ? sessions.get(tabId) : undefined;
  if (session) {
    return {
      active: true,
      tabId,
      sessionStartedAt: session.startedAt,
      sent: session.sent,
      rejected: session.rejected,
      duplicates: session.duplicates,
      withPhone: session.withPhone,
      lastError: session.lastError,
      apiBaseUrl,
      hasToken: authToken.length > 0,
      sourceHost: session.sourceName
    };
  }

  const snapshot = tabId !== null ? lastCounts.get(tabId) : undefined;
  return {
    active: false,
    tabId,
    sessionStartedAt: snapshot?.startedAt ?? null,
    sent: snapshot?.sent ?? 0,
    rejected: snapshot?.rejected ?? 0,
    duplicates: snapshot?.duplicates ?? 0,
    withPhone: snapshot?.withPhone ?? 0,
    lastError: snapshot?.lastError ?? null,
    apiBaseUrl,
    hasToken: authToken.length > 0,
    sourceHost: snapshot?.sourceHost ?? null
  };
}

function broadcast(tabId: number | null): void {
  void chrome.runtime
    .sendMessage({ type: 'UCS_STATE', state: publicState(tabId) })
    .catch(() => {
      // No side panel open. Nothing to update.
    });
}

function broadcastAutoRun(): void {
  void chrome.runtime
    .sendMessage({ type: 'UCS_AUTORUN_STATE', state: autoState })
    .catch(() => {
      // No side panel open. The state is persisted anyway.
    });
}

async function postBatch(payload: {
  batchId: string;
  sessionId: string;
  sourceUrl: string;
  sourceName: string;
  capturedAt: string;
  country?: string;
  rows: CapturedRow[];
}): Promise<BatchResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const response = await fetch(`${apiBaseUrl}/api/accounts/extractor/captures/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ country: 'IN', ...payload })
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      'CRM token missing or expired. Download a fresh package from Accounts > Extractor > Extension Setup.'
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API returned ${response.status}. ${text.slice(0, 160)}`);
  }

  return (await response.json()) as BatchResult;
}

/** Rows that could not be posted are kept here so a tab close cannot lose them. */
async function appendPendingBatch(batch: PendingBatch): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(PENDING_KEY);
    const queue = Array.isArray(stored[PENDING_KEY]) ? (stored[PENDING_KEY] as PendingBatch[]) : [];
    queue.push(batch);
    await chrome.storage.local.set({ [PENDING_KEY]: queue });
  } catch {
    // Storage is best effort; the job error already reports the loss.
  }
}

async function retryPendingBatches(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(PENDING_KEY);
    const queue = Array.isArray(stored[PENDING_KEY]) ? (stored[PENDING_KEY] as PendingBatch[]) : [];
    if (queue.length === 0) return;

    const remaining: PendingBatch[] = [];
    let saved = 0;
    for (const batch of queue) {
      try {
        const result = await postBatch({
          batchId: batch.batchId,
          sessionId: batch.sessionId,
          sourceUrl: batch.sourceUrl,
          sourceName: batch.sourceName,
          capturedAt: new Date().toISOString(),
          rows: batch.rows
        });
        saved += result.accepted + result.updated + result.duplicatesIgnored;
      } catch {
        remaining.push(batch);
      }
    }

    await chrome.storage.local.set({ [PENDING_KEY]: remaining });
    if (saved > 0) {
      void chrome.runtime
        .sendMessage({
          type: 'UCS_PENDING_FLUSHED',
          saved,
          remaining: remaining.reduce((total, batch) => total + batch.rows.length, 0)
        })
        .catch(() => {
          // No side panel open.
        });
    }
  } catch {
    // Retried again on the next tick / worker start.
  }
}

async function flush(session: TabSession): Promise<void> {
  if (session.flushing || session.buffer.length === 0) return;
  if (holdFlushTabs.has(session.tabId)) return;

  session.flushing = true;
  // Only rows with a number are kept; a listing without a phone cannot be used
  // for outreach and the API would reject it anyway.
  session.buffer = session.buffer.filter(
    (row) => Boolean(row.phone && row.phone.trim().length > 0)
  );
  if (session.buffer.length === 0) {
    session.flushing = false;
    return;
  }
  const rows = session.buffer.splice(0, MAX_ROWS_PER_POST);
  session.batchCounter += 1;

  const payload = {
    batchId: `${session.sessionId}-${session.batchCounter}`,
    sessionId: session.sessionId,
    sourceUrl: session.sourceUrl,
    sourceName: session.sourceName,
    capturedAt: new Date().toISOString(),
    rows
  };

  try {
    const result = await postBatch(payload);

    session.sent += result.accepted + result.updated;
    session.duplicates += result.duplicatesIgnored;
    session.rejected += result.rejected;
    session.lastError = null;
  } catch (error) {
    // Put the rows back so nothing is silently lost.
    session.buffer.unshift(...rows);
    if (session.buffer.length > MAX_BUFFER) {
      session.buffer.length = MAX_BUFFER;
    }
    session.lastError =
      error instanceof Error
        ? `${error.message} Rows are held locally and will retry.`
        : 'Could not reach the API. Rows are held locally and will retry.';

    setTimeout(() => {
      void flush(session);
      broadcast(session.tabId);
    }, 5000);
  } finally {
    session.flushing = false;
    broadcast(session.tabId);
  }
}

/** Drain the whole buffer, retrying a transient API outage before giving up. */
async function flushAll(session: TabSession): Promise<void> {
  for (let pass = 0; pass < 60; pass += 1) {
    if (session.buffer.length === 0) return;
    const before = session.buffer.length;
    await flush(session);
    if (session.buffer.length >= before) {
      // One failure is usually a backend restart or a flaky link. Give it a
      // few seconds before calling the job failed.
      if (pass < 3) {
        await delay(2000 * (pass + 1));
        continue;
      }
      return;
    }
  }
}

function ensureSession(tabId: number, url: string, sourceName: string): TabSession {
  const existing = sessions.get(tabId);
  if (existing) return existing;

  const session: TabSession = {
    tabId,
    sessionId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    sourceUrl: url,
    sourceName,
    buffer: [],
    sent: 0,
    rejected: 0,
    duplicates: 0,
    withPhone: 0,
    lastError: null,
    flushing: false,
    batchCounter: 0
  };
  sessions.set(tabId, session);
  lastCounts.delete(tabId);
  return session;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown source';
  }
}

async function handleStart(tabId: number, auto = false): Promise<PublicState> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab?.url ?? '';
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Open a normal http(s) page first. Chrome system pages cannot be captured.');
  }

  const session = ensureSession(tabId, url, hostOf(url));

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'UCS_START', auto });
  } catch {
    sessions.delete(tabId);
    throw new Error(
      'The page script is not loaded on this tab yet. Reload the page, then start capture again.'
    );
  }

  broadcast(tabId);
  return publicState(tabId);
}

async function handleStop(tabId: number): Promise<StopOutcome> {
  const session = sessions.get(tabId);
  if (!session) {
    return { ...publicState(tabId), pending: 0 };
  }

  await flushAll(session);
  const pending = session.buffer.length;

  if (pending > 0) {
    // The tab is about to close. Keep the unsent rows in extension storage so
    // they are retried instead of disappearing with the session.
    await appendPendingBatch({
      batchId: `${session.sessionId}-p${session.batchCounter + 1}`,
      sessionId: session.sessionId,
      sourceUrl: session.sourceUrl,
      sourceName: session.sourceName,
      rows: session.buffer.slice()
    });
  }

  lastCounts.set(tabId, {
    startedAt: session.startedAt,
    sourceHost: session.sourceName,
    sent: session.sent,
    rejected: session.rejected,
    duplicates: session.duplicates,
    withPhone: session.withPhone,
    lastError: session.lastError
  });

  sessions.delete(tabId);
  void chrome.tabs.sendMessage(tabId, { type: 'UCS_STOP' }).catch(() => {
    // Tab may have navigated away.
  });
  broadcast(tabId);
  return { ...publicState(tabId), pending };
}

// ── Auto-run queue ───────────────────────────────────────────────────────

function cancelled(token: number): boolean {
  return token !== autoLoopToken;
}

function normalizeSettings(raw: unknown): AutoRunSettings {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    scrollSteps: clampNumber(
      source.scrollSteps,
      AUTO_MIN_SCROLLS,
      AUTO_MAX_SCROLLS,
      AUTO_DEFAULT_SCROLLS
    ),
    settleMs: clampNumber(source.settleMs, 500, 15_000, AUTO_PAGE_SETTLE_MS),
    gapMs: clampNumber(source.gapMs, AUTO_MIN_GAP_MS, AUTO_MAX_GAP_MS, AUTO_DEFAULT_GAP_MS),
    deepMaps: source.deepMaps !== false,
    activeTab: source.activeTab === true,
    targetPhones: clampNumber(source.targetPhones, 0, 10_000, 0),
    aiGenerate: source.aiGenerate === true,
    aiBatchSize: clampNumber(source.aiBatchSize, 1, 10, 5)
  };
}

function normalizeJob(raw: unknown): AutoJob | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const job = raw as Record<string, unknown>;
  if (typeof job['id'] !== 'string' || typeof job['label'] !== 'string') return null;
  if (typeof job['url'] !== 'string' || !/^https?:\/\//i.test(job['url'])) return null;
  if (!isAutoSite(job['site'])) return null;

  const status = job['status'];
  const validStatus =
    status === 'done' || status === 'failed' || status === 'running' || status === 'pending'
      ? status
      : 'pending';

  return {
    id: job['id'],
    site: job['site'],
    label: job['label'].slice(0, 120),
    url: job['url'],
    // A worker death leaves "running" behind; it must be retried, not trusted.
    status: validStatus === 'running' ? 'pending' : validStatus,
    rows: clampNumber(job['rows'], 0, 1_000_000, 0),
    phones: clampNumber(job['phones'], 0, 1_000_000, 0),
    duplicates: clampNumber(job['duplicates'], 0, 1_000_000, 0),
    error: typeof job['error'] === 'string' ? job['error'] : null,
    startedAt: typeof job['startedAt'] === 'string' ? job['startedAt'] : null,
    finishedAt: typeof job['finishedAt'] === 'string' ? job['finishedAt'] : null
  };
}

function normalizeState(raw: unknown): AutoRunState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const state = raw as Record<string, unknown>;
  if (!Array.isArray(state['jobs'])) return null;

  const jobs = state['jobs'].map(normalizeJob).filter((job): job is AutoJob => job !== null);
  if (jobs.length === 0) return null;

  const status = state['status'];
  const validStatus =
    status === 'running' || status === 'paused' || status === 'done' || status === 'stopped'
      ? status
      : 'idle';

  const index = clampNumber(state['index'], 0, jobs.length, 0);
  const interrupted = validStatus === 'running';

  return {
    status: interrupted ? 'paused' : validStatus,
    jobs,
    index,
    settings: normalizeSettings(state['settings']),
    startedAt: typeof state['startedAt'] === 'string' ? state['startedAt'] : null,
    finishedAt: interrupted ? null : typeof state['finishedAt'] === 'string' ? state['finishedAt'] : null,
    message: interrupted
      ? 'Chrome stopped the background worker while this run was in progress. Press Resume to continue from the first unfinished page.'
      : typeof state['message'] === 'string'
        ? state['message']
        : null,
    currentTabId: interrupted ? null : typeof state['currentTabId'] === 'number' ? state['currentTabId'] : null
  };
}

async function persistAutoRun(): Promise<void> {
  if (!autoState) return;
  try {
    await chrome.storage.local.set({ [AUTO_STORAGE_KEY]: autoState });
  } catch {
    // Storage is best effort; the in-memory run continues.
  }
}

async function loadAutoRun(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(AUTO_STORAGE_KEY);
    autoState = normalizeState(stored[AUTO_STORAGE_KEY]);
  } catch {
    autoState = null;
  }
}

const autoReady = loadAutoRun();

async function waitForTabComplete(
  tabId: number,
  timeoutMs: number,
  token: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      clearInterval(poll);
    };

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo): void => {
      if (id === tabId && info.status === 'complete') finish();
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    const timer = setTimeout(
      () => finish(new Error('The page took too long to load.')),
      timeoutMs
    );

    const poll = setInterval(() => {
      if (cancelled(token)) finish(new AutoCancelled());
    }, 300);

    // The tab may already be complete before the listener attaches.
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') finish();
      })
      .catch(() => finish(new Error('The tab closed before it finished loading.')));
  });
}

async function startAutoCapture(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab?.url ?? '';
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('The page could not be opened (Chrome blocked this URL).');
  }

  ensureSession(tabId, url, hostOf(url));
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'UCS_START', auto: true });
      broadcast(tabId);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Could not reach the page script.';
      await delay(700);
    }
  }

  sessions.delete(tabId);
  throw new Error(
    `The page script did not respond on this page. ${lastError ?? ''}`.trim()
  );
}

async function scrollTab(tabId: number): Promise<boolean> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: 'UCS_SCROLL' })) as {
      ok?: boolean;
      scrolled?: boolean;
    };
    return Boolean(response?.ok && response.scrolled);
  } catch {
    return false;
  }
}

async function closeAutoTab(tabId: number): Promise<void> {
  autoTabs.delete(tabId);
  holdFlushTabs.delete(tabId);
  await chrome.tabs.remove(tabId).catch(() => {
    // The user may have closed it already.
  });
}

/** Stable key for a Maps place link, so repeated scrolls do not re-add it. */
function placeKey(href: string): string {
  const placeId = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(href)?.[1];
  return placeId ?? href.split('?')[0] ?? href;
}

async function collectMapsLinks(
  tabId: number,
  max: number
): Promise<Array<{ href: string; name: string }>> {
  const response = (await chrome.tabs
    .sendMessage(tabId, { type: 'UCS_MAPS_PLACES', max })
    .catch(() => null)) as
    | { ok?: boolean; places?: Array<{ href: string; name: string }> }
    | null;
  return response?.places ?? [];
}

/** Lowercase, punctuation-free name used only to pair a detail row with its card. */
function nameKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function samePlace(expected: string, actual: string): boolean {
  const left = nameKey(expected);
  const right = nameKey(actual);
  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return true;

  const leftWord = left.split(' ')[0] ?? '';
  const rightWord = right.split(' ')[0] ?? '';
  return leftWord.length > 2 && leftWord === rightWord && right.includes(leftWord);
}

interface PlaceRead {
  row: CapturedRow | null;
  opened: boolean;
}

/**
 * A place page is a full document load, so the content script may not exist for
 * the first few hundred milliseconds, and Maps renders the phone block after
 * the heading. Retry both, but never accept a heading that belongs to the
 * previous place (that would attach the wrong phone to a business).
 */
async function readPlaceWithRetry(
  tabId: number,
  place: { href: string; name: string },
  token: number
): Promise<PlaceRead> {
  const placeId = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(place.href)?.[1] ?? '';
  let lastRow: CapturedRow | null = null;
  let opened = false;
  let noPhoneReads = 0;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    if (cancelled(token)) return { row: null, opened: false };

    try {
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: 'UCS_READ_PLACE',
        name: place.name,
        placeId
      })) as
        | { ok?: boolean; ready?: boolean; row?: CapturedRow | null; opened?: boolean }
        | undefined;

      // `ready: false` means an older document answered; the new page has not
      // committed yet. Never read a phone from the previous place.
      if (response?.ok && response.ready !== false) {
        const row = response.row ?? null;
        const nameOk = placeId.length > 0 || (row !== null && samePlace(place.name, row.name));

        if (row && nameOk) {
          lastRow = row;
          opened = true;
          if (row.phone) return { row, opened: true };
          // The page is loaded and simply shows no number. Two readings are
          // enough grace for a late phone block; retrying eight times only
          // wastes seconds on every phone-less place.
          noPhoneReads += 1;
          if (noPhoneReads >= 2) return { row: lastRow, opened: true };
        } else if (response.opened) {
          opened = true;
        }
      }
    } catch {
      // The content script has not been injected into the new document yet.
    }

    await delay(700);
  }

  // A page that rendered but exposed no phone is reported as opened, so the job
  // can say "no phone on this place" instead of blaming the browser.
  return { row: lastRow, opened };
}

/**
 * Write the phone pass back into the rows that are still buffered, instead of
 * posting a second row for the same business. The API keys rows by phone when
 * one exists, so posting both would duplicate every place.
 */
function mergeMapsDetails(session: TabSession, details: CapturedRow[]): void {
  for (const detail of details) {
    // A detail page with no phone adds nothing we can use.
    if (!detail.phone || detail.phone.trim().length === 0) continue;
    const key = nameKey(detail.name);
    if (key.length === 0) continue;

    const target = session.buffer.find((row) => nameKey(row.name) === key);
    if (!target) {
      session.buffer.push(detail);
      if (detail.phone) session.withPhone += 1;
      continue;
    }

    let gainedPhone = false;
    if (!target.phone && detail.phone) {
      target.phone = detail.phone;
      gainedPhone = true;
    }
    if (!target.website && detail.website) target.website = detail.website;
    if (!target.address && detail.address) target.address = detail.address;
    if (!target.categoryLabel && detail.categoryLabel) {
      target.categoryLabel = detail.categoryLabel;
    }
    if (gainedPhone) session.withPhone += 1;
  }
}

/**
 * Google Maps hides phones on the results list. Read the place URLs from the
 * list, visit each one, and merge the phone back into the row that page already
 * produced. Places are read in a small pool of tabs so a long result list does
 * not take one page load per place in series.
 */
async function readMapsPhones(
  tabId: number,
  token: number,
  collected: Array<{ href: string; name: string }> = []
): Promise<{ links: number; visited: number; found: number; panelOpened: number }> {
  const places =
    collected.length > 0
      ? collected.slice(0, AUTO_MAPS_DETAIL_MAX)
      : await collectMapsLinks(tabId, AUTO_MAPS_DETAIL_MAX);

  if (places.length === 0) return { links: 0, visited: 0, found: 0, panelOpened: 0 };

  const session = sessions.get(tabId) ?? null;
  const details: CapturedRow[] = [];
  const queue = [...places];
  let visited = 0;
  let found = 0;
  let panelOpened = 0;

  // The list tab keeps working as the first reader; the rest are hidden tabs
  // that only exist for this walk and are always closed below.
  const extraTabs: number[] = [];
  const workerCount = Math.max(1, Math.min(MAPS_READ_CONCURRENCY, places.length));
  for (let index = 1; index < workerCount; index += 1) {
    if (cancelled(token)) break;
    try {
      const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
      if (typeof tab.id === 'number') {
        extraTabs.push(tab.id);
        autoTabs.add(tab.id);
      }
    } catch {
      // Fewer readers is slower, not broken.
    }
  }

  const runWorker = async (workerTabId: number): Promise<void> => {
    for (;;) {
      if (cancelled(token)) return;
      const place = queue.shift();
      if (!place) return;

      try {
        await chrome.tabs.update(workerTabId, { url: place.href });
      } catch {
        return;
      }

      const result = await readPlaceWithRetry(workerTabId, place, token);
      visited += 1;
      if (result.opened) panelOpened += 1;
      if (result.row) {
        details.push(result.row);
        if (result.row.phone) found += 1;
      }
    }
  };

  try {
    await Promise.all(
      [tabId, ...extraTabs].map((workerTabId) =>
        runWorker(workerTabId).catch(() => undefined)
      )
    );
  } finally {
    // A cancel must not leave stray Maps tabs behind.
    await Promise.all(
      extraTabs.map((id) =>
        chrome.tabs.remove(id).catch(() => undefined)
      )
    );
    for (const id of extraTabs) {
      autoTabs.delete(id);
      holdFlushTabs.delete(id);
      sessions.delete(id);
    }
  }

  if (session) mergeMapsDetails(session, details);
  return { links: places.length, visited, found, panelOpened };
}

async function fetchAiSuggestions(
  region: string,
  exclude: string[],
  count: number
): Promise<string[]> {
  try {
    const response = (await fetch(`${apiBaseUrl}/api/ai/suggest-searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region, count, exclude })
    }).then((r) => r.json().catch(() => ({})))) as { queries?: string[]; error?: unknown };
    if (Array.isArray(response.queries)) return response.queries;
  } catch {
    // ignore
  }
  return [];
}

async function runAutoLoop(token: number): Promise<void> {
  const state = autoState;
  if (!state) return;

  state.status = 'running';
  state.finishedAt = null;
  state.currentTabId = null;
  startKeepAlive();
  await persistAutoRun();
  broadcastAutoRun();

  const usedQueries = new Set<string>(state.jobs.map((j) => j.label));
  let totalPhones = state.jobs.reduce((t, j) => t + (j.phones || 0), 0);
  // AI batches must fan out to every region this run covers, not just the first.
  const aiRegions = [
    ...new Set(
      state.jobs
        .map((job) => (job.label.includes('·') ? job.label.split('·').pop()?.trim() ?? '' : ''))
        .filter((region) => region.length > 0)
    )
  ];

  while (true) {
    if (cancelled(token)) return;

    // Stop when target reached.
    if (state.settings.targetPhones > 0 && totalPhones >= state.settings.targetPhones) {
      break;
    }

    // Queue empty: try AI generation or stop.
    if (state.index >= state.jobs.length) {
      if (state.settings.aiGenerate && state.jobs.length < AUTO_MAX_JOBS) {
        state.message = 'Asking AI for more searches…';
        broadcastAutoRun();
        const region = aiRegions.join(', ');
        const newQueries = await fetchAiSuggestions(
          region,
          [...usedQueries],
          state.settings.aiBatchSize
        );
        if (cancelled(token)) return;
        if (newQueries.length === 0) break;
        // Keep the run inside the 30-search promise the panel makes.
        const site = state.jobs[0]?.site ?? 'google_maps';
        let added = 0;
        for (const q of newQueries) {
          const room = AUTO_MAX_JOBS - state.jobs.length;
          if (room <= 0) break;
          const parsed = parseJobLines(q, site, region);
          for (const job of parsed.jobs.slice(0, room)) {
            state.jobs.push(job);
            usedQueries.add(job.label);
            added += 1;
          }
        }
        await persistAutoRun();
        broadcastAutoRun();
        if (added === 0) break;
        if (state.index >= state.jobs.length) break;
      } else {
        break;
      }
    }
    if (cancelled(token)) return;

    const job = state.jobs[state.index];
    if (!job) break;

    if (job.status === 'done' || job.status === 'failed') {
      state.index += 1;
      continue;
    }

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.finishedAt = null;
    job.error = null;
    job.rows = 0;
    job.phones = 0;
    job.duplicates = 0;
    state.message = `Opening ${job.label}…`;
    await persistAutoRun();
    broadcastAutoRun();

    let tabId: number | null = null;
    let stoppedEarly = false;

    try {
      const tab = await chrome.tabs.create({
        url: job.url,
        active: state.settings.activeTab
      });
      tabId = tab.id ?? null;
      if (tabId === null) throw new Error('Chrome did not return a tab id for this page.');

      autoTabs.add(tabId);
      if (job.site === 'google_maps' && state.settings.deepMaps) {
        holdFlushTabs.add(tabId);
      }
      state.currentTabId = tabId;
      await persistAutoRun();
      broadcastAutoRun();

      await waitForTabComplete(tabId, AUTO_JOB_TIMEOUT_MS, token);
      if (cancelled(token)) throw new AutoCancelled();

      state.message = `Waiting for ${job.label} to render…`;
      broadcastAutoRun();
      await autoSleep(state.settings.settleMs);
      if (cancelled(token)) throw new AutoCancelled();

      await startAutoCapture(tabId);
      if (cancelled(token)) throw new AutoCancelled();

      // The content script's first scan is synchronous but its row batch is a
      // separate message. Give it a moment so a page with zero scroll steps
      // cannot be stopped before its first batch arrives.
      state.message = `Capturing ${job.label}…`;
      broadcastAutoRun();
      await autoSleep(800);
      if (cancelled(token)) throw new AutoCancelled();

      const mapsDeep = job.site === 'google_maps' && state.settings.deepMaps;
      const mapsPlaces = new Map<string, { href: string; name: string }>();
      const rememberPlaces = (places: Array<{ href: string; name: string }>): void => {
        for (const place of places) {
          if (mapsPlaces.size >= AUTO_MAPS_DETAIL_MAX) break;
          const key = placeKey(place.href);
          if (!mapsPlaces.has(key)) mapsPlaces.set(key, place);
        }
      };

      // Maps virtualises its list, so links have to be collected after every
      // scroll instead of once at the end; otherwise only ~20 places survive.
      if (mapsDeep) {
        rememberPlaces(await collectMapsLinks(tabId, 60));
        state.message = `Found ${mapsPlaces.size} place link(s) so far…`;
        broadcastAutoRun();
      }

      let emptyScrolls = 0;
      for (let step = 0; step < state.settings.scrollSteps; step += 1) {
        const scrolled = await scrollTab(tabId);
        if (cancelled(token)) throw new AutoCancelled();

        emptyScrolls = scrolled ? 0 : emptyScrolls + 1;
        state.message = `Scrolling ${job.label} (${step + 1}/${state.settings.scrollSteps})…`;
        broadcastAutoRun();

        await autoSleep(AUTO_SCROLL_PAUSE_MS);
        if (cancelled(token)) throw new AutoCancelled();

        if (mapsDeep && mapsPlaces.size < AUTO_MAPS_DETAIL_MAX) {
          rememberPlaces(await collectMapsLinks(tabId, 60));
        }

        // Two dead scrolls in a row means the page has no more content.
        if (emptyScrolls >= 2) break;
      }

      if (mapsDeep) {
        rememberPlaces(await collectMapsLinks(tabId, 60));
        state.message = `Opening ${mapsPlaces.size} place page(s) to read numbers…`;
        broadcastAutoRun();
      }

      let mapsResult: {
        links?: number;
        visited?: number;
        found?: number;
        panelOpened?: number;
      } | null = null;

      if (mapsDeep) {
        state.message = `Reading phone numbers from ${job.label}…`;
        broadcastAutoRun();

        // Every step inside is bounded (8 short retries per place), and the
        // visit list is capped by AUTO_MAPS_DETAIL_MAX.
        mapsResult = await readMapsPhones(tabId, token, [...mapsPlaces.values()]);
        if (cancelled(token)) throw new AutoCancelled();
      }

      // Rows were held while the phone pass ran; release them so handleStop
      // sends one merged batch instead of a list row plus a duplicate detail row.
      holdFlushTabs.delete(tabId);

      const outcome = await handleStop(tabId);
      job.rows = outcome.sent;
      job.phones = outcome.withPhone;
      job.duplicates = outcome.duplicates;
       totalPhones += outcome.withPhone;

      if (outcome.pending > 0) {
        job.status = 'failed';
        job.error = `${outcome.pending} row(s) could not reach the API and are saved in the extension for automatic retry.${
          outcome.lastError ? ` ${outcome.lastError}` : ''
        }`;
      } else if (outcome.sent === 0) {
        job.status = 'failed';
        job.error =
          outcome.rejected > 0
            ? `The API rejected all ${outcome.rejected} row(s) from this page.`
            : 'No leads were saved from this page. It may have hid its data, required a login, or still be loading.';
      } else {
        job.status = 'done';
        const deepMapsRan = mapsDeep && mapsResult !== null;
        const mapsVisited = mapsResult?.visited ?? 0;
        const mapsFound = mapsResult?.found ?? 0;
        const mapsLinks = mapsResult?.links ?? 0;
        const mapsOpened = mapsResult?.panelOpened ?? 0;

        if (deepMapsRan && mapsLinks === 0) {
          job.error =
            'Saved rows, but the results list exposed no place links, so no phone numbers were read.';
        } else if (deepMapsRan && mapsVisited === 0) {
          job.error = `Found ${mapsLinks} place link(s), but none could be opened. Check that tabs are allowed to open.`;
        } else if (deepMapsRan && mapsFound === 0) {
          job.error = `Visited ${mapsVisited} place page(s), but none showed a phone number.`;
        } else if (deepMapsRan && outcome.withPhone === 0) {
          job.error = `Read ${mapsFound} phone number(s), but none matched a saved row.`;
        } else if (deepMapsRan && mapsFound < mapsVisited) {
          const unopened = Math.max(0, mapsVisited - mapsOpened);
          job.error =
            unopened > 0
              ? `Read phones from ${mapsFound} of ${mapsVisited} place page(s); ${unopened} did not load and the rest showed none.`
              : `Read phones from ${mapsFound} of ${mapsVisited} place page(s); the rest showed none.`;
        } else if (outcome.withPhone === 0) {
          job.error =
            'Saved rows, but none carried a phone number. For Google Maps, enable "Open each result".';
        } else if (outcome.rejected > 0) {
          job.error = `${outcome.rejected} row(s) were rejected by the CRM. Only mobile numbers are stored, so landlines are skipped.`;
        }
      }
    } catch (error) {
      if (cancelled(token) || error instanceof AutoCancelled) {
        stoppedEarly = true;
      } else {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'This page failed.';
      }
    } finally {
      if (tabId !== null) {
        // Always release the hold: a cancelled run must still post what it read.
        holdFlushTabs.delete(tabId);
        await handleStop(tabId).catch(() => null);
        await closeAutoTab(tabId);
      }

      if (stoppedEarly || cancelled(token)) return;

      job.finishedAt = job.finishedAt ?? new Date().toISOString();
      state.index += 1;
      state.currentTabId = null;
      await persistAutoRun();
      broadcastAutoRun();
    }

    if (cancelled(token)) return;

    if (state.index < state.jobs.length) {
      const gapSeconds = Math.round(state.settings.gapMs / 1000);
      state.message = `Waiting ${gapSeconds}s before the next page…`;
      broadcastAutoRun();
      await autoSleep(state.settings.gapMs);
      if (cancelled(token)) return;
    }
  }

  if (cancelled(token)) return;

  state.status = 'done';
  state.finishedAt = new Date().toISOString();
  state.currentTabId = null;
  state.message = summarizeRun(state);
  stopKeepAlive();
  await persistAutoRun();
  broadcastAutoRun();
}

async function startAutoRun(input: {
  raw: string;
  site: string;
  region: string;
  settings: unknown;
}): Promise<{ ok: boolean; state?: AutoRunState; error?: string; errors?: string[] }> {
  await autoReady;

  if (autoState?.status === 'running') {
    return { ok: false, error: 'An auto-run is already in progress. Stop it first.' };
  }
  if (!isAutoSite(input.site)) {
    return { ok: false, error: 'Choose a source first.' };
  }

  const parsed = parseJobLines(input.raw, input.site, input.region);
  if (parsed.jobs.length === 0) {
    return {
      ok: false,
      error: parsed.errors[0] ?? 'Add at least one search line.',
      errors: parsed.errors
    };
  }

  autoLoopToken += 1;
  autoState = {
    status: 'running',
    jobs: parsed.jobs,
    index: 0,
    settings: normalizeSettings(input.settings),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message:
      parsed.errors.length > 0
        ? `Queued ${parsed.jobs.length} page(s). It will run all of them unless you press Stop. ${parsed.errors.join(' ')}`
        : `Queued ${parsed.jobs.length} page(s). It will run all of them unless you press Stop.`,
    currentTabId: null
  };

  const token = autoLoopToken;
  await persistAutoRun();
  broadcastAutoRun();
  void runAutoLoop(token).catch(async (error: unknown) => {
    if (cancelled(token) || !autoState) return;
    autoState.status = 'paused';
    autoState.message =
      error instanceof Error ? `The run paused: ${error.message}` : 'The run paused unexpectedly.';
    autoState.currentTabId = null;
    stopKeepAlive();
    await persistAutoRun();
    broadcastAutoRun();
  });

  return { ok: true, state: autoState, errors: parsed.errors };
}

async function stopAutoRun(reason: string): Promise<AutoRunState | null> {
  await autoReady;
  if (!autoState) return null;

  autoLoopToken += 1;
  interruptAutoSleep();
  stopKeepAlive();

  const state = autoState;
  const wasRunning = state.status === 'running';
  const tabId = state.currentTabId;

  // The page that was mid-flight is not finished; re-queue it so Resume (or a
  // later run) can try it again instead of labelling it "running" forever.
  const currentJob = state.jobs[state.index];
  if (currentJob && currentJob.status === 'running') {
    currentJob.status = 'pending';
    currentJob.startedAt = null;
    currentJob.error = 'Stopped before this page finished.';
  }

  state.status = 'stopped';
  state.finishedAt = new Date().toISOString();
  state.currentTabId = null;
  state.message = reason;

  await persistAutoRun();
  broadcastAutoRun();

  if (tabId !== null && wasRunning) {
    await handleStop(tabId).catch(() => null);
    await closeAutoTab(tabId);
  }

  return state;
}

async function resumeAutoRun(): Promise<{ ok: boolean; state?: AutoRunState; error?: string }> {
  await autoReady;
  if (!autoState) return { ok: false, error: 'There is no auto-run to resume.' };
  if (autoState.status === 'running') return { ok: true, state: autoState };
  if (autoState.index >= autoState.jobs.length) {
    return { ok: false, error: 'This run already finished. Start a new one.' };
  }

  const token = ++autoLoopToken;
  autoState.status = 'running';
  autoState.finishedAt = null;
  autoState.currentTabId = null;
  autoState.message = 'Resuming…';
  await persistAutoRun();
  broadcastAutoRun();

  void runAutoLoop(token).catch(async (error: unknown) => {
    if (cancelled(token) || !autoState) return;
    autoState.status = 'paused';
    autoState.message =
      error instanceof Error ? `The run paused: ${error.message}` : 'The run paused unexpectedly.';
    autoState.currentTabId = null;
    stopKeepAlive();
    await persistAutoRun();
    broadcastAutoRun();
  });

  return { ok: true, state: autoState };
}

async function clearAutoRun(): Promise<void> {
  await autoReady;
  autoLoopToken += 1;
  interruptAutoSleep();
  stopKeepAlive();

  const tabId = autoState?.currentTabId ?? null;
  autoState = null;

  if (tabId !== null) {
    await handleStop(tabId).catch(() => null);
    await closeAutoTab(tabId);
  }

  await chrome.storage.local.remove(AUTO_STORAGE_KEY).catch(() => {});
  broadcastAutoRun();
}

void autoReady;
void settingsReady;

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (response: unknown) => void) => {
    if (typeof message !== 'object' || message === null) return false;
    const typed = message as {
      type?: string;
      rows?: CapturedRow[];
      withPhone?: number;
      sourceUrl?: string;
      sourceName?: string;
      tabId?: number;
      url?: string;
      token?: string;
      raw?: string;
      site?: string;
      region?: string;
      settings?: unknown;
    };

    void settingsReady;

    if (typed.type === 'UCS_ROWS') {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return false;
      const session = sessions.get(tabId);
      if (!session) return false;

      if (typed.sourceUrl) session.sourceUrl = typed.sourceUrl;
      if (typed.sourceName) session.sourceName = typed.sourceName;
      const rows = (typed.rows ?? []).filter(
        (row) => Boolean(row.phone && row.phone.trim().length > 0)
      );
      session.buffer.push(...rows);
      session.withPhone += rows.length;

      void flush(session);
      return false;
    }

    if (typed.type === 'UCS_GET_STATE') {
      const tabId = typed.tabId ?? null;
      sendResponse(publicState(tabId));
      return false;
    }

    if (typed.type === 'UCS_START') {
      const tabId = typed.tabId;
      if (tabId === undefined) {
        sendResponse({ ok: false, error: 'No active tab.' });
        return false;
      }
      handleStart(tabId)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Could not start capture.'
          })
        );
      return true;
    }

    if (typed.type === 'UCS_STOP') {
      const tabId = typed.tabId;
      if (tabId === undefined) {
        sendResponse({ ok: false, error: 'No active tab.' });
        return false;
      }
      handleStop(tabId)
        .then(({ pending: _pending, ...state }) => sendResponse({ ok: true, state }))
        .catch(() => sendResponse({ ok: false, error: 'Could not stop capture.' }));
      return true;
    }

    if (typed.type === 'UCS_SET_API_BASE') {
      const url = (typed.url ?? '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s]+$/i.test(url)) {
        sendResponse({ ok: false, error: 'Enter a full URL, for example http://localhost:5000.' });
        return false;
      }
      apiBaseUrl = url;
      void chrome.storage.local.set({ apiBaseUrl });
      const tabId = typed.tabId ?? null;
      broadcast(tabId);
      sendResponse({ ok: true, apiBaseUrl });
      return false;
    }

    if (typed.type === 'UCS_SET_TOKEN') {
      const token = String(typed.token ?? '').trim();
      authToken = token;
      void chrome.storage.local.set({ token });
      broadcast(typed.tabId ?? null);
      sendResponse({ ok: true, hasToken: authToken.length > 0 });
      return false;
    }

    if (typed.type === 'UCS_GET_SETTINGS') {
      sendResponse({ ok: true, apiBaseUrl, hasToken: authToken.length > 0 });
      return false;
    }

    if (typed.type === 'UCS_GET_AI_KEYWORDS') {
      // The keyword vocabulary lives in the CRM's AI settings. It is the only
      // source the tagger may use, so copying it into the search queue keeps
      // the two in step. Authenticated: this is a guarded CRM route.
      const headers: Record<string, string> = {};
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      fetch(`${apiBaseUrl}/api/accounts/extractor/ai/settings`, { headers })
        .then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            throw new Error(
              'CRM token missing or expired. Download a fresh package from Accounts > Extractor.'
            );
          }
          if (!response.ok) throw new Error(`the CRM answered ${response.status}`);
          const body = (await response.json()) as {
            configured?: boolean;
            keywords?: Array<{ keyword?: unknown }>;
          };
          const keywords = (body.keywords ?? [])
            .map((item) => String(item.keyword ?? '').trim())
            .filter((keyword) => keyword.length > 0);
          sendResponse({ ok: true, keywords, configured: body.configured !== false });
        })
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Could not load the keywords.'
          })
        );
      return true;
    }

    if (typed.type === 'UCS_TEST_API') {
      const headers: Record<string, string> = {};
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      fetch(`${apiBaseUrl}/api/accounts/extractor/status`, { headers })
        .then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            throw new Error('CRM token missing or expired. Download a fresh package from the panel.');
          }
          if (!response.ok) throw new Error(`API returned ${response.status}.`);
          const body = (await response.json()) as {
            ok?: boolean;
            ready?: boolean;
            leads?: number;
            batches?: number;
            message?: string;
          };
          if (body.ok === false) {
            throw new Error(body.message || 'Extractor tables are not ready on the server.');
          }
          sendResponse({
            ok: true,
            ready: body.ready !== false,
            leads: body.leads ?? 0,
            batches: body.batches ?? 0
          });
        })
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Could not reach the CRM.'
          })
        );
      return true;
    }

    if (typed.type === 'UCS_AUTORUN_START') {
      startAutoRun({
        raw: String(typed.raw ?? ''),
        site: String(typed.site ?? ''),
        region: String(typed.region ?? ''),
        settings: typed.settings
      })
        .then((result) => sendResponse(result))
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Could not start the auto-run.'
          })
        );
      return true;
    }

    if (typed.type === 'UCS_AUTORUN_STOP') {
      stopAutoRun('Stopped by you.')
        .then((state) => sendResponse({ ok: true, state }))
        .catch(() => sendResponse({ ok: false, error: 'Could not stop the auto-run.' }));
      return true;
    }

    if (typed.type === 'UCS_AUTORUN_RESUME') {
      resumeAutoRun()
        .then((result) => sendResponse(result))
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Could not resume the auto-run.'
          })
        );
      return true;
    }

    if (typed.type === 'UCS_AUTORUN_CLEAR') {
      clearAutoRun()
        .then(() => sendResponse({ ok: true, state: null }))
        .catch(() => sendResponse({ ok: false, error: 'Could not clear the auto-run.' }));
      return true;
    }

    if (typed.type === 'UCS_AUTORUN_GET') {
      autoReady
        .then(() => sendResponse({ ok: true, state: autoState }))
        .catch(() => sendResponse({ ok: true, state: null }));
      return true;
    }

    if (typed.type === 'UCS_PING') {
      sendResponse({ ok: true });
      return false;
    }

    return false;
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  lastCounts.delete(tabId);
  autoTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && sessions.has(tabId) && !autoTabs.has(tabId)) {
    // A new document means a new content script with an empty seen-set.
    // Stop cleanly instead of pretending the old session is still capturing.
    // Auto-run tabs navigate on purpose, so the queue owns their lifecycle.
    void handleStop(tabId);
  }
});

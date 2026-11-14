/**
 * Side panel UI. Plain TypeScript + DOM: no framework, no bundler runtime cost.
 * It only ever displays what the worker reports - it never guesses a row count.
 */

import { isAutoSite, mergeKeywordLines, summarizeRun } from '../autorun';
import type { AutoJob, AutoRunState } from '../autorun';

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

function requireEl<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const statusDot = requireEl<HTMLSpanElement>('status-dot');
const statusText = requireEl<HTMLSpanElement>('status-text');
const pageHost = requireEl<HTMLParagraphElement>('page-host');
const toggleButton = requireEl<HTMLButtonElement>('toggle');
const errorMessage = requireEl<HTMLParagraphElement>('error-msg');
const statSent = requireEl<HTMLSpanElement>('stat-sent');
const statDuplicates = requireEl<HTMLSpanElement>('stat-duplicates');
const statRejected = requireEl<HTMLSpanElement>('stat-rejected');
const apiInput = requireEl<HTMLInputElement>('api-base');
const saveApiButton = requireEl<HTMLButtonElement>('save-api');
const testApiButton = requireEl<HTMLButtonElement>('test-api');
const apiMessage = requireEl<HTMLParagraphElement>('api-msg');
const tokenInput = requireEl<HTMLInputElement>('api-token');
const saveTokenButton = requireEl<HTMLButtonElement>('save-token');
const tokenMessage = requireEl<HTMLParagraphElement>('token-msg');

const autoSite = requireEl<HTMLSelectElement>('auto-site');
const autoRegion = requireEl<HTMLInputElement>('auto-region');
const autoQueries = requireEl<HTMLTextAreaElement>('auto-queries');
const autoLoadKeywords = requireEl<HTMLButtonElement>('auto-load-keywords');
const autoScrolls = requireEl<HTMLInputElement>('auto-scrolls');
const autoGap = requireEl<HTMLInputElement>('auto-gap');
const autoDeep = requireEl<HTMLInputElement>('auto-deep');
const autoFocus = requireEl<HTMLInputElement>('auto-focus');
const autoTarget = requireEl<HTMLInputElement>('auto-target');
const autoAi = requireEl<HTMLInputElement>('auto-ai');
const autoAiBatch = requireEl<HTMLInputElement>('auto-ai-batch');
const autoStartButton = requireEl<HTMLButtonElement>('auto-start');
const autoStopButton = requireEl<HTMLButtonElement>('auto-stop');
const autoResumeButton = requireEl<HTMLButtonElement>('auto-resume');
const autoError = requireEl<HTMLParagraphElement>('auto-error');
const autoNote = requireEl<HTMLParagraphElement>('auto-note');
const autoPill = requireEl<HTMLSpanElement>('auto-pill');
const autoProgress = requireEl<HTMLDivElement>('auto-progress');
const autoSummary = requireEl<HTMLElement>('auto-summary');
const autoCurrent = requireEl<HTMLSpanElement>('auto-current');
const autoJobs = requireEl<HTMLOListElement>('auto-jobs');
const autoClearButton = requireEl<HTMLButtonElement>('auto-clear');
const autoFormat = requireEl<HTMLParagraphElement>('auto-format');

let currentTabId: number | null = null;
let currentHost = '';
let pending = false;
let autoState: AutoRunState | null = null;
let pingTimer: number | null = null;
let keywordLoadBusy = false;

function setError(message: string | null): void {
  if (!message) {
    errorMessage.hidden = true;
    errorMessage.textContent = '';
    return;
  }
  errorMessage.hidden = false;
  errorMessage.textContent = message;
}

function setAutoError(message: string | null): void {
  if (!message) {
    autoError.hidden = true;
    autoError.textContent = '';
    return;
  }
  autoError.hidden = false;
  autoError.textContent = message;
}

function render(state: PublicState): void {
  statusDot.classList.toggle('on', state.active);
  statusText.textContent = state.active ? 'Capturing this tab' : 'Capture off';

  if (state.active) {
    toggleButton.textContent = 'Stop capture';
    toggleButton.classList.add('on');
  } else {
    toggleButton.textContent = 'Start capture';
    toggleButton.classList.remove('on');
  }
  toggleButton.disabled = pending;

  statSent.textContent = String(state.sent);
  statDuplicates.textContent = String(state.duplicates);
  statRejected.textContent = String(state.rejected);

  pageHost.textContent = currentHost
    ? state.active
      ? `Reading rows from ${currentHost}`
      : `Ready on ${currentHost}`
    : 'Checking the current page…';

  if (document.activeElement !== apiInput) {
    apiInput.value = state.apiBaseUrl;
  }

  if (state.hasToken) {
    tokenMessage.textContent = 'Token configured. Captures post to your CRM account.';
    tokenMessage.className = 'hint ok';
  } else if (!tokenInput.value) {
    tokenMessage.textContent = 'No token yet. Download the package from Accounts > Extractor, or paste one here.';
    tokenMessage.className = 'hint bad';
  }

  setError(state.lastError);
}

function jobMeta(job: AutoJob): string {
  if (job.status === 'pending') return 'Waiting';
  if (job.status === 'running') return 'Running now';

  const parts = [`${job.rows} saved`, `${job.phones} number${job.phones === 1 ? '' : 's'} found`];
  if (job.duplicates > 0) {
    parts.push(`${job.duplicates} duplicate${job.duplicates === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

function renderJobs(jobs: AutoJob[]): void {
  autoJobs.replaceChildren();

  for (const job of jobs) {
    const item = document.createElement('li');
    item.className = `job ${job.status}`;

    const dot = document.createElement('span');
    dot.className = 'job-dot';
    dot.setAttribute('aria-hidden', 'true');

    const main = document.createElement('div');
    main.className = 'job-main';

    const label = document.createElement('span');
    label.className = 'job-label';
    label.textContent = job.label;

    const meta = document.createElement('span');
    meta.className = 'job-meta';
    meta.textContent = jobMeta(job);

    main.append(label, meta);

    if (job.error) {
      const note = document.createElement('span');
      note.className = 'job-meta warn';
      note.textContent = job.error;
      main.append(note);
    }

    item.append(dot, main);
    autoJobs.append(item);
  }
}

function syncPing(): void {
  const running = autoState?.status === 'running';
  if (running && pingTimer === null) {
    // Keeps the MV3 worker awake while the panel is open. The worker also has
    // its own keep-alive, so closing the panel does not cancel a run.
    pingTimer = window.setInterval(() => {
      void sendMessage({ type: 'UCS_PING' }).catch(() => {
        // Worker is restarting; the next state update will restore the view.
      });
    }, 15_000);
  } else if (!running && pingTimer !== null) {
    window.clearInterval(pingTimer);
    pingTimer = null;
  }
}

function renderAuto(state: AutoRunState | null): void {
  autoState = state;
  const status = state?.status ?? 'idle';
  const running = status === 'running';
  const total = state?.jobs.length ?? 0;
  const resumable =
    state !== null &&
    (status === 'paused' || status === 'stopped') &&
    state.index < state.jobs.length;

  autoPill.textContent = status;
  autoPill.className = `pill ${status}`;

  autoProgress.hidden = state === null;
  autoStopButton.hidden = !running;
  autoResumeButton.hidden = !resumable;
  autoResumeButton.disabled = running;

  autoStartButton.disabled = running;
  autoStartButton.textContent = resumable ? 'Start a new run' : 'Start auto-run';

  for (const input of [
    autoSite,
    autoRegion,
    autoQueries,
    autoScrolls,
    autoGap,
    autoDeep,
    autoFocus,
    autoTarget,
    autoAi,
    autoAiBatch
  ]) {
    input.disabled = running;
  }
  autoLoadKeywords.disabled = running || keywordLoadBusy;

  if (!state) {
    autoSummary.textContent = 'No run yet';
    autoCurrent.textContent = '';
    autoJobs.replaceChildren();
    autoClearButton.hidden = true;
    autoNote.textContent = '';
    syncPing();
    return;
  }

  autoSummary.textContent = summarizeRun(state);
  autoCurrent.textContent =
    status === 'done'
      ? `${total} page${total === 1 ? '' : 's'}`
      : `Page ${Math.min(state.index + 1, total)} of ${total}`;
  autoNote.textContent = state.message ?? '';
  autoClearButton.hidden = running;

  renderJobs(state.jobs);
  syncPing();
}

function updateFormatHint(): void {
  const site = autoSite.value;
  if (site === 'custom') {
    autoFormat.textContent =
      'One URL per line, or query | url where the URL can contain {q} and {region}. Example: dentist | https://example.com/search?q={q}&city={region}';
    return;
  }
  if (site === 'google_maps') {
    autoFormat.textContent =
      "One search per line. Put several cities in Region separated by commas — each search runs once per city. Add | area to override the region on one line. Google Maps hides phones in its list, so 'Open each result' is on by default.";
    return;
  }
  autoFormat.textContent =
    'One search per line. Put several cities in Region separated by commas — each search runs once per city. Add | area to override the region on one line. Lines starting with # are skipped.';
}

function readForm(): {
  site: string;
  region: string;
  raw: string;
  settings: {
    scrollSteps: number;
    gapMs: number;
    deepMaps: boolean;
    activeTab: boolean;
    targetPhones: number;
    aiGenerate: boolean;
    aiBatchSize: number;
  };
} {
  return {
    site: isAutoSite(autoSite.value) ? autoSite.value : 'google_maps',
    region: autoRegion.value.trim(),
    raw: autoQueries.value,
    settings: {
      scrollSteps: Number(autoScrolls.value),
      gapMs: Number(autoGap.value) * 1000,
      deepMaps: autoDeep.checked,
      activeTab: autoFocus.checked,
      targetPhones: Number(autoTarget.value),
      aiGenerate: autoAi.checked,
      aiBatchSize: Number(autoAiBatch.value)
    }
  };
}

async function saveForm(): Promise<void> {
  const form = readForm();
  await chrome.storage.local
    .set({
      autoForm: {
        site: form.site,
        region: form.region,
        raw: form.raw,
        scrolls: Number(autoScrolls.value),
        gap: Number(autoGap.value),
        deep: autoDeep.checked,
        focus: autoFocus.checked,
         target: Number(autoTarget.value),
         ai: autoAi.checked,
         aiBatch: Number(autoAiBatch.value)
      }
    })
    .catch(() => {
      // Form persistence is a convenience, never a requirement.
    });
}

async function loadForm(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get('autoForm');
    const form = stored['autoForm'] as Record<string, unknown> | undefined;
    if (!form) return;

    if (typeof form['site'] === 'string' && isAutoSite(form['site'])) {
      autoSite.value = form['site'];
    }
    if (typeof form['region'] === 'string') autoRegion.value = form['region'];
    if (typeof form['raw'] === 'string') autoQueries.value = form['raw'];
    if (typeof form['scrolls'] === 'number') autoScrolls.value = String(form['scrolls']);
    if (typeof form['gap'] === 'number') autoGap.value = String(form['gap']);
    if (typeof form['deep'] === 'boolean') autoDeep.checked = form['deep'];
    if (typeof form['focus'] === 'boolean') autoFocus.checked = form['focus'];
    if (typeof form['target'] === 'number') autoTarget.value = String(form['target']);
    if (typeof form['ai'] === 'boolean') autoAi.checked = form['ai'];
    if (typeof form['aiBatch'] === 'number') autoAiBatch.value = String(form['aiBatch']);
  } catch {
    // Keep the defaults.
  } finally {
    updateFormatHint();
  }
}

function sendMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? 'Could not reach the extension worker.'));
        return;
      }
      resolve(response);
    });
  });
}

async function refreshState(): Promise<void> {
  const state = await sendMessage<PublicState>({
    type: 'UCS_GET_STATE',
    tabId: currentTabId
  });
  render(state);
}

async function refreshAutoRun(): Promise<void> {
  try {
    const response = await sendMessage<{ ok: boolean; state: AutoRunState | null }>({
      type: 'UCS_AUTORUN_GET'
    });
    renderAuto(response?.state ?? null);
  } catch {
    renderAuto(null);
  }
}

async function init(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  currentTabId = tab?.id ?? null;
  try {
    currentHost = tab?.url ? new URL(tab.url).hostname : '';
  } catch {
    currentHost = '';
  }

  toggleButton.disabled = currentTabId === null;

  await Promise.all([refreshState().catch(() => renderEmptyState()), loadForm()]);
  await refreshAutoRun();
}

function renderEmptyState(): void {
  pageHost.textContent = 'Could not read the current tab.';
  toggleButton.disabled = true;
}

toggleButton.addEventListener('click', () => {
  if (currentTabId === null || pending) return;
  pending = true;
  toggleButton.disabled = true;
  setError(null);

  const type = toggleButton.classList.contains('on') ? 'UCS_STOP' : 'UCS_START';

  void sendMessage<{ ok: boolean; state?: PublicState; error?: string }>({
    type,
    tabId: currentTabId
  })
    .then((response) => {
      if (!response?.ok) {
        setError(response?.error ?? 'That did not work. Try reloading the page.');
        return;
      }
      if (response.state) render(response.state);
    })
    .catch((error: unknown) => {
      setError(error instanceof Error ? error.message : 'That did not work.');
    })
    .finally(() => {
      pending = false;
      toggleButton.disabled = false;
    });
});

autoSite.addEventListener('change', () => {
  updateFormatHint();
  void saveForm();
});

// A typed number outside the input's own min/max is clamped by the worker. Do
// it in the field too, so the value shown is the value that will actually run.
for (const input of [autoScrolls, autoGap, autoAiBatch]) {
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(
      Number(input.max),
      Math.max(Number(input.min), Math.trunc(value))
    );
    if (clamped !== value) input.value = String(clamped);
    void saveForm();
  });
}

/**
 * Settings keywords are the vocabulary the AI tags leads with; they are not
 * search queries. Still, copying them into the queue is the obvious step, so
 * this button does that without retyping and without duplicating a line.
 */
autoLoadKeywords.addEventListener('click', () => {
  if (keywordLoadBusy) return;
  setAutoError(null);
  keywordLoadBusy = true;
  autoLoadKeywords.disabled = true;
  autoLoadKeywords.textContent = 'Loading…';

  // The keyword vocabulary lives in the CRM. The service worker makes the
  // authenticated call because this page cannot read the stored token.
  void sendMessage<{
    ok: boolean;
    keywords?: string[];
    configured?: boolean;
    error?: string;
  }>({ type: 'UCS_GET_AI_KEYWORDS' })
    .then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? 'Could not load keywords from the CRM.');
        return;
      }

      const keywords = response.keywords ?? [];
      if (keywords.length === 0) {
        setAutoError(
          'No AI keywords yet. Add them in Accounts > Extractor > AI & Settings, then try again.'
        );
        return;
      }
      if (response.configured === false) {
        setAutoError(
          'Keywords loaded, but GEMINI_API_KEY is not set on the CRM. Tagging will stay queued.'
        );
      }

      const merged = mergeKeywordLines(autoQueries.value, keywords);

      if (merged.added === 0) {
        autoLoadKeywords.textContent = 'Already in the list';
        return;
      }

      autoQueries.value = merged.text;
      void saveForm();
      autoLoadKeywords.textContent = `Added ${merged.added} of ${keywords.length}`;
    })
    .catch(() => setAutoError('Could not load keywords from the CRM.'))
    .finally(() => {
      keywordLoadBusy = false;
      autoLoadKeywords.disabled = false;
      window.setTimeout(() => {
        autoLoadKeywords.textContent = 'Use my AI keywords as searches';
      }, 2500);
    });
});

autoStartButton.addEventListener('click', () => {
  setAutoError(null);
  const form = readForm();

  if (form.raw.trim().length === 0) {
    setAutoError('Add at least one search line first.');
    return;
  }

  autoStartButton.disabled = true;
  void saveForm();

  void sendMessage<{
    ok: boolean;
    state?: AutoRunState;
    error?: string;
    errors?: string[];
  }>({
    type: 'UCS_AUTORUN_START',
    raw: form.raw,
    site: form.site,
    region: form.region,
    settings: form.settings
  })
    .then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? 'Could not start the auto-run.');
        autoStartButton.disabled = false;
        if (response?.errors && response.errors.length > 0) {
          autoNote.textContent = response.errors.join(' ');
        }
        return;
      }
      renderAuto(response.state ?? null);
    })
    .catch((error: unknown) => {
      setAutoError(error instanceof Error ? error.message : 'Could not start the auto-run.');
      autoStartButton.disabled = false;
    });
});

autoStopButton.addEventListener('click', () => {
  autoStopButton.disabled = true;
  setAutoError(null);

  void sendMessage<{ ok: boolean; state?: AutoRunState; error?: string }>({
    type: 'UCS_AUTORUN_STOP'
  })
    .then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? 'Could not stop the auto-run.');
        return;
      }
      renderAuto(response.state ?? null);
    })
    .catch((error: unknown) => {
      setAutoError(error instanceof Error ? error.message : 'Could not stop the auto-run.');
    })
    .finally(() => {
      autoStopButton.disabled = false;
    });
});

autoResumeButton.addEventListener('click', () => {
  autoResumeButton.disabled = true;
  setAutoError(null);

  void sendMessage<{ ok: boolean; state?: AutoRunState; error?: string }>({
    type: 'UCS_AUTORUN_RESUME'
  })
    .then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? 'Could not resume the auto-run.');
        autoResumeButton.disabled = false;
        return;
      }
      renderAuto(response.state ?? null);
    })
    .catch((error: unknown) => {
      setAutoError(error instanceof Error ? error.message : 'Could not resume the auto-run.');
      autoResumeButton.disabled = false;
    });
});

autoClearButton.addEventListener('click', () => {
  setAutoError(null);
  void sendMessage<{ ok: boolean; error?: string }>({ type: 'UCS_AUTORUN_CLEAR' })
    .then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? 'Could not clear the run.');
        return;
      }
      renderAuto(null);
    })
    .catch(() => setAutoError('Could not clear the run.'));
});

saveApiButton.addEventListener('click', () => {
  setError(null);
  void sendMessage<{ ok: boolean; error?: string; apiBaseUrl?: string }>({
    type: 'UCS_SET_API_BASE',
    url: apiInput.value,
    tabId: currentTabId
  })
    .then((response) => {
      if (!response?.ok) {
        apiMessage.textContent = response?.error ?? 'Could not save that URL.';
        apiMessage.className = 'hint bad';
        return;
      }
      apiInput.value = response.apiBaseUrl ?? apiInput.value;
      apiMessage.textContent = 'Saved.';
      apiMessage.className = 'hint ok';
    })
    .catch(() => {
      apiMessage.textContent = 'Could not save that URL.';
      apiMessage.className = 'hint bad';
    });
});

saveTokenButton.addEventListener('click', () => {
  void sendMessage<{ ok: boolean; hasToken?: boolean; error?: string }>({
    type: 'UCS_SET_TOKEN',
    token: tokenInput.value,
    tabId: currentTabId
  })
    .then((response) => {
      if (!response?.ok) {
        tokenMessage.textContent = response?.error ?? 'Could not save the token.';
        tokenMessage.className = 'hint bad';
        return;
      }
      tokenInput.value = '';
      tokenMessage.textContent = response.hasToken
        ? 'Token saved. Captures post to your CRM account.'
        : 'Token cleared.';
      tokenMessage.className = response.hasToken ? 'hint ok' : 'hint bad';
    })
    .catch(() => {
      tokenMessage.textContent = 'Could not save the token.';
      tokenMessage.className = 'hint bad';
    });
});

testApiButton.addEventListener('click', () => {
  apiMessage.textContent = 'Checking…';
  apiMessage.className = 'hint';

  void sendMessage<{
    ok: boolean;
    ready?: boolean;
    leads?: number;
    batches?: number;
    error?: string;
  }>({
    type: 'UCS_TEST_API'
  })
    .then((response) => {
      if (!response?.ok) {
        apiMessage.textContent = response?.error ?? 'Could not reach the CRM.';
        apiMessage.className = 'hint bad';
        return;
      }
      apiMessage.textContent = response.ready
        ? `CRM reachable. ${response.leads ?? 0} leads in ${response.batches ?? 0} batches.`
        : 'CRM reachable, but the Extractor tables are not ready on the server.';
      apiMessage.className = response.ready ? 'hint ok' : 'hint bad';
    })
    .catch(() => {
      apiMessage.textContent = 'Could not reach the CRM.';
      apiMessage.className = 'hint bad';
    });
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message !== 'object' || message === null) return;
  const typed = message as {
    type?: string;
    state?: PublicState | AutoRunState | null;
    saved?: number;
    remaining?: number;
  };

  if (typed.type === 'UCS_STATE' && typed.state) {
    const state = typed.state as PublicState;
    if (state.tabId === null || state.tabId === currentTabId) {
      render(state);
    }
    return;
  }

  if (typed.type === 'UCS_AUTORUN_STATE') {
    renderAuto((typed.state as AutoRunState | null) ?? null);
    return;
  }

  if (typed.type === 'UCS_PENDING_FLUSHED') {
    autoNote.textContent = `${typed.saved ?? 0} held row(s) reached the CRM.${
      typed.remaining ? ` ${typed.remaining} still waiting to retry.` : ''
    }`;
  }
});

void init().catch(() => {
  renderEmptyState();
  renderAuto(null);
});

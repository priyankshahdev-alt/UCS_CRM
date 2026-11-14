"use strict";
(() => {
  // src/autorun.ts
  function isAutoSite(value) {
    return value === "google_maps" || value === "bing_search" || value === "custom";
  }
  function mergeKeywordLines(current, keywords) {
    const existing = current.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    const seen = new Set(existing.map((line) => line.toLowerCase()));
    const added = [];
    for (const raw of keywords) {
      const keyword = raw.trim();
      if (keyword.length === 0) continue;
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(keyword);
    }
    return { text: [...existing, ...added].join("\n"), added: added.length };
  }
  function summarizeRun(state) {
    const done = state.jobs.filter((job) => job.status === "done").length;
    const failed = state.jobs.filter((job) => job.status === "failed").length;
    const rows = state.jobs.reduce((total, job) => total + job.rows, 0);
    const phones = state.jobs.reduce((total, job) => total + job.phones, 0);
    const target = state.settings.targetPhones;
    const pages = state.jobs.length;
    const parts = [
      `${done} of ${pages} page${pages === 1 ? "" : "s"} captured`,
      `${failed} failed`,
      `${rows} row${rows === 1 ? "" : "s"} saved`,
      `${phones} number${phones === 1 ? "" : "s"} found`
    ];
    if (target > 0) {
      if (phones >= target) {
        parts.push(`target ${target} reached`);
      } else if (state.status === "running") {
        parts.push(`target ${target} not reached yet (${phones} so far)`);
      } else if (state.status === "paused") {
        parts.push(`target ${target} not reached (paused at ${phones})`);
      } else if (state.status === "stopped") {
        parts.push(`target ${target} not reached (stopped at ${phones})`);
      } else {
        parts.push(`target ${target} not reached (queue ended at ${phones})`);
      }
    }
    return parts.join(" \xB7 ");
  }

  // src/sidepanel/index.ts
  function requireEl(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing element #${id}`);
    return element;
  }
  var statusDot = requireEl("status-dot");
  var statusText = requireEl("status-text");
  var pageHost = requireEl("page-host");
  var toggleButton = requireEl("toggle");
  var errorMessage = requireEl("error-msg");
  var statSent = requireEl("stat-sent");
  var statDuplicates = requireEl("stat-duplicates");
  var statRejected = requireEl("stat-rejected");
  var apiInput = requireEl("api-base");
  var saveApiButton = requireEl("save-api");
  var testApiButton = requireEl("test-api");
  var apiMessage = requireEl("api-msg");
  var tokenInput = requireEl("api-token");
  var saveTokenButton = requireEl("save-token");
  var tokenMessage = requireEl("token-msg");
  var autoSite = requireEl("auto-site");
  var autoRegion = requireEl("auto-region");
  var autoQueries = requireEl("auto-queries");
  var autoLoadKeywords = requireEl("auto-load-keywords");
  var autoScrolls = requireEl("auto-scrolls");
  var autoGap = requireEl("auto-gap");
  var autoDeep = requireEl("auto-deep");
  var autoFocus = requireEl("auto-focus");
  var autoTarget = requireEl("auto-target");
  var autoAi = requireEl("auto-ai");
  var autoAiBatch = requireEl("auto-ai-batch");
  var autoStartButton = requireEl("auto-start");
  var autoStopButton = requireEl("auto-stop");
  var autoResumeButton = requireEl("auto-resume");
  var autoError = requireEl("auto-error");
  var autoNote = requireEl("auto-note");
  var autoPill = requireEl("auto-pill");
  var autoProgress = requireEl("auto-progress");
  var autoSummary = requireEl("auto-summary");
  var autoCurrent = requireEl("auto-current");
  var autoJobs = requireEl("auto-jobs");
  var autoClearButton = requireEl("auto-clear");
  var autoFormat = requireEl("auto-format");
  var currentTabId = null;
  var currentHost = "";
  var pending = false;
  var autoState = null;
  var pingTimer = null;
  var keywordLoadBusy = false;
  function setError(message) {
    if (!message) {
      errorMessage.hidden = true;
      errorMessage.textContent = "";
      return;
    }
    errorMessage.hidden = false;
    errorMessage.textContent = message;
  }
  function setAutoError(message) {
    if (!message) {
      autoError.hidden = true;
      autoError.textContent = "";
      return;
    }
    autoError.hidden = false;
    autoError.textContent = message;
  }
  function render(state) {
    statusDot.classList.toggle("on", state.active);
    statusText.textContent = state.active ? "Capturing this tab" : "Capture off";
    if (state.active) {
      toggleButton.textContent = "Stop capture";
      toggleButton.classList.add("on");
    } else {
      toggleButton.textContent = "Start capture";
      toggleButton.classList.remove("on");
    }
    toggleButton.disabled = pending;
    statSent.textContent = String(state.sent);
    statDuplicates.textContent = String(state.duplicates);
    statRejected.textContent = String(state.rejected);
    pageHost.textContent = currentHost ? state.active ? `Reading rows from ${currentHost}` : `Ready on ${currentHost}` : "Checking the current page\u2026";
    if (document.activeElement !== apiInput) {
      apiInput.value = state.apiBaseUrl;
    }
    if (state.hasToken) {
      tokenMessage.textContent = "Token configured. Captures post to your CRM account.";
      tokenMessage.className = "hint ok";
    } else if (!tokenInput.value) {
      tokenMessage.textContent = "No token yet. Download the package from Accounts > Extractor, or paste one here.";
      tokenMessage.className = "hint bad";
    }
    setError(state.lastError);
  }
  function jobMeta(job) {
    if (job.status === "pending") return "Waiting";
    if (job.status === "running") return "Running now";
    const parts = [`${job.rows} saved`, `${job.phones} number${job.phones === 1 ? "" : "s"} found`];
    if (job.duplicates > 0) {
      parts.push(`${job.duplicates} duplicate${job.duplicates === 1 ? "" : "s"}`);
    }
    return parts.join(" \xB7 ");
  }
  function renderJobs(jobs) {
    autoJobs.replaceChildren();
    for (const job of jobs) {
      const item = document.createElement("li");
      item.className = `job ${job.status}`;
      const dot = document.createElement("span");
      dot.className = "job-dot";
      dot.setAttribute("aria-hidden", "true");
      const main = document.createElement("div");
      main.className = "job-main";
      const label = document.createElement("span");
      label.className = "job-label";
      label.textContent = job.label;
      const meta = document.createElement("span");
      meta.className = "job-meta";
      meta.textContent = jobMeta(job);
      main.append(label, meta);
      if (job.error) {
        const note = document.createElement("span");
        note.className = "job-meta warn";
        note.textContent = job.error;
        main.append(note);
      }
      item.append(dot, main);
      autoJobs.append(item);
    }
  }
  function syncPing() {
    const running = autoState?.status === "running";
    if (running && pingTimer === null) {
      pingTimer = window.setInterval(() => {
        void sendMessage({ type: "UCS_PING" }).catch(() => {
        });
      }, 15e3);
    } else if (!running && pingTimer !== null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
  }
  function renderAuto(state) {
    autoState = state;
    const status = state?.status ?? "idle";
    const running = status === "running";
    const total = state?.jobs.length ?? 0;
    const resumable = state !== null && (status === "paused" || status === "stopped") && state.index < state.jobs.length;
    autoPill.textContent = status;
    autoPill.className = `pill ${status}`;
    autoProgress.hidden = state === null;
    autoStopButton.hidden = !running;
    autoResumeButton.hidden = !resumable;
    autoResumeButton.disabled = running;
    autoStartButton.disabled = running;
    autoStartButton.textContent = resumable ? "Start a new run" : "Start auto-run";
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
      autoSummary.textContent = "No run yet";
      autoCurrent.textContent = "";
      autoJobs.replaceChildren();
      autoClearButton.hidden = true;
      autoNote.textContent = "";
      syncPing();
      return;
    }
    autoSummary.textContent = summarizeRun(state);
    autoCurrent.textContent = status === "done" ? `${total} page${total === 1 ? "" : "s"}` : `Page ${Math.min(state.index + 1, total)} of ${total}`;
    autoNote.textContent = state.message ?? "";
    autoClearButton.hidden = running;
    renderJobs(state.jobs);
    syncPing();
  }
  function updateFormatHint() {
    const site = autoSite.value;
    if (site === "custom") {
      autoFormat.textContent = "One URL per line, or query | url where the URL can contain {q} and {region}. Example: dentist | https://example.com/search?q={q}&city={region}";
      return;
    }
    if (site === "google_maps") {
      autoFormat.textContent = "One search per line. Put several cities in Region separated by commas \u2014 each search runs once per city. Add | area to override the region on one line. Google Maps hides phones in its list, so 'Open each result' is on by default.";
      return;
    }
    autoFormat.textContent = "One search per line. Put several cities in Region separated by commas \u2014 each search runs once per city. Add | area to override the region on one line. Lines starting with # are skipped.";
  }
  function readForm() {
    return {
      site: isAutoSite(autoSite.value) ? autoSite.value : "google_maps",
      region: autoRegion.value.trim(),
      raw: autoQueries.value,
      settings: {
        scrollSteps: Number(autoScrolls.value),
        gapMs: Number(autoGap.value) * 1e3,
        deepMaps: autoDeep.checked,
        activeTab: autoFocus.checked,
        targetPhones: Number(autoTarget.value),
        aiGenerate: autoAi.checked,
        aiBatchSize: Number(autoAiBatch.value)
      }
    };
  }
  async function saveForm() {
    const form = readForm();
    await chrome.storage.local.set({
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
    }).catch(() => {
    });
  }
  async function loadForm() {
    try {
      const stored = await chrome.storage.local.get("autoForm");
      const form = stored["autoForm"];
      if (!form) return;
      if (typeof form["site"] === "string" && isAutoSite(form["site"])) {
        autoSite.value = form["site"];
      }
      if (typeof form["region"] === "string") autoRegion.value = form["region"];
      if (typeof form["raw"] === "string") autoQueries.value = form["raw"];
      if (typeof form["scrolls"] === "number") autoScrolls.value = String(form["scrolls"]);
      if (typeof form["gap"] === "number") autoGap.value = String(form["gap"]);
      if (typeof form["deep"] === "boolean") autoDeep.checked = form["deep"];
      if (typeof form["focus"] === "boolean") autoFocus.checked = form["focus"];
      if (typeof form["target"] === "number") autoTarget.value = String(form["target"]);
      if (typeof form["ai"] === "boolean") autoAi.checked = form["ai"];
      if (typeof form["aiBatch"] === "number") autoAiBatch.value = String(form["aiBatch"]);
    } catch {
    } finally {
      updateFormatHint();
    }
  }
  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message ?? "Could not reach the extension worker."));
          return;
        }
        resolve(response);
      });
    });
  }
  async function refreshState() {
    const state = await sendMessage({
      type: "UCS_GET_STATE",
      tabId: currentTabId
    });
    render(state);
  }
  async function refreshAutoRun() {
    try {
      const response = await sendMessage({
        type: "UCS_AUTORUN_GET"
      });
      renderAuto(response?.state ?? null);
    } catch {
      renderAuto(null);
    }
  }
  async function init() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    currentTabId = tab?.id ?? null;
    try {
      currentHost = tab?.url ? new URL(tab.url).hostname : "";
    } catch {
      currentHost = "";
    }
    toggleButton.disabled = currentTabId === null;
    await Promise.all([refreshState().catch(() => renderEmptyState()), loadForm()]);
    await refreshAutoRun();
  }
  function renderEmptyState() {
    pageHost.textContent = "Could not read the current tab.";
    toggleButton.disabled = true;
  }
  toggleButton.addEventListener("click", () => {
    if (currentTabId === null || pending) return;
    pending = true;
    toggleButton.disabled = true;
    setError(null);
    const type = toggleButton.classList.contains("on") ? "UCS_STOP" : "UCS_START";
    void sendMessage({
      type,
      tabId: currentTabId
    }).then((response) => {
      if (!response?.ok) {
        setError(response?.error ?? "That did not work. Try reloading the page.");
        return;
      }
      if (response.state) render(response.state);
    }).catch((error) => {
      setError(error instanceof Error ? error.message : "That did not work.");
    }).finally(() => {
      pending = false;
      toggleButton.disabled = false;
    });
  });
  autoSite.addEventListener("change", () => {
    updateFormatHint();
    void saveForm();
  });
  for (const input of [autoScrolls, autoGap, autoAiBatch]) {
    input.addEventListener("change", () => {
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
  autoLoadKeywords.addEventListener("click", () => {
    if (keywordLoadBusy) return;
    setAutoError(null);
    keywordLoadBusy = true;
    autoLoadKeywords.disabled = true;
    autoLoadKeywords.textContent = "Loading\u2026";
    void sendMessage({ type: "UCS_GET_AI_KEYWORDS" }).then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? "Could not load keywords from the CRM.");
        return;
      }
      const keywords = response.keywords ?? [];
      if (keywords.length === 0) {
        setAutoError(
          "No AI keywords yet. Add them in Accounts > Extractor > AI & Settings, then try again."
        );
        return;
      }
      if (response.configured === false) {
        setAutoError(
          "Keywords loaded, but GEMINI_API_KEY is not set on the CRM. Tagging will stay queued."
        );
      }
      const merged = mergeKeywordLines(autoQueries.value, keywords);
      if (merged.added === 0) {
        autoLoadKeywords.textContent = "Already in the list";
        return;
      }
      autoQueries.value = merged.text;
      void saveForm();
      autoLoadKeywords.textContent = `Added ${merged.added} of ${keywords.length}`;
    }).catch(() => setAutoError("Could not load keywords from the CRM.")).finally(() => {
      keywordLoadBusy = false;
      autoLoadKeywords.disabled = false;
      window.setTimeout(() => {
        autoLoadKeywords.textContent = "Use my AI keywords as searches";
      }, 2500);
    });
  });
  autoStartButton.addEventListener("click", () => {
    setAutoError(null);
    const form = readForm();
    if (form.raw.trim().length === 0) {
      setAutoError("Add at least one search line first.");
      return;
    }
    autoStartButton.disabled = true;
    void saveForm();
    void sendMessage({
      type: "UCS_AUTORUN_START",
      raw: form.raw,
      site: form.site,
      region: form.region,
      settings: form.settings
    }).then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? "Could not start the auto-run.");
        autoStartButton.disabled = false;
        if (response?.errors && response.errors.length > 0) {
          autoNote.textContent = response.errors.join(" ");
        }
        return;
      }
      renderAuto(response.state ?? null);
    }).catch((error) => {
      setAutoError(error instanceof Error ? error.message : "Could not start the auto-run.");
      autoStartButton.disabled = false;
    });
  });
  autoStopButton.addEventListener("click", () => {
    autoStopButton.disabled = true;
    setAutoError(null);
    void sendMessage({
      type: "UCS_AUTORUN_STOP"
    }).then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? "Could not stop the auto-run.");
        return;
      }
      renderAuto(response.state ?? null);
    }).catch((error) => {
      setAutoError(error instanceof Error ? error.message : "Could not stop the auto-run.");
    }).finally(() => {
      autoStopButton.disabled = false;
    });
  });
  autoResumeButton.addEventListener("click", () => {
    autoResumeButton.disabled = true;
    setAutoError(null);
    void sendMessage({
      type: "UCS_AUTORUN_RESUME"
    }).then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? "Could not resume the auto-run.");
        autoResumeButton.disabled = false;
        return;
      }
      renderAuto(response.state ?? null);
    }).catch((error) => {
      setAutoError(error instanceof Error ? error.message : "Could not resume the auto-run.");
      autoResumeButton.disabled = false;
    });
  });
  autoClearButton.addEventListener("click", () => {
    setAutoError(null);
    void sendMessage({ type: "UCS_AUTORUN_CLEAR" }).then((response) => {
      if (!response?.ok) {
        setAutoError(response?.error ?? "Could not clear the run.");
        return;
      }
      renderAuto(null);
    }).catch(() => setAutoError("Could not clear the run."));
  });
  saveApiButton.addEventListener("click", () => {
    setError(null);
    void sendMessage({
      type: "UCS_SET_API_BASE",
      url: apiInput.value,
      tabId: currentTabId
    }).then((response) => {
      if (!response?.ok) {
        apiMessage.textContent = response?.error ?? "Could not save that URL.";
        apiMessage.className = "hint bad";
        return;
      }
      apiInput.value = response.apiBaseUrl ?? apiInput.value;
      apiMessage.textContent = "Saved.";
      apiMessage.className = "hint ok";
    }).catch(() => {
      apiMessage.textContent = "Could not save that URL.";
      apiMessage.className = "hint bad";
    });
  });
  saveTokenButton.addEventListener("click", () => {
    void sendMessage({
      type: "UCS_SET_TOKEN",
      token: tokenInput.value,
      tabId: currentTabId
    }).then((response) => {
      if (!response?.ok) {
        tokenMessage.textContent = response?.error ?? "Could not save the token.";
        tokenMessage.className = "hint bad";
        return;
      }
      tokenInput.value = "";
      tokenMessage.textContent = response.hasToken ? "Token saved. Captures post to your CRM account." : "Token cleared.";
      tokenMessage.className = response.hasToken ? "hint ok" : "hint bad";
    }).catch(() => {
      tokenMessage.textContent = "Could not save the token.";
      tokenMessage.className = "hint bad";
    });
  });
  testApiButton.addEventListener("click", () => {
    apiMessage.textContent = "Checking\u2026";
    apiMessage.className = "hint";
    void sendMessage({
      type: "UCS_TEST_API"
    }).then((response) => {
      if (!response?.ok) {
        apiMessage.textContent = response?.error ?? "Could not reach the CRM.";
        apiMessage.className = "hint bad";
        return;
      }
      apiMessage.textContent = response.ready ? `CRM reachable. ${response.leads ?? 0} leads in ${response.batches ?? 0} batches.` : "CRM reachable, but the Extractor tables are not ready on the server.";
      apiMessage.className = response.ready ? "hint ok" : "hint bad";
    }).catch(() => {
      apiMessage.textContent = "Could not reach the CRM.";
      apiMessage.className = "hint bad";
    });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (typeof message !== "object" || message === null) return;
    const typed = message;
    if (typed.type === "UCS_STATE" && typed.state) {
      const state = typed.state;
      if (state.tabId === null || state.tabId === currentTabId) {
        render(state);
      }
      return;
    }
    if (typed.type === "UCS_AUTORUN_STATE") {
      renderAuto(typed.state ?? null);
      return;
    }
    if (typed.type === "UCS_PENDING_FLUSHED") {
      autoNote.textContent = `${typed.saved ?? 0} held row(s) reached the CRM.${typed.remaining ? ` ${typed.remaining} still waiting to retry.` : ""}`;
    }
  });
  void init().catch(() => {
    renderEmptyState();
    renderAuto(null);
  });
})();

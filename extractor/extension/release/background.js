"use strict";
(() => {
  // src/autorun.ts
  var AUTO_MAX_JOBS = 30;
  var AUTO_MAX_SCROLLS = 60;
  var AUTO_MIN_SCROLLS = 0;
  var AUTO_MIN_GAP_MS = 4e3;
  var AUTO_MAX_GAP_MS = 6e4;
  var AUTO_DEFAULT_SCROLLS = 40;
  var AUTO_DEFAULT_GAP_MS = 8e3;
  var AUTO_MAPS_DETAIL_MAX = 300;
  var AUTO_PAGE_SETTLE_MS = 2500;
  var AUTO_SCROLL_PAUSE_MS = 1400;
  function isAutoSite(value) {
    return value === "google_maps" || value === "bing_search" || value === "custom";
  }
  function clampNumber(value, min, max, fallback) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(numeric)));
  }
  function buildSearchUrl(site, query, region) {
    const term = region ? `${query} in ${region}` : query;
    if (site === "google_maps") {
      return `https://www.google.com/maps/search/${encodeURIComponent(term)}?hl=en`;
    }
    if (site === "bing_search") {
      return `https://www.bing.com/search?q=${encodeURIComponent(term)}&count=30`;
    }
    return query;
  }
  function expandCustomUrl(line, query, region) {
    return line.replace(/\{q\}/gi, encodeURIComponent(query)).replace(/\{region\}/gi, encodeURIComponent(region));
  }
  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
  function splitRegions(value) {
    const seen = /* @__PURE__ */ new Set();
    const regions = [];
    for (const part of value.split(/[,\n;]+/)) {
      const region = part.trim().replace(/\s+/g, " ");
      if (region.length === 0) continue;
      const key = region.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      regions.push(region.slice(0, 60));
    }
    return regions;
  }
  function parseJobLines(raw, site, region) {
    const jobs = [];
    const errors = [];
    const regionList = splitRegions(region);
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
    let dropped = 0;
    const pushJob = (label, url) => {
      if (jobs.length >= AUTO_MAX_JOBS) {
        dropped += 1;
        return;
      }
      jobs.push(makeJob(site, label, url));
    };
    for (const line of lines) {
      if (site === "custom") {
        const separator = line.indexOf("|");
        const query2 = separator >= 0 ? line.slice(0, separator).trim() : "";
        const template = (separator >= 0 ? line.slice(separator + 1) : line).trim();
        const customRegions = regionList.length > 0 ? regionList : [""];
        const seenUrls = /* @__PURE__ */ new Set();
        let badUrl = false;
        for (const target of customRegions) {
          const url = expandCustomUrl(template, query2, target);
          if (!isHttpUrl(url)) {
            badUrl = true;
            break;
          }
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          pushJob(
            query2.length > 0 ? target ? `${query2} \xB7 ${target}` : query2 : url.slice(0, 80),
            url
          );
        }
        if (badUrl) errors.push(`"${line.slice(0, 60)}" is not an http(s) URL.`);
        continue;
      }
      const [rawQuery, ...rawRegionParts] = line.split("|");
      const query = (rawQuery ?? "").trim();
      if (query.length < 2) {
        errors.push(`"${line.slice(0, 60)}" is too short to search.`);
        continue;
      }
      const override = rawRegionParts.join("|").trim();
      const targets = override.length > 0 ? splitRegions(override) : regionList;
      if (targets.length === 0) {
        pushJob(query, buildSearchUrl(site, query, ""));
        continue;
      }
      for (const target of targets) {
        pushJob(target ? `${query} \xB7 ${target}` : query, buildSearchUrl(site, query, target));
      }
    }
    if (dropped > 0) {
      errors.push(
        `Only the first ${AUTO_MAX_JOBS} searches were queued; ${dropped} more did not fit. Run them after this batch.`
      );
    }
    return { jobs, errors };
  }
  function makeJob(site, label, url) {
    return {
      id: crypto.randomUUID(),
      site,
      label: label.slice(0, 120),
      url,
      status: "pending",
      rows: 0,
      phones: 0,
      duplicates: 0,
      error: null,
      startedAt: null,
      finishedAt: null
    };
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

  // src/background.ts
  var AutoCancelled = class extends Error {
    constructor() {
      super("Auto-run cancelled.");
      this.name = "AutoCancelled";
    }
  };
  var INJECTED_CONFIG = globalThis.UCS_EXTRACTOR_CONFIG || {};
  var DEFAULT_API_BASE = (INJECTED_CONFIG.apiBase || "http://localhost:5000").replace(/\/+$/, "");
  var DEFAULT_TOKEN = typeof INJECTED_CONFIG.token === "string" ? INJECTED_CONFIG.token : "";
  var MAX_ROWS_PER_POST = 50;
  var PENDING_KEY = "pendingCaptureQueue";
  var MAX_BUFFER = 2e3;
  var AUTO_STORAGE_KEY = "autoRun";
  var AUTO_JOB_TIMEOUT_MS = 45e3;
  var MAPS_READ_CONCURRENCY = 3;
  var sessions = /* @__PURE__ */ new Map();
  var lastCounts = /* @__PURE__ */ new Map();
  var autoTabs = /* @__PURE__ */ new Set();
  var holdFlushTabs = /* @__PURE__ */ new Set();
  var apiBaseUrl = DEFAULT_API_BASE;
  var authToken = DEFAULT_TOKEN;
  var autoState = null;
  var autoLoopToken = 0;
  var autoWake = null;
  var keepAliveTimer = null;
  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(["apiBaseUrl", "token"]);
      const baseValue = stored["apiBaseUrl"];
      const tokenValue = stored["token"];
      apiBaseUrl = typeof baseValue === "string" && baseValue.trim().length > 0 ? baseValue.replace(/\/+$/, "") : DEFAULT_API_BASE;
      authToken = typeof tokenValue === "string" && tokenValue.trim().length > 0 ? tokenValue.trim() : DEFAULT_TOKEN;
    } catch {
      apiBaseUrl = DEFAULT_API_BASE;
      authToken = DEFAULT_TOKEN;
    }
  }
  var settingsReady = loadSettings();
  void settingsReady.catch(() => {
    apiBaseUrl = DEFAULT_API_BASE;
    authToken = DEFAULT_TOKEN;
  });
  void settingsReady.then(() => retryPendingBatches()).catch(() => {
  });
  setInterval(() => {
    void retryPendingBatches();
  }, 6e4);
  function delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  function autoSleep(ms) {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        if (autoWake === finish) autoWake = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      autoWake = finish;
    });
  }
  function interruptAutoSleep() {
    autoWake?.();
  }
  function startKeepAlive() {
    if (keepAliveTimer !== null) return;
    keepAliveTimer = setInterval(() => {
      void chrome.runtime.getPlatformInfo().catch(() => {
      });
    }, 2e4);
  }
  function stopKeepAlive() {
    if (keepAliveTimer !== null) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  });
  function publicState(tabId) {
    const session = tabId !== null ? sessions.get(tabId) : void 0;
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
    const snapshot = tabId !== null ? lastCounts.get(tabId) : void 0;
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
  function broadcast(tabId) {
    void chrome.runtime.sendMessage({ type: "UCS_STATE", state: publicState(tabId) }).catch(() => {
    });
  }
  function broadcastAutoRun() {
    void chrome.runtime.sendMessage({ type: "UCS_AUTORUN_STATE", state: autoState }).catch(() => {
    });
  }
  async function postBatch(payload) {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const response = await fetch(`${apiBaseUrl}/api/accounts/extractor/captures/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ country: "IN", ...payload })
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "CRM token missing or expired. Download a fresh package from Accounts > Extractor > Extension Setup."
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`API returned ${response.status}. ${text.slice(0, 160)}`);
    }
    return await response.json();
  }
  async function appendPendingBatch(batch) {
    try {
      const stored = await chrome.storage.local.get(PENDING_KEY);
      const queue = Array.isArray(stored[PENDING_KEY]) ? stored[PENDING_KEY] : [];
      queue.push(batch);
      await chrome.storage.local.set({ [PENDING_KEY]: queue });
    } catch {
    }
  }
  async function retryPendingBatches() {
    try {
      const stored = await chrome.storage.local.get(PENDING_KEY);
      const queue = Array.isArray(stored[PENDING_KEY]) ? stored[PENDING_KEY] : [];
      if (queue.length === 0) return;
      const remaining = [];
      let saved = 0;
      for (const batch of queue) {
        try {
          const result = await postBatch({
            batchId: batch.batchId,
            sessionId: batch.sessionId,
            sourceUrl: batch.sourceUrl,
            sourceName: batch.sourceName,
            capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
            rows: batch.rows
          });
          saved += result.accepted + result.updated + result.duplicatesIgnored;
        } catch {
          remaining.push(batch);
        }
      }
      await chrome.storage.local.set({ [PENDING_KEY]: remaining });
      if (saved > 0) {
        void chrome.runtime.sendMessage({
          type: "UCS_PENDING_FLUSHED",
          saved,
          remaining: remaining.reduce((total, batch) => total + batch.rows.length, 0)
        }).catch(() => {
        });
      }
    } catch {
    }
  }
  async function flush(session) {
    if (session.flushing || session.buffer.length === 0) return;
    if (holdFlushTabs.has(session.tabId)) return;
    session.flushing = true;
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
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      rows
    };
    try {
      const result = await postBatch(payload);
      session.sent += result.accepted + result.updated;
      session.duplicates += result.duplicatesIgnored;
      session.rejected += result.rejected;
      session.lastError = null;
    } catch (error) {
      session.buffer.unshift(...rows);
      if (session.buffer.length > MAX_BUFFER) {
        session.buffer.length = MAX_BUFFER;
      }
      session.lastError = error instanceof Error ? `${error.message} Rows are held locally and will retry.` : "Could not reach the API. Rows are held locally and will retry.";
      setTimeout(() => {
        void flush(session);
        broadcast(session.tabId);
      }, 5e3);
    } finally {
      session.flushing = false;
      broadcast(session.tabId);
    }
  }
  async function flushAll(session) {
    for (let pass = 0; pass < 60; pass += 1) {
      if (session.buffer.length === 0) return;
      const before = session.buffer.length;
      await flush(session);
      if (session.buffer.length >= before) {
        if (pass < 3) {
          await delay(2e3 * (pass + 1));
          continue;
        }
        return;
      }
    }
  }
  function ensureSession(tabId, url, sourceName) {
    const existing = sessions.get(tabId);
    if (existing) return existing;
    const session = {
      tabId,
      sessionId: crypto.randomUUID(),
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "unknown source";
    }
  }
  async function handleStart(tabId, auto = false) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const url = tab?.url ?? "";
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Open a normal http(s) page first. Chrome system pages cannot be captured.");
    }
    const session = ensureSession(tabId, url, hostOf(url));
    try {
      await chrome.tabs.sendMessage(tabId, { type: "UCS_START", auto });
    } catch {
      sessions.delete(tabId);
      throw new Error(
        "The page script is not loaded on this tab yet. Reload the page, then start capture again."
      );
    }
    broadcast(tabId);
    return publicState(tabId);
  }
  async function handleStop(tabId) {
    const session = sessions.get(tabId);
    if (!session) {
      return { ...publicState(tabId), pending: 0 };
    }
    await flushAll(session);
    const pending = session.buffer.length;
    if (pending > 0) {
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
    void chrome.tabs.sendMessage(tabId, { type: "UCS_STOP" }).catch(() => {
    });
    broadcast(tabId);
    return { ...publicState(tabId), pending };
  }
  function cancelled(token) {
    return token !== autoLoopToken;
  }
  function normalizeSettings(raw) {
    const source = raw ?? {};
    return {
      scrollSteps: clampNumber(
        source.scrollSteps,
        AUTO_MIN_SCROLLS,
        AUTO_MAX_SCROLLS,
        AUTO_DEFAULT_SCROLLS
      ),
      settleMs: clampNumber(source.settleMs, 500, 15e3, AUTO_PAGE_SETTLE_MS),
      gapMs: clampNumber(source.gapMs, AUTO_MIN_GAP_MS, AUTO_MAX_GAP_MS, AUTO_DEFAULT_GAP_MS),
      deepMaps: source.deepMaps !== false,
      activeTab: source.activeTab === true,
      targetPhones: clampNumber(source.targetPhones, 0, 1e4, 0),
      aiGenerate: source.aiGenerate === true,
      aiBatchSize: clampNumber(source.aiBatchSize, 1, 10, 5)
    };
  }
  function normalizeJob(raw) {
    if (typeof raw !== "object" || raw === null) return null;
    const job = raw;
    if (typeof job["id"] !== "string" || typeof job["label"] !== "string") return null;
    if (typeof job["url"] !== "string" || !/^https?:\/\//i.test(job["url"])) return null;
    if (!isAutoSite(job["site"])) return null;
    const status = job["status"];
    const validStatus = status === "done" || status === "failed" || status === "running" || status === "pending" ? status : "pending";
    return {
      id: job["id"],
      site: job["site"],
      label: job["label"].slice(0, 120),
      url: job["url"],
      // A worker death leaves "running" behind; it must be retried, not trusted.
      status: validStatus === "running" ? "pending" : validStatus,
      rows: clampNumber(job["rows"], 0, 1e6, 0),
      phones: clampNumber(job["phones"], 0, 1e6, 0),
      duplicates: clampNumber(job["duplicates"], 0, 1e6, 0),
      error: typeof job["error"] === "string" ? job["error"] : null,
      startedAt: typeof job["startedAt"] === "string" ? job["startedAt"] : null,
      finishedAt: typeof job["finishedAt"] === "string" ? job["finishedAt"] : null
    };
  }
  function normalizeState(raw) {
    if (typeof raw !== "object" || raw === null) return null;
    const state = raw;
    if (!Array.isArray(state["jobs"])) return null;
    const jobs = state["jobs"].map(normalizeJob).filter((job) => job !== null);
    if (jobs.length === 0) return null;
    const status = state["status"];
    const validStatus = status === "running" || status === "paused" || status === "done" || status === "stopped" ? status : "idle";
    const index = clampNumber(state["index"], 0, jobs.length, 0);
    const interrupted = validStatus === "running";
    return {
      status: interrupted ? "paused" : validStatus,
      jobs,
      index,
      settings: normalizeSettings(state["settings"]),
      startedAt: typeof state["startedAt"] === "string" ? state["startedAt"] : null,
      finishedAt: interrupted ? null : typeof state["finishedAt"] === "string" ? state["finishedAt"] : null,
      message: interrupted ? "Chrome stopped the background worker while this run was in progress. Press Resume to continue from the first unfinished page." : typeof state["message"] === "string" ? state["message"] : null,
      currentTabId: interrupted ? null : typeof state["currentTabId"] === "number" ? state["currentTabId"] : null
    };
  }
  async function persistAutoRun() {
    if (!autoState) return;
    try {
      await chrome.storage.local.set({ [AUTO_STORAGE_KEY]: autoState });
    } catch {
    }
  }
  async function loadAutoRun() {
    try {
      const stored = await chrome.storage.local.get(AUTO_STORAGE_KEY);
      autoState = normalizeState(stored[AUTO_STORAGE_KEY]);
    } catch {
      autoState = null;
    }
  }
  var autoReady = loadAutoRun();
  async function waitForTabComplete(tabId, timeoutMs, token) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timer);
        clearInterval(poll);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onUpdated = (id, info) => {
        if (id === tabId && info.status === "complete") finish();
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      const timer = setTimeout(
        () => finish(new Error("The page took too long to load.")),
        timeoutMs
      );
      const poll = setInterval(() => {
        if (cancelled(token)) finish(new AutoCancelled());
      }, 300);
      chrome.tabs.get(tabId).then((tab) => {
        if (tab.status === "complete") finish();
      }).catch(() => finish(new Error("The tab closed before it finished loading.")));
    });
  }
  async function startAutoCapture(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const url = tab?.url ?? "";
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("The page could not be opened (Chrome blocked this URL).");
    }
    ensureSession(tabId, url, hostOf(url));
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "UCS_START", auto: true });
        broadcast(tabId);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Could not reach the page script.";
        await delay(700);
      }
    }
    sessions.delete(tabId);
    throw new Error(
      `The page script did not respond on this page. ${lastError ?? ""}`.trim()
    );
  }
  async function scrollTab(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "UCS_SCROLL" });
      return Boolean(response?.ok && response.scrolled);
    } catch {
      return false;
    }
  }
  async function closeAutoTab(tabId) {
    autoTabs.delete(tabId);
    holdFlushTabs.delete(tabId);
    await chrome.tabs.remove(tabId).catch(() => {
    });
  }
  function placeKey(href) {
    const placeId = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(href)?.[1];
    return placeId ?? href.split("?")[0] ?? href;
  }
  async function collectMapsLinks(tabId, max) {
    const response = await chrome.tabs.sendMessage(tabId, { type: "UCS_MAPS_PLACES", max }).catch(() => null);
    return response?.places ?? [];
  }
  function nameKey(value) {
    return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function samePlace(expected, actual) {
    const left = nameKey(expected);
    const right = nameKey(actual);
    if (left.length === 0 || right.length === 0) return false;
    if (left === right) return true;
    const leftWord = left.split(" ")[0] ?? "";
    const rightWord = right.split(" ")[0] ?? "";
    return leftWord.length > 2 && leftWord === rightWord && right.includes(leftWord);
  }
  async function readPlaceWithRetry(tabId, place, token) {
    const placeId = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(place.href)?.[1] ?? "";
    let lastRow = null;
    let opened = false;
    let noPhoneReads = 0;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      if (cancelled(token)) return { row: null, opened: false };
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "UCS_READ_PLACE",
          name: place.name,
          placeId
        });
        if (response?.ok && response.ready !== false) {
          const row = response.row ?? null;
          const nameOk = placeId.length > 0 || row !== null && samePlace(place.name, row.name);
          if (row && nameOk) {
            lastRow = row;
            opened = true;
            if (row.phone) return { row, opened: true };
            noPhoneReads += 1;
            if (noPhoneReads >= 2) return { row: lastRow, opened: true };
          } else if (response.opened) {
            opened = true;
          }
        }
      } catch {
      }
      await delay(700);
    }
    return { row: lastRow, opened };
  }
  function mergeMapsDetails(session, details) {
    for (const detail of details) {
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
  async function readMapsPhones(tabId, token, collected = []) {
    const places = collected.length > 0 ? collected.slice(0, AUTO_MAPS_DETAIL_MAX) : await collectMapsLinks(tabId, AUTO_MAPS_DETAIL_MAX);
    if (places.length === 0) return { links: 0, visited: 0, found: 0, panelOpened: 0 };
    const session = sessions.get(tabId) ?? null;
    const details = [];
    const queue = [...places];
    let visited = 0;
    let found = 0;
    let panelOpened = 0;
    const extraTabs = [];
    const workerCount = Math.max(1, Math.min(MAPS_READ_CONCURRENCY, places.length));
    for (let index = 1; index < workerCount; index += 1) {
      if (cancelled(token)) break;
      try {
        const tab = await chrome.tabs.create({ url: "about:blank", active: false });
        if (typeof tab.id === "number") {
          extraTabs.push(tab.id);
          autoTabs.add(tab.id);
        }
      } catch {
      }
    }
    const runWorker = async (workerTabId) => {
      for (; ; ) {
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
        [tabId, ...extraTabs].map(
          (workerTabId) => runWorker(workerTabId).catch(() => void 0)
        )
      );
    } finally {
      await Promise.all(
        extraTabs.map(
          (id) => chrome.tabs.remove(id).catch(() => void 0)
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
  async function fetchAiSuggestions(region, exclude, count) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/ai/suggest-searches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region, count, exclude })
      }).then((r) => r.json().catch(() => ({})));
      if (Array.isArray(response.queries)) return response.queries;
    } catch {
    }
    return [];
  }
  async function runAutoLoop(token) {
    const state = autoState;
    if (!state) return;
    state.status = "running";
    state.finishedAt = null;
    state.currentTabId = null;
    startKeepAlive();
    await persistAutoRun();
    broadcastAutoRun();
    const usedQueries = new Set(state.jobs.map((j) => j.label));
    let totalPhones = state.jobs.reduce((t, j) => t + (j.phones || 0), 0);
    const aiRegions = [
      ...new Set(
        state.jobs.map((job) => job.label.includes("\xB7") ? job.label.split("\xB7").pop()?.trim() ?? "" : "").filter((region) => region.length > 0)
      )
    ];
    while (true) {
      if (cancelled(token)) return;
      if (state.settings.targetPhones > 0 && totalPhones >= state.settings.targetPhones) {
        break;
      }
      if (state.index >= state.jobs.length) {
        if (state.settings.aiGenerate && state.jobs.length < AUTO_MAX_JOBS) {
          state.message = "Asking AI for more searches\u2026";
          broadcastAutoRun();
          const region = aiRegions.join(", ");
          const newQueries = await fetchAiSuggestions(
            region,
            [...usedQueries],
            state.settings.aiBatchSize
          );
          if (cancelled(token)) return;
          if (newQueries.length === 0) break;
          const site = state.jobs[0]?.site ?? "google_maps";
          let added = 0;
          for (const q of newQueries) {
            const room = AUTO_MAX_JOBS - state.jobs.length;
            if (room <= 0) break;
            const parsed = parseJobLines(q, site, region);
            for (const job2 of parsed.jobs.slice(0, room)) {
              state.jobs.push(job2);
              usedQueries.add(job2.label);
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
      if (job.status === "done" || job.status === "failed") {
        state.index += 1;
        continue;
      }
      job.status = "running";
      job.startedAt = (/* @__PURE__ */ new Date()).toISOString();
      job.finishedAt = null;
      job.error = null;
      job.rows = 0;
      job.phones = 0;
      job.duplicates = 0;
      state.message = `Opening ${job.label}\u2026`;
      await persistAutoRun();
      broadcastAutoRun();
      let tabId = null;
      let stoppedEarly = false;
      try {
        const tab = await chrome.tabs.create({
          url: job.url,
          active: state.settings.activeTab
        });
        tabId = tab.id ?? null;
        if (tabId === null) throw new Error("Chrome did not return a tab id for this page.");
        autoTabs.add(tabId);
        if (job.site === "google_maps" && state.settings.deepMaps) {
          holdFlushTabs.add(tabId);
        }
        state.currentTabId = tabId;
        await persistAutoRun();
        broadcastAutoRun();
        await waitForTabComplete(tabId, AUTO_JOB_TIMEOUT_MS, token);
        if (cancelled(token)) throw new AutoCancelled();
        state.message = `Waiting for ${job.label} to render\u2026`;
        broadcastAutoRun();
        await autoSleep(state.settings.settleMs);
        if (cancelled(token)) throw new AutoCancelled();
        await startAutoCapture(tabId);
        if (cancelled(token)) throw new AutoCancelled();
        state.message = `Capturing ${job.label}\u2026`;
        broadcastAutoRun();
        await autoSleep(800);
        if (cancelled(token)) throw new AutoCancelled();
        const mapsDeep = job.site === "google_maps" && state.settings.deepMaps;
        const mapsPlaces = /* @__PURE__ */ new Map();
        const rememberPlaces = (places) => {
          for (const place of places) {
            if (mapsPlaces.size >= AUTO_MAPS_DETAIL_MAX) break;
            const key = placeKey(place.href);
            if (!mapsPlaces.has(key)) mapsPlaces.set(key, place);
          }
        };
        if (mapsDeep) {
          rememberPlaces(await collectMapsLinks(tabId, 60));
          state.message = `Found ${mapsPlaces.size} place link(s) so far\u2026`;
          broadcastAutoRun();
        }
        let emptyScrolls = 0;
        for (let step = 0; step < state.settings.scrollSteps; step += 1) {
          const scrolled = await scrollTab(tabId);
          if (cancelled(token)) throw new AutoCancelled();
          emptyScrolls = scrolled ? 0 : emptyScrolls + 1;
          state.message = `Scrolling ${job.label} (${step + 1}/${state.settings.scrollSteps})\u2026`;
          broadcastAutoRun();
          await autoSleep(AUTO_SCROLL_PAUSE_MS);
          if (cancelled(token)) throw new AutoCancelled();
          if (mapsDeep && mapsPlaces.size < AUTO_MAPS_DETAIL_MAX) {
            rememberPlaces(await collectMapsLinks(tabId, 60));
          }
          if (emptyScrolls >= 2) break;
        }
        if (mapsDeep) {
          rememberPlaces(await collectMapsLinks(tabId, 60));
          state.message = `Opening ${mapsPlaces.size} place page(s) to read numbers\u2026`;
          broadcastAutoRun();
        }
        let mapsResult = null;
        if (mapsDeep) {
          state.message = `Reading phone numbers from ${job.label}\u2026`;
          broadcastAutoRun();
          mapsResult = await readMapsPhones(tabId, token, [...mapsPlaces.values()]);
          if (cancelled(token)) throw new AutoCancelled();
        }
        holdFlushTabs.delete(tabId);
        const outcome = await handleStop(tabId);
        job.rows = outcome.sent;
        job.phones = outcome.withPhone;
        job.duplicates = outcome.duplicates;
        totalPhones += outcome.withPhone;
        if (outcome.pending > 0) {
          job.status = "failed";
          job.error = `${outcome.pending} row(s) could not reach the API and are saved in the extension for automatic retry.${outcome.lastError ? ` ${outcome.lastError}` : ""}`;
        } else if (outcome.sent === 0) {
          job.status = "failed";
          job.error = outcome.rejected > 0 ? `The API rejected all ${outcome.rejected} row(s) from this page.` : "No leads were saved from this page. It may have hid its data, required a login, or still be loading.";
        } else {
          job.status = "done";
          const deepMapsRan = mapsDeep && mapsResult !== null;
          const mapsVisited = mapsResult?.visited ?? 0;
          const mapsFound = mapsResult?.found ?? 0;
          const mapsLinks = mapsResult?.links ?? 0;
          const mapsOpened = mapsResult?.panelOpened ?? 0;
          if (deepMapsRan && mapsLinks === 0) {
            job.error = "Saved rows, but the results list exposed no place links, so no phone numbers were read.";
          } else if (deepMapsRan && mapsVisited === 0) {
            job.error = `Found ${mapsLinks} place link(s), but none could be opened. Check that tabs are allowed to open.`;
          } else if (deepMapsRan && mapsFound === 0) {
            job.error = `Visited ${mapsVisited} place page(s), but none showed a phone number.`;
          } else if (deepMapsRan && outcome.withPhone === 0) {
            job.error = `Read ${mapsFound} phone number(s), but none matched a saved row.`;
          } else if (deepMapsRan && mapsFound < mapsVisited) {
            const unopened = Math.max(0, mapsVisited - mapsOpened);
            job.error = unopened > 0 ? `Read phones from ${mapsFound} of ${mapsVisited} place page(s); ${unopened} did not load and the rest showed none.` : `Read phones from ${mapsFound} of ${mapsVisited} place page(s); the rest showed none.`;
          } else if (outcome.withPhone === 0) {
            job.error = 'Saved rows, but none carried a phone number. For Google Maps, enable "Open each result".';
          } else if (outcome.rejected > 0) {
            job.error = `${outcome.rejected} row(s) were rejected by the CRM. Only mobile numbers are stored, so landlines are skipped.`;
          }
        }
      } catch (error) {
        if (cancelled(token) || error instanceof AutoCancelled) {
          stoppedEarly = true;
        } else {
          job.status = "failed";
          job.error = error instanceof Error ? error.message : "This page failed.";
        }
      } finally {
        if (tabId !== null) {
          holdFlushTabs.delete(tabId);
          await handleStop(tabId).catch(() => null);
          await closeAutoTab(tabId);
        }
        if (stoppedEarly || cancelled(token)) return;
        job.finishedAt = job.finishedAt ?? (/* @__PURE__ */ new Date()).toISOString();
        state.index += 1;
        state.currentTabId = null;
        await persistAutoRun();
        broadcastAutoRun();
      }
      if (cancelled(token)) return;
      if (state.index < state.jobs.length) {
        const gapSeconds = Math.round(state.settings.gapMs / 1e3);
        state.message = `Waiting ${gapSeconds}s before the next page\u2026`;
        broadcastAutoRun();
        await autoSleep(state.settings.gapMs);
        if (cancelled(token)) return;
      }
    }
    if (cancelled(token)) return;
    state.status = "done";
    state.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    state.currentTabId = null;
    state.message = summarizeRun(state);
    stopKeepAlive();
    await persistAutoRun();
    broadcastAutoRun();
  }
  async function startAutoRun(input) {
    await autoReady;
    if (autoState?.status === "running") {
      return { ok: false, error: "An auto-run is already in progress. Stop it first." };
    }
    if (!isAutoSite(input.site)) {
      return { ok: false, error: "Choose a source first." };
    }
    const parsed = parseJobLines(input.raw, input.site, input.region);
    if (parsed.jobs.length === 0) {
      return {
        ok: false,
        error: parsed.errors[0] ?? "Add at least one search line.",
        errors: parsed.errors
      };
    }
    autoLoopToken += 1;
    autoState = {
      status: "running",
      jobs: parsed.jobs,
      index: 0,
      settings: normalizeSettings(input.settings),
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      finishedAt: null,
      message: parsed.errors.length > 0 ? `Queued ${parsed.jobs.length} page(s). It will run all of them unless you press Stop. ${parsed.errors.join(" ")}` : `Queued ${parsed.jobs.length} page(s). It will run all of them unless you press Stop.`,
      currentTabId: null
    };
    const token = autoLoopToken;
    await persistAutoRun();
    broadcastAutoRun();
    void runAutoLoop(token).catch(async (error) => {
      if (cancelled(token) || !autoState) return;
      autoState.status = "paused";
      autoState.message = error instanceof Error ? `The run paused: ${error.message}` : "The run paused unexpectedly.";
      autoState.currentTabId = null;
      stopKeepAlive();
      await persistAutoRun();
      broadcastAutoRun();
    });
    return { ok: true, state: autoState, errors: parsed.errors };
  }
  async function stopAutoRun(reason) {
    await autoReady;
    if (!autoState) return null;
    autoLoopToken += 1;
    interruptAutoSleep();
    stopKeepAlive();
    const state = autoState;
    const wasRunning = state.status === "running";
    const tabId = state.currentTabId;
    const currentJob = state.jobs[state.index];
    if (currentJob && currentJob.status === "running") {
      currentJob.status = "pending";
      currentJob.startedAt = null;
      currentJob.error = "Stopped before this page finished.";
    }
    state.status = "stopped";
    state.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
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
  async function resumeAutoRun() {
    await autoReady;
    if (!autoState) return { ok: false, error: "There is no auto-run to resume." };
    if (autoState.status === "running") return { ok: true, state: autoState };
    if (autoState.index >= autoState.jobs.length) {
      return { ok: false, error: "This run already finished. Start a new one." };
    }
    const token = ++autoLoopToken;
    autoState.status = "running";
    autoState.finishedAt = null;
    autoState.currentTabId = null;
    autoState.message = "Resuming\u2026";
    await persistAutoRun();
    broadcastAutoRun();
    void runAutoLoop(token).catch(async (error) => {
      if (cancelled(token) || !autoState) return;
      autoState.status = "paused";
      autoState.message = error instanceof Error ? `The run paused: ${error.message}` : "The run paused unexpectedly.";
      autoState.currentTabId = null;
      stopKeepAlive();
      await persistAutoRun();
      broadcastAutoRun();
    });
    return { ok: true, state: autoState };
  }
  async function clearAutoRun() {
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
    await chrome.storage.local.remove(AUTO_STORAGE_KEY).catch(() => {
    });
    broadcastAutoRun();
  }
  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (typeof message !== "object" || message === null) return false;
      const typed = message;
      if (typed.type === "UCS_ROWS") {
        const tabId = sender.tab?.id;
        if (tabId === void 0) return false;
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
      if (typed.type === "UCS_GET_STATE") {
        const tabId = typed.tabId ?? null;
        sendResponse(publicState(tabId));
        return false;
      }
      if (typed.type === "UCS_START") {
        const tabId = typed.tabId;
        if (tabId === void 0) {
          sendResponse({ ok: false, error: "No active tab." });
          return false;
        }
        handleStart(tabId).then((state) => sendResponse({ ok: true, state })).catch(
          (error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Could not start capture."
          })
        );
        return true;
      }
      if (typed.type === "UCS_STOP") {
        const tabId = typed.tabId;
        if (tabId === void 0) {
          sendResponse({ ok: false, error: "No active tab." });
          return false;
        }
        handleStop(tabId).then(({ pending: _pending, ...state }) => sendResponse({ ok: true, state })).catch(() => sendResponse({ ok: false, error: "Could not stop capture." }));
        return true;
      }
      if (typed.type === "UCS_SET_API_BASE") {
        const url = (typed.url ?? "").trim().replace(/\/+$/, "");
        if (!/^https?:\/\/[^\s]+$/i.test(url)) {
          sendResponse({ ok: false, error: "Enter a full URL, for example http://localhost:5000." });
          return false;
        }
        apiBaseUrl = url;
        void chrome.storage.local.set({ apiBaseUrl });
        const tabId = typed.tabId ?? null;
        broadcast(tabId);
        sendResponse({ ok: true, apiBaseUrl });
        return false;
      }
      if (typed.type === "UCS_SET_TOKEN") {
        const token = String(typed.token ?? "").trim();
        authToken = token;
        void chrome.storage.local.set({ token });
        broadcast(typed.tabId ?? null);
        sendResponse({ ok: true, hasToken: authToken.length > 0 });
        return false;
      }
      if (typed.type === "UCS_GET_SETTINGS") {
        sendResponse({ ok: true, apiBaseUrl, hasToken: authToken.length > 0 });
        return false;
      }
      if (typed.type === "UCS_GET_AI_KEYWORDS") {
        const headers = {};
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
        fetch(`${apiBaseUrl}/api/accounts/extractor/ai/settings`, { headers }).then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            throw new Error(
              "CRM token missing or expired. Download a fresh package from Accounts > Extractor."
            );
          }
          if (!response.ok) throw new Error(`the CRM answered ${response.status}`);
          const body = await response.json();
          const keywords = (body.keywords ?? []).map((item) => String(item.keyword ?? "").trim()).filter((keyword) => keyword.length > 0);
          sendResponse({ ok: true, keywords, configured: body.configured !== false });
        }).catch(
          (error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Could not load the keywords."
          })
        );
        return true;
      }
      if (typed.type === "UCS_TEST_API") {
        const headers = {};
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
        fetch(`${apiBaseUrl}/api/accounts/extractor/status`, { headers }).then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            throw new Error("CRM token missing or expired. Download a fresh package from the panel.");
          }
          if (!response.ok) throw new Error(`API returned ${response.status}.`);
          const body = await response.json();
          if (body.ok === false) {
            throw new Error(body.message || "Extractor tables are not ready on the server.");
          }
          sendResponse({
            ok: true,
            ready: body.ready !== false,
            leads: body.leads ?? 0,
            batches: body.batches ?? 0
          });
        }).catch(
          (error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Could not reach the CRM."
          })
        );
        return true;
      }
      if (typed.type === "UCS_AUTORUN_START") {
        startAutoRun({
          raw: String(typed.raw ?? ""),
          site: String(typed.site ?? ""),
          region: String(typed.region ?? ""),
          settings: typed.settings
        }).then((result) => sendResponse(result)).catch(
          (error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Could not start the auto-run."
          })
        );
        return true;
      }
      if (typed.type === "UCS_AUTORUN_STOP") {
        stopAutoRun("Stopped by you.").then((state) => sendResponse({ ok: true, state })).catch(() => sendResponse({ ok: false, error: "Could not stop the auto-run." }));
        return true;
      }
      if (typed.type === "UCS_AUTORUN_RESUME") {
        resumeAutoRun().then((result) => sendResponse(result)).catch(
          (error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Could not resume the auto-run."
          })
        );
        return true;
      }
      if (typed.type === "UCS_AUTORUN_CLEAR") {
        clearAutoRun().then(() => sendResponse({ ok: true, state: null })).catch(() => sendResponse({ ok: false, error: "Could not clear the auto-run." }));
        return true;
      }
      if (typed.type === "UCS_AUTORUN_GET") {
        autoReady.then(() => sendResponse({ ok: true, state: autoState })).catch(() => sendResponse({ ok: true, state: null }));
        return true;
      }
      if (typed.type === "UCS_PING") {
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
    if (changeInfo.status === "loading" && sessions.has(tabId) && !autoTabs.has(tabId)) {
      void handleStop(tabId);
    }
  });
})();

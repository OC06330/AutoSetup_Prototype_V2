// Optimus Internal Review, folded into the AutoSetup prototype (autofill/review/). Loaded by
// autofill/background.js with importScripts, so it shares the service worker with Moonfill, the
// Checklist Autofill and AutoSetup: everything here sits inside one function, so none of its names
// clash with theirs. Its messages all start with "oir", its stored runs with "oirRun_".
// One Internal Review run, start to finish, without the user's attention.
// Started from the review panel (autofill/review/panel.html), which Moonfill's 🔎 IR button opens on an
// Implementation record (MID + "signed in" needed):
//  1. reads every Awin UI page (background tabs, group "IR <mid>")
//  2. runs the checks and applies every automatic fix (set, save, reload, read back)
//  3. deletes the programme's test transactions (after the pending transaction was read)
//  4. updates the Salesforce fields and posts the short report to the record's Chatter
// The run lives in chrome.storage.local (oirRun_<id>), which the panel renders.
(function () {
importScripts("autofill/review/lib/log.js", "autofill/review/lib/fields.js", "autofill/review/lib/checks.js");
const L = self.OIRLog;
const F = self.OIRFields;
const C = self.OIRChecks;

const RUN_PREFIX = "oirRun_";
const HISTORY_MAX = 30;
const TAB_LOAD_MS = 45000;
const PREJOIN_ATTEMPTS = 3;
const DELETE_MAX_STEPS = 30;
// The IR's own version, then the build it runs in (shown in the panel and at the top of the Chatter report)
const OIR_VERSION = "0.2.23";
const MANIFEST = chrome.runtime.getManifest();
const VERSION = `${OIR_VERSION} (${MANIFEST.version_name || MANIFEST.version})`;
const PAGE_FILES = ["autofill/review/lib/fields.js", "autofill/review/content/awin-page.js"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runKey = (id) => RUN_PREFIX + id;
const getRun = async (id) => (await chrome.storage.local.get(runKey(id)))[runKey(id)];
const saveRun = (run) => chrome.storage.local.set({ [runKey(run.id)]: run });
const pageDef = (key) => F.PAGES.find((p) => p.key === key);
const today = () => new Date().toISOString().slice(0, 10);

// Chrome stops an extension's service worker after ~30 s without extension events, even in
// the middle of a run (e.g. while waiting for a page to reload). An extension API call every
// 20 s keeps it alive while a run is working.
let busyCount = 0, keepAliveTimer = null;
function busy(on) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  if (busyCount && !keepAliveTimer) keepAliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError), 20000);
  if (!busyCount && keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}
const STALL_MS = 6 * 60 * 1000;
function startWatchdog() { chrome.alarms.create("oirWatchdog", { periodInMinutes: 1 }); }
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "oirWatchdog") return;
  const all = await chrome.storage.local.get(null);
  const active = Object.keys(all).filter((k) => k.startsWith(RUN_PREFIX) && ["running", "applying", "salesforce"].includes(all[k].state)).map((k) => all[k]);
  if (!active.length) { chrome.alarms.clear("oirWatchdog"); return; }
  for (const r of active) {
    if (Date.now() - (r.updatedAt || r.startedAt) < STALL_MS) continue;
    const msg = `stopped by the watchdog: no progress for ${STALL_MS / 60000} minutes during "${r.step || "?"}". Copy the debug log and start the review again`;
    await mutate(r.id, (x) => {
      x.state = "failed"; x.error = msg; x.finishedAt = Date.now(); x.stalled = true;
      (x.steps || []).forEach((st) => { if (st.status === "running") { st.status = "fail"; st.detail = "no progress"; } });
    });
    await runLog(r.id, "error", "watchdog", msg);
    await closeGroup(r.id);
    notify("Optimus IR: review stopped", `MID ${r.awinId}: ${msg}`, r);
  }
});
const ORPHANED = "interrupted: Chrome stopped the extension's background process during the review. Start the review again (the fixes already made stay made)";

// Run updates are serialised, so parallel page reads never overwrite each other
const locks = {};
function mutate(id, fn) {
  const next = (locks[id] || Promise.resolve()).then(async () => {
    const run = await getRun(id);
    if (!run) return null;
    const wasStalled = run.stalled;
    await fn(run);
    if (wasStalled) { run.state = "failed"; run.stalled = true; }
    run.updatedAt = Date.now();
    await saveRun(run);
    return run;
  });
  locks[id] = next.catch(() => {});
  return next;
}
// Log: service worker console (chrome://extensions → Optimus IR → "service worker"), the run's
// own log (Copy debug log in the popup) and, for warnings and errors, the record tab's console.
const plain = (a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })());
async function runLog(id, level, ctx, ...args) {
  L[level](`${ctx}${id ? " " + id.slice(0, 8) : ""}`, ...args);
  if (!id) return;
  const run = await mutate(id, (r) => {
    r.log = (r.log || []).concat(`${new Date().toISOString().slice(11, 19)} ${level.toUpperCase()} [${ctx}] ${args.map(plain).join(" ")}`).slice(-300);
  });
  if (run && run.originTabId && (level === "warn" || level === "error")) {
    chrome.tabs.sendMessage(run.originTabId, { action: "oirLog", level, ctx: `${ctx} · MID ${run.awinId}`, args: args.map(plain) }).catch(() => {});
  }
}
// Page fields that came back empty: usually a label or id that changed (lib/fields.js)
function logMissing(id, pageName, res) {
  if (!res) return;
  if (res.signin) return runLog(id, "error", pageName, "the Awin UI asked for a sign-in", res.url || "");
  if (!res.ok) return runLog(id, "error", pageName, "page not read:", res.error || "unknown error", res.url || "");
  const f = res.fields || {};
  const missing = Object.keys(f).filter((k) => f[k] === null || f[k] === undefined);
  if (missing.length) runLog(id, "warn", pageName, "not found on the page (check the selectors in lib/fields.js):", missing.join(", "), res.url || "");
  if (res.idConfirmed === false) runLog(id, "warn", pageName, "the page did not show the MID");
  if ((res.errors || []).length) runLog(id, "warn", pageName, "messages on the page:", res.errors);
  runLog(id, "debug", pageName, "read:", f);
}

// Steps shown in the popup: running -> ok / fail / skip
const stepStart = (id, key, label) => mutate(id, (r) => {
  r.steps = (r.steps || []).filter((s) => s.key !== key).concat({ key, label, status: "running" });
  r.step = label;
});
const stepEnd = async (id, key, status, detail) => {
  const run = await mutate(id, (r) => {
    const s = (r.steps || []).find((x) => x.key === key);
    if (s) { s.status = status; s.detail = detail || ""; }
  });
  const s = run && (run.steps || []).find((x) => x.key === key);
  if (status === "fail") await runLog(id, "error", "step", `${s ? s.label : key}: ${detail || "failed"}`);
  else if (status === "skip") await runLog(id, "warn", "step", `${s ? s.label : key} skipped: ${detail || ""}`);
  else await runLog(id, "info", "step", `${s ? s.label : key}: ${status}${detail ? " · " + detail : ""}`);
  return run;
};

function notify(title, message, run) {
  chrome.notifications.create(`oir|${run.id}|${Date.now()}`, { type: "basic", iconUrl: "autofill/review/icon128.png", title, message }, () => void chrome.runtime.lastError);
}
chrome.notifications.onClicked.addListener(async (nid) => {
  const [tag, id] = nid.split("|");
  if (tag !== "oir") return;
  chrome.notifications.clear(nid);
  const run = await getRun(id);
  if (!run) return;
  const tab = await recordTab(run);
  if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {}); }
  else await chrome.tabs.create({ url: run.recordUrl });
});

// ---------- tabs ----------
function waitForLoad(tabId, ms = TAB_LOAD_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(l); clearTimeout(timer); resolve(ok); };
    const l = (id, info) => { if (id === tabId && info.status === "complete") finish(true); };
    const timer = setTimeout(() => finish(false), ms);
    chrome.tabs.onUpdated.addListener(l);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") finish(true); }).catch(() => finish(false));
  });
}
const groupChains = {};
function addToGroup(id, mid, tabId) {
  const next = (groupChains[id] || Promise.resolve()).then(async () => {
    const r = await getRun(id);
    if (r && r.groupId != null) {
      try { await chrome.tabs.group({ groupId: r.groupId, tabIds: [tabId] }); return; } catch (e) { /* group gone */ }
    }
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: `IR ${mid}`, color: "purple", collapsed: true });
    await mutate(id, (x) => { x.groupId = groupId; });
  }).catch(() => {});
  groupChains[id] = next;
  return next;
}
// In the record's window (the panel is a window of its own, and tabs can't go there). Each tab is closed
// as soon as its read or fix is done (the user prefers that to keeping them, 2026-11-19).
async function recordWindow(run) {
  const t = run.originTabId != null ? await chrome.tabs.get(run.originTabId).catch(() => null) : null;
  return t ? t.windowId : undefined;
}
async function openBg(run, url) {
  const windowId = await recordWindow(run);
  const tab = await chrome.tabs.create(windowId != null ? { url, active: false, windowId } : { url, active: false });
  await addToGroup(run.id, run.awinId, tab.id);
  await waitForLoad(tab.id);
  return tab;
}
const closeTab = async (tabId) => { try { await chrome.tabs.remove(tabId); } catch (e) { /* closed */ } };
async function closeGroup(id, keep) {
  const run = await getRun(id);
  if (!run || run.groupId == null) return;
  const tabs = await chrome.tabs.query({ groupId: run.groupId }).catch(() => []);
  for (const t of tabs) if (t.id !== keep) await closeTab(t.id);
  if (!keep) await mutate(id, (r) => { r.groupId = null; });
}

async function inPage(tabId, func, args = [], world = "ISOLATED") {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world });
  return res ? res.result : null;
}
// Chrome's own messages when a page reloads or redirects while our script runs in it
const PAGE_GONE = /Frame with ID \d+ was removed|frame was removed|No frame with id|back\/forward cache|message channel (is )?closed|page has been closed|context invalidated/i;
const SIGNIN_URL = /id\.awin\.com|\/login|signin|microsoftonline/i;
const shortUrl = (u) => String(u || "").replace(/^https?:\/\//, "").slice(0, 90);
function friendly(msg, url) {
  const m = String(msg || "unknown error");
  if (PAGE_GONE.test(m)) return "the page reloaded or went to another address while it was being read (tried 3 times)" +
    (url ? `; it ended on ${shortUrl(url)}` : "") + ". Usually a slow Awin UI page or an expired session: open that page once by hand, then run the review again";
  if (/No tab with id|tab was closed/i.test(m)) return "the tab was closed before it could be read";
  if (/Cannot access contents|Missing host permission/i.test(m)) return `the extension is not allowed to read ${shortUrl(url) || "this address"}`;
  return m;
}
// Rejects when the promise takes longer than ms: no call may wait forever
function limit(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: no answer after ${ms / 1000} s`)), ms); })]).finally(() => clearTimeout(t));
}
async function awinOnce(tabId, method, args) {
  await limit(chrome.scripting.executeScript({ target: { tabId }, files: PAGE_FILES }), 20000, "loading the page script");
  return limit(inPage(tabId, (m, a) => window.OIRPage[m](...a), [method, args]), 60000, `page step "${method}"`);
}
// Reads: retried up to 3 times when the page reloads/redirects under us; readable error otherwise
async function awin(tabId, method, ...args) {
  let last;
  for (let i = 1; i <= 3; i++) {
    // the tab was already waited for when it opened: a short wait here, so a page that keeps "loading"
    // can't use up the read's time limit before the page script even starts
    try { await waitForLoad(tabId, 15000); return await awinOnce(tabId, method, args); }
    catch (e) {
      last = e;
      if (!PAGE_GONE.test(e.message)) break;
      L.warn("page", `${method}: the page reloaded or redirected while being read (${e.message}), try ${i}/3`);
      await sleep(2000 * i);
    }
  }
  const t = await chrome.tabs.get(tabId).catch(() => null);
  const err = new Error(friendly(last && last.message, t && t.url));
  err.raw = last && last.message; err.url = t && t.url; err.signin = !!(t && SIGNIN_URL.test(t.url || ""));
  throw err;
}
async function scrapePage(tabId, key, mid) {
  // never longer than 60 s (the time limit also covers the reads made while fixing)
  try { return (await withTimeout(awin(tabId, "scrape", key, mid), 60000)) || { ok: false, error: "no answer from the page" }; }
  catch (e) { return e.signin ? { ok: false, signin: true, url: e.url } : { ok: false, error: e.message, raw: e.raw, url: e.url }; }
}
// Actions that submit a form: the page navigating away while our script runs is expected
async function awinNav(tabId, method, ...args) {
  try { return (await awinOnce(tabId, method, args)) || { ok: true, navigating: true }; }
  catch (e) {
    if (PAGE_GONE.test(e.message) || /removed|navigat|unloaded/i.test(e.message)) return { ok: true, navigating: true };
    const t = await chrome.tabs.get(tabId).catch(() => null);
    return { ok: false, error: friendly(e.message, t && t.url), raw: e.message, signin: !!(t && SIGNIN_URL.test(t.url || "")) };
  }
}
const awinApply = (tabId, change, mid) => awinNav(tabId, "apply", change, mid);

// ---------- Test transactions: search by MID (#merchantId), read, delete ----------
async function testTxSearch(tabId, mid) {
  const s = await awinNav(tabId, "ttSearch", mid);
  if (s.signin) return { ok: false, signin: true };
  if (!s.ok) return s;
  await settle(tabId);
  const r = await awin(tabId, "ttRead", mid);
  return { ok: true, rows: r.rows, searched: r.searched };
}
async function readTestTx(tabId, mid) {
  try {
    await awin(tabId, "pageReady");
    if (await awin(tabId, "signinShown")) return { ok: false, signin: true };
    const r = await testTxSearch(tabId, mid);
    if (r.signin) return { ok: false, signin: true };
    if (!r.ok) return { ok: false, error: r.error };
    const t = await chrome.tabs.get(tabId).catch(() => null);
    return { ok: true, idConfirmed: true, url: t && t.url, fields: { rows: r.rows } };
  } catch (e) { return e.signin ? { ok: false, signin: true } : { ok: false, error: e.message, raw: e.raw, url: e.url }; }
}

// After a click that may reload the page: wait for the reload only if one starts (Ajax saves
// don't reload), instead of a fixed pause
async function settle(tabId) {
  const t = await chrome.tabs.get(tabId).catch(() => null);
  const started = (t && t.status === "loading") || await new Promise((res) => {
    let done = false;
    const l = (id, info) => { if (id === tabId && info.status === "loading" && !done) { done = true; chrome.tabs.onUpdated.removeListener(l); res(true); } };
    chrome.tabs.onUpdated.addListener(l);
    setTimeout(() => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(l); res(false); } }, 1200);
  });
  if (started) await waitForLoad(tabId);
  await sleep(300);
}

// ---------- {loc} ----------
async function locCandidates(region) {
  const { oirRegionLoc = {} } = await chrome.storage.local.get("oirRegionLoc");
  const table = Object.assign({}, F.REGION_LOC, oirRegionLoc);
  const hit = Object.entries(table).find(([k]) => k.toLowerCase() === String(region || "").trim().toLowerCase());
  return Array.from(new Set([hit ? hit[1] : null, "us"].filter(Boolean)));
}
async function rememberLoc(region, loc) {
  if (!region || !loc) return;
  const { oirRegionLoc = {} } = await chrome.storage.local.get("oirRegionLoc");
  if (oirRegionLoc[region] !== loc) { oirRegionLoc[region] = loc; await chrome.storage.local.set({ oirRegionLoc }); }
}
async function readMain(run) {
  const looksRight = (r) => r && r.ok && r.fields && (r.fields.append !== null || r.fields.website !== null);
  let last = null;
  for (const loc of await locCandidates(run.sf.region)) {
    const url = pageDef("main").url(loc, run.awinId);
    const tab = await openBg(run, url);
    // the same tries as the other pages (2 × 45 s, the tab reloaded in between), not one 60 s go
    const r = await readPage(run.id, pageDef("main"), tab.id, run.awinId);
    if (r && r.signin) return { loc, result: r, tabId: tab.id };
    await closeTab(tab.id);
    if (looksRight(r)) return { loc, url: r.url || url, result: r };
    last = r;
  }
  const tab = await openBg(run, `https://ui.awin.com/dashboard/awin/advertiser/${run.awinId}`);
  const href = await inPage(tab.id, () => (Array.from(document.querySelectorAll('a[href*="tracking-settings/"]'))[0] || {}).href || null).catch(() => null);
  await closeTab(tab.id);
  const loc = href && (/tracking-settings\/([^/]+)\/awin/.exec(href) || [])[1];
  if (!loc) return { loc: null, result: last && !last.ok ? last : { ok: false, error: "could not work out the region path ({loc})" } };
  const t2 = await openBg(run, pageDef("main").url(loc, run.awinId));
  const r = await readPage(run.id, pageDef("main"), t2.id, run.awinId);
  await closeTab(t2.id);
  return { loc, url: r.url, result: r };
}

// ---------- advertiser site: eCommerce platform (lib/platforms.js) ----------
// Shopify's internal domain: tried as before (/meta.json, then Shopify.shop on the site). If the
// shop is known to be Shopify and that takes longer than SHOPIFY_WAIT_MS, *.myshopify.com is
// whitelisted instead and the run goes on.
const SHOPIFY_WAIT_MS = 25000;
const SHOPIFY_WILDCARD = "*.myshopify.com";
async function readSite(run) {
  const params = ((run.ui.validate && run.ui.validate.fields && run.ui.validate.fields.transactions) || []).flatMap((t) => t.params || []);
  const shopifyKnown = params.some((p) => /shopify/i.test(p)) || /shopify/i.test(String(run.sf.ecomPlatform || "") + String(run.sf.otherEcomPlatform || ""));
  const wildcard = (why) => ({ checked: true, platform: "Shopify", evidence: [shopifyKnown ? "Shopify custom parameter / record" : "Shopify signs"], others: [],
    domains: [SHOPIFY_WILDCARD], wildcard: true, note: `internal Shopify domain ${why}: ${SHOPIFY_WILDCARD} whitelisted instead` });
  const t0 = Date.now();
  const res = await withTimeout(readSiteFull(run), SHOPIFY_WAIT_MS);
  if (res.timeout) {
    return shopifyKnown ? wildcard(`not found within ${SHOPIFY_WAIT_MS / 1000} s`)
      : { checked: false, error: `the site check took longer than ${SHOPIFY_WAIT_MS / 1000} s: skipped` };
  }
  if (res.platform === "Shopify" && !(res.domains || []).length) return wildcard("not readable on the site");
  if (!res.platform && shopifyKnown) return wildcard(res.checked ? "not found on the site" : `not readable (${res.error || "site check failed"})`);
  res.ms = Date.now() - t0;
  return res;
}
async function readSiteFull(run) {
  const uiSite = run.ui && run.ui.main && run.ui.main.fields ? run.ui.main.fields.website : "";
  const urls = Array.from(new Set([uiSite, run.sf.website, run.sf.landingPage].filter(Boolean).map((u) => (/^https?:/i.test(u) ? u : "https://" + u))));
  if (!urls.length) return { checked: false, error: "no website in the Awin UI or on the record" };
  let origins;
  try { origins = Array.from(new Set(urls.map((u) => new URL(u).origin))); } catch (e) { return { checked: false, error: "the website is not a valid URL" }; }
  if (!(await chrome.permissions.contains({ origins: origins.map((o) => o + "/*") }).catch(() => false))) return { checked: false, error: "site check not allowed yet (Options → Allow site check)" };
  // custom parameters on the pending transaction (e.g. "shopifyApp_5.6.02") are a hint too
  const params = ((run.ui.validate && run.ui.validate.fields && run.ui.validate.fields.transactions) || []).flatMap((t) => t.params || []);
  const hint = params.find((p) => /shopify/i.test(p));

  // 1. Shopify, fast and without a tab: every Shopify store answers /meta.json with its myshopify domain
  for (const o of origins) {
    const meta = await withTimeout(fetch(o + "/meta.json", { credentials: "omit", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null), 10000);
    if (meta && meta.myshopify_domain) {
      return { checked: true, platform: "Shopify", evidence: [`${o}/meta.json: ${meta.myshopify_domain}`].concat(hint ? [`custom parameter ${hint}`] : []), others: [], domains: [C.domainOf(meta.myshopify_domain)] };
    }
  }
  // 2. signs in the page (lib/platforms.js), each URL at most 40 s
  let best = null;
  const errors = [];
  for (const url of urls) {
    const r = await withTimeout((async () => {
      const tab = await openBg(run, url);
      try {
        for (let i = 1; i <= 3; i++) {
          try {
            await waitForLoad(tab.id, 20000);
            await sleep(2000); // late scripts (window.Shopify)
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["autofill/review/lib/platforms.js"], world: "MAIN" });
            return { ok: true, res: await inPage(tab.id, () => window.OIRPlatforms.detect(), [], "MAIN") };
          } catch (e) {
            if (!PAGE_GONE.test(e.message) || i === 3) return { ok: false, error: friendly(e.message, url) };
            await sleep(1500); // the site redirected (country, cookie wall): read again
          }
        }
      } finally { await closeTab(tab.id); }
    })(), 40000);
    if (!r.ok) { errors.push(`${shortUrl(url)}: ${r.error}`); continue; }
    if (r.res && r.res.platform && (!best || r.res.evidence.length > best.evidence.length)) best = Object.assign({ from: url }, r.res);
    if (best && (best.platform !== "Shopify" || best.domains.length)) break;
  }
  if (best) return Object.assign({ checked: true, others: [], domains: [] }, best);
  if (hint) return { checked: true, platform: "Shopify", evidence: [`custom parameter ${hint}`], others: [], domains: [], note: "Shopify from the custom parameters; its myshopify domain could not be read" };
  if (errors.length === urls.length) return { checked: false, error: "the site could not be read: " + errors.join("; ") };
  return { checked: true, platform: null, evidence: [], others: [], domains: [] };
}

// ---------- start ----------
async function startRun(msg) {
  const mid = String(msg.mid || "").trim();
  if (!/^\d{3,}$/.test(mid)) return { ok: false, error: "enter the programme's MID" };
  if (!msg.signedIn) return { ok: false, error: "confirm you are signed in to ui.awin.com" };
  const col = msg.collected || {};
  if (!col.recordId) return { ok: false, error: "open the Implementation record first" };
  if (col.sf && /^\d+$/.test(String(col.sf.awinId || "")) && String(col.sf.awinId) !== mid) {
    return { ok: false, error: `MID ${mid} is not the Awin Program ID on this record (${col.sf.awinId})` };
  }
  const missing = C.missingInputs(msg.inputs);
  if (missing.length) return { ok: false, error: "missing: " + missing.join(", ") };
  const all = await chrome.storage.local.get(null);
  if (Object.keys(all).some((k) => k.startsWith(RUN_PREFIX) && all[k].awinId === mid && ["running", "applying", "salesforce"].includes(all[k].state))) {
    return { ok: false, error: `a review of MID ${mid} is already running` };
  }
  const id = crypto.randomUUID();
  await saveRun({
    id, version: VERSION, awinId: mid, name: (col.sf && col.sf.name) || "", recordId: col.recordId, recordUrl: col.recordUrl,
    originTabId: msg.tabId || null, inputs: msg.inputs, inputsSource: msg.inputsSource || "form",
    sf: col.sf || {}, startedAt: Date.now(), state: "running", step: "Starting",
    steps: [], pages: {}, ui: {}, applied: [], groupId: null
  });
  await prune();
  runLog(id, "info", "start", `MID ${mid} · record ${col.recordId} · inputs (${msg.inputsSource || "form"}):`, msg.inputs);
  busy(true);
  startWatchdog();
  pipeline(id).finally(() => busy(false)).catch(async (e) => {
    await runLog(id, "error", "run", "stopped by an unexpected error:", e && e.stack ? e.stack : String(e));
    await mutate(id, (r) => { r.state = "failed"; r.error = e.message || String(e); r.finishedAt = Date.now(); });
    await closeGroup(id);
  });
  return { ok: true, runId: id };
}

async function blocked(id, error, tabId) {
  const run = await mutate(id, (r) => { r.state = "blocked"; r.error = error; r.finishedAt = Date.now(); });
  await closeGroup(id, tabId);
  if (tabId) {
    try { if (run.groupId != null) await chrome.tabGroups.update(run.groupId, { collapsed: false }); await chrome.tabs.update(tabId, { active: true }); } catch (e) { /* gone */ }
  }
  await runLog(id, "error", "run", "stopped:", error);
  notify("Optimus IR: stopped", `MID ${run.awinId}: ${error}`, run);
}
const SIGNIN = "The Awin UI asked for a sign-in. Sign in to ui.awin.com, then start the review again.";
const readStatus = (r) => (r.signin ? "fail" : r.ok ? "ok" : r.skipped ? "skip" : "fail");
const readDetail = (r) => (r.signin ? "sign-in needed" : r.ok ? (r.note || "") : r.error || "not readable");

// No page read may hang the run: each try has a time limit; some pages get a few tries.
// After the last try the page is skipped with a note (its checks show as skipped).
const READ_PLAN = {
  commission: { tries: 3, ms: 20000, done: (r) => r.ok && (r.fields.groups || []).some((g) => /^default/i.test(String(g.name))) },
  default: { tries: 2, ms: 45000, done: (r) => r.ok }
};
const withTimeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(() => res({ ok: false, timeout: true, error: `no answer after ${ms / 1000} s` }), ms))]);
async function readPage(id, p, tabId, mid) {
  const plan = READ_PLAN[p.key] || READ_PLAN.default;
  let r;
  for (let i = 1; i <= plan.tries; i++) {
    const t0 = Date.now();
    r = await withTimeout(p.key === "testtx" ? readTestTx(tabId, mid) : scrapePage(tabId, p.key, mid), plan.ms);
    await runLog(id, "debug", p.name, `try ${i}/${plan.tries}: ${r.ok ? "read" : r.error || "failed"} in ${Math.round((Date.now() - t0) / 1000)} s`);
    if (r.signin || plan.done(r)) return r;
    if (i < plan.tries) { await chrome.tabs.reload(tabId).catch(() => {}); await settle(tabId); }
  }
  if (r.ok) return r; // read, but without what the plan looks for (e.g. no DEFAULT row)
  return { ok: false, skipped: true, error: `skipped after ${plan.tries} tries (${plan.ms / 1000} s each): ${r.error || "not readable"}` };
}

// ---------- the run ----------
// Everything runs at the same time as far as the pages allow:
//  - pages whose URL has no region path start at once, next to Main settings;
//  - Commission groups, MasterTag plugins and Tracking diagnosis start when Main settings gave {loc};
//  - each page is fixed as soon as it has been read (Main settings also waits for the site check,
//    which gives the Shopify domain);
//  - test transactions are deleted as soon as Pending transactions and Tracking diagnosis are read.
const NEEDS_LOC = ["commission", "plugins", "wizard"];
const blankEntry = (c, error) => ({ id: c.id, page: c.area, field: c.field, from: c.from, to: c.to, verified: false, error });

async function pipeline(id) {
  const run0 = await getRun(id);
  runLog(id, "debug", "salesforce", "record fields:", run0.sf);
  await mutate(id, (r) => { r.plan = { changes: [] }; r.state = "running"; });
  let signinLost = false;
  const signinTabs = [];

  // ---- reads ----
  async function readOne(p, loc) {
    const url = p.url(loc, run0.awinId);
    try {
      const tab = await openBg(run0, url);
      const r = await readPage(id, p, tab.id, run0.awinId);
      if (r.signin) { signinLost = true; signinTabs.push(tab.id); } else await closeTab(tab.id);
      await mutate(id, (x) => { x.ui[p.key] = r; x.pages[p.key] = (r.url && p.key !== "testtx") ? r.url : url; });
      await logMissing(id, p.name, r);
      await stepEnd(id, "read:" + p.key, readStatus(r), readDetail(r));
      return r;
    } catch (e) {
      const r = { ok: false, error: "unexpected error: " + e.message };
      await mutate(id, (x) => { x.ui[p.key] = r; });
      await stepEnd(id, "read:" + p.key, "fail", r.error);
      return r;
    }
  }
  for (const p of F.PAGES) await stepStart(id, "read:" + p.key, "Read: " + p.name);
  const mainP = (async () => {
    try {
      const main = await readMain(run0);
      if (main.result.signin) { signinLost = true; if (main.tabId) signinTabs.push(main.tabId); }
      await mutate(id, (r) => { r.loc = main.loc; r.ui.main = main.result; if (main.url) r.pages.main = main.url; });
      await logMissing(id, "Main settings", main.result);
      await stepEnd(id, "read:main", readStatus(main.result), readDetail(main.result));
      await rememberLoc(run0.sf.region, main.loc);
      return main;
    } catch (e) {
      await stepEnd(id, "read:main", "fail", "unexpected error: " + e.message);
      return { loc: null, result: { ok: false, error: e.message } };
    }
  })();
  const readP = {};
  for (const p of F.PAGES.filter((x) => x.key !== "main")) {
    readP[p.key] = NEEDS_LOC.includes(p.key) ? mainP.then((m) => readOne(p, m.loc || "us")) : readOne(p, "us");
  }
  readP.main = mainP.then((m) => m.result);

  // ---- advertiser site (after Main settings, for #MainWebsiteURL, and Pending transactions, for the custom parameters) ----
  const siteP = Promise.all([mainP, readP.validate]).then(async () => {
    await stepStart(id, "site", "Advertiser site: eCommerce platform");
    let site;
    try { site = await readSite(await getRun(id)); } catch (e) { site = { checked: false, error: "unexpected error: " + e.message }; }
    await mutate(id, (r) => { r.site = site; });
    await stepEnd(id, "site", site.checked ? "ok" : "skip", site.checked
      ? (site.platform ? `${site.platform}${(site.domains || []).length ? " (" + site.domains.join(", ") + ")" : ""}` : "no platform signs") : site.error);
    return site;
  });

  // ---- fixes, per page, as soon as that page is ready ----
  async function planFor(pageKey, site) {
    const r = await getRun(id);
    const res = C.runChecks({ inputs: r.inputs, sf: r.sf, ui: { [pageKey]: r.ui[pageKey] }, site, today: today() });
    const changes = res.changes.filter((c) => c.pageKey === pageKey && c.auto);
    for (const c of res.checks.filter((x) => x.pageKey === pageKey && x.result !== "pass")) {
      await runLog(id, c.result === "fail" ? "warn" : "info", `check ${c.area}`, `${c.check}: ${c.result} · UI ${c.ui}${c.expected ? " · expected " + c.expected : ""}${c.note ? " · " + c.note : ""}`);
    }
    if (changes.length) {
      await mutate(id, (x) => { x.plan.changes = x.plan.changes.filter((c) => c.pageKey !== pageKey).concat(changes); x.state = "applying"; });
      await runLog(id, "info", "plan", `${changes[0].area}: ${changes.length} fix(es)`, changes.map((c) => `${c.field} → ${c.to || c.verb}`));
    }
    return changes;
  }
  const record = async (entries) => {
    await mutate(id, (r) => { r.applied = (r.applied || []).filter((a) => !entries.some((e) => e.id === a.id)).concat(entries); });
    for (const e of entries) {
      await stepEnd(id, "fix:" + e.id, e.verified ? "ok" : "fail", e.verified ? (e.noop ? "already right" : e.refs ? e.refs.join(", ") : "") : e.error);
      if (e.signin) signinLost = true;
    }
  };
  const label = (c) => `Fix: ${c.area} · ${c.field}${c.to && c.target !== "deleteTestTx" ? " → " + c.to : ""}`;

  async function fixPage(pageKey, waitFor) {
    try {
      const results = await Promise.all(waitFor);
      const site = pageKey === "main" ? results[results.length - 1] : (await getRun(id)).site;
      if (!(await getRun(id)).ui[pageKey] || !(await getRun(id)).ui[pageKey].ok) return;
      const changes = await planFor(pageKey, site);
      if (pageKey === "main") { // Main settings: every change in one submit
        if (!changes.length) return;
        for (const c of changes) await stepStart(id, "fix:" + c.id, label(c));
        let entries;
        if (signinLost) entries = changes.map((c) => blankEntry(c, "not tried: the Awin UI asked for a sign-in"));
        else {
          try { entries = await applyMainBatch(id, changes); }
          catch (err) { entries = changes.map((c) => blankEntry(c, "unexpected error: " + err.message)); }
        }
        await record(entries);
        return;
      }
      for (const c of changes) {
        await stepStart(id, "fix:" + c.id, label(c));
        if (signinLost) { await record([blankEntry(c, "not tried: the Awin UI asked for a sign-in")]); continue; }
        let e;
        try { e = c.target === "deleteTestTx" ? await deleteTestTransactions(id, c) : await applyOne(id, c); }
        catch (err) { e = blankEntry(c, "unexpected error: " + err.message); }
        await record([e]);
      }
    } catch (e) {
      await runLog(id, "error", "fix", `${pageKey}: unexpected error`, e.message);
    }
  }
  const fixes = [
    fixPage("main", [readP.main, siteP]),
    ...["commission", "plugins", "mobile", "prejoin", "migrated"].map((k) => fixPage(k, [readP[k]])),
    // test transactions go only after the pending transaction and Tracking diagnosis were read
    fixPage("testtx", [readP.testtx, readP.validate, readP.wizard])
  ];
  await Promise.all([...Object.values(readP), siteP, ...fixes]);
  await closeGroup(id, signinTabs[0]);
  if (signinTabs.length) {
    await runLog(id, "error", "run", SIGNIN);
    notify("Optimus IR: sign-in needed", `MID ${run0.awinId}: ${SIGNIN}`, run0);
    try { await chrome.tabs.update(signinTabs[0], { active: true }); } catch (e) { /* gone */ }
  }

  // ---- checks again, on what the pages show now; then Salesforce + Chatter ----
  await mutate(id, (r) => {
    r.result = C.runChecks({ inputs: r.inputs, sf: r.sf, ui: r.ui, site: r.site, today: today() });
    r.state = "salesforce";
  });
  await finishSalesforce(id);
}

function verifyChange(c, fields) {
  if (!fields) return false;
  const t = c.target;
  switch (t) {
    case "website": case "landingPage": case "append": return String(fields[t] ?? "").trim() === c.to;
    case "awc": return fields.awc === true;
    case "acceptedDomains": return (fields.acceptedDomains || []).includes(c.to.toLowerCase());
    case "singleView": return !!(fields.plugins || []).find((p) => p.enabled === true);
    case "defaultCommission": {
      const [type, value] = c.to.split(" ");
      const d = (fields.groups || []).find((g) => /^default/i.test(String(g.name)));
      return !!d && d.type === type && Number(d.value) === Number(value);
    }
    case "strategy": return fields.strategy === true;
    case "manualApproval": return fields.manualApproval === /^on$/i.test(c.to);
    case "validationDays": return Number(fields.validationDays) === Number(c.to);
    case "publisher": return !!(fields.publishers || []).find((p) => p.id === c.to && /^active$/i.test(p.status));
    default: return false;
  }
}

// Main settings: all fixes of the page, one submit, then one reload to read every value back
// After the Save click (made by the page 150 ms after answering): up to 15 s, either the tab
// reloads (form submit) or the page shows the save went through. Never waits inside the page.
async function followSave(tabId) {
  const end = Date.now() + 15000;
  await sleep(400);
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return { state: "tab closed" };
    if (t.status === "loading") { await waitForLoad(tabId, 30000); return { state: "confirmed", how: "the page reloaded after Save" }; }
    let st;
    try { st = await limit(awinOnce(tabId, "saveStatus", []), 5000, "saveStatus"); }
    catch (e) { st = PAGE_GONE.test(e.message) ? { state: "confirmed", how: "the page reloaded after Save" } : { state: "pending" }; }
    if (st.state !== "pending") return st;
    await sleep(500);
  }
  return { state: "pending", how: "no sign of the save after 15 s; reading the page again anyway" };
}

// Main settings, driven from here in short steps (each answers at once; all waiting happens
// here, never inside the page):
//   1. each domain: wait for #newValidDomain, type it, click the + (<i>, then <a>, then <span>)
//      and look for a .tag with it after each click;
//   2. the other fields (append, awc...);
//   3. one Save (btn btn-default [2]). The Save click counts as success; the page is not re-read.
async function applyMainBatch(id, changes) {
  const run = await getRun(id);
  const url = run.pages.main || pageDef("main").url(run.loc || "us", run.awinId);
  const at = new Date().toISOString();
  const entries = changes.map((c) => ({ id: c.id, page: c.area, field: c.field, from: c.from, to: c.to, at, verified: false }));
  const tab = await openBg(run, url);
  const log = (level, ...m) => runLog(id, level, "Main settings", ...m);
  // one short call into the page; a reload in between is waited for, not an error
  const call = async (method, ...args) => {
    try { return (await limit(awinOnce(tab.id, method, args), 10000, `page step "${method}"`)) || {}; }
    catch (e) {
      if (PAGE_GONE.test(e.message)) { await log("warn", `${method}: the page reloaded`); await waitForLoad(tab.id, 30000); await sleep(1000); return { gone: true }; }
      return { error: friendly(e.message) };
    }
  };
  try {
    if (await awin(tab.id, "signinShown").catch(() => false)) { entries.forEach((e) => { e.signin = true; e.error = "sign-in needed"; }); return entries; }
    // native alert()/confirm() would freeze the page in a background tab: record / answer OK
    await inPage(tab.id, () => {
      window.__oirAlerts = [];
      window.alert = (m) => { window.__oirAlerts.push(String(m)); };
      window.confirm = (m) => { window.__oirAlerts.push("confirm: " + String(m)); return true; };
    }, [], "MAIN").catch(() => {});
    const per = {};

    // 1. domains first (a + that reloads the page must not lose the other fields)
    for (const c of changes.filter((x) => x.target === "acceptedDomains")) {
      let st = {};
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        st = await call("domainState", c.to);
        if (st.inputFound || st.tagged || st.listed) break;
        await sleep(500);
      }
      if (st.tagged || st.listed) { per[c.id] = { ok: true, noop: true, how: "already accepted" }; await log("info", `${st.host}: already accepted`); continue; }
      if (!st.inputFound) { per[c.id] = { ok: false, error: `#newValidDomain not found on Main settings${st.error ? " (" + st.error + ")" : ""}` }; await log("error", per[c.id].error); continue; }
      const tried = [];
      let tagged = false;
      for (let n = 0; n < 3 && !tagged; n++) {
        const a = await call("domainClickAdd", c.to, n);
        if (a.error) { tried.push(a.error); break; }
        tried.push(a.gone ? "(page reloaded)" : a.clicked);
        const end = Date.now() + 3000;
        while (Date.now() < end) {
          st = await call("domainState", c.to);
          if (st.tagged || st.listed) { tagged = true; break; }
          await sleep(300);
        }
        await log(tagged ? "info" : "warn", `${st.host || c.to}: typed into #newValidDomain, + clicked on ${tried[tried.length - 1]} → ${tagged ? ".tag created" : "no .tag yet"} (tags: ${(st.tags || []).join(" | ") || "none"})`);
        if (a.targets && n + 1 >= a.targets) break;
      }
      per[c.id] = tagged ? { ok: true, changed: true, how: ".tag created" }
        : { ok: false, error: `typed and + clicked (${tried.join(", ")}), but no .tag with ${c.to} was created` };
    }

    // 2. the other fields of the page
    const fields = changes.filter((x) => x.target !== "acceptedDomains");
    if (fields.length) {
      const r = await call("mainSetFields", fields);
      for (const x of r.results || []) per[x.id] = x;
      for (const c of fields) if (!per[c.id]) per[c.id] = { ok: false, error: r.error || (r.gone ? "the page reloaded before the fields were set" : "not set") };
      await log("debug", "fields:", r.results || r.error || r);
    }

    // 3. one Save, only if something changed
    const changed = Object.values(per).some((x) => x.ok && x.changed);
    let saved = false;
    if (changed) {
      const sv = await call("mainClickSave");
      if (sv.ok) { saved = true; await log("info", `Save clicked: "${sv.clicked.text}" (btn btn-default [${sv.clicked.index}], type=${sv.clicked.type})`); }
      else if (sv.gone) { saved = true; await log("info", "Save clicked: the page reloaded right away"); }
      else await log("error", "not saved:", sv.error || "unknown");
      if (saved) {
        // keep the tab open until the save has gone (reload or saved state, 15 s max); logged only
        const done = await followSave(tab.id);
        await log("debug", `after Save: ${done.state}${done.how ? " (" + done.how + ")" : ""}`);
        const alerts = await inPage(tab.id, () => window.__oirAlerts || [], [], "MAIN").catch(() => []);
        if (alerts && alerts.length) await log("warn", "the page showed:", alerts);
      }
    } else await log("info", "nothing to save");

    // success = the fix was made on the page (a domain: its .tag) AND Save was clicked
    for (const e of entries) {
      const res = per[e.id] || {};
      if (res.noop) e.noop = true;
      e.verified = !!(res.ok && (res.noop || saved));
      if (!e.verified) e.error = res.ok === false ? res.error : "not saved";
      else { delete e.error; if (res.how) e.how = res.how; }
    }
    await mutate(id, (x) => {
      const f = x.ui.main && x.ui.main.fields;
      if (!f) return;
      for (const e of entries.filter((y) => y.verified)) {
        const c = changes.find((y) => y.id === e.id);
        if (["website", "landingPage", "append"].includes(c.target)) f[c.target] = c.to;
        if (c.target === "awc") f.awc = true;
        if (c.target === "acceptedDomains") f.acceptedDomains = Array.from(new Set([...(f.acceptedDomains || []), c.to.toLowerCase()]));
      }
    });
    return entries;
  } finally {
    await closeTab(tab.id);
  }
}

async function applyOne(id, change) {
  const run = await getRun(id);
  const url = run.pages[change.pageKey] || pageDef(change.pageKey).url(run.loc || "us", run.awinId);
  const entry = { id: change.id, page: change.area, field: change.field, from: change.from, to: change.to, at: new Date().toISOString(), verified: false };
  const tab = await openBg(run, url);
  const attempts = change.pageKey === "prejoin" ? PREJOIN_ATTEMPTS : 1;
  try {
    for (let i = 1; i <= attempts; i++) {
      const r = await awinApply(tab.id, change, run.awinId);
      await runLog(id, r.ok ? "debug" : "warn", "fix", `${change.area} · ${change.field} (try ${i}):`, r);
      if (r.signin) { entry.signin = true; entry.error = "sign-in needed"; return entry; }
      if (!r.ok) {
        entry.error = r.error || "failed";
        if (i < attempts && !r.needsInput) { await chrome.tabs.reload(tab.id); await settle(tab.id); continue; }
        return entry;
      }
      if (r.noop) { // already right: nothing was saved
        const now = await scrapePage(tab.id, change.pageKey, run.awinId);
        entry.verified = verifyChange(change, now && now.fields);
        entry.noop = true;
        if (entry.verified) { delete entry.error; return entry; }
        entry.error = "looked right before saving, but not when read again";
        return entry;
      }
      await settle(tab.id);
      const errs = await awin(tab.id, "pageErrors").catch(() => []);
      if (errs && errs.length) {
        entry.error = "the page showed an error: " + errs.join("; ");
        if (i < attempts) { await chrome.tabs.reload(tab.id); await settle(tab.id); continue; }
        return entry;
      }
      await chrome.tabs.reload(tab.id);
      await settle(tab.id);
      const after = await scrapePage(tab.id, change.pageKey, run.awinId);
      if (after && after.ok) await mutate(id, (x) => { x.ui[change.pageKey] = after; });
      entry.verified = verifyChange(change, after && after.fields);
      entry.attempts = i;
      if (entry.verified) { delete entry.error; return entry; }
      entry.error = "saved, but the page shows another value after reloading";
    }
    return entry;
  } finally {
    await closeTab(tab.id);
  }
}

// Deletes every test transaction of the MID: search (#merchantId), then one row ->
// .deleteTestTransaction, several -> #delete-all; search again until none is left
async function deleteTestTransactions(id, change) {
  const run = await getRun(id);
  const entry = { id: change.id, page: change.area, field: change.field, from: change.from, to: "", at: new Date().toISOString(), verified: false, refs: [] };
  const tab = await openBg(run, pageDef("testtx").url());
  try {
    for (let i = 1; i <= 5; i++) {
      const found = await testTxSearch(tab.id, run.awinId);
      if (found.signin) { entry.signin = true; entry.error = "sign-in needed"; return entry; }
      if (!found.ok) { entry.error = found.error; break; }
      await runLog(id, "debug", "test transactions", `search ${i}: ${found.rows.length} row(s)`, found.rows.map((r) => r.ref));
      if (!found.rows.length) break;
      // native confirm() on this page is answered "OK", for the deletion only
      await inPage(tab.id, () => { window.confirm = () => true; }, [], "MAIN").catch(() => {});
      const r = await awinNav(tab.id, "ttDelete", run.awinId);
      await runLog(id, r.ok ? "debug" : "warn", "test transactions", `delete ${i}:`, r);
      if (r.signin) { entry.signin = true; entry.error = "sign-in needed"; return entry; }
      if (!r.ok) { entry.error = r.error; break; }
      const refs = r.refs || found.rows.map((x) => x.ref);
      entry.refs.push(...refs.filter((x) => x && !entry.refs.includes(x)));
      await settle(tab.id);
    }
    const after = await readTestTx(tab.id, run.awinId);
    if (after && after.ok) await mutate(id, (x) => { x.ui.testtx = after; });
    entry.verified = !!(after && after.ok && after.fields.rows.length === 0);
    if (entry.verified) delete entry.error;
    else if (!entry.error) entry.error = after && after.ok ? `${after.fields.rows.length} row(s) still there after deleting` : (after && after.error) || "could not read the page again";
    if (!entry.refs.length && change.from) entry.refs = change.from.split(", ");
    return entry;
  } finally {
    await closeTab(tab.id);
  }
}

// ---------- Salesforce fields + Chatter on the record tab ----------
async function recordTab(run) {
  if (run.originTabId) {
    const t = await chrome.tabs.get(run.originTabId).catch(() => null);
    if (t && t.url && t.url.includes(run.recordId)) return t;
  }
  const host = new URL(run.recordUrl).host;
  const [t] = await chrome.tabs.query({ url: `*://${host}/lightning/r/TSE__c/${run.recordId}/*` });
  return t || null;
}
async function ask(tabId, msg) {
  for (let i = 0; i < 30; i++) {
    try { return await limit(chrome.tabs.sendMessage(tabId, msg), 150000, `Salesforce "${msg.action}"`); }
    catch (e) {
      if (!/Receiving end does not exist|Could not establish connection/.test(e.message)) return { ok: false, retry: /no answer/.test(e.message), error: e.message };
      await sleep(1000);
    }
  }
  return { ok: false, retry: true, error: "the Salesforce page did not answer" };
}

const finishing = new Set();
async function finishSalesforce(id) {
  if (finishing.has(id)) return;
  finishing.add(id);
  busy(true);
  let opened = null, prev = null;
  try {
    let run = await getRun(id);
    let tab = await recordTab(run);
    if (!tab) { tab = await chrome.tabs.create({ url: run.recordUrl, active: true }); opened = tab.id; await waitForLoad(tab.id); await sleep(4000); }
    else {
      [prev] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      await chrome.tabs.update(tab.id, { active: true }); // the record must be drawn
      await sleep(1500);
    }

    if (!run.sfUpdate || !run.sfUpdate.ok) {
      await stepStart(id, "sfupdate", "Salesforce: update fields");
      const updates = (run.result.sfUpdates || []).filter((u) => u.key); // after the fixes (e.g. plugins now enabled)
      const res = updates.length ? await ask(tab.id, { action: "oirSfUpdate", recordId: run.recordId, updates }) : { ok: true, set: [], notfound: [], problem: [] };
      run = await mutate(id, (r) => { r.sfUpdate = res; });
      const detail = res.ok ? [res.set.length ? "set: " + res.set.join(", ") : "nothing to change", res.notfound.length ? "not on the layout: " + res.notfound.join(", ") : "", res.problem.length ? res.problem.join("; ") : ""].filter(Boolean).join(" · ") : res.error;
      // a field that is not on the record's layout is noted, not an error; only real problems fail
      if (res.ok && res.notfound && res.notfound.length) await runLog(id, "info", "salesforce", "fields not on this record's layout (skipped):", res.notfound);
      await stepEnd(id, "sfupdate", res.ok && !(res.problem || []).length ? "ok" : "fail", detail);
    }

    if (!run.chatter || !run.chatter.ok) {
      await stepStart(id, "chatter", "Salesforce: post to Chatter");
      let text = C.chatterText(run);
      if (text.length > 9500) text = text.slice(0, 9400) + "\n…";
      // last line: @Integrator, who does the Tech sign-off and talks to the client
      const mention = run.sf.integrator ? { name: run.sf.integrator, note: "Internal Review done: please review and complete the Tech sign-off." } : null;
      if (!mention) await runLog(id, "warn", "chatter", "no Integrator / Assigned TC on the record: posted without @mention");
      const res = await ask(tab.id, { action: "oirPostChatter", recordId: run.recordId, text, mention });
      if (res.ok && mention && !res.mentioned) await runLog(id, "warn", "chatter", `@${mention.name} left as plain text: pick them from the mention list by hand to notify`);
      run = await mutate(id, (r) => { r.chatter = res; r.chatterText = text + (mention ? `\n@${mention.name} ${mention.note}` : ""); });
      await stepEnd(id, "chatter", res.ok ? "ok" : "fail", res.ok ? "" : res.error);
    }

    const pending = !(run.sfUpdate && run.sfUpdate.ok) || !(run.chatter && run.chatter.ok);
    run = await mutate(id, (r) => { r.state = pending ? "waiting_sf" : "done"; r.finishedAt = Date.now(); r.step = pending ? "Salesforce not finished" : "Done"; });
    const fixed = (run.applied || []).filter((a) => a.verified).length;
    const failed = (run.applied || []).filter((a) => !a.verified).length;
    const open = run.result.checks.filter((c) => c.result === "fail").length;
    notify(pending ? "Optimus IR: Salesforce step pending" : "Optimus IR: review done",
      `MID ${run.awinId}: ${fixed} fixed${failed ? `, ${failed} fix(es) failed` : ""}, ${open} check(s) failing.` +
      (pending ? " Bring the browser to the front or click Retry in Optimus IR." : " Posted to Chatter."), run);
  } finally {
    if (opened) { await sleep(1500); await closeTab(opened); }
    else if (prev) { try { await chrome.tabs.update(prev.id, { active: true }); } catch (e) { /* gone */ } }
    finishing.delete(id);
    busy(false);
  }
}
// A pending Salesforce step is retried when a browser window gets focus (at most every 30 s)
let lastRetry = 0;
chrome.windows.onFocusChanged.addListener(async (wid) => {
  if (wid === chrome.windows.WINDOW_ID_NONE || Date.now() - lastRetry < 30000) return;
  const all = await chrome.storage.local.get(null);
  const waiting = Object.keys(all).filter((k) => k.startsWith(RUN_PREFIX) && all[k].state === "waiting_sf").map((k) => all[k]);
  if (!waiting.length) return;
  lastRetry = Date.now();
  for (const r of waiting) await finishSalesforce(r.id);
});

// ---------- page structure, for fixing selectors ----------
async function describePages(id) {
  const run = await getRun(id);
  if (!run) return { ok: false };
  const out = {};
  for (const p of F.PAGES) {
    const tab = await openBg(run, run.pages[p.key] || p.url(run.loc || "us", run.awinId));
    try { await awin(tab.id, "pageReady"); out[p.key] = await awin(tab.id, "describe"); }
    catch (e) { out[p.key] = { error: e.message }; }
    await closeTab(tab.id);
  }
  await mutate(id, (r) => { r.diagnostics = { at: new Date().toISOString(), version: VERSION, pages: out }; });
  await closeGroup(id);
  return { ok: true };
}

async function prune() {
  const all = await chrome.storage.local.get(null);
  const runs = Object.keys(all).filter((k) => k.startsWith(RUN_PREFIX)).map((k) => all[k]).sort((a, b) => b.startedAt - a.startedAt);
  for (const r of runs.slice(HISTORY_MAX)) await chrome.storage.local.remove(runKey(r.id));
}

// ---------- the review panel ----------
// Moonfill's 🔎 IR button on an Implementation record (caught by content/hook.js) opens the panel in a
// small window of its own, tied to that record's tab. One panel per record tab: clicking again brings
// it back to the front.
const PANEL = "autofill/review/panel.html";
const panels = {}; // record tab id -> panel window id
async function openPanel(tab, mid) {
  if (!tab || tab.id == null) return { ok: false, error: "no record tab" };
  const known = panels[tab.id];
  if (known != null) {
    const w = await chrome.windows.get(known).catch(() => null);
    if (w) { await chrome.windows.update(known, { focused: true }); return { ok: true, focused: true }; }
  }
  const url = chrome.runtime.getURL(`${PANEL}?tab=${tab.id}${mid ? "&mid=" + encodeURIComponent(mid) : ""}`);
  const near = await chrome.windows.get(tab.windowId).catch(() => null);
  const width = 440, height = 760;
  const place = near && near.left != null ? { left: Math.max(0, near.left + near.width - width - 24), top: Math.max(0, near.top + 72) } : {};
  const w = await chrome.windows.create({ url, type: "popup", width, height, focused: true, ...place });
  panels[tab.id] = w.id;
  return { ok: true, opened: true };
}
chrome.windows.onRemoved.addListener((wid) => { for (const k of Object.keys(panels)) if (panels[k] === wid) delete panels[k]; });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.action !== "string") return;
  const handlers = {
    oirOpenPanel: () => openPanel(sender.tab, String(msg.mid || "").replace(/\D/g, "")),
    oirStart: () => startRun(msg),
    oirRetrySf: async () => { await finishSalesforce(msg.runId); return { ok: true }; },
    oirDescribe: () => describePages(msg.runId),
    oirChatterText: async () => { const r = await getRun(msg.runId); return r ? { ok: true, text: r.chatterText || C.chatterText(r) } : { ok: false }; }
  };
  if (!handlers[msg.action]) return;
  handlers[msg.action]().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

(async () => {
  const all = await chrome.storage.local.get(null);
  for (const k of Object.keys(all)) {
    const r = all[k];
    if (k.startsWith(RUN_PREFIX) && ["running", "applying", "salesforce"].includes(r.state)) {
      r.state = "failed"; r.error = ORPHANED; r.groupId = null; r.finishedAt = Date.now();
      (r.steps || []).forEach((st) => { if (st.status === "running") { st.status = "fail"; st.detail = "interrupted"; } });
      r.log = (r.log || []).concat(`${new Date().toISOString().slice(11, 19)} ERROR [run] ${ORPHANED}`);
      await chrome.storage.local.set({ [k]: r });
      L.error("run", ORPHANED, r.awinId);
    }
  }
})();

chrome.runtime.onStartup.addListener(async () => {
  const all = await chrome.storage.local.get(null);
  for (const k of Object.keys(all)) {
    const r = all[k];
    if (k.startsWith(RUN_PREFIX) && ["running", "applying", "salesforce"].includes(r.state)) {
      r.state = "failed"; r.error = "interrupted (the browser was closed). Start the review again."; r.groupId = null;
      await chrome.storage.local.set({ [k]: r });
    }
  }
});
})();

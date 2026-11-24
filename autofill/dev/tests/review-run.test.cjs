// Ported from Optimus IR's own test/run.sim.js (autofill/review/). Run by `npm test` with the prototype's tests.
// Simulates one whole run of background.js with a fake Chrome and fake Awin pages
// (each with its own delay), to check ordering, parallelism and that the run always ends.
// node test/run.sim.js            (shop answers /meta.json)
// SIM_SLOW_SHOP=1 node test/run.sim.js   (the shop never answers: *.myshopify.com after 25 s)
const SLOW = !!process.env.SIM_SLOW_SHOP;
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..", "..", ".."); // the extension root: importScripts paths start there
const T0 = Date.now();
const t = () => Date.now() - T0;
const events = [];
const ev = (e) => events.push([t(), e]);

// ---- fake Awin pages: delay (ms) and state ----
const state = {
  main: { website: "https://breggz.com/nl", landingPage: "https://breggz.com/nl", append: "source=aw", awc: true, linkBuilder: true, acceptedDomains: ["breggz.com"] },
  mobile: { strategy: false },
  migrated: { validationDays: "30", manualApproval: true },
  prejoin: { formFound: true, publishers: [{ id: "111", status: "Active" }, { id: "45628", status: "Pending" }] },
  testtx: { rows: [{ ref: "T1" }, { ref: "T2" }] }
};
const DELAY = { main: 400, commission: 300, plugins: 200, fees: 500, validate: 600, wizard: 700, mobile: 150, prejoin: 250, migrated: 200, testtx: 300 };
const keyOf = (url) =>
  /main-settings/.test(url) ? "main" : /commission-groups/.test(url) ? "commission" : /plugins/.test(url) ? "plugins" :
  /fee-manager/.test(url) ? "fees" : /validate-pending/.test(url) ? "validate" : /trackingwizard/.test(url) ? "wizard" :
  /mobile-tracking/.test(url) ? "mobile" : /pre-join/.test(url) ? "prejoin" :
  /migrated-advertiser/.test(url) ? "migrated" : /test-transactions/.test(url) ? "testtx" : /lightning/.test(url) ? "sf" : "site";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fields(k) {
  switch (k) {
    case "commission": return { groups: [{ name: "DEFAULT", type: "Percentage", value: 8 }] };
    case "plugins": return { plugins: [{ name: "R.O.EYE - Consent - SingleView", enabled: true }] };
    case "fees": return { feeValue: "30", fees: [] };
    case "validate": return { transactions: [{ ref: "T1", voucher: true, params: ["shopifyApp_5.6.02"] }] };
    case "wizard": return { transactionDetails: 1 };
    default: return JSON.parse(JSON.stringify(state[k]));
  }
}
async function page(url, method, a) {
  const k = keyOf(url);
  if (method === "pageReady" || method === "pageErrors") return method === "pageErrors" ? [] : undefined;
  if (method === "signinShown") return false;
  if (method === "scrape") { await sleep(DELAY[k]); ev(`read ${k}`); return { ok: true, idConfirmed: true, url, errors: [], fields: fields(k) }; }
  if (method === "ttSearch") return { ok: true, submitted: true };
  if (method === "saveStatus") return { state: "confirmed", how: "sim" };
  if (method === "ttRead") { await sleep(DELAY.testtx); ev("read testtx"); return { searched: true, rows: state.testtx.rows.slice() }; }
  if (method === "ttDelete") { ev("DELETE test transactions"); const refs = state.testtx.rows.map((r) => r.ref); state.testtx.rows = []; return { ok: true, refs }; }
  if (method === "domainState") { const host = a[0]; const tagged = state.main.acceptedDomains.includes(host); return { host, tagged, listed: tagged, inputFound: true, tags: state.main.acceptedDomains.slice() }; }
  if (method === "domainClickAdd") { ev("FIX main: + for " + a[0]); if (a[1] === 0) state.main.acceptedDomains.push(a[0]); return { ok: true, clicked: "<i.fa-plus>", targets: 3 }; }
  if (method === "mainSetFields") { ev("FIX main fields: " + a[0].map((c) => c.target).join(",")); for (const c of a[0]) if (c.target === "append") state.main.append = c.to; return { results: a[0].map((c) => ({ id: c.id, ok: true, changed: true })) }; }
  if (method === "mainClickSave") { ev("FIX main (one submit): acceptedDomains + Save"); return { ok: true, clicked: { text: "Save", index: 2, type: "submit" } }; }
  if (method === "applyMain") {
    ev("FIX main (one submit): " + a[0].map((c) => c.target).join(","));
    for (const c of a[0]) {
      if (c.target === "append") state.main.append = c.to;
      if (c.target === "acceptedDomains") state.main.acceptedDomains.push(c.to);
    }
    return { ok: true, scheduled: true, clicked: { text: "Save", index: 2, type: "submit" }, results: a[0].map((c) => ({ id: c.id, ok: true })) };
  }
  if (method === "apply") {
    const c = a[0];
    await sleep(100);
    ev(`FIX ${c.pageKey}.${c.target}`);
    if (c.target === "strategy") state.mobile.strategy = true;
    if (c.target === "validationDays") state.migrated.validationDays = c.to;
    if (c.target === "manualApproval") state.migrated.manualApproval = /on/i.test(c.to);
    if (c.target === "publisher") state.prejoin.publishers.forEach((p) => (p.status = "Active"));
    return { ok: true, navigating: true };
  }
  throw new Error("unknown method " + method);
}

// ---- fake chrome ----
const store = {};
const created = [], groupTitles = [];
const tabs = new Map();
let nextTab = 1;
const listeners = { msg: [], updated: [], alarm: [] };
const chrome = {
  runtime: {
    getManifest: () => JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")),
    onMessage: { addListener: (f) => listeners.msg.push(f) },
    onStartup: { addListener: () => {} },
    getPlatformInfo: (cb) => cb && cb({}),
    lastError: null
  },
  storage: { local: {
    get: async (k) => (k === null ? JSON.parse(JSON.stringify(store)) : typeof k === "string" ? (k in store ? { [k]: JSON.parse(JSON.stringify(store[k])) } : {}) : {}),
    set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
    remove: async (k) => { [].concat(k).forEach((x) => delete store[x]); }
  } },
  tabs: {
    create: async ({ url, windowId }) => { created.push({ url, windowId }); const tab = { id: nextTab++, url, status: "complete", windowId: windowId || 9 }; tabs.set(tab.id, tab); return tab; },
    get: async (id) => { if (!tabs.has(id)) throw new Error("No tab with id: " + id); return tabs.get(id); },
    remove: async (id) => { tabs.delete(id); },
    update: async (id) => tabs.get(id),
    reload: async (id) => { setTimeout(() => listeners.updated.slice().forEach((f) => f(id, { status: "loading" })), 20); },
    query: async () => [],
    group: async () => 1,
    sendMessage: async (id, msg) => { await sleep(50); ev("SF " + msg.action); return msg.action === "oirSfUpdate" ? { ok: true, set: msg.updates.map((u) => u.field), same: [], notfound: [], problem: [] } : { ok: true, mentioned: true }; },
    onUpdated: { addListener: (f) => listeners.updated.push(f), removeListener: (f) => { const i = listeners.updated.indexOf(f); if (i >= 0) listeners.updated.splice(i, 1); } }
  },
  tabGroups: { update: async (g, o) => { groupTitles.push(o); } },
  windows: { update: async () => {}, get: async () => null, create: async () => ({ id: 5 }), onFocusChanged: { addListener: () => {} }, onRemoved: { addListener: () => {} }, WINDOW_ID_NONE: -1 },
  scripting: {
    executeScript: async ({ target, files, func, args }) => {
      const tab = tabs.get(target.tabId);
      if (!tab) throw new Error("No tab with id: " + target.tabId);
      if (files) return [{}];
      if (args && args.length === 2 && typeof args[0] === "string") return [{ result: await page(tab.url, args[0], args[1]) }];
      if (String(func).includes("OIRPlatforms")) { if (SLOW) await sleep(120000); return [{ result: { platform: null, evidence: [], others: [], domains: [] } }]; }
      return [{ result: undefined }];
    }
  },
  permissions: { contains: async () => true },
  notifications: { create: (id, o) => ev("NOTIFY " + o.title), clear: () => {}, onClicked: { addListener: () => {} } },
  alarms: { create: () => {}, clear: () => {}, onAlarm: { addListener: (f) => listeners.alarm.push(f) } },
  action: {}
};
const ctx = {
  chrome, console: { ...console, debug: () => {}, info: () => {}, log: () => {} }, setTimeout, clearTimeout, setInterval, clearInterval,
  crypto: require("crypto").webcrypto, URL, fetch: async (u) => { if (SLOW) await new Promise(() => {}); await sleep(100); ev("fetch " + u); return { ok: true, json: async () => ({ myshopify_domain: "breggz-dc0shy6m.myshopify.com" }) }; },
  Promise, Date, JSON, Math, Object, Array, String, Number, RegExp, Error, Set, Map
};
ctx.self = ctx; ctx.globalThis = ctx;
ctx.importScripts = (...files) => files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f }));
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "autofill/review/background.js"), "utf8"), ctx, { filename: "autofill/review/background.js" });

const send = (msg) => new Promise((res) => { for (const f of listeners.msg) if (f(msg, {}, res) === true) return; });
(async () => {
  const inputs = { commissionType: "Percentage", commissionValue: "8",
    autoApprove: false, validationDays: 45, trackingFeeType: "Percentage", trackingFeeValue: "30", offerOverride: "Accelerate" };
  const res = await send({ action: "oirStart", mid: "131530", signedIn: true, inputs, tabId: 99, inputsSource: "checklist",
    collected: { recordId: "a0CTr0000E880fGMQQ", recordUrl: "https://awin.lightning.force.com/lightning/r/TSE__c/a0CTr0000E880fGMQQ/view", sf: { awinId: "131530", name: "Breggz - NL", integrator: "Claudio Valdes" } } });
  if (!res.ok) { console.error("start failed", res); process.exit(1); }
  tabs.set(99, { id: 99, url: "https://awin.lightning.force.com/lightning/r/TSE__c/a0CTr0000E880fGMQQ/view", windowId: 1 });
  const key = "oirRun_" + res.runId;
  let run;
  for (let i = 0; i < 900; i++) { await sleep(100); run = store[key]; if (run && ["done", "failed", "waiting_sf", "blocked"].includes(run.state)) break; }
  const at = (e) => (events.find(([, x]) => x.startsWith(e)) || [Infinity])[0];
  const checks = [
    ["run ended", ["done", "waiting_sf"].includes(run.state), run.state + (run.error ? ": " + run.error : "")],
    ["test transactions deleted after the pending + wizard reads", at("DELETE") > at("read validate") && at("DELETE") > at("read wizard"), `delete ${at("DELETE")} ms, validate ${at("read validate")}, wizard ${at("read wizard")}`],
    ["a fix starts before the slowest read ends (parallel)", Math.min(at("FIX mobile"), at("FIX migrated"), at("FIX prejoin")) < at("read wizard"), `first fix ${Math.min(at("FIX mobile"), at("FIX migrated"), at("FIX prejoin"))} ms, wizard read ${at("read wizard")} ms`],
    ["Main settings: one submit with the Shopify domain", events.some(([, e]) => /FIX main \(one submit\): .*acceptedDomains/.test(e)), ""],
    ["Shopify domain: " + (SLOW ? "*.myshopify.com after the wait" : "the internal domain"),
      (run.applied || []).some((a) => a.to === (SLOW ? "*.myshopify.com" : "breggz-dc0shy6m.myshopify.com") && a.verified), ""],
    ["all fixes verified", (run.applied || []).every((a) => a.verified), JSON.stringify((run.applied || []).filter((a) => !a.verified))],
    ["Chatter posted", events.some(([, e]) => e === "SF oirPostChatter"), ""],
    // each Awin tab is closed as soon as its read or fix is done (the user's preference), in a collapsed
    // "IR <MID>" group, opened in the record's window
    ["tabs opened in the record's window", created.length > 0 && created.every((c) => c.windowId === 1), JSON.stringify(created.filter((c) => c.windowId !== 1).slice(0, 2))],
    ["group named \"IR 131530\", collapsed", groupTitles.some((o) => o.title === "IR 131530" && o.collapsed === true), JSON.stringify(groupTitles)],
    ["every Awin tab closed after the run", ![...tabs.values()].some((t) => /ui\.awin\.com/.test(t.url || "")), JSON.stringify([...tabs.values()].filter((t) => /ui\.awin\.com/.test(t.url || "")).map((t) => t.url))]
  ];
  let failed = 0;
  for (const [name, okk, detail] of checks) { console.log(`${okk ? "ok  " : "FAIL"} ${name}${detail ? " · " + detail : ""}`); if (!okk) failed++; }
  console.log(`total ${t()} ms (serial page time would be ≥ ${Object.values(DELAY).reduce((a, b) => a + b, 0)} ms of reads alone)`);
  console.log(run.chatterText);
  if (!/^Internal Review \| MID 131530 \| Optimus IR v0\.2\.23 \(/.test(run.chatterText || "")) { console.log("FAIL Chatter report names the IR version and the build"); failed++; }
  process.exit(failed ? 1 : 0);
})();

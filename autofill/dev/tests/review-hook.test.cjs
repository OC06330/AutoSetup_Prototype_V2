// The Internal Review in the AutoSetup prototype: Moonfill's 🔎 IR button opens the review panel on an
// Implementation record (content/hook.js), and the panel takes the MID from the record, checks the Awin
// sign-in by itself and can still just open the IR tabs (panel.js).
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const review = path.join(__dirname, "..", "..", "review");
const root = path.join(__dirname, "..", "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REC = "a0CTr0000E880fGMQQ";

function record(url) {
  const dom = new JSDOM(`<html><body><div class="oneContent active">
    <a href="https://ui.awin.com/dashboard/awin/advertiser/131530">Awin</a>
    <div id="moonfillSalesforceSection"><button class="mf-ir">🔎 IR</button></div></div></body></html>`, { runScripts: "outside-only", url });
  const w = dom.window;
  w.eval("HTMLElement.prototype.getClientRects = function(){return [1]};");
  const sent = [];
  w.chrome = { runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true }; } } };
  let moonfillClicked = 0;
  w.document.querySelector("button.mf-ir").addEventListener("click", () => { moonfillClicked++; }); // Moonfill's own handler
  w.eval(fs.readFileSync(path.join(review, "content/hook.js"), "utf8"));
  const click = (opts = {}) => w.document.querySelector("button.mf-ir").dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true, ...opts }));
  return { w, sent, click, moonfill: () => moonfillClicked };
}

test("IR hook: 🔎 IR on an Implementation record opens the review panel, with the record's MID", () => {
  const p = record(`https://awin.lightning.force.com/lightning/r/TSE__c/${REC}/view`);
  p.click();
  assert.deepEqual(p.sent, [{ action: "oirOpenPanel", mid: "131530" }]);
  assert.equal(p.moonfill(), 0, "Moonfill's own click (the tab group) is not run");
});

test("IR hook: shift-click, and the Case page's IR button, keep Moonfill's tab group", () => {
  let p = record(`https://awin.lightning.force.com/lightning/r/TSE__c/${REC}/view`);
  p.click({ shiftKey: true });
  assert.deepEqual(p.sent, []);
  assert.equal(p.moonfill(), 1);
  p = record("https://awin.lightning.force.com/lightning/r/Case/5003X00002abcdeQAA/view");
  p.click();
  assert.deepEqual(p.sent, []);
  assert.equal(p.moonfill(), 1);
});

function panel(query, session, checklist, opts = {}) {
  const html = fs.readFileSync(path.join(review, "panel.html"), "utf8").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: `chrome-extension://x/autofill/review/panel.html${query}` });
  const w = dom.window;
  const sent = [], tabsAsked = [], created = [], tabsSent = [];
  const store = {};
  w.chrome = {
    runtime: {
      getManifest: () => ({ version: "3.0.3", version_name: "3.0.3 AutoSetup prototype" }),
      getURL: (p) => "chrome-extension://x/" + p,
      sendMessage: async (m) => { sent.push(m); return m.action === "tcaSetupCheckSession" ? session : { ok: true, runId: "r2" }; }
    },
    tabs: {
      get: async (id) => { tabsAsked.push(id); return { id, windowId: 3, url: `https://awin.lightning.force.com/lightning/r/TSE__c/${REC}/view` }; },
      query: async () => [],
      create: async (o) => { created.push(o); return { id: 9 }; },
      sendMessage: async (id, m) => (tabsSent.push(m.action), m.action === "oirChecklist" && opts.checklistDelay && await sleep(opts.checklistDelay), m.action === "oirChecklist")
        ? { ok: true, checklist: checklist || { found: true, inputs: { commissionType: "Percentage", commissionValue: "8", autoApprove: false, validationDays: 30, trackingFeeType: "Percentage", trackingFeeValue: "30", offerOverride: "Accelerate" }, missing: [] } }
        : { ok: true, recordId: REC, recordUrl: "u", sf: { awinId: "131530", name: "Breggz" } }
    },
    storage: {
      local: { get: async () => ({}) },
      session: { get: async (k) => (k in store ? { [k]: store[k] } : {}), set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; } },
      onChanged: { addListener: () => {} }
    },
    scripting: { executeScript: async () => [] }
  };
  w.navigator.clipboard = { writeText: async () => {} };
  for (const f of ["lib/log.js", "lib/fields.js", "lib/checks.js", "panel.js"]) w.eval(fs.readFileSync(path.join(review, f), "utf8"));
  w.console.info = () => {};
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return { w, d: w.document, sent, tabsAsked, created, tabsSent };
}

test("IR panel: tied to the record tab, MID from the record, signed in ticked by the setup's own check", async () => {
  const p = panel("?tab=7&mid=131530", { signedIn: true });
  await sleep(300);
  assert.ok(p.tabsAsked.includes(7), "reads the record tab it was opened from");
  assert.equal(p.d.querySelector('input[name="mid"]').value, "131530");
  assert.ok(p.sent.some((m) => m.action === "tcaSetupCheckSession" && m.mid === "131530"));
  assert.equal(p.d.querySelector('input[name="signedIn"]').checked, true);
  assert.match(p.d.getElementById("start").textContent, /Signed in to Awin/);
  assert.equal(p.d.querySelector("#start button.primary").disabled, false, "Run is ready: checklist read, record read, signed in");
  assert.match(p.d.getElementById("v").textContent, /v0\.2\.23 · 3\.0\.3 AutoSetup prototype/);
});

test("IR panel: signed out -> not ticked, Sign in to Awin opens Awin next to the record", async () => {
  const p = panel("?tab=7&mid=131530", { signedIn: false, detail: "Awin asked to sign in" });
  await sleep(300);
  assert.equal(p.d.querySelector('input[name="signedIn"]').checked, false);
  const signIn = Array.from(p.d.querySelectorAll("#start button")).find((b) => b.textContent === "Sign in to Awin");
  assert.ok(signIn);
  signIn.click();
  assert.deepEqual(p.created[0], { url: "https://ui.awin.com/", windowId: 3, active: true });
  // Run is never greyed out: clicked, it says what's wrong and doesn't start
  const run = p.d.querySelector("#start button.primary");
  assert.equal(run.disabled, false);
  p.d.querySelector("#start form").dispatchEvent(new p.w.Event("submit", { cancelable: true }));
  await sleep(50);
  assert.ok(!p.sent.some((m) => m.action === "oirStart"));
  assert.match(p.d.querySelector("#start .err").textContent, /tick “signed in”/);
});

test("IR panel: Enter the details by hand opens every field at once, stops the Chatter search, and Run starts once the record is read", async () => {
  const p = panel("?tab=7&mid=131530", { signedIn: true }, { found: false, posts: 3, stopped: true }, { checklistDelay: 600 });
  await sleep(100);
  assert.ok(!p.d.querySelector('input[name="commissionValue"]'), "no fields while the search runs");
  const byHand = Array.from(p.d.querySelectorAll("#start button")).find((b) => b.textContent === "Enter the details by hand");
  assert.ok(byHand && !byHand.disabled);
  byHand.click();
  for (const name of ["commissionValue", "validationDays", "offerOverride", "autoApprove"]) assert.ok(p.d.querySelector(`[name="${name}"]`), `${name} shown at once`);
  assert.ok(p.tabsSent.includes("oirStopSearch"), "the Chatter search is stopped");
  assert.equal(byHand.hidden, true);
  p.d.querySelector('input[name="commissionValue"]').value = "7";
  p.d.querySelector('input[name="validationDays"]').value = "45";
  p.d.querySelector('select[name="offerOverride"]').value = "Advanced";
  // Run while the record is still being read: queued, then started by itself
  p.d.querySelector("#start form").dispatchEvent(new p.w.Event("submit", { cancelable: true }));
  await sleep(20);
  assert.match(p.d.querySelector("#start .err").textContent, /Starts as soon as the record is read/);
  assert.ok(!p.sent.some((m) => m.action === "oirStart"));
  await sleep(900);
  const start = p.sent.find((m) => m.action === "oirStart");
  assert.ok(start, "started once the record was read");
  assert.equal(start.inputs.commissionValue, "7");
  assert.equal(start.inputs.validationDays, 45);
  assert.equal(start.inputs.offerOverride, "Advanced");
  assert.equal(start.inputs.autoApprove, undefined, "neither ticked: manual, as the setup");
  assert.equal(start.inputsSource, "form");
});

test("IR panel: fields opened by hand get what the search found, without replacing what the TC typed", async () => {
  const p = panel("?tab=7&mid=131530", { signedIn: true }, { found: true, recordChecklist: true, setupNote: null, checklistPost: false,
    inputs: { recordChecklist: true, offerOverride: "Accelerate", commissionType: "Percentage", commissionValue: "8", validationDays: 30 }, missing: [], differences: [] }, { checklistDelay: 300 });
  await sleep(50);
  Array.from(p.d.querySelectorAll("#start button")).find((b) => b.textContent === "Enter the details by hand").click();
  p.d.querySelector('input[name="validationDays"]').value = "60";
  await sleep(700);
  assert.equal(p.d.querySelector('input[name="commissionValue"]').value, "8", "filled from the record");
  assert.equal(p.d.querySelector('select[name="offerOverride"]').value, "Accelerate");
  assert.equal(p.d.querySelector('input[name="validationDays"]').value, "60", "the TC's own value stays");
  p.d.querySelector("#start form").dispatchEvent(new p.w.Event("submit", { cancelable: true }));
  await sleep(100);
  const start = p.sent.find((m) => m.action === "oirStart");
  assert.equal(start.inputs.validationDays, 60);
  assert.equal(start.inputsSource, "record + form");
});

test("IR panel: Just open the IR tabs does what the 🔎 IR button always did", async () => {
  const p = panel("?tab=7&mid=131530", { signedIn: null });
  await sleep(300);
  p.d.querySelector("button.tabs-only").click();
  assert.ok(p.sent.some((m) => m.action === "openReviewTabs" && m.mid === "131530"));
  assert.match(p.d.getElementById("start").textContent, /Couldn't check the Awin sign-in/);
});

test("manifest: the Internal Review runs on Salesforce records, its background is loaded with the others", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const entry = manifest.content_scripts.find((c) => c.js.includes("autofill/review/content/salesforce.js"));
  assert.deepEqual(entry.matches, ["https://awin.lightning.force.com/*"]);
  assert.deepEqual(entry.js, ["lib/log.js", "lib/fields.js", "lib/checks.js", "content/salesforce.js", "content/hook.js"].map((f) => "autofill/review/" + f));
  for (const f of entry.js) assert.ok(fs.existsSync(path.join(root, f)), f);
  for (const p of ["tabs", "storage", "scripting", "tabGroups", "notifications", "alarms"]) assert.ok(manifest.permissions.includes(p), p);
  assert.match(fs.readFileSync(path.join(root, "autofill/background.js"), "utf8"), /importScripts\('autofill\/review\/background\.js'\)/);
  const bg = fs.readFileSync(path.join(review, "background.js"), "utf8");
  for (const f of bg.match(/"autofill\/review\/[^"]+\.js"/g)) assert.ok(fs.existsSync(path.join(root, JSON.parse(f))), f);
});

test("IR Salesforce update: waits for the shared edit lock, holds it while editing, then lets go", async () => {
  const dom = new JSDOM(`<html><body><div class="oneContent active"><a data-tab-value="detailTab" aria-selected="true">Details</a></div></body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true, url: `https://awin.lightning.force.com/lightning/r/TSE__c/${REC}/view` });
  const w = dom.window;
  w.eval("HTMLElement.prototype.getClientRects = function(){return [1]};");
  const listeners = [];
  w.chrome = { runtime: { onMessage: { addListener: (f) => listeners.push(f) } }, storage: { local: { get: async () => ({}) } } };
  for (const f of ["lib/log.js", "lib/fields.js", "lib/checks.js", "content/salesforce.js"]) w.eval(fs.readFileSync(path.join(review, f), "utf8"));
  w.console.info = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  const html = w.document.documentElement;
  html.dataset.awinEditLock = "checklist-abcd";          // the Checklist Autofill is saving
  const seen = [];
  const watch = setInterval(() => seen.push(html.dataset.awinEditLock || ""), 50);
  setTimeout(() => { delete html.dataset.awinEditLock; }, 400);
  const res = await new Promise((r) => listeners.forEach((f) => f({ action: "oirSfUpdate", recordId: REC, updates: [] }, {}, r)));
  clearInterval(watch);
  assert.ok(seen.slice(0, 5).every((t) => t === "checklist-abcd"), "left the other fill's lock alone while waiting");
  assert.equal(res.error, "no edit pencil on the Details tab", "then went on to edit (this mock record has nothing to edit)");
  assert.equal(html.dataset.awinEditLock, undefined, "and let go of the lock afterwards");
});

test("IR panel: inputs from the setup note (the source of truth), differences with the checklist post shown", async () => {
  const p = panel("?tab=7&mid=131530", { signedIn: true }, {
    found: true, setupNote: { mid: "131530", offer: "Access", needsLook: [], notStarted: [] }, checklistPost: true,
    inputs: { setupNote: true, offerOverride: "Access", commissionType: "Percentage", commissionValue: "8", validationTarget: 37, validationDays: 30, autoApprove: false },
    missing: [], differences: ["Commission: Percentage 8 in the setup note, Percentage 9 in the checklist post (the setup note's is used)"]
  });
  await sleep(300);
  const text = p.d.getElementById("start").textContent;
  assert.match(text, /From the setup note \(approval from “Implementation Checklist”\): Commission Percentage 8 · Validation 37 days as set \(30 in the contract\) · Auto-approve No · Offer Access/);
  assert.match(text, /Commission: Percentage 8 in the setup note, Percentage 9 in the checklist post \(the setup note's is used\)\./);
  assert.ok(!p.d.querySelector('input[name="trackingFeeValue"]'), "no tracking fee asked for");
  assert.equal(p.d.querySelector("#start button.primary").disabled, false);
  p.d.querySelector("#start form").dispatchEvent(new p.w.Event("submit", { cancelable: true }));
  await sleep(100);
  const start = p.sent.find((m) => m.action === "oirStart");
  assert.equal(start.inputsSource, "setup note + checklist");
  assert.equal(start.inputs.validationTarget, 37);
});

test("IR panel: inputs from the record's marketing checklist, the setup note as backup", async () => {
  const p = panel("?tab=7&mid=131530", { signedIn: true }, {
    found: true, recordChecklist: true, setupNote: { mid: "131530", offer: "Accelerate", needsLook: [], notStarted: [] }, checklistPost: false,
    inputs: { recordChecklist: true, setupNote: true, offerOverride: "Accelerate", commissionType: "Percentage", commissionValue: "9", validationDays: 30, validationTarget: 30 },
    missing: [], differences: ["Commission: Percentage 9 on the record, Percentage 8 in the setup note (the record's is used)"]
  });
  await sleep(300);
  const text = p.d.getElementById("start").textContent;
  assert.match(text, /From the record's marketing checklist \(setup note as backup\): Commission Percentage 9/);
  assert.match(text, /Commission: Percentage 9 on the record, Percentage 8 in the setup note \(the record's is used\)\./);
  p.d.querySelector("#start form").dispatchEvent(new p.w.Event("submit", { cancelable: true }));
  await sleep(100);
  assert.equal(p.sent.find((m) => m.action === "oirStart").inputsSource, "record + setup note");
});

test("IR panel: no MID from the click -> taken from the setup note, else the record's Awin Program ID", async () => {
  // the record's Awin Program ID (the panel's record read answers 131530)
  let p = panel("?tab=7", { signedIn: true });
  await sleep(400);
  assert.equal(p.d.querySelector('input[name="mid"]').value, "131530");
  assert.match(p.d.getElementById("start").textContent, /From the record's Awin Program ID\./);
  assert.ok(p.sent.some((m) => m.action === "tcaSetupCheckSession" && m.mid === "131530"), "the sign-in is checked for it");
  assert.equal(p.d.querySelector('input[name="signedIn"]').checked, true);
  assert.equal(p.d.querySelector("#start button.primary").disabled, false);
  // the setup note's MID, as soon as the Chatter is read
  p = panel("?tab=7", { signedIn: true }, { found: true, setupNote: { mid: "131530", offer: "Access", needsLook: [], notStarted: [] }, checklistPost: false,
    inputs: { setupNote: true, offerOverride: "Access", commissionType: "Percentage", commissionValue: "8", validationTarget: 37, validationDays: 30 }, missing: [], differences: [] });
  await sleep(400);
  assert.match(p.d.getElementById("start").textContent, /From the setup note\./);
});

test("IR hook: the MID from a dashboard link not on screen; MID 0 is never used", () => {
  const p = record(`https://awin.lightning.force.com/lightning/r/TSE__c/${REC}/view`);
  p.w.eval("HTMLElement.prototype.getClientRects = function(){return []};"); // nothing drawn on screen
  p.click();
  assert.equal(p.sent[0].mid, "131530");
  p.w.document.querySelector("a").setAttribute("href", "https://ui.awin.com/dashboard/awin/advertiser/0");
  p.click();
  assert.equal(p.sent[1].mid, "");
});

// ---------- one settings page for the four tools ----------
async function settingsPage(local = {}, sync = {}) {
  const store = { sync: { ...sync }, local: { ...local } };
  const area = (name) => ({
    get: async (k) => (k === null ? JSON.parse(JSON.stringify(store[name])) : typeof k === "string" ? (k in store[name] ? { [k]: JSON.parse(JSON.stringify(store[name][k])) } : {}) : {}),
    set: async (o) => { Object.assign(store[name], JSON.parse(JSON.stringify(o))); },
    remove: async (k) => { [].concat(k).forEach((x) => delete store[name][x]); }
  });
  const chrome = {
    storage: { sync: area("sync"), local: area("local"), onChanged: { addListener: () => {} } },
    permissions: { contains: async () => false, request: async () => true, remove: async () => true },
    runtime: { getURL: (p) => "chrome-extension://x/" + p }
  };
  const dom = await JSDOM.fromFile(path.join(root, "autofill/options.html"), {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(window) { window.chrome = chrome; }
  });
  await new Promise((r) => dom.window.addEventListener("load", r));
  await sleep(50);
  return { w: dom.window, d: dom.window.document, store };
}

test("settings: one page, Shared first, then one block per tool with who built it", async () => {
  const { w, d } = await settingsPage();
  assert.deepEqual(Array.from(d.querySelectorAll("section.tool")).map((s) => s.id), ["shared", "moonfill", "checklist", "setup", "review"]);
  assert.deepEqual(Array.from(d.querySelectorAll("nav.jump a")).map((a) => a.getAttribute("href")), ["#shared", "#moonfill", "#checklist", "#setup", "#review"]);
  const by = (id) => d.querySelector(`#${id} .by`).textContent;
  assert.match(by("moonfill"), /Rodier Sangibala/);
  assert.match(by("checklist"), /Oscar Coleman/);
  assert.match(by("setup"), /Oscar Coleman/);
  assert.match(by("review"), /Kaio Da Mota/);
  assert.ok(d.querySelector("#shared input[name=menu-style]") && d.querySelector("#shared #detect-toggle") && d.querySelector("#shared #date-format"), "the shared settings are in Shared");
  assert.equal(d.querySelectorAll("#checklist #fields tr").length, 45);
  assert.match(d.querySelector("#moonfill").textContent, /No settings of its own/);
  assert.match(d.querySelector("#setup").textContent, /No settings of its own/);
  w.close();
});

test("settings: the shared date format is saved at once, for the checklist and the review", async () => {
  const { w, d, store } = await settingsPage();
  const sel = d.getElementById("date-format");
  sel.value = "MM/DD/YYYY";
  sel.dispatchEvent(new w.Event("change"));
  await sleep(50);
  assert.equal(store.sync.tcaSettings.dateFormat, "MM/DD/YYYY");
  assert.equal(store.local.oirDateFormat, "MM/DD/YYYY");
  assert.match(d.getElementById("date-status").textContent, /Saved: MM\/DD\/YYYY/);
  w.close();
});

test("settings: the review's region paths and history, in its own block", async () => {
  const { w, d, store } = await settingsPage({ oirRegionLoc: { UK: "gb" }, oirRun_a: { state: "done" }, oirRun_b: { state: "running" }, other: 1 });
  assert.match(d.getElementById("oir-locs").textContent, /UK.*gb/);
  d.getElementById("oir-region").value = "Germany"; d.getElementById("oir-loc").value = "de";
  d.getElementById("oir-add").click();
  await sleep(50);
  assert.deepEqual(store.local.oirRegionLoc, { UK: "gb", Germany: "de" });
  d.querySelector("#oir-locs button").click();
  await sleep(50);
  assert.deepEqual(store.local.oirRegionLoc, { Germany: "de" });
  d.getElementById("oir-clear").click();
  await sleep(50);
  assert.ok(!("oirRun_a" in store.local) && "oirRun_b" in store.local && store.local.other === 1, "finished reviews removed, a running one and other data kept");
  assert.match(d.getElementById("oir-cleared").textContent, /1 review\(s\) removed/);
  w.close();
});

test("IR hook: open() starts the review without Moonfill's button (the floating button's 🔎 IR)", () => {
  let p = record(`https://awin.lightning.force.com/lightning/r/TSE__c/${REC}/view`);
  p.w.document.getElementById("moonfillSalesforceSection").remove();
  assert.equal(p.w.OIRHook.open(), true);
  assert.deepEqual(p.sent, [{ action: "oirOpenPanel", mid: "131530" }]);
  p = record("https://awin.lightning.force.com/lightning/r/Case/5003X00002abcdeQAA/view");
  assert.equal(p.w.OIRHook.open(), false, "not on a Case page");
  assert.deepEqual(p.sent, []);
});

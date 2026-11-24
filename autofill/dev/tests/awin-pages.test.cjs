// The Awin UI pages the tools open (autofill/pages.js), "Just open the tabs" (autofill/tabs.js) and the
// Case page's MID (salesforce.js): the project's own code since 2026-11-19, with no code from other extensions.
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..", "..", "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("pages: the setup's ten addresses, in its order, each matching its own page recipe", () => {
  const P = require(path.join(root, "autofill/pages.js"));
  const w = new JSDOM("", { url: "https://ui.awin.com/", runScripts: "outside-only" }).window;
  // setup/fill.js's recipes, as they run on the Awin pages
  w.TCAEngine = { dom: new Proxy({}, { get: () => () => {} }) };
  w.eval(read("autofill/setup/fill.js"));
  const recipes = w.TCASetupFill.PAGES;
  const urls = P.setupUrls("131530");
  assert.equal(urls.length, 10);
  assert.deepEqual(P.SETUP.map((p) => p.key), recipes.map((r) => r.key), "the same pages in the same order as the recipes");
  urls.forEach((u, i) => assert.ok(recipes[i].match.test(new URL(u).pathname), `${recipes[i].name}: ${u}`));
  assert.ok(urls.every((u) => u.startsWith("https://ui.awin.com/") && u.includes("131530")));
  assert.deepEqual(P.setupUrls("13a15b30"), urls, "only the MID's digits are used");
});

test("pages: the review's tabs are Optimus IR's own page list", () => {
  require(path.join(root, "autofill/review/lib/fields.js"));
  const P = require(path.join(root, "autofill/pages.js"));
  const urls = P.reviewUrls("131530");
  assert.equal(urls.length, globalThis.OIRFields.PAGES.length);
  assert.deepEqual(urls, globalThis.OIRFields.PAGES.map((p) => p.url("us", "131530")));
});

function tabsWorker() {
  const created = [], groups = [], listeners = [];
  const chrome = {
    runtime: { onMessage: { addListener: (f) => listeners.push(f) } },
    tabs: { create: async (o) => { created.push(o); return { id: created.length }; }, group: async ({ tabIds }) => { groups.push({ tabIds }); return 77; } },
    tabGroups: { update: async (id, o) => { groups[groups.length - 1].title = o.title; groups[groups.length - 1].color = o.color; } }
  };
  const ctx = vm.createContext({ chrome, console, URL });
  ctx.globalThis = ctx;
  vm.runInContext(read("autofill/review/lib/fields.js"), ctx);
  vm.runInContext(read("autofill/pages.js"), ctx);
  vm.runInContext(read("autofill/tabs.js"), ctx);
  const send = (msg, sender = {}) => listeners.map((f) => f(msg, sender, () => {}));
  return { created, groups, send };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test("tabs: 🚀 opens the setup's pages and 🔎 the review's, as one group each, in the record's window", async () => {
  const t = tabsWorker();
  assert.deepEqual(t.send({ action: "openSetupTabs", mid: "131530" }, { tab: { id: 5, windowId: 3 } }), [undefined], "never answered");
  await settle();
  assert.equal(t.created.length, 10);
  assert.ok(t.created.every((c) => c.windowId === 3 && c.active === false));
  assert.deepEqual([t.groups[0].title, t.groups[0].color], ["131530 setup", "cyan"]);
  t.send({ action: "openReviewTabs", mid: "131530", windowId: 4 });   // from the review panel (a window of its own)
  await settle();
  assert.equal(t.created.length, 20);
  assert.ok(t.created.slice(10).every((c) => c.windowId === 4));
  assert.deepEqual([t.groups[1].title, t.groups[1].color], ["IR 131530", "purple"]);
  t.send({ action: "openSetupTabs", mid: "0" });
  t.send({ action: "openReviewTabs", mid: "" });
  t.send({ action: "somethingElse", mid: "131530" });
  await settle();
  assert.equal(t.created.length, 20, "nothing for MID 0, no MID, or other messages");
});

function casePage(links, url = "https://awin.lightning.force.com/lightning/r/Case/5003X00002abcdeQAA/view") {
  const dom = new JSDOM(`<html><head></head><body><div class="oneContent active">${links}
    <article class="slds-card"><div class="slds-card__header"><span class="slds-card__header-title">Case Details</span></div></article></div></body></html>`,
    { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.eval("HTMLElement.prototype.getClientRects = function(){return [1]};");
  w.chrome = { runtime: { onMessage: { addListener: () => {} }, sendMessage: async () => ({}), getManifest: () => ({ version: "t" }) }, storage: { local: { get: async () => ({}) } } };
  w.console.log = () => {}; w.console.warn = () => {};
  w.eval(read("salesforce.js"));
  w.ensureCaseButton();
  return w;
}

test("case page: the IR button takes the MID from the Case's link into the Awin UI", () => {
  let w = casePage('<a href="https://ui.awin.com/dashboard/awin/advertiser/131530">131530</a>');
  let b = w.document.querySelector("#moonfillCaseSection button.mf-ir");
  assert.equal(w.document.getElementById("moonfillCaseSection").dataset.mid, "131530");
  assert.equal(b.disabled, false);
  w.close();
  w = casePage('<a href="https://ui.awin.com/provider/pre-join-publishers?advertiserId=98765">Awin</a>');
  assert.equal(w.document.getElementById("moonfillCaseSection").dataset.mid, "98765");
  w.close();
  w = casePage('<a href="https://ui.awin.com/dashboard/awin/advertiser/0">0</a><a href="https://example.com/advertiser/5">x</a>');
  b = w.document.querySelector("#moonfillCaseSection button.mf-ir");
  assert.equal(b.disabled, true, "MID 0, or a link outside the Awin UI, gives no MID");
  assert.match(b.title, /No link to the advertiser in the Awin UI/);
  w.close();
  w = casePage("", "https://awin.lightning.force.com/lightning/r/TSE__c/a0CTr0000E880fGMQQ/view");
  assert.equal(w.document.getElementById("moonfillCaseSection"), null, "only on Case pages");
  w.close();
});

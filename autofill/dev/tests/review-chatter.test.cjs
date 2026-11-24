// Ported from Optimus IR's own test/chatter.smoke.js (autofill/review/). Run by `npm test` with the prototype's tests.
// The "Implementation Checklist" post is found even when it is not among the posts loaded first
// (needs jsdom: npm i -D jsdom). node test/chatter.smoke.js
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..", "review");
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };
const post = (text) => `<article class="cuf-feedElement"><div class="cuf-feedBodyText">${text.replace(/\n/g, "<br>")}</div></article>`;
const CHECKLIST = "Implementation Checklist\nBase commission: Percentage 8\nAuto-approve publishers: No\nValidation period in contract: 30\nTracking fee: Percentage 30\nPlatform Offer: Accelerate";

function page(mode) {
  const dom = new JSDOM(`<html><body><div class="oneContent active">
    <header class="slds-page-header"><button id="recMore">More</button></header>
    <a data-tab-value="detailTab" aria-selected="false">Details</a><a data-tab-value="collaborateTab" aria-selected="true">Chatter</a>
    <div class="slds-form-element"><span class="test-id__field-label">Implementation Name</span><lightning-formatted-text>Shop</lightning-formatted-text></div>
    <div class="cuf-feed"><div class="feed">${post("Newest note")}${post("Optimus IR report")}${post("Kick-off call done")}</div>
    ${mode === "button" || mode === "incomplete" ? '<button id="more">Show More Posts</button>' : ""}</div></div></body></html>`,
    { runScripts: "outside-only", url: "https://awin.lightning.force.com/lightning/r/TSE__c/a0CTr0000E880fGMQQ/view" });
  const w = dom.window;
  w.eval("window.scrollTo = function(){}; HTMLElement.prototype.getClientRects = function(){return [1]}; HTMLElement.prototype.scrollIntoView = function(){ window.__scrolled && window.__scrolled(); };");
  const older = mode === "none" ? [[post("Older 1")], []]
    : mode === "incomplete" ? [[post("Implementation Checklist\nBase commission: Percentage 9")], [post(CHECKLIST)]]
    : [[post("Older 1"), post("Older 2")], [post(CHECKLIST), post("Very old")]];
  let page = 0;
  const loadOlder = () => { if (page < older.length) w.document.querySelector(".feed").insertAdjacentHTML("beforeend", older[page++].join("")); };
  if (mode === "button" || mode === "incomplete") w.document.getElementById("more").addEventListener("click", loadOlder);
  else w.__scrolled = () => setTimeout(loadOlder, 100); // infinite scroll
  w.document.getElementById("recMore").addEventListener("click", () => { w.__recMoreClicked = true; });
  // switching tabs would show in aria-selected
  w.document.querySelectorAll("[data-tab-value]").forEach((t) => t.addEventListener("click", () => {
    w.document.querySelectorAll("[data-tab-value]").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
  }));
  const listeners = [];
  w.chrome = { runtime: { onMessage: { addListener: (f) => listeners.push(f) } }, storage: { local: { get: async () => ({}) } } };
  for (const f of ["lib/log.js", "lib/fields.js", "lib/checks.js", "content/salesforce.js"]) w.eval(fs.readFileSync(path.join(root, f), "utf8"));
  w.console.info = () => {}; w.console.warn = () => {};
  const ask = (action) => new Promise((res) => listeners.forEach((f) => f({ action }, {}, res)));
  return { w, ask, pages: () => page };
}

(async () => {
  let p = page("button");
  let r = await p.ask("oirChecklist");
  ok(r.ok && r.checklist.found && r.checklist.missing.length === 0 && r.checklist.inputs.offerOverride === "Accelerate" && p.pages() === 2,
    `"Show More Posts": found 2 loads back ${JSON.stringify(r.checklist)}`);
  ok(!p.w.__recMoreClicked && p.w.document.querySelector('[data-tab-value="collaborateTab"]').getAttribute("aria-selected") === "true",
    "stayed on Chatter the whole time; the record's own More menu was never clicked");
  p = page("incomplete");
  r = await p.ask("oirChecklist");
  ok(r.checklist.found && r.checklist.missing.length === 0 && r.checklist.inputs.commissionValue === "8",
    "newest checklist incomplete -> kept looking and used the older, complete one");
  p = page("scroll");
  r = await p.ask("oirChecklist");
  ok(r.ok && r.checklist.found && r.checklist.inputs.validationDays === 30, "infinite scroll: found after scrolling");
  p = page("none");
  const t0 = Date.now();
  r = await p.ask("oirChecklist");
  ok(r.ok && r.checklist.found === false, `no checklist anywhere: stops at the end of the feed (${Math.round((Date.now() - t0) / 1000)} s)`);
})();

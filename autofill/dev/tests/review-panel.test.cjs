// Ported from Optimus IR's own test/popup.smoke.js (autofill/review/). Run by `npm test` with the prototype's tests.
// popup.html/popup.js are panel.html/panel.js here.
// Popup: no automatic Chatter search when this record has a running/recent review; form cleared after Run.
// (needs jsdom: npm i -D jsdom) node test/popup.smoke.js
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..", "review");
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REC = "a0CTr0000E880fGMQQ";

function popup(runs) {
  const html = fs.readFileSync(path.join(root, "panel.html"), "utf8").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "chrome-extension://x/popup.html" });
  const w = dom.window;
  const local = Object.assign({}, runs), session = {}, sent = [];
  w.chrome = {
    runtime: { getManifest: () => ({ version: "test" }), sendMessage: async (m) => { sent.push(m.action); return { ok: true, runId: "r2" }; }, openOptionsPage: () => {} },
    tabs: {
      query: async () => [{ id: 7, url: `https://awin.lightning.force.com/lightning/r/TSE__c/${REC}/view` }],
      sendMessage: async (id, m) => {
        sent.push(m.action);
        if (m.action === "oirChecklist") return { ok: true, checklist: { found: true, inputs: { commissionType: "Percentage", commissionValue: "8", autoApprove: false, validationDays: 30, trackingFeeType: "Percentage", trackingFeeValue: "30", offerOverride: "Accelerate" }, missing: [] } };
        return { ok: true, recordId: REC, recordUrl: "u", sf: { awinId: "131530", name: "Breggz" } };
      }
    },
    storage: {
      local: { get: async (k) => (k === null ? JSON.parse(JSON.stringify(local)) : {}) },
      session: { get: async (k) => (k in session ? { [k]: session[k] } : {}), set: async (o) => Object.assign(session, o), remove: async (k) => { delete session[k]; } },
      onChanged: { addListener: () => {} }
    },
    scripting: { executeScript: async () => [] }
  };
  w.navigator.clipboard = { writeText: async () => {} };
  for (const f of ["lib/log.js", "lib/fields.js", "lib/checks.js", "panel.js"]) w.eval(fs.readFileSync(path.join(root, f), "utf8"));
  w.console.info = () => {};
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return { w, sent, session };
}
const running = { [`oirRun_r1`]: { id: "r1", recordId: REC, awinId: "131530", state: "applying", startedAt: Date.now(), steps: [], inputs: {}, log: [] } };

(async () => {
  // 1. a review is running for this record: no Chatter search on open
  let p = popup(running);
  await sleep(300);
  const startText = p.w.document.getElementById("start").textContent;
  ok(!p.sent.includes("oirChecklist") && /is running for this record/.test(startText), "running review: popup does not search Chatter again");
  // ... until "Start a new review"
  Array.from(p.w.document.querySelectorAll("#start button")).find((b) => /Start a new review/.test(b.textContent)).click();
  await sleep(300);
  ok(p.sent.includes("oirChecklist") && p.sent.includes("oirRecord"), "Start a new review: searches Chatter, then reads the record");

  // 2. no recent review: search, fill MID + signed in, Run -> form cleared, draft removed
  p = popup({});
  await sleep(300);
  const d = p.w.document;
  const mid = d.querySelector('input[name="mid"]'); mid.value = "131530"; mid.dispatchEvent(new p.w.Event("input", { bubbles: true }));
  const cb = d.querySelector('input[name="signedIn"]'); cb.checked = true; cb.dispatchEvent(new p.w.Event("change", { bubbles: true }));
  ok(p.session.oirDraft && p.session.oirDraft.mid === "131530", "while typing, the MID is kept as a draft");
  d.querySelector("#start form").dispatchEvent(new p.w.Event("submit", { cancelable: true }));
  await sleep(300);
  ok(p.sent.includes("oirStart") && !p.session.oirDraft && !d.querySelector('input[name="mid"]') && /started/.test(d.getElementById("start").textContent),
    "after Run: draft removed, form replaced by 'started' + Start a new review");
})();

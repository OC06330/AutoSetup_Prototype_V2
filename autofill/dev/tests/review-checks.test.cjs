// Ported from Optimus IR's own test/checks.test.js (autofill/review/). Run by `npm test` with the prototype's tests.
// npm test
const test = require("node:test");
const assert = require("node:assert");
require("../../review/lib/fields.js");
const C = require("../../review/lib/checks.js");

const inputs = {
  commissionType: "Percentage", commissionValue: "8", autoApprove: false,
  validationDays: 30, trackingFeeType: "Percentage", trackingFeeValue: "30", offerOverride: "Accelerate"
};
const sf = {
  name: "Brand UK", awinId: "131913", website: "https://www.brand.com/", landingPage: "https://brand.com/uk",
  dedup: "Yes", dedupParam: "source=awin", linkBuilder: "Yes", ecomPlatform: "Shopify", offer: "Offer 2",
  validationPeriod: "30", trackingFeeOption: "Percentage", trackingFee: "30"
};
const page = (fields) => ({ ok: true, idConfirmed: true, fields });
const ui = () => ({
  main: page({ website: "brand.com", landingPage: "https://brand.com/uk/", append: "utm_source=awin", awc: false, linkBuilder: true, acceptedDomains: ["brand.com"] }),
  commission: page({ groups: [{ name: "DEFAULT", type: "Percentage", value: 8 }] }),
  plugins: page({ plugins: [{ name: "R.O.Eye - Consent - SingleView", enabled: true }] }),
  fees: page({ fees: [{ name: "Tracking Fee", type: "Percentage", value: 30 }] }),
  validate: page({ transactions: [{ ref: "ORD-1", publisher: "111", voucher: true, params: ["p1", "customeracquisition", "parts", "vc"] }] }),
  wizard: page({ transactionDetails: 1 }),
  mobile: page({ strategy: true }),
  prejoin: page({ publishers: [{ id: "111", status: "Active" }, { id: "45628", status: "Pending" }] }),
  migrated: page({ validationDays: "30", manualApproval: true }),
  testtx: page({ rows: [{ ref: "ORD-1" }, { ref: "ORD-2" }] })
});
const site = { checked: true, platform: "Shopify", evidence: ["Shopify.shop = brand-uk.myshopify.com"], others: [], domains: ["brand-uk.myshopify.com"] };
const run = (o = {}) => C.runChecks({ inputs: o.inputs || inputs, sf: o.sf || sf, ui: o.ui || ui(), site, today: "2026-11-17" });
const row = (r, name) => r.checks.find((c) => c.check === name);
const ch = (r, target) => r.changes.find((c) => c.target === target);

test("checklist post: label/value lines in several styles", () => {
  const p = C.parseChecklist(`
    Base commission: 8%
    Analytics: Yes
    Analytics parameters: utm_source=awin&utm_medium=affiliate
    Auto-approve publishers - No
    Validation period in contract: 30 days
    Tracking fee: Fixed 0.50
    Platform Offer: Offer 1`);
  assert.deepEqual(p.missing, []);
  assert.equal(p.inputs.commissionType, "Percentage");
  assert.equal(p.inputs.commissionValue, "8");
  assert.equal(p.inputs.analytics, undefined); // Analytics lines are no longer used
  assert.equal(p.inputs.autoApprove, false);
  assert.equal(p.inputs.validationDays, 30);
  assert.equal(p.inputs.trackingFeeType, "Fixed");
  assert.equal(p.inputs.trackingFeeValue, "0.5");
});

test("checklist post: skill format, missing items", () => {
  const p = C.parseChecklist("- Base commission: Percentage 8\n- Analytics: Yes — utm_source=awin\n- Publisher approval: manual");
  assert.equal(p.inputs.commissionValue, "8");
  assert.equal(p.inputs.autoApprove, false);
  assert.deepEqual(p.missing, ["Validation period in contract", "Platform Offer"]); // the tracking fee is optional in the prototype
  const q = C.parseChecklist("Commission type: Fixed\nCommission value: 5\nAnalytics: No\nAuto approve: Yes\nValidation period: 0\nTracking fee type: Percentage\nTracking fee: 0\nOffer: Advanced");
  assert.deepEqual(q.missing, []);
  assert.equal(q.inputs.commissionType, "Fixed");
  assert.equal(q.inputs.validationDays, 0);
});

test("main settings fixes (no analytics checks)", () => {
  const r = run();
  assert.equal(ch(r, "append").to, "utm_source=awin&source=awin"); // only the missing dedup pair is added
  assert.ok(!r.checks.some((c) => /^Analytics/.test(c.check)));
  assert.equal(ch(r, "awc").verb, "enabled");
  assert.equal(ch(r, "acceptedDomains").to, "brand-uk.myshopify.com");
  assert.equal(row(r, "Link Builder").result, "pass");
});

test("mobile, prejoin, migrated, test transactions; Account details no longer checked", () => {
  const r = run();
  assert.ok(!r.checks.some((c) => c.pageKey === "account"));
  assert.equal(ch(r, "ipTruncation"), undefined);
  assert.equal(ch(r, "refererInvalid"), undefined);
  assert.equal(ch(r, "strategy"), undefined);
  assert.equal(ch(r, "publisher").to, "45628");
  assert.equal(row(r, "Manual approval").result, "pass");
  assert.equal(ch(r, "deleteTestTx").from, "ORD-1, ORD-2");
  assert.equal(row(r, "Test transaction tracked").result, "pass");
});

test("pending transaction: voucher and custom parameters go to Salesforce", () => {
  const r = run();
  assert.equal(row(r, "Custom parameters").ui, "p1, customeracquisition");
  assert.deepEqual(r.sfUpdates.find((u) => u.key === "voucherTracking").value, "Yes");
  assert.equal(r.sfUpdates.find((u) => u.key === "customParameters").value, "p1, customeracquisition");
  const none = C.runChecks({ inputs, sf, site, ui: { ...ui(), validate: page({ transactions: [{ ref: "X", voucher: false, params: ["vc"] }] }) } });
  assert.equal(none.sfUpdates.find((u) => u.key === "customParameters").value, "");
});

test("Access: validation +7, auto-approve flips manual approval", () => {
  const r = run({ inputs: { ...inputs, autoApprove: true, offerOverride: "Access" } });
  assert.equal(ch(r, "validationDays").to, "37");
  assert.equal(ch(r, "manualApproval").to, "Off");
  assert.equal(row(r, "SingleView plugin").result, "skipped");
});

test("chatter comment: only what was adjusted and what needs review", () => {
  const u = ui(); u.mobile = page({ strategy: false });
  const first = C.runChecks({ inputs, sf, ui: u, site, today: "2026-11-17" });
  const applied = [
    { id: ch(first, "append").id, verified: true },
    { id: ch(first, "strategy").id, verified: false, error: "the field did not change" },
    { id: ch(first, "publisher").id, verified: true },
    { id: ch(first, "deleteTestTx").id, verified: true, refs: ["ORD-1", "ORD-2"] }
  ];
  const text = C.chatterText({ awinId: "131913", version: "0.2.12", plan: { changes: first.changes }, applied, result: first,
    sfUpdate: { ok: true, set: ["Voucher Tracking implemented"], notfound: [], problem: [] } });
  const lines = text.split("\n");
  assert.equal(lines[0], "Internal Review | MID 131913 | Optimus IR v0.2.12");
  assert.ok(lines.includes("Default Query String Append modified [utm_source=awin&source=awin] | OK"));
  assert.ok(lines.includes("Test publisher 45628 invited | OK"));
  assert.ok(lines.includes("Test transactions deleted [ORD-1, ORD-2] | OK"));
  assert.ok(lines.includes("Salesforce updated: Voucher Tracking implemented | OK"));
  assert.ok(lines.includes("Mobile tracking strategy enabled | FAILED (the field did not change)"));
  assert.ok(lines.includes("Awin Click ID enabled | NOT DONE"));
  assert.ok(!/Other checks OK|Voucher used|tracked \| OK|Analytics|IP truncation|Referer/.test(text));
});

test("unread page is skipped, sign-in reported", () => {
  const u = ui(); u.mobile = { signin: true };
  const r = run({ ui: u });
  assert.equal(row(r, "Strategy implemented").result, "skipped");
  assert.match(row(r, "Strategy implemented").note, /sign-in/);
});

test("URL rules", () => {
  assert.equal(C.compareUrl("https://www.Brand.com/", "brand.com").result, "pass");
  assert.equal(C.compareUrl("other.com", "brand.com").result, "review");
  assert.equal(C.compareUrl("brand.com", "").action, "sf");
});

test("checklist post on one line (as pasted from Chatter)", () => {
  const p = C.parseChecklist("Base commission: Percentage 8 Analytics: Yes Analytics parameters: utm_source=awin&utm_medium=affiliate Auto-approve publishers: No Validation period in contract: 30 Tracking fee: Percentage 30 Platform Offer: Accelerate");
  assert.deepEqual(p.missing, []);
  assert.deepEqual(
    [p.inputs.commissionType, p.inputs.commissionValue, p.inputs.autoApprove, p.inputs.validationDays, p.inputs.trackingFeeType, p.inputs.trackingFeeValue, p.inputs.offerOverride],
    ["Percentage", "8", false, 30, "Percentage", "30", "Accelerate"]); // the Analytics items in between don't leak into the values
});

test("site platform: any platform, compared with the record", () => {
  const plat = (p) => run({ sf: { ...sf, ecomPlatform: p } });
  const r1 = C.runChecks({ inputs, sf: { ...sf, ecomPlatform: "" }, ui: ui(), today: "2026-11-17",
    site: { checked: true, platform: "WooCommerce", evidence: ["woocommerce body class"], others: [], domains: [] } });
  assert.equal(row(r1, "eCommerce platform").result, "pass");
  assert.equal(r1.sfUpdates.find((u) => u.key === "ecomPlatform").value, "WooCommerce");
  assert.equal(r1.changes.find((c) => c.target === "acceptedDomains"), undefined); // no platform domain for WooCommerce
  const r2 = C.runChecks({ inputs, sf: { ...sf, ecomPlatform: "Magento" }, ui: ui(), site: { checked: true, platform: "WooCommerce", evidence: ["x"], others: [], domains: [] } });
  assert.equal(row(r2, "eCommerce platform").result, "review");
  assert.equal(row(plat("Shopify Plus"), "eCommerce platform").result, "pass");
  const r3 = C.runChecks({ inputs, sf, ui: ui(), site: { checked: false, error: "site check not allowed yet" } });
  assert.equal(row(r3, "eCommerce platform").result, "skipped");
});

test("platform detection signs", () => {
  const P = require("../../review/lib/platforms.js");
  const doc = (srcs = [], cls = "") => ({
    body: { className: cls }, querySelector: () => null,
    querySelectorAll: () => srcs.map((u) => ({ getAttribute: (a) => (a === "src" ? u : null) }))
  });
  assert.deepEqual(P.detect({ Shopify: { shop: "Brand.myshopify.com" } }, doc(["https://cdn.shopify.com/x.js"])).domains, ["brand.myshopify.com"]);
  assert.equal(P.detect({}, doc([], "home woocommerce")).platform, "WooCommerce");
  assert.equal(P.detect({ vtex: {} }, doc(["https://x.vtexassets.com/a.js"])).platform, "VTEX");
  assert.equal(P.detect({ BCData: {} }, doc()).platform, "BigCommerce");
  assert.equal(P.detect({}, doc(["/on/demandware.static/x.js"])).platform, "Salesforce Commerce Cloud");
  assert.equal(P.detect({}, doc(["/main.js"])).platform, null);
});

test("Salesforce: blank record fields filled from the Awin UI, tracking test date", () => {
  const blankSf = { ...sf, website: "", landingPage: "", dedupParam: "", linkBuilder: "", trackingTestDate: "" };
  const r = C.runChecks({ inputs, sf: blankSf, ui: ui(), site, today: "2026-11-17" });
  const up = Object.fromEntries(r.sfUpdates.filter((u) => u.key).map((u) => [u.key, u.value]));
  assert.equal(up.website, "brand.com");
  assert.equal(up.landingPage, "https://brand.com/uk/");
  assert.equal(up.dedupParam, "utm_source"); // the parameter name of the pair in the append
  assert.equal(up.channelParams, "awin");     // its value
  assert.equal(up.linkBuilder, "Yes");
  assert.equal(up.trackingAppends, undefined); // Tracking appends required: no longer updated
  assert.equal(up.trackingTestDate, "2026-11-17");
  assert.equal(row(r, "Website").result, "pass");
  // filled values are not repeated as "To check" in Chatter
  const text = C.chatterText({ awinId: "1", version: "x", plan: { changes: [] }, applied: [], result: r });
  assert.ok(!/To check: (Website|Landing page|Link Builder)/.test(text));
  // record already filled: nothing overwritten; no tracked transaction: no date
  const u2 = ui(); u2.wizard = page({ transactionDetails: 0 });
  const r2 = C.runChecks({ inputs, sf: { ...sf, dedupParam: "source", channelParams: "awin", trackingTestDate: "" }, ui: u2, site, today: "2026-11-17" });
  const keys = r2.sfUpdates.map((u) => u.key);
  for (const k of ["website", "landingPage", "dedupParam", "linkBuilder", "trackingTestDate"]) assert.ok(!keys.includes(k), k);
});

test("Offer comes only from the checklist; MT plugins activated", () => {
  assert.ok(C.missingInputs({ ...inputs, offerOverride: "" }).includes("Platform Offer"));
  const u = ui(); u.plugins = page({ plugins: [{ name: "R.O.EYE - Consent - SingleView", enabled: true }, { name: "Other plugin", enabled: false }] });
  const r = C.runChecks({ inputs, sf, ui: u, site });
  assert.equal(r.sfUpdates.find((x) => x.key === "mtPlugins").value, "R.O.EYE - Consent - SingleView");
});

test("website / landing page: same name on another country domain is fine, other domains are reported", () => {
  assert.equal(C.compareUrl("https://breggz.com/nl", "www.breggz.nl").result, "pass");
  assert.equal(C.compareUrl("https://brand.co.uk", "brand.com").result, "pass");
  const r = C.compareUrl("https://other.com", "brand.com");
  assert.equal(r.result, "review");
  const run2 = C.runChecks({ inputs, sf: { ...sf, landingPage: "www.breggz.nl" }, ui: (() => { const u = ui(); u.main.fields.landingPage = "https://breggz.com/nl"; return u; })(), site });
  assert.equal(row(run2, "Landing page").result, "pass");
  assert.equal(run2.changes.find((c) => c.target === "landingPage"), undefined);
});

test("Breggz case: domains from the UI, dedup from the append when the record is blank", () => {
  const u = ui();
  u.main.fields = { website: "https://breggz.com/nl", landingPage: "https://breggz.com/nl", awc: true, linkBuilder: true,
    append: "sv1=affiliate&sv_campaign_id=!!!id!!!&source=aw&utm_source=awin&utm_medium=affiliate&utm_campaign=breggz_nl_affilate", acceptedDomains: ["breggz.com"] };
  const recSf = { ...sf, website: null, landingPage: "www.breggz.nl", dedup: null, dedupParam: null, ecomPlatform: null };
  const shop = { checked: true, platform: "Shopify", evidence: ["meta.json"], others: [], domains: ["breggz-dc0shy6m.myshopify.com"] };
  const r = C.runChecks({ inputs: { ...inputs, analyticsParams: "&utm_source=awin&utm_medium=affiliate&utm_campaign=breggz_nl_affilate" }, sf: recSf, ui: u, site: shop });
  const domains = r.changes.filter((c) => c.target === "acceptedDomains").map((c) => c.to);
  assert.deepEqual(domains, ["breggz-dc0shy6m.myshopify.com"]); // not breggz.nl
  assert.equal(row(r, "Deduplication append").result, "pass");
  assert.equal(r.sfUpdates.find((x) => x.key === "dedupParam").value, "source");
  assert.equal(r.sfUpdates.find((x) => x.key === "channelParams").value, "aw");
  assert.equal(r.sfUpdates.find((x) => x.key === "ecomPlatform").value, "Shopify");
});

test("Fee manager: feeValueCtrl value against the tracking fee given", () => {
  const u = ui(); u.fees = page({ feeValue: "2.50", fees: [] });
  const r = C.runChecks({ inputs: { ...inputs, trackingFeeValue: "2.5" }, sf, ui: u, site });
  assert.equal(row(r, "Tracking fee").result, "pass");
  u.fees = page({ feeValue: "3", fees: [] });
  const r2 = C.runChecks({ inputs: { ...inputs, trackingFeeValue: "2.5" }, sf, ui: u, site });
  assert.equal(row(r2, "Tracking fee").result, "fail");
  assert.equal(r2.changes.length, C.runChecks({ inputs: { ...inputs, trackingFeeValue: "3" }, sf, ui: u, site }).changes.length); // never changed
});

test("Shopify domain too slow: *.myshopify.com whitelisted, listed for review", () => {
  const u = ui(); u.main.fields.acceptedDomains = ["brand.com"];
  const wild = { checked: true, platform: "Shopify", evidence: [], others: [], domains: ["*.myshopify.com"], wildcard: true, note: "internal Shopify domain not found within 25 s: *.myshopify.com whitelisted instead" };
  const r = C.runChecks({ inputs, sf, ui: u, site: wild });
  assert.deepEqual(r.changes.filter((c) => c.target === "acceptedDomains").map((c) => c.to), ["*.myshopify.com"]);
  assert.equal(row(r, "Shopify internal domain").result, "review");
  // once whitelisted, a myshopify domain counts as covered
  u.main.fields.acceptedDomains = ["brand.com", "*.myshopify.com"];
  const r2 = C.runChecks({ inputs, sf, ui: u, site: { ...wild, domains: ["brand-uk.myshopify.com"], wildcard: false } });
  assert.equal(r2.changes.filter((c) => c.target === "acceptedDomains").length, 0);
});

test("Shopify domain captured as a URL goes in as the host only", () => {
  const r = C.runChecks({ inputs, sf, ui: ui(), site: { ...site, domains: ["https://breggz-dc0shy6m.myshopify.com/"] } });
  assert.deepEqual(r.changes.filter((c) => c.target === "acceptedDomains").map((c) => c.to), ["breggz-dc0shy6m.myshopify.com"]);
  const P = require("../../review/lib/platforms.js");
  const doc = { body: { className: "" }, querySelector: () => null, querySelectorAll: () => [] };
  assert.deepEqual(P.detect({ Shopify: { shop: "https://Breggz-DC0SHY6M.myshopify.com/" } }, doc).domains, ["breggz-dc0shy6m.myshopify.com"]);
});

test("checklist items glued together (text without line breaks) are still split", () => {
  const p = C.parseChecklist("Base commission: Percentage 8Auto-approve publishers: NoValidation period in contract: 30Tracking fee: Percentage 30Platform Offer: Accelerate");
  assert.deepEqual(p.missing, []);
  assert.equal(p.inputs.autoApprove, false);
  assert.equal(p.inputs.validationDays, 30);
});

test("Deduplication Parameter = parameter name, Channel parameters implemented = value, from the append", () => {
  const mk = (append, rec) => { const u = ui(); u.main.fields.append = append; return C.runChecks({ inputs, sf: { ...sf, ...rec }, ui: u, site }); };
  const up = (r) => Object.fromEntries(r.sfUpdates.filter((x) => x.key).map((x) => [x.key, x.value]));
  // blank record: plugin (site platform) -> source first
  let r = mk("utm_source=awin&source=aw", { dedup: "", dedupParam: "", channelParams: "" });
  assert.equal(up(r).dedupParam, "source"); assert.equal(up(r).channelParams, "aw");
  // blank record: GTM / direct -> utm_source first
  r = mk("utm_source=awin&source=aw", { dedup: "", dedupParam: "", channelParams: "", dedupSolution: "GTM" });
  assert.equal(up(r).dedupParam, "utm_source"); assert.equal(up(r).channelParams, "awin");
  // customised name on the record, found in the append
  r = mk("sv1=x&ref_src=awin", { dedup: "Yes", dedupParam: "ref_src", channelParams: "" });
  assert.equal(row(r, "Deduplication append").result, "pass"); assert.equal(up(r).channelParams, "awin"); assert.equal(up(r).dedupParam, undefined);
  // old "source=aw" on the record -> fixed to the name only
  r = mk("source=aw", { dedup: "Yes", dedupParam: "source=aw", channelParams: "aw" });
  assert.equal(up(r).dedupParam, "source");
  // Salesforce first: the append has the parameter with another value -> to check, nothing changed
  r = mk("source=aw", { dedup: "Yes", dedupParam: "source", channelParams: "awin" });
  assert.equal(row(r, "Deduplication append").result, "review"); assert.equal(up(r).channelParams, undefined);
  assert.equal(r.changes.find((c) => c.target === "append"), undefined);
  // Salesforce has both and the append matches -> pass
  r = mk("utm_source=awin", { dedup: "Yes", dedupParam: "utm_source", channelParams: "awin" });
  assert.equal(row(r, "Deduplication append").result, "pass");
  // Salesforce has only the channel -> the pair with that value gives the parameter name
  r = mk("sv1=x&src=aw", { dedup: "Yes", dedupParam: "", channelParams: "aw" });
  assert.equal(up(r).dedupParam, "src");
  // the record's pair is missing in the append -> added to the UI
  r = mk("sv1=x", { dedup: "Yes", dedupParam: "utm_source", channelParams: "awin" });
  assert.equal(r.changes.find((c) => c.target === "append").to, "sv1=x&utm_source=awin");
});

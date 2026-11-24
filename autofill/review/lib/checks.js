// The Internal Review rules, as pure functions (no DOM, no chrome.*):
// - parseChecklist: contract inputs from the "Implementation Checklist" Chatter post
// - runChecks: check rows, the UI fixes to apply, Salesforce updates
// - chatterText: the short, fixed-template Chatter comment
(function (root) {
  const F = root.OIRFields || (typeof require !== "undefined" ? require("./fields.js") : null);

  // ---------- helpers ----------
  const blank = (v) => v === null || v === undefined || String(v).trim() === "";
  const str = (v) => (blank(v) ? "" : String(v).trim());
  const normUrl = (u) => str(u).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  const domainOf = (u) => { const n = normUrl(u); return n ? n.split(/[/?#]/)[0].split(":")[0] : ""; };
  function num(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const m = /-?\d+(?:[.,]\d+)?/.exec(str(v));
    return m ? Number(m[0].replace(",", ".")) : null;
  }
  const sameNum = (a, b) => num(a) !== null && num(a) === num(b);
  function yesNo(v) {
    const s = str(v).toLowerCase();
    if (/^(yes|true|on|enabled|active|1|sim|y)$/.test(s)) return true;
    if (/^(no|false|off|disabled|inactive|0|não|nao|n)$/.test(s)) return false;
    return null;
  }
  const onOff = (b) => (b === true ? "On" : b === false ? "Off" : "—");

  function compareUrl(uiVal, sfVal, opts = {}) {
    if (blank(uiVal)) return { result: "fail", action: "ui", note: "empty in the Awin UI" };
    if (blank(sfVal)) return { result: "review", action: "sf", note: "empty on the Implementation record" };
    if (!opts.shopify && /myshopify\.com|\/admin(\/|$)/i.test(str(uiVal) + " " + str(sfVal))) return { result: "review", action: "", note: "Shopify admin or myshopify.com URL used as the website" };
    const a = normUrl(uiVal), b = normUrl(sfVal);
    if (a === b) return { result: "pass", action: "", note: "" };
    if (domainOf(a) === domainOf(b)) return { result: "pass", action: "", note: `domain matches; path differs: ${a} vs ${b}` };
    // same name on another country domain (breggz.com/nl vs breggz.nl): the same site, not an error
    if (brandOf(a) && brandOf(a) === brandOf(b)) return { result: "pass", action: "", note: `same site on another domain: ${a} vs ${b}` };
    // really another domain: reported, never changed automatically
    return { result: "review", action: "integrator", note: `different domains: ${a} (Awin UI) vs ${b} (record)` };
  }
  // "www.breggz.co.uk" -> "breggz"
  function brandOf(u) {
    const parts = domainOf(u).split(".").filter(Boolean);
    if (parts.length < 2) return parts[0] || "";
    const two = parts.slice(-2).join(".");
    const sld = /^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(two);
    return parts[parts.length - (sld ? 3 : 2)] || "";
  }
  function offerName(v) {
    const s = str(v).toLowerCase();
    if (!s) return "";
    if (/access|offer\s*1\b|^1$/.test(s)) return "Access";
    if (/accelerate|offer\s*2\b|^2$/.test(s)) return "Accelerate";
    if (/advanced|offer\s*3\b|^3$/.test(s)) return "Advanced";
    return str(v);
  }
  const parseAppend = (s) => str(s).replace(/^[?&]+/, "").split("&").map((p) => p.trim()).filter(Boolean);
  const hasName = (pairs, name) => pairs.find((p) => p.split("=")[0] === name) || null;
  function parseAnalytics(s) {
    const raw = str(s);
    if (!raw) return { pairs: [], names: [], free: "" };
    const tokens = raw.split(/[&,\s]+/).map((t) => t.trim()).filter(Boolean);
    const anyPair = tokens.some((t) => t.includes("="));
    const pairs = [], names = [], free = [];
    for (const t of tokens) {
      if (t.includes("=")) pairs.push(t);
      else if (/^[a-z][a-z0-9_.-]*$/i.test(t) && (anyPair || t.includes("_"))) names.push(t);
      else free.push(t);
    }
    return { pairs, names, free: free.join(" ") };
  }
  const SHOPIFY_WILDCARD_TXT = "*.myshopify.com";
  const isShopifyText = (...vals) => vals.some((v) => /shopify/i.test(str(v)));

  // "Percentage 8", "8%", "8 %", "Fixed 5", "£5", "5 GBP" -> {type, value}
  function parseMoney(s) {
    const t = str(s);
    const value = num(t.replace(/(\d),(\d{3})/g, "$1$2"));
    let type = null;
    if (/%|percent/i.test(t)) type = "Percentage";
    else if (/fixed|flat|[£$€]|\b[A-Z]{3}\b/.test(t) || /fixed|flat/i.test(t)) type = "Fixed";
    return { type, value };
  }

  // ---------- contract inputs ----------
  // AutoSetup prototype: only the commission, the validation period and the Platform Offer are needed.
  // - Auto-approve is optional: without a contract value ("Implementation Checklist" post), publishers are
  //   approved manually, as the setup sets them.
  // - The tracking fee is optional: it is usually filled by default, so without it the fee isn't checked.
  // - The validation period can be the value the setup set in Awin (validationTarget) instead of the
  //   contract's days.
  const hasFee = (i) => !!i && /^(Percentage|Fixed)$/.test(i.trackingFeeType || "") && num(i.trackingFeeValue) !== null;
  function missingInputs(i) {
    const m = [];
    if (!i || !/^(Percentage|Fixed)$/.test(i.commissionType || "") || num(i.commissionValue) === null) m.push("Base commission");
    if (!i || (!(Number.isInteger(i.validationDays) && i.validationDays >= 0) && !Number.isInteger(i.validationTarget))) m.push("Validation period in contract");
    // the Offer drives the Access rules (validation + 7, no SingleView): from the setup note or the checklist
    if (!i || !/^(Access|Accelerate|Advanced)$/.test(i.offerOverride || "")) m.push("Platform Offer");
    return m;
  }
  function inputsLine(i) {
    i = i || {};
    const parts = [`Commission ${i.commissionType} ${i.commissionValue}`];
    parts.push(Number.isInteger(i.validationTarget)
      ? `Validation ${i.validationTarget} days as set${Number.isInteger(i.validationDays) ? ` (${i.validationDays} in the contract)` : ""}`
      : `Validation ${i.validationDays} days`);
    parts.push(typeof i.autoApprove === "boolean" ? `Auto-approve ${i.autoApprove ? "Yes" : "No"}` : "Manual approval (as the setup)");
    if (hasFee(i)) parts.push(`Tracking fee ${i.trackingFeeType} ${i.trackingFeeValue}`);
    if (i.offerOverride) parts.push(`Offer ${i.offerOverride}`);
    return parts.join(" · ");
  }

  // ---------- the setup's Chatter note (AutoSetup prototype): the source of truth ----------
  // New Implementation setup for MID 131530 (Accelerate)[, after a retry]
  //
  // Default commission group: Sale, Percentage, 8%[ (filled, not saved) | , but … needs a look | not set (…)]
  // Validation period: 37 days (30 + 7 for Access) | 30 days | -1 (0 days in the contract) | 45 days (already set, kept) | not set (…)
  //
  // Pages: 8 saved, 2 skipped.
  // [Needs a look: Plugin store (reason); …] [Not started: Fee manager, …]
  // Returns null for another post, else { mid, offer, inputs: {setupNote, offerOverride, commissionType,
  // commissionValue, validationTarget, validationDays?}, needsLook: [page], notStarted: [page] }.
  function parseSetupNote(text) {
    const t = str(text).replace(/\r/g, "");
    const head = F.SETUP_NOTE_TITLE.exec(t);
    if (!head) return null;
    const line = (label) => { const m = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]+)`, "i").exec(t); return m ? m[1].trim() : null; };
    const inputs = { setupNote: true };
    if (head[2]) inputs.offerOverride = offerName(head[2]);
    const com = line("Default commission group");
    if (com && !/^not set/i.test(com)) {
      const m = /(Percentage|Fixed)\s*,\s*(-?\d+(?:[.,]\d+)?)/i.exec(com);
      if (m) { inputs.commissionType = /^fix/i.test(m[1]) ? "Fixed" : "Percentage"; inputs.commissionValue = String(Number(m[2].replace(",", "."))); }
    }
    const val = line("Validation period");
    if (val && !/^not set/i.test(val)) {
      const set = /^(-?\d+)/.exec(val);
      if (set) inputs.validationTarget = Number(set[1]);
      const contract = /\((\d+) \+ 7 for Access\)|\((\d+) days in the contract\)/i.exec(val);
      if (contract) inputs.validationDays = Number(contract[1] || contract[2]);
      else if (set && !/already set/i.test(val) && Number(set[1]) >= 0) inputs.validationDays = Number(set[1]);
    }
    const pages = (label) => (line(label) || "").replace(/\.$/, "");
    const needsLook = pages("Needs a look").split(/;\s*/).map((p) => p.replace(/\s*\(.*$/, "").trim()).filter(Boolean);
    const notStarted = pages("Not started").split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    if (needsLook.length) inputs.setupNeedsLook = needsLook;
    if (notStarted.length) inputs.setupNotStarted = notStarted;
    return { mid: head[1] || "", offer: inputs.offerOverride || "", inputs, needsLook, notStarted };
  }

  // ---------- the record's marketing checklist (AutoSetup prototype): read first ----------
  // The same fields the setup reads: Platform Offer, Commission type with Commission Amount, and Auto
  // validation period. raw: { offer, commissionType, commissionAmount, validationPeriod }, as shown on
  // the record. Only what the record actually says is returned.
  function parseRecordChecklist(raw) {
    raw = raw || {};
    const inputs = {};
    const offer = offerName(raw.offer);
    if (/^(Access|Accelerate|Advanced)$/.test(offer)) inputs.offerOverride = offer;   // anything else: the backups say
    const type = /percent/i.test(str(raw.commissionType)) ? "Percentage" : /fix/i.test(str(raw.commissionType)) ? "Fixed" : "";
    const value = num(raw.commissionAmount);
    if (type && value !== null) { inputs.commissionType = type; inputs.commissionValue = String(value); }
    const days = /\d+/.exec(str(raw.validationPeriod));
    if (days) inputs.validationDays = Number(days[0]);
    if (Object.keys(inputs).length) inputs.recordChecklist = true;
    return { inputs, missing: missingInputs(inputs) };
  }

  // The inputs of a review, in this order: the record's marketing checklist (the same fields the setup
  // reads), then the setup note as the backup, then the "Implementation Checklist" post for what neither
  // says (publisher approval, the tracking fee). Differences are listed, so the panel can show them.
  function mergeInputs(checklistInputs, note, recordInputs) {
    const cl = checklistInputs || {};
    const sn = (note && note.inputs) || {};
    const rc = recordInputs || {};
    const inputs = Object.assign({}, cl, sn, rc);
    const differences = [];
    const sources = [[rc, "on the record", "the record's"], [sn, "in the setup note", "the setup note's"], [cl, "in the checklist post", ""]];
    const compare = (label, has, show, same) => {
      const found = sources.filter(([s]) => has(s));
      if (found.length < 2) return;
      const others = found.slice(1).filter(([s]) => !same(found[0][0], s));
      if (others.length) differences.push(`${label}: ${[found[0], ...others].map(([s, where]) => `${show(s)} ${where}`).join(", ")} (${found[0][2]} is used)`);
    };
    compare("Platform Offer", (s) => !!s.offerOverride, (s) => s.offerOverride, (a, b) => a.offerOverride === b.offerOverride);
    compare("Commission", (s) => !!s.commissionType, (s) => `${s.commissionType} ${s.commissionValue}`,
      (a, b) => a.commissionType === b.commissionType && sameNum(a.commissionValue, b.commissionValue));
    compare("Validation period", (s) => Number.isInteger(s.validationDays), (s) => `${s.validationDays} days`, (a, b) => a.validationDays === b.validationDays);
    // The value the setup set in Awin (validationTarget) stands, unless the record says otherwise: set under
    // another Platform Offer, or from other contract days, the record's rule applies instead.
    if (note && Number.isInteger(sn.validationTarget)) {
      const keptOnly = !Number.isInteger(sn.validationDays);   // Access, already set: kept as it was
      const otherOffer = !!(rc.offerOverride && sn.offerOverride && rc.offerOverride !== sn.offerOverride);
      const otherDays = Number.isInteger(rc.validationDays) && !keptOnly && rc.validationDays !== sn.validationDays;
      if (otherOffer || otherDays) delete inputs.validationTarget;
      // a kept value has no contract days: the checklist post's would only mislead (the record's are shown)
      else if (keptOnly && !Number.isInteger(rc.validationDays)) delete inputs.validationDays;
    }
    return { inputs, missing: missingInputs(inputs), differences };
  }

  // Reads the "Implementation Checklist" post: one "Label: value" per line.
  // Accepts ":", "=", " - ", "–", "|" or a tab between label and value.
  // One line per item, as posted. A post that arrives on one line ("Implementation Checklist
  // Base commission: Percentage 8 Analytics: Yes ...") is split before each known field name.
  function splitChecklist(text) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[- ]/g, "[-\\s]?");
    // before each field name, even when glued to the previous value ("Percentage 8Auto-approve…"),
    // but not inside a word or a URL/parameter ("utm_offer=…")
    const re = new RegExp(`(?<![A-Za-z_\\-=&/.])\\s*(?=(?:${F.CHECKLIST_LABELS.map(esc).join("|")})\\s*(?::|=|\\s[-–—|]\\s))`, "gi");
    // glued after a lowercase letter ("NoValidation period…"): split where the field name starts with a capital
    const camel = new RegExp(`(?<=[a-z])(?=(?:${F.CHECKLIST_LABELS.map((l) => esc(l[0].toUpperCase() + l.slice(1))).join("|")})\\s*(?::|=|\\s[-–—|]\\s))`, "g");
    return str(text).replace(/\r/g, "").split("\n").flatMap((l) => l.replace(re, "\n").replace(camel, "\n").split("\n"));
  }

  function parseChecklist(text) {
    const inputs = {};
    const lines = splitChecklist(text).map((l) => l.replace(/^[\s•\-*·▪◦]+/, "").trim()).filter(Boolean);
    const kv = lines.map((l) => {
      const m = /^(.{2,80}?)\s*(?::|=(?=\s)|\s[-–—|]\s|\t)\s*(.*)$/.exec(l);
      return m ? { k: m[1].toLowerCase(), v: m[2].trim() } : null;
    }).filter(Boolean);
    const take = (re, not) => { const e = kv.find((x) => re.test(x.k) && !(not && not.test(x.k))); return e ? e.v : null; };

    // tracking fee
    const feeType = take(/tracking fee.*(type|option)/);
    const feeVal = take(/tracking fee/, /type|option/);
    if (feeVal !== null || feeType) {
      const m = parseMoney([feeType, feeVal].filter(Boolean).join(" "));
      if (m.value !== null) { inputs.trackingFeeValue = String(m.value); inputs.trackingFeeType = m.type || (/fix/i.test(feeType || "") ? "Fixed" : "Percentage"); }
    }
    // commission
    const comType = take(/commission.*type/, /tracking/);
    const comVal = take(/commission/, /type|group(s)?\b(?!.*default)|tracking/);
    if (comVal !== null || comType) {
      const m = parseMoney([comType, comVal].filter(Boolean).join(" "));
      if (m.value !== null) { inputs.commissionValue = String(m.value); inputs.commissionType = m.type || (/fix/i.test(comType || "") ? "Fixed" : "Percentage"); }
    }
    // publisher approval
    const ap = take(/auto.?approv|publisher.*approv|approv.*publisher/);
    if (ap !== null) {
      const yn = yesNo(ap.split(/\s/)[0]);
      inputs.autoApprove = yn !== null ? yn : /auto/i.test(ap) ? true : /manual/i.test(ap) ? false : undefined;
      if (inputs.autoApprove === undefined) delete inputs.autoApprove;
    }
    // validation period
    const vp = take(/validation/);
    if (vp !== null && num(vp) !== null) inputs.validationDays = Math.round(num(vp));
    // offer (optional)
    const off = take(/offer/);
    if (off) inputs.offerOverride = offerName(off);

    return { inputs, missing: missingInputs(inputs) };
  }

  // ---------- the checks ----------
  // site: { checked, platform, evidence, others, domains, error } from lib/platforms.js
  function runChecks({ inputs, sf, ui, site, today }) {
    const checks = [], changes = [], sfUpdates = [], questions = [];
    const NAME = Object.fromEntries(F.PAGES.map((p) => [p.key, p.name]));
    NAME.site = "Advertiser site";
    NAME.setup = "Setup note";
    site = site || { checked: false, error: "not checked" };
    const add = (pageKey, check, uiVal, expected, result, note, action) =>
      checks.push({ area: NAME[pageKey], pageKey, check, ui: str(uiVal) || "—", expected: expected || "", result, note: note || "", action: action || "" });
    // verb: how the change reads in Chatter ("modified", "enabled", "added", ...)
    const change = (pageKey, field, target, from, to, verb, opts = {}) =>
      changes.push({ id: `${pageKey}:${target}:${to}`, pageKey, area: NAME[pageKey], field, target, from: str(from), to: str(to), verb,
        auto: opts.auto !== false, note: opts.note || "" });

    const offer = offerName(inputs.offerOverride);
    const isAccess = offer === "Access";
    const unreadable = (key) => {
      const p = ui[key];
      if (!p) return "page not read";
      if (p.signin) return "the Awin UI asked for a sign-in";
      if (!p.ok) return p.error || "page could not be read";
      if (p.idConfirmed === false) return "the page did not show this advertiser's ID";
      return null;
    };
    const skipAll = (key, names, why) => names.forEach((n) => add(key, n, "", "", "skipped", why, ""));
    const f = (key) => (ui[key] && ui[key].fields) || {};

    // ===== Main settings =====
    const mWhy = unreadable("main");
    if (mWhy) skipAll("main", ["Website", "Landing page", "Default Query String Append", "Awin Click ID (awc)", "Accepted domains", "Link Builder"], mWhy);
    else {
      const m = f("main");
      // Shopify stores: the setup puts the store's own myshopify address in the website, so the website
      // isn't compared with the record (the AutoSetup prototype's rule), and a myshopify address is fine.
      const shopifyStore = /myshopify\.com/i.test(str(m.website)) || (site && site.platform === "Shopify") || isShopifyText(sf.ecomPlatform, sf.otherEcomPlatform);
      for (const [label, k] of [["Website", "website"], ["Landing page", "landingPage"]]) {
        if (k === "website" && shopifyStore && !blank(m.website) && (!blank(sf.website) || /myshopify\.com/i.test(str(m.website)))) {
          // (a blank record website is still filled from the UI, unless the UI has the myshopify address)
          add("main", label, m.website, "", "pass", "Shopify store: not compared with the record (the setup uses the store's myshopify address)");
          continue;
        }
        const c = compareUrl(m[k], sf[k], { shopify: shopifyStore });
        if (c.action === "sf" && !blank(m[k])) {
          // blank on the record: filled in from the Awin UI
          add("main", label, m[k], "— (record)", "pass", "blank on the record: filled in from the Awin UI");
          sfUpdates.push({ key: k, field: label === "Website" ? "Program website" : "URL of Landing Page", value: str(m[k]), note: "from the Awin UI" });
          continue;
        }
        add("main", label, m[k], `${str(sf[k]) || "—"} (record)`, c.result, c.note, c.action);
        if (c.result === "fail" && !blank(sf[k])) change("main", label, k, m[k], sf[k], "modified");
      }

      const pairs = parseAppend(m.append);
      const missing = [];
      // Deduplication, always matched against the Default Query String Append:
      //   "utm_source=awin" -> Deduplication Parameter "utm_source", Channel parameters implemented "awin"
      //   "source=aw"       -> Deduplication Parameter "source",     Channel parameters implemented "aw"
      // Plugins usually use "source", GTM / direct integrations "utm_source"; customised names are taken as found.
      const DEDUP_NAMES = ["source", "utm_source", "src", "channel", "aff", "affiliate", "partner", "network"];
      const how = `${str(sf.dedupSolution)} ${str(sf.otherDedupSolution)}`.toLowerCase();
      const viaPlugin = /plugin|app|extension|module/.test(how) || (!/gtm|tag manager|direct|server|api/.test(how) && !!(site && site.platform));
      const preferred = /gtm|tag manager|direct|server|api/.test(how) ? ["utm_source", "source"] : viaPlugin ? ["source", "utm_source"] : ["source", "utm_source"];
      const split = (pair) => { const i = pair.indexOf("="); return i < 0 ? { name: pair, value: "" } : { name: pair.slice(0, i), value: pair.slice(i + 1) }; };
      const inAppend = (name) => pairs.map(split).find((x) => x.name.toLowerCase() === String(name).toLowerCase()) || null;
      const pickFromAppend = () => {
        for (const n of preferred) { const x = inAppend(n); if (x) return x; }
        const others = DEDUP_NAMES.filter((n) => !preferred.includes(n)).map(inAppend).filter(Boolean);
        return others.length === 1 ? others[0] : null;
      };
      // Salesforce first: the record says which pair it should be; the append is then checked against it.
      // (The record may still hold the old "name=value" form: the field keeps the name only.)
      const rec = split(str(sf.dedupParam));
      const recName = rec.name;
      const recChannel = str(sf.channelParams) || rec.value;
      const dedupOff = yesNo(sf.dedup) === false;
      const fixNameFormat = () => { if (rec.value) sfUpdates.push({ key: "dedupParam", field: "Deduplication Parameter", value: recName, note: `was "${str(sf.dedupParam)}": the field holds the parameter name only` }); };
      const fillChannel = (value) => {
        if (value && blank(sf.channelParams)) sfUpdates.push({ key: "channelParams", field: "Channel parameters implemented", value, note: "value of the dedup pair in the Default Query String Append" });
      };
      // AutoSetup prototype: with a setup note, the query string the setup wrote is the truth. When the
      // record names another dedup pair (often the checklist's default, source / aw), the record follows
      // the append instead of the append being changed (e.g. Access without a platform: utm_source=awin).
      const fromSetup = !!inputs.setupNote;
      const followAppend = (x, why) => {
        add("main", "Deduplication append", m.append, `${x.name}=${x.value} (the setup's query string)`, "pass", why);
        if (str(sf.dedupParam) !== x.name) sfUpdates.push({ key: "dedupParam", field: "Deduplication Parameter", value: x.name, note: "the dedup pair in the setup's query string" });
        if (str(sf.channelParams) !== x.value) sfUpdates.push({ key: "channelParams", field: "Channel parameters implemented", value: x.value, note: "the dedup pair in the setup's query string" });
      };
      const setupPair = fromSetup && !dedupOff ? pickFromAppend() : null;
      const recordPairInAppend = recName && recChannel && inAppend(recName) && inAppend(recName).value === recChannel;
      if (setupPair && recName && !recordPairInAppend) {
        followAppend(setupPair, `the record said ${recName}${recChannel ? "=" + recChannel : ""}: the record is updated to the setup's ${setupPair.name}=${setupPair.value}`);
      } else if (dedupOff) {
        add("main", "Deduplication", m.append, "set up (record)", "fail",
          "Deduplication is No on the record" + (isShopifyText(sf.ecomPlatform, sf.otherEcomPlatform) ? ". On Shopify this is simple to activate." : ""), "integrator");
      } else if (recName && recChannel) {
        // 1. the record has both: the append must hold exactly name=channel
        const found = inAppend(recName);
        const want = `${recName}=${recChannel}`;
        if (found && found.value === recChannel) add("main", "Deduplication append", m.append, `${want} (Salesforce)`, "pass");
        else if (found) add("main", "Deduplication append", `${found.name}=${found.value}`, `${want} (Salesforce)`, "review",
          `the append has ${found.name}=${found.value}, Salesforce says ${want}: not changed (it may be a customisation)`, "integrator");
        else { add("main", "Deduplication append", m.append, `${want} (Salesforce)`, "fail", `no ${recName}= in the append`, "ui"); missing.push(want); }
        fixNameFormat();
        if (blank(sf.channelParams) && rec.value) fillChannel(rec.value);
      } else if (recName) {
        // 2. only the parameter name: its value in the append is the channel
        const found = inAppend(recName);
        if (found) { add("main", "Deduplication append", m.append, `${recName} (Salesforce)`, "pass", `${found.name}=${found.value}`); fillChannel(found.value); }
        else {
          const other = pickFromAppend();
          add("main", "Deduplication append", m.append, `${recName} (Salesforce)`, other ? "review" : "fail",
            other ? `Salesforce says ${recName}, the append uses ${other.name}=${other.value}` : `no ${recName}= in the append and no channel on the record`, "integrator");
        }
        fixNameFormat();
      } else if (recChannel) {
        // 3. only the channel: the append's pair with that value gives the parameter name
        const hits = pairs.map(split).filter((x) => x.value === recChannel);
        const x = hits.length === 1 ? hits[0] : hits.find((h) => preferred.includes(h.name.toLowerCase()));
        if (x) {
          add("main", "Deduplication append", m.append, `?=${recChannel} (Salesforce)`, "pass", `${x.name}=${x.value}: Deduplication Parameter ${x.name}`);
          sfUpdates.push({ key: "dedupParam", field: "Deduplication Parameter", value: x.name, note: `the append's pair with the record's channel (${recChannel})` });
        } else add("main", "Deduplication append", m.append, `?=${recChannel} (Salesforce)`, "review", `no pair with the value ${recChannel} in the append`, "integrator");
      } else {
        // 4. nothing on the record: take the pair the append really uses
        const x = pickFromAppend();
        if (x) {
          add("main", "Deduplication append", m.append, "— (Salesforce blank)", "pass", `the append has ${x.name}=${x.value}: Deduplication Parameter ${x.name}, Channel parameters implemented ${x.value}`);
          sfUpdates.push({ key: "dedupParam", field: "Deduplication Parameter", value: x.name, note: "parameter name of the dedup pair in the Default Query String Append" });
          fillChannel(x.value);
        } else {
          add("main", "Deduplication", m.append, "— (Salesforce blank)", "review", "no dedup pair (source=, utm_source=…) in the Default Query String Append", "integrator");
        }
      }
      if (missing.length) {
        const next = [str(m.append).replace(/^[?&]+/, ""), ...missing].filter(Boolean).join("&");
        change("main", "Default Query String Append", "append", m.append, next, "modified");
      }

      if (m.awc === true) add("main", "Awin Click ID (awc)", "On", "On", "pass");
      else if (m.awc === false) { add("main", "Awin Click ID (awc)", "Off", "On", "fail", "", "ui"); change("main", "Awin Click ID", "awc", "Off", "On", "enabled"); }
      else add("main", "Awin Click ID (awc)", "", "On", "skipped", "could not read the switch");

      // platform-specific domains, e.g. Shopify's *.myshopify.com
      const platformDomains = (site.domains || []).map(domainOf).filter(Boolean);
      // the domains the Awin UI really uses; a record domain only when it is another site
      // (www.breggz.nl on the record vs breggz.com/nl in the UI is the same site)
      const expected = [];
      for (const d of [domainOf(m.website), domainOf(m.landingPage)]) if (d && !expected.includes(d)) expected.push(d);
      for (const d of [domainOf(sf.website), domainOf(sf.landingPage)]) {
        if (d && !expected.some((e) => e === d || brandOf(e) === brandOf(d))) expected.push(d);
      }
      for (const pd of platformDomains) if (!expected.includes(pd)) expected.push(pd);
      const accepted = (m.acceptedDomains || []).map(domainOf).filter(Boolean);
      const covers = (d) => accepted.some((a) => a === d || (a.startsWith("*.") && d.endsWith(a.slice(1))));
      if (!m.acceptedDomains) add("main", "Accepted domains", "", expected.join(", "), "skipped", "could not read the accepted domains");
      else for (const d of expected) {
        const ok = covers(d);
        add("main", `Accepted domain ${d}`, accepted.join(", "), d, ok ? "pass" : "fail", "", ok ? "" : "ui");
        if (!ok) change("main", "Accepted domain", "acceptedDomains", "", d, "added");
      }
      if (site.wildcard) add("main", "Shopify internal domain", SHOPIFY_WILDCARD_TXT, "<shop>.myshopify.com", "review", site.note || "", "integrator");
      if (site.checked && site.platform === "Shopify" && !platformDomains.length) {
        add("main", "Shopify domain", "", "*.myshopify.com", "review", site.note || "the site is Shopify but its myshopify domain could not be read", "integrator");
      }

      const sfLb = yesNo(sf.linkBuilder);
      if (m.linkBuilder === null || m.linkBuilder === undefined) add("main", "Link Builder", "", onOff(sfLb), "skipped", "could not read the switch");
      else if (sfLb === null) {
        add("main", "Link Builder", onOff(m.linkBuilder), "— (record)", "pass", "blank on the record: filled in from the Awin UI");
        sfUpdates.push({ key: "linkBuilder", field: "Link Builder Activated", value: m.linkBuilder ? "Yes" : "No", note: "from the Awin UI" });
      }
      else if (sfLb === m.linkBuilder) add("main", "Link Builder", onOff(m.linkBuilder), onOff(sfLb), "pass");
      else add("main", "Link Builder", onOff(m.linkBuilder), `${onOff(sfLb)} (record)`, "review", "UI and record differ: not changed automatically", "integrator");
    }

    // ===== Advertiser site: eCommerce platform =====
    const flat = (v) => str(v).toLowerCase().replace(/[^a-z0-9]/g, "");
    const sfPlat = str(sf.ecomPlatform) && !/^other$/i.test(str(sf.ecomPlatform)) ? str(sf.ecomPlatform) : str(sf.otherEcomPlatform);
    if (!site.checked) add("site", "eCommerce platform", "", sfPlat || "—", "skipped", site.error || "site not checked");
    else if (!site.platform) add("site", "eCommerce platform", "no platform signs", sfPlat || "—", sfPlat ? "review" : "skipped",
      sfPlat ? "could not confirm the record's platform on the site" : "no platform signs on the site", sfPlat ? "integrator" : "");
    else {
      const same = sfPlat && (flat(sfPlat).includes(flat(site.platform)) || flat(site.platform).includes(flat(sfPlat)));
      const why = (site.evidence || []).slice(0, 2).join(", ") + (site.others && site.others.length ? `; also signs of ${site.others.map((o) => o.name).join(", ")}` : "");
      if (same) add("site", "eCommerce platform", site.platform, `${sfPlat} (record)`, "pass", why);
      else if (!sfPlat) {
        add("site", "eCommerce platform", site.platform, "— (record)", "pass", `blank on the record: filled in from the site (${why})`);
        sfUpdates.push({ key: "ecomPlatform", field: "eCommerce platform", value: site.platform, note: `detected on the site (${why})` });
      } else add("site", "eCommerce platform", site.platform, `${sfPlat} (record)`, "review", `site and record differ: ${why}`, "integrator");
    }

    // ===== Commission groups =====
    const cWhy = unreadable("commission");
    if (cWhy) add("commission", "Default commission", "", "", "skipped", cWhy);
    else {
      const groups = f("commission").groups || [];
      const def = groups.find((g) => /^default/i.test(str(g.name)));
      const want = `${inputs.commissionType} ${inputs.commissionValue}`;
      if (!def) add("commission", "Default commission", "no DEFAULT group", want, "fail", "", "integrator");
      else if (def.value === null || def.value === undefined) add("commission", "Default commission", def.raw || "unreadable", want, "skipped", "DEFAULT row found but its rate could not be read");
      else {
        const shown = `${def.type || "?"} ${def.value ?? "?"}`;
        const ok = def.type === inputs.commissionType && sameNum(def.value, inputs.commissionValue);
        // reported, not changed: the commission grid (ag-grid) has no automatic edit yet
        add("commission", "Default commission", shown, `${want} (checklist)`, ok ? "pass" : "fail", ok ? "" : "not changed automatically", ok ? "" : "integrator");
      }
    }

    // ===== MasterTag plugins =====
    const pWhy = unreadable("plugins");
    if (!offer) add("plugins", "SingleView plugin", "", "", "review", "Platform Offer is blank", "integrator");
    else if (isAccess) add("plugins", "SingleView plugin", "", "", "skipped", "not required for Access");
    else if (pWhy) add("plugins", "SingleView plugin", "", "enabled", "skipped", pWhy);
    else {
      const sv = (f("plugins").plugins || []).find((p) => /singleview/i.test(str(p.name)));
      if (!sv) add("plugins", "SingleView plugin", "not listed", "enabled", "fail", "", "integrator");
      else if (sv.enabled === true) add("plugins", "SingleView plugin", "enabled", "enabled", "pass");
      else if (sv.enabled === false) { add("plugins", "SingleView plugin", "disabled", "enabled", "fail", "", "ui"); change("plugins", "SingleView plugin", "singleView", "Off", "On", "enabled"); }
      else add("plugins", "SingleView plugin", "unknown", "enabled", "skipped", "could not read the switch");
    }

    // MT plugins activated (Salesforce): the plugins enabled in the Awin UI
    if (!pWhy) {
      const on = (f("plugins").plugins || []).filter((p) => p.enabled === true).map((p) => str(p.name)).filter(Boolean);
      if (on.length) sfUpdates.push({ key: "mtPlugins", field: "MT plugins activated", value: on.join(", "), note: "enabled in MasterTag plugins" });
    }

    // ===== Fee manager (checked, not changed: needs an effective date) =====
    const fWhy = unreadable("fees");
    const feeWant = `${inputs.trackingFeeType} ${inputs.trackingFeeValue}`;
    if (!hasFee(inputs)) add("fees", "Tracking fee", "", "", "skipped", "not given: filled by default");
    else if (fWhy) add("fees", "Tracking fee", "", feeWant, "skipped", fWhy);
    else if ("feeValue" in f("fees") && f("fees").feeValue !== undefined && !(f("fees").fees || []).length) {
      // Fee manager: the value of input[formcontrolname=feeValueCtrl] against the tracking fee given
      const v = f("fees").feeValue;
      if (blank(v)) add("fees", "Tracking fee", "empty", feeWant, "fail", "the fee value field is empty", "integrator");
      else {
        const ok = sameNum(v, inputs.trackingFeeValue);
        add("fees", "Tracking fee", v, `${inputs.trackingFeeValue} (checklist)`, ok ? "pass" : "fail", ok ? "" : "not changed automatically", ok ? "" : "integrator");
      }
    }
    else {
      const t = today || new Date().toISOString().slice(0, 10);
      const tracking = (f("fees").fees || []).filter((x) => /tracking/i.test(str(x.name)));
      const cur = tracking.find((x) => (!x.from || x.from <= t) && (!x.to || x.to >= t)) || tracking[0];
      if (!cur) add("fees", "Tracking fee", "none", feeWant, num(inputs.trackingFeeValue) === 0 ? "pass" : "fail", "", "integrator");
      else {
        const ok = cur.type === inputs.trackingFeeType && sameNum(cur.value, inputs.trackingFeeValue);
        add("fees", "Tracking fee", `${cur.type || "?"} ${cur.value ?? "?"}`, `${feeWant} (checklist)`, ok ? "pass" : "fail", ok ? "" : "fees are not changed automatically", ok ? "" : "integrator");
      }
    }
    if (hasFee(inputs) && !blank(sf.trackingFee) && !sameNum(sf.trackingFee, inputs.trackingFeeValue)) {
      add("fees", "Tracking fee vs Opportunity", `${str(sf.trackingFeeOption)} ${str(sf.trackingFee)}`, feeWant, "review", "checklist and Opportunity differ", "integrator");
    }

    // ===== Pending transactions: voucher and custom parameters =====
    const vWhy = unreadable("validate");
    if (vWhy) add("validate", "Test transaction", "", "", "skipped", vWhy);
    else {
      const txs = f("validate").transactions || [];
      if (!txs.length) add("validate", "Test transaction", "none pending", "1 or more", "review", "no pending transaction: voucher and parameters not checked", "integrator");
      else {
        const voucher = txs.some((x) => x.voucher);
        const params = Array.from(new Set(txs.flatMap((x) => x.params || []))).filter((p) => !F.CORE_PARAMS.includes(p.toLowerCase()));
        add("validate", "Test transaction", `${txs.length} pending`, "", "pass", txs.map((x) => x.ref).filter(Boolean).join(", "));
        add("validate", "Voucher used", voucher ? "Yes" : "No", "", "pass");
        add("validate", "Custom parameters", params.join(", ") || "none", "", "pass");
        sfUpdates.push({ key: "voucherTracking", field: "Voucher Tracking implemented", value: voucher ? "Yes" : "No", note: "from the pending test transaction" });
        // value "" = no custom parameters (No on a picklist; left alone on a text field)
        sfUpdates.push({ key: "customParameters", field: "Custom parameters implemented", value: params.join(", "), note: "from the pending test transaction" });
      }
    }

    // ===== Tracking diagnosis =====
    const wWhy = unreadable("wizard");
    if (wWhy) add("wizard", "Test transaction tracked", "", "", "skipped", wWhy);
    else {
      const n = f("wizard").transactionDetails || 0;
      if (n && blank(sf.trackingTestDate)) {
        sfUpdates.push({ key: "trackingTestDate", field: "Successful Tracking Test", value: today || new Date().toISOString().slice(0, 10), note: "test transaction tracked" });
      }
      add("wizard", "Test transaction tracked", n ? `${n} transaction(s)` : "none", "1 or more", n ? "pass" : "fail", n ? "" : "no transaction details in Tracking diagnosis", n ? "" : "integrator");
    }

    // ===== Mobile tracking =====
    const moWhy = unreadable("mobile");
    if (moWhy) add("mobile", "Strategy implemented", "", "On", "skipped", moWhy);
    else {
      const s = f("mobile").strategy;
      if (typeof s !== "boolean") add("mobile", "Strategy implemented", "", "On", "skipped", "field not found");
      else if (s) add("mobile", "Strategy implemented", "On", "On", "pass");
      else { add("mobile", "Strategy implemented", "Off", "On", "fail", "", "ui"); change("mobile", "Mobile tracking strategy", "strategy", "Off", "On", "enabled"); }
    }

    // ===== Pre-join publishers =====
    const jWhy = unreadable("prejoin");
    for (const id of F.TEST_PUBLISHERS) {
      const name = `Test publisher ${id}`;
      if (jWhy) { add("prejoin", name, "", "Active", "skipped", jWhy); continue; }
      const p = (f("prejoin").publishers || []).find((x) => str(x.id) === id);
      if (!p) add("prejoin", name, "not listed", "Active", "fail", "not in the pre-join form", "integrator");
      else if (/^active$/i.test(str(p.status))) add("prejoin", name, p.status, "Active", "pass");
      else { add("prejoin", name, p.status || "unknown", "Active", "fail", "", "ui"); change("prejoin", `Test publisher ${id}`, "publisher", p.status, id, "invited"); }
    }

    // ===== Migrated advertiser settings =====
    const V = inputs.validationDays;
    // the setup note's value, as the setup set it in Awin, comes first (the source of truth)
    const setDays = Number.isInteger(inputs.validationTarget) ? inputs.validationTarget : null;
    const expDays = setDays !== null ? setDays : !offer || !Number.isInteger(V) ? null : isAccess ? V + 7 : V === 0 ? -1 : V;
    const rule = setDays !== null ? `as the setup set it${Number.isInteger(V) ? ` (${V} days in the contract)` : ""}`
      : !offer ? "" : isAccess ? `Access: ${V} + 7` : V === 0 ? "not Access, 0 days: -1" : `not Access: ${V}`;
    const gWhy = unreadable("migrated");
    if (gWhy) skipAll("migrated", ["Validation Period Days", "Manual approval"], gWhy);
    else {
      const g = f("migrated");
      if (expDays === null) add("migrated", "Validation Period Days", g.validationDays, "", "review", "Platform Offer is blank", "integrator");
      else if (blank(g.validationDays)) add("migrated", "Validation Period Days", "", String(expDays), "skipped", "field not found");
      else {
        const ok = sameNum(g.validationDays, expDays);
        add("migrated", "Validation Period Days", g.validationDays, String(expDays), ok ? "pass" : "fail", rule, ok ? "" : "ui");
        if (!ok) change("migrated", "Validation Period Days", "validationDays", g.validationDays, String(expDays), "modified", { note: rule });
      }
      // manual unless the contract ("Implementation Checklist" post) says auto-approve: as the setup sets it
      const wantManual = inputs.autoApprove !== true;
      const approvalFrom = typeof inputs.autoApprove === "boolean" ? "checklist" : "as the setup";
      if (typeof g.manualApproval !== "boolean") add("migrated", "Manual approval", "", onOff(wantManual), "skipped", "field not found");
      else if (g.manualApproval === wantManual) add("migrated", "Manual approval", onOff(g.manualApproval), onOff(wantManual), "pass");
      else { add("migrated", "Manual approval", onOff(g.manualApproval), `${onOff(wantManual)} (${approvalFrom})`, "fail", "", "ui"); change("migrated", "Manual approval", "manualApproval", onOff(g.manualApproval), onOff(wantManual), wantManual ? "enabled" : "disabled"); }
    }
    if (!blank(sf.validationPeriod) && !sameNum(sf.validationPeriod, V)) {
      add("migrated", "Validation period vs Signed Product", str(sf.validationPeriod), String(V), "review", "checklist and Signed Product differ", "integrator");
    }

    // ===== Test transactions: deleted after everything else was read =====
    const tWhy = unreadable("testtx");
    if (tWhy) add("testtx", "Test transactions", "", "deleted", "skipped", tWhy);
    else {
      const rows = f("testtx").rows || [];
      if (!rows.length) add("testtx", "Test transactions", "none", "none left", "pass");
      else {
        add("testtx", "Test transactions", `${rows.length} found`, "none left", "fail", rows.map((r) => r.ref).filter(Boolean).join(", "), "ui");
        change("testtx", "Test transactions", "deleteTestTx", rows.map((r) => r.ref).filter(Boolean).join(", "), "", "deleted");
      }
    }

    // ===== The setup note: its pages the review doesn't check itself =====
    for (const page of F.SETUP_ONLY_PAGES || []) {
      const why = (inputs.setupNeedsLook || []).includes(page) ? "needed a look in the setup" : (inputs.setupNotStarted || []).includes(page) ? "not started by the setup" : "";
      if (why) add("setup", `Setup: ${page}`, "", "", "review", why, "integrator");
    }

    return { checks, changes, sfUpdates, questions, offer };
  }

  // ---------- Chatter comment: fixed template, short ----------
  // "Default Query String Append modified [x] | OK", "Test publisher 111 invited | OK",
  // "Test transactions deleted [ref1, ref2] | OK", "To check: Tracking fee Percentage 25 (expected Percentage 30)"
  function changeLine(c, a) {
    const status = a ? (a.verified ? "OK" : `FAILED (${a.error || "not verified"})`) : "NOT DONE";
    let text;
    switch (c.verb) {
      case "modified": text = `${c.field} modified [${c.to}]`; break;
      case "added": text = `${c.field} added [${c.to}]`; break;
      case "set to level": text = `${c.field} set to level ${c.to}`; break;
      case "invited": text = `${c.field} invited`; break;
      case "deleted": text = `${c.field} deleted [${(a && a.refs && a.refs.join(", ")) || c.from || "—"}]`; break;
      default: text = `${c.field} ${c.verb}`;
    }
    return `${text} | ${status}`;
  }

  // Only what was adjusted (OK / FAILED) and what needs a person (CHECK / To check).
  // What was already right is not listed.
  function chatterText(run) {
    const plan = run.plan || { changes: [] };
    const r = run.result || { checks: [] };
    const applied = run.applied || [];
    const done = [], review = [];
    for (const c of plan.changes) {
      const a = applied.find((x) => x.id === c.id);
      if (a && a.verified && a.noop) continue; // was already right: nothing adjusted
      (a && a.verified ? done : review).push(changeLine(c, a));
    }
    if (run.sfUpdate) {
      const s = run.sfUpdate;
      if (s.ok && s.set && s.set.length) done.push(`Salesforce updated: ${s.set.join(", ")} | OK`);
      if (!s.ok) review.push(`Salesforce update | FAILED (${s.error || "unknown"})`);
      if (s.problem && s.problem.length) review.push(`Salesforce: ${s.problem.join("; ")} | CHECK`);
    }
    const get = (page, check) => r.checks.find((c) => c.pageKey === page && c.check === check);
    const tracked = get("wizard", "Test transaction tracked");
    if (tracked && tracked.result === "fail") review.push("Test transaction not found in Tracking diagnosis | CHECK");
    if ((get("validate", "Test transaction") || {}).result === "review") review.push("No pending test transaction | CHECK");
    // UI fails have their own OK/FAILED line above; list only what needs a person
    for (const c of r.checks.filter((x) => (x.result === "fail" || x.result === "review") && x.action !== "ui" && !["wizard", "validate"].includes(x.pageKey))) {
      review.push(`To check: ${c.check} ${c.ui}${c.expected ? ` (expected ${c.expected})` : ""}${c.note ? ` · ${c.note}` : ""}`);
    }
    const skipped = r.checks.filter((c) => c.result === "skipped" && !/not required|filled by default/.test(c.note));
    if (skipped.length) review.push(`Not checked: ${skipped.map((c) => c.check).join(", ")}`);
    const L = [`Internal Review | MID ${run.awinId} | Optimus IR v${run.version}`, ...done, ...review];
    if (!done.length && !review.length) L.push("Nothing to adjust, nothing to review.");
    return L.join("\n");
  }

  const api = { runChecks, chatterText, parseChecklist, parseSetupNote, parseRecordChecklist, mergeInputs, missingInputs, inputsLine, compareUrl, normUrl, domainOf, num, yesNo, offerName, parseAppend, parseAnalytics, parseMoney };
  root.OIRChecks = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

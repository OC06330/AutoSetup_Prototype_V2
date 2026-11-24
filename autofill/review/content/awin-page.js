// Injected by background.js into an Awin UI tab (chrome.scripting.executeScript).
// scrape(key, id): reads one page. apply(change, id): makes one fix and saves.
// describe(): the page's structure (labels, ids, columns, buttons; no values) for fixing selectors.
// Never clicks Delete/Reset, except the test transaction rows on the Test transactions page.
(function () {
  if (window.OIRPage) return;
  const F = window.OIRFields;
  const A = F.AWIN;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // mouse down/up/click, as a person would (some Angular handlers listen to mousedown)
  const realClick = (el) => ["mousedown", "mouseup", "click"].forEach((type) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
  const L_info = (...a) => { try { console.info("[Optimus IR] [awin page]", ...a); } catch (e) { /* none */ } };
  const L_warn = (...a) => { try { console.warn("[Optimus IR] [awin page]", ...a); } catch (e) { /* none */ } };

  // ---------- basics ----------
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const norm = (s) => String(s || "").replace(/\s+/g, " ").replace(/[*:?]+\s*$/, "").trim().toLowerCase();
  const txt = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "");
  const CONTROL = 'input:not([type="hidden"]), select, textarea, [role="switch"], [role="checkbox"], [role="radio"], [contenteditable="true"]';
  const LABELISH = "label, legend, th, dt, h1, h2, h3, h4, h5, h6, strong, b, span, p, div, td, mat-label, [class*='label' i], [class*='title' i]";
  const BAD = /delete|remove|reset|cancel|discard|clear/i;

  async function waitFor(fn, ms = 15000, every = 300) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch (e) { /* page mid-render */ }
      await sleep(every);
    }
    return null;
  }
  function signinShown() {
    if (/login\.microsoftonline|id\.awin\.com|\/login|\/sso|signin/i.test(location.href)) return true;
    return Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
  }
  // AutoSetup prototype: a page whose own sign of being drawn shows is ready even if the browser still
  // says it's loading (Awin's pages can keep loading something for a long time), and a page without that
  // sign is taken as it is after 12 s, once it has text and no spinner, instead of waiting the full 30 s
  // (which, with the load wait, ran Main settings past its 60 s limit: "no answer after 60 s").
  async function pageReady(extraTest) {
    const drawn = () => { try { return !!(extraTest && extraTest()); } catch (e) { return false; } };
    await waitFor(() => document.readyState === "complete" || drawn() || signinShown(), 30000);
    const t0 = Date.now();
    await waitFor(() => {
      if (signinShown()) return true;
      // the page's own sign of being drawn is enough (grids keep "loading" overlays around)
      if (drawn()) return true;
      const spinning = Array.from(document.querySelectorAll('[class*="spinner" i], [class*="loading" i], [role="progressbar"]')).some(visible);
      return txt(document.body).length > 150 && !spinning && (!extraTest || Date.now() - t0 > 12000);
    }, 30000, 400);
    await sleep(500);
  }
  // Visible error messages (form validation, alerts)
  function pageErrors() {
    return Array.from(document.querySelectorAll('.alert-danger, .alert-error, .has-error .help-block, .invalid-feedback, .form-error, .error-message, ul.errors li, [role="alert"]'))
      .filter(visible).map(txt).filter((t) => t && t.length < 300).slice(0, 5);
  }

  // first element for a list of selectors; prefers a checkbox/select/radio over a hidden twin
  function q(list, scope = document) {
    for (const sel of list) {
      let all;
      try { all = Array.from(scope.querySelectorAll(sel)); } catch (e) { continue; }
      if (!all.length) continue;
      return all.find((e) => e.type === "checkbox" || e.type === "radio" || e.tagName === "SELECT") || all.find((e) => e.type !== "hidden") || all[0];
    }
    return null;
  }

  // ---------- labels and controls ----------
  function findLabel(aliases, scope = document) {
    const want = aliases.map(norm);
    let best = null;
    for (const el of scope.querySelectorAll(LABELISH)) {
      // cheap first: a label is short (its rendered text is computed only for short elements; doing it for
      // every div of a big page made a single read take tens of seconds)
      const raw = el.textContent;
      if (!raw || raw.length > 400 || !raw.trim()) continue;
      if (!visible(el)) continue;
      const t = norm(txt(el));
      if (!t || t.length > 90 || !want.includes(t)) continue;
      if (!best || best.contains(el)) best = el;
    }
    return best;
  }
  function controlFor(label) {
    if (!label) return null;
    if (label.htmlFor) { const el = document.getElementById(label.htmlFor); if (el) return el; }
    if (label.id) { const el = document.querySelector(`[aria-labelledby~="${CSS.escape(label.id)}"]`); if (el) return el; }
    const inner = label.querySelector(CONTROL);
    if (inner) return inner;
    let node = label;
    for (let i = 0; i < 5 && node.parentElement; i++) {
      node = node.parentElement;
      const next = Array.from(node.querySelectorAll(CONTROL))
        .filter((c) => visible(c) || visible(c.closest('[role="switch"], label, mat-slide-toggle, mat-checkbox')))
        .find((c) => label.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (next) return next;
    }
    return null;
  }
  function radioGroup(c) {
    if (c.name) return Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(c.name)}"]`));
    const g = c.closest('[role="radiogroup"], fieldset, mat-radio-group') || c.parentElement.parentElement;
    return Array.from(g.querySelectorAll('input[type="radio"], [role="radio"]'));
  }
  const radioLabel = (r) => txt(r.closest("label, mat-radio-button, [role='radio']") || (r.id && document.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.parentElement) || r.value;
  function readControl(c) {
    if (!c) return null;
    const role = c.getAttribute("role");
    if (c.type === "checkbox") return !!c.checked;
    if (role === "switch" || role === "checkbox") return c.getAttribute("aria-checked") === "true";
    if (c.type === "radio" || role === "radio") {
      const on = radioGroup(c).find((r) => r.checked || r.getAttribute("aria-checked") === "true");
      return on ? radioLabel(on) : "";
    }
    if (c.tagName === "SELECT") return c.selectedOptions[0] ? txt(c.selectedOptions[0]) : "";
    if (c.isContentEditable) return txt(c);
    return c.value;
  }
  function readByLabel(aliases) {
    const l = findLabel(aliases);
    if (!l) return { found: false, value: null };
    const c = controlFor(l);
    if (c) return { found: true, value: readControl(c), control: c, label: l };
    const rest = l.parentElement ? txt(l.parentElement).replace(txt(l), "").trim() : "";
    return { found: true, value: rest || null, label: l };
  }
  const toBool = (r) => (typeof r.value === "boolean" ? r.value : !r.found ? null
    : /\b(on|yes|enabled|active|true)\b/i.test(String(r.value)) ? true : /\b(off|no|disabled|inactive|false)\b/i.test(String(r.value)) ? false : null);

  // ---------- tables ----------
  function parseTable(t) {
    const headRow = t.querySelector("thead tr") || t.querySelector("tr");
    const headers = headRow ? Array.from(headRow.children).map((c) => norm(txt(c))) : [];
    const rows = Array.from(t.querySelectorAll("tbody tr, tr")).filter((r) => r !== headRow && !r.querySelector("th"))
      .map((r) => ({ el: r, cells: Array.from(r.children).map(txt), cellEls: Array.from(r.children) }))
      .filter((r) => r.cells.some(Boolean) && !/no (data|results|records|transactions)/i.test(r.cells.join(" ")));
    return { el: t, headers, rows };
  }
  // ag-grid (Commission groups, Fee manager...): no <table>; cells carry col-id and rows
  // are split between pinned and centre containers, joined here by row-index
  function agTables() {
    const out = [];
    for (const g of document.querySelectorAll(".ag-root, .ag-root-wrapper")) {
      if (out.some((o) => o.el.contains(g))) continue;
      const cols = [], headers = [];
      for (const h of g.querySelectorAll(".ag-header-cell[col-id]")) {
        const id = h.getAttribute("col-id");
        if (cols.includes(id)) continue;
        cols.push(id);
        headers.push(norm(txt(h.querySelector(".ag-header-cell-text") || h) || id));
      }
      const byIdx = new Map();
      for (const r of g.querySelectorAll(".ag-row[row-index], [role='row'][row-index]")) {
        const idx = r.getAttribute("row-index");
        if (!byIdx.has(idx)) byIdx.set(idx, { el: r, cells: {}, els: {} });
        for (const c of r.querySelectorAll("[col-id]")) {
          byIdx.get(idx).cells[c.getAttribute("col-id")] = txt(c.querySelector(".ag-cell-value") || c);
          byIdx.get(idx).els[c.getAttribute("col-id")] = c;
        }
      }
      const rows = Array.from(byIdx.values())
        .map((r) => ({ el: r.el, cells: cols.map((c) => r.cells[c] || ""), cellEls: cols.map((c) => r.els[c] || r.el) }))
        .filter((r) => r.cells.some(Boolean));
      out.push({ el: g, headers: headers.map((h, i) => h + " " + norm(cols[i])), rows, ag: true });
    }
    return out;
  }
  function tables() {
    const out = Array.from(document.querySelectorAll("table")).filter(visible).map(parseTable).concat(agTables());
    for (const g of document.querySelectorAll('[role="table"], [role="grid"]')) {
      if (!visible(g) || g.tagName === "TABLE") continue;
      const headers = Array.from(g.querySelectorAll('[role="columnheader"]')).map((c) => norm(txt(c)));
      const rows = Array.from(g.querySelectorAll('[role="row"]')).filter((r) => !r.querySelector('[role="columnheader"]'))
        .map((r) => { const cellEls = Array.from(r.querySelectorAll('[role="cell"], [role="gridcell"]')); return { el: r, cells: cellEls.map(txt), cellEls }; })
        .filter((r) => r.cells.some(Boolean));
      out.push({ el: g, headers, rows });
    }
    return out;
  }
  const col = (headers, re) => headers.findIndex((h) => re.test(h));
  function money(s) {
    const t = String(s || "");
    const m = /-?\d+(?:[.,]\d+)?/.exec(t.replace(/(\d),(\d{3})/g, "$1$2"));
    let type = null;
    if (/%|percent/i.test(t)) type = "Percentage";
    else if (/[£$€]|\b[A-Z]{3}\b|fixed|flat/i.test(t)) type = "Fixed";
    return { value: m ? Number(m[0].replace(",", ".")) : null, type };
  }
  function isoDate(s) {
    const t = String(s || "").trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(t);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const d = Date.parse(t);
    return Number.isNaN(d) ? "" : new Date(d).toISOString().slice(0, 10);
  }

  // ---------- tooltips (custom parameters on pending transactions) ----------
  const TIP_ATTRS = ["data-original-title", "data-bs-original-title", "title", "data-content", "data-bs-content", "data-tooltip", "mattooltip", "ng-reflect-message", "aria-label"];
  const tipText = (el) => TIP_ATTRS.map((a) => el.getAttribute(a)).filter(Boolean).join("\n");
  async function hoverText(el) {
    ["mouseenter", "mouseover", "focus"].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true })));
    await sleep(350);
    const tip = Array.from(document.querySelectorAll('[role="tooltip"], .tooltip, .popover, .mat-mdc-tooltip, .mat-tooltip, .cdk-overlay-container')).filter(visible).map((e) => e.innerText || e.textContent || "").join("\n");
    ["mouseleave", "mouseout", "blur"].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true })));
    await sleep(100);
    return tip;
  }
  // "p1=app<br>parts=DEFAULT:10" or "p1: app, p2: x" -> ["p1", "parts"] (key of each piece only)
  function paramNames(text) {
    const pieces = String(text).split(/<br\s*\/?>|\n|&(?!amp;|lt;|gt;)|[,;|]|\s+(?=[A-Za-z][\w.\-]*\s*[=:])/i).map((s) => s.trim()).filter(Boolean);
    const sep = pieces.some((p) => /^[A-Za-z][\w.\-[\]]{0,40}\s*=/.test(p)) ? "=" : ":";
    return pieces.map((p) => (new RegExp(`^([A-Za-z][\\w.\\-[\\]]{0,40})\\s*${sep}`).exec(p) || [])[1]).filter(Boolean).map((n) => n.replace(/\[\]$/, ""));
  }

  // ---------- Test transactions ----------
  // #merchantId = MID, then #formprovidertesttransactionssearch; each transaction is a <tr>
  // in tableHeader. One row: its .deleteTestTransaction; several: #delete-all.
  // The search and the deletions reload the page, so background.js drives the steps.
  function ttRows(mid) {
    let rows = [];
    for (const sel of A.testtx.rows) {
      try { rows = Array.from(document.querySelectorAll(sel)); } catch (e) { rows = []; }
      rows = rows.filter((r) => !r.querySelector("th") && r.querySelector("td") && !/no (data|results|records|transactions)/i.test(txt(r)));
      if (rows.length) break;
    }
    return rows.map((r) => {
      const table = r.closest("table");
      const headers = table ? Array.from(table.querySelectorAll("thead th, tr:first-child th")).map((h) => norm(txt(h))) : [];
      const cells = Array.from(r.children).map(txt);
      const refCol = col(headers, /order ?ref|reference|\bref\b/);
      const advCol = col(headers, /advertiser|merchant|\bmid\b/);
      return {
        el: r,
        ref: refCol >= 0 ? cells[refCol] : cells.find((c) => c && !new RegExp(`^${mid}$`).test(c) && !/^\d{1,2}[/.-]/.test(c)) || cells[0],
        mine: advCol < 0 || new RegExp(`\\b${mid}\\b`).test(cells[advCol] || "")
      };
    });
  }
  function ttSearch(mid) {
    const input = q(A.testtx.midInput) || q(A.testtx.midFallback);
    if (!input) return { ok: false, error: "MID field (#merchantId) not found on Test transactions" };
    setValue(input, String(mid));
    const go = q(A.testtx.search);
    if (!go) return { ok: false, error: "search button (#formprovidertesttransactionssearch) not found" };
    // after we return: the search may reload the page
    setTimeout(() => {
      if (go.tagName === "FORM") { go.requestSubmit ? go.requestSubmit() : go.submit(); }
      else go.click();
    }, 100);
    return { ok: true, submitted: true };
  }
  async function ttRead(mid) {
    // results may come by Ajax: give the rows a moment
    await waitFor(() => ttRows(mid).length || /no (data|results|records|transactions)/i.test(txt(document.body)), 6000, 300);
    const input = q(A.testtx.midInput) || q(A.testtx.midFallback);
    return {
      searched: !input || input.value === String(mid) || location.href.includes(String(mid)),
      rows: ttRows(mid).filter((r) => r.mine).map((r) => ({ ref: r.ref }))
    };
  }
  async function ttDelete(mid) {
    const rows = ttRows(mid);
    const mine = rows.filter((r) => r.mine);
    if (!mine.length) return { ok: true, remaining: 0, refs: [] };
    if (mine.length !== rows.length) return { ok: false, error: "the search shows rows of another advertiser: nothing deleted" };
    let btn;
    if (rows.length === 1) btn = rows[0].el.querySelector(A.testtx.deleteOne);
    else btn = q(A.testtx.deleteAll);
    if (!btn) return { ok: false, error: rows.length === 1 ? "no .deleteTestTransaction on the row" : "no #delete-all button", remaining: rows.length };
    const refs = mine.map((r) => r.ref);
    btn.click();
    // confirmations: #popup_ok (after Delete all) or a modal with a Delete/OK button.
    // Native confirm() is answered by background.js. Up to 3 in a row.
    for (let i = 0; i < 3; i++) {
      const next = await waitFor(() => { const ok = q(A.testtx.popupOk); return (ok && isButton(ok) && ok) || openDialog(); }, 2500, 200);
      if (!next) break;
      if (next.matches && next.matches(A.testtx.popupOk.join(","))) { next.click(); await sleep(600); continue; }
      const yes = Array.from(next.querySelectorAll('button, [role="button"], input[type="submit"], a.btn'))
        .find((b) => isButton(b) && (/^(delete|yes|confirm|ok|remove)\b/i.test(btnText(b)) || b.matches(A.testtx.popupOk.join(","))));
      if (!yes) return { ok: false, error: `unexpected dialog ("${txt(next).slice(0, 100)}")`, remaining: rows.length };
      yes.click();
      await sleep(600);
    }
    await sleep(1500);
    return { ok: true, refs, clicked: rows.length === 1 ? "deleteTestTransaction" : "delete-all" };
  }

  // ---------- page readers ----------
  const DOMAIN_RE = /(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}/gi;
  // the accepted domains shown as tags: document.getElementsByClassName('tag')[i].innerText
  // the accepted domains: one div.tags per domain; its text minus the "x" of a.deleteTag.close
  const tagEls = () => { for (const sel of A.main.domainTag) { const els = Array.from(document.querySelectorAll(sel)); if (els.length) return els; } return []; };
  const tagText = (t) => {
    const c = t.cloneNode(true);
    c.querySelectorAll("a.deleteTag, .close, button").forEach((x) => x.remove());
    return (c.textContent || "").replace(/[×✕x]\s*$/i, "").trim().toLowerCase();
  };
  const domainTags = () => tagEls().map(tagText).filter(Boolean);
  const hasTag = (host) => domainTags().some((t) => t === host || t.split(/\s+/).includes(host));
  function domainSection() {
    const l = findLabel(A.main.acceptedDomains) || q(A.main.newDomain);
    if (!l) return null;
    let node = l;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      node = node.parentElement;
      const text = Array.from(node.querySelectorAll("*"))
        .filter((e) => !e.children.length && e !== l && !/^(BUTTON|SCRIPT|STYLE)$/.test(e.tagName) && !e.closest("button") && !e.matches(A.main.newDomain.join(",")))
        .map((e) => (e.tagName === "INPUT" || e.tagName === "TEXTAREA" ? e.value : e.textContent)).join(" ");
      if ((text.match(DOMAIN_RE) || []).length) return { label: l, box: node, text };
    }
    return { label: l, box: l.parentElement, text: "" };
  }
  function singleViewSwitch() {
    const el = Array.from(document.querySelectorAll("body *")).filter((e) => visible(e) && e.children.length < 3 && A.plugins.singleView.test(txt(e)) && txt(e).length < 120)
      .sort((a, b) => txt(a).length - txt(b).length)[0];
    if (!el) return { el: null, c: null };
    let node = el;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      node = node.parentElement;
      const c = node.querySelector('input[type="checkbox"], [role="switch"], [role="checkbox"]');
      if (c) return { el, c };
    }
    return { el, c: null, box: node };
  }
  // AutoSetup (live page): a publisher not yet pre-joined has a tick box whose value is its id; one
  // already pre-joined has none. Without any status dropdown on the page, that is how it is read.
  const publisherBox = (scope, id) => Array.from(scope.querySelectorAll('input[type="checkbox"]')).find((b) => b.value === id) || null;
  function prejoinRows() {
    const form = q(A.prejoin.form);
    const scope = form || document;
    const out = [];
    const tickBoxes = !scope.querySelector("select") && !!form;
    for (const id of F.TEST_PUBLISHERS) {
      const box = publisherBox(scope, id);
      if (box || tickBoxes) {
        out.push(box ? { id, status: box.checked ? "Ticked" : "Not pre-joined", box, row: box.closest("tr, li, label, div") || box }
          : { id, status: "Active", note: "already pre-joined (no tick box)" });
        continue;
      }
      const re = new RegExp(`(^|\\D)${id}(\\D|$)`);
      const row = Array.from(scope.querySelectorAll("tr, li, .row, fieldset, [class*='publisher' i]"))
        .filter((r) => re.test(txt(r)) && (r.querySelector("select, input") || /status/i.test(txt(r))))
        .sort((a, b) => txt(a).length - txt(b).length)[0];
      if (!row) continue;
      const sel = row.querySelector("select");
      const radios = Array.from(row.querySelectorAll('input[type="radio"]'));
      let status = "";
      if (sel) status = sel.selectedOptions[0] ? txt(sel.selectedOptions[0]) : "";
      else if (radios.length) { const on = radios.find((r) => r.checked); status = on ? radioLabel(on) : ""; }
      else status = (txt(row).match(/\b(active|pending|rejected|suspended|inactive|invited|not ?joined|left)\b/i) || [""])[0];
      out.push({ id, status: status.trim(), row, sel, radios });
    }
    return { form, rows: out };
  }
  // manual approval: its id, or (AutoSetup, live page) the select labelled "Approval of Publishers Joining"
  const approvalControl = () => q(A.migrated.manualApproval) || readByLabel(A.migrated.approvalLabels || []).control || null;
  function migratedValidation() {
    const el = q(A.migrated.validationDays);
    if (el && /INPUT|SELECT/.test(el.tagName)) return el;
    const r = readByLabel(A.migrated.validationLabels);
    return r.control || null;
  }
  // #strategy-implemented: configured when it has checked="checked" (or is checked now). Fallback (AutoSetup,
  // live page): the radio name="strategy" labelled "Tracking is implemented on mobile site", on when checked.
  const strategyOn = (el) => (el.type === "radio" ? el.checked === true : el.checked === true || el.getAttribute("checked") === "checked" || el.hasAttribute("checked"));
  const mobileStrategy = () => q(A.mobile.strategy) || Array.from(document.querySelectorAll(`input[type="radio"][name="${A.mobile.strategyRadio}"]`)).find((r) => A.mobile.strategyLabel.test(radioLabel(r).trim())) || null;
  // A select whose options say what they mean ("Manual Approval" / "Auto Approval", as on the live
  // Advertiser settings page): the text decides, whatever the option values are (AutoSetup prototype)
  const manualText = (t) => (/manual/i.test(t) ? true : /\bauto/i.test(t) ? false : null);
  function boolOf(el) {
    if (!el) return null;
    if (el.type === "checkbox") return el.checked;
    if (el.tagName === "SELECT" && el.selectedOptions[0] && manualText(el.selectedOptions[0].text) !== null) return manualText(el.selectedOptions[0].text);
    if (el.tagName === "SELECT") return /^(1|yes|true|on|manual)/i.test(el.value) || /^(yes|true|on|manual)/i.test(readControl(el)) ? true : /^(0|no|false|off|auto)/i.test(el.value) || /^(no|false|off|auto)/i.test(readControl(el)) ? false : null;
    if (el.type === "radio") { const on = radioGroup(el).find((r) => r.checked); return on ? /^(1|yes|true|on|manual)/i.test(on.value + " " + radioLabel(on)) : null; }
    return null;
  }

  function agDefaultCommission() {
    for (const sc of document.querySelectorAll(A.commission.bottom.join(","))) {
      const cell = Array.from(sc.querySelectorAll(".ag-cell-value")).find((c) => /^default$/i.test(txt(c)));
      if (!cell) continue;
      const row = cell.closest('[role="row"], .ag-row');
      const idx = row && row.getAttribute("row-index");
      const area = sc.closest(".ag-floating-bottom") || sc;
      // the row can be split between the pinned and the centre part: match by row-index
      const rateEl = (row && q(A.commission.rate, row)) ||
        (idx !== null && idx !== undefined && Array.from(area.querySelectorAll(`[row-index="${idx}"]`)).map((r) => q(A.commission.rate, r)).find(Boolean)) ||
        q(A.commission.rate, area);
      if (!rateEl) return { name: "DEFAULT", type: null, value: null, raw: "rate cell not found" };
      const text = txt(rateEl.querySelector(".ag-cell-value") || rateEl);
      const m = money(text);
      return { name: "DEFAULT", type: m.type || "Percentage", value: m.value, raw: text };
    }
    return null;
  }

  const readers = {
    main() {
      const L = A.main;
      const f = {};
      for (const k of ["website", "landingPage", "append"]) f[k] = readByLabel(L[k]).value;
      const wid = q(L.websiteId);
      if (wid) f.website = wid.value;
      // the ids AutoSetup found on the live page come first
      for (const k of ["landingPage", "append"]) { const el = q((L.ids || {})[k] || []); if (el) f[k] = el.value; }
      for (const k of ["awc", "linkBuilder"]) f[k] = toBool(readByLabel(L[k]));
      const lb = q((L.ids || {}).linkBuilder || []);
      if (lb && lb.type === "checkbox") f.linkBuilder = !!lb.checked;
      const sec = domainSection();
      const fromTags = domainTags().flatMap((t) => t.match(DOMAIN_RE) || []).map((d) => d.toLowerCase());
      f.acceptedDomains = sec || fromTags.length ? Array.from(new Set([...(sec ? sec.text.match(DOMAIN_RE) || [] : []).map((d) => d.toLowerCase()), ...fromTags])) : null;
      return f;
    },
    commission() {
      // ag-grid first: .ag-floating-bottom-viewport, the row whose .ag-cell-value is "Default",
      // then its rate.publisherCommission cell's .ag-cell-value
      const d = agDefaultCommission();
      if (d) return { groups: [d], source: "ag-grid" };
      const groups = [];
      for (const t of tables()) {
        const nameCol = Math.max(0, col(t.headers, /group|name/));
        const valCol = col(t.headers, /commission|sale|rate|value|amount/);
        const typeCol = col(t.headers, /type/);
        for (const r of t.rows) {
          const name = r.cells[nameCol];
          const m = money(valCol >= 0 ? r.cells[valCol] : r.cells.find((c) => /%|[£$€]|\d/.test(c) && c !== name) || "");
          const tc = r.cells[typeCol] || "";
          groups.push({ name, type: /fixed/i.test(tc) ? "Fixed" : /percent/i.test(tc) ? "Percentage" : m.type, value: m.value });
        }
      }
      return { groups };
    },
    plugins() {
      // the plugins table: name = <strong> in td .d-flex.items-center.gap-1; a listed plugin is active
      // unless its row has a switch that is off
      const named = Array.from(document.querySelectorAll(A.plugins.names)).filter((e) => txt(e));
      if (named.length) {
        const list = [];
        for (const el of named) {
          const name = txt(el);
          const row = el.closest("tr");
          const sw = row && row.querySelector('input[type="checkbox"], [role="switch"]');
          if (!list.some((p) => p.name === name)) list.push({ name, enabled: sw ? readControl(sw) : true });
        }
        return { plugins: list };
      }
      // every plugin with a switch: its name is the first line of the block that holds only that switch
      const STATUS = /^(on|off|enabled|disabled|active|inactive|yes|no|activate|deactivate)$/i;
      const plugins = [];
      for (const c of Array.from(document.querySelectorAll('input[type="checkbox"], [role="switch"]'))) {
        let box = c, node = c;
        for (let i = 0; i < 7 && node.parentElement; i++) {
          node = node.parentElement;
          if (node.querySelectorAll('input[type="checkbox"], [role="switch"]').length > 1) break;
          box = node;
        }
        const name = (box.innerText || box.textContent || "").split("\n").map((x) => x.trim()).find((x) => x && !STATUS.test(x) && x.length < 120);
        if (name && !plugins.some((p) => p.name === name)) plugins.push({ name, enabled: readControl(c) });
      }
      // no switches: a table or list with a status column
      if (!plugins.length) for (const t of tables()) {
        const nameCol = Math.max(0, col(t.headers, /plugin|name/));
        const stCol = col(t.headers, /status|state|enabled|active/);
        for (const r of t.rows) plugins.push({ name: r.cells[nameCol], enabled: stCol >= 0 ? /enabled|active|on|yes/i.test(r.cells[stCol]) : null });
      }
      const sv = singleViewSwitch();
      if (sv.el && !plugins.some((p) => A.plugins.singleView.test(p.name))) plugins.push({ name: txt(sv.el), enabled: sv.c ? readControl(sv.c) : null });
      return { plugins };
    },
    async fees() {
      // the tracking fee value: input[formcontrolname=feeValueCtrl] (Angular fills it a little late)
      const input = q(A.fees.value);
      if (input) {
        await waitFor(() => String(input.value).trim(), 8000, 250);
        return { feeValue: String(input.value).trim() || null, fees: [] };
      }
      const fees = [];
      for (const t of tables()) {
        const nameCol = Math.max(0, col(t.headers, /fee|type|name|description/));
        const valCol = col(t.headers, /value|amount|rate|percent/);
        const fromCol = col(t.headers, /from|start|effective|valid/);
        const toCol = col(t.headers, /\bto\b|end|until|expir/);
        for (const r of t.rows) {
          const v = money(valCol >= 0 ? r.cells[valCol] : r.cells.slice(1).join(" "));
          fees.push({ name: r.cells[nameCol], type: v.type, value: v.value, from: fromCol >= 0 ? isoDate(r.cells[fromCol]) : "", to: toCol >= 0 ? isoDate(r.cells[toCol]) : "" });
        }
      }
      return { fees };
    },
    async validate() {
      const transactions = [];
      for (const t of tables()) {
        const refCol = col(t.headers, /order ?ref|reference|\bref\b/);
        const vcCol = col(t.headers, /voucher/);
        const pubCol = col(t.headers, /publisher/);
        const parCol = col(t.headers, /param|custom/);
        if (refCol < 0 && vcCol < 0) continue;
        for (const r of t.rows) {
          const voucherText = vcCol >= 0 ? r.cells[vcCol] : "";
          const scope = parCol >= 0 ? r.cellEls[parCol] : r.el;
          let text = Array.from(scope.querySelectorAll("*")).map(tipText).join("\n") + "\n" + (parCol >= 0 ? r.cells[parCol] : "");
          if (!paramNames(text).length) {
            const icons = Array.from(scope.querySelectorAll("i, svg, mat-icon, [class*='icon' i], [class*='info' i], [class*='param' i]")).filter(visible).slice(0, 6);
            for (const ic of icons) text += "\n" + (await hoverText(ic));
          }
          transactions.push({
            ref: refCol >= 0 ? r.cells[refCol] : "",
            publisher: pubCol >= 0 ? r.cells[pubCol] : "",
            voucher: !!voucherText && !/^[-–—]?$|^(none|n\/a|no)$/i.test(voucherText.trim()),
            params: Array.from(new Set(paramNames(text)))
          });
        }
      }
      return { transactions };
    },
    wizard() {
      return { transactionDetails: document.querySelectorAll(A.wizard.details).length };
    },
    mobile() {
      const s = mobileStrategy();
      return { strategy: s ? strategyOn(s) : null };
    },
    prejoin() {
      const p = prejoinRows();
      return { formFound: !!p.form, publishers: p.rows.map((r) => ({ id: r.id, status: r.status })) };
    },
    migrated() {
      const v = migratedValidation();
      const m = approvalControl();
      return { validationDays: v ? String(v.value) : null, manualApproval: boolOf(m) };
    },
    testtx: (mid) => ttRead(mid)
  };

  const readyTest = {
    // the ids the setup found on the live page first (the labels may not match word for word)
    main: () => q(A.main.websiteId) || q((A.main.ids || {}).append || []) || findLabel(A.main.append) || findLabel(A.main.website),
    commission: () => agDefaultCommission() || tables().some((t) => t.rows.length),
    plugins: () => /plugin/i.test(txt(document.body)),
    fees: () => q(A.fees.value) || agTables().some((t) => t.rows.length) || Array.from(document.querySelectorAll("table")).some((t) => t.querySelector("td")) || /no fees/i.test(txt(document.body)),
    validate: () => tables().length || /no (pending )?transactions/i.test(txt(document.body)),
    wizard: () => document.querySelector(A.wizard.details) || /transaction/i.test(txt(document.body)),
    mobile: () => mobileStrategy(),
    prejoin: () => q(A.prejoin.form) || /publisher/i.test(txt(document.body)),
    migrated: () => approvalControl() || migratedValidation(),
    testtx: () => q(A.testtx.midInput) || q(A.testtx.midFallback) || document.querySelector("form")
  };

  async function scrape(key, mid) {
    await pageReady(readyTest[key]);
    if (signinShown()) return { ok: false, signin: true, url: location.href };
    if (key === "wizard") {
      await waitFor(() => document.querySelector(A.wizard.details), 8000); // Angular draws it late
      if (!document.querySelector(A.wizard.details)) {
        // the transactions may sit behind "Show recent transactions"
        const show = Array.from(document.querySelectorAll('button, a, [role="button"]')).find((b) => visible(b) && /recent transactions/i.test(btnText(b)));
        if (show) { show.click(); await waitFor(() => document.querySelector(A.wizard.details), 10000); }
      }
    }
    if (key === "plugins") await waitFor(() => A.plugins.singleView.test(txt(document.body)), 5000);
    const idConfirmed = key === "testtx" || location.href.includes(String(mid)) || txt(document.body).includes(String(mid));
    try {
      return { ok: true, idConfirmed, url: location.href, errors: pageErrors(), fields: await readers[key](mid) };
    } catch (e) {
      return { ok: false, url: location.href, error: "could not read the page: " + e.message };
    }
  }

  // ---------- applying ----------
  function setValue(el, v) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    ["input", "change", "blur"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  }
  const clickable = (c) => (c.type === "checkbox" && !visible(c) ? c.closest('[role="switch"], label, mat-slide-toggle, mat-checkbox') || (c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`)) || c : c);
  const isButton = (b) => visible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true";
  const btnText = (b) => (txt(b) || b.value || b.getAttribute("aria-label") || b.getAttribute("title") || "").trim();
  const openDialog = () => Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], mat-dialog-container, .modal.show, .modal.in, .cdk-overlay-pane')).find(visible);

  function setBool(el, want) {
    if (el.tagName === "SELECT") {
      const opt = Array.from(el.options).find((o) => manualText(o.text) === want)
        || Array.from(el.options).find((o) => (want ? /^(1|yes|true|on|manual)/i : /^(0|no|false|off|auto)/i).test(o.value + " " + o.text.trim()));
      if (!opt) return false;
      setValue(el, opt.value);
      return true;
    }
    if (el.type === "radio") {
      const r = radioGroup(el).find((x) => (want ? /^(1|yes|true|on|manual)/i : /^(0|no|false|off|auto)/i).test(x.value + " " + radioLabel(x)));
      if (!r) return false;
      if (!r.checked) clickable(r).click();
      return true;
    }
    if (readControl(el) !== want) clickable(el).click();
    if (readControl(el) !== want && el.type === "checkbox") { el.checked = want; el.dispatchEvent(new Event("change", { bubbles: true })); }
    return readControl(el) === want;
  }

  // Save: in a server-rendered form, click its submit button after we return (the page
  // navigates); in a single-page app, click Save and watch for a dialog.
  function saveButtonNear(el) {
    let node = el;
    for (let i = 0; i < 10 && node; i++, node = node.parentElement) {
      const b = Array.from(node.querySelectorAll('button, [role="button"], input[type="submit"]'))
        .find((x) => isButton(x) && /^(save|update|apply|submit)\b/i.test(btnText(x)) && !BAD.test(btnText(x)));
      if (b) return b;
    }
    const all = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .filter((x) => isButton(x) && /^(save|update|submit)\b/i.test(btnText(x)) && !BAD.test(btnText(x)));
    return all.length === 1 ? all[0] : null;
  }
  async function save(near) {
    const form = near.form || near.closest("form");
    if (form && form.method && /post/i.test(form.method)) {
      const b = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])'))
        .find((x) => isButton(x) && !BAD.test(btnText(x))) || saveButtonNear(near);
      setTimeout(() => (b ? b.click() : form.requestSubmit ? form.requestSubmit() : form.submit()), 150);
      return { ok: true, navigating: true };
    }
    const b = saveButtonNear(near);
    if (!b) return { ok: false, error: "no Save button found for this section" };
    b.click();
    await sleep(1500);
    const d = openDialog();
    if (d) return { ok: false, needsInput: true, error: `the page asked for more input ("${txt(d).slice(0, 120)}")` };
    const errs = pageErrors();
    if (errs.length) return { ok: false, retryable: true, error: errs.join("; ") };
    return { ok: true };
  }

  async function editDefaultCommission(change) {
    const [type, value] = change.to.split(" ");
    const row = tables().flatMap((t) => t.rows).find((r) => /^default/i.test(r.cells[0] || ""));
    if (!row) return { ok: false, error: "DEFAULT group not found" };
    const edit = Array.from(row.el.querySelectorAll('button, a, [role="button"]')).find((b) => /edit|pencil/i.test(btnText(b) + " " + b.className));
    if (!edit) return { ok: false, error: "no Edit button on the DEFAULT group" };
    edit.click();
    const scope = await waitFor(() => openDialog() || row.el.querySelector("input"), 6000) || document;
    await sleep(500);
    const dateField = Array.from(scope.querySelectorAll('input[type="date"], input[name*="date" i], input[id*="date" i]')).find((i) => visible(i) && i.required && !i.value);
    if (dateField) return { ok: false, needsInput: true, error: "the page asks for an effective date" };
    const typeSel = Array.from(scope.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => /percent|fixed/i.test(o.text)));
    if (typeSel) setValue(typeSel, Array.from(typeSel.options).find((o) => new RegExp(type.slice(0, 5), "i").test(o.text)).value);
    const typeRadio = Array.from(scope.querySelectorAll('input[type="radio"]')).find((r) => new RegExp(type.slice(0, 5), "i").test(radioLabel(r)));
    if (typeRadio && !typeRadio.checked) clickable(typeRadio).click();
    const input = Array.from(scope.querySelectorAll('input[type="number"], input[name*="commission" i], input[name*="rate" i], input[name*="value" i], input[name*="amount" i]')).find(visible);
    if (!input) return { ok: false, error: "commission value field not found" };
    setValue(input, value);
    const b = Array.from(scope.querySelectorAll('button, [role="button"], input[type="submit"]')).find((x) => isButton(x) && /^(save|update|apply|confirm)\b/i.test(btnText(x)));
    if (!b) return { ok: false, error: "no Save button in the commission editor" };
    b.click();
    await sleep(2000);
    const errs = pageErrors();
    return errs.length ? { ok: false, error: errs.join("; ") } : { ok: true };
  }

  // Main settings: every change of the page in one go, then ONE submit (button.btn.btn-default).
  // Domains: #newValidDomain + its .input-group-text. Returns one result per change.
  async function applyMain(changes) {
    const M = A.main;
    const results = [];
    let changed = false;
    const t0 = Date.now();
    window.__oirTrace = [];
    const trace = (m) => { window.__oirTrace.push(`+${Date.now() - t0} ms ${m}`); };
    trace(`start: ${changes.length} change(s): ${changes.map((c) => c.target + "=" + c.to).join(", ")}`);
    for (const c of changes) {
      try {
        if (["website", "landingPage", "append"].includes(c.target)) {
          const el = (c.target === "website" && q(M.websiteId)) || readByLabel(M[c.target]).control;
          if (!el || !/INPUT|TEXTAREA/.test(el.tagName)) { results.push({ id: c.id, ok: false, error: `${c.field}: field not found` }); continue; }
          if (el.value.trim() === c.to) { results.push({ id: c.id, ok: true, noop: true }); continue; }
          setValue(el, c.to); changed = true; results.push({ id: c.id, ok: true });
          trace(`${c.target}: ${results[results.length - 1] && results[results.length - 1].ok ? "set" : "not set"}`);
        } else if (c.target === "awc") {
          const el = readByLabel(M.awc).control;
          if (!el) { results.push({ id: c.id, ok: false, error: "Awin Click ID switch not found" }); continue; }
          if (readControl(el) === true) { results.push({ id: c.id, ok: true, noop: true }); continue; }
          if (!setBool(el, true)) { results.push({ id: c.id, ok: false, error: "Awin Click ID switch did not change" }); continue; }
          changed = true; results.push({ id: c.id, ok: true });
        } else if (c.target === "acceptedDomains") {
          const hostWanted = String(c.to).trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
          const sec0 = domainSection();
          const listedAlready = sec0 && (sec0.text.match(DOMAIN_RE) || []).map((d) => d.toLowerCase()).includes(hostWanted);
          if (hasTag(hostWanted) || listedAlready) { trace(`${hostWanted}: already accepted`); results.push({ id: c.id, ok: true, noop: true, how: "already accepted" }); continue; }
          trace("waiting for newValidDomain");
          const input = q(M.newDomain) || await waitFor(() => q(M.newDomain), 8000); // Angular may draw it late
          trace(input ? "newValidDomain found" : "newValidDomain NOT found");
          if (!input) { results.push({ id: c.id, ok: false, error: "the newValidDomain field was not found on Main settings" }); continue; }
          const block = input.closest(M.domainBlock.join(",")) || input.closest(".input-group") || input.parentElement;
          const hostOnly = String(c.to).trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
          input.focus();
          setValue(input, hostOnly); // no quotes, no https://, no trailing slash
          // the "+": span.input-group-text of this block (= getElementsByClassName('col-sm-4 mb-md')[…]
          // .getElementsByTagName('span')[0]). Angular may listen on the span or on its <a>/<i>, and a
          // click only travels UP to parents, so the innermost element is clicked first (it bubbles
          // through <a> and <span>); then <a>, then the span itself, until a .tag shows.
          const span = q(M.addDomain, block) || block.getElementsByTagName("span")[0];
          if (!span) { results.push({ id: c.id, ok: false, error: "the + (span.input-group-text) was not found next to newValidDomain" }); continue; }
          const targets = [span.querySelector("i"), span.querySelector("a"), span].filter(Boolean);
          let tagged = false;
          for (const t of targets) {
            if (hasTag(hostOnly)) { tagged = true; break; }   // never add the same domain twice
            if (input.value.trim() !== hostOnly) setValue(input, hostOnly); // Angular may have cleared it
            trace(`typed ${hostOnly}; clicking + on <${t.tagName.toLowerCase()}${t.className ? "." + String(t.className).replace(/\s+/g, ".") : ""}>`);
            realClick(t);
            tagged = !!(await waitFor(() => hasTag(hostOnly), 2500, 200));
            trace(tagged ? `.tag with ${hostOnly} created` : `no .tag after clicking <${t.tagName.toLowerCase()}>`);
            if (tagged) break;
          }
          trace(tagged ? ".tag found" : `no .tag after clicking ${targets.map((t) => t.tagName.toLowerCase()).join(", ")} (tags: ${domainTags().join(" | ") || "none"})`);
          L_info(`domain ${hostOnly}: typed in newValidDomain, + clicked, ${tagged ? "a .tag with it was created" : "NO .tag with it"}`);
          if (!tagged) { results.push({ id: c.id, ok: false, error: `${hostOnly} typed and + clicked, but no .tag element with it was created (not added)` }); continue; }
          changed = true; results.push({ id: c.id, ok: true, added: true, how: ".tag created" });
        } else results.push({ id: c.id, ok: false, error: "no automatic fix for this item" });
      } catch (e) { results.push({ id: c.id, ok: false, error: e.message }); }
    }
    if (!changed) { trace("nothing changed: no Save"); return { ok: true, noop: true, results }; }
    const btn = mainSaveButton();
    trace(btn.el ? `Save button: "${btnText(btn.el)}" (btn btn-default [${btn.index}])` : `no Save: ${btn.error}`);
    if (!btn.el) return { ok: false, error: btn.error, results };
    const clicked = { text: btnText(btn.el), index: btn.index, type: btn.el.type || "", disabled: btn.el.disabled };
    L_info("Main settings: clicking Save", clicked);
    // Click AFTER answering: a type=submit Save reloads the page, and a script still waiting in a
    // page that reloads never gets its answer back (that was the "no answer after 60 s").
    // background.js then follows the save with short saveStatus() calls and the tab's reload.
    window.__oirSaveBtn = btn.el;
    setTimeout(() => { trace("Save clicked"); realClick(btn.el); }, 150);
    trace("answering (Save will be clicked in 150 ms)");
    return { ok: true, clicked, results, scheduled: true, trace: window.__oirTrace.slice() };
  }
  // One quick look (no waiting): has the save gone through?
  function saveStatus() {
    const btn = window.__oirSaveBtn;
    if (!btn) return { state: "reloaded" }; // a new page: the old script and its button are gone
    const form = btn.form || btn.closest("form");
    const success = Array.from(document.querySelectorAll('.alert-success, .toast-success, .toast, [role="status"], .mat-mdc-snack-bar-container, .snackbar'))
      .find((e) => visible(e) && /saved|success|updated/i.test(txt(e)));
    const errors = pageErrors();
    if (errors.length) return { state: "error", errors };
    const tags = tagEls();
    if (tags.length && !tags.some((t) => t.hasAttribute("data-oir-before-save"))) return { state: "confirmed", how: `the domain list was re-rendered by the server (${tags.length} tags)` };
    if (success) return { state: "confirmed", how: "success message: " + txt(success).slice(0, 80) };
    if (!document.contains(btn)) return { state: "confirmed", how: "the Save button was redrawn" };
    if (form && form.classList.contains("ng-pristine")) return { state: "confirmed", how: "the form is pristine again" };
    if (btn.disabled) return { state: "confirmed", how: "the Save button is disabled again" };
    return { state: "pending" };
  }

  // getElementsByClassName('btn btn-default')[2] when it is type=submit; otherwise the first
  // type=submit .btn.btn-default. A disabled Save is reported, never replaced by another button.
  function mainSaveButton() {
    const direct = Array.from(document.querySelectorAll(A.main.saveSubmit.join(","))).find((b) => !BAD.test(btnText(b)));
    if (direct) {
      if (direct.disabled || direct.getAttribute("aria-disabled") === "true") return { error: `the Save button ("${btnText(direct)}") is disabled: the form is not valid or nothing changed` };
      return { el: direct, index: Array.from(document.getElementsByClassName("btn btn-default")).indexOf(direct) };
    }
    const all = Array.from(document.getElementsByClassName("btn btn-default"));
    let index = A.main.saveIndex;
    let el = all[index] && (all[index].type === "submit" || all[index].getAttribute("type") === "submit") ? all[index] : null;
    if (!el) { index = all.findIndex((b) => (b.type === "submit" || b.getAttribute("type") === "submit") && !BAD.test(btnText(b))); el = all[index] || null; }
    if (!el) return { error: `Save button not found: no type=submit among the ${all.length} .btn.btn-default of the page` };
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return { error: `the Save button ("${btnText(el)}") is disabled: the form is not valid or nothing changed` };
    return { el, index };
  }


  async function apply(change, mid) {
    await pageReady(readyTest[change.pageKey]);
    if (signinShown()) return { ok: false, signin: true, error: "the Awin UI asked for a sign-in" };
    const t = change.target, want = change.to;

    if (["website", "landingPage", "append"].includes(t)) {
      const r = readByLabel(A.main[t]);
      if (!r.control || !/INPUT|TEXTAREA/.test(r.control.tagName)) return { ok: false, error: "field not found or not editable" };
      setValue(r.control, want);
      return save(r.control);
    }
    if (t === "awc") {
      const r = readByLabel(A.main.awc);
      if (!r.control || !setBool(r.control, true)) return { ok: false, error: "switch not found or did not change" };
      return save(r.control);
    }
    if (t === "acceptedDomains") {
      const sec = domainSection();
      if (!sec) return { ok: false, error: "accepted domains section not found" };
      const input = Array.from(sec.box.querySelectorAll('input[type="text"], input:not([type]), textarea')).find((i) => visible(i) && !i.value);
      if (!input) return { ok: false, error: "no empty domain field" };
      setValue(input, want);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const add = Array.from(sec.box.querySelectorAll('button, [role="button"]')).find((b) => isButton(b) && /^(\+|add)\b/i.test(btnText(b)));
      if (add) add.click();
      await sleep(500);
      return save(sec.box);
    }
    if (t === "singleView") {
      const s = singleViewSwitch();
      if (!s.c || !setBool(s.c, true)) return { ok: false, error: "plugin switch not found or did not change" };
      await sleep(400);
      const d = openDialog();
      if (d) return { ok: false, needsInput: true, error: `the page asked for more input ("${txt(d).slice(0, 120)}")` };
      return saveButtonNear(s.c) ? save(s.c) : { ok: true };
    }
    if (t === "defaultCommission") return editDefaultCommission(change);
    if (t === "strategy") {
      const el = mobileStrategy();
      if (!el) return { ok: false, error: "#strategy-implemented (or the \"Tracking is implemented on mobile site\" option) not found" };
      if (strategyOn(el)) return { ok: true, noop: true }; // already configured: nothing to click, nothing to save
      realClick(el);
      if (!strategyOn(el)) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); }
      const upd = q(A.mobile.save);
      if (!upd) return { ok: false, error: "#updateChanges not found" };
      setTimeout(() => upd.click(), 100); // may reload the page
      return { ok: true, navigating: true, clicked: { text: btnText(upd), id: upd.id } };
    }
    if (t === "manualApproval") {
      const el = approvalControl();
      if (!el) return { ok: false, error: "field not found" };
      if (boolOf(el) === /^on$/i.test(want)) return { ok: true, noop: true }; // already right: no save
      if (!setBool(el, /^on$/i.test(want))) return { ok: false, error: "the field did not change" };
      return save(el);
    }
    if (t === "validationDays") {
      const el = migratedValidation();
      if (!el) return { ok: false, error: "Validation Period Days not found" };
      if (Number(el.value) === Number(want)) return { ok: true, noop: true };
      setValue(el, want);
      return save(el);
    }
    if (t === "publisher") {
      // sets every test publisher that isn't Active, then submits the form once
      const p = prejoinRows();
      if (!p.form) return { ok: false, error: "pre_join_publishers form not found" };
      let changed = 0;
      for (const r of p.rows) {
        if (/^active$/i.test(r.status)) continue;
        if (r.box) {
          if (!r.box.checked) clickable(r.box).click();
          if (!r.box.checked) { r.box.checked = true; r.box.dispatchEvent(new Event("change", { bubbles: true })); }
          changed++;
        } else if (r.sel) {
          const opt = Array.from(r.sel.options).find((o) => /^active$/i.test(o.text.trim()) || /^active$/i.test(o.value));
          if (!opt) return { ok: false, error: `no Active option for publisher ${r.id}` };
          setValue(r.sel, opt.value); changed++;
        } else if (r.radios.length) {
          const on = r.radios.find((x) => /active/i.test(radioLabel(x)));
          if (!on) return { ok: false, error: `no Active option for publisher ${r.id}` };
          clickable(on).click(); changed++;
        } else return { ok: false, error: `no status control for publisher ${r.id}` };
      }
      if (!changed) return { ok: true, noop: true };
      return save(p.form.querySelector("select, input") || p.form);
    }
    return { ok: false, error: "no automatic fix for this item" };
  }

  // ---------- structure only (no values) ----------
  function describe() {
    const short = (el) => txt(el).slice(0, 80);
    const uniq = (a) => Array.from(new Set(a.filter(Boolean)));
    return {
      url: location.href.replace(/\d{3,}/g, "{id}"),
      headings: uniq(Array.from(document.querySelectorAll("h1,h2,h3,h4,legend")).filter(visible).map(short)).slice(0, 40),
      labels: uniq(Array.from(document.querySelectorAll("label, dt, th, mat-label, [class*='label' i]")).filter(visible).map(short)).slice(0, 120),
      forms: Array.from(document.querySelectorAll("form")).map((f) => ({ name: f.getAttribute("name") || "", id: f.id || "", method: f.method })),
      tables: tables().map((t) => ({ id: t.el.id || "", headers: t.headers, rows: t.rows.length })),
      buttons: uniq(Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).filter(visible).map(btnText)).slice(0, 60),
      controls: Array.from(document.querySelectorAll("input, select, textarea, [role=switch]")).slice(0, 120)
        .map((c) => ({ tag: c.tagName.toLowerCase(), type: c.type || c.getAttribute("role") || "", id: c.id || "", name: c.getAttribute("name") || "" })),
      customElements: uniq(Array.from(document.querySelectorAll("*")).map((e) => e.tagName.toLowerCase()).filter((n) => n.startsWith("app-"))).slice(0, 40)
    };
  }

  // ---- Main settings in short, synchronous steps (no waiting inside the page) ----
  // background.js calls these one by one and does all the waiting itself, so a page that
  // reloads, or whose timers are paused (background tab), can't leave a step hanging.
  function mainSetFields(changes) {
    const M = A.main, results = [];
    for (const c of changes) {
      try {
        if (["website", "landingPage", "append"].includes(c.target)) {
          const el = (c.target === "website" && q(M.websiteId)) || q((M.ids || {})[c.target] || []) || readByLabel(M[c.target]).control;
          if (!el || !/INPUT|TEXTAREA/.test(el.tagName)) results.push({ id: c.id, ok: false, error: `${c.field}: field not found` });
          else if (el.value.trim() === c.to) results.push({ id: c.id, ok: true, noop: true });
          else { setValue(el, c.to); results.push({ id: c.id, ok: true, changed: true }); }
        } else if (c.target === "awc") {
          const el = readByLabel(M.awc).control;
          if (!el) results.push({ id: c.id, ok: false, error: "Awin Click ID switch not found" });
          else if (readControl(el) === true) results.push({ id: c.id, ok: true, noop: true });
          else if (!setBool(el, true)) results.push({ id: c.id, ok: false, error: "Awin Click ID switch did not change" });
          else results.push({ id: c.id, ok: true, changed: true });
        }
      } catch (e) { results.push({ id: c.id, ok: false, error: e.message }); }
    }
    return { results, url: location.href };
  }
  const hostOf = (v) => String(v).trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
  // is the domain already accepted (a .tag, or in the list)?
  function domainState(domain) {
    const host = hostOf(domain);
    const sec = domainSection();
    const listed = sec && (sec.text.match(DOMAIN_RE) || []).map((d) => d.toLowerCase()).includes(host);
    const input = q(A.main.newDomain);
    return { host, tagged: hasTag(host), listed: !!listed, inputFound: !!input, inputValue: input ? input.value : null, tags: domainTags(), url: location.href };
  }
  // Type the domain into #newValidDomain the way the recording shows Angular gets it:
  // focus/focusin, value through the native setter, input (as a paste); then change, focusout and
  // blur (the mousedown on the + takes the focus away) and the click on the + (target n:
  // 0 = <i class="fa-plus">, 1 = its <a>, 2 = the span), which bubbles up to the <a>'s (click).
  function domainClickAdd(domain, n) {
    const host = hostOf(domain);
    const input = q(A.main.newDomain);
    if (!input) return { ok: false, error: "#newValidDomain not found" };
    const group = input.closest(".input-group") || input.closest(A.main.domainBlock.join(",")) || input.parentElement;
    const span = q(A.main.addDomain, group) || group.getElementsByTagName("span")[0];
    if (!span) return { ok: false, error: "the + (.input-group-append span.input-group-text) was not found next to #newValidDomain" };
    const a = span.querySelector("a");
    const targets = [(a || span).querySelector("i.fa-plus, i"), a, span].filter(Boolean);
    const t = targets[Math.min(n, targets.length - 1)];
    input.focus();
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, host);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: host }));
    t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    input.blur();
    ["mouseup", "click"].forEach((type) => t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
    return { ok: true, clicked: `<${t.tagName.toLowerCase()}${t.className ? "." + String(t.className).replace(/\s+/g, ".") : ""}>`, targets: targets.length };
  }
  // click Save (btn btn-default [2], type=submit) right now and answer
  function mainClickSave() {
    const btn = mainSaveButton();
    if (!btn.el) return { ok: false, error: btn.error };
    const clicked = { text: btnText(btn.el), index: btn.index, type: btn.el.type || "" };
    window.__oirSaveBtn = btn.el;
    tagEls().forEach((t) => t.setAttribute("data-oir-before-save", "1")); // the server re-renders the list after Save
    btn.el.focus();
    realClick(btn.el);
    return { ok: true, clicked };
  }

  const traceNow = () => ({ trace: window.__oirTrace || null, tags: domainTags(), url: location.href });
  window.OIRPage = { scrape, apply, applyMain, saveStatus, traceNow, mainSetFields, domainState, domainClickAdd, mainClickSave, describe, pageReady, signinShown, pageErrors, ttSearch, ttRead, ttDelete };
})();

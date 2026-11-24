// Ported from Optimus IR's own test/pages.smoke.js (autofill/review/). Run by `npm test` with the prototype's tests.
// Smoke test of content/awin-page.js against mock Awin pages (needs jsdom: npm i -D jsdom).
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..", "review");
const pad = `<p>${"x".repeat(200)}</p>`;
function load(html, url) {
  const dom = new JSDOM(`<html><body>${html}${pad}</body></html>`, { runScripts: "outside-only", url });
  const w = dom.window;
  w.eval("HTMLElement.prototype.getClientRects = function(){return [1]}; window.CSS = {escape: s => s};");
  w.eval(fs.readFileSync(path.join(root, "lib/fields.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(root, "content/awin-page.js"), "utf8"));
  return w;
}
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };
(async () => {
  // Mobile
  w = load(`<h1>131913</h1><form method="post"><input type="checkbox" id="strategy-implemented"><button>Save</button></form>`, "https://ui.awin.com/provider/merchant-settings/131913/mobile-tracking/network/awin");
  r = await w.OIRPage.scrape("mobile", "131913");
  ok(r.fields.strategy === false, "mobile read");

  // Pre-join
  w = load(`<form name="pre_join_publishers" method="post"><table><tr><th>Publisher</th><th>Membership status</th></tr>
    <tr><td>111 - Test</td><td><select><option>Active</option><option selected>Pending</option></select></td></tr>
    <tr><td>45628 - Example</td><td><select><option selected>Active</option><option>Pending</option></select></td></tr></table><button type="submit">Submit</button></form>`,
    "https://ui.awin.com/provider/pre-join-publishers?advertiserId=131913");
  w.document.forms[0].addEventListener("submit", (e) => e.preventDefault());
  r = await w.OIRPage.scrape("prejoin", "131913");
  ok(JSON.stringify(r.fields.publishers) === JSON.stringify([{ id: "111", status: "Pending" }, { id: "45628", status: "Active" }]), "prejoin read " + JSON.stringify(r.fields.publishers));
  r = await w.OIRPage.apply({ pageKey: "prejoin", target: "publisher", to: "111" }, "131913");
  ok(r.navigating && w.document.querySelector("select").value === "Active", "prejoin set Active + submit");

  // Migrated
  w = load(`<h1>131913</h1><form method="post"><label for="migrated_advertiser_settings_validationPeriodDays">Validation Period Days</label>
    <input id="migrated_advertiser_settings_validationPeriodDays" value="30">
    <input type="checkbox" id="migrated_advertiser_settings_advertiserProgramOptions_manualApproval" checked><button type="submit">Save</button></form>`,
    "https://ui.awin.com/provider/migrated-advertiser-settings/131913");
  w.document.forms[0].addEventListener("submit", (e) => e.preventDefault());
  r = await w.OIRPage.scrape("migrated", "131913");
  ok(r.fields.validationDays === "30" && r.fields.manualApproval === true, "migrated read");
  await w.OIRPage.apply({ pageKey: "migrated", target: "manualApproval", to: "Off" }, "131913");
  ok(!w.document.querySelector("input[type=checkbox]").checked, "manual approval turned off");

  // Pending transactions with tooltip parameters
  w = load(`<h1>131913</h1><table><thead><tr><th>Order ref</th><th>Publisher</th><th>Voucher</th><th>Parameters</th></tr></thead>
    <tbody><tr><td>ORD-1</td><td>111</td><td>TEST10</td><td><i class="fa-info" data-original-title="p1=app-2.1&lt;br&gt;customeracquisition=NEW&lt;br&gt;parts=DEFAULT:10"></i></td></tr></tbody></table>`,
    "https://ui.awin.com/awin/merchant/131913/validate-pending/network/awin");
  r = await w.OIRPage.scrape("validate", "131913");
  ok(r.fields.transactions[0].voucher && r.fields.transactions[0].params.join() === "p1,customeracquisition,parts", "validate read " + JSON.stringify(r.fields));

  // Tracking wizard
  w = load(`<h1>131913 transactions</h1><app-transaction-details></app-transaction-details>`, "https://ui.awin.com/advertiser-integration-tool/trackingwizard/us/awin/merchant/131913");
  r = await w.OIRPage.scrape("wizard", "131913");
  ok(r.fields.transactionDetails === 1, "wizard read");

  // Test transactions: #merchantId + #formprovidertesttransactionssearch, rows in tableHeader,
  // one row -> .deleteTestTransaction, several -> #delete-all
  w = load(`<form id="f"><input id="merchantId"><button id="formprovidertesttransactionssearch" type="button">Search</button></form>
    <table><thead><tr><th>Order ref</th><th>Advertiser</th><th></th></tr></thead><tbody id="tableHeader"></tbody></table><button id="delete-all">Delete all</button>`,
    "https://ui.awin.com/provider/test-transactions");
  const tb = w.document.getElementById("tableHeader");
  const seed = (refs) => { tb.innerHTML = refs.map((x) => `<tr><td>${x}</td><td>131530</td><td><a class="deleteTestTransaction">x</a></td></tr>`).join(""); tb.querySelectorAll(".deleteTestTransaction").forEach((b) => (b.onclick = () => b.closest("tr").remove())); };
  w.document.getElementById("formprovidertesttransactionssearch").onclick = () => { if (w.document.getElementById("merchantId").value === "131530" && !w.__s) { w.__s = 1; seed(["A1", "A2"]); } };
  w.document.getElementById("delete-all").onclick = () => {
    const pop = w.document.createElement("div");
    pop.innerHTML = '<p>Delete all test transactions?</p><button id="popup_ok">OK</button>';
    w.document.body.append(pop);
    w.document.getElementById("popup_ok").onclick = () => { tb.innerHTML = ""; pop.remove(); };
  };
  r = w.OIRPage.ttSearch("131530");
  await new Promise((x) => setTimeout(x, 300));
  r = await w.OIRPage.ttRead("131530");
  ok(r.rows.map((x) => x.ref).join() === "A1,A2", "testtx search + read " + JSON.stringify(r));
  r = await w.OIRPage.ttDelete("131530");
  ok(r.clicked === "delete-all" && !tb.children.length, "several rows -> #delete-all");
  seed(["B1"]);
  r = await w.OIRPage.ttDelete("131530");
  ok(r.clicked === "deleteTestTransaction" && !tb.children.length && r.refs.join() === "B1", "one row -> .deleteTestTransaction");

  // Main settings, the DOM from the print: .col-sm-4.mb-md > .input-group > input[formcontrolname=newValidDomain]
  // + .input-group-append > span.input-group-text > a > i.fa-plus; Save = getElementsByClassName('btn btn-default')[2], type=submit
  w = load(`<h1>131530</h1><form id="m" class="ng-pristine"><label>Website</label><input id="MainWebsiteURL" value="https://breggz.com">
    <label>Default Query String Append</label><input id="ap" value="source=awin">
    <button class="btn btn-default" type="button">Back</button><button class="btn btn-default" type="button">Preview</button>
    <div class="domains"><label>Accepted domains</label><ul><li>breggz.com</li></ul>
      <div class="col-sm-4 mb-md"><div class="input-group"><input id="newValidDomain" type="text" formcontrolname="newValidDomain" class="form-control">
        <div class="input-group-append"><span class="input-group-text"><a><i class="fa-regular fa-plus"></i></a></span></div></div></div></div>
    <button class="btn btn-default" type="submit">Save</button></form>`, "https://ui.awin.com/tracking-settings/us/awin/advertiser/131530/main-settings");
  const form = w.document.getElementById("m");
  let saves = 0, added = [];
  form.addEventListener("input", () => form.classList.replace("ng-pristine", "ng-dirty"));
  form.addEventListener("submit", (e) => { e.preventDefault(); saves++; setTimeout(() => form.classList.replace("ng-dirty", "ng-pristine"), 400); });
  w.document.querySelector("span.input-group-text").addEventListener("click", () => {
    const v = w.document.getElementById("newValidDomain").value; added.push(v);
    const tag = w.document.createElement("span"); tag.className = "tag"; tag.textContent = v + " ×"; w.document.querySelector(".domains ul").append(tag);
  });
  r = await w.OIRPage.scrape("main", "131530");
  ok(r.fields.website === "https://breggz.com" && r.fields.acceptedDomains.join() === "breggz.com", "main read " + JSON.stringify(r.fields));
  r = await w.OIRPage.applyMain([
    { id: "a", target: "append", to: "source=awin&utm_source=awin", field: "append" },
    { id: "d", target: "acceptedDomains", to: "https://breggz-dc0shy6m.myshopify.com/", field: "domain" },
    { id: "d2", target: "acceptedDomains", to: "breggz.com", field: "domain" }]);
  await new Promise((x) => setTimeout(x, 700)); // the page clicks Save 150 ms after answering; the save takes 400 ms
  r.saved = w.OIRPage.saveStatus().state;
  ok(r.results.find((x) => x.id === "d").how === ".tag created" && saves === 1 && added.join() === "breggz-dc0shy6m.myshopify.com" && r.clicked.index === 2 && r.clicked.text === "Save" && r.saved === "confirmed"
    && r.results.find((x) => x.id === "d2").noop && w.document.getElementById("ap").value === "source=awin&utm_source=awin",
    "main: domain via span.input-group-text, Save = btn btn-default[2] clicked once and confirmed " + JSON.stringify({ saves, added, clicked: r.clicked, saved: r.saved }));

  // Angular-style: the click handler is on the <a> inside the span (a click on the span alone would not reach it)
  w = load(`<h1>131530</h1><form><label>Accepted domains</label><div class="col-sm-4 mb-md"><div class="input-group">
    <input id="newValidDomain" formcontrolname="newValidDomain"><div class="input-group-append"><span class="input-group-text"><a><i class="fa-regular fa-plus"></i></a></span></div></div></div>
    <div class="tags"></div>
    <button class="btn btn-default" type="button">A</button><button class="btn btn-default" type="button">B</button><button class="btn btn-default" type="submit">Save</button></form>`,
    "https://ui.awin.com/tracking-settings/us/awin/advertiser/131530/main-settings");
  let aClicks = 0;
  w.document.querySelector(".input-group-text a").addEventListener("click", () => {
    aClicks++;
    const v = w.document.getElementById("newValidDomain").value;
    w.document.querySelector(".tags").insertAdjacentHTML("beforeend", `<span class="tag">${v}</span>`);
  });
  let saved3 = 0; w.document.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); saved3++; });
  r = await w.OIRPage.applyMain([{ id: "d", target: "acceptedDomains", to: "greenwood-group.myshopify.com", field: "domain" }]);
  await new Promise((x) => setTimeout(x, 400));
  ok(r.results[0].ok && aClicks === 1 && saved3 === 1 && w.document.getElementsByClassName("tag")[0].textContent === "greenwood-group.myshopify.com",
    "handler on the <a>: the click on <i> reaches it, one .tag, one Save " + JSON.stringify({ aClicks, saved3, trace: r.trace }));

  // short synchronous steps (what background.js now calls): state, + on <i>, fields, Save
  w = load(`<h1>131530</h1><form><label>Default Query String Append</label><input id="ap" value="source=aw">
    <label>Accepted domains</label><div class="col-sm-4 mb-md"><div class="input-group">
    <input id="newValidDomain" formcontrolname="newValidDomain"><div class="input-group-append"><span class="input-group-text"><a><i class="fa-regular fa-plus"></i></a></span></div></div></div>
    <div class="tags"></div>
    <button class="btn btn-default" type="button">A</button><button class="btn btn-default" type="button">B</button><button class="btn btn-default" type="submit">Save</button></form>`,
    "https://ui.awin.com/tracking-settings/us/awin/advertiser/131530/main-settings");
  w.document.querySelector(".input-group-text a").addEventListener("click", () => {
    w.document.querySelector(".tags").insertAdjacentHTML("beforeend", `<span class="tag">${w.document.getElementById("newValidDomain").value}</span>`);
  });
  let saved4 = 0; w.document.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); saved4++; });
  const st0 = w.OIRPage.domainState("https://greenwood-group.myshopify.com/");
  const add0 = w.OIRPage.domainClickAdd("greenwood-group.myshopify.com", 0);
  const st1 = w.OIRPage.domainState("greenwood-group.myshopify.com");
  const f = w.OIRPage.mainSetFields([{ id: "a", target: "append", to: "source=aw&utm_source=awin", field: "append" }]);
  const sv = w.OIRPage.mainClickSave();
  ok(st0.inputFound && !st0.tagged && add0.clicked === "<i.fa-regular.fa-plus>" && st1.tagged && f.results[0].changed && sv.ok && sv.clicked.index === 2 && saved4 === 1,
    "short steps: #newValidDomain typed, + on <i>, .tag seen, fields set, Save [2] clicked once " + JSON.stringify({ st1, sv }));

  // The page as recorded (gravacao-accepted-domains-awin.md): Angular model updated by "input",
  // (click) on the <a> of the +, one div.tags per domain with a.deleteTag.close, the only
  // button[type=submit].btn.btn-default, list re-rendered by the server ~ after Save
  w = load(`<h1>129791</h1><form class="form-horizontal p-form"><label>Accepted domains</label>
    <div class="col-sm-4 mb-md"><div class="input-group"><input _ngcontent-ng-c1 id="newValidDomain" type="text" formcontrolname="newValidDomain" class="form-control">
      <div class="input-group-append"><span class="input-group-text"><a _ngcontent-ng-c1><i class="fa-regular fa-plus"></i></a></span></div></div></div>
    <div id="list"><div class="tags mt-1">advance7.shop <a class="deleteTag close">x</a></div><div class="tags mt-1">*.advance7.shop <a class="deleteTag close">x</a></div></div>
    <button type="submit" class="btn btn-default">Save</button></form>`, "https://ui.awin.com/tracking-settings/us/awin/advertiser/129791/main-settings");
  const model = { newValidDomain: "", domains: ["advance7.shop", "*.advance7.shop"] };
  const inp = w.document.getElementById("newValidDomain");
  inp.addEventListener("input", (e) => { model.newValidDomain = e.target.value; });          // Reactive Forms: the model follows "input"
  const draw = () => { w.document.getElementById("list").innerHTML = model.domains.map((d) => `<div class="tags mt-1">${d} <a class="deleteTag close">x</a></div>`).join(""); };
  w.document.querySelector(".input-group-append span.input-group-text a").addEventListener("click", () => {   // (click) on the <a>
    if (model.newValidDomain) { model.domains.push(model.newValidDomain); model.newValidDomain = ""; draw(); }
  });
  let submits = 0;
  w.document.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); submits++; setTimeout(draw, 300); }); // server re-render
  const stA = w.OIRPage.domainState("greenwood-group.myshopify.com");
  const addA = w.OIRPage.domainClickAdd("https://greenwood-group.myshopify.com/", 0);
  const stB = w.OIRPage.domainState("greenwood-group.myshopify.com");
  const svA = w.OIRPage.mainClickSave();
  const beforeRender = w.OIRPage.saveStatus().state;
  await new Promise((x) => setTimeout(x, 500));
  const afterRender = w.OIRPage.saveStatus();
  ok(!stA.tagged && stA.tags.join() === "advance7.shop,*.advance7.shop" && addA.clicked === "<i.fa-regular.fa-plus>" && stB.tagged
    && svA.ok && submits === 1 && beforeRender === "pending" && afterRender.state === "confirmed",
    "as recorded: model via input event, + on <i> → <a>, div.tags created, button[type=submit] Save, confirmed by the re-render " + JSON.stringify({ tags: stB.tags, save: svA.clicked, afterRender }));
  ok(w.OIRPage.domainState("advance7.shop").tagged && !w.OIRPage.domainState("advance7").tagged, "div.tags compared without the x, whole domain only");

  // + clicked but no .tag created -> the domain fix fails (wrong input); nothing else changed -> no Save
  w = load(`<h1>131530</h1><form><label>Accepted domains</label><div class="col-sm-4 mb-md"><div class="input-group">
    <input id="newValidDomain" formcontrolname="newValidDomain"><div class="input-group-append"><span class="input-group-text"><a></a></span></div></div></div>
    <button class="btn btn-default" type="button">A</button><button class="btn btn-default" type="button">B</button><button class="btn btn-default" type="submit">Save</button></form>`,
    "https://ui.awin.com/tracking-settings/us/awin/advertiser/131530/main-settings");
  let saved2 = 0; w.document.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); saved2++; });
  r = await w.OIRPage.applyMain([{ id: "d", target: "acceptedDomains", to: "shop-x.myshopify.com", field: "domain" }]);
  await new Promise((x) => setTimeout(x, 400));
  ok(r.results[0].ok === false && /no \.tag/.test(r.results[0].error) && !r.clicked && saved2 === 0, "no .tag after + -> domain failed, no Save clicked");

  // Plugins: every plugin with its switch
  w = load(`<h1>131530</h1><h2>Plugins</h2><table><thead><tr><th>Name</th><th>Last Updated</th><th>Updated By</th></tr></thead>
    <tbody><tr><td><div class="d-flex items-center gap-1"><strong>R.O.EYE - Consent - SingleView</strong><i class="fa-info"></i></div></td><td>01/11/2026</td><td>Someone</td></tr></tbody></table>`,
    "https://ui.awin.com/advertiser-mastertag/us/awin/131530/plugins");
  r = await w.OIRPage.scrape("plugins", "131530");
  ok(JSON.stringify(r.fields.plugins) === JSON.stringify([{ name: "R.O.EYE - Consent - SingleView", enabled: true }]), "plugins: only the name from <strong> " + JSON.stringify(r.fields.plugins));

  // Commission groups (ag-grid): DEFAULT in the floating bottom row, rate.publisherCommission
  w = load(`<h1>131530</h1><div class="ag-root">
    <div class="ag-floating-bottom"><div class="ag-pinned-left-floating-bottom"><div role="row" row-index="b-0"><div col-id="name"><span class="ag-cell-value">Default</span></div></div></div>
    <div class="ag-floating-bottom-viewport"><div role="row" row-index="b-0"><div col-id="name"><span class="ag-cell-value">Default</span></div>
      <div col-id="rate.publisherCommission"><span class="ag-cell-value">8.00%</span></div></div></div></div></div>`,
    "https://ui.awin.com/commission-manager/us/awin/merchant/131530/commission-groups");
  w.eval("document.body.insertAdjacentHTML('beforeend', '<div class=\"ag-overlay-loading-wrapper\">Loading...</div>')"); // a grid overlay must not block
  const t0 = Date.now();
  r = await w.OIRPage.scrape("commission", "131530");
  ok(JSON.stringify(r.fields.groups) === JSON.stringify([{ name: "DEFAULT", type: "Percentage", value: 8, raw: "8.00%" }]) && Date.now() - t0 < 5000,
    `commission from ag-grid in ${Date.now() - t0} ms ` + JSON.stringify(r.fields.groups));

  // Fee manager as an ag-grid
  w = load(`<h1>131530</h1><div class="ag-root"><div class="ag-header-cell" col-id="feeType"><span class="ag-header-cell-text">Fee type</span></div>
    <div class="ag-header-cell" col-id="value"><span class="ag-header-cell-text">Value</span></div>
    <div class="ag-row" row-index="0"><div col-id="feeType"><span class="ag-cell-value">Tracking Fee</span></div><div col-id="value"><span class="ag-cell-value">2.50%</span></div></div></div>`,
    "https://ui.awin.com/provider/finance/fee-manager/en/131530");
  r = await w.OIRPage.scrape("fees", "131530");
  ok(r.fields.fees.length === 1 && r.fields.fees[0].name === "Tracking Fee" && r.fields.fees[0].value === 2.5 && r.fields.fees[0].type === "Percentage", "fees from ag-grid " + JSON.stringify(r.fields.fees));

  // Fee manager: input[formcontrolname=feeValueCtrl]
  w = load(`<h1>131530</h1><input formcontrolname="feeValueCtrl" value="2.5">`, "https://ui.awin.com/provider/finance/fee-manager/en/131530");
  r = await w.OIRPage.scrape("fees", "131530");
  ok(r.fields.feeValue === "2.5", "fee value from feeValueCtrl " + JSON.stringify(r.fields));

  // Mobile tracking: checked="checked" = configured -> nothing clicked, nothing saved
  w = load(`<h1>131530</h1><form><input type="radio" name="strategy" id="strategy-implemented" checked="checked"><input type="radio" name="strategy" id="strategy-none">
    <button id="updateChanges" type="button">Update changes</button></form>`, "https://ui.awin.com/provider/merchant-settings/131530/mobile-tracking/network/awin");
  let updates = 0; w.document.getElementById("updateChanges").onclick = () => updates++;
  r = await w.OIRPage.scrape("mobile", "131530");
  const readOn = r.fields.strategy;
  r = await w.OIRPage.apply({ pageKey: "mobile", target: "strategy", to: "On" }, "131530");
  await new Promise((x) => setTimeout(x, 200));
  ok(readOn === true && r.noop === true && updates === 0, "mobile: checked=checked is read as configured, no click, no save");
  // not configured: click #strategy-implemented, then #updateChanges
  w = load(`<h1>131530</h1><form><input type="radio" name="strategy" id="strategy-implemented"><input type="radio" name="strategy" id="strategy-none" checked="checked">
    <button id="updateChanges" type="button">Update changes</button></form>`, "https://ui.awin.com/provider/merchant-settings/131530/mobile-tracking/network/awin");
  updates = 0; w.document.getElementById("updateChanges").onclick = () => updates++;
  r = await w.OIRPage.scrape("mobile", "131530");
  const readOff = r.fields.strategy;
  r = await w.OIRPage.apply({ pageKey: "mobile", target: "strategy", to: "On" }, "131530");
  await new Promise((x) => setTimeout(x, 200));
  ok(readOff === false && w.document.getElementById("strategy-implemented").checked && updates === 1, "mobile: not configured -> clicked, then #updateChanges");

  console.log(JSON.stringify(w.OIRPage.describe()).slice(0, 200));
})();

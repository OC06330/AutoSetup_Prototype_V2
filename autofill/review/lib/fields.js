// Labels, ids and page definitions. Everything that depends on how Salesforce or the Awin UI
// names things lives here, so a renamed label or id is a one-line fix.
// Label aliases are matched case-insensitively against the whole label text.
(function (root) {
  // ---- Salesforce: Implementation record (TSE__c), read from the page ----
  const SF_RECORD = {
    name:              ["Implementation Name", "Name"],
    awinId:            ["Awin Program ID", "Awin Programme ID", "Program ID"],
    status:            ["Implementation Status", "Status"],
    region:            ["Region of the program", "Region"],
    website:           ["Program website", "Programme website", "Website"],
    landingPage:       ["URL of Landing Page", "Landing Page URL", "Landing page"],
    dedup:             ["Deduplication"],
    dedupSolution:     ["Deduplication Solution"],
    otherDedupSolution:["Other Deduplication Solution"],
    dedupParam:        ["Deduplication Parameter"],
    channelParams:     ["Channel parameters implemented"],
    linkBuilder:       ["Link Builder Activated", "Link Builder"],
    ecomPlatform:      ["eCommerce platform"],
    otherEcomPlatform: ["other eCommerce platform", "Other eCommerce platform"],
    ecomPlatformUrl:   ["eCommerce Platform URL"],
    trackingTestDate:  ["Successful Tracking Test"],
    // the integrator, @mentioned at the end of the Chatter comment (first label found wins)
    integrator:        ["Integrator", "Assigned TC", "Assigned Technical Consultant", "Technical Consultant", "Implementation Owner", "Owner"]
  };
  // ---- Salesforce fields written after the review (Details tab, edit mode, Save) ----
  // kind "yesno": picklist/checkbox set to Yes/No. kind "text": text field.
  // kind "auto": Yes/No on a picklist or checkbox, the parameter names on a text field.
  const SF_UPDATES = {
    voucherTracking:  { labels: ["Voucher Tracking implemented"], kind: "yesno" },
    customParameters: { labels: ["Custom parameters implemented"], kind: "auto" },
    ecomPlatform:     { labels: ["eCommerce platform"], kind: "picklist" },
    // filled from the Awin UI only when blank on the record
    website:          { labels: SF_RECORD.website, kind: "text" },
    landingPage:      { labels: SF_RECORD.landingPage, kind: "text" },
    dedupParam:       { labels: SF_RECORD.dedupParam, kind: "text" },      // parameter name only: "source", "utm_source"
    channelParams:    { labels: SF_RECORD.channelParams, kind: "text" },   // its value: "aw", "awin"
    linkBuilder:      { labels: SF_RECORD.linkBuilder, kind: "yesno" },
    // the MasterTag plugins enabled in the Awin UI (after the fixes), e.g. "R.O.EYE - Consent - SingleView"
    mtPlugins:        { labels: ["MT plugins activated", "MT Plugins activated", "MasterTag plugins activated"], kind: "text" },
    // today's date, when the test transaction was tracked and the field is blank
    trackingTestDate: { labels: SF_RECORD.trackingTestDate, kind: "date" }
  };

  // ---- AutoSetup prototype: the record's marketing checklist, read first ----
  // The same fields the setup reads (autofill/config.js: platformOfferLabel, setupRecord). The setup's
  // own labels are used first when its config is loaded on the page; these are the fallback.
  const SF_CHECKLIST = {
    offer:            ["Platform Offer"],
    commissionType:   ["Commission type"],
    commissionAmount: ["Commission Amount"],
    validationPeriod: ["Auto validation period"]
  };

  // ---- Chatter post with the contract inputs ----
  const CHECKLIST_TITLE = /implementation checklist/i;
  // AutoSetup prototype: the setup's own Chatter note, the review's source of truth (offer, commission,
  // validation period as set). "New Implementation setup for MID 131530 (Accelerate)"
  const SETUP_NOTE_TITLE = /New Implementation setup(?: for MID (\d+))?(?: \((Access|Accelerate|Advanced)\))?/i;
  // Setup pages the review doesn't check itself: if the setup note says one needs a look or wasn't
  // started, the review lists it under "To check"
  const SETUP_ONLY_PAGES = ["Invite user", "Tracking tag settings", "Account details"];
  // Field names of the post, longest first: lets a post that arrives on one line be split.
  // (Analytics lines are still recognised so they don't run into the next value, but not used.)
  const CHECKLIST_LABELS = ["Analytics parameters", "Analytics params", "Analytics", "Base commission", "Commission type",
    "Commission value", "Default commission", "Auto-approve publishers", "Auto approve publishers", "Auto-approve", "Auto approve",
    "Publisher approval", "Validation period in contract", "Validation period", "Tracking fee type", "Tracking fee option",
    "Tracking fee", "Platform Offer", "Offer"];

  // ---- Awin UI pages ----
  const PAGES = [
    { key: "main",       name: "Main settings",                url: (loc, id) => `https://ui.awin.com/tracking-settings/${loc}/awin/advertiser/${id}/main-settings` },
    { key: "commission", name: "Commission groups",            url: (loc, id) => `https://ui.awin.com/commission-manager/${loc}/awin/merchant/${id}/commission-groups` },
    { key: "plugins",    name: "MasterTag plugins",            url: (loc, id) => `https://ui.awin.com/advertiser-mastertag/${loc}/awin/${id}/plugins` },
    { key: "fees",       name: "Fee manager",                  url: (loc, id) => `https://ui.awin.com/provider/finance/fee-manager/en/${id}` },
    { key: "validate",   name: "Pending transactions",         url: (loc, id) => `https://ui.awin.com/awin/merchant/${id}/validate-pending/network/awin` },
    { key: "wizard",     name: "Tracking diagnosis",           url: (loc, id) => `https://ui.awin.com/advertiser-integration-tool/trackingwizard/${loc}/awin/merchant/${id}` },
    { key: "mobile",     name: "Mobile tracking",              url: (loc, id) => `https://ui.awin.com/provider/merchant-settings/${id}/mobile-tracking/network/awin` },
    { key: "prejoin",    name: "Pre-join publishers",          url: (loc, id) => `https://ui.awin.com/provider/pre-join-publishers?advertiserId=${id}` },
    { key: "migrated",   name: "Migrated advertiser settings", url: (loc, id) => `https://ui.awin.com/provider/migrated-advertiser-settings/${id}` },
    { key: "testtx",     name: "Test transactions",            url: () => "https://ui.awin.com/provider/test-transactions" }
  ];

  // Labels and ids inside the Awin UI pages
  const AWIN = {
    main: {
      // ids/classes on the page come first; labels are the fallback
      websiteId:      ["#MainWebsiteURL"],
      // ids found by the AutoSetup's page check on the live page (tried before the labels)
      ids: { landingPage: ["#GlobalClickThroughPage"], append: ["#ClickAppend"], linkBuilder: ["#DeeplinkEnabled"] },
      // accepted domains block: .col-sm-4.mb-md > .input-group > input[formcontrolname=newValidDomain]
      //                         + .input-group-append > span.input-group-text (the "+")
      domainBlock:    [".col-sm-4.mb-md"],
      newDomain:      ["#newValidDomain", '[formcontrolname="newValidDomain"]'],
      // the "+": .input-group-append span.input-group-text a (no href/class/id), its <i class="fa-plus">
      addDomain:      [".input-group-append span.input-group-text", "span.input-group-text", ".input-group-text"],
      // each accepted domain is a div.tags (one per domain, with an a.deleteTag.close "x")
      domainTag:      ["div.tags", ".tags", ".tag"],
      // Save: button[type=submit].btn.btn-default ("Save", the only one; submits form.form-horizontal.p-form);
      // fallback: getElementsByClassName('btn btn-default')[2] when it is type=submit
      saveSubmit:     ["button[type=submit].btn.btn-default", "input[type=submit].btn.btn-default"],
      saveIndex:      2,
      save:           ["button.btn.btn-default", "input.btn.btn-default"],
      website:        ["Website", "Website URL", "Advertiser website", "Program website"],
      landingPage:    ["Landing page", "Default landing page", "Landing page URL", "Default Landing Page URL"],
      append:         ["Default Query String Append", "Query String Append", "Default query string append"],
      awc:            ["Awin Click ID", "Awin Click Identifier", "AWC", "Enable Awin Click ID"],
      linkBuilder:    ["Enable Link Builder for publishers", "Link Builder", "Enable Link Builder", "Link Builder enabled"],
      acceptedDomains:["Accepted domains", "Accepted Domains", "Allowed domains"]
    },
    // configured = #strategy-implemented has checked="checked"; otherwise click it, then #updateChanges
    // fallback (AutoSetup, live page): the radio name="strategy" labelled "Tracking is implemented on mobile site"
    mobile: { strategy: ["#strategy-implemented"], strategyRadio: "strategy", strategyLabel: /^tracking is implemented on mobile site/i, save: ["#updateChanges"] },
    // AutoSetup (live page): each publisher not yet pre-joined has a tick box whose value is its id;
    // a publisher already pre-joined has none. Submitted with the form's "Submit" button.
    prejoin: { form: ['form[name="pre_join_publishers"]', "form#pre_join_publishers", "#pre_join_publishers"] },
    migrated: {
      validationDays: ['[id*="alidationPeriod"]', '[name*="alidationPeriod"]'],
      validationLabels: ["Validation Period Days", "Validation period days", "Validation Period"],
      manualApproval: ["#migrated_advertiser_settings_advertiserProgramOptions_manualApproval",
                       '[name*="[manualApproval]"]'],
      // AutoSetup (live page): a select labelled "Approval of Publishers Joining" with "Manual Approval"
      approvalLabels: ["Approval of Publishers Joining"]
    },
    testtx: {
      midInput: ["#merchantId"],
      search: ["#formprovidertesttransactionssearch"],
      rows: ["#tableHeader tr", ".tableHeader tr", "table#transactions tbody tr", "#transactions tbody tr"],
      deleteOne: ".deleteTestTransaction",
      deleteAll: ["#delete-all"],
      popupOk: ["#popup_ok"], // extra confirmation after Delete all
      table: ["table#transactions", "#transactions"],
      midFallback: ['input[name*="merchant" i]', 'input[id*="merchant" i]', 'input[name*="advertiser" i]', 'input[id*="advertiser" i]']
    },
    wizard: { details: "app-transaction-details" },
    // Fee manager: only the tracking fee value, from this input
    fees: { value: ['[formcontrolname="feeValueCtrl"]'] },
    // ag-grid: the DEFAULT group sits in the floating bottom row
    commission: {
      bottom: [".ag-floating-bottom-viewport", ".ag-floating-bottom"],
      rate: ['[col-id="rate.publisherCommission"]', '[id="rate.publisherCommission"]']
    },
    plugins: { singleView: /singleview/i, names: "td .d-flex.items-center.gap-1 strong" },
  };

  // Core conversion parameters (awin-tracking-test 5.2): anything else is a custom parameter
  const CORE_PARAMS = ["tt", "tv", "ch", "cks", "a", "merchant", "b", "amount", "c", "ref", "d", "parts", "vc", "cr",
    "testmode", "t", "l", "cons", "j", "bd", "currency", "voucher", "vouchercode", "orderref", "channel"];

  const TEST_PUBLISHERS = ["111", "45628"];
  const REGION_LOC = { "": "us" };

  root.OIRFields = { SF_RECORD, SF_UPDATES, SF_CHECKLIST, CHECKLIST_TITLE, CHECKLIST_LABELS, SETUP_NOTE_TITLE, SETUP_ONLY_PAGES,
    PAGES, AWIN, CORE_PARAMS, TEST_PUBLISHERS, REGION_LOC };
  if (typeof module !== "undefined") module.exports = root.OIRFields;
})(typeof globalThis !== "undefined" ? globalThis : this);

// Check page / Fill only / Fill & save for the Technical Checklist, in one of two menu styles (Settings):
//  - 'panel' (the original): a panel docked at the bottom right that opens and closes;
//  - 'orb': a round floating button that can be dragged anywhere; its menu opens on hover (a click pins
//    it open) and can also start Moonfill's processes (🌙 scan, 🔎 IR, 🚀 New Implementation).
// Both live in their own shadow root on <body>, outside Salesforce's components, so Lightning
// re-renders can't remove them and SLDS styles can't leak in.
(function () {
  const teamCfg = globalThis.TCA_CONFIG;
  const teamFields = globalThis.TCA_FIELDS;
  const engine = globalThis.TCAEngine;
  const settings = globalThis.TCASettings;
  const templates = globalThis.TCA_TEMPLATES || [];
  const T = globalThis.TCATemplates;
  // Layers, last wins: team defaults → platform template (empty fields only) → the user's own settings.
  let saved = {};
  const effective = template => settings.apply(T.applyTemplate(teamFields, template), teamCfg, saved);
  let { fields, cfg, changed: personal } = effective(null);
  const refresh = async () => {
    saved = await settings.load();
    ({ fields, cfg, changed: personal } = effective(null));
    if ((saved.menuStyle || 'panel') !== state.style) { state.style = saved.menuStyle || 'panel'; placeOrb(); }
  };
  // The "Clear checklist" preset: every field Fill would fill, emptied (dropdowns set to --None--).
  const clearing = () => state.template === 'clear';
  const clearFields = () => engine.planTargets(fields).targets.map(f => ({ label: f.label, excluded: false, value: '', clear: true }));
  const summary = () => {
    if (clearing()) return `Clears ${clearFields().length} fields: everything Fill fills, including the dates. v${cfg.version}`;
    const targets = engine.planTargets(fields).targets;
    return `Fills ${targets.length} fields: ${targets.filter(f => !f.rule).length} values and ${targets.filter(f => f.rule).length} dates. ` +
      (personal ? `Your settings: ${personal} change(s) from the team defaults.` : 'Team defaults.') + ` v${cfg.version}`;
  };

  const isMock = location.protocol === 'file:' && /\/mock\/[^/]+\.html$/.test(location.pathname);
  const isSalesforce = location.protocol === 'https:' && location.hostname === 'awin.lightning.force.com';
  if ((!isMock && !isSalesforce) || document.getElementById('tca-root')) return;

  const state = { running: false, ready: false, onRecord: false, expanded: isMock, status: '', message: '', report: '', template: 'auto', style: 'panel' };
  const ORB = 52;    // the floating button's size
  const EDGE = 8;    // and how close it may get to the window's edge

  const host = document.createElement('div');
  host.id = 'tca-root';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
<style>
  :host { all: initial; }
  .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px);
    background: #fff; color: #181818; border: 1px solid #c9c9c9; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.18);
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: 0; background: none; font: inherit; font-weight: 600; cursor: pointer; text-align: left; color: inherit; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #939393; flex: none; }
  .ready .dot { background: #2e844a; }
  .found { margin-left: auto; font-weight: 400; color: #5c5c5c; font-size: 12px; }
  .body { padding: 0 12px 12px; display: grid; gap: 8px; }
  .collapsed .body { display: none; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  button.act { padding: 5px 10px; border: 1px solid #0176d3; border-radius: 4px; background: #fff; color: #0176d3; font: inherit; font-weight: 600; cursor: pointer; }
  button.act.primary { background: #0176d3; color: #fff; }
  button.act:disabled { opacity: .5; cursor: default; }
  select { font: inherit; padding: 2px 4px; }
  .status:empty { display: none; }
  .status[data-state="saved"], .status[data-state="filled"] { color: #2e844a; }
  .status[data-state="failed"], .status[data-state="unconfirmed"] { color: #ba0517; font-weight: 600; }
  textarea { width: 100%; box-sizing: border-box; height: 160px; font: 11px/1.35 ui-monospace, Menlo, Consolas, monospace; }
  .report[hidden] { display: none; }
  .note { color: #5c5c5c; font-size: 12px; }
  button.link { margin-left: auto; padding: 5px 4px; border: 0; background: none; color: #0176d3; font: inherit; text-decoration: underline; cursor: pointer; }
  [hidden] { display: none !important; }

  /* The floating button ('orb' style): the panel's blue and white, round, and movable. */
  .orb { position: fixed; z-index: 2147483000; width: ${ORB}px; height: ${ORB}px; padding: 0; border: 2px solid #fff; border-radius: 50%;
    background: #0176d3; color: #fff; display: grid; place-items: center; cursor: grab; touch-action: none;
    box-shadow: 0 4px 16px rgba(0,0,0,.18), 0 1px 3px rgba(0,0,0,.2); transition: transform .15s ease, background .15s ease; }
  .orb svg { width: 26px; height: 26px; }
  .orb::before { content: ""; position: absolute; inset: -6px; border-radius: 50%; border: 2px solid rgba(1,118,211,.25); pointer-events: none; }
  .orb .dot { position: absolute; right: -1px; top: -1px; width: 10px; height: 10px; border: 2px solid #fff; box-sizing: content-box; }
  .orb.ready .dot { background: #2e844a; }
  .wrap.open .orb, .orb:hover { background: #014486; transform: scale(1.05); }
  .orb:focus-visible { outline: 3px solid rgba(1,118,211,.45); outline-offset: 3px; }
  .wrap.dragging .orb { cursor: grabbing; transform: scale(.96); }
  .wrap.running .orb::before { border-color: rgba(1,118,211,.2); border-top-color: #0176d3; animation: tca-spin 1s linear infinite; }
  @keyframes tca-spin { to { transform: rotate(360deg); } }
  .orb-mode .panel { right: auto; bottom: auto; display: none; max-height: calc(100vh - 16px); overflow: auto; }
  .orb-mode.open:not(.dragging) .panel { display: block; }
  .orb-mode .head { cursor: default; }
  .start { display: flex; gap: 6px; flex-wrap: wrap; padding-bottom: 8px; border-bottom: 1px solid #e5e5e5; }
  .start button { flex: 1; white-space: nowrap; }
</style>
<div class="wrap">
<button class="orb" type="button" aria-label="Checklist Autofill" title="Checklist Autofill (drag to move)" hidden><span class="dot"></span>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>
</button>
<div class="panel collapsed">
  <button class="head" type="button" aria-expanded="false"><span class="dot"></span><span>Checklist Autofill</span><span class="found"></span></button>
  <div class="body">
    <div class="start" hidden>
      <button class="act moon" type="button" title="Submit the Moonpull form for this record">🌙 Scan</button>
      <button class="act ir" type="button" title="Run the Internal Review (checks and fixes the Awin UI, then reports to Chatter)">🔎 IR</button>
      <button class="act impl" type="button" title="Start the New Implementation setup">🚀 Setup</button>
    </div>
    <div class="row"><label>Template <select class="template">
      <option value="auto">Auto-detect platform</option>
      <option value="none">Default (no template)</option>
      ${templates.map(t => `<option value="${t.name}">${t.name}</option>`).join('')}
      <option value="clear">Clear checklist</option>
    </select></label></div>
    <div class="note summary"></div>
    <div class="row">
      <button class="act check" type="button">Check page</button>
      <button class="act fill" type="button">Fill only</button>
      <button class="act primary save" type="button">Fill &amp; save</button>
      <button class="link settings" type="button">Settings</button>
    </div>
    <div class="status" role="status" aria-live="polite"></div>
    <div class="report" hidden>
      <textarea readonly aria-label="Page check report"></textarea>
      <div class="row"><button class="act copy" type="button">Copy report</button><span class="note">Labels and page structure only, no field values.</span></div>
    </div>
  </div>
</div>
</div>`;

  const $ = sel => shadow.querySelector(sel);

  const orbMode = () => state.style === 'orb';
  // Fill works once the checklist is on the page, or on any implementation record: it opens the
  // Details tab and draws the checklist itself (it needn't have been scrolled to first).
  const canFill = () => state.ready || state.onRecord;

  // With the floating button, Moonfill's own row of buttons on the record (🌙 / 🔎 / 🚀, and 🔎 on a
  // Case) repeats what its menu offers, so it's moved out of sight. Not removed: Moonfill redraws a row
  // that has no size, and the menu still presses these buttons.
  const HIDE_ROW = 'tca-orb-hides-row';
  function hideMoonfillRow(on) {
    const old = document.getElementById(HIDE_ROW);
    if (!on) { if (old) old.remove(); return; }
    if (old) return;
    const style = document.createElement('style');
    style.id = HIDE_ROW;
    style.textContent = '#moonfillSalesforceSection, #moonfillCaseSection { position: fixed !important; left: -10000px !important; top: 0 !important; width: 1px !important; height: 1px !important; overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; margin: 0 !important; padding: 0 !important; }';
    (document.head || document.documentElement).appendChild(style);
  }

  function paint() {
    const wrap = $('.wrap');
    hideMoonfillRow(orbMode());
    wrap.classList.toggle('orb-mode', orbMode());
    wrap.classList.toggle('running', state.running);
    $('.orb').hidden = !orbMode();
    $('.orb').classList.toggle('ready', state.ready);
    $('.start').hidden = !orbMode();
    $('.panel').classList.toggle('collapsed', !orbMode() && !state.expanded);
    $('.panel').classList.toggle('ready', state.ready);
    $('.head').setAttribute('aria-expanded', String(orbMode() || state.expanded));
    $('.found').textContent = state.running ? 'working…' : state.ready ? `${cfg.checklistTitle} found` : state.onRecord ? 'ready' : 'checklist not found';
    $('.head').title = !state.ready && state.onRecord ? `Fill opens the record's Details and finds the ${cfg.checklistTitle} itself.` : '';
    for (const b of shadow.querySelectorAll('.fill, .save')) b.disabled = state.running || !canFill();
    for (const b of shadow.querySelectorAll('.start button')) b.disabled = state.running;
    $('.check').disabled = state.running;
    $('.template').disabled = state.running;
    $('.summary').textContent = summary();
    const status = $('.status');
    if (state.status) status.dataset.state = state.status; else delete status.dataset.state;
    status.textContent = state.message;
    $('.report').hidden = !state.report;
    $('textarea').value = state.report;
  }

  const RECORD = /\/lightning\/r\/TSE__c\/[a-zA-Z0-9]+\/view/;
  function detect() {
    if (state.running) return;
    let ready = false;
    let twice = false;
    try { engine.findChecklist(document, cfg); ready = true; } catch (error) { twice = /expected exactly one/.test(error.message); }
    // On an implementation record (or a mock), Fill can find the checklist itself, unless it's there twice.
    const onRecord = !twice && (isMock || RECORD.test(location.pathname));
    if (ready && !state.ready && !state.seen) { state.expanded = true; state.seen = true; }
    if (ready !== state.ready || onRecord !== state.onRecord) { state.ready = ready; state.onRecord = onRecord; paint(); }
  }

  // Ask the background script to read the client's site ('fetch' = invisibly, 'tab' = background tab).
  const readSite = (url, via) => Promise.resolve()
    .then(() => chrome.runtime.sendMessage({ action: 'tcaReadSite', url, via }))
    .then(answer => answer || { error: 'no answer' }, error => ({ error: error.message }));

  const say = message => { state.message = message; paint(); };

  // The template for this run: the one picked in the panel, or the detected platform's.
  // Anything unclear means no template (the default fill), with a note saying why.
  async function chooseTemplate(notes) {
    if (state.template === 'none' || clearing()) return null;
    if (state.template !== 'auto') return templates.find(t => t.name === state.template) || null;
    const site = engine.landingPageUrl(document, cfg);
    if (!site.url) { notes.push(`No template: ${site.reason}, so the default fill was used.`); return null; }
    say('Detecting the platform…');
    const page = await readSite(site.url, 'fetch');
    if (page.error === 'permission') { notes.push('No template: platform detection isn\'t allowed yet (turn it on in Settings), so the default fill was used.'); return null; }
    let found = page.ok ? T.detect(page.text, cfg) : { name: null, reason: page.error ? `the site couldn't be read (${page.error})` : `the site answered ${page.status}` };
    if (!found.name) {
      say('Checking the site in a background tab…');
      const tab = await readSite(site.url, 'tab');
      if (tab.ok) found = T.detect(tab.text, cfg);
    }
    if (!found.name) { notes.push(`No template: ${found.reason}, so the default fill was used.`); return null; }
    notes.push(`Detected ${found.name}: template applied.`);
    return templates.find(t => t.name === found.name) || null;
  }

  async function act(mode) {
    if (state.running) return;
    pin();   // the floating menu stays open until the result has been seen
    if (clearing() && mode === 'save' && !window.confirm(`Clear ${clearFields().length} Technical Checklist fields and save the record?`)) return;
    Object.assign(state, { running: true, status: 'running', message: mode === 'save' ? 'Filling and saving…' : 'Filling…', report: '' });
    paint();
    let result;
    const notes = [];
    try {
      await refresh();
      const template = await chooseTemplate(notes);
      if (template && state.template !== 'auto') notes.push(`${template.name} template applied.`);
      say(mode === 'save' ? 'Filling and saving…' : 'Filling…');
      const run = effective(template);
      if (clearing()) notes.push('Clear checklist:');
      result = await engine.run(document, run.cfg, clearing() ? clearFields() : run.fields, { mode });
    } catch (error) {
      result = { status: 'failed', message: `Unexpected error: ${error.message}` };
    }
    Object.assign(state, { running: false, status: result.status, message: [...notes, result.message].join(' ') });
    paint();
    detect();
    recordUsage(mode, result);
  }

  // Usage reporting: one record per Fill, sent to the background script. Only the outcome and a
  // reason code are kept from the result (usage.js turns the message into a code).
  function recordUsage(mode, result) {
    const ok = result.status === 'saved' || result.status === 'filled';
    const event = {
      tool: 'Checklist', action: mode === 'save' ? 'fill-save' : 'fill', outcome: ok ? 'success' : 'failed',
      reason: result.status === 'unconfirmed' ? 'unconfirmed' : result.message, tc: assignedTc()
    };
    Promise.resolve().then(() => chrome.runtime.sendMessage({ action: 'tcaUsage', event })).catch(() => {});
  }
  const assignedTc = () => { try { return engine.assignedTc(document, cfg); } catch { return ''; } };

  async function check() {
    let report;
    try {
      await refresh();
      await engine.reveal(document, cfg);   // the Details tab, and the checklist drawn if it isn't yet (display only)
      const template = state.template === 'auto' ? 'auto-detect (runs on Fill)' : state.template === 'none' ? 'default (no template)' : state.template;
      report = engine.checkPage(document, cfg, fields, { pageType: isMock ? 'mock page' : 'Salesforce Lightning', personal, template });
    } catch (error) {
      report = `Page check failed: ${error.message}`;
    }
    Object.assign(state, { status: '', message: 'Check complete. Nothing was changed.', report });
    paint();
  }

  async function copy() {
    const area = $('textarea');
    try {
      await navigator.clipboard.writeText(area.value);
      state.message = 'Report copied.';
    } catch {
      area.select();
      state.message = 'Report selected: press Ctrl+C (⌘C on Mac) to copy.';
    }
    $('.status').textContent = state.message;
  }

  // ---------- the floating button ('orb' style) ----------
  // Its place is kept as a share of the free space (0..1 across and down), so it stays put on screen
  // when the window is resized, and follows into other Salesforce tabs (chrome.storage.local).
  let orbPos = { rx: 1, ry: 1 };   // default: bottom right, where the panel sits
  let dragging = false;
  let closeTimer = null;
  const local = () => { try { return chrome.storage.local || null; } catch { return null; } };
  const span = () => ({ x: Math.max(1, window.innerWidth - ORB - 2 * EDGE), y: Math.max(1, window.innerHeight - ORB - 2 * EDGE) });
  function moveOrb(x, y) {
    const orb = $('.orb');
    const left = Math.max(EDGE, Math.min(x, window.innerWidth - ORB - EDGE));
    const top = Math.max(EDGE, Math.min(y, window.innerHeight - ORB - EDGE));
    orb.style.left = `${left}px`;
    orb.style.top = `${top}px`;
    placeMenu();
  }
  function placeOrb() {
    const s = span();
    moveOrb(EDGE + orbPos.rx * s.x, EDGE + orbPos.ry * s.y);
  }
  // The menu opens beside the button, towards the side of the window that has room.
  function placeMenu() {
    const orb = $('.orb');
    const menu = $('.panel');
    if (!orbMode()) { for (const k of ['left', 'right', 'top', 'bottom']) menu.style[k] = ''; return; }
    const r = orb.getBoundingClientRect();
    const left = parseFloat(orb.style.left) || r.left;
    const top = parseFloat(orb.style.top) || r.top;
    const onRight = left + ORB / 2 > window.innerWidth / 2;
    const below = top + ORB / 2 > window.innerHeight / 2;
    menu.style.left = onRight ? 'auto' : `${left + ORB + 10}px`;
    menu.style.right = onRight ? `${window.innerWidth - left + 10}px` : 'auto';
    menu.style.top = below ? 'auto' : `${top}px`;
    menu.style.bottom = below ? `${window.innerHeight - top - ORB}px` : 'auto';
  }
  const wrap = () => $('.wrap');
  const openMenu = () => { clearTimeout(closeTimer); if (!dragging && orbMode()) { wrap().classList.add('open'); placeMenu(); } };
  const closeMenu = () => { clearTimeout(closeTimer); wrap().classList.remove('open', 'pinned'); };
  const closeSoon = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (!wrap().classList.contains('pinned') && !state.running) wrap().classList.remove('open'); }, 380);
  };
  function pin() { if (orbMode()) { openMenu(); wrap().classList.add('pinned'); } }
  for (const el of ['.orb', '.panel']) {
    $(el).addEventListener('pointerenter', openMenu);
    $(el).addEventListener('pointerleave', closeSoon);
  }
  // Drag to move; a click without moving pins the menu open, or closes it.
  let start = null;
  $('.orb').addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const orb = $('.orb');
    const r = orb.getBoundingClientRect();
    const left = parseFloat(orb.style.left);
    const top = parseFloat(orb.style.top);
    start = { x: e.clientX, y: e.clientY, dx: e.clientX - (Number.isNaN(left) ? r.left : left), dy: e.clientY - (Number.isNaN(top) ? r.top : top) };
    try { $('.orb').setPointerCapture(e.pointerId); } catch { /* not supported */ }
  });
  $('.orb').addEventListener('pointermove', e => {
    if (!start) return;
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
    if (!dragging) { dragging = true; wrap().classList.add('dragging'); wrap().classList.remove('open', 'pinned'); }
    moveOrb(e.clientX - start.dx, e.clientY - start.dy);
  });
  const release = e => {
    if (!start) return;
    start = null;
    try { $('.orb').releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!dragging) { toggleMenu(); return; }
    dragging = false;
    wrap().classList.remove('dragging');
    const s = span();
    const left = parseFloat($('.orb').style.left) || EDGE;
    const top = parseFloat($('.orb').style.top) || EDGE;
    orbPos = { rx: Math.max(0, Math.min(1, (left - EDGE) / s.x)), ry: Math.max(0, Math.min(1, (top - EDGE) / s.y)) };
    const store = local();
    if (store) store.set({ tcaOrbPos: orbPos }).catch(() => {});
  };
  function toggleMenu() {
    if (wrap().classList.contains('pinned')) closeMenu();
    else pin();
  }
  $('.orb').addEventListener('pointerup', release);
  $('.orb').addEventListener('pointercancel', release);
  $('.orb').addEventListener('click', e => { if (e.detail === 0) toggleMenu(); });   // keyboard (Enter / Space)
  // A click elsewhere on the page, or Escape, closes a pinned menu.
  document.addEventListener('pointerdown', e => { if (orbMode() && wrap().classList.contains('pinned') && !e.composedPath().includes(host)) closeMenu(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && orbMode()) closeMenu(); });
  window.addEventListener('resize', () => { if (!dragging) placeOrb(); });
  try {
    const store = local();
    if (store) store.get('tcaOrbPos').then(s => { if (s && s.tcaOrbPos) { orbPos = s.tcaOrbPos; placeOrb(); } }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {   // moved in another tab: follow it
      if (area === 'local' && changes.tcaOrbPos && changes.tcaOrbPos.newValue && !dragging) { orbPos = changes.tcaOrbPos.newValue; placeOrb(); }
    });
  } catch { /* no extension storage (tests) */ }

  // Moonfill's processes, started from the floating menu by pressing its own buttons on the record,
  // so they run exactly as they do from there (🚀 opens the New Implementation setup).
  // Moonfill's button for this record: a visible one, else one that's on the page but out of sight (with
  // the floating button, Moonfill's row is moved off screen, and the browser may count it as not visible).
  function moonfillButton(cls) {
    const page = document.querySelector('.oneContent.active') || document;
    const buttons = engine.all(page, `button.${cls}`);
    const id = (location.pathname.match(/\/lightning\/r\/TSE__c\/([a-zA-Z0-9]+)\/view/) || [])[1];
    const forThisRecord = b => { const row = b.closest('#moonfillSalesforceSection'); return !row || !row.dataset.recordId || !id || row.dataset.recordId === id; };
    return buttons.find(b => engine.dom.visible(b) && forThisRecord(b)) || buttons.find(b => b.isConnected && forThisRecord(b)) || null;
  }
  // Without Moonfill's button (its row waits for parts of the record Lightning may not have drawn), the
  // setup and the Internal Review start by themselves: neither needs Moonfill for it. The scan does.
  const DIRECT = {
    'mf-impl': () => globalThis.TCASetupForm && (globalThis.TCASetupForm.open(), true),
    'mf-ir': () => globalThis.OIRHook && globalThis.OIRHook.open()
  };
  function startProcess(cls, name) {
    const button = moonfillButton(cls);
    if (button && button.disabled) { say(`${name}: ${button.title || 'not available on this record'}.`); return; }
    if (button) { closeMenu(); button.click(); return; }
    if (DIRECT[cls] && DIRECT[cls]()) { closeMenu(); return; }
    say(`Moonfill's ${name} button isn't on this record yet: wait for the record to finish loading, or reload the page.`);
  }
  $('.moon').addEventListener('click', () => startProcess('mf-moon', 'Moonpull scan'));
  $('.ir').addEventListener('click', () => startProcess('mf-ir', 'IR'));
  $('.impl').addEventListener('click', () => startProcess('mf-impl', 'New Implementation'));

  $('.head').addEventListener('click', () => { if (orbMode()) return; state.expanded = !state.expanded; paint(); });
  $('.check').addEventListener('click', check);
  $('.template').addEventListener('change', e => { state.template = e.target.value; paint(); });
  $('.fill').addEventListener('click', () => act('fill'));
  $('.save').addEventListener('click', () => act('save'));
  // Opened directly: the settings page is web-accessible on Salesforce only.
  const openPage = page => {
    try { window.open(chrome.runtime.getURL(`autofill/${page}`), '_blank'); } catch { state.message = 'Open Settings from edge://extensions → Moonfill → Details → Extension options.'; paint(); }
  };
  $('.settings').addEventListener('click', () => openPage('options.html'));
  // The background script asks for the record's Assigned TC when a Moonfill button is used here.
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.action === 'tcaAssignedTc') sendResponse({ name: assignedTc() });
      return undefined;
    });
  } catch { /* no extension messaging (tests) */ }
  settings.onChange(() => refresh().then(paint));

  (document.body || document.documentElement).appendChild(host);
  paint();
  placeOrb();
  refresh().then(paint);
  detect();
  setInterval(detect, 1500);
})();

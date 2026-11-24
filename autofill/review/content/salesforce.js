// Optimus IR on the Salesforce Implementation record (TSE__c). No UI of its own: the
// review panel and background.js ask it to
//   oirChecklist   read the record's marketing checklist, then the setup's Chatter note and the "Implementation Checklist"
//                  post as backups (first, so the panel knows if it needs the form)
//   oirStopSearch  stop the Chatter search now (the TC enters the details by hand): oirChecklist answers with what it has
//   oirRecord      read the record's fields
//   oirCollect     both (older callers)
//   oirLog         print a run's warning/error in this page's console
//   oirSfUpdate    fill fields on the Details tab and Save
//   oirPostChatter post the short report to the record's Chatter
(function () {
  if (window.__oirLoaded) return;
  window.__oirLoaded = true;
  const F = window.OIRFields;
  const C = window.OIRChecks;
  const L = window.OIRLog;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isVisible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const activeRoot = () => document.querySelector(".oneContent.active") || document;
  const recordId = () => (location.pathname.match(/\/r\/TSE__c\/([a-zA-Z0-9]{15,18})\/view/) || [])[1] || null;
  const norm = (s) => String(s || "").replace(/\s+/g, " ").replace(/\*/g, "").trim().toLowerCase();
  const first = (sel) => Array.from(activeRoot().querySelectorAll(sel)).find(isVisible) || null;
  async function waitFor(fn, ms = 15000, every = 250) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(every); }
    return null;
  }
  function realClick(el) {
    ["mousedown", "mouseup", "click"].forEach((type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
  }

  // ---------- record fields ----------
  function labelText(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll(".slds-assistive-text, lightning-helptext, abbr, button, svg").forEach((n) => n.remove());
    return norm(c.textContent);
  }
  function fieldBox(aliases, scope) {
    const want = aliases.map(norm);
    const label = Array.from((scope || activeRoot()).querySelectorAll(".test-id__field-label, .slds-form-element__label, .slds-form-element__legend"))
      .find((l) => isVisible(l) && want.includes(labelText(l)));
    return label ? label.closest(".slds-form-element") : null;
  }
  function readField(aliases) {
    const box = fieldBox(aliases);
    if (!box) return null;
    const cb = box.querySelector('input[type="checkbox"]');
    if (cb) return cb.checked ? "Yes" : "No";
    const v = box.querySelector("lightning-formatted-text, lightning-formatted-url, lightning-formatted-number, lightning-formatted-rich-text, .test-id__field-value");
    return v ? v.textContent.trim() : "";
  }
  // A user lookup (Integrator / Assigned TC): the linked name, without "Open … Preview" texts
  function readPerson(aliasList) {
    for (const a of aliasList) {
      const box = fieldBox([a]);
      if (!box) continue;
      const link = box.querySelector("force-lookup a, records-hoverable-link a, a[href*='/lightning/r/']");
      const t = link ? (link.querySelector("span:not(.slds-assistive-text)") || link).textContent.trim() : readField([a]);
      if (t) return t.replace(/^open\s+|\s+preview$/gi, "").trim();
    }
    return "";
  }
  async function openTab(value) {
    const tab = first(`a[data-tab-value="${value}"]`);
    if (tab && tab.getAttribute("aria-selected") !== "true") { realClick(tab); await sleep(1000); }
    return tab;
  }
  function expandSections() {
    activeRoot().querySelectorAll('button.slds-section__title-action[aria-expanded="false"], button.slds-accordion__summary-action[aria-expanded="false"]')
      .forEach((b) => { if (isVisible(b)) b.click(); });
  }
  async function readRecord() {
    await openTab("detailTab");
    expandSections();
    await waitFor(() => fieldBox(F.SF_RECORD.website) || fieldBox(F.SF_RECORD.dedup), 8000);
    const sf = {};
    for (const [k, aliases] of Object.entries(F.SF_RECORD)) sf[k] = k === "integrator" ? readPerson(aliases) : readField(aliases);
    if (!/^\d+$/.test(String(sf.awinId || ""))) {
      const link = Array.from(activeRoot().querySelectorAll('a[href*="ui.awin.com/dashboard/awin/advertiser/"]')).find(isVisible);
      const m = link && /advertiser\/(\d+)/.exec(link.href);
      sf.awinId = m ? m[1] : (String(sf.awinId || "").match(/\d+/) || [""])[0];
    }
    if (!sf.name) {
      const t = first('[slot="primaryField"], .slds-page-header__title');
      sf.name = t ? t.textContent.trim() : document.title.split("|")[0].trim();
    }
    return { sf };
  }

  // ---------- the "Implementation Checklist" Chatter post ----------
  const FEED_ITEMS = "article.cuf-feedElement, .cuf-feedItem, .forceChatterFeedItem, [data-type='FeedItem'], .slds-feed__item, .cuf-commentItem, .forceChatterComment";
  const FEED_ROOT = ".cuf-feed, .forceChatterFeed, .slds-feed, .forceChatterFeedBody, [class*='feedContainer'], [class*='Feed']";
  const feedCount = () => activeRoot().querySelectorAll(FEED_ITEMS).length;
  const buttonsIn = (re, scope) => Array.from((scope || activeRoot()).querySelectorAll("button, a, [role='button']"))
    .filter((b) => isVisible(b) && re.test(b.textContent.trim()));
  // The feed is ready when no spinner shows in it and the number of posts stays the same for 1.5 s
  async function feedSettled(maxMs = 10000) {
    const end = Date.now() + maxMs;
    let last = -1, since = Date.now();
    while (Date.now() < end) {
      const n = feedCount();
      const spinning = Array.from(activeRoot().querySelectorAll(".slds-spinner, lightning-spinner, [class*='spinner']")).some((e) => isVisible(e) && e.closest(FEED_ROOT));
      if (n !== last) { last = n; since = Date.now(); }
      if (!spinning && n > 0 && Date.now() - since >= 1500) return n;
      await sleep(250);
    }
    return feedCount();
  }
  // Older posts: the FEED's own "Show more posts" button (never a record "More" menu), and scrolling
  // to the end of the feed (infinite scroll). Collapsed comments are opened too.
  async function loadOlderPosts() {
    const before = feedCount();
    for (const b of buttonsIn(/^(view|show) (\d+ )?(more|all|previous) comments?$|^(mostrar|ver) mais coment/i)) if (b.closest(FEED_ITEMS)) realClick(b);
    const more = buttonsIn(/^(show more posts|more posts|load more( posts)?|show more|view more|mostrar mais|ver mais)$/i)
      .filter((b) => !b.closest(FEED_ITEMS) && (b.closest(FEED_ROOT) || /posts/i.test(b.textContent))
        && !b.closest("[class*='action'], [class*='Action'], .slds-dropdown-trigger, .slds-page-header, header"));
    if (more.length) realClick(more[more.length - 1]);
    const items = activeRoot().querySelectorAll(FEED_ITEMS);
    const last = items[items.length - 1];
    try { if (last) last.scrollIntoView({ block: "end" }); } catch (e) { /* not available */ }
    const scroller = last && last.closest(".slds-scrollable_y, .forceChatterScroller, [class*='scroller'], .oneContent");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    try { window.scrollTo(0, document.body.scrollHeight); } catch (e) { /* not available */ }
    await waitFor(() => feedCount() > before, 8000, 250);
    await feedSettled(6000);
    return feedCount() > before;
  }
  // <br> and block elements become line breaks (innerText does this in Chrome)
  function textWithBreaks(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    c.querySelectorAll("p, div, li").forEach((b) => b.append("\n"));
    return c.textContent || "";
  }
  // Every post/comment with a title among those loaded, newest first, with its text after the title
  const seen = new WeakMap();
  async function postsTitled(title) {
    const items = Array.from(activeRoot().querySelectorAll(FEED_ITEMS)).filter((el) => title.test(el.textContent));
    const inner = items.filter((el) => !items.some((o) => o !== el && el.contains(o)));
    const out = [];
    for (const item of inner) {
      if (!seen.has(item)) {
        const more = Array.from(item.querySelectorAll("button, a")).find((b) => isVisible(b) && /^(show more|more|mostrar mais)$/i.test(b.textContent.trim()));
        if (more) { realClick(more); await sleep(600); }
        const body = item.querySelector(".cuf-feedBodyText, .feedBodyInner, .cuf-body, [class*='feedBody'], .cuf-commentBody") || item;
        seen.set(item, body.innerText || textWithBreaks(body));
      }
      const text = seen.get(item);
      const i = text.search(title);
      if (i >= 0) out.push({ item, text: text.slice(i) });
    }
    return out;
  }
  async function checklistCandidates() {
    return (await postsTitled(F.CHECKLIST_TITLE)).map((c) => Object.assign(c, { parsed: C.parseChecklist(c.text.replace(F.CHECKLIST_TITLE, "")) }));
  }
  // AutoSetup prototype: the setup's own Chatter note ("New Implementation setup for MID …"), the
  // review's source of truth. The newest one for this MID (or any MID when it isn't known yet).
  async function setupNotes(mid) {
    return (await postsTitled(F.SETUP_NOTE_TITLE)).map((c) => Object.assign(c, { note: C.parseSetupNote(c.text) }))
      .filter((c) => c.note && (!mid || !c.note.mid || c.note.mid === String(mid)));
  }
  // AutoSetup prototype: the record's marketing checklist, the same fields the setup reads. The setup's
  // own reader and labels are used when they're on the page (they are, unless this tab was opened before
  // the extension was loaded); otherwise this script's own reader, with F.SF_CHECKLIST.
  async function readMarketingChecklist() {
    await openTab("detailTab");
    expandSections();
    const E = window.TCAEngine, cfg = window.TCA_CONFIG;
    const setup = cfg && cfg.setupRecord ? { offer: cfg.platformOfferLabel, commissionType: cfg.setupRecord.commissionType,
      commissionAmount: cfg.setupRecord.commissionAmount, validationPeriod: cfg.setupRecord.validationPeriod } : {};
    const labels = Object.fromEntries(Object.entries(F.SF_CHECKLIST).map(([k, list]) => [k, [setup[k], ...list].filter(Boolean)]));
    const found = (label) => (E && cfg ? E.recordField(document, cfg, label) : []).length > 0 || !!fieldBox([label]);
    const read = (label) => {
      const hit = E && cfg ? E.recordField(document, cfg, label).find((f) => f.text) : null;
      return hit ? hit.text.trim() : (readField([label]) || "").trim();
    };
    // Details already drawn (any field label showing): a moment for the checklist's section; else up to 6 s
    const drawn = !!Array.from(activeRoot().querySelectorAll(".test-id__field-label, .slds-form-element__label")).find(isVisible);
    await waitFor(() => Object.values(labels).some((list) => list.some(found)), drawn ? 1500 : 6000);
    const raw = {};
    for (const [k, list] of Object.entries(labels)) raw[k] = list.map(read).find(Boolean) || "";
    const parsed = C.parseRecordChecklist(raw);
    L.info("checklist", "the record's marketing checklist:", raw, "→", parsed.inputs);
    return parsed.inputs;
  }

  // First the record's marketing checklist (the same fields the setup reads), then Chatter for the
  // backups. It stays on Chatter until it has what the review needs, or the feed ends:
  // - the setup note (offer, commission and validation period as set, the pages that needed a look), and
  // - an "Implementation Checklist" post for what neither says (the contract's publisher approval), or
  //   for everything when there is nothing else.
  // With complete inputs, it stops after one round that loads nothing new (the rest is only a bonus
  // then). Only then does the panel read the record's other fields.
  let stopSearch = false;   // set by oirStopSearch: the TC is entering the details by hand
  async function readChecklist(mid) {
    stopSearch = false;
    const record = await readMarketingChecklist();
    const fromRecord = !!record.recordChecklist;
    await openTab("collaborateTab");
    await waitFor(() => stopSearch || feedCount(), 15000, 250);
    if (!stopSearch) await feedSettled();
    let found = await checklistCandidates();
    let notes = await setupNotes(mid);
    const best = () => found.find((c) => !c.parsed.missing.length) || found.slice().sort((a, b) => a.parsed.missing.length - b.parsed.missing.length)[0] || null;
    const merged = () => C.mergeInputs(best() ? best().parsed.inputs : {}, notes[0] ? notes[0].note : null, record);
    const approvalKnown = () => found.some((c) => typeof c.parsed.inputs.autoApprove === "boolean");
    // complete, and: with a setup note, the contract's approval too; without one, a checklist post
    // (complete from the record alone, it keeps looking for the setup note)
    const enough = () => !merged().missing.length && (notes.length ? approvalKnown() : found.length > 0);
    let rounds = 0, stale = 0;
    while (!stopSearch && !enough() && rounds < 30 && stale < (!merged().missing.length ? 1 : 3)) {
      rounds++;
      L.info("checklist", notes.length
        ? `setup note found${merged().missing.length ? ` but missing ${merged().missing.join(", ")}` : ""}: looking for an "Implementation Checklist" post too (${rounds})`
        : found.length
          ? `"Implementation Checklist" found but incomplete (missing ${found[0].parsed.missing.join(", ")}): looking for an older, complete one or the setup note (${rounds})`
          : `not in the ${feedCount()} post(s) loaded yet: loading older posts (${rounds})`);
      const grew = await loadOlderPosts();
      stale = grew ? 0 : stale + 1;
      found = await checklistCandidates();
      notes = await setupNotes(mid);
    }
    const pick = best(), note = notes[0] || null;
    if (!pick && !note && !fromRecord) {
      L.info("checklist", `nothing on the record's marketing checklist, and no setup note and no "Implementation Checklist" in the ${feedCount()} post(s) of this record's Chatter (feed end reached): the panel shows the form`);
      return { found: false, posts: feedCount(), stopped: stopSearch };
    }
    const m = merged();
    try { if (note || pick) (note || pick).item.scrollIntoView({ block: "center" }); } catch (e) { /* not available */ }
    if (note) L.info("checklist", `setup note${fromRecord ? " (the backup)" : ""}:`, note.text.trim());
    if (pick) L.info("checklist", `"Implementation Checklist" post${rounds ? ` after ${rounds} round(s) of older posts` : ""}:`, pick.text.trim());
    L.info("checklist", "inputs:", m.inputs);
    if (m.differences.length) L.warn("checklist", "the sources differ:", m.differences);
    if (m.missing.length) L.warn("checklist", "missing (the panel asks for them):", m.missing.join(", "));
    return { found: true, inputs: m.inputs, missing: m.missing, differences: m.differences, posts: feedCount(),
      setupNote: note ? { mid: note.note.mid, offer: note.note.offer, needsLook: note.note.needsLook, notStarted: note.note.notStarted } : null,
      checklistPost: !!pick, recordChecklist: fromRecord, stopped: stopSearch };
  }

  // ---------- Chatter post (from Moonfill's postToChatter) ----------
  // Types "@Name" and picks the person from Chatter's mention list, so they get notified
  async function insertMention(editor, name) {
    const options = () => Array.from(document.querySelectorAll('[role="option"], .cuf-mentionsListItem, li.forceMentionsListItem, .mention-item, .slds-listbox__option'))
      .filter((o) => isVisible(o) && norm(o.textContent).includes(norm(name).split(" ")[0]));
    const mentioned = () => editor.querySelector(".ql-mention, .mention, [data-mention], a[data-id], span[data-value]");
    for (const query of [name, name.split(" ")[0]]) {
      document.execCommand("insertText", false, "@" + query);
      const list = await waitFor(() => options().length && options(), 5000, 200);
      const pick = list && (list.find((o) => norm(o.textContent).includes(norm(name))) || list[0]);
      if (pick) { realClick(pick.querySelector("a, span") || pick); await sleep(500); if (mentioned()) return true; }
      if (query === name.split(" ")[0]) break;
      for (let i = 0; i <= query.length; i++) document.execCommand("delete"); // remove "@query" and try the first name
    }
    L.warn("chatter", `could not pick ${name} from the mention list: left as plain text (no notification)`);
    return false;
  }

  async function postToChatter(text, mention) {
    if (document.visibilityState !== "visible") return { ok: false, retry: true, error: "the record tab is not visible" };
    const findEditor = () => first(".forceChatterMessageBodyInputRichTextEditor .ql-editor");
    const findPlaceholder = () => Array.from(activeRoot().querySelectorAll("span.bBody")).find((el) => el.textContent.trim() === "Share an update..." && isVisible(el)) || null;
    let editor = findEditor(), placeholder = editor ? null : findPlaceholder();
    if (!editor && !placeholder) {
      const tab = await waitFor(() => first('a[data-tab-value="collaborateTab"]'), 15000);
      if (!tab) return { ok: false, error: "Chatter tab not found on this record" };
      if (tab.getAttribute("aria-selected") !== "true") realClick(tab);
      await waitFor(() => (editor = findEditor()) || (placeholder = findPlaceholder()), 15000);
      if (!editor && !placeholder) return { ok: false, retry: true, error: 'the "Share an update..." box did not appear' };
    }
    if (!editor) { realClick(placeholder.closest("button") || placeholder); editor = await waitFor(findEditor, 10000); }
    if (!editor) return { ok: false, retry: true, error: "the Chatter editor did not open" };
    await sleep(400);
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    text.split("\n").forEach((line, i) => { if (i) document.execCommand("insertParagraph"); if (line) document.execCommand("insertText", false, line); });
    if (!editor.textContent.trim()) return { ok: false, retry: true, error: "could not insert the text" };
    let mentioned = null;
    if (mention && mention.name) {
      document.execCommand("insertParagraph");
      mentioned = await insertMention(editor, mention.name);
      if (mention.note) document.execCommand("insertText", false, " " + mention.note);
    }
    const share = await waitFor(() => first("button.cuf-publisherShareButton.qe-textPostDesktop:not([disabled])"), 8000);
    if (!share) return { ok: false, retry: true, error: "the Share button stayed disabled" };
    share.click();
    const done = await waitFor(() => !document.contains(editor) || !editor.textContent.trim() || share.disabled, 15000);
    return done ? { ok: true, mentioned } : { ok: false, error: "clicked Share but could not confirm the post" };
  }

  // ---------- Salesforce field update (from Moonfill's Techfill) ----------
  const SAVE = 'button[name="SaveEdit"]', CANCEL = 'button[name="CancelEdit"]';
  const visibleAll = (sel) => Array.from(activeRoot().querySelectorAll(sel)).filter(isVisible);
  function setNative(el, v) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
  function comboOptions(btn) {
    const scope = btn.closest(".slds-combobox") || btn.closest(".slds-form-element") || activeRoot();
    return Array.from(scope.querySelectorAll('[role="option"], lightning-base-combobox-item')).filter(isVisible);
  }
  const optText = (o) => norm((o.querySelector(".slds-truncate, .slds-media__body") || o).textContent);
  async function setCombobox(btn, value) {
    if (norm(btn.textContent) === norm(value)) return "same";
    for (let i = 0; i < 2; i++) {
      btn.click();
      const opt = await waitFor(() => comboOptions(btn).find((o) => optText(o) === norm(value) || norm(o.getAttribute("data-value")) === norm(value)), 2500, 150);
      if (opt) { realClick(opt); await sleep(200); return "set"; }
      if (btn.getAttribute("aria-expanded") === "true") btn.click();
      await sleep(250);
    }
    return `option "${value}" not in the list`;
  }
  async function setField({ labels, kind }, raw) {
    const box = fieldBox(labels);
    if (!box) return "notfound";
    const pick = box.querySelector('button[role="combobox"], input[type="checkbox"], select');
    // "auto": a picklist/checkbox gets Yes/No, a text field gets the value itself
    const value = kind === "auto" && pick ? (raw ? "Yes" : "No") : raw;
    if (kind === "auto" && !pick && !raw) return "same";
    const combo = box.querySelector('button[role="combobox"]');
    if (combo) return setCombobox(combo, value);
    const cb = box.querySelector('input[type="checkbox"]');
    if (cb) { const want = /^yes$/i.test(value); if (cb.checked === want) return "same"; cb.click(); return "set"; }
    const sel = box.querySelector("select");
    if (sel) {
      const o = Array.from(sel.options).find((x) => norm(x.text) === norm(value));
      if (!o) return `option "${value}" not in the list`;
      if (sel.value === o.value) return "same";
      sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return "set";
    }
    const input = box.querySelector("textarea, input:not([type='hidden']):not([type='checkbox'])");
    if (input && kind === "date") {
      // value is YYYY-MM-DD; typed in the format chosen in Options (default DD/MM/YYYY)
      const [y, mo, d] = String(value).split("-");
      const { oirDateFormat = "DD/MM/YYYY" } = await chrome.storage.local.get("oirDateFormat");
      const typed = oirDateFormat === "MM/DD/YYYY" ? `${mo}/${d}/${y}` : `${d}/${mo}/${y}`;
      if (input.value.trim()) return "same"; // only fills a blank date
      setNative(input, typed);
      input.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
      return "set";
    }
    if (input && kind !== "yesno") { if (input.value.trim() === value) return "same"; setNative(input, value); return "set"; }
    return "no editable control";
  }
  // AutoSetup prototype: the record's edit lock (<html data-awin-edit-lock>) is shared with Moonfill's
  // Moonpull fill and the Checklist Autofill, so two of them never edit the record at once. Waits up to
  // 30 s for the other one to finish, then holds the lock while it edits.
  const LOCK = "awinEditLock";
  async function updateFields(rid, updates) {
    const html = document.documentElement;
    const free = await waitFor(() => !html.dataset[LOCK], 30000, 250);
    if (!free) return { ok: false, retry: true, error: html.dataset[LOCK] === "moonfill" ? "Moonfill is filling this record from a Moonpull scan" : "another fill is still working on this record" };
    const token = "internal-review-" + Math.random().toString(36).slice(2, 8);
    html.dataset[LOCK] = token;
    try { return await updateFieldsUnlocked(rid, updates); }
    finally { if (html.dataset[LOCK] === token) delete html.dataset[LOCK]; }
  }
  async function updateFieldsUnlocked(rid, updates) {
    if (recordId() !== rid) return { ok: false, error: "the tab is not on the expected record" };
    if (document.visibilityState !== "visible") return { ok: false, retry: true, error: "the record tab is not visible" };
    if (visibleAll(SAVE).length) return { ok: false, error: "the record is already in edit mode (unsaved edits?)" };
    await openTab("detailTab");
    expandSections();
    await sleep(400);
    const trigger = visibleAll("button.test-id__inline-edit-trigger")[0];
    if (!trigger) return { ok: false, error: "no edit pencil on the Details tab" };
    trigger.click();
    if (!(await waitFor(() => visibleAll(SAVE)[0], 8000))) return { ok: false, error: "edit mode did not open" };
    await sleep(400);
    const rep = { ok: true, set: [], same: [], notfound: [], problem: [] };
    for (const u of updates) {
      const def = F.SF_UPDATES[u.key];
      if (!def) continue;
      const r = await setField(def, u.value || "");
      if (r === "set") rep.set.push(u.field);
      else if (r === "same") rep.same.push(u.field);
      else if (r === "notfound") rep.notfound.push(u.field);
      else rep.problem.push(`${u.field}: ${r}`);
    }
    if (!rep.set.length) { const c = visibleAll(CANCEL)[0]; if (c) c.click(); return rep; }
    visibleAll(SAVE)[0].click();
    const closed = await waitFor(() => !visibleAll(SAVE).length, 12000);
    if (!closed) { rep.ok = false; rep.error = "Save did not complete (required field or validation rule?)"; }
    return rep;
  }

  // ---------- messages ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.action !== "string") return;
    let p = null;
    const rid0 = recordId();
    const base = () => ({ recordId: rid0, recordUrl: `${location.origin}/lightning/r/TSE__c/${rid0}/view` });
    if (msg.action === "oirLog") {
      L[msg.level === "error" ? "error" : msg.level === "warn" ? "warn" : "info"](msg.ctx || "run", ...(msg.args || []));
      return;
    }
    if (msg.action === "oirChecklist") {
      p = rid0 ? readChecklist(msg.mid).then((checklist) => ({ ok: true, ...base(), checklist })) : Promise.resolve({ ok: false, error: "not an Implementation record" });
    } else if (msg.action === "oirStopSearch") {
      if (!stopSearch) L.info("checklist", "the TC is entering the details by hand: the Chatter search stops");
      stopSearch = true;
      p = Promise.resolve({ ok: true });
    } else if (msg.action === "oirRecord") {
      p = rid0 ? readRecord().then((rec) => { L.info("record", "fields read:", rec.sf); return { ok: true, ...base(), ...rec }; })
        : Promise.resolve({ ok: false, error: "not an Implementation record" });
    } else if (msg.action === "oirCollect") {
      p = (async () => {
        const rid = recordId();
        if (!rid) return { ok: false, error: "not an Implementation record" };
        const checklist = await readChecklist();
        const rec = await readRecord();
        return { ok: true, recordId: rid, recordUrl: `${location.origin}/lightning/r/TSE__c/${rid}/view`, ...rec, checklist };
      })();
    } else if (msg.action === "oirSfUpdate") p = updateFields(msg.recordId, msg.updates || []);
    else if (msg.action === "oirPostChatter") p = recordId() === msg.recordId ? postToChatter(msg.text, msg.mention) : Promise.resolve({ ok: false, error: "the tab is not on the expected record" });
    else if (msg.action === "oirPing") p = Promise.resolve({ ok: true, recordId: recordId() });
    if (!p) return;
    p.then((res) => {
      if (res && res.ok === false) L.error(msg.action, res.error || res);
      else if (res && (res.problem || []).length) L.warn(msg.action, "fields with problems:", res.problem);
      if (res && (res.notfound || []).length) L.warn(msg.action, "Salesforce fields not found on the Details tab:", res.notfound);
      sendResponse(res);
    }, (e) => { L.error(msg.action, e); sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    return true;
  });
})();

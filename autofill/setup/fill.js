// Programme setup, stage 3 (page side): fills one Awin UI setup page from the values entered in the
// setup form, then saves it. Driven by the background script, one page at a time:
//   { action: 'tcaSetupFill', values, save }  →  { status: 'skipped' | 'filled' | 'saving' | 'failed', message }
//   { action: 'tcaSetupVerify', values }       →  { status: 'saved' | 'unconfirmed' | 'failed', message }
// Fields are found by their id where the page check showed a stable one, otherwise by their visible
// text (label or option), so pages whose structure the check couldn't see still work.
(function (root) {
  const { all, cleanText, visible, closest, norm, setNative, clickLikeUser, waitFor, sleep } = root.TCAEngine.dom;
  const NOISE = '.sr-only, .visually-hidden, script, style, svg';
  const CONTROL = 'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="checkbox"], [role="switch"]';
  const TRIGGER = '.ng-select, mat-select, .mat-select, .mat-mdc-select, .select2-container, .chosen-container, .p-dropdown, [role="combobox"], [aria-haspopup="listbox"], select';
  const OPTION = '[role="option"], .ng-option, mat-option, .mat-option, .mat-mdc-option, .select2-results__option, .dropdown-item, .p-dropdown-item, li';
  const ERROR = '.alert-danger, .alert-error, .error-message, .toast-error, .notification-error, [role="alert"].error';
  const SUCCESS = '.alert-success, .toast-success, .notification-success';

  // Timings (ms). quiet: how long the page must stop changing before it counts as loaded.
  const T = { quiet: 1200, quietMax: 15000, recheck: 1500 };

  // Waits until the page has stopped changing (its data has arrived and been drawn), or quietMax.
  function settled() {
    return new Promise(resolve => {
      let timer;
      const observer = new root.MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, T.quiet); });
      const done = () => { observer.disconnect(); clearTimeout(cap); resolve(); };
      const cap = setTimeout(done, T.quietMax);
      observer.observe(doc().documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      timer = setTimeout(done, T.quiet);
    });
  }

  class SetupError extends Error {}
  const fail = message => { throw new SetupError(message); };

  // Page 1's Default Query String Append. Access: source=aw on a supported e-commerce platform (or when
  // the site couldn't be checked), utm_source=awin when the site check found none. Others: the long one.
  const PLATFORM_APPEND = {
    Access: 'source=aw',
    accessNoPlatform: 'utm_source=awin',
    other: 'source=aw&utm_source=awin&sv1=affiliate&sv_campaign_id=!!!id!!!'
  };
  const PLUGIN = { name: 'R.O.EYE - Consent - SingleView', code: 'AWIN.Tracking.RoEye = AWIN.Tracking.RoEye || {};' };
  const PUBLISHERS = ['45628', '111'];

  // ---------- finding things ----------

  const doc = () => root.document;
  const shown = selector => all(doc().body, selector).filter(visible).filter(el => !closest(el, '#tca-setup-root'));
  const same = (a, b) => norm(a).replace(/[:?]$/, '') === norm(b).replace(/[:?]$/, '');
  // Awin's account switcher ("Provider Area", Go To Advertiser Account, Submit) is on every page.
  const inSwitcher = el => !!(closest(el, 'form') && closest(el, 'form').querySelector('[name="switchId"]'));
  const byId = id => { const el = doc().getElementById(id); return el && visible(el) ? el : null; };

  // The smallest visible element whose own text is exactly this label.
  function labelElement(text) {
    const hits = shown('label, span, div, p, td, th, dt, h3, h4, h5, legend, strong, b').filter(el => same(cleanText(el, NOISE), text));
    return hits.find(el => !hits.some(other => other !== el && el.contains(other))) || null;
  }

  // The first control after a label: its "for" target, or the next matching element in page order
  // within the label's surroundings (up to four levels up).
  function controlAfter(label, selector) {
    if (label.tagName === 'LABEL' && label.htmlFor) { const t = doc().getElementById(label.htmlFor); if (t && t.matches(selector)) return t; }
    const inside = all(label, selector).filter(visible)[0];
    if (inside) return inside;
    for (let n = label, depth = 0; n && depth < 4; n = n.parentElement, depth++) {
      const after = all(n.parentElement || n, selector).filter(visible).find(el => label.compareDocumentPosition(el) & 4);
      if (after) return after;
    }
    return null;
  }

  function fieldByLabel(text, selector = CONTROL) {
    const native = shown('input, select, textarea').find(el => el.labels && [...el.labels].some(l => same(cleanText(l, NOISE), text)));
    if (native && native.matches(selector)) return native;
    const label = labelElement(text);
    return label ? controlAfter(label, selector) : null;
  }

  // ---------- changing things (each one checks it worked) ----------

  async function setText(el, value, name) {
    if (!el) fail(`"${name}" not found on the page.`);
    if (el.disabled || el.readOnly) fail(`"${name}" can't be edited.`);
    if (el.isContentEditable) {
      el.focus();
      doc().execCommand('selectAll', false, null);
      doc().execCommand('insertText', false, value);
    } else {
      setNative(el, value);
    }
    const now = el.isContentEditable ? el.textContent : el.value;
    if (now.trim() !== String(value).trim()) fail(`"${name}" didn't keep its new value.`);
  }

  // Where code goes: a code editor (CodeMirror, Ace, Monaco) or a plain text box, inside scope.
  const EDITORS = [
    ['.cm-editor', '.cm-content', 'CodeMirror'],
    ['.CodeMirror', 'textarea', 'CodeMirror'],
    ['.ace_editor', 'textarea', 'Ace'],
    ['.monaco-editor', 'textarea', 'Monaco']
  ];
  function codeBox(scope) {
    for (const [wrap, input, kind] of EDITORS) {
      const editor = all(scope, wrap).filter(visible).pop();
      const el = editor && all(editor, input)[0];
      if (el) return { el, editor, kind };
    }
    const free = el => visible(el) && !inSwitcher(el) && !el.disabled && !el.readOnly;
    const box = all(scope, 'textarea, [contenteditable="true"]').filter(free).pop()
      || (scope !== doc().body && all(scope, 'input[type="text"], input:not([type])').filter(free).filter(el => !/search|filter/i.test(`${el.name} ${el.placeholder} ${el.className}`)).pop());
    return box ? { el: box, editor: null, kind: box.tagName === 'TEXTAREA' ? 'text box' : box.isContentEditable ? 'editable box' : 'single-line text box' } : null;
  }
  // The box titled "Set-up" in the plugin's settings: where the code goes.
  const EDITOR_WRAP = EDITORS.map(([wrap]) => wrap).join(', ');
  function setupBox() {
    for (const title of ['Set-up', 'Setup', 'Set up']) {
      const label = labelElement(title);
      const el = label && controlAfter(label, `${EDITOR_WRAP}, textarea, [contenteditable="true"], input[type="text"], input:not([type])`);
      if (!el) continue;
      const wrap = closest(el, EDITOR_WRAP);
      if (wrap) {
        const [, input, kind] = EDITORS.find(([w]) => wrap.matches(w));
        const inner = all(wrap, input)[0];
        if (inner) return { el: inner, editor: wrap, kind: `"${title}" ${kind} editor` };
      }
      if (el.disabled || el.readOnly) continue;
      return { el, editor: null, kind: `"${title}" ${el.tagName === 'TEXTAREA' ? 'text box' : el.isContentEditable ? 'editable box' : 'single-line text box'}` };
    }
    return null;
  }
  const findCodeBox = () => setupBox() || codeBox(pluginScope || doc().body) || codeBox(doc().body);

  // Asks the background script to set an editor's text from the page's own side (where the editor's
  // controls live). The editor is marked with an attribute so it can be found there.
  async function setThroughEditor(editor, code) {
    if (!root.chrome || !root.chrome.runtime || !root.chrome.runtime.sendMessage) return { error: 'not available' };
    editor.setAttribute('data-tca-code-target', '');
    try { return await root.chrome.runtime.sendMessage({ action: 'tcaSetupSetEditor', code }); }
    catch (error) { return { error: error.message }; }
    finally { editor.removeAttribute('data-tca-code-target'); }
  }

  const squash = text => String(text ?? '').replace(/[\s\u00a0\u200b]+/g, '');
  // For a code editor, only what it shows counts: its hidden input box can hold typed text it ignored.
  const codeShown = box => squash(box.editor ? cleanText(box.editor, NOISE) : box.el.isContentEditable ? box.el.textContent : box.el.value).includes(squash(PLUGIN.code));

  // Types code the way a person would (so editors and page frameworks register it), falling back to
  // setting the value directly where typing isn't available.
  function typeCode(box, code) {
    const { el } = box;
    el.focus();
    let typed = false;
    try {
      if (typeof doc().execCommand === 'function') {
        if (el.select && !box.editor) el.select(); else doc().execCommand('selectAll', false, null);
        typed = doc().execCommand('insertText', false, code);
      }
    } catch { typed = false; }
    if (!typed || !codeShown(box)) {
      if (el.isContentEditable) el.textContent = code;
      else setNative(el, code);
    }
  }

  // Something clickable by its text: a button or link, or (for prompts drawn as plain text) the
  // smallest visible element showing exactly that text.
  function clickableText(text) {
    const b = button(text);
    if (b) return b;
    const hits = shown('span, a, u, strong, b, div, p, label, small').filter(el => same(cleanText(el, NOISE), text));
    return hits.find(el => !hits.some(other => other !== el && el.contains(other))) || null;
  }

  // A short description of a box, to show in the run's results.
  function describeBox(box) {
    const el = box.editor || box.el;
    const label = (el.labels && el.labels[0] && cleanText(el.labels[0], NOISE)) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    const name = el.id ? `#${el.id}` : el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : el.className ? `.${String(el.className).trim().split(/\s+/)[0]}` : '';
    return `${box.kind} ${el.tagName.toLowerCase()}${name}${label ? ` "${label.slice(0, 40)}"` : ''}`;
  }

  function ensureChecked(el, name) {
    if (!el) fail(`"${name}" not found on the page.`);
    if (el.disabled) fail(`"${name}" can't be changed.`);
    if (!el.checked) clickLikeUser(el);
    if (!el.checked) fail(`"${name}" didn't stay ticked.`);
  }

  // A radio button whose label starts with the option's text.
  function chooseRadio(groupName, option) {
    const radios = [...doc().querySelectorAll(`input[type="radio"][name="${groupName}"]`)];
    if (!radios.length) fail(`The "${option}" choice wasn't found on the page.`);
    const radio = radios.find(r => [...(r.labels || [])].some(l => norm(cleanText(l, NOISE)).startsWith(norm(option))));
    if (!radio) fail(`Option "${option}" isn't available.`);
    if (!radio.checked) clickLikeUser(radio);
    if (!radio.checked) fail(`"${option}" didn't stay selected.`);
  }

  function chooseNative(select, option, name) {
    const match = [...select.options].find(o => same(o.text, option));
    if (!match) fail(`"${name}": option "${option}" isn't available. Options shown: ${[...select.options].map(o => o.text.trim()).filter(Boolean).join(', ')}.`);
    setNative(select, match.value);
    if (select.value !== match.value) fail(`"${name}" didn't keep "${option}".`);
  }

  // A dropdown: native, or built from plain elements (click it open, then click the option's text).
  async function choose(trigger, option, name) {
    if (!trigger) fail(`"${name}" not found on the page.`);
    if (trigger.tagName === 'SELECT') return chooseNative(trigger, option, name);
    const opened = async () => waitFor(() => shown(OPTION).find(o => same(cleanText(o, NOISE), option)), 3000);
    let item = null;
    for (let attempt = 0; attempt < 2 && !item; attempt++) {   // the first click is sometimes swallowed
      clickLikeUser(all(trigger, 'input')[0] || trigger);
      item = await opened();
    }
    if (!item) fail(`"${name}": option "${option}" didn't appear when the dropdown was opened.`);
    clickLikeUser(item);
    await sleep(200);
    if (!norm(cleanText(trigger, NOISE)).includes(norm(option)) && !(trigger.value && same(trigger.value, option))) {
      fail(`"${name}" doesn't show "${option}" after choosing it.`);
    }
  }

  // The dropdown, anywhere on the page, that offers this option.
  async function chooseAnywhere(option, name) {
    const select = shown('select').find(s => [...s.options].some(o => same(o.text, option)));
    if (select) { chooseNative(select, option, name); return select; }
    for (const trigger of shown(TRIGGER)) {
      try { await choose(trigger, option, name); return trigger; } catch { doc().body.click(); /* close it and try the next one */ }
    }
    fail(`No dropdown on the page offers "${option}".`);
  }

  // A visible button or link by its text. Leading symbols ("+ Add…") are ignored; an exact match wins,
  // otherwise the shortest one containing the text (for multi-word labels only).
  function button(texts, scope = doc().body) {
    const wanted = [].concat(texts).map(norm);
    const words = b => norm(cleanText(b, NOISE) || b.value || b.getAttribute('aria-label') || b.title).replace(/^[^a-z0-9]+/, '');
    const candidates = all(scope, 'button, input[type="submit"], input[type="button"], a, [role="button"], [role="link"]').filter(visible)
      .filter(b => !closest(b, '#tca-setup-root') && !inSwitcher(b));
    for (const want of wanted) {
      const exact = candidates.find(b => words(b) === want);
      if (exact) return exact;
    }
    const partial = candidates.filter(b => wanted.some(w => w.includes(' ') && words(b).includes(w)));
    return partial.sort((a, b) => words(a).length - words(b).length)[0] || null;
  }

  async function clickSave(el, name, upToDate) {
    if (!el) fail(`The ${name} button wasn't found.`);
    const off = () => el.disabled || el.classList.contains('btn-disabled');
    if (off()) {
      await waitFor(() => !off(), 5000);
      // Save stays greyed out when nothing changed: fine if the page already shows every value.
      if (off() && upToDate && upToDate()) return { status: 'saved', message: 'Already up to date: nothing needed saving.' };
      if (off()) fail(`The ${name} button stayed disabled: the page didn't register the changes.`);
    }
    // Answer first: a classic form reloads the page as soon as it's submitted.
    setTimeout(() => clickLikeUser(el), 100);
    return { status: 'saving', message: `${name} clicked.` };
  }

  const errorShown = () => shown(ERROR).map(e => cleanText(e, NOISE)).find(Boolean);
  const successShown = () => shown(SUCCESS).map(e => cleanText(e, NOISE)).find(Boolean);

  // ---------- the pages, in the order New Implementation opens them ----------

  // v.ecommerce (from the site check on the record): true = a supported platform, false = none found,
  // undefined = not checked.
  const append = v => (v.platformOffer !== 'Access' ? PLATFORM_APPEND.other : v.ecommerce === false ? PLATFORM_APPEND.accessNoPlatform : PLATFORM_APPEND.Access);

  // ---------- Commission groups: a table of boxes ----------

  const BOX = `${TRIGGER}, input:not([type="hidden"]), textarea, [contenteditable="true"]`;
  const ROW = 'tr, [role="row"], .ag-row, .row, .grid-row';
  const CELL = 'td, th, [role="gridcell"], [role="cell"], .ag-cell';
  // The cells of a row that hold a box, in order, each with its main control (a dropdown first).
  function boxCells(row) {
    const cells = all(row, CELL).filter(c => closest(c.parentElement, ROW) === row || c.parentElement === row);
    const list = (cells.length ? cells : [...row.children]).filter(visible);
    return list.map(cell => ({ cell, el: all(cell, TRIGGER).filter(visible)[0] || all(cell, BOX).filter(visible)[0] })).filter(c => c.el);
  }
  // The row to fill: one with at least six boxes; if several, the one whose sixth box is still empty.
  function commissionRow() {
    const rows = shown(ROW).filter(r => !inSwitcher(r) && boxCells(r).length >= 6 && !shown(ROW).some(inner => inner !== r && r.contains(inner) && boxCells(inner).length >= 6));
    if (rows.length < 2) return rows[0] || null;
    return rows.find(r => { const sixth = boxCells(r)[5].el; return 'value' in sixth && sixth.value === ''; }) || rows[rows.length - 1];
  }
  // Transaction Type, Commission Type, Publisher Commission: by their column headings when the
  // table has them, otherwise boxes 4, 5 and 6 of the row.
  function commissionBoxes(row) {
    const cells = boxCells(row);
    const table = closest(row, 'table, [role="grid"], [role="table"], .ag-root');
    const heads = table ? all(table, 'th, [role="columnheader"], .ag-header-cell').filter(visible) : [];
    const rowCells = all(row, CELL).filter(c => closest(c.parentElement, ROW) === row || c.parentElement === row).filter(visible);
    const byHeading = ['Transaction Type', 'Commission Type', 'Publisher Commission'].map(text => {
      const i = heads.findIndex(h => same(cleanText(h, NOISE), text));
      const cell = i >= 0 && heads.length === rowCells.length ? rowCells[i] : null;
      return cell && cells.find(c => c.cell === cell);
    });
    const picked = byHeading.every(Boolean) ? byHeading : cells.slice(3, 6);
    const [t, c, p] = picked.map(x => x && x.el);
    const rate = p && (p.matches('input, textarea, [contenteditable="true"]') ? p : all(p.parentElement, 'input:not([type="hidden"])')[0]);
    return [t, c, rate];
  }

  // What page 3 looks like, for the run's results when it fails: structure only, no values.
  let commissionLog = [];
  const describeEl = el => {
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(c => '.' + c).join('');
    return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${cls}`;
  };
  const chain = el => { const out = []; for (let n = el; n && n !== doc().body && out.length < 6; n = n.parentElement) out.push(describeEl(n)); return out.join(' < '); };
  function describeCommissionPage() {
    const parts = [...commissionLog];
    for (const title of ['Transaction Type', 'Commission Type', 'Publisher Commission']) {
      const el = labelElement(title);
      parts.push(el ? `"${title}" heading: ${chain(el)}` : `no "${title}" heading`);
    }
    const kinds = el => (el.tagName === 'INPUT' ? `input:${el.type || 'text'}` : describeEl(el));
    const rows = shown(ROW).filter(r => !inSwitcher(r)).map(r => ({ r, boxes: all(r, BOX).filter(visible) })).filter(x => x.boxes.length && !inSwitcher(x.r));
    if (isAgGrid()) {
      const idx = agRowIndexes();
      parts.push(`ag-Grid: ${idx.length} row(s); columns ${shown('.ag-header-cell[col-id]').map(h => `${h.getAttribute('col-id')}="${cleanText(h.querySelector('.ag-header-cell-text') || h, NOISE)}"`).join(', ')}`);
      if (idx.length) parts.push(`row ${idx[0]} cells: ${agCells(idx[0]).map(c => `${c.getAttribute('col-id')}${c.classList.contains('ag-cell-inline-editing') ? '(editing)' : ''}${all(c, BOX).filter(visible).length ? '(box)' : ''}`).join(', ')}`);
    }
    parts.push(`${rows.length} row(s) with boxes`);
    for (const { r, boxes } of rows.slice(0, 6)) parts.push(`row ${describeEl(r)}: ${boxes.length} box(es) [${boxes.slice(0, 8).map(kinds).join(', ')}]`);
    const loose = shown(BOX).filter(el => !inSwitcher(el) && !closest(el, ROW));
    if (loose.length) parts.push(`${loose.length} box(es) outside any row: ${loose.slice(0, 8).map(el => `${kinds(el)} in ${chain(el.parentElement)}`).join(' | ')}`);
    parts.push(diagnostics());
    return parts.join('; ').replace(/\d{4,}/g, '#');
  }

  // ---------- Commission groups as an ag-Grid (spreadsheet-like) table ----------
  // Cells only become boxes when they're being edited: click (or double-click) a cell, type or pick,
  // then Enter. Columns are matched by heading (col-id), else by position (4th, 5th, 6th).

  const isAgGrid = () => !!shown('.ag-root, .ag-root-wrapper').length;
  const press = (el, key) => {
    const win = el.ownerDocument.defaultView;
    for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new win.KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }));
  };
  const agRowIndexes = () => [...new Set(shown('.ag-row[row-index]').map(r => r.getAttribute('row-index')))];
  const agCells = index => shown(`.ag-row[row-index="${index}"] .ag-cell[col-id]`)
    .sort((a, b) => (+a.getAttribute('aria-colindex') || 0) - (+b.getAttribute('aria-colindex') || 0));
  function agColumns(index) {
    const ids = ['Transaction Type', 'Commission Type', 'Publisher Commission'].map(title => {
      const head = shown('.ag-header-cell[col-id]').find(h => same(cleanText(h.querySelector('.ag-header-cell-text') || h, NOISE), title));
      return head && head.getAttribute('col-id');
    });
    if (ids.every(Boolean)) return ids;
    return agCells(index).slice(3, 6).map(c => c.getAttribute('col-id'));
  }
  const agCell = (index, colId) => shown(`.ag-row[row-index="${index}"] .ag-cell[col-id="${colId}"]`)[0] || null;
  // The editor that opened for a cell: inside it, or in a popup.
  function agEditor(cell) {
    const inside = all(cell, 'select, input:not([type="hidden"]):not([type="checkbox"]), textarea').filter(visible)[0];
    if (inside) return inside;
    const popup = shown('.ag-popup-editor, .ag-popup .ag-rich-select, .ag-select-list').pop();
    return popup ? (all(popup, 'select, input:not([type="hidden"])').filter(visible)[0] || popup) : null;
  }
  const agOptions = () => shown('.ag-rich-select-row, .ag-list-item, .ag-select-list-item, [role="option"]');
  const editing = cell => cell.classList.contains('ag-cell-inline-editing') || cell.classList.contains('ag-cell-popup-editing') || !!agEditor(cell);
  const shownIn = (cell, value) => {
    const text = cleanText(cell, NOISE);
    if (same(text, value)) return true;
    const n = parseFloat(String(value).replace(',', '.'));
    return !Number.isNaN(n) && parseFloat(text.replace(',', '.').replace(/[^\d.-]/g, '')) === n;
  };

  async function agEdit(index, colId, value, name) {
    let cell = agCell(index, colId);
    if (!cell) fail(`The "${name}" cell wasn't found in the commission table.`);
    if (shownIn(cell, value)) { commissionLog.push(`${name} already "${value}"`); return false; }
    if (cell.scrollIntoView) cell.scrollIntoView({ block: 'nearest', inline: 'center' });
    const win = cell.ownerDocument.defaultView;
    clickLikeUser(cell);
    let editor = await waitFor(() => agEditor(cell), 800);
    if (!editor) { cell.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true, cancelable: true })); editor = await waitFor(() => agEditor(cell), 1500); }
    if (!editor) { if (cell.focus) cell.focus(); press(cell, 'Enter'); editor = await waitFor(() => agEditor(cell), 1500); }
    if (!editor) fail(`The "${name}" cell didn't open for editing (it may be read-only until Edit Commission Groups is clicked).`);
    if (editor.tagName === 'SELECT') {
      chooseNative(editor, value, name);
      press(editor, 'Enter');
    } else if (editor.tagName === 'INPUT' || editor.tagName === 'TEXTAREA') {
      const option = () => agOptions().find(o => same(cleanText(o, NOISE), value));
      if (agOptions().length && !option()) { gridType(editor, value); await sleep(300); }   // a searchable list
      if (option()) clickLikeUser(option());
      else return agTypeAndCommit(index, colId, value, name, editor);
    } else {
      const option = await waitFor(() => agOptions().find(o => same(cleanText(o, NOISE), value)), 1500);
      if (!option) fail(`"${name}": option "${value}" isn't available. Options shown: ${agOptions().map(o => cleanText(o, NOISE)).join(', ') || 'none'}.`);
      clickLikeUser(option);
    }
    await waitFor(() => { cell = agCell(index, colId) || cell; return !editing(cell); }, 2000);
    if (editing(cell)) { press(agEditor(cell) || cell, 'Enter'); await sleep(300); }
    const kept = await waitFor(() => shownIn(agCell(index, colId) || cell, value), 2000);
    if (!kept) fail(`"${name}" doesn't show "${value}" after editing the cell.`);
    commissionLog.push(`${name} set to "${value}"`);
    return true;
  }

  // Puts text into a grid editor's box without leaving it (leaving can end the edit before the value
  // is in): the box's own value setter, then the input events a framework listens for.
  function gridType(el, value) {
    const win = el.ownerDocument.defaultView;
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement : win.HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, String(value));
    el.dispatchEvent(new win.InputEvent('input', { bubbles: true, composed: true, data: String(value), inputType: 'insertText' }));
    for (const type of ['keyup', 'change']) el.dispatchEvent(new win.Event(type, { bubbles: true }));
  }

  // Masked number boxes reformat what they're given: Awin's fills in from the right like a till, so
  // "5" becomes 0.05%. Tries the shapes such a box may expect (5.00, 500, 5) until it holds the number,
  // judged by what the box shows. Text that isn't a number is put in as it is.
  const numberIn = text => parseFloat(String(text ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
  async function typeNumberInto(editor, value) {
    const n = numberIn(value);
    if (Number.isNaN(n) || !/^\s*-?[\d.,]+\s*%?\s*$/.test(String(value))) { gridType(editor, value); return true; }
    for (const shape of [n.toFixed(2), String(Math.round(n * 100)), String(value).trim()]) {
      gridType(editor, '');
      gridType(editor, shape);
      await sleep(150);
      if (numberIn(editor.value) === n) return true;
    }
    return false;
  }

  // A typed cell: tries the ways a grid finishes an edit (Enter, then Tab) until the cell
  // shows the value. What each try left in the cell goes into the report if none works.
  async function agTypeAndCommit(index, colId, value, name, firstEditor) {
    const cellNow = () => agCell(index, colId);
    const tries = [];
    const reopen = async () => {
      const cell = cellNow();
      if (!cell) return null;
      const win = cell.ownerDocument.defaultView;
      if (agEditor(cell)) return agEditor(cell);
      cell.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return waitFor(() => agEditor(cellNow() || cell), 1500);
    };
    // Clicking away isn't one of the ways: on Awin's grid it throws the edit away.
    const ways = [
      ['Enter', el => press(el, 'Enter')],
      ['Tab', el => press(el, 'Tab')]
    ];
    for (const [how, finish] of ways) {
      const editor = tries.length ? await reopen() : firstEditor;
      if (!editor) { tries.push(`${how}: the cell didn't open again`); continue; }
      const kind = `${describeEl(editor)}${editor.type ? `[type=${editor.type}]` : ''}`;
      const typed = await typeNumberInto(editor, value);
      const held = editor.value;
      if (!typed) { tries.push(`${how} in ${kind}: the box wouldn't hold ${value} (it held "${held}")`); press(editor, 'Escape'); await sleep(300); continue; }
      finish(editor);
      await waitFor(() => { const c = cellNow(); return c && !editing(c); }, 1500);
      const c = cellNow();
      if (c && shownIn(c, value)) { commissionLog.push(`${name} set to "${value}" (${how})`); return true; }
      tries.push(`${how} in ${kind} (box held "${held}"): cell shows "${c ? cleanText(c, NOISE) : '(gone)'}"`);
    }
    commissionLog.push(`${name}: ${tries.join('; ')}`);
    fail(`"${name}" doesn't show "${value}" after editing the cell.`);
  }

  async function agCommission(v) {
    const before = agRowIndexes();
    for (const name of ['Add Default Commission Group', 'Edit Commission Groups']) {
      const open = button(name);
      commissionLog.push(open ? `clicked "${name}" (${describeEl(open)})` : `no "${name}" button`);
      if (!open) continue;
      clickLikeUser(open);
      await sleep(1000);
      await settled();
      break;
    }
    const rows = agRowIndexes();
    if (!rows.length) fail('The commission table has no rows to fill in.');
    // A newly added row if there is one; otherwise the row whose Publisher Commission is empty; else the first.
    const added = rows.filter(i => !before.includes(i));
    const columns = agColumns(added[0] || rows[0]);
    if (columns.length < 3) fail(`The commission table has ${agCells(rows[0]).length} column(s); expected at least 6.`);
    const index = added[0] || rows.find(i => { const c = agCell(i, columns[2]); return c && !cleanText(c, NOISE); }) || rows[0];
    commissionLog.push(`row ${index} of ${rows.length}, columns ${columns.join(', ')}`);
    let changed = 0;
    changed += await agEdit(index, columns[0], v.transactionType, 'Transaction Type');
    changed += await agEdit(index, columns[1], v.commissionType, 'Commission Type');
    changed += await agEdit(index, columns[2], v.publisherCommission, 'Publisher commission');
    // Nothing to change means nothing to save (Save stays greyed out): that's not a failure.
    if (!changed) return { status: 'skipped', message: 'Already set to these values: nothing to save.' };
    // Give the page a moment to register the edits before Save (clicking away would undo an edit).
    await sleep(800);
    return { note: commissionLog.filter(l => / set to /.test(l)).join(', ') + '.' };
  }

  let pluginScope = null;   // the plugin menu, once open

  // Page 9's Validation Period Days: the record's period, plus 7 for Access (where it was empty).
  // Access: the contract's days + 7. Otherwise the contract's days, except 0 days, which Awin takes as -1
  // (the user's rule, 2026-11-19, the same as the Internal Review's).
  const advertiserDays = v => String(v.platformOffer === 'Access' ? +v.validationDays + 7 : +v.validationDays === 0 ? -1 : +v.validationDays);

  // Page 1's fields: by id (from the page check), or by label if the id differs.
  const TRACKING = [
    ['MainWebsiteURL', 'Website URL', 'text'],
    ['GlobalClickThroughPage', 'Landing Page', 'text'],
    ['ClickAppend', 'Default Query String Append', 'text'],
    ['DeeplinkEnabled', 'Enable Link Builder for publishers', 'tick'],
    ['NoDomainDeeplink', 'Use relative URLs for deep links', 'tick']
  ];
  const trackingField = (id, label, kind) => byId(id) || fieldByLabel(label, kind === 'text' ? 'input:not([type="hidden"]):not([type="checkbox"]), textarea' : 'input[type="checkbox"]');
  const trackingValues = v => ({ MainWebsiteURL: v.websiteUrl, GlobalClickThroughPage: v.landingPage, ClickAppend: append(v) });

  const PAGES = [
    {
      key: 'tracking', name: 'Tracking settings', match: /\/tracking-settings\/.*\/main-settings/,
      // The values come from the setup form (Salesforce); here they're typed into the page's boxes.
      // The page draws its form a moment after loading, so wait for the boxes before giving up.
      async fill(v) {
        const missing = () => TRACKING.filter(([id, label, kind]) => !trackingField(id, label, kind)).map(([, label]) => label);
        await waitFor(() => !missing().length, 15000);
        if (missing().length) fail(`${missing().map(l => `"${l}"`).join(', ')} not found on the page (waited 15 s for it to load).`);
        const values = trackingValues(v);
        const write = async () => {
          for (const [id, label, kind] of TRACKING) {
            if (kind === 'text') await setText(trackingField(id, label, kind), values[id], label);
            else ensureChecked(trackingField(id, label, kind), label);
          }
        };
        await write();
        // If the page loads its saved settings over ours, write them again once.
        await sleep(T.recheck);
        if (!this.verify(v).every(Boolean)) { await settled(); await write(); await sleep(T.recheck); }
        const wrong = TRACKING.filter((f, i) => !this.verify(v)[i]).map(([, label]) => label);
        if (wrong.length) fail(`${wrong.join(', ')} kept changing back after being filled.`);
        // A new address shows a warning under its box with "Add to Accepted Domains": click each one.
        const prompt = () => clickableText('Add to Accepted Domains');
        await waitFor(prompt, 2000);
        let added = 0;
        for (let p = prompt(); p && added < 6; p = prompt()) {
          clickLikeUser(p);
          added++;
          await waitFor(() => prompt() !== p || !p.isConnected, 2000);
          await sleep(300);
        }
        if (prompt()) fail('"Add to Accepted Domains" was clicked but is still showing.');
        return added ? { note: `Added to Accepted Domains ${added === 1 ? 'once' : `${added} times`}.` } : null;
      },
      save: () => button('Save'),
      verify: v => {
        const values = trackingValues(v);
        return TRACKING.map(([id, label, kind]) => { const el = trackingField(id, label, kind); return el && (kind === 'text' ? el.value === values[id] : el.checked); });
      }
    },
    { key: 'invite', name: 'Invite user', match: /\/settings\/invite-user/, skip: () => 'comes pre-filled' },
    {
      key: 'commission', name: 'Commission groups', match: /\/commission-manager\/.*\/commission-groups/,
      skip: v => v.commissionSkip || null,
      // A table: column headings on top, a row of boxes underneath. In that row, boxes 1–3 are left
      // alone and boxes 4, 5, 6 are Transaction Type, Commission Type and Publisher Commission.
      // The row appears after clicking "Add Default Commission Group".
      async fill(v) {
        if (v.commissionProblem) fail(v.commissionProblem);
        await waitFor(() => isAgGrid() || commissionRow() || button(['Add Default Commission Group', 'Edit Commission Groups']), 10000);
        commissionLog = [];
        if (isAgGrid()) return agCommission(v);
        for (const name of ['Add Default Commission Group', 'Edit Commission Groups']) {
          if (commissionRow()) break;
          const open = button(name);
          commissionLog.push(open ? `clicked "${name}" (${describeEl(open)})` : `no "${name}" button`);
          if (open) { clickLikeUser(open); await waitFor(commissionRow, 8000); await sleep(500); }
        }
        const row = commissionRow();
        if (!row) fail('The row of commission boxes didn\'t appear after clicking Add Default Commission Group.');
        const [transaction, commission, rate] = commissionBoxes(row);
        await choose(transaction, v.transactionType, 'Transaction Type');
        await choose(commission, v.commissionType, 'Commission Type');
        await setText(rate, v.publisherCommission, 'Publisher commission');
      },
      save: () => button(['Save', 'Save changes', 'Update', 'Confirm']),
      // The grid shows no confirmation after saving; no error shown counts as saved.
      verify: () => [!errorShown()],
      diagnose: () => describeCommissionPage()
    },
    {
      key: 'plugin', name: 'Plugin store', match: /\/advertiser-mastertag\/.*\/plugins/,
      skip: v => (v.platformOffer === 'Access' ? 'not needed for Access' : null),
      async fill() {
        const stay = button('Stay here for now');
        if (stay) { clickLikeUser(stay); await sleep(500); }
        const add = button('Add Plugin');
        if (!add) fail('The Add Plugin button wasn\'t found.');
        clickLikeUser(add);
        await waitFor(() => shown(TRIGGER).length, 5000);
        const dropdown = await chooseAnywhere(PLUGIN.name, 'Plugin');
        // The plugin's settings (with the code box) are drawn after the plugin is chosen.
        pluginScope = closest(dropdown, '[role="dialog"], .modal-content, .modal, form, .panel, .card, section') || doc().body;
        await sleep(1000);
        const box = await waitFor(findCodeBox, 8000);
        if (!box) fail('The plugin\'s code box wasn\'t found after choosing the plugin.');
        typeCode(box, PLUGIN.code);
        // The page sometimes redraws the form just after: check the code is still there, and retype once.
        await sleep(1000);
        const again = findCodeBox();
        if (!again || !codeShown(again)) { if (again) typeCode(again, PLUGIN.code); await sleep(500); }
        let now = findCodeBox();
        let how = 'typed into';
        // A code editor in a background tab ignores typing (it only listens while focused): set the
        // code through the editor itself instead, from the page's own side.
        if (now && now.editor && !codeShown(now)) {
          const answer = await setThroughEditor(now.editor, PLUGIN.code);
          await sleep(500);
          now = findCodeBox();
          how = `set through the editor (${answer && (answer.editor || answer.error) || 'no answer'}) in`;
        }
        if (!now || !codeShown(now)) fail(`The plugin code didn't stay in the ${box.kind} (${describeBox(now || box)}).`);
        return { note: `Code ${how}: ${describeBox(now)}.` };
      },
      save: () => button(['Save', 'Add', 'Add Plugin', 'Confirm', 'Submit', 'Install'], pluginScope || doc().body),
      // The plugin store shows no confirmation after saving (it saves fine in live runs): no error
      // shown counts as saved. Only after Save: a greyed-out Save still fails here.
      noConfirmation: true
    },
    {
      key: 'tag', name: 'Tracking tag settings', match: /\/advertiser-mastertag\/.*\/trackingtagsettings/,
      async fill() {
        await waitFor(() => shown(TRIGGER).length, 8000);
        await chooseAnywhere('Conversion Tag and Image Pixel integrated', 'Tracking tag');
      },
      save: () => button(['Save', 'Save changes', 'Update']),
      // This page shows no confirmation after saving; no error shown counts as saved.
      verify: () => [!errorShown()]
    },
    {
      key: 'account', name: 'Account details', match: /\/merchant-settings\/.*\/account-details/,
      async fill() {
        for (const id of ['ipTrackingEnabled', 'referer_truncation_isDomainIncludeInvalid']) if (!byId(id)) fail(`"${id}" tick box not found on the page.`);
        ensureChecked(byId('ipTrackingEnabled'), 'Enable IP tracking');
        ensureChecked(byId('referer_truncation_isDomainIncludeInvalid'), 'Strip path information if referrer has no valid domain');
      },
      save: () => byId('tracking-masterdata-submit'),
      verify: () => [byId('ipTrackingEnabled')?.checked, byId('referer_truncation_isDomainIncludeInvalid')?.checked]
    },
    { key: 'fee', name: 'Fee manager', match: /\/finance\/fee-manager\//, skip: () => 'comes pre-filled' },
    {
      key: 'mobile', name: 'Mobile tracking', match: /\/merchant-settings\/.*\/mobile-tracking/,
      async fill() { chooseRadio('strategy', 'Tracking is implemented on mobile site'); },
      save: () => byId('updateChanges'),
      verify: () => [[...doc().querySelectorAll('input[name="strategy"]')].some(r => r.checked && [...(r.labels || [])].some(l => norm(cleanText(l, NOISE)).startsWith(norm('Tracking is implemented on mobile site'))))]
    },
    {
      key: 'advertiser', name: 'Advertiser settings', match: /\/provider\/migrated-advertiser-settings\//,
      async fill(v) {
        const approval = fieldByLabel('Approval of Publishers Joining', 'select');
        const days = fieldByLabel('Validation Period Days', 'input');
        if (!approval) fail('"Approval of Publishers Joining" not found on the page.');
        if (!days) fail('"Validation Period Days" not found on the page.');
        // Validation Period Days: the record's "Auto validation period". For Access it's usually set
        // already: left alone unless it's empty or -1, when it becomes the record's period + 7.
        const now = String(days.value).trim();
        const unset = now === '' || now === '-1';
        if (v.platformOffer === 'Access' && !unset) {
          chooseNative(approval, v.approval, 'Approval of Publishers Joining');
          return { note: `Validation Period Days already set (${now}): left as it is.` };
        }
        if (!/^\d+$/.test(String(v.validationDays))) fail('"Auto validation period" is empty on the record, so Validation Period Days couldn\'t be set.');
        const target = advertiserDays(v);
        chooseNative(approval, v.approval, 'Approval of Publishers Joining');
        await setText(days, target, 'Validation Period Days');
        return v.platformOffer === 'Access' ? { note: `Validation Period Days was empty: set to ${v.validationDays} + 7 = ${target}.` } : null;
      },
      save: () => byId('migrated_advertiser_settings_save') || button('Save'),
      verify: v => {
        const approval = fieldByLabel('Approval of Publishers Joining', 'select');
        const days = String(fieldByLabel('Validation Period Days', 'input')?.value ?? '').trim();
        const daysOk = v.platformOffer === 'Access' ? days !== '' && days !== '-1' : days === advertiserDays(v);
        return [approval && same(approval.selectedOptions[0]?.text, v.approval), daysOk];
      }
    },
    {
      key: 'prejoin', name: 'Pre-join publishers', match: /\/provider\/pre-join-publishers/,
      async fill() {
        const boxes = PUBLISHERS.map(id => [id, publisherBox(id)]);
        const missing = boxes.filter(([, box]) => !box).map(([id]) => id);
        if (missing.length === PUBLISHERS.length) return { status: 'skipped', message: `Already pre-joined: publishers ${PUBLISHERS.join(' and ')} have no tick box.` };
        if (missing.length) fail(`Publisher ${missing.join(', ')} not found with a tick box.`);
        for (const [id, box] of boxes) ensureChecked(box, `Publisher ${id}`);
        return null;
      },
      save: () => {
        const box = publisherBox(PUBLISHERS[0]) || publisherBox(PUBLISHERS[1]);
        const form = box && closest(box, 'form');
        return (form && [...form.querySelectorAll('button, input[type="submit"]')].find(b => visible(b) && norm(cleanText(b, NOISE) || b.value) === 'submit')) || null;
      },
      verify: () => [!PUBLISHERS.some(id => { const box = publisherBox(id); return box && !box.checked; })]
    }
  ];

  // The tick box in the row (table row, list item…) whose cell shows exactly this publisher ID.
  function publisherBox(id) {
    for (const box of shown('input[type="checkbox"]')) {
      if (box.value === id) return box;
      const row = closest(box, 'tr, li, [role="row"], .row');
      if (row && all(row, 'td, th, span, a, div, label').some(c => cleanText(c, NOISE) === id)) return box;
    }
    return null;
  }

  const pageFor = () => PAGES.find(p => p.match.test(root.location.pathname));

  // A sign-in form shown in place of the setup page (a password box), whatever the address says.
  const signInForm = () => shown('input[type="password"]').length > 0;

  async function fillPage(values, save) {
    const page = pageFor();
    if (signInForm()) return { status: 'signin', message: 'Awin\'s sign-in form is showing.', login: true };
    if (!page) {
      const path = root.location.pathname.replace(/\d{4,}/g, '#');
      if (/authori[sz]e|login|signin|sign-in|prelogin|\/idp\/|\/oidc|\/sso|callback/i.test(path)) return { status: 'signin', message: `Awin's sign-in page is showing (${path}).`, login: /login/i.test(path) };
      return { status: 'failed', message: `This page isn't one of the setup pages (${path}).` };
    }
    const why = page.skip && page.skip(values);
    if (why) return { status: 'skipped', message: `Skipped: ${why}.`, page: page.key };
    try {
      await settled();
      const early = await page.fill(values);
      const note = early && early.note;
      if (early && early.status) return { ...early, page: page.key };
      if (!save) return { status: 'filled', message: `Filled, not saved: check it, then save it yourself.${note ? ' ' + note : ''}`, page: page.key, note };
      const upToDate = page.verify && (() => { try { return page.verify(values).every(Boolean); } catch { return false; } });
      return { ...(await clickSave(page.save(), 'Save', upToDate)), page: page.key, note };
    } catch (error) {
      return { status: 'failed', message: error instanceof SetupError ? error.message : `Unexpected error: ${error.message}`, page: page.key, diagnostics: page.diagnose ? page.diagnose() : diagnostics() };
    }
  }

  async function verifyPage(values) {
    const page = pageFor();
    if (!page) return { status: 'failed', message: 'The page changed to something unexpected after saving.' };
    await sleep(500);
    const error = errorShown();
    if (error) return { status: 'failed', message: `The page shows an error: ${error.slice(0, 200)}`, page: page.key };
    const checks = page.verify ? page.verify(values) : [];
    if (checks.length && checks.every(Boolean)) return { status: 'saved', message: 'Saved and checked.', page: page.key };
    if (!checks.length && successShown()) return { status: 'saved', message: 'Saved.', page: page.key };
    if (!checks.length && page.noConfirmation) return { status: 'saved', message: 'Saved (this page shows no confirmation; no error was shown).', page: page.key };
    return { status: 'unconfirmed', message: checks.length ? 'Saved, but the page doesn\'t show every value afterwards: check it.' : 'Save was clicked; the page showed no confirmation: check it.', page: page.key };
  }

  // What the page looked like when a field couldn't be found: frames are the usual reason.
  function diagnostics() {
    const frames = [...doc().querySelectorAll('iframe')].map(f => {
      let readable = false;
      try { readable = !!(f.contentDocument && f.contentDocument.body); } catch { /* another site */ }
      const r = f.getBoundingClientRect();
      return `${readable ? 'readable' : 'not readable'} frame ${Math.round(r.width)}×${Math.round(r.height)}`;
    });
    return `${shown(CONTROL).length} visible controls, ${shown(TRIGGER).length} dropdowns; ${frames.length ? frames.join(', ') : 'no frames'}`;
  }

  // Marks the tab so the result is visible in the tab strip.
  function mark(symbol) {
    doc().title = `${symbol} ${doc().title.replace(/^[✓⚠⏭✎] /, '')}`;
  }

  root.TCASetupFill = { T, PAGES, PLATFORM_APPEND, PLUGIN, PUBLISHERS, fillPage, verifyPage, pageFor, mark };

  if (root.top !== root || !root.chrome || !root.chrome.runtime || !root.chrome.runtime.onMessage) return;
  root.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return undefined;
    if (message.action === 'tcaSetupFill') { fillPage(message.values, message.save).then(sendResponse); return true; }
    if (message.action === 'tcaSetupVerify') { verifyPage(message.values).then(sendResponse); return true; }
    if (message.action === 'tcaSetupMark') { mark(message.symbol); sendResponse({ ok: true }); return undefined; }
    return undefined;
  });
})(globalThis);

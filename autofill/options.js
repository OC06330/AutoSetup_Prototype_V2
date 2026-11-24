// The settings page for the four tools (Shared, Moonfill, Checklist Autofill, AutoSetup, Internal Review).
// This script runs the shared settings and the checklist's: one row per field (team default + the user's
// choice). The Internal Review's block is run by review/options-section.js.
// The date format is shared: saved at once, for the checklist (tcaSettings.dateFormat) and the review
// (oirDateFormat). The bar's Save and Reset are for the checklist fields only.
(function () {
  const fields = globalThis.TCA_FIELDS;
  const cfg = globalThis.TCA_CONFIG;
  const S = globalThis.TCASettings;
  const $ = id => document.getElementById(id);

  const CHOICES = [
    ['', 'Team default'],
    ['skip', 'Leave untouched'],
    ['value', 'Fill with…'],
    ['created', 'Record creation date'],
    ['today', "Today's date"]
  ];

  function row(f) {
    const tr = document.createElement('tr');
    tr.dataset.label = f.label;
    const td = (cls, ...kids) => { const c = document.createElement('td'); c.className = cls; c.append(...kids); return c; };

    const select = document.createElement('select');
    select.className = 'mode';
    select.setAttribute('aria-label', `Your choice for ${f.label}`);
    // Date fields get date choices instead of free text (Salesforce reformats typed dates);
    // "leave untouched" only where the default fills something.
    for (const [mode, text] of CHOICES) {
      if ((mode === 'created' || mode === 'today') && !f.rule) continue;
      if (mode === 'value' && f.rule) continue;
      if (mode === 'skip' && f.excluded) continue;
      select.append(new Option(text, mode));
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'value';
    input.setAttribute('aria-label', `Value for ${f.label}`);
    input.placeholder = f.value || 'Value, exactly as shown in Salesforce';
    const sync = () => { input.hidden = select.value !== 'value'; tr.classList.toggle('changed', select.value !== ''); };
    select.addEventListener('change', () => { sync(); if (select.value === 'value') input.focus(); status(''); });
    input.addEventListener('input', () => status(''));
    tr.append(td('label', f.label), td('default', S.describe(f)), td('choice', select, input));
    tr.sync = sync;
    return tr;
  }

  const menuStyle = () => (document.querySelector('input[name="menu-style"]:checked') || {}).value || 'panel';
  function show(settings) {
    for (const radio of document.querySelectorAll('input[name="menu-style"]')) radio.checked = radio.value === (settings.menuStyle || 'panel');
    $('date-format').value = settings.dateFormat || cfg.dateFormat;
    for (const tr of $('fields').children) {
      const o = (settings.fields || {})[tr.dataset.label];
      const select = tr.querySelector('.mode');
      select.value = o && [...select.options].some(opt => opt.value === o.mode) ? o.mode : '';
      tr.querySelector('.value').value = o && o.mode === 'value' ? o.value : '';
      tr.sync();
    }
  }

  function read() {
    const out = { fields: {} };
    if (menuStyle() !== 'panel') out.menuStyle = menuStyle();
    if ($('date-format').value !== cfg.dateFormat) out.dateFormat = $('date-format').value;
    for (const tr of $('fields').children) {
      const mode = tr.querySelector('.mode').value;
      if (!mode) continue;
      if (mode === 'value') {
        const value = tr.querySelector('.value').value.trim();
        if (!value) throw new Error(`Enter a value for "${tr.dataset.label}", or choose another option.`);
        out.fields[tr.dataset.label] = { mode, value };
      } else out.fields[tr.dataset.label] = { mode };
    }
    return out;
  }

  function status(text, state) {
    $('status').textContent = text;
    if (state) $('status').dataset.state = state; else delete $('status').dataset.state;
  }

  async function save() {
    try {
      const settings = read();
      await S.save(settings);
      await reviewDate($('date-format').value);
      const n = Object.keys(settings.fields).length + (settings.dateFormat ? 1 : 0);
      status(n ? `Saved. ${n} change(s) from the team defaults.` : 'Saved. Using the team defaults.', 'ok');
    } catch (error) {
      status(error.message, 'error');
    }
  }

  // only the checklist's fields: the shared menu style and date format stay as they are
  async function reset() {
    const kept = await S.load();
    show({ menuStyle: kept.menuStyle, dateFormat: kept.dateFormat });
    await save();
  }

  // the shared date format, for the Internal Review too (it reads oirDateFormat)
  const reviewDate = format => {
    try { return chrome.storage.local.set({ oirDateFormat: format }); } catch { return Promise.resolve(); }
  };

  // Platform detection: the optional "read websites" permission, granted or removed here. request()
  // must run straight from the click (no await before it), or the browser refuses to ask.
  const SITES = { origins: ['https://*/*', 'http://*/*'] };
  const permissions = () => (globalThis.chrome && chrome.permissions) || null;
  async function showDetection() {
    const p = permissions();
    const button = $('detect-toggle');
    if (!p) { $('detect-status').textContent = 'Not available on this page.'; button.hidden = true; return; }
    const on = await p.contains(SITES);
    $('detect-status').textContent = on ? 'Allowed: the tools above may read the client\'s site.' : 'Not allowed yet: the checklist uses its default fill, the setup the Landing Page URL and source=aw, and the review skips the platform check.';
    button.textContent = on ? 'Turn off' : 'Allow reading client websites';
    button.dataset.on = String(on);
    button.hidden = false;
  }
  $('detect-toggle').addEventListener('click', () => {
    const p = permissions();
    const on = $('detect-toggle').dataset.on === 'true';
    (on ? p.remove(SITES) : p.request(SITES)).catch(() => false).then(showDetection);
  });
  showDetection();

  for (const format of S.DATE_FORMATS) $('date-format').append(new Option(format, format));
  $('date-format').addEventListener('change', async () => {
    status('');
    try {
      const format = $('date-format').value;
      const saved = await S.load();
      const next = { ...saved };
      if (format !== cfg.dateFormat) next.dateFormat = format; else delete next.dateFormat;
      await S.save(next);
      await reviewDate(format);
      $('date-status').textContent = `Saved: ${format}.`;
    } catch (error) {
      $('date-status').textContent = error.message;
    }
  });
  $('fields').append(...fields.map(row));
  // The menu style is saved as soon as it's picked, on top of whatever is saved already.
  for (const radio of document.querySelectorAll('input[name="menu-style"]')) {
    radio.addEventListener('change', async () => {
      try {
        await S.save({ ...(await S.load()), menuStyle: menuStyle() });
        $('style-status').textContent = menuStyle() === 'orb' ? 'Saved: the floating button is used.' : 'Saved: the panel is used.';
      } catch (error) {
        $('style-status').textContent = error.message;
      }
    });
  }
  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', reset);
  S.load().then(show);
})();

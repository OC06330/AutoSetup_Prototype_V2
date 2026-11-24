// The Internal Review's block on the combined settings page (autofill/options.html, #review): the Region →
// page path table ({loc} in some Awin addresses) and clearing the review history. (Optimus IR's own options
// page, folded in. Its site check and date format are the page's shared settings.)
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$('oir-locs')) return;
  const local = () => (globalThis.chrome && chrome.storage && chrome.storage.local) || null;
  const say = (id, text) => { $(id).textContent = text; };

  async function showLocs() {
    const store = local();
    if (!store) return;
    const { oirRegionLoc = {} } = await store.get('oirRegionLoc');
    const body = $('oir-locs');
    body.textContent = '';
    const pairs = Object.entries(oirRegionLoc);
    if (!pairs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 3; td.className = 'muted'; td.textContent = 'None yet: us is used.';
      tr.append(td); body.append(tr);
    }
    for (const [region, loc] of pairs) {
      const tr = document.createElement('tr');
      for (const t of [region, loc]) { const td = document.createElement('td'); td.textContent = t; tr.append(td); }
      const del = document.createElement('button');
      del.type = 'button'; del.textContent = 'Remove';
      del.addEventListener('click', async () => {
        const now = (await store.get('oirRegionLoc')).oirRegionLoc || {};
        delete now[region];
        await store.set({ oirRegionLoc: now });
        say('oir-loc-status', `Removed ${region}.`);
        showLocs();
      });
      const td = document.createElement('td'); td.append(del); tr.append(td);
      body.append(tr);
    }
  }

  $('oir-add').addEventListener('click', async () => {
    const store = local();
    const region = $('oir-region').value.trim();
    const loc = $('oir-loc').value.trim().toLowerCase();
    if (!region || !/^[a-z]{2,5}$/.test(loc)) { say('oir-loc-status', 'Enter a region and a path of 2 to 5 letters (e.g. us).'); return; }
    const { oirRegionLoc = {} } = await store.get('oirRegionLoc');
    oirRegionLoc[region] = loc;
    await store.set({ oirRegionLoc });
    $('oir-region').value = ''; $('oir-loc').value = '';
    say('oir-loc-status', `Saved: ${region} → ${loc}.`);
    showLocs();
  });

  $('oir-clear').addEventListener('click', async () => {
    const store = local();
    const all = await store.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('oirRun_') && !['running', 'applying', 'salesforce'].includes(all[k].state));
    await store.remove(keys);
    say('oir-cleared', `${keys.length} review(s) removed.`);
  });

  globalThis.OIRSettingsSection = { showLocs };
  showLocs();
})();

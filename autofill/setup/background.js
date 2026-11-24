// Programme setup, stage 3 (background): runs the setup started from the 🚀 New Implementation form.
//   { action: 'tcaSetupRun', mid, values, save, only? }  →  { ok } at once; progress goes back to the record tab
//   only: the pages to do (by position), for "Retry failed pages": the others are left as they are, and
//   the tabs still open from the last run for this MID are used again.
// Opens the setup's ten pages (autofill/pages.js) as a tab group, then works through them one
// at a time: fill, save, wait for the page to settle, check. A page that fails is marked ⚠ and left
// open, unsaved, and the run carries on. Pre-join publishers is retried, as it often errors once.
(function () {
  const PAGES = ['Tracking settings', 'Invite user', 'Commission groups', 'Plugin store', 'Tracking tag settings',
    'Account details', 'Fee manager', 'Mobile tracking', 'Advertiser settings', 'Pre-join publishers'];
  const T = { load: 30000, settle: 1000, keepAlive: 20000, reloadStart: 4000, answer: 15000, retries: 5, retryWait: 3000, reloadDelay: 5000, signinWaits: 4, pageLimit: 120000 };
  // Pages reloaded before filling (by position): Tracking tag settings often doesn't load fully first time.
  const RELOAD_FIRST = new Set([4]);
  // Pages that come pre-filled (Invite user, Fee manager): opened for reference, never filled.
  const ALWAYS_SKIPPED = new Set([1, 6]);
  // The Plugin store page isn't needed for Access programmes: skipped without touching it.
  const PLUGIN_PAGE = 3;
  // Commission groups is left for the TC when the record's commission isn't a percentage.
  const COMMISSION_PAGE = 2;
  let cancelRequested = false;
  const SYMBOL = { saved: '✓', filled: '✎', skipped: '⏭', unconfirmed: '⚠', failed: '⚠' };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Resolves once the tab has finished loading (at once if it already has).
  function waitForLoad(tabId, timeout = T.load) {
    return new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
      const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
      chrome.tabs.onUpdated.addListener(onUpdated);
      timer = setTimeout(done, timeout);
      chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') done(); }, done);
    });
  }

  // After Save: a classic form reloads the page; a newer page doesn't. Wait for whichever happens.
  function waitAfterSave(tabId) {
    return new Promise(resolve => {
      let timer;
      const finish = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
      const onUpdated = (id, info) => {
        if (id !== tabId || info.status !== 'loading') return;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        waitForLoad(tabId).then(resolve);
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      timer = setTimeout(finish, T.reloadStart);
    });
  }

  // Reloads a tab and resolves once it has loaded again.
  function reload(tabId) {
    return new Promise(resolve => {
      let timer;
      const onUpdated = (id, info) => {
        if (id !== tabId || info.status !== 'loading') return;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        waitForLoad(tabId).then(resolve);
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); waitForLoad(tabId).then(resolve); }, T.reloadStart);
      chrome.tabs.reload(tabId).catch(() => {});
    });
  }

  // Message the page, retrying while its script is still starting up.
  async function ask(tabId, message) {
    const end = Date.now() + T.answer;
    for (;;) {
      try {
        const answer = await chrome.tabs.sendMessage(tabId, message);
        if (answer) return answer;
      } catch (error) {
        if (Date.now() > end) return { status: 'failed', message: `The page didn't respond (${error.message}). Is it signed in?` };
      }
      if (Date.now() > end) return { status: 'failed', message: 'The page didn\'t respond.' };
      await sleep(500);
    }
  }

  // Is this tab showing one of Awin's sign-in pages (or any page off ui.awin.com, where the setup
  // pages never are)? The content script can't answer there, so the tab's address is checked here.
  const SIGNIN_PATH = /login|signin|sign-in|\/idp\/|authori[sz]e|\/oidc|\/sso|prelogin|callback/i;
  async function onSignInPage(tabId) {
    try {
      const url = new URL((await chrome.tabs.get(tabId)).url || '');
      return url.hostname !== 'ui.awin.com' || SIGNIN_PATH.test(url.pathname);
    } catch { return false; }
  }

  // Asks the page to fill itself; if it's on Awin's sign-in pages (a redirect still going on), waits
  // for it to come back to the setup page first.
  async function fillWhenReady(tabId, values, save) {
    for (let wait = 0; ; wait++) {
      const filled = await ask(tabId, { action: 'tcaSetupFill', values, save });
      if (filled.status !== 'signin') return filled;
      if (wait >= T.signinWaits) {
        return { status: 'failed', signin: true, message: filled.login ? 'Awin asked to sign in again in this tab.' : `${filled.message} It didn't return to the setup page.` };
      }
      await waitAfterSave(tabId);   // a redirect: wait for the next page load
      await sleep(T.settle);
    }
  }

  async function runPage(tabId, values, save) {
    let result;
    for (let attempt = 1; attempt <= T.retries; attempt++) {
      const filled = await fillWhenReady(tabId, values, save);
      if (filled.status !== 'saving') return filled;
      await waitAfterSave(tabId);
      await sleep(T.settle);
      result = { ...(await ask(tabId, { action: 'tcaSetupVerify', values })), attempts: attempt };
      if (filled.note) Object.assign(result, { message: `${result.message} ${filled.note}`, note: filled.note });
      // Only Pre-join publishers is retried: it often shows an error on the first try.
      if (result.status !== 'failed' || filled.page !== 'prejoin') return result;
      if (attempt < T.retries) await sleep(T.retryWait);
    }
    return { ...result, message: `${result.message} (tried ${T.retries} times)` };
  }

  // The latest run's tabs, by page position: "Retry failed pages" uses them again, and "Sign in"
  // brings the one showing Awin's sign-in to the front.
  const last = { mid: null, tabs: [], group: null };

  async function run({ mid, values, save, only }, recordTabId) {
    const progress = update => chrome.tabs.sendMessage(recordTabId, { action: 'tcaSetupProgress', ...update }).catch(() => {});
    cancelRequested = false;
    const urls = globalThis.TCAPages ? globalThis.TCAPages.setupUrls(mid) : null;   // the setup's page list (autofill/pages.js)
    if (!urls || urls.length !== PAGES.length) {
      progress({ done: true, error: 'The list of setup pages didn\'t load, so the setup can\'t run. Reload the extension, or use "Just open the tabs".' });
      return;
    }
    const pages = Array.isArray(only) && only.length ? [...new Set(only.map(Number))].filter(i => i >= 0 && i < urls.length).sort((a, b) => a - b) : urls.map((u, i) => i);
    const retrying = Array.isArray(only) && only.length > 0;
    if (!retrying || last.mid !== mid) Object.assign(last, { mid, tabs: [], group: null });
    // Tabs open one at a time, as each page's turn comes: opening all ten at once sends some of them
    // to Awin's sign-in pages.
    // To save time, the next page is opened once the current one has loaded (its sign-in is done),
    // so it loads while the current one is being filled. Never more than one page ahead.
    const tabs = last.tabs;
    const opening = [];
    const openedAt = [];
    const ensureOpen = k => (k < pages.length ? (opening[k] = opening[k] || open(k)) : Promise.resolve(null));
    const open = async k => {
      if (k > 0) await opening[k - 1];   // keep the tabs in order
      const i = pages[k];
      let tab = null;
      if (retrying && tabs[i]) {   // a retry: the page's tab from the last run, loaded again
        try { tab = await chrome.tabs.update(tabs[i].id, { url: urls[i] }); } catch { tab = null; }
      }
      if (!tab) {
        tab = await chrome.tabs.create({ url: urls[i], active: false });
        try {
          if (last.group === null) { last.group = await chrome.tabs.group({ tabIds: [tab.id] }); await chrome.tabGroups.update(last.group, { title: `${mid} setup`, color: 'cyan' }); }
          else await chrome.tabs.group({ groupId: last.group, tabIds: [tab.id] });
        } catch { /* grouping is a nicety */ }
      }
      tabs[i] = tab;
      openedAt[i] = Date.now();
      return tab;
    };

    const results = [];
    let signedOut = false;
    // Keeps the background script awake for the whole run, even with the browser in the background.
    const awake = setInterval(() => { try { chrome.runtime.getPlatformInfo().catch(() => {}); } catch { /* not available */ } }, T.keepAlive);
    try {
    for (let k = 0; k < pages.length; k++) {
      const i = pages[k];
      progress({ index: i, name: PAGES[i], status: 'working' });
      await ensureOpen(k);
      let result;
      if (cancelRequested) {
        for (let j = k; j < pages.length; j++) progress({ index: pages[j], name: PAGES[pages[j]], status: 'cancelled', message: 'not started (cancelled)' });
        break;
      }
      const skip = ALWAYS_SKIPPED.has(i) ? 'comes pre-filled'
        : i === PLUGIN_PAGE && values.platformOffer === 'Access' ? 'not needed for Access'
          : i === COMMISSION_PAGE && values.commissionSkip ? values.commissionSkip : null;
      const problem = i === COMMISSION_PAGE && values.commissionProblem;
      if (skip || problem) {
        result = problem ? { status: 'failed', message: problem } : { status: 'skipped', message: `Skipped: ${skip}.` };
        results.push({ name: PAGES[i], ...result });
        chrome.tabs.sendMessage(tabs[i].id, { action: 'tcaSetupMark', symbol: SYMBOL[result.status] }).catch(() => {});
        progress({ index: i, name: PAGES[i], status: result.status, message: result.message });
        ensureOpen(k + 1);
        continue;
      }
      try {
        await waitForLoad(tabs[i].id);
        ensureOpen(k + 1);
        if (RELOAD_FIRST.has(i)) {
          progress({ index: i, name: PAGES[i], status: 'working', message: 'reloading the page first' });
          await sleep(Math.max(0, T.reloadDelay - (Date.now() - openedAt[i])));   // 5 s after it opened
          await reload(tabs[i].id);
        }
        await sleep(T.settle);
        // A page that never answers (for example after the Awin session expired) can't hold up the run.
        let timer;
        const limit = new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'failed', message: `No result after ${Math.round(T.pageLimit / 1000)} s. If your Awin session has expired, sign in, then use Retry failed pages.` }), T.pageLimit); });
        result = await Promise.race([runPage(tabs[i].id, values, save), limit]);
        clearTimeout(timer);
      } catch (error) {
        result = { status: 'failed', message: `Unexpected error: ${error.message}` };
      }
      // A page that failed on Awin's sign-in page (or never answered there) is flagged, so the TC is
      // offered to sign in in that tab and retry.
      if (result.status === 'failed' && !result.signin && tabs[i] && await onSignInPage(tabs[i].id)) {
        result = { ...result, signin: true, message: 'Awin showed its sign-in page in this tab.' };
      }
      results.push({ name: PAGES[i], ...result });
      chrome.tabs.sendMessage(tabs[i].id, { action: 'tcaSetupMark', symbol: SYMBOL[result.status] || '⚠' }).catch(() => {});
      progress({ index: i, name: PAGES[i], status: result.status, message: result.message, note: result.note, diagnostics: result.diagnostics, signin: !!result.signin });
      // Signed out of Awin altogether? Then the next pages would only fail the same way: stop here.
      if (result.signin && k < pages.length - 1 && (await checkSession(mid)).signedIn === false) {
        signedOut = true;
        for (let j = k + 1; j < pages.length; j++) progress({ index: pages[j], name: PAGES[pages[j]], status: 'cancelled', message: 'not started: signed out of Awin' });
        break;
      }
    }
    } finally {
      clearInterval(awake);
    }

    const needsLook = results.filter(r => r.status === 'failed' || r.status === 'unconfirmed');
    const count = s => results.filter(r => r.status === s).length;
    const cancelled = cancelRequested;
    const notStarted = pages.length - results.length;
    const summary = [count('saved') && `${count('saved')} saved`, count('filled') && `${count('filled')} filled (not saved)`,
      count('skipped') && `${count('skipped')} skipped`, needsLook.length && `${needsLook.length} need a look`,
      (cancelled || signedOut) && notStarted && `${notStarted} not started`].filter(Boolean).join(', ') || 'nothing done';
    cancelRequested = false;
    progress({ done: true, summary, cancelled, signedOut, needsLook: needsLook.length, retried: retrying ? pages : null });
    try {
      chrome.notifications.create(`tcaSetup-${mid}-${Date.now()}`, {
        type: 'basic', iconUrl: 'assets/autosetup128.png', title: `Setup for MID ${mid}: ${signedOut ? 'signed out of Awin' : cancelled ? 'cancelled' : needsLook.length ? 'needs a look' : 'done'}`,
        message: `${summary}.${needsLook.length ? ' ' + needsLook.map(r => `${r.name}: ${r.message}`).join(' ') : ''}`.slice(0, 400)
      });
    } catch { /* notifications are a nicety */ }
    if (globalThis.TCAUsageWorker && !retrying) {   // a retry finishes a setup already counted
      globalThis.TCAUsageWorker.add({ tool: 'New Implementation', action: 'setup', outcome: needsLook.length || cancelled || signedOut ? 'failed' : 'success', reason: signedOut ? 'setup-signed-out' : cancelled ? 'setup-cancelled' : 'setup-page-failed', tc: values.assignedTc });
    }
    return results;
  }

  // Runs in the page's own world (not the extension's), where code editors keep their controls:
  // sets the text of the editor marked data-tca-code-target. CodeMirror 5 and 6, Ace and Monaco.
  function setEditorInPage(code) {
    const el = document.querySelector('[data-tca-code-target]');
    if (!el) return { error: 'editor not found' };
    try {
      if (el.CodeMirror && el.CodeMirror.setValue) { el.CodeMirror.setValue(code); if (el.CodeMirror.save) el.CodeMirror.save(); return { editor: 'CodeMirror' }; }
      const cm6 = el.cmView && el.cmView.view || (el.querySelector('.cm-content') || {}).cmView && el.querySelector('.cm-content').cmView.view;
      if (cm6 && cm6.dispatch) { cm6.dispatch({ changes: { from: 0, to: cm6.state.doc.length, insert: code } }); return { editor: 'CodeMirror 6' }; }
      if (el.env && el.env.editor && el.env.editor.setValue) { el.env.editor.setValue(code, 1); return { editor: 'Ace' }; }
      if (window.ace && window.ace.edit && el.classList.contains('ace_editor')) { window.ace.edit(el).setValue(code, 1); return { editor: 'Ace' }; }
      if (window.monaco && window.monaco.editor) {
        const editor = window.monaco.editor.getEditors().find(e => el.contains(e.getDomNode()) || e.getDomNode().contains(el));
        if (editor) { editor.setValue(code); return { editor: 'Monaco' }; }
      }
      return { error: 'no editor controls found' };
    } catch (error) {
      return { error: String(error.message || error) };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaSetupSetEditor') return undefined;
    const tab = sender && sender.tab;
    if (!tab || !/^https:\/\/ui\.awin\.com\//.test(sender.url || tab.url || '')) { sendResponse({ error: 'not an Awin page' }); return undefined; }
    chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [sender.frameId || 0] }, world: 'MAIN', func: setEditorInPage, args: [String(message.code)] })
      .then(([frame]) => sendResponse((frame && frame.result) || { error: 'no result' }), error => sendResponse({ error: error.message }));
    return true;
  });

  // Is the TC signed in to Awin? Asks for one of the classic setup pages (the server redirects a
  // signed-out browser to Awin's sign-in) and looks at where it ended up. Nothing is changed.
  //   { action: 'tcaSetupCheckSession', mid }  →  { signedIn: true | false | null, detail }
  // A sign-in form can also come back as a normal 200 on ui.awin.com (as SharePoint's did for Moonfill),
  // so the page itself is looked at too: a password box or a sign-in form means signed out.
  const SIGNIN_FORM = /<input[^>]+type=["']?password|<form[^>]+action=["'][^"']*(login|signin|authori[sz]e|oidc|idp)/i;
  async function checkSession(mid) {
    try {
      const res = await fetch(`https://ui.awin.com/provider/migrated-advertiser-settings/${mid}`, { credentials: 'include', redirect: 'follow', cache: 'no-store' });
      const where = new URL(res.url || 'https://ui.awin.com/');
      if (SIGNIN_PATH.test(where.pathname) || where.hostname !== 'ui.awin.com') return { signedIn: false, detail: 'Awin asked to sign in' };
      if (res.status === 401 || res.status === 403) return { signedIn: false, detail: `Awin answered ${res.status}` };
      if (res.ok) {
        let text = '';
        try { text = typeof res.text === 'function' ? String(await res.text()).slice(0, 200000) : ''; } catch { /* unreadable: the address is enough */ }
        if (SIGNIN_FORM.test(text)) return { signedIn: false, detail: 'Awin showed its sign-in form' };
        return { signedIn: true };
      }
      return { signedIn: null, detail: `Awin answered ${res.status}` };
    } catch (error) {
      return { signedIn: null, detail: String(error.message || error) };
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaSetupCheckSession') return undefined;
    const mid = String(message.mid || '').replace(/\D/g, '');
    if (!mid) { sendResponse({ signedIn: null, detail: 'no MID' }); return undefined; }
    checkSession(mid).then(sendResponse);
    return true;
  });

  // "Sign in" on the setup box: brings the tab showing Awin's sign-in to the front, so the TC can sign in
  // right there. Without that tab (closed, or none known), Awin opens in a new tab.
  //   { action: 'tcaSetupShowTab', index }  →  { ok, opened? }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaSetupShowTab') return undefined;
    const tab = last.tabs[Number(message.index)];
    (async () => {
      if (tab) {
        try {
          const shown = await chrome.tabs.update(tab.id, { active: true });
          if (chrome.windows) await chrome.windows.update(shown.windowId, { focused: true }).catch(() => {});
          return { ok: true };
        } catch { /* closed since */ }
      }
      await chrome.tabs.create({ url: 'https://ui.awin.com/', active: true });
      return { ok: true, opened: true };
    })().then(sendResponse, error => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  });

  // The ✕ on the progress bar: the page being filled is finished, then the run stops.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaSetupCancel') return undefined;
    cancelRequested = true;
    sendResponse({ ok: true });
    return undefined;
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaSetupRun') return undefined;
    const mid = String(message.mid || '').replace(/\D/g, '');
    if (!mid || !message.values) { sendResponse({ ok: false, error: 'No MID or values.' }); return undefined; }
    if (/^0+$/.test(mid)) { sendResponse({ ok: false, error: 'the MID is 0: the advertiser hasn\'t been created in Awin yet.' }); return undefined; }
    sendResponse({ ok: true });
    run({ mid, values: message.values, save: !!message.save, only: message.only }, sender && sender.tab ? sender.tab.id : null)
      .catch(error => console.error('Moonfill setup failed', error));
    return undefined;
  });

  // The setup's summary for the record's Chatter: handed to Moonfill's own Chatter code, which answers
  // moonfillPost in the record tab (salesforce.js). Only ever to the tab that asked.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaSetupChatter') return undefined;
    const tabId = sender && sender.tab ? sender.tab.id : null;
    if (tabId == null || !message.text) { sendResponse({ ok: false, error: 'no record tab or text' }); return undefined; }
    Promise.resolve()
      .then(() => chrome.tabs.sendMessage(tabId, { action: 'moonfillPost', text: String(message.text), recordId: message.recordId, share: true, fast: false, activated: false }))
      .then(answer => sendResponse(answer || { ok: false, error: 'no answer from the page' }), error => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  });

  globalThis.TCASetupRunner = { run, PAGES, T, RELOAD_FIRST, setEditorInPage, checkSession, onSignInPage, last };   // for tests
})();

// Moonfill's 🔎 IR button on an Implementation record (TSE__c) opens the Internal Review panel instead of
// only opening the IR tabs. The click is caught first, in the capture phase, as the setup form does for 🚀,
// so Moonfill's own code stays unchanged. Shift-click (or "Just open the IR tabs" in the panel) still opens
// the tabs as before. Elsewhere (the Case page's IR button) nothing changes.
(function () {
  if (globalThis.__oirHook) return;
  globalThis.__oirHook = true;
  const RECORD = /\/lightning\/r\/TSE__c\/[a-zA-Z0-9]{15,18}\/view/;
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  // The MID from the record's Awin dashboard link, as Moonfill and the setup read it: a visible link first,
  // then one not on screen. The panel also takes it from the setup note or the record's Awin Program ID.
  function readMid() {
    const scope = document.querySelector('.oneContent.active') || document;
    const links = Array.from(scope.querySelectorAll('a[href*="ui.awin.com/dashboard/awin/advertiser/"]'));
    const link = links.find(visible) || links[0];
    const mid = link ? ((link.getAttribute('href').match(/advertiser\/(\d+)/) || [])[1] || '') : '';
    return mid === '0' ? '' : mid;
  }

  window.addEventListener('click', (event) => {
    const button = event.target && event.target.closest && event.target.closest('button.mf-ir');
    if (!button || button.disabled || event.shiftKey || !RECORD.test(location.pathname)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    try {
      chrome.runtime.sendMessage({ action: 'oirOpenPanel', mid: readMid() }).catch(() => {});
    } catch (e) { /* extension reloaded: the page needs a refresh */ }
  }, true);

  // Opens the review panel for this record without Moonfill's button (the floating button's 🔎 IR).
  // false when this isn't an Implementation record.
  function open() {
    if (!RECORD.test(location.pathname)) return false;
    try { chrome.runtime.sendMessage({ action: 'oirOpenPanel', mid: readMid() }).catch(() => {}); } catch (e) { return false; }
    return true;
  }

  globalThis.OIRHook = { readMid, open };
})();

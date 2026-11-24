// "Just open the tabs": Moonfill's 🚀 New Implementation and 🔎 IR buttons, the setup box's "Just open the
// tabs" and the review panel's "Just open the IR tabs" send openSetupTabs / openReviewTabs with a MID. This
// opens that tool's pages (autofill/pages.js) as one tab group, next to the record, with nothing filled.
// Loaded in the service worker by autofill/background.js. Written for this project (2026-11-19).
(function () {
  const KINDS = {
    openSetupTabs: { urls: mid => globalThis.TCAPages.setupUrls(mid), title: mid => `${mid} setup`, color: 'cyan' },
    openReviewTabs: { urls: mid => globalThis.TCAPages.reviewUrls(mid), title: mid => `IR ${mid}`, color: 'purple' }
  };

  async function openGroup(kind, mid, windowId) {
    const urls = kind.urls(mid);
    if (!urls.length) return;
    const tabIds = [];
    for (const url of urls) {
      const tab = await chrome.tabs.create(windowId != null ? { url, active: false, windowId } : { url, active: false });
      tabIds.push(tab.id);
    }
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: kind.title(mid), color: kind.color });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    const kind = message && KINDS[message.action];
    if (!kind) return undefined;
    const mid = String(message.mid || '').replace(/\D/g, '');
    if (!mid || /^0+$/.test(mid)) return undefined;   // no advertiser in Awin yet: nothing to open
    // the record's window: the sender's tab, or the one the review panel names (it's a window of its own)
    const windowId = message.windowId != null ? message.windowId : sender && sender.tab ? sender.tab.windowId : undefined;
    openGroup(kind, mid, windowId).catch(e => console.warn('Could not open the tabs:', e));
    return undefined;   // never answered, like the other Moonfill messages
  });

  globalThis.TCATabs = { KINDS, openGroup };
})();

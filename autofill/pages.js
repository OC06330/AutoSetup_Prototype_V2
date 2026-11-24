// The Awin UI pages the tools open, by address (written for this project, 2026-11-19).
// - The setup's ten pages, in the order the setup works through them: the page-by-page setup the user
//   specified on 2026-11-17, whose recipes (setup/fill.js) match each address and were built and checked
//   on the live pages. The setup and "Just open the tabs" (🚀) open these.
// - The review's pages: Optimus IR's own page list (review/lib/fields.js, by Kaio Da Mota), with the
//   region path "us", which the Awin UI accepts for every region. "Just open the IR tabs" (🔎) opens these.
// Loaded in the service worker (autofill/background.js) and by the tests.
(function (root) {
  const UI = 'https://ui.awin.com';
  const id = mid => encodeURIComponent(String(mid).replace(/\D/g, ''));

  // [setup/fill.js key, name, address]
  const SETUP = [
    ['tracking', 'Tracking settings', mid => `${UI}/tracking-settings/us/awin/advertiser/${id(mid)}/main-settings`],
    ['invite', 'Invite user', mid => `${UI}/awin/merchant/${id(mid)}/settings/invite-user`],
    ['commission', 'Commission groups', mid => `${UI}/commission-manager/us/awin/merchant/${id(mid)}/commission-groups`],
    ['plugin', 'Plugin store', mid => `${UI}/advertiser-mastertag/us/awin/${id(mid)}/plugins`],
    ['tag', 'Tracking tag settings', mid => `${UI}/advertiser-mastertag/us/awin/${id(mid)}/trackingtagsettings`],
    ['account', 'Account details', mid => `${UI}/provider/merchant-settings/${id(mid)}/account-details/network/awin`],
    ['fee', 'Fee manager', mid => `${UI}/provider/finance/fee-manager/en/${id(mid)}`],
    ['mobile', 'Mobile tracking', mid => `${UI}/provider/merchant-settings/${id(mid)}/mobile-tracking/network/awin`],
    ['advertiser', 'Advertiser settings', mid => `${UI}/provider/migrated-advertiser-settings/${id(mid)}`],
    ['prejoin', 'Pre-join publishers', mid => `${UI}/provider/pre-join-publishers?advertiserId=${id(mid)}`]
  ].map(([key, name, url]) => ({ key, name, url }));

  const setupUrls = mid => SETUP.map(p => p.url(mid));

  // The review's own list, when its fields.js is loaded (the service worker loads it with the review)
  function reviewUrls(mid) {
    const F = root.OIRFields;
    if (!F || !Array.isArray(F.PAGES)) return [];
    return F.PAGES.map(p => p.url('us', id(mid)));
  }

  const api = { SETUP, setupUrls, reviewUrls };
  root.TCAPages = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

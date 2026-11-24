// Console logging with one prefix, so everything from the extension can be filtered with
// "[Optimus IR]" in DevTools. Used by the service worker, the content scripts and the popup.
// background.js also forwards each run's warnings and errors to the Salesforce record tab,
// so they show up in that page's console (F12 on the record).
(function (root) {
  const PREFIX = "[Optimus IR]";
  const tag = (ctx) => (ctx ? `${PREFIX} [${ctx}]` : PREFIX);
  const out = (level) => (ctx, ...args) => {
    try { console[level](tag(ctx), ...args); } catch (e) { /* no console */ }
  };
  root.OIRLog = { PREFIX, tag, debug: out("debug"), info: out("info"), warn: out("warn"), error: out("error") };
  if (typeof module !== "undefined") module.exports = root.OIRLog;
})(typeof globalThis !== "undefined" ? globalThis : this);

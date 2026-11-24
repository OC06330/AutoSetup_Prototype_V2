// eCommerce platform detection on the advertiser's site.
// Injected into the site's tab in the MAIN world (it needs the page's own window objects,
// e.g. window.Shopify). Reads only: it clicks nothing and sends nothing.
// Each platform: name (as in the Salesforce "eCommerce platform" picklist), signs (each
// returns a short evidence string or null) and, optionally, extra domains that must be
// accepted in the Awin UI (Shopify: the *.myshopify.com domain).
// Platform-specific rules can be added here per entry.
(function (root) {
  // "https://Shop.myshopify.com/" -> "shop.myshopify.com" (the Awin UI accepts the host only)
  const host = (v) => String(v || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "");
  const PLATFORMS = [
    {
      name: "Shopify",
      signs: [
        (w) => (w.Shopify && w.Shopify.shop ? `Shopify.shop = ${w.Shopify.shop}` : null),
        (w) => (w.Shopify ? "window.Shopify" : null),
        (w, d, s) => (s.some((x) => /cdn\.shopify\.com|\/cdn\/shop\//.test(x)) ? "Shopify CDN assets" : null)
      ],
      domains: (w) => (w.Shopify && w.Shopify.shop ? [host(w.Shopify.shop)].filter(Boolean) : [])
    },
    {
      name: "WooCommerce",
      signs: [
        (w) => (w.wc_add_to_cart_params || w.woocommerce_params || w.wc ? "WooCommerce scripts" : null),
        (w, d) => (d.body && /\bwoocommerce\b/.test(d.body.className) ? "woocommerce body class" : null),
        (w, d, s) => (s.some((x) => /wp-content\/plugins\/woocommerce/.test(x)) ? "WooCommerce plugin assets" : null)
      ]
    },
    {
      name: "Magento",
      signs: [
        (w, d) => (d.querySelector('script[type="text/x-magento-init"]') ? "x-magento-init" : null),
        (w, d, s) => (s.some((x) => /\/static\/(version\d+\/)?frontend\//.test(x)) ? "Magento static frontend" : null),
        (w) => (w.Mage ? "window.Mage" : null)
      ]
    },
    {
      name: "BigCommerce",
      signs: [
        (w) => (w.BCData ? "window.BCData" : null),
        (w, d, s) => (s.some((x) => /bigcommerce\.com/.test(x)) ? "BigCommerce CDN" : null)
      ]
    },
    {
      name: "Salesforce Commerce Cloud",
      signs: [
        (w, d, s) => (s.some((x) => /demandware\.(static|store)|\/on\/demandware/.test(x)) ? "demandware assets" : null),
        (w) => (w.dw || w.dwAnalytics ? "dw analytics" : null)
      ]
    },
    { name: "PrestaShop", signs: [(w) => (w.prestashop ? "window.prestashop" : null)] },
    {
      name: "Shopware 6",
      signs: [
        (w) => (w.PluginManager && w.router ? "Shopware 6 PluginManager" : null),
        (w, d, s) => (s.some((x) => /\/bundles\/storefront\//.test(x)) ? "Shopware 6 storefront bundle" : null)
      ]
    },
    {
      name: "Shopware 5",
      signs: [
        (w) => (w.StateManager && w.jQuery ? "Shopware 5 StateManager" : null),
        (w, d, s) => (s.some((x) => /\/themes\/Frontend\//.test(x)) ? "Shopware 5 theme assets" : null)
      ]
    },
    {
      name: "Wix",
      signs: [
        (w) => (w.wixBiSession || w.wixEmbedsAPI ? "Wix globals" : null),
        (w, d, s) => (s.some((x) => /static\.parastorage\.com|wixstatic\.com/.test(x)) ? "Wix CDN" : null)
      ]
    },
    {
      name: "Squarespace",
      signs: [
        (w) => (w.Static && w.Static.SQUARESPACE_CONTEXT ? "SQUARESPACE_CONTEXT" : null),
        (w, d, s) => (s.some((x) => /squarespace(-cdn)?\.com/.test(x)) ? "Squarespace CDN" : null)
      ]
    },
    {
      name: "OpenCart",
      signs: [
        (w, d, s) => (s.some((x) => /catalog\/view\/(theme|javascript)\//.test(x)) ? "OpenCart catalog assets" : null),
        (w, d) => (d.querySelector('a[href*="route=common/home"], a[href*="route=product/"]') ? "OpenCart routes" : null)
      ]
    },
    {
      name: "Lightspeed",
      signs: [(w, d, s) => (s.some((x) => /shoplightspeed\.com|webshopapp\.com|lightspeedhq/.test(x)) ? "Lightspeed assets" : null)]
    },
    {
      name: "Shoplazza",
      signs: [
        (w) => (w.SHOPLAZZA ? "window.SHOPLAZZA" : null),
        (w, d, s) => (s.some((x) => /shoplazza|shoplazza\.com/.test(x)) ? "Shoplazza assets" : null)
      ]
    },
    {
      name: "VTEX",
      signs: [
        (w) => (w.vtex || w.vtexjs ? "window.vtex" : null),
        (w, d, s) => (s.some((x) => /vtexassets\.com|vteximg\.com/.test(x)) ? "VTEX assets" : null)
      ]
    },
    {
      name: "Nuvemshop",
      signs: [(w, d, s) => (s.some((x) => /nuvemshop|tiendanube|d26lpennugtm8s\.cloudfront\.net/.test(x)) ? "Nuvemshop assets" : null)]
    }
  ];

  // Returns { platform, evidence, others: [{name, evidence}], domains }
  function detect(w, d) {
    w = w || window; d = d || document;
    const srcs = Array.from(d.querySelectorAll("script[src], link[href], img[src]"))
      .map((e) => e.getAttribute("src") || e.getAttribute("href") || "").slice(0, 400);
    const gen = (d.querySelector('meta[name="generator"]') || {}).content || "";
    const hits = [];
    for (const p of PLATFORMS) {
      const ev = [];
      for (const sign of p.signs) { try { const r = sign(w, d, srcs); if (r) ev.push(r); } catch (e) { /* page object missing */ } }
      if (gen && new RegExp(p.name.split(" ")[0], "i").test(gen)) ev.push(`generator: ${gen.slice(0, 60)}`);
      if (ev.length) hits.push({ name: p.name, evidence: ev, p });
    }
    hits.sort((a, b) => b.evidence.length - a.evidence.length);
    if (!hits.length) return { platform: null, evidence: [], others: [], domains: [] };
    const top = hits[0];
    let domains = [];
    try { domains = top.p.domains ? top.p.domains(w, d) : []; } catch (e) { /* none */ }
    return {
      platform: top.name,
      evidence: top.evidence,
      others: hits.slice(1).map((h) => ({ name: h.name, evidence: h.evidence })),
      domains
    };
  }

  root.OIRPlatforms = { PLATFORMS, detect, host, names: PLATFORMS.map((p) => p.name) };
  if (typeof module !== "undefined") module.exports = root.OIRPlatforms;
})(typeof globalThis !== "undefined" ? globalThis : this);

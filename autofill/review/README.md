# 🧭 Optimus Internal Review

> **In the AutoSetup prototype.** This is Optimus Internal Review v0.2.23 (from `optimus-internal-review-checker`, branch `feat/v0.2-internal-review`), folded into the prototype under `autofill/review/`. The rules, page readers and fixes below are unchanged. What differs:
>
> - **No popup of its own.** On an Implementation record, Moonfill's **🔎 IR** button (or 🔎 IR in the floating button's menu) opens the review in a small window tied to that record (`panel.html`). **Shift-click** 🔎 IR, or use **Just open the IR tabs** in the panel, to only open the 11 IR pages as before. The Case page's IR button is unchanged.
> - **The MID** is taken from the record (still editable, and it must match the record's Awin Program ID). **The Awin sign-in** is checked by itself with the setup's own check: signed in ticks the box; signed out offers **Sign in to Awin**.
> - **Settings** are in the **🔎 Internal Review** block of the prototype's one settings page (`autofill/options.html#review`, run by `options-section.js`): the Region → loc pairs and clearing the review history. Its site check and date format are the page's **Shared** settings (the same permission as the checklist's platform detection; the date saved for both).
> - **The Salesforce update** waits for the record's shared edit lock (`<html data-awin-edit-lock>`), so it never edits the record while Moonfill or the Checklist Autofill is.
> - **The record's marketing checklist comes first, the setup's Chatter note is the backup** (the user, 2026-11-24; before that the note was the source of truth, 2026-11-19). The review reads the same marketing-checklist fields as the setup (Platform Offer, Commission type with Commission Amount, Auto validation period), with the setup's own reader and labels when they're on the page (`readMarketingChecklist` in `content/salesforce.js`, `parseRecordChecklist` in `lib/checks.js`). Then it reads the newest "New Implementation setup for MID …" note for this MID, which fills what the record doesn't say and still provides the pages that needed a look and the setup's query string. Validation Period Days is expected as the setup set it (including "already set, kept") unless the record gives another Platform Offer or other contract days; then the record's rule applies. The "Implementation Checklist" post fills what neither says, mainly the contract's publisher approval. Differences are shown in the panel ("… (the record's is used)"). With complete inputs, the Chatter search stops after one round that loads nothing new.
> - **Enter the details by hand** (the user, 2026-11-24): a button on the panel that opens every input field at once (commission, validation period, Platform Offer, auto-approve) and sends `oirStopSearch` to the record tab, so the Chatter search ends and the record's other fields are read straight away. What the search found still fills the fields left empty. **Run Internal Review is never greyed out**: clicked with something missing it says what; clicked while the record is still being read it starts by itself once the reading is done.
> - **Only the commission, validation period and Platform Offer are needed.** The tracking fee is optional (usually filled by default; without it the fee isn't checked, and isn't listed as "Not checked"). Publisher approval is **manual, as the setup sets it**, unless an "Implementation Checklist" post states auto-approve.
> - **0 days in the contract → −1** (not Access), in the review and now in the setup too.
> - **Shopify stores:** the setup puts the store's myshopify address in the website, so the website isn't compared with the record (a blank record website is still filled from the UI, unless the UI has the myshopify address).
> - **Deduplication with a setup note:** the setup's query string stands. If the record names another pair (often the checklist's default `source` / `aw`, e.g. on Access without a platform, where the setup wrote `utm_source=awin`), the record's Deduplication Parameter and Channel are updated to the append's pair instead of the append being changed.
> - **Setup pages the review doesn't check** (Invite user, Tracking tag settings, Account details) are listed under "To check" when the setup note says they needed a look or weren't started.
> - **Page details from the setup's live pages:** Link Builder `#DeeplinkEnabled`, landing page `#GlobalClickThroughPage`, append `#ClickAppend`; pre-join publishers as tick boxes (value = the publisher id; none = already pre-joined); mobile tracking by the `strategy` radio "Tracking is implemented on mobile site"; approval by the "Approval of Publishers Joining" select, read and set by its option text.
> - **Tabs:** as in Optimus IR, each Awin tab closes as soon as its read or fix is done, in a collapsed **IR \<MID\>** group (kept that way at the user's request, after trying the setup's open-group style in v3.0.5). They now open in the record's window.
> - **Main settings no longer times out:** it counts as drawn as soon as `#MainWebsiteURL` or `#ClickAppend` shows (the labels may not match word for word); a page that keeps "loading" is read once it's drawn; a page with no sign of being drawn is taken as it is after 12 s; labels are found without measuring every element of the page; and Main settings gets the same two tries as the other pages.
> - The Chatter report's first line names both versions: `Internal Review | MID … | Optimus IR v0.2.23 (3.0.14 AutoSetup prototype)`.
> - Tests run with the prototype's: `cd autofill/dev && npm test` (`tests/review-*.test.cjs`). In the paths below, `lib/`, `content/`, `background.js` and `popup.*` are under `autofill/review/` (`popup.*` is `panel.*`).

**Runs the Internal Review of one Awin programme from its Salesforce Implementation record, in the background.**

Open the Implementation record and click the extension icon. The MID field is ready straight away: type the programme's MID and tick **I'm signed in to ui.awin.com**. Meanwhile the extension looks for the **Implementation Checklist** post in the record's Chatter, and then reads the record. When both are done, click **Run**. Optimus IR: After **Run**, the form is cleared. Reopening the popup while a review of that record is running, or up to 10 minutes after it finished, does not start the Chatter search again: it shows the review and a **Start a new review** button.

1. reads the contract inputs from the record's Chatter post titled **Implementation Checklist** (a form appears only for what's missing);
2. reads the record and 11 Awin UI pages in a collapsed **IR \<MID\>** tab group. A page that reloads while being read is retried up to 3 times, and no page can hang the run: each read has a time limit, after which the page is skipped with a note;
3. runs the checks and **fixes the Awin UI automatically**: each fix is saved, the page reloaded and the value read back;
4. deletes the programme's test transactions (after the pending transaction was read);
5. updates the Salesforce record (see below) and posts a short report to Chatter, ending with an @mention of the record's integrator.

The Implementation Status is not changed: the Tech sign-off stays with the integrator, who also talks to the client.

You can keep working in other tabs and apps. Every step and every check is shown in the popup, like Moonfill.

> **v0.2: first version, for testing.** The page selectors were written from the ids and labels you gave, without the real pages. When a check comes back **➖ skipped** or a fix fails, use **Describe pages** → **Copy page structure** (labels, ids, columns, no values) and send it, so `lib/fields.js` can be corrected.

## The Implementation Checklist post

One `Label: value` per line, anywhere under the title. Both forms below work:

```
Implementation Checklist
Base commission: Percentage 8        (or 8%, Fixed 5, £5)
Auto-approve publishers: No          (or Publisher approval: manual)
Validation period in contract: 30 days
Tracking fee: Percentage 30
Platform Offer: Accelerate           (required: Access / Accelerate / Advanced)
```

The record tab **stays on Chatter** until the checklist is read. The extension searches **every post and comment**, not only the latest. If the post isn't among those loaded, it loads older posts with the feed's own "Show more posts" button (never the record's "More" menu) and by scrolling to the end of the feed, and it opens collapsed comments. It goes on until it finds a post with everything needed, or until the feed ends. If the newest checklist post is incomplete, older ones are checked too. Only then does it switch to Details to read the record. The popup shows the seconds spent searching. `:`, `=`, ` - ` and `|` all work as separators. A post that Chatter shows on one line also works: it is split before each field name. The newest post with the title is used.

Analytics lines may stay in the post: they are recognised but not used (the UTMs are not checked).

## What is checked and fixed

| Page | Checked | Fixed automatically |
|---|---|---|
| Main settings | website (`#MainWebsiteURL`), landing page, dedup pair in the append, awc, accepted domains (+ platform domains, e.g. Shopify's), Link Builder | dedup pair, awc, website/landing page, missing domains, following the recording in `docs/recordings/accepted-domains-main-settings.md`: the domain goes into `#newValidDomain` (focus, native value, `input`, then `change`/`focusout`/`blur`), the `<i class="fa-plus">` of `.input-group-append span.input-group-text a` is clicked, and a new `div.tags` with the domain must appear. Then **one Save** with `button[type=submit].btn.btn-default`; the click counts as success, and the server re-rendering the list is logged as confirmation |
| Advertiser site | eCommerce platform from signs in the page (Shopify, WooCommerce, Magento, BigCommerce, Salesforce Commerce Cloud, PrestaShop, Shopware 5/6, Wix, Squarespace, OpenCart, Lightspeed, Shoplazza, VTEX, Nuvemshop) vs the record | fills **eCommerce platform** in Salesforce when blank; a different value is reported |
| Commission groups | DEFAULT rate from the grid: `.ag-floating-bottom-viewport` → row whose `.ag-cell-value` is Default → `rate.publisherCommission` (3 tries of 20 s, then skipped with a note) | not changed; a difference is listed under "To check" |
| MasterTag plugins | every plugin and whether it is enabled; SingleView (not for Access) | enables SingleView; the enabled plugins go to **MT plugins activated** in Salesforce |
| Fee manager | the value of `input[formcontrolname=feeValueCtrl]` vs the tracking fee given | not changed; a difference is listed under "To check" |
| Pending transactions | test transaction, voucher, custom parameters (tooltips) | — (goes to Salesforce) |
| Tracking diagnosis | `app-transaction-details` present | — |
| Mobile tracking | configured when `#strategy-implemented` has `checked="checked"` | if not: clicks `#strategy-implemented`, then `#updateChanges` |
| Pre-join publishers | 111 and 45628 Active in `pre_join_publishers` | sets Active and submits, up to 3 tries |
| Migrated advertiser settings | Validation Period Days (Access: + 7; 0 → -1), `…_manualApproval` vs auto-approve | both, Save |
| Test transactions | `#merchantId` = MID, search with `#formprovidertesttransactionssearch`, rows in `tableHeader` | one row: its `.deleteTestTransaction`; several: `#delete-all`; searched again until none is left |

Link Builder differences are reported, not changed: the record could be the wrong side.

## Salesforce updates

**Deduplication: Salesforce first, then the Default Query String Append.** In `source=aw` the parameter is `source` and the channel is `aw`; in `utm_source=awin` they are `utm_source` and `awin`.

1. **The record has both:** the append must hold exactly `parameter=channel`.
   - Same parameter with another value: "To check", not changed, because it may be a customisation.
   - Parameter missing: the pair is added to the append.
2. **Only the parameter:** its value in the append fills Channel parameters implemented.
3. **Only the channel:** the append's pair with that value fills Deduplication Parameter.
4. **Record blank:** the append's pair is used. Plugins usually use `source` and GTM or direct integrations `utm_source`, so that pair is taken first, according to the Deduplication Solution.

All of these are written in one edit on the Details tab, then saved.

| Field | Value | When |
|---|---|---|
| Voucher Tracking implemented | Yes / No | a pending test transaction was found (voucher used or not) |
| Custom parameters implemented | Yes / No (picklist), or the parameter names (text field) | a pending test transaction was found |
| eCommerce platform | the platform detected on the site | blank on the record |
| Program website, URL of Landing Page | the value in the Awin UI | blank on the record |
| Deduplication Parameter | the **parameter name** of the dedup pair in the Default Query String Append (`source`, `utm_source` or a customised name) | blank on the record (or still in the old `name=value` form) |
| Channel parameters implemented | the **value** of that pair (`aw`, `awin`…) | blank on the record; a different value is listed under "To check" |
| Link Builder Activated | Yes / No from the Awin UI | blank on the record |
| Successful Tracking Test | today's date | the test transaction shows in Tracking diagnosis and the field is blank |
| MT plugins activated | the plugins enabled in MasterTag plugins (after the fixes), e.g. `R.O.EYE - Consent - SingleView` | always, from the Awin UI |

Values already on the record are never overwritten by these. The date format is set in **Options** (DD/MM/YYYY by default).

The integrator is read from the record's **Integrator** or **Assigned TC** field, or the owner. The comment ends with `@Name Internal Review done: please review and complete the Tech sign-off.`, with the person picked from Chatter's mention list so they get notified.

## The Chatter comment

Short, fixed template, no AI needed. It lists only **what was adjusted** and **what needs a person**; what was already right is left out.

```
Internal Review | MID 131530 | Optimus IR v0.2.5
Default Query String Append modified [source=awin&utm_source=awin] | OK
Accepted domain added [breggz-dc0shy6m.myshopify.com] | OK
Test publisher 45628 invited | OK
Test transactions deleted [ORD-1, ORD-2] | OK
Salesforce updated: Voucher Tracking implemented, MT plugins activated | OK
IP truncation set to level 4 | FAILED (the field did not change)
To check: Tracking fee Percentage 25 (expected Percentage 30 (checklist))
@Integrator Internal Review done: please review and complete the Tech sign-off.
```

Website and landing page: the same name on another country domain (`breggz.com/nl` vs `www.breggz.nl`) counts as the same site. Truly different domains are listed under "To check" and never changed automatically.

## Debugging

Everything the extension writes to the console starts with `[Optimus IR]`, so you can filter on that text.

- **On the Salesforce record (F12 → Console):** shows the Chatter post that was read, the inputs taken from it, what is missing, and the record's fields. It also shows every **warning and error of a review** started from that record: page fields not found, failed steps, failed fixes, and Salesforce or Chatter errors.
- **Service worker** (`chrome://extensions` → Optimus IR → *service worker*): shows the full log, including what each Awin page returned.
- **Popup → Copy debug log:** copies a run's steps and log, ready to paste into a message.

## Everything runs in parallel

The order is set by what each step needs, not by a fixed list.

- **At once:** the pages whose address has no region path start together with Main settings: Fee manager, Pending transactions, Mobile tracking, Pre-join publishers, Migrated advertiser settings and Test transactions.
- **After Main settings:** Commission groups, MasterTag plugins and Tracking diagnosis start as soon as Main settings gives the region path (`{loc}`).
- **Fixes:** each page is fixed as soon as it has been read. Main settings also waits for the site check, which gives the Shopify domain, and then saves everything in one submit.
- **Test transactions:** they are deleted as soon as Pending transactions and Tracking diagnosis have been read. They don't wait for the other pages.
- **Waits:** after a save, the extension waits for a page reload only when one actually starts.

`npm run sim` plays a whole review against a fake Chrome to check this order.

## Shopify's internal domain

1. **Is it Shopify?** The custom parameters on the pending transaction (e.g. `shopifyApp_5.6.02`), the record, or the signs on the site say so.
2. **The internal domain:** the extension first asks `https://<site>/meta.json`, which every Shopify store answers with its `myshopify_domain` (about 1 s, no tab). If that doesn't work, it opens the site and reads `Shopify.shop`.
3. **Too slow:** if step 2 takes longer than **25 s**, `*.myshopify.com` is added to the accepted domains instead and the review goes on. The Chatter comment shows it under "To check".

## A review never hangs

A review can fail, but it always ends.

- **Time limit on every call:** every call into a page or into Salesforce has one (60 s for a page step, 150 s for Salesforce).
- **Reads:** each page read is retried, then skipped with a note.
- **Fixes:** a fix that fails is marked ❌, and the next one still runs.
- **Sign-in during fixes:** if the Awin UI asks for a sign-in while fixing, the remaining fixes are marked "not tried" and Salesforce and Chatter still run.
- **Kept alive:** the extension keeps its background process awake while a review runs.
- **Watchdog:** a review with no progress for 6 minutes is ended as failed and named in a notification. A review left behind when Chrome stopped the background process is marked "interrupted" too.

## Safety

- **One programme only:** the MID you type, which must match the record's Awin Program ID.
- **Sign-in:** if any page asks for a sign-in, the run stops and shows that tab.
- **Deletes only** the test transaction rows listed for this MID on Test transactions. Nothing else is deleted; Delete/Reset buttons elsewhere are never clicked.
- **Salesforce:** the record must be in front for the field update and the Chatter post (Lightning doesn't draw hidden pages). If it isn't, the step waits and retries when the browser gets focus, or click **Retry Salesforce + Chatter**. It won't start if the record is already in edit mode.
- **Advertiser site:** the website and landing page on the record are opened in a background tab only to detect the platform, once allowed in **Options**. Nothing is clicked there.
- **Data:** runs are stored in this browser profile (last 30). **Describe pages** records labels, ids and column names, never values.

## Install (developer mode)

1. Unzip, or clone the repository, somewhere permanent.
2. `chrome://extensions` (or `edge://extensions`) → **Developer mode** → **Load unpacked** → the folder with `manifest.json`.
3. Pin 🧭 Optimus Internal Review. In **Options**, click **Allow site check** for the platform check (any eCommerce platform).

To update: replace the files and click **reload** on the extension's card. Moonfill can stay installed.

## For developers

| Path | What it is |
|---|---|
| `lib/fields.js` | Every label, id and URL: Salesforce fields, Chatter title, Awin pages and selectors, Salesforce fields to update |
| `lib/platforms.js` | eCommerce platform signs and platform-specific rules (e.g. Shopify's myshopify domain) |
| `lib/checks.js` | Checklist parsing, checks, fixes to make, Chatter template (pure functions) |
| `content/awin-page.js` | Injected in Awin UI tabs: read a page, make one fix, describe the page |
| `content/salesforce.js` | On the record: read it and the checklist post, update fields, post to Chatter |
| `background.js` | A run: tabs, related records, fixes with read-back, test transaction deletion, Salesforce |
| `popup.*` | Start a review, follow the runs, history |
| `test/` | `npm test` (rules), `npm i && npm run smoke` (mock pages, jsdom) |
| `build.sh` | Makes `dist/Optimus_Internal_Review.zip` |

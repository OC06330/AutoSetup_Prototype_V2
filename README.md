# 🚀 UI AutoSetup prototype: Moonfill, Checklist Autofill, AutoSetup and Internal Review

**Four tools for Awin Technical Consultants in one browser extension (Edge or Chrome), each run in one click from the programme's Salesforce Implementation record.**

| Tool | What it does | Where to find it | Built by |
|---|---|---|---|
| **🌙 Moonfill** (Moonpull scans) | Submits the Moonpull form for the record, waits for the scan, posts the result to the record's Chatter and fills the five scan fields. Its row on the record also has the 🚀 and 🔎 buttons | **🌙 Submit Moonpull form** on the record | **Rodier Sangibala** |
| **📋 Checklist Autofill** (SalesforceAutofill) | Fills the agreed answers into the Technical Checklist (30 of its 45 fields, with templates for 13 eCommerce platforms), checks nothing else changed, and saves | **Checklist Autofill** panel (or the floating button), bottom right of the record | **Oscar Coleman** |
| **🚀 AutoSetup** (New Implementation setup) | Sets up a new programme in the Awin UI from the record: fills and saves the ten setup pages one by one, then posts a summary to Chatter | **🚀 New Implementation** on the record | **Oscar Coleman** |
| **🔎 Internal Review** (Optimus IR) | Reviews the programme in the Awin UI against the setup's Chatter note, fixes what it may, deletes the test transactions, fills blank record fields and posts a short report to Chatter for the integrator | **🔎 IR** on the record | **Kaio Da Mota** |

**Questions?** See the [FAQ](FAQ.md).

Before, a TC filled in the Moonpull form and copied its result from Teams, went through the Technical Checklist field by field, opened ten Awin pages to set a programme up, and checked them all again for the Internal Review. Now each of those is one click, and the four work together: Moonfill fills the scan fields the checklist leaves alone, the setup's Chatter note is what the review checks against, and no two of them edit the record at the same time.

This is the **prototype**: AutoSetup and the Internal Review are being tested here before they join the team release (Moonfill and the Checklist Autofill only).

---

## Why use it

- **One click each.** No typing the MID or region, no form to fill in, no copy and paste, no going through the checklist field by field, no opening the Awin pages one by one.
- **Nothing to remember.** The program, MID, country, offer, commission and validation period are read from the Salesforce record (and, for the review, from the setup's Chatter note). The checklist values are the team's agreed answers.
- **Work on something else.** Scans, setups and reviews run in background tabs while you use other tabs and apps.
- **Several scans at once.** Start as many as you like, for the same client or different ones. Each result goes to its own record.
- **Always visible.** The extension's toolbar button shows every scan; the checklist panel says exactly what it filled; the setup and the review show each page's progress and post a summary to Chatter.
- **Safe by design.** Moonfill checks the result belongs to the MID you scanned. The checklist checks nothing else on the record changed before saving. The setup and the review check you're signed in to Awin and work on that one MID only, and the review deletes only that MID's test transactions. If a check fails, nothing is posted or saved.
- **A safety net.** **Force paste** and **Copy result** for scans; **Fill only** for the checklist and the setup; **Retry failed pages** for the setup; **Retry Salesforce + Chatter** for the review.
- **Your way.** One **Settings** page for all four tools: shared settings first (menu style, reading client websites, date format), then one block per tool.

---

## How it works

### Moonpull scan

1. Open the program's record in Salesforce and click **🌙 Submit Moonpull form**.
2. A form tab opens, fills itself in, submits and closes. This takes about 25 seconds, then you are back on the record.
3. Moonfill waits for the scan to finish. You don't need to do anything.
4. When the result is ready, Moonfill opens the record in the background, posts the result to its **Chatter** feed, fills the scan fields (see [Fields filled by both](#fields-filled-by-both)) and shows a notification.

**To follow your scans:** click the extension's button in the toolbar (the AutoSetup icon). It lists the four tools, your Moonpull scans (with **History**) and a **Settings** button.

| What you see | What it means |
|---|---|
| Submitting form… | The form is being filled in and sent |
| In progress (3m 20s) | The scan is running |
| Posting to Salesforce… | The result is ready and is being posted |
| Result ready · waiting for the browser to be in front | The browser window was hidden. The result will be posted as soon as you bring the browser to the front |
| Complete · pasted in Salesforce | Done. The card disappears after one minute and stays in **History** |
| Failed: … | Something went wrong. See "If something goes wrong" below |

The **History** button lists your latest scans with program, MID and status.

### Technical Checklist

Open an Implementation record. The **Checklist Autofill** panel at the bottom right shows a green dot when it can see the Technical Checklist. You don't have to scroll down to the checklist first: Salesforce only draws a section once it has been on screen, so **Fill** opens the **Details** tab, brings the checklist up itself (switching the form to edit mode if that's what it takes) and then fills it. If Moonfill is filling the scan fields on the same record at that moment, the fill waits for it to finish.

**Menu style.** In **Settings → Menu style** you can swap the panel for a **floating button**: a round blue button you can drag anywhere on the page (it stays where you put it, in every Salesforce tab). Hover it for its menu, or click it to keep the menu open. The menu has the same controls as the panel, plus **🌙 Scan**, **🔎 IR** and **🚀 Setup**, which start those processes just like Moonfill's buttons on the record. With the floating button, that row of buttons at the top of the record is hidden, since the menu has the same three. If Moonfill's row isn't on the record (it waits for parts of the record Salesforce may not have drawn yet), **🚀 Setup** and **🔎 IR** start the setup and the review by themselves; only **🌙 Scan** needs Moonfill's button.

| Button | What it does |
|---|---|
| **Check page** | Read-only. Lists which checklist fields it found and whether it found the record's creation date. **Copy report** copies field labels and page structure only, never field values. |
| **Fill only** | Fills the checklist but **doesn't save**. Check the values, then click Salesforce's **Save**, or **Cancel** to discard them. |
| **Fill & save** | Fills the checklist, checks that nothing else changed, clicks Save once and confirms the saved values. |
| **Settings** | Opens the settings page (see below). |

Each run fills **30 of the checklist's 45 fields**:

- **28 fixed answers**, for example Img tag implemented → Yes, Deduplication Parameter → `source`.
- **Pixel Sent**: the date on the **Created.** line of the record's **Implementation History** box. Filled only if empty.
- **Successful Tracking Test**: today's date. Filled only if empty.

The other 15 fields, such as Tech notes, are left untouched. If the Implementation History box or its Created. line can't be found, Pixel Sent is left as it is and the panel says why. Everything else is still filled and saved.

**Platform templates.** Thirteen eCommerce platforms have their own answers for six fields: Deduplication Solution, Other Deduplication Solution, Tag Management Solution, eCommerce platform, Voucher Tracking implemented and Product Level Tracking implemented. The panel's **Template** menu offers:

- **Auto-detect platform** (the default). When you click Fill, Moonfill reads the client's site from the record's **Landing Page URL**, works out the platform from signs in the page, and applies that platform's template. It first downloads the page invisibly. If that's blocked or inconclusive, it opens the site briefly in a background tab, then closes it.
- **A platform by name**, to skip detection: BigCommerce, Lightspeed, Magento, OpenCart, PrestaShop, Salesforce Commerce Cloud, Shopify, Shoplazza, Shopware 5, Shopware 6, Squarespace, Wix, WooCommerce.
- **Default (no template).**
- **Clear checklist.** Empties every field Fill fills, the dates included; dropdowns go back to --None--. Fields Fill leaves alone, such as notes and the scan's fields, stay as they are. **Fill only** clears without saving; **Fill & save** asks before it clears and saves.

Template values only fill **empty** fields, so an answer that's already there is kept. If there's no Landing Page URL, no platform is recognised, or the signs point to two platforms, the default fill is used and the panel says why. Detection needs permission to read websites, which you grant once in Settings (**Allow platform detection**). Until then, the default fill is used.

**SingleView Setup.** For **Accelerate** and **Advanced** programmes (the record's Platform Offer), the 🚀 setup sets the record's **SingleView Setup** checklist as it starts: SingleView Setup Type → **MasterTag Enabled**, SingleView Integration Status → **New**. **Run and save** saves it; **Fill only** leaves it unsaved. The result shows under the progress bar. For Access, and in the Technical Checklist fill, it's left alone. It doesn't matter whether that section has been scrolled to, or what the record's layout calls it: the fields are found by their names.

**Settings.** For every checklist field you can choose:
- **Team default** (the agreed answer)
- **Leave untouched**
- **Fill with…**, a value of your own
- **Record creation date** or **Today's date**, for the two date fields only

These are in the **📋 Checklist Autofill** block of the Settings page, with **Save** and **Reset fields to team defaults** in the bar at the bottom. Your own choices win over templates.

**One Settings page for all four tools.** It opens from the panel's **Settings**, the review window's **Settings**, or the extensions page (the extension → **Details** → **Extension options**). It's split into clearly marked blocks:

| Block | Settings |
|---|---|
| **Shared** | **Menu style** (panel or floating button); **Reading client websites** (one permission, used by the checklist's platform detection, the setup's Shopify address and Access query string, and the review's platform check); **Date format in Salesforce** (DD/MM/YYYY or MM/DD/YYYY, for the checklist's and the review's dates) |
| **🌙 Moonfill** | none of its own (scans and their history are in the toolbar icon) |
| **📋 Checklist Autofill** | what each of the 45 checklist fields is filled with |
| **🚀 AutoSetup** | none of its own (it uses Reading client websites) |
| **🔎 Internal Review** | Region → page path (`{loc}`) pairs; clear the review history |

Settings are yours alone. They follow your Edge or Chrome profile and take effect on your next click.

### New Implementation setup

Clicking **🚀 New Implementation** on a record sets up the programme in Awin. Everything comes from the record:

| Setup value | Taken from |
|---|---|
| Website URL, Landing Page | **Landing Page URL** (Shopify stores: their `https://…myshopify.com` address, with platform detection allowed) |
| Platform Offer | **Platform Offer** (Access, Accelerate or Advanced) |
| Transaction Type, Commission Type | **Commission type** = Percentage → Sale + Percentage. Anything else: the commission group is left for you |
| Publisher Commission | **Commission Amount** |
| Approval of Publishers Joining | always **Manual Approval** |
| Validation Period Days | **Auto validation period**. For Access, a value already on the page is kept; if it's empty or -1, it becomes the period + 7. Otherwise 0 days is set as -1 |

Before anything starts, the box checks you're signed in to Awin (looking at the page Awin sends back, not just its address), and checks again when you click **Run and save** if the box has been open for more than a minute. If you're not signed in, it says so, with **Open Awin** and **Check again**. It also checks the record has everything listed above. If something is missing, it lists it, with **Enter the details by hand**, which opens a form filled in with whatever the record has. Without a Landing Page URL or Platform Offer, that form is the only way to run it.

You're asked only whether to save: **Run and save**, **Fill only** or **Cancel**. A progress bar then shows the pages being done one at a time. The red **✕** cancels: the page being filled is finished, and the rest aren't started.

| Page | What the setup does |
|---|---|
| Tracking settings | Website URL, Landing Page, query string append, Link Builder and relative URLs ticked, Add to Accepted Domains. Query string: Accelerate/Advanced `source=aw&utm_source=awin&sv1=affiliate&sv_campaign_id=!!!id!!!`. Access: `source=aw` if the client's site runs on one of the 13 supported e-commerce platforms, `utm_source=awin` if none is found, `source=aw` if the site can't be checked (detection not allowed in Settings, or the site doesn't load) |
| Invite user, Fee manager | skipped (they come pre-filled) |
| Commission groups | Add Default Commission Group, then Transaction Type, Commission Type, Publisher Commission |
| Plugin store | Not for Access. Otherwise adds **R.O.EYE - Consent - SingleView** with its code line. The page shows no confirmation after saving, so no error counts as saved |
| Tracking tag settings | **Conversion Tag and Image Pixel integrated** (the page is reloaded first) |
| Account details | IP tracking, and stripping the referrer path when it has no valid domain |
| Mobile tracking | **Tracking is implemented on mobile site** |
| Advertiser settings | Manual Approval, Validation Period Days |
| Pre-join publishers | Publishers 45628 and 111, retried up to 5 times if the page shows an error |

**Signed out during a run.** If a page lands on Awin's sign-in instead, it's marked ⚠ and the box offers **Sign in to Awin**, which brings that tab to the front so you can sign in there. If Awin has signed you out altogether, the setup stops rather than failing every page after it. Either way, **Retry failed pages** then redoes only the pages that didn't work (and those not started), in their own tabs, after checking you're signed in again.

Each tab is marked ✓ saved, ✎ filled, ⏭ skipped or ⚠ needs a look. **Details** under the progress bar lists each page's result, and **Copy results** copies it. A MID of 0 (advertiser not created in Awin yet) can't be run. **Just open the tabs** opens the pages without filling anything, as before.

**Implementation Status.** When a **Run and save** finishes with at least one page saved, the setup does the last step of the procedure for you: on the status path at the top of the record it clicks **Consultation**, then **Mark as Current Implementation Status**. It only does this while the status is **Not Started**, so a record that's further along is never moved back. A cancelled run, a run stopped by an Awin sign-out, and **Fill only** leave the status alone. If the path isn't there, or Salesforce doesn't confirm the change, the box says so and you mark Consultation by hand. The result goes in the Chatter summary.

**Summary in Chatter.** After **Run and save**, if at least one page was saved, a short plain summary is posted to the record's **Chatter**. At the top: the **default commission group** and the **validation period** as they were set (or why not). Then one line of page counts, and only what needs attention: the pages that need a look (and why) and any not started, plus the SingleView Setup and Implementation Status results. After **Retry failed pages**, an updated summary is posted. If the record tab isn't in front when the run ends, it's posted as soon as you come back to it. **Fill only** posts nothing. Posting opens the record's Chatter tab.

```
New Implementation setup for MID 123456 (Accelerate)

Default commission group: Sale, Percentage, 5%
Validation period: 30 days

Pages: 8 saved, 2 skipped.
SingleView Setup: MasterTag Enabled, New.
Implementation Status: Consultation (was Not Started).

Posted by UI_AutoSetup_Prototype v3.0.15 AutoSetup prototype.
```

While the setup runs, the **Awin logo** at the front of the progress bar is a little pixel fire, flickering in the logo's own shape and colours. It stands still when the run ends.

### Internal Review

**🔎 IR** on an Implementation record opens the **Internal Review** panel (Optimus IR v0.2.23, built by Kaio Da Mota and folded into this prototype) in a small window next to the record:

1. The MID comes from the record, and the panel checks you're signed in to Awin (**Sign in to Awin** if not).
2. It reads the record's **marketing checklist** first, the same fields the setup reads: Platform Offer, Commission type and Commission Amount, and Auto validation period. The **setup's own Chatter note** ("New Implementation setup for MID …") is the backup for anything the checklist doesn't say. The note also tells the review which setup pages needed a look, and its validation value stands when it matches the record ("already set, kept" on Access). A post titled **Implementation Checklist** fills what neither says (the contract's publisher approval; otherwise approval is manual, as the setup sets it). The tracking fee is optional. Anything missing gets a small form, and any differences between the sources are shown in the panel. If you know the details aren't there, **Enter the details by hand** opens every field at once and stops the Chatter search. **Run Internal Review** is never greyed out: clicked early, it says what's missing, or starts by itself as soon as the record has been read.
3. **Run Internal Review** reads 11 Awin UI pages in a collapsed **IR <MID>** tab group (each tab closes as soon as it's done), all at once where it can, runs the checks and fixes what it may: dedup pair in the query string append, awc, accepted domains (Shopify's myshopify domain too), SingleView, mobile tracking, test publishers 111 and 45628, validation period and manual approval. Each fix is saved and read back.
4. It deletes the programme's test transactions, last, once everything else is done. If the report has anything for a person to check (a fix that didn't stick, a **To check**, a page not checked, or a test transaction that isn't in Tracking diagnosis), the review **keeps the test transactions** and waits. The panel lists what to check, with **Carry on and delete test transactions** and **Stop: keep them**. Either way it then updates the record and posts the report, which says whether they were deleted or kept. If everything passes, they're deleted straight away, as before.
5. It fills blank record fields (voucher tracking, custom parameters, eCommerce platform, dedup parameter and channel, Link Builder, MT plugins activated, Successful Tracking Test), and posts a short report to Chatter that @mentions the integrator. The Tech sign-off stays with them.

Shift-click 🔎 IR, or **Just open the IR tabs** in the panel, to only open the 11 IR pages as before. Its settings (region paths, history) are in its own block on the Settings page; its date format and site check are the shared ones. Full detail: [`autofill/review/README.md`](autofill/review/README.md).

### Fields filled by both

After a scan, Moonfill fills five Technical Checklist fields from the result. The checklist's team defaults also set three of them:

| Field | Set by the scan | Checklist team default |
|---|---|---|
| Moonpull Status | from the scan | left untouched |
| Consent Signals | from the scan | left untouched |
| Transparency & Consent Framework Plugin | from the scan (Yes/No) | always **No** |
| AASAF | from the scan (Yes/No) | always **No** |
| Consent Management Platform | detected CMP, or Other | always **Other** |

So **Fill & save after a scan replaces the scan's values for the last three.** To keep the scan's values, set those three to **Leave untouched** in Settings.

---

## What you need

- **Microsoft Edge or Google Chrome** installed on your computer.
- To be **signed in to Salesforce and Microsoft 365** in the same browser, and **to the Awin UI** (ui.awin.com) for the setup and the review.
- **For scans: access to the shared Moonpull results folder.** Please contact Rodier or Thomas on Teams to request access to the Moonpull batch results folder. This is where the scan results are saved. The Technical Checklist needs no extra access.

---

## Install (developer mode)

Moonfill is not in the browser store yet, so it is installed from the folder you received.

**Microsoft Edge**
1. Unzip the Moonfill folder somewhere permanent, for example in Documents. Don't delete it afterwards.
2. Open `edge://extensions`.
3. Turn on **Developer mode** (bottom left).
4. Click **Load unpacked** and select the Moonfill folder (the one containing `manifest.json`).
5. Click the puzzle icon in the toolbar and pin the extension (**UI_AutoSetup_Prototype**).

**Google Chrome**
1. Unzip the folder somewhere permanent.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the Moonfill folder.
5. Pin the extension (**UI_AutoSetup_Prototype**) from the puzzle icon.

**Already using Moonfill, the team release (Moonfill x SF_autofill), the separate SalesforceAutofill or Optimus Internal Review?** Let any running scans finish, then turn the others off or remove them before loading this one, so two copies don't run on the same page. Scan history from the old Moonfill doesn't carry over.

**To update:** replace the files in the folder with the new ones, open the extensions page again, click the **reload** icon on the extension's card, then refresh your Salesforce tabs.

---

## Golden rules to avoid problems

**Scans**
1. **Start from the record.** Always click **🌙 Submit Moonpull form** on the Salesforce record of the program you want to scan.
2. **Let the form finish.** Don't switch to another app during the first 25 seconds. The form needs to be on screen to fill itself in. When the tab closes, you are free.
3. **Keep the browser open.** You can minimize it, but don't close it until the card says Complete. If you close it by mistake, reopen it within 10 minutes of submitting and Moonfill carries on.
4. **Keep the browser visible when the result arrives, if you can.** If Edge or Chrome is hidden behind other windows, Salesforce can't draw its page, so the result waits. Leaving the browser visible on one of your screens avoids this. Otherwise it is posted as soon as you bring the browser to the front.
5. **Stay signed in.** If your Salesforce or Microsoft 365 session expires, Moonfill can't read the result or open the record. Sign in again and use Force paste if needed.
6. **Don't type in the Chatter box of that record** while its result is being posted.
7. **Don't scan the same MID twice by accident.** Each click is a new scan and gets its own post.
8. **Check the notification.** If you see "scan failed" or "result ready", click the extension's toolbar button.

**Technical Checklist**
1. **Save or cancel your own edits first.** The checklist won't start while the record is in edit mode, because Salesforce's Save would also save your unrelated changes.
2. **Don't fill the checklist while a scan result is being posted to the same record.** Wait until the card says Complete.
3. **New to it, or changed your settings?** Use **Check page** and **Fill only** first, on a record that's easy to put right.

---

## If something goes wrong

**Scans**

| Message | What to do |
|---|---|
| Result ready · waiting for the browser | Bring Edge or Chrome to the front. It posts by itself within a few seconds. Or click **Force paste**. |
| Failed: Chatter tab not found / "Share an update..." box did not appear | Click the extension's toolbar button, then **Force paste**. If it fails again, click **Copy result** and paste it into Chatter yourself. |
| Failed: no result after 10 minutes | The scan may have taken longer or failed. Check the Teams message. |
| Failed: result is for another MID | Nothing was posted. Check the Teams message and tell the project owner. |
| Can't read the result folder | Sign in to Microsoft 365 in this browser and check that you have access to the results folder. |
| The form opens but doesn't fill in | Don't click again. Tell the project owner. The form may have changed. |
| Nothing happens after clicking 🌙 | Reload the page and check that the extension is on in the extensions page. |

**Technical Checklist**

| Message | What to do |
|---|---|
| Checklist not found (grey dot) | Open the record's **Details** tab. If the checklist is collapsed, that's fine: it is expanded automatically. |
| The record is already in edit mode | Save or cancel your own edits, then click again. |
| "…" changed unexpectedly, so nothing was saved | Something else changed while filling, such as a dependent field, or a scan filling the record at the same time. Click **Cancel**, wait a moment and try again. |
| Option "…" is not available | That dropdown doesn't have the value. If you set it in Settings, correct it there. Otherwise tell the project owner. Nothing was saved; click **Cancel**. |
| No template: platform detection isn't allowed yet | Open **Settings** and click **Allow platform detection**, or pick the platform in the **Template** menu. |
| No template: no platform signs found / signs of both… | The site's platform couldn't be told for sure. Pick it in the **Template** menu and click again, or keep the default fill. |
| Pixel Sent left as it is: no "Implementation History" box… | If the history box is on the **Related** tab, open that tab once, go back to Details and click again. |
| Saved, but … don't show the expected value | Check those fields on the record. Salesforce may have changed them on save. |

When you report a problem, please send a screenshot of the Moonfill card or the checklist panel, the program name and the time. For the checklist, the **Check page** report helps too.

---

## Good to know

- The result posted in Chatter is the same text as the Teams message, without your name and job title.
- The Teams message is still sent, so you always have a copy.
- Moonfill only talks to Microsoft Forms, SharePoint (the Moonpull results folder and, once set up, the usage list) and Salesforce, using your own logins. It stores the scan list on your computer only. Your checklist settings are kept in your browser profile, and follow it to your other devices if browser sync is on. The checklist works on the page in front of you. Apart from the usage count, its only network request is platform detection: when you click Fill with Auto-detect on, it reads the client's public site (the record's Landing Page URL) without your cookies, and only once you've allowed it in Settings.
- Moonfill counts each use (checklist fills, Moonpull scans, New Implementation and IR) by the record's Assigned TC, to measure adoption. No client information is recorded.
- Moonfill is for scans started from a Salesforce record. There is no manual MID box anymore.
- The checklist only changes the **Technical Checklist**. Other checklists and fields on the record are compared before and after, and never saved by it.

---

## For developers

| Path | What it is |
|---|---|
| `manifest.json`, `background.js`, `content.js`, `salesforce.js`, `popup.*`, `css/`, `assets/` | Moonpull scans, the toolbar popup and the record buttons |
| `autofill/` | The Technical Checklist: panel, fill/save engine, settings page. See [`autofill/README.md`](autofill/README.md) |
| `autofill/setup/` | The New Implementation setup (🚀) |
| `autofill/review/` | The Internal Review (🔎 IR, Optimus IR). See [`autofill/review/README.md`](autofill/review/README.md) |
| `autofill/dev/` | Checklist field specification, mock record pages and tests (`cd autofill/dev && npm ci && npm test`) |

Record page buttons: colours and spacing are in the `injectStyles` block of `salesforce.js`. The steps of each post attempt are logged in the service worker console ("Moonfill post steps").

---

## Who built it

| Tool | Built by | Code here | Its own repository |
|---|---|---|---|
| Moonfill (Moonpull scans) | **Rodier Sangibala** | `manifest.json`, `background.js`, `content.js`, `salesforce.js`, `popup.*` | [OptimusRodier/moonfill](https://github.com/OptimusRodier/moonfill) |
| Checklist Autofill (SalesforceAutofill) | **Oscar Coleman** | `autofill/` | |
| AutoSetup (New Implementation setup) | **Oscar Coleman** | `autofill/setup/` | this repository |
| Internal Review (Optimus IR) | **Kaio Da Mota** | `autofill/review/` | `optimus-internal-review-checker` |

The combined extension, and the work that makes the four tools fit together (the floating button, the shared sign-in check and edit lock, the review reading the setup's note, the one settings page), are by Oscar Coleman.

## Licence

See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
- **For Awin staff only.** Neither the extension nor any part of it may be used or shared outside Awin.
- **Checklist Autofill, AutoSetup and the code that joins the four tools** (Oscar Coleman): Awin staff may use, copy and change it for their work for Awin, while they work for Awin (LICENSE, section 1).
- **Moonfill** (Rodier Sangibala) and the **Internal Review** (Kaio Da Mota): each author's own terms. Neither has published a licence yet, so ask the author before reusing their code outside this project.

## Support

Questions, bugs and ideas: contact the tool's author above, or the project owner (Oscar Coleman). For Moonfill itself: [GitHub Issues](https://github.com/OptimusRodier/moonfill).

## What's new

**The review keeps the test transactions when something needs a look (3.0.15, 25 November 2026)**
- The Internal Review now deletes the test transactions last. If its report has anything for a person to check (a fix that didn't stick, a **To check**, a page not checked, or a test transaction that isn't in Tracking diagnosis), the review **keeps the test transactions** and waits. The panel lists what to check, with **Carry on and delete test transactions** and **Stop: keep them**. Either way it then updates the record and posts the report, which says whether they were deleted or kept. If everything passes, they're deleted straight away, as before.

**New toolbar popup, FAQ, Awin staff only (3.0.14, 25 November 2026)**
- Clicking the extension's toolbar button now shows **UI AutoSetup**, not the old Moonfill menu: the four tools and the button that starts each on the record, your Moonpull scans as before (Force paste, Copy result, History), a **Settings** button and the credits. It follows the Settings page's look, light or dark.
- **[FAQ](FAQ.md)** for TCs and team leads.
- **Licence: for Awin staff only.** Oscar Coleman's code may be used, copied and changed by Awin staff for their work for Awin, and isn't to be shared outside Awin (LICENSE, section 1). Moonfill and the Internal Review stay under their authors' own terms.

**This repository (3.0.13, 24 November 2026)**
- AutoSetup_Prototype_V2 starts here, with 3.0.13 as its first version.

**Run and save sets Implementation Status to Consultation (3.0.12, 24 November 2026)**
- When **Run and save** finishes, the setup marks **Consultation** as the record's current Implementation Status, as the procedure says, only if it's still **Not Started**. The Chatter summary says what happened.
- **Moonfill waits up to 10 minutes** for a scan result (was 6.5) before it marks the scan as failed.

**Internal Review reads the marketing checklist (3.0.10, 24 November 2026)**
- **Enter the details by hand** in the review panel opens every field at once and stops the Chatter search. **Run Internal Review** is no longer greyed out: it says what's missing, or starts as soon as the record is read. (3.0.11)
- **🔎 IR takes its inputs from the record's marketing checklist first**, as the setup does (Platform Offer, Commission type and Amount, Auto validation period). The setup's Chatter note is now the backup, then the "Implementation Checklist" post, then the form. Where they differ, the record's value is used and the panel says so.

**Internal Review (added 19 November 2026, prototype)**
- **🔎 IR runs the Internal Review** (Optimus IR v0.2.23) from the record, in a small panel window: MID from the record, Awin sign-in checked for you, fixes made and read back, test transactions deleted, record updated, report posted to Chatter. Shift-click for just the tabs.
- The review's Salesforce update shares the record's edit lock with Moonfill and the checklist.
- **The review checks against the setup's Chatter note** (the source of truth), keeps the setup's query string and the myshopify website of Shopify stores, and reads pre-join publishers, mobile tracking, Link Builder and approval the way the setup does.
- **0 days of validation in the contract is set as −1** (not Access), by the setup and the review.
- **The floating button's 🚀 Setup and 🔎 IR always start:** with Moonfill's row hidden (or not drawn yet), they no longer say "isn't on this record yet".
- **LICENSE** and **NOTICE** added.
- **One Settings page for all four tools:** Shared settings, then a block for each tool (the review's own settings page is gone).

**Technical Checklist (added November 2026)**
- One-click fill and save of the Technical Checklist (30 fields), with **Check page** and **Fill only**.
- Pixel Sent from the record's creation date, and Successful Tracking Test from today's date.
- Personal **Settings** for every checklist field.
- **Platform templates** for 13 eCommerce platforms, picked by hand or detected from the client's site.
- Usage counting by Assigned TC, to measure adoption. No client information is recorded.
- **New Implementation setup:** a form on 🚀, then the setup pages are filled and saved one by one.
- **Clear checklist** preset in the Template menu.
- **The checklist needn't have been seen first:** Fill opens the Details tab and brings up the checklist (or SingleView Setup) itself, even if it was never scrolled to (as in Moonfill's own Techfill).
- **Floating button** menu style (Settings), draggable, with 🌙 Scan, 🔎 IR and 🚀 Setup in its menu.
- **Setup sign-in:** a sign-in page shown in a setup tab gets **Sign in to Awin**; a sign-out stops the run; **Retry failed pages** redoes only what didn't work.
- **Simpler Chatter summary**, with the commission group and validation period first.
- Moonfill's scan-field fill and the checklist fill never write to the record at the same time (a shared lock, from Moonfill upstream).

**v2.1**
- **Fills Salesforce fields from the result**, silently, right after the result is pasted: Moonpull Status, Consent Signals, Transparency & Consent Framework Plugin, AASAF and Consent Management Platform are set (existing values replaced) and saved. No setting; the notification only mentions fields that need a look.
- **Record page buttons:** Submit Moonpull form (left), IR (middle), New Implementation (right). One **IR button** on the Case page.
- **Temporary window** is tried after any retryable failure.

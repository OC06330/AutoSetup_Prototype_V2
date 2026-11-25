# UI AutoSetup prototype: frequently asked questions

Short answers for Technical Consultants, team leads and anyone deciding whether to use the extension. The [README](README.md) has the full detail.

---

## About the extension

### What is it?
A browser extension for **Microsoft Edge or Google Chrome** that puts four tools on the programme's **Salesforce Implementation record**:

| Tool | What it does | How you start it |
|---|---|---|
| 🌙 **Moonpull scan** (Moonfill) | Submits the Moonpull form, waits for the scan, posts the result to the record's Chatter and fills the five scan fields | **🌙 Submit Moonpull form** on the record |
| 📋 **Technical Checklist** (Checklist Autofill) | Fills 30 of the checklist's 45 fields with the team's agreed answers, checks nothing else changed, and saves | The **Checklist Autofill** panel (or the floating button) |
| 🚀 **New Implementation** (AutoSetup) | Sets the programme up on the ten Awin UI setup pages from the record, then posts a summary to Chatter | **🚀 New Implementation** on the record |
| 🔎 **Internal Review** (Optimus IR) | Checks the programme in the Awin UI, fixes what it safely can, deletes the test transactions, fills blank record fields and posts a report for the integrator | **🔎 IR** on the record |

### Who is it for?
Awin Technical Consultants who set up and review new programmes in Salesforce and the Awin UI.

### Who built it?
- **Moonfill** (Moonpull scans): Rodier Sangibala.
- **Checklist Autofill** and **AutoSetup**, and the work that joins the four tools: Oscar Coleman.
- **Internal Review** (Optimus IR): Kaio Da Mota.

### Why use it?
- **Time.** By the dashboard's own estimates, a scan saves about 10 minutes, a checklist fill about 10, and a setup about 4½. Together that's around 25 minutes per programme, before the Internal Review.
- **Consistency.** The same answers and settings every time, from the record, with no copying between tabs.
- **A record of what was done.** The scan, the setup and the review each post to the record's Chatter.

### Is it finished?
It's a **prototype**, in use and still being tested. Each tool has run successfully on Salesforce, and new changes are tried on live records before they're relied on. The **What's new** section of the README lists each version.

---

## Getting started

### What do I need?
- Edge or Chrome.
- To be signed in to **Salesforce** and **Microsoft 365** in the same browser, and to the **Awin UI** for the setup and the review.
- For scans, access to the shared **Moonpull results folder** in SharePoint (ask Rodier or Thomas on Teams).

### How do I install it?
It isn't in a browser store, so it's loaded from its folder:
1. Put the folder somewhere permanent, such as Documents.
2. Open `edge://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the folder that contains `manifest.json`.
5. Pin the extension from the puzzle icon in the toolbar.

### How do I update it?
1. Replace the files in the folder.
2. Click **reload** on the extension's card.
3. **Refresh your Salesforce tabs.**

### I installed it and the buttons don't work. Why?
Usually there are **two copies loaded**: an older Moonfill, team release or prototype as well as this one. Two copies fight over the same buttons on the record. To fix it:
1. In the extensions page, remove or turn off every other copy.
2. Reload this one.
3. Refresh the Salesforce tab.

A copy loaded from a new folder also starts with fresh settings, so allow **Reading client websites** again in Settings.

### Where are the settings?
Click the extension's toolbar button, then **Settings**. There's one Settings page for all four tools:
- **Shared:** menu style, reading client websites, date format.
- **Checklist Autofill:** what each checklist field is filled with.
- **Internal Review:** region paths and review history.

---

## Using the tools

### Moonpull scan: do I have to wait on the page?
- Only for the first **25 seconds**, while the form fills itself in and submits.
- After that, keep the browser open (minimised is fine).
- The result is usually ready after about 5 minutes and is posted to Chatter by itself.
- The toolbar button shows every scan with a timer, and keeps a **History**.

### Moonpull scan: what if it fails?
- Click the toolbar button.
  - **Force paste** posts a result that's waiting.
  - **Copy result** lets you paste it into Chatter yourself.
- A scan with no result after **10 minutes** is marked failed. The Teams message is still sent, so you always have a copy.

### Technical Checklist: what exactly does it fill?
- **30 of the 45 fields:**
  - 28 agreed answers;
  - **Pixel Sent**, from the record's creation date;
  - **Successful Tracking Test**, set to today.

  The two dates are filled only if they're empty.
- The other 15 fields, such as Tech notes, are left for you.
- With **platform detection** on, 13 eCommerce platforms get their own answers for six fields. Template answers only fill empty fields.

### Technical Checklist: can I check before it saves?
Yes:
- **Check page** only reads.
- **Fill only** fills without saving, so you review and save yourself.
- **Fill & save** checks that nothing else on the record changed before it saves, and confirms the saved values afterwards.

### New Implementation: what does it set up?
The ten Awin UI setup pages, from the record's Landing Page URL, Platform Offer, Commission type and amount, and Auto validation period:

| Page | What happens |
|---|---|
| Tracking settings | Filled |
| Invite user | Opened only |
| Commission groups | Filled, Percentage only |
| Plugin store | Filled, Accelerate and Advanced only |
| Tracking tag settings | Filled |
| Account details | Filled |
| Fee manager | Opened only |
| Mobile tracking | Filled |
| Advertiser settings | Filled |
| Pre-join publishers | Filled |

For Accelerate and Advanced, it also sets the record's **SingleView Setup** section.

### New Implementation: what are Run and save and Fill only?
- **Run and save** fills and saves each page, and checks the values stuck. Then it posts a summary to Chatter. If the record's **Implementation Status** is still **Not Started**, it marks it **Consultation**.
- **Fill only** fills each page and saves nothing, so you check and save each page yourself.

### New Implementation: what if a page goes wrong?
- That page is marked **⚠ needs a look** and left open, unsaved, and the run carries on with the next page.
- **Retry failed pages** redoes only the pages that didn't work.
- If Awin signs you out during a run, the setup stops and offers **Sign in to Awin**.

### Internal Review: what does it check and fix?
- **Its inputs:**
  - the record's marketing checklist first;
  - the setup's Chatter summary for anything the checklist doesn't say;
  - the "Implementation Checklist" post for the contract's publisher approval.
- **The pages:** it reads 11 Awin UI pages and fixes what it safely can, reading each fix back. The fixes cover:
  - the query string's dedup pair, awc and accepted domains;
  - SingleView and mobile tracking;
  - the test publishers;
  - the validation period and manual approval.
- **Clean-up:** it fills blank record fields and, last, deletes the programme's test transactions. If anything needs a look, it keeps them and waits: see below.
- **Report:** it posts a short report to Chatter that @mentions the integrator.
- **Sign-off:** the **Tech sign-off stays with the integrator**.

### Internal Review: why is it waiting before deleting the test transactions?
If the review finds anything for a person to check (a fix that didn't stick, a value it doesn't change itself, a page it couldn't read, or a test transaction that isn't in Tracking diagnosis), it keeps the test transactions so you can look first. The panel lists what to check:
- **Carry on and delete test transactions** deletes them, then updates the record and posts the report.
- **Stop: keep them** leaves them in place, then updates the record and posts the report, which says they were kept.

If everything passes, they're deleted straight away and nothing waits.

### Internal Review: the details aren't on the record. What now?
Click **Enter the details by hand**, which opens every field at once. **Run Internal Review** is never greyed out: if something's missing, it says what.

---

## Safety and data

### Can it break a record or an Awin account?
It's built to change only what it's meant to, and to check its work:
- **Only its own fields.** Each tool changes only the fields it's for. Everything else on the page is left as it is.
- **Nothing undone.** It never unticks, deletes or removes anything. The one exception is the review deleting that programme's **test transactions**.
- **Checked after saving.** The checklist, the setup and the review read back what they saved, and report anything that didn't stick.
- **One writer at a time.** The tools share an edit lock, so two of them never edit the record at once.
- **A review step if you want one.** **Fill only**, **Check page** and **Cancel** are always there.

### Whose logins does it use?
Yours: your own Salesforce, Microsoft 365 and Awin UI sessions, in your own browser. It has no logins or passwords of its own.

### Does it send data anywhere?
- It talks only to Salesforce, the Awin UI, Microsoft Forms and SharePoint (for scan results).
- With **Reading client websites** on, it also reads the client's own site, to detect its eCommerce platform.
- There's no outside server.
- Scan lists and settings stay in your browser profile.

### Does it track me?
- It counts each use (checklist fills, scans, setups, reviews) by the record's **Assigned TC**, to measure adoption and time saved.
- **No client information is recorded.**
- Until the team's SharePoint list is set up, the counts stay in your browser.

### Why does it ask to read websites?
- Only for **platform detection**, the setup's Shopify store address and Access query string, and the review's platform check. It reads the client's page and changes nothing.
- It's an **optional** permission that you grant once in Settings. Without it, the default answers are used.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| Nothing happens when I click a button | Make sure only one copy of the extension is on, reload it, then refresh the Salesforce tab |
| "Sign in to Awin" | Click it, sign in to the Awin UI, then **Check again** or **Retry failed pages** |
| The checklist panel shows a grey dot | Open the record's **Details** tab |
| "The record is already in edit mode" | Save or cancel your own edits, then click again |
| A scan says "Result ready · waiting for the browser" | Bring the browser to the front, or click **Force paste** |
| A setup page says ⚠ needs a look | Open that tab, check the page, then **Retry failed pages** or finish it by hand |

When you report a problem, send a screenshot, the programme name and MID, and the time. For the setup, **Copy results** gives the details.

---

## For developers

### Where's the code, and how is it tested?
- The [README](README.md#for-developers) lists the layout.
- The automated tests run against mock record and Awin pages: `cd autofill/dev && npm ci && npm test`.

### What licence is it under?
- **The extension is for Awin staff only.** Don't share it, or any part of it, outside Awin.
- **Checklist Autofill, AutoSetup and the code that joins the tools:** Awin staff may use, copy and change them for their work for Awin, while they work for Awin.
- **Moonfill** and the **Internal Review:** their authors' own terms. Ask them before reusing that code elsewhere.

See [LICENSE](LICENSE) and [NOTICE](NOTICE).

### Who do I contact?
- **About a tool:** its author (above).
- **About the extension as a whole:** Oscar Coleman.

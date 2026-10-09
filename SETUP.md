# Wedding Budget – Setup Guide

Think of it like a ship: the **Google Sheet is the logbook** (locked in the cabin), the
**Apps Script is the harbour pilot** (the only one with the cabin key), and the **web page is the
notice board on the pier** that anyone can walk past. The page asks the pilot for figures, and the
pilot only answers if you give the right passphrase.

There are **two pages**, both reading the same Sheet:

| Page | Link | What it does | Passphrase |
|---|---|---|---|
| Dashboard | `https://conazz.github.io/Wedding_Budget/` | read-only view | **view** passphrase (or the edit one) |
| Editor | `https://conazz.github.io/Wedding_Budget/edit.html` | add, edit, record payments, delete | **edit** passphrase only |

Edits made in the editor are written to the Sheet immediately, and the dashboard shows them the
next time it refreshes (every ~45 seconds while open, or on Refresh).

---

## Part A – Upgrading the script to the editing version (do this once)

1. In your TEST Sheet: **Extensions > Apps Script**.
2. Click **Code.gs**, select all, delete, then paste the new `Code.gs` from this folder. **Save** (disk icon).
3. **Optional view-only passphrase:** gear icon (Project Settings) > **Script Properties** > **Add script property**:
   name `VIEW_PIN`, value = a different passphrase to give family/friends who may look but not change.
   Your existing `PIN` stays as the **edit** passphrase. Click **Save script properties**.
4. **Deploy > Manage deployments** > pencil (Edit) > **Version: New version** > **Deploy**.
   The URL stays the same, so you don't change anything in the pages.
5. Open the editor link, enter the **edit** passphrase.

### Budget cover and payment notes (new)

- **Budget cover:** under *Remaining to pay*, both pages show Charles's and Justine's budget left, and whether the two together cover what's left to pay ("Enough, ₱X to spare" or "Short by ₱X"). Pages only, no script change.
- **Payment notes:** the *+ Payment* box has an optional Note. The note shows in the Payment history and is searchable. In the editor, each history entry has an **Add note / Edit note** button; the dashboard shows notes read-only.
- **Needs a script redeploy** (paste the new `Code.gs`, then **Deploy > Manage deployments > pencil > New version > Deploy**). The Payment Log tab gains two columns, *Note* and *Entry ID*; don't delete them.

### Who paid what (new)

On both pages, each person's budget card has a **Who paid what** button. It lists every item that person has paid toward, largest first, with their share of their own payments and how much of each item they covered. It uses figures the pages already load, so **no script change or redeploy is needed** for it.

### Payment log (new)

Every payment is now recorded with the **date and time (Manila time)**, **who paid** (Charles or Justine), the item and the amount.
- Open **Payment history** on either page, or tap **History** on an item card.
- The script creates a tab called **Payment Log** in your Google Sheet by itself on the first payment. Your existing tab is not changed. Please don't rename or sort that tab.
- Logged: payments recorded in the editor, changes to a Paid amount made in the Edit form (as the difference, a decrease shows as a minus), starting payments on a new item, and payments taken back when an item is deleted.
- **Not** logged: numbers you type straight into Google Sheets.
- To get this, redeploy the script once (**Deploy > Manage deployments > pencil > New version > Deploy**), as in step 4 above.

### Test checklist on the TEST copy (do all of these before touching the real Sheet)
- [ ] Add an item. It appears in the next empty row of the Sheet, and the Remaining / Percentage cells fill in by themselves.
- [ ] Edit an amount. The Sheet's Remaining and TOTAL update.
- [ ] Record a payment for Charles and one for Justine. The Paid cells go up.
- [ ] Delete an item (the page asks first). Its cells empty out; totals drop.
- [ ] Type letters into an amount box. The page refuses.
- [ ] Open the editor on two devices, change the same amount on both. The second one shows a "The Sheet changed" choice instead of overwriting.
- [ ] Turn on airplane mode, make an edit ("Saving…" then "Offline: will retry"), turn it off. It goes through once.
- [ ] Open the **Payment Log** tab in the Sheet. Each payment you made is a row with date, time and payer.
- [ ] Look at the Sheet. All the TOTAL / Remaining formulas are still formulas.

**How "delete" works:** it empties the item's cells and keeps the row, so formulas and the totals
never shift. Empty rows are reused by the next "Add item". You can delete the blank row yourself in
Google Sheets if you prefer.

---

---

## Part 0 – Safety first: work on a COPY

1. Open your budget Sheet.
2. **File > Make a copy**. Name it `Wedding Budget – TEST`.
3. Do **Part 1** on the TEST copy. Only repeat it on the real Sheet when everything works.

> **If something ever goes wrong in the real Sheet:** *File > Version history > See version
> history*, pick a version from before the problem, then **Restore this version**. Nothing in
> Phase 1 changes your cells, but it's good to know where the lifeboat is.

---

## Part 1 – Put the pilot on board (Apps Script)

1. In the Sheet, click **Extensions > Apps Script**. A new tab opens.
2. In the left list, click **Code.gs**. Select everything in the editor and delete it.
3. Open the file `Code.gs` from this project folder, copy **all** of it, and paste it in.
4. Check the line `var SHEET_GID = 2019565424;`. This must be the number after `gid=` in your
   Sheet's address bar. If you made a copy, **look at the copy's URL**; the number is usually the
   same, but if the page later says "Tab not found", change it here.
5. Click the **disk icon** (Save).

### Set the passphrase (it is stored on Google's side, never in the code)

6. In the Apps Script tab, click the **gear icon (Project Settings)** on the left.
7. Scroll to **Script Properties** and click **Add script property**.
8. Property: `PIN` (capital letters). Value: your passphrase.
   - **Use a long passphrase, not a 4-digit PIN.** For example four random words:
     `lantern-orchid-harbor-pebble`. Because the page's address is public, the passphrase is the
     only lock. A short PIN can be guessed by a determined person; a long phrase realistically can't.
   - Avoid spaces at the start/end.
9. Click **Save script properties**.

### Deploy it

10. Click the blue **Deploy** button (top right) > **New deployment**.
11. Click the gear next to "Select type" and choose **Web app**.
12. Fill in:
    - Description: `Wedding budget v1`
    - **Execute as: Me** (your account)
    - **Who has access: Anyone**
      (This sounds scary, but the pilot checks the passphrase on every request. "Anyone" just means
      no Google sign-in is required, which the page can't do.)
13. Click **Deploy**.
14. Google asks you to **Authorize access**. Click **Authorize access** and pick your account.
15. You'll see **"Google hasn't verified this app"**. This is expected: it's *your own* script,
    not a published app.
    - Click **Advanced**.
    - Click **Go to (project name) (unsafe)**.
    - Click **Allow**.
16. Copy the **Web app URL** (it ends in `/exec`). Keep it handy.

### Quick check

17. Paste the Web app URL into a new browser tab. You should see only:
    `{"ok":true,"service":"wedding-budget"}`. No budget data is shown, which is correct.

---

## Part 2 – Connect the page

1. Open `index.html` in a text editor (Notepad is fine).
2. Find this line near the bottom:

   ```
   var SCRIPT_URL = '';
   ```
3. Paste your Web app URL between the quotes, so it looks like:

   ```
   var SCRIPT_URL = 'https://script.google.com/macros/s/AKfy.../exec';
   ```
4. Save the file.

> The Web app URL is not a secret that you must hide (it will be visible in the public page), but
> without the passphrase it returns nothing.

---

## Part 3 – Put the page on the internet (GitHub Pages)

You need a free account at **github.com**.

### Create the repository (the harbour berth for your files)

1. On github.com click **+ > New repository**.
2. Name: `wedding-budget` (or anything you like).
3. Choose **Public** (free GitHub Pages requires it. The page contains **no budget data**).
4. Do **not** tick "Add a README". Click **Create repository**.

### Upload the files (easiest way, no commands)

5. On the new repo page click **uploading an existing file**.
6. Drag in **only** these from your project folder: `index.html`, `edit.html` and `.gitignore`.
   Do **not** upload any `.xlsx` / `.csv` export of your budget.
   (`Code.gs` and `SETUP.md` are harmless to upload, since the passphrase is not in them, but the site doesn't need them.)
7. Click **Commit changes**.

### Turn on GitHub Pages

8. In the repo: **Settings > Pages**.
9. Under **Build and deployment > Source**, choose **Deploy from a branch**.
10. Branch: **main**, folder: **/ (root)**. Click **Save**.
11. Wait about a minute and refresh. The page shows your link:

    `https://YOUR-GITHUB-USERNAME.github.io/wedding-budget/`

12. Open it **on your phone**, enter your passphrase, and your budget appears.
    Add it to your home screen (Share / menu > **Add to Home Screen**) for one-tap access.

> **Test from the real github.io link**, not just from your computer, because that is where the
> real browser rules apply.

### Updating the page later

- On GitHub, open `index.html` > the **pencil icon** > paste the new version > **Commit changes**.
  Or on the repo page: **Add file > Upload files** and drop the new `index.html` (it replaces the old one).
- GitHub Pages refreshes in about a minute. Hard-refresh your phone browser if it still shows the old one.

---

## Part 4 – After you change Code.gs (redeploy)

Saving the script is **not enough**. The live web app keeps running the old version until you redeploy:

1. Apps Script > **Deploy > Manage deployments**.
2. Click the **pencil (Edit)** icon on your deployment.
3. **Version: New version**. Click **Deploy**.

The **URL stays the same**, so you don't touch `index.html`. (Choosing "New deployment" instead
would create a *new* URL.)

---

## Part 5 – Switching from the TEST copy to the real Sheet

Only after everything works on the copy (Phase 2 will add a checklist for add/edit/delete):

1. Repeat **Part 1** inside the real Sheet (new deployment, new URL).
2. Paste the new URL into **both** `index.html` and `edit.html` (Part 2: the `SCRIPT_URL` line) and update them on GitHub.

---

## Privacy notes (plain words)

- The public page contains **no budget figures and no passphrase**. Without the passphrase, the
  pilot says nothing.
- After **5 wrong tries** the pilot refuses everyone for **15 minutes**. The downside is that a
  stranger could lock *you* out for 15 minutes by guessing; it clears itself.
- The page asks search engines not to list it (`noindex`) and uses no analytics or trackers.
- **"Lock this device"** forgets the passphrase and wipes the saved copy of the budget from that
  phone/computer. Use it if you lend or lose a device.
- **Your Sheet itself is currently "anyone with the link can view".** That is a bigger leak than the
  page. In the Sheet: **Share > General access > Restricted**, and add only you and Justine.
  The pilot still works because it runs as you.
- Never put an exported `.xlsx` / `.csv` of the budget in this folder's GitHub repo. The
  `.gitignore` blocks them as a second safety net.
- Stronger alternatives later if you want them: Google sign-in (per-person login, heavier setup)
  or paid GitHub private Pages.

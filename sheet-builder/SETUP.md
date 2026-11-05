# Setup: Google Sheets access for the revenue tracker builder

The builder signs in as you and creates the workbook in your Drive. It asks for one permission,
`drive.file`, which covers **only files this app creates**. It cannot see or change any other sheet, document
or file in your Drive, including the Quote Calculator sheet.

This is a separate app from the Quote Calculator's, so it has its own project, its own sign-in and its own
cloud environment, and either can be revoked without affecting the other.

You do steps 1 to 5 once. Total time is about 15 minutes.

## 1. Create a Google Cloud project
1. Go to https://console.cloud.google.com/ and sign in as **sam.drummond@seamlessdata.co.nz** (the same
   account the Quote Calculator uses).
2. Open the project picker, choose **New Project** and name it `revenue-tracker-builder`.
3. In that project go to **APIs & Services → Library** and enable both:
   - **Google Sheets API** (do **not** enable the Google Drive API: leaving it off means nothing here can
     delete or trash the spreadsheet file itself)

## 2. Configure the OAuth consent screen
1. Go to **APIs & Services → OAuth consent screen** (it may be called **Google Auth Platform → Branding**).
2. For **User type** choose **Internal**, so only seamlessdata.co.nz accounts can sign in and Google does not need
   to verify the app.
3. App name: `Revenue Tracker Builder`. Support contact: your email.
4. You do not need to add scopes here. The script asks for them when you sign in.

## 3. Create an OAuth client
1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type:** Desktop app.
3. Download the JSON file and save it in this folder (`sheet-builder/`) as **`credentials.json`**.
   It is git-ignored, so it is never committed.

## 4. Sign in once, on your own machine
```bash
cd sheet-builder
npm install
npm run sign-in
```
A browser window opens. Sign in and approve. A `token.json` file is saved here (also git-ignored).

## 5. Give the token to the cloud environment
The cloud has no browser, so it reads the token from an environment variable instead.

1. Run `npm run show-token`. It prints the token as one line.
2. In Claude Code on the web, open the **advanced-revenue-monitor** environment
   (environment menu in the session's title bar → **Edit**, or Settings → Environments).
3. Add an environment variable named **`GOOGLE_TOKEN_JSON`** and paste that one line as its value.
4. Save. Do this **before** starting the next session, because variables are only read when a session starts.
5. Delete the local `credentials.json` and `token.json` once a cloud run has worked, if you want.

> **Never paste the token into a chat or commit it.** It is the key to this app's access. Anyone who can edit
> the environment can use it. To revoke at any time, remove "Revenue Tracker Builder" at
> https://myaccount.google.com/permissions and delete the variable.

The environment should allow only `oauth2.googleapis.com` and `sheets.googleapis.com` (plus package
registries). `drive.googleapis.com` is no longer needed and can be removed from its network settings.

## What the builder can and cannot do
- It works in **one spreadsheet**, pinned in `src/workspace.ts` (`SPREADSHEET_ID`, or the `SHEET_ID` variable).
- It can read, write, append, add tabs and format.
- It **cannot** create spreadsheets, delete the file, or delete/clear tabs, rows, columns or ranges: those
  requests are rejected in code, and the Drive API is never called.

## 6. Check it works
Start a **new session on the `advanced-revenue-monitor` environment** with this repo selected and ask Claude to
run the smoke test. Or run it yourself:

```bash
npm run smoke
```

It writes four test formulas into a `smoke` tab of the workspace sheet and checks they calculate. Expect
five `PASS` lines. It also records how real Google Sheets rounds `1.005`, which the engine must match.

## If something is blocked
- **Can't create a project, or an API is blocked:** your Workspace admin may restrict this. Ask them to allow
  Cloud projects for your account, or to create the project and give you access.
- **"Access blocked" when signing in:** the admin may need to trust the OAuth app under
  **Admin console → Security → API controls**.
- **"Google did not return a refresh token":** remove the app at https://myaccount.google.com/permissions,
  delete `token.json`, and run `npm run sign-in` again.
- **Smoke test fails with a network error in the cloud:** the session is probably not on the
  `advanced-revenue-monitor` environment, or `GOOGLE_TOKEN_JSON` was added after the session started.

## Limit it with Google: use a service account (recommended)

A personal sign-in can reach every file the app created and is the owner of them. A service account is a
separate identity that Google limits to exactly the spreadsheets you share with it, and it cannot delete a
file it does not own.

1. In the `revenue-tracker-builder` project go to **IAM & Admin → Service Accounts → Create service account**
   (name `sheet-builder`). Skip the optional role and user-access steps: it needs **no** project roles.
2. Open it → **Keys → Add key → Create new key → JSON**. Download the file.
3. Open the workspace spreadsheet, click **Share**, add the service account's email
   (`...@revenue-tracker-builder.iam.gserviceaccount.com`) as **Editor**, untick **Notify**, and keep you as owner.
   In the share dialog's settings, turn **off** "Editors can change permissions and share".
4. Confirm **Google Drive API** is **disabled** in **APIs & Services → Enabled APIs** (only the Sheets API is on).
5. In the `advanced-revenue-monitor` cloud environment, add a variable `GOOGLE_SERVICE_ACCOUNT_JSON` with the
   whole key file contents, and **remove `GOOGLE_TOKEN_JSON`** so the personal sign-in is no longer available.
   Remove `drive.googleapis.com` from the allowed hosts. Start a new session afterwards.
6. Revoke the old personal access at https://myaccount.google.com/permissions ("Revenue Tracker Builder").
7. Run `npm run smoke`. It should print no "signing in as a person" warning.

Google keeps **version history** (File → Version history), so you can restore the sheet to any earlier state
if a tab or range is ever overwritten.

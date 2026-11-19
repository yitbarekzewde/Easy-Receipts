# Easy Receipt Apps Script Backend

`Code.gs` is the only Apps Script file to add to the deployment. Its single `doPost(e)` routes email OTP verification, password reset, sign-in notifications, support messages, developer contact messages, and receipt emails by the JSON `action` field.

## Install

1. Create or open the Apps Script project that will serve this web app.
2. Replace the project's contents with this folder's `Code.gs` and `appsscript.json`. Do not add the retired scripts from the subfolders; they also defined `doPost(e)` and are no longer needed.
3. In **Project Settings**, show the `appsscript.json` manifest and replace it with this folder's manifest.
4. Confirm `FIREBASE_PROJECT_ID` in `Code.gs` is `easy-receipts-2`; set `SUPPORT_EMAIL` and `CONTACT_EMAIL` to the desired inboxes.
5. In Google Cloud IAM, grant the account that deploys/runs the script the Firebase Authentication Admin role on the Firebase project. The Identity Toolkit API must be enabled. This permission is needed to set `emailVerified` and reset a user's password.
6. In the Apps Script editor, run `authorizeServices()` once and approve the requested Mail, URL Fetch, and Identity Toolkit permissions.
7. Deploy as a **Web app**, executing as **User deploying**, with access set to **Anyone**. Edit the existing deployment and select a new version to keep its `/exec` URL unchanged.
8. If the deployment URL changes, replace the existing `/exec` URL in both `main.js` files, both login and forgot-password pages, both credit-customer scripts, and the contact form pages. Receipt and support URL constants in `main.js` already alias `APPS_SCRIPT_URL`.

The script sends registration, manual-profile verification, and password-reset codes by email and expires them after 10 minutes. It limits incorrect OTP attempts and rate-limits outgoing mail. Requests use the `sendOTP`, `verifyOTP`, `sendManualProfileOTP`, `verifyManualProfileOTP`, `sendResetOTP`, `resetPassword`, `notifyAuthEvent`, `sendSupportEmail`, `sendDeveloperContact`, and `sendReceiptEmail` actions. Receipt and support attachments are limited to 10 MB and common image/document types.

## Quick check

Open the deployed `/exec` URL with a browser. A JSON response with `"status":"ready"` confirms the deployment is reachable. Then test with a non-production account and a small attachment before using it for real customer support.

The deployment is publicly callable because the static site must reach it. Apps Script mail quota, per-address limits, and OTP limits reduce abuse, but they are not a replacement for a production API gateway or stronger request attestation.

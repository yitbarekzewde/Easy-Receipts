# Easy Receipt Apps Script Backend

`Code.gs` handles the app's email OTP registration, email verification, password-reset OTP, Firebase password update, support email with an optional attachment, and receipt email with an attachment.

## Install

1. Create or open the Apps Script project that will serve this web app.
2. Replace its `Code.gs` with the contents of this folder's `Code.gs`.
3. In **Project Settings**, show the `appsscript.json` manifest and replace it with this folder's manifest.
4. Confirm `FIREBASE_PROJECT_ID` in `Code.gs` is `receipts-eccf0` and set `SUPPORT_EMAIL` to the inbox that should receive support requests.
5. In Google Cloud IAM, grant the account that deploys/runs the script the Firebase Authentication Admin role on the Firebase project. The Identity Toolkit API must be enabled. This permission is needed to set `emailVerified` and reset a user's password.
6. In the Apps Script editor, run `authorizeServices()` once and approve the requested Mail, URL Fetch, and Identity Toolkit permissions.
7. Deploy as a **Web app**, executing as **User deploying**, with access set to **Anyone**. Deploy a new version and copy the `/exec` URL.
8. If the deployed URL differs from the current one, replace `APPS_SCRIPT_URL` in both `main.js` files and the endpoint constants in both registration, verification, and forgot-password pages.

The script sends verification/reset codes by email and expires them after 10 minutes. It limits incorrect OTP attempts and rate-limits outgoing mail. Support and receipt payloads use the `sendSupportEmail` and `sendReceiptEmail` actions, respectively. Attachments are limited to 10 MB and common image/document types.

## Quick check

Open the deployed `/exec` URL with a browser. A JSON response with `"status":"ready"` confirms the deployment is reachable. Then test with a non-production account and a small attachment before using it for real customer support.

The deployment is publicly callable because the static site must reach it. Apps Script mail quota, per-address limits, and OTP limits reduce abuse, but they are not a replacement for a production API gateway or stronger request attestation.

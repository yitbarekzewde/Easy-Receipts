# Global business-account dashboard

The global dashboard uses Supabase project
`https://jxjttlprbbobqksxtcww.supabase.co` as a protected reporting database.
Firebase Authentication remains the account directory, and Firestore remains
the app's source of customer and receipt data. Loading an account page mirrors
its account summaries to Supabase; opening an account refreshes that user's
customer and receipt summaries from Firestore, atomically replaces the
corresponding Supabase reporting rows, and reads the dashboard result from
Supabase. This is a reporting sync, not a migration of the app's primary data.

The Supabase tables have row-level security enabled with no browser access
policies. Only Firebase Functions use the Supabase service-role secret. The
callable functions separately require a Firebase Auth token with the trusted
`admin: true` custom claim. Never expose the Supabase service-role key in the
browser, repository, or app configuration.

## Set up the Supabase project

1. In the Supabase SQL Editor for project
   `https://supabase.com/dashboard/project/jxjttlprbbobqksxtcww/sql/new`, run
   [`../supabase/migrations/20261104225000_create_business_reporting.sql`](../supabase/migrations/20261104225000_create_business_reporting.sql).
2. In Firebase project `easy-receipts-2`, configure the Supabase service-role
   key as a Firebase Functions secret. Run this command locally; the CLI
   prompts for the value without putting it in the command:

   ```powershell
   npx -y firebase-tools@latest functions:secrets:set SUPABASE_SERVICE_ROLE_KEY --project easy-receipts-2
   ```

   Find the server-side key in Supabase Project Settings → API Keys. Do not use
   the public anon/publishable key for this server operation.

## Grant dashboard access

Use a trusted workstation or Cloud Shell with Google Cloud Application Default
Credentials for project `easy-receipts-2`:

```powershell
gcloud auth application-default login
cd functions
npm install
node scripts/set-admin-claim.js admin@example.com
```

Replace the example with the Firebase Authentication email of the administrator.
Never add service-account keys or credentials to this repository. The account
must sign in again after its claim is granted.

## Deploy

The app's `.firebaserc` default may point to a different project, so deploy
explicitly to the project containing `easy-receipts-main`:

```powershell
npx -y firebase-tools@latest deploy --only functions --project easy-receipts-2
```

Cloud Functions deployment may require the project to use the Blaze billing plan.
The functions are deployed in `africa-south1`, matching the Firestore database.

After deployment, sign in to the dashboard with the Firebase administrator
account, then use **Sync & load accounts**. Account metadata is synchronized a
page at a time; each selected account's customer and receipt data is refreshed
when its details are opened. No Supabase public API key is needed in the browser.

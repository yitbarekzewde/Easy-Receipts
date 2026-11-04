# Global business-account dashboard

The dashboard's global account view reads Firebase Authentication accounts and
the `p3_saved_customers` / `p3_pos_snapshots` data stored under each user's
`users/{uid}/appData` path. It exposes customer contact details and receipt
transactions, so only Firebase users with the trusted `admin: true` custom
claim can call the server-side functions. Firestore rules remain unchanged;
the functions use the Admin SDK and must not be made public.

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

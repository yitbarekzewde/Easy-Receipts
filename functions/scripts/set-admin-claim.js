"use strict";

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const PROJECT_ID = "easy-receipts-2";
const email = process.argv[2];

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Usage: node scripts/set-admin-claim.js admin@example.com");
    process.exitCode = 1;
} else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    const auth = getAuth();
    auth.getUserByEmail(email)
        .then(user => auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true }))
        .then(() => console.log(`Granted the admin claim to ${email}. Have the user sign in again to refresh their token.`))
        .catch(error => {
            console.error("Could not grant the admin claim.", error);
            process.exitCode = 1;
        });
}

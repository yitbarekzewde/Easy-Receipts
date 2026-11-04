"use strict";

const { getApp, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { buildBusinessData, parseBusinessArray } = require("./business-data");

const PROJECT_ID = "easy-receipts-2";
const DATABASE_ID = "easy-receipts-main";
const REGION = "africa-south1";
const CHUNK_MARKER = /^__EASY_RECEIPT_CHUNKS_V1__:(\d+)$/;
const MAX_CHUNKS = 9;
const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore(getApp(), DATABASE_ID);

function requireAdmin(request) {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sign in to access the business account list.");
    }
    if (request.auth.token.admin !== true) {
        throw new HttpsError("permission-denied", "This account is not authorized to view business account data.");
    }
}

function pageSizeFrom(data) {
    const requested = data && data.pageSize;
    if (requested == null) return PAGE_SIZE;
    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_PAGE_SIZE) {
        throw new HttpsError("invalid-argument", `Page size must be from 1 to ${MAX_PAGE_SIZE}.`);
    }
    return requested;
}

function accountSummary(user) {
    return {
        uid: user.uid,
        displayName: user.displayName || "",
        email: user.email || "",
        disabled: user.disabled,
        createdAt: user.metadata.creationTime || "",
        lastSignInAt: user.metadata.lastSignInTime || ""
    };
}

async function readBusinessArray(uid, key) {
    const baseRef = db.doc(`users/${uid}/appData/${key}`);
    const baseSnapshot = await baseRef.get();
    if (!baseSnapshot.exists) return [];

    const stored = baseSnapshot.get("value");
    if (typeof stored !== "string") {
        throw new HttpsError("failed-precondition", `Saved ${key} data has an invalid format.`);
    }

    const match = stored.match(CHUNK_MARKER);
    let value = stored;
    if (match) {
        const count = Number(match[1]);
        if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) {
            throw new HttpsError("failed-precondition", `Saved ${key} data has an invalid chunk count.`);
        }
        const chunks = await Promise.all(Array.from({ length: count }, (_, index) =>
            db.doc(`users/${uid}/appData/${key}__chunk_${index}`).get()));
        if (chunks.some(chunk => !chunk.exists || typeof chunk.get("value") !== "string")) {
            throw new HttpsError("failed-precondition", `Saved ${key} data is incomplete.`);
        }
        value = chunks.map(chunk => chunk.get("value")).join("");
    }

    try {
        return parseBusinessArray(value, key);
    } catch (error) {
        logger.warn("A user's saved business data could not be parsed.", { uid, key, error: error.message });
        throw new HttpsError("failed-precondition", error.message);
    }
}

exports.listBusinessAccounts = onCall({ region: REGION, maxInstances: 10 }, async request => {
    requireAdmin(request);
    const data = request.data || {};
    const pageToken = data.pageToken == null ? undefined : data.pageToken;
    if (pageToken !== undefined && (typeof pageToken !== "string" || pageToken.length > 2048)) {
        throw new HttpsError("invalid-argument", "The account page token is invalid.");
    }

    try {
        const page = await auth.listUsers(pageSizeFrom(data), pageToken);
        return {
            accounts: page.users.map(accountSummary),
            nextPageToken: page.pageToken || null
        };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error("Could not list Firebase business accounts.", error);
        throw new HttpsError("internal", "Could not load accounts. Please try again.");
    }
});

exports.getAccountBusinessData = onCall({ region: REGION, maxInstances: 10, timeoutSeconds: 120, memory: "512MiB" }, async request => {
    requireAdmin(request);
    const uid = request.data && request.data.uid;
    if (typeof uid !== "string" || !uid || uid.length > 128) {
        throw new HttpsError("invalid-argument", "A valid account ID is required.");
    }

    try {
        const account = await auth.getUser(uid);
        const [customerRecords, receiptRecords] = await Promise.all([
            readBusinessArray(uid, "p3_saved_customers"),
            readBusinessArray(uid, "p3_pos_snapshots")
        ]);
        return {
            account: accountSummary(account),
            ...buildBusinessData(customerRecords, receiptRecords)
        };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        if (error.code === "auth/user-not-found") {
            throw new HttpsError("not-found", "The Firebase account no longer exists.");
        }
        logger.error("Could not load business data for an account.", { uid, error });
        throw new HttpsError("internal", "Could not load this account's business data. Please try again.");
    }
});

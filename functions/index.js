"use strict";

const { getApp, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { defineSecret, defineString } = require("firebase-functions/params");
const { createClient } = require("@supabase/supabase-js");
const { buildBusinessData, parseBusinessArray, toDatabaseRows } = require("./business-data");

const PROJECT_ID = "easy-receipts-2";
const DATABASE_ID = "easy-receipts-main";
const REGION = "africa-south1";
const CHUNK_MARKER = /^__EASY_RECEIPT_CHUNKS_V1__:(\d+)$/;
const MAX_CHUNKS = 9;
const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const SUPABASE_URL = defineString("SUPABASE_URL", {
    default: "https://jxjttlprbbobqksxtcww.supabase.co"
});
const SUPABASE_SERVICE_ROLE_KEY = defineSecret("SUPABASE_SERVICE_ROLE_KEY");

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore(getApp(), DATABASE_ID);
let supabase;

function getSupabase() {
    if (!supabase) {
        supabase = createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_ROLE_KEY.value(), {
            auth: { autoRefreshToken: false, persistSession: false }
        });
    }
    return supabase;
}

function checkSupabase(result, operation) {
    if (result.error) {
        logger.error(operation, { code: result.error.code, message: result.error.message });
        throw new HttpsError("internal", "Could not sync or load the Supabase business report. Please try again.");
    }
    return result.data;
}

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

function accountDatabaseRow(user) {
    const account = accountSummary(user);
    return {
        uid: account.uid,
        email: account.email || null,
        display_name: account.displayName || null,
        disabled: account.disabled,
        created_at: account.createdAt || null,
        last_sign_in_at: account.lastSignInAt || null,
        synced_at: new Date().toISOString()
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

exports.listBusinessAccounts = onCall({
    region: REGION,
    maxInstances: 10,
    secrets: [SUPABASE_SERVICE_ROLE_KEY]
}, async request => {
    requireAdmin(request);
    const data = request.data || {};
    const pageToken = data.pageToken == null ? undefined : data.pageToken;
    if (pageToken !== undefined && (typeof pageToken !== "string" || pageToken.length > 2048)) {
        throw new HttpsError("invalid-argument", "The account page token is invalid.");
    }

    try {
        const page = await auth.listUsers(pageSizeFrom(data), pageToken);
        const accountRows = page.users.map(accountDatabaseRow);
        const client = getSupabase();
        if (accountRows.length) {
            checkSupabase(
                await client.from("business_accounts").upsert(accountRows, { onConflict: "uid" }),
                "Could not sync account metadata to Supabase."
            );
        }
        const syncedAccounts = accountRows.length
            ? checkSupabase(
                await client.from("business_accounts")
                    .select("uid,displayName:display_name,email,disabled,createdAt:created_at,lastSignInAt:last_sign_in_at")
                    .in("uid", accountRows.map(account => account.uid)),
                "Could not load account metadata from Supabase."
            )
            : [];
        const accountsByUid = new Map(syncedAccounts.map(account => [account.uid, account]));
        return {
            accounts: accountRows.map(account => accountsByUid.get(account.uid)).filter(Boolean),
            nextPageToken: page.pageToken || null
        };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error("Could not list Firebase business accounts.", error);
        throw new HttpsError("internal", "Could not load accounts. Please try again.");
    }
});

exports.getAccountBusinessData = onCall({
    region: REGION,
    maxInstances: 10,
    timeoutSeconds: 120,
    memory: "512MiB",
    secrets: [SUPABASE_SERVICE_ROLE_KEY]
}, async request => {
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
        const businessData = buildBusinessData(customerRecords, receiptRecords);
        const rows = toDatabaseRows(uid, accountSummary(account), businessData);
        const client = getSupabase();
        checkSupabase(
            await client.rpc("replace_business_account_data", {
                p_account: rows.account,
                p_customers: rows.customers,
                p_receipts: rows.receipts
            }),
            "Could not sync business data to Supabase."
        );

        const [syncedCustomers, syncedReceipts] = await Promise.all([
            client.from("business_customers")
                .select("customer_key,name,phone,email,due,deposit")
                .eq("owner_uid", uid)
                .order("name", { ascending: true }),
            client.from("business_receipts")
                .select("receipt_key,receipt_ref,created_at,timestamp_text,customer,store,total,paid,items")
                .eq("owner_uid", uid)
                .order("created_at", { ascending: false, nullsFirst: false })
        ]);
        return {
            account: accountSummary(account),
            customers: checkSupabase(syncedCustomers, "Could not load customers from Supabase.")
                .map(customer => ({
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email,
                    due: customer.due,
                    deposit: customer.deposit
                })),
            receipts: checkSupabase(syncedReceipts, "Could not load receipts from Supabase.")
                .map(receipt => ({
                    id: receipt.receipt_key,
                    receiptRef: receipt.receipt_ref,
                    createdAt: receipt.created_at || "",
                    timestamp: receipt.timestamp_text || "",
                    customer: receipt.customer,
                    store: receipt.store,
                    total: receipt.total,
                    paid: receipt.paid,
                    items: Array.isArray(receipt.items) ? receipt.items : []
                }))
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

import {
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithCredential,
    signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    runTransaction,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const BUSINESS_KEYS = new Set([
    "p3_active_cart",
    "p3_auto_prices",
    "p3_box_barcodes",
    "p3_pos_drafts",
    "p3_pos_snapshots",
    "p3_saved_customers",
    "p3_saved_stores",
    "p3_stock_audit",
    "p3_stock_items"
]);
const MAX_VALUE_LENGTH = 200000;
const MAX_VALUE_BYTES = 800000;
const MAX_INITIAL_DOCUMENTS = 499;
const MAX_CHUNK_CODE_POINTS = 150000;
const CHUNK_MARKER_PREFIX = "__EASY_RECEIPT_CHUNKS_V1__:";
let activeUid = "";
let syncReady = false;
let applyingRemoteChanges = false;
let unsubscribeData = null;
let pendingWrites = new Map();
let flushTimer = 0;
let latestRemoteChangeAt = 0;

function isBusinessKey(key) {
    return BUSINESS_KEYS.has(key);
}

function getChunkCount(value) {
    const match = typeof value === "string" && value.match(/^__EASY_RECEIPT_CHUNKS_V1__:(\d+)$/);
    return match ? Number(match[1]) : 0;
}

function chunkKey(key, index) {
    return `${key}__chunk_${index}`;
}

function encodeCloudEntry(key, value) {
    if (value.length <= MAX_VALUE_LENGTH && new TextEncoder().encode(value).length <= MAX_VALUE_BYTES) {
        return [[key, value]];
    }
    const chunks = value.match(new RegExp(`[\\s\\S]{1,${MAX_CHUNK_CODE_POINTS}}`, "gu")) || [];
    if (chunks.length > 9) throw new Error("A business data record is too large to sync safely.");
    return [
        [key, `${CHUNK_MARKER_PREFIX}${chunks.length}`],
        ...chunks.map((chunk, index) => [chunkKey(key, index), chunk])
    ];
}

async function writeCloudValue(uid, key, value) {
    const baseReference = doc(db, "users", uid, "appData", key);
    const previousSnapshot = await getDoc(baseReference);
    const previousChunkCount = getChunkCount(previousSnapshot.data()?.value);
    const batch = writeBatch(db);
    let nextChunkCount = 0;

    if (value === null) {
        batch.delete(baseReference);
    } else {
        const entries = encodeCloudEntry(key, value);
        if (entries.length > 10) throw new Error(`The local record ${key} is too large to sync safely.`);
        entries.forEach(([entryKey, entryValue]) => {
            batch.set(doc(db, "users", uid, "appData", entryKey), { value: entryValue });
        });
        nextChunkCount = getChunkCount(entries[0][1]);
    }

    for (let index = nextChunkCount; index < previousChunkCount; index += 1) {
        batch.delete(doc(db, "users", uid, "appData", chunkKey(key, index)));
    }
    await batch.commit();
}

function getOrCreateSyncNotice() {
    let notice = document.getElementById("cloudSyncNotice");
    if (!notice) {
        notice = document.createElement("div");
        notice.id = "cloudSyncNotice";
        notice.setAttribute("role", "status");
        notice.setAttribute("aria-live", "polite");
        document.body.appendChild(notice);
    }
    notice.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:20000;width:min(340px,calc(100vw - 32px));padding:12px 14px;border-radius:8px;background:#172722;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.22);font:600 13px/1.45 Arial,sans-serif;box-sizing:border-box";
    return notice;
}

function hideSyncNotice() {
    const notice = document.getElementById("cloudSyncNotice");
    if (notice) notice.style.display = "none";
}

function createSyncNoticeCloseButton(notice) {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "\u00d7";
    closeButton.title = "Dismiss";
    closeButton.setAttribute("aria-label", "Dismiss");
    closeButton.style.cssText = "flex:0 0 auto;width:auto;border:0;background:transparent;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:2px 4px;margin:-2px -4px 0 0";
    closeButton.addEventListener("click", () => {
        notice.style.display = "none";
    });
    return closeButton;
}

function renderGoogleSignInButton(container) {
    const tryRender = () => {
        if (!window.google?.accounts?.id?.renderButton) return false;
        try {
            window.google.accounts.id.renderButton(container, { type: "standard", theme: "outline", size: "medium", text: "signin_with" });
        } catch (error) {
            console.error("Could not render the Google sign-in button.", error);
        }
        return true;
    };
    if (tryRender()) return;
    let attempts = 0;
    const retryTimer = window.setInterval(() => {
        attempts += 1;
        if (tryRender() || attempts >= 20) window.clearInterval(retryTimer);
    }, 250);
}

function showSignInPrompt(message) {
    const notice = getOrCreateSyncNotice();
    notice.replaceChildren();
    notice.style.background = "#172722";

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:flex-start;gap:10px";

    const text = document.createElement("div");
    text.textContent = message;
    text.style.cssText = "flex:1;margin-bottom:10px";
    header.appendChild(text);
    header.appendChild(createSyncNoticeCloseButton(notice));
    notice.appendChild(header);

    const googleButtonHost = document.createElement("div");
    notice.appendChild(googleButtonHost);
    renderGoogleSignInButton(googleButtonHost);
}

function showSyncNotice(message, isError = false, offerReload = false) {
    const notice = getOrCreateSyncNotice();
    notice.replaceChildren(document.createTextNode(message));
    notice.style.background = isError ? "#9b2c2c" : "#172722";
    if (offerReload) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Reload";
        button.style.cssText = "width:auto;margin-left:10px;padding:5px 9px;border:0;border-radius:4px;background:#fff;color:#172722;font-weight:700;cursor:pointer";
        button.addEventListener("click", () => window.location.reload());
        notice.appendChild(button);
    }
}

function readLocalBusinessData() {
    const entries = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!isBusinessKey(key)) continue;
        const value = localStorage.getItem(key);
        if (value !== null) entries.push([key, value]);
    }
    return entries;
}

function readPendingState(uid) {
    try {
        const stored = JSON.parse(localStorage.getItem(`easyReceiptPending:${uid}`) || '{"keys":[],"deleted":[]}');
        return {
            keys: new Set(Array.isArray(stored.keys) ? stored.keys.filter(isBusinessKey) : []),
            deleted: new Set(Array.isArray(stored.deleted) ? stored.deleted.filter(isBusinessKey) : [])
        };
    } catch (error) {
        console.error("Could not read pending cloud changes.", error);
        return { keys: new Set(), deleted: new Set() };
    }
}

function savePendingState(uid, state) {
    const storageKey = `easyReceiptPending:${uid}`;
    try {
        if (!state.keys.size) {
            localStorage.removeItem(storageKey);
            return;
        }
        localStorage.setItem(storageKey, JSON.stringify({
            keys: [...state.keys],
            deleted: [...state.deleted]
        }));
    } catch (error) {
        console.error("Could not preserve the cloud sync retry marker.", error);
        showSyncNotice("Could not save the sync retry marker on this device. Keep this page open until the connection is restored.", true);
    }
}

function markPending(uid, key, deleted) {
    const state = readPendingState(uid);
    state.keys.add(key);
    if (deleted) state.deleted.add(key);
    else state.deleted.delete(key);
    savePendingState(uid, state);
}

function clearSyncedPending(uid, batch) {
    const state = readPendingState(uid);
    for (const key of batch.keys()) {
        if (pendingWrites.has(key)) continue;
        state.keys.delete(key);
        state.deleted.delete(key);
    }
    savePendingState(uid, state);
}

function queueWrite(key, value) {
    if (!activeUid || !isBusinessKey(key)) return;
    pendingWrites.set(key, value);
    markPending(activeUid, key, value === null);
    if (!syncReady) return;
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => void flushWrites(), 250);
}

async function flushWrites() {
    if (!syncReady || !activeUid || pendingWrites.size === 0) return;
    const uid = activeUid;
    const batch = pendingWrites;
    pendingWrites = new Map();
    const writes = [];

    for (const [key, value] of batch) {
        writes.push(writeCloudValue(uid, key, value));
    }

    try {
        await Promise.all(writes);
        clearSyncedPending(uid, batch);
        if (pendingWrites.size) {
            window.clearTimeout(flushTimer);
            flushTimer = window.setTimeout(() => void flushWrites(), 250);
        }
    } catch (error) {
        console.error("Could not sync Easy Receipt business data.", error);
        for (const [key, value] of batch) {
            if (!pendingWrites.has(key)) pendingWrites.set(key, value);
        }
        showSyncNotice(`Cloud sync failed: ${error.message} Your local changes are saved on this device and will retry.`, true);
        window.clearTimeout(flushTimer);
        flushTimer = window.setTimeout(() => void flushWrites(), 10000);
    }
}

function installStorageSync() {
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.setItem = function (key, value) {
        originalSetItem.call(this, key, value);
        if (this === window.localStorage && !applyingRemoteChanges) queueWrite(String(key), String(value));
    };
    Storage.prototype.removeItem = function (key) {
        originalRemoveItem.call(this, key);
        if (this === window.localStorage && !applyingRemoteChanges) queueWrite(String(key), null);
    };

    window.addEventListener("storage", event => {
        if (event.storageArea === window.localStorage && event.key && isBusinessKey(event.key)) {
            queueWrite(event.key, event.newValue);
        }
    });
}

async function claimInitialSync(uid) {
    const entries = readLocalBusinessData();
    const stateReference = doc(db, "users", uid, "syncMeta", "state");
    const existingState = await getDoc(stateReference);
    if (!existingState.exists()) {
        if (entries.length > 0 && !window.confirm(
            "This account has no cloud data yet. Upload this device's existing Easy Receipt business data to the account so it can be used on your other devices?"
        )) {
            return null;
        }
    }
    const encodedEntries = existingState.exists()
        ? []
        : entries.flatMap(([key, value]) => encodeCloudEntry(key, value));
    if (encodedEntries.length + 1 > MAX_INITIAL_DOCUMENTS) {
        throw new Error("This device has too much local business data to initialize safely in a single sync.");
    }

    const alreadyInitialized = await runTransaction(db, async transaction => {
        const state = await transaction.get(stateReference);
        if (state.exists()) return true;

        for (const [key, value] of encodedEntries) {
            transaction.set(doc(db, "users", uid, "appData", key), { value });
        }
        transaction.set(stateReference, { initialized: true });
        return false;
    });
    return alreadyInitialized;
}

function applySnapshot(snapshot, firstSnapshot) {
    const remoteKeys = new Set();
    const chunkGroups = new Map();
    const documents = [];
    const pendingState = readPendingState(activeUid);
    let changedCount = 0;
    applyingRemoteChanges = true;
    try {
        snapshot.forEach(item => {
            documents.push([item.id, item.data().value]);
        });
        documents.forEach(([key, value]) => {
            const chunkMatch = key.match(/^(p3_[A-Za-z0-9_]+)__chunk_(\d+)$/);
            if (chunkMatch && BUSINESS_KEYS.has(chunkMatch[1])) {
                const group = chunkGroups.get(chunkMatch[1]) || new Map();
                group.set(Number(chunkMatch[2]), value);
                chunkGroups.set(chunkMatch[1], group);
            }
        });
        documents.forEach(([key, storedValue]) => {
            if (/^(p3_[A-Za-z0-9_]+)__chunk_\d+$/.test(key)
                && BUSINESS_KEYS.has(key.match(/^(p3_[A-Za-z0-9_]+)__chunk_\d+$/)[1])) return;
            if (!isBusinessKey(key) || typeof storedValue !== "string") return;
            remoteKeys.add(key);
            let value = storedValue;
            const count = getChunkCount(storedValue);
            if (count) {
                const chunks = chunkGroups.get(key);
                if (!chunks || chunks.size < count) return;
                value = Array.from({ length: count }, (_, index) => chunks.get(index) || "").join("");
            }
            if (pendingState.keys.has(key)) {
                if (pendingState.deleted.has(key)) {
                    if (localStorage.getItem(key) !== null) {
                        localStorage.removeItem(key);
                        changedCount += 1;
                    }
                    queueWrite(key, null);
                    return;
                }
                const localValue = localStorage.getItem(key);
                if (localValue !== null) {
                    value = localValue;
                    queueWrite(key, localValue);
                }
            }
            if (localStorage.getItem(key) !== value) {
                localStorage.setItem(key, value);
                changedCount += 1;
            }
        });
        if (firstSnapshot) {
            for (const [key] of readLocalBusinessData()) {
                if (pendingState.keys.has(key)) {
                    queueWrite(key, localStorage.getItem(key));
                } else if (!remoteKeys.has(key)) {
                    localStorage.removeItem(key);
                }
            }
            for (const key of pendingState.keys) {
                if (remoteKeys.has(key)) continue;
                queueWrite(key, pendingState.deleted.has(key) ? null : localStorage.getItem(key));
            }
        } else {
            snapshot.docChanges().forEach(change => {
                if (change.type === "removed"
                    && isBusinessKey(change.doc.id)
                    && localStorage.getItem(change.doc.id) !== null) {
                    if (pendingState.keys.has(change.doc.id)) {
                        queueWrite(change.doc.id, localStorage.getItem(change.doc.id));
                    } else {
                        localStorage.removeItem(change.doc.id);
                        changedCount += 1;
                    }
                }
            });
        }
    } finally {
        applyingRemoteChanges = false;
    }
    return changedCount;
}

async function startSync(user) {
    activeUid = user.uid;
    syncReady = false;
    pendingWrites.clear();
    showSyncNotice("Connecting this account's business data...");

    const alreadyInitialized = await claimInitialSync(user.uid);
    if (alreadyInitialized === null) {
        activeUid = "";
        showSyncNotice("Cloud sync was not started. Your data remains on this device.");
        return;
    }

    const dataReference = collection(db, "users", user.uid, "appData");
    await new Promise((resolve, reject) => {
        let firstSnapshot = true;
        const timeout = window.setTimeout(() => reject(new Error("Cloud sync did not respond in time.")), 20000);
        unsubscribeData = onSnapshot(dataReference, snapshot => {
            if (firstSnapshot && snapshot.metadata.fromCache) return;
            const wasFirstSnapshot = firstSnapshot;
            firstSnapshot = false;
            const changedCount = applySnapshot(snapshot, wasFirstSnapshot);
            if (wasFirstSnapshot) {
                window.clearTimeout(timeout);
                syncReady = true;
                void flushWrites();
                showSyncNotice("Business data is syncing across devices.");
                resolve();
            } else if (changedCount) {
                const now = Date.now();
                if (now - latestRemoteChangeAt > 1500) {
                    latestRemoteChangeAt = now;
                    showSyncNotice("Business data changed on another device. Reload to refresh this page.", false, true);
                }
            }
        }, error => {
            window.clearTimeout(timeout);
            reject(error);
        });
    });
}

function stopSync() {
    syncReady = false;
    activeUid = "";
    pendingWrites.clear();
    window.clearTimeout(flushTimer);
    if (unsubscribeData) unsubscribeData();
    unsubscribeData = null;
}

installStorageSync();
window.easyReceiptSignOut = async () => {
    window.clearTimeout(flushTimer);
    await flushWrites();
    if (pendingWrites.size) throw new Error("Pending business data could not be synced.");
    await signOut(auth);
};
window.easyReceiptSignInWithGoogle = idToken =>
    signInWithCredential(auth, GoogleAuthProvider.credential(idToken));

onAuthStateChanged(auth, user => {
    stopSync();
    if (!user) {
        showSignInPrompt("Sign in with your Easy Receipt account to sync business data across devices.");
        return;
    }
    hideSyncNotice();
    localStorage.setItem("p3_user_profile", JSON.stringify({
        name: user.displayName || user.email || "Cashier",
        email: user.email || "",
        provider: user.providerData[0]?.providerId || "firebase"
    }));
    const displayName = document.getElementById("user-display-name");
    if (displayName) displayName.textContent = user.displayName || user.email || "Cashier";
    void startSync(user).catch(error => {
        console.error("Easy Receipt cloud sync could not start.", error);
        stopSync();
        showSyncNotice(`Cloud sync could not start: ${error.message} Your local data remains on this device.`, true);
    });
});

import { deleteApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
    createUserWithEmailAndPassword,
    deleteUser,
    getAuth,
    onAuthStateChanged,
    sendPasswordResetEmail,
    signOut,
    updateProfile
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    updateDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const CHUNK_MARKER = /^__EASY_RECEIPT_CHUNKS_V1__:(\d+)$/;
const SETUP_APP_NAME = "cashier-setup";
let staff = [];
let signedInOwner = null;

const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]
));

function setStatus(message, isError = false) {
    const status = byId("teamStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("account-status-error", isError);
}

function businessName() {
    try {
        return JSON.parse(localStorage.getItem("p3_user_profile") || "{}").businessName || "";
    } catch (error) {
        return "";
    }
}

function buildShareLink(member) {
    const url = new URL("login.html", import.meta.url);
    url.searchParams.set("cashier", member.email);
    const business = businessName();
    if (business) url.searchParams.set("business", business);
    return url.href;
}

async function shareLink(member) {
    const link = buildShareLink(member);
    const business = businessName() || "the business";
    const text = `Hi ${member.name}, sign in as a cashier for ${business}. Your owner will give you your password separately.`;
    if (navigator.share) {
        try {
            await navigator.share({ title: "Easy Receipt cashier sign-in", text, url: link });
            setStatus(`Share sheet opened for ${member.name}.`);
            return;
        } catch (error) {
            if (error.name === "AbortError") return;
        }
    }
    try {
        await navigator.clipboard.writeText(`${text}\n${link}`);
        setStatus(`Sign-in link for ${member.name} copied. Paste it into a message to share.`);
    } catch (error) {
        window.prompt("Copy this cashier sign-in link:", link);
    }
}

async function loadCashierSales(member) {
    const base = doc(db, "users", member.id, "appData", "p3_pos_snapshots");
    const snapshot = await getDoc(base);
    if (!snapshot.exists()) return [];
    let value = snapshot.data().value;
    const marker = typeof value === "string" && value.match(CHUNK_MARKER);
    if (marker) {
        const parts = await Promise.all(Array.from({ length: Number(marker[1]) }, (_, index) =>
            getDoc(doc(db, "users", member.id, "appData", `p3_pos_snapshots__chunk_${index}`))));
        value = parts.map(part => (part.exists() ? part.data().value : "")).join("");
    }
    try {
        const sales = JSON.parse(value);
        return Array.isArray(sales) ? sales : [];
    } catch (error) {
        return [];
    }
}

function money(value) {
    return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function showSales(member, container) {
    container.textContent = "Loading sales...";
    try {
        const sales = await loadCashierSales(member);
        const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
        const recent = sales.slice(-5).reverse().map(sale =>
            `<li>${escapeHtml(sale.timestamp || "")} - ${escapeHtml(sale.client || "Customer")} - <strong>${money(sale.total)}</strong></li>`
        ).join("");
        container.innerHTML = `<strong>${sales.length}</strong> sale${sales.length === 1 ? "" : "s"}, total <strong>${money(total)}</strong>`
            + (recent ? `<ul class="team-sales-list">${recent}</ul>` : "");
    } catch (error) {
        container.textContent = `Could not load sales: ${error.message}`;
    }
}

function renderList() {
    const list = byId("teamList");
    if (!list) return;
    if (!signedInOwner) {
        list.innerHTML = '<p class="team-empty">Sign in with your business account to manage cashiers.</p>';
        return;
    }
    if (!staff.length) {
        list.innerHTML = '<p class="team-empty">No cashiers yet. Add the first one above.</p>';
        return;
    }
    list.innerHTML = staff.map(member => `
        <article class="team-member${member.active ? "" : " team-member-off"}" data-uid="${escapeHtml(member.id)}">
            <div class="team-member-head">
                <span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.email)}</small></span>
                <span class="team-badge ${member.active ? "team-badge-on" : ""}">${member.active ? "Active" : "Deactivated"}</span>
            </div>
            <div class="team-actions">
                <button type="button" class="btn-secondary" data-action="share"><i class="fas fa-share-alt"></i> Share link</button>
                <button type="button" class="btn-secondary" data-action="sales"><i class="fas fa-chart-line"></i> Sales</button>
                <button type="button" class="btn-secondary" data-action="reset"><i class="fas fa-key"></i> Reset password</button>
                <button type="button" class="btn-secondary" data-action="toggle">${member.active ? "Deactivate" : "Activate"}</button>
                <button type="button" class="btn-danger" data-action="remove"><i class="fas fa-trash"></i> Remove</button>
            </div>
            <div class="team-sales" data-sales hidden></div>
        </article>`).join("");
}

async function refresh() {
    if (!signedInOwner) {
        renderList();
        return;
    }
    try {
        const snapshot = await getDocs(query(collection(db, "staff"), where("ownerUid", "==", signedInOwner.uid)));
        staff = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
            .sort((left, right) => String(left.name).localeCompare(String(right.name)));
        renderList();
    } catch (error) {
        setStatus(`Could not load cashiers: ${error.message}`, true);
    }
}

async function createCashierAuth(email, password, name) {
    const existing = getApps().find(app => app.name === SETUP_APP_NAME);
    if (existing) await deleteApp(existing);
    const setupApp = initializeApp(auth.app.options, SETUP_APP_NAME);
    const setupAuth = getAuth(setupApp);
    try {
        const credential = await createUserWithEmailAndPassword(setupAuth, email, password);
        await updateProfile(credential.user, { displayName: name });
        return {
            uid: credential.user.uid,
            rollback: () => deleteUser(credential.user).catch(() => {}),
            finish: async () => {
                await signOut(setupAuth).catch(() => {});
                await deleteApp(setupApp).catch(() => {});
            }
        };
    } catch (error) {
        await deleteApp(setupApp).catch(() => {});
        throw error;
    }
}

async function addCashier(event) {
    event.preventDefault();
    if (!signedInOwner) return setStatus("Sign in with your business account first.", true);
    if (window.easyReceiptStaff) return setStatus("Cashier accounts cannot create other cashiers.", true);
    const name = byId("teamName").value.trim();
    const email = byId("teamEmail").value.trim().toLowerCase();
    const password = byId("teamPassword").value;
    const shareAfter = byId("teamShareAfter").checked;
    if (!name || !email) return setStatus("Enter the cashier's name and email.", true);
    if (password.length < 8) return setStatus("Use a password of at least 8 characters.", true);
    if (password !== byId("teamPasswordConfirm").value) return setStatus("The passwords do not match.", true);

    const submit = byId("teamSubmit");
    submit.disabled = true;
    setStatus("Creating cashier account...");
    let created = null;
    try {
        created = await createCashierAuth(email, password, name);
        const record = { ownerUid: signedInOwner.uid, name, email, active: true, createdAt: new Date().toISOString() };
        try {
            await setDoc(doc(db, "staff", created.uid), record);
        } catch (error) {
            await created.rollback();
            throw error;
        }
        await created.finish();
        byId("teamForm").reset();
        setStatus(`Cashier ${name} created. Give them the password you set.`);
        await refresh();
        if (shareAfter) await shareLink({ id: created.uid, ...record });
    } catch (error) {
        const messages = {
            "auth/email-already-in-use": "That email already has an account. Use a different email for the cashier.",
            "auth/invalid-email": "That email address is not valid.",
            "auth/weak-password": "Choose a stronger password."
        };
        setStatus(messages[error.code] || `Could not create the cashier: ${error.message}`, true);
    } finally {
        submit.disabled = false;
    }
}

async function handleAction(event) {
    const button = event.target.closest("[data-action]");
    const card = event.target.closest(".team-member");
    if (!button || !card) return;
    const member = staff.find(item => item.id === card.dataset.uid);
    if (!member) return;
    const action = button.dataset.action;
    try {
        if (action === "share") return await shareLink(member);
        if (action === "sales") {
            const container = card.querySelector("[data-sales]");
            container.hidden = !container.hidden;
            if (!container.hidden) await showSales(member, container);
            return;
        }
        if (action === "reset") {
            await sendPasswordResetEmail(auth, member.email);
            return setStatus(`Password reset email sent to ${member.email}.`);
        }
        if (action === "toggle") {
            const next = !member.active;
            if (!next && !window.confirm(`Deactivate ${member.name}? They will be signed out and blocked from the register.`)) return;
            await updateDoc(doc(db, "staff", member.id), {
                ownerUid: member.ownerUid, name: member.name, email: member.email, active: next
            });
            setStatus(`${member.name} ${next ? "activated" : "deactivated"}.`);
        }
        if (action === "remove") {
            if (!window.confirm(`Remove ${member.name}? Their access ends immediately.`)) return;
            await deleteDoc(doc(db, "staff", member.id));
            setStatus(`${member.name} removed.`);
        }
        await refresh();
    } catch (error) {
        setStatus(`Action failed: ${error.message}`, true);
    }
}

function init() {
    byId("teamForm")?.addEventListener("submit", addCashier);
    byId("teamList")?.addEventListener("click", handleAction);
    onAuthStateChanged(auth, user => {
        signedInOwner = user && !window.easyReceiptStaff ? user : null;
        void refresh();
    });
}

window.teamManager = { refresh };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

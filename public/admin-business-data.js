import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-functions.js";
import { auth } from "./firebase-config.js";

const PAGE_SIZE = 50;
const functions = getFunctions(auth.app, "africa-south1");
const listAccounts = httpsCallable(functions, "listBusinessAccounts");
const getBusinessData = httpsCallable(functions, "getAccountBusinessData");
const pageTokens = [null];
let pageIndex = 0;
let accounts = [];
let loading = false;
let accountsLoaded = false;
let authGeneration = 0;
let detailRequest = 0;

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const money = value => `R ${Number(value || 0).toFixed(2)}`;

function setStatus(message) {
    $("businessAccountsStatus").textContent = message;
}

function setLoading(value) {
    loading = value;
    $("loadBusinessAccounts").disabled = value || !auth.currentUser;
    $("previousBusinessPage").disabled = value || pageIndex === 0;
    $("nextBusinessPage").disabled = value || !pageTokens[pageIndex + 1];
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function renderAccounts() {
    $("businessAccountsBody").innerHTML = accounts.map((account, index) => `
        <tr>
            <td data-label="Account">${escapeHtml(account.displayName || "No display name")}</td>
            <td data-label="Email">${escapeHtml(account.email || "—")}</td>
            <td data-label="Created">${escapeHtml(formatDate(account.createdAt))}</td>
            <td data-label="Last sign-in">${escapeHtml(formatDate(account.lastSignInAt))}</td>
            <td data-label="Status">${account.disabled ? "Disabled" : "Active"}</td>
            <td><button type="button" class="btn btn-muted" data-account-index="${index}">Customers &amp; receipts</button></td>
        </tr>`).join("");
    $("businessAccountsEmpty").style.display = accountsLoaded && !accounts.length ? "block" : "none";
    $("businessAccountsEmpty").textContent = accountsLoaded ? "No Firebase accounts on this page." : "Load accounts to view the Firebase user list.";
}

function showError(error, context) {
    console.error(context, error);
    if (error.code === "functions/permission-denied") {
        return "Access denied. This Firebase account needs the admin claim.";
    }
    if (error.code === "functions/unauthenticated") {
        return "Sign in to the app with an authorized administrator account.";
    }
    return error.message || "The request failed. Please try again.";
}

async function loadPage(index) {
    if (loading || !auth.currentUser) return;
    if (index < 0 || index >= pageTokens.length) return;
    const requestGeneration = authGeneration;
    detailRequest += 1;
    pageIndex = index;
    setLoading(true);
    setStatus("Loading Firebase accounts…");
    try {
        const result = await listAccounts({ pageSize: PAGE_SIZE, pageToken: pageTokens[pageIndex] });
        if (requestGeneration !== authGeneration || !auth.currentUser) return;
        accounts = result.data.accounts;
        accountsLoaded = true;
        if (result.data.nextPageToken) pageTokens[pageIndex + 1] = result.data.nextPageToken;
        else pageTokens.length = pageIndex + 1;
        renderAccounts();
        $("businessAccountDetails").hidden = true;
        clearBusinessDetails();
        setStatus(`Page ${pageIndex + 1} · ${accounts.length} accounts loaded`);
    } catch (error) {
        if (requestGeneration !== authGeneration) return;
        setStatus(showError(error, "Could not load Firebase accounts."));
    } finally {
        if (requestGeneration === authGeneration) setLoading(false);
    }
}

function renderCustomers(customers) {
    $("businessCustomerCount").textContent = `(${customers.length})`;
    $("businessCustomersBody").innerHTML = customers.map(customer => `
        <tr>
            <td data-label="Name">${escapeHtml(customer.name || "—")}</td>
            <td data-label="Phone">${escapeHtml(customer.phone || "—")}</td>
            <td data-label="Email">${escapeHtml(customer.email || "—")}</td>
            <td data-label="Balance due">${escapeHtml(money(customer.due))}</td>
            <td data-label="Deposit">${escapeHtml(money(customer.deposit))}</td>
        </tr>`).join("");
    $("businessCustomersEmpty").style.display = customers.length ? "none" : "block";
}

function renderReceipts(receipts) {
    $("businessReceiptCount").textContent = `(${receipts.length})`;
    $("businessReceiptsBody").innerHTML = receipts.map(receipt => {
        const items = receipt.items.map(item =>
            `${escapeHtml(item.name)} × ${escapeHtml(item.qty)} @ ${escapeHtml(money(item.price))}`).join("<br>");
        return `<tr>
            <td data-label="Receipt">${escapeHtml(receipt.receiptRef || receipt.id || "—")}</td>
            <td data-label="Date">${escapeHtml(formatDate(receipt.createdAt || receipt.timestamp))}</td>
            <td data-label="Customer">${escapeHtml(receipt.customer || "—")}</td>
            <td data-label="Store">${escapeHtml(receipt.store || "—")}</td>
            <td data-label="Total">${escapeHtml(money(receipt.total))}</td>
            <td data-label="Paid">${escapeHtml(money(receipt.paid))}</td>
            <td data-label="Items">${items || "Item details unavailable"}</td>
        </tr>`;
    }).join("");
    $("businessReceiptsEmpty").style.display = receipts.length ? "none" : "block";
}

function clearBusinessDetails() {
    $("businessAccountTitle").textContent = "";
    $("businessAccountDetailStatus").textContent = "";
    $("businessCustomerCount").textContent = "";
    $("businessReceiptCount").textContent = "";
    $("businessCustomersBody").innerHTML = "";
    $("businessReceiptsBody").innerHTML = "";
    $("businessCustomersEmpty").style.display = "none";
    $("businessReceiptsEmpty").style.display = "none";
}

async function openAccount(index) {
    const account = accounts[index];
    if (!account || loading) return;
    const requestId = ++detailRequest;
    const requestGeneration = authGeneration;
    const details = $("businessAccountDetails");
    clearBusinessDetails();
    details.hidden = false;
    $("businessAccountTitle").textContent = account.displayName || account.email || account.uid;
    $("businessAccountDetailStatus").textContent = "Loading saved customers and receipts…";
    details.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
        const result = await getBusinessData({ uid: account.uid });
        if (requestId !== detailRequest || requestGeneration !== authGeneration) return;
        renderCustomers(result.data.customers);
        renderReceipts(result.data.receipts);
        $("businessAccountDetailStatus").textContent = `${result.data.account.email || result.data.account.uid} · ${result.data.receipts.length} receipt transactions`;
    } catch (error) {
        if (requestId !== detailRequest || requestGeneration !== authGeneration) return;
        $("businessAccountDetailStatus").textContent = showError(error, "Could not load account business data.");
    }
}

$("loadBusinessAccounts").addEventListener("click", () => loadPage(0));
$("previousBusinessPage").addEventListener("click", () => loadPage(pageIndex - 1));
$("nextBusinessPage").addEventListener("click", () => loadPage(pageIndex + 1));
$("businessAccountsBody").addEventListener("click", event => {
    const button = event.target.closest("[data-account-index]");
    if (button) openAccount(Number(button.getAttribute("data-account-index")));
});

onAuthStateChanged(auth, user => {
    authGeneration += 1;
    detailRequest += 1;
    loading = false;
    accounts = [];
    accountsLoaded = false;
    pageTokens.length = 1;
    pageTokens[0] = null;
    pageIndex = 0;
    renderAccounts();
    $("businessAccountDetails").hidden = true;
    clearBusinessDetails();
    $("loadBusinessAccounts").disabled = !user;
    $("previousBusinessPage").disabled = true;
    $("nextBusinessPage").disabled = true;
    setStatus(user
        ? "Signed in. Load accounts to verify administrator access."
        : "Sign in to the app with an administrator account to load Firebase accounts.");
});

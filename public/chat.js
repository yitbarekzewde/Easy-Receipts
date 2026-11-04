import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    setDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const GROUP = "group";
const MAX_TEXT = 2000;
const state = {
    me: null,
    ownerUid: "",
    members: new Map(),
    staffRoster: new Map(),
    groupMessages: [],
    directMessages: [],
    reads: {},
    active: GROUP,
    open: false,
    unsubs: []
};
let ui = null;
let readWriteTimer = 0;

const link = document.createElement("link");
link.rel = "stylesheet";
link.href = new URL("chat.css", import.meta.url).href;
document.head.appendChild(link);

function directChannel(peerUid) {
    return [state.me.uid, peerUid].sort().join("_");
}

function channelMessages(channel) {
    const list = channel === GROUP
        ? state.groupMessages
        : state.directMessages.filter(message => message.channel === channel);
    return list.slice().sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id)));
}

function channelFor(key) {
    return key === GROUP ? GROUP : directChannel(key);
}

function unreadFor(key) {
    if (!state.me) return 0;
    const channel = channelFor(key);
    const seen = Number(state.reads[channel] || 0);
    return channelMessages(channel).filter(message => message.senderUid !== state.me.uid && message.at > seen).length;
}

function totalUnread() {
    if (!state.me) return 0;
    let total = unreadFor(GROUP);
    state.roster().forEach(member => { total += unreadFor(member.uid); });
    return total;
}

state.roster = function roster() {
    const merged = new Map();
    state.staffRoster.forEach((value, uid) => merged.set(uid, value));
    state.members.forEach((value, uid) => merged.set(uid, { ...(merged.get(uid) || {}), ...value }));
    merged.delete(state.me?.uid);
    return [...merged.entries()]
        .map(([uid, value]) => ({ uid, name: value.name || "Team member", role: value.role || "Cashier" }))
        .sort((a, b) => {
            const rank = { Owner: 0, Manager: 1, Cashier: 2 };
            return (rank[a.role] ?? 3) - (rank[b.role] ?? 3) || a.name.localeCompare(b.name);
        });
};

function updateBadges() {
    const count = totalUnread();
    document.querySelectorAll("[data-chat-badge]").forEach(badge => {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = count === 0;
    });
}

function buildUi() {
    if (ui) return ui;
    const root = document.createElement("div");
    root.id = "erChat";
    root.className = "er-chat";
    root.hidden = true;
    root.innerHTML = `
        <div class="er-chat-panel" role="dialog" aria-label="Messages">
            <aside class="er-chat-side">
                <div class="er-chat-side-head"><strong><i class="fas fa-comments"></i> Messages</strong></div>
                <div class="er-chat-list" data-list></div>
            </aside>
            <section class="er-chat-main">
                <header class="er-chat-head">
                    <button type="button" class="er-chat-back" data-back aria-label="Back to chats"><i class="fas fa-arrow-left"></i></button>
                    <span class="er-chat-title" data-title></span>
                    <button type="button" class="er-chat-close" data-close aria-label="Close messages"><i class="fas fa-times"></i></button>
                </header>
                <div class="er-chat-status" data-status hidden></div>
                <div class="er-chat-thread" data-thread></div>
                <form class="er-chat-form" data-form autocomplete="off">
                    <input type="text" data-input maxlength="${MAX_TEXT}" placeholder="Type a message" aria-label="Message">
                    <button type="submit" aria-label="Send message"><i class="fas fa-paper-plane"></i></button>
                </form>
            </section>
        </div>`;
    document.body.appendChild(root);
    ui = {
        root,
        list: root.querySelector("[data-list]"),
        title: root.querySelector("[data-title]"),
        thread: root.querySelector("[data-thread]"),
        form: root.querySelector("[data-form]"),
        input: root.querySelector("[data-input]"),
        status: root.querySelector("[data-status]")
    };
    root.querySelector("[data-close]").addEventListener("click", closeChat);
    root.addEventListener("click", event => { if (event.target === root) closeChat(); });
    root.querySelector("[data-back]").addEventListener("click", () => root.classList.remove("er-chat-thread-open"));
    ui.form.addEventListener("submit", event => {
        event.preventDefault();
        void sendMessage();
    });
    ui.list.addEventListener("click", event => {
        const item = event.target.closest("[data-key]");
        if (!item) return;
        state.active = item.dataset.key;
        root.classList.add("er-chat-thread-open");
        render();
        ui.input.focus();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && state.open) closeChat();
    });
    return ui;
}

function setStatus(text) {
    if (!ui) return;
    ui.status.textContent = text || "";
    ui.status.hidden = !text;
}

function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "?";
}

function renderList() {
    const rows = [{ key: GROUP, name: "Shop group", role: "Everyone in the shop", group: true }]
        .concat(state.roster().map(member => ({ key: member.uid, name: member.name, role: member.role })));
    ui.list.textContent = "";
    rows.forEach(row => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "er-chat-item" + (row.key === state.active ? " active" : "");
        button.dataset.key = row.key;
        const avatar = document.createElement("span");
        avatar.className = "er-chat-avatar";
        if (row.group) avatar.innerHTML = '<i class="fas fa-users"></i>';
        else avatar.textContent = initials(row.name);
        const text = document.createElement("span");
        text.className = "er-chat-item-text";
        const name = document.createElement("strong");
        name.textContent = row.name;
        const role = document.createElement("small");
        role.textContent = row.role;
        text.append(name, role);
        button.append(avatar, text);
        const unread = unreadFor(row.key);
        if (unread) {
            const badge = document.createElement("span");
            badge.className = "er-chat-unread";
            badge.textContent = unread > 99 ? "99+" : String(unread);
            button.appendChild(badge);
        }
        ui.list.appendChild(button);
    });
}

function renderThread() {
    const peer = state.active === GROUP ? null : state.roster().find(member => member.uid === state.active);
    if (state.active !== GROUP && !peer) state.active = GROUP;
    ui.title.textContent = state.active === GROUP ? "Shop group" : `${peer.name} (${peer.role})`;
    const messages = channelMessages(channelFor(state.active)).slice(-300);
    const nearBottom = ui.thread.scrollHeight - ui.thread.scrollTop - ui.thread.clientHeight < 80;
    ui.thread.textContent = "";
    if (!messages.length) {
        const empty = document.createElement("p");
        empty.className = "er-chat-empty";
        empty.textContent = state.active === GROUP ? "No messages yet. Say hello to the team." : "No messages yet. Start the conversation.";
        ui.thread.appendChild(empty);
    }
    let lastDay = "";
    messages.forEach(message => {
        const date = new Date(message.at);
        const day = date.toLocaleDateString();
        if (day !== lastDay) {
            lastDay = day;
            const divider = document.createElement("div");
            divider.className = "er-chat-day";
            divider.textContent = day;
            ui.thread.appendChild(divider);
        }
        const mine = message.senderUid === state.me.uid;
        const bubble = document.createElement("div");
        bubble.className = "er-chat-msg" + (mine ? " mine" : "");
        if (!mine && state.active === GROUP) {
            const sender = document.createElement("span");
            sender.className = "er-chat-sender";
            sender.textContent = message.senderName || "Team member";
            bubble.appendChild(sender);
        }
        const body = document.createElement("span");
        body.className = "er-chat-body";
        body.textContent = message.text;
        const time = document.createElement("small");
        time.textContent = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + (message.pending ? " · sending" : "");
        bubble.append(body, time);
        ui.thread.appendChild(bubble);
    });
    if (nearBottom || ui.thread.dataset.fresh !== state.active) {
        ui.thread.scrollTop = ui.thread.scrollHeight;
        ui.thread.dataset.fresh = state.active;
    }
}

function render() {
    if (!ui) return;
    renderList();
    renderThread();
    markRead();
}

function markRead() {
    if (!state.open || !state.me) return;
    const channel = channelFor(state.active);
    const incoming = channelMessages(channel).filter(message => message.senderUid !== state.me.uid && !message.pending);
    if (!incoming.length) return;
    const latest = incoming[incoming.length - 1].at;
    if (latest <= Number(state.reads[channel] || 0)) return;
    state.reads[channel] = latest;
    if (state.local) {
        const reads = readLocal(LOCAL_READS, {});
        reads[state.me.uid] = { ...state.reads };
        localStorage.setItem(LOCAL_READS, JSON.stringify(reads));
        updateBadges();
        renderList();
        return;
    }
    window.clearTimeout(readWriteTimer);
    readWriteTimer = window.setTimeout(() => {
        void setDoc(memberRef(), { ...memberFields(), reads: { [channel]: latest } }, { merge: true }).catch(() => {});
    }, 400);
    updateBadges();
    renderList();
}

const LOCAL_MESSAGES = "er_chat_local_messages";
const LOCAL_READS = "er_chat_local_reads";
const LOCAL_PEOPLE = "er_chat_local_people";

function readLocal(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

function localId(value) {
    return "local:" + String(value || "guest").trim().toLowerCase();
}

function loadLocalMessages() {
    const all = readLocal(LOCAL_MESSAGES, []);
    state.groupMessages = all.filter(message => message.kind === "group");
    state.directMessages = all.filter(message => message.kind === "direct" && message.members.includes(state.me.uid));
    state.reads = readLocal(LOCAL_READS, {})[state.me.uid] || {};
}

function startLocal() {
    const profile = readLocal("p3_user_profile", null) || {};
    const name = profile.name || profile.username || "Guest";
    state.local = true;
    state.ownerUid = "local";
    state.me = { uid: localId(profile.email || name), name, role: "Member" };
    const people = readLocal(LOCAL_PEOPLE, {});
    people[state.me.uid] = { name, role: "Member" };
    localStorage.setItem(LOCAL_PEOPLE, JSON.stringify(people));
    const registered = readLocal("registeredUsers", []);
    (Array.isArray(registered) ? registered : []).forEach(record => {
        const label = record.name || record.username || record.email;
        if (label) people[localId(record.email || label)] = { name: label, role: "Member" };
    });
    state.staffRoster = new Map(Object.entries(people));
    loadLocalMessages();
    const onStorage = event => {
        if (event.key && ![LOCAL_MESSAGES, LOCAL_READS, LOCAL_PEOPLE].includes(event.key)) return;
        if (event.key === LOCAL_PEOPLE) state.staffRoster = new Map(Object.entries(readLocal(LOCAL_PEOPLE, {})));
        loadLocalMessages();
        updateBadges();
        render();
    };
    window.addEventListener("storage", onStorage);
    state.unsubs.push(() => window.removeEventListener("storage", onStorage));
    updateBadges();
    if (state.open) openChat();
}

function memberRef() {
    return doc(db, "shops", state.ownerUid, "members", state.me.uid);
}

function memberFields() {
    return { name: state.me.name, role: state.me.role, updatedAt: Date.now() };
}

async function sendMessage() {
    const text = ui.input.value.trim();
    if (!text || !state.me) return;
    if (text.length > MAX_TEXT) return setStatus(`Messages can be up to ${MAX_TEXT} characters.`);
    const group = state.active === GROUP;
    const message = {
        kind: group ? "group" : "direct",
        channel: channelFor(state.active),
        members: group ? [] : [state.me.uid, state.active],
        senderUid: state.me.uid,
        senderName: state.me.name,
        text,
        at: Date.now()
    };
    ui.input.value = "";
    setStatus("");
    if (state.local) {
        const all = readLocal(LOCAL_MESSAGES, []);
        all.push({ id: `${message.at}-${Math.random().toString(36).slice(2, 8)}`, ...message });
        localStorage.setItem(LOCAL_MESSAGES, JSON.stringify(all.slice(-2000)));
        loadLocalMessages();
        render();
        return;
    }
    try {
        await addDoc(collection(db, "shops", state.ownerUid, "messages"), message);
    } catch (error) {
        ui.input.value = text;
        setStatus(`Could not send: ${error.code === "permission-denied" ? "you do not have access to this chat." : error.message}`);
    }
}

function openChat() {
    buildUi();
    state.open = true;
    ui.root.hidden = false;
    document.body.classList.add("er-chat-lock");
    if (!state.me) {
        ui.list.textContent = "";
        ui.thread.textContent = "";
        ui.title.textContent = "Messages";
        ui.form.hidden = true;
        setStatus("Sign in with your Easy Receipt account to use Messages.");
        ui.root.classList.add("er-chat-thread-open");
        return;
    }
    ui.root.classList.remove("er-chat-thread-open");
    ui.form.hidden = false;
    setStatus(state.local ? "Local chat: messages are shared only between accounts on this device. Sign in to message your team online." : "");
    render();
}

function closeChat() {
    state.open = false;
    if (ui) {
        ui.root.hidden = true;
        ui.root.classList.remove("er-chat-thread-open");
    }
    document.body.classList.remove("er-chat-lock");
}

function stopListening() {
    state.unsubs.forEach(stop => stop());
    state.unsubs = [];
    state.me = null;
    state.ownerUid = "";
    state.local = false;
    state.members = new Map();
    state.staffRoster = new Map();
    state.groupMessages = [];
    state.directMessages = [];
    state.reads = {};
    state.active = GROUP;
    updateBadges();
}

function messageList(snapshot) {
    return snapshot.docs.map(item => ({ id: item.id, ...item.data(), pending: item.metadata.hasPendingWrites }));
}

async function resolveContext(user) {
    const staffSnap = await getDoc(doc(db, "staff", user.uid));
    if (staffSnap.exists()) {
        const staff = staffSnap.data();
        if (staff.active !== true) return null;
        return { ownerUid: staff.ownerUid, role: staff.role === "Manager" ? "Manager" : "Cashier", name: staff.name || user.displayName || user.email || "Staff" };
    }
    return { ownerUid: user.uid, role: "Owner", name: user.displayName || user.email || "Owner" };
}

async function start(user) {
    const run = ++startRun;
    let context;
    try {
        context = await resolveContext(user);
    } catch {
        return;
    }
    if (run !== startRun || !context) return;
    state.me = { uid: user.uid, name: context.name, role: context.role };
    state.ownerUid = context.ownerUid;
    const shop = ["shops", state.ownerUid];
    const fail = error => {
        if (state.open) setStatus(`Messages unavailable: ${error.code === "permission-denied" ? "chat rules are not deployed yet." : error.message}`);
    };
    try {
        await setDoc(memberRef(), memberFields(), { merge: true });
    } catch (error) {
        fail(error);
    }
    if (run !== startRun) return;
    state.unsubs.push(onSnapshot(collection(db, ...shop, "members"), snapshot => {
        state.members = new Map(snapshot.docs.map(item => [item.id, item.data()]));
        state.reads = { ...(state.members.get(state.me.uid)?.reads || {}), ...state.reads };
        updateBadges();
        render();
    }, fail));
    state.unsubs.push(onSnapshot(query(collection(db, ...shop, "messages"), where("kind", "==", "group")), snapshot => {
        state.groupMessages = messageList(snapshot);
        updateBadges();
        render();
    }, fail));
    state.unsubs.push(onSnapshot(query(collection(db, ...shop, "messages"), where("members", "array-contains", user.uid)), snapshot => {
        state.directMessages = messageList(snapshot);
        updateBadges();
        render();
    }, fail));
    if (context.role === "Owner") {
        try {
            const staffDocs = await getDocs(query(collection(db, "staff"), where("ownerUid", "==", user.uid)));
            if (run !== startRun) return;
            state.staffRoster = new Map(staffDocs.docs
                .filter(item => item.data().active === true)
                .map(item => [item.id, { name: item.data().name, role: item.data().role === "Manager" ? "Manager" : "Cashier" }]));
            render();
        } catch {
            // The roster still fills from members who have opened the chat.
        }
    }
    updateBadges();
    if (state.open) openChat();
}

let startRun = 0;

window.easyReceiptChat = { open: openChat, close: closeChat };

onAuthStateChanged(auth, user => {
    startRun++;
    stopListening();
    if (ui && state.open) openChat();
    if (user) void start(user);
    else startLocal();
});

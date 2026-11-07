(function () {
    'use strict';

    var LOG_KEY = 'activityLog';
    var USERS_KEY = 'registeredUsers';
    var NOTES_KEY = 'supportNotes';
    var DAY = 864e5;
    var feedState = { limit: 100 };
    var caseState = null;
    var activeStat = '';

    function $(id) { return document.getElementById(id); }
    function read(key, fallback) {
        try {
            var value = JSON.parse(localStorage.getItem(key));
            return value == null ? fallback : value;
        } catch (error) { return fallback; }
    }
    function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmt(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    function ago(iso) {
        if (!iso) return 'never';
        var diff = Date.now() - new Date(iso).getTime();
        if (isNaN(diff)) return 'never';
        if (diff < 6e4) return 'just now';
        if (diff < 36e5) return Math.floor(diff / 6e4) + ' min ago';
        if (diff < DAY) return Math.floor(diff / 36e5) + ' h ago';
        return Math.floor(diff / DAY) + ' d ago';
    }
    function time(entry) { return new Date(entry.timestamp).getTime() || 0; }
    function csvCell(value) {
        var text = String(value == null ? '' : value);
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }
    function download(name, content, type) {
        var link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([content], { type: type }));
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }
    function toast(message) {
        var node = $('toast');
        node.textContent = message;
        node.classList.add('show');
        setTimeout(function () { node.classList.remove('show'); }, 2500);
    }

    function getLog() {
        var log = read(LOG_KEY, []);
        return Array.isArray(log) ? log : [];
    }
    function entryEmail(entry) {
        var email = String(entry.email || '').trim().toLowerCase();
        if (email) return email;
        var name = String(entry.username || '').trim().toLowerCase();
        return name.indexOf('@') > 0 ? name : '';
    }
    function currentIdentity() {
        if (localStorage.getItem('isLoggedIn') !== 'true') return null;
        return read('currentUser', null);
    }
    function isCurrent(user) {
        var current = currentIdentity();
        if (!current) return false;
        return (user.uid && current.uid === user.uid) ||
            (user.email && String(current.email || '').toLowerCase() === user.email);
    }

    function buildUsers() {
        var map = {};
        var nameIndex = {};
        var registered = read(USERS_KEY, []);
        if (!Array.isArray(registered)) registered = [];
        registered.forEach(function (record) {
            var email = String(record.email || '').trim().toLowerCase();
            var key = email ? 'e:' + email : 'n:' + String(record.username || '').toLowerCase();
            map[key] = { key: key, uid: record.uid || '', username: record.username || email, email: email, createdAt: record.createdAt || '', registered: true, entries: [] };
            if (record.username) nameIndex[String(record.username).toLowerCase()] = key;
        });
        getLog().forEach(function (entry) {
            var email = entryEmail(entry);
            var name = String(entry.username || '').toLowerCase();
            var key = email ? 'e:' + email : (nameIndex[name] || 'n:' + (name || 'guest'));
            var user = map[key];
            if (!user) {
                user = map[key] = { key: key, uid: '', username: entry.username || email || 'Guest', email: email, createdAt: '', registered: false, entries: [] };
            }
            if (!user.uid && entry.userId) user.uid = entry.userId;
            if (!user.email && email) user.email = email;
            if (entry.username && entry.username.indexOf('@') < 0 && /@/.test(user.username)) user.username = entry.username;
            user.entries.push(entry);
        });
        return Object.keys(map).map(function (key) {
            var user = map[key];
            user.entries.sort(function (a, b) { return time(b) - time(a); });
            user.stats = computeStats(user);
            user.code = window.UserCode ? window.UserCode.forUser(user) : '';
            user.receipts = receiptHistory(user);
            return user;
        });
    }

    var RECEIPT_TYPES = { 'Receipt Saved': 'saved', 'Receipt Shared': 'shared', 'Receipt Downloaded': 'downloaded', 'Receipt Copied': 'copied', 'Receipt Printed': 'printed' };

    function receiptHistory(user) {
        var groups = {};
        function group(ref, info) {
            if (!groups[ref]) groups[ref] = { ref: ref, client: '', total: null, store: '', savedAt: '', counts: { saved: 0, shared: 0, downloaded: 0, copied: 0, printed: 0 }, events: [] };
            var g = groups[ref];
            if (info) {
                g.client = g.client || info.client || '';
                g.store = g.store || info.store || '';
                if (g.total == null && info.total != null) g.total = info.total;
            }
            return g;
        }
        user.entries.forEach(function (e) {
            var type = RECEIPT_TYPES[e.action];
            if (!type || !e.receipt) return;
            var g = group(e.receipt.ref || 'Unsaved receipt', e.receipt);
            g.counts[type]++;
            if (type === 'saved' && !g.savedAt) g.savedAt = e.timestamp;
            g.events.push({ type: type, action: e.action, channel: e.receipt.channel || '', timestamp: e.timestamp });
        });
        if (isCurrent(user)) {
            var snaps = read('p3_pos_snapshots', []);
            (Array.isArray(snaps) ? snaps : []).forEach(function (s) {
                var ref = s.receiptRef || String(s.id);
                var g = group(ref, { client: s.client, store: s.store, total: isFinite(Number(s.total)) ? Number(s.total) : null });
                if (!g.counts.saved) {
                    g.counts.saved = 1;
                    g.savedAt = s.timestamp || new Date(Number(s.id)).toISOString();
                    g.events.push({ type: 'saved', action: 'Receipt Saved', channel: '', timestamp: g.savedAt });
                }
            });
        }
        return Object.keys(groups).map(function (k) {
            var g = groups[k];
            g.events.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
            g.last = g.events[0] ? g.events[0].timestamp : g.savedAt;
            return g;
        }).sort(function (a, b) { return new Date(b.last || 0) - new Date(a.last || 0); });
    }

    function computeStats(user) {
        var now = Date.now();
        var stats = { total: user.entries.length, byAction: {}, sessions: {}, devices: {}, pages: {}, errors: [], failed24: 0, lastLogin: null, lastFailed: null, last: user.entries[0] || null, first: user.entries[user.entries.length - 1] || null };
        user.entries.forEach(function (entry) {
            stats.byAction[entry.action] = (stats.byAction[entry.action] || 0) + 1;
            if (entry.sessionId) stats.sessions[entry.sessionId] = 1;
            if (entry.device) stats.devices[entry.device] = (stats.devices[entry.device] || 0) + 1;
            if (entry.page) stats.pages[entry.page] = (stats.pages[entry.page] || 0) + 1;
            if (entry.action === 'Error') stats.errors.push(entry);
            if (entry.action === 'Failed Login' && now - time(entry) < DAY) stats.failed24++;
            if (entry.action === 'Logged In' && !stats.lastLogin) stats.lastLogin = entry;
            if (entry.action === 'Failed Login' && !stats.lastFailed) stats.lastFailed = entry;
        });
        return stats;
    }

    function diagnose(user) {
        var s = user.stats;
        var now = Date.now();
        var notes = [];
        if (s.failed24 >= 3) notes.push({ level: 'bad', text: s.failed24 + ' failed sign-ins in the last 24 hours. Most likely a wrong password: guide them to "Forgot Password".' });
        if (s.lastFailed && (!s.lastLogin || time(s.lastFailed) > time(s.lastLogin))) notes.push({ level: 'warn', text: 'Their latest sign-in attempt failed (' + fmt(s.lastFailed.timestamp) + ') and no successful sign-in followed.' });
        if (user.registered && !s.lastLogin) notes.push({ level: 'warn', text: 'Registered but has never signed in. They may not have completed the email verification code.' });
        var recentErrors = s.errors.filter(function (e) { return now - time(e) < 7 * DAY; });
        if (recentErrors.length) notes.push({ level: 'bad', text: recentErrors.length + ' app error(s) in the last 7 days. Latest: "' + recentErrors[0].detail + '" on ' + (recentErrors[0].page || 'unknown page') + '.' });
        var deviceCount = Object.keys(s.devices).length;
        if (deviceCount > 1) notes.push({ level: 'info', text: 'Used ' + deviceCount + ' different devices/browsers. Check which one they are having trouble on.' });
        if (s.last && now - time(s.last) > 30 * DAY) notes.push({ level: 'info', text: 'Inactive for more than 30 days.' });
        if (!notes.length) notes.push({ level: 'ok', text: 'No problems detected in the recorded activity.' });
        return notes;
    }

    function dataSnapshot(user) {
        if (!isCurrent(user)) return null;
        function count(key) {
            var value = read(key, null);
            return Array.isArray(value) ? value.length : (value && typeof value === 'object' ? Object.keys(value).length : 0);
        }
        var settings = read('p3_app_settings', {}) || {};
        return {
            'Saved receipts': count('p3_pos_snapshots'),
            'Drafts': count('p3_pos_drafts'),
            'Customers': count('p3_saved_customers'),
            'Stores': count('p3_saved_stores'),
            'Stock items': count('p3_stock_items'),
            'Storage mode': settings.storageMode || 'cloud',
            'Theme': settings.theme || 'system'
        };
    }

    function getNotes(key) {
        var all = read(NOTES_KEY, {});
        return (all && all[key]) || [];
    }
    function setNotes(key, notes) {
        var all = read(NOTES_KEY, {}) || {};
        if (notes.length) all[key] = notes; else delete all[key];
        write(NOTES_KEY, all);
    }

    function badge(action) {
        var cls = { 'Logged In': 'login', 'Failed Login': 'fail', 'Registered': 'reg', 'Error': 'err', 'Page View': 'page', 'Action': 'act', 'Data Change': 'data', 'Session Start': 'login', 'Connectivity': 'other' }[action] || 'other';
        return '<span class="badge ' + cls + '">' + esc(action || 'Activity') + '</span>';
    }

    function periodStart(value) {
        var now = Date.now();
        if (value === 'hour') return now - 36e5;
        if (value === 'day') return now - DAY;
        if (value === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
        if (value === 'week') return now - 7 * DAY;
        if (value === 'month') return now - 30 * DAY;
        return 0;
    }

    function renderStats(users) {
        var log = getLog();
        var now = Date.now();
        var activeToday = {};
        var activeNow = {};
        var start = periodStart('today');
        users.forEach(function (user) {
            if (user.stats.last && time(user.stats.last) >= start) activeToday[user.key] = 1;
            if (user.stats.last && now - time(user.stats.last) < 15 * 6e4) activeNow[user.key] = 1;
        });
        var failed24 = log.filter(function (e) { return e.action === 'Failed Login' && now - time(e) < DAY; }).length;
        var errors7 = log.filter(function (e) { return e.action === 'Error' && now - time(e) < 7 * DAY; }).length;
        var unregistered = users.filter(function (user) { return !user.registered; }).length;
        var cards = [
            ['blue', users.length, 'Known Users', 'known-users'],
            ['yellow', unregistered, 'Unregistered Users (here)', 'unregistered'],
            ['', Object.keys(activeNow).length, 'Active Now (15 min)', 'active-now'],
            ['', Object.keys(activeToday).length, 'Active Today', 'active-today'],
            ['yellow', log.length, 'Recorded Events', 'events'],
            ['red', failed24, 'Failed Logins (24h)', 'failed-logins'],
            ['red', errors7, 'App Errors (7d)', 'app-errors']
        ];
        $('statsRow').innerHTML = cards.map(function (c) {
            var selected = activeStat === c[3];
            return '<button type="button" class="stat-card ' + c[0] + (selected ? ' active' : '') + '" data-stat="' + c[3] + '" aria-pressed="' + selected + '" aria-label="' + esc(c[2] + ': ' + c[1]) + '">' +
                '<div class="num">' + c[1] + '</div><div class="label">' + c[2] + '</div></button>';
        }).join('');
    }

    function renderAttention(users) {
        var flagged = users.map(function (user) {
            return { user: user, issues: diagnose(user).filter(function (n) { return n.level === 'bad' || n.level === 'warn'; }) };
        }).filter(function (item) { return item.issues.length; });
        $('attentionPanel').style.display = flagged.length ? 'block' : 'none';
        $('attentionList').innerHTML = flagged.map(function (item) {
            return '<div class="attention-item"><div><b>' + esc(item.user.username) + '</b> <span class="muted">' + esc(item.user.email) + '</span><div class="note ' + item.issues[0].level + '">' + esc(item.issues[0].text) + '</div></div>' +
                '<button class="btn btn-primary" data-act="open" data-key="' + encodeURIComponent(item.user.key) + '"><i class="fas fa-life-ring"></i> Help</button></div>';
        }).join('');
    }

    function renderUsers(users) {
        var search = $('searchInput').value.trim().toLowerCase();
        var sort = $('sortSelect').value;
        var list = users.filter(function (u) {
            if (search && (u.username + ' ' + u.email + ' ' + u.uid + ' ' + u.code).toLowerCase().indexOf(search) < 0) return false;
            if (activeStat === 'unregistered' && u.registered) return false;
            if (activeStat === 'active-now' && (!u.stats.last || Date.now() - time(u.stats.last) >= 15 * 6e4)) return false;
            if (activeStat === 'active-today' && (!u.stats.last || time(u.stats.last) < periodStart('today'))) return false;
            return true;
        });
        var sorters = {
            recent: function (a, b) { return (a.stats.last ? time(a.stats.last) : 0) - (b.stats.last ? time(b.stats.last) : 0); },
            newest: function (a, b) { return new Date(a.createdAt || 0) - new Date(b.createdAt || 0); },
            az: function (a, b) { return String(b.username).localeCompare(String(a.username)); },
            active: function (a, b) { return a.stats.total - b.stats.total; },
            issues: function (a, b) { return issueScore(a) - issueScore(b); }
        };
        list.sort(sorters[sort] || sorters.recent);
        list.reverse();
        $('usersEmptyState').style.display = list.length ? 'none' : 'block';
        $('usersEmptyState').textContent = search ? 'No user matches "' + $('searchInput').value.trim() + '".' : 'No users or activity recorded on this browser yet.';
        $('searchResultInfo').textContent = search || activeStat === 'unregistered' || activeStat === 'active-now' || activeStat === 'active-today'
            ? list.length + ' of ' + users.length + ' users match'
            : users.length + ' users';
        $('usersTableBody').innerHTML = list.map(function (u) {
            var online = isCurrent(u) ? '<span class="badge login">Signed in here</span>' : (u.stats.last && Date.now() - time(u.stats.last) < 15 * 6e4 ? '<span class="badge act">Recently active</span>' : '<span class="badge other">Offline</span>');
            var issues = issueScore(u);
            var flag = issues ? '<span class="badge fail">' + issues + ' issue' + (issues > 1 ? 's' : '') + '</span>' : '<span class="badge login">OK</span>';
            return '<tr data-act="open" data-key="' + encodeURIComponent(u.key) + '">' +
                '<td data-label="ID"><b>' + esc(u.code || '—') + '</b></td>' +
                '<td data-label="User"><a href="#" class="user-link" data-act="open" data-key="' + encodeURIComponent(u.key) + '"><b>' + esc(u.username) + '</b></a>' + (u.registered ? '' : ' <span class="muted">(not registered here)</span>') + '</td>' +
                '<td data-label="Email">' + esc(u.email || '—') + '</td>' +
                '<td data-label="Receipts">' + u.receipts.length + '</td>' +
                '<td data-label="Last Activity">' + esc(ago(u.stats.last && u.stats.last.timestamp)) + '</td>' +
                '<td data-label="Events">' + u.stats.total + '</td>' +
                '<td data-label="Status">' + online + '</td>' +
                '<td data-label="Health">' + flag + '</td>' +
                '<td class="row-actions"><i class="fas fa-life-ring view" title="Open support case" data-act="open" data-key="' + encodeURIComponent(u.key) + '"></i>' +
                '<i class="fas fa-trash" title="Remove local record" data-act="del-user" data-key="' + encodeURIComponent(u.key) + '"></i></td></tr>';
        }).join('');
    }
    function issueScore(user) {
        return diagnose(user).filter(function (n) { return n.level === 'bad' || n.level === 'warn'; }).length;
    }

    function filteredFeed(users) {
        var userKey = $('userFilter').value;
        var action = $('actionFilter').value;
        var since = periodStart($('periodFilter').value);
        var search = $('activitySearchInput').value.trim().toLowerCase();
        var source = getLog().slice();
        if (userKey !== 'all') {
            var selected = users.filter(function (u) { return u.key === userKey; })[0];
            source = selected ? selected.entries.slice() : [];
        }
        source.sort(function (a, b) { return time(b) - time(a); });
        return source.filter(function (e) {
            if (action !== 'all' && e.action !== action) return false;
            if (since && time(e) < since) return false;
            if (search && [e.username, e.email, e.action, e.detail, e.page, e.device].join(' ').toLowerCase().indexOf(search) < 0) return false;
            return true;
        });
    }

    function refreshFilterOptions(users) {
        var userSelect = $('userFilter');
        var previousUser = userSelect.value || 'all';
        userSelect.innerHTML = '<option value="all">All users</option>' + users.map(function (u) {
            return '<option value="' + esc(u.key) + '">' + esc(u.username + (u.email && u.email !== u.username ? ' (' + u.email + ')' : '')) + '</option>';
        }).join('');
        userSelect.value = users.some(function (u) { return u.key === previousUser; }) ? previousUser : 'all';

        var actionSelect = $('actionFilter');
        var previousAction = actionSelect.value || 'all';
        var actions = {};
        getLog().forEach(function (e) { if (e.action) actions[e.action] = 1; });
        actions['Failed Login'] = 1;
        actions.Error = 1;
        actionSelect.innerHTML = '<option value="all">All actions</option>' + Object.keys(actions).sort().map(function (a) {
            return '<option value="' + esc(a) + '">' + esc(a) + '</option>';
        }).join('');
        actionSelect.value = actions[previousAction] ? previousAction : 'all';
    }

    function renderFeed(users) {
        var rows = filteredFeed(users);
        var shown = rows.slice(0, feedState.limit);
        $('feedCount').textContent = rows.length + ' matching event' + (rows.length === 1 ? '' : 's');
        $('activityEmptyState').style.display = rows.length ? 'none' : 'block';
        $('activityTableBody').innerHTML = shown.map(function (e) {
            return '<tr><td data-label="When">' + fmt(e.timestamp) + '</td>' +
                '<td data-label="User">' + esc(e.username || e.email || '—') + '</td>' +
                '<td data-label="Action">' + badge(e.action) + '</td>' +
                '<td data-label="Detail">' + esc(e.detail || '') + '</td>' +
                '<td data-label="Page">' + esc(e.page || '') + '</td>' +
                '<td data-label="Device">' + esc(e.device || '') + '</td></tr>';
        }).join('');
        $('moreFeed').style.display = rows.length > shown.length ? 'inline-block' : 'none';
    }

    function sharedRows(users) {
        var rows = [];
        users.forEach(function (user) {
            user.entries.forEach(function (e) {
                if (e.action !== 'Receipt Shared') return;
                var r = e.receipt || {};
                rows.push({ entry: e, key: user.key, user: user.username || user.email || '—', ref: r.ref || '', client: r.client || '', store: r.store || '', total: r.total, channel: r.channel || '', timestamp: e.timestamp });
            });
        });
        rows.sort(function (a, b) { return time(b.entry) - time(a.entry); });
        return rows;
    }

    function filteredShared(users) {
        var term = $('sharedSearch').value.trim().toLowerCase();
        var channel = $('sharedChannel').value;
        var start = periodStart($('sharedPeriod').value);
        return sharedRows(users).filter(function (r) {
            if (channel !== 'all' && r.channel !== channel) return false;
            if (start && time(r.entry) < start) return false;
            return !term || (r.ref + ' ' + r.client + ' ' + r.store + ' ' + r.user).toLowerCase().indexOf(term) > -1;
        });
    }

    function renderShared(users) {
        var select = $('sharedChannel');
        var current = select.value;
        var channels = [];
        sharedRows(users).forEach(function (r) { if (r.channel && channels.indexOf(r.channel) === -1) channels.push(r.channel); });
        channels.sort();
        select.innerHTML = '<option value="all">All channels</option>' + channels.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
        select.value = channels.indexOf(current) > -1 ? current : 'all';
        var rows = filteredShared(users);
        $('sharedCount').textContent = rows.length + ' shared';
        $('sharedEmptyState').style.display = rows.length ? 'none' : 'block';
        $('sharedTableBody').innerHTML = rows.slice(0, 200).map(function (r) {
            var id = encodeURIComponent(r.entry.timestamp + '|' + r.entry.detail);
            return '<tr><td data-label="When">' + fmt(r.timestamp) + '</td>' +
                '<td data-label="User">' + esc(r.user) + '</td>' +
                '<td data-label="Receipt">' + esc(r.ref || '—') + '</td>' +
                '<td data-label="Client">' + esc(r.client || '—') + '</td>' +
                '<td data-label="Store">' + esc(r.store || '—') + '</td>' +
                '<td data-label="Total">' + (r.total == null || r.total === '' ? '—' : esc(r.total)) + '</td>' +
                '<td data-label="Channel">' + esc(r.channel || '—') + '</td>' +
                '<td data-label="Control" class="row-actions"><i class="fas fa-eye view" title="Open user case" data-act="open" data-key="' + encodeURIComponent(r.key) + '"></i>' +
                '<i class="fas fa-trash" title="Remove this record" data-act="del-shared" data-id="' + esc(id) + '"></i></td></tr>';
        }).join('');
    }

    function renderAll() {
        var users = buildUsers();
        refreshFilterOptions(users);
        renderStats(users);
        renderAttention(users);
        renderUsers(users);
        renderShared(users);
        renderFeed(users);
        if (caseState && $('userModal').classList.contains('show')) { renderCaseReceipts(); renderCaseTimeline(); }
    }

    $('statsRow').addEventListener('click', function (event) {
        var card = event.target.closest('[data-stat]');
        if (!card) return;
        var selectedStat = card.getAttribute('data-stat');
        activeStat = activeStat === selectedStat ? '' : selectedStat;
        var isUserStat = ['known-users', 'unregistered', 'active-now', 'active-today'].indexOf(selectedStat) !== -1;
        if (isUserStat) {
            $('searchInput').value = '';
        } else if (activeStat) {
            $('userFilter').value = 'all';
            $('actionFilter').value = activeStat === 'failed-logins' ? 'Failed Login' : activeStat === 'app-errors' ? 'Error' : 'all';
            $('periodFilter').value = activeStat === 'failed-logins' ? 'day' : activeStat === 'app-errors' ? 'week' : 'all';
            $('activitySearchInput').value = '';
            feedState.limit = 100;
        }
        renderAll();
        (isUserStat ? $('usersPanel') : $('activityPanel')).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function findUser(key) {
        return buildUsers().filter(function (u) { return u.key === key; })[0];
    }

    function buildReport(user) {
        var s = user.stats;
        return {
            generatedAt: new Date().toISOString(),
            note: 'Activity data is read from this browser only.',
            user: { username: user.username, email: user.email, uid: user.uid, userCode: user.code, registeredAt: user.createdAt || null, registeredOnThisBrowser: user.registered },
            summary: {
                totalEvents: s.total,
                firstSeen: s.first && s.first.timestamp,
                lastSeen: s.last && s.last.timestamp,
                lastSuccessfulLogin: s.lastLogin && s.lastLogin.timestamp,
                lastFailedLogin: s.lastFailed && s.lastFailed.timestamp,
                failedLoginsLast24h: s.failed24,
                sessions: Object.keys(s.sessions).length,
                eventsByAction: s.byAction,
                pagesVisited: s.pages
            },
            diagnosis: diagnose(user).map(function (n) { return n.text; }),
            devices: s.devices,
            errors: s.errors.slice(0, 20),
            businessDataSnapshot: dataSnapshot(user),
            receiptHistory: user.receipts,
            supportNotes: getNotes(user.key),
            timeline: user.entries
        };
    }

    function reportText(user) {
        var r = buildReport(user);
        var lines = [
            'SUPPORT SUMMARY — ' + user.username + (user.email ? ' <' + user.email + '>' : ''),
            'Generated: ' + fmt(r.generatedAt),
            'Registered: ' + fmt(user.createdAt) + ' | User ID: ' + (user.code || 'n/a') + ' | UID: ' + (user.uid || 'unknown'),
            'Total events: ' + r.summary.totalEvents + ' | Sessions: ' + r.summary.sessions,
            'First seen: ' + fmt(r.summary.firstSeen) + ' | Last seen: ' + fmt(r.summary.lastSeen),
            'Last sign-in: ' + fmt(r.summary.lastSuccessfulLogin) + ' | Last failed sign-in: ' + fmt(r.summary.lastFailedLogin),
            'Failed sign-ins (24h): ' + r.summary.failedLoginsLast24h,
            '', 'Findings:'
        ].concat(r.diagnosis.map(function (t) { return ' - ' + t; }));
        lines.push('', 'Devices:');
        Object.keys(r.devices).forEach(function (d) { lines.push(' - ' + d + ' (' + r.devices[d] + ' events)'); });
        if (r.businessDataSnapshot) {
            lines.push('', 'Business data on this browser:');
            Object.keys(r.businessDataSnapshot).forEach(function (k) { lines.push(' - ' + k + ': ' + r.businessDataSnapshot[k]); });
        }
        if (r.supportNotes.length) {
            lines.push('', 'Support notes:');
            r.supportNotes.forEach(function (n) { lines.push(' - [' + fmt(n.timestamp) + '] ' + n.text); });
        }
        lines.push('', 'Receipt history (' + user.receipts.length + '):');
        user.receipts.slice(0, 30).forEach(function (g) {
            lines.push(' - ' + g.ref + (g.client ? ' | ' + g.client : '') + (g.total != null ? ' | ' + g.total.toFixed(2) : '') +
                ' | saved ' + g.counts.saved + ', shared ' + g.counts.shared + ', downloaded ' + g.counts.downloaded + ', copied ' + g.counts.copied + ', printed ' + g.counts.printed);
        });
        lines.push('', 'Last 15 events:');
        user.entries.slice(0, 15).forEach(function (e) { lines.push(' ' + fmt(e.timestamp) + ' | ' + e.action + ' | ' + (e.detail || '') + ' | ' + (e.page || '')); });
        return lines.join('\n');
    }

    function timelineCsv(entries) {
        var rows = [['When', 'User', 'Email', 'Action', 'Detail', 'Page', 'Device', 'Session', 'Online']];
        entries.forEach(function (e) {
            rows.push([e.timestamp, e.username, e.email, e.action, e.detail, e.page, e.device, e.sessionId, e.online]);
        });
        return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    }

    function openCase(key) {
        var user = findUser(key);
        if (!user) return;
        caseState = { key: key, action: 'all', search: '', limit: 50, rType: 'all', rSearch: '' };
        var r = buildReport(user);
        var s = user.stats;
        var snapshot = r.businessDataSnapshot;
        var actions = Object.keys(s.byAction).sort();
        $('modalUserTitle').innerHTML = '<i class="fas fa-life-ring"></i> Support case: ' + esc(user.username);
        $('modalBody').innerHTML =
            '<div class="case-actions">' +
            '<button class="btn btn-primary" data-act="copy-summary"><i class="fas fa-copy"></i> Copy summary</button>' +
            '<button class="btn btn-muted" data-act="export-json"><i class="fas fa-file-code"></i> Full report (JSON)</button>' +
            '<button class="btn btn-muted" data-act="export-timeline"><i class="fas fa-file-csv"></i> Timeline (CSV)</button>' +
            '<button class="btn btn-muted" data-act="print-case"><i class="fas fa-print"></i> Print</button></div>' +
            '<h4><i class="fas fa-stethoscope"></i> Findings</h4>' +
            r.diagnosis.map(function (text, i) { return '<div class="note ' + diagnose(user)[i].level + '">' + esc(text) + '</div>'; }).join('') +
            '<h4><i class="fas fa-id-card"></i> Account</h4>' +
            line('User ID', user.code || 'n/a') + line('Email', user.email || '—') + line('Auth UID', user.uid || 'unknown') + line('Registered', fmt(user.createdAt)) +
            line('First seen', fmt(s.first && s.first.timestamp)) + line('Last seen', fmt(s.last && s.last.timestamp) + ' (' + ago(s.last && s.last.timestamp) + ')') +
            line('Last sign-in', fmt(s.lastLogin && s.lastLogin.timestamp)) + line('Last failed sign-in', fmt(s.lastFailed && s.lastFailed.timestamp)) +
            line('Sessions', Object.keys(s.sessions).length) + line('Total events', s.total) +
            '<h4><i class="fas fa-receipt"></i> Receipt history</h4>' +
            '<div class="toolbar"><select id="receiptType"><option value="all">All activity</option><option value="saved">Saved</option><option value="shared">Shared</option><option value="downloaded">Downloaded</option><option value="copied">Copied</option><option value="printed">Printed</option></select>' +
            '<input type="text" id="receiptSearch" placeholder="Search receipt number or customer..."></div><div id="caseReceipts"></div>' +
            '<h4><i class="fas fa-laptop"></i> Devices &amp; browsers</h4>' +
            (Object.keys(s.devices).map(function (d) { return line(d, s.devices[d] + ' events'); }).join('') || '<p class="muted">No device data recorded yet.</p>') +
            '<h4><i class="fas fa-database"></i> Business data on this browser</h4>' +
            (snapshot ? Object.keys(snapshot).map(function (k) { return line(k, snapshot[k]); }).join('') : '<p class="muted">Business data is stored per user. It is shown here only when this user is signed in on this browser.</p>') +
            '<h4><i class="fas fa-note-sticky"></i> Support notes</h4><div id="caseNotes"></div>' +
            '<div class="note-form"><input type="text" id="noteInput" maxlength="500" placeholder="Add a note (what was asked, what you did)..."><button class="btn btn-primary" data-act="add-note">Add</button></div>' +
            '<h4><i class="fas fa-list"></i> Activity timeline</h4>' +
            '<div class="toolbar"><select id="caseAction"><option value="all">All actions</option>' + actions.map(function (a) { return '<option value="' + esc(a) + '">' + esc(a) + ' (' + s.byAction[a] + ')</option>'; }).join('') + '</select>' +
            '<input type="text" id="caseSearch" placeholder="Search this timeline..."></div><div id="caseTimeline"></div>';
        renderCaseNotes();
        renderCaseReceipts();
        renderCaseTimeline();
        $('userModal').classList.add('show');
    }
    function renderCaseReceipts() {
        var user = findUser(caseState.key);
        if (!user || !$('caseReceipts')) return;
        var type = caseState.rType;
        var term = caseState.rSearch;
        var rows = user.receipts.filter(function (g) {
            if (type !== 'all' && !g.counts[type]) return false;
            return !term || [g.ref, g.client, g.store].join(' ').toLowerCase().indexOf(term) > -1;
        });
        $('caseReceipts').innerHTML = rows.map(function (g) {
            var events = g.events.filter(function (ev) { return type === 'all' || ev.type === type; });
            return '<div class="activity-item"><b>' + esc(g.ref) + '</b>' + (g.client ? ' · ' + esc(g.client) : '') + (g.total != null ? ' · ' + g.total.toFixed(2) : '') + (g.store ? ' · ' + esc(g.store) : '') +
                '<div class="meta">Saved ' + g.counts.saved + ' · Shared ' + g.counts.shared + ' · Downloaded ' + g.counts.downloaded + ' · Copied ' + g.counts.copied + ' · Printed ' + g.counts.printed + '</div>' +
                events.slice(0, 20).map(function (ev) {
                    return '<div class="meta">' + esc(ev.action.replace('Receipt ', '')) + (ev.channel ? ' (' + esc(ev.channel) + ')' : '') + ' — ' + fmt(ev.timestamp) + '</div>';
                }).join('') + '</div>';
        }).join('') || '<p class="muted">No receipt activity recorded for this user' + (type !== 'all' || term ? ' matching the filter' : '') + '.</p>';
    }
    function line(label, value) {
        return '<div class="profile-line"><b>' + esc(label) + '</b><span>' + esc(value) + '</span></div>';
    }

    function renderCaseNotes() {
        var notes = getNotes(caseState.key);
        $('caseNotes').innerHTML = notes.length ? notes.map(function (n, i) {
            return '<div class="activity-item">' + esc(n.text) + '<div class="meta">' + fmt(n.timestamp) + ' <a href="#" data-act="del-note" data-index="' + i + '">delete</a></div></div>';
        }).join('') : '<p class="muted">No notes yet.</p>';
    }

    function caseEntries(user) {
        return user.entries.filter(function (e) {
            if (caseState.action !== 'all' && e.action !== caseState.action) return false;
            return !caseState.search || [e.action, e.detail, e.page, e.device].join(' ').toLowerCase().indexOf(caseState.search) > -1;
        });
    }

    function renderCaseTimeline() {
        var user = findUser(caseState.key);
        if (!user) { closeCase(); return; }
        var rows = caseEntries(user);
        var shown = rows.slice(0, caseState.limit);
        $('caseTimeline').innerHTML = (shown.map(function (e) {
            return '<div class="activity-item">' + badge(e.action) + ' ' + esc(e.detail || '') +
                '<div class="meta">' + fmt(e.timestamp) + (e.page ? ' · ' + esc(e.page) : '') + (e.device ? ' · ' + esc(e.device) : '') + '</div></div>';
        }).join('') || '<p class="muted">No matching activity.</p>') +
            (rows.length > shown.length ? '<button class="btn btn-muted" data-act="case-more">Show more (' + (rows.length - shown.length) + ' left)</button>' : '');
    }

    function closeCase() {
        $('userModal').classList.remove('show');
        caseState = null;
    }

    function removeUser(key) {
        var user = findUser(key);
        if (!user) return;
        if (!confirm('Remove the local record and activity history for "' + user.username + '"? This does not delete their Firebase account.')) return;
        write(USERS_KEY, read(USERS_KEY, []).filter(function (r) {
            var email = String(r.email || '').toLowerCase();
            return (email ? 'e:' + email : 'n:' + String(r.username || '').toLowerCase()) !== key;
        }));
        var drop = {};
        user.entries.forEach(function (e) { drop[e.timestamp + '|' + e.action + '|' + e.detail] = 1; });
        write(LOG_KEY, getLog().filter(function (e) { return !drop[e.timestamp + '|' + e.action + '|' + e.detail]; }));
        setNotes(key, []);
        renderAll();
    }

    document.addEventListener('click', function (event) {
        var target = event.target.closest('[data-act]');
        if (!target) return;
        var act = target.getAttribute('data-act');
        var key = target.getAttribute('data-key') ? decodeURIComponent(target.getAttribute('data-key')) : (caseState && caseState.key);
        if (act === 'del-note' || act === 'del-user') event.stopPropagation();
        if (act === 'open') { event.preventDefault(); openCase(key); return; }
        if (act === 'del-user') { removeUser(key); return; }
        if (act === 'more') { feedState.limit += 100; renderAll(); return; }
        if (act === 'del-shared') {
            event.stopPropagation();
            if (!confirm('Remove this shared-receipt record from the activity log on this browser?')) return;
            var id = decodeURIComponent(target.getAttribute('data-id'));
            var removed = false;
            write(LOG_KEY, getLog().filter(function (e) {
                if (!removed && e.action === 'Receipt Shared' && (e.timestamp + '|' + e.detail) === id) { removed = true; return false; }
                return true;
            }));
            renderAll();
            return;
        }
        if (!caseState) return;
        var user = findUser(caseState.key);
        if (!user) return;
        var slug = String(user.email || user.username).replace(/[^a-z0-9]+/gi, '_');
        if (act === 'copy-summary') {
            var text = reportText(user);
            (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Summary copied'); }, function () { download('support_' + slug + '.txt', text, 'text/plain'); });
        } else if (act === 'export-json') {
            download('support_report_' + slug + '.json', JSON.stringify(buildReport(user), null, 2), 'application/json');
        } else if (act === 'export-timeline') {
            download('timeline_' + slug + '.csv', timelineCsv(caseEntries(user)), 'text/csv');
        } else if (act === 'print-case') {
            window.print();
        } else if (act === 'add-note') {
            var input = $('noteInput');
            var value = input.value.trim();
            if (!value) return;
            var notes = getNotes(caseState.key);
            notes.unshift({ text: value, timestamp: new Date().toISOString() });
            setNotes(caseState.key, notes);
            input.value = '';
            renderCaseNotes();
        } else if (act === 'del-note') {
            event.preventDefault();
            var list = getNotes(caseState.key);
            list.splice(Number(target.getAttribute('data-index')), 1);
            setNotes(caseState.key, list);
            renderCaseNotes();
        } else if (act === 'case-more') {
            caseState.limit += 50;
            renderCaseTimeline();
        }
    });

    document.addEventListener('input', function (event) {
        if (event.target.id === 'caseSearch' && caseState) { caseState.search = event.target.value.trim().toLowerCase(); caseState.limit = 50; renderCaseTimeline(); }
        if (event.target.id === 'receiptSearch' && caseState) { caseState.rSearch = event.target.value.trim().toLowerCase(); renderCaseReceipts(); }
    });
    document.addEventListener('change', function (event) {
        if (event.target.id === 'receiptType' && caseState) { caseState.rType = event.target.value; renderCaseReceipts(); }
        if (event.target.id === 'caseAction' && caseState) { caseState.action = event.target.value; caseState.limit = 50; renderCaseTimeline(); }
    });
    $('userModal').addEventListener('click', function (event) { if (event.target === $('userModal')) closeCase(); });
    $('closeCase').addEventListener('click', closeCase);

    function runSearch() {
        renderAll();
        var term = $('searchInput').value.trim().toLowerCase();
        if (!term) return;
        var hits = buildUsers().filter(function (u) { return (u.username + ' ' + u.email + ' ' + u.uid + ' ' + u.code).toLowerCase().indexOf(term) > -1; });
        if (hits.length === 1) openCase(hits[0].key);
        else if (!hits.length) toast('No user found for "' + $('searchInput').value.trim() + '"');
    }
    $('searchBtn').addEventListener('click', runSearch);
    $('searchInput').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); runSearch(); } });
    $('clearSearchBtn').addEventListener('click', function () { $('searchInput').value = ''; renderAll(); $('searchInput').focus(); });
    ['searchInput', 'sortSelect'].forEach(function (id) { $(id).addEventListener('input', renderAll); });
    ['userFilter', 'actionFilter', 'periodFilter', 'activitySearchInput'].forEach(function (id) {
        $(id).addEventListener('input', function () { feedState.limit = 100; renderAll(); });
    });
    $('exportUsers').addEventListener('click', function () {
        var users = buildUsers();
        if (!users.length) { toast('No users to export.'); return; }
        var rows = [['User ID', 'Username', 'Email', 'Auth UID', 'Registered', 'First seen', 'Last seen', 'Last sign-in', 'Failed logins (24h)', 'Sessions', 'Events', 'Receipts', 'Findings']];
        users.forEach(function (u) {
            var s = u.stats;
            rows.push([u.code, u.username, u.email, u.uid, u.createdAt, s.first && s.first.timestamp, s.last && s.last.timestamp, s.lastLogin && s.lastLogin.timestamp, s.failed24, Object.keys(s.sessions).length, s.total, u.receipts.length, diagnose(u).map(function (n) { return n.text; }).join(' | ')]);
        });
        download('users_overview.csv', rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'), 'text/csv');
    });
    $('exportFeed').addEventListener('click', function () {
        var rows = filteredFeed(buildUsers());
        if (!rows.length) { toast('Nothing to export.'); return; }
        download('activity_log.csv', timelineCsv(rows), 'text/csv');
    });
    $('clearLog').addEventListener('click', function () {
        if (!confirm('Clear the entire activity log stored in this browser? This cannot be undone.')) return;
        write(LOG_KEY, []);
        renderAll();
    });
    window.addEventListener('storage', renderAll);
    ['sharedSearch', 'sharedChannel', 'sharedPeriod'].forEach(function (id) { $(id).addEventListener('input', renderAll); });
    $('exportShared').addEventListener('click', function () {
        var rows = filteredShared(buildUsers());
        if (!rows.length) { toast('Nothing to export.'); return; }
        var out = [['When', 'User', 'Receipt', 'Client', 'Store', 'Total', 'Channel']];
        rows.forEach(function (r) { out.push([r.timestamp, r.user, r.ref, r.client, r.store, r.total, r.channel]); });
        download('shared_receipts.csv', out.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'), 'text/csv');
    });

    var menuToggle = $('menuToggle');
    var menuList = $('menuList');
    function setMenu(open) {
        menuList.hidden = !open;
        menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    menuToggle.addEventListener('click', function (event) { event.stopPropagation(); setMenu(menuList.hidden); });
    menuList.addEventListener('click', function (event) {
        var link = event.target.closest('[data-nav]');
        if (!link) return;
        event.preventDefault();
        var target = $(link.getAttribute('data-nav'));
        setMenu(false);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.addEventListener('click', function (event) { if (!menuList.hidden && !event.target.closest('.menu-wrap')) setMenu(false); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') setMenu(false); });
    setInterval(renderAll, 30000);

    renderAll();
})();

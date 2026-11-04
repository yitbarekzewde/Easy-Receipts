(function () {
    'use strict';

    var LOG_KEY = 'activityLog';
    var MAX_ENTRIES = 3000;
    var TRACKED_DATA = {
        p3_pos_snapshots: 'Saved receipts',
        p3_pos_drafts: 'Drafts',
        p3_saved_customers: 'Customers',
        p3_saved_stores: 'Stores',
        p3_stock_items: 'Stock items',
        p3_auto_prices: 'Price list'
    };
    var rawSetItem = Storage.prototype.setItem;
    var recent = {};
    var errorCount = 0;

    function read(key, fallback) {
        try {
            var value = JSON.parse(localStorage.getItem(key));
            return value == null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function identity() {
        var current = read('currentUser', null) || {};
        var profile = read('p3_user_profile', null) || {};
        var email = String(current.email || profile.email || '').trim().toLowerCase();
        var who = {
            userId: current.uid || '',
            email: email,
            username: current.username || profile.name || email,
            role: profile.role || ''
        };
        who.userCode = (window.UserCode && (who.email || who.userId)) ? window.UserCode.forUser(who) : '';
        return who;
    }

    function sessionId() {
        try {
            var id = sessionStorage.getItem('activitySessionId');
            if (!id) {
                id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
                sessionStorage.setItem('activitySessionId', id);
                sessionStorage.setItem('activitySessionNew', '1');
            }
            return id;
        } catch (error) {
            return 'no-session';
        }
    }

    function deviceLabel() {
        var ua = navigator.userAgent;
        var browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
        var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'Unknown OS';
        var mobile = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop';
        return browser + ' · ' + platform + ' · ' + mobile + ' · ' + screen.width + 'x' + screen.height;
    }

    function pageName() {
        var parts = location.pathname.split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : 'index.html';
    }

    function log(action, detail, receipt) {
        var who = identity();
        if (!who.email && !who.username) return;
        var signature = action + '|' + detail;
        var now = Date.now();
        if (recent[signature] && now - recent[signature] < 1000) return;
        recent[signature] = now;

        var entries = read(LOG_KEY, []);
        if (!Array.isArray(entries)) entries = [];
        var entry = {
            username: who.username,
            userId: who.userId,
            userCode: who.userCode,
            email: who.email,
            action: action,
            detail: String(detail || '').slice(0, 300),
            page: pageName(),
            sessionId: sessionId(),
            device: deviceLabel(),
            online: navigator.onLine,
            timestamp: new Date().toISOString()
        };
        if (receipt) entry.receipt = receipt;
        entries.push(entry);
        if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
        try {
            rawSetItem.call(localStorage, LOG_KEY, JSON.stringify(entries));
        } catch (error) {
            entries = entries.slice(Math.floor(entries.length / 2));
            try { rawSetItem.call(localStorage, LOG_KEY, JSON.stringify(entries)); } catch (ignored) { /* storage full */ }
        }
    }

    function countOf(raw) {
        try {
            var value = JSON.parse(raw);
            if (Array.isArray(value)) return value.length;
            if (value && typeof value === 'object') return Object.keys(value).length;
        } catch (error) { /* not JSON */ }
        return null;
    }

    function receiptSummary(ref, extra) {
        var info = { ref: ref || '', client: '', total: null, store: '' };
        var snapshots = read('p3_pos_snapshots', []);
        var match = Array.isArray(snapshots) && snapshots.filter(function (s) {
            return ref && (String(s.receiptRef) === String(ref) || String(s.id) === String(ref));
        })[0];
        if (match) {
            info.ref = match.receiptRef || String(match.id);
            info.client = match.client || '';
            info.total = Number(match.total);
            info.store = match.store || '';
        } else {
            var client = document.getElementById('client');
            info.client = client ? client.value.trim() : '';
            try { info.total = window.cartManager.calculateTotals().total; } catch (error) { /* no active cart */ }
        }
        if (!isFinite(info.total)) info.total = null;
        for (var key in extra) info[key] = extra[key];
        return info;
    }

    function receiptDetail(info) {
        return [info.ref || 'Unsaved receipt', info.client, info.total != null ? info.total.toFixed(2) : '', info.channel].filter(Boolean).join(' · ');
    }

    function logReceipt(action, ref, channel) {
        var info = receiptSummary(ref, { channel: channel });
        log(action, receiptDetail(info), info);
    }

    Storage.prototype.setItem = function (key, value) {
        var tracked = this === localStorage && TRACKED_DATA[key];
        var before = tracked ? countOf(localStorage.getItem(key)) : null;
        var previous = this === localStorage && key === 'p3_pos_snapshots' ? read(key, []) : null;
        rawSetItem.apply(this, arguments);
        if (tracked) {
            var after = countOf(value);
            if (before !== null && after !== null && before !== after) {
                log('Data Change', TRACKED_DATA[key] + ': ' + before + ' → ' + after);
            }
        }
        if (previous) {
            try {
                var known = {};
                (Array.isArray(previous) ? previous : []).forEach(function (s) { known[s.id] = 1; });
                JSON.parse(value).forEach(function (snapshot) {
                    // Receipt ids are creation timestamps, so older ones arriving here come from cloud sync, not this device.
                    if (!known[snapshot.id] && Date.now() - Number(snapshot.id) < 120000) {
                        var info = { ref: snapshot.receiptRef || String(snapshot.id), client: snapshot.client || '', total: isFinite(Number(snapshot.total)) ? Number(snapshot.total) : null, store: snapshot.store || '', channel: '' };
                        log('Receipt Saved', receiptDetail(info), info);
                    }
                });
            } catch (error) { /* value is not a receipt list */ }
        }
    };

    function currentRef() {
        var active = window.activeReceiptShareSnapshot;
        return active && active.payload ? active.payload.id : '';
    }
    function published() {
        return !!(window.activeReceiptShareSnapshot && window.activeReceiptShareSnapshot.saved);
    }
    function emailReady() {
        var input = document.getElementById('receiptEmailTo');
        return !!(input && input.checkValidity() && window.cartManager && window.cartManager.cart.length);
    }

    // Each entry: function name, activity, channel, and a condition that must hold for the action to really happen.
    var RECEIPT_ACTIONS = [
        ['downloadReceipt', 'Receipt Downloaded', 'PNG image'],
        ['downloadSavedReceipt', 'Receipt Downloaded', 'Saved receipt image', null, true],
        ['downloadReceiptText', 'Receipt Downloaded', 'Text file'],
        ['printReceiptOnly', 'Receipt Printed', 'Print'],
        ['shareReceiptAction', 'Receipt Shared', 'WhatsApp', published],
        ['shareReceiptTelegram', 'Receipt Shared', 'Telegram', published],
        ['shareReceiptPng', 'Receipt Shared', 'PNG image', published],
        ['shareReceiptPdf', 'Receipt Shared', 'PDF', published],
        ['shareReceiptNative', 'Receipt Shared', 'Text / share sheet'],
        ['shareReceiptText', 'Receipt Shared', 'Text / share sheet'],
        ['sendReceiptByEmail', 'Receipt Shared', 'Email', emailReady],
        ['copyReceiptLink', 'Receipt Copied', 'Link', published],
        ['copyReceiptText', 'Receipt Copied', 'Text']
    ];

    window.addEventListener('load', function () {
        RECEIPT_ACTIONS.forEach(function (spec) {
            var name = spec[0];
            var original = window[name];
            if (typeof original !== 'function' || original.__tracked) return;
            var wrapped = function () {
                try {
                    if (!spec[3] || spec[3]()) logReceipt(spec[1], spec[4] ? arguments[0] : currentRef(), spec[2]);
                } catch (error) { /* tracking must never block the action */ }
                return original.apply(this, arguments);
            };
            wrapped.__tracked = true;
            window[name] = wrapped;
        });
    });

    document.addEventListener('click', function (event) {
        var element = event.target.closest && event.target.closest('button, a, li[onclick], [role="button"], .bottom-nav-item');
        if (!element) return;
        var label = (element.getAttribute('aria-label') || element.title || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (label) log('Action', 'Clicked: ' + label);
    }, true);

    function reportError(message) {
        if (errorCount++ < 20) log('Error', message);
    }
    window.addEventListener('error', function (event) {
        var file = String(event.filename || '').split('/').pop();
        reportError((event.message || 'Script error') + (file ? ' @ ' + file + ':' + event.lineno : ''));
    });
    window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason;
        reportError('Unhandled: ' + (reason && reason.message ? reason.message : String(reason)));
    });
    window.addEventListener('offline', function () { log('Connectivity', 'Went offline'); });
    window.addEventListener('online', function () { log('Connectivity', 'Back online'); });

    var id = sessionId();
    try {
        if (sessionStorage.getItem('activitySessionNew')) {
            sessionStorage.removeItem('activitySessionNew');
            log('Session Start', 'New session ' + id.slice(0, 8));
        }
    } catch (error) { /* session storage unavailable */ }
    log('Page View', pageName());

    window.ActivityLog = { log: log, identity: identity };
})();

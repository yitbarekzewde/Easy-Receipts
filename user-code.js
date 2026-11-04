(function () {
    'use strict';

    var KEY = 'userCodes';

    function read() {
        try {
            var value = JSON.parse(localStorage.getItem(KEY));
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (error) {
            return {};
        }
    }

    function idKey(user) {
        return String((user && (user.email || user.uid || user.username)) || '').trim().toLowerCase();
    }

    // The same email always starts from the same code, so a user keeps one ID across browsers unless two users collide.
    function hash(text) {
        var h = 2166136261;
        for (var i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h;
    }

    function peek(user) {
        var key = idKey(user);
        return key ? read()[key] || '' : '';
    }

    function forUser(user) {
        var key = idKey(user);
        if (!key) return '';
        var map = read();
        if (map[key]) return map[key];
        var used = {};
        Object.keys(map).forEach(function (k) { used[map[k]] = true; });
        var start = hash(key) % 9000;
        for (var i = 0; i < 9000; i++) {
            var code = String(1000 + (start + i) % 9000);
            if (!used[code]) {
                map[key] = code;
                try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (error) { /* storage full */ }
                return code;
            }
        }
        return '';
    }

    window.UserCode = { forUser: forUser, peek: peek };
})();

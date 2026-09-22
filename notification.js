function msg(message, type = 'info') {
    const existing = document.getElementById('app-message');
    if (existing) existing.remove();
    const notice = document.createElement('div');
    notice.id = 'app-message';
    notice.textContent = message;
    notice.style.cssText = `position:fixed;top:20px;right:20px;z-index:1000000;max-width:360px;padding:12px 16px;border-radius:8px;color:#fff;background:${type === 'error' ? '#dc2626' : '#16a34a'};box-shadow:0 8px 20px rgba(15,23,42,.18);font:600 14px/1.4 sans-serif;`;
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 4000);
}

window.msg = msg;
window.alert = msg;

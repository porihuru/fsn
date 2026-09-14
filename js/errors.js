/* Error reporting must also work when localStorage is denied or full. */
var ErrorStore = (function () {
    var items = [];
    function add(source, message, detail) {
        var i, now = new Date().toISOString();
        for (i = 0; i < items.length; i += 1) {
            if (items[i].source === source && items[i].message === message && items[i].detail === (detail || '')) { items[i].count += 1; items[i].lastAt = now; return; }
        }
        items.unshift({ source: source, message: message, detail: detail || '', count: 1, createdAt: now, lastAt: now });
        items = items.slice(0, 100);
    }
    return { add: add, all: function () { return items.slice(); }, clear: function () { items = []; } };
}());
window.addEventListener('error', function (event) {
    ErrorStore.add('JavaScript', event.message || 'リソースを読み込めません。', event.filename ? event.filename.split('?')[0] + ':' + event.lineno : '');
});
function checkBrowserCompatibility() {
    var ua = navigator.userAgent, edge = /Edg\/(\d+)/.exec(ua), fatal = false, provider = window.crypto || window.msCrypto, key = 'fsn_storage_probe';
    if (document.documentMode && document.documentMode !== 11) { ErrorStore.add('ブラウザ互換性', 'IE11標準モードが必要です。互換表示を解除してください。'); fatal = true; }
    if (!document.documentMode && (!edge || +edge[1] < 95)) { ErrorStore.add('ブラウザ互換性', '動作対象外です。Edge 95以降またはIE11標準モードを使用してください。', ua); }
    if (document.documentMode === 11) { ErrorStore.add('ブラウザ互換性', 'IE11互換モード：暗号処理に時間がかかります。SharePoint製品側の対応可否も確認してください。'); }
    if (!provider || !provider.getRandomValues || !window.XMLHttpRequest || !window.JSON || !StickyCrypto.available()) { ErrorStore.add('ブラウザ互換性', '必要な通信・暗号機能を利用できません。'); fatal = true; }
    try { var prior = window.localStorage.getItem(key); window.localStorage.setItem(key, 'test'); if (prior === null) { window.localStorage.removeItem(key); } else { window.localStorage.setItem(key, prior); } }
    catch (e) { ErrorStore.add('端末保存', 'localStorageを使用できません。ブラウザの保存許可を確認してください。'); fatal = true; }
    if (APP_CONFIG.USE_SHAREPOINT) {
        var anchor = document.createElement('a'); anchor.href = APP_CONFIG.SHAREPOINT_BASE_URL;
        if (!/^https?:\/\//.test(APP_CONFIG.SHAREPOINT_BASE_URL) || /[?#]/.test(APP_CONFIG.SHAREPOINT_BASE_URL)) { ErrorStore.add('SharePoint設定', 'サイトURLを http(s):// から入力してください。クエリや # は指定できません。'); fatal = true; }
        if (window.location.protocol === 'file:' || anchor.protocol !== window.location.protocol || anchor.host !== window.location.host) { ErrorStore.add('SharePoint設定', 'HTMLの配置先とSharePointが別オリジンです。認証・CORS設定が必要です。'); }
        if (anchor.protocol === 'http:') { ErrorStore.add('SharePoint設定', 'HTTPでは通信を暗号化できません。実データを扱う前にHTTPSを設定してください。'); }
    }
    return !fatal;
}
function renderErrors() {
    var box = document.getElementById('error-list'), rows = ErrorStore.all();
    if (box) { box.innerHTML = rows.map(function (r) { return '<div class="notification-row"><div><strong>' + Util.esc(r.source + '：' + r.message) + '</strong><p>' + Util.esc(r.detail) + '</p><small>' + Util.esc(r.lastAt) + '（' + r.count + '回）</small></div></div>'; }).join('') || '<p>エラーはありません。</p>'; }
}

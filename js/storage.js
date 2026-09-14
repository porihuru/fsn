/* Never silently replace corrupt data with an empty collection. */
var Storage = {
    get: function (key, fallback) {
        var value;
        try { value = window.localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }
        catch (e) { throw new Error('端末保存を読み込めません（' + key + '）。元データを消さず、ブラウザ設定を確認してください。'); }
    },
    set: function (key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); }
        catch (e) { throw new Error('端末保存に失敗しました。空き容量・保存許可を確認してください。'); }
    },
    remove: function (key) { window.localStorage.removeItem(key); }
};
var Audit = {
    log: function (action, relatedId) {
        var user = Session.user(), items;
        if (!user) { return; }
        try {
            items = this.all();
            items.unshift({ action: action, detail: relatedId || '', userId: user.userId, deviceId: Session.deviceId(), createdAt: new Date().toISOString() });
            Storage.set('fsn_audit_' + user.userId, items.slice(0, 500));
        } catch (e) { ErrorStore.add('監査ログ', Util.message(e)); }
    },
    all: function () { var user = Session.user(); return user ? Storage.get('fsn_audit_' + user.userId, []) : []; }
};

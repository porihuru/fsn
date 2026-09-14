/* The unlocked private key and token exist only in this page's memory. */
var Session = (function () {
    'use strict';
    var current = null, currentUser = null, privateKey = null;
    function user() { return currentUser; }
    function deviceId() { var id = Storage.get('fsn_device_id', null); if (!id) { id = Util.uid(); Storage.set('fsn_device_id', id); } return id; }
    function clear() { current = null; currentUser = null; privateKey = null; }
    function start(row, key, callback) {
        var token = Util.uid() + Util.uid(), now = new Date().toISOString(), expires = new Date(new Date().getTime() + 8 * 3600000).toISOString(), hash = Util.hash(token), device;
        try { device = deviceId(); } catch (e) { callback(e); return; }
        Records.save(APP_CONFIG.LIST_SESSIONS, null, { Title: 'session', UserId: row.StickyUserId, DeviceId: device, TokenHash: hash, CreatedAt: now, LastAccessAt: now, ExpiresAt: expires, Revoked: false, UserAgent: navigator.userAgent }, function (error, session) {
            if (error) { callback(error); return; }
            Records.save(APP_CONFIG.LIST_USERS, row, { CurrentSessionHash: hash, CurrentDeviceId: device, LastLoginAt: now }, function (e, saved) {
                if (e) { Records.remove(APP_CONFIG.LIST_SESSIONS, session, function (cleanup) { if (cleanup) { ErrorStore.add('セッション後始末', Util.message(cleanup)); } callback(e); }); return; }
                current = { token: token, expiresAt: expires, row: session };
                currentUser = saved; currentUser.userId = saved.StickyUserId; currentUser.displayName = saved.DisplayName; currentUser.organization = saved.Organization; currentUser.publicKey = saved.PublicKey;
                privateKey = key; Audit.log('LOGIN', ''); callback(null, currentUser);
            });
        });
    }
    function guard(callback) {
        var captured = current, actor = currentUser;
        if (!captured || !actor || !privateKey || new Date(captured.expiresAt).getTime() <= new Date().getTime()) { callback(new Error('ログインの有効期限が切れています。再ログインしてください。')); return; }
        Records.get(APP_CONFIG.LIST_USERS, actor.Id, function (error, row) {
            if (!error && (captured !== current || row.Enabled !== true || row.CurrentSessionHash !== Util.hash(captured.token))) { error = new Error('別のログインまたは利用者の無効化を検出しました。再ログインしてください。'); }
            if (error) { callback(error); return; }
            Records.get(APP_CONFIG.LIST_SESSIONS, captured.row.Id, function (e, session) {
                if (!e && (captured !== current || session.Revoked || session.TokenHash !== Util.hash(captured.token) || new Date(session.ExpiresAt).getTime() <= new Date().getTime())) { e = new Error('セッションが無効です。再ログインしてください。'); }
                if (!e) { currentUser = row; currentUser.userId = row.StickyUserId; currentUser.displayName = row.DisplayName; currentUser.organization = row.Organization; currentUser.publicKey = row.PublicKey; }
                callback(e || null);
            });
        });
    }
    function logout(callback) {
        var captured = current;
        if (!captured) { clear(); callback(null); return; }
        Audit.log('LOGOUT', '');
        Records.get(APP_CONFIG.LIST_SESSIONS, captured.row.Id, function (error, row) {
            if (error) { clear(); callback(error); return; }
            Records.save(APP_CONFIG.LIST_SESSIONS, row, { Revoked: true }, function (e) { clear(); callback(e); });
        });
    }
    return { user: user, start: start, guard: guard, clear: clear, logout: logout, deviceId: deviceId,
        key: function () { if (!privateKey) { throw new Error('秘密鍵がロックされています。'); } return privateKey; },
        token: function () { return current && current.token; }
    };
}());

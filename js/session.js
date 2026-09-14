/* Live keys are kept in memory. Opt-in resume data is managed by TrustedDevice. */
var Session = (function () {
    'use strict';
    var current = null, currentUser = null, privateKey = null, generation = 0, rememberWarning = '';
    function user() { return currentUser; }
    function deviceId() { var id = Storage.get('fsn_device_id', null); if (!id) { id = Util.uid(); Storage.set('fsn_device_id', id); } return id; }
    function clear() { current = null; currentUser = null; privateKey = null; generation += 1; }
    function setUser(row) {
        currentUser = row; currentUser.userId = row.StickyUserId; currentUser.displayName = row.DisplayName;
        currentUser.organization = row.Organization; currentUser.publicKey = row.PublicKey;
    }
    function activate(row, session, token, key) {
        current = { token: token, expiresAt: session.ExpiresAt, row: session }; setUser(row); privateKey = key;
    }
    function start(row, key, callback, options) {
        try { if (Recovery.isTemporary(row)) { throw new Error('仮パスワードでは通常画面を開けません。新しいパスワードへ変更してください。'); } }
        catch (temporaryError) { callback(temporaryError); return; }
        var remember = !!(options && options.remember), epoch = ++generation;
        var token = Util.uid() + Util.uid(), now = new Date().toISOString(), expires = new Date(new Date().getTime() + (remember ? TrustedDevice.DAYS * 24 : 8) * 3600000).toISOString(), hash = Util.hash(token), device;
        rememberWarning = '';
        try { device = deviceId(); TrustedDevice.forget(); } catch (e) { callback(e); return; }
        Records.save(APP_CONFIG.LIST_SESSIONS, null, { Title: 'session', UserId: row.StickyUserId, DeviceId: device, TokenHash: hash, CreatedAt: now, LastAccessAt: now, ExpiresAt: expires, Revoked: false, UserAgent: navigator.userAgent }, function (error, session) {
            if (error) { callback(error); return; }
            if (epoch !== generation) { callback(new Error('ログイン操作が変更されました。再試行してください。')); return; }
            Records.save(APP_CONFIG.LIST_USERS, row, { CurrentSessionHash: hash, CurrentDeviceId: device, LastLoginAt: now }, function (e, saved) {
                if (e) { Records.remove(APP_CONFIG.LIST_SESSIONS, session, function (cleanup) { if (cleanup) { ErrorStore.add('セッション後始末', Util.message(cleanup)); } callback(e); }); return; }
                if (epoch !== generation) { callback(new Error('ログイン操作が変更されました。再試行してください。')); return; }
                activate(saved, session, token, key);
                if (remember) {
                    try { TrustedDevice.save(saved, session, token, key); }
                    catch (storageError) { rememberWarning = 'ログインしましたが端末保存に失敗しました。次回はパスワードが必要です。'; ErrorStore.add('自動ログイン', rememberWarning); }
                }
                Audit.log('LOGIN', ''); callback(null, currentUser);
            });
        });
    }
    function restore(callback) {
        var saved, epoch = ++generation;
        if (currentUser) { callback(null, currentUser); return; }
        function fail(error) {
            if (epoch === generation) {
                try { TrustedDevice.forget(saved && saved.token); } catch (e) { ErrorStore.add('端末保存解除', Util.message(e)); }
                clear();
            }
            callback(error);
        }
        function stale() { return epoch !== generation; }
        try {
            saved = TrustedDevice.load();
            if (!saved) { callback(null, null); return; }
            TrustedDevice.validate(saved);
            if (Storage.get('fsn_device_id', null) !== saved.deviceId) { throw new Error('端末情報が変わりました。パスワードでログインしてください。'); }
        } catch (e) { fail(e); return; }
        function check(identity) {
            Records.get(APP_CONFIG.LIST_USERS, saved.userRowId, function (error, row) {
                if (stale()) { callback(new Error('自動ログインを中止しました。')); return; }
                if (error) { fail(error); return; }
                var temporary;
                try { temporary = Recovery.isTemporary(row); } catch (parseError) { fail(parseError); return; }
                if (temporary || row.Enabled !== true || row.StickyUserId !== saved.userId || row.LoginName !== saved.loginName ||
                        row.CurrentSessionHash !== Util.hash(saved.token) || row.CurrentDeviceId !== saved.deviceId ||
                        TrustedDevice.stamp(row) !== saved.stamp ||
                        APP_CONFIG.USE_SHAREPOINT && (!identity || identity.LoginName !== row.LoginName || String(identity.Id) !== row.SharePointUserId)) {
                    fail(new Error('保存したログイン情報は無効です。アカウント変更・別のログイン・パスワード変更等を確認してください。')); return;
                }
                Records.get(APP_CONFIG.LIST_SESSIONS, saved.sessionId, function (e, session) {
                    if (stale()) { callback(new Error('自動ログインを中止しました。')); return; }
                    if (e) { fail(e); return; }
                    if (session.Revoked !== false || session.UserId !== saved.userId || session.DeviceId !== saved.deviceId ||
                            session.TokenHash !== Util.hash(saved.token) || session.ExpiresAt !== saved.expiresAt ||
                            !isFinite(new Date(session.ExpiresAt).getTime()) || new Date(session.ExpiresAt).getTime() <= new Date().getTime()) {
                        fail(new Error('自動ログインの期限が切れているか、ログアウト済みです。')); return;
                    }
                    var key;
                    try { key = TrustedDevice.unlock(saved, row.PublicKey); } catch (decryptError) { fail(decryptError); return; }
                    activate(row, session, saved.token, key); rememberWarning = '';
                    Audit.log('AUTO_LOGIN', ''); callback(null, currentUser);
                });
            });
        }
        if (APP_CONFIG.USE_SHAREPOINT) {
            SharePoint.getCurrentUser(function (error, identity) { if (stale()) { callback(new Error('自動ログインを中止しました。')); return; } if (error) { fail(error); return; } check(identity); });
        } else { check(null); }
    }
    function guard(callback) {
        var captured = current, actor = currentUser;
        if (!captured || !actor || !privateKey || !isFinite(new Date(captured.expiresAt).getTime()) || new Date(captured.expiresAt).getTime() <= new Date().getTime()) { callback(new Error('ログインの有効期限が切れています。再ログインしてください。')); return; }
        Records.get(APP_CONFIG.LIST_USERS, actor.Id, function (error, row) {
            if (!error && (captured !== current || row.Enabled !== true || row.CurrentSessionHash !== Util.hash(captured.token))) { error = new Error('別のログインまたは利用者の無効化を検出しました。再ログインしてください。'); }
            if (error) { callback(error); return; }
            Records.get(APP_CONFIG.LIST_SESSIONS, captured.row.Id, function (e, session) {
                if (!e && (captured !== current || session.Revoked !== false || session.UserId !== actor.userId || session.TokenHash !== Util.hash(captured.token) || !isFinite(new Date(session.ExpiresAt).getTime()) || new Date(session.ExpiresAt).getTime() <= new Date().getTime())) { e = new Error('セッションが無効です。再ログインしてください。'); }
                if (!e) { setUser(row); }
                callback(e || null);
            });
        });
    }
    function forgetDevice(callback) {
        guard(function (error) {
            if (error) { callback(error); return; }
            /* Rotate the live token too, so a copied resume record stops working. */
            start(currentUser, privateKey, function (e) { if (!e) { Audit.log('FORGET_DEVICE', ''); } callback(e); }, { remember: false });
        });
    }
    function rememberedUntil() {
        try { var saved = TrustedDevice.load(); return current && saved && saved.token === current.token ? saved.expiresAt : ''; }
        catch (e) { return ''; }
    }
    function logout(callback) {
        var captured = current, localError = null;
        try { TrustedDevice.forget(captured && captured.token); } catch (e) { localError = e; ErrorStore.add('端末保存解除', Util.message(e)); }
        if (!captured) { clear(); callback(localError); return; }
        Audit.log('LOGOUT', '');
        /* Drop live and persistent credentials immediately, even if the network fails. */
        clear();
        Records.get(APP_CONFIG.LIST_SESSIONS, captured.row.Id, function (error, row) {
            if (error) { callback(error); return; }
            Records.save(APP_CONFIG.LIST_SESSIONS, row, { Revoked: true }, function (e) { callback(e || localError); });
        });
    }
    return { user: user, start: start, restore: restore, guard: guard, clear: clear, logout: logout, deviceId: deviceId, forgetDevice: forgetDevice, rememberedUntil: rememberedUntil,
        rememberWarning: function () { return rememberWarning; },
        key: function () { if (!privateKey) { throw new Error('秘密鍵がロックされています。'); } return privateKey; },
        token: function () { return current && current.token; }
    };
}());

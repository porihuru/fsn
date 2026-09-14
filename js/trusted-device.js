/* Opt-in convenience credential, NOT a secure OS password vault.
 * The wrapping key is derivable from the locally stored token. Anyone who can
 * read this browser's storage (including same-origin JavaScript) can unlock it.
 * The application password is never persisted. Server checks precede restore.
 */
var TrustedDevice = (function () {
    'use strict';
    var days = 30;
    function scope() {
        return APP_CONFIG.USE_SHAREPOINT ? 'sp:' + String(APP_CONFIG.SHAREPOINT_BASE_URL).replace(/\/+$/, '') : 'local';
    }
    function storageKey() { return 'fsn_trusted_device_' + encodeURIComponent(scope()); }
    function credentialStamp(row) { return Util.hash(JSON.stringify([row.PasswordHash, row.PublicKey, row.EncryptedPrivateKey])); }
    function wrappingKey(token) { return forge.md.sha256.create().update('fsn-device-v1:' + token, 'utf8').digest().getBytes(); }
    function load() { return Storage.get(storageKey(), null); }
    function forget(expectedToken) {
        /* A stale tab must not erase a newer login's remembered credential. */
        if (expectedToken) { var saved = load(); if (saved && saved.token !== expectedToken) { return; } }
        Storage.remove(storageKey());
    }
    function save(row, session, token, privateKey) {
        var saved = { version: 1, scope: scope(), userId: row.StickyUserId, userRowId: row.Id, loginName: row.LoginName,
            deviceId: session.DeviceId, sessionId: session.Id, token: token, expiresAt: session.ExpiresAt, stamp: credentialStamp(row),
            privateKey: StickyCrypto.encryptJson({ privateKey: privateKey }, wrappingKey(token)) };
        Storage.set(storageKey(), saved);
    }
    function validate(saved) {
        if (!saved || saved.version !== 1 || saved.scope !== scope() || !/^[a-f0-9]{64}$/.test(saved.token) ||
                !/^\d+$/.test(String(saved.userRowId)) || !/^\d+$/.test(String(saved.sessionId)) ||
                !saved.userId || !saved.deviceId || !saved.stamp || !saved.privateKey ||
                !isFinite(new Date(saved.expiresAt).getTime())) { throw new Error('端末ログイン情報が不正です。パスワードでログインしてください。'); }
        if (new Date(saved.expiresAt).getTime() <= new Date().getTime()) { throw new Error('自動ログインの保存期限が切れました。パスワードでログインしてください。'); }
    }
    function unlock(saved, publicKey) {
        var value = StickyCrypto.decryptJson(saved.privateKey, wrappingKey(saved.token)), key, publicPart;
        key = forge.pki.privateKeyFromPem(value.privateKey); publicPart = forge.pki.publicKeyFromPem(publicKey);
        if (key.n.compareTo(publicPart.n) !== 0 || key.e.compareTo(publicPart.e) !== 0) { throw new Error('端末の秘密鍵と登録された公開鍵が一致しません。'); }
        return value.privateKey;
    }
    return { DAYS: days, load: load, save: save, forget: forget, validate: validate, unlock: unlock, stamp: credentialStamp };
}());

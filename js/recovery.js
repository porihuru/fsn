/* Administrator escrow of the EXISTING user key; no key rotation on reset. */
var Recovery = (function () {
    'use strict';
    var settingsId = '__fsn:admin-recovery:v1', storedSettings = null, settingUp = false;
    function publicKey() { return storedSettings ? storedSettings.PublicKey : Util.trim(APP_CONFIG.RECOVERY_PUBLIC_KEY || ''); }
    function fingerprint(pem) { return forge.pki.getPublicKeyFingerprint(forge.pki.publicKeyFromPem(pem), { md: forge.md.sha256.create(), encoding: 'hex' }); }
    function configured() {
        var pem = publicKey();
        if (!pem) { return false; }
        if (forge.pki.publicKeyFromPem(pem).n.bitLength() < 2048) { throw new Error('管理者復旧鍵はRSA 2048ビット以上が必要です。'); }
        return true;
    }
    /* A disabled system row reuses the existing list; it is never a login user.
     * Concurrent first-time creates use the lowest SharePoint item ID. Later
     * candidates never replace that key, even without a unique-column setting. */
    function load(callback) {
        storedSettings = null;
        Records.list(APP_CONFIG.LIST_USERS, 'StickyUserId eq ' + SharePoint.literal(settingsId), function (r) { return r.StickyUserId === settingsId; }, function (error, rows) {
            if (error) { callback(error); return; }
            var row, file, legacy = Util.trim(APP_CONFIG.RECOVERY_PUBLIC_KEY || '');
            try {
                if (!rows.length) { callback(null, null); return; }
                rows.sort(function (a, b) { return Number(a.Id) - Number(b.Id); }); row = rows[0];
                file = JSON.parse(row.EncryptedPrivateKey);
                if (row.Title !== 'fsn-admin-recovery-v1' || row.Enabled !== false || file.version !== 'FSN-ADMIN-KEY-V1' || !file.material ||
                        file.material.publicKey !== row.PublicKey || !file.material.privateKeyPayload || !file.material.privateKeySalt ||
                        forge.pki.publicKeyFromPem(row.PublicKey).n.bitLength() < 2048) { throw new Error('管理者設定が破損しています。設定行を削除・再作成せず、管理者に確認してください。'); }
                if (legacy && fingerprint(legacy) !== fingerprint(row.PublicKey)) { throw new Error('以前の復旧鍵設定と保存済みの管理者設定が一致しません。鍵を上書きせず確認してください。'); }
                storedSettings = row;
            } catch (e) { callback(e); return; }
            callback(null, row);
        });
    }
    function setup(password, confirmation, callback) {
        if (settingUp) { callback(new Error('管理者パスワードを登録中です。')); return; }
        if (!password || password.length < 12 || password !== confirmation) { callback(new Error('管理者パスワードは12文字以上で、確認欄と一致させてください。')); return; }
        settingUp = true;
        function done(error, result) { settingUp = false; password = ''; confirmation = ''; callback(error, result); }
        function unconfigured(next) {
            load(function (error, row) {
                if (error) { next(error); return; }
                if (row || publicKey()) { next(new Error('管理者設定は登録済みです。既存の復旧鍵は上書きしません。')); return; }
                next(null);
            });
        }
        admin(function (error, operator) {
            if (error) { done(error); return; }
            unconfigured(function (loadError) {
                if (loadError) { done(loadError); return; }
                CryptoJobs.run({ operation: 'create', password: password }, function (cryptoError, value) {
                    password = ''; confirmation = '';
                    if (cryptoError) { done(cryptoError); return; }
                    /* Only the password-encrypted material is persisted. */
                    value.privateKey = '';
                    admin(function (permissionError, currentOperator) {
                        if (permissionError || currentOperator.Id !== operator.Id || currentOperator.LoginName !== operator.LoginName) { done(permissionError || new Error('操作中に管理者アカウントが変わりました。')); return; }
                        unconfigured(function (changedError) {
                            if (changedError) { done(changedError); return; }
                            var fields = { Title: 'fsn-admin-recovery-v1', StickyUserId: settingsId, LoginName: '', SharePointUserId: '',
                                DisplayName: '管理者復旧設定（削除しないでください）', Organization: '', Enabled: false,
                                PublicKey: value.material.publicKey, EncryptedPrivateKey: JSON.stringify({ version: 'FSN-ADMIN-KEY-V1', material: value.material }), CryptoVersion: StickyCrypto.VERSION };
                            Records.save(APP_CONFIG.LIST_USERS, null, fields, function (saveError, saved) {
                                if (saveError) { done(saveError); return; }
                                load(function (verifyError, active) {
                                    if (verifyError) { done(verifyError); return; }
                                    if (!active || String(active.Id) !== String(saved.Id) || active.EncryptedPrivateKey !== fields.EncryptedPrivateKey) { done(new Error('別の管理者設定が先に保存されました。このパスワードは登録されていません。先に登録した管理者へ確認してください。')); return; }
                                    done(null, active);
                                });
                            });
                        });
                    });
                });
            });
        });
    }
    function resetStored(userId, password, callback) {
        admin(function (error) {
            if (error) { callback(error); return; }
            load(function (loadError, row) {
                if (loadError) { callback(loadError); return; }
                if (!row) { callback(new Error('管理者パスワードが未登録です。初回登録を行ってください。')); return; }
                reset(userId, row.EncryptedPrivateKey, password, callback);
            });
        });
    }
    function attach(material, privateKey, userId) {
        if (!configured()) { return material; }
        if (!StickyCrypto.keyMatches(privateKey, material.publicKey)) { throw new Error('利用者の鍵が一致しません。'); }
        var key = StickyCrypto.generateContentKey();
        material.recovery = { version: 1, keyId: fingerprint(publicKey()), userId: userId,
            wrappedKey: StickyCrypto.encryptKeyForRecipient(key, publicKey()),
            payload: StickyCrypto.encryptJson({ userId: userId, publicKey: material.publicKey, privateKey: privateKey }, key) };
        return material;
    }
    function ensure(row, privateKey, callback) {
        var material, updated;
        try {
            if (!configured()) { callback(null, row); return; }
            material = JSON.parse(row.EncryptedPrivateKey);
            if (material.recovery && material.recovery.keyId === fingerprint(publicKey()) && material.recovery.userId === row.StickyUserId) { callback(null, row); return; }
            /* Keep the old escrow on configuration mismatch; rotation is a separate operation. */
            if (material.recovery) { throw new Error('登録済みの管理者復旧鍵と設定が異なります。復旧鍵を上書きせず管理者に確認してください。'); }
            updated = attach(material, privateKey, row.StickyUserId);
        } catch (e) { callback(e); return; }
        Records.save(APP_CONFIG.LIST_USERS, row, { EncryptedPrivateKey: JSON.stringify(updated) }, callback);
    }
    function recover(row, adminPrivateKey) {
        var material = JSON.parse(row.EncryptedPrivateKey), escrow = material.recovery, value, key;
        if (!configured() || !escrow || escrow.version !== 1) { throw new Error('管理者復旧が未登録です。本人の正常ログインが必要です。既存データは変更しません。'); }
        if (escrow.keyId !== fingerprint(publicKey()) || escrow.userId !== row.StickyUserId) { throw new Error('復旧鍵または利用者IDが一致しません。'); }
        key = StickyCrypto.decryptRecipientKey(escrow.wrappedKey, adminPrivateKey);
        value = StickyCrypto.decryptJson(escrow.payload, key);
        if (value.userId !== row.StickyUserId || value.publicKey !== row.PublicKey || !StickyCrypto.keyMatches(value.privateKey, row.PublicKey)) { throw new Error('復旧された秘密鍵が対象利用者と一致しません。'); }
        return value.privateKey;
    }
    function admin(callback) {
        if (!APP_CONFIG.USE_SHAREPOINT) { callback(null, { Id: 0, LoginName: 'local-key-holder' }); return; }
        if (window.location.protocol !== 'https:') { callback(new Error('管理者初期化はHTTPSで配信されたページから実行してください。')); return; }
        SharePoint.getCurrentUser(function (error, identity) {
            if (error) { callback(error); return; }
            if (!identity || identity.IsSiteAdmin !== true) { callback(new Error('SharePointサイトコレクション管理者だけが初期化できます。')); return; }
            callback(null, identity);
        });
    }
    function isTemporary(row) { return JSON.parse(row.EncryptedPrivateKey).mustChangePassword === true; }
    function checkTemporary(row) {
        var material = JSON.parse(row.EncryptedPrivateKey), time = new Date(material.temporaryExpiresAt).getTime();
        if (material.mustChangePassword && (!isFinite(time) || time <= new Date().getTime())) { throw new Error('仮パスワードの期限が切れています。管理者に再発行を依頼してください。'); }
        return !!material.mustChangePassword;
    }
    function reset(userId, keyFile, keyPassword, callback) {
        if (!keyPassword || !userId) { callback(new Error('対象の利用者IDと管理者復旧鍵のパスワードを入力してください。')); return; }
        admin(function (error, operator) {
            if (error) { callback(error); return; }
            var file;
            try {
                if (!configured()) { throw new Error('管理者復旧用の公開鍵が未設定です。'); }
                file = JSON.parse(keyFile);
                if (file.version !== 'FSN-ADMIN-KEY-V1' || !file.material || fingerprint(file.material.publicKey) !== fingerprint(publicKey())) { throw new Error('このアプリの管理者復旧鍵ファイルではありません。'); }
            } catch (e) { callback(e); return; }
            Records.list(APP_CONFIG.LIST_USERS, 'StickyUserId eq ' + SharePoint.literal(userId), function (r) { return r.StickyUserId === userId; }, function (lookupError, rows) {
                if (lookupError) { callback(lookupError); return; }
                if (rows.length !== 1 || rows[0].Enabled !== true) { callback(new Error('有効な利用者を一意に特定できません。')); return; }
                var row = rows[0];
                /* Compute in a local worker; no passwords or private keys go into requests/logs. */
                CryptoJobs.run({ operation: 'adminReset', password: keyPassword, adminMaterial: file.material, target: row, recoveryPublicKey: publicKey() }, function (cryptoError, generated) {
                    if (cryptoError) { callback(cryptoError); return; }
                    admin(function (permissionError, currentOperator) {
                        if (permissionError || currentOperator.LoginName !== operator.LoginName || currentOperator.Id !== operator.Id) { callback(permissionError || new Error('操作中に管理者アカウントが変わりました。')); return; }
                        var fields = { PasswordHash: JSON.stringify(generated.record), PasswordSalt: generated.record.salt,
                            EncryptedPrivateKey: JSON.stringify(generated.material), CurrentSessionHash: '', CurrentDeviceId: '' };
                        Records.save(APP_CONFIG.LIST_USERS, row, fields, function (saveError) {
                            if (saveError) { callback(saveError); return; }
                            try {
                                var log = Storage.get('fsn_admin_reset_audit', []);
                                log.unshift({ action: 'ADMIN_PASSWORD_RESET', userId: userId, operator: operator.LoginName, createdAt: new Date().toISOString() });
                                Storage.set('fsn_admin_reset_audit', log.slice(0, 100));
                            } catch (auditError) { ErrorStore.add('管理者初期化', '初期化は成功しましたが端末の操作履歴を保存できません。'); }
                            callback(null, { userId: userId, displayName: row.DisplayName, temporaryPassword: generated.temporaryPassword, expiresAt: generated.material.temporaryExpiresAt });
                        });
                    });
                });
            });
        });
    }
    return { publicKey: publicKey, configured: configured, fingerprint: fingerprint, load: load, setup: setup, resetStored: resetStored, attach: attach, ensure: ensure, recover: recover, admin: admin, reset: reset, isTemporary: isTemporary, checkTemporary: checkTemporary };
}());

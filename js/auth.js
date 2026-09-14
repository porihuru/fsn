var Auth = (function () {
    'use strict';
    var pendingReset = null;
    function profile(name, organization) {
        if (!Util.trim(name) || Util.trim(name).length > 100) { throw new Error('名前を1～100文字で入力してください。'); }
        if (!/^[A-Za-z0-9]{1,64}$/.test(organization)) { throw new Error('部署名は半角英数字1～64文字で入力してください。'); }
    }
    function directory(callback) { Records.list(APP_CONFIG.LIST_USERS, 'Enabled eq 1', function (r) { return r.Enabled === true; }, callback); }
    function login(input, callback) {
        pendingReset = null;
        var loginId = Util.trim(input.id), password = input.password;
        if (!password || !loginId && !APP_CONFIG.USE_SHAREPOINT) { callback(new Error('ユーザーIDとパスワードを入力してください。')); return; }
        if (!APP_CONFIG.USE_SHAREPOINT && !/^[A-Za-z0-9_.@-]{1,100}$/.test(loginId)) { callback(new Error('ユーザーIDは半角英数字と _ . @ - で入力してください。')); return; }
        function lookup(identity) {
            var field = APP_CONFIG.USE_SHAREPOINT ? 'LoginName' : 'StickyUserId', value = identity.LoginName || loginId;
            Records.list(APP_CONFIG.LIST_USERS, field + ' eq ' + SharePoint.literal(value), function (r) { return r[field] === value; }, function (error, rows) {
                if (error) { callback(error); return; }
                if (rows.length > 1) { callback(new Error('利用者が重複登録されています。管理者に確認してください。')); return; }
                if (rows.length) {
                    var row = rows[0], record, material, key;
                    if (input.register) { callback(new Error('登録済みです。新規登録のチェックを外してログインしてください。')); return; }
                    if (!row.Enabled) { callback(new Error('この利用者は無効です。')); return; }
                    try {
                        record = JSON.parse(row.PasswordHash); material = JSON.parse(row.EncryptedPrivateKey);
                        if (!StickyCrypto.verifyPassword(password, record)) { throw new Error('ユーザーIDまたはパスワードが違います。'); }
                        Recovery.checkTemporary(row);
                        key = StickyCrypto.unlockUserPrivateKey(password, material);
                        if (material.publicKey !== row.PublicKey) { throw new Error('公開鍵と秘密鍵の登録が一致しません。'); }
                    } catch (e) { callback(e); return; }
                    if (material.mustChangePassword) {
                        try { TrustedDevice.forget(); } catch (forgetError) { callback(forgetError); return; }
                        Session.clear();
                        pendingReset = { row: row, key: key, expiresAt: new Date().getTime() + 10 * 60000 };
                        callback(null, { requirePasswordChange: true }); return;
                    }
                    Recovery.ensure(row, key, function (recoveryError, enrolled) {
                        if (recoveryError) { ErrorStore.add('管理者復旧登録', Util.message(recoveryError), 'ログインは継続できますが、管理者初期化への対応を確認してください。'); }
                        Session.start(enrolled || row, key, callback, { remember: !!input.remember });
                    });
                } else {
                    if (!input.register) { callback(new Error('未登録です。新規登録を選び、名前・部署・確認用パスワードを入力してください。')); return; }
                    try {
                        profile(input.name, input.organization);
                        if (password.length < 10 || password !== input.confirm) { throw new Error('パスワードは10文字以上とし、確認欄と一致させてください。'); }
                        var created = StickyCrypto.createPasswordRecord(password), keys = StickyCrypto.createUserKeyMaterial(password);
                        var fields = { Title: 'user', StickyUserId: APP_CONFIG.USE_SHAREPOINT ? 'sp-' + identity.Id : loginId, SharePointUserId: String(identity.Id || ''), LoginName: value, DisplayName: Util.trim(input.name), Organization: input.organization, PasswordHash: JSON.stringify(created), PasswordSalt: created.salt, PublicKey: keys.publicKey, EncryptedPrivateKey: JSON.stringify(keys), CryptoVersion: StickyCrypto.VERSION, Enabled: true };
                        var privateKey = StickyCrypto.unlockUserPrivateKey(password, keys);
                        Recovery.attach(keys, privateKey, fields.StickyUserId);
                        fields.EncryptedPrivateKey = JSON.stringify(keys);
                    } catch (e2) { callback(e2); return; }
                    Records.save(APP_CONFIG.LIST_USERS, null, fields, function (e, row2) {
                        if (e) { callback(e); return; }
                        Session.start(row2, privateKey, function (sessionError, user) {
                            if (sessionError) { callback(sessionError); return; }
                            syncGroup(function (groupError) { if (groupError) { ErrorStore.add('部署同期', Util.message(groupError), '利用者の部署は登録済みです。設定から再同期できます。'); } callback(null, user); });
                        }, { remember: !!input.remember });
                    });
                }
            });
        }
        Recovery.load(function (settingsError) {
            if (settingsError) { callback(settingsError); return; }
            if (APP_CONFIG.USE_SHAREPOINT) { SharePoint.getCurrentUser(function (error, user) { if (error) { callback(error); return; } lookup(user); }); }
            else { lookup({}); }
        });
    }
    function completeReset(password, confirmation, callback) {
        var pending = pendingReset;
        if (!pending || pending.expiresAt <= new Date().getTime()) { pendingReset = null; callback(new Error('変更手続きの期限が切れました。仮パスワードでもう一度ログインしてください。')); return; }
        try {
            if (password.length < 10 || password !== confirmation) { throw new Error('新しいパスワードは10文字以上で、確認欄と一致させてください。'); }
            if (StickyCrypto.verifyPassword(password, JSON.parse(pending.row.PasswordHash))) { throw new Error('仮パスワードとは異なるパスワードを指定してください。'); }
        } catch (e) { callback(e); return; }
        function change(identity) {
            Records.get(APP_CONFIG.LIST_USERS, pending.row.Id, function (error, row) {
                if (pendingReset !== pending) { callback(new Error('パスワード変更を中止しました。')); return; }
                if (error) { callback(error); return; }
                try {
                    if (!row.Enabled || TrustedDevice.stamp(row) !== TrustedDevice.stamp(pending.row) || !Recovery.checkTemporary(row) ||
                            APP_CONFIG.USE_SHAREPOINT && (!identity || identity.LoginName !== row.LoginName || String(identity.Id) !== row.SharePointUserId)) { throw new Error('利用者または初期化情報が変わりました。再ログインしてください。'); }
                } catch (e) { pendingReset = null; callback(e); return; }
                CryptoJobs.run({ operation: 'rewrap', password: password, privateKey: pending.key, publicKey: row.PublicKey, recovery: JSON.parse(row.EncryptedPrivateKey).recovery }, function (cryptoError, generated) {
                    if (pendingReset !== pending || pending.expiresAt <= new Date().getTime()) { callback(new Error('パスワード変更を中止しました。再ログインしてください。')); return; }
                    if (cryptoError) { callback(cryptoError); return; }
                    try { Recovery.checkTemporary(row); } catch (expiredError) { callback(expiredError); return; }
                    /* Hash, protected key and session invalidation commit in the same item update. */
                    Records.save(APP_CONFIG.LIST_USERS, row, { PasswordHash: JSON.stringify(generated.record), PasswordSalt: generated.record.salt,
                        EncryptedPrivateKey: JSON.stringify(generated.material), CurrentSessionHash: '', CurrentDeviceId: '' }, function (saveError) {
                        if (saveError) { callback(saveError); return; }
                        pendingReset = null; Session.clear();
                        try { TrustedDevice.forget(); } catch (e) { ErrorStore.add('端末保存解除', Util.message(e)); }
                        callback(null);
                    });
                });
            });
        }
        if (APP_CONFIG.USE_SHAREPOINT) { SharePoint.getCurrentUser(function (error, identity) { if (error) { callback(error); return; } change(identity); }); }
        else { change(null); }
    }
    function syncGroup(callback) {
        var user = Session.user();
        Records.list('StickyGroups', 'GroupKey eq ' + SharePoint.literal(user.Organization), function (r) { return r.GroupKey === user.Organization; }, function (error, groups) {
            if (error || groups.length > 1) { callback(error || new Error('部署グループが重複しています。')); return; }
            function members(e) {
                if (e) { callback(e); return; }
                Records.list('StickyGroupMembers', 'UserId eq ' + SharePoint.literal(user.userId), function (r) { return r.UserId === user.userId; }, function (err, rows) {
                    if (err) { callback(err); return; }
                    var same = rows.filter(function (r) { return r.GroupKey === user.Organization; });
                    if (same.length > 1) { callback(new Error('部署メンバーが重複しています。')); return; }
                    Util.each(rows.filter(function (r) { return r.Enabled && r.GroupKey !== user.Organization; }), function (row, next) { Records.save('StickyGroupMembers', row, { Enabled: false }, next); }, function (e2) {
                        if (e2) { callback(e2); return; }
                        Records.save('StickyGroupMembers', same[0] || null, { Title: 'membership', GroupKey: user.Organization, UserId: user.userId, Enabled: true }, callback);
                    });
                });
            }
            Records.save('StickyGroups', groups[0] || null, { Title: 'group', GroupKey: user.Organization, DisplayName: user.Organization, Enabled: true }, members);
        });
    }
    function updateProfile(name, organization, callback) {
        try { profile(name, organization); } catch (e) { callback(e); return; }
        Session.guard(function (error) {
            if (error) { callback(error); return; }
            Records.save(APP_CONFIG.LIST_USERS, Session.user(), { DisplayName: Util.trim(name), Organization: organization }, function (e) {
                if (e) { callback(e); return; }
                Session.guard(function (err) {
                    if (err) { callback(err); return; }
                    Audit.log('UPDATE_PROFILE', '');
                    syncGroup(function (groupError) { if (groupError) { ErrorStore.add('部署同期', Util.message(groupError)); } callback(null, groupError); });
                });
            });
        });
    }
    return { login: login, directory: directory, profile: profile, updateProfile: updateProfile, syncGroup: syncGroup,
        completeReset: completeReset, cancelReset: function () { pendingReset = null; } };
}());

var Auth = (function () {
    'use strict';
    function profile(name, organization) {
        if (!Util.trim(name) || Util.trim(name).length > 100) { throw new Error('名前を1～100文字で入力してください。'); }
        if (!/^[A-Za-z0-9]{1,64}$/.test(organization)) { throw new Error('部署名は半角英数字1～64文字で入力してください。'); }
    }
    function directory(callback) { Records.list(APP_CONFIG.LIST_USERS, 'Enabled eq 1', function (r) { return r.Enabled === true; }, callback); }
    function login(input, callback) {
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
                        key = StickyCrypto.unlockUserPrivateKey(password, material);
                        if (material.publicKey !== row.PublicKey) { throw new Error('公開鍵と秘密鍵の登録が一致しません。'); }
                    } catch (e) { callback(e); return; }
                    Session.start(row, key, callback);
                } else {
                    if (!input.register) { callback(new Error('未登録です。新規登録を選び、名前・部署・確認用パスワードを入力してください。')); return; }
                    try {
                        profile(input.name, input.organization);
                        if (password.length < 10 || password !== input.confirm) { throw new Error('パスワードは10文字以上とし、確認欄と一致させてください。'); }
                        var created = StickyCrypto.createPasswordRecord(password), keys = StickyCrypto.createUserKeyMaterial(password);
                        var fields = { Title: 'user', StickyUserId: APP_CONFIG.USE_SHAREPOINT ? 'sp-' + identity.Id : loginId, SharePointUserId: String(identity.Id || ''), LoginName: value, DisplayName: Util.trim(input.name), Organization: input.organization, PasswordHash: JSON.stringify(created), PasswordSalt: created.salt, PublicKey: keys.publicKey, EncryptedPrivateKey: JSON.stringify(keys), CryptoVersion: StickyCrypto.VERSION, Enabled: true };
                        var privateKey = StickyCrypto.unlockUserPrivateKey(password, keys);
                    } catch (e2) { callback(e2); return; }
                    Records.save(APP_CONFIG.LIST_USERS, null, fields, function (e, row2) {
                        if (e) { callback(e); return; }
                        Session.start(row2, privateKey, function (sessionError, user) {
                            if (sessionError) { callback(sessionError); return; }
                            syncGroup(function (groupError) { if (groupError) { ErrorStore.add('部署同期', Util.message(groupError), '利用者の部署は登録済みです。設定から再同期できます。'); } callback(null, user); });
                        });
                    });
                }
            });
        }
        if (APP_CONFIG.USE_SHAREPOINT) { SharePoint.getCurrentUser(function (error, user) { if (error) { callback(error); return; } lookup(user); }); }
        else { lookup({}); }
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
    return { login: login, directory: directory, profile: profile, updateProfile: updateProfile, syncGroup: syncGroup };
}());

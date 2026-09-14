/* Password-only admin UI. Encrypted recovery material is stored automatically. */
(function () {
    'use strict';
    var busy = false, initialized = false;
    function id(name) { return document.getElementById(name); }
    function fail(error) { id('admin-error').textContent = Util.message(error); }
    function working(value) {
        busy = value;
        ['admin-reset-submit', 'generate-admin-key', 'admin-clear', 'admin-setup-clear', 'reset-user-id', 'admin-key-password', 'setup-password', 'setup-confirm'].forEach(function (name) { id(name).disabled = value; });
    }
    function clear() {
        if (busy) { return; }
        ['admin-key-password', 'setup-password', 'setup-confirm', 'temporary-password'].forEach(function (name) { id(name).value = ''; });
        id('admin-reset-result').style.display = 'none';
    }
    function directory(callback) {
        var select = id('reset-user-id'); select.textContent = '';
        var placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '利用者を選択してください'; select.appendChild(placeholder);
        Auth.directory(function (error, users) {
            if (error) { callback(error); return; }
            users.forEach(function (user) {
                var option = document.createElement('option'); option.value = user.StickyUserId;
                option.textContent = user.DisplayName + ' / ' + user.Organization + '（' + user.StickyUserId + '）'; select.appendChild(option);
            });
            callback(null);
        });
    }
    function ready() {
        id('admin-reset-panel').style.display = 'block'; id('admin-setup-panel').style.display = 'none';
        id('admin-status').textContent = '管理者パスワードは登録済みです。対象の利用者を選んでください。';
        working(true);
        directory(function (error) { working(false); if (error) { fail(error); id('admin-reset-submit').disabled = true; } });
    }
    document.addEventListener('DOMContentLoaded', function () {
        if (!id('admin-reset-form') || window.location.hash !== '#admin' || initialized) { return; }
        initialized = true;
        id('admin-root').style.display = 'block'; id('login-screen').style.display = 'none';
        if (!checkBrowserCompatibility()) { fail(new Error('必要なブラウザ機能・暗号ライブラリを確認してください。')); return; }
        id('admin-storage-note').textContent = APP_CONFIG.USE_SHAREPOINT ? '設定はSharePointへ自動保存します。管理操作にはサイトコレクション管理者の権限が必要です。' : '端末内モード：設定はこのブラウザだけに保存します。他の端末とは共有されません。ブラウザデータを消すと設定と付箋も失われます。';
        working(true);
        Recovery.admin(function (error) {
            if (error) { working(false); fail(error); id('admin-status').textContent = '管理者権限を確認できません。'; return; }
            Recovery.load(function (loadError, settings) {
                working(false);
                if (loadError) { fail(loadError); id('admin-status').textContent = '保存済みの管理者設定を確認できません。再登録は行いません。'; return; }
                if (settings) { ready(); return; }
                if (Recovery.publicKey()) { fail(new Error('旧ファイル方式の復旧鍵が設定されています。既存の鍵を引き継ぐ対応が必要です。新しい鍵で上書きしないでください。')); return; }
                id('admin-status').textContent = '初回のみ、管理者パスワードを登録してください。';
                id('admin-setup-panel').style.display = 'block';
            });
        });
        id('admin-reset-form').onsubmit = function (event) {
            event.preventDefault(); if (busy) { return; }
            var select = id('reset-user-id'), user = select.value, password = id('admin-key-password').value;
            id('temporary-password').value = ''; id('admin-reset-result').style.display = 'none'; id('admin-error').textContent = '';
            if (!user || !password) { fail(new Error('対象の利用者を選び、管理者パスワードを入力してください。')); return; }
            if (!window.confirm(select.options[select.selectedIndex].textContent + '\n本人確認は済んでいますか？ この利用者のパスワードを初期化し、現在のログインを無効にします。')) { return; }
            working(true); id('admin-status').textContent = 'パスワードを検証し、初期化しています…';
            Recovery.resetStored(user, password, function (error, result) {
                password = ''; working(false); clear();
                if (error) { fail(error); id('admin-status').textContent = '初期化できませんでした。通信タイムアウトの場合は結果を確認してから再発行してください。'; return; }
                id('admin-result-target').textContent = result.displayName + '（' + result.userId + '）の初期化が完了しました。';
                id('temporary-password').value = result.temporaryPassword; id('temporary-expires').textContent = '有効期限（UTC）：' + result.expiresAt;
                id('admin-reset-result').style.display = 'block'; id('admin-status').textContent = '以前のパスワード・セッションを無効にしました。';
            });
        };
        id('admin-key-form').onsubmit = function (event) {
            event.preventDefault(); if (busy) { return; }
            working(true); id('admin-error').textContent = ''; id('admin-status').textContent = '管理者設定を生成・保存しています。しばらくお待ちください…';
            Recovery.setup(id('setup-password').value, id('setup-confirm').value, function (error) {
                working(false); clear();
                if (error) { fail(error); id('admin-status').textContent = '登録完了を確認できません。通信エラーの場合は再読み込みして保存状態を確認してください。'; return; }
                ready(); id('admin-status').textContent = '登録が完了しました。ファイルの作成・保存・配置は不要です。';
            });
        };
        id('admin-clear').onclick = clear; id('admin-setup-clear').onclick = clear;
        id('reset-user-id').onchange = clear;
    });
}());

function sanitizeHtml(value) {
    var allowed = { P: 1, BR: 1, B: 1, STRONG: 1, U: 1, S: 1, SPAN: 1, TABLE: 1, TBODY: 1, THEAD: 1, TR: 1, TD: 1, TH: 1, UL: 1, OL: 1, LI: 1 };
    var box = document.createElement('div'), nodes, i, j;
    box.innerHTML = String(value || '');
    nodes = box.getElementsByTagName('*');
    for (i = nodes.length - 1; i >= 0; i -= 1) {
        if (!allowed[nodes[i].tagName]) { nodes[i].parentNode.removeChild(nodes[i]); continue; }
        for (j = nodes[i].attributes.length - 1; j >= 0; j -= 1) { nodes[i].removeAttribute(nodes[i].attributes[j].name); }
    }
    return box.innerHTML;
}
var Fsn = (function () {
    'use strict';
    var currentTab = 'stickies', editor = null, archived = false, unread = false, toastTimer, refreshing = false, initialized = false, returnFocus;
    function id(value) { return document.getElementById(value); }
    function bind(value, handler) { id(value).onclick = handler; }
    function toast(message) { window.clearTimeout(toastTimer); id('toast').textContent = message; id('toast').className = 'toast visible'; toastTimer = window.setTimeout(function () { id('toast').className = 'toast'; }, 5000); }
    function note(value) { return Views.find('notes', value); }
    function result(error, warning) {
        if (error) { ErrorStore.add('操作', Util.message(error)); toast(Util.message(error)); if (Session.user()) { render(); } return; }
        render(); toast(warning || '保存しました');
    }
    function render() {
        if (!Session.user()) { return; }
        id('user-name').textContent = Session.user().DisplayName; id('org-name').textContent = Session.user().Organization;
        id('inbox-badge').textContent = Data.state().notes.filter(function (r) { return r.NoteType === 'DIRECT' && !r.Deleted && r.SenderUserId !== Session.user().userId && !r.recipient.IsRead; }).length;
        id('notification-badge').textContent = Data.state().notifications.filter(function (r) { return !r.IsRead; }).length;
        if (currentTab === 'stickies') { StickyApp.render(); }
        else if (Views[currentTab]) { Views[currentTab](); }
        else if (currentTab === 'errors') { renderErrors(); }
        else if (currentTab === 'audit') { id('audit-list').innerHTML = Audit.all().map(function (r) { return '<div class="notification-row"><div><strong>' + Util.esc(r.action) + '</strong><p>' + Util.esc(r.detail) + '</p><small>' + Util.esc(r.createdAt) + '</small></div></div>'; }).join('') || '<p>履歴はありません。</p>'; }
        else if (currentTab === 'settings') { id('profile-name').value = Session.user().DisplayName; id('profile-org').value = Session.user().Organization; }
        id('recipient-users').innerHTML = Data.state().users.map(function (r) { return '<option value="@' + Util.esc(r.StickyUserId) + '">' + Util.esc(r.DisplayName + ' / ' + r.Organization) + '</option>'; }).join('');
    }
    function tab(name) {
        if (!id('panel-' + name) || !Session.user()) { return; }
        currentTab = name;
        var tabs = document.querySelectorAll('.nav-tab'), panels = document.querySelectorAll('.tab-panel'), i;
        for (i = 0; i < tabs.length; i += 1) { tabs[i].className = 'nav-tab' + (tabs[i].getAttribute('data-tab') === name ? ' active' : ''); }
        for (i = 0; i < panels.length; i += 1) { panels[i].className = 'tab-panel' + (panels[i].id === 'panel-' + name ? ' active' : ''); }
        render();
    }
    function open(row, mode, initial) {
        if (!Session.user() || Data.busy()) { return; }
        mode = mode || (row && row.NoteType === 'TASK' ? 'task' : row && row.NoteType === 'DIRECT' ? 'read' : 'personal');
        var value = Util.clone(initial || row && row.value || { title: '', content: '', color: 'yellow', due: '', x: 30, y: 30, width: 250, height: 180 });
        editor = { row: row || null, mode: mode, value: value };
        returnFocus = document.activeElement;
        id('note-title').value = value.title || ''; id('note-content').value = value.content || ''; id('note-color').value = Util.color(value.color); id('note-due').value = value.due || ''; id('task-state').value = value.status || '未着手';
        id('note-recipient').value = ''; id('recipient-label').style.display = mode === 'send' ? 'block' : 'none';
        id('task-state-label').style.display = mode === 'task' ? 'block' : 'none';
        id('editor-title').textContent = { read: '読み取り専用', send: '付箋を送る', task: 'タスク', personal: row ? '付箋を編集' : '新しい付箋' }[mode];
        id('note-title').readOnly = mode === 'read'; id('note-content').readOnly = mode === 'read';
        id('note-color').disabled = mode === 'read'; id('note-due').disabled = mode === 'read';
        id('editor-save').disabled = false; id('editor-save').style.display = mode === 'read' ? 'none' : '';
        id('editor-save').textContent = mode === 'send' ? '送信する' : '保存する';
        id('editor-toolbar').style.display = mode === 'read' ? 'none' : '';
        id('note-to-task').style.display = mode === 'read' || mode === 'send' || mode === 'task' ? 'none' : '';
        id('note-history').style.display = mode !== 'read' && row && (value.versions || []).length ? '' : 'none';
        id('editor-modal').className = 'modal-backdrop visible'; id('note-title').focus();
    }
    function close(force) {
        if (Data.busy() && !force) { toast('処理が終わるまでお待ちください。'); return; }
        editor = null; id('editor-modal').className = 'modal-backdrop';
        id('note-content').value = ''; id('note-title').value = ''; id('note-recipient').value = '';
        if (returnFocus && returnFocus.focus) { returnFocus.focus(); }
    }
    function formValue() {
        var value = Util.clone(editor.value);
        value.title = id('note-title').value; value.content = id('note-content').value; value.color = id('note-color').value; value.due = id('note-due').value;
        if (editor.mode === 'task') { value.status = id('task-state').value; }
        return value;
    }
    function save() {
        if (!editor || editor.mode === 'read' || Data.busy()) { return false; }
        var captured = editor, value = formValue(), token = Session.token();
        id('editor-save').disabled = true;
        Data.saveNote(editor.row, value, id('note-recipient').value, { send: 'DIRECT', task: 'TASK', personal: 'PERSONAL' }[editor.mode], function (error, warning) {
            id('editor-save').disabled = false;
            if (token !== Session.token()) { return; }
            if (!error && editor === captured) { close(); }
            result(error, warning);
        });
        return true;
    }
    function updateNote(row, value, callback) { Data.saveNote(row, value, '', row.NoteType, callback || result); }
    function remove(value) { var row = note(value), changed; if (!row) { return; } changed = Util.clone(row.value); changed.deleted = true; updateNote(row, changed); }
    function refresh() {
        if (!Session.user() || refreshing || Data.busy() || editor) { return; }
        refreshing = true; id('app-status').textContent = '更新中…';
        Data.refresh(function (error) { refreshing = false; id('app-status').textContent = error ? Util.message(error) : ''; if (error) { ErrorStore.add('データ更新', Util.message(error)); } render(); });
    }
    function lock() {
        if (Data.busy()) { toast('保存処理が終わってからロックしてください。'); return; }
        var user = Session.user(); if (user) { id('login-id').value = user.userId; }
        Session.clear(); Data.reset(); editor = null; refreshing = false; close(true);
        id('application').style.display = 'none'; id('login-screen').style.display = 'flex';
        id('login-password').value = ''; id('register-confirm').value = ''; id('register').checked = false; id('registration-fields').style.display = 'none';
        /* Remove decrypted DOM content, not just its visibility. */
        ['sticky-board', 'inbox-list', 'sent-list', 'sns-list', 'task-list', 'notification-list', 'user-list', 'global-search-results', 'audit-list', 'trash-list'].forEach(function (x) { id(x).innerHTML = ''; });
        id('login-error').textContent = 'ロックしました。パスワードを入力してください。'; id('login-password').focus();
    }
    function download(filename, content, type) {
        var blob = new Blob([content], { type: type }), url, a;
        if (navigator.msSaveOrOpenBlob) { navigator.msSaveOrOpenBlob(blob, filename); return; }
        var api = window.URL || window.webkitURL;
        if (!api || !api.createObjectURL) { throw new Error('ファイル出力に対応していません。'); }
        url = api.createObjectURL(blob); a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); window.setTimeout(function () { api.revokeObjectURL(url); }, 60000);
    }
    function csv(value) { value = String(value == null ? '' : value); if (/^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)) { value = "'" + value; } return '"' + value.replace(/"/g, '""') + '"'; }
    function init() {
        if (initialized) { return; } initialized = true;
        var compatible = checkBrowserCompatibility(), tabs = document.querySelectorAll('.nav-tab'), i;
        id('login-mode').textContent = APP_CONFIG.USE_SHAREPOINT ? 'SharePointにログイン済みのアカウントを使用します。' : '端末内モード：このブラウザ内でのみ共有されます。';
        id('login-id-label').style.display = APP_CONFIG.USE_SHAREPOINT ? 'none' : '';
        id('mode-banner').textContent = APP_CONFIG.USE_SHAREPOINT ? 'SharePoint連携モード' : '端末内モードです。他のPC・ブラウザとは同期しません。';
        id('login-button').disabled = !compatible;
        try { id('login-id').value = Storage.get('fsn_remember_id', ''); id('remember-id').checked = !!id('login-id').value; } catch (e) { id('login-error').textContent = Util.message(e); }
        bind('register', function () { id('registration-fields').style.display = this.checked ? 'block' : 'none'; });
        bind('login-errors', function () { id('login-diagnostics').textContent = ErrorStore.all().map(function (r) { return r.source + '：' + r.message + '\n' + r.detail; }).join('\n\n') || 'エラーはありません。'; });
        id('login-form').onsubmit = function (event) {
            event.preventDefault(); if (id('login-button').disabled) { return; }
            var input = { id: id('login-id').value, password: id('login-password').value, register: id('register').checked, name: id('register-name').value, organization: id('register-org').value, confirm: id('register-confirm').value };
            id('login-button').disabled = true; id('login-error').textContent = '認証・暗号鍵を確認しています…';
            window.setTimeout(function () {
                Auth.login(input, function (error) {
                    input.password = ''; input.confirm = ''; id('login-password').value = ''; id('register-confirm').value = ''; id('login-button').disabled = false;
                    if (error) { ErrorStore.add('ログイン', Util.message(error)); id('login-error').textContent = Util.message(error); return; }
                    try { if (id('remember-id').checked) { Storage.set('fsn_remember_id', id('login-id').value); } else { Storage.remove('fsn_remember_id'); } } catch (e) { ErrorStore.add('設定保存', Util.message(e)); }
                    Data.reset(); id('login-screen').style.display = 'none'; id('application').style.display = 'block'; id('login-error').textContent = '';
                    archived = false; tab('stickies'); refresh();
                });
            }, 30);
        };
        for (i = 0; i < tabs.length; i += 1) { tabs[i].onclick = function () { tab(this.getAttribute('data-tab')); }; }
        bind('new-note', function () { open(null, 'personal'); }); bind('send-note', function () { open(null, 'send'); }); bind('new-task', function () { open(null, 'task'); });
        bind('editor-save', save); bind('editor-close', function () { close(); }); bind('editor-cancel', function () { close(); });
        bind('editor-copy', function () { if (!editor) { return; } var value = formValue(); delete value.versions; delete value.deleted; delete value.archived; open(null, 'personal', value); });
        bind('note-to-task', function () { if (!editor || editor.mode === 'read') { return; } var value = formValue(); value.status = '未着手'; Data.saveNote(null, value, '', 'TASK', result); });
        bind('note-history', function () {
            if (!editor || editor.mode === 'read') { return; }
            var versions = editor.value.versions || [], choice = window.prompt(versions.map(function (v, index) { return (index + 1) + '：' + (v.updatedAt || '') + ' ' + v.title; }).join('\n'), String(versions.length)), index;
            if (!/^\d+$/.test(choice || '')) { return; } index = +choice - 1;
            if (versions[index]) { var row = editor.row, mode = editor.mode; open(row, mode, versions[index]); toast('履歴を読み込みました。「保存する」で確定します。'); }
        });
        var inserts = document.querySelectorAll('[data-insert]');
        for (i = 0; i < inserts.length; i += 1) { inserts[i].onclick = function () { if (!editor || editor.mode === 'read') { return; } var field = id('note-content'), start = field.selectionStart || 0, end = field.selectionEnd || start, selected = field.value.substring(start, end), type = this.getAttribute('data-insert'), text = type === 'bold' ? '<strong>' + (selected || '太字') + '</strong>' : type === 'table' ? '<table><tr><td>項目</td><td>内容</td></tr></table>' : '\n[ ] 項目'; field.value = field.value.substring(0, start) + text + field.value.substring(end); field.focus(); }; }
        bind('lock-button', lock); bind('logout-button', function () { if (Data.busy()) { toast('保存処理をお待ちください。'); return; } Session.logout(function (error) { lock(); if (error) { ErrorStore.add('ログアウト', Util.message(error), '端末の秘密鍵は破棄しました。サーバー側の失効確認は未完了です。'); } }); });
        bind('archive-toggle', function () { archived = !archived; this.textContent = archived ? '通常表示' : 'アーカイブ'; render(); });
        bind('inbox-filter', function () { unread = !unread; this.textContent = unread ? 'すべて表示' : '未読のみ'; render(); });
        bind('align-notes', function () {
            var rows = Data.state().notes.filter(function (r) { return r.NoteType === 'PERSONAL' && !r.Deleted && !r.value.pinned && !!r.Archived === archived; }), index = 0;
            Util.each(rows, function (row, next) { var value = Util.clone(row.value); value.x = 30 + (index % 3) * 290; value.y = 30 + Math.floor(index / 3) * 250; index += 1; updateNote(row, value, function (e) { next(e); }); }, result);
        });
        bind('template-note', function () { var choice = window.prompt('1：確認依頼　2：会議メモ', '1'); if (choice === '1' || choice === '2') { open(null, 'personal', { title: choice === '1' ? '確認依頼' : '会議メモ', content: choice === '1' ? '[ ] 内容を確認\n[ ] コメントを返信' : '日時：\n参加者：\n決定事項：\n[ ] 次のアクション', color: 'blue' }); } });
        bind('new-post', function () {
            var body = window.prompt('投稿本文', ''), category, raw, options = [];
            if (body === null) { return; } category = window.prompt('分類（アンケートの場合は「アンケート」）', 'お知らせ'); if (category === null) { return; }
            if (category === 'アンケート') { raw = window.prompt('選択肢をカンマで区切って入力', ''); if (raw === null) { return; } options = raw.split(/[,、]/).map(Util.trim); if (options.length < 2 || options.length > 10 || options.some(function (v, index) { return !v || v.length > 100 || options.indexOf(v) !== index; })) { toast('重複しない選択肢を2～10個、各100文字以内で入力してください。'); return; } }
            Data.savePost(null, { body: body, category: category, options: options, createdAt: new Date().toISOString() }, result);
        });
        bind('read-notifications', function () { Data.readNotifications(result); });
        id('search-input').oninput = render; id('user-search').oninput = Views.users; id('global-search-input').oninput = Views.search; id('task-filter').onchange = Views.tasks;
        bind('clear-errors', function () { ErrorStore.clear(); renderErrors(); });
        bind('refresh-data', refresh);
        bind('save-profile', function () { if (Data.busy()) { return; } Auth.updateProfile(id('profile-name').value, id('profile-org').value, function (error, warning) { if (error) { result(error); return; } refresh(); toast(warning ? 'プロフィールは保存済み。部署同期はエラー一覧を確認してください。' : 'プロフィールを保存しました'); }); });
        bind('sync-group', function () { Session.guard(function (e) { if (e) { result(e); return; } Auth.syncGroup(result); }); });
        bind('check-sharepoint', function () { if (!APP_CONFIG.USE_SHAREPOINT) { toast('現在は端末内モードです。'); return; } this.disabled = true; SharePointSetup.check(function (failures) { id('check-sharepoint').disabled = false; toast(failures.length ? failures.length + '件の問題があります。エラー一覧を確認してください。' : '列名と列型を確認しました。権限・一意制約は管理者が確認してください。'); }); });
        bind('audit-export', function () { try { download('fsn-audit.csv', '\uFEFF' + [['日時', '利用者ID', '端末ID', '操作', '対象ID']].concat(Audit.all().map(function (r) { return [r.createdAt, r.userId, r.deviceId, r.action, r.detail]; })).map(function (row) { return row.map(csv).join(','); }).join('\r\n'), 'text/csv;charset=utf-8'); } catch (e) { result(e); } });
        bind('export-legacy', function () {
            try { var data = {}, key, j; for (j = 0; j < window.localStorage.length; j += 1) { key = window.localStorage.key(j); if (key.indexOf('sticky_') === 0) { data[key] = Storage.get(key, null); } } download('fsn-legacy-backup.json', JSON.stringify(data, null, 2), 'application/json'); toast('旧データには平文が含まれます。安全に保管してください。'); } catch (e) { result(e); }
        });
        bind('import-legacy', function () {
            if (Data.busy() || !window.confirm('旧端末データの付箋がすべて自分のものであることを確認しましたか？元データは残したまま、現在の利用者の付箋として暗号化して取り込みます。')) { return; }
            var rows; try { rows = Storage.get('sticky_notes', []); if (!Array.isArray(rows)) { throw new Error('旧付箋の形式が不正です。'); } } catch (e) { result(e); return; }
            Util.each(rows, function (value, next) { value = Util.clone(value); var key = Util.hash(JSON.stringify(value)); if (Data.state().notes.some(function (r) { return r.value.legacyKey === key; })) { next(); return; } value.legacyKey = key; Data.saveNote(null, value, '', 'PERSONAL', function (e) { next(e); }); }, result);
        });
        document.addEventListener('keydown', function (event) {
            var key = event.keyCode || event.which;
            if (!Session.user()) { return; }
            if (event.ctrlKey && key === 83) { event.preventDefault(); save(); }
            else if (event.ctrlKey && key === 78) { event.preventDefault(); open(null, 'personal'); }
            else if (key === 27 && editor) { event.preventDefault(); close(); }
            else if (key === 9 && editor) {
                var focusable = id('editor-modal').querySelectorAll('input,textarea,select,button'), visible = [], k;
                for (k = 0; k < focusable.length; k += 1) { if (!focusable[k].disabled && focusable[k].offsetWidth) { visible.push(focusable[k]); } }
                if (event.shiftKey && document.activeElement === visible[0]) { event.preventDefault(); visible[visible.length - 1].focus(); }
                else if (!event.shiftKey && document.activeElement === visible[visible.length - 1]) { event.preventDefault(); visible[0].focus(); }
            }
        });
        window.setInterval(function () { if (!Session.user() || Data.busy()) { return; } var token = Session.token(); Session.guard(function (e) { if (e && token === Session.token()) { ErrorStore.add('セッション', Util.message(e)); lock(); } }); }, Math.max(5000, Number(APP_CONFIG.SESSION_CHECK_INTERVAL) || 15000));
        window.setInterval(refresh, Math.max(15000, Number(APP_CONFIG.MESSAGE_INTERVAL) || 30000));
    }
    document.addEventListener('DOMContentLoaded', init);
    return { tab: tab, open: open, close: close, save: save, remove: remove, updateNote: updateNote, result: result, render: render, toast: toast, esc: Util.esc, note: note, archived: function () { return archived; }, unreadOnly: function () { return unread; }, lock: lock, csv: csv, init: init };
}());

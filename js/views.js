var Views = (function () {
    function name(id) { var rows = Data.state().users.filter(function (u) { return u.StickyUserId === id; }); return rows.length ? rows[0].DisplayName : id; }
    function find(collection, id) { return Data.state()[collection].filter(function (r) { return String(r.Id) === String(id); })[0]; }
    function set(id, html) { document.getElementById(id).innerHTML = html || '<p class="empty-message">該当するデータはありません。</p>'; }
    function bind(id, selector, run) { var buttons = document.getElementById(id).querySelectorAll(selector), i; for (i = 0; i < buttons.length; i += 1) { buttons[i].onclick = run; } }
    function openNote(row) {
        if (!row || !Session.user() || Data.busy()) { return; }
        Fsn.open(row);
        if (NoteVisibility.received(row) && !row.recipient.IsRead) { Data.readNote(row, Fsn.result); }
    }
    function inbox() {
        var user = Session.user().userId;
        set('inbox-list', Data.state().notes.filter(function (r) { return r.NoteType === 'DIRECT' && !r.Deleted && r.SenderUserId !== user && (!Fsn.unreadOnly() || !r.recipient.IsRead || !NoteVisibility.hidden(r)); }).map(function (r) {
            return '<div class="inbox-card received-note" data-received-note="' + r.Id + '"><div class="note-actions" role="group" aria-label="受信付箋の操作">' + NoteVisibility.button(r) + '</div><div class="received-preview">' +
                (NoteVisibility.hidden(r) ? '<p class="note-hidden-message">内容を非表示中</p>' : '<div class="note-body">' + NoteMarkup.html(r.value.content) + (r.value.due ? '<small class="note-due">' + Util.esc(r.value.due) + '</small>' : '') + '</div>') +
                '<p>' + Util.esc(name(r.SenderUserId)) + ' から</p><small>' + (r.recipient.IsRead ? '既読 ' + Util.esc(r.recipient.ReadAt || '') : '未読') + '</small></div><button type="button" class="outline" data-note="' + r.Id + '" title="内容を表示して開く">開く</button></div>';
        }).join(''));
        bind('inbox-list', '[data-note]', function () { openNote(find('notes', this.getAttribute('data-note'))); });
        bind('inbox-list', '[data-action="visibility"]', function () {
            NoteVisibility.toggle(find('notes', this.parentNode.parentNode.getAttribute('data-received-note')), Fsn.result);
        });
        set('sent-list', Data.state().notes.filter(function (r) { return r.NoteType === 'DIRECT' && !r.Deleted && r.SenderUserId === user; }).map(function (r) {
            var targets = r.recipients.filter(function (p) { return p.RecipientUserId !== user; });
            return '<div class="inbox-card"><div><strong>' + Util.esc(r.value.title) + '</strong><p>' + targets.map(function (p) { return Util.esc(name(p.RecipientUserId)) + '：' + (p.IsRead ? '既読 ' + Util.esc(p.ReadAt || '') : '未読'); }).join('<br>') + '</p><small>既読 ' + targets.filter(function (p) { return p.IsRead; }).length + '/' + targets.length + '</small></div><button class="outline" data-note="' + r.Id + '">開く</button></div>';
        }).join(''));
        bind('sent-list', '[data-note]', function () { Fsn.open(find('notes', this.getAttribute('data-note')), 'read'); });
    }
    function sns() {
        var state = Data.state(), user = Session.user().userId;
        set('sns-list', state.posts.slice().sort(function (a, b) { return Number(!!b.IsPinned) - Number(!!a.IsPinned) || b.Id - a.Id; }).map(function (r) {
            var reactions = state.reactions.filter(function (x) { return x.PostId === String(r.Id); }), viewers = {}, count = 0;
            state.views.filter(function (v) { return v.PostId === String(r.Id); }).forEach(function (v) { if (!viewers['$' + v.ViewerUserId]) { count += 1; viewers['$' + v.ViewerUserId] = true; } });
            var likes = {}, liked = false, likeCount = 0;
            reactions.filter(function (x) { return x.ReactionType === 'LIKE'; }).forEach(function (x) { if (!likes['$' + x.UserId]) { likeCount += 1; likes['$' + x.UserId] = true; } if (x.UserId === user) { liked = true; } });
            return '<article class="post-card" data-post="' + r.Id + '"><div class="post-head"><div><strong>' + Util.esc(name(r.AuthorUserId)) + '</strong><small>' + Util.esc(r.Category) + (r.IsPinned ? '・固定' : '') + '</small></div>' + (r.AuthorUserId === user ? '<button data-action="pin" class="secondary">固定切替</button><button data-action="delete" class="secondary">削除</button>' : '') + '</div>' + (r.value.title ? '<h3>' + Util.esc(r.value.title) + '</h3>' : '') + '<div class="post-body">' + (r.value.bodyFormat === 'html' ? NoteMarkup.html(r.value.body) : Util.esc(r.value.body).replace(/\n/g, '<br>')) + '</div>' +
                (r.value.options || []).map(function (option, index) { var voters = {}; reactions.filter(function (x) { return x.ReactionType === 'VOTE:' + index; }).forEach(function (x) { voters['$' + x.UserId] = true; }); return '<button data-action="vote" data-option="' + index + '" class="secondary">' + Util.esc(option) + ' (' + Object.keys(voters).length + ')' + (voters['$' + user] ? ' ✓' : '') + '</button>'; }).join(' ') +
                state.comments.filter(function (c) { return c.PostId === String(r.Id); }).map(function (c) { return '<p class="comment">' + Util.esc(name(c.AuthorUserId)) + '：' + Util.esc(c.value.text) + '</p>'; }).join('') +
                '<div class="post-foot"><span>' + count + '人が閲覧</span><button data-action="open">投稿を開く</button><button data-action="like">' + (liked ? '♥' : '♡') + ' ' + likeCount + '</button><button data-action="comment">コメント</button><button data-action="copy">付箋にコピー</button></div></article>';
        }).join(''));
        bind('sns-list', '[data-action]', function () {
            var card = this.parentNode, action = this.getAttribute('data-action'), row, text, value;
            while (!card.getAttribute('data-post')) { card = card.parentNode; }
            row = find('posts', card.getAttribute('data-post'));
            if (action === 'open') { Fsn.open(null, 'read', { title: row.value.title || row.Category, content: row.value.bodyFormat === 'html' ? row.value.body : Util.esc(row.value.body), color: 'lavender' }); Data.view(row, Fsn.result); }
            if (action === 'copy') { Fsn.open(null, 'personal', { title: row.value.title || row.Category, content: row.value.bodyFormat === 'html' ? row.value.body : Util.esc(row.value.body), color: 'lavender' }); }
            if (action === 'like') { Data.react(row, 'LIKE', Fsn.result); }
            if (action === 'vote') { Data.react(row, 'VOTE:' + this.getAttribute('data-option'), Fsn.result); }
            if (action === 'comment') { text = window.prompt('コメント（メンションは @利用者ID）', ''); if (text !== null) { Data.comment(row, text, Fsn.result); } }
            if (action === 'pin' || action === 'delete') { if (action === 'delete' && !window.confirm('この投稿を削除しますか？')) { return; } value = Util.clone(row.value); if (action === 'pin') { value.pinned = !row.IsPinned; } else { value.deleted = true; } Data.savePost(row, value, Fsn.result); }
        });
    }
    function tasks() {
        var filter = document.getElementById('task-filter').value;
        set('task-list', Data.state().notes.filter(function (r) { return r.NoteType === 'TASK' && !r.Deleted && r.SenderUserId === Session.user().userId && (!filter || r.value.status === filter); }).map(function (r) {
            return '<div class="task-row" data-task="' + r.Id + '"><strong>' + (NoteVisibility.hidden(r) ? '内容を非表示中' : Util.esc(r.value.title)) + '</strong><span>' + (NoteVisibility.hidden(r) ? '' : Util.esc(r.value.due || '期限なし')) + '</span><span>' + Util.esc(r.value.status || '未着手') + '</span><span>' + NoteVisibility.button(r) + '<button class="secondary" data-edit="' + r.Id + '">編集</button><button class="secondary" data-delete="' + r.Id + '">削除</button></span></div>';
        }).join(''));
        bind('task-list', '[data-edit]', function () { Fsn.open(find('notes', this.getAttribute('data-edit')), 'task'); });
        bind('task-list', '[data-delete]', function () { Fsn.remove(this.getAttribute('data-delete')); });
        bind('task-list', '[data-action="visibility"]', function () { NoteVisibility.toggle(find('notes', this.parentNode.parentNode.getAttribute('data-task')), Fsn.result); });
    }
    function notifications() {
        var names = { NOTE: '付箋が届きました', READ: '付箋が開封されました', COMMENT: 'コメント・メンションがあります' };
        set('notification-list', Data.state().notifications.slice().reverse().map(function (r) { return '<div class="notification-row"><div><strong>' + Util.esc(names[r.NotificationType] || r.NotificationType) + '</strong><p>' + Util.esc(name(r.SenderUserId)) + ' ・ ' + (r.IsRead ? '既読' : '未読') + '</p></div><button class="secondary" data-notice="' + r.Id + '">関連画面</button></div>'; }).join(''));
        bind('notification-list', '[data-notice]', function () { var row = find('notifications', this.getAttribute('data-notice')); Fsn.tab(row.NotificationType === 'COMMENT' ? 'sns' : 'inbox'); });
    }
    function users() {
        var query = document.getElementById('user-search').value.toLowerCase();
        set('user-list', Data.state().users.filter(function (r) { return (r.DisplayName + ' ' + r.Organization + ' ' + r.StickyUserId).toLowerCase().indexOf(query) !== -1; }).map(function (r) { return '<div class="inbox-card"><div><strong>' + Util.esc(r.DisplayName) + '</strong><p>' + Util.esc(r.Organization + ' / @' + r.StickyUserId) + '</p></div><button class="outline" data-user="' + Util.esc(r.StickyUserId) + '">送信</button></div>'; }).join(''));
        bind('user-list', '[data-user]', function () { Fsn.open(null, 'send'); document.getElementById('note-recipient').value = '@' + this.getAttribute('data-user'); });
    }
    function trash() {
        var rows = Data.trashRows();
        document.getElementById('empty-trash').disabled = Data.busy() || !rows.length;
        set('trash-list', rows.map(function (r) { return '<div class="inbox-card"><div><strong>' + (NoteVisibility.hidden(r) ? '内容を非表示中' : Util.esc(r.value.title)) + '</strong></div><button class="outline" data-restore="' + r.Id + '"' + (Data.busy() ? ' disabled' : '') + '>復元</button></div>'; }).join(''));
        bind('trash-list', '[data-restore]', function () { var row = find('notes', this.getAttribute('data-restore')), value = Util.clone(row.value); value.deleted = false; Fsn.updateNote(row, value); });
    }
    function search() {
        var query = Util.trim(document.getElementById('global-search-input').value).toLowerCase(), html = [];
        if (!query) { set('global-search-results', '<p>検索語を入力してください。</p>'); return; }
        Data.state().notes.filter(function (r) { return !r.Deleted; }).forEach(function (r) { var text = NoteMarkup.plain(r.value.content), concealed = NoteVisibility.hidden(r); if ((r.value.title + ' ' + text).toLowerCase().indexOf(query) !== -1) { html.push('<div class="notification-row"><div><strong>' + Util.esc(r.NoteType + '：' + (concealed ? '内容を非表示中' : r.value.title)) + '</strong>' + (concealed ? '' : '<p>' + Util.esc(text) + '</p>') + '</div><button type="button" class="secondary" data-search-note="' + r.Id + '" title="内容を表示して開く">開く</button></div>'); } });
        Data.state().posts.forEach(function (r) { var text = r.value.bodyFormat === 'html' ? NoteMarkup.plain(r.value.body) : r.value.body; if ((r.Category + ' ' + (r.value.title || '') + ' ' + text).toLowerCase().indexOf(query) !== -1) { html.push('<div class="notification-row"><div><strong>SNS：' + Util.esc(r.value.title || r.Category) + '</strong><p>' + Util.esc(text) + '</p></div></div>'); } });
        set('global-search-results', html.join(''));
        bind('global-search-results', '[data-search-note]', function () { openNote(find('notes', this.getAttribute('data-search-note'))); });
    }
    return { inbox: inbox, sns: sns, tasks: tasks, notifications: notifications, users: users, trash: trash, search: search, name: name, find: find };
}());

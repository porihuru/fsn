/* One application data path: encrypted records, then commit, then refresh UI. */
var Data = (function () {
    'use strict';
    var state = empty(), busy = false, generation = 0;
    function empty() { return { users: [], notes: [], recipients: [], posts: [], comments: [], reactions: [], views: [], notifications: [] }; }
    function reset() { state = empty(); generation += 1; busy = false; }
    function eq(field, value) { return field + ' eq ' + SharePoint.literal(value); }
    function actor() { if (!Session.user()) { throw new Error('再ログインしてください。'); } return Session.user().userId; }
    function seal(value, users) {
        var key = StickyCrypto.generateContentKey(), keys = [], seen = {};
        users.forEach(function (user) {
            var id = user.StickyUserId;
            if (!seen['$' + id]) {
                if (!user.PublicKey || !user.Enabled) { throw new Error('宛先の公開鍵または有効状態を確認してください。'); }
                keys.push({ userId: id, key: StickyCrypto.encryptKeyForRecipient(key, user.PublicKey) }); seen['$' + id] = true;
            }
        });
        return { payload: StickyCrypto.encryptJson(value, key), keys: keys };
    }
    function unseal(envelope) {
        var entries = envelope.keys || [], id = actor(), i;
        for (i = 0; i < entries.length; i += 1) { if (entries[i].userId === id) { return StickyCrypto.decryptJson(envelope.payload, StickyCrypto.decryptRecipientKey(entries[i].key, Session.key())); } }
        return null;
    }
    function resolve(text, users) {
        var tokens = text.split(/[,、\n]/), result = [], ids = {};
        if (!Util.trim(text)) { throw new Error('送信先を入力してください。'); }
        tokens.forEach(function (token) {
            token = Util.trim(token);
            if (!token) { throw new Error('空の宛先があります。区切り文字を確認してください。'); }
            var group = token.charAt(0) === '#', id = token.charAt(0) === '@';
            var matches = users.filter(function (u) { return u.Enabled && (group ? u.Organization === token.substring(1) : id ? u.StickyUserId === token.substring(1) : u.DisplayName === token); });
            if (!matches.length || !group && matches.length !== 1) { throw new Error('宛先「' + token + '」が未登録または同名です。@利用者ID または #部署名を指定してください。'); }
            matches.forEach(function (u) { if (!u.PublicKey) { throw new Error('公開鍵が未登録の宛先があります。'); } if (!ids['$' + u.StickyUserId]) { result.push(u); ids['$' + u.StickyUserId] = true; } });
        });
        return result;
    }
    function refresh(callback) {
        var token = Session.token(), epoch = generation, nextState = empty(), userId;
        if (busy) { callback(new Error('保存中です。完了後に更新してください。')); return; }
        try { userId = actor(); } catch (e) { callback(e); return; }
        Session.guard(function (error) {
            if (error) { callback(error); return; }
            var jobs = [
                ['users', APP_CONFIG.LIST_USERS, 'Enabled eq 1', function (r) { return r.Enabled === true; }],
                ['recipients', APP_CONFIG.LIST_RECIPIENTS, '', null],
                ['notes', APP_CONFIG.LIST_NOTES, '', null],
                ['posts', APP_CONFIG.LIST_POSTS, '', null],
                ['comments', APP_CONFIG.LIST_COMMENTS, 'Deleted eq 0', function (r) { return !r.Deleted; }],
                ['reactions', APP_CONFIG.LIST_REACTIONS, '', null],
                ['views', APP_CONFIG.LIST_POST_VIEWS, '', null],
                ['notifications', APP_CONFIG.LIST_NOTIFICATIONS, eq('RecipientUserId', userId), function (r) { return r.RecipientUserId === userId; }]
            ];
            Util.each(jobs, function (job, next) {
                if (token !== Session.token() || epoch !== generation) { next(new Error('利用者が変わったため読み込みを中止しました。')); return; }
                Records.list(job[1], job[2], job[3], function (e, rows) { if (!e) { nextState[job[0]] = rows; } next(e); });
            }, function (err) {
                if (err) { callback(err); return; }
                if (token !== Session.token() || epoch !== generation || busy) { callback(new Error('読み込み中に状態が変わりました。再更新してください。')); return; }
                try {
                    nextState.notes = nextState.notes.filter(function (row) {
                        var recipients = nextState.recipients.filter(function (r) { return r.NoteId === String(row.Id); });
                        var own = recipients.filter(function (r) { return r.RecipientUserId === userId; });
                        if (!own.length || row.Deleted && row.SenderUserId !== userId) { return false; }
                        if (own.length !== 1) { throw new Error('付箋 ' + row.Id + ' の宛先鍵が重複しています。'); }
                        row.value = StickyCrypto.decryptJson(JSON.parse(row.EncryptedPayload), StickyCrypto.decryptRecipientKey(own[0].EncryptedNoteKey, Session.key()));
                        row.recipient = own[0]; row.recipients = recipients;
                        return !row.Deleted || !!row.value.deleted;
                    });
                    nextState.posts = nextState.posts.filter(function (row) { row.value = unseal(JSON.parse(row.EncryptedPayload)); return row.value && !row.value.deleted; });
                    nextState.comments = nextState.comments.filter(function (row) { row.value = unseal(JSON.parse(row.EncryptedPayload)); return !!row.value; });
                } catch (e2) { ErrorStore.add('復号', Util.message(e2), '既存表示は保持しました。鍵を再作成せず登録内容を確認してください。'); callback(e2); return; }
                state = nextState; callback(null);
            });
        });
    }
    function mutate(action, work, callback) {
        if (busy) { callback(new Error('処理中です。完了をお待ちください。')); return; }
        busy = true; generation += 1;
        var token = Session.token(), done = false;
        function finish(error, id) {
            if (done) { return; } done = true; busy = false;
            if (token !== Session.token()) { callback(new Error('利用者が変わりました。保存結果は再ログイン後に確認してください。')); return; }
            if (error) { ErrorStore.add(action, Util.message(error)); callback(error); return; }
            Audit.log(action, String(id || ''));
            refresh(function (e) { if (e) { ErrorStore.add('保存後の更新', Util.message(e)); } callback(null, e ? '保存済みですが再表示に失敗しました。更新してください。' : ''); });
        }
        Session.guard(function (error) { if (error) { finish(error); return; } try { work(finish); } catch (e) { finish(e); } });
    }
    function validateNote(value) {
        value.content = NoteMarkup.normalize(value.content);
        if (!Util.trim(value.title) && !Util.trim(NoteMarkup.plain(value.content)) && !/<table>/.test(value.content)) { throw new Error('タイトルまたは本文を入力してください。'); }
        if (String(value.title).length > 200 || String(value.content).length > 20000) { throw new Error('タイトル200文字・本文20000文字以内で入力してください。'); }
        if (!Util.date(value.due)) { throw new Error('期限は実在する日付を YYYY-MM-DD で入力してください。'); }
        if (value.status && ['未着手', '対応中', '保留', '完了'].indexOf(value.status) === -1) { throw new Error('タスクの状態が不正です。'); }
        value.title = Util.trim(value.title) || '無題の付箋'; value.color = Util.color(value.color);
        value.updatedAt = new Date().toISOString();
    }
    function notify(userId, type, relatedId, callback) {
        Records.save(APP_CONFIG.LIST_NOTIFICATIONS, null, { Title: 'notice', RecipientUserId: userId, NotificationType: type, RelatedId: String(relatedId), SenderUserId: actor(), IsRead: false }, function (e) {
            if (e) { ErrorStore.add('通知作成', Util.message(e), '本体の保存は成功しました。'); } callback();
        });
    }
    function nextNoteLayer() {
        var highest = 0;
        state.notes.forEach(function (row) {
            var layer = Number(row.value.zIndex);
            if (row.NoteType === 'PERSONAL' && row.SenderUserId === actor() && isFinite(layer)) { highest = Math.max(highest, layer); }
        });
        return highest + 1;
    }
    function saveNote(row, value, recipientsText, type, callback) {
        mutate(type === 'DIRECT' ? 'SEND_NOTE' : 'SAVE_NOTE', function (finish) {
            value = Util.clone(value); validateNote(value);
            if (row && (row.SenderUserId !== actor() || row.NoteType === 'DIRECT')) { throw new Error('受信付箋・送信済み付箋は編集できません。コピーして保存してください。'); }
            if (row) {
                var previous = Util.clone(row.value); delete previous.versions;
                value.versions = (row.value.versions || []).concat([previous]).slice(-30);
                var key = StickyCrypto.decryptRecipientKey(row.recipient.EncryptedNoteKey, Session.key());
                Records.save(APP_CONFIG.LIST_NOTES, row, { EncryptedPayload: JSON.stringify(StickyCrypto.encryptJson(value, key)), Deleted: !!value.deleted, Archived: !!value.archived }, function (e) { finish(e, row.Id); });
                return;
            }
            if (!type || type === 'PERSONAL') { value.zIndex = nextNoteLayer(); }
            Auth.directory(function (directoryError, users) {
                if (directoryError) { finish(directoryError); return; }
                var targets, envelope, sender = Session.user();
                try { targets = type === 'DIRECT' ? resolve(recipientsText, users) : []; envelope = seal(value, targets.concat([sender])); }
                catch (e) { finish(e); return; }
                /* Staged note is not visible until every recipient key exists. */
                Records.save(APP_CONFIG.LIST_NOTES, null, { Title: 'note', SenderUserId: actor(), NoteType: type || 'PERSONAL', EncryptedPayload: JSON.stringify(envelope.payload), CryptoVersion: StickyCrypto.VERSION, Deleted: true, Archived: false }, function (error, created) {
                    if (error) { finish(error); return; }
                    var made = [];
                    function rollback(cause) {
                        Util.each(made, function (r, next) { Records.remove(APP_CONFIG.LIST_RECIPIENTS, r, function (cleanup) { if (cleanup) { ErrorStore.add('送信後始末', Util.message(cleanup), '非公開の作業中付箋 ID ' + created.Id); } next(); }); }, function () {
                            Records.remove(APP_CONFIG.LIST_NOTES, created, function (cleanup) { if (cleanup) { ErrorStore.add('送信後始末', Util.message(cleanup), '非公開の作業中付箋 ID ' + created.Id); } finish(cause); });
                        });
                    }
                    Util.each(envelope.keys, function (entry, next) {
                        Records.save(APP_CONFIG.LIST_RECIPIENTS, null, { Title: 'recipient', NoteId: String(created.Id), RecipientUserId: entry.userId, EncryptedNoteKey: entry.key, IsRead: entry.userId === actor(), ReadAt: entry.userId === actor() ? new Date().toISOString() : null }, function (e, r) { if (!e) { made.push(r); } next(e); });
                    }, function (e) {
                        if (e) { rollback(e); return; }
                        Session.guard(function (sessionError) {
                            if (sessionError) { rollback(sessionError); return; }
                            Records.save(APP_CONFIG.LIST_NOTES, created, { Deleted: false }, function (commitError) {
                                /* A timeout has an unknown outcome: never delete after an ambiguous commit. */
                                if (commitError) { ErrorStore.add('送信確定', '保存結果を再読み込みして確認してください。', '付箋 ID ' + created.Id); finish(commitError); return; }
                                Util.each(targets.filter(function (u) { return u.StickyUserId !== actor(); }), function (u, next) { notify(u.StickyUserId, 'NOTE', created.Id, next); }, function () { finish(null, created.Id); });
                            });
                        });
                    });
                });
            });
        }, callback);
    }
    function readNote(row, callback) {
        mutate('READ_NOTE', function (finish) {
            Records.get(APP_CONFIG.LIST_RECIPIENTS, row.recipient.Id, function (error, receipt) {
                if (error) { finish(error); return; }
                if (receipt.RecipientUserId !== actor()) { finish(new Error('開封できない宛先です。')); return; }
                if (receipt.IsRead) { finish(null, row.Id); return; }
                Records.save(APP_CONFIG.LIST_RECIPIENTS, receipt, { IsRead: true, ReadAt: new Date().toISOString() }, function (e) {
                    if (e) { finish(e); return; }
                    notify(row.SenderUserId, 'READ', row.Id, function () { finish(null, row.Id); });
                });
            });
        }, callback);
    }
    function savePost(row, value, callback) {
        mutate('SAVE_POST', function (finish) {
            if (!Util.trim(value.body)) { throw new Error('投稿本文を入力してください。'); }
            if (value.body.length > 20000 || String(value.category || '').length > 100) { throw new Error('投稿本文20000文字・分類100文字以内で入力してください。'); }
            if (row && row.AuthorUserId !== actor()) { throw new Error('他の利用者の投稿は変更できません。'); }
            var existing = row && JSON.parse(row.EncryptedPayload), encrypted;
            if (row) {
                var entry = existing.keys.filter(function (k) { return k.userId === actor(); })[0];
                existing.payload = StickyCrypto.encryptJson(value, StickyCrypto.decryptRecipientKey(entry.key, Session.key())); encrypted = existing;
                Records.save(APP_CONFIG.LIST_POSTS, row, { EncryptedPayload: JSON.stringify(encrypted), IsPinned: !!value.pinned, Category: value.category || 'お知らせ' }, function (e) { finish(e, row.Id); });
            } else {
                Auth.directory(function (error, users) {
                    if (error) { finish(error); return; }
                    try { encrypted = seal(value, users); } catch (e) { finish(e); return; }
                    Records.save(APP_CONFIG.LIST_POSTS, null, { Title: 'post', AuthorUserId: actor(), Category: value.category || 'お知らせ', EncryptedPayload: JSON.stringify(encrypted), IsPinned: !!value.pinned }, function (e, r) { finish(e, r && r.Id); });
                });
            }
        }, callback);
    }
    function comment(post, text, callback) {
        mutate('COMMENT', function (finish) {
            if (!Util.trim(text) || text.length > 5000) { throw new Error('コメントは1～5000文字で入力してください。'); }
            var audience = JSON.parse(post.EncryptedPayload).keys, users = state.users.filter(function (u) { return audience.some(function (k) { return k.userId === u.StickyUserId; }); });
            var encrypted = seal({ text: Util.trim(text), createdAt: new Date().toISOString() }, users);
            Records.save(APP_CONFIG.LIST_COMMENTS, null, { Title: 'comment', PostId: String(post.Id), AuthorUserId: actor(), EncryptedPayload: JSON.stringify(encrypted), Deleted: false }, function (error, row) {
                if (error) { finish(error); return; }
                var targets = users.filter(function (u) { return u.StickyUserId !== actor() && (u.StickyUserId === post.AuthorUserId || text.indexOf('@' + u.StickyUserId + ' ') !== -1 || text.slice(-u.StickyUserId.length - 1) === '@' + u.StickyUserId); });
                Util.each(targets, function (u, next) { notify(u.StickyUserId, 'COMMENT', post.Id, next); }, function () { finish(null, row.Id); });
            });
        }, callback);
    }
    function react(post, type, callback) {
        mutate('REACTION', function (finish) {
            if (type !== 'LIKE' && !/^VOTE:\d+$/.test(type)) { throw new Error('リアクションが不正です。'); }
            if (type !== 'LIKE' && (!post.value.options || +type.split(':')[1] >= post.value.options.length)) { throw new Error('投票先が不正です。'); }
            var filter = eq('PostId', String(post.Id)) + ' and ' + eq('UserId', actor());
            Records.list(APP_CONFIG.LIST_REACTIONS, filter, function (r) { return r.PostId === String(post.Id) && r.UserId === actor(); }, function (error, rows) {
                if (error) { finish(error); return; }
                rows = rows.filter(function (r) { return type === 'LIKE' ? r.ReactionType === 'LIKE' : r.ReactionType.indexOf('VOTE:') === 0; });
                if (rows.length > 1) { finish(new Error('リアクションが重複しています。管理者に確認してください。')); return; }
                if (type === 'LIKE' && rows.length) { Records.remove(APP_CONFIG.LIST_REACTIONS, rows[0], function (e) { finish(e, post.Id); }); }
                else { Records.save(APP_CONFIG.LIST_REACTIONS, rows[0] || null, { Title: 'reaction', PostId: String(post.Id), UserId: actor(), ReactionType: type }, function (e) { finish(e, post.Id); }); }
            });
        }, callback);
    }
    function view(post, callback) {
        mutate('VIEW_POST', function (finish) {
            Records.list(APP_CONFIG.LIST_POST_VIEWS, eq('PostId', String(post.Id)) + ' and ' + eq('ViewerUserId', actor()), function (r) { return r.PostId === String(post.Id) && r.ViewerUserId === actor(); }, function (error, rows) {
                if (error || rows.length > 1) { finish(error || new Error('閲覧履歴が重複しています。')); return; }
                var now = new Date().toISOString();
                Records.save(APP_CONFIG.LIST_POST_VIEWS, rows[0] || null, { Title: 'view', PostId: String(post.Id), ViewerUserId: actor(), FirstViewedAt: rows.length ? rows[0].FirstViewedAt : now, LastViewedAt: now, ViewCount: rows.length ? Number(rows[0].ViewCount) + 1 : 1 }, function (e) { finish(e, post.Id); });
            });
        }, callback);
    }
    function readNotifications(callback) {
        mutate('READ_NOTIFICATIONS', function (finish) {
            Util.each(state.notifications.filter(function (r) { return !r.IsRead && r.RecipientUserId === actor(); }), function (r, next) { Records.save(APP_CONFIG.LIST_NOTIFICATIONS, r, { IsRead: true }, next); }, finish);
        }, callback);
    }
    return { state: function () { return state; }, reset: reset, refresh: refresh, busy: function () { return busy; }, resolve: resolve, seal: seal, unseal: unseal, validateNote: validateNote,
        nextNoteLayer: nextNoteLayer, saveNote: saveNote, readNote: readNote, savePost: savePost, comment: comment, react: react, view: view, readNotifications: readNotifications };
}());

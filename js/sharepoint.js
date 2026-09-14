/* SharePoint verbose REST; no fetch/Promise/ES2015 dependency. */
var SharePoint = (function () {
    'use strict';
    var digest = null, digestUntil = 0, waiting = null, types = {};
    function endpoint(url) {
        var base = String(APP_CONFIG.SHAREPOINT_BASE_URL || '').replace(/\/+$/, '');
        if (!/^https?:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(base)) { throw new Error('SharePointサイトURLが不正です。'); }
        if (url.indexOf('/_api/') === 0) { return base + url; }
        if (url.indexOf(base + '/_api/') === 0) { return url; }
        /* A paging link must never receive credentials or a digest on another site. */
        var anchor = document.createElement('a'); anchor.href = base;
        if (url.indexOf('/') === 0 && (anchor.protocol + '//' + anchor.host + url).indexOf(base + '/_api/') === 0) { return anchor.protocol + '//' + anchor.host + url; }
        throw new Error('別サイトを指すREST URLを拒否しました。');
    }
    function request(method, url, data, headers, callback) {
        var xhr, key, finished = false;
        function finish(result) {
            if (finished) { return; } finished = true;
            if (!result.ok) { ErrorStore.add('SharePoint REST', result.error || ('HTTP ' + result.status), method + ' ' + url.split('?')[0]); }
            callback(result);
        }
        try {
            xhr = new XMLHttpRequest();
            xhr.open(method, endpoint(url), true); xhr.timeout = 30000; xhr.withCredentials = true;
            xhr.setRequestHeader('Accept', 'application/json;odata=verbose');
            if (data !== null) { xhr.setRequestHeader('Content-Type', 'application/json;odata=verbose'); }
            for (key in headers) { if (Object.prototype.hasOwnProperty.call(headers, key)) { xhr.setRequestHeader(key, headers[key]); } }
            xhr.onload = function () {
                var status = xhr.status === 1223 ? 204 : xhr.status, parsed = null;
                if (status < 200 || status >= 300) {
                    finish({ ok: false, status: status, error: status === 412 ? '別の操作で更新されました。再読み込みしてください。' : 'HTTP ' + status + '：' + ({ 401: '認証を確認してください。', 403: '権限またはRequestDigestを確認してください。', 404: 'サイト・リスト・列名を確認してください。', 429: 'アクセスが集中しています。時間をおいて再試行してください。' }[status] || 'SharePoint処理に失敗しました。') }); return;
                }
                try { parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null; }
                catch (e) { finish({ ok: false, status: status, error: 'JSONではない応答です。ログイン画面への転送やHTML配置制限を確認してください。' }); return; }
                finish({ ok: true, status: status, data: parsed, etag: xhr.getResponseHeader('ETag') });
            };
            xhr.onerror = function () { finish({ ok: false, status: 0, error: '通信失敗：接続先・同一オリジン・CORS・証明書を確認してください。' }); };
            xhr.ontimeout = function () { finish({ ok: false, status: 0, error: '通信がタイムアウトしました。書き込み結果を再読み込みして確認してください。' }); };
            xhr.onabort = function () { finish({ ok: false, status: 0, error: '通信が中断されました。' }); };
            xhr.send(data === null ? null : JSON.stringify(data));
        } catch (e) { finish({ ok: false, status: 0, error: Util.message(e) }); }
    }
    function get(url, callback) { request('GET', url, null, {}, callback); }
    function getRequestDigest(callback) {
        if (digest && digestUntil > new Date().getTime()) { callback({ ok: true, value: digest }); return; }
        if (waiting) { waiting.push(callback); return; }
        waiting = [callback];
        request('POST', '/_api/contextinfo', null, {}, function (result) {
            var info = result.data && result.data.d && result.data.d.GetContextWebInformation, callbacks = waiting, i, answer;
            waiting = null;
            if (result.ok && info && info.FormDigestValue) {
                digest = info.FormDigestValue; digestUntil = new Date().getTime() + Math.max(1, (Number(info.FormDigestTimeoutSeconds) || 60) - 15) * 1000;
                answer = { ok: true, value: digest };
            } else { answer = { ok: false, status: result.status, error: result.error || 'RequestDigestが応答にありません。' }; }
            for (i = 0; i < callbacks.length; i += 1) { callbacks[i](answer); }
        });
    }
    function write(url, data, headers, callback) {
        getRequestDigest(function (result) {
            if (!result.ok) { callback(result); return; }
            headers['X-RequestDigest'] = result.value;
            request('POST', url, data, headers, function (answer) { if (answer.status === 403) { digest = null; } callback(answer); });
        });
    }
    function literal(value) { return "'" + encodeURIComponent(String(value).replace(/'/g, "''")).replace(/'/g, '%27') + "'"; }
    function listUrl(title) { return '/_api/web/lists/getbytitle(' + literal(title) + ')'; }
    function itemUrl(title, id) { if (!/^\d+$/.test(String(id))) { throw new Error('リストIDが不正です。'); } return listUrl(title) + '/items(' + id + ')'; }
    function rows(url, callback) {
        var collected = [], seen = {};
        function next(link) {
            if (seen[link]) { callback({ ok: false, error: 'ページ送りが循環しています。' }); return; } seen[link] = true;
            get(link, function (result) {
                var data = result.data && result.data.d;
                if (!result.ok) { callback(result); return; }
                if (!data || !Array.isArray(data.results)) { callback({ ok: false, error: 'リスト応答形式が不正です。' }); return; }
                collected = collected.concat(data.results);
                if (data.__next) { next(data.__next); } else { callback({ ok: true, data: collected }); }
            });
        }
        next(url);
    }
    function payload(title, fields, callback) {
        function done(type) { var data = Util.clone(fields); data.__metadata = { type: type }; callback(null, data); }
        if (types[title]) { done(types[title]); return; }
        get(listUrl(title) + '?$select=ListItemEntityTypeFullName', function (result) {
            var type = result.data && result.data.d && result.data.d.ListItemEntityTypeFullName;
            if (!result.ok || !type) { callback(result.error || 'リストの型を確認できません。'); return; }
            types[title] = type; done(type);
        });
    }
    function create(title, fields, callback) { payload(title, fields, function (error, data) { if (error) { callback({ ok: false, error: error }); return; } write(listUrl(title) + '/items', data, {}, callback); }); }
    function updateItem(title, row, fields, callback) {
        var etag = row.__metadata && row.__metadata.etag;
        if (!etag) { callback({ ok: false, error: '競合確認用ETagがありません。再読み込みしてください。' }); return; }
        payload(title, fields, function (error, data) { if (error) { callback({ ok: false, error: error }); return; } write(itemUrl(title, row.Id), data, { 'IF-MATCH': etag, 'X-HTTP-Method': 'MERGE' }, callback); });
    }
    function deleteItem(title, row, callback) {
        var etag = row.__metadata && row.__metadata.etag;
        if (!etag) { callback({ ok: false, error: '削除対象のETagがありません。' }); return; }
        write(itemUrl(title, row.Id), null, { 'IF-MATCH': etag, 'X-HTTP-Method': 'DELETE' }, callback);
    }
    return { get: get, listUrl: listUrl, itemUrl: itemUrl, literal: literal, allPages: rows, getRequestDigest: getRequestDigest, createListItem: create, updateItem: updateItem, deleteItem: deleteItem,
        listItems: function (title, query, cb) { rows(listUrl(title) + '/items' + (query || ''), cb); },
        getCurrentUser: function (cb) { get('/_api/web/currentuser', function (r) { var d = r.data && r.data.d; cb(r.ok && d ? null : new Error(r.error || 'ログイン利用者を取得できません。'), d); }); }
    };
}());

/* Read-only diagnostics. Lists and columns are created manually by an administrator. */
var SharePointSetup = (function () {
    var definitions = [
        { title: 'StickyUsers', fields: [{ name: 'StickyUserId', type: 'SP.FieldText', kind: 2, required: true }, { name: 'SharePointUserId', type: 'SP.FieldText', kind: 2 }, { name: 'LoginName', type: 'SP.FieldText', kind: 2 }, { name: 'Organization', type: 'SP.FieldText', kind: 2 }, { name: 'DisplayName', type: 'SP.FieldText', kind: 2 }, { name: 'PasswordHash', type: 'SP.FieldNote', kind: 3 }, { name: 'PasswordSalt', type: 'SP.FieldText', kind: 2 }, { name: 'PublicKey', type: 'SP.FieldNote', kind: 3 }, { name: 'EncryptedPrivateKey', type: 'SP.FieldNote', kind: 3 }, { name: 'CryptoVersion', type: 'SP.FieldText', kind: 2 }, { name: 'CurrentSessionHash', type: 'SP.FieldText', kind: 2 }, { name: 'CurrentDeviceId', type: 'SP.FieldText', kind: 2 }, { name: 'LastLoginAt', type: 'SP.FieldDateTime', kind: 4 }, { name: 'Enabled', type: 'SP.FieldBoolean', kind: 8 }] },
        { title: 'StickySessions', fields: [{ name: 'UserId', type: 'SP.FieldText', kind: 2, required: true }, { name: 'DeviceId', type: 'SP.FieldText', kind: 2 }, { name: 'TokenHash', type: 'SP.FieldText', kind: 2 }, { name: 'CreatedAt', type: 'SP.FieldDateTime', kind: 4 }, { name: 'LastAccessAt', type: 'SP.FieldDateTime', kind: 4 }, { name: 'ExpiresAt', type: 'SP.FieldDateTime', kind: 4 }, { name: 'Revoked', type: 'SP.FieldBoolean', kind: 8 }, { name: 'UserAgent', type: 'SP.FieldNote', kind: 3 }] },
        { title: 'StickyNotes', fields: [{ name: 'SenderUserId', type: 'SP.FieldText', kind: 2 }, { name: 'NoteType', type: 'SP.FieldText', kind: 2 }, { name: 'EncryptedPayload', type: 'SP.FieldNote', kind: 3 }, { name: 'CryptoVersion', type: 'SP.FieldText', kind: 2 }, { name: 'Deleted', type: 'SP.FieldBoolean', kind: 8 }, { name: 'Archived', type: 'SP.FieldBoolean', kind: 8 }] },
        { title: 'StickyRecipients', fields: [{ name: 'NoteId', type: 'SP.FieldText', kind: 2 }, { name: 'RecipientUserId', type: 'SP.FieldText', kind: 2 }, { name: 'EncryptedNoteKey', type: 'SP.FieldNote', kind: 3 }, { name: 'IsRead', type: 'SP.FieldBoolean', kind: 8 }, { name: 'ReadAt', type: 'SP.FieldDateTime', kind: 4 }] },
        { title: 'StickyPosts', fields: [{ name: 'AuthorUserId', type: 'SP.FieldText', kind: 2 }, { name: 'Category', type: 'SP.FieldText', kind: 2 }, { name: 'EncryptedPayload', type: 'SP.FieldNote', kind: 3 }, { name: 'IsPinned', type: 'SP.FieldBoolean', kind: 8 }] },
        { title: 'StickyPostViews', fields: [{ name: 'PostId', type: 'SP.FieldText', kind: 2 }, { name: 'ViewerUserId', type: 'SP.FieldText', kind: 2 }, { name: 'FirstViewedAt', type: 'SP.FieldDateTime', kind: 4 }, { name: 'LastViewedAt', type: 'SP.FieldDateTime', kind: 4 }, { name: 'ViewCount', type: 'SP.FieldNumber', kind: 9 }] },
        { title: 'StickyComments', fields: [{ name: 'PostId', type: 'SP.FieldText', kind: 2 }, { name: 'AuthorUserId', type: 'SP.FieldText', kind: 2 }, { name: 'EncryptedPayload', type: 'SP.FieldNote', kind: 3 }, { name: 'Deleted', type: 'SP.FieldBoolean', kind: 8 }] },
        { title: 'StickyReactions', fields: [{ name: 'PostId', type: 'SP.FieldText', kind: 2 }, { name: 'UserId', type: 'SP.FieldText', kind: 2 }, { name: 'ReactionType', type: 'SP.FieldText', kind: 2 }] },
        { title: 'StickyGroups', fields: [{ name: 'GroupKey', type: 'SP.FieldText', kind: 2, required: true }, { name: 'DisplayName', type: 'SP.FieldText', kind: 2, required: true }, { name: 'Enabled', type: 'SP.FieldBoolean', kind: 8 }] },
        { title: 'StickyGroupMembers', fields: [{ name: 'GroupKey', type: 'SP.FieldText', kind: 2, required: true }, { name: 'UserId', type: 'SP.FieldText', kind: 2, required: true }, { name: 'Enabled', type: 'SP.FieldBoolean', kind: 8 }] },
        { title: 'StickyNotifications', fields: [{ name: 'RecipientUserId', type: 'SP.FieldText', kind: 2 }, { name: 'NotificationType', type: 'SP.FieldText', kind: 2 }, { name: 'RelatedId', type: 'SP.FieldText', kind: 2 }, { name: 'SenderUserId', type: 'SP.FieldText', kind: 2 }, { name: 'IsRead', type: 'SP.FieldBoolean', kind: 8 }] }
    ];

    function check(callback) {
        var failures = [];
        Util.each(definitions, function (definition, next) {
            SharePoint.get(SharePoint.listUrl(definition.title) + '/fields?$select=InternalName,FieldTypeKind,RichText', function (r) {
                var rows = r.data && r.data.d && r.data.d.results || [], i, j, found;
                if (!r.ok) { failures.push(definition.title + ': ' + r.error); next(); return; }
                for (i = 0; i < definition.fields.length; i += 1) {
                    found = null;
                    for (j = 0; j < rows.length; j += 1) { if (rows[j].InternalName === definition.fields[i].name) { found = rows[j]; } }
                    if (!found || found.FieldTypeKind !== definition.fields[i].kind || (found.FieldTypeKind === 3 && found.RichText)) { failures.push(definition.title + '.' + definition.fields[i].name + ': 列不足・型不一致・リッチテキスト設定'); }
                }
                next();
            });
        }, function () { var i; for (i = 0; i < failures.length; i += 1) { ErrorStore.add('リスト診断', failures[i]); } callback(failures); });
    }
    return { definitions: definitions, check: check };
}());

/* Identical callback contract in local and SharePoint modes. Filters are explicit. */
var Records = {
    list: function (title, filter, predicate, callback) {
        if (APP_CONFIG.USE_SHAREPOINT) {
            SharePoint.listItems(title, '?$top=500' + (filter ? '&$filter=' + filter : ''), function (r) { callback(r.ok ? null : new Error(r.error), r.data); });
        } else {
            try { callback(null, Storage.get('fsn_table_' + title, []).filter(predicate || function () { return true; })); }
            catch (e) { callback(e); }
        }
    },
    get: function (title, id, callback) {
        this.list(title, 'Id eq ' + Number(id), function (r) { return String(r.Id) === String(id); }, function (e, rows) { callback(e || (!rows.length ? new Error('対象が見つかりません。') : null), rows && rows[0]); });
    },
    save: function (title, row, fields, callback) {
        if (APP_CONFIG.USE_SHAREPOINT) {
            var finish = function (r) {
                if (!r.ok) { callback(new Error(r.error || '保存に失敗しました。')); return; }
                var saved = r.data && r.data.d;
                Records.get(title, saved && saved.Id || row.Id, callback);
            };
            if (row) { SharePoint.updateItem(title, row, fields, finish); } else { SharePoint.createListItem(title, fields, finish); }
        } else {
            try {
                var rows = Storage.get('fsn_table_' + title, []), saved = null, i, key, max = 0;
                for (i = 0; i < rows.length; i += 1) {
                    max = Math.max(max, rows[i].Id);
                    if (row && row.Id === rows[i].Id) {
                        if (row._rev !== rows[i]._rev) { throw new Error('別の操作で更新されました。再読み込みしてください。'); }
                        saved = rows[i];
                    }
                }
                if (row && !saved) { throw new Error('更新対象が削除されています。'); }
                if (!saved) { saved = { Id: max + 1, _rev: 0 }; rows.push(saved); }
                for (key in fields) { if (Object.prototype.hasOwnProperty.call(fields, key)) { saved[key] = fields[key]; } }
                saved._rev += 1; Storage.set('fsn_table_' + title, rows); callback(null, Util.clone(saved));
            } catch (e) { callback(e); }
        }
    },
    remove: function (title, row, callback) {
        if (APP_CONFIG.USE_SHAREPOINT) { SharePoint.deleteItem(title, row, function (r) { callback(r.ok ? null : new Error(r.error)); }); return; }
        try {
            var rows = Storage.get('fsn_table_' + title, []), found = false;
            rows = rows.filter(function (r) { if (r.Id !== row.Id) { return true; } if (r._rev !== row._rev) { throw new Error('削除対象が更新されています。'); } found = true; return false; });
            if (!found) { throw new Error('削除対象がありません。'); }
            Storage.set('fsn_table_' + title, rows); callback(null);
        } catch (e) { callback(e); }
    }
};

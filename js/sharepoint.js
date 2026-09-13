var SharePoint = (function () {
    'use strict';
    var digest = null;
    function endpoint(url) { return (APP_CONFIG.SHAREPOINT_BASE_URL || '') + url; }
    function request(method, url, data, headers, callback) {
        var xhr = new XMLHttpRequest(), key;
        xhr.open(method, endpoint(url), true);
        xhr.setRequestHeader('Accept', 'application/json;odata=verbose');
        if (data) { xhr.setRequestHeader('Content-Type', 'application/json;odata=verbose'); }
        for (key in (headers || {})) { if (headers.hasOwnProperty(key)) { xhr.setRequestHeader(key, headers[key]); } }
        xhr.onreadystatechange = function () {
            var result;
            if (xhr.readyState !== 4) { return; }
            result = { ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data: null, raw: xhr.responseText };
            try { result.data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (ignore) { result.data = xhr.responseText; }
            if (callback) { callback(result); }
        };
        xhr.send(data ? JSON.stringify(data) : null);
    }
    function getRequestDigest(callback) {
        if (digest) { callback({ ok: true, value: digest }); return; }
        request('POST', '/_api/contextinfo', null, {}, function (result) {
            if (result.ok && result.data && result.data.d && result.data.d.GetContextWebInformation) { digest = result.data.d.GetContextWebInformation.FormDigestValue; }
            callback({ ok: !!digest, value: digest, result: result });
        });
    }
    function write(method, url, data, callback, extraHeaders) {
        getRequestDigest(function (token) {
            if (!token.ok) { if (callback) { callback({ ok: false, status: 0, error: 'RequestDigestを取得できませんでした。' }); } return; }
            var headers = { 'X-RequestDigest': token.value };
            if (extraHeaders) { var key; for (key in extraHeaders) { if (extraHeaders.hasOwnProperty(key)) { headers[key] = extraHeaders[key]; } } }
            request(method, url, data, headers, callback);
        });
    }
    function get(url, callback) { request('GET', url, null, {}, callback); }
    function post(url, data, callback) { write('POST', url, data, callback); }
    function update(url, data, etag, callback) { write('POST', url, data, callback, { 'IF-MATCH': etag || '*', 'X-HTTP-Method': 'MERGE' }); }
    function remove(url, etag, callback) { write('POST', url, null, callback, { 'IF-MATCH': etag || '*', 'X-HTTP-Method': 'DELETE' }); }
    function listItems(listTitle, query, callback) { var url = "/_api/web/lists/getbytitle('" + encodeURIComponent(listTitle) + "')/items" + (query || ''); get(url, callback); }
    function getListItemEntityType(listTitle, callback) { get("/_api/web/lists/getbytitle('" + encodeURIComponent(listTitle) + "')?$select=ListItemEntityTypeFullName", function (result) { callback(result.ok && result.data && result.data.d ? result.data.d.ListItemEntityTypeFullName : null, result); }); }
    function createListItem(listTitle, fields, callback) { getListItemEntityType(listTitle, function (entityType, entityResult) { var payload, key; if (!entityType) { callback({ ok: false, result: entityResult }); return; } payload = { '__metadata': { type: entityType } }; for (key in fields) { if (fields.hasOwnProperty(key)) { payload[key] = fields[key]; } } post("/_api/web/lists/getbytitle('" + encodeURIComponent(listTitle) + "')/items", payload, callback); }); }
    function allPages(url, callback, results) { results = results || []; get(url, function (result) { var next; if (!result.ok) { callback(result); return; } if (result.data && result.data.d && result.data.d.results) { results = results.concat(result.data.d.results); } next = result.data && result.data.d ? result.data.d.__next : null; if (next) { allPages(next, callback, results); } else { callback({ ok: true, status: result.status, data: results }); } }); }
    function getCurrentUser(callback) { get('/_api/web/currentuser', function (result) { var user = null; if (result.ok && result.data && result.data.d) { user = { sharePointUserId: result.data.d.Id, loginName: result.data.d.LoginName, displayName: result.data.d.Title || result.data.d.LoginName }; } callback({ ok: result.ok, user: user, result: result }); }); }
    return { get: get, post: post, update: update, remove: remove, getRequestDigest: getRequestDigest, listItems: listItems, createListItem: createListItem, allPages: allPages, getCurrentUser: getCurrentUser, clearDigest: function () { digest = null; } };
}());

/* Specification-compatible aliases. */
function spGet(url, callback) { SharePoint.get(url, callback); }
function spPost(url, data, callback) { SharePoint.post(url, data, callback); }
function spUpdate(url, data, etag, callback) { SharePoint.update(url, data, etag, callback); }
function spDelete(url, etag, callback) { SharePoint.remove(url, etag, callback); }
function getRequestDigest(callback) { SharePoint.getRequestDigest(callback); }

var SharePointSetup = (function () {
    function listUrl(title) { return "/_api/web/lists/getbytitle('" + encodeURIComponent(title) + "')"; }
    function ensureList(title, callback) {
        SharePoint.get(listUrl(title), function (result) {
            if (result.ok) { callback({ ok: true, existing: true }); return; }
            SharePoint.post('/_api/web/lists', { '__metadata': { type: 'SP.List' }, BaseTemplate: 100, Title: title, AllowContentTypes: true }, function (created) { callback({ ok: created.ok, existing: false, result: created }); });
        });
    }
    function ensureField(listTitle, field, callback) {
        SharePoint.get(listUrl(listTitle) + "/fields/getbyinternalnameortitle('" + encodeURIComponent(field.name) + "')", function (found) {
            if (found.ok) { callback({ ok: true, existing: true }); return; }
            SharePoint.post(listUrl(listTitle) + '/fields', { '__metadata': { type: field.type }, Title: field.name, FieldTypeKind: field.kind, Required: !!field.required }, function (created) { callback({ ok: created.ok, existing: false, result: created }); });
        });
    }
    function provisionDefinition(definition, callback) {
        ensureList(definition.title, function (listResult) {
            if (!listResult.ok) { callback(listResult); return; }
            var index = 0;
            function next() {
                if (index >= definition.fields.length) { callback({ ok: true }); return; }
                ensureField(definition.title, definition.fields[index], function (fieldResult) { index += 1; if (!fieldResult.ok) { callback(fieldResult); return; } next(); });
            }
            next();
        });
    }
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
    function provisionCoreLists(callback) {
        var index = 0;
        function next(result) { if (result && !result.ok) { callback(result); return; } if (index >= definitions.length) { callback({ ok: true }); return; } provisionDefinition(definitions[index], function (itemResult) { index += 1; next(itemResult); }); }
        next();
    }
    return { provisionCoreLists: provisionCoreLists, definitions: definitions };
}());

var StickyUsersApi = (function () {
    function escapeOData(value) { return String(value || '').replace(/'/g, "''"); }
    function ensureUser(user, callback) {
        var filter = "?$select=Id,StickyUserId&$filter=LoginName eq '" + escapeOData(user.loginName) + "'";
        SharePoint.listItems('StickyUsers', filter, function (result) {
            var records = result.ok && result.data && result.data.d ? result.data.d.results : [];
            if (records && records.length) { callback({ ok: true, itemId: records[0].Id, stickyUserId: records[0].StickyUserId, existing: true }); return; }
            SharePoint.createListItem('StickyUsers', { Title: user.displayName, StickyUserId: user.userId, SharePointUserId: String(user.sharePointUserId || ''), LoginName: user.loginName, Organization: user.organization || '', DisplayName: user.displayName, PublicKey: user.publicKey || '', CryptoVersion: user.publicKey ? StickyCrypto.VERSION : '', Enabled: true }, function (created) {
                callback({ ok: created.ok, itemId: created.data && created.data.d ? created.data.d.Id : null, stickyUserId: user.userId, existing: false, result: created });
            });
        });
    }
    function findByDisplayNames(names, callback) {
        var index = 0, found = [];
        function next() {
            var name, filter;
            if (index >= names.length) { callback({ ok: true, users: found }); return; }
            name = names[index];
            filter = "?$select=StickyUserId,DisplayName,PublicKey&$filter=DisplayName eq '" + escapeOData(name) + "'";
            SharePoint.listItems('StickyUsers', filter, function (result) {
                var records = result.ok && result.data && result.data.d ? result.data.d.results : [];
                if (!result.ok || !records.length || !records[0].PublicKey) { callback({ ok: false, message: '宛先の公開鍵が見つかりません：' + name }); return; }
                found.push(records[0]);
                index += 1;
                next();
            });
        }
        next();
    }
    return { ensureUser: ensureUser, findByDisplayNames: findByDisplayNames };
}());

var StickyGroupsApi = (function () {
    function escapeOData(value) { return String(value || '').replace(/'/g, "''"); }
    function ensureMembership(groupKey, userId, callback) {
        var groupFilter = "?$select=Id&$filter=GroupKey eq '" + escapeOData(groupKey) + "'";
        SharePoint.listItems('StickyGroups', groupFilter, function (groupResult) {
            var groups = groupResult.ok && groupResult.data && groupResult.data.d ? groupResult.data.d.results : [];
            function member() {
                var memberFilter = "?$select=Id&$filter=GroupKey eq '" + escapeOData(groupKey) + "' and UserId eq '" + escapeOData(userId) + "'";
                SharePoint.listItems('StickyGroupMembers', memberFilter, function (memberResult) {
                    var members = memberResult.ok && memberResult.data && memberResult.data.d ? memberResult.data.d.results : [];
                    if (members.length) { callback({ ok: true, existing: true }); return; }
                    SharePoint.createListItem('StickyGroupMembers', { Title: groupKey + ':' + userId, GroupKey: groupKey, UserId: userId, Enabled: true }, callback);
                });
            }
            if (groups.length) { member(); return; }
            SharePoint.createListItem('StickyGroups', { Title: groupKey, GroupKey: groupKey, DisplayName: groupKey, Enabled: true }, function (created) { if (!created.ok) { callback(created); return; } member(); });
        });
    }
    return { ensureMembership: ensureMembership };
}());

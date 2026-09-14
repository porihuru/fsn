/* Large encrypted JSON uses immutable attachments on hidden storage records.
 * Upload first, commit the reference second. Never remove an attachment after
 * an ambiguous write: an already-committed note could be referencing it. */
var PayloadStore = (function () {
    'use strict';
    var version = 'FSN-PAYLOAD-ATTACHMENT-V1';
    function prepare(fields, callback) {
        var value = fields.EncryptedPayload, token = Session.token(), name = 'payload-' + Util.uid() + '.json';
        Session.guard(function (error) {
            if (error) { callback(error); return; }
            Records.save(APP_CONFIG.LIST_NOTES, null, { Title: 'encrypted-storage', SenderUserId: Session.user().userId, NoteType: 'BLOB', Deleted: true, Archived: false, EncryptedPayload: '', CryptoVersion: StickyCrypto.VERSION }, function (saveError, row) {
                if (saveError) { callback(saveError); return; }
                SharePoint.addAttachment(row.Id, name, value, function (answer) {
                    if (!answer.ok) { callback(new Error('暗号化した写真・本文を保存できません。StickyNotesの添付ファイル設定・権限・容量を確認してください。' + (answer.error || ''))); return; }
                    if (token !== Session.token()) { callback(new Error('利用者が変わったため保存を中止しました。')); return; }
                    Session.guard(function (guardError) {
                        if (guardError) { callback(guardError); return; }
                        var prepared = Util.clone(fields);
                        prepared.EncryptedPayload = JSON.stringify({ storage: version, itemId: row.Id, name: name, hash: Util.hash(value) }); callback(null, prepared);
                    });
                });
            });
        });
    }
    function resolveRows(rows, callback) {
        Util.each(rows, function (row, next) {
            var pointer;
            try { pointer = row.EncryptedPayload && JSON.parse(row.EncryptedPayload); } catch (e) { next(); return; }
            if (!pointer || pointer.storage !== version) { next(); return; }
            if (!/^[1-9][0-9]*$/.test(String(pointer.itemId)) || !/^payload-[a-f0-9]{32}\.json$/.test(pointer.name) || !/^[a-f0-9]{64}$/.test(pointer.hash)) { next(new Error('写真・本文の保存先情報が不正です。')); return; }
            SharePoint.getAttachment(pointer.itemId, pointer.name, function (answer) {
                if (!answer.ok) { next(new Error('暗号化した写真・本文を読み込めません。添付ファイルと権限を確認してください。' + (answer.error || ''))); return; }
                var text;
                try {
                    text = JSON.stringify(answer.data);
                    if (!text || text.length > 8 * 1024 * 1024 || Util.hash(text) !== pointer.hash) { throw new Error('写真・本文の添付データが一致しません。'); }
                    row.EncryptedPayload = text;
                } catch (e) { next(e); return; }
                next();
            });
        }, function (error) { callback(error, error ? null : rows); });
    }
    return { prepare: prepare, resolveRows: resolveRows };
}());

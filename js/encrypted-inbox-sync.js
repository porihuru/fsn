function loadEncryptedInbox() {
    var user = Storage.get('sticky_user', {}), filter;
    if (!APP_CONFIG.USE_SHAREPOINT || !APP_CONFIG.SHAREPOINT_BASE_URL || !window.StickySessionPrivateKey) { return; }
    filter = "?$select=Id,NoteId,EncryptedNoteKey,IsRead&$filter=RecipientUserId eq '" + String(user.userId).replace(/'/g, "''") + "'";
    SharePoint.listItems('StickyRecipients', filter, function (recipients) {
        var rows = recipients.ok && recipients.data && recipients.data.d ? recipients.data.d.results : [], inbox = [], index = 0;
        function next() {
            var row, noteFilter;
            if (index >= rows.length) { Storage.set('sticky_remote_inbox', inbox); if (document.getElementById('panel-inbox').className.indexOf('active') !== -1) { renderInbox(); } return; }
            row = rows[index++];
            noteFilter = "?$select=Id,EncryptedPayload,SenderUserId&$filter=Id eq " + row.NoteId;
            SharePoint.listItems('StickyNotes', noteFilter, function (notes) {
                var records = notes.ok && notes.data && notes.data.d ? notes.data.d.results : [], key, data;
                try { if (records.length) { key = StickyCrypto.decryptRecipientKey(row.EncryptedNoteKey, window.StickySessionPrivateKey); data = StickyCrypto.decryptJson(JSON.parse(records[0].EncryptedPayload), key); inbox.push({ id: 'sp-' + records[0].Id, title: data.title, content: data.content, sender: records[0].SenderUserId, sentAt: data.savedAt, read: !!row.IsRead, sharePointRecipient: row }); } } catch (error) { Audit.log('DECRYPT_INBOX_FAILED', row.NoteId); }
                next();
            });
        }
        next();
    });
}
document.addEventListener('DOMContentLoaded', function () { loadEncryptedInbox(); window.setInterval(loadEncryptedInbox, APP_CONFIG.MESSAGE_INTERVAL); });

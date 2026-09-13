function syncEncryptedPersonalNote(note) {
    var user = Storage.get('sticky_user', {}), contentKey, payload, wrappedKey;
    if (!APP_CONFIG.USE_SHAREPOINT || !APP_CONFIG.SHAREPOINT_BASE_URL || !user.publicKey || !window.StickyCrypto) { return; }
    try {
        contentKey = StickyCrypto.generateContentKey();
        payload = StickyCrypto.encryptJson(note, contentKey);
        wrappedKey = StickyCrypto.encryptKeyForRecipient(contentKey, user.publicKey);
    } catch (error) { Fsn.toast('付箋の暗号化に失敗しました。'); return; }
    SharePoint.createListItem('StickyNotes', { Title: 'Encrypted note', SenderUserId: user.userId, NoteType: 'PERSONAL', EncryptedPayload: JSON.stringify(payload), CryptoVersion: StickyCrypto.VERSION, Deleted: false, Archived: false }, function (created) {
        var itemId;
        if (!created.ok || !created.data || !created.data.d) { Fsn.toast('SharePointへの暗号化付箋保存に失敗しました。'); return; }
        itemId = String(created.data.d.Id);
        SharePoint.createListItem('StickyRecipients', { Title: 'Recipient key', NoteId: itemId, RecipientUserId: user.userId, EncryptedNoteKey: wrappedKey, IsRead: true, ReadAt: new Date().toISOString() }, function (recipient) {
            if (recipient.ok) { Audit.log('SYNC_ENCRYPTED_NOTE', itemId); }
        });
    });
}

function syncEncryptedDirectNote(note, names) {
    var user = Storage.get('sticky_user', {}), groups = { '開発部': ['鈴木 一郎', '田中 花子'], '営業部': ['佐藤 花子'], '企画部': ['高橋 健'], '総務部': ['田中 花子'] }, expanded = [], contentKey, payload, i, j, name;
    if (!APP_CONFIG.USE_SHAREPOINT || !APP_CONFIG.SHAREPOINT_BASE_URL) { return; }
    for (i = 0; i < names.length; i += 1) { name = String(names[i]).replace(/^\s+|\s+$/g, ''); if (groups[name]) { for (j = 0; j < groups[name].length; j += 1) { if (expanded.indexOf(groups[name][j]) === -1) { expanded.push(groups[name][j]); } } } else if (name && expanded.indexOf(name) === -1) { expanded.push(name); } }
    StickyUsersApi.findByDisplayNames(expanded, function (lookup) {
        var recipients = lookup.users || [];
        if (!lookup.ok) { Fsn.toast(lookup.message); return; }
        try { contentKey = StickyCrypto.generateContentKey(); payload = StickyCrypto.encryptJson(note, contentKey); } catch (error) { Fsn.toast('付箋の暗号化に失敗しました。'); return; }
        SharePoint.createListItem('StickyNotes', { Title: 'Encrypted note', SenderUserId: user.userId, NoteType: 'DIRECT', EncryptedPayload: JSON.stringify(payload), CryptoVersion: StickyCrypto.VERSION, Deleted: false, Archived: false }, function (created) {
            var noteId, pending = recipients.length;
            if (!created.ok || !created.data || !created.data.d) { Fsn.toast('SharePointへの暗号化付箋保存に失敗しました。'); return; }
            noteId = String(created.data.d.Id);
            for (i = 0; i < recipients.length; i += 1) {
                (function (recipient) { SharePoint.createListItem('StickyRecipients', { Title: 'Recipient key', NoteId: noteId, RecipientUserId: recipient.StickyUserId, EncryptedNoteKey: StickyCrypto.encryptKeyForRecipient(contentKey, recipient.PublicKey), IsRead: false }, function (result) { pending -= 1; if (!result.ok) { Fsn.toast('宛先鍵の保存に失敗しました。'); } if (pending === 0) { Audit.log('SYNC_ENCRYPTED_DIRECT_NOTE', noteId); } }); }(recipients[i]));
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    var originalSave = Fsn.save;
    Fsn.save = function () {
        var recipient = document.getElementById('note-recipient'), title = document.getElementById('note-title'), content = document.getElementById('note-content'), color = document.getElementById('note-color'), due = document.getElementById('note-due'), note;
        note = { title: title.value || '無題の付箋', content: content.value, color: color.value, due: due.value, savedAt: new Date().toISOString() };
        originalSave();
        if (recipient && recipient.value) { syncEncryptedDirectNote(note, recipient.value.split(/[,、]/)); } else { syncEncryptedPersonalNote(note); }
    };
});

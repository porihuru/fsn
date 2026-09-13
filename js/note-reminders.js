function checkNoteReminders() {
    var notes = Storage.get('sticky_notes', []), sent = Storage.get('sticky_note_reminders', {}), now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), i, note, due, days, key;
    for (i = 0; i < notes.length; i += 1) {
        note = notes[i];
        if (note.deleted || note.archived || !note.due) { continue; }
        due = new Date(note.due + 'T00:00:00');
        if (isNaN(due.getTime())) { continue; }
        days = Math.floor((due.getTime() - today.getTime()) / 86400000);
        key = note.id + ':' + note.due;
        if (days < 0 && !sent[key + ':overdue']) {
            NotificationStore.add('付箋の期限切れ', '「' + note.title + '」は期限を過ぎています。');
            sent[key + ':overdue'] = true;
        } else if (days >= 0 && days <= 1 && !sent[key + ':soon']) {
            NotificationStore.add('付箋の期限が近づいています', '「' + note.title + '」の期限はあと' + days + '日です。');
            sent[key + ':soon'] = true;
        }
    }
    Storage.set('sticky_note_reminders', sent);
}

document.addEventListener('DOMContentLoaded', function () { checkNoteReminders(); updateNotificationCount(); });

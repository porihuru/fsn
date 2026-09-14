/* Display privacy, not an access-control boundary. Received previews are session-local. */
var NoteVisibility = (function () {
    'use strict';
    var sessionToken = null, receivedShown = {};
    function received(row) { return !!(row && row.NoteType === 'DIRECT' && Session.user() && row.SenderUserId !== Session.user().userId); }
    function syncSession() {
        if (sessionToken !== Session.token()) { sessionToken = Session.token(); receivedShown = {}; }
    }
    function hidden(row) {
        if (received(row)) { syncSession(); return !receivedShown['$' + row.Id]; }
        return !!(row && row.value.contentHidden);
    }
    function button(row) {
        var concealed = hidden(row), label = concealed ? 'タイトルと内容を表示' : 'タイトルと内容を隠す';
        return '<button type="button" class="note-visibility secondary" data-action="visibility" title="' + label + '" aria-label="' + label + '" aria-pressed="' + concealed + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><path d="M2 12C7 4 17 4 22 12C17 20 7 20 2 12Z"></path><circle cx="12" cy="12" r="3"></circle>' + (concealed ? '<path d="M3 3L21 21"></path>' : '') + '</svg></button>';
    }
    function toggle(row, callback) {
        if (!row || !Session.user() || Data.busy()) { return; }
        if (received(row)) {
            var show = hidden(row);
            receivedShown['$' + row.Id] = show;
            if (show && !row.recipient.IsRead) { Data.readNote(row, callback); }
            else { callback(null, show ? '内容を表示しました' : '内容を隠しました'); }
            return;
        }
        var value = Util.clone(row.value); value.contentHidden = !hidden(row);
        Data.saveNote(row, value, '', row.NoteType, callback);
    }
    return { received: received, hidden: hidden, button: button, toggle: toggle };
}());

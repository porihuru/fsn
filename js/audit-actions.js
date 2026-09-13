document.addEventListener('DOMContentLoaded', function () {
    var originalSave = Fsn.save;
    Fsn.save = function () {
        var recipient = document.getElementById('note-recipient'), title = document.getElementById('note-title'), recipientText = recipient ? recipient.value : '';
        originalSave();
        if (recipientText) { Audit.log('SEND_NOTE', (title && title.value ? title.value : '無題の付箋') + ' → ' + recipientText); }
    };
});

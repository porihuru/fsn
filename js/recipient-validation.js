function validateRecipients(value) {
    var values = String(value || '').split(/[,、]/), invalid = [], i;
    for (i = 0; i < values.length; i += 1) { if (!values[i].replace(/^\s+|\s+$/g, '')) { invalid.push('空の宛先'); } }
    return invalid;
}

document.addEventListener('DOMContentLoaded', function () {
    var originalSave = Fsn.save;
    Fsn.save = function () {
        var field = document.getElementById('note-recipient'), invalid;
        if (field && field.value) {
            invalid = validateRecipients(field.value);
            if (invalid.length) { Fsn.toast('送信先が見つかりません：' + invalid.join('、')); return; }
        }
        originalSave();
    };
});

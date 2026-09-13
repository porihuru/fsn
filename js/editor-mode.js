function setEditorReadOnly(readOnly) {
    var title = document.getElementById('note-title'), content = document.getElementById('note-content'), color = document.getElementById('note-color'), due = document.getElementById('note-due'), save = document.getElementById('editor-save'), cancel = document.getElementById('editor-cancel');
    if (title) { title.readOnly = !!readOnly; }
    if (content) { content.readOnly = !!readOnly; }
    if (color) { color.disabled = !!readOnly; }
    if (due) { due.disabled = !!readOnly; }
    if (save) { save.style.display = readOnly ? 'none' : ''; }
    if (cancel) { cancel.textContent = readOnly ? '閉じる' : 'キャンセル'; }
}

document.addEventListener('DOMContentLoaded', function () {
    var originalOpen = Fsn.open;
    Fsn.open = function (note) {
        originalOpen(note);
        setEditorReadOnly(false);
    };
});

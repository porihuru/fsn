function renderInbox() {
    var buttons = document.querySelectorAll('.inbox-card .outline'), i;
    for (i = 0; i < buttons.length; i += 1) {
        buttons[i].onclick = function () { Fsn.toast('付箋を開封しました'); };
    }
}

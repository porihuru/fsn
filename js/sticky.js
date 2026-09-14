var StickyApp = (function () {
    function content(text, id) {
        return String(text || '').split('\n').map(function (line, i) {
            var match = /^\[([ xX])\]\s*(.*)$/.exec(line);
            if (match) { return '<label class="note-check"><input type="checkbox" data-line="' + i + '" data-note="' + id + '"' + (match[1].toLowerCase() === 'x' ? ' checked' : '') + '><span>' + sanitizeHtml(match[2]) + '</span></label>'; }
            return sanitizeHtml(line);
        }).join('<br>');
    }
    function number(value, fallback, max) { value = Number(value); return isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback; }
    function render() {
        var board = document.getElementById('sticky-board'), query = document.getElementById('search-input').value.toLowerCase(), extent = 510;
        var rows = Data.state().notes.filter(function (r) { return r.NoteType === 'PERSONAL' && !r.Deleted && r.SenderUserId === Session.user().userId && !!r.Archived === Fsn.archived(); });
        board.innerHTML = rows.filter(function (r) { return (r.value.title + r.value.content).toLowerCase().indexOf(query) !== -1; }).map(function (row) {
            var n = row.value, left = number(n.x, 30, 5000), top = number(n.y, 30, 10000), height = n.minimized ? 80 : Math.max(150, number(n.height, 180, 1500));
            extent = Math.max(extent, top + height + 100);
            return '<article class="sticky-note ' + Util.color(n.color) + (n.pinned ? ' pinned' : '') + '" data-id="' + row.Id + '" style="left:' + left + 'px;top:' + top + 'px;width:' + Math.max(240, number(n.width, 250, 1500)) + 'px;min-height:' + height + 'px;z-index:' + number(n.zIndex, 1, 999) + '"><div class="note-actions">' +
                '<button data-action="edit">編集</button><button data-action="delete" title="ゴミ箱">×</button><button data-action="minimized" title="最小化">−</button><button data-action="pinned" title="位置を固定">◆</button><button data-action="archived" title="アーカイブ">□</button></div><h3>' + Util.esc(n.title) + '</h3>' +
                '<div class="note-body"' + (n.minimized ? ' style="display:none"' : '') + '>' + content(n.content, row.Id) + (n.due ? '<small class="note-due">' + Util.esc(n.due) + '</small>' : '') + '</div>' + (!n.pinned && !n.minimized ? '<span class="resize-handle" title="サイズ変更"></span>' : '') + '</article>';
        }).join('') || '<div class="empty-state">該当する付箋はありません。</div>';
        board.style.height = extent + 'px';
        var cards = board.querySelectorAll('.sticky-note'), i;
        for (i = 0; i < cards.length; i += 1) { bind(cards[i]); }
    }
    function bind(card) {
        var row = Fsn.note(card.getAttribute('data-id')), buttons = card.querySelectorAll('[data-action]'), checks = card.querySelectorAll('.note-check input'), handle = card.querySelector('.resize-handle'), i;
        for (i = 0; i < buttons.length; i += 1) {
            buttons[i].onclick = function () {
                var action = this.getAttribute('data-action'), value = Util.clone(row.value);
                if (action === 'edit') { Fsn.open(row); return; }
                if (action === 'delete') { value.deleted = true; } else { value[action] = !value[action]; }
                Fsn.updateNote(row, value);
            };
        }
        for (i = 0; i < checks.length; i += 1) {
            checks[i].onclick = function () {
                var value = Util.clone(row.value), lines = value.content.split('\n'), line = +this.getAttribute('data-line');
                lines[line] = '[' + (this.checked ? 'x' : ' ') + ']' + lines[line].substring(3); value.content = lines.join('\n'); Fsn.updateNote(row, value);
            };
        }
        card.onmousedown = function (e) { if (!row.value.pinned && (e.target === card || e.target.tagName === 'H3')) { drag(e, card, row, false); } };
        if (handle) { handle.onmousedown = function (e) { drag(e, card, row, true); }; }
    }
    function drag(e, card, row, resize) {
        if (Data.busy() || e.button !== 0) { return; }
        e.preventDefault(); e.stopPropagation();
        var x = e.clientX, y = e.clientY, left = parseInt(card.style.left, 10), top = parseInt(card.style.top, 10), width = card.offsetWidth, height = card.offsetHeight, moved = false, token = Session.token();
        function move(event) {
            moved = true;
            if (resize) { card.style.width = Math.min(1500, Math.max(240, width + event.clientX - x)) + 'px'; card.style.minHeight = Math.min(1500, Math.max(150, height + event.clientY - y)) + 'px'; }
            else { card.style.left = Math.min(5000, Math.max(0, left + event.clientX - x)) + 'px'; card.style.top = Math.min(10000, Math.max(0, top + event.clientY - y)) + 'px'; }
        }
        function up() {
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); window.removeEventListener('blur', up);
            if (!moved || token !== Session.token()) { return; }
            var value = Util.clone(row.value);
            if (resize) { value.width = card.offsetWidth; value.height = card.offsetHeight; } else { value.x = parseInt(card.style.left, 10); value.y = parseInt(card.style.top, 10); value.zIndex = Math.min(999, Math.max.apply(null, Data.state().notes.map(function (r) { return Number(r.value.zIndex) || 1; }).concat([1])) + 1); }
            Fsn.updateNote(row, value);
        }
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); window.addEventListener('blur', up);
    }
    return { render: render, content: content };
}());

var StickyApp = (function () {
    function content(text, id) {
        /* Normalize the whole fragment first: splitting raw HTML breaks tables. */
        return NoteMarkup.normalize(text).split('\n').map(function (line, i) {
            var match = /^\[([ xX])\]\s*(.*)$/.exec(line);
            if (match) { return '<label class="note-check"><input type="checkbox" data-line="' + i + '" data-note="' + id + '"' + (match[1].toLowerCase() === 'x' ? ' checked' : '') + '><span>' + sanitizeHtml(match[2]) + '</span></label>'; }
            return line;
        }).join('<br>');
    }
    function number(value, fallback, max) { value = Number(value); return isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback; }
    function isMoveHandle(target, card) {
        var background = target === card;
        while (target && target !== card) {
            /* Keep button clicks (including SVG icons) and body selection independent. */
            if (/^(BUTTON|INPUT|TEXTAREA|SELECT|LABEL|A)$/.test(target.tagName)) { return false; }
            if (/(^|\s)(note-actions|note-drag-handle|note-hidden-message)(\s|$)/.test(target.getAttribute && target.getAttribute('class') || '')) { return true; }
            target = target.parentNode;
        }
        return background;
    }
    function render() {
        var board = document.getElementById('sticky-board'), query = document.getElementById('search-input').value.toLowerCase(), extent = 510;
        var rows = Data.state().notes.filter(function (r) { return r.NoteType === 'PERSONAL' && !r.Deleted && r.SenderUserId === Session.user().userId && !!r.Archived === Fsn.archived(); });
        /* Render saved layers as compact ranks; old layers above 999 must not tie. */
        rows.sort(function (a, b) { return (Number(a.value.zIndex) || 0) - (Number(b.value.zIndex) || 0) || a.Id - b.Id; });
        board.innerHTML = rows.filter(function (r) { return (r.value.title + r.value.content).toLowerCase().indexOf(query) !== -1; }).map(function (row, index) {
            var n = row.value, concealed = NoteVisibility.hidden(row), pinLabel = n.pinned ? '固定を解除' : '位置を固定', left = number(n.x, 30, 5000), top = number(n.y, 30, 10000), height = n.minimized ? 80 : Math.max(150, number(n.height, 180, 1500));
            extent = Math.max(extent, top + height + 100);
            return '<article class="sticky-note ' + Util.color(n.color) + (n.pinned ? ' pinned' : '') + '" data-id="' + row.Id + '" style="left:' + left + 'px;top:' + top + 'px;width:' + Math.max(240, number(n.width, 250, 1500)) + 'px;min-height:' + height + 'px;z-index:' + (index + 1) + '"><div class="note-actions" role="group" aria-label="付箋の操作">' +
                '<span class="note-drag-handle" title="' + (n.pinned ? '位置は固定中です（◆で解除）' : 'ここをドラッグして移動') + '" aria-hidden="true">⋮⋮</span><button type="button" data-action="edit">編集</button>' + NoteVisibility.button(row) + '<button type="button" data-action="forward" title="別のユーザーへ送る" aria-label="別のユーザーへ送る">→</button><button type="button" data-action="post" title="みんなの投稿へ投稿する" aria-label="みんなの投稿へ投稿する">↑</button><button type="button" data-action="delete" title="ゴミ箱" aria-label="ゴミ箱">×</button><button type="button" data-action="minimized" title="最小化" aria-label="最小化">−</button><button type="button" data-action="pinned" title="' + pinLabel + '" aria-label="' + pinLabel + '" aria-pressed="' + !!n.pinned + '">◆</button><button type="button" data-action="archived" title="アーカイブ" aria-label="アーカイブ">□</button></div>' +
                (concealed ? '<p class="note-hidden-message">内容を非表示中</p>' : '<div class="note-body"' + (n.minimized ? ' style="display:none"' : '') + '>' + content(n.content, row.Id) + (n.due ? '<small class="note-due">' + Util.esc(n.due) + '</small>' : '') + '</div>') + (!n.pinned && !n.minimized ? '<span class="resize-handle" title="サイズ変更"></span>' : '') + '</article>';
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
                if (action === 'visibility') { NoteVisibility.toggle(row, Fsn.result); return; }
                if (action === 'edit') { Fsn.open(row); return; }
                if (action === 'forward' || action === 'post') { Fsn.share(row, action === 'forward' ? 'send' : 'post'); return; }
                if (action === 'delete') { value.deleted = true; } else { value[action] = !value[action]; }
                Fsn.updateNote(row, value);
            };
        }
        for (i = 0; i < checks.length; i += 1) {
            checks[i].onclick = function () {
                var value = Util.clone(row.value), lines = NoteMarkup.normalize(value.content).split('\n'), line = +this.getAttribute('data-line');
                lines[line] = '[' + (this.checked ? 'x' : ' ') + ']' + lines[line].substring(3); value.content = lines.join('\n'); Fsn.updateNote(row, value);
            };
        }
        card.onmousedown = function (e) { if (!row.value.pinned && isMoveHandle(e.target, card)) { drag(e, card, row, false); } };
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
            if (resize) { value.width = card.offsetWidth; value.height = card.offsetHeight; } else { value.x = parseInt(card.style.left, 10); value.y = parseInt(card.style.top, 10); value.zIndex = Data.nextNoteLayer(); }
            Fsn.updateNote(row, value);
        }
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); window.addEventListener('blur', up);
    }
    return { render: render, content: content };
}());

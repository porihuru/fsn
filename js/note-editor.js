/* Offline ES5 rich text. Store the existing content string, not a new schema. */
function sanitizeHtml(value) {
    var allowed = { DIV: 1, P: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, SPAN: 1, TABLE: 1, TBODY: 1, THEAD: 1, TFOOT: 1, TR: 1, TD: 1, TH: 1, UL: 1, OL: 1, LI: 1 };
    var inert = document.implementation.createHTMLDocument(''), box = inert.createElement('div'), nodes, i, j, name, span;
    box.innerHTML = String(value || ''); nodes = box.getElementsByTagName('*');
    for (i = nodes.length - 1; i >= 0; i -= 1) {
        if (!allowed[nodes[i].tagName]) { nodes[i].parentNode.removeChild(nodes[i]); continue; }
        for (j = nodes[i].attributes.length - 1; j >= 0; j -= 1) {
            name = nodes[i].attributes[j].name.toLowerCase(); span = nodes[i].attributes[j].value;
            if (/^(TD|TH)$/.test(nodes[i].tagName) && /^(colspan|rowspan)$/.test(name) && /^[1-9][0-9]?$/.test(span)) { continue; }
            nodes[i].removeAttribute(name);
        }
    }
    return box.innerHTML;
}
var NoteMarkup = (function () {
    'use strict';
    function children(parent, inTable) {
        var result = '', node, tag, value, block, attributes, afterTable;
        for (node = parent.firstChild; node; node = node.nextSibling) {
            afterTable = !inTable && /<\/table>$/.test(result);
            if (node.nodeType === 3) {
                value = node.nodeValue.replace(/\r\n?/g, '\n');
                if (inTable && /^(TABLE|TBODY|THEAD|TFOOT|TR)$/.test(parent.tagName)) { continue; }
                if (afterTable && value && value.charAt(0) !== '\n') { result += '\n'; }
                result += Util.esc(inTable ? value.replace(/\s*\n\s*/g, ' ') : value); continue;
            }
            if (node.nodeType !== 1) { continue; }
            tag = node.tagName; block = tag === 'DIV' || tag === 'P';
            if (tag === 'BR') { result += inTable ? '<br>' : '\n'; continue; }
            value = children(node, inTable || tag === 'TABLE');
            if (block) {
                if (inTable) { if (result && !/<br>$/.test(result)) { result += '<br>'; } result += value + (/<br>$/.test(value) ? '' : '<br>'); }
                else { if (result && !/\n$/.test(result)) { result += '\n'; } if (!(afterTable && value === '\n')) { result += value + (/\n$/.test(value) ? '' : '\n'); } }
                continue;
            }
            attributes = '';
            if (tag === 'TD' || tag === 'TH') {
                if (node.getAttribute('colspan')) { attributes += ' colspan="' + node.getAttribute('colspan') + '"'; }
                if (node.getAttribute('rowspan')) { attributes += ' rowspan="' + node.getAttribute('rowspan') + '"'; }
                value = value.replace(/(?:<br>)+$/, '') || '<br>';
            }
            if (tag === 'TABLE' && result && !/\n$/.test(result) && !inTable) { result += '\n'; }
            else if (afterTable) { result += '\n'; }
            result += '<' + tag.toLowerCase() + attributes + '>' + value + '</' + tag.toLowerCase() + '>';
        }
        return result;
    }
    function normalize(value) { var box = document.createElement('div'); box.innerHTML = sanitizeHtml(value); return children(box, false).replace(/\n+$/, ''); }
    function html(value) { return normalize(value).replace(/\n/g, '<br>'); }
    function plain(value) {
        var box = document.createElement('div');
        box.innerHTML = normalize(value).replace(/<\/t[dh]>/g, '\t').replace(/<\/tr>/g, '\n').replace(/<br>/g, '\n');
        return box.textContent;
    }
    return { normalize: normalize, html: html, plain: plain };
}());
var NoteEditor = (function () {
    'use strict';
    var field, savedRange = null, readonly = false, initialized = false;
    function belongs(range) { return range && field.contains(range.startContainer) && field.contains(range.endContainer); }
    function remember() { var selection = window.getSelection(); if (selection.rangeCount && belongs(selection.getRangeAt(0))) { savedRange = selection.getRangeAt(0).cloneRange(); } }
    function range() {
        var selection = window.getSelection(), value;
        if (selection.rangeCount && belongs(selection.getRangeAt(0))) { value = selection.getRangeAt(0).cloneRange(); }
        else if (belongs(savedRange)) { value = savedRange.cloneRange(); }
        else { value = document.createRange(); value.selectNodeContents(field); value.collapse(false); }
        return value;
    }
    function select(value) { var selection = window.getSelection(); field.focus(); selection.removeAllRanges(); selection.addRange(value); savedRange = value.cloneRange(); }
    function cell(value) { var node = value.startContainer; if (node.nodeType !== 1) { node = node.parentNode; } while (node && node !== field) { if (/^(TD|TH)$/.test(node.tagName)) { return node; } node = node.parentNode; } return null; }
    function tableOf(node) { while (node && node !== field) { if (node.tagName === 'TABLE') { return node; } node = node.parentNode; } return null; }
    function focusCell(node) { var value = document.createRange(); value.selectNodeContents(node); select(value); }
    function get() { return NoteMarkup.normalize(field.innerHTML); }
    function status() {
        var size = get().length, message = document.getElementById('note-content-status');
        message.textContent = size > 20000 ? '本文が上限を超えています。表・書式を含め20000文字以内にしてください。' : '';
        field.setAttribute('aria-invalid', size > 20000 ? 'true' : 'false');
    }
    function put(html, firstCell) {
        if (readonly) { return; }
        var value = range(), box = document.createElement('div'), fragment = document.createDocumentFragment(), last, first;
        box.innerHTML = sanitizeHtml(html); first = firstCell && box.querySelector('td,th');
        if (!box.firstChild) { return; }
        if (box.lastChild.tagName === 'TABLE') { last = document.createElement('p'); last.appendChild(document.createElement('br')); box.appendChild(last); }
        while (box.firstChild) { last = box.firstChild; fragment.appendChild(last); }
        value.deleteContents(); value.insertNode(fragment);
        if (first) { focusCell(first); }
        else { value.setStartAfter(last); value.collapse(true); select(value); }
        status();
    }
    function table() {
        if (cell(range())) { Fsn.toast('表の中では「行追加」「列追加」を使ってください。'); return; }
        put('<table><tbody><tr><th>項目</th><th>内容</th></tr><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>', true);
    }
    function structure(action) {
        if (readonly) { return; }
        var current = cell(range()), target = tableOf(current), row, next, i, cells, created;
        if (!target) { Fsn.toast('先に表のセルをクリックしてください。'); return; }
        if (action === 'remove-table') {
            if (!window.confirm('この表を削除しますか？')) { return; }
            next = document.createElement('p'); next.appendChild(document.createElement('br')); target.parentNode.replaceChild(next, target); focusCell(next); status(); return;
        }
        if (target.querySelector('[colspan],[rowspan]')) { Fsn.toast('結合セルを含む表は、元の表で行・列を追加して貼り付け直してください。セル内の文字は編集できます。'); return; }
        row = current.parentNode;
        if (action === 'row') {
            if (target.rows.length >= 100) { Fsn.toast('表は100行以内にしてください。'); return; }
            next = document.createElement('tr');
            for (i = 0; i < row.cells.length; i += 1) { created = document.createElement('td'); created.appendChild(document.createElement('br')); next.appendChild(created); }
            row.parentNode.insertBefore(next, row.nextSibling); focusCell(next.cells[0]);
        } else {
            cells = current.cellIndex;
            for (i = 0; i < target.rows.length; i += 1) { if (target.rows[i].cells.length >= 20) { Fsn.toast('表は20列以内にしてください。'); return; } }
            for (i = 0; i < target.rows.length; i += 1) {
                created = document.createElement(target.rows[i].cells[0] && target.rows[i].cells[0].tagName === 'TH' ? 'th' : 'td'); created.appendChild(document.createElement('br'));
                target.rows[i].insertBefore(created, target.rows[i].cells[cells + 1] || null);
            }
            focusCell(row.cells[cells + 1]);
        }
        status();
    }
    function insert(type) {
        if (readonly) { return; }
        if (type === 'table') { table(); return; }
        if (type === 'row' || type === 'column' || type === 'remove-table') { structure(type); return; }
        var value = range(), text = value.toString();
        if (type === 'bold') {
            /* Do not extract table structure into an inline formatting element. */
            if (value.cloneContents().querySelector('table,tr,td,th')) { Fsn.toast('太字にするセル内の文字を選択してください。'); return; }
            put('<strong>' + Util.esc(text || '太字').replace(/\n/g, '<br>') + '</strong>', false);
        } else { put('<br>[ ] ' + Util.esc(text || '項目') + '<br>', false); }
    }
    function paste(event) {
        event.preventDefault(); if (readonly) { return; }
        var clipboard = event.clipboardData || window.clipboardData, html = '', text = '', rows, width, i, j;
        if (!clipboard) { Fsn.toast('このブラウザでは貼り付けを取得できません。直接入力してください。'); return; }
        try { html = event.clipboardData ? clipboard.getData('text/html') : ''; text = clipboard.getData(event.clipboardData ? 'text/plain' : 'Text'); }
        catch (e) { Fsn.toast('クリップボードを読み取れません。ブラウザの権限を確認してください。'); return; }
        if (html.length > 200000 || text.length > 20000) { Fsn.toast('貼り付ける内容が大きすぎます。範囲を小さくしてください。'); return; }
        if (html) { html = NoteMarkup.html(html); }
        else if (text.indexOf('\t') !== -1 && !cell(range())) {
            rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'); width = 0;
            for (i = 0; i < rows.length; i += 1) { rows[i] = rows[i].split('\t'); width = Math.max(width, rows[i].length); }
            if (rows.length > 100 || width > 20) { Fsn.toast('表の貼り付けは100行・20列以内にしてください。'); return; }
            html = '<table><tbody>';
            for (i = 0; i < rows.length; i += 1) { html += '<tr>'; for (j = 0; j < width; j += 1) { html += '<td>' + (Util.esc(rows[i][j] || '') || '<br>') + '</td>'; } html += '</tr>'; }
            html += '</tbody></table><p><br></p>';
        } else { html = Util.esc(text).replace(/\r\n?|\n/g, '<br>'); }
        if (cell(range()) && /<table[ >]/i.test(html)) { Fsn.toast('表の外をクリックして貼り付けてください。'); return; }
        if (NoteMarkup.normalize(html).length > 20000) { Fsn.toast('表・書式を含め20000文字以内にしてください。'); return; }
        put(html, /<table[ >]/i.test(html));
    }
    function init() {
        if (initialized) { return; } initialized = true; field = document.getElementById('note-content');
        field.onkeyup = remember; field.onmouseup = remember; field.onblur = remember;
        field.oninput = function () { remember(); status(); };
        field.onpaste = paste;
        field.ondrop = function (event) { event.preventDefault(); if (!readonly) { Fsn.toast('画像・ファイルのドロップは使えません。表はコピーして貼り付けてください。'); } };
        field.onkeydown = function (event) {
            if (readonly || (event.keyCode || event.which) !== 9) { return; }
            var current = cell(range()), target = tableOf(current), cells, index, next;
            if (!target) { return; }
            cells = target.querySelectorAll('td,th'); index = Array.prototype.indexOf.call(cells, current); next = index + (event.shiftKey ? -1 : 1);
            if (next >= 0 && next < cells.length) { event.preventDefault(); event.stopPropagation(); focusCell(cells[next]); }
            else if (!event.shiftKey && target.rows.length < 100 && !target.querySelector('[colspan],[rowspan]')) { event.preventDefault(); event.stopPropagation(); structure('row'); }
        };
        document.getElementById('editor-toolbar').onmousedown = function (event) { remember(); event.preventDefault(); };
    }
    function set(value, readOnly) {
        init(); readonly = !!readOnly; savedRange = null; field.innerHTML = NoteMarkup.html(value);
        if (!readonly && field.lastChild && field.lastChild.tagName === 'TABLE') { var after = document.createElement('p'); after.appendChild(document.createElement('br')); field.appendChild(after); }
        field.setAttribute('contenteditable', readonly ? 'false' : 'true'); field.setAttribute('aria-readonly', readonly ? 'true' : 'false'); status();
    }
    function clear() { if (!field) { return; } field.innerHTML = ''; savedRange = null; status(); }
    return { init: init, set: set, get: get, clear: clear, insert: insert };
}());

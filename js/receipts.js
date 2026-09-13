function receiptInboxItems() {
    var user = Storage.get('sticky_user', {}), sent = Storage.get('sticky_sent_notes', []), items = [], i, note;
    for (i = 0; i < sent.length; i += 1) {
        note = sent[i];
        if (note.recipients && note.recipients.indexOf(user.displayName) !== -1) {
            items.push({ id: note.id || ('legacy-' + i), title: note.title, content: note.content, sender: note.sender || '山田 太郎', sentAt: note.sentAt, read: !!(note.receipts && note.receipts[user.displayName] && note.receipts[user.displayName].read) });
        }
    }
    return items;
}

function markReceiptRead(noteId) {
    var user = Storage.get('sticky_user', {}), sent = Storage.get('sticky_sent_notes', []), i;
    for (i = 0; i < sent.length; i += 1) {
        if (sent[i].id === noteId || (!sent[i].id && ('legacy-' + i) === noteId)) {
            sent[i].receipts = sent[i].receipts || {};
            sent[i].receipts[user.displayName] = { read: true, readAt: new Date().toISOString() };
            Storage.set('sticky_sent_notes', sent);
            NotificationStore.add('付箋を開封しました', user.displayName + 'さんが「' + sent[i].title + '」を開封しました');
            Audit.log('READ_NOTE', sent[i].title);
            return;
        }
    }
}

function renderInbox() {
    var list = document.querySelector('#panel-inbox .inbox-list'), items = receiptInboxItems(), staticItems, badge, i, html = '', unread = 0, buttons;
    if (!list) { return; }
    staticItems = [
        { id: 'sample-inbox-1', title: '確認依頼', content: '資料をご確認いただき、問題なければコメントをお願いします。', sender: '佐藤 花子', sentAt: '今日 09:05', read: false },
        { id: 'sample-inbox-2', title: 'リリース準備', content: '受入テストの結果とリリース手順を共有します。', sender: '鈴木 一郎', sentAt: '昨日 16:20', read: true }
    ];
    if (!items.length) { items = staticItems; }
    for (i = 0; i < items.length; i += 1) {
        if (!items[i].read) { unread += 1; }
        html += '<div class="inbox-card' + (items[i].read ? '' : ' unread') + '" data-receipt="' + Fsn.esc(items[i].id) + '" data-static="' + (items === staticItems ? '1' : '0') + '"><span class="avatar coral">' + Fsn.esc(items[i].sender.charAt(0)) + '</span><div><strong>' + Fsn.esc(items[i].title) + '</strong><p>' + Fsn.esc(items[i].sender) + 'さんから付箋が届きました</p><small>' + Fsn.esc(String(items[i].sentAt).substring(0, 16).replace('T', ' ')) + '　<span class="pill' + (items[i].read ? ' gray' : '') + '">' + (items[i].read ? '既読' : '未読') + '</span></small></div><button class="outline open-receipt" type="button">開く</button></div>';
    }
    list.innerHTML = html;
    badge = document.querySelector('.nav-tab[data-tab="inbox"] .badge');
    if (badge) { badge.textContent = unread; badge.style.display = unread ? 'inline-block' : 'none'; }
    buttons = list.querySelectorAll('.open-receipt');
    for (i = 0; i < buttons.length; i += 1) {
        buttons[i].onclick = function (event) {
            var card = this.parentNode, id = card.getAttribute('data-receipt'), current = receiptInboxItems(), j, note = null;
            if (event && event.stopPropagation) { event.stopPropagation(); }
            if (card.getAttribute('data-static') !== '1') { markReceiptRead(id); }
            for (j = 0; j < current.length; j += 1) { if (current[j].id === id) { note = current[j]; } }
            Fsn.open({ title: note ? note.title : card.querySelector('strong').textContent, content: note ? note.content : '受信付箋の内容です。', color: 'yellow' });
            document.getElementById('editor-title').textContent = '受信付箋を確認';
            setEditorReadOnly(true);
            renderInbox();
        };
    }
    if (window.renderSentHistory) { renderSentHistory(); }
}

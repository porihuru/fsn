function notificationItems() {
    var items = [
        { id: 'seed-note', i: '▣', t: '新しい付箋が届きました', b: '佐藤 花子さんから「確認依頼」が届いています。', d: '5分前' },
        { id: 'seed-read', i: '◉', t: '付箋が開封されました', b: '鈴木 一郎さんが「リリース準備」を開封しました。', d: '18分前' },
        { id: 'seed-comment', i: '▱', t: 'コメントが追加されました', b: '田中 花子さんが投稿にコメントしました。', d: '1時間前' }
    ], custom = NotificationStore.all(), i;
    for (i = custom.length - 1; i >= 0; i -= 1) { items.unshift({ id: custom[i].id, i: custom[i].icon || '●', t: custom[i].title, b: custom[i].body, d: custom[i].time }); }
    return items;
}

function renderNotificationFilters(items, reads, filter) {
    var panel = document.getElementById('panel-notifications'), list = document.getElementById('notification-list'), holder = document.getElementById('notification-filters'), unread = 0, i, buttons;
    if (!panel || !list) { return; }
    for (i = 0; i < items.length; i += 1) { if (!reads[items[i].id]) { unread += 1; } }
    if (!holder) { holder = document.createElement('div'); holder.id = 'notification-filters'; holder.style.margin = '0 0 14px'; panel.insertBefore(holder, list); }
    holder.innerHTML = '<button type="button" class="secondary notification-filter" data-filter="all">すべて ' + items.length + '</button> <button type="button" class="secondary notification-filter" data-filter="unread">未読 ' + unread + '</button>';
    buttons = holder.querySelectorAll('.notification-filter');
    for (i = 0; i < buttons.length; i += 1) { buttons[i].onclick = function () { Storage.set('sticky_notification_filter', this.getAttribute('data-filter')); renderNotifications(); }; }
}

function renderNotifications() {
    var container = document.getElementById('notification-list'), items = notificationItems(), reads = Storage.get('sticky_read_notifications', {}), filter = Storage.get('sticky_notification_filter', 'all'), i, item, html = '', rows;
    if (!container) { return; }
    renderNotificationFilters(items, reads, filter);
    for (i = 0; i < items.length; i += 1) {
        item = items[i];
        if (filter === 'unread' && reads[item.id]) { continue; }
        html += '<div class="notification-row' + (reads[item.id] ? ' read' : '') + '" data-notification="' + Fsn.esc(item.id) + '"><span class="notification-icon">' + Fsn.esc(item.i) + '</span><div><strong>' + Fsn.esc(item.t) + '</strong><p>' + Fsn.esc(item.b) + '</p></div><time>' + Fsn.esc(item.d) + '</time></div>';
    }
    container.innerHTML = html || '<div class="empty-state" style="padding-top:40px">未読の通知はありません。</div>';
    rows = container.querySelectorAll('.notification-row');
    for (i = 0; i < rows.length; i += 1) { rows[i].onclick = markNotificationRead; }
    updateNotificationCount(items);
}

function markNotificationRead(event) {
    var row = event.currentTarget, reads = Storage.get('sticky_read_notifications', {});
    reads[row.getAttribute('data-notification')] = true;
    Storage.set('sticky_read_notifications', reads);
    renderNotifications();
}

function updateNotificationCount(items) {
    var reads = Storage.get('sticky_read_notifications', {}), count = 0, i, badge = document.querySelector('.dot');
    items = items || notificationItems();
    for (i = 0; i < items.length; i += 1) { if (!reads[items[i].id]) { count += 1; } }
    if (badge) { badge.textContent = count; badge.style.display = count ? 'block' : 'none'; }
}

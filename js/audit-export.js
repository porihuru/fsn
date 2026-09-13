function csvCell(value) {
    return '"' + String(value === undefined || value === null ? '' : value).replace(/"/g, '""') + '"';
}

function exportAuditCsv() {
    var items = Audit.all(), lines = ['日時,操作,詳細,ユーザーID,端末ID'], i, item, blob, url, link;
    Audit.log('EXPORT_AUDIT', '監査ログをCSV出力');
    items = Audit.all();
    for (i = 0; i < items.length; i += 1) {
        item = items[i];
        lines.push([item.createdAt || '', item.action || '', item.detail || '', item.userId || '', item.deviceId || ''].map(csvCell).join(','));
    }
    blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    if (window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(blob, 'audit-log.csv');
    } else {
        url = window.URL.createObjectURL(blob);
        link = document.createElement('a');
        link.href = url;
        link.download = 'audit-log.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }
    renderAuditLog();
    Fsn.toast('監査ログをCSV出力しました');
}

document.addEventListener('DOMContentLoaded', function () {
    var head = document.querySelector('#panel-audit .page-head'), refresh, button;
    if (!head || document.getElementById('audit-export')) { return; }
    refresh = document.getElementById('audit-refresh');
    button = document.createElement('button');
    button.id = 'audit-export';
    button.className = 'secondary';
    button.type = 'button';
    button.textContent = 'CSV出力';
    button.onclick = exportAuditCsv;
    if (refresh && refresh.parentNode === head) { head.appendChild(button); } else { head.appendChild(button); }
});

function taskDefaults() {
    return [
        { id: 'sample-1', t: '週次レビュー資料の確認', o: '自分', d: '2026-09-18', s: '対応中', k: 'progress', p: '高' },
        { id: 'sample-2', t: 'リリース準備の手順書更新', o: '鈴木 一郎', d: '2026-09-25', s: '未着手', k: 'todo', p: '中' },
        { id: 'sample-3', t: 'チーム資料の月次棚卸し', o: '自分', d: '2026-10-02', s: '完了', k: 'done', p: '低' }
    ];
}

function taskState(task) {
    var saved = Storage.get('sticky_task_status', {})[task.id];
    if (saved) { task.s = saved.s; task.k = saved.k; }
    return task;
}

function taskIsOverdue(task) {
    var today = new Date(), due;
    if (!task.d || task.k === 'done') { return false; }
    due = new Date(task.d + 'T23:59:59');
    today.setHours(0, 0, 0, 0);
    return !isNaN(due.getTime()) && due < today;
}

function renderTaskFilters(tasks, active) {
    var panel = document.getElementById('panel-tasks'), existing = document.getElementById('task-filters'), counts = { all: tasks.length, todo: 0, progress: 0, done: 0 }, i, html;
    if (!panel) { return; }
    for (i = 0; i < tasks.length; i += 1) { counts[tasks[i].k] = (counts[tasks[i].k] || 0) + 1; }
    if (!existing) { existing = document.createElement('div'); existing.id = 'task-filters'; existing.style.margin = '0 0 14px'; panel.insertBefore(existing, document.getElementById('task-list')); }
    html = '<button class="secondary task-filter" data-filter="all" type="button">すべて ' + counts.all + '</button> <button class="secondary task-filter" data-filter="todo" type="button">未着手 ' + counts.todo + '</button> <button class="secondary task-filter" data-filter="progress" type="button">対応中 ' + counts.progress + '</button> <button class="secondary task-filter" data-filter="done" type="button">完了 ' + counts.done + '</button>';
    existing.innerHTML = html;
    for (i = 0; i < existing.querySelectorAll('.task-filter').length; i += 1) {
        existing.querySelectorAll('.task-filter')[i].onclick = function () { Storage.set('sticky_task_filter', this.getAttribute('data-filter')); renderTasks(); };
    }
}

function renderTasks() {
    var container = document.getElementById('task-list'), tasks = taskDefaults(), custom = Storage.get('sticky_tasks', []), customIds = {}, filter = Storage.get('sticky_task_filter', 'all'), i, task, rows = '', visible = [];
    if (!container) { return; }
    for (i = 0; i < custom.length; i += 1) { customIds[custom[i].id] = true; tasks.push({ id: custom[i].id, t: custom[i].title, o: custom[i].owner || '自分', d: custom[i].due || '', s: '未着手', k: 'todo', p: custom[i].priority || '中' }); }
    for (i = 0; i < tasks.length; i += 1) { taskState(tasks[i]); if (filter === 'all' || tasks[i].k === filter) { visible.push(tasks[i]); } }
    renderTaskFilters(tasks, filter);
    rows = '<div class="task-header"><span>タスク</span><span>担当者</span><span>期限</span><span>状態</span></div>';
    for (i = 0; i < visible.length; i += 1) {
        task = visible[i];
        rows += '<div class="task-row" data-task="' + Fsn.esc(task.id) + '"><span><i class="task-check ' + task.k + '"></i><strong>' + Fsn.esc(task.t) + '</strong> <small class="pill' + (task.p === '高' ? '' : ' gray') + '">優先度：' + Fsn.esc(task.p) + '</small></span><span>' + Fsn.esc(task.o) + '</span><span' + (taskIsOverdue(task) ? ' style="color:#d25b5b;font-weight:bold"' : '') + '>' + Fsn.esc(task.d || '期限なし') + (taskIsOverdue(task) ? '（期限切れ）' : '') + '</span><span><em class="status ' + task.k + '">' + task.s + '</em>' + (customIds[task.id] ? ' <button type="button" class="delete-task" title="タスクを削除">×</button>' : '') + '</span></div>';
    }
    container.innerHTML = rows + (visible.length ? '' : '<div class="empty-state" style="padding-top:40px">該当するタスクはありません。</div>');
    for (i = 0; i < container.querySelectorAll('.task-row').length; i += 1) { container.querySelectorAll('.task-row')[i].onclick = cycleTask; }
    for (i = 0; i < container.querySelectorAll('.delete-task').length; i += 1) { container.querySelectorAll('.delete-task')[i].onclick = deleteTask; }
}

function deleteTask(event) {
    var id = event.currentTarget.parentNode.parentNode.getAttribute('data-task'), tasks = Storage.get('sticky_tasks', []), saved = Storage.get('sticky_task_status', {}), kept = [], i;
    if (event.stopPropagation) { event.stopPropagation(); }
    if (!window.confirm('このタスクを削除しますか？')) { return; }
    for (i = 0; i < tasks.length; i += 1) { if (tasks[i].id !== id) { kept.push(tasks[i]); } }
    delete saved[id];
    Storage.set('sticky_tasks', kept);
    Storage.set('sticky_task_status', saved);
    Audit.log('DELETE_TASK', id);
    renderTasks();
    Fsn.toast('タスクを削除しました');
}

function cycleTask(event) {
    var row = event.currentTarget, id = row.getAttribute('data-task'), states = [{ s: '未着手', k: 'todo' }, { s: '対応中', k: 'progress' }, { s: '完了', k: 'done' }], current = row.querySelector('.status').className.split(' ')[1], i, next, saved;
    for (i = 0; i < states.length; i += 1) { if (states[i].k === current) { next = states[(i + 1) % states.length]; } }
    saved = Storage.get('sticky_task_status', {});
    saved[id] = next || states[0];
    Storage.set('sticky_task_status', saved);
    renderTasks();
    Fsn.toast('タスクの状態を「' + (next || states[0]).s + '」に更新しました');
}

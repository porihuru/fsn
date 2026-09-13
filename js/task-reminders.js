function checkTaskReminders() {
    var tasks = taskDefaults(), custom = Storage.get('sticky_tasks', []), states = Storage.get('sticky_task_status', {}), sent = Storage.get('sticky_task_reminders', {}), now = new Date(), today, i, task, state, due, days;
    today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (i = 0; i < custom.length; i += 1) { tasks.push({ id: custom[i].id, t: custom[i].title, d: custom[i].due || '', s: '未着手', k: 'todo' }); }
    for (i = 0; i < tasks.length; i += 1) {
        task = tasks[i];
        state = states[task.id] || task;
        if (!task.d || state.k === 'done') { continue; }
        due = new Date(task.d + 'T00:00:00');
        if (isNaN(due.getTime())) { continue; }
        days = Math.floor((due.getTime() - today.getTime()) / 86400000);
        if (days < 0 && !sent[task.id + ':overdue']) {
            NotificationStore.add('タスク期限切れ', '「' + task.t + '」は期限を過ぎています。');
            sent[task.id + ':overdue'] = true;
        } else if (days >= 0 && days <= 3 && !sent[task.id + ':soon']) {
            NotificationStore.add('タスク期限が近づいています', '「' + task.t + '」の期限はあと' + days + '日です。');
            sent[task.id + ':soon'] = true;
        }
    }
    Storage.set('sticky_task_reminders', sent);
}

document.addEventListener('DOMContentLoaded', function () { checkTaskReminders(); updateNotificationCount(); });

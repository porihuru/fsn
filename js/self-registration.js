function registerOwnProfile() {
    var user = Storage.get('sticky_user', {}), name, organization;
    if (!user.userId || Storage.get('sticky_profile_completed_' + user.userId, false)) { return; }
    name = window.prompt('表示する氏名を登録してください', user.displayName || '');
    if (!name) { Fsn.toast('氏名が未登録のため、自己登録を完了できません。'); return; }
    organization = window.prompt('部署名を登録してください', user.organization === '社内ユーザー' ? '' : (user.organization || ''));
    if (!organization) { Fsn.toast('部署名が未登録のため、自己登録を完了できません。'); return; }
    user.displayName = name.replace(/^\s+|\s+$/g, '');
    user.organization = organization.replace(/^\s+|\s+$/g, '');
    if (!/^[A-Za-z0-9]+$/.test(user.organization)) { Fsn.toast('部署名は半角アルファベットと数字のみで入力してください。'); return; }
    Storage.set('sticky_user', user);
    Storage.set('sticky_profile_completed_' + user.userId, true);
    document.getElementById('user-name').textContent = user.displayName;
    document.getElementById('org-name').textContent = user.organization;
    Audit.log('REGISTER_PROFILE', user.displayName + ' / ' + user.organization);
    if (APP_CONFIG.USE_SHAREPOINT && APP_CONFIG.SHAREPOINT_BASE_URL) { StickyUsersApi.ensureUser(user, function (result) { if (!result.ok) { Fsn.toast('SharePointへの自己登録に失敗しました。'); return; } StickyGroupsApi.ensureMembership(user.organization, user.userId, function (membership) { if (!membership.ok) { Fsn.toast('部署グループへの登録に失敗しました。'); } }); }); }
    Fsn.toast('氏名・部署を登録しました。');
}

document.addEventListener('DOMContentLoaded', function () { window.setTimeout(registerOwnProfile, 0); });

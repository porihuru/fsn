function pollMarkup(post, key, reactions) {
    var reaction = reactions[key] || {}, options = post.pollOptions || [], votes = reaction.votes || [], i, count, total = 0, html;
    if (!options.length) { return ''; }
    for (i = 0; i < votes.length; i += 1) { total += votes[i] || 0; }
    html = '<div class="poll-box"><strong>アンケート</strong>';
    for (i = 0; i < options.length; i += 1) { count = votes[i] || 0; html += '<button type="button" class="poll-option" data-option="' + i + '">' + Fsn.esc(options[i]) + ' <span>' + count + '票</span></button>'; }
    return html + '<small>投票数：' + total + '票</small></div>';
}

function commentMarkup(reaction) {
    var comments = reaction.commentTexts || [], i, html = '';
    if (!comments.length) { return ''; }
    html = '<div class="post-comments">';
    for (i = 0; i < comments.length; i += 1) { html += '<div class="post-comment"><strong>' + Fsn.esc(comments[i].author) + '</strong><p>' + Fsn.esc(comments[i].text) + '</p><small>' + String(comments[i].createdAt || '').substring(0, 16).replace('T', ' ') + '</small></div>'; }
    return html + '</div>';
}

function snsPosts() {
    var posts = [
        { id: 'sample-post-1', n: '佐藤 花子', i: '佐', tone: 'coral', d: '今日 09:10', k: 'お知らせ', b: '今週の全体ミーティングは大会議室で行います。資料を共有しました。', v: 27, l: 8, m: 3 },
        { id: 'sample-post-2', n: '鈴木 一郎', i: '鈴', tone: 'indigo', d: '今日 08:42', k: 'ナレッジ', b: 'SharePointの新しい検索Tipsをまとめました。ぜひご覧ください。', v: 14, l: 5, m: 1 }
    ], extras = Storage.get('sticky_posts', []), changed = false, i;
    for (i = 0; i < extras.length; i += 1) {
        if (!extras[i].id) { extras[i].id = 'post-' + new Date().getTime() + '-' + i; changed = true; }
        posts.unshift(extras[i]);
    }
    posts.sort(function (left, right) { return (right.isPinned ? 1 : 0) - (left.isPinned ? 1 : 0); });
    if (changed) { Storage.set('sticky_posts', extras); }
    return posts;
}

function renderSnsPosts() {
    var list = document.getElementById('sns-list'), posts, reactions, cards, i;
    if (!list) { return; }
    posts = snsPosts();
    reactions = Storage.get('sticky_reactions', {});
    list.innerHTML = '';
    posts.forEach(function (post) {
        var key = post.id, reaction = reactions[key] || {};
        list.innerHTML += '<article class="post-card" data-post="' + Fsn.esc(key) + '"><div class="post-head"><span class="avatar ' + (post.tone || 'green') + '">' + Fsn.esc(post.i) + '</span><div><strong>' + Fsn.esc(post.n) + '</strong><small>' + Fsn.esc(post.d) + '　<span class="category">' + Fsn.esc(post.k) + '</span>' + (post.isPinned ? '　<span class="pill">固定</span>' : '') + '</small></div><button class="more" type="button" title="投稿メニュー">•••</button></div><p class="post-body">' + Fsn.esc(post.b) + '</p>' + pollMarkup(post, key, reactions) + commentMarkup(reaction) + '<div class="post-foot"><span>◉ ' + post.v + '人が閲覧</span><button type="button" class="like-post">' + (reaction.liked ? '♥' : '♡') + ' ' + (post.l + (reaction.liked ? 1 : 0)) + '</button><button type="button" class="comment-post">▱ ' + (post.m + (reaction.comments || 0)) + '</button><button type="button" class="copy-post">付箋にコピー</button></div></article>';
    });
    cards = list.querySelectorAll('.post-card');
    for (i = 0; i < cards.length; i += 1) { bindPost(cards[i], cards[i].getAttribute('data-post')); }
}

function createSnsPost(body, category, pollOptions) {
    var user = Storage.get('sticky_user', { displayName: '山田 太郎' }), posts = Storage.get('sticky_posts', []);
    posts.unshift({ id: 'post-' + new Date().getTime(), n: user.displayName, i: (user.displayName || '山').charAt(0), tone: 'green', d: 'たった今', k: category || 'お知らせ', b: body, v: 0, l: 0, m: 0, pollOptions: pollOptions || [] });
    Storage.set('sticky_posts', posts);
    renderSnsPosts();
    Fsn.toast('投稿しました');
}

function deleteSnsPost(key) {
    var posts = Storage.get('sticky_posts', []), reactions = Storage.get('sticky_reactions', {}), kept = [], i;
    for (i = 0; i < posts.length; i += 1) { if (posts[i].id !== key) { kept.push(posts[i]); } }
    delete reactions[key];
    Storage.set('sticky_posts', kept);
    Storage.set('sticky_reactions', reactions);
    Audit.log('DELETE_POST', key);
    renderSnsPosts();
    Fsn.toast('投稿を削除しました');
}

function toggleSnsPostPin(key) {
    var posts = Storage.get('sticky_posts', []), i;
    for (i = 0; i < posts.length; i += 1) { if (posts[i].id === key) { posts[i].isPinned = !posts[i].isPinned; Storage.set('sticky_posts', posts); Audit.log(posts[i].isPinned ? 'PIN_POST' : 'UNPIN_POST', key); renderSnsPosts(); Fsn.toast(posts[i].isPinned ? '投稿を固定しました' : '投稿の固定を解除しました'); return; } }
}

function bindPost(card, key) {
    var like = card.querySelector('.like-post'), comment = card.querySelector('.comment-post'), copy = card.querySelector('.copy-post'), more = card.querySelector('.more'), options = card.querySelectorAll('.poll-option'), reactions = Storage.get('sticky_reactions', {}), i;
    like.onclick = function () { var reaction = reactions[key] || {}; reaction.liked = !reaction.liked; reactions[key] = reaction; Storage.set('sticky_reactions', reactions); renderSnsPosts(); };
    for (i = 0; i < options.length; i += 1) { options[i].onclick = function () { var reaction = reactions[key] || {}, selected = parseInt(this.getAttribute('data-option'), 10), previous = reaction.pollVote; reaction.votes = reaction.votes || []; if (typeof previous === 'number' && previous !== selected && reaction.votes[previous]) { reaction.votes[previous] -= 1; } if (previous !== selected) { reaction.votes[selected] = (reaction.votes[selected] || 0) + 1; reaction.pollVote = selected; } reactions[key] = reaction; Storage.set('sticky_reactions', reactions); renderSnsPosts(); Fsn.toast(previous === selected ? 'この選択肢に投票済みです' : '投票しました'); }; }
    comment.onclick = function () { var value = window.prompt('コメントを入力してください', ''); if (value) { var reaction = reactions[key] || {}, user = Storage.get('sticky_user', { displayName: '山田 太郎' }), mention = value.match(/@([^\s　]+)/); reaction.comments = (reaction.comments || 0) + 1; reaction.commentTexts = reaction.commentTexts || []; reaction.commentTexts.push({ author: user.displayName, text: value, createdAt: new Date().toISOString() }); reactions[key] = reaction; Storage.set('sticky_reactions', reactions); if (mention) { NotificationStore.add('メンションされました', user.displayName + 'さんがコメント内で @' + mention[1] + ' とメンションしました'); } renderSnsPosts(); Fsn.toast('コメントを追加しました'); } };
    copy.onclick = function () { Fsn.open({ title: 'SNSからの付箋', content: '投稿を付箋にコピーしました。', color: 'lavender' }); };
    more.onclick = function () { var user = Storage.get('sticky_user', { displayName: '' }), action; if (card.querySelector('.post-head strong').textContent !== user.displayName) { Fsn.toast('他のユーザーの投稿は変更できません'); return; } action = window.prompt('操作を選んでください\n1：固定／固定解除\n2：削除', '1'); if (action === '1') { toggleSnsPostPin(key); } else if (action === '2' && window.confirm('この投稿を削除しますか？')) { deleteSnsPost(key); } };
}

document.addEventListener('DOMContentLoaded', function () {
    var originalSearch = window.renderGlobalSearch;
    if (!originalSearch) { return; }
    window.renderGlobalSearch = function (query) {
        var list, posts, text, i, post, html = '';
        originalSearch(query);
        text = String(query || '').toLowerCase();
        if (!text || !window.snsPosts) { return; }
        list = document.getElementById('global-search-results');
        if (!list) { return; }
        posts = snsPosts();
        for (i = 0; i < posts.length; i += 1) {
            post = posts[i];
            if ((String(post.n) + String(post.k) + String(post.b)).toLowerCase().indexOf(text) !== -1) {
                html += '<div class="notification-row"><span class="notification-icon">◉</span><div><strong>SNS：' + Fsn.esc(post.k) + '</strong><p>' + Fsn.esc(post.b) + '</p><small>' + Fsn.esc(post.n) + '　' + Fsn.esc(post.d) + '</small></div></div>';
            }
        }
        if (html) { list.innerHTML += html; }
    };
});

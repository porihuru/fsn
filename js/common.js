/* ES5 only: shared validation used by buttons, shortcuts and background work. */
var Util = (function () {
    'use strict';
    function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
    function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function date(v) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v), d;
        if (!v) { return true; }
        if (!m || +m[1] < 1000) { return false; }
        d = new Date(+m[1], +m[2] - 1, +m[3]);
        return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
    }
    function uid() { return forge.util.bytesToHex(StickyCrypto.randomBytes(16)); }
    function hash(v) { return forge.md.sha256.create().update(v, 'utf8').digest().toHex(); }
    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    function each(items, run, done) {
        var i = 0;
        function next(error) { if (error || i === items.length) { done(error || null); return; } run(items[i++], next); }
        next();
    }
    function message(error) { return error && (error.message || error.error) || '処理に失敗しました。エラー一覧を確認してください。'; }
    function color(v) { return /^(yellow|blue|pink|lavender)$/.test(v) ? v : 'yellow'; }
    return { trim: trim, esc: esc, date: date, uid: uid, hash: hash, clone: clone, each: each, message: message, color: color };
}());

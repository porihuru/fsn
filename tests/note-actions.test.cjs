const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, call, addUser, login, note, root } = require('./helpers.cjs');

test('compact tinted action row includes labelled send/post arrows, including on minimized notes', async () => {
  const c = app({init:true}), w = c.w, d = w.document;
  try {
    await addUser(w, 'alice'); await login(w);
    const style = d.createElement('style');
    style.textContent = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
    d.head.appendChild(style);
    await call(w.Data, 'saveNote', null, {...note(), width:240}, '', 'PERSONAL');
    w.Fsn.tab('stickies');
    const card = d.querySelector('.sticky-note'), actions = card.querySelector('.note-actions');
    assert.deepEqual([...actions.querySelectorAll('button')].map(b => b.getAttribute('data-action')), ['edit', 'visibility', 'forward', 'post', 'delete', 'minimized', 'pinned', 'archived']);
    assert.equal(actions.querySelector('[data-action="forward"]').textContent, '→');
    assert.equal(actions.querySelector('[data-action="post"]').textContent, '↑');
    assert.equal(actions.getAttribute('aria-label'), '付箋の操作');
    assert.equal(card.querySelector('.note-share-actions'), null);
    assert.equal(card.querySelectorAll('[data-action]').length, 8);
    const css = w.getComputedStyle(actions);
    assert.equal(css.backgroundColor, 'rgba(80, 70, 60, 0.08)');
    assert.equal(css.left, '0px'); assert.equal(css.right, '0px'); assert.equal(css.top, '0px');
    assert.equal(css.height, '24px'); assert.equal(css.flexWrap, 'nowrap');
    assert.ok(parseInt(w.getComputedStyle(card).paddingTop, 10) > parseInt(css.height, 10));
    for (const [action, label] of [['forward', '別のユーザーへ送る'], ['post', 'みんなの投稿へ投稿する']]) {
      const button = actions.querySelector('[data-action="' + action + '"]');
      assert.equal(button.type, 'button'); assert.equal(button.title, label);
      assert.equal(button.getAttribute('aria-label'), label);
      assert.equal(w.getComputedStyle(button).minWidth, '24px');
    }
    const row = w.Data.state().notes[0];
    await call(w.Data, 'saveNote', row, {...row.value, minimized:true}, '', 'PERSONAL');
    w.Fsn.render();
    assert.equal(d.querySelector('.note-body').style.display, 'none');
    d.querySelector('.note-actions [data-action="forward"]').click();
    assert.equal(d.getElementById('editor-save').textContent, '送信する');
    w.Fsn.close();
    d.querySelector('.note-actions [data-action="post"]').click();
    assert.equal(d.getElementById('editor-save').textContent, '投稿する');
    assert.equal(w.Data.state().notes.length, 1); assert.equal(w.Data.state().posts.length, 0);
  } finally { c.close(); }
});

test('cards omit titles without erasing them; icons appear on hover or keyboard focus without hiding the drag strip', async () => {
  const c = app({init:true}), w = c.w, d = w.document;
  try {
    await addUser(w, 'alice'); await addUser(w, 'bob'); await login(w);
    const style = d.createElement('style');
    // jsdom has no pointer hit testing; simulate the CSS hover state with a class.
    style.textContent = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8').replace(/:hover/g, '.test-hover');
    d.head.appendChild(style);
    await call(w.Data, 'saveNote', null, note('カードには出さないタイトル'), '', 'PERSONAL'); w.Fsn.tab('stickies');
    let card = d.querySelector('.sticky-note');
    assert.equal(card.querySelector('h3'), null); assert.doesNotMatch(card.innerHTML, /カードには出さないタイトル/);
    assert.match(card.querySelector('.note-body').textContent, /本文 secret/);
    const actions = card.querySelector('.note-actions'), edit = actions.querySelector('[data-action="edit"]');
    assert.notEqual(w.getComputedStyle(actions).display, 'none'); assert.equal(w.getComputedStyle(actions).cursor, 'move');
    for (const control of actions.children) assert.equal(w.getComputedStyle(control).opacity, '0');
    card.classList.add('test-hover');
    for (const control of actions.children) assert.equal(w.getComputedStyle(control).opacity, '1');
    card.classList.remove('test-hover');
    edit.focus(); assert.equal(w.getComputedStyle(edit).opacity, '1'); edit.blur();
    assert.notEqual(d.activeElement, edit);
    card.setAttribute('data-test-blurred', 'true'); // invalidate jsdom's computed-style cache after blur
    assert.equal(w.getComputedStyle(edit).opacity, '0');
    edit.click(); assert.equal(d.getElementById('note-title').value, 'カードには出さないタイトル'); w.Fsn.close();
    await call(w.Data, 'saveNote', null, note('受信タイトル'), '@bob', 'DIRECT'); await login(w, 'bob'); w.Fsn.tab('inbox');
    card = d.querySelector('.received-note'); const eye = card.querySelector('.note-visibility');
    assert.equal(w.getComputedStyle(eye).opacity, '0'); card.classList.add('test-hover'); assert.equal(w.getComputedStyle(eye).opacity, '1');
    eye.click(); card = d.querySelector('.received-note');
    assert.equal(card.querySelector('h3'), null); assert.doesNotMatch(card.innerHTML, /受信タイトル/);
    assert.match(card.querySelector('.note-body').textContent, /本文 secret/);
    assert.equal(w.Data.state().notes[0].value.title, '受信タイトル');
  } finally { c.close(); }
});

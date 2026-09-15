const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, addUser, login, note } = require('./helpers.cjs');

test('new notes start in the body and save without a title; editing preserves legacy titles', async () => {
  const c = app({init:true}), w = c.w, d = w.document;
  try {
    await addUser(w, 'alice'); await login(w); d.getElementById('new-note').click();
    assert.equal(d.getElementById('note-title-label').style.display, 'none');
    assert.equal(d.activeElement.id, 'note-content');
    w.Fsn.save(); assert.equal(w.Data.state().notes.length, 0);
    assert.match(d.getElementById('toast').textContent, /本文を入力/);
    d.getElementById('note-content').textContent = '本文だけの付箋';
    d.dispatchEvent(new w.KeyboardEvent('keydown', {ctrlKey:true, keyCode:83, bubbles:true}));
    assert.equal(w.Data.state().notes.length, 1); assert.equal(w.Data.state().notes[0].value.content, '本文だけの付箋');
    await call(w.Data, 'saveNote', null, note('既存タイトル'), '', 'PERSONAL');
    const row = w.Data.state().notes.find(r => r.value.title === '既存タイトル'); w.Fsn.open(row);
    assert.equal(d.getElementById('note-title-label').style.display, 'none');
    d.getElementById('note-title').value = 'hidden field must not replace legacy title';
    d.getElementById('note-content').textContent = '編集した本文'; w.Fsn.save();
    assert.equal(w.Data.state().notes.find(r => r.Id === row.Id).value.title, '既存タイトル');
  } finally { c.close(); }
});

test('switching from task/post to personal/send hides titles again; titleless direct notes can be read and copied', async () => {
  const c = app({init:true}), w = c.w, d = w.document;
  try {
    await addUser(w, 'alice'); await addUser(w, 'bob'); await login(w);
    for (const mode of ['task', 'post']) {
      w.Fsn.open(null, mode); assert.equal(d.getElementById('note-title-label').style.display, 'block');
      w.Fsn.open(null, 'personal'); assert.equal(d.getElementById('note-title-label').style.display, 'none'); assert.equal(d.activeElement.id, 'note-content');
    }
    w.Fsn.open(null, 'send'); assert.equal(d.getElementById('note-title-label').style.display, 'none');
    d.getElementById('note-content').textContent = 'タイトルなしで送信'; d.getElementById('note-recipient').value = '@bob'; w.Fsn.save();
    await login(w, 'bob'); w.Fsn.open(w.Data.state().notes[0]);
    assert.equal(d.getElementById('note-title-label').style.display, 'none'); assert.match(d.getElementById('note-content').textContent, /タイトルなしで送信/);
    d.getElementById('editor-copy').click(); assert.equal(d.getElementById('note-title-label').style.display, 'none'); w.Fsn.save();
    assert.equal(w.Data.state().notes.filter(r => r.NoteType === 'PERSONAL').length, 1);
  } finally { c.close(); }
});

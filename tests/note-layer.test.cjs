const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, addUser, login, note } = require('./helpers.cjs');

test('new notes keep their position and persist above existing layers, including layers above 999', async () => {
  const c = app({init:true}), w = c.w;
  try {
    await addUser(w, 'alice'); await login(w);
    await call(w.Data, 'saveNote', null, note('既存'), '', 'PERSONAL');
    let old = w.Data.state().notes[0];
    await call(w.Data, 'saveNote', old, {...old.value, zIndex:1500, pinned:true}, '', 'PERSONAL');
    const value = {...note('新規'), x:30, y:30, zIndex:1};
    await call(w.Data, 'saveNote', null, value, '', 'PERSONAL');
    await call(w.Data, 'refresh');
    const added = w.Data.state().notes.find(r => r.value.title === '新規');
    assert.equal(added.value.zIndex,1501);
    assert.equal(added.value.x,30); assert.equal(added.value.y,30);
    w.Fsn.tab('stickies');
    const cards = [...w.document.querySelectorAll('.sticky-note')];
    const front = cards.find(card => card.getAttribute('data-id') === String(added.Id));
    assert.equal(Number(front.style.zIndex), Math.max(...cards.map(card => Number(card.style.zIndex))));
    await call(w.Data, 'saveNote', null, {...note('コピー'), zIndex:2}, '', 'PERSONAL');
    assert.equal(w.Data.state().notes.find(r => r.value.title === 'コピー').value.zIndex,1502);
    old = w.Data.state().notes.find(r => r.value.title === '既存');
    await call(w.Data, 'saveNote', old, {...old.value, title:'編集済み'}, '', 'PERSONAL');
    assert.equal(w.Data.state().notes.find(r => r.value.title === '編集済み').value.zIndex,1500);
  } finally { c.close(); }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, addUser, login, note } = require('./helpers.cjs');

async function setup() {
  const c = app({init:true}); await addUser(c.w, 'alice'); await addUser(c.w, 'bob'); await login(c.w); return c;
}
async function trashed(w, title = '削除対象の秘密', type = 'PERSONAL') {
  await call(w.Data, 'saveNote', null, note(title), '', type);
  const row = w.Data.state().notes.find(r => r.value.title === title);
  await call(w.Data, 'saveNote', row, {...row.value, deleted:true, contentHidden:true}, '', type);
  return w.Data.state().notes.find(r => r.Id === row.Id);
}
const button = w => w.document.getElementById('empty-trash');

test('empty trash is disabled when empty, requires confirmation, and cancellation makes no writes', async () => {
  const c = await setup(), w = c.w;
  try {
    w.Fsn.tab('trash'); assert.equal(button(w).disabled, true);
    await trashed(w); w.Fsn.render(); assert.equal(button(w).disabled, false);
    const before = JSON.stringify([...c.storage.map]);
    w.confirm = message => { assert.match(message, /1 件/); assert.match(message, /復元できなく/); assert.doesNotMatch(message, /削除対象の秘密/); return false; };
    button(w).click(); assert.equal(JSON.stringify([...c.storage.map]), before);
    const busy = w.Data.busy; w.Data.busy = () => true; w.Fsn.render();
    assert.equal(button(w).disabled, true); assert.equal(w.document.querySelector('[data-restore]').disabled, true);
    w.Data.busy = busy;
  } finally { c.close(); }
});

test('confirmed purge removes only own trash from the app, discards content/history, and preserves IDs and other data', async () => {
  const c = await setup(), w = c.w;
  try {
    await login(w, 'bob'); const other = await trashed(w, 'bob trash'); await login(w);
    const personal = await trashed(w), task = await trashed(w, 'task trash', 'TASK');
    await call(w.Data, 'saveNote', null, note('live'), '', 'PERSONAL');
    let live = w.Data.state().notes.find(r => r.value.title === 'live');
    await call(w.Data, 'saveNote', live, {...live.value, archived:true}, '', 'PERSONAL');
    await call(w.Data, 'saveNote', null, note('sent'), '@bob', 'DIRECT');
    await call(w.Data, 'savePost', null, {body:'post', category:'共有'});
    await call(w.Records, 'save', w.APP_CONFIG.LIST_NOTES, null, {Title:'encrypted-storage', SenderUserId:'alice', NoteType:'BLOB', Deleted:true, EncryptedPayload:''});
    const rawBefore = w.Storage.get('fsn_table_StickyNotes', []), recipients = JSON.stringify(w.Storage.get('fsn_table_StickyRecipients', []));
    w.Fsn.tab('trash'); w.confirm = message => { assert.match(message, /2 件/); return true; }; button(w).click();
    assert.equal(w.Data.trashRows().length, 0); assert.equal(button(w).disabled, true);
    assert.equal(w.document.querySelector('[data-restore]'), null); assert.match(w.document.getElementById('toast').textContent, /空にしました（2件）/);
    const rawAfter = w.Storage.get('fsn_table_StickyNotes', []);
    assert.equal(rawAfter.length, rawBefore.length); assert.equal(JSON.stringify(w.Storage.get('fsn_table_StickyRecipients', [])), recipients);
    for (const row of [personal, task]) {
      const saved = rawAfter.find(r => r.Id === row.Id);
      const key = w.StickyCrypto.decryptRecipientKey(row.recipient.EncryptedNoteKey, w.Session.key());
      const value = w.StickyCrypto.decryptJson(JSON.parse(saved.EncryptedPayload), key);
      assert.equal(value.purged, true); assert.equal(value.title, undefined); assert.equal(value.content, undefined); assert.equal(value.versions, undefined);
    }
    for (const row of rawBefore.filter(r => ![personal.Id, task.Id].includes(r.Id))) assert.deepEqual(rawAfter.find(r => r.Id === row.Id), row);
    assert.equal(w.Data.state().posts.length, 1);
    await login(w); assert.equal(w.Data.trashRows().length, 0);
    await call(w.Data, 'saveNote', null, note('new'), '', 'PERSONAL');
    assert.ok(w.Data.state().notes.find(r => r.value.title === 'new').Id > Math.max(...rawBefore.map(r => r.Id)));
    await login(w, 'bob'); assert.equal(w.Data.trashRows()[0].Id, other.Id);
  } finally { c.close(); }
});

test('purge is scoped to confirmed IDs, rejects non-trash targets before writing, and preserves newly added trash', async () => {
  const c = await setup(), w = c.w;
  try {
    const first = await trashed(w, 'first'); await call(w.Data, 'saveNote', null, note('live'), '', 'PERSONAL');
    const live = w.Data.state().notes.find(r => r.value.title === 'live');
    await assert.rejects(call(w.Data, 'emptyTrash', [first.Id, live.Id]), /対象が変わりました/);
    assert.equal(w.Data.trashRows().length, 1);
    const later = await trashed(w, 'later'); await call(w.Data, 'emptyTrash', [first.Id]);
    assert.equal(w.Data.trashRows().length, 1); assert.equal(w.Data.trashRows()[0].Id, later.Id);
  } finally { c.close(); }
});

test('partial failures refresh remaining trash and never report full success; retry processes only the remainder', async () => {
  const c = await setup(), w = c.w;
  try {
    await trashed(w, 'first'); const second = await trashed(w, 'second'); w.Fsn.tab('trash');
    const save = w.Records.save;
    w.Records.save = (title, row, fields, cb) => title === w.APP_CONFIG.LIST_NOTES && row.Id === second.Id ? cb(new Error('purge failed')) : save(title, row, fields, cb);
    button(w).click();
    assert.equal(w.Data.trashRows().length, 1); assert.equal(w.Data.trashRows()[0].Id, second.Id);
    assert.match(w.document.getElementById('toast').textContent, /削除確認済み 1件/);
    assert.match(w.document.getElementById('toast').textContent, /purge failed/); assert.equal(button(w).disabled, false);
    w.Records.save = save; button(w).click(); assert.equal(w.Data.trashRows().length, 0);
  } finally { c.close(); }
});

test('restored and concurrently updated items are not overwritten; unknown commit results are re-read', async () => {
  const c = await setup(), w = c.w;
  try {
    const row = await trashed(w); const get = w.Records.get;
    w.Records.get = (title, id, cb) => {
      if (title !== w.APP_CONFIG.LIST_NOTES) { get.call(w.Records, title, id, cb); return; }
      w.Records.get = get;
      const rows = w.Storage.get('fsn_table_StickyNotes', []); rows.find(r => r.Id === row.Id).Deleted = false; w.Storage.set('fsn_table_StickyNotes', rows);
      get.call(w.Records, title, id, cb);
    };
    await assert.rejects(call(w.Data, 'emptyTrash', [row.Id]), /削除を中止/);
    assert.equal(w.Data.state().notes[0].value.title, '削除対象の秘密');
    let current = w.Data.state().notes[0]; await call(w.Data, 'saveNote', current, {...current.value, deleted:true}, '', 'PERSONAL');
    const save = w.Records.save;
    w.Records.save = (title, old, fields, cb) => {
      w.Records.save = save;
      const rows = w.Storage.get('fsn_table_StickyNotes', []); rows.find(r => r.Id === row.Id)._rev += 1; w.Storage.set('fsn_table_StickyNotes', rows);
      save(title, old, fields, cb);
    };
    await assert.rejects(call(w.Data, 'emptyTrash', [row.Id]), /別の操作で更新/);
    assert.equal(w.Data.trashRows().length, 1);
    w.Records.save = (title, old, fields, cb) => { w.Records.save = save; save(title, old, fields, error => cb(error || new Error('timeout after commit'))); };
    await assert.rejects(call(w.Data, 'emptyTrash', [row.Id]), /timeout after commit/);
    assert.equal(w.Data.trashRows().length, 0);
  } finally { c.close(); }
});

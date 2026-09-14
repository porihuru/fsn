const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, addUser, login, note } = require('./helpers.cjs');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=';
const privateNote = () => ({...note('秘密タイトル'), content:'秘密本文\n<table><tr><td>秘密セル</td></tr></table><img src="' + png + '" alt="秘密写真">'});
const eye = (w, scope = '.sticky-note') => w.document.querySelector(scope + ' [data-action="visibility"]');
function concealed(element) {
  assert.ok(element.querySelector('.note-hidden-message'));
  assert.doesNotMatch(element.innerHTML, /秘密タイトル|秘密本文|秘密セル|秘密写真|2028-02-29/);
  assert.equal(element.querySelector('img, table, .note-body, h3'), null);
}
async function setup() {
  const c = app({init:true});
  await addUser(c.w, 'alice'); await addUser(c.w, 'bob'); await addUser(c.w, 'carol'); await login(c.w);
  return c;
}

test('eye conceals title, body, photos, tables and due date without deleting them; encrypted preference survives login', async () => {
  const c = await setup(), w = c.w, d = w.document;
  try {
    await call(w.Data, 'saveNote', null, privateNote(), '', 'PERSONAL'); w.Fsn.tab('stickies');
    const before = w.Data.state().notes[0].value;
    assert.equal(eye(w).getAttribute('aria-pressed'), 'false');
    eye(w).click(); concealed(d.querySelector('.sticky-note'));
    assert.equal(eye(w).getAttribute('aria-label'), 'タイトルと内容を表示');
    assert.equal(eye(w).getAttribute('aria-pressed'), 'true');
    assert.equal(w.Data.state().notes[0].value.content, before.content);
    assert.equal(w.Data.state().notes[0].value.title, before.title);
    assert.equal(w.Data.state().notes[0].value.contentHidden, true);
    assert.doesNotMatch(JSON.stringify([...c.storage.map.values()]), /秘密本文|秘密タイトル|contentHidden/);
    await call(w.Data, 'refresh'); w.Fsn.render(); concealed(d.querySelector('.sticky-note'));
    w.Fsn.lock(); await login(w); w.Fsn.tab('stickies'); concealed(d.querySelector('.sticky-note'));
    d.querySelector('.sticky-note [data-action="edit"]').click();
    assert.equal(d.getElementById('note-title').value, before.title);
    assert.ok(d.querySelector('#note-content img')); w.Fsn.save(); concealed(d.querySelector('.sticky-note'));
    d.querySelector('.sticky-note [data-action="minimized"]').click(); concealed(d.querySelector('.sticky-note'));
    eye(w).click();
    assert.equal(d.querySelector('.sticky-note h3').textContent, before.title);
    assert.equal(d.querySelector('.note-body').style.display, 'none'); // separate minimize setting
    d.querySelector('.sticky-note [data-action="minimized"]').click();
    assert.ok(d.querySelector('.note-body img')); assert.ok(d.querySelector('.note-body table'));
    assert.equal(d.querySelector('.note-due').textContent, before.due);
    assert.equal(w.Data.state().notes[0].value.contentHidden, false);
  } finally { c.close(); }
});

test('hidden personal notes do not leak through search, archive, trash or task copies', async () => {
  const c = await setup(), w = c.w, d = w.document;
  try {
    await call(w.Data, 'saveNote', null, {...privateNote(), contentHidden:true}, '', 'PERSONAL');
    w.Fsn.tab('search'); d.getElementById('global-search-input').value = '秘密'; w.Views.search();
    assert.doesNotMatch(d.getElementById('global-search-results').innerHTML, /秘密タイトル|秘密本文|秘密セル/);
    d.querySelector('[data-search-note]').click(); assert.equal(d.getElementById('note-title').value, '秘密タイトル'); w.Fsn.close();
    w.Fsn.tab('stickies'); d.querySelector('[data-action="archived"]').click();
    d.getElementById('archive-toggle').click(); concealed(d.querySelector('.sticky-note'));
    d.querySelector('[data-action="edit"]').click(); d.getElementById('note-to-task').click(); w.Fsn.close();
    w.Fsn.tab('tasks'); assert.doesNotMatch(d.getElementById('task-list').innerHTML, /秘密タイトル|2028-02-29/);
    eye(w, '.task-row').click(); assert.match(d.getElementById('task-list').textContent, /秘密タイトル/);
    eye(w, '.task-row').click(); assert.doesNotMatch(d.getElementById('task-list').innerHTML, /秘密タイトル|2028-02-29/);
    w.Fsn.tab('stickies'); d.querySelector('[data-action="delete"]').click(); w.Fsn.tab('trash');
    assert.doesNotMatch(d.getElementById('trash-list').innerHTML, /秘密タイトル/);
    d.querySelector('[data-restore]').click(); w.Fsn.tab('stickies'); concealed(d.querySelector('.sticky-note'));
  } finally { c.close(); }
});

test('received notes default to hidden, reveal marks read only once, and preview choices never affect other users', async () => {
  const c = await setup(), w = c.w, d = w.document;
  try {
    await call(w.Data, 'saveNote', null, {...privateNote(), contentHidden:false}, '@bob,@carol', 'DIRECT');
    const ciphertext = w.Data.state().notes[0].EncryptedPayload;
    await login(w, 'bob'); w.Fsn.tab('inbox');
    concealed(d.querySelector('.received-note')); assert.match(d.getElementById('inbox-list').textContent, /alice から/);
    assert.equal(w.Data.state().notes[0].recipient.IsRead, false);
    eye(w, '.received-note').click();
    assert.equal(w.Data.state().notes[0].recipient.IsRead, true);
    assert.ok(d.querySelector('.received-note img')); assert.ok(d.querySelector('.received-note table'));
    assert.equal(d.querySelector('.received-note h3').textContent, '秘密タイトル');
    const readAt = w.Data.state().notes[0].recipient.ReadAt;
    await call(w.Data, 'refresh'); w.Fsn.render(); assert.ok(d.querySelector('.received-note img'));
    eye(w, '.received-note').click(); concealed(d.querySelector('.received-note'));
    assert.equal(w.Data.state().notes[0].recipient.IsRead, true);
    eye(w, '.received-note').click(); assert.equal(w.Data.state().notes[0].recipient.ReadAt, readAt);
    assert.equal(w.Data.state().notes[0].EncryptedPayload, ciphertext);
    w.Fsn.lock(); await login(w, 'bob'); w.Fsn.tab('inbox'); concealed(d.querySelector('.received-note'));
    await login(w, 'carol'); w.Fsn.tab('inbox'); concealed(d.querySelector('.received-note'));
    assert.equal(w.Data.state().notes[0].recipient.IsRead, false);
    await login(w, 'alice'); w.Fsn.tab('inbox');
    assert.match(d.getElementById('sent-list').textContent, /秘密タイトル/);
    assert.equal(w.Data.state().notes[0].value.contentHidden, false);
    assert.equal(w.Data.state().notifications.filter(r => r.NotificationType === 'READ').length, 1);
  } finally { c.close(); }
});

test('explicit received-note opening shows content but leaves its list concealed; copies start hidden on the board', async () => {
  const c = await setup(), w = c.w, d = w.document;
  try {
    await call(w.Data, 'saveNote', null, privateNote(), '@bob', 'DIRECT'); await login(w, 'bob');
    w.Fsn.tab('search'); d.getElementById('global-search-input').value = '秘密'; w.Views.search();
    assert.doesNotMatch(d.getElementById('global-search-results').innerHTML, /秘密タイトル|秘密本文|秘密セル/);
    assert.equal(w.Data.state().notes[0].recipient.IsRead, false);
    d.querySelector('[data-search-note]').click();
    assert.equal(d.getElementById('note-title').value, '秘密タイトル'); assert.equal(w.Data.state().notes[0].recipient.IsRead, true);
    w.Fsn.close(); w.Fsn.tab('inbox'); concealed(d.querySelector('.received-note'));
    d.querySelector('#inbox-list [data-note]').click(); assert.ok(d.querySelector('#note-content img'));
    d.getElementById('editor-copy').click(); w.Fsn.save(); w.Fsn.tab('stickies'); concealed(d.querySelector('.sticky-note'));
    eye(w).click(); assert.ok(d.querySelector('.sticky-note img'));
    w.Fsn.tab('inbox'); concealed(d.querySelector('.received-note'));
  } finally { c.close(); }
});

test('failed hide saves retain the last saved preference, and hidden notes still share actual content', async () => {
  const c = await setup(), w = c.w, d = w.document;
  try {
    await call(w.Data, 'saveNote', null, privateNote(), '', 'PERSONAL'); w.Fsn.tab('stickies');
    const save = w.Records.save;
    w.Records.save = (title, row, fields, cb) => title === w.APP_CONFIG.LIST_NOTES ? cb(new Error('hide save failed')) : save(title, row, fields, cb);
    eye(w).click(); assert.equal(w.NoteVisibility.hidden(w.Data.state().notes[0]), false);
    assert.ok(d.querySelector('.note-body img')); assert.match(d.getElementById('toast').textContent, /hide save failed/);
    w.Records.save = save; eye(w).click(); concealed(d.querySelector('.sticky-note'));
    d.querySelector('[data-action="forward"]').click(); assert.ok(d.querySelector('#note-content img'));
    d.getElementById('note-recipient').value = '@bob'; w.Fsn.save();
    const sent = w.Data.state().notes.find(r => r.NoteType === 'DIRECT'); assert.equal(sent.value.contentHidden, undefined);
    assert.ok(sent.value.content.includes('秘密本文')); concealed(d.querySelector('.sticky-note'));
    await login(w, 'bob'); w.Fsn.tab('inbox'); concealed(d.querySelector('.received-note'));
  } finally { c.close(); }
});

test('unread-only filter keeps a revealed note visible until hidden; read failures and busy state do not claim success', async () => {
  const c = await setup(), w = c.w, d = w.document;
  try {
    await call(w.Data, 'saveNote', null, privateNote(), '@bob', 'DIRECT'); await login(w, 'bob'); w.Fsn.tab('inbox');
    d.getElementById('inbox-filter').click(); assert.equal(w.Fsn.unreadOnly(), true);
    const busy = w.Data.busy; w.Data.busy = () => true;
    eye(w, '.received-note').click(); concealed(d.querySelector('.received-note'));
    assert.equal(w.Data.state().notes[0].recipient.IsRead, false); w.Data.busy = busy;
    const save = w.Records.save;
    w.Records.save = (title, row, fields, cb) => title === w.APP_CONFIG.LIST_RECIPIENTS ? cb(new Error('read save failed')) : save(title, row, fields, cb);
    eye(w, '.received-note').click(); assert.ok(d.querySelector('.received-note img'));
    assert.equal(w.Data.state().notes[0].recipient.IsRead, false); assert.match(d.getElementById('toast').textContent, /read save failed/);
    w.Records.save = save; eye(w, '.received-note').click(); concealed(d.querySelector('.received-note'));
    eye(w, '.received-note').click(); assert.ok(d.querySelector('.received-note img'));
    assert.equal(w.Data.state().notes[0].recipient.IsRead, true);
    eye(w, '.received-note').click(); assert.equal(d.querySelector('.received-note'), null);
  } finally { c.close(); }
});

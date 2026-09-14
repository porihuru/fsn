const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { app, call, addUser, login, note, memory, password, root, scripts } = require('./helpers.cjs');

test('all shipped JS parses as ES5; HTML script paths and IDs are unique', () => {
  for (const file of fs.readdirSync(path.join(root, 'js'))) {
    if (file.endsWith('.js')) acorn.parse(fs.readFileSync(path.join(root, 'js', file), 'utf8'), { ecmaVersion: 5 });
  }
  const ctx = app();
  const ids = [...ctx.w.document.querySelectorAll('[id]')].map(n => n.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const file of scripts) assert.ok(fs.existsSync(path.join(root, file)));
  assert.equal(new Set(scripts).size, scripts.length);
  ctx.close();
});
test('date validation rejects rollover, bad format and supports leap days', () => {
  const c = app(), { date } = c.w.Util;
  for (const value of ['', '2028-02-29', '2026-12-31']) assert.equal(date(value), true, value);
  for (const value of ['2026-02-29','2026-02-30','2026-13-01','2026-00-01','2026-04-31','2026-9-1']) assert.equal(date(value), false, value);
  c.close();
});
test('storage denial/corruption is visible, never silently reported as an empty success', () => {
  const c = app(); c.storage.setItem('broken', '{');
  assert.throws(() => c.w.Storage.get('broken', []));
  c.storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => c.w.Storage.set('x', 'y'), /端末保存/);
  c.w.ErrorStore.add('保存', '失敗'); c.w.ErrorStore.add('保存', '失敗');
  assert.equal(c.w.ErrorStore.all().length, 1); assert.equal(c.w.ErrorStore.all()[0].count, 2);
  assert.equal(c.w.checkBrowserCompatibility(), false);
  c.close();
});
test('login requires explicit registration; profile, legacy-safe ID, password and lock', async () => {
  const c = app({init:true}), w = c.w;
  await assert.rejects(call(w.Auth,'login',{id:'new',password}), /未登録/);
  await addUser(w,'alice','同名','DEV01'); await login(w);
  await call(w.Auth,'updateProfile','変更後の名前','DEV99');
  await call(w.Session,'logout'); await login(w);
  assert.equal(w.Session.user().DisplayName,'変更後の名前');
  assert.equal(w.Session.user().Organization,'DEV99');
  await assert.rejects(call(w.Auth,'updateProfile','  ','DEV01'), /名前/);
  await assert.rejects(call(w.Auth,'updateProfile','名前','開発部'), /半角英数字/);
  await assert.rejects(call(w.Auth,'login',{id:'alice',password:'wrong'}), /パスワード/);
  w.Fsn.open(null,'personal',note()); w.Fsn.lock();
  assert.equal(w.Session.user(),null); assert.throws(() => w.Session.key());
  assert.equal(w.document.getElementById('note-content').value,'');
  assert.equal(w.document.getElementById('application').style.display,'none');
  c.close();
});
test('two tabs do not inherit each other’s session; superseded writer is rejected', async () => {
  const store = memory(), a = app({storage:store}), b = app({storage:store});
  await addUser(a.w,'alice'); await login(a.w); await login(b.w);
  await assert.rejects(call(a.w.Data,'saveNote',null,note(),'','PERSONAL'), /別のログイン/);
  assert.equal(a.w.Storage.get('fsn_table_StickyNotes',[]).length,0);
  await call(b.w.Data,'saveNote',null,note(),'','PERSONAL');
  assert.equal(b.w.Data.state().notes.length,1);
  a.close(); b.close();
});
test('personal save updates in place, encrypts, versions, deletes and restores', async () => {
  const c = app(), w = c.w; await addUser(w,'alice'); await login(w);
  await call(w.Data,'saveNote',null,note(),'','PERSONAL');
  let row = w.Data.state().notes[0], value = {...row.value, title:'編集後'};
  await call(w.Data,'saveNote',row,value,'','PERSONAL');
  row = w.Data.state().notes[0]; assert.equal(row.value.title,'編集後'); assert.equal(row.value.versions.length,1);
  assert.equal(w.Storage.get('fsn_table_StickyNotes',[]).length,1);
  assert.equal(w.Storage.get('fsn_table_StickyRecipients',[]).length,1);
  assert.ok(!JSON.stringify([...c.storage.map.values()]).includes('本文 secret'));
  await call(w.Data,'saveNote',row,{...row.value,deleted:true},'','PERSONAL');
  row = w.Data.state().notes[0]; assert.equal(row.Deleted,true);
  await call(w.Data,'saveNote',row,{...row.value,deleted:false},'','PERSONAL');
  assert.equal(w.Data.state().notes[0].Deleted,false);
  await addUser(w,'bob'); await login(w,'bob'); assert.equal(w.Data.state().notes.length,0);
  c.close();
});
test('button and Ctrl+S share validation; send cancel resets recipient; read-only cannot save', async () => {
  const c = app({init:true}), w = c.w, doc = w.document;
  await addUser(w,'alice'); await login(w); w.Fsn.tab('stickies');
  doc.getElementById('send-note').click(); doc.getElementById('note-recipient').value='@nobody'; doc.getElementById('editor-cancel').click();
  assert.ok(!doc.getElementById('editor-modal').className.includes('visible'));
  doc.getElementById('new-note').click(); assert.equal(doc.getElementById('note-recipient').value,'');
  doc.getElementById('note-title').value='試験'; doc.getElementById('note-due').value='2026-02-30';
  doc.getElementById('editor-save').click(); assert.equal(w.Data.state().notes.length,0);
  doc.dispatchEvent(new w.KeyboardEvent('keydown',{ctrlKey:true,keyCode:83,bubbles:true})); assert.equal(w.Data.state().notes.length,0);
  doc.getElementById('note-due').value='2028-02-29'; doc.getElementById('editor-save').click(); assert.equal(w.Data.state().notes.length,1);
  w.Fsn.open(null,'read',note()); assert.equal(w.Fsn.save(),false);
  doc.dispatchEvent(new w.KeyboardEvent('keydown',{ctrlKey:true,keyCode:83,bubbles:true})); assert.equal(w.Data.state().notes.length,1);
  c.close();
});
test('strict recipient resolution: duplicate display names, explicit groups, dedup and no partial unknown targets', async () => {
  const c = app(), w = c.w;
  await addUser(w,'alice','同名','DEV01'); await addUser(w,'bob','同名','DEV01'); await addUser(w,'carol','別名','OPS02'); await login(w);
  const users = w.Data.state().users;
  assert.throws(()=>w.Data.resolve('同名',users), /同名/);
  assert.throws(()=>w.Data.resolve('@bob,,@carol',users), /空/);
  assert.throws(()=>w.Data.resolve('#DEV01,@missing',users), /未登録/);
  assert.equal(w.Data.resolve('#DEV01,@bob',users).length,2);
  await assert.rejects(call(w.Data,'saveNote',null,note(),'@missing','DIRECT'), /未登録/);
  assert.equal(w.Storage.get('fsn_table_StickyNotes',[]).length,0);
  await call(w.Data,'saveNote',null,note(),'@bob,@carol,@bob','DIRECT');
  assert.equal(w.Data.state().notes[0].recipients.length,3); // sender key included
  await login(w,'bob'); assert.equal(w.Data.state().notes.length,1);
  const before = w.Data.state().notes[0]; await call(w.Data,'readNote',before);
  const first = w.Data.state().notes[0].recipient.ReadAt; await call(w.Data,'readNote',w.Data.state().notes[0]);
  assert.equal(w.Data.state().notes[0].recipient.ReadAt,first);
  await login(w,'alice'); assert.equal(w.Data.state().notes[0].recipients.filter(r=>r.IsRead).length,2);
  c.close();
});
test('recipient write failure rolls back staged note and does not report success', async () => {
  const c = app(), w = c.w; await addUser(w,'alice'); await addUser(w,'bob'); await login(w);
  const original = w.Records.save; let calls=0;
  w.Records.save = function(title,row,fields,cb) { if (title==='StickyRecipients' && ++calls===2) { cb(new Error('receipt failure')); return; } original.call(this,title,row,fields,cb); };
  await assert.rejects(call(w.Data,'saveNote',null,note(),'@bob','DIRECT'),/receipt failure/);
  assert.equal(w.Storage.get('fsn_table_StickyNotes',[]).length,0);
  assert.equal(w.Storage.get('fsn_table_StickyRecipients',[]).length,0);
  assert.equal(w.Audit.all().filter(r=>r.action==='SEND_NOTE').length,0);
  c.close();
});
test('failed refresh preserves last good state; corrupt ciphertext never renders plaintext', async () => {
  const c = app(), w = c.w; await addUser(w,'alice'); await login(w); await call(w.Data,'saveNote',null,note(),'','PERSONAL');
  const previous=w.Data.state(); c.storage.setItem('fsn_table_StickyPosts','bad JSON');
  await assert.rejects(call(w.Data,'refresh')); assert.equal(w.Data.state(),previous);
  c.storage.removeItem('fsn_table_StickyPosts');
  const rows=w.Storage.get('fsn_table_StickyNotes',[]), payload=JSON.parse(rows[0].EncryptedPayload); payload.authTag='AAAAAAAAAAAAAAAAAAAAAA=='; rows[0].EncryptedPayload=JSON.stringify(payload); w.Storage.set('fsn_table_StickyNotes',rows);
  await assert.rejects(call(w.Data,'refresh'),/検証/); assert.equal(w.Data.state(),previous);
  c.close();
});
test('SNS identity, votes, copy, comments and views use stable IDs; hidden render is not a view', async () => {
  const c=app({init:true}), w=c.w; await addUser(w,'alice','同名'); await addUser(w,'bob','同名'); await login(w);
  await call(w.Data,'savePost',null,{body:'実際の投稿本文',category:'アンケート',options:['A','B']});
  let post=w.Data.state().posts[0]; w.Fsn.tab('sns'); assert.equal(w.Data.state().views.length,0);
  w.document.querySelector('[data-action="copy"]').click(); assert.equal(w.document.getElementById('note-content').value,'実際の投稿本文'); w.Fsn.close();
  await call(w.Data,'react',post,'VOTE:0'); await call(w.Data,'react',post,'VOTE:1');
  assert.equal(w.Data.state().reactions.length,1); assert.equal(w.Data.state().reactions[0].ReactionType,'VOTE:1');
  await call(w.Data,'view',post); await call(w.Data,'view',post); assert.equal(w.Data.state().views.length,1); assert.equal(w.Data.state().views[0].ViewCount,2);
  await login(w,'bob'); post=w.Data.state().posts[0];
  await assert.rejects(call(w.Data,'savePost',post,{...post.value,deleted:true}),/他の利用者/);
  await call(w.Data,'react',post,'LIKE'); await call(w.Data,'comment',post,'@alice コメント');
  assert.equal(w.Data.state().comments.length,1); assert.equal(w.Data.state().reactions.filter(r=>r.ReactionType==='LIKE').length,1);
  await login(w,'alice'); assert.equal(w.Data.state().notifications.filter(r=>r.NotificationType==='COMMENT').length,1);
  w.Fsn.tab('search'); w.document.getElementById('global-search-input').value='実際の投稿'; w.Views.search();
  assert.ok(w.document.getElementById('global-search-results').textContent.includes('実際の投稿本文'));
  assert.ok(!w.document.getElementById('global-search-results').textContent.includes('該当するデータはありません'));
  c.close();
});
test('HTML sanitizer, CSV formula safety, and pinned/archived rendering', async () => {
  const c=app({init:true}),w=c.w;
  const clean=w.sanitizeHtml('<script>alert(1)</script><img src=x onerror=alert(1)><strong onclick="x()">ok</strong><a href="javascript:x()">a</a>');
  assert.equal(clean,'<strong>ok</strong>'); assert.equal(w.Fsn.csv(' =1+1'),'"\' =1+1"');
  await addUser(w,'alice'); await login(w); await call(w.Data,'saveNote',null,{...note(),pinned:true},'','PERSONAL'); w.Fsn.tab('stickies');
  assert.ok(w.document.querySelector('.sticky-note.pinned')); assert.equal(w.document.querySelector('.resize-handle'),null);
  let row=w.Data.state().notes[0]; await call(w.Data,'saveNote',row,{...row.value,archived:true},'','PERSONAL'); w.Fsn.render(); assert.equal(w.document.querySelector('.sticky-note'),null);
  w.document.getElementById('archive-toggle').click(); assert.ok(w.document.querySelector('.sticky-note'));
  c.close();
});

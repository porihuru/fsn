const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, addUser, password, note, memory } = require('./helpers.cjs');

async function setup(remember = true) {
  const c = app({init:true});
  await addUser(c.w, 'alice');
  await call(c.w.Auth, 'login', {id:'alice', password, remember});
  await call(c.w.Data, 'refresh');
  return c;
}
function rememberedKey(storage) { return [...storage.map.keys()].find(k => k.startsWith('fsn_trusted_device_')); }

test('remember is opt-in and never stores the password or a plaintext private key', async () => {
  const c = await setup(false), w = c.w;
  try {
    assert.equal(w.TrustedDevice.load(), null);
    assert.equal(w.document.getElementById('remember-device').checked, false);
    await call(w.Auth, 'login', {id:'alice',password,remember:true});
    const saved = w.TrustedDevice.load();
    assert.equal(saved.version,1);
    assert.equal(new Date(saved.expiresAt) - new Date(w.Storage.get('fsn_table_StickySessions',[]).slice(-1)[0].CreatedAt), 30*24*3600000);
    assert.ok(!JSON.stringify(saved).includes(password));
    assert.ok(!JSON.stringify(saved).includes('PRIVATE KEY'));
    assert.ok(saved.privateKey.cipherText);
    assert.equal(w.document.getElementById('login-password').value, '');
  } finally { c.close(); }
});
test('reload resumes the same validated session and decrypts existing notes without a password', async () => {
  const c = await setup(), w=c.w;
  try {
    await call(w.Data,'saveNote',null,note(),'','PERSONAL');
    const token=w.Session.token(), count=w.Storage.get('fsn_table_StickySessions',[]).length;
    w.Session.clear(); w.Data.reset();
    await call(w.Session,'restore'); await call(w.Data,'refresh');
    assert.equal(w.Session.token(), token);
    assert.equal(w.Storage.get('fsn_table_StickySessions',[]).length, count);
    assert.equal(w.Data.state().notes[0].value.content,note().content);
    assert.equal(w.Session.user().userId,'alice');
  } finally { c.close(); }
});
test('a new page automatically opens the application and does not extend the expiry', async () => {
  const c=await setup(), saved=c.w.TrustedDevice.load(), next=app({storage:c.storage,init:true});
  try {
    assert.equal(next.w.Session.user().userId,'alice');
    assert.equal(next.w.document.getElementById('application').style.display,'block');
    assert.equal(next.w.document.getElementById('login-screen').style.display,'none');
    assert.equal(next.w.TrustedDevice.load().expiresAt,saved.expiresAt);
    assert.equal(next.w.document.getElementById('login-password').value,'');
  } finally { c.close(); next.close(); }
});
test('lock, logout and explicit removal disable automatic login', async () => {
  const c=await setup(), w=c.w;
  try {
    const old=w.TrustedDevice.load(), storageKey=rememberedKey(c.storage);
    await call(w.Session,'forgetDevice');
    assert.equal(w.TrustedDevice.load(),null);
    assert.notEqual(w.Session.token(),old.token);
    assert.ok(w.Session.user()); // explicit removal keeps the current screen open
    w.Storage.set(storageKey,old);
    w.Session.clear(); await assert.rejects(call(w.Session,'restore'),/無効/);
    await call(w.Auth,'login',{id:'alice',password,remember:true});
    w.Fsn.lock();
    assert.equal(w.TrustedDevice.load(),null); assert.equal(w.Session.user(),null);
    assert.equal(await call(w.Session,'restore'),null);
    await call(w.Auth,'login',{id:'alice',password,remember:true});
    const id=w.TrustedDevice.load().sessionId;
    await call(w.Session,'logout'); assert.equal(w.TrustedDevice.load(),null);
    assert.equal(w.Storage.get('fsn_table_StickySessions',[]).find(r=>r.Id===id).Revoked,true);
  } finally { c.close(); }
});
test('expired, tampered, disabled, revoked and changed-password credentials are rejected', async () => {
  const changes = [
    (w,s) => { s.expiresAt='2000-01-01T00:00:00.000Z'; },
    (w,s) => { s.privateKey.authTag='AAAAAAAAAAAAAAAAAAAAAA=='; },
    (w,s) => { const rows=w.Storage.get('fsn_table_StickyUsers',[]); rows[0].Enabled=false; w.Storage.set('fsn_table_StickyUsers',rows); },
    (w,s) => { const rows=w.Storage.get('fsn_table_StickySessions',[]); rows[0].Revoked=true; w.Storage.set('fsn_table_StickySessions',rows); },
    (w,s) => { const rows=w.Storage.get('fsn_table_StickyUsers',[]); rows[0].PasswordHash += ' '; w.Storage.set('fsn_table_StickyUsers',rows); },
    (w,s) => { s.deviceId='different-device'; },
    (w,s) => { s.sessionId=999; },
    (w,s) => { s.expiresAt='not-a-date'; }
  ];
  for (const change of changes) {
    const c=await setup(), w=c.w;
    try {
      const saved=w.TrustedDevice.load(), key=rememberedKey(c.storage);
      change(w,saved); w.Storage.set(key,saved); w.Session.clear();
      await assert.rejects(call(w.Session,'restore'));
      assert.equal(w.Session.user(),null); assert.equal(w.TrustedDevice.load(),null);
      assert.throws(()=>w.Session.key());
    } finally { c.close(); }
  }
});
test('wrong password does not create a remembered login; unchecked login removes prior opt-in', async () => {
  const c=await setup(false), w=c.w;
  try {
    await assert.rejects(call(w.Auth,'login',{id:'alice',password:'wrong',remember:true}));
    assert.equal(w.TrustedDevice.load(),null);
    await call(w.Auth,'login',{id:'alice',password,remember:true}); assert.ok(w.TrustedDevice.load());
    await call(w.Auth,'login',{id:'alice',password,remember:false}); assert.equal(w.TrustedDevice.load(),null);
    const row=w.Storage.get('fsn_table_StickySessions',[]).slice(-1)[0];
    assert.equal(new Date(row.ExpiresAt)-new Date(row.CreatedAt),8*3600000);
  } finally { c.close(); }
});
test('storage write failure is reported without persisting credentials or losing manual login', async () => {
  const c=await setup(false), w=c.w, write=c.storage.setItem;
  try {
    c.storage.setItem=(key,value)=>{if(key.startsWith('fsn_trusted_device_'))throw new Error('quota'); write(key,value);};
    await call(w.Auth,'login',{id:'alice',password,remember:true});
    assert.ok(w.Session.user()); assert.equal(w.TrustedDevice.load(),null);
    assert.match(w.Session.rememberWarning(),/端末保存に失敗/);
    assert.ok(w.ErrorStore.all().some(r=>r.source==='自動ログイン'));
  } finally { c.close(); }
});
test('logout clears credentials immediately even when server revocation fails', async () => {
  const c=await setup(), w=c.w;
  try {
    w.Records.get=(title,id,cb)=>cb(new Error('network down'));
    await assert.rejects(call(w.Session,'logout'),/network down/);
    assert.equal(w.TrustedDevice.load(),null); assert.equal(w.Session.user(),null);
  } finally { c.close(); }
});
test('a stale tab cannot delete another manual login’s remembered credential', async () => {
  const storage=memory(), a=app({storage,init:true}), b=app({storage,init:true});
  try {
    await addUser(a.w,'alice'); await addUser(a.w,'bob');
    await call(a.w.Auth,'login',{id:'alice',password,remember:true});
    await call(b.w.Auth,'login',{id:'bob',password,remember:true});
    const token=b.w.TrustedDevice.load().token;
    await call(a.w.Session,'logout');
    assert.equal(b.w.TrustedDevice.load().token,token);
    b.w.Session.clear(); await call(b.w.Session,'restore'); assert.equal(b.w.Session.user().userId,'bob');
  } finally { a.close(); b.close(); }
});
test('SharePoint restore verifies current Windows/SharePoint identity before unlocking', async () => {
  for (const sameAccount of [true,false]) {
    const c=await setup(), w=c.w;
    try {
      const token=w.Session.token(), key=w.Session.key();
      let row=w.Storage.get('fsn_table_StickyUsers',[])[0]; row.LoginName='domain\\alice'; row.SharePointUserId='42';
      w.Storage.set('fsn_table_StickyUsers',[row]);
      const session=w.Storage.get('fsn_table_StickySessions',[])[0];
      w.APP_CONFIG.USE_SHAREPOINT=true; w.APP_CONFIG.SHAREPOINT_BASE_URL='https://example.test/site';
      w.TrustedDevice.save(row,session,token,key); w.Session.clear();
      let identityChecked=false, unlocked=false;
      w.SharePoint.getCurrentUser=cb=>{identityChecked=true; cb(null,{Id:sameAccount?42:99,LoginName:sameAccount?'domain\\alice':'domain\\bob'});};
      w.Records.get=(table,id,cb)=>{assert.equal(identityChecked,true);cb(null,w.Storage.get('fsn_table_'+table,[]).find(r=>r.Id===id));};
      const original=w.TrustedDevice.unlock;
      w.TrustedDevice.unlock=(...args)=>{unlocked=true;return original(...args);};
      if(sameAccount){await call(w.Session,'restore');assert.equal(w.Session.user().userId,'alice');assert.equal(unlocked,true);}
      else{await assert.rejects(call(w.Session,'restore'),/無効/);assert.equal(unlocked,false);}
    } finally { c.close(); }
  }
});
test('corrupt resume storage and forgotten-password help remain readable on the login page', () => {
  const storage=memory(); storage.setItem('fsn_trusted_device_local','invalid JSON');
  const c=app({storage,init:true}), w=c.w;
  try {
    assert.equal(w.Session.user(),null); assert.equal(w.document.getElementById('login-button').disabled,false);
    assert.ok(w.document.getElementById('login-error').textContent);
    w.document.getElementById('forgot-password').click();
    assert.equal(w.document.getElementById('password-help').style.display,'block');
    assert.match(w.document.getElementById('password-help').textContent,/復号できません/);
  } finally { c.close(); }
});

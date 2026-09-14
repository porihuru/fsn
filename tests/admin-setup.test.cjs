const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, addUser, password, note, pair } = require('./helpers.cjs');
const adminPassword = 'Administrator-Only-Password-2026!';
const settingsId = '__fsn:admin-recovery:v1';
const settings = w => w.Storage.get('fsn_table_StickyUsers', []).filter(r => r.StickyUserId === settingsId);
const user = (w, id='alice') => w.Storage.get('fsn_table_StickyUsers', []).find(r => r.StickyUserId === id);
const register = w => call(w.Recovery, 'setup', adminPassword, adminPassword);
async function until(predicate) { for (let n=0;n<100;n++) { if(predicate()) return; await new Promise(resolve=>setTimeout(resolve,20)); } assert.fail('UI did not finish'); }
function submit(w,id) { w.document.getElementById(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); }

test('one-time password registration persists encrypted settings and enables fileless reset across reloads', async () => {
  const c=app(), w=c.w; let reopened;
  try {
    await addUser(w,'alice','既存利用者');
    await call(w.Auth,'login',{id:'alice',password}); await call(w.Data,'refresh');
    await call(w.Data,'saveNote',null,note(),'','PERSONAL');
    const key=w.Session.key(), publicKey=user(w).PublicKey;
    const saved=await register(w);
    assert.equal(saved.Enabled,false); assert.equal(settings(w).length,1);
    assert.equal(w.APP_CONFIG.RECOVERY_PUBLIC_KEY,''); // no config-file editing
    assert.equal((await call(w.Auth,'directory')).length,1);
    const packageData=JSON.parse(saved.EncryptedPrivateKey);
    const adminKey=w.StickyCrypto.unlockUserPrivateKey(adminPassword,packageData.material);
    const storageText=JSON.stringify([...c.storage.map.values()]);
    for(const secret of [adminPassword,password,adminKey,key]) assert.ok(!storageText.includes(secret));
    await assert.rejects(call(w.Recovery,'resetStored','alice',adminPassword),/未登録/);
    reopened=app({storage:c.storage});
    await call(reopened.w.Auth,'login',{id:'alice',password});
    assert.ok(JSON.parse(user(w).EncryptedPrivateKey).recovery);
    assert.equal(reopened.w.Recovery.publicKey(),saved.PublicKey);
    const temporary=await call(reopened.w.Recovery,'resetStored','alice',adminPassword);
    await call(reopened.w.Auth,'login',{id:'alice',password:temporary.temporaryPassword});
    await call(reopened.w.Auth,'completeReset','New-Password-2026!','New-Password-2026!');
    await call(reopened.w.Auth,'login',{id:'alice',password:'New-Password-2026!'});
    await call(reopened.w.Data,'refresh');
    assert.equal(reopened.w.Session.key(),key); assert.equal(user(w).PublicKey,publicKey);
    assert.equal(reopened.w.Data.state().notes[0].value.content,note().content);
    await call(reopened.w.Auth,'login',{id:'newuser',password,confirm:password,register:true,name:'新規',organization:'DEV01'});
    assert.ok(JSON.parse(user(w,'newuser').EncryptedPrivateKey).recovery);
    await assert.rejects(call(w.Recovery,'resetStored',settingsId,adminPassword),/有効な利用者/);
  } finally { if(reopened) reopened.close(); c.close(); }
});

test('invalid passwords, existing settings and legacy keys cannot overwrite a registered key', async () => {
  const c=app(),w=c.w;
  try {
    await assert.rejects(call(w.Recovery,'setup','short','short'),/12文字/);
    await assert.rejects(call(w.Recovery,'setup',adminPassword,'different'),/一致/);
    assert.equal(settings(w).length,0);
    await register(w); const original=JSON.stringify(settings(w));
    await assert.rejects(register(w),/登録済み/);
    assert.equal(JSON.stringify(settings(w)),original);
    w.APP_CONFIG.RECOVERY_PUBLIC_KEY=pair.publicKey;
    await assert.rejects(call(w.Recovery,'load'),/一致しません/);
    assert.equal(JSON.stringify(settings(w)),original);
  } finally { c.close(); }
  const legacy=app();
  try { legacy.w.APP_CONFIG.RECOVERY_PUBLIC_KEY=pair.publicKey; await assert.rejects(register(legacy.w),/登録済み/); assert.equal(settings(legacy.w).length,0); }
  finally { legacy.close(); }
});

test('read/write failure is not treated as empty settings or successful setup', async () => {
  const c=app(),w=c.w;
  try {
    const list=w.Records.list,save=w.Records.save,run=w.CryptoJobs.run; let generated=0;
    w.CryptoJobs.run=(job,cb)=>{generated++;run(job,cb);};
    w.Records.list=(title,filter,predicate,cb)=>cb(new Error('read denied'));
    await assert.rejects(register(w),/read denied/); assert.equal(generated,0);
    w.Records.list=list;
    w.Records.save=(title,row,fields,cb)=>cb(new Error('write denied'));
    await assert.rejects(register(w),/write denied/); assert.equal(settings(w).length,0); assert.equal(w.Recovery.configured(),false);
    w.Records.save=save; await register(w); assert.equal(settings(w).length,1);
  } finally { c.close(); }
});

test('unknown setup response is recovered by reading saved settings, never generating a replacement', async () => {
  const c=app(),w=c.w;
  try {
    const save=w.Records.save;
    w.Records.save=(title,row,fields,cb)=>save(title,row,fields,()=>cb(new Error('timeout after commit')));
    await assert.rejects(register(w),/timeout/); assert.equal(settings(w).length,1);
    const original=JSON.stringify(settings(w)); w.Records.save=save;
    await assert.rejects(register(w),/登録済み/); assert.equal(JSON.stringify(settings(w)),original);
    assert.equal((await call(w.Recovery,'load')).PublicKey,settings(w)[0].PublicKey);
  } finally { c.close(); }
});

test('SharePoint bootstrap denies non-admins, account changes and HTTP before saving', async () => {
  const c=app(),w=c.w;
  try {
    w.APP_CONFIG.USE_SHAREPOINT=true; let writes=0,reads=0;
    w.Records.list=(title,filter,predicate,cb)=>{reads++;cb(null,[]);};
    w.Records.save=()=>{writes++;};
    w.SharePoint.getCurrentUser=cb=>cb(null,{Id:1,LoginName:'member',IsSiteAdmin:false});
    await assert.rejects(register(w),/サイトコレクション管理者/); assert.equal(reads,0);
    await assert.rejects(call(w.Recovery,'resetStored','alice',adminPassword),/サイトコレクション管理者/); assert.equal(reads,0);
    let checks=0;
    w.SharePoint.getCurrentUser=cb=>{checks++;cb(null,{Id:checks,LoginName:'admin-'+checks,IsSiteAdmin:true});};
    await assert.rejects(register(w),/アカウントが変わりました/); assert.equal(writes,0);
    c.dom.reconfigure({url:'http://example.test/index.html#admin'});
    await assert.rejects(register(w),/HTTPS/); assert.equal(writes,0);
  } finally { c.close(); }
});

test('concurrent bootstrap keeps the first saved key and reports the losing password as unregistered', async () => {
  const c=app(),w=c.w;
  try {
    const save=w.Records.save, competitor=w.StickyCrypto.rewrapUserKey('Competing-Admin-Password',pair.privateKey,pair.publicKey);
    w.Records.save=(title,row,fields,cb)=>{
      const first={...fields,PublicKey:pair.publicKey,EncryptedPrivateKey:JSON.stringify({version:'FSN-ADMIN-KEY-V1',material:competitor})};
      save(title,null,first,error=>{if(error) cb(error);else save(title,row,fields,cb);});
    };
    await assert.rejects(register(w),/先に保存/);
    assert.equal(settings(w).length,2); assert.equal(w.Recovery.publicKey(),pair.publicKey);
    w.Records.save=save;
    const rows=w.Storage.get('fsn_table_StickyUsers',[]); w.Storage.set('fsn_table_StickyUsers',rows.reverse());
    assert.equal((await call(w.Recovery,'load')).Id,1);
    await assert.rejects(register(w),/登録済み/);
  } finally { c.close(); }
});

test('corrupt stored settings do not allow replacement or unprotected user registration', async () => {
  const c=app(),w=c.w;
  try {
    await register(w);
    const rows=w.Storage.get('fsn_table_StickyUsers',[]); rows[0].EncryptedPrivateKey='{}'; w.Storage.set('fsn_table_StickyUsers',rows);
    await assert.rejects(register(w),/破損/);
    await assert.rejects(call(w.Auth,'login',{id:'alice',password,confirm:password,register:true,name:'利用者',organization:'DEV01'}),/破損/);
    assert.equal(w.Storage.get('fsn_table_StickyUsers',[]).length,1);
  } finally { c.close(); }
});

test('admin UI completes setup and reset without file inputs or downloads and hides settings rows', async () => {
  const c=app({url:'https://example.test/sticky/index.html#admin'}),w=c.w; let reopened;
  try {
    await addUser(w,'alice','利用者');
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    assert.equal(w.document.querySelector('#admin-root input[type=file]'),null);
    assert.equal(w.document.getElementById('download-admin-key'),null);
    assert.equal(w.document.getElementById('admin-setup-panel').style.display,'block');
    w.document.getElementById('setup-password').value=adminPassword;
    w.document.getElementById('setup-confirm').value=adminPassword; submit(w,'admin-key-form');
    await until(()=>w.document.getElementById('admin-reset-panel').style.display==='block');
    assert.equal(w.document.getElementById('setup-password').value,'');
    assert.equal(w.document.getElementById('admin-setup-panel').style.display,'none');
    assert.match(w.document.getElementById('admin-status').textContent,/登録が完了/);
    const choices=w.document.getElementById('reset-user-id'); assert.equal(choices.options.length,2);
    assert.match(choices.options[1].textContent,/利用者.*DEV01.*alice/);
    await call(w.Auth,'login',{id:'alice',password});
    const before=JSON.stringify(user(w)); choices.value='alice'; w.document.getElementById('admin-key-password').value=adminPassword;
    w.confirm=()=>false; submit(w,'admin-reset-form'); assert.equal(JSON.stringify(user(w)),before);
    w.confirm=()=>true; w.document.getElementById('admin-key-password').value='wrong-password'; submit(w,'admin-reset-form');
    await until(()=>!w.document.getElementById('admin-reset-submit').disabled);
    assert.equal(w.document.getElementById('admin-reset-result').style.display,'none'); assert.equal(JSON.stringify(user(w)),before);
    w.document.getElementById('admin-key-password').value=adminPassword; submit(w,'admin-reset-form');
    await until(()=>w.document.getElementById('admin-reset-result').style.display==='block');
    assert.ok(w.document.getElementById('temporary-password').value); assert.equal(w.document.getElementById('admin-key-password').value,'');
    w.document.getElementById('admin-clear').click(); assert.equal(w.document.getElementById('temporary-password').value,'');
    reopened=app({storage:c.storage,url:'https://example.test/sticky/index.html#admin'});
    reopened.w.document.dispatchEvent(new reopened.w.Event('DOMContentLoaded'));
    assert.equal(reopened.w.document.getElementById('admin-reset-panel').style.display,'block');
    assert.equal(reopened.w.document.getElementById('admin-setup-panel').style.display,'none');
    assert.equal(reopened.w.Session.user(),null);
  } finally { if(reopened) reopened.close(); c.close(); }
});

test('SharePoint reads shared admin settings on a separate browser without local setup', async () => {
  const c=app(), remote=app(), w=remote.w;
  try {
    const saved=await register(c.w); let requests=0;
    w.APP_CONFIG.USE_SHAREPOINT=true;
    w.SharePoint.listItems=(title,query,cb)=>{
      requests++; assert.equal(title,'StickyUsers'); assert.match(query,/StickyUserId eq/);
      cb({ok:true,data:[JSON.parse(JSON.stringify(saved))]});
    };
    assert.equal((await call(w.Recovery,'load')).PublicKey,saved.PublicKey);
    assert.equal(w.Recovery.publicKey(),saved.PublicKey); assert.equal(remote.storage.map.size,0); assert.equal(requests,1);
  } finally { remote.close(); c.close(); }
});

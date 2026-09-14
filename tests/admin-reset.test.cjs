const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { app, call, addUser, password, note, root } = require('./helpers.cjs');
const pair = crypto.generateKeyPairSync('rsa', {modulusLength:2048, publicKeyEncoding:{type:'spki',format:'pem'}, privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const adminPassword='Admin-Recovery-Only-2026!';
const newPassword='New-User-Password-2026!';
let packageText;
async function setup(enroll=true) {
  const c=app({init:true}), w=c.w;
  if (!packageText) packageText=JSON.stringify({version:'FSN-ADMIN-KEY-V1',material:w.StickyCrypto.rewrapUserKey(adminPassword,pair.privateKey,pair.publicKey)});
  if (enroll) w.APP_CONFIG.RECOVERY_PUBLIC_KEY=pair.publicKey;
  await addUser(w,'alice','利用者');
  await call(w.Auth,'login',{id:'alice',password,remember:true}); await call(w.Data,'refresh');
  return c;
}
const row = w => w.Storage.get('fsn_table_StickyUsers',[])[0];
const reset = w => call(w.Recovery,'reset','alice',packageText,adminPassword);

test('admin reset preserves old ciphertext, public/private keys, and forces change before access', async () => {
  const c=await setup(), w=c.w;
  try {
    await call(w.Data,'saveNote',null,note(),'','PERSONAL');
    const before=row(w), oldKey=w.Session.key(), oldNotes=JSON.stringify(w.Storage.get('fsn_table_StickyNotes',[]));
    assert.ok(JSON.parse(before.EncryptedPrivateKey).recovery);
    const result=await reset(w), temporary=result.temporaryPassword;
    assert.equal(row(w).PublicKey,before.PublicKey);
    assert.equal(row(w).CurrentSessionHash,'');
    assert.equal(JSON.stringify(w.Storage.get('fsn_table_StickyNotes',[])),oldNotes);
    await assert.rejects(call(w.Session,'guard'),/別のログイン/);
    w.Session.clear(); await assert.rejects(call(w.Session,'restore'));
    await assert.rejects(call(w.Auth,'login',{id:'alice',password}),/パスワード/);
    const response=await call(w.Auth,'login',{id:'alice',password:temporary,remember:true});
    assert.equal(response.requirePasswordChange,true); assert.equal(w.Session.user(),null); assert.equal(w.TrustedDevice.load(),null);
    await assert.rejects(call(w.Data,'saveNote',null,note(),'','PERSONAL'),/ログイン/);
    await assert.rejects(call(w.Auth,'completeReset',temporary,temporary),/異なる/);
    await call(w.Auth,'completeReset',newPassword,newPassword);
    assert.equal(w.Session.user(),null); // normal login is still required
    await assert.rejects(call(w.Auth,'login',{id:'alice',password:temporary}),/パスワード/);
    await call(w.Auth,'login',{id:'alice',password:newPassword}); await call(w.Data,'refresh');
    assert.equal(w.Session.key(),oldKey);
    assert.equal(w.Data.state().notes[0].value.content,note().content);
    assert.equal(row(w).PublicKey,before.PublicKey);
    assert.equal(JSON.parse(row(w).EncryptedPrivateKey).mustChangePassword,undefined);
    assert.ok(JSON.parse(row(w).EncryptedPrivateKey).recovery);
    const stored=JSON.stringify([...c.storage.map.values()]);
    for(const secret of [password,newPassword,temporary,adminPassword,oldKey,pair.privateKey]) assert.ok(!stored.includes(secret));
    assert.equal(w.Storage.get('fsn_admin_reset_audit',[])[0].userId,'alice');
  } finally { c.close(); }
});
test('existing user enrollment waits for a normal login and never changes their private key', async () => {
  const c=await setup(false),w=c.w;
  try {
    const key=w.Session.key(), before=row(w);
    w.APP_CONFIG.RECOVERY_PUBLIC_KEY=pair.publicKey;
    await assert.rejects(reset(w),/未登録/); assert.equal(row(w).EncryptedPrivateKey,before.EncryptedPrivateKey);
    await call(w.Auth,'login',{id:'alice',password});
    assert.ok(JSON.parse(row(w).EncryptedPrivateKey).recovery); assert.equal(w.Session.key(),key);
    const result=await reset(w); assert.ok(result.temporaryPassword);
  } finally { c.close(); }
});
test('new registration includes administrator recovery when configured', async () => {
  const c=await setup(),w=c.w;
  try {
    await call(w.Auth,'login',{id:'new-user',password,confirm:password,register:true,name:'新規利用者',organization:'NEW01'});
    const registered=w.Storage.get('fsn_table_StickyUsers',[]).find(r=>r.StickyUserId==='new-user');
    assert.ok(JSON.parse(registered.EncryptedPrivateKey).recovery);
    const result=await call(w.Recovery,'reset','new-user',packageText,adminPassword);
    assert.equal(result.userId,'new-user');
  } finally { c.close(); }
});
test('SharePoint administrator reset refuses an HTTP page', async () => {
  const c=await setup(),w=c.w;
  try {
    c.dom.reconfigure({url:'http://example.test/admin.html'}); w.APP_CONFIG.USE_SHAREPOINT=true;
    w.SharePoint.getCurrentUser=()=>{throw new Error('must not send credentials from HTTP');};
    await assert.rejects(reset(w),/HTTPS/);
  } finally { c.close(); }
});
test('wrong administrator key/password and malformed packages never mutate the user', async () => {
  const c=await setup(),w=c.w;
  try {
    const before=JSON.stringify(row(w));
    await assert.rejects(call(w.Recovery,'reset','alice',packageText,'wrong-password'));
    await assert.rejects(call(w.Recovery,'reset','alice','{}',adminPassword));
    const wrong=JSON.parse(packageText); wrong.material.publicKey=row(w).PublicKey;
    await assert.rejects(call(w.Recovery,'reset','alice',JSON.stringify(wrong),adminPassword),/復旧鍵ファイル/);
    assert.equal(JSON.stringify(row(w)),before);
    assert.equal(w.Storage.get('fsn_admin_reset_audit',[]).length,0);
  } finally { c.close(); }
});
test('SharePoint non-admin and authentication failure are denied before reading target data', async () => {
  const c=await setup(),w=c.w;
  try {
    w.APP_CONFIG.USE_SHAREPOINT=true;
    w.Records.list=()=>{throw new Error('target lookup must not execute');};
    w.SharePoint.getCurrentUser=cb=>cb(null,{LoginName:'member',Id:7,IsSiteAdmin:false});
    await assert.rejects(reset(w),/サイトコレクション管理者/);
    w.SharePoint.getCurrentUser=cb=>cb(new Error('401'));
    await assert.rejects(reset(w),/401/);
  } finally { c.close(); }
});
test('authority is checked again after crypto and immediately before reset write', async () => {
  const c=await setup(),w=c.w;
  try {
    const before=JSON.stringify(row(w)); let checks=0,writes=0;
    w.APP_CONFIG.USE_SHAREPOINT=true;
    w.SharePoint.getCurrentUser=cb=>{checks++;cb(null,{Id:1,LoginName:'admin',IsSiteAdmin:checks===1});};
    w.Records.list=(title,filter,predicate,cb)=>cb(null,[row(w)]);
    w.Records.save=()=>{writes++;throw new Error('must not write');};
    await assert.rejects(reset(w),/サイトコレクション管理者/);
    assert.equal(checks,2); assert.equal(writes,0); assert.equal(JSON.stringify(row(w)),before);
  } finally { c.close(); }
});
test('reset failure leaves old password and encryption material usable', async () => {
  const c=await setup(),w=c.w;
  try {
    const before=JSON.stringify(row(w)), save=w.Records.save;
    w.Records.save=(title,old,fields,cb)=>cb(new Error('412 conflict'));
    await assert.rejects(reset(w),/412/);
    assert.equal(JSON.stringify(row(w)),before);
    w.Records.save=save; await call(w.Auth,'login',{id:'alice',password}); assert.ok(w.Session.user());
  } finally { c.close(); }
});
test('expired temporary password cannot unlock a normal session', async () => {
  const c=await setup(),w=c.w;
  try {
    const result=await reset(w), rows=w.Storage.get('fsn_table_StickyUsers',[]), material=JSON.parse(rows[0].EncryptedPrivateKey);
    material.temporaryExpiresAt='2000-01-01T00:00:00.000Z'; rows[0].EncryptedPrivateKey=JSON.stringify(material); w.Storage.set('fsn_table_StickyUsers',rows);
    w.Session.clear();
    await assert.rejects(call(w.Auth,'login',{id:'alice',password:result.temporaryPassword}),/期限/);
    assert.equal(w.Session.user(),null);
  } finally { c.close(); }
});
test('a newer administrator reset invalidates an in-progress password change', async () => {
  const c=await setup(),w=c.w;
  try {
    const first=await reset(w);
    await call(w.Auth,'login',{id:'alice',password:first.temporaryPassword});
    const second=await reset(w);
    await assert.rejects(call(w.Auth,'completeReset',newPassword,newPassword),/変わりました/);
    const response=await call(w.Auth,'login',{id:'alice',password:second.temporaryPassword});
    assert.equal(response.requirePasswordChange,true);
    w.Auth.cancelReset(); await assert.rejects(call(w.Auth,'completeReset',newPassword,newPassword),/期限/);
  } finally { c.close(); }
});
test('password change validates confirmation and keeps pending recovery on write failure', async () => {
  const c=await setup(),w=c.w;
  try {
    const result=await reset(w); await call(w.Auth,'login',{id:'alice',password:result.temporaryPassword});
    await assert.rejects(call(w.Auth,'completeReset','short','short'),/10文字/);
    await assert.rejects(call(w.Auth,'completeReset',newPassword,'mismatch'),/一致/);
    const before=JSON.stringify(row(w)), save=w.Records.save;
    w.Records.save=(title,old,fields,cb)=>cb(new Error('412 conflict'));
    await assert.rejects(call(w.Auth,'completeReset',newPassword,newPassword),/412/);
    assert.equal(JSON.stringify(row(w)),before);
    w.Records.save=save; await call(w.Auth,'completeReset',newPassword,newPassword);
    await call(w.Auth,'login',{id:'alice',password:newPassword}); assert.ok(w.Session.user());
  } finally { c.close(); }
});
test('login form routes temporary credentials only to the forced-change form', async () => {
  const c=await setup(),w=c.w;
  try {
    const result=await reset(w); w.Session.clear();
    w.document.getElementById('login-id').value='alice'; w.document.getElementById('login-password').value=result.temporaryPassword;
    w.document.getElementById('login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(w.document.getElementById('password-change-form').style.display,'block');
    assert.equal(w.document.getElementById('application').style.display,'none'); assert.equal(w.Session.user(),null);
    w.document.getElementById('password-change-cancel').click();
    assert.equal(w.document.getElementById('password-change-form').style.display,'none');
    await assert.rejects(call(w.Auth,'completeReset',newPassword,newPassword),/期限/);
  } finally { c.close(); }
});
test('administrator HTML has local script references and no duplicated element IDs', () => {
  const dom=new JSDOM(fs.readFileSync(path.join(root,'admin.html'),'utf8'));
  try {
    assert.equal(dom.window.document.querySelector('a').getAttribute('href'),'index.html#admin');
    const ids=[...dom.window.document.querySelectorAll('[id]')].map(n=>n.id); assert.equal(new Set(ids).size,ids.length);
    for(const node of dom.window.document.querySelectorAll('script[src]')) { const source=node.getAttribute('src'); assert.ok(!/^https?:/.test(source)); assert.ok(fs.existsSync(path.join(root,source))); }
  } finally { dom.window.close(); }
});
test('admin route uses the same storage without automatically logging in as the remembered user', async () => {
  const c=await setup();
  await call(c.w.Records,'save',c.w.APP_CONFIG.LIST_USERS,null,{Title:'fsn-admin-recovery-v1',StickyUserId:'__fsn:admin-recovery:v1',Enabled:false,PublicKey:pair.publicKey,EncryptedPrivateKey:packageText});
  const admin=app({storage:c.storage,init:true,url:'https://example.test/sticky/index.html#admin'}), w=admin.w;
  try {
    w.APP_CONFIG.RECOVERY_PUBLIC_KEY=pair.publicKey;
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    assert.equal(w.document.getElementById('admin-root').style.display,'block');
    assert.equal(w.document.getElementById('login-screen').style.display,'none');
    assert.equal(w.document.getElementById('admin-reset-panel').style.display,'block');
    assert.equal(w.Session.user(),null);
    assert.equal(w.Storage.get('fsn_table_StickyUsers',[])[0].StickyUserId,'alice');
  } finally { c.close(); admin.close(); }
});
test('shipped worker and browser forge bundle can reset and rewrap the same key', async () => {
  const c=await setup(),w=c.w;
  try {
    let answer;
    const context={crypto:crypto.webcrypto,Uint8Array,setTimeout,clearTimeout,addEventListener:()=>{},navigator:{userAgent:'test-worker'},postMessage:(value,transfer)=>{assert.notEqual(typeof transfer,'string');answer=value;}};
    context.self=context;
    vm.createContext(context);
    context.importScripts=(...sources)=>{for(const source of sources){try{vm.runInContext(fs.readFileSync(path.resolve(root,'js',source),'utf8'),context,{filename:source});}catch(e){throw new Error(source+': '+e.message);}}};
    vm.runInContext(fs.readFileSync(path.join(root,'js/crypto-worker.js'),'utf8'),context,{filename:'crypto-worker.js'});
    context.onmessage({data:{operation:'adminReset',password:adminPassword,adminMaterial:JSON.parse(packageText).material,target:row(w),recoveryPublicKey:pair.publicKey}});
    assert.equal(answer.error,undefined);
    assert.equal(w.StickyCrypto.unlockUserPrivateKey(answer.value.temporaryPassword,answer.value.material),w.Session.key());
    context.onmessage({data:{operation:'rewrap',password:newPassword,privateKey:w.Session.key(),publicKey:row(w).PublicKey,recovery:JSON.parse(row(w).EncryptedPrivateKey).recovery}});
    assert.equal(answer.error,undefined);
    assert.equal(w.StickyCrypto.unlockUserPrivateKey(newPassword,answer.value.material),w.Session.key());
  } finally { c.close(); }
});

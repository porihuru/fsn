const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, addUser, login, note } = require('./helpers.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=';
const content='<table><tr><td>写真付き</td></tr></table><img src="'+png+'" alt="写真">';
const field=w=>w.document.getElementById('note-content');
async function setup(){const c=app({init:true});await addUser(c.w,'alice');await addUser(c.w,'bob');await addUser(c.w,'carol');await login(c.w);return c;}

test('safe embedded photos render, save encrypted, reopen and respect the three-photo limit',async()=>{
  const c=await setup(),w=c.w;
  try{
    w.Fsn.open(null,'personal',{...note(),content});w.Fsn.save();assert.ok(w.document.querySelector('.note-body img'));
    assert.equal(JSON.stringify([...c.storage.map.values()]).includes(png),false);
    const row=w.Data.state().notes[0];w.Fsn.open(row);assert.equal(field(w).querySelector('img').src,png);
    field(w).querySelector('img').click();w.NoteEditor.insert('remove-photo');assert.equal(field(w).querySelector('img'),null);
    w.Fsn.close();assert.ok(w.Data.state().notes[0].value.content.includes(png)); // cancel kept original
    await assert.rejects(call(w.Data,'saveNote',null,{...note(),content:content.repeat(4)},'','PERSONAL'),/3枚/);
    w.Fsn.open(null,'personal',{title:'',content:'<img src="'+png+'">'});w.Fsn.save();assert.equal(w.Data.state().notes.length,2);
    assert.equal(w.sanitizeHtml('<img src="https://example.test/private"><img src="data:image/svg+xml;base64,abcd"><img src="'+png+'" onerror="x()" style="x" srcset="x">'),'<img src="'+png+'">');
  }finally{c.close();}
});

test('photo processing shrinks locally to JPEG and rejects unsupported, oversized or undecodable files',async()=>{
  const c=app(),w=c.w;
  try{
    const jpeg='data:image/jpeg;base64,/9j/AAAA',canvases=[];
    w.FileReader=function(){this.readAsDataURL=()=>{this.result=png;this.onload();};};
    w.Image=function(){this.naturalWidth=2048;this.naturalHeight=1024;Object.defineProperty(this,'src',{set:()=>this.onload()});};
    const create=w.document.createElement.bind(w.document);
    w.document.createElement=name=>{
      if(name!=='canvas')return create(name);
      const canvas={getContext:()=>({fillRect:()=>{},drawImage:()=>{}}),toDataURL:(type,quality)=>{assert.equal(type,'image/jpeg');assert.ok(quality<=.82);return jpeg;}};
      canvases.push(canvas);return canvas;
    };
    assert.equal(await call(w.NotePhoto,'read',{type:'image/png',size:100}),jpeg);
    assert.equal(canvases[0].width,1024);assert.equal(canvases[0].height,512);
    await assert.rejects(call(w.NotePhoto,'read',{type:'image/svg+xml',size:10}),/JPEG/);
    await assert.rejects(call(w.NotePhoto,'read',{type:'image/jpeg',size:11*1024*1024}),/10MB/);
    w.Image=function(){Object.defineProperty(this,'src',{set:()=>this.onerror()});};
    await assert.rejects(call(w.NotePhoto,'read',{type:'image/png',size:100}),/表示できません/);
  }finally{c.close();}
});

test('pending photo import cannot be saved early or leak into a different editor after cancellation',async()=>{
  const c=await setup(),w=c.w;
  try{
    let finish;w.NotePhoto.read=(file,cb)=>{finish=cb;};w.Fsn.open(null,'personal',note());
    w.NoteEditor.addPhoto({type:'image/png'});assert.equal(w.NoteEditor.busy(),true);assert.equal(w.Fsn.save(),false);
    w.Fsn.close();w.Fsn.open(null,'personal');finish(null,png);
    assert.equal(field(w).querySelector('img'),null);assert.equal(w.NoteEditor.busy(),false);
    w.NoteEditor.addPhoto({type:'image/png'});finish(null,png);assert.ok(field(w).querySelector('img'));
    const e=new w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(e,'clipboardData',{value:{files:[{type:'image/png'}]}});
    field(w).dispatchEvent(e);finish(null,png);assert.equal(field(w).querySelectorAll('img').length,2);
  }finally{c.close();}
});

test('Office clipboard with both table HTML and bitmap keeps editable cells instead of a photo',async()=>{
  const c=await setup(),w=c.w;
  try{
    w.Fsn.open(null,'personal');w.NotePhoto.read=()=>assert.fail('HTML table must take priority');
    const e=new w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(e,'clipboardData',{value:{files:[{type:'image/png'}],getData:type=>type==='text/html'?'<table><tr><td>編集可能</td></tr></table>':'編集可能'}});
    field(w).dispatchEvent(e);assert.ok(field(w).querySelector('td'));assert.equal(field(w).querySelector('img'),null);
  }finally{c.close();}
});

test('existing note send button opens a draft, keeps original and history private, and sends photos only to selected recipients',async()=>{
  const c=await setup(),w=c.w;
  try{
    await call(w.Data,'saveNote',null,{...note(),content:'PRIVATE HISTORY'},'','PERSONAL');let row=w.Data.state().notes[0];
    await call(w.Data,'saveNote',row,{...row.value,content},'','PERSONAL');row=w.Data.state().notes[0];w.Fsn.render();
    const original=JSON.stringify(row.value);w.document.querySelector('[data-action="forward"]').click();
    assert.equal(w.document.getElementById('editor-save').textContent,'送信する');assert.ok(field(w).querySelector('img'));
    w.document.getElementById('note-recipient').value='@bob';w.Fsn.save();
    assert.equal(JSON.stringify(w.Data.state().notes.find(r=>r.Id===row.Id).value),original);
    const sent=w.Data.state().notes.find(r=>r.NoteType==='DIRECT');assert.ok(sent);assert.equal(sent.value.versions,undefined);
    assert.equal(JSON.stringify(sent.value).includes('PRIVATE HISTORY'),false);assert.equal(sent.value.OriginalNoteId,String(row.Id));
    assert.equal(sent.recipients.length,2);assert.equal(sent.value.ForwardedBy,'alice');
    await login(w,'carol');assert.equal(w.Data.state().notes.length,0);
    await login(w,'bob');assert.equal(w.Data.state().notes.length,1);w.Fsn.open(w.Data.state().notes[0]);
    assert.equal(field(w).getAttribute('contenteditable'),'false');assert.ok(field(w).querySelector('img'));
    assert.equal(w.document.getElementById('editor-photo-toolbar').style.display,'none');
    w.document.getElementById('editor-forward').click();w.document.getElementById('note-recipient').value='@carol';w.Fsn.save();
    await login(w,'carol');assert.equal(w.Data.state().notes[0].value.OriginalSender,'alice');assert.equal(w.Data.state().notes[0].value.ForwardedBy,'bob');
  }finally{c.close();}
});

test('posting an existing note requires confirmation and retains photo/table formatting for every current user',async()=>{
  const c=await setup(),w=c.w;
  try{
    await call(w.Data,'saveNote',null,{...note(),content:'PRIVATE HISTORY'},'','PERSONAL');let row=w.Data.state().notes[0];
    await call(w.Data,'saveNote',row,{...row.value,content},'','PERSONAL');row=w.Data.state().notes[0];const before=JSON.stringify(row.value);w.Fsn.render();
    w.document.querySelector('[data-action="post"]').click();assert.equal(w.Data.state().posts.length,0);
    w.confirm=()=>false;assert.equal(w.Fsn.save(),false);assert.equal(w.Data.state().posts.length,0);
    w.confirm=message=>{assert.match(message,/登録利用者全員/);return true;};w.Fsn.save();
    assert.equal(w.Data.state().posts.length,1);assert.equal(w.Data.state().posts[0].value.bodyFormat,'html');
    assert.equal(JSON.stringify(w.Data.state().posts[0].value).includes('PRIVATE HISTORY'),false);
    assert.equal(JSON.stringify(w.Data.state().notes[0].value),before);
    assert.ok(w.document.querySelector('.post-body img'));assert.ok(w.document.querySelector('.post-body table'));
    assert.equal(w.Data.state().views.length,0);assert.equal(JSON.stringify([...c.storage.map.values()]).includes(png),false);
    await login(w,'bob');assert.equal(w.Data.state().posts.length,1);w.Fsn.tab('sns');
    w.document.querySelector('.post-card [data-action="copy"]').click();assert.ok(field(w).querySelector('img'));assert.ok(field(w).querySelector('table'));w.Fsn.close();
    w.document.querySelector('.post-card [data-action="open"]').click();assert.ok(field(w).querySelector('img'));assert.equal(w.Data.state().views.length,1);
  }finally{c.close();}
});

test('sharing errors/cancel do not modify the source or publish a partial draft',async()=>{
  const c=await setup(),w=c.w;
  try{
    await call(w.Data,'saveNote',null,{...note(),content},'','PERSONAL');const row=w.Data.state().notes[0],before=JSON.stringify(row.value);
    w.Fsn.open(row);w.document.getElementById('editor-forward').click();w.document.getElementById('note-recipient').value='@missing';w.Fsn.save();
    assert.equal(w.Data.state().notes.length,1);w.Fsn.close();w.Fsn.open(row);w.document.getElementById('editor-post').click();
    const save=w.Records.save;w.Records.save=(title,old,fields,cb)=>title==='StickyPosts'?cb(new Error('post failed')):save(title,old,fields,cb);
    w.Fsn.save();assert.equal(w.Data.state().posts.length,0);assert.equal(w.document.getElementById('editor-modal').className.includes('visible'),true);
    assert.equal(JSON.stringify(w.Data.state().notes[0].value),before);
  }finally{c.close();}
});

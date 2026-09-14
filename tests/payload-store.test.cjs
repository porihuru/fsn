const test=require('node:test');
const assert=require('node:assert/strict');
const {app,call,addUser,login,note}=require('./helpers.cjs');
const photo='data:image/jpeg;base64,/9j/'+'A'.repeat(60000);
function server(w){
  const tables={},attachments={},log=[];let uploadError=false,readError=false,conflict=false,timeout=false;
  for(const name of ['StickyUsers','StickySessions','StickyNotes','StickyRecipients','StickyPosts','StickyComments','StickyReactions','StickyPostViews','StickyNotifications']){
    tables[name]=w.Storage.get('fsn_table_'+name,[]);for(const row of tables[name])row.__metadata={etag:'"'+(row._rev||1)+'"'};
  }
  const clone=x=>JSON.parse(JSON.stringify(x));
  w.APP_CONFIG.USE_SHAREPOINT=true;
  w.SharePoint.listItems=(title,query,cb)=>{
    let rows=tables[title]||[],matches=[...decodeURIComponent(query).matchAll(/(\w+) eq ('[^']*'|\d+)/g)];
    for(const [,field,value]of matches){rows=rows.filter(r=>value[0]==="'"?String(r[field])===value.slice(1,-1):typeof r[field]==='boolean'?Number(r[field])===Number(value):Number(r[field])===Number(value));}
    cb({ok:true,data:clone(rows)});
  };
  w.SharePoint.createListItem=(title,fields,cb)=>{
    assert.ok(!fields.EncryptedPayload||fields.EncryptedPayload.length<=50000,'large content must not go into a text column');
    const rows=tables[title]||(tables[title]=[]),row={Id:Math.max(0,...rows.map(r=>r.Id))+1,...clone(fields),__metadata:{etag:'"1"'}};rows.push(row);log.push(['create',title,clone(fields)]);cb({ok:true,data:{d:clone(row)}});
  };
  w.SharePoint.updateItem=(title,row,fields,cb)=>{
    const current=tables[title].find(r=>r.Id===row.Id);
    assert.ok(!fields.EncryptedPayload||fields.EncryptedPayload.length<=50000);
    if(conflict||current.__metadata.etag!==row.__metadata.etag){cb({ok:false,error:'412 conflict'});return;}
    Object.assign(current,clone(fields));current.__metadata.etag='"'+(Number(current.__metadata.etag.replace(/"/g,''))+1)+'"';
    log.push(['update',title,clone(fields)]);cb(timeout?{ok:false,error:'timeout after commit'}:{ok:true});
  };
  w.SharePoint.addAttachment=(id,name,text,cb)=>{
    if(uploadError){cb({ok:false,error:'attachments disabled'});return;}
    assert.equal(text.includes('data:image/'),false);attachments[id+'/'+name]=text;log.push(['attachment',id,name]);cb({ok:true});
  };
  w.SharePoint.getAttachment=(id,name,cb)=>{const raw=attachments[id+'/'+name];cb(readError||!raw?{ok:false,error:'attachment unavailable'}:{ok:true,data:JSON.parse(raw)});};
  w.SharePoint.deleteItem=(title,row,cb)=>{tables[title]=tables[title].filter(r=>r.Id!==row.Id);cb({ok:true});};
  return{tables,attachments,log,setUploadError:x=>{uploadError=x;},setReadError:x=>{readError=x;},setConflict:x=>{conflict=x;},setTimeout:x=>{timeout=x;}};
}
async function setup(){const c=app();await addUser(c.w,'alice');await addUser(c.w,'bob');await login(c.w);return c;}
const value=()=>({...note(),content:'添付写真<img src="'+photo+'" alt="写真">'});

test('large note and SNS payloads are encrypted attachments, referenced only after upload, and fully reload',async()=>{
  const c=await setup(),w=c.w,s=server(w);
  try{
    await call(w.Data,'saveNote',null,value(),'','PERSONAL');
    assert.equal(w.Data.state().notes.length,1);assert.equal(w.Data.state().notes[0].value.content.includes(photo),true);
    const raw=s.tables.StickyNotes.find(r=>r.NoteType==='PERSONAL'),pointer=JSON.parse(raw.EncryptedPayload);
    assert.equal(pointer.storage,'FSN-PAYLOAD-ATTACHMENT-V1');assert.equal(s.tables.StickyNotes.find(r=>r.Id===pointer.itemId).NoteType,'BLOB');
    assert.equal(s.tables.StickyNotes.find(r=>r.Id===pointer.itemId).Deleted,true);
    assert.ok(s.log.findIndex(r=>r[0]==='attachment')<s.log.findIndex(r=>r[0]==='create'&&r[2].NoteType==='PERSONAL'));
    assert.equal(JSON.stringify(s.tables).includes(photo),false);assert.equal(JSON.stringify(s.attachments).includes(photo),false);
    await call(w.Data,'refresh');assert.equal(w.Data.state().notes.length,1);
    await call(w.Data,'savePost',null,{title:'写真共有',body:value().content,bodyFormat:'html',category:'共有'});
    assert.equal(w.Data.state().posts.length,1);assert.equal(w.Data.state().posts[0].value.body.includes(photo),true);
    assert.equal(JSON.parse(s.tables.StickyPosts[0].EncryptedPayload).storage,'FSN-PAYLOAD-ATTACHMENT-V1');
  }finally{c.close();}
});

test('attachment upload failure publishes no new note or post and leaves existing data untouched',async()=>{
  const c=await setup(),w=c.w,s=server(w);
  try{
    s.setUploadError(true);
    await assert.rejects(call(w.Data,'saveNote',null,value(),'','PERSONAL'),/添付ファイル設定/);
    assert.equal(s.tables.StickyNotes.filter(r=>r.NoteType!=='BLOB').length,0);assert.equal(s.tables.StickyRecipients.length,0);
    await assert.rejects(call(w.Data,'savePost',null,{body:value().content,bodyFormat:'html'}),/添付ファイル設定/);
    assert.equal(s.tables.StickyPosts.length,0);
  }finally{c.close();}
});

test('attachment failure or corruption preserves the last good application state',async()=>{
  const c=await setup(),w=c.w,s=server(w);
  try{
    await call(w.Data,'saveNote',null,value(),'','PERSONAL');const previous=w.Data.state();s.setReadError(true);
    await assert.rejects(call(w.Data,'refresh'),/読み込めません/);assert.equal(w.Data.state(),previous);
    s.setReadError(false);const name=Object.keys(s.attachments)[0];const payload=JSON.parse(s.attachments[name]);payload.cipherText='corrupt';s.attachments[name]=JSON.stringify(payload);
    await assert.rejects(call(w.Data,'refresh'),/一致しません/);assert.equal(w.Data.state(),previous);
  }finally{c.close();}
});

test('conflict preserves old reference; ambiguous commit never deletes an attachment that may be in use',async()=>{
  const c=await setup(),w=c.w,s=server(w);
  try{
    await call(w.Data,'saveNote',null,value(),'','PERSONAL');let row=w.Data.state().notes[0];const original=s.tables.StickyNotes.find(r=>r.Id===row.Id).EncryptedPayload;
    s.setConflict(true);await assert.rejects(call(w.Data,'saveNote',row,{...row.value,title:'conflict'},'','PERSONAL'),/412/);
    assert.equal(s.tables.StickyNotes.find(r=>r.Id===row.Id).EncryptedPayload,original);
    s.setConflict(false);s.setTimeout(true);await assert.rejects(call(w.Data,'saveNote',row,{...row.value,title:'committed'},'','PERSONAL'),/timeout/);
    const pointer=JSON.parse(s.tables.StickyNotes.find(r=>r.Id===row.Id).EncryptedPayload);assert.ok(s.attachments[pointer.itemId+'/'+pointer.name]);
    s.setTimeout(false);await call(w.Data,'refresh');assert.equal(w.Data.state().notes[0].value.title,'committed');
  }finally{c.close();}
});

test('malformed references and excessive payloads are refused before network writes',async()=>{
  const c=app(),w=c.w;
  try{
    w.SharePoint.getAttachment=()=>assert.fail('no arbitrary attachment requests');
    await assert.rejects(call(w.PayloadStore,'resolveRows',[{EncryptedPayload:JSON.stringify({storage:'FSN-PAYLOAD-ATTACHMENT-V1',itemId:1,name:'../private',hash:'0'.repeat(64)})}]),/不正/);
    await assert.rejects(call(w.Records,'save','StickyNotes',null,{EncryptedPayload:'a'.repeat(8*1024*1024+1)}),/8MB/);
  }finally{c.close();}
});

test('SharePoint attachment transport sends binary UTF-8 with digest and reads the documented value route',async()=>{
  const c=app(),w=c.w,requests=[];
  try{
    w.APP_CONFIG.SHAREPOINT_BASE_URL='https://example.test/site';
    w.XMLHttpRequest=function(){this.headers={};this.open=(method,url)=>{this.method=method;this.url=url;};this.setRequestHeader=(k,v)=>{this.headers[k]=v;};this.getResponseHeader=()=>null;this.send=body=>{requests.push({url:this.url,headers:this.headers,body});this.status=200;this.responseText=JSON.stringify(this.url.endsWith('contextinfo')?{d:{GetContextWebInformation:{FormDigestValue:'digest',FormDigestTimeoutSeconds:1800}}}:this.url.endsWith('$value')?{cipherText:'encrypted'}:{d:{FileName:'saved'}});this.onload();};};
    const name='payload-'+'a'.repeat(32)+'.json',text=JSON.stringify({cipherText:'encrypted'});
    const answer=await new Promise(resolve=>w.SharePoint.addAttachment(42,name,text,resolve));assert.equal(answer.ok,true);
    const upload=requests[1];assert.match(upload.url,/items\(42\)\/AttachmentFiles\/add\(FileName=/);assert.equal(upload.headers['X-RequestDigest'],'digest');assert.equal(upload.headers['Content-Type'],'application/octet-stream');
    assert.equal(Buffer.from(new Uint8Array(upload.body)).toString('utf8'),text);
    const downloaded=await new Promise(resolve=>w.SharePoint.getAttachment(42,name,resolve));assert.equal(downloaded.data.cipherText,'encrypted');assert.ok(requests[2].url.endsWith("')/$value"));
  }finally{c.close();}
});

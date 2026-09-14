const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, addUser, login, note } = require('./helpers.cjs');
const body = w => w.document.getElementById('note-content');
function cursor(w,node,start=0,end=start) { const r=w.document.createRange();r.setStart(node,start);r.setEnd(node,end);const s=w.getSelection();s.removeAllRanges();s.addRange(r);body(w).dispatchEvent(new w.Event('mouseup')); }
function toolbar(w,type) { w.document.querySelector('[data-insert="'+type+'"]').click(); }
function paste(w,html,text='',legacy=false) {
  const e=new w.Event('paste',{bubbles:true,cancelable:true});
  const clipboard={getData:type=>type==='text/html'?html:text};
  if(legacy) w.clipboardData=clipboard; else Object.defineProperty(e,'clipboardData',{value:clipboard});
  body(w).dispatchEvent(e); assert.equal(e.defaultPrevented,true);
}
async function fixture() { const c=app({init:true});await addUser(c.w,'alice');await login(c.w);c.w.Fsn.open(null,'personal');return c; }

test('table button inserts real editable cells and encrypted save/reopen retains their content',async()=>{
  const c=await fixture(),w=c.w;
  try {
    assert.equal(body(w).tagName,'DIV');assert.equal(body(w).getAttribute('contenteditable'),'true');
    toolbar(w,'table');let table=body(w).querySelector('table');
    assert.equal(table.rows.length,3);assert.equal(table.rows[0].cells.length,2);
    assert.equal(body(w).textContent.includes('<table>'),false);
    table.rows[0].cells[0].textContent='担当';table.rows[1].cells[0].textContent='山田';table.rows[1].cells[1].textContent='確認中';
    w.document.getElementById('note-title').value='表の付箋';w.Fsn.save();
    assert.equal(w.Data.state().notes.length,1);
    assert.ok(!JSON.stringify([...c.storage.map.values()]).includes('確認中'));
    assert.equal(w.document.querySelectorAll('.note-body table').length,1);
    assert.match(w.document.querySelector('.note-body').textContent,/山田.*確認中/);
    const row=w.Data.state().notes[0];w.Fsn.open(row);
    table=body(w).querySelector('table');assert.equal(table.rows[1].cells[1].textContent,'確認中');
    assert.equal(body(w).lastChild.tagName,'P'); // type below an existing table
    table.rows[1].cells[1].textContent='完了';w.Fsn.save();
    assert.equal(w.Data.state().notes[0].value.versions.length,1);
    assert.match(w.document.querySelector('.note-body table').textContent,/完了/);
  } finally {c.close();}
});

test('row/column insertion and Tab navigation use the selected cell without moving other text',async()=>{
  const c=await fixture(),w=c.w;
  try {
    toolbar(w,'table');const table=body(w).querySelector('table');table.rows[1].cells[0].textContent='keep';
    cursor(w,table.rows[1].cells[0],0);toolbar(w,'row');assert.equal(table.rows.length,4);
    assert.equal(table.rows[1].cells[0].textContent,'keep');
    cursor(w,table.rows[1].cells[0],0);toolbar(w,'column');assert.equal(table.rows[1].cells.length,3);
    assert.equal(table.rows[0].cells[1].tagName,'TH');
    cursor(w,table.rows[1].cells[0],0);
    const forward=new w.KeyboardEvent('keydown',{keyCode:9,bubbles:true,cancelable:true});body(w).dispatchEvent(forward);
    assert.equal(forward.defaultPrevented,true);assert.equal(w.getSelection().anchorNode,table.rows[1].cells[1]);
    body(w).dispatchEvent(new w.KeyboardEvent('keydown',{keyCode:9,shiftKey:true,bubbles:true,cancelable:true}));
    assert.equal(w.getSelection().anchorNode,table.rows[1].cells[0]);
    cursor(w,table.rows[3].cells[2],0);body(w).dispatchEvent(new w.KeyboardEvent('keydown',{keyCode:9,bubbles:true,cancelable:true}));
    assert.equal(table.rows.length,5);assert.equal(w.getSelection().anchorNode,table.rows[4].cells[0]);
    w.confirm=()=>false;toolbar(w,'remove-table');assert.ok(body(w).querySelector('table'));
    w.confirm=()=>true;toolbar(w,'remove-table');assert.equal(body(w).querySelector('table'),null);
  }finally{c.close();}
});

test('table insertion remembers the body caret when the toolbar takes focus',async()=>{
  const c=await fixture(),w=c.w;
  try {
    w.NoteEditor.set('前後',false);cursor(w,body(w).firstChild,1);
    w.document.querySelector('[data-insert="table"]').focus();w.getSelection().removeAllRanges();toolbar(w,'table');
    const content=w.NoteEditor.get();assert.match(content,/^前\n<table>/);assert.match(content,/<\/table>\n後$/);
    const table=body(w).querySelector('table');cursor(w,table.rows[0].cells[0],0);toolbar(w,'table');
    assert.equal(body(w).querySelectorAll('table').length,1);
  }finally{c.close();}
});

test('multiline legacy HTML tables remain intact and canonical markup is stable',()=>{
  const c=app(),w=c.w;
  try {
    const source='前\n<table>\n<tr><td>項目</td><td>内容<br>次の行</td></tr>\n<tr><td>A</td><td>B</td></tr>\n</table>\n後\n[ ] 確認';
    const clean=w.NoteMarkup.normalize(source),html=w.StickyApp.content(source,1),box=w.document.createElement('div');box.innerHTML=html;
    assert.equal(box.querySelector('table').rows.length,2);assert.equal(box.querySelectorAll('table').length,1);
    assert.equal(box.querySelectorAll('.note-check input').length,1);
    assert.equal(w.NoteMarkup.normalize(clean),clean);assert.equal(w.NoteMarkup.normalize(w.NoteMarkup.html(clean)),clean);
    assert.match(w.NoteMarkup.plain(clean),/内容\n次の行/);
    w.NoteEditor.set(source,false);assert.equal(w.NoteEditor.get(),clean);
  }finally{c.close();}
});

test('checklist remains clickable after rich editing alongside a table and bold remains visual',async()=>{
  const c=await fixture(),w=c.w;
  try {
    w.NoteEditor.set('重要\n[ ] 確認\n<table>\n<tr><td>表</td></tr>\n</table>',false);
    cursor(w,body(w).firstChild,0,2);toolbar(w,'bold');assert.equal(body(w).querySelector('strong').textContent,'重要');
    w.document.getElementById('note-title').value='確認';w.Fsn.save();
    let check=w.document.querySelector('.note-check input');assert.ok(check);check.click();
    assert.match(w.Data.state().notes[0].value.content,/\[x\] 確認/);
    assert.equal(w.document.querySelectorAll('.note-body table').length,1);
    w.Fsn.open(w.Data.state().notes[0]);assert.ok(body(w).querySelector('strong'));assert.match(body(w).textContent,/\[x\] 確認/);
    w.NoteEditor.set('',false);toolbar(w,'check');assert.match(w.NoteEditor.get(),/\[ \] 項目/);
  }finally{c.close();}
});

test('HTML table paste retains cells and safe spans while removing executable content and attributes',async()=>{
  const c=await fixture(),w=c.w;
  try {
    paste(w,'<div><table onclick="x()"><tr><td colspan="2" style="background:url(https://example.test/a)"><p>A</p><p>B</p><img src=x onerror="x()"></td></tr><tr><td>1</td><td>2</td></tr></table><script>x()</script><iframe src="x"></iframe></div>');
    const table=body(w).querySelector('table');assert.equal(table.rows.length,2);assert.equal(table.rows[0].cells[0].colSpan,2);
    assert.equal(table.rows[0].cells[0].innerHTML,'A<br>B');
    assert.equal(body(w).querySelector('[onclick],[style],img,script,iframe'),null);
    cursor(w,table.rows[0].cells[0],0);toolbar(w,'row');assert.equal(table.rows.length,2);
    assert.match(w.document.getElementById('toast').textContent,/結合セル/);
  }finally{c.close();}
});

test('tab-separated clipboard data becomes a table including the IE text-only fallback',async()=>{
  const c=await fixture(),w=c.w;
  try {
    for(const legacy of [false,true]) {
      w.NoteEditor.set('',false);paste(w,'','担当\t状態\r\n山田\t未着手\r\n',legacy);
      const table=body(w).querySelector('table');assert.equal(table.rows.length,2);assert.equal(table.rows[1].cells[1].textContent,'未着手');
    }
    w.NoteEditor.set('',false);paste(w,'','<script>alert(1)</script>\nA & B');
    assert.equal(body(w).querySelector('script'),null);assert.match(body(w).textContent,/<script>alert\(1\)<\/script>/);
    assert.match(w.NoteEditor.get(),/&lt;script&gt;/);
  }finally{c.close();}
});

test('read-only notes render tables but reject edits, paste and toolbar mutations; copy is editable',async()=>{
  const c=await fixture(),w=c.w;
  try {
    const content='<table><tr><td>受信内容</td></tr></table>';
    w.Fsn.open(null,'read',{...note(),content});assert.equal(body(w).getAttribute('contenteditable'),'false');
    const before=w.NoteEditor.get();w.NoteEditor.insert('table');paste(w,'','overwrite');assert.equal(w.NoteEditor.get(),before);assert.equal(w.Fsn.save(),false);
    w.document.getElementById('editor-copy').click();assert.equal(body(w).getAttribute('contenteditable'),'true');assert.ok(body(w).querySelector('table'));
    w.Fsn.lock();assert.equal(body(w).innerHTML,'');
  }finally{c.close();}
});

test('length and empty-body validation still apply to rich text through save and Ctrl+S',async()=>{
  const c=await fixture(),w=c.w;
  try {
    body(w).innerHTML='<p><br></p>';w.Fsn.save();assert.equal(w.Data.state().notes.length,0);
    body(w).textContent='a'.repeat(20001);body(w).dispatchEvent(new w.Event('input'));
    assert.equal(body(w).getAttribute('aria-invalid'),'true');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown',{keyCode:83,ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(w.Data.state().notes.length,0);
    w.NoteEditor.set('',false);toolbar(w,'table');w.Fsn.save();assert.equal(w.Data.state().notes.length,1);
    w.Fsn.open(null,'personal');paste(w,'','b'.repeat(20001));assert.equal(w.NoteEditor.get(),'');
  }finally{c.close();}
});

test('history and search keep table contents without exposing HTML tags as text',async()=>{
  const c=await fixture(),w=c.w;
  try {
    toolbar(w,'table');body(w).querySelector('td').textContent='検索用セル';w.Fsn.save();
    w.Fsn.open(w.Data.state().notes[0]);body(w).querySelector('td').textContent='変更後セル';w.Fsn.save();
    w.Fsn.open(w.Data.state().notes[0]);w.prompt=()=> '1';w.document.getElementById('note-history').click();assert.equal(body(w).querySelector('td').textContent,'検索用セル');w.Fsn.save();
    w.document.getElementById('global-search-input').value='検索用セル';w.Views.search();
    const results=w.document.getElementById('global-search-results').textContent;assert.match(results,/検索用セル/);assert.equal(results.includes('<table>'),false);
  }finally{c.close();}
});

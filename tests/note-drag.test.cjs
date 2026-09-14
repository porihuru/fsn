const test = require('node:test');
const assert = require('node:assert/strict');
const { app, call, addUser, login, note } = require('./helpers.cjs');

function mouse(w, target, type, x, y, button = 0) {
  const event = new w.MouseEvent(type, {bubbles:true, cancelable:true, clientX:x, clientY:y, button});
  target.dispatchEvent(event);
  return event;
}
function move(w, target, button = 0) {
  mouse(w, target, 'mousedown', 100, 100, button);
  mouse(w, w.document, 'mousemove', 140, 155, button);
  mouse(w, w.document, 'mouseup', 140, 155, button);
}
async function setup() {
  const c = app({init:true}); await addUser(c.w, 'alice'); await login(c.w);
  await call(c.w.Data, 'saveNote', null, note(), '', 'PERSONAL'); c.w.Fsn.tab('stickies'); return c;
}

test('full-width action strip moves visible, hidden and minimized notes and persists their position', async () => {
  const c = await setup(), w = c.w;
  try {
    for (const flags of [{}, {contentHidden:true}, {minimized:true}, {contentHidden:true, minimized:true}]) {
      let row = w.Data.state().notes[0];
      await call(w.Data, 'saveNote', row, {...note(), ...flags}, '', 'PERSONAL'); w.Fsn.render();
      move(w, w.document.querySelector('.note-actions'));
      row = w.Data.state().notes[0];
      assert.equal(row.value.x, 60); assert.equal(row.value.y, 85);
      assert.equal(!!row.value.contentHidden, !!flags.contentHidden);
      assert.equal(!!row.value.minimized, !!flags.minimized);
      await call(w.Data, 'refresh'); w.Fsn.render();
      assert.equal(w.document.querySelector('.sticky-note').style.left, '60px');
      assert.equal(w.document.querySelector('.sticky-note').style.top, '85px');
    }
  } finally { c.close(); }
});

test('drag grip, title, card background and concealed placeholder remain drag handles', async () => {
  const c = await setup(), w = c.w;
  try {
    for (const selector of ['.note-drag-handle', '.sticky-note h3', '.sticky-note', '.note-hidden-message']) {
      const row = w.Data.state().notes[0];
      await call(w.Data, 'saveNote', row, {...note(), contentHidden:selector === '.note-hidden-message'}, '', 'PERSONAL'); w.Fsn.render();
      const target = w.document.querySelector(selector); assert.ok(target, selector); move(w, target);
      assert.equal(w.Data.state().notes[0].value.x, 60, selector);
      assert.equal(w.Data.state().notes[0].value.y, 85, selector);
    }
  } finally { c.close(); }
});

test('action buttons and their SVG children, checkboxes and body text never start a drag', async () => {
  const c = await setup(), w = c.w;
  try {
    const row = w.Data.state().notes[0];
    await call(w.Data, 'saveNote', row, {...note(), content:'[ ] check\n<table><tr><td>cell</td></tr></table>'}, '', 'PERSONAL'); w.Fsn.render();
    const before = JSON.stringify(w.Data.state().notes[0].value);
    const targets = w.document.querySelectorAll('.note-actions button, .note-actions svg, .note-actions svg path, .note-check, .note-check input, .note-check span, .note-body, .note-body td');
    for (const target of targets) {
      const event = mouse(w, target, 'mousedown', 100, 100); assert.equal(event.defaultPrevented, false);
      mouse(w, w.document, 'mousemove', 140, 155); mouse(w, w.document, 'mouseup', 140, 155);
      assert.equal(JSON.stringify(w.Data.state().notes[0].value), before, target.tagName);
    }
  } finally { c.close(); }
});

test('pinned notes, right clicks and busy state cannot move; releasing the pin restores dragging', async () => {
  const c = await setup(), w = c.w;
  try {
    move(w, w.document.querySelector('.note-actions'), 2); assert.equal(w.Data.state().notes[0].value.x, 20);
    const busy = w.Data.busy; w.Data.busy = () => true;
    move(w, w.document.querySelector('.note-actions')); assert.equal(w.Data.state().notes[0].value.x, 20); w.Data.busy = busy;
    w.document.querySelector('[data-action="pinned"]').click();
    move(w, w.document.querySelector('.note-actions')); assert.equal(w.Data.state().notes[0].value.x, 20);
    assert.equal(w.document.querySelector('[data-action="pinned"]').title, '固定を解除');
    w.document.querySelector('[data-action="pinned"]').click();
    move(w, w.document.querySelector('.note-actions')); assert.equal(w.Data.state().notes[0].value.x, 60);
    const before = JSON.stringify(w.Data.state().notes[0].value);
    mouse(w, w.document.querySelector('.note-actions'), 'mousedown', 100, 100);
    mouse(w, w.document, 'mouseup', 100, 100); assert.equal(JSON.stringify(w.Data.state().notes[0].value), before);
  } finally { c.close(); }
});

test('resize remains separate from moving, and failed move saves restore the saved position', async () => {
  const c = await setup(), w = c.w;
  try {
    const card = w.document.querySelector('.sticky-note');
    Object.defineProperty(card, 'offsetWidth', {get:() => parseInt(card.style.width, 10)});
    Object.defineProperty(card, 'offsetHeight', {get:() => parseInt(card.style.minHeight, 10)});
    move(w, card.querySelector('.resize-handle'));
    const row = w.Data.state().notes[0];
    assert.equal(row.value.width, 290); assert.equal(row.value.height, 235);
    assert.equal(row.value.x, 20); assert.equal(row.value.y, 30);
    const save = w.Records.save;
    w.Records.save = (title, old, fields, cb) => title === w.APP_CONFIG.LIST_NOTES ? cb(new Error('move save failed')) : save(title, old, fields, cb);
    move(w, w.document.querySelector('.note-actions'));
    assert.equal(w.Data.state().notes[0].value.x, 20);
    assert.equal(w.document.querySelector('.sticky-note').style.left, '20px');
    assert.match(w.document.getElementById('toast').textContent, /move save failed/);
  } finally { c.close(); }
});

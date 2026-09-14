const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('compact workspace reserves space for notes without changing saved positions', () => {
  const root = path.resolve(__dirname, '..');
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const { document, getComputedStyle } = dom.window;
  const style = document.createElement('style');
  style.textContent = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
  document.head.appendChild(style);
  const css = selector => getComputedStyle(document.querySelector(selector));
  assert.equal(css('main').paddingTop, '8px');
  assert.equal(css('main').maxWidth, 'none');
  assert.equal(css('.topbar').minHeight, '56px');
  assert.equal(css('.mode-banner').paddingTop, '4px');
  assert.equal(css('#app-status').display, 'none');
  assert.equal(css('#panel-stickies .page-head').marginBottom, '8px');
  assert.equal(css('#panel-stickies .eyebrow').display, 'none');
  assert.equal(css('.board-wrap').paddingTop, '10px');
  document.getElementById('app-status').textContent = '通信に失敗しました';
  assert.notEqual(css('#app-status').display, 'none');
  dom.window.close();
});

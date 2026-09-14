const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const forge = require('../.vendor/package');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const password = '安全なテストPassword123!';
function memory() {
  const map = new Map();
  return { get length() { return map.size; }, key: i => [...map.keys()][i], getItem: k => map.has(k) ? map.get(k) : null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k), map };
}
function app({ storage = memory(), browserCrypto = false, init = false, url = 'https://example.test/sticky/index.html' } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w, 'localStorage', { value: storage });
  Object.defineProperty(w.navigator, 'userAgent', { value: 'Mozilla/5.0 Edg/95.0.1020.30' });
  w.setInterval = () => 0;
  w.alert = () => {}; w.confirm = () => true; w.prompt = () => null;
  for (const script of scripts) {
    if (script.includes('forge.min') && !browserCrypto) { w.forge = forge; continue; }
    w.eval(fs.readFileSync(path.join(root, script), 'utf8') + '\n//# sourceURL=' + script);
  }
  if (init) { w.Fsn.init(); }
  return { w, dom, storage, close: () => dom.window.close() };
}
const call = (target, method, ...args) => new Promise((resolve, reject) => target[method](...args, (error, result) => error ? reject(error) : resolve(result)));
let credentials;
function fixture(w, id = 'alice', name = id, org = 'DEV01') {
  if (!credentials) {
    const record = w.StickyCrypto.createPasswordRecord(password);
    const salt = crypto.randomBytes(16), key = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('binary');
    const material = { version: w.StickyCrypto.VERSION, iterations: 210000, encoding: 'utf8', publicKey: pair.publicKey, privateKeySalt: salt.toString('base64'), privateKeyPayload: w.StickyCrypto.encryptJson({ privateKey: pair.privateKey }, key) };
    credentials = { PasswordHash: JSON.stringify(record), PasswordSalt: record.salt, PublicKey: pair.publicKey, EncryptedPrivateKey: JSON.stringify(material), CryptoVersion: w.StickyCrypto.VERSION };
  }
  return { Title: 'user', StickyUserId: id, LoginName: id, DisplayName: name, Organization: org, Enabled: true, ...credentials };
}
async function addUser(w, id, name, org) { return call(w.Records, 'save', w.APP_CONFIG.LIST_USERS, null, fixture(w, id, name, org)); }
async function login(w, id = 'alice') { await call(w.Auth, 'login', { id, password, register: false }); w.Data.reset(); await call(w.Data, 'refresh'); }
function note(title = '秘密の付箋') { return { title, content: '本文 secret', color: 'yellow', due: '2028-02-29', x: 20, y: 30, width: 250, height: 180 }; }
module.exports = { app, call, memory, fixture, addUser, login, note, password, pair, root, scripts };

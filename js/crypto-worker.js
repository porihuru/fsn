/* Local-only worker. No credentials or plaintext are sent to a server. */
var window = self;
/* Forge's Window postMessage scheduler cannot be used in a Worker. */
var setImmediate = function (callback) { return self.setTimeout(callback, 0); };
importScripts('../.vendor/package/dist/forge.min.js', 'config.js', 'common.js', 'crypto.js', 'recovery.js', 'crypto-jobs.js');
self.onmessage = function (event) {
    try { self.postMessage({ value: CryptoJobs.compute(event.data) }); }
    catch (e) { self.postMessage({ error: e.message || '暗号処理に失敗しました。' }); }
    event.data.password = '';
};

/* Password/KDF and RSA generation run off the UI thread where workers are allowed. */
var CryptoJobs = (function () {
    function compute(job) {
        if (job.operation === 'unlock') {
            if (!StickyCrypto.verifyPassword(job.password, job.record)) { throw new Error('ユーザーIDまたはパスワードが違います。'); }
            if (job.material.publicKey !== job.publicKey) { throw new Error('公開鍵と秘密鍵の登録が一致しません。'); }
            return { privateKey: StickyCrypto.unlockUserPrivateKey(job.password, job.material) };
        }
        var record = StickyCrypto.createPasswordRecord(job.password), material = StickyCrypto.createUserKeyMaterial(job.password);
        return { record: record, material: material, privateKey: StickyCrypto.unlockUserPrivateKey(job.password, material) };
    }
    function run(job, callback) {
        var worker, completed = false, timer;
        function done(error, value) { if (completed) { return; } completed = true; window.clearTimeout(timer); if (worker) { worker.terminate(); } job.password = ''; callback(error, value); }
        function fallback() {
            if (worker) { worker.terminate(); worker = null; }
            ErrorStore.add('暗号処理', 'Web Workerを利用できないため画面内で計算します。処理中はお待ちください。');
            window.setTimeout(function () { var value; try { value = compute(job); } catch (e) { done(e); return; } done(null, value); }, 0);
        }
        if (!window.Worker) { fallback(); return; }
        try {
            worker = new Worker('js/crypto-worker.js');
            worker.onmessage = function (event) { done(event.data.error ? new Error(event.data.error) : null, event.data.value); };
            worker.onerror = fallback;
            timer = window.setTimeout(function () { done(new Error('暗号鍵の処理がタイムアウトしました。')); }, 300000);
            worker.postMessage(job);
        } catch (e) { fallback(); }
    }
    return { run: run, compute: compute };
}());

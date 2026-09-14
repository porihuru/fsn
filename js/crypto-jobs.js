/* Password/KDF and RSA generation run off the UI thread where workers are allowed. */
var CryptoJobs = (function () {
    function compute(job) {
        if (job.operation === 'rewrap') {
            var rewritten = StickyCrypto.rewrapUserKey(job.password, job.privateKey, job.publicKey);
            if (job.recovery) { rewritten.recovery = job.recovery; }
            return { record: StickyCrypto.createPasswordRecord(job.password), material: rewritten };
        }
        if (job.operation === 'adminReset') {
            APP_CONFIG.RECOVERY_PUBLIC_KEY = job.recoveryPublicKey;
            var adminPrivate = StickyCrypto.unlockUserPrivateKey(job.password, job.adminMaterial);
            if (!StickyCrypto.keyMatches(adminPrivate, job.recoveryPublicKey)) { throw new Error('管理者の公開鍵と秘密鍵が一致しません。'); }
            var originalKey = Recovery.recover(job.target, adminPrivate), temporary = forge.util.encode64(StickyCrypto.randomBytes(24));
            var resetMaterial = StickyCrypto.rewrapUserKey(temporary, originalKey, job.target.PublicKey);
            resetMaterial.recovery = JSON.parse(job.target.EncryptedPrivateKey).recovery;
            resetMaterial.mustChangePassword = true;
            resetMaterial.temporaryExpiresAt = new Date(new Date().getTime() + 24 * 3600000).toISOString();
            return { record: StickyCrypto.createPasswordRecord(temporary), material: resetMaterial, temporaryPassword: temporary };
        }
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
        function done(error, value) { if (completed) { return; } completed = true; window.clearTimeout(timer); if (worker) { worker.terminate(); } job.password = ''; job.privateKey = ''; callback(error, value); }
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

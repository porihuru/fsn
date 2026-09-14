/*
 * Cryptographic facade. Primitives are supplied by the bundled node-forge
 * distribution; this file deliberately does not implement AES, RSA, or SHA.
 */
var StickyCrypto = (function () {
    var version = 'STICKY-CRYPTO-V1', iterations = 210000;
    function available() { return typeof forge !== 'undefined' && !!forge.pkcs5 && !!forge.cipher && !!forge.pki; }
    function requireForge() { if (!available()) { throw new Error('暗号ライブラリを読み込めませんでした。'); } }
    function randomBytes(size) {
        var provider = window.crypto || window.msCrypto, bytes, result = '', i;
        requireForge();
        if (!provider || !provider.getRandomValues || typeof Uint8Array === 'undefined') { throw new Error('安全な乱数生成が利用できません。暗号化を停止しました。'); }
        bytes = new Uint8Array(size); provider.getRandomValues(bytes);
        for (i = 0; i < bytes.length; i += 1) { result += String.fromCharCode(bytes[i]); }
        return result;
    }
    function toBase64(bytes) { return forge.util.encode64(bytes); }
    function fromBase64(value) {
        if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) { throw new Error('Base64形式が不正です。'); }
        return forge.util.decode64(value);
    }
    function derivePasswordKey(password, salt, count, encoding) {
        requireForge(); count = count || iterations;
        if (count < 10000 || count > 2000000 || count !== Math.floor(count)) { throw new Error('鍵導出の反復数が不正です。'); }
        return forge.pkcs5.pbkdf2(encoding === 'utf8' ? forge.util.encodeUtf8(String(password)) : String(password), salt, count, 32, 'sha256');
    }
    function createPasswordRecord(password) {
        var salt = randomBytes(16), hash = derivePasswordKey(password, salt, iterations, 'utf8');
        return { version: version, algorithm: 'PBKDF2-HMAC-SHA-256', encoding: 'utf8', iterations: iterations, salt: toBase64(salt), hash: toBase64(hash) };
    }
    function verifyPassword(password, record) {
        var actual, expected, i, different = 0;
        if (!record || record.version !== version || record.algorithm !== 'PBKDF2-HMAC-SHA-256' || !record.salt || !record.hash) { return false; }
        actual = toBase64(derivePasswordKey(password, fromBase64(record.salt), record.iterations, record.encoding));
        expected = String(record.hash);
        if (actual.length !== expected.length) { return false; }
        for (i = 0; i < actual.length; i += 1) { different |= actual.charCodeAt(i) ^ expected.charCodeAt(i); }
        return different === 0;
    }
    function encryptJson(value, keyBytes) {
        var iv = randomBytes(12), cipher, plaintext;
        requireForge();
        if (!keyBytes || keyBytes.length !== 32) { throw new Error('AES鍵長が不正です。'); }
        cipher = forge.cipher.createCipher('AES-GCM', keyBytes);
        plaintext = forge.util.encodeUtf8(JSON.stringify(value));
        cipher.start({ iv: iv, tagLength: 128 });
        cipher.update(forge.util.createBuffer(plaintext));
        if (!cipher.finish()) { throw new Error('AES暗号化に失敗しました。'); }
        return { version: version, algorithm: 'AES-256-GCM', iv: toBase64(iv), cipherText: toBase64(cipher.output.getBytes()), authTag: toBase64(cipher.mode.tag.getBytes()) };
    }
    function decryptJson(payload, keyBytes) {
        var cipher, ok, text;
        requireForge();
        if (!payload || payload.version !== version || payload.algorithm !== 'AES-256-GCM') { throw new Error('暗号ペイロード形式が不正です。'); }
        if (!keyBytes || keyBytes.length !== 32 || fromBase64(payload.iv).length !== 12 || fromBase64(payload.authTag).length !== 16) { throw new Error('暗号パラメーターが不正です。'); }
        cipher = forge.cipher.createDecipher('AES-GCM', keyBytes);
        cipher.start({ iv: fromBase64(payload.iv), tagLength: 128, tag: forge.util.createBuffer(fromBase64(payload.authTag)) });
        cipher.update(forge.util.createBuffer(fromBase64(payload.cipherText)));
        ok = cipher.finish();
        if (!ok) { throw new Error('暗号ペイロードの検証に失敗しました。'); }
        text = forge.util.decodeUtf8(cipher.output.getBytes());
        return JSON.parse(text);
    }
    function generateContentKey() { return randomBytes(32); }
    function generateRsaKeyPair() { requireForge(); return forge.pki.rsa.generateKeyPair({ bits: 2048, e: 65537 }); }
    function exportPublicKey(key) { requireForge(); return forge.pki.publicKeyToPem(key); }
    function exportPrivateKey(key) { requireForge(); return forge.pki.privateKeyToPem(key); }
    function encryptKeyForRecipient(contentKey, publicKeyPem) { var key; requireForge(); key = forge.pki.publicKeyFromPem(publicKeyPem); return toBase64(key.encrypt(contentKey, 'RSA-OAEP', { md: forge.md.sha256.create(), mgf1: { md: forge.md.sha256.create() } })); }
    function decryptRecipientKey(encryptedKey, privateKeyPem) { var key; requireForge(); key = forge.pki.privateKeyFromPem(privateKeyPem); return key.decrypt(fromBase64(encryptedKey), 'RSA-OAEP', { md: forge.md.sha256.create(), mgf1: { md: forge.md.sha256.create() } }); }
    function createUserKeyMaterial(password) { var pair = generateRsaKeyPair(), salt = randomBytes(16), key = derivePasswordKey(password, salt, iterations, 'utf8'); return { version: version, iterations: iterations, encoding: 'utf8', publicKey: exportPublicKey(pair.publicKey), privateKeyPayload: encryptJson({ privateKey: exportPrivateKey(pair.privateKey) }, key), privateKeySalt: toBase64(salt) }; }
    function unlockUserPrivateKey(password, material) { var key, data; if (!material || material.version !== version || !material.privateKeySalt || !material.privateKeyPayload) { throw new Error('ユーザー鍵が見つかりません。'); } key = derivePasswordKey(password, fromBase64(material.privateKeySalt), material.iterations, material.encoding); data = decryptJson(material.privateKeyPayload, key); return data.privateKey; }
    return { VERSION: version, ITERATIONS: iterations, available: available, randomBytes: randomBytes, createPasswordRecord: createPasswordRecord, verifyPassword: verifyPassword, encryptJson: encryptJson, decryptJson: decryptJson, generateContentKey: generateContentKey, generateRsaKeyPair: generateRsaKeyPair, exportPublicKey: exportPublicKey, exportPrivateKey: exportPrivateKey, encryptKeyForRecipient: encryptKeyForRecipient, decryptRecipientKey: decryptRecipientKey, createUserKeyMaterial: createUserKeyMaterial, unlockUserPrivateKey: unlockUserPrivateKey };
}());

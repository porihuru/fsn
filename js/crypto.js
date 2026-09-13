/*
 * Cryptographic facade. Primitives are supplied by the bundled node-forge
 * distribution; this file deliberately does not implement AES, RSA, or SHA.
 */
var StickyCrypto = (function () {
    var version = 'STICKY-CRYPTO-V1', iterations = 210000;
    function available() { return typeof forge !== 'undefined' && !!forge.pkcs5 && !!forge.cipher && !!forge.pki; }
    function requireForge() { if (!available()) { throw new Error('暗号ライブラリを読み込めませんでした。'); } }
    function randomBytes(size) { requireForge(); return forge.random.getBytesSync(size); }
    function toBase64(bytes) { return forge.util.encode64(bytes); }
    function fromBase64(value) { return forge.util.decode64(value); }
    function derivePasswordKey(password, salt) { requireForge(); return forge.pkcs5.pbkdf2(String(password), salt, iterations, 32, forge.md.sha256.create()); }
    function createPasswordRecord(password) {
        var salt = randomBytes(16), hash = derivePasswordKey(password, salt);
        return { version: version, algorithm: 'PBKDF2-HMAC-SHA-256', iterations: iterations, salt: toBase64(salt), hash: toBase64(hash) };
    }
    function verifyPassword(password, record) {
        var actual, expected, i, different = 0;
        if (!record || !record.salt || !record.hash) { return false; }
        actual = toBase64(derivePasswordKey(password, fromBase64(record.salt)));
        expected = String(record.hash);
        if (actual.length !== expected.length) { return false; }
        for (i = 0; i < actual.length; i += 1) { different |= actual.charCodeAt(i) ^ expected.charCodeAt(i); }
        return different === 0;
    }
    function encryptJson(value, keyBytes) {
        var iv = randomBytes(12), cipher, plaintext;
        requireForge();
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
    function createUserKeyMaterial(password) { var pair = generateRsaKeyPair(), salt = randomBytes(16), key = derivePasswordKey(password, salt); return { version: version, publicKey: exportPublicKey(pair.publicKey), privateKeyPayload: encryptJson({ privateKey: exportPrivateKey(pair.privateKey) }, key), privateKeySalt: toBase64(salt) }; }
    function unlockUserPrivateKey(password, material) { var key, data; if (!material || !material.privateKeySalt || !material.privateKeyPayload) { throw new Error('ユーザー鍵が見つかりません。'); } key = derivePasswordKey(password, fromBase64(material.privateKeySalt)); data = decryptJson(material.privateKeyPayload, key); return data.privateKey; }
    return { VERSION: version, ITERATIONS: iterations, available: available, randomBytes: randomBytes, createPasswordRecord: createPasswordRecord, verifyPassword: verifyPassword, encryptJson: encryptJson, decryptJson: decryptJson, generateContentKey: generateContentKey, generateRsaKeyPair: generateRsaKeyPair, exportPublicKey: exportPublicKey, exportPrivateKey: exportPrivateKey, encryptKeyForRecipient: encryptKeyForRecipient, decryptRecipientKey: decryptRecipientKey, createUserKeyMaterial: createUserKeyMaterial, unlockUserPrivateKey: unlockUserPrivateKey };
}());

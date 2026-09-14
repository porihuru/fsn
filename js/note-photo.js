/* Local-only photo processing. No image URL or plaintext upload to a service. */
var NotePhoto = (function () {
    'use strict';
    var maximum = 200000;
    function valid(value) {
        if (typeof value !== 'string' || value.length > maximum || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) { return false; }
        return value.indexOf('data:image/jpeg;base64,/9j/') === 0 || value.indexOf('data:image/png;base64,iVBORw0KGgo') === 0;
    }
    function read(file, callback) {
        var reader, finished = false;
        function done(error, value) { if (finished) { return; } finished = true; callback(error, value); }
        if (!file || !/^(image\/jpeg|image\/png)$/.test(file.type)) { done(new Error('写真はJPEGまたはPNGを選択してください。')); return; }
        if (file.size > 10 * 1024 * 1024) { done(new Error('元の写真は10MB以下にしてください。')); return; }
        if (!window.FileReader) { done(new Error('写真の読み込みに対応していません。')); return; }
        reader = new FileReader();
        reader.onerror = function () { done(new Error('写真ファイルを読み込めません。')); };
        reader.onabort = function () { done(new Error('写真の読み込みが中止されました。')); };
        reader.onload = function () {
            var source = String(reader.result || ''), picture;
            if (!/^data:image\/jpeg;base64,\/9j\//.test(source) && !/^data:image\/png;base64,iVBORw0KGgo/.test(source)) { done(new Error('JPEG・PNGの写真データではありません。')); return; }
            picture = new Image();
            picture.onerror = function () { done(new Error('写真を表示できません。破損・形式・ブラウザ対応を確認してください。')); };
            picture.onload = function () {
                try {
                    var width = picture.naturalWidth || picture.width, height = picture.naturalHeight || picture.height, scale, canvas, context, data, quality = 0.82, attempt;
                    if (!width || !height || width * height > 50000000) { throw new Error('写真の画素数が大きすぎるか、画像が不正です。'); }
                    scale = Math.min(1, 1024 / Math.max(width, height)); canvas = document.createElement('canvas'); context = canvas.getContext('2d');
                    if (!context) { throw new Error('写真の縮小処理に対応していません。'); }
                    for (attempt = 0; attempt < 8; attempt += 1) {
                        canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
                        context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(picture, 0, 0, canvas.width, canvas.height);
                        data = canvas.toDataURL('image/jpeg', quality);
                        if (valid(data)) { done(null, data); return; }
                        scale *= 0.8; quality = Math.max(0.5, quality - 0.08);
                    }
                    throw new Error('写真を保存可能な容量まで縮小できません。小さい写真を選択してください。');
                } catch (e) { done(e); }
            };
            picture.src = source;
        };
        try { reader.readAsDataURL(file); } catch (e) { done(e); }
    }
    return { valid: valid, read: read, MAXIMUM: maximum };
}());

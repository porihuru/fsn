# fsn — 社内付箋プロトタイプ

SharePoint連携を前提にした、IE11互換方針の社内付箋・SNS UIプロトタイプです。

## 起動

`login.html` をブラウザで開き、ログインボタンを押してください。現在はローカルモックモードのため、付箋データはブラウザの `localStorage` に保存されます。

## 実装済み

- 個人付箋ボード（作成・編集・削除・検索・色・期限）
- 受信BOX、SNS投稿、通知、タスク画面
- 付箋へのSNS投稿コピー、トースト通知
- 外部依存なしのCSS/JavaScript
- ES5構文、XMLHttpRequestベースのSharePointラッパー

## SharePoint接続

`js/config.js` の `USE_SHAREPOINT` と `SHAREPOINT_BASE_URL` を環境に合わせて設定してください。`js/sharepoint.js` はREST呼び出しの土台です。認証、暗号化、RequestDigest、リストのCRUD、セッション排他は本番導入前にサーバー側の設計・検証が必要です。このプロトタイプは機密データを扱う本番実装ではありません。

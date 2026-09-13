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
## リスト別の列型

`Title` はSharePointが標準で作る「1行テキスト」のまま残します。

### StickyUsers

| 列名 | 種類 |
|---|---|
| StickyUserId | 1行テキスト |
| SharePointUserId | 1行テキスト |
| LoginName | 1行テキスト |
| Organization | 1行テキスト |
| DisplayName | 1行テキスト |
| PasswordHash | 複数行テキスト |
| PasswordSalt | 1行テキスト |
| PublicKey | 複数行テキスト |
| EncryptedPrivateKey | 複数行テキスト |
| CryptoVersion | 1行テキスト |
| CurrentSessionHash | 1行テキスト |
| CurrentDeviceId | 1行テキスト |
| LastLoginAt | 日付と時刻 |
| Enabled | はい/いいえ |

### StickySessions

| 列名 | 種類 |
|---|---|
| UserId | 1行テキスト |
| DeviceId | 1行テキスト |
| TokenHash | 1行テキスト |
| CreatedAt | 日付と時刻 |
| LastAccessAt | 日付と時刻 |
| ExpiresAt | 日付と時刻 |
| Revoked | はい/いいえ |
| UserAgent | 複数行テキスト |

### StickyNotes

| 列名 | 種類 |
|---|---|
| SenderUserId | 1行テキスト |
| NoteType | 1行テキスト |
| EncryptedPayload | 複数行テキスト |
| CryptoVersion | 1行テキスト |
| Deleted | はい/いいえ |
| Archived | はい/いいえ |

### StickyRecipients

| 列名 | 種類 |
|---|---|
| NoteId | 1行テキスト |
| RecipientUserId | 1行テキスト |
| EncryptedNoteKey | 複数行テキスト |
| IsRead | はい/いいえ |
| ReadAt | 日付と時刻 |

### StickyPosts

| 列名 | 種類 |
|---|---|
| AuthorUserId | 1行テキスト |
| Category | 1行テキスト |
| EncryptedPayload | 複数行テキスト |
| IsPinned | はい/いいえ |

### StickyPostViews

| 列名 | 種類 |
|---|---|
| PostId | 1行テキスト |
| ViewerUserId | 1行テキスト |
| FirstViewedAt | 日付と時刻 |
| LastViewedAt | 日付と時刻 |
| ViewCount | 数値（小数なし） |

### StickyComments

| 列名 | 種類 |
|---|---|
| PostId | 1行テキスト |
| AuthorUserId | 1行テキスト |
| EncryptedPayload | 複数行テキスト |
| Deleted | はい/いいえ |

### StickyReactions

| 列名 | 種類 |
|---|---|
| PostId | 1行テキスト |
| UserId | 1行テキスト |
| ReactionType | 1行テキスト |

### StickyNotifications

| 列名 | 種類 |
|---|---|
| RecipientUserId | 1行テキスト |
| NotificationType | 1行テキスト |
| RelatedId | 1行テキスト |
| SenderUserId | 1行テキスト |
| IsRead | はい/いいえ |

### StickyGroups

| 列名 | 種類 |
|---|---|
| GroupKey | 1行テキスト |
| DisplayName | 1行テキスト |
| Enabled | はい/いいえ |

### StickyGroupMembers

| 列名 | 種類 |
|---|---|
| GroupKey | 1行テキスト |
| UserId | 1行テキスト |
| Enabled | はい/いいえ |
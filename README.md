# fsn — 社内付箋プロトタイプ

SharePoint連携を前提にした、IE11互換方針の社内付箋・SNS UIプロトタイプです。

## 起動

`login.html` をブラウザで開き、ログインボタンを押してください。現在はローカルモックモードのため、付箋データはブラウザの `localStorage` に保存されます。

ログイン時に「この端末では次回からパスワード不要（30日間）」を選べます。パスワード自体ではなく端末ログイン情報を保存します。自分専用の端末で使用してください。ロック・ログアウトで保存を解除します。設定画面から保存だけを解除することもできます。

保存の安全性の限界は [端末の自動ログイン](docs/password-and-recovery.md) を参照してください。パスワードを忘れた場合は、管理者が仮パスワードを発行し、本人が次回ログイン時に変更します。管理者画面 `admin.html` で、初回に管理者パスワードを登録するだけで設定完了です。復旧鍵は暗号化して既存のStickyUsersリスト（端末内モードはブラウザ内）に自動保存するため、ファイル操作やリスト・列の追加は不要です。[管理者パスワードの登録と初期化手順](docs/admin-password-reset.md) を参照してください。既存利用者は管理者登録後に一度パスワードを入力して正常ログインし、復旧登録を行ってください。

## 実装済み

- 個人付箋ボード（作成・編集・削除・検索・色・期限）
- 本文の表を直接編集（行・列追加、表貼り付け、太字）。操作は [付箋の表編集](docs/note-editor.md) を参照してください。
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

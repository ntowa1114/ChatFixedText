# ChatFixedText

Twitch の配信チャットで、事前登録した定型文を予測変換のように素早く入力できる Chrome 拡張機能（Manifest V3）です。

- チャット入力欄で `otu` と打つと「お疲れ様です！」、`88` と打つと「8888888」が候補に出ます
- `↑` `↓` で選択、`Tab` / `Enter` で確定、`Esc` で閉じる。マウスクリックでも確定できます
- 確定するとキャレット直前の単語が定型文に置き換わります（自動送信はしません）
- 対象: `https://www.twitch.tv/*`（ポップアウトチャット `/popout/<channel>/chat` を含む）

## ビルド・読み込み手順

前提: Node.js 20 以上

```sh
npm install
npm run build      # dist/ に拡張機能が出力される
```

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパー モード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」で **`dist/` フォルダ**を選択する
4. Twitch のタブを開き直す（読み込み済みのタブには反映されません）

開発中は `npm run watch` でファイル変更のたびに再ビルドされます。再ビルド後は `chrome://extensions` で拡張機能の再読み込みボタンを押し、Twitch のタブをリロードしてください。

その他のコマンド:

| コマンド | 内容 |
| --- | --- |
| `npm test` | ユニットテスト（Vitest） |
| `npm run typecheck` | 型チェック |

## 定型文の追加方法

定型文は `src/data/phrases.json` だけで管理します（ユーザーが追加・編集する UI はありません）。

```json
[
  { "id": "otsukare", "text": "お疲れ様です！", "keywords": ["otu", "otsukare", "おつ"] },
  { "id": "clap", "text": "8888888", "keywords": ["88", "pachi"] }
]
```

| フィールド | 内容 |
| --- | --- |
| `id` | 一意な ID。英数字・`_`・`-` のみ。重複不可 |
| `text` | 入力欄に挿入される本文 |
| `keywords` | マッチングに使う読み・略称。空白は含められません（空配列も可） |

- 本文とキーワードの両方が検索対象です。完全一致 → 前方一致 → 部分一致の順に並び、同順位は配列の並び順です。よく使うものを上に書いてください
- 大文字/小文字、全角/半角、カタカナ/ひらがなは区別しません（`ＯＴＵ`・`ｵﾂ`・`オツ` も `otu`・`おつ` と同じ扱い）
- 候補は最大 8 件です。1 文字だけの入力では、キーワードと完全一致する定型文だけが出ます（例: `の` → `ノ`）。前方一致・部分一致は 2 文字目から出ます（`src/content/matcher.ts` の `SHORT_QUERY_LENGTH`）
- 入力が定型文の本文とまったく同じ場合、その定型文は候補に出ません
- `npm run build` 時に内容が検証され、不正（ID の重複、空の本文など）があるとビルドが失敗してエラー箇所が表示されます。`npm test` でも同梱データを検証します

追加したらビルドし、下記の手順でバージョンを上げてください。

## バージョン更新手順

バージョンは **`package.json` の `version` だけ**で管理します。ビルド時に `dist/manifest.json` へ自動で埋め込まれるので、ルートの `manifest.json` には書きません。

```sh
npm version patch --no-git-tag-version   # 0.1.0 → 0.1.1（定型文の追加など）
npm version minor --no-git-tag-version   # 0.1.0 → 0.2.0（機能追加）
npm test
npm run build
```

配布する場合は `dist/` の中身を zip にまとめます（例: `cd dist && zip -r ../chatfixedtext-$(node -p "require('../package.json').version").zip .`）。

## 動作の仕組みと確認方法

### テキスト置換

Twitch の入力欄 `[data-a-target="chat-input"]` は Slate.js の contenteditable です。`innerText` などを直接書き換えると Slate の内部状態とずれ、**画面上は置き換わっても送信されるのは元の文字列**になります。

そのため `src/content/chatInput.ts` では「DOM の選択範囲を置換したい単語に合わせる → 編集イベントを発火して Slate 自身に編集させる」方式を取り、次の順に試します。

1. `beforeinput`（`inputType: "insertText"`）: Slate が処理する本命の方法
2. `paste`（`text/plain` の DataTransfer）: 1 を Slate が処理しなかった場合の予備
3. `document.execCommand('insertText')`: エディタがどちらも処理しなかった場合の最終手段

`execCommand` を最初に使わないのは、**Chrome では `execCommand` が `beforeinput` を発火しないため、Slate の内部状態が更新されない**からです（実際の Slate + Chromium で確認済み）。エディタがイベントを `preventDefault` した（＝処理した）時点で終了するので、二重に挿入されることはありません。

### 実際に送信される内容の確認手順

1. Twitch を開いた状態で DevTools のコンソールを開き、次を実行してリロードする

   ```js
   localStorage.setItem('chatfixedtext:debug', '1')
   ```

2. 自分のチャンネル（またはテスト用のチャンネル）のチャット入力欄で `otu` と入力し、`Enter` で確定する
3. コンソールに次のようなログが出ることを確認する

   ```
   [ChatFixedText] 置換成功 {ok: true, strategy: 'beforeinput', before: 'otu', expected: 'お疲れ様です！', actual: 'お疲れ様です！'}
   ```

   - `strategy` が `beforeinput` か `paste` なら Slate に反映されています
   - `strategy` が `execCommand` の場合は警告が出ます。表示だけ置き換わって送信内容は元のままの可能性があります
4. もう一度 `Enter` を押して送信し、**チャット欄に表示された自分のメッセージ**が「お疲れ様です！」になっていることを確認する（ポップアップ非表示時の `Enter` では `Enter: 送信される入力欄の内容 = "..."` もログに出ます）
5. 確認が終わったら `localStorage.removeItem('chatfixedtext:debug')` で無効化する

もし Twitch 側の変更で置換が効かなくなった場合も、このログで「どの方法が処理されたか」「期待値と実際の値」が分かります。

### その他の挙動

- **SPA 対応**: `document.body` を MutationObserver で監視し、入力欄が差し替わったら付け替えます。イベントリスナーは起動時に 1 回だけ登録し、入力欄の参照を差し替えるだけなので多重登録になりません
- **キー操作**: `keydown` を `window` の capture フェーズで受け取り、ポップアップ表示中の `↑` `↓` `Tab` `Enter` `Esc` だけを `preventDefault` + `stopPropagation` します。非表示時は一切干渉しません
- **日本語 IME**: 変換中（`compositionstart`〜`compositionend`、`isComposing`）は候補を出さず、キーも処理しません。変換確定後の文字列でマッチングします
- **他の補完との衝突回避**: 入力が `:` や `/` で始まる場合（エモート補完・コマンド）、単語が `:` や `@` で始まる場合（エモート・メンション補完）は候補を出しません
- **Esc / 確定後**: 入力内容が変わるまで同じ内容に対して候補を出し直しません
- **スタイルの隔離**: ポップアップは `document.body` 直下の Shadow DOM 内に描画します。ダーク/ライトは `<html>` の `tw-root--theme-dark` / `tw-root--theme-light` クラスで判定し、どちらもない場合は OS の設定に従います
- **権限**: `content_scripts` の `matches` だけで動作するため、`permissions` / `host_permissions` は宣言していません

## ディレクトリ構成

```
manifest.json         # 拡張機能の manifest（version はビルド時に package.json から埋め込む）
vite.config.ts        # ビルド設定（content script の IIFE バンドル、phrases.json の検証）
src/
  content/
    index.ts          # エントリ。入力欄の検出・監視、キー操作、候補の更新
    chatInput.ts      # 入力欄の取得、キャレット直前の単語の取得、テキスト置換
    popup.ts / .css   # 候補ポップアップの UI（Shadow DOM）
    matcher.ts        # 候補検索ロジック
    debug.ts          # デバッグログ
  data/
    phrases.json      # 定型文データ
  types.ts            # Phrase 型とバリデーション
tests/                # Vitest のユニットテスト
```

# Swarm 共有文ジェネレーター

Swarmの共有URLまたはURLを含む文章から、`I'm at 施設名 in 市区町村, 都道府県` と元のURLを生成します。

## 対応URL

- 新形式: `https://app.foursquare.com/share/checkin/ID?s=...&lang=ja`
- 従来形式: `https://swarmapp.com/user/USER_ID/checkin/ID?s=...`
- 従来形式の `www` / `ja` サブドメインと `foursquare.com` も受け付けます。

共有用の `s` などのクエリパラメータは取得・コピー・X投稿時に保持します。新形式では `PREFETCHED_SHARED_CONTENT` のJSONから施設名を抽出し、ユーザー名が検索語に混ざることを防ぎます。旧形式のOpen Graphメタデータも引き続き利用します。

Nominatimで候補を検索し、候補選択、クリップボードへのコピー、X投稿画面の表示、Googleでの再検索に対応します。Googleの利用にはサーバー環境変数 `GOOGLE_MAPS_API_KEY` が必要です。

## 検証

Node.js 22.13以上を使用します。

```sh
npm ci
npm test
```

テストは外部通信をモックし、新旧URL、施設名、住所、転送先の制限、APIエラー、画面操作を検証します。実際のGoogle API通信・クリップボード権限・Xへの投稿送信は実行しません。

`public/index.html` と `public/swarm-url.js` を同じ公開ディレクトリで配信し、`/api` を `api/index.js` に接続する既存のホスティング構成を使用します。ブラウザのURL判定とAPIの許可規則は `public/swarm-url.js` を共有します。

2026-10-24に新形式の実ページで施設名取得とNominatimでの共有文生成を確認しました。変更を公開環境へ反映するには、既存のデプロイ手順で公開してください。

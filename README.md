# Swarm 共有文ジェネレーター

Swarmの共有URLまたはURLを含む文章から、`I'm at 施設名 in 市区町村, 都道府県` と元のURLを生成します。

## 対応URL

- 新形式: `https://app.foursquare.com/share/checkin/ID?s=...&lang=ja`
- 従来形式: `https://swarmapp.com/user/USER_ID/checkin/ID?s=...`
- 従来形式の `www` / `ja` サブドメインと `foursquare.com` も受け付けます。

共有用の `s` などのクエリパラメータは取得・コピー・X投稿時に保持します。新形式では `PREFETCHED_SHARED_CONTENT` のJSONから施設名を抽出し、ユーザー名が検索語に混ざることを防ぎます。旧形式のOpen Graphメタデータも引き続き利用します。

Nominatimで候補を検索し、候補選択、クリップボードへのコピー、X投稿画面の表示、Googleでの再検索に対応します。Googleの利用にはサーバー環境変数 `GOOGLE_MAPS_API_KEY` が必要です。

## Google検索の月間上限

利用者全員・全デプロイ合計で月9,000リクエストを上限にします。Google Geocodingの月10,000回の無料枠に対し余裕を持たせています。月の境界はGoogleに合わせ `America/Los_Angeles` の月初0時です。

Googleに送信する直前にUpstash RedisのLuaスクリプトで枠を確保します。同時リクエストでも上限を超えません。送信後の失敗も消費として扱い、返却・自動再試行は行いません。保存先の未設定・障害・カウンター消失時はGoogle検索を停止し、Nominatimと候補選択は引き続き利用できます。画面の残数は最後のGoogle応答時点の値です。

### 本番設定

1. Upstash Redisの無料プランを作成し、`UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` をサーバー環境変数として接続します（`KV_REST_API_URL` / `KV_REST_API_TOKEN` も対応）。同じGoogle課金枠を利用する全プロジェクトで同じRedisを共有してください。
2. Redisはevictionを無効にし、カウンターキーにTTLを設定しないでください。カウンターを過去のバックアップに戻すと消費数が戻るため、停止して実使用量を確認してから復旧します。
3. Google呼び出しを停止した状態で、当月の既使用量をGoogle Cloudで確認して初期化します。秘密情報を設定した環境で `node --env-file=.env.local scripts/init-google-budget.js YYYY-MM USED_COUNT` を実行します。月は太平洋時間の当月です。不明なら安全側に9,000を指定し、その月は停止します。既存キーの上書きは拒否します。
4. 全稼働プロジェクトに同じ制限をデプロイします。制限前の旧デプロイや他アプリから同じ課金枠へのアクセスが残ると、このカウンターを迂回します。旧デプロイをアクセス不可にするか、そのキーを無効化して制限済み環境だけに新しいキーを設定してください。
5. 上限時に429、保存先異常時に503となりGoogleに送信されないことを確認します。月初は自動更新されます。上限後に開いたままの画面は再読み込みしてください。

太平洋時間ではまだ前月の場合に翌月分を先に初期化するには、確認済みの翌月使用量を指定し `--allow-next-month` を付けます。翌月開始まではGoogle通信を停止します。既存カウンターのリセットや上書きはしません。

この制限はジェネレーターが送るGeocodingリクエストを対象とし、他アプリ・他APIの費用は制限しません。Google Cloud側のAPI割り当ても併用できます。

料金根拠: [Google公式料金表](https://developers.google.com/maps/billing-and-pricing/pricing)、[請求期間](https://developers.google.com/maps/billing-and-pricing/overview)、[Upstash料金](https://upstash.com/pricing/redis)。無料プランかを作成時に確認してください。

## テスト

Node.js 22.13以上を使用します。

```sh
npm ci
npm test
```

テストは外部通信をモックし、新旧URL、施設名、住所、転送先の制限、APIエラー、画面操作を検証します。実際のGoogle API通信・クリップボード権限・Xへの投稿送信は実行しません。

実Redisでの同時予約・月替わり・破損データ検証は `node --env-file=.env.test.local scripts/verify-google-budget.js` で実行します。ランダムな検証キーのみを使用し、本番カウンターは変更しません。通常の `npm test` は実Redis検証を含みません。

`public/index.html` と `public/swarm-url.js` を同じ公開ディレクトリで配信し、`/api` を `api/index.js` に接続する既存のホスティング構成を使用します。ブラウザのURL判定とAPIの許可規則は `public/swarm-url.js` を共有します。

2026-10-24に新形式の実ページで施設名取得とNominatimでの共有文生成を確認しました。変更を公開環境へ反映するには、既存のデプロイ手順で公開してください。

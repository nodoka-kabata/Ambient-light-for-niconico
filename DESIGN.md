# ニコニコ動画向け Ambient Light 設計

## 目的

ニコニコ動画の視聴ページで、再生中映像の色を使ったアンビエントライトを表示する Chrome 拡張を作る。動画の周囲をぼかした光で照らし、視聴への没入感を高める。

## 参照機能と初期スコープ

参考拡張の主機能は、光のぼかし・広がり・フェード、視聴モードごとの有効化、オン/オフ、詳細な映像調整など。初版は核となる体験に絞る。

- `www.nicovideo.jp/watch/*` の動画ページだけで動作
- プレイヤーの背後に、映像色を反映するアンビエント光を表示
- 表示方式を「プレイヤー周囲」と「画面全体をぼかす」から選択
- 再生/停止や動画切り替えに追従
- 有効/無効、ぼかし量、広がり、フェード時間、明るさ、コントラスト、彩度を設定
- 設定は `chrome.storage.sync` に保存
- ページ外への通信は行わない

黒帯除去、画質制限、ページ全体の装飾、統計は初版に含めない。

## 技術方針

- Manifest V3 の Chrome 拡張
- `document_idle` で動く content script が視聴ページとプレイヤーを監視
- `video[data-name="video-content"]` を動画要素として取得し、プレイヤー内に拡張管理の `<canvas>` を配置。縮小した映像をぼかして表示する
- 全画面背景モードでは canvas を document root に固定配置し、root/body と動画を包む大きな不透明背景を一時的に透過してページUIの背面に表示。終了時に元の背景色へ戻す
- `requestVideoFrameCallback` が使える場合はそれで更新し、未対応時は `requestAnimationFrame` を使う
- `MutationObserver` で SPA の動画遷移・プレイヤー再生成を検出し、購読を張り直す
- Popup はオン/オフ、表示方式、スライダーのみ。設定画面は作らない

## 重要な技術リスク

共有された DevTools の画面では、動画要素は `video[data-name="video-content"]`、`src` は `blob:https://www.nicovideo.jp/...` と確認できた。実装はフレームを縮小して canvas に描くだけで、`getImageData()` による画素読み出しは行わない。そのため canvas が origin-clean である必要はない。実ページで描画・重なり順・全画面表示を確認する。

動画要素はプレイヤー内の `data-name="content"` レイヤーにあり、`object-fit: contain` で表示される。周囲モードでは光を同じ `data-name="inner"` レイヤー内に z-index 0 で置き、映像やコメント・字幕より下に配置する。全画面モードでは固定canvasをページ背景の後ろに置く。実ページで重なり順と背景色の透過を確認する。

## 実装順

1. 再生中の `video[data-name="video-content"]` で canvas 読み出し可否を確認し、光を置く親要素を特定
2. 単一ページ上で canvas のアンビエント光を表示する最小実装
3. 動画切り替え・プレイヤー再生成・全画面表示に追従
4. Popup のオン/オフ、表示方式、映像設定を接続
5. Chrome に読み込んで視聴ページで手動確認

## 完了条件

- 視聴ページだけで表示され、他ページに影響しない
- 動画の色変化に追従し、停止時に無駄なフレーム処理を続けない
- ページ遷移やプレイヤー再生成後も二重レイヤーや多重ループが残らない
- 設定変更が保存され、再訪後も反映される
- フルスクリーン時に動画の周囲へ光が見える
- 全画面背景モードで動画のぼかしがページ全体に見える

## 参照

- [Ambient light for YouTube™ Chrome Web Store](https://chromewebstore.google.com/detail/ambient-light-for-youtube/paponcgjfojgemddooebbgniglhkajkj)
- [Niconico視聴ページの DOM/CSS 利用例](https://gist.github.com/mfmfuyu/6fb6457fc26841a22e0fd211f5b8529c)（非公式・2024年時点。現行DOMの保証なし）

# MediaPipe Pose (local)

このフォルダに `pose.js`（および必要なら追加アセット）を配置すると、CDN なしでローカルから読み込みます。

## 置き場所

- `c:\xampp\htdocs\Demo\mediapipe\pose\pose.js`

## 自動ダウンロード（PowerShell）

1. Windows PowerShell を管理者で開く必要はありません。
2. プロジェクトの `Demo` 直下にある `download_pose.bat` をダブルクリック、または以下のコマンドを手動で実行します。

```powershell
# Demo フォルダ内で実行
powershell -ExecutionPolicy Bypass -File .\mediapipe\pose\get_pose.ps1
```

取得されるファイル（環境により一部のみ使用）:

- pose.js
- pose_solution_packed_assets_loader.js
- pose_solution_packed_assets.data
- pose_solution_simd_wasm_bin.wasm
- pose_solution_wasm_bin.js
- pose_solution_simd_wasm_bin.js

## 手動ダウンロード（ブラウザ）

1. 以下URLを開く
   - https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/pose.js
2. `pose.js` として保存し、このフォルダ（`mediapipe/pose`）へ配置

## 追加アセットについて（必要になったら）

環境によっては `pose.js` が内部で追加ファイル（*.wasm や *.data）を読み込む場合があります。ブラウザのコンソール/ネットワークに 404 が出たら、本フォルダの `get_pose.ps1` を再実行するか、npm から同バージョンのパッケージを取得して一式コピーしてください。

```
# 作業用ディレクトリで
npm init -y
npm install @mediapipe/pose@0.5.1675469242
# 展開先（このフォルダ）へコピー
# node_modules/@mediapipe/pose/ 配下のファイルをすべて mediapipe/pose/ へコピー
```

## トラブルシュート

- 画面の STATUS が `LOADING POSE...` から進まない: ネットワーク遮断またはファイル未配置です。`pose.js` が本フォルダにあるか確認。
- `POSE NOT FOUND` のまま: `pose.js` が壊れている/追加アセット404。READMEの手順で再配置。
- `POSE READY` になっても数値が 100000 固定: カメラに上半身が十分入っていない、または暗すぎます。照明と構図を調整してください。

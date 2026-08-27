<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="88" alt="PeroPix">

# PeroPix

**NovelAI の画像生成のためのデスクトップ作業台。**<br>
シーンをレーンに並べて一度押せば、まとめて出てきます。

[![Release](https://img.shields.io/github/v/release/mrm987/PeroPix3?label=download&color=5865F2)](https://github.com/mrm987/PeroPix3/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/mrm987/PeroPix3/total?color=5865F2)](https://github.com/mrm987/PeroPix3/releases)
[![License](https://img.shields.io/badge/license-AGPL--3.0-informational)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

[English](README.md) · [한국어](README.ko.md) · **日本語**

</div>

---

一枚ずつ出すのは難しくありません。同じキャラクターをシーンだけ変えて二十枚となると話は
別です。PeroPix はそのための道具です — **変わらない部分は一度だけ書き、変わる部分だけを
レーンに並べて、まとめて回します。**

- **シーンレーン** — シーン一つがカード一枚。違うところだけ埋めてレーンごと回すと、結果は
  それを生んだシーンに紐づいたまま残ります。
- **プロンプトブロック** — 長い一行ではなく、名前のついたブロックで組み立てます。カンマを
  数えずに、切り替え・並べ替え・重み付けができます。
- **カードデッキ** — 画風やキャラクターをカードとして保存し、どのシーンにも落とせます。
  カードを直せば、それを使うシーンがすべて追従します。
- **ワイルドカード** — 生成時に自分で選ばれる候補の束です。
- **インペイントと強化** — マスクを塗ってその部分だけ描き直す、あるいは仕上がった絵を強さ
  だけ変えて回し直す。バイブ転送とアップスケールも同じ場所にあります。
- **検閲** — 端末内のモデルが隠す場所を見つけて覆います。外に出るものはなく、方式と強さは
  自分で選べます。
- **AI アシスタント** — ワークスペースを預けて言葉で頼めば、プロンプトを直して処理を積んで
  くれます。取り消せないことは必ず先に尋ねます。

## 必要なもの

- **NovelAI のサブスクリプションと Persistent API Token。** 画像を作るのは NovelAI で、
  PeroPix はその手前の作業台です。トークンは NovelAI のアカウント設定で作成でき、
  `pst-` で始まります。
- **生成には Anlas がかかります。** プランの無料範囲（サイズ・ステップ数）内なら無料で、
  生成ボタンは押す前に必ず現在の値を表示します。
- **Windows 10 または 11。** WebView2 ランタイムが必要で、通常はすでに入っています。

## インストール

1. [最新リリース](https://github.com/mrm987/PeroPix3/releases/latest)から
   `PeroPix-<バージョン>-win64.zip` をダウンロードします。
2. **書き込みできる場所**に展開します — ドキュメントフォルダや別のドライブ。
   `Program Files` の中は不可です。
3. `PeroPix.exe` を起動し、**設定 ▸ 一般**でトークンを貼り付けます。

以上です。Python はパッケージに同梱されているので別途インストールは不要で、レジストリにも
何も書きません。移動や削除はフォルダごとで済みます。

> 複数展開して**並べて動かせます** — フォルダごとにポート・保存先・設定が分かれます。
> 塞いであるのは*同じ*フォルダを二重に開くことだけです。

## ファイルの置き場所

すべて `PeroPix.exe` の隣にあります。ここを控えておけば全部で、アップデートは触りません。

| フォルダ | 中身 |
|---|---|
| `workspaces/` | 作業物 — タブ・シーン・プロンプトと `output/` 以下の画像 |
| `gallery/` | 残すことにした画像 |
| `data/` | 設定とカード。**トークンは `data/secrets.json` にだけあります** |
| `logs/` | ログ一つ。不具合を知らせるときは `logs/peropix.log` を添えてください |

`app/` はプログラム本体で、アップデートのたびに入れ替わります。

## アップデート

起動時に静かに確認し、新しい版があれば知らせます。**設定 ▸ アップデート**から押しても
かまいません。受け取ったあと再起動すると適用されます。小さなパッチか全体かはアプリが自分
で決め、利用者に見えるのは容量だけです。

## 開発

```bash
npm install
npm run tauri dev     # フロント(1420) + バックエンド(8770) + ウィンドウ
```

バックエンドのみ: `python backend/server.py --port 8770`。
依存関係は `backend/requirements.txt` にあります。

パッケージ作成・リリース・アップデートがパッチと全体を選ぶ規則は
**[docs/release.md](docs/release.md)** にあります。

## ライセンス

[AGPL-3.0-or-later](LICENSE)。同梱の third-party 構成要素は [THIRD-PARTY.md](THIRD-PARTY.md) に記載しています。

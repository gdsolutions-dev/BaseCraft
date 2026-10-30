<p align="center"><a href="../../README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.pt.md">Português</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ko.md">한국어</a></p>

<div align="center">

<img src="../logo/png/icone-256.png" alt="BaseCraft" width="128" height="128">

<h1>BaseCraft</h1>

<p><strong>デスクトップ向けデータベースワークベンチ。Microsoft Access の発想を受け継ぐオープンソースアプリケーションです。</strong><br>
テーブル、クエリ、フォーム、レポートを、通常の SQLite データベースのままの単一ファイルで作成できます。<br>
Windows · macOS · Linux</p>

<p>
<a href="../../LICENSE"><img alt="ライセンス: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-EF572C"></a>
<img alt="TypeScript で記述" src="https://img.shields.io/badge/written%20in-TypeScript-364554">
<img alt="Windows · macOS · Linux で動作" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-EF572C">
<img alt="アカウント不要、テレメトリなし" src="https://img.shields.io/badge/no%20account-no%20telemetry-364554">
<br>
<a href="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/gdsolutions-dev/BaseCraft/releases"><img alt="最新リリース" src="https://img.shields.io/github/v/release/gdsolutions-dev/BaseCraft?include_prereleases&label=release"></a>
</p>

<p><a href="https://gdsolutions-dev.github.io/BaseCraft/"><strong>Web サイト</strong></a> · <a href="https://github.com/gdsolutions-dev/BaseCraft/releases">ダウンロード</a> · <a href="https://gdsolutions-dev.github.io/BaseCraft/maquettes/">UI モックアップ</a></p>

<img src="../images/screenshot.png" alt="グループ化と集計を設定した BaseCraft のレポートのデザインビュー" width="900">

</div>

BaseCraft は、テーブル、クエリ、フォーム、レポート、マクロ、コードといった、小規模なデータアプリケーションを作る Access 流のやり方を、モダンなインターフェイスで、Windows に縛られることなく復活させます。データベースの内容はすべて**単一のファイル**に収まり、そのファイルは通常の SQLite データベースなので、どの SQLite ツールでも開けます。

> **ステータス: 開発初期段階。** ステージ A（テーブル、リレーションシップ、クエリ、フォーム、レポート、インポートとエクスポート）はプレビュー版 0.2.0 で完了しています。1.0 より前に互換性のない変更が入る可能性があります。

## 背景

デスクトップで構造化データを管理する人は、たいてい次のどちらかに行き着きます。

- **Excel**。フォームによるデータ入力や、関連するデータの扱いには向いていません。
- **Access**。目的は果たせますが、Windows でしか動かず、ネットワーク経由で共有するとファイルが破損しやすい問題があります。

目標は、Excel を使いこなせる人が、コードを書かずに、午後のうちに小さなデータ入力アプリケーションを作れるようにすることです。関連付けたテーブル、入力フォーム、絞り込みクエリ、印刷用の PDF レポートを用意し、同僚に渡せます。

## 原則

- **使い慣れている。** Access と同じオブジェクトの種類と概念を備えています。すべてのオブジェクトにデザインビューと実行ビュー、QBE クエリグリッド、データシート、プロパティシートがあります。
- **データはあなたのもの。** `.basecraft` ファイルは通常の SQLite データベースです。ユーザーテーブルは、あなたが付けた名前のままの本物の SQLite テーブルで、BaseCraft がスキーマにカスタム関数や照合順序を入れることはありません。
- **標準で安全。** クラッシュしてもデータは失われません。メールで受け取ったファイルがコンピューターに害を及ぼすこともありません。
- **個人利用ならインストール不要。** サーバーも Python も追加のランタイムも要りません。
- **バイリンガル。** 英語とフランス語のインターフェイスに対応し、式もインターフェイスの言語で表示されます。

## 現在使える機能

- `.basecraft` ファイルの作成と読み込み（バージョン管理されたフォーマットとマイグレーション）
- ハートビート付きの書き込みロック。2 台目のマシンでは読み取り専用で開きます
- ネットワーク共有と同期フォルダー（OneDrive、Dropbox など）の検出
- テーブル: デザインビュー（フィールドの型、キー、複数フィールドのインデックス、テーブルの入力規則、データを失わない変更）、データシートからのテーブルフィールドタブ
- データシート: 入力、並べ替え、フィルター、検索、削除、行単位の保存
- フィールドプロパティ: 書式、既定値、入力規則と入力規則のエラーメッセージ、定型入力、ルックアップフィールド
- 参照整合性とカスケードに対応したリレーションシップウィンドウ、式ビルダー
- Access のセマンティクスに沿った式エンジン（パーサー、評価器、SQLite ジェネレーター）
- クエリ: QBE グリッドと SQL ビュー、選択クエリ、集計クエリ、パラメータークエリ、アクションクエリ
- フォーム: デザインビュー、プロパティシート、コントロール、単票フォーム、帳票フォーム、データシート、マスター/詳細のサブフォーム、オートフォーム
- レポート: バンドデザイナー、グループ化と集計、印刷プレビュー、PDF エクスポートと印刷、オートレポート
- インポート: テキストファイル（区切り文字形式と固定長）と Excel。エクスポート: テキストファイルと Excel。オブジェクトの切り取り、コピー、貼り付け
- リンクテーブル: 別の BaseCraft ファイルや SQLite ファイルのテーブルをリンク、リンクテーブルマネージャー
- 名前を付けて保存、最適化/修復、`.basecraft` ファイルの関連付け
- リボン、ナビゲーションウィンドウ、タブ、ライトテーマとダークテーマ
- ファイル › オプション: ワークステーションの設定（確認、最近使ったデータベース、起動時に開く前回のデータベース、既定のフォルダー）とデータベースのオプション（メニュー、ショートカットメニュー、特殊キー、ステータスバー、タブ、閉じるときに最適化）

## ロードマップ

| ステージ | 内容 |
|---|---|
| **A — Excel の置き換え** ✅ | テーブル、リレーションと式、クエリ（QBE + SQL）、フォーム、PDF エクスポート付きレポート、CSV/Excel のインポートとエクスポート、インストーラー |
| **B — 自動化と配布** | イベント、マクロ、AutoExec、BaseCraft Runtime（デザイン機能なしでデータベースを実行） |
| **C — 共同作業** | PostgreSQL、SQL Server、SQLite、Access へのリンクテーブル、楽観的ロック、移行ウィザード |
| **D — Python** | VBA の代わりに、BaseCraft のオブジェクトを扱える Python コード（Pyodide） |
| **E — Access のインポート** | `.mdb` / `.accdb` のテーブル、データ、クエリ、フォーム、レポート、マクロ |

予定していないもの: VBA 互換、複数人による同時デザイン、Web 版やモバイル版。

## ダウンロード

Windows、macOS、Linux 向けのプレビュービルドは [Releases ページ](https://github.com/gdsolutions-dev/BaseCraft/releases)にあります。初期のプレビュー版ですので、重要なデータはバックアップを取ってください。

- **Windows:** `BaseCraft-x.y.z-win-x64.exe`（インストーラー）または `.zip`（ポータブル版）。ビルドには SARL IN SET の署名が付いています。証明書が新しいため、しばらくは Windows SmartScreen が警告を表示することがあります。その場合は「詳細情報」を選んでから「実行」を選んでください。
- **macOS（Apple シリコン）:** `BaseCraft-x.y.z-mac-arm64.dmg` または `.zip`。**Mac ではまだテストしていません。** これらのビルドは CI で生成されていますが、誰も実行していません。問題があれば issue で報告してください。公証（notarization）も受けていないため、BaseCraft を「アプリケーション」にコピーした後で、一度 `xattr -dr com.apple.quarantine /Applications/BaseCraft.app` を実行してください。実行しないと、macOS がアプリを「壊れている」と報告します。
- **Linux:** `BaseCraft-x.y.z-linux-amd64.deb`（`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`）、`BaseCraft-x.y.z-linux-x86_64.AppImage`（実行権限を付けてから実行）、または `.tar.gz`。

### BaseCraft Runtime

BaseCraft Runtime は、デザイン機能なしでデータベースを実行します。デザインビューもデザインツールもありません。作成したデータベースを使うだけの人に配布できます。独自のインストーラー `BaseCraft-Runtime-x.y.z-<os>-<arch>` を持つ別製品で、Windows（`.exe` または `.zip`）と Linux（`.deb`、`.AppImage`、`.tar.gz`）向けです。2 つの製品は並べてインストールできます。

- **Windows:** `.basecraft` の関連付けは完全版のアプリケーションが保持します。両方の製品がインストールされている場合、インストールの順序に関係なく、ダブルクリックすると完全版のアプリケーションが開きます。例外として、Runtime が現在のユーザーのみ、完全版がすべてのユーザー向けにインストールされている場合は、Runtime がファイルを開きます。BaseCraft Runtime は「プログラムから開く」（« Ouvrir avec »）の一覧に表示されます。ダブルクリックで `.basecraft` ファイルを開くのは、Runtime だけがインストールされている場合に限られます。完全版をアンインストールして Runtime を残した場合、次にダブルクリックしたときに Windows がどのアプリケーションを使うか尋ねるので、BaseCraft Runtime を選んでください。
- **Linux:** どちらの製品も `application/x-basecraft` を宣言します。既定のアプリケーションはデスクトップ環境が決めます。確認または変更するには、`xdg-mime query default application/x-basecraft` または `xdg-mime default basecraft.desktop application/x-basecraft`（Runtime は `basecraft-runtime.desktop`）を実行します。
- **macOS:** Runtime のビルドはまだありません。完全版の macOS ビルドは署名も公証もされていません（上記参照）。

### マクロ、アクションクエリ、信頼できるフォルダー

開いたデータベース内のマクロとアクションクエリは、セキュリティバーの **コンテンツの有効化**（« Activer le contenu »）をクリックするか、管理者が信頼済みとしたフォルダーにファイルがあるまで、無効のままです。保存済みのアクションクエリを含む、0.3 より前に作成されたデータベースでは、一度だけ確認が表示されます。

管理者は、BaseCraft が読み取るだけのシステムファイルに信頼できるフォルダーを列挙します。

- Windows: `%ProgramData%\BaseCraft\trust.json`
- macOS: `/Library/Application Support/BaseCraft/trust.json`
- Linux: `/etc/basecraft/trust.json`

```json
{ "trustedFolders": [{ "path": "D:\\Bases\\Compta", "subfolders": true }] }
```

このファイルを置くフォルダーは、管理者だけに書き込み権限を付けて作成してください。そうしないと、一般ユーザーが自分のフォルダーを信頼済みにできてしまいます。

## ソースからのビルド

必要なもの: [Node.js](https://nodejs.org/) 24 以降（BaseCraft は組み込みの `node:sqlite` を使用します）。

```sh
npm install
npm run dev        # start the app in development mode
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript checks
npm run e2e        # end-to-end tests (Playwright + Electron)
npm run dist:win   # Windows installer and zip, in dist/ (run on Windows)
npm run dist:linux # Linux .deb, AppImage and tar.gz, in dist/ (run on Linux)
npm run dist:mac   # macOS dmg and zip (arm64), in dist/ (run on macOS)
npm run dist:runtime:win   # BaseCraft Runtime installer and zip, in dist-runtime/ (run on Windows)
npm run dist:runtime:linux # BaseCraft Runtime .deb, AppImage and tar.gz, in dist-runtime/ (run on Linux)
```

スタック: Electron、React、TypeScript、Vite、Glide Data Grid、SQLite。

## ドキュメント

- [UI モックアップ](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## ライセンス

[GNU Affero General Public License v3.0](../../LICENSE)。

Microsoft Access は Microsoft Corporation の商標です。BaseCraft は独立したプロジェクトであり、Microsoft と提携しておらず、Microsoft の承認も受けていません。

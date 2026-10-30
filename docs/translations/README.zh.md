<p align="center"><a href="../../README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.pt.md">Português</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ko.md">한국어</a></p>

<div align="center">

<img src="../logo/png/icone-256.png" alt="BaseCraft" width="128" height="128">

<h1>BaseCraft</h1>

<p><strong>桌面数据库工作台；一款秉承 Microsoft Access 精神的开源应用。</strong><br>
在单个文件中构建表、查询、窗体和报表，而该文件始终是一个普通的 SQLite 数据库。<br>
Windows · macOS · Linux</p>

<p>
<a href="../../LICENSE"><img alt="许可证：AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-EF572C"></a>
<img alt="使用 TypeScript 编写" src="https://img.shields.io/badge/written%20in-TypeScript-364554">
<img alt="运行于 Windows · macOS · Linux" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-EF572C">
<img alt="无需账号，无遥测" src="https://img.shields.io/badge/no%20account-no%20telemetry-364554">
<br>
<a href="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/gdsolutions-dev/BaseCraft/releases"><img alt="最新版本" src="https://img.shields.io/github/v/release/gdsolutions-dev/BaseCraft?include_prereleases&label=release"></a>
</p>

<p><a href="https://gdsolutions-dev.github.io/BaseCraft/"><strong>网站</strong></a> · <a href="https://github.com/gdsolutions-dev/BaseCraft/releases">下载</a> · <a href="https://gdsolutions-dev.github.io/BaseCraft/maquettes/">界面原型</a></p>

<img src="../images/screenshot.png" alt="BaseCraft 报表设计视图，含分组与汇总" width="900">

</div>

BaseCraft 重现了 Access 构建小型数据应用的方式——表、查询、窗体、报表、宏和代码——并配以现代化的界面，且不再受限于 Windows。数据库包含的一切都存放在**单个文件**中，这个文件就是一个普通的 SQLite 数据库，任何 SQLite 工具都能打开。

> **状态：早期开发中。** 阶段 A（表、关系、查询、窗体、报表、导入与导出）已在预览版 0.3.0 中完成。1.0 之前可能出现不兼容的变更。

## 为什么做 BaseCraft

在桌面上管理结构化数据的人，通常最终会面对：

- **Excel**：它并不适合基于窗体的数据录入，也不适合处理关联数据；
- **Access**：能完成任务，但只能在 Windows 上运行，通过网络共享时文件容易损坏。

我们的目标：一位熟练的 Excel 用户，无需编写代码，一个下午就能搭建出小型数据录入应用——关联表、录入窗体、筛选查询、打印的 PDF 报表——并发送给同事。

## 原则

- **熟悉。** 与 Access 相同的对象类别和概念：每个对象都有设计视图和运行视图、QBE 查询网格、数据表、属性表。
- **数据归你所有。** `.basecraft` 文件就是普通的 SQLite 数据库。用户表是真正的 SQLite 表，名称由你决定；BaseCraft 绝不会在架构中放入自定义函数或排序规则。
- **默认安全。** 崩溃后不丢失数据；通过电子邮件收到的文件不会损害你的计算机。
- **单机使用无需安装任何东西。** 无需服务器、Python 或额外的运行时。
- **多语言。** 界面支持 11 种语言（英语、法语、西班牙语、德语、意大利语、葡萄牙语、荷兰语、波兰语、日语、中文、韩语）；表达式以法语或英语显示。

## 目前可用的功能

- 创建和打开 `.basecraft` 文件，带版本化格式和迁移
- 带心跳的写锁定；第二台机器以只读方式打开文件
- 检测网络共享和同步文件夹（OneDrive、Dropbox 等）
- 表：设计视图（字段类型、键、多字段索引、表验证规则、无损更改），数据表中的“表字段”选项卡
- 数据表：录入、排序、筛选、查找、删除、逐行保存
- 字段属性：格式、默认值、验证规则和验证文本、输入掩码、查阅字段
- 带参照完整性和级联的关系窗口；表达式生成器
- 采用 Access 语义的表达式引擎（解析器、求值器、SQLite 生成器）
- 查询：QBE 网格和 SQL 视图，选择、分组、参数及操作查询
- 窗体：设计视图、属性表、控件、单个窗体、连续窗体、数据表、主/子窗体、自动窗体
- 报表：分区设计器、分组与汇总、打印预览、PDF 导出和打印、自动报表
- 导入：文本文件（分隔符和固定宽度）及 Excel；导出：文本文件及 Excel；对象的剪切、复制和粘贴
- 链接表：链接另一个 BaseCraft 文件或 SQLite 文件的表，链接表管理器
- 另存为、压缩和修复；`.basecraft` 文件关联
- 功能区、导航窗格、选项卡、浅色和深色主题
- 文件 › 选项：工作站设置（确认提示、最近使用的数据库、启动时打开上次的数据库、默认文件夹）和数据库选项（菜单、快捷菜单、特殊键、状态栏、选项卡、关闭时压缩）

## 路线图

| 阶段 | 内容 |
|---|---|
| **A — 取代 Excel** ✅ | 表、关系与表达式、查询（QBE + SQL）、窗体、可导出 PDF 的报表、CSV/Excel 导入导出、安装程序 |
| **B — 自动化与分发** | 事件、宏、AutoExec、BaseCraft Runtime（无设计权限地运行数据库） |
| **C — 协同工作** | 链接到 PostgreSQL、SQL Server、SQLite 和 Access 的表；乐观锁定；迁移向导 |
| **D — Python** | 以 Python 代码（Pyodide）取代 VBA，可操作 BaseCraft 对象 |
| **E — 导入 Access** | 从 `.mdb` / `.accdb` 导入表、数据、查询、窗体、报表和宏 |

不在计划内：VBA 兼容、多人同时设计、网页版或移动版。

## 下载

适用于 Windows、macOS 和 Linux 的预览版构建发布在 [Releases 页面](https://github.com/gdsolutions-dev/BaseCraft/releases)。它们只是早期预览版：请备份重要数据。

- **Windows：** `BaseCraft-x.y.z-win-x64.exe`（安装程序）或 `.zip`（便携版）。构建由 SARL IN SET 签名。由于证书是新的，Windows SmartScreen 在一段时间内仍可能发出警告：请选择“更多信息”，然后选择“仍要运行”。
- **macOS（Apple 芯片）：** `BaseCraft-x.y.z-mac-arm64.dmg` 或 `.zip`。**尚未在 Mac 上测试：** 这些构建由 CI 生成，但还没有人运行过；如有任何问题，请在 issues 中反馈。它们也未经公证：将 BaseCraft 复制到“应用程序”后，请运行一次 `xattr -dr com.apple.quarantine /Applications/BaseCraft.app`，否则 macOS 会提示应用已损坏。
- **Linux：** `BaseCraft-x.y.z-linux-amd64.deb`（`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`）、`BaseCraft-x.y.z-linux-x86_64.AppImage`（赋予可执行权限后运行）或 `.tar.gz`。

### BaseCraft Runtime

BaseCraft Runtime 可在没有设计权限的情况下运行数据库：没有设计视图，没有设计工具。你可以把它交给只使用你所建数据库的人。它是一个独立的产品，有自己的安装程序 `BaseCraft-Runtime-x.y.z-<os>-<arch>`，提供 Windows（`.exe` 或 `.zip`）和 Linux（`.deb`、`.AppImage` 或 `.tar.gz`）版本。两个产品可以并排安装。

- **Windows：** 完整应用程序保留 `.basecraft` 的关联：当两个产品都已安装时，无论安装顺序如何，双击都会打开完整应用程序；唯一的例外是：如果 Runtime 仅为当前用户安装，而完整应用程序为所有用户安装，则由 Runtime 打开该文件。BaseCraft Runtime 会列在“打开方式”（« Ouvrir avec »）下。仅当它是唯一安装的产品时，双击才会用它打开 `.basecraft` 文件。如果你卸载了完整应用程序而保留 Runtime，下次双击时 Windows 会询问使用哪个应用程序：请选择 BaseCraft Runtime。
- **Linux：** 两个产品都声明了 `application/x-basecraft`。默认应用由桌面环境决定；要查看或更改它，请运行 `xdg-mime query default application/x-basecraft` 或 `xdg-mime default basecraft.desktop application/x-basecraft`（Runtime 则用 `basecraft-runtime.desktop`）。
- **macOS：** 暂无 Runtime 构建。完整应用程序的 macOS 构建未经签名或公证（见上文）。

### 宏、操作查询与受信任文件夹

在你打开的数据库中，宏和操作查询会被禁用，直到你在安全栏中单击**启用内容**（« Activer le contenu »），或者文件位于管理员已信任的文件夹中。0.3 之前创建、且已保存有操作查询的数据库会询问一次。

管理员在 BaseCraft 只读取的系统文件中列出受信任的文件夹：

- Windows：`%ProgramData%\BaseCraft\trust.json`
- macOS：`/Library/Application Support/BaseCraft/trust.json`
- Linux：`/etc/basecraft/trust.json`

```json
{ "trustedFolders": [{ "path": "D:\\Bases\\Compta", "subfolders": true }] }
```

请将存放此文件的文件夹设为仅管理员可写，否则任何用户都可以信任自己的文件夹。

## 从源代码构建

要求：[Node.js](https://nodejs.org/) 24 或更高版本（BaseCraft 使用内置的 `node:sqlite`）。

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

技术栈：Electron、React、TypeScript、Vite、Glide Data Grid、SQLite。

## 文档

- [界面原型](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## 许可证

[GNU Affero General Public License v3.0](../../LICENSE)。

Microsoft Access 是 Microsoft Corporation 的商标。BaseCraft 是独立项目，与 Microsoft 无关联，也未获其认可。

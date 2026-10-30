<p align="center"><a href="README.md">English</a> · <a href="docs/translations/README.fr.md">Français</a> · <a href="docs/translations/README.es.md">Español</a> · <a href="docs/translations/README.de.md">Deutsch</a> · <a href="docs/translations/README.it.md">Italiano</a> · <a href="docs/translations/README.pt.md">Português</a> · <a href="docs/translations/README.nl.md">Nederlands</a> · <a href="docs/translations/README.pl.md">Polski</a> · <a href="docs/translations/README.ja.md">日本語</a> · <a href="docs/translations/README.zh.md">简体中文</a> · <a href="docs/translations/README.ko.md">한국어</a></p>

<div align="center">

<img src="docs/logo/png/icone-256.png" alt="BaseCraft" width="128" height="128">

<h1>BaseCraft</h1>

<p><strong>The desktop database workbench; an open-source application in the spirit of Microsoft Access.</strong><br>
Build tables, queries, forms and reports in a single file that stays a plain SQLite database.<br>
Windows · macOS · Linux</p>

<p>
<a href="LICENSE"><img alt="license: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-EF572C"></a>
<img alt="written in TypeScript" src="https://img.shields.io/badge/written%20in-TypeScript-364554">
<img alt="runs on Windows · macOS · Linux" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-EF572C">
<img alt="no account, no telemetry" src="https://img.shields.io/badge/no%20account-no%20telemetry-364554">
<br>
<a href="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/gdsolutions-dev/BaseCraft/releases"><img alt="latest release" src="https://img.shields.io/github/v/release/gdsolutions-dev/BaseCraft?include_prereleases&label=release"></a>
</p>

<p><a href="https://gdsolutions-dev.github.io/BaseCraft/"><strong>Website</strong></a> · <a href="https://github.com/gdsolutions-dev/BaseCraft/releases">Download</a> · <a href="https://gdsolutions-dev.github.io/BaseCraft/maquettes/">UI mockups</a></p>

<img src="docs/images/screenshot.png" alt="BaseCraft report Design view with grouping and totals" width="900">

</div>

BaseCraft brings back the Access way of building small data applications — tables, queries, forms, reports, macros and code — with a modern interface, and without being tied to Windows. Everything a database contains lives in **a single file**, which is a plain SQLite database that any SQLite tool can still open.

> **Status: early development.** Stage A (tables, relationships, queries, forms, reports, import and export) is complete in preview 0.3.0. Expect breaking changes before 1.0.

## Why

People who manage structured data on a desktop usually end up with:

- **Excel**, which is not built for form-based data entry or related data;
- **Access**, which does the job but only runs on Windows and is prone to file corruption when shared over a network.

The goal: a good Excel user, without writing code, builds a small data-entry application in an afternoon — related tables, an entry form, a filtered query, a printed PDF report — and sends it to a colleague.

## Principles

- **Familiar.** Same object families and concepts as Access: Design view and run view for every object, QBE query grid, Datasheet, property sheets.
- **Your data stays yours.** A `.basecraft` file is an ordinary SQLite database. User tables are real SQLite tables with the names you chose; BaseCraft never puts custom functions or collations in the schema.
- **Safe by default.** No data loss after a crash; a file received by email cannot harm your machine.
- **Nothing to install for solo use.** No server, no Python, no extra runtime.
- **Multilingual.** Interface in 11 languages (English, French, Spanish, German, Italian, Portuguese, Dutch, Polish, Japanese, Chinese, Korean); expressions are shown in French or English.

## What works today

- Create and open `.basecraft` files, with versioned format and migrations
- Write lock with heartbeat; a second machine opens the file read-only
- Detection of network shares and synced folders (OneDrive, Dropbox…)
- Tables: Design view (field types, keys, multi-field indexes, table validation rule, lossless changes), Table Fields tab from the Datasheet
- Datasheet: entry, sorting, filters, Find, deletion, per-row save
- Field properties: Format, Default Value, Validation Rule and Validation Text, Input Mask, Lookup fields
- Relationships window with referential integrity and cascades; Expression Builder
- Expression engine with Access semantics (parser, evaluator, SQLite generator)
- Queries: QBE grid and SQL view, Select, Group By, Parameter and action queries
- Forms: Design view, Property Sheet, controls, Single Form, Continuous Forms, Datasheet, master/detail subforms, AutoForm
- Reports: band designer, grouping and totals, Print Preview, PDF export and printing, AutoReport
- Import: text files (delimited and fixed width) and Excel; export: text files and Excel; Cut, Copy and Paste of objects
- Linked tables: link the tables of another BaseCraft file or a SQLite file, Linked Table Manager; a linked table opens in Design view read-only, after a warning (as in Access)
- Linked Access databases (`.accdb`, `.mdb`, password-protected ones too): link their tables read-only, refreshed when the file changes
- Split database: Database Tools › Split Database moves the tables to a shared data file; several workstations enter data in it at the same time, with Access's Write Conflict dialog and refresh interval (see [Split database and shared data file](#split-database-and-shared-data-file))
- Save As, Compact and Repair; `.basecraft` file association
- Ribbon, navigation pane, tabs, light and dark themes
- File › Options: workstation settings (confirmations, recent databases, last database at startup, default folder) and database options (menus, shortcut menus, special keys, status bar, tabs, compact on close)

## Roadmap

| Stage | Content |
|---|---|
| **A — Replace Excel** ✅ | Tables, relations and expressions, queries (QBE + SQL), forms, reports with PDF export, CSV/Excel import and export, installers |
| **B — Automate and distribute** | Events, macros, AutoExec, BaseCraft Runtime (run a database without design access) |
| **C — Work together** | Linked tables on PostgreSQL, SQL Server, SQLite and Access; split database and shared data file with optimistic locking; migration wizard |
| **D — Python** | Python code (Pyodide) in place of VBA, with BaseCraft objects |
| **E — Access import** | Tables, data, queries, forms, reports and macros from `.mdb` / `.accdb` |

Not planned: VBA compatibility, concurrent design by several people, a web or mobile version.

## Download

Preview builds for Windows, macOS and Linux are on the [Releases page](https://github.com/gdsolutions-dev/BaseCraft/releases). They are early previews: keep backups of important data.

- **Windows:** `BaseCraft-x.y.z-win-x64.exe` (installer) or `.zip` (portable). The builds are signed by SARL IN SET. As the certificate is new, Windows SmartScreen may still warn you for a while: choose *More info*, then *Run anyway*.
- **macOS (Apple silicon):** `BaseCraft-x.y.z-mac-arm64.dmg` or `.zip`. **Not tested on a Mac yet:** these builds are produced by CI but nobody has run them; please report any problem in the issues. They are not notarized either: after copying BaseCraft to Applications, run `xattr -dr com.apple.quarantine /Applications/BaseCraft.app` once, or macOS reports the app as damaged.
- **Linux:** `BaseCraft-x.y.z-linux-amd64.deb` (`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`), `BaseCraft-x.y.z-linux-x86_64.AppImage` (make it executable, then run it) or `.tar.gz`.

### BaseCraft Runtime

BaseCraft Runtime runs a database without design access: no Design view, no design tools. You can give it to the people who only use your bases. It is a separate product with its own installer, `BaseCraft-Runtime-x.y.z-<os>-<arch>`, for Windows (`.exe` or `.zip`) and Linux (`.deb`, `.AppImage` or `.tar.gz`). The two products can be installed side by side.

- **Windows:** the full application keeps `.basecraft`: when both products are installed, a double-click opens the full application, whatever the install order, with one exception: if the Runtime was installed for the current user only and the full application for all users, the Runtime opens the file. BaseCraft Runtime is listed under *Open with* (« Ouvrir avec »). It opens `.basecraft` files on a double-click only when it is installed alone. If you uninstall the full application and keep the Runtime, Windows asks which application to use at the next double-click: choose BaseCraft Runtime.
- **Linux:** both products declare `application/x-basecraft`. The desktop chooses the default; to see it, or to change it, run `xdg-mime query default application/x-basecraft` or `xdg-mime default basecraft.desktop application/x-basecraft` (`basecraft-runtime.desktop` for the Runtime).
- **macOS:** no Runtime build yet. The macOS builds of the full application are not signed or notarized (see above).

### Macros, action queries and trusted folders

Macros and action queries in a base you open are disabled until you click **Enable Content** (« Activer le contenu ») in the security bar, or until the file is in a folder an administrator has trusted. Bases created before 0.3 that already hold saved action queries ask once.

Administrators list trusted folders in a system file that BaseCraft only reads:

- Windows: `%ProgramData%\BaseCraft\trust.json`
- macOS: `/Library/Application Support/BaseCraft/trust.json`
- Linux: `/etc/basecraft/trust.json`

```json
{ "trustedFolders": [{ "path": "D:\\Bases\\Compta", "subfolders": true }] }
```

Create the folder holding this file with write permission for administrators only, or any user could trust their own folders.

### Split database and shared data file

Database Tools › Split Database (« Fractionner la base de données ») moves the tables of a base to a data file (`<name>_donnees.basecraft`, or `<name>_data.basecraft` in English) and turns the base into a front-end that links to them; a backup of the original is made first. Put the data file on a shared folder, give every workstation the front-end, and several people enter data in the same tables at the same time:

- **Supported: Windows workstations on a Windows share only.** On the Windows server (or PC) that holds the data file, turn off opportunistic locks and leasing once, in PowerShell run as administrator, as for Access databases on a share:

  ```powershell
  Set-SmbServerConfiguration -EnableOplocks $false -EnableLeasing $false
  ```

  This support matrix comes from a concurrent-write spike run on one PC over a virtual network; the validation on two real machines is pending ([checklist](docs/superpowers/plans/2026-10-29-basecraft-c3-validation-manuelle.md)).

- **Not supported:** Samba shares (a NAS, a Linux server). Linux workstations (and macOS ones, while macOS is on hold) open a data file on a network share **read-only**: their SMB client cannot take SQLite's write lock.
- **Size:** 10 to 20 workstations on a local network. Every workstation must run a BaseCraft release that has the shared data file, or a later one: an older release does not know the shared mode and gets no write-conflict check.
- **Paths:** use UNC paths (`\\server\share\Ventes_donnees.basecraft`) rather than mapped drive letters, which differ from one PC to another.
- **No synchronized folder** (OneDrive, Dropbox, Google Drive…): sync tools copy half-written files, so a data file there opens read-only.
- **Structure changes** (a new field, a relation, Compact and Repair) need the data file to yourself: open the data file itself, not a front-end; while others are connected, BaseCraft names them and refuses the change. Entering data, forms, queries and reports work while others are connected.
- **Record locking:** « Aucun » (no locks), as Access's default: when two people change the same record, the second save shows the Write Conflict dialog (Save Record, Copy to Clipboard, Drop Changes). Workstation options (File › Options › Client Settings › Advanced): default open mode, refresh interval (60 s by default), number of update retries and update retry interval.
- **One front-end per workstation with the full application.** BaseCraft (the full application) opens a front-end in place, with its exclusive lock: give each workstation its own copy of the front-end (on its own disk, or its own file on the share). Two people who open the same front-end file with the full application get it the way any base works: the second one reads only, its links to the data file included.
- **BaseCraft Runtime** opens a front-end from a share through a local copy (in its user data folder), copied again when the original changes: only the Runtime does this copy for you. Republish the front-end on the share and each workstation takes the new version at its next opening.

## Build from source

Requirements: [Node.js](https://nodejs.org/) 24 or later (BaseCraft uses the built-in `node:sqlite`).

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

Stack: Electron, React, TypeScript, Vite, Glide Data Grid, SQLite.

## Documentation

- [UI mockups](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## License

[GNU Affero General Public License v3.0](LICENSE).

Microsoft Access is a trademark of Microsoft Corporation. BaseCraft is an independent project, not affiliated with or endorsed by Microsoft.

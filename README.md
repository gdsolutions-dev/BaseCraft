# BaseCraft

[![CI](https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg)](https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml)

**A desktop database application in the spirit of Microsoft Access — for Windows, macOS and Linux.**

BaseCraft brings back the Access way of building small data applications — tables, queries, forms, reports, macros and code — with a modern interface, and without being tied to Windows. Everything a database contains lives in **a single file**, which is a plain SQLite database that any SQLite tool can still open.

> **Status: early development.** Stage A (tables, relationships, queries, forms, reports, import and export) is complete in preview 0.2.0. Expect breaking changes before 1.0.

Website: https://gdsolutions-dev.github.io/BaseCraft/

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
- **Bilingual.** English and French interface, including expressions displayed in the interface language.

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
- Save As, Compact and Repair; `.basecraft` file association
- Ribbon, navigation pane, tabs, light and dark themes

## Roadmap

| Stage | Content |
|---|---|
| **A — Replace Excel** ✅ | Tables, relations and expressions, queries (QBE + SQL), forms, reports with PDF export, CSV/Excel import and export, installers |
| **B — Automate and distribute** | Events, macros, AutoExec, BaseCraft Runtime (run a database without design access) |
| **C — Work together** | Linked tables on PostgreSQL, SQL Server, SQLite and Access; optimistic locking; migration wizard |
| **D — Python** | Python code (Pyodide) in place of VBA, with BaseCraft objects |
| **E — Access import** | Tables, data, queries, forms, reports and macros from `.mdb` / `.accdb` |

Not planned: VBA compatibility, concurrent design by several people, a web or mobile version.

## Download

Preview builds for Windows, macOS and Linux are on the [Releases page](https://github.com/gdsolutions-dev/BaseCraft/releases). They are early previews: keep backups of important data.

- **Windows:** `BaseCraft-x.y.z-win-x64.exe` (installer) or `.zip` (portable). The builds are signed by SARL IN SET. As the certificate is new, Windows SmartScreen may still warn you for a while: choose *More info*, then *Run anyway*.
- **macOS (Apple silicon):** `BaseCraft-x.y.z-mac-arm64.dmg` or `.zip`. The builds are not notarized yet: after copying BaseCraft to Applications, run `xattr -dr com.apple.quarantine /Applications/BaseCraft.app` once, or macOS reports the app as damaged.
- **Linux:** `BaseCraft-x.y.z-linux-amd64.deb` (`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`), `BaseCraft-x.y.z-linux-x86_64.AppImage` (make it executable, then run it) or `.tar.gz`.

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
```

Stack: Electron, React, TypeScript, Vite, Glide Data Grid, SQLite.

## Documentation

- [UI mockups](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## License

[GNU Affero General Public License v3.0](LICENSE).

Microsoft Access is a trademark of Microsoft Corporation. BaseCraft is an independent project, not affiliated with or endorsed by Microsoft.

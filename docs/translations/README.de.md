<p align="center"><a href="../../README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.pt.md">Português</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ko.md">한국어</a></p>

<div align="center">

<img src="../logo/png/icone-256.png" alt="BaseCraft" width="128" height="128">

<h1>BaseCraft</h1>

<p><strong>Die Desktop-Datenbank-Werkbank; eine Open-Source-Anwendung im Geiste von Microsoft Access.</strong><br>
Erstellen Sie Tabellen, Abfragen, Formulare und Berichte in einer einzigen Datei, die eine ganz normale SQLite-Datenbank bleibt.<br>
Windows · macOS · Linux</p>

<p>
<a href="../../LICENSE"><img alt="Lizenz: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-EF572C"></a>
<img alt="geschrieben in TypeScript" src="https://img.shields.io/badge/written%20in-TypeScript-364554">
<img alt="läuft unter Windows · macOS · Linux" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-EF572C">
<img alt="kein Konto, keine Telemetrie" src="https://img.shields.io/badge/no%20account-no%20telemetry-364554">
<br>
<a href="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/gdsolutions-dev/BaseCraft/releases"><img alt="neueste Version" src="https://img.shields.io/github/v/release/gdsolutions-dev/BaseCraft?include_prereleases&label=release"></a>
</p>

<p><a href="https://gdsolutions-dev.github.io/BaseCraft/"><strong>Website</strong></a> · <a href="https://github.com/gdsolutions-dev/BaseCraft/releases">Download</a> · <a href="https://gdsolutions-dev.github.io/BaseCraft/maquettes/">UI-Mockups</a></p>

<img src="../images/screenshot.png" alt="Entwurfsansicht eines BaseCraft-Berichts mit Gruppierung und Summen" width="900">

</div>

BaseCraft bringt die Access-Art, kleine Datenanwendungen zu bauen, zurück – Tabellen, Abfragen, Formulare, Berichte, Makros und Code – mit moderner Oberfläche und ohne Bindung an Windows. Alles, was eine Datenbank enthält, liegt in **einer einzigen Datei**, einer gewöhnlichen SQLite-Datenbank, die sich mit jedem SQLite-Werkzeug weiterhin öffnen lässt.

> **Status: frühe Entwicklung.** Stufe A (Tabellen, Beziehungen, Abfragen, Formulare, Berichte, Import und Export) ist in der Vorschauversion 0.3.0 abgeschlossen. Bis 1.0 sind inkompatible Änderungen zu erwarten.

## Warum

Wer strukturierte Daten am Desktop verwaltet, landet meist bei:

- **Excel**, das weder für formularbasierte Dateneingabe noch für verknüpfte Daten gemacht ist;
- **Access**, das die Aufgabe erfüllt, aber nur unter Windows läuft und bei Freigabe über ein Netzwerk zu Dateibeschädigungen neigt.

Das Ziel: Ein versierter Excel-Anwender baut ohne Programmierung an einem Nachmittag eine kleine Dateneingabe-Anwendung – verknüpfte Tabellen, ein Eingabeformular, eine gefilterte Abfrage, ein gedruckter PDF-Bericht – und schickt sie einem Kollegen.

## Prinzipien

- **Vertraut.** Dieselben Objektfamilien und Konzepte wie in Access: Entwurfsansicht und Ausführungsansicht für jedes Objekt, QBE-Abfrageraster, Datenblatt, Eigenschaftenblätter.
- **Ihre Daten gehören Ihnen.** Eine `.basecraft`-Datei ist eine gewöhnliche SQLite-Datenbank. Benutzertabellen sind echte SQLite-Tabellen mit den von Ihnen gewählten Namen; BaseCraft legt niemals eigene Funktionen oder Sortierfolgen im Schema ab.
- **Standardmäßig sicher.** Kein Datenverlust nach einem Absturz; eine per E-Mail erhaltene Datei kann Ihrem Rechner nicht schaden.
- **Für den Einzelgebrauch nichts zu installieren.** Kein Server, kein Python, keine zusätzliche Laufzeitumgebung.
- **Mehrsprachig.** Oberfläche in 11 Sprachen (Englisch, Französisch, Spanisch, Deutsch, Italienisch, Portugiesisch, Niederländisch, Polnisch, Japanisch, Chinesisch, Koreanisch); Ausdrücke werden auf Französisch oder Englisch angezeigt.

## Was heute funktioniert

- `.basecraft`-Dateien erstellen und öffnen, mit versioniertem Format und Migrationen
- Schreibsperre mit Heartbeat; ein zweiter Rechner öffnet die Datei schreibgeschützt
- Erkennung von Netzwerkfreigaben und synchronisierten Ordnern (OneDrive, Dropbox …)
- Tabellen: Entwurfsansicht (Feldtypen, Schlüssel, Indizes über mehrere Felder, Tabellengültigkeitsregel, verlustfreie Änderungen), Registerkarte „Tabellenfelder“ im Datenblatt
- Datenblatt: Eingabe, Sortierung, Filter, Suchen, Löschen, Speichern pro Zeile
- Feldeigenschaften: Format, Standardwert, Gültigkeitsregel und Gültigkeitsmeldung, Eingabeformat, Nachschlagefelder
- Beziehungsfenster mit referenzieller Integrität und Weitergaben; Ausdrucks-Generator
- Ausdrucksmodul mit Access-Semantik (Parser, Auswerter, SQLite-Generator)
- Abfragen: QBE-Raster und SQL-Ansicht, Auswahl-, Gruppierungs-, Parameter- und Aktionsabfragen
- Formulare: Entwurfsansicht, Eigenschaftenblatt, Steuerelemente, Einzelformular, Endlosformular, Datenblatt, Haupt-/Unterformulare, AutoFormular
- Berichte: Bereichsentwurf, Gruppierung und Summen, Seitenansicht, PDF-Export und Druck, AutoBericht
- Import: Textdateien (getrennt und mit fester Breite) und Excel; Export: Textdateien und Excel; Ausschneiden, Kopieren und Einfügen von Objekten
- Verknüpfte Tabellen: Tabellen einer anderen BaseCraft-Datei oder einer SQLite-Datei verknüpfen, Verknüpfte-Tabellen-Manager
- Speichern unter, Komprimieren und Reparieren; Dateizuordnung für `.basecraft`
- Menüband, Navigationsbereich, Registerkarten, helle und dunkle Designs
- Datei › Optionen: Einstellungen für den Arbeitsplatz (Bestätigungen, zuletzt verwendete Datenbanken, letzte Datenbank beim Start, Standardordner) und Datenbankoptionen (Menüs, Kontextmenüs, Sondertasten, Statusleiste, Registerkarten, Komprimieren beim Schließen)

## Roadmap

| Stufe | Inhalt |
|---|---|
| **A — Excel ersetzen** ✅ | Tabellen, Beziehungen und Ausdrücke, Abfragen (QBE + SQL), Formulare, Berichte mit PDF-Export, CSV-/Excel-Import und -Export, Installationsprogramme |
| **B — Automatisieren und verteilen** | Ereignisse, Makros, AutoExec, BaseCraft Runtime (eine Datenbank ohne Entwurfszugriff ausführen) |
| **C — Zusammenarbeiten** | Verknüpfte Tabellen für PostgreSQL, SQL Server, SQLite und Access; optimistisches Sperren; Migrationsassistent |
| **D — Python** | Python-Code (Pyodide) anstelle von VBA, mit BaseCraft-Objekten |
| **E — Access-Import** | Tabellen, Daten, Abfragen, Formulare, Berichte und Makros aus `.mdb` / `.accdb` |

Nicht geplant: VBA-Kompatibilität, gleichzeitiger Entwurf durch mehrere Personen, eine Web- oder Mobilversion.

## Download

Vorschau-Builds für Windows, macOS und Linux finden Sie auf der [Releases-Seite](https://github.com/gdsolutions-dev/BaseCraft/releases). Es sind frühe Vorschauversionen: Sichern Sie wichtige Daten.

- **Windows:** `BaseCraft-x.y.z-win-x64.exe` (Installationsprogramm) oder `.zip` (portabel). Die Builds sind von SARL IN SET signiert. Da das Zertifikat neu ist, kann Windows SmartScreen noch eine Weile warnen: Wählen Sie *Weitere Informationen* und dann *Trotzdem ausführen*.
- **macOS (Apple Silicon):** `BaseCraft-x.y.z-mac-arm64.dmg` oder `.zip`. **Noch nicht auf einem Mac getestet:** Diese Builds werden von der CI erzeugt, aber noch niemand hat sie ausgeführt; bitte melden Sie Probleme in den Issues. Sie sind außerdem nicht notarisiert: Führen Sie nach dem Kopieren von BaseCraft nach „Programme“ einmal `xattr -dr com.apple.quarantine /Applications/BaseCraft.app` aus, sonst meldet macOS die App als beschädigt.
- **Linux:** `BaseCraft-x.y.z-linux-amd64.deb` (`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`), `BaseCraft-x.y.z-linux-x86_64.AppImage` (ausführbar machen, dann starten) oder `.tar.gz`.

### BaseCraft Runtime

BaseCraft Runtime führt eine Datenbank ohne Entwurfszugriff aus: keine Entwurfsansicht, keine Entwurfswerkzeuge. Sie können es an Personen weitergeben, die Ihre Datenbanken nur benutzen. Es ist ein eigenständiges Produkt mit eigenem Installationsprogramm, `BaseCraft-Runtime-x.y.z-<os>-<arch>`, für Windows (`.exe` oder `.zip`) und Linux (`.deb`, `.AppImage` oder `.tar.gz`). Beide Produkte können nebeneinander installiert werden.

- **Windows:** Die Vollversion behält `.basecraft`: Sind beide Produkte installiert, öffnet ein Doppelklick die Vollversion, unabhängig von der Installationsreihenfolge, mit einer Ausnahme: Wurde die Runtime nur für den aktuellen Benutzer und die Vollversion für alle Benutzer installiert, öffnet die Runtime die Datei. BaseCraft Runtime erscheint unter *Öffnen mit* (« Ouvrir avec »). Sie öffnet `.basecraft`-Dateien per Doppelklick nur, wenn sie allein installiert ist. Wenn Sie die Vollversion deinstallieren und die Runtime behalten, fragt Windows beim nächsten Doppelklick, welche Anwendung verwendet werden soll: Wählen Sie BaseCraft Runtime.
- **Linux:** Beide Produkte deklarieren `application/x-basecraft`. Die Desktop-Umgebung bestimmt den Standard; um ihn anzuzeigen oder zu ändern, führen Sie `xdg-mime query default application/x-basecraft` bzw. `xdg-mime default basecraft.desktop application/x-basecraft` aus (`basecraft-runtime.desktop` für die Runtime).
- **macOS:** Noch kein Runtime-Build. Die macOS-Builds der Vollversion sind nicht signiert oder notarisiert (siehe oben).

### Makros, Aktionsabfragen und vertrauenswürdige Ordner

Makros und Aktionsabfragen in einer geöffneten Datenbank sind deaktiviert, bis Sie in der Sicherheitsleiste auf **Inhalt aktivieren** (« Activer le contenu ») klicken oder bis sich die Datei in einem Ordner befindet, dem ein Administrator vertraut. Vor 0.3 erstellte Datenbanken, die bereits gespeicherte Aktionsabfragen enthalten, fragen einmalig nach.

Administratoren führen vertrauenswürdige Ordner in einer Systemdatei auf, die BaseCraft nur liest:

- Windows: `%ProgramData%\BaseCraft\trust.json`
- macOS: `/Library/Application Support/BaseCraft/trust.json`
- Linux: `/etc/basecraft/trust.json`

```json
{ "trustedFolders": [{ "path": "D:\\Bases\\Compta", "subfolders": true }] }
```

Legen Sie den Ordner, der diese Datei enthält, so an, dass nur Administratoren Schreibrechte haben, sonst könnte jeder Benutzer seinen eigenen Ordnern vertrauen.

## Aus dem Quellcode bauen

Voraussetzungen: [Node.js](https://nodejs.org/) 24 oder neuer (BaseCraft verwendet das integrierte `node:sqlite`).

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

## Dokumentation

- [UI-Mockups](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## Lizenz

[GNU Affero General Public License v3.0](../../LICENSE).

Microsoft Access ist eine Marke der Microsoft Corporation. BaseCraft ist ein unabhängiges Projekt, weder mit Microsoft verbunden noch von Microsoft unterstützt.

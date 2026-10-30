<p align="center"><a href="../../README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.pt.md">Português</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ko.md">한국어</a></p>

<div align="center">

<img src="../logo/png/icone-256.png" alt="BaseCraft" width="128" height="128">

<h1>BaseCraft</h1>

<p><strong>Il banco di lavoro per database desktop; un'applicazione open source nello spirito di Microsoft Access.</strong><br>
Crea tabelle, query, maschere e report in un unico file che resta un semplice database SQLite.<br>
Windows · macOS · Linux</p>

<p>
<a href="../../LICENSE"><img alt="licenza: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-EF572C"></a>
<img alt="scritto in TypeScript" src="https://img.shields.io/badge/written%20in-TypeScript-364554">
<img alt="funziona su Windows · macOS · Linux" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-EF572C">
<img alt="nessun account, nessuna telemetria" src="https://img.shields.io/badge/no%20account-no%20telemetry-364554">
<br>
<a href="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/gdsolutions-dev/BaseCraft/releases"><img alt="ultima versione" src="https://img.shields.io/github/v/release/gdsolutions-dev/BaseCraft?include_prereleases&label=release"></a>
</p>

<p><a href="https://gdsolutions-dev.github.io/BaseCraft/"><strong>Sito web</strong></a> · <a href="https://github.com/gdsolutions-dev/BaseCraft/releases">Download</a> · <a href="https://gdsolutions-dev.github.io/BaseCraft/maquettes/">Mockup dell'interfaccia</a></p>

<img src="../images/screenshot.png" alt="Visualizzazione Struttura di un report BaseCraft con raggruppamenti e totali" width="900">

</div>

BaseCraft riporta il modo di Access di costruire piccole applicazioni di dati — tabelle, query, maschere, report, macro e codice — con un'interfaccia moderna e senza essere legati a Windows. Tutto ciò che un database contiene vive in **un unico file**, un semplice database SQLite che qualsiasi strumento SQLite può ancora aprire.

> **Stato: sviluppo iniziale.** La fase A (tabelle, relazioni, query, maschere, report, importazione ed esportazione) è completa nell'anteprima 0.3.1. Aspettati modifiche incompatibili prima della 1.0.

## Perché

Chi gestisce dati strutturati sul desktop di solito finisce con:

- **Excel**, che non è pensato per l'inserimento dati tramite maschere né per i dati correlati;
- **Access**, che fa il suo lavoro ma funziona solo su Windows ed è soggetto a corruzione del file quando viene condiviso in rete.

L'obiettivo: un buon utente di Excel, senza scrivere codice, costruisce in un pomeriggio una piccola applicazione di inserimento dati — tabelle correlate, una maschera di inserimento, una query filtrata, un report PDF stampato — e la invia a un collega.

## Principi

- **Familiare.** Stesse famiglie di oggetti e stessi concetti di Access: visualizzazione Struttura e visualizzazione di esecuzione per ogni oggetto, griglia di query QBE, Foglio dati, finestre delle proprietà.
- **I tuoi dati restano tuoi.** Un file `.basecraft` è un normale database SQLite. Le tabelle utente sono vere tabelle SQLite con i nomi che hai scelto; BaseCraft non inserisce mai funzioni o collazioni personalizzate nello schema.
- **Sicuro per impostazione predefinita.** Nessuna perdita di dati dopo un arresto anomalo; un file ricevuto via e-mail non può danneggiare il tuo computer.
- **Niente da installare per l'uso singolo.** Nessun server, nessun Python, nessun runtime aggiuntivo.
- **Multilingue.** Interfaccia in 11 lingue (inglese, francese, spagnolo, tedesco, italiano, portoghese, olandese, polacco, giapponese, cinese, coreano); le espressioni sono mostrate in francese o in inglese.

## Cosa funziona oggi

- Creazione e apertura di file `.basecraft`, con formato versionato e migrazioni
- Blocco in scrittura con heartbeat; una seconda macchina apre il file in sola lettura
- Rilevamento delle condivisioni di rete e delle cartelle sincronizzate (OneDrive, Dropbox…)
- Tabelle: visualizzazione Struttura (tipi di campo, chiavi, indici multicampo, regola di convalida della tabella, modifiche senza perdita di dati), scheda Campi tabella dal Foglio dati
- Foglio dati: inserimento, ordinamento, filtri, Trova, eliminazione, salvataggio per riga
- Proprietà dei campi: Formato, Valore predefinito, Regola di convalida e Messaggio di convalida, Maschera di input, campi di ricerca
- Finestra Relazioni con integrità referenziale e propagazioni a catena; Generatore di espressioni
- Motore di espressioni con la semantica di Access (parser, valutatore, generatore SQLite)
- Query: griglia QBE e visualizzazione SQL, query di selezione, di raggruppamento, con parametri e di comando
- Maschere: visualizzazione Struttura, Finestra delle proprietà, controlli, maschera singola, maschere continue, Foglio dati, sottomaschere master/detail, AutoMaschera
- Report: designer a sezioni, raggruppamenti e totali, Anteprima di stampa, esportazione PDF e stampa, AutoReport
- Importazione: file di testo (delimitati e a larghezza fissa) ed Excel; esportazione: file di testo ed Excel; Taglia, Copia e Incolla di oggetti
- Tabelle collegate: collegamento delle tabelle di un altro file BaseCraft o di un file SQLite, Gestione tabelle collegate
- Salva con nome, Compatta e ripristina; associazione dei file `.basecraft`
- Barra multifunzione, riquadro di spostamento, schede, temi chiaro e scuro
- File › Opzioni: impostazioni della postazione (conferme, database recenti, ultimo database all'avvio, cartella predefinita) e opzioni del database (menu, menu di scelta rapida, tasti speciali, barra di stato, schede, compattazione alla chiusura)

## Roadmap

| Fase | Contenuto |
|---|---|
| **A — Sostituire Excel** ✅ | Tabelle, relazioni ed espressioni, query (QBE + SQL), maschere, report con esportazione PDF, importazione ed esportazione CSV/Excel, programmi di installazione |
| **B — Automatizzare e distribuire** | Eventi, macro, AutoExec, BaseCraft Runtime (eseguire un database senza accesso alla progettazione) |
| **C — Lavorare insieme** | Tabelle collegate su PostgreSQL, SQL Server, SQLite e Access; blocco ottimistico; procedura guidata di migrazione |
| **D — Python** | Codice Python (Pyodide) al posto di VBA, con gli oggetti BaseCraft |
| **E — Importazione da Access** | Tabelle, dati, query, maschere, report e macro da `.mdb` / `.accdb` |

Non previsti: compatibilità con VBA, progettazione simultanea da parte di più persone, una versione web o mobile.

## Download

Le build di anteprima per Windows, macOS e Linux sono nella [pagina delle Release](https://github.com/gdsolutions-dev/BaseCraft/releases). Sono anteprime iniziali: conserva copie di backup dei dati importanti.

- **Windows:** `BaseCraft-x.y.z-win-x64.exe` (programma di installazione) o `.zip` (portatile). Le build sono firmate da SARL IN SET. Poiché il certificato è nuovo, Windows SmartScreen potrebbe ancora avvisarti per un po' di tempo: scegli *Ulteriori informazioni*, poi *Esegui comunque*.
- **macOS (Apple silicon):** `BaseCraft-x.y.z-mac-arm64.dmg` o `.zip`. **Non ancora testato su un Mac:** queste build sono prodotte dalla CI ma nessuno le ha eseguite; segnala qualsiasi problema nelle issue. Inoltre non sono notarizzate: dopo aver copiato BaseCraft in Applicazioni, esegui una volta `xattr -dr com.apple.quarantine /Applications/BaseCraft.app`, altrimenti macOS segnala l'app come danneggiata.
- **Linux:** `BaseCraft-x.y.z-linux-amd64.deb` (`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`), `BaseCraft-x.y.z-linux-x86_64.AppImage` (rendilo eseguibile, poi avvialo) o `.tar.gz`.

### BaseCraft Runtime

BaseCraft Runtime esegue un database senza accesso alla progettazione: nessuna visualizzazione Struttura, nessuno strumento di progettazione. Puoi darlo alle persone che usano soltanto le tue basi di dati. È un prodotto separato con il proprio programma di installazione, `BaseCraft-Runtime-x.y.z-<os>-<arch>`, per Windows (`.exe` o `.zip`) e Linux (`.deb`, `.AppImage` o `.tar.gz`). I due prodotti possono essere installati affiancati.

- **Windows:** l'applicazione completa mantiene `.basecraft`: quando entrambi i prodotti sono installati, un doppio clic apre l'applicazione completa, a prescindere dall'ordine di installazione, con un'eccezione: se il Runtime è stato installato solo per l'utente corrente e l'applicazione completa per tutti gli utenti, il file viene aperto dal Runtime. BaseCraft Runtime è elencato sotto *Apri con* (« Ouvrir avec »). Apre i file `.basecraft` con un doppio clic solo quando è installato da solo. Se disinstalli l'applicazione completa e mantieni il Runtime, Windows chiede quale applicazione usare al doppio clic successivo: scegli BaseCraft Runtime.
- **Linux:** entrambi i prodotti dichiarano `application/x-basecraft`. È il desktop a scegliere quello predefinito; per vederlo, o per cambiarlo, esegui `xdg-mime query default application/x-basecraft` oppure `xdg-mime default basecraft.desktop application/x-basecraft` (`basecraft-runtime.desktop` per il Runtime).
- **macOS:** nessuna build del Runtime per ora. Le build macOS dell'applicazione completa non sono firmate né notarizzate (vedi sopra).

### Macro, query di comando e cartelle attendibili

Le macro e le query di comando di una base di dati che apri sono disattivate finché non fai clic su **Abilita contenuto** (« Activer le contenu ») nella barra di sicurezza, oppure finché il file non si trova in una cartella che un amministratore ha reso attendibile. Le basi create prima della 0.3 che contengono già query di comando salvate lo chiedono una sola volta.

Gli amministratori elencano le cartelle attendibili in un file di sistema che BaseCraft si limita a leggere:

- Windows: `%ProgramData%\BaseCraft\trust.json`
- macOS: `/Library/Application Support/BaseCraft/trust.json`
- Linux: `/etc/basecraft/trust.json`

```json
{ "trustedFolders": [{ "path": "D:\\Bases\\Compta", "subfolders": true }] }
```

Crea la cartella che contiene questo file con permesso di scrittura riservato agli amministratori, altrimenti qualsiasi utente potrebbe rendere attendibili le proprie cartelle.

## Compilare dai sorgenti

Requisiti: [Node.js](https://nodejs.org/) 24 o successivo (BaseCraft usa il modulo integrato `node:sqlite`).

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

## Documentazione

- [Mockup dell'interfaccia](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## Licenza

[GNU Affero General Public License v3.0](../../LICENSE).

Microsoft Access è un marchio di Microsoft Corporation. BaseCraft è un progetto indipendente, non affiliato né approvato da Microsoft.

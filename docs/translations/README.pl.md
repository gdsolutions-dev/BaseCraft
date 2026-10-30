<p align="center"><a href="../../README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.pt.md">Português</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ko.md">한국어</a></p>

<div align="center">

<img src="../logo/png/icone-256.png" alt="BaseCraft" width="128" height="128">

<h1>BaseCraft</h1>

<p><strong>Desktopowe narzędzie do pracy z bazami danych; aplikacja open source w duchu Microsoft Access.</strong><br>
Twórz tabele, kwerendy, formularze i raporty w jednym pliku, który pozostaje zwykłą bazą SQLite.<br>
Windows · macOS · Linux</p>

<p>
<a href="../../LICENSE"><img alt="licencja: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-EF572C"></a>
<img alt="napisane w TypeScript" src="https://img.shields.io/badge/written%20in-TypeScript-364554">
<img alt="działa na Windows · macOS · Linux" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-EF572C">
<img alt="bez konta, bez telemetrii" src="https://img.shields.io/badge/no%20account-no%20telemetry-364554">
<br>
<a href="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/gdsolutions-dev/BaseCraft/releases"><img alt="najnowsze wydanie" src="https://img.shields.io/github/v/release/gdsolutions-dev/BaseCraft?include_prereleases&label=release"></a>
</p>

<p><a href="https://gdsolutions-dev.github.io/BaseCraft/"><strong>Strona internetowa</strong></a> · <a href="https://github.com/gdsolutions-dev/BaseCraft/releases">Pobierz</a> · <a href="https://gdsolutions-dev.github.io/BaseCraft/maquettes/">Makiety interfejsu</a></p>

<img src="../images/screenshot.png" alt="Widok projektu raportu w BaseCraft z grupowaniem i sumami" width="900">

</div>

BaseCraft przywraca sposób budowania małych aplikacji danych znany z Accessa — tabele, kwerendy, formularze, raporty, makra i kod — we współczesnym interfejsie i bez przywiązania do Windows. Wszystko, co zawiera baza danych, mieści się w **jednym pliku**, który jest zwykłą bazą SQLite, nadal możliwą do otwarcia w dowolnym narzędziu SQLite.

> **Status: wczesny etap rozwoju.** Etap A (tabele, relacje, kwerendy, formularze, raporty, import i eksport) jest ukończony w wersji zapoznawczej 0.3.0. Przed wersją 1.0 spodziewaj się zmian łamiących zgodność.

## Dlaczego

Osoby zarządzające danymi strukturalnymi na komputerze zwykle trafiają na:

- **Excela**, który nie jest stworzony do wprowadzania danych przez formularze ani do danych powiązanych;
- **Accessa**, który spełnia swoje zadanie, ale działa tylko w Windows i łatwo ulega uszkodzeniu pliku, gdy jest udostępniany w sieci.

Cel: dobry użytkownik Excela, bez pisania kodu, w jedno popołudnie buduje małą aplikację do wprowadzania danych — powiązane tabele, formularz, filtrowaną kwerendę, raport PDF do wydruku — i wysyła ją koledze.

## Zasady

- **Znajome.** Te same rodziny obiektów i pojęcia co w Accessie: widok projektu i widok uruchomieniowy każdego obiektu, siatka kwerendy QBE, arkusz danych, arkusze właściwości.
- **Twoje dane pozostają twoje.** Plik `.basecraft` to zwykła baza SQLite. Tabele użytkownika to prawdziwe tabele SQLite o wybranych przez ciebie nazwach; BaseCraft nigdy nie umieszcza w schemacie własnych funkcji ani reguł porównywania.
- **Bezpieczne domyślnie.** Brak utraty danych po awarii; plik otrzymany e-mailem nie może zaszkodzić twojemu komputerowi.
- **Nic do instalowania przy pracy indywidualnej.** Bez serwera, bez Pythona, bez dodatkowego środowiska uruchomieniowego.
- **Wielojęzyczne.** Interfejs w 11 językach (angielski, francuski, hiszpański, niemiecki, włoski, portugalski, niderlandzki, polski, japoński, chiński, koreański); wyrażenia są wyświetlane po francusku lub angielsku.

## Co działa dziś

- Tworzenie i otwieranie plików `.basecraft`, z wersjonowanym formatem i migracjami
- Blokada zapisu z sygnałem aktywności; drugi komputer otwiera plik tylko do odczytu
- Wykrywanie udziałów sieciowych i folderów synchronizowanych (OneDrive, Dropbox…)
- Tabele: widok projektu (typy pól, klucze, indeksy wielopolowe, reguła poprawności tabeli, zmiany bez utraty danych), karta Pola tabeli w arkuszu danych
- Arkusz danych: wprowadzanie, sortowanie, filtry, Znajdź, usuwanie, zapis dla każdego wiersza
- Właściwości pól: Format, Wartość domyślna, Reguła poprawności i Komunikat o naruszeniu reguły, Maska wprowadzania, Pola odnośników
- Okno relacji z więzami integralności i kaskadami; Konstruktor wyrażeń
- Silnik wyrażeń z semantyką Accessa (parser, interpreter, generator SQLite)
- Kwerendy: siatka QBE i widok SQL, kwerendy wybierające, grupujące, z parametrami i kwerendy funkcjonalne
- Formularze: widok projektu, Arkusz właściwości, kontrolki, formularz pojedynczy, formularze ciągłe, arkusz danych, podformularze nadrzędny/podrzędny, AutoFormularz
- Raporty: projektant sekcji, grupowanie i sumy, Podgląd wydruku, eksport do PDF i drukowanie, AutoRaport
- Import: pliki tekstowe (rozdzielane i o stałej szerokości) oraz Excel; eksport: pliki tekstowe i Excel; Wytnij, Kopiuj i Wklej obiektów
- Tabele połączone: łącz tabele z innego pliku BaseCraft lub pliku SQLite, Menedżer tabel połączonych
- Zapisz jako, Kompaktuj i napraw; skojarzenie plików `.basecraft`
- Wstążka, okienko nawigacji, karty, motywy jasny i ciemny
- Plik › Opcje: ustawienia stanowiska (potwierdzenia, ostatnio używane bazy, ostatnia baza przy uruchomieniu, folder domyślny) oraz opcje bazy danych (menu, menu kontekstowe, klawisze specjalne, pasek stanu, karty, kompaktowanie przy zamknięciu)

## Plan rozwoju

| Etap | Zawartość |
|---|---|
| **A — Zastąp Excela** ✅ | Tabele, relacje i wyrażenia, kwerendy (QBE + SQL), formularze, raporty z eksportem do PDF, import i eksport CSV/Excel, instalatory |
| **B — Automatyzuj i dystrybuuj** | Zdarzenia, makra, AutoExec, BaseCraft Runtime (uruchamianie bazy bez dostępu do projektowania) |
| **C — Pracuj razem** | Tabele połączone z PostgreSQL, SQL Server, SQLite i Access; blokowanie optymistyczne; kreator migracji |
| **D — Python** | Kod w Pythonie (Pyodide) zamiast VBA, z obiektami BaseCraft |
| **E — Import z Accessa** | Tabele, dane, kwerendy, formularze, raporty i makra z plików `.mdb` / `.accdb` |

Nie planujemy: zgodności z VBA, równoczesnego projektowania przez kilka osób, wersji internetowej ani mobilnej.

## Pobieranie

Wersje zapoznawcze dla Windows, macOS i Linux znajdziesz na [stronie Releases](https://github.com/gdsolutions-dev/BaseCraft/releases). To wczesne wersje zapoznawcze: rób kopie zapasowe ważnych danych.

- **Windows:** `BaseCraft-x.y.z-win-x64.exe` (instalator) lub `.zip` (wersja przenośna). Kompilacje są podpisane przez SARL IN SET. Ponieważ certyfikat jest nowy, Windows SmartScreen może jeszcze przez jakiś czas ostrzegać: wybierz *Więcej informacji*, a następnie *Uruchom mimo to*.
- **macOS (Apple silicon):** `BaseCraft-x.y.z-mac-arm64.dmg` lub `.zip`. **Jeszcze nie testowano na Macu:** te kompilacje powstają w CI, ale nikt ich nie uruchamiał; zgłaszaj wszelkie problemy w zgłoszeniach (issues). Nie są też poddane notaryzacji: po skopiowaniu BaseCraft do Programów uruchom raz `xattr -dr com.apple.quarantine /Applications/BaseCraft.app`, w przeciwnym razie macOS zgłosi, że aplikacja jest uszkodzona.
- **Linux:** `BaseCraft-x.y.z-linux-amd64.deb` (`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`), `BaseCraft-x.y.z-linux-x86_64.AppImage` (nadaj uprawnienie do wykonywania, a potem uruchom) lub `.tar.gz`.

### BaseCraft Runtime

BaseCraft Runtime uruchamia bazę danych bez dostępu do projektowania: bez widoku projektu, bez narzędzi projektowych. Możesz go przekazać osobom, które tylko korzystają z twoich baz. To osobny produkt z własnym instalatorem, `BaseCraft-Runtime-x.y.z-<os>-<arch>`, dla Windows (`.exe` lub `.zip`) i Linuksa (`.deb`, `.AppImage` lub `.tar.gz`). Oba produkty można zainstalować obok siebie.

- **Windows:** pełna aplikacja zachowuje skojarzenie `.basecraft`: gdy zainstalowane są oba produkty, dwukrotne kliknięcie otwiera pełną aplikację, niezależnie od kolejności instalacji, z jednym wyjątkiem: jeśli Runtime zainstalowano tylko dla bieżącego użytkownika, a pełną aplikację dla wszystkich użytkowników, plik otworzy Runtime. BaseCraft Runtime jest widoczny na liście *Otwórz za pomocą* (« Ouvrir avec » w wersji francuskiej). Otwiera pliki `.basecraft` dwukrotnym kliknięciem tylko wtedy, gdy jest zainstalowany samodzielnie. Jeśli odinstalujesz pełną aplikację i zachowasz Runtime, przy następnym dwukrotnym kliknięciu Windows zapyta, której aplikacji użyć: wybierz BaseCraft Runtime.
- **Linux:** oba produkty deklarują `application/x-basecraft`. Domyślną aplikację wybiera środowisko graficzne; aby ją sprawdzić lub zmienić, uruchom `xdg-mime query default application/x-basecraft` albo `xdg-mime default basecraft.desktop application/x-basecraft` (`basecraft-runtime.desktop` dla Runtime).
- **macOS:** na razie bez kompilacji Runtime. Kompilacje pełnej aplikacji dla macOS nie są podpisane ani poddane notaryzacji (patrz wyżej).

### Makra, kwerendy funkcjonalne i foldery zaufane

Makra i kwerendy funkcjonalne w otwieranej bazie są wyłączone, dopóki nie klikniesz **Włącz zawartość** (« Activer le contenu ») na pasku zabezpieczeń lub dopóki plik nie znajdzie się w folderze, który administrator uznał za zaufany. Bazy utworzone przed wersją 0.3, które zawierają już zapisane kwerendy funkcjonalne, zapytają o to jednorazowo.

Administratorzy wymieniają foldery zaufane w pliku systemowym, który BaseCraft jedynie odczytuje:

- Windows: `%ProgramData%\BaseCraft\trust.json`
- macOS: `/Library/Application Support/BaseCraft/trust.json`
- Linux: `/etc/basecraft/trust.json`

```json
{ "trustedFolders": [{ "path": "D:\\Bases\\Compta", "subfolders": true }] }
```

Folder z tym plikiem utwórz z uprawnieniem do zapisu wyłącznie dla administratorów, w przeciwnym razie każdy użytkownik mógłby uznać własne foldery za zaufane.

## Budowanie ze źródeł

Wymagania: [Node.js](https://nodejs.org/) 24 lub nowszy (BaseCraft korzysta z wbudowanego `node:sqlite`).

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

Stos technologiczny: Electron, React, TypeScript, Vite, Glide Data Grid, SQLite.

## Dokumentacja

- [Makiety interfejsu](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## Licencja

[GNU Affero General Public License v3.0](../../LICENSE).

Microsoft Access jest znakiem towarowym Microsoft Corporation. BaseCraft jest niezależnym projektem, niepowiązanym z Microsoft ani przez niego niezatwierdzonym.

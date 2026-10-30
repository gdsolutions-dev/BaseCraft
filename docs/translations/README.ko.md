<p align="center"><a href="../../README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.pt.md">Português</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ko.md">한국어</a></p>

<div align="center">

<img src="../logo/png/icone-256.png" alt="BaseCraft" width="128" height="128">

<h1>BaseCraft</h1>

<p><strong>데스크톱 데이터베이스 워크벤치. Microsoft Access의 정신을 잇는 오픈 소스 애플리케이션입니다.</strong><br>
테이블, 쿼리, 폼, 보고서를 하나의 파일에 만들 수 있고, 그 파일은 그대로 일반 SQLite 데이터베이스입니다.<br>
Windows · macOS · Linux</p>

<p>
<a href="../../LICENSE"><img alt="라이선스: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-EF572C"></a>
<img alt="TypeScript로 작성" src="https://img.shields.io/badge/written%20in-TypeScript-364554">
<img alt="Windows · macOS · Linux에서 실행" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-EF572C">
<img alt="계정 불필요, 텔레메트리 없음" src="https://img.shields.io/badge/no%20account-no%20telemetry-364554">
<br>
<a href="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/gdsolutions-dev/BaseCraft/releases"><img alt="최신 릴리스" src="https://img.shields.io/github/v/release/gdsolutions-dev/BaseCraft?include_prereleases&label=release"></a>
</p>

<p><a href="https://gdsolutions-dev.github.io/BaseCraft/"><strong>웹사이트</strong></a> · <a href="https://github.com/gdsolutions-dev/BaseCraft/releases">다운로드</a> · <a href="https://gdsolutions-dev.github.io/BaseCraft/maquettes/">UI 목업</a></p>

<img src="../images/screenshot.png" alt="그룹화와 합계가 있는 BaseCraft 보고서 디자인 보기" width="900">

</div>

BaseCraft는 작은 데이터 애플리케이션을 만드는 Access 방식(테이블, 쿼리, 폼, 보고서, 매크로, 코드)을 현대적인 인터페이스로 되살리며, Windows에 얽매이지 않습니다. 데이터베이스에 담긴 모든 것이 **하나의 파일**에 들어 있고, 그 파일은 어떤 SQLite 도구로도 열 수 있는 일반 SQLite 데이터베이스입니다.

> **상태: 초기 개발 단계.** 1단계 A(테이블, 관계, 쿼리, 폼, 보고서, 가져오기 및 내보내기)는 프리뷰 0.3.0에서 완료되었습니다. 1.0 이전에는 호환성을 깨는 변경이 있을 수 있습니다.

## 왜 BaseCraft인가

데스크톱에서 정형 데이터를 다루는 사람들은 대개 이런 상황에 놓입니다.

- **Excel**은 폼 기반 데이터 입력이나 관계형 데이터를 위해 만들어지지 않았습니다.
- **Access**는 역할을 해내지만 Windows에서만 실행되고, 네트워크로 공유하면 파일이 손상되기 쉽습니다.

목표는 이렇습니다. Excel을 잘 다루는 사람이 코드를 작성하지 않고도 오후 한나절 만에 작은 데이터 입력 애플리케이션(관계가 있는 테이블, 입력 폼, 필터링된 쿼리, 인쇄용 PDF 보고서)을 만들어 동료에게 보낼 수 있어야 합니다.

## 원칙

- **익숙함.** Access와 같은 개체 종류와 개념을 따릅니다. 모든 개체에 디자인 보기와 실행 보기가 있고, QBE 쿼리 그리드, 데이터시트, 속성 시트를 제공합니다.
- **데이터는 당신의 것.** `.basecraft` 파일은 일반 SQLite 데이터베이스입니다. 사용자 테이블은 직접 정한 이름의 실제 SQLite 테이블이며, BaseCraft는 스키마에 사용자 지정 함수나 콜레이션을 넣지 않습니다.
- **기본적으로 안전.** 충돌이 나도 데이터가 손실되지 않으며, 이메일로 받은 파일이 내 컴퓨터를 해칠 수 없습니다.
- **혼자 쓸 때는 설치할 것이 없음.** 서버도, Python도, 추가 런타임도 필요 없습니다.
- **다국어.** 인터페이스는 11개 언어(영어, 프랑스어, 스페인어, 독일어, 이탈리아어, 포르투갈어, 네덜란드어, 폴란드어, 일본어, 중국어, 한국어)를 지원하며, 식은 프랑스어 또는 영어로 표시됩니다.

## 현재 동작하는 기능

- 버전이 관리되는 형식과 마이그레이션을 갖춘 `.basecraft` 파일 만들기 및 열기
- 하트비트가 있는 쓰기 잠금. 두 번째 컴퓨터는 파일을 읽기 전용으로 엽니다
- 네트워크 공유 및 동기화 폴더(OneDrive, Dropbox 등) 감지
- 테이블: 디자인 보기(필드 형식, 키, 다중 필드 인덱스, 테이블 유효성 검사 규칙, 무손실 변경), 데이터시트의 테이블 필드 탭
- 데이터시트: 입력, 정렬, 필터, 찾기, 삭제, 행 단위 저장
- 필드 속성: 형식, 기본값, 유효성 검사 규칙 및 유효성 검사 텍스트, 입력 마스크, 조회 필드
- 참조 무결성과 연쇄 동작을 지원하는 관계 창, 식 작성기
- Access 의미 체계를 따르는 식 엔진(파서, 평가기, SQLite 생성기)
- 쿼리: QBE 그리드와 SQL 보기, 선택, 그룹화, 매개 변수 및 실행 쿼리
- 폼: 디자인 보기, 속성 시트, 컨트롤, 단일 폼, 연속 폼, 데이터시트, 마스터/디테일 하위 폼, 자동 폼
- 보고서: 밴드 디자이너, 그룹화와 합계, 인쇄 미리 보기, PDF 내보내기와 인쇄, 자동 보고서
- 가져오기: 텍스트 파일(구분 기호 및 고정 너비)과 Excel. 내보내기: 텍스트 파일과 Excel. 개체 잘라내기, 복사, 붙여넣기
- 연결 테이블: 다른 BaseCraft 파일이나 SQLite 파일의 테이블 연결, 연결 테이블 관리자
- 다른 이름으로 저장, 압축 및 복구, `.basecraft` 파일 연결
- 리본, 탐색 창, 탭, 밝은 테마와 어두운 테마
- 파일 › 옵션: 워크스테이션 설정(확인 대화 상자, 최근 데이터베이스, 시작 시 마지막 데이터베이스, 기본 폴더)과 데이터베이스 옵션(메뉴, 바로 가기 메뉴, 특수 키, 상태 표시줄, 탭, 닫을 때 압축)

## 로드맵

| 단계 | 내용 |
|---|---|
| **A — Excel 대체** ✅ | 테이블, 관계와 식, 쿼리(QBE + SQL), 폼, PDF 내보내기가 있는 보고서, CSV/Excel 가져오기 및 내보내기, 설치 프로그램 |
| **B — 자동화와 배포** | 이벤트, 매크로, AutoExec, BaseCraft Runtime(디자인 접근 없이 데이터베이스 실행) |
| **C — 함께 작업** | PostgreSQL, SQL Server, SQLite, Access의 연결 테이블, 낙관적 잠금, 마이그레이션 마법사 |
| **D — Python** | VBA 대신 BaseCraft 개체를 다루는 Python 코드(Pyodide) |
| **E — Access 가져오기** | `.mdb` / `.accdb`의 테이블, 데이터, 쿼리, 폼, 보고서, 매크로 |

계획에 없는 것: VBA 호환, 여러 사람의 동시 디자인, 웹 또는 모바일 버전.

## 다운로드

Windows, macOS, Linux용 프리뷰 빌드는 [릴리스 페이지](https://github.com/gdsolutions-dev/BaseCraft/releases)에 있습니다. 초기 프리뷰이므로 중요한 데이터는 백업해 두세요.

- **Windows:** `BaseCraft-x.y.z-win-x64.exe`(설치 프로그램) 또는 `.zip`(휴대용). 빌드는 SARL IN SET이 서명했습니다. 인증서가 새것이라 한동안 Windows SmartScreen이 경고할 수 있습니다. *추가 정보*를 선택한 다음 *실행*을 선택하세요.
- **macOS(Apple silicon):** `BaseCraft-x.y.z-mac-arm64.dmg` 또는 `.zip`. **아직 Mac에서 테스트하지 않았습니다.** 이 빌드는 CI에서 만들어지지만 실제로 실행해 본 사람이 없습니다. 문제가 있으면 이슈로 알려 주세요. 공증(notarization)도 되어 있지 않으므로, BaseCraft를 Applications에 복사한 뒤 `xattr -dr com.apple.quarantine /Applications/BaseCraft.app`을 한 번 실행해야 합니다. 그렇지 않으면 macOS가 앱이 손상되었다고 알립니다.
- **Linux:** `BaseCraft-x.y.z-linux-amd64.deb`(`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`), `BaseCraft-x.y.z-linux-x86_64.AppImage`(실행 권한을 부여한 다음 실행) 또는 `.tar.gz`.

### BaseCraft Runtime

BaseCraft Runtime은 디자인 접근 없이 데이터베이스를 실행합니다. 디자인 보기도 디자인 도구도 없습니다. 만들어 둔 데이터베이스를 사용하기만 하는 사람들에게 배포할 수 있습니다. 별도의 제품이며 전용 설치 프로그램 `BaseCraft-Runtime-x.y.z-<os>-<arch>`가 있고, Windows(`.exe` 또는 `.zip`)와 Linux(`.deb`, `.AppImage` 또는 `.tar.gz`)용으로 제공됩니다. 두 제품은 나란히 설치할 수 있습니다.

- **Windows:** `.basecraft`는 전체 애플리케이션이 유지합니다. 두 제품이 모두 설치되어 있으면 설치 순서와 관계없이 더블 클릭 시 전체 애플리케이션이 열립니다. 한 가지 예외는 Runtime이 현재 사용자 전용으로, 전체 애플리케이션이 모든 사용자용으로 설치된 경우로, 이때는 Runtime이 파일을 엽니다. BaseCraft Runtime은 *연결 프로그램*(« Ouvrir avec ») 목록에 나타납니다. 단독으로 설치된 경우에만 더블 클릭으로 `.basecraft` 파일을 엽니다. 전체 애플리케이션을 제거하고 Runtime만 남기면 다음 더블 클릭 때 Windows가 사용할 애플리케이션을 물으니, BaseCraft Runtime을 선택하세요.
- **Linux:** 두 제품 모두 `application/x-basecraft`를 선언합니다. 기본값은 데스크톱 환경이 정합니다. 확인하거나 바꾸려면 `xdg-mime query default application/x-basecraft` 또는 `xdg-mime default basecraft.desktop application/x-basecraft`(Runtime은 `basecraft-runtime.desktop`)를 실행하세요.
- **macOS:** 아직 Runtime 빌드가 없습니다. 전체 애플리케이션의 macOS 빌드는 서명 및 공증되어 있지 않습니다(위 참조).

### 매크로, 실행 쿼리, 신뢰할 수 있는 폴더

열어 본 데이터베이스의 매크로와 실행 쿼리는 보안 표시줄에서 **콘텐츠 사용**(« Activer le contenu »)을 클릭하기 전까지, 또는 파일이 관리자가 신뢰하도록 지정한 폴더에 있기 전까지 비활성화됩니다. 0.3 이전에 만들어져 저장된 실행 쿼리가 있는 데이터베이스는 한 번 확인을 요청합니다.

관리자는 BaseCraft가 읽기만 하는 시스템 파일에 신뢰할 수 있는 폴더를 나열합니다.

- Windows: `%ProgramData%\BaseCraft\trust.json`
- macOS: `/Library/Application Support/BaseCraft/trust.json`
- Linux: `/etc/basecraft/trust.json`

```json
{ "trustedFolders": [{ "path": "D:\\Bases\\Compta", "subfolders": true }] }
```

이 파일이 있는 폴더는 관리자에게만 쓰기 권한을 주어 만드세요. 그렇지 않으면 모든 사용자가 자기 폴더를 신뢰 대상으로 지정할 수 있습니다.

## 소스에서 빌드

요구 사항: [Node.js](https://nodejs.org/) 24 이상(BaseCraft는 내장 `node:sqlite`를 사용합니다).

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

스택: Electron, React, TypeScript, Vite, Glide Data Grid, SQLite.

## 문서

- [UI 목업](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## 라이선스

[GNU Affero General Public License v3.0](../../LICENSE).

Microsoft Access는 Microsoft Corporation의 상표입니다. BaseCraft는 독립 프로젝트이며 Microsoft와 제휴하거나 Microsoft의 보증을 받은 것이 아닙니다.

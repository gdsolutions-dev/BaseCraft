<p align="center"><a href="../../README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.pt.md">Português</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ko.md">한국어</a></p>

<div align="center">

<img src="../logo/png/icone-256.png" alt="BaseCraft" width="128" height="128">

<h1>BaseCraft</h1>

<p><strong>A bancada de bancos de dados para desktop; um aplicativo de código aberto no espírito do Microsoft Access.</strong><br>
Crie tabelas, consultas, formulários e relatórios em um único arquivo que continua sendo um banco de dados SQLite comum.<br>
Windows · macOS · Linux</p>

<p>
<a href="../../LICENSE"><img alt="licença: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-EF572C"></a>
<img alt="escrito em TypeScript" src="https://img.shields.io/badge/written%20in-TypeScript-364554">
<img alt="roda no Windows · macOS · Linux" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-EF572C">
<img alt="sem conta, sem telemetria" src="https://img.shields.io/badge/no%20account-no%20telemetry-364554">
<br>
<a href="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/gdsolutions-dev/BaseCraft/releases"><img alt="última versão" src="https://img.shields.io/github/v/release/gdsolutions-dev/BaseCraft?include_prereleases&label=release"></a>
</p>

<p><a href="https://gdsolutions-dev.github.io/BaseCraft/"><strong>Site</strong></a> · <a href="https://github.com/gdsolutions-dev/BaseCraft/releases">Download</a> · <a href="https://gdsolutions-dev.github.io/BaseCraft/maquettes/">Protótipos da interface</a></p>

<img src="../images/screenshot.png" alt="Modo Design de um relatório do BaseCraft com agrupamento e totais" width="900">

</div>

O BaseCraft traz de volta o jeito Access de criar pequenos aplicativos de dados — tabelas, consultas, formulários, relatórios, macros e código — com uma interface moderna e sem depender do Windows. Tudo o que um banco de dados contém fica em **um único arquivo**, que é um banco de dados SQLite comum, ainda aberto por qualquer ferramenta SQLite.

> **Status: desenvolvimento inicial.** A etapa A (tabelas, relacionamentos, consultas, formulários, relatórios, importação e exportação) está concluída na prévia 0.2.0. Espere mudanças incompatíveis antes da 1.0.

## Por quê

Quem gerencia dados estruturados no desktop costuma acabar com:

- o **Excel**, que não foi feito para entrada de dados por formulários nem para dados relacionados;
- o **Access**, que resolve, mas só roda no Windows e está sujeito à corrupção de arquivos quando compartilhado em rede.

O objetivo: um bom usuário de Excel, sem escrever código, monta em uma tarde um pequeno aplicativo de entrada de dados — tabelas relacionadas, um formulário de entrada, uma consulta filtrada, um relatório em PDF para impressão — e o envia a um colega.

## Princípios

- **Familiar.** As mesmas famílias de objetos e conceitos do Access: modo Design e modo de execução para cada objeto, grade de consulta QBE, Folha de Dados, folhas de propriedades.
- **Seus dados continuam seus.** Um arquivo `.basecraft` é um banco de dados SQLite comum. As tabelas do usuário são tabelas SQLite reais, com os nomes que você escolheu; o BaseCraft nunca coloca funções ou collations personalizadas no esquema.
- **Seguro por padrão.** Nenhuma perda de dados após uma falha; um arquivo recebido por e-mail não pode prejudicar o seu computador.
- **Nada para instalar no uso individual.** Sem servidor, sem Python, sem runtime adicional.
- **Bilíngue.** Interface em inglês e francês, incluindo expressões exibidas no idioma da interface.

## O que funciona hoje

- Criar e abrir arquivos `.basecraft`, com formato versionado e migrações
- Bloqueio de gravação com heartbeat; uma segunda máquina abre o arquivo somente para leitura
- Detecção de compartilhamentos de rede e pastas sincronizadas (OneDrive, Dropbox…)
- Tabelas: modo Design (tipos de campo, chaves, índices com vários campos, regra de validação da tabela, alterações sem perdas), guia Campos da Tabela a partir da Folha de Dados
- Folha de Dados: entrada, ordenação, filtros, Localizar, exclusão, salvamento por linha
- Propriedades de campo: Formato, Valor Padrão, Regra de Validação e Texto de Validação, Máscara de Entrada, campos de Pesquisa
- Janela Relacionamentos com integridade referencial e cascatas; Construtor de Expressões
- Mecanismo de expressões com a semântica do Access (analisador, avaliador, gerador SQLite)
- Consultas: grade QBE e modo SQL, Seleção, Agrupar Por, consultas de Parâmetro e de ação
- Formulários: modo Design, Folha de Propriedades, controles, Formulário Único, Formulários Contínuos, Folha de Dados, subformulários mestre/detalhe, AutoFormulário
- Relatórios: designer de seções, agrupamento e totais, Visualização de Impressão, exportação para PDF e impressão, AutoRelatório
- Importação: arquivos de texto (delimitados e de largura fixa) e Excel; exportação: arquivos de texto e Excel; Recortar, Copiar e Colar de objetos
- Tabelas vinculadas: vincule as tabelas de outro arquivo BaseCraft ou de um arquivo SQLite, Gerenciador de Tabelas Vinculadas
- Salvar Como, Compactar e Reparar; associação do arquivo `.basecraft`
- Faixa de opções, painel de navegação, guias, temas claro e escuro
- Arquivo › Opções: configurações da estação de trabalho (confirmações, bancos recentes, último banco na inicialização, pasta padrão) e opções do banco de dados (menus, menus de atalho, teclas especiais, barra de status, guias, compactar ao fechar)

## Roteiro

| Etapa | Conteúdo |
|---|---|
| **A — Substituir o Excel** ✅ | Tabelas, relações e expressões, consultas (QBE + SQL), formulários, relatórios com exportação em PDF, importação e exportação de CSV/Excel, instaladores |
| **B — Automatizar e distribuir** | Eventos, macros, AutoExec, BaseCraft Runtime (executar um banco de dados sem acesso ao design) |
| **C — Trabalhar em conjunto** | Tabelas vinculadas em PostgreSQL, SQL Server, SQLite e Access; bloqueio otimista; assistente de migração |
| **D — Python** | Código Python (Pyodide) no lugar do VBA, com objetos do BaseCraft |
| **E — Importação do Access** | Tabelas, dados, consultas, formulários, relatórios e macros de `.mdb` / `.accdb` |

Fora do planejamento: compatibilidade com VBA, design simultâneo por várias pessoas, versão web ou móvel.

## Download

As versões de prévia para Windows, macOS e Linux estão na [página de Releases](https://github.com/gdsolutions-dev/BaseCraft/releases). São prévias iniciais: mantenha backups dos dados importantes.

- **Windows:** `BaseCraft-x.y.z-win-x64.exe` (instalador) ou `.zip` (portátil). As compilações são assinadas pela SARL IN SET. Como o certificado é novo, o Windows SmartScreen ainda pode exibir um aviso por algum tempo: escolha *Mais informações* e depois *Executar assim mesmo*.
- **macOS (Apple silicon):** `BaseCraft-x.y.z-mac-arm64.dmg` ou `.zip`. **Ainda não testado em um Mac:** essas compilações são geradas pela CI, mas ninguém as executou; relate qualquer problema nas issues. Elas também não são notarizadas: depois de copiar o BaseCraft para Aplicativos, execute `xattr -dr com.apple.quarantine /Applications/BaseCraft.app` uma vez, ou o macOS informará que o aplicativo está danificado.
- **Linux:** `BaseCraft-x.y.z-linux-amd64.deb` (`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`), `BaseCraft-x.y.z-linux-x86_64.AppImage` (torne-o executável e depois execute) ou `.tar.gz`.

### BaseCraft Runtime

O BaseCraft Runtime executa um banco de dados sem acesso ao design: sem modo Design, sem ferramentas de design. Você pode entregá-lo a quem apenas usa os seus bancos. É um produto separado, com instalador próprio, `BaseCraft-Runtime-x.y.z-<os>-<arch>`, para Windows (`.exe` ou `.zip`) e Linux (`.deb`, `.AppImage` ou `.tar.gz`). Os dois produtos podem ser instalados lado a lado.

- **Windows:** o aplicativo completo fica com o `.basecraft`: quando os dois produtos estão instalados, um clique duplo abre o aplicativo completo, seja qual for a ordem de instalação, com uma exceção: se o Runtime foi instalado só para o usuário atual e o aplicativo completo para todos os usuários, o Runtime abre o arquivo. O BaseCraft Runtime aparece em *Abrir com* (« Ouvrir avec »). Ele só abre arquivos `.basecraft` com um clique duplo quando está instalado sozinho. Se você desinstalar o aplicativo completo e mantiver o Runtime, o Windows perguntará qual aplicativo usar no próximo clique duplo: escolha BaseCraft Runtime.
- **Linux:** os dois produtos declaram `application/x-basecraft`. O ambiente de desktop escolhe o padrão; para vê-lo ou alterá-lo, execute `xdg-mime query default application/x-basecraft` ou `xdg-mime default basecraft.desktop application/x-basecraft` (`basecraft-runtime.desktop` para o Runtime).
- **macOS:** ainda não há compilação do Runtime. As compilações do aplicativo completo para macOS não são assinadas nem notarizadas (veja acima).

### Macros, consultas de ação e pastas confiáveis

As macros e consultas de ação de um banco que você abre ficam desativadas até que você clique em **Habilitar Conteúdo** (« Activer le contenu ») na barra de segurança, ou até que o arquivo esteja em uma pasta que um administrador tenha marcado como confiável. Bancos criados antes da 0.3 que já contêm consultas de ação salvas perguntam uma vez.

Os administradores listam as pastas confiáveis em um arquivo de sistema que o BaseCraft apenas lê:

- Windows: `%ProgramData%\BaseCraft\trust.json`
- macOS: `/Library/Application Support/BaseCraft/trust.json`
- Linux: `/etc/basecraft/trust.json`

```json
{ "trustedFolders": [{ "path": "D:\\Bases\\Compta", "subfolders": true }] }
```

Crie a pasta que contém esse arquivo com permissão de gravação apenas para administradores; caso contrário, qualquer usuário poderia tornar confiáveis as suas próprias pastas.

## Compilar a partir do código-fonte

Requisitos: [Node.js](https://nodejs.org/) 24 ou posterior (o BaseCraft usa o `node:sqlite` integrado).

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

## Documentação

- [Protótipos da interface](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## Licença

[GNU Affero General Public License v3.0](../../LICENSE).

Microsoft Access é uma marca registrada da Microsoft Corporation. O BaseCraft é um projeto independente, sem afiliação nem endosso da Microsoft.

<p align="center"><a href="../../README.md">English</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.pt.md">Português</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ko.md">한국어</a></p>

<div align="center">

<img src="../logo/png/icone-256.png" alt="BaseCraft" width="128" height="128">

<h1>BaseCraft</h1>

<p><strong>El banco de trabajo de bases de datos de escritorio; una aplicación de código abierto en el espíritu de Microsoft Access.</strong><br>
Crea tablas, consultas, formularios e informes en un único archivo que sigue siendo una base de datos SQLite normal.<br>
Windows · macOS · Linux</p>

<p>
<a href="../../LICENSE"><img alt="licencia: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-EF572C"></a>
<img alt="escrito en TypeScript" src="https://img.shields.io/badge/written%20in-TypeScript-364554">
<img alt="funciona en Windows · macOS · Linux" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux-EF572C">
<img alt="sin cuenta, sin telemetría" src="https://img.shields.io/badge/no%20account-no%20telemetry-364554">
<br>
<a href="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gdsolutions-dev/BaseCraft/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/gdsolutions-dev/BaseCraft/releases"><img alt="última versión" src="https://img.shields.io/github/v/release/gdsolutions-dev/BaseCraft?include_prereleases&label=release"></a>
</p>

<p><a href="https://gdsolutions-dev.github.io/BaseCraft/"><strong>Sitio web</strong></a> · <a href="https://github.com/gdsolutions-dev/BaseCraft/releases">Descargar</a> · <a href="https://gdsolutions-dev.github.io/BaseCraft/maquettes/">Maquetas de la interfaz</a></p>

<img src="../images/screenshot.png" alt="Vista Diseño de un informe de BaseCraft con agrupación y totales" width="900">

</div>

BaseCraft recupera la forma de construir pequeñas aplicaciones de datos al estilo Access (tablas, consultas, formularios, informes, macros y código) con una interfaz moderna y sin depender de Windows. Todo lo que contiene una base de datos vive en **un único archivo**, que es una base de datos SQLite normal que cualquier herramienta SQLite puede seguir abriendo.

> **Estado: desarrollo temprano.** La etapa A (tablas, relaciones, consultas, formularios, informes, importación y exportación) está completa en la versión preliminar 0.3.0. Se esperan cambios incompatibles antes de la 1.0.

## Por qué

Quienes gestionan datos estructurados en el escritorio suelen acabar con:

- **Excel**, que no está pensado para la entrada de datos mediante formularios ni para datos relacionados;
- **Access**, que cumple su función pero solo funciona en Windows y es propenso a la corrupción de archivos cuando se comparte en red.

El objetivo: que un buen usuario de Excel, sin escribir código, construya en una tarde una pequeña aplicación de entrada de datos (tablas relacionadas, un formulario de entrada, una consulta filtrada, un informe en PDF para imprimir) y se la envíe a un compañero.

## Principios

- **Familiar.** Las mismas familias de objetos y conceptos que en Access: vista Diseño y vista de ejecución para cada objeto, cuadrícula de consulta QBE, Hoja de datos, hojas de propiedades.
- **Tus datos siguen siendo tuyos.** Un archivo `.basecraft` es una base de datos SQLite corriente. Las tablas de usuario son tablas SQLite reales con los nombres que elegiste; BaseCraft nunca incluye funciones ni colaciones personalizadas en el esquema.
- **Seguro por defecto.** Sin pérdida de datos tras un fallo; un archivo recibido por correo electrónico no puede dañar tu equipo.
- **Nada que instalar para uso individual.** Sin servidor, sin Python, sin entorno de ejecución adicional.
- **Multilingüe.** Interfaz en 11 idiomas (inglés, francés, español, alemán, italiano, portugués, neerlandés, polaco, japonés, chino, coreano); las expresiones se muestran en francés o en inglés.

## Qué funciona hoy

- Crear y abrir archivos `.basecraft`, con formato versionado y migraciones
- Bloqueo de escritura con latido; un segundo equipo abre el archivo en solo lectura
- Detección de recursos compartidos de red y carpetas sincronizadas (OneDrive, Dropbox…)
- Tablas: vista Diseño (tipos de campo, claves, índices de varios campos, regla de validación de la tabla, cambios sin pérdida), pestaña Campos de tabla desde la Hoja de datos
- Hoja de datos: entrada, ordenación, filtros, Buscar, eliminación, guardado por fila
- Propiedades de campo: Formato, Valor predeterminado, Regla de validación y Texto de validación, Máscara de entrada, campos de búsqueda
- Ventana Relaciones con integridad referencial y cascadas; Generador de expresiones
- Motor de expresiones con la semántica de Access (analizador, evaluador, generador SQLite)
- Consultas: cuadrícula QBE y vista SQL, consultas de selección, de agrupación, con parámetros y de acción
- Formularios: vista Diseño, Hoja de propiedades, controles, Formulario simple, Formularios continuos, Hoja de datos, subformularios maestro/detalle, AutoFormulario
- Informes: diseñador de bandas, agrupación y totales, Vista previa de impresión, exportación a PDF e impresión, AutoInforme
- Importación: archivos de texto (delimitados y de ancho fijo) y Excel; exportación: archivos de texto y Excel; Cortar, Copiar y Pegar objetos
- Tablas vinculadas: vincula las tablas de otro archivo BaseCraft o de un archivo SQLite, Administrador de tablas vinculadas
- Guardar como, Compactar y reparar; asociación de archivos `.basecraft`
- Cinta de opciones, panel de navegación, pestañas, temas claro y oscuro
- Archivo › Opciones: ajustes del equipo (confirmaciones, bases de datos recientes, última base de datos al iniciar, carpeta predeterminada) y opciones de la base de datos (menús, menús contextuales, teclas especiales, barra de estado, pestañas, compactar al cerrar)

## Hoja de ruta

| Etapa | Contenido |
|---|---|
| **A — Sustituir Excel** ✅ | Tablas, relaciones y expresiones, consultas (QBE + SQL), formularios, informes con exportación a PDF, importación y exportación CSV/Excel, instaladores |
| **B — Automatizar y distribuir** | Eventos, macros, AutoExec, BaseCraft Runtime (ejecutar una base de datos sin acceso al diseño) |
| **C — Trabajar en equipo** | Tablas vinculadas en PostgreSQL, SQL Server, SQLite y Access; bloqueo optimista; asistente de migración |
| **D — Python** | Código Python (Pyodide) en lugar de VBA, con objetos de BaseCraft |
| **E — Importación de Access** | Tablas, datos, consultas, formularios, informes y macros desde `.mdb` / `.accdb` |

No previsto: compatibilidad con VBA, diseño simultáneo por varias personas, una versión web o móvil.

## Descarga

Las compilaciones preliminares para Windows, macOS y Linux están en la [página de Releases](https://github.com/gdsolutions-dev/BaseCraft/releases). Son versiones preliminares tempranas: conserva copias de seguridad de los datos importantes.

- **Windows:** `BaseCraft-x.y.z-win-x64.exe` (instalador) o `.zip` (portátil). Las compilaciones están firmadas por SARL IN SET. Como el certificado es nuevo, es posible que Windows SmartScreen siga mostrando una advertencia durante un tiempo: elige *Más información* y después *Ejecutar de todas formas*.
- **macOS (Apple silicon):** `BaseCraft-x.y.z-mac-arm64.dmg` o `.zip`. **Aún no probado en un Mac:** estas compilaciones las genera la CI pero nadie las ha ejecutado; informa de cualquier problema en las issues. Tampoco están notarizadas: tras copiar BaseCraft a Aplicaciones, ejecuta una vez `xattr -dr com.apple.quarantine /Applications/BaseCraft.app`, o macOS indicará que la aplicación está dañada.
- **Linux:** `BaseCraft-x.y.z-linux-amd64.deb` (`sudo apt install ./BaseCraft-x.y.z-linux-amd64.deb`), `BaseCraft-x.y.z-linux-x86_64.AppImage` (hazlo ejecutable y ejecútalo) o `.tar.gz`.

### BaseCraft Runtime

BaseCraft Runtime ejecuta una base de datos sin acceso al diseño: sin vista Diseño ni herramientas de diseño. Puedes dárselo a quienes solo utilizan tus bases. Es un producto independiente con su propio instalador, `BaseCraft-Runtime-x.y.z-<os>-<arch>`, para Windows (`.exe` o `.zip`) y Linux (`.deb`, `.AppImage` o `.tar.gz`). Ambos productos pueden instalarse en paralelo.

- **Windows:** la aplicación completa conserva `.basecraft`: cuando ambos productos están instalados, un doble clic abre la aplicación completa, sea cual sea el orden de instalación, con una excepción: si el Runtime se instaló solo para el usuario actual y la aplicación completa para todos los usuarios, el Runtime abre el archivo. BaseCraft Runtime aparece en *Abrir con* (« Ouvrir avec »). Solo abre archivos `.basecraft` con doble clic cuando está instalado solo. Si desinstalas la aplicación completa y conservas el Runtime, Windows preguntará qué aplicación usar en el siguiente doble clic: elige BaseCraft Runtime.
- **Linux:** ambos productos declaran `application/x-basecraft`. El escritorio elige el predeterminado; para verlo o cambiarlo, ejecuta `xdg-mime query default application/x-basecraft` o `xdg-mime default basecraft.desktop application/x-basecraft` (`basecraft-runtime.desktop` para el Runtime).
- **macOS:** aún no hay compilación del Runtime. Las compilaciones de macOS de la aplicación completa no están firmadas ni notarizadas (ver arriba).

### Macros, consultas de acción y carpetas de confianza

Las macros y consultas de acción de una base que abres están desactivadas hasta que hagas clic en **Habilitar contenido** (« Activer le contenu ») en la barra de seguridad, o hasta que el archivo esté en una carpeta que un administrador haya marcado como de confianza. Las bases creadas antes de la 0.3 que ya contienen consultas de acción guardadas preguntan una vez.

Los administradores enumeran las carpetas de confianza en un archivo de sistema que BaseCraft solo lee:

- Windows: `%ProgramData%\BaseCraft\trust.json`
- macOS: `/Library/Application Support/BaseCraft/trust.json`
- Linux: `/etc/basecraft/trust.json`

```json
{ "trustedFolders": [{ "path": "D:\\Bases\\Compta", "subfolders": true }] }
```

Crea la carpeta que contiene este archivo con permiso de escritura solo para administradores; de lo contrario, cualquier usuario podría marcar como de confianza sus propias carpetas.

## Compilar desde el código fuente

Requisitos: [Node.js](https://nodejs.org/) 24 o posterior (BaseCraft usa el módulo integrado `node:sqlite`).

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

## Documentación

- [Maquetas de la interfaz](https://gdsolutions-dev.github.io/BaseCraft/maquettes/)

## Licencia

[GNU Affero General Public License v3.0](../../LICENSE).

Microsoft Access es una marca registrada de Microsoft Corporation. BaseCraft es un proyecto independiente, sin afiliación ni respaldo de Microsoft.

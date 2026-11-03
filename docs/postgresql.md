# PostgreSQL linked tables

BaseCraft links tables from a PostgreSQL server the way Access links ODBC tables. The links appear in the Navigation Pane, and queries on them run on the server. The server checks and stores every write. To move the local tables of an application to PostgreSQL, see [Move an application to a server](server-migration.md).

## Requirements

- **PostgreSQL 14 or later.** BaseCraft refuses to connect to an older server.
- **A login with `SELECT`, `INSERT`, `UPDATE` and `DELETE`** on the linked tables, plus `USAGE` on their schemas. BaseCraft lists only the tables this login can read. Each user enters their own login the first time they connect. BaseCraft never writes the password into the front-end. If you tick « Mémoriser le mot de passe » (ticked by default), it is encrypted with the operating system's protection (Electron's safeStorage: DPAPI on Windows, the desktop keyring on Linux) and kept in `credentials.json` in BaseCraft's user data folder, for the link's TLS mode: after a change of mode, the password is asked once more. On Linux without a keyring (no GNOME Keyring or KWallet), BaseCraft never stores it: « Mémoriser » is disabled and the password is asked at each session.
- **A primary key** on each table you want to edit. A view or a table without a primary key opens read-only, as in Access when no unique index is chosen.

## TLS

| Mode | Behaviour |
|---|---|
| `verify-full` (default) | Encrypted. The server's certificate must be trusted by the workstation (Node's CAs or the system store), and the host name must match it. Otherwise the link reports a certificate problem. |
| `require` | Encrypted, but the certificate is not checked. |
| `disable` | Not encrypted. Use it only on a trusted network. |

Each session sets `application_name = 'BaseCraft'` and the workstation's time zone. If the server does not know the zone name, BaseCraft sends the current UTC offset instead. In that case, wall-clock times can be off by an hour across a daylight-saving change. Each session also sets `statement_timeout` to the link's timeout (60 s by default; 0 means none). A statement that runs longer is stopped and reported as a timeout.

## Types

| PostgreSQL | BaseCraft |
|---|---|
| `int2`, `int4` | Number (Integer, Long Integer) |
| `serial` or identity | AutoNumber (an `int8` above 2^53 shows rounded) |
| `int8` | Number Decimal(19, 0), exact (BigInt support) |
| `float4`, `float8` | Single, Double |
| `numeric(p, s)`, p ≤ 28 | Decimal(p, s) |
| `numeric` without precision, or p > 28 | Decimal(28, 6), rounded to 6 places |
| `bool` | Yes/No |
| `varchar(n)`, `char(n)`, n ≤ 255 | Short Text (n) |
| `text`, longer `varchar`, `citext`, enums, `json`, `jsonb` | Long Text |
| `uuid` | Short Text (36) |
| `date`, `timestamp` | Date/Time (Date/Time Extended support). Fractional seconds are not shown. |
| `timestamptz` | Date/Time, the wall clock in the workstation's zone |
| `time` | Date/Time on 1899-12-30, as Access |
| `money`, `interval`, `bytea`, arrays, geometry, ranges, `xml`, others | skipped and listed in the link dialog |

A date outside 0100-01-01 … 9999-12-31, `infinity` or a BC date reads as Null.

## Queries on the server: the closed list

BaseCraft translates a query on linked PostgreSQL tables into one PostgreSQL statement. Every value is sent as a parameter. Anything outside the list below is refused before a statement is sent. The message names the function or the query shape.

**Operators:** `=` `<>` `<` `<=` `>` `>=` (text compared without case, accents kept), `&`, `+` `-` `*` `/` `^` `\` `Mod`, `And` `Or` `Not` `Xor`, `Like` (`*` `?` `#` `[…]` `[!…]`), `Between`, `In`, `Is Null`, subqueries (`(SELECT …)`, `Exists`, `In (SELECT …)`).

**Functions translated:** `IIf`, `Nz`, `IsNull`, `CBool`, `Len`, `Left`, `Right`, `Mid`, `Trim`, `LTrim`, `RTrim`, `UCase`, `LCase`, `InStr`, `Replace`, `Space`, `String`, `Round` (banker's rounding), `Int`, `Fix`, `Abs`, `Sgn`, `Sqr`, `CInt`, `CLng`, `CDbl`, `CCur`, `Date`, `Time`, `Now` (the workstation's clock), `Year`, `Month`, `Day`, `Hour`, `Minute`, `Second`, `Weekday`, `DateAdd`, `DateDiff`, `DatePart`, `DateSerial`, `TimeSerial`, and the aggregates `Count`, `Sum`, `Avg`, `Min`, `Max`, `StDev`, `StDevP`, `Var`, `VarP`.

**Functions refused:** `Format`, `Val`, `CStr`, `CDate`, `IsNumeric`, `IsDate`, `StrComp` (they depend on regional settings), `First`, `Last` (a server has no row order to take them by).

**Query shapes:** SELECT with inner and outer joins, WHERE, GROUP BY / HAVING, ORDER BY, DISTINCT, UNION [ALL], subqueries, parameters, and `TOP n` (ties kept, as Access). These are refused: `TOP n PERCENT`, Make-Table queries (create the table on the server, then fill it with an Append query).

**Action queries:** Append (`INSERT … VALUES`, `INSERT … SELECT`), Update and Delete run on the server in one transaction, every row through the table's rules as on a local table. A row a rule refuses is counted by cause and skipped only when you choose to run the query anyway; a row the server itself refuses (a duplicate key, a missing parent record) cancels the whole query, nothing written, even when you run it anyway. A Delete that related records refuse deletes nothing. An Append that gives the values of an AutoNumber field is refused before anything is sent: remove that field from the query, the server numbers the new records. If the connection is lost while the query runs, whether it completed is unknown: check the table before running it again.

**Crosstab queries** run on the server: the column headings are read there first, then merged as Access compares text (« Lyon » and « LYON » make one column, accents count). Their order follows the server's collation, which may differ from Access's. A column heading with more than 254 values on the server (counted before they are merged) is refused.

**Tables made by the migration wizard** keep BaseCraft's own field properties on their link (caption, format, input mask, validation rules, lookups, the local type where the server stores another), and BaseCraft enforces those rules on every write it makes. Other programs that write to the server bypass them. See [Move an application to a server](server-migration.md#basecrafts-properties-travel-with-the-link).

**Data entry through a query on several tables** (orders joined to their customers, as on local tables): a save writes the order's row as its own table's datasheet does, then the customer's row it joins, found by the join fields (compared as the query compares them: text without case), locked until the save ends, and updated, all in one server transaction. AutoLookup fills the customer's fields from the key typed in the order, read on the server. Nothing is saved, not even the order, when the customer's row is missing or found twice, when the server refuses a value, or when another user changed the customer since it was read; that conflict is found by comparing the customer's fields with the values read (except Single, Double and Long Text fields), whatever the table's own conflict check. If the row of a « one » table does not exist (the order's Client matches no customer), the customer's fields cannot be edited and the save is refused (« Aucun enregistrement correspondant n'existe dans la table liée… », `noParent`). If it is found twice, its fields are read-only (`readOnly`). A query is editable only when every table it writes has a primary key.

A query that uses a refused function stays usable on local tables only.

## Differences from Access

A cross-test suite runs the same expressions on BaseCraft's evaluator, on SQLite (local tables) and on a real PostgreSQL server. Each difference below is a case in that suite (`src/main/connectors/postgres/cross.test.ts`, `PG_DISCREPANCIES`), which checks that it still holds.

- Refused on PostgreSQL (bc:serverFunction): outside the closed list
- Refused on PostgreSQL (bc:serverFunction): an operator or a comparison does not mix text with numbers or dates. For example, comparing a text with a number or a date, a text used as a condition, or arithmetic on text.
- Refused on PostgreSQL (bc:serverFunction): & takes text, Null, an AutoNumber or an integer literal. Access's `&` formats other numbers and dates with regional settings.
- A division by zero ends the PostgreSQL query (Access: an error in that cell)
- PostgreSQL computes a constant expression once for the whole query: 1 / 0 in IIf fails every row
- Sqr of a negative number ends the PostgreSQL query (Access: an error in that cell)
- Nz(v) without a default gives 0 or a zero-length text by type on PostgreSQL (BaseCraft locally: Empty, shown as Null)
- Replace is case-sensitive on PostgreSQL (Access compares text without case)
- A date with fractional seconds is shown truncated to the second on PostgreSQL (Access rounds it)
- DateDiff with "w" or "ww" and DatePart with "ww" are refused on PostgreSQL (bc:serverFunction)
- Space and String of a negative count give a zero-length text on PostgreSQL (Access: an error)
- GROUP BY, DISTINCT and UNION group text case-sensitively on PostgreSQL ("Lyon" and "LYON" are two groups; Access: one)
- Refused on PostgreSQL (bc:serverFunction): a Like pattern read from a field (a literal or a parameter is translated)
- Text comparisons ignore case through `lower()`, so the server does not use an index on that column for them.
- Case folding follows the server's character classification. On a server whose `LC_CTYPE` is `C` (libc provider), `lower()` and `ILIKE` do not fold accented capitals such as `É`: there, "ÉTÉ" and "été" are not equal and `Like "É*"` does not match "été". A server created with a UTF-8 locale (such as `en_US.UTF-8`) or an ICU default collation folds them as Access does.
- Text sorts use the server's `fr-x-icu` collation when it has one, else `und-x-icu`, else the column's own collation.

## Pass-through queries

A pass-through query is written in PostgreSQL's own SQL and sent to the server exactly as typed. BaseCraft never reads, rewrites or wraps the text, so any function of the server works (`string_agg`, window functions, `generate_series`, your own functions). Create one with Create › Query Design, then Query Type › « SQL direct ». It opens in SQL view only (no grid, no Design view).

**Properties** (Property Sheet):

- **Connexion**: the servers of the front-end's links, one entry per host, port, database, TLS mode and user, or « Autre serveur PostgreSQL… » (« Autre serveur SQL Server… » for a SQL Server, see [docs/sqlserver.md](sqlserver.md#pass-through-queries)) for any other server. The query keeps the connection, not the password. A pass-through needs no linked table. Its login is the one of the server: a link and a pass-through to the same server share one password prompt.
- **Renvoie des enregistrements**: Oui for a query that returns rows (`SELECT`, or `INSERT … RETURNING`), Non for one that only acts (`UPDATE`, `DELETE`, a function call).
- **Délai d'attente ODBC**: seconds the server may take, from 0 to 3600; 0 means no limit; 60 by default (Access's default). A longer statement is stopped and reported as a timeout that names this property.

**What is sent.** The text goes through PostgreSQL's simple query protocol: several statements separated by `;` all run (as one implicit transaction unless the text has its own `BEGIN` and `COMMIT`), and no parameter is ever bound: `[Ville ?]` or `$1` are the server's to refuse. Each run opens its own connection and closes it afterwards, so a `SET`, a `BEGIN` without `COMMIT` or a temporary table in the text never reaches your linked tables or the next run; the server rolls back an open transaction when the connection closes.

**Results are a snapshot.** A query that returns records shows as a read-only datasheet and can be the record source of a form or a report. BaseCraft takes the whole result into memory once and sorts, filters and counts it there, with Access's rules, without asking the server again. The text runs again when you open the query, form or report and when you Requery (Shift+F9), once per opening, not when you scroll, sort or filter. An export writes the result the window already holds (from an opening, even if its tab is now closed) without running the text again; it runs the text only when the window holds none. The whole result is held in memory: put the filter or the grouping in the SQL text, and do not return millions of rows.

**Column types.** `bool`, `int2`, `int4`, `int8`, `float4`, `float8`, `numeric`, `text`, `varchar`, `char`, `uuid`, `json`, `jsonb`, `date`, `time`, `timestamp` and `timestamptz` map as in the Types table above. Every other type (`money`, `interval`, arrays, `bytea`, enums, `citext`…) is never skipped: it shows as Long Text, in the server's text form. A column BaseCraft cannot name as given (empty, repeated such as two `?column?`, `rowid`, invalid) is called `Expr1000`, `Expr1001`… as Access names unnamed result columns. Give columns an alias (`AS "Total"`) to choose their names.

**Returns Records = Non.** The query runs at once, with no question (the number of rows it will change is not known beforehand), from the Navigation Pane, Design view's Run or a macro's OpenQuery. It also runs on a read-only front-end and in the Runtime, since it changes the server, not the file. Open datasheets read again afterwards.

**Disabled mode.** A pass-through with Returns Records = Non is an action: it is blocked while the database is in disabled mode (« Cette requête action est bloquée… ») and runs after « Activer le contenu » or from a trusted folder. A pass-through with Returns Records = Oui is **not** blocked: it opens in disabled mode, and so does a report or form built on it. Be aware that such a query can still write on the server (`UPDATE … RETURNING`, a function with side effects). Give the PostgreSQL login of people who open files you do not trust only the rights they need: the server, not BaseCraft, decides what a query may change, and the validation rules and relationships of BaseCraft do not apply to what a pass-through changes.

**A remembered password needs a file you trust.** In a file you have not trusted (its content not enabled with « Activer le contenu », and not in a trusted folder), a pass-through asks the password even if it was remembered (« Mémoriser »): a file you receive cannot run its server text with your saved password without you typing it. A file with no active content at all counts as not trusted, since a file holding only pass-throughs that return records shows no security bar: its pass-throughs ask the password in each session until the file is in a trusted folder or has content you enabled. The login prompt then says that the file is not trusted. The password typed is used until the database closes, or until a Stop has to restart the data process, after which it is asked again. Linked tables are not concerned: they keep using the remembered password.

The approval covers the pass-throughs too: every pass-through definition is part of the content « Activer le contenu » approves, even one that returns records and shows no security bar. A copy of an approved file with a pass-through added or changed is therefore not approved: its content is disabled again and its pass-throughs ask the password. Authoring active content yourself (a macro, an action query, an event procedure of a form or report) in a file that shows no security bar approves the file: from then on its pass-throughs use the remembered password, in this session and the next ones. Do that only in a file whose pass-throughs you have read.

**A pass-through is never the source of another query.** A query, a lookup's Row Source (a table field's, or a form's combo box or list box), or a SQL record source that names a pass-through is refused with « La requête SQL direct … ne peut pas servir de source… » (Access allows it). Put the filter or the grouping in the text of the pass-through. Query Design's Show Table does not list pass-throughs.

**Errors.** The server's own message is shown (« Le serveur a refusé l'opération : … »). A timeout names « Délai d'attente ODBC ». Stop cancels the statement on the server and BaseCraft stays usable. If the connection is lost during a run, BaseCraft says that it does not know whether the text ran, and never sends it again by itself. Returns Records = Oui with a text that returns no result set (for example an `UPDATE` without `RETURNING`) reports that no records came back.

## Known limitations

- **A save that loses its connection.** If the connection to the server drops while a record is being saved (a network cut, a server restart), BaseCraft cannot know whether the server stored it. It says so (« La connexion au serveur a été perdue pendant l'enregistrement… »), keeps the record as typed and never sends it again by itself, even when you leave the record. In a datasheet, refresh (Home › Refresh) to see whether it was stored, then press Esc to drop your copy, or Save Record to send it again. In a form, Refresh saves the record first, so it shows the message again: press Esc to drop your copy, or Save Record to send it again. A save that the client refused before sending anything (the connection had already dropped while idle) is sent once more on a new connection, without asking.
- **A front-end on a shared folder.** The Runtime copies a front-end to the workstation before opening it only when « Application frontale » is ticked (Options › Base de données active). A file that holds only PostgreSQL links, opened from a share without that option, opens read-only for the second Runtime user. Tick the option before you distribute the file.
- **Stop does not interrupt every server call.** Refresh Link, the link dialog's table list, exports from a server table and saves cannot be stopped with Stop. With the link's timeout at 0 (none), a server that never answers keeps them waiting, and a save waiting on a lock held by another user waits as long as that lock lasts.
- **Pass-through results are held in memory.** The whole result of a pass-through query is kept in the workstation's memory (twice for a moment while it loads). Filter on the server. A result stays in memory until the query is saved, renamed or deleted, or the database closes: closing its tab does not free it.
- **Two views of the same pass-through.** A window keeps one result per pass-through. Each view (tab) that opens it runs it, and the views share the latest result: the first view's next pages read the second run's rows.
- **A form's field list in Design view.** The result taken to list the fields of a form built on a pass-through serves the next opening of that form as it is.
- **A pass-through as a source.** Refused as the source of another query or lookup (Access allows it).
- **The Linked Table Manager does not relink pass-throughs.** After a server moves, open each pass-through's property sheet and choose its connection again.

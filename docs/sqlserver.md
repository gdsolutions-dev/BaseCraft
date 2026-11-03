# SQL Server linked tables

BaseCraft links tables from a SQL Server database the way Access links ODBC tables. The links appear in the Navigation Pane, and queries on them run on the server. The server checks and stores every write. To move the local tables of an application to SQL Server, see [Move an application to a server](server-migration.md).

## Requirements

- **SQL Server 2016 (13.x) or later**, Azure SQL Database or Azure SQL Managed Instance. BaseCraft refuses to connect to an older server.
- **A SQL Server login** (SQL Server authentication: a login name and a password) **with `SELECT`, `INSERT`, `UPDATE` and `DELETE`** on the linked tables. Windows authentication and Microsoft Entra ID are not supported. BaseCraft lists only the tables and views this login can read. Each user enters their own login the first time they connect. BaseCraft never writes the password into the front-end. A remembered password is kept as for PostgreSQL links (see [PostgreSQL linked tables](postgresql.md#requirements)): encrypted with the operating system's protection, for the link's encryption mode, and never stored on Linux without a keyring.
- **A primary key** on each table you want to edit. A view or a table without a primary key (a heap) opens read-only, as in Access when no unique index is chosen.

## Server, instance and encryption

The server is a host name and a port (1433 by default), or `host\instance` for a named instance, as in SQL Server Management Studio. With an instance name the port is not used: BaseCraft asks the SQL Server Browser service (UDP port 1434) for the instance's port. SQL Server Express installs as the named instance `SQLEXPRESS` on a dynamic port by default.

| Mode | Behaviour |
|---|---|
| `verify-full` (default) | Encrypted. The server's certificate must be trusted by the workstation (Node's CAs or the system store), and the host name must match it, as ODBC Driver 18's default. Otherwise the link reports a certificate problem. |
| `require` | Encrypted, trusting the server's certificate without checking it (Access's “Trust server certificate”). |
| `disable` | Not encrypted. Use it only on a trusted network. |

Each session is named `BaseCraft` and sets `LANGUAGE us_english`, `DATEFORMAT ymd`, `DATEFIRST 7`, `LOCK_TIMEOUT -1`, `ARITHABORT ON` and `CONCAT_NULL_YIELDS_NULL ON`. A statement that runs longer than the link's timeout (60 s by default; 0 means none) is stopped and reported as a timeout. SQL Server's timeout is measured by BaseCraft on the workstation, so a save that times out may have been completed by the server just before: it is reported as a save whose connection was lost (« La connexion au serveur a été perdue pendant l'enregistrement… », see [PostgreSQL linked tables](postgresql.md#known-limitations)) and is never sent again by itself.

## Types

| SQL Server | BaseCraft |
|---|---|
| `tinyint`, `smallint`, `int` | Number (Byte, Integer, Long Integer) |
| `IDENTITY` `smallint`, `int` or `bigint`, the table's only key | AutoNumber (a `bigint` above 2^53 shows rounded; the row is still found by its exact value). Another identity column keeps its integer type, read-only |
| `bigint` | Number Decimal(19, 0), exact (BigInt support) |
| `real`, `float` | Single, Double |
| `decimal(p, s)`, `numeric(p, s)`, p ≤ 28 | Decimal(p, s) |
| `decimal` or `numeric` with p > 28 | Decimal(28, s), at most 6 decimals, rounded |
| `money`, `smallmoney` | Currency, exact to 4 decimals |
| `bit` | Yes/No. As in Access, a Yes/No value is -1 (Yes) or 0 (No) in expressions |
| `char`, `varchar`, `nchar`, `nvarchar` up to 255 characters | Short Text (n). A `char` value keeps its trailing spaces |
| `varchar(max)`, `nvarchar(max)`, longer text, `text`, `ntext` | Long Text |
| `uniqueidentifier` | Short Text (36) |
| `date`, `smalldatetime`, `datetime`, `datetime2` | Date/Time (Date/Time Extended support). Fractional seconds are not shown, but a key keeps them: the row is found again |
| `time` | Date/Time on 1899-12-30, as Access |
| `datetimeoffset` | Short Text (34), the server's text form, as Access's ODBC link |
| computed columns | their type, read-only |
| `rowversion` (`timestamp`) | not a field: BaseCraft uses it to detect conflicts (see Locking) |
| `xml`, `binary`, `varbinary`, `image`, `sql_variant`, `hierarchyid`, `geometry`, `geography`, CLR types | skipped and listed in the link dialog |

A field is required when its column is `NOT NULL` without a default, and is neither an identity nor a computed column. A date before 0100-01-01 reads as Null. A table in the `dbo` schema is linked under its own name, a table of another schema as `<schema>_<table>` (Access names every ODBC link `dbo_<table>`); a link can be renamed.

## Text comparisons and collations

Access compares text without case and with accents. Most SQL Server collations (`French_CI_AS`, `SQL_Latin1_General_CP1_CI_AS`, `Latin1_General_100_CI_AS`…) already do, and BaseCraft compares in the column's own collation there, so the server can use the column's indexes. On a column whose collation is case-sensitive (`_CS_`, `_BIN`, `_BIN2`…), or between two columns of different collations, BaseCraft compares in `Latin1_General_100_CI_AS`: `=`, `<>`, `<`, `>`, `Like`, `In`, `Between`, `InStr`, `Replace` and joins ignore case as in Access, and a join of two columns in different collations runs (no “collation conflict” error). The text is converted to Unicode first, so a `varchar` column whose code page is not Latin-1's (a Polish, Japanese or UTF-8 collation) keeps its characters. Text sorts fold case in French order (`French_100_CI_AS`), then put the exact forms in a fixed order.

`GROUP BY`, `DISTINCT` and `UNION` group in the column's own collation (see Differences from Access).

## Queries on the server: the closed list

BaseCraft translates a query on linked SQL Server tables into one T-SQL statement. Every value is sent as a parameter. Anything outside the list below is refused before a statement is sent. The message names the function or the query shape. The list is the same as for PostgreSQL.

**Operators:** `=` `<>` `<` `<=` `>` `>=` (text compared without case, accents kept), `&`, `+` `-` `*` `/` `^` `\` `Mod`, `And` `Or` `Not` `Xor`, `Like` (`*` `?` `#` `[…]` `[!…]`), `Between`, `In`, `Is Null`, subqueries (`(SELECT …)`, `Exists`, `In (SELECT …)`).

**Functions translated:** `IIf`, `Nz`, `IsNull`, `CBool`, `Len`, `Left`, `Right`, `Mid`, `Trim`, `LTrim`, `RTrim`, `UCase`, `LCase`, `InStr`, `Replace`, `Space`, `String`, `Round` (banker's rounding), `Int`, `Fix`, `Abs`, `Sgn`, `Sqr`, `CInt`, `CLng`, `CDbl`, `CCur`, `Date`, `Time`, `Now` (the workstation's clock), `Year`, `Month`, `Day`, `Hour`, `Minute`, `Second`, `Weekday`, `DateAdd`, `DateDiff`, `DatePart`, `DateSerial`, `TimeSerial`, and the aggregates `Count`, `Sum`, `Avg`, `Min`, `Max`, `StDev`, `StDevP`, `Var`, `VarP`.

**Functions refused:** `Format`, `Val`, `CStr`, `CDate`, `IsNumeric`, `IsDate`, `StrComp` (they depend on regional settings), `First`, `Last` (a server has no row order to take them by).

**Query shapes:** SELECT with inner and outer joins, WHERE, GROUP BY / HAVING, ORDER BY, DISTINCT, UNION [ALL], subqueries, parameters, and `TOP n` (ties kept, as Access). These are refused: `TOP n PERCENT`, Make-Table queries (create the table on the server, then fill it with an Append query).

**Action queries:** Append (`INSERT … VALUES`, `INSERT … SELECT`), Update and Delete run on the server in one transaction, every row through the table's rules as on a local table. A row a rule refuses is counted by cause and skipped only when you choose to run the query anyway; a row the server itself refuses (a duplicate key, a missing parent record) cancels the whole query, nothing written, even when you run it anyway. A Delete that related records refuse deletes nothing. An Append that gives the values of an AutoNumber field is refused before anything is sent: remove that field from the query, the server numbers the new records. On a table without a `rowversion` column, an Update query does not check whether another user changed a record between the query's read and its write (a datasheet or form save does); tables made by the migration wizard have one (`bc_rowversion`). If the connection is lost while the query runs, whether it completed is unknown: check the table before running it again.

**Crosstab queries** run on the server: the column headings are read there first, then merged as Access compares text (« Lyon » and « LYON » make one column, accents count). Their order follows the server's collation, which may differ from Access's. A column heading with more than 254 values on the server (counted before they are merged) is refused.

**Tables made by the migration wizard** keep BaseCraft's own field properties on their link (caption, format, input mask, validation rules, lookups, the local type where the server stores another), and BaseCraft enforces those rules on every write it makes. Other programs that write to the server bypass them. See [Move an application to a server](server-migration.md#basecrafts-properties-travel-with-the-link).

A query that uses a refused function stays usable on local tables only.

## Differences from Access

A cross-test suite runs the same expressions on BaseCraft's evaluator, on SQLite (local tables) and on a real SQL Server, once on a database with a case-insensitive collation and once on a case-sensitive one (`Latin1_General_100_CS_AS`). Each difference below is a case in that suite (`src/main/connectors/sqlserver/cross.test.ts`, `MS_DISCREPANCIES`), which checks that it still holds.

- Refused on SQL Server (bc:serverFunction): outside the closed list
- Refused on SQL Server (bc:serverFunction): an operator or a comparison does not mix text with numbers or dates. For example, comparing a text with a number or a date, a text used as a condition, or arithmetic on text.
- Refused on SQL Server (bc:serverFunction): & takes text, Null, an AutoNumber or an integer literal. Access's `&` formats other numbers and dates with regional settings.
- A division by zero ends the SQL Server query (Access: an error in that cell). This also holds for `\` and `Mod` by zero, and for a division in an `IIf` branch, but only when a row takes that branch.
- Sqr of a negative number ends the SQL Server query (Access: an error in that cell)
- Nz(v) without a default gives 0 or a zero-length text by type on SQL Server (BaseCraft locally: Empty, shown as Null)
- DateDiff with "w" or "ww" and DatePart with "ww" are refused on SQL Server (bc:serverFunction)
- Space and String of a negative count give Null on SQL Server (Access: an error)
- Refused on SQL Server (bc:serverFunction): a Like pattern read from a field (a literal or a parameter is translated)
- GROUP BY, DISTINCT and UNION follow the column's collation on SQL Server: one group for "Lyon" and "LYON" on a _CI_AS column (as Access), two on a case-sensitive one
- Avg of a Decimal field is exact on SQL Server, to min(s + 19, 28 - (p - s)) decimals for a Decimal(p, s), its last decimal truncated, not rounded (BaseCraft locally: a Double, about 15 significant digits)
- A criterion on a case-sensitive column (or between two columns of different collations) cannot use the column's index.
- In a `Like` class, a range of ASCII letters or digits (`[a-z]`, `[0-9]`) and `#` match those characters only, as Access. Any other range (`[à-ÿ]`) follows the collation's order.

Unlike PostgreSQL, `Replace` follows the comparison rule above: it finds its text without case, also on a case-sensitive column, as Access. `Replace` is therefore not a difference from Access here. A date with fractional seconds plus a fraction of a day is rounded to the second, as Access. A Yes/No value reads -1 (Yes) or 0 (No) in expressions, as in Access.

## Locking

BaseCraft checks each write against the row as it was read, as Access does on an ODBC link:

- **A table with a `rowversion` column:** the row is updated only if its `rowversion` has not changed. Any change by another user is a conflict, whatever the field.
- **A table without one:** the row is updated only if every field still holds the value read, except Single, Double (`real`, `float`) and Long Text fields, which Access does not compare either. A change in such a field alone is not detected. A Date/Time field is compared to the second, so a `datetime2(7)` fraction never reports a false conflict. Text is compared in the column's collation: a change of case only is not a conflict on a `_CI_AS` column.

A conflict opens the Write Conflict dialog. A row deleted by another user is reported as deleted. Deletes are not checked: a row is deleted by its key.

Add a `rowversion` column to the tables several people edit at once: conflicts are then exact and cheaper to check.

**Data entry through a query on several tables** (orders joined to their customers, as on local tables): a save writes the order's row as its own table's datasheet does, then the customer's row it joins, found by the join fields (compared as the query compares them: text without case), locked until the save ends, and updated, all in one server transaction. AutoLookup fills the customer's fields from the key typed in the order, read on the server. Nothing is saved, not even the order, when the customer's row is missing or found twice, when the server refuses a value, or when another user changed the customer since it was read; that conflict is found by comparing the customer's fields with the values read (except Single, Double and Long Text fields), whatever the table's own conflict check. If the row of a « one » table does not exist (the order's Client matches no customer), the customer's fields cannot be edited and the save is refused (« Aucun enregistrement correspondant n'existe dans la table liée… », `noParent`). If it is found twice, its fields are read-only (`readOnly`). A query is editable only when every table it writes has a primary key.

## Pass-through queries

A pass-through query is written in T-SQL and sent to SQL Server exactly as typed. It works as described in [PostgreSQL's pass-through queries](postgresql.md#pass-through-queries): Create › Query Design, Query Type › « SQL direct », SQL view only; the Property Sheet's **Connexion** lists the servers of the front-end's links (one entry per server, instance, database, encryption mode and user) and offers « Autre serveur PostgreSQL… » and « Autre serveur SQL Server… », each opening that server's connection dialog. The new query's connection is the first linked server's, whatever its kind. Results are a read-only snapshot, Returns Records = Non is an action blocked in disabled mode, a remembered password needs a file you trust, a pass-through is never the source of another query, and errors, Stop and « Délai d'attente ODBC » behave the same.

What differs on SQL Server:

- **What is sent.** The text is one batch (no `sp_executesql`, no parameter: `@x` must be declared in the text). Several statements all run, each in its own transaction unless the text has a `BEGIN TRANSACTION … COMMIT`. `GO` is not T-SQL but a separator of SQL Server's tools: the server refuses it, as through Access. Each run opens its own connection and closes it, so a `SET`, a `#temp` table or an open transaction never reaches the linked tables or the next run.
- **Which result.** The records are the first result set; later ones are ignored. The number of rows reported counts every statement's rows (`SET NOCOUNT ON` in the text hides them).
- **Column types** map as in the Types table above: integers, `bigint` (exact digits), `real`, `float`, `decimal`, `money`, `bit`, text, `uniqueidentifier`, `date`, `datetime`, `datetime2`, `smalldatetime`, `time` (on 1899-12-30) and `datetimeoffset` (Short Text). Every other type (`xml`, binary types as `0x…`, `sql_variant`, `hierarchyid`, spatial types) is never skipped: it shows as Long Text.
- **Values.** A date is the server's own date and time, never shifted to the workstation's zone. A `datetimeoffset` shows in UTC (`+00:00`) to the millisecond: write `CONVERT(nvarchar(34), x)` in the text to see its own offset. A `decimal` or `money` value is read as a double (pass-through results are not rewritten, so they lose the exact digits linked tables keep): the digits a double cannot hold, beyond about 15 significant digits, are lost. Write `CAST(x AS varchar(48))` in the text when every digit matters.

## Known limitations

- **Decimal expressions.** The average of a Decimal *expression* (`Avg([Montant] * 2)`) is computed as a Double (about 15 significant digits); the average of a Decimal field is exact.
- **Round on large or very precise values.** `Round`, `CInt`, `CLng`, `CCur`, `\` and `Mod` round on `decimal(38, 10)`: a value above 10^28 ends the query with an arithmetic overflow, and `Round(x, n)` keeps at most 6 decimals.
- **Currency above about 9 × 10^11** shows its last decimal rounded (BaseCraft holds Currency as a Double).
- **Very large numbers.** A `bigint` identity above 2^53 and a very large `money` value show rounded; the row is still found again by its exact value.
- **Authentication.** SQL logins only: Windows (integrated, NTLM) and Microsoft Entra authentication are not supported. SQL Server 2014 and older are refused; Azure SQL Database and Azure SQL Managed Instance are accepted.
- **Temporal tables.** The period columns (`GENERATED ALWAYS AS ROW START/END`) are read-only.
- **An `INSTEAD OF` trigger that writes nothing.** On a table with a `rowversion` column BaseCraft notices that the row did not change and refuses the save. On a table without one it cannot tell, and the save reads as successful although nothing was stored. Refresh to see the stored data.
- **A `varchar` key outside the database's code page.** A `varchar` primary key holding a character that the database's code page cannot hold is not found again after a save (the server cannot store the character as typed). Refresh the datasheet to see what was stored, and prefer `nvarchar` keys.
- **Stop does not interrupt every server call.** Refresh Link, the link dialog's table list, exports from a server table and saves cannot be stopped with Stop. With « Délai d'attente ODBC » at 0 (no timeout), a save waiting on a lock held by another user waits as long as that lock lasts.

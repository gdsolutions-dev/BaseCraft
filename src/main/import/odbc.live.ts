// Live ODBC tests: a SQLite file read through the SQLite ODBC driver. Windows with « SQLite3 ODBC Driver » installed, or any system
// naming its driver in BASECRAFT_ODBC_TEST_DRIVER (the isql path then runs); without one, the live tests are skipped.
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { powershellPath } from './access-export';

export function liveDriver(): string | undefined {
  if (process.env.BASECRAFT_ODBC_TEST_DRIVER) return process.env.BASECRAFT_ODBC_TEST_DRIVER;
  if (process.platform !== 'win32') return undefined;
  try {
    const out = execFileSync(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', "(Get-OdbcDriver -Name 'SQLite3 ODBC Driver' -Platform '64-bit' -ErrorAction SilentlyContinue).Name"], { encoding: 'utf8' });
    return out.trim() || undefined;
  } catch { return undefined; }
}

/** The source the live tests read: Clients (2 rows) and Pays (1 row). */
export function makeLiveSource(file: string): void {
  const s = new DatabaseSync(file);
  s.exec(`CREATE TABLE Clients (id INTEGER PRIMARY KEY, nom VARCHAR(50), solde REAL, actif BOOLEAN, ne DATETIME, note TEXT);
    INSERT INTO Clients VALUES (1, 'Zoé "x"; é', 12.5, 1, '2024-05-17 13:01:02', 'long'), (2, NULL, NULL, 0, NULL, NULL); CREATE TABLE Pays (c CHAR(2)); INSERT INTO Pays VALUES ('FR');`);
  s.close();
}

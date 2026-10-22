import type { Migration } from './file-format';

// NOCASE is ASCII-only: Unicode-insensitive duplicates are refused by relations.ts, not by the schema.
export const BC_RELATIONS_DDL = 'CREATE TABLE bc_relations (name TEXT PRIMARY KEY COLLATE NOCASE, props TEXT NOT NULL)';

// Migrations run inside ONE transaction with foreign_keys=ON (see openBaseFile). A migration that rebuilds a table
// (DROP + RENAME) must instead run with foreign_keys=OFF and a scoped PRAGMA foreign_key_check: not needed for CREATE TABLE.
export const MIGRATIONS: Migration[] = [{ toMajor: 1, toMinor: 1, up: (db) => db.exec(BC_RELATIONS_DDL) }];

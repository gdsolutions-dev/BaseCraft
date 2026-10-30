import type { Migration } from './file-format';

// NOCASE is ASCII-only: Unicode-insensitive duplicates are refused by relations.ts, not by the schema.
export const BC_RELATIONS_DDL = 'CREATE TABLE bc_relations (name TEXT PRIMARY KEY COLLATE NOCASE, props TEXT NOT NULL)';

// Migrations run inside ONE transaction with foreign_keys=ON (see openBaseFile). A migration that rebuilds a table
// (DROP + RENAME) must instead run with foreign_keys=OFF and a scoped PRAGMA foreign_key_check: not needed for CREATE TABLE.
// Format 1.2: queries, forms, reports, macros and modules. `definition` is JSON ({ formatVersion: "1.0", ... }), unknown keys
// kept. Names are compared by sameName in objects.ts (the PRIMARY KEY is binary): no BaseCraft collation in the schema.
export const BC_OBJECTS_DDL = `CREATE TABLE bc_objects (
  kind TEXT NOT NULL CHECK (kind IN ('query','form','report','macro','module')),
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  description TEXT,
  nav_group TEXT,
  created TEXT NOT NULL, modified TEXT NOT NULL,
  PRIMARY KEY (kind, name)
)`;

// Format 1.3: linked files (C1). `props` is JSON: a source holds { path, relative? }, a link { description? }; unknown kinds and keys
// are kept. Names are compared by sameName in links/store.ts (the PRIMARY KEY is binary), as bc_objects.
export const BC_SOURCES_DDL = `CREATE TABLE bc_sources (id TEXT PRIMARY KEY, kind TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}')`;
export const BC_LINKS_DDL = `CREATE TABLE bc_links (name TEXT PRIMARY KEY, source_id TEXT NOT NULL, remote_name TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}')`;

export const MIGRATIONS: Migration[] = [
  { toMajor: 1, toMinor: 1, up: (db) => db.exec(BC_RELATIONS_DDL) },
  { toMajor: 1, toMinor: 2, up: (db) => db.exec(BC_OBJECTS_DDL) },
  { toMajor: 1, toMinor: 3, up: (db) => { db.exec(BC_SOURCES_DDL); db.exec(BC_LINKS_DDL); } },
];

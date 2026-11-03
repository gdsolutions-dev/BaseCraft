// Server migration wizard (C7): types shared by the main process and the renderer.
import type { ServerKind } from './api';

/** R5: a rule the server does not hold, kept and enforced by the front-end only (listed in the report). */
export interface FrontEndRule { table: string; field?: string; what: 'defaultValue' | 'validationRule' | 'allowZeroLength' | 'tableRule' }
/** R1: the wizard's run: the engine, the params its login step accepted (never a password), the target schema. */
export interface MigrateRequest { kind: ServerKind; params: unknown; schema: string /* 1–128 chars */ }
/** R16. */
export interface MigrationReport {
  kind: ServerKind; server: string /* connector.label */; schema: string; backupPath: string;
  tables: { name: string; rows: number; nextId?: number; version?: string }[];
  indexes: { table: string; name: string; unique: boolean }[];
  relations: { name: string; result: 'created' | 'noAction' | 'notEnforced' }[];
  approximated: { table: string; field: string; serverType: string }[];
  frontEndOnly: FrontEndRule[];
  queries: { name: string; error: string }[]; // R13 (Task 8 fills it; [] until then)
  queriesUnchecked?: string; // R13's check failed (a bc: message): `queries` is empty, not checked
}
/** R17: the server tables copied into local tables (`remote`: the server's name, `skipped`: columns not imported), or why nothing was. */
export type ServerImportResult = { ok: true; tables: { name: string; remote: string; rows: number; skipped: string[] }[] }
  | { ok: false; reason: 'nameExists' | 'missingTables'; names: string[] } | { ok: false; reason: 'cancelled' };
/** R9: `failed` names the table (and the field when the server tells); `closed`: its ROLLBACK failed, the connection was closed
 *  (the server rolls back); `left`: server tables the run may have left (a COMMIT
 *  whose outcome is unknown (`unknown`), lost or Stopped, or tables a failed local switch could not drop); `backupPath` once the copy is made. */
export type MigrateResult = { ok: true; report: MigrationReport }
  | { ok: false; reason: 'readOnly' | 'noTables' | 'dataFile' }
  | { ok: false; reason: 'cancelled'; backupPath?: string }
  | { ok: false; reason: 'noSchema'; schema: string }
  | { ok: false; reason: 'nameTaken' | 'nameTooLong' | 'invalidDesign'; names: string[] }
  | { ok: false; reason: 'failed'; error: string /* a bc: message */; table?: string; field?: string; left?: string[]; unknown?: true /* the COMMIT's outcome */; closed?: true; backupPath?: string };

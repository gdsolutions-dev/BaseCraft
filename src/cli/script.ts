import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { LocaleInfo } from '../shared/locale-format';
import { BaseFileError, checkBaseFile, CURRENT_FORMAT, registerFunctions } from '../main/db/file-format';
import { acquireLock } from '../main/db/lock';
import { CliUsageError } from './errors';
import { OP_HANDLERS } from './ops';

export type ScriptOp = { op: string; [k: string]: unknown };
export type ScriptResult = { ok: true; applied: number } | { ok: false; index: number; op: string; message: string };

export function parseScript(text: string): ScriptOp[] {
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { throw new CliUsageError(`invalid JSON: ${(e as Error).message}`); }
  if (!Array.isArray(json)) throw new CliUsageError('the script must be a JSON array of operations');
  for (const [i, o] of json.entries()) {
    if (typeof o !== 'object' || o === null || Array.isArray(o) || typeof (o as { op?: unknown }).op !== 'string') throw new CliUsageError(`operation #${i} needs a string "op"`);
  }
  return json as ScriptOp[];
}

/** The target must be a BaseCraft base at exactly the current format; the CLI never migrates. Throws BaseFileError. */
export function checkTarget(basePath: string): void {
  try { checkBaseFile(basePath); } catch (e) {
    if (e instanceof BaseFileError) throw new BaseFileError(e.code, `${e.code === 'cannotOpen' ? 'cannot open' : 'not a BaseCraft base'}: ${basePath}`);
    throw e;
  }
  let major: number, minor: number;
  try {
    const db = new DatabaseSync(basePath, { readOnly: true });
    try {
      const get = (k: string) => Number((db.prepare('SELECT value FROM bc_meta WHERE key = ?').get(k) as { value: string } | undefined)?.value);
      major = get('format_major'); minor = get('format_minor');
    } finally { db.close(); }
  } catch { throw new BaseFileError('notBasecraft', `not a BaseCraft base: ${basePath}`); }
  if (!Number.isInteger(major) || !Number.isInteger(minor)) throw new BaseFileError('notBasecraft', `not a BaseCraft base: ${basePath}`);
  const { major: cm, minor: cn } = CURRENT_FORMAT;
  if (major === cm && minor === cn) return;
  const older = major < cm || (major === cm && minor < cn);
  throw new BaseFileError('notBasecraft', older
    ? `${basePath} uses format ${major}.${minor}; open it in BaseCraft to upgrade it first`
    : `${basePath} uses format ${major}.${minor}, newer than this basecraft-cli supports (${cm}.${cn})`);
}

/** All-or-nothing: ops run on a temp copy that replaces the base only if every op succeeded. */
export function applyScript(basePath: string, ops: ScriptOp[], info: LocaleInfo): ScriptResult {
  if (ops.length === 0) return { ok: true, applied: 0 };
  const got = acquireLock(basePath, crypto.randomUUID());
  if (got.status === 'cannotLock') return { ok: false, index: -1, op: 'lock', message: `cannot lock ${basePath}: ${got.reason}` };
  if (got.status === 'heldByOther') return { ok: false, index: -1, op: 'lock', message: `${basePath} is in use by ${got.info.user}@${got.info.host}${got.stale ? `; the lock looks stale (its holder may have crashed): remove ${basePath}.lock if no one is using the base` : ''}` };
  const tmp = `${basePath}.cli-tmp`;
  try {
    fs.copyFileSync(basePath, tmp);
    let result: ScriptResult = { ok: true, applied: ops.length };
    const db = new DatabaseSync(tmp);
    try {
      registerFunctions(db);
      for (const [index, { op, ...args }] of ops.entries()) {
        const handler = Object.hasOwn(OP_HANDLERS, op) ? OP_HANDLERS[op] : undefined;
        let out: { ok: true } | { ok: false; message: string };
        try { out = handler ? handler(db, args, info) : { ok: false, message: `unknown op: ${op}` }; } catch (e) { out = { ok: false, message: e instanceof Error ? e.message : String(e) }; }
        if (!out.ok) { result = { ok: false, index, op, message: out.message }; break; }
      }
    } finally { db.close(); }
    if (result.ok) fs.renameSync(tmp, basePath);
    return result;
  } catch (e) {
    return { ok: false, index: -1, op: 'file', message: e instanceof Error ? e.message : String(e) };
  } finally {
    fs.rmSync(tmp, { force: true });
    got.lock.release();
  }
}

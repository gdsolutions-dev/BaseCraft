// Aperçu et exécution d'un import de fichier texte. Toutes les écritures passent par la couche d'écriture, dans une seule
// transaction : un échec en cours de route (lecture, contrainte inattendue) ne laisse aucune table à moitié remplie.
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { FieldErrorCode } from '../../shared/coerce';
import { defaultProps, type FieldDef, type TableDesign } from '../../shared/field-types';
import {
  defaultSpec, detectNumberFormat, importFieldProps, normalizeValue, specLocale, suffixedName, uniqueName,
  type ImportEncoding, type ImportPlan, type ImportResult, type ImportSpec, type ResolvedEncoding, type TextPreview,
} from '../../shared/import-text';
import type { LocaleInfo } from '../../shared/locale-format';
import { listObjects } from '../db/objects';
import {
  createTable, DanglingKeyError, danglingNames, DesignValidationError, foreignKeys, listTables, NameExistsError, quoteIdent, sqliteSameName, tableDesign,
} from '../db/schema';
import { inTransactionAsync } from '../db/tx';
import { insertRow } from '../db/write-layer';
import { detectHeader, inferFields, SAMPLE } from './infer';
import { detectFormat, proposeBreaks, readRecords, sniffEncoding, splitRecords, type Rec } from './text-parse';

const PREVIEW_ROWS = 50;
const NOT_A_NUMBER = '#'; // refused by coerce as invalidNumber

/** Libellés écrits dans la base (langue de l'interface) : nom par défaut des champs, table et messages d'erreur. */
export interface ImportTexts {
  fieldPrefix: string;
  idName: string;
  errorSuffix: string;
  errorFields: { error: string; field: string; line: string };
  messages: Record<FieldErrorCode, string>;
  log: { unclosed: string; truncated: string };
}

const SAMPLE_BYTES = 4 << 20;
const fileKey = (path: string) => { const st = statSync(path); return `${path}|${st.size}|${st.mtimeMs}`; };
// ponytail: one file remembered (the wizard handles one file at a time).
let sniffed: { key: string; encoding: ResolvedEncoding } | null = null;
let sampled: { key: string; text: string; final: boolean } | null = null;

/** Encodage du fichier ; la détection automatique (lecture de tout le fichier) n'est faite qu'une fois par version du fichier. */
function resolveEncoding(path: string, requested: ImportEncoding): ResolvedEncoding {
  if (requested !== 'auto') return requested;
  const key = fileKey(path);
  if (sniffed?.key !== key) sniffed = { key, encoding: sniffEncoding(path) };
  return sniffed.encoding;
}

/** Début du fichier décodé (4 Mo), relu seulement si le fichier ou l'encodage change : chaque option de l'assistant le réutilise. */
function sampleText(path: string, encoding: ResolvedEncoding): { text: string; final: boolean } {
  const key = `${fileKey(path)}|${encoding}`;
  if (sampled?.key === key) return sampled;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(SAMPLE_BYTES);
    const n = readSync(fd, buf, 0, SAMPLE_BYTES, 0);
    const final = n < SAMPLE_BYTES || fstatSync(fd).size === n;
    const text = new TextDecoder(encoding).decode(buf.subarray(0, n), { stream: !final }); // stream: a cut character is dropped
    sampled = { key, text, final };
    return sampled;
  } finally {
    closeSync(fd);
  }
}

/** Où l'import lit ses enregistrements : un fichier texte, une feuille Excel. `progress` : avancement (done / total) ; `size` : total
 *  quand la source le connaît d'avance (sinon 0, la source le donne par `progress`). */
export interface ImportSource { records(progress?: (done: number, total: number) => void): Iterable<Rec>; size: number }

export function textSource(path: string, spec: ImportSpec): ImportSource {
  const encoding = resolveEncoding(path, spec.encoding);
  return { size: 0, records: (progress) => readRecords(path, { spec, encoding }, progress) };
}

/** Aperçu : sans spécification, tout est détecté (encodage, format, séparateur, en-tête, coupures, types). */
export function previewText(path: string, given: ImportSpec | null, region: LocaleInfo, prefix: string): TextPreview {
  let spec = given ?? defaultSpec(region);
  const encoding = resolveEncoding(path, spec.encoding);
  const { text, final } = sampleText(path, encoding);
  const raw = splitRecords(text, { spec, raw: true }, final).map((r) => r[0]);
  if (raw.length === 0) throw new Error('bc:emptyFile');
  const lines = raw.slice(0, PREVIEW_ROWS);
  if (!given) spec = { ...spec, ...detectFormat(raw.slice(0, 200)) };
  else if (spec.format === 'fixed' && spec.breaks.length === 0) spec = { ...spec, breaks: proposeBreaks(lines) }; // passage à la largeur fixe
  const info = specLocale(spec, region);
  const records = splitRecords(text, { spec }, final).slice(0, SAMPLE + 1);
  const nf = detectNumberFormat(records.flat(), region.decimalSep);
  if (!given) spec = { ...spec, decimalSep: nf.decimalSep, thousandsSep: nf.thousandsSep };
  const assumedDecimal = nf.assumed && spec.decimalSep === nf.decimalSep;
  if (!given) spec = { ...spec, hasHeader: detectHeader(records, spec, info) };
  const header = spec.hasHeader ? records[0] ?? [] : null;
  const rows = spec.hasHeader ? records.slice(1) : records;
  const columns = spec.format === 'fixed' ? spec.breaks.length + 1 : Math.max(1, header?.length ?? 0, ...rows.map((r) => r.length));
  const inferred = inferFields(header, rows, columns, spec, info, prefix);
  if (!given) spec = { ...spec, fields: inferred };
  return { encoding, spec, inferred, lines, header, rows: rows.slice(0, PREVIEW_ROWS), columns, assumedDecimal };
}

/** The error's own text when the write layer gives one (validation text, relation), else the message of its code, with the
 *  field's rule filled in ({{rule}}, as stored). */
function messageOf(e: { field: string; code: string; message?: unknown; table?: string }, texts: ImportTexts, design: TableDesign): string {
  if (typeof e.message === 'string' && e.message !== '') return e.message;
  const record = e.field === '' && (e.code === 'validation' || e.code === 'expressionError'); // the table's rule (fieldError.tableRule…)
  const rule = (record ? design.validationRule : design.fields.find((x) => x.name === e.field)?.props.validationRule) ?? '';
  const key = record ? (e.code === 'validation' ? 'tableRule' : 'tableRuleError') : e.code;
  return ((texts.messages as Record<string, string>)[key] ?? e.code).replace('{{rule}}', rule).replace('{{table}}', e.table ?? '');
}

class ImportFailure extends Error {
  constructor(public result: ImportResult) { super('import refused'); }
}

/** Conception de la nouvelle table : champs importés, et clé primaire NuméroAuto, choisie ou absente. */
function newDesign(plan: ImportPlan & { target: { kind: 'new' } }, idName: string): { design: TableDesign; columns: (string | null)[] } {
  const { spec, target } = plan;
  const fields: FieldDef[] = [];
  const columns = spec.fields.map((f) => (f.skip ? null : f.name));
  for (const f of spec.fields) if (!f.skip) fields.push({ name: f.name, props: importFieldProps(f) });
  const pk = target.primaryKey;
  if (pk.kind === 'auto') {
    fields.unshift({ name: uniqueName(idName, fields.map((x) => x.name)), props: defaultProps('autoNumber') });
  } else if (pk.kind === 'field') {
    const fd = fields.find((x) => x.name === pk.field);
    if (!fd) throw new TypeError('bc:invalidArgument');
    fd.props = { ...fd.props, primaryKey: true, required: true, indexed: 'yesNoDuplicates' };
  }
  return { design: { name: target.table, fields }, columns };
}

/** Table cible et champ de chaque colonne du fichier (null : colonne sautée). */
function prepare(db: DatabaseSync, plan: ImportPlan, idName: string): { design: TableDesign; columns: (string | null)[] } {
  if (plan.target.kind === 'new') {
    const r = newDesign(plan as ImportPlan & { target: { kind: 'new' } }, idName);
    try {
      createTable(db, r.design);
    } catch (e) {
      if (e instanceof DesignValidationError) throw new ImportFailure({ ok: false, reason: 'design', errors: e.errors });
      if (e instanceof NameExistsError) throw new ImportFailure({ ok: false, reason: 'nameExists' });
      if (e instanceof DanglingKeyError) throw new ImportFailure({ ok: false, reason: 'danglingKey', table: e.table });
      throw e;
    }
    return { design: tableDesign(db, r.design.name), columns: r.columns };
  }
  const design = tableDesign(db, plan.target.table);
  const used = plan.target.mapping.filter((m): m is string => m !== null);
  for (const m of used) {
    const fd = design.fields.find((x) => x.name === m);
    if (!fd || fd.props.type === 'autoNumber') throw new TypeError('bc:invalidArgument');
  }
  if (new Set(used).size !== used.length) throw new TypeError('bc:invalidArgument');
  return { design, columns: plan.target.mapping };
}

/**
 * Importe le fichier. Les enregistrements refusés (conversion, validation, doublon) sont consignés dans
 * `<Table>_ErreursImportation`, créée seulement s'il y en a. `tick` : rend la main entre deux blocs (progression).
 */
export async function runImport(
  db: DatabaseSync, from: string | ImportSource, plan: ImportPlan, region: LocaleInfo, texts: ImportTexts,
  tick: (done: number, total: number) => Promise<void> = async () => {},
): Promise<ImportResult> {
  if (db.isTransaction) throw new Error('bc:invalidArgument'); // never inside another write
  const { spec } = plan;
  const source = typeof from === 'string' ? textSource(from, spec) : from; // a path: a text file read with the plan's spec
  const info = specLocale(spec, region);
  try {
    return await inTransactionAsync(db, async () => {
      const { design, columns } = prepare(db, plan, texts.idName);
      const targets = columns.map((name) => (name === null ? null : design.fields.find((x) => x.name === name)!));
      let errorDesign: TableDesign | null = null;
      let imported = 0;
      let errors = 0;
      // Lines of the rows written into a table with foreign keys: a DEFERRABLE key is only checked at the end (below).
      const keyed = foreignKeys(db).some((k) => k.child === design.name);
      const lines = new Map<number, number>();
      const logError = async (field: string, line: number, message: string) => {
        if (!errorDesign) {
          // Tables and queries share one namespace; a name a dangling key targets is taken too: the error table would become
          // that key's parent.
          const taken = [...[...listTables(db), ...listObjects(db, 'query')].map((x) => x.name), ...danglingNames(db)];
          const name = suffixedName(design.name, texts.errorSuffix, taken);
          const { error, field: champ, line: ligne } = texts.errorFields;
          errorDesign = {
            name, fields: [
              { name: error, props: { ...defaultProps('shortText'), size: 255 } },
              { name: champ, props: { ...defaultProps('shortText'), size: 64 } },
              { name: ligne, props: defaultProps('number') },
            ],
          };
          createTable(db, errorDesign);
        }
        const [e, c, l] = errorDesign.fields.map((x) => x.name);
        // Cut to the column's 255 characters: a long rule quoted in the message must not abort the import.
        const r = await insertRow(db, errorDesign, { [e]: [...message].slice(0, 255).join(''), [c]: field, [l]: line }, region); // await: insertRow becomes async (A2)
        if (!r.ok) throw new Error('error log refused');
        errors++;
      };
      let pending = { done: 0, total: source.size };
      let first = true;
      let last = Date.now();
      for (const rec of source.records((done, total) => { pending = { done, total }; })) {
        const { line } = rec;
        if (first && (first = false, spec.hasHeader)) continue;
        if (rec.unclosed) await logError('', line, texts.log.unclosed); // read with the qualifier as text, imported if it converts
        const values: Record<string, string> = {};
        const truncated: string[] = [];
        targets.forEach((fd, i) => {
          if (!fd) return;
          const t = fd.props.type;
          // a number that does not follow the spec gets a value the write layer refuses: all the row's errors are reported
          let v = normalizeValue(rec[i] ?? '', t === 'number' || t === 'currency' ? 'number' : t === 'dateTime' ? 'dateTime' : 'text', spec) ?? NOT_A_NUMBER;
          const size = t === 'shortText' ? fd.props.size ?? 255 : Infinity;
          if ([...v.trim()].length > size) { v = [...v.trim()].slice(0, size).join(''); truncated.push(fd.name); } // as Access
          values[fd.name] = v;
        });
        // ponytail: insertRow ligne à ligne (savepoint + relecture) ≈ 35 000 lignes/s ; un insertRows groupé dans la couche
        // d'écriture si les gros fichiers deviennent courants.
        const r = await insertRow(db, design, values, info);
        if (r.ok) {
          imported++;
          if (keyed) lines.set(r.rowid, line);
          for (const f of truncated) await logError(f, line, texts.log.truncated);
        }
        else for (const e of r.errors) await logError(e.field, line, messageOf(e, texts, design));
        if (Date.now() - last > 50) { await tick(pending.done, pending.total); last = Date.now(); }
      }
      // A row whose DEFERRABLE INITIALLY DEFERRED key has no parent passed its insert: logged like any noParent, then taken out
      // (older orphans of the table are not this import's business).
      const check = keyed ? db.prepare(`PRAGMA foreign_key_check(${quoteIdent(design.name)})`).all() as { rowid: number; parent: string; fkid: number }[] : [];
      for (const v of check) {
        const line = lines.get(v.rowid);
        if (line === undefined) continue;
        lines.delete(v.rowid);
        const col = (db.prepare('SELECT "from" AS c FROM pragma_foreign_key_list(?) WHERE id = ? ORDER BY seq').get(design.name, v.fkid) as { c: string }).c;
        const field = design.fields.find((fd) => sqliteSameName(fd.name, col))?.name ?? col;
        db.prepare(`DELETE FROM ${quoteIdent(design.name)} WHERE rowid = ?`).run(v.rowid);
        imported--;
        await logError(field, line, messageOf({ field, code: 'noParent', table: v.parent }, texts, design));
      }
      await tick(pending.total, pending.total);
      const done: ImportResult = { ok: true, table: design.name, imported, errors };
      if (errorDesign) done.errorTable = (errorDesign as TableDesign).name;
      return done;
    });
  } catch (e) {
    if (e instanceof ImportFailure) return e.result;
    // the session closed the connection (lock lost, base or window closed): SQLite rolled the whole import back
    if (!db.isOpen) throw new Error('bc:importInterrupted');
    throw e;
  }
}

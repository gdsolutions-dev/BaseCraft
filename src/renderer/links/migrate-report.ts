// L'Assistant Migration vers un serveur (C7 R16) : le rapport et les messages d'un refus ou d'un échec, en texte (sans React :
// testés seuls). Ni nom d'utilisateur ni mot de passe : le serveur est nommé par son libellé (hôte, port, base).
import type { TFunction } from 'i18next';
import type { MigrateResult, MigrationReport } from '../../shared/migrate';
import { bcErrorCode, errorMessage, SERVER_PRODUCTS } from '../shell/Modal';

/** A run's error (a bc: message) as its text: the migration's own codes, else the shell's error messages. */
export function errorText(error: string, t: TFunction): string {
  const [code, a = '', b = '', c = ''] = error.split('|');
  if (code === 'bc:migrateCount') return t('migrate.error.migrateCount', { table: a, local: b, server: c });
  if (code === 'bc:migrateUnlinkable') return t('migrate.error.migrateUnlinkable', { table: a });
  if (code === 'bc:migrateOneNull') return t('migrate.error.migrateOneNull', { field: a, relation: b });
  const m = errorMessage(new Error(error));
  return t(m.key, m.params);
}

/** R16: the report's sections as the dialog shows them, each head with its lines; an empty section is left out. */
export function reportSections(r: MigrationReport, t: TFunction): [string, string[]][] {
  const sep = t('migrate.report.sep');
  const rule = { defaultValue: 'fieldProp.defaultValue', validationRule: 'fieldProp.validationRule', allowZeroLength: 'fieldProp.allowZeroLength',
    tableRule: 'tableFields.recordValidationRuleLabel' } as const;
  const sections: [string, string[]][] = [
    [t('migrate.report.tables'), r.tables.map((x) => [t('migrate.report.table', { name: x.name, rows: x.rows }),
      ...(x.nextId !== undefined ? [t('migrate.report.nextId', { next: x.nextId })] : []),
      ...(x.version !== undefined ? [t('migrate.report.version', { column: x.version })] : [])].join(sep))],
    [t('migrate.report.indexes'), r.indexes.map((x) => t(x.unique ? 'migrate.report.uniqueIndex' : 'migrate.report.index', { table: x.table, name: x.name }))],
    [t('migrate.report.relations'), r.relations.map((x) => t(`migrate.report.${x.result}`, { name: x.name }))],
    [t('migrate.report.frontEndOnly'), r.frontEndOnly.map((x) => t('migrate.report.rule', { name: x.field ? `${x.table}.${x.field}` : x.table, what: t(rule[x.what]) }))],
    [t('migrate.report.approximated'), r.approximated.map((x) => t('migrate.report.approx', { name: `${x.table}.${x.field}`, type: x.serverType }))],
    [t('migrate.report.queries'), r.queries.map((x) => x.error === 'bc:unreadable' ? t('migrate.report.unreadable', { name: x.name }) : t('migrate.report.query', { name: x.name, error: errorText(x.error, t) }))],
  ];
  return sections.filter(([, lines]) => lines.length);
}

/** The lines above the sections: the backup copy, the server, then R13's check when it failed. */
export const reportHead = (r: MigrationReport, t: TFunction): string[] =>
  [t('migrate.done', { backup: r.backupPath }), t('migrate.server', { product: SERVER_PRODUCTS.get(r.kind) ?? r.kind, server: r.server, schema: r.schema }),
    ...(r.queriesUnchecked !== undefined ? [t('migrate.queriesUnchecked', { detail: errorText(r.queriesUnchecked, t) })] : [])];

/** R16: the report as the dialog shows it, one line per entry (the clipboard's text). */
export function reportText(r: MigrationReport, t: TFunction): string {
  return [...reportHead(r, t), ...reportSections(r, t).flatMap(([head, lines]) => ['', head, ...lines.map((l) => `  ${l}`)])].join('\n');
}

/** A refusal or a failure as its paragraphs (R9): what changed — nothing, or tables that stayed on the server — and the backup. */
export function resultLines(r: Exclude<MigrateResult, { ok: true }>, t: TFunction): string[] {
  const backup = 'backupPath' in r && r.backupPath ? [t('migrate.backup', { backup: r.backupPath })] : [];
  switch (r.reason) {
    case 'readOnly': return [t('dialog.op.readOnly')];
    case 'noTables': case 'dataFile': return [t(`migrate.${r.reason}`)];
    case 'noSchema': return [t('migrate.noSchema', { schema: r.schema })];
    case 'nameTaken': case 'nameTooLong': case 'invalidDesign': return [t(`migrate.${r.reason}`, { names: r.names.join(', ') })];
    case 'cancelled': return [t('migrate.cancelled'), ...backup];
    case 'failed': {
      const error = errorText(r.error, t).replace(/[.。]\s*$/, '');
      if (!r.left) {
        const table = r.table === undefined ? undefined : r.field ? `${r.table}.${r.field}` : r.table;
        return [table === undefined ? t('migrate.failedNoTable', { error }) : t('migrate.failed', { table, error }),
          ...(r.closed ? [t('migrate.closed')] : []), ...backup];
      }
      const names = r.left.join(', ');
      // a COMMIT lost or Stopped on the way (run.ts): its outcome is unknown, every table may be on the server
      if (r.unknown) return [t('migrate.commitUnknown'), t('migrate.leftMaybe', { names }), ...backup];
      return [t('migrate.switchFailed', { error }), ...(r.left.length ? [t('migrate.left', { names }), t('migrate.leftCheck')] : [t('migrate.dropped')]), ...backup];
    }
  }
}

/** The run's rejection as its paragraphs: a Stop that ended the data process (bc:cancelled, ipc.ts cancelCall) is the run's own
 *  cancelled, with the backup copy once made (its first progress event); anything else, the shell's error message. */
export function rejectedLines(e: unknown, backupPath: string | undefined, t: TFunction): string[] {
  if (bcErrorCode(e) === 'cancelled') return resultLines({ ok: false, reason: 'cancelled', ...(backupPath !== undefined && { backupPath }) }, t);
  const m = errorMessage(e);
  return [t(m.key, m.params)];
}

import { describe, expect, it } from 'vitest';
import type { MigrateResult, MigrationReport } from '../../shared/migrate';
import { UI_LANGUAGES } from '../../shared/i18n';
import { i18n } from '../i18n';
import { rejectedLines, reportText, resultLines } from './migrate-report';

const en = i18n.getFixedT('en');
const fr = i18n.getFixedT('fr');
const REPORT: MigrationReport = {
  kind: 'sqlserver', server: 'db.example:1433/ventes', schema: 'dbo', backupPath: 'C:\\b\\Ventes.backup-1.basecraft',
  tables: [{ name: 'Clients', rows: 4, nextId: 5, version: 'bc_rowversion' }, { name: 'Journal', rows: 0 }],
  indexes: [{ table: 'Clients', name: 'Clients_Nom', unique: true }],
  relations: [{ name: 'ClientsCommandes', result: 'created' }, { name: 'R2', result: 'noAction' }, { name: 'R3', result: 'notEnforced' }],
  approximated: [{ table: 'Clients', field: 'Site', serverType: 'nvarchar(max)' }],
  frontEndOnly: [{ table: 'Commandes', field: 'Montant', what: 'validationRule' }, { table: 'Commandes', what: 'tableRule' }],
  queries: [{ name: 'QNoms', error: 'bc:serverFunction|Format|sqlserver' }],
};
it('an unreadable object is listed as not checked', () => {
  expect(reportText({ ...REPORT, tables: [], indexes: [], relations: [], approximated: [], frontEndOnly: [], queries: [{ name: 'QBad', error: 'bc:unreadable' }] }, en))
    .toContain('QBad: unreadable definition, not checked');
});

it('an R13 check that failed says the queries could not be checked (one line, every language)', () => {
  const r = { ...REPORT, queries: [], queriesUnchecked: 'bc:linkUnavailable|cannotConnect|db.example:1433/ventes' };
  expect(reportText(r, fr)).toContain(`Les requêtes n'ont pas pu être vérifiées sur le serveur : ${fr('dialog.error.linkUnavailable_cannotConnect', { detail: 'db.example:1433/ventes' })}`);
  expect(reportText(r, en)).toContain('The queries could not be checked against the server: ');
  for (const l of UI_LANGUAGES) expect(reportText(r, i18n.getFixedT(l)), l).not.toMatch(/migrate\.|\{\{|dialog\.error/);
  expect(reportText(REPORT, en)).not.toContain('could not be checked');
});

it('a Stop that ended the data process (the run rejected bc:cancelled): cancelled, with the backup copy once made', () => {
  const stopped = new Error("Error invoking remote method 'bc:migrate:run': Error: bc:cancelled");
  const backupPath = 'C:\\b\\x.basecraft';
  expect(rejectedLines(stopped, backupPath, fr)).toEqual(["Migration annulée : rien n'a été modifié.", `Copie de sauvegarde : ${backupPath}.`]);
  expect(rejectedLines(stopped, undefined, fr)).toEqual(["Migration annulée : rien n'a été modifié."]);
  expect(rejectedLines(new Error('bc:busy'), backupPath, en)).toEqual([en('dialog.error.busy')]);
});

describe('migrate report (R16)', () => {
  it('one line per entry, the sections as the dialog shows them', () => {
    expect(reportText(REPORT, en).split('\n')).toEqual([
      'Move complete. Backup copy: C:\\b\\Ventes.backup-1.basecraft.', 'SQL Server server: db.example:1433/ventes, schema dbo.',
      '', 'Tables moved', '  Clients: 4 record(s), next AutoNumber: 5, version column: bc_rowversion', '  Journal: 0 record(s)',
      '', 'Indexes created', '  Clients: Clients_Nom (no duplicates)',
      '', 'Relationships', '  ClientsCommandes: foreign key created',
      '  R2: foreign key created without cascades (SQL Server refuses several cascade paths to one table)',
      '  R3: referential integrity not enforced, nothing created on the server',
      '', 'Enforced by the application only (not by the server)', '  Commandes.Montant: Validation Rule', '  Commandes: Record Validation Rule',
      '', 'Stored as another type on the server', '  Clients.Site: nvarchar(max)',
      '', 'Queries the server refuses', `  QNoms: ${en('dialog.error.serverFunction', { name: 'Format', detail: 'SQL Server' })}`,
    ]);
    // empty sections are left out
    expect(reportText({ ...REPORT, indexes: [], approximated: [], queries: [], frontEndOnly: [], relations: [] }, fr).split('\n')).toEqual([
      'Migration terminée. Copie de sauvegarde : C:\\b\\Ventes.backup-1.basecraft.', 'Serveur SQL Server : db.example:1433/ventes, schéma dbo.',
      '', 'Tables déplacées', '  Clients : 4 enregistrement(s), prochain NuméroAuto : 5, colonne de version : bc_rowversion', '  Journal : 0 enregistrement(s)',
    ]);
  });

  it('every refusal and failure has its text in every language; a COMMIT whose outcome is unknown says the tables may be on the server', () => {
    const backupPath = 'C:\\b\\x.basecraft';
    const all: Exclude<MigrateResult, { ok: true }>[] = [
      { ok: false, reason: 'readOnly' }, { ok: false, reason: 'noTables' }, { ok: false, reason: 'dataFile' },
      { ok: false, reason: 'cancelled', backupPath }, { ok: false, reason: 'noSchema', schema: 'ventes' },
      { ok: false, reason: 'nameTaken', names: ['Clients', 'Commandes'] }, { ok: false, reason: 'nameTooLong', names: ['T.F'] },
      { ok: false, reason: 'invalidDesign', names: ['Clients.Nom'] },
      { ok: false, reason: 'failed', error: 'bc:migrateCount|Commandes|5|4', table: 'Commandes', backupPath },
      { ok: false, reason: 'failed', error: 'bc:migrateUnlinkable|Commandes|key', table: 'Commandes', backupPath },
      { ok: false, reason: 'failed', error: 'bc:migrateOneNull|P.Code|PQ', table: 'P', field: 'Code', backupPath },
      { ok: false, reason: 'failed', error: 'bc:copyFailed|EACCES' },
      { ok: false, reason: 'failed', error: 'bc:cancelled', unknown: true, left: ['Clients', 'Commandes'], backupPath },
      { ok: false, reason: 'failed', error: 'bc:busy', left: [], backupPath },
      { ok: false, reason: 'failed', error: 'bc:busy', left: ['Journal'], backupPath },
      { ok: false, reason: 'failed', error: 'bc:serverError|23502|null value', table: 'Commandes', field: 'Montant', closed: true, backupPath },
    ];
    for (const l of UI_LANGUAGES) {
      const t = i18n.getFixedT(l);
      for (const r of all) for (const line of resultLines(r, t)) expect(line, `${l} ${JSON.stringify(r)}`).not.toMatch(/migrate\.|\{\{|dialog\.error/);
    }
    expect(resultLines(all[3]!, fr)).toEqual(['Migration annulée : rien n\'a été modifié.', `Copie de sauvegarde : ${backupPath}.`]);
    expect(resultLines(all[5]!, fr)).toEqual(['Le serveur a déjà des tables de ces noms : Clients, Commandes. Supprimez-les ou choisissez un autre schéma.']);
    expect(resultLines(all[8]!, en)[0]).toBe('The move failed (Commandes): The server counts 4 record(s) in Commandes instead of 5. Nothing was changed on the server or in the database.');
    expect(resultLines(all[10]!, en)[0]).toMatch(/^The move failed \(P\.Code\): The field P\.Code holds several Null values/);
    expect(resultLines(all[11]!, en)).toHaveLength(1); // no backup made
    const unknown = resultLines(all[12]!, en);
    expect(unknown.join(' ')).toContain('These tables may be on the server: Clients, Commandes. Check them and delete them before moving again.');
    expect(unknown.join(' ')).not.toMatch(/nothing was changed/i);
    expect(unknown.at(-1)).toBe(`Backup copy: ${backupPath}.`);
    // keyed on the flag, not on the error text
    expect(resultLines({ ...all[12]!, error: 'bc:busy' } as typeof all[0], en).join(' ')).toContain('may be on the server');
    expect(resultLines({ ...all[12]!, unknown: undefined } as typeof all[0], en).join(' ')).not.toContain('may be on the server');
    expect(resultLines(all[13]!, en).join(' ')).toContain('The copied tables were deleted from the server.');
    expect(resultLines(all[14]!, en).join(' ')).toContain('These tables were left on the server: Journal. Check them and delete them before moving again.');
    // a refusal whose ROLLBACK failed: the refusal named, the connection closed, never "cannot connect"
    const closed = resultLines(all[15]!, en);
    expect(closed[0]).toMatch(/^The move failed \(Commandes\.Montant\): /);
    expect(closed.slice(1)).toEqual(['The connection to the server was closed.', `Backup copy: ${backupPath}.`]);
  });
});

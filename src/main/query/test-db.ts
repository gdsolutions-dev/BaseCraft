// Test base of the A3 plan (Clients / Commandes), reused by every query task. The relation comes with seedSalesRelation (Task 6).
import type { DatabaseSync } from 'node:sqlite';
import { saveRelation } from '../db/relations';
import { createTable } from '../db/schema';
import { localeInfo } from '../../shared/locale-format';
import { f, t } from '../../shared/test-fixtures';

export function seedSales(db: DatabaseSync): void {
  createTable(db, t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText', { required: true }), f('Ville', 'shortText')]));
  createTable(db, t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }),
    f('Montant', 'currency', { validationRule: '>0' }), f('Le', 'dateTime')]));
  const c = db.prepare('INSERT INTO "Clients" ("Nom", "Ville") VALUES (?, ?)');
  for (const r of [['Dupont', 'Lyon'], ['Martin', 'LYON'], ['Durand', 'Paris'], ['Éric', 'Lyôn']]) c.run(...r);
  const o = db.prepare('INSERT INTO "Commandes" ("Client", "Montant", "Le") VALUES (?, ?, ?)');
  for (const r of [[1, 10.1, '2026-10-01'], [1, 0.1, '2026-10-05'], [2, 0.2, '2026-10-21'], [3, 99.99, '2026-09-30'], [2, 0.1, '2026-10-21']]) {
    o.run(r[0], r[1], `${r[2]} 00:00:00`);
  }
}

/** The ClientsCommandes relation (N° → Client, enforced, joinType 1), through A2's saveRelation. */
export function seedSalesRelation(db: DatabaseSync): void {
  const r = saveRelation(db, { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
    enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 }, null, localeInfo('fr-FR'));
  if (!r.ok) throw new Error(`seedSalesRelation: ${r.reason}`);
}

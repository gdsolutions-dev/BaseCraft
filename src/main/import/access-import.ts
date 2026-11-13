// Access import (E1): the picked tables of an Access file, with their rows and relationships, copied into the open base. The copy
// is one transaction (all or nothing); relationships are applied after it, one by one, and what cannot be carried goes to the report.
import type { DatabaseSync } from 'node:sqlite';
import type MDBReader from 'mdb-reader';
import type { AccessExport } from '../../shared/access-export';
import type { AccessImportResult, ReportLine } from '../../shared/access-import';
import type { Relation } from '../../shared/api';
import { quoteIdent, sameName, type TableDesign } from '../../shared/field-types';
import type { ImportProgress } from '../../shared/import-text';
import type { LocaleInfo } from '../../shared/locale-format';
import { saveRelation } from '../db/relations';
import { createTable } from '../db/schema';
import { inTransactionAsync } from '../db/tx';
import { accessDesign, stored } from '../links/access';
import { withStructure } from './access-structure';

/** One row of MSysRelationships: one field pair of a relationship (szObject: the child table, szReferencedObject: the parent). */
export interface MSysRelRow { szRelationship: string; grbit: number; ccolumn: number; icolumn: number;
  szObject: string; szColumn: string; szReferencedObject: string; szReferencedColumn: string }

/** `local`: Access table name → local name of the tables imported. Relationships of system tables (a table whose name starts
 *  with "MSys") are left out silently; one whose table is not in `local` is `skipped` with reason 'tableNotImported'. */
export function accessRelations(rows: MSysRelRow[], local: ReadonlyMap<string, string>):
  { relations: { access: string; rel: Relation }[]; skipped: { access: string; reason: 'tableNotImported' }[] } {
  const groups = new Map<string, MSysRelRow[]>();
  for (const r of rows) groups.set(r.szRelationship, [...(groups.get(r.szRelationship) ?? []), r]);
  const relations: { access: string; rel: Relation }[] = [];
  const skipped: { access: string; reason: 'tableNotImported' }[] = [];
  for (const [access, g] of groups) {
    const { szObject: child, szReferencedObject: parent, grbit } = g[0];
    if (/^MSys/i.test(child) || /^MSys/i.test(parent)) continue;
    const parentTable = local.get(parent); const childTable = local.get(child);
    if (!parentTable || !childTable) { skipped.push({ access, reason: 'tableNotImported' }); continue; }
    const pairs = [...g].sort((a, b) => a.icolumn - b.icolumn);
    relations.push({ access, rel: {
      name: '', parentTable, parentFields: pairs.map((p) => p.szReferencedColumn), childTable, childFields: pairs.map((p) => p.szColumn),
      enforce: !(grbit & 0x2), cascadeUpdate: !!(grbit & 0x100), cascadeDelete: !!(grbit & 0x1000),
      joinType: grbit & 0x01000000 ? 2 : grbit & 0x02000000 ? 3 : 1 } });
  }
  return { relations, skipped };
}

export const PAGE = 1000;
/** The page size: BASECRAFT_E2E_IMPORT_PAGE only under BASECRAFT_E2E=1 (so the e2e suite can reach Stop on a small file). */
export const pageSize = () => (process.env.BASECRAFT_E2E === '1' ? Number(process.env.BASECRAFT_E2E_IMPORT_PAGE) || PAGE : PAGE);

/** `tables`: picked tables, `remote` in the file, `name` free in `front`. Stop: `stopped()` read after every tick. */
export async function importAccess(d: { front: DatabaseSync; r: MDBReader; jet3: boolean; source: string;
  tables: { remote: string; name: string }[]; linked: string[]; info: LocaleInfo;
  tick: (p: ImportProgress) => Promise<void>; stopped: () => boolean;
  /** The export folder of the file (E2): its tables, matched to `tables[].remote` by sameName, give exact keys, indexes and properties. */
  structure?: AccessExport }): Promise<AccessImportResult> {
  const read = d.tables.map((t) => ({ ...t, table: d.r.getTable(t.remote) }));
  const total = read.reduce((n, t) => n + t.table.rowCount, 0);
  const lines: ReportLine[] = [];
  let done = 0;
  let missing = false; // a picked table the export does not hold
  try {
    await inTransactionAsync(d.front, async () => {
      for (const { name, remote, table } of read) {
        const { design: d0, skipped } = accessDesign(table, d.jet3);
        const plain = { ...d0, name };
        const ext = d.structure?.tables.find((x) => sameName(x.name, remote));
        if (!ext) missing = true;
        const first = ext ? withStructure(plain, ext) : undefined;
        const start = done;
        // Copies the table's rows into a table made from `design`; the values lost per field are counted in `lost`.
        const copy = async (design: TableDesign) => {
          done = start;
          createTable(d.front, design);
          const ins = d.front.prepare(`INSERT INTO ${quoteIdent(name)} (${design.fields.map((f) => quoteIdent(f.name)).join(', ')}) VALUES (${design.fields.map(() => '?').join(', ')})`);
          const columns = design.fields.map((f) => f.name);
          const lost = new Map<string, number>();
          const size = pageSize();
          for (let offset = 0; offset < table.rowCount; offset += size) {
            const page = table.getData({ columns, rowOffset: offset, rowLimit: size });
            for (const row of page) {
              ins.run(...design.fields.map((f) => {
                const v = stored(f, row[f.name]);
                if (v === null && row[f.name] !== null && row[f.name] !== undefined) lost.set(f.name, (lost.get(f.name) ?? 0) + 1);
                return v;
              }));
            }
            done += page.length;
            await d.tick({ done, total, label: name });
            if (d.stopped()) throw new Error('bc:cancelled');
          }
          return lost;
        };
        // One savepoint per table: a row refused by the carried structure redoes the table from the plain design.
        d.front.exec('SAVEPOINT bcx_import_table');
        let lost: Map<string, number>; let design = plain; let structured = !!first?.applied;
        try {
          design = first?.applied ? first.design : plain;
          lost = await copy(design);
        } catch (e) {
          // Any failure of the first attempt other than Stop is retried once with the plain design; a second failure propagates.
          if (!structured || (e instanceof Error && e.message === 'bc:cancelled')) throw e;
          d.front.exec('ROLLBACK TO bcx_import_table');
          structured = false; design = plain;
          lost = await copy(design);
        }
        d.front.exec('RELEASE bcx_import_table');
        lines.push({ code: 'tableImported', object: name, n: table.rowCount });
        if (structured) lines.push({ code: 'structureExact', object: name }, ...first!.lines);
        else {
          const key = design.fields.find((f) => f.props.type === 'autoNumber');
          lines.push(key ? { code: 'keyAssumed', object: name, part: key.name } : { code: 'keyNotRead', object: name });
          if (first) lines.push(...first.lines, { code: 'structureNotRead', object: name });
        }
        for (const c of skipped) lines.push({ code: 'fieldSkipped', object: name, part: c });
        for (const [part, n] of lost) lines.push({ code: 'valuesLost', object: name, part, n });
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'bc:cancelled') return { ok: false, reason: 'cancelled' };
    throw e;
  }
  for (const object of d.linked) lines.push({ code: 'tableLinked', object });

  await d.tick({ done: total, total, finishing: true });
  let rows: MSysRelRow[] = [];
  try { rows = d.r.getTable('MSysRelationships').getData() as unknown as MSysRelRow[]; } catch { /* a file without the table has no relationship */ }
  const { relations, skipped } = accessRelations(rows, new Map(d.tables.map((t) => [t.remote, t.name])));
  for (const { access, rel } of relations) {
    let res = saveRelation(d.front, rel, null, d.info);
    if (!res.ok && rel.enforce && (res.reason === 'parentNotUnique' || res.reason === 'violations')) {
      const reason = res.reason;
      res = saveRelation(d.front, { ...rel, enforce: false, cascadeUpdate: false, cascadeDelete: false }, null, d.info);
      if (res.ok) { lines.push({ code: 'relationNotEnforced', object: res.relation.name, reason }); continue; }
    }
    lines.push(res.ok ? { code: 'relationCreated', object: res.relation.name } : { code: 'relationIgnored', object: access, reason: res.reason });
  }
  for (const s of skipped) lines.push({ code: 'relationIgnored', object: s.access, reason: s.reason });
  if (missing) lines.push({ code: 'structureNotRead' });
  lines.push({ code: 'tablesOnly' });
  return { ok: true, tables: read.map((t) => ({ name: t.name, remote: t.remote, rows: t.table.rowCount })), report: { source: d.source, lines } };
}

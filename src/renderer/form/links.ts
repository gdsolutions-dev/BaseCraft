// Sous-formulaires (module pur) : champs pères/fils (Link Master/Child Fields), valeurs du père qui filtrent le fils, liens proposés
// en mode Création d'après les relations, puis la clé primaire du père.
import type { Relation } from '../../shared/api';
import type { SqlValue } from '../../shared/coerce';
import { sameName } from '../../shared/field-types';
import type { RecordSourceRef, SourceInfo } from '../../shared/record-source';
import type { RecordSnapshot } from './record-controller';

/** Nested subforms at most (the form itself counted), as Access. */
export const MAX_SUBFORM_DEPTH = 7;

/** 'N°;Pays' -> ['N°', 'Pays'] (spaces removed, empty names dropped). */
export function splitFields(text: string | undefined): string[] {
  return (text ?? '').split(';').map((s) => s.trim()).filter(Boolean);
}

/** The master record's stored values of its link fields; null when one is Null or unknown, or when the record is new and not
 *  saved (or there is none): the subform then shows no record and allows no addition. */
export function masterValues(masterFields: string[], snap: RecordSnapshot): SqlValue[] | null {
  const info = snap.info;
  if (!info || snap.isNew || snap.index >= snap.total) return null;
  const out: SqlValue[] = [];
  for (const n of masterFields) {
    const i = info.fields.findIndex((f) => sameName(f.name, n));
    const v = i < 0 ? null : snap.values[i] ?? null;
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

const tableOf = (info: SourceInfo, ref: RecordSourceRef): string | undefined => (ref.kind === 'table' ? ref.name : info.keyTable);
/** The source's field showing table.field (its origin, else its own name). */
const shown = (info: SourceInfo, table: string, field: string): string | undefined =>
  info.fields.find((f) => (f.origin ? sameName(f.origin.table, table) && sameName(f.origin.field, field) : sameName(f.name, field)))?.name;

/** Link fields for a subform: a relation from the master source's table to the child source's table, else the master's primary
 *  key when the child has fields of the same names; null when neither gives one. */
export function proposeLinks(master: SourceInfo, masterRef: RecordSourceRef, child: SourceInfo, childRef: RecordSourceRef,
  relations: Relation[]): { master: string[]; child: string[] } | null {
  const mt = tableOf(master, masterRef), ct = tableOf(child, childRef);
  if (mt && ct) {
    for (const r of relations) {
      if (!sameName(r.parentTable, mt) || !sameName(r.childTable, ct)) continue;
      const m = r.parentFields.map((f) => shown(master, mt, f));
      const c = r.childFields.map((f) => shown(child, ct, f));
      if (m.length && m.every(Boolean) && c.every(Boolean)) return { master: m as string[], child: c as string[] };
    }
  }
  const keys = master.fields.filter((f) => f.props.primaryKey);
  const c = keys.map((k) => child.fields.find((f) => sameName(f.name, k.name))?.name);
  return keys.length && c.every(Boolean) ? { master: keys.map((k) => k.name), child: c as string[] } : null;
}

// Boîte de dialogue Index (pure) : une ligne par index, comme dans Access. La clé primaire (PrimaryKey) et la propriété Indexé
// des champs y apparaissent avec les index multichamps (IndexDef) ; OK redistribue les lignes entre ces trois formes.
import { isValidObjectName, MAX_INDEX_FIELDS, MAX_INDEXES, sameName, type IndexDef, type IndexField, type TableDesign } from '../../shared/field-types';

/** A row of the dialog; an IndexDef's unknown keys ride along (its own and its fields'). */
export interface IndexRow { name: string; fields: IndexField[]; primary: boolean; unique: boolean; [unknownKey: string]: unknown }

export const PRIMARY_KEY = 'PrimaryKey'; // Access's name for the primary key's index

/** 'PrimaryKey' first, then one row per field with Indexed ≠ No (named as the field), then the multi-field indexes. */
export function indexRows(d: TableDesign): IndexRow[] {
  const pk = d.fields.filter((x) => x.props.primaryKey);
  return [
    ...(pk.length ? [{ name: PRIMARY_KEY, fields: pk.map((x) => ({ name: x.name, desc: false })), primary: true, unique: true }] : []),
    ...d.fields.filter((x) => x.name && x.props.indexed !== 'no')
      .map((x) => ({ name: x.name, fields: [{ name: x.name, desc: false }], primary: false, unique: x.props.indexed === 'yesNoDuplicates' })),
    ...(d.indexes ?? []).map((ix) => ({ ...ix, fields: ix.fields.map((x) => ({ ...x })), primary: false })),
  ];
}

/** The rows back into the design: the primary row is the primary key; a one-field, ascending row named as its field is that
 *  field's Indexed; every other row an IndexDef. A field no row indexes that way gets Indexed = No. */
export function applyIndexRows(d: TableDesign, rows: IndexRow[]): TableDesign {
  const primary = rows.find((r) => r.primary);
  const own = (r: IndexRow) => !r.primary && r.fields.length === 1 && !r.fields[0]!.desc && sameName(r.name, r.fields[0]!.name);
  const indexed = rows.filter(own);
  const indexes: IndexDef[] = rows.filter((r) => !r.primary && !own(r))
    .map(({ primary: _p, ...r }) => ({ ...r, fields: r.fields.map((x) => ({ ...x })) }));
  const { indexes: _old, ...rest } = d;
  return {
    ...rest,
    fields: d.fields.map((fd) => {
      const row = indexed.find((r) => sameName(r.fields[0]!.name, fd.name));
      const primaryKey = !!primary?.fields.some((x) => sameName(x.name, fd.name));
      const value = row ? (row.unique ? 'yesNoDuplicates' : 'yesDuplicates') : 'no';
      return fd.props.primaryKey === primaryKey && fd.props.indexed === value ? fd : { ...fd, props: { ...fd.props, primaryKey, indexed: value } };
    }),
    ...(indexes.length ? { indexes } : {}),
  };
}

/** The first problem of the rows (an i18n key), or null. `fields`: the table's field names. */
export function indexRowsError(rows: IndexRow[], fields: string[]): string | null {
  if (rows.length > MAX_INDEXES) return 'indexes.tooManyIndexes';
  if (rows.filter((r) => r.primary).length > 1) return 'indexes.twoPrimary';
  for (const [i, r] of rows.entries()) {
    if (!r.name.trim()) return 'indexes.emptyName';
    if (!isValidObjectName(r.name)) return 'indexes.invalidName';
    if (rows.slice(0, i).some((o) => sameName(o.name, r.name))) return 'indexes.duplicateName';
    if (!r.fields.length) return 'indexes.noField';
    if (r.fields.length > MAX_INDEX_FIELDS) return 'indexes.tooManyFields';
    for (const [j, x] of r.fields.entries()) {
      if (!fields.some((n) => sameName(n, x.name))) return 'indexes.unknownField';
      if (r.fields.slice(0, j).some((o) => sameName(o.name, x.name))) return 'indexes.fieldTwice';
    }
  }
  return null;
}

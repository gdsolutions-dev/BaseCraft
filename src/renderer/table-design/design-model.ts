// Modèle du mode Création (réducteur pur). Chaque ligne garde le nom du champ dont elle provient (sourceName),
// ce qui permet à l'enregistrement de distinguer un renommage d'un champ supprimé puis recréé.
import type { SaveTableRequest } from '../../shared/api';
import type { ExprErrorCode } from '../../shared/expr/ast';
import type { MaskErrorCode } from '../../shared/expr/input-mask';
import {
  changeType, defaultProps, renamedIndexes, renamedRule, LOOKUP_TEXT_KEYS, lookupRowShown, MASK_TYPES, sameName, type FieldProps, type FieldType, type IndexDef, type TableDesign,
} from '../../shared/field-types';

export interface DesignRow { key: string; name: string; props: FieldProps; sourceName: string | null }
export interface DesignModel {
  originalName: string | null; description: string; rows: DesignRow[]; selected: number; dirty: boolean; extra?: Record<string, unknown>
  /** The table's rule (canonical, naming the fields by their source names until the save) and its text. */
  validationRule?: string; validationText?: string
  /** The Indexes dialog's multi-field indexes, naming their fields by row key: a rename needs nothing, a swap stays a swap. */
  indexes?: ModelIndex[]
  /** Expressions or masks typed but unreadable, by `rowKey:prop` (the prop keeps its last valid value); the save refuses while any. */
  invalid: Record<string, InvalidCode>
}
/** An IndexDef with its fields by row key; unknown keys (of the index, of each field) ride along to the save. */
export interface ModelIndex { name: string; fields: { key: string; desc: boolean; [unknownKey: string]: unknown }[]; unique: boolean; [unknownKey: string]: unknown }
/** badCount, badWidths, badListWidth: the Lookup tab's typed properties (numbers, column widths, list width). */
export type InvalidCode = ExprErrorCode | MaskErrorCode | 'badCount' | 'badWidths' | 'badListWidth';
export type DesignAction =
  | { type: 'addRow'; at?: number } | { type: 'deleteRows'; indices: number[] } | { type: 'moveRow'; from: number; to: number }
  | { type: 'setName'; index: number; name: string } | { type: 'setType'; index: number; fieldType: FieldType }
  | { type: 'setDescription'; description: string } // the table's, set from the Properties dialog: not an edit of this design
  | { type: 'setTableProp'; name: 'description' | 'validationRule' | 'validationText'; value: string | undefined } // Property Sheet
  | { type: 'setIndexes'; design: TableDesign } // the Indexes dialog's answer over designOf(m): one field per row, in order
  | { type: 'setProp'; index: number; key: string; value: unknown } | { type: 'setInvalid'; index: number; key: string; code: InvalidCode | null } | { type: 'togglePrimaryKey'; indices: number[] } | { type: 'select'; index: number };

/** setInvalid's index -1: an entry of the table's Property Sheet, kept under `table:<prop>` (no row key starts with "table"). */
export const TABLE_KEY = 'table';
let seq = 0;
const row = (name: string, props: FieldProps, sourceName: string | null): DesignRow => ({ key: `r${++seq}`, name, props, sourceName });
const blankRow = () => row('', defaultProps('shortText'), null);

/** IndexDefs (fields by name) as model indexes over `rows` (an unknown name is left out, an index left empty too). */
function keyedIndexes(indexes: IndexDef[] | undefined, rows: DesignRow[]): { indexes?: ModelIndex[] } {
  const out = (indexes ?? []).map((ix) => ({
    ...ix,
    fields: ix.fields.flatMap(({ name, ...rest }) => {
      const r = rows.find((y) => y.name === name) ?? rows.find((y) => sameName(y.name, name));
      return r ? [{ ...rest, key: r.key }] : [];
    }),
  })).filter((ix) => ix.fields.length);
  return out.length ? { indexes: out } : {};
}
/** The model's indexes with the fields named by `nameOf` their row. */
const namedIndexes = (m: DesignModel, nameOf: (r: DesignRow) => string): IndexDef[] => (m.indexes ?? []).map((ix) => ({
  ...ix, fields: ix.fields.map(({ key, ...rest }) => ({ ...rest, name: nameOf(m.rows.find((r) => r.key === key)!) })),
}));
/** The design as edited (every row, current names): what the Indexes dialog works on. */
export const designOf = (m: DesignModel, name: string): TableDesign => {
  const indexes = namedIndexes(m, (r) => r.name);
  return { name, fields: m.rows.map((r) => ({ name: r.name, props: r.props })), ...(indexes.length ? { indexes } : {}) };
};

/** A row the user never touched: the save ignores it, as Access ignores empty lines. */
function isBlank(r: DesignRow): boolean {
  return r.name === '' && r.sourceName === null && JSON.stringify(r.props) === JSON.stringify(defaultProps('shortText'));
}

/** description: the table's description last set from the Properties dialog (DocTab.description), newer than a load
 *  that was already on its way. */
export function fromDesign(d: TableDesign, description?: string): DesignModel {
  const rows = d.fields.map((x) => row(x.name, { ...x.props }, x.name));
  return {
    originalName: d.name, description: description ?? d.description ?? '', selected: 0, dirty: false, invalid: {}, rows,
    ...keyedIndexes(d.indexes, rows),
    ...(d.extra ? { extra: d.extra } : {}),
    ...(d.validationRule ? { validationRule: d.validationRule } : {}), ...(d.validationText ? { validationText: d.validationText } : {}),
  };
}

export function emptyDesign(): DesignModel {
  return { originalName: null, description: '', rows: [], selected: 0, dirty: false, invalid: {} };
}

export function designReducer(m: DesignModel, a: DesignAction): DesignModel {
  const rows = [...m.rows];
  const edit = (i: number, fn: (p: FieldProps) => FieldProps): DesignModel =>
    rows[i] ? { ...m, rows: rows.map((r, j) => (j === i ? { ...r, props: fn(r.props) } : r)), dirty: true } : m;
  switch (a.type) {
    case 'select': return { ...m, selected: a.index };
    case 'setDescription': return { ...m, description: a.description };
    case 'setTableProp': {
      if (a.name === 'description') return { ...m, description: a.value ?? '', dirty: true };
      const { [a.name]: _old, ...rest } = m;
      return { ...rest, ...(a.value ? { [a.name]: a.value } : {}), dirty: true };
    }
    case 'addRow': {
      const at = Math.min(a.at ?? rows.length, rows.length);
      rows.splice(at, 0, blankRow());
      return { ...m, rows, selected: at, dirty: true };
    }
    case 'deleteRows': {
      const left = rows.filter((_, i) => !a.indices.includes(i));
      if (left.length === rows.length) return m;
      const invalid = Object.fromEntries(Object.entries(m.invalid).filter(([k]) => k.startsWith(`${TABLE_KEY}:`) || left.some((r) => k.startsWith(`${r.key}:`))));
      const { indexes: _old, ...rest } = m; // a deleted field leaves its indexes; an index left without a field goes
      const indexes = (m.indexes ?? []).map((ix) => ({ ...ix, fields: ix.fields.filter((x) => left.some((r) => r.key === x.key)) })).filter((ix) => ix.fields.length);
      return { ...rest, ...(indexes.length ? { indexes } : {}), rows: left, invalid, selected: Math.max(0, Math.min(Math.min(...a.indices), left.length - 1)), dirty: true };
    }
    case 'moveRow': {
      if (!rows[a.from] || a.to < 0 || a.to >= rows.length) return m;
      rows.splice(a.to, 0, ...rows.splice(a.from, 1));
      return { ...m, rows, selected: a.to, dirty: true };
    }
    case 'setName':
      return rows[a.index] ? { ...m, rows: rows.map((r, j) => (j === a.index ? { ...r, name: a.name } : r)), dirty: true } : m;
    case 'setType': {
      const r = rows[a.index];
      if (!r) return m;
      const typed = edit(a.index, (p) => {
        const next = changeType(p, a.fieldType);
        // R7: an AutoNumber is the table's key (changeType itself stays literal).
        return a.fieldType === 'autoNumber' ? { ...next, primaryKey: true, indexed: 'yesNoDuplicates' } : next;
      });
      // An unreadable entry of a property the new type does not have is gone with its control: it must not block the save.
      const props = typed.rows[a.index]!.props;
      const gone = (prop: string) => (prop === 'inputMask' ? !MASK_TYPES.includes(a.fieldType) : a.fieldType === 'autoNumber' || hiddenLookup(props, prop));
      const invalid = Object.fromEntries(Object.entries(m.invalid).filter(([k]) => !(k.startsWith(`${r.key}:`) && gone(k.slice(r.key.length + 1)))));
      return { ...typed, invalid };
    }
    case 'setProp': {
      const next = edit(a.index, (p) => {
        const props: Record<string, unknown> = { ...p, [a.key]: a.value };
        if (a.value === undefined || a.value === '') delete props[a.key]; // cleared caption/description: absent, so the save removes it
        return props as FieldProps;
      });
      // A Lookup tab row hidden by this change (Text Box, List Box) takes its unreadable entry with it.
      const r = next.rows[a.index];
      if (a.key !== 'lookup' || !r) return next;
      return { ...next, invalid: Object.fromEntries(Object.entries(next.invalid).filter(([k]) => !(k.startsWith(`${r.key}:`) && hiddenLookup(r.props, k.slice(r.key.length + 1))))) };
    }
    case 'setIndexes': {
      const next = rows.map((r, i) => {
        const p = a.design.fields[i]?.props;
        return p && (p.primaryKey !== r.props.primaryKey || p.indexed !== r.props.indexed) ? { ...r, props: { ...r.props, primaryKey: p.primaryKey, indexed: p.indexed } } : r;
      });
      const { indexes: _old, ...rest } = m;
      return { ...rest, ...keyedIndexes(a.design.indexes, next), rows: next, dirty: true };
    }
    case 'setInvalid': {
      const key = a.index === -1 ? TABLE_KEY : rows[a.index]?.key;
      if (key === undefined) return m;
      const { [`${key}:${a.key}`]: _old, ...invalid } = m.invalid;
      return a.code === null ? { ...m, invalid } : { ...m, invalid: { ...invalid, [`${key}:${a.key}`]: a.code }, dirty: true };
    }
    case 'togglePrimaryKey': {
      const sel = a.indices.filter((i) => rows[i]);
      if (!sel.length) return m;
      // As in Access: the selection already is exactly the key → no key; otherwise the selection becomes the key.
      const isKey = rows.every((r, i) => r.props.primaryKey === sel.includes(i));
      return {
        ...m, dirty: true,
        rows: rows.map((r, i) => {
          const pk = !isKey && sel.includes(i);
          if (r.props.primaryKey === pk) return r;
          return { ...r, props: { ...r.props, primaryKey: pk, ...(pk && sel.length === 1 ? { indexed: 'yesNoDuplicates' as const } : {}) } };
        }),
      };
    }
  }
}

/** A Lookup tab property typed as text whose row these props no longer show. */
const hiddenLookup = (p: FieldProps, prop: string) => (LOOKUP_TEXT_KEYS as readonly string[]).includes(prop) && !lookupRowShown(p, prop);

export const MAX_FIELD_NAME_CHARS = 64;
/** A field name over 64 characters (counted after NFC, as the core stores names) is refused when it is new or renamed; a
 *  long name an external tool gave a field is kept (C8). */
export const fieldNameTooLong = (r: DesignRow): boolean =>
  r.name !== r.sourceName && [...r.name.normalize('NFC')].length > MAX_FIELD_NAME_CHARS;
export const longFieldNames = (m: DesignModel): DesignRow[] => m.rows.filter(fieldNameTooLong);

export function toSaveRequest(m: DesignModel, tableName: string, allowDataLoss: boolean): SaveTableRequest {
  const rows = m.rows.filter((r) => !isBlank(r));
  return {
    originalName: m.originalName,
    allowDataLoss,
    design: {
      name: tableName,
      ...(m.description ? { description: m.description } : {}),
      fields: rows.map((r) => ({ name: r.name, props: r.props })),
      ...(m.extra ? { extra: m.extra } : {}),
      ...(m.validationRule ? { validationRule: m.validationRule } : {}), // with the source names: alterTable follows the renames
      ...(m.validationText ? { validationText: m.validationText } : {}),
      ...(m.indexes ? { indexes: namedIndexes(m, (r) => r.sourceName ?? r.name) } : {}), // source names too
    },
    mapping: rows.map((r) => ({ name: r.name, sourceName: r.sourceName })),
  };
}

/** Access's "Yes" to "no primary key": an existing AutoNumber becomes the key, else a new one is added at the top. */
export function withDefaultPrimaryKey(m: DesignModel, idName: string): DesignModel {
  const auto = m.rows.findIndex((r) => r.props.type === 'autoNumber');
  if (auto >= 0) return designReducer(m, { type: 'togglePrimaryKey', indices: [auto] });
  const taken = (n: string) => m.rows.some((r) => sameName(r.name, n));
  let name = idName;
  for (let n = 1; taken(name); n++) name = `${idName}${n}`;
  return { ...m, rows: [row(name, defaultProps('autoNumber'), null), ...m.rows], selected: 0, dirty: true };
}

/** The model right after a successful save: the saved fields are now the table's fields (sourceName = name), not dirty. */
export function savedModel(m: DesignModel, req: SaveTableRequest): DesignModel {
  const { validationRule: rule, indexes } = req.design;
  const next = fromDesign({ // as alterTable stored it
    ...req.design, ...(rule ? { validationRule: renamedRule(rule, req.mapping) } : {}), ...(indexes ? { indexes: renamedIndexes(indexes, req.mapping) } : {}),
  });
  return { ...next, selected: Math.min(m.selected, next.rows.length) };
}

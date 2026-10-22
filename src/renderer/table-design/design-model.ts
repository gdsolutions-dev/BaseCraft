// Modèle du mode Création (réducteur pur). Chaque ligne garde le nom du champ dont elle provient (sourceName),
// ce qui permet à l'enregistrement de distinguer un renommage d'un champ supprimé puis recréé.
import type { SaveTableRequest } from '../../shared/api';
import type { ExprErrorCode } from '../../shared/expr/ast';
import type { MaskErrorCode } from '../../shared/expr/input-mask';
import { changeType, defaultProps, MASK_TYPES, sameName, type FieldProps, type FieldType, type TableDesign } from '../../shared/field-types';

export interface DesignRow { key: string; name: string; props: FieldProps; sourceName: string | null }
export interface DesignModel {
  originalName: string | null; description: string; rows: DesignRow[]; selected: number; dirty: boolean; extra?: Record<string, unknown>
  /** Expressions or masks typed but unreadable, by `rowKey:prop` (the prop keeps its last valid value); the save refuses while any. */
  invalid: Record<string, InvalidCode>
}
export type InvalidCode = ExprErrorCode | MaskErrorCode;
export type DesignAction =
  | { type: 'addRow'; at?: number } | { type: 'deleteRows'; indices: number[] } | { type: 'moveRow'; from: number; to: number }
  | { type: 'setName'; index: number; name: string } | { type: 'setType'; index: number; fieldType: FieldType }
  | { type: 'setProp'; index: number; key: string; value: unknown } | { type: 'setInvalid'; index: number; key: string; code: InvalidCode | null } | { type: 'togglePrimaryKey'; indices: number[] } | { type: 'select'; index: number };

let seq = 0;
const row = (name: string, props: FieldProps, sourceName: string | null): DesignRow => ({ key: `r${++seq}`, name, props, sourceName });
const blankRow = () => row('', defaultProps('shortText'), null);

/** A row the user never touched: the save ignores it, as Access ignores empty lines. */
function isBlank(r: DesignRow): boolean {
  return r.name === '' && r.sourceName === null && JSON.stringify(r.props) === JSON.stringify(defaultProps('shortText'));
}

export function fromDesign(d: TableDesign): DesignModel {
  return {
    originalName: d.name, description: d.description ?? '', selected: 0, dirty: false, invalid: {},
    rows: d.fields.map((x) => row(x.name, { ...x.props }, x.name)),
    ...(d.extra ? { extra: d.extra } : {}),
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
    case 'addRow': {
      const at = Math.min(a.at ?? rows.length, rows.length);
      rows.splice(at, 0, blankRow());
      return { ...m, rows, selected: at, dirty: true };
    }
    case 'deleteRows': {
      const left = rows.filter((_, i) => !a.indices.includes(i));
      if (left.length === rows.length) return m;
      const invalid = Object.fromEntries(Object.entries(m.invalid).filter(([k]) => left.some((r) => k.startsWith(`${r.key}:`))));
      return { ...m, rows: left, invalid, selected: Math.max(0, Math.min(Math.min(...a.indices), left.length - 1)), dirty: true };
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
      const gone = (prop: string) => (prop === 'inputMask' ? !MASK_TYPES.includes(a.fieldType) : a.fieldType === 'autoNumber');
      const invalid = Object.fromEntries(Object.entries(m.invalid).filter(([k]) => !(k.startsWith(`${r.key}:`) && gone(k.slice(r.key.length + 1)))));
      return { ...typed, invalid };
    }
    case 'setProp':
      return edit(a.index, (p) => {
        const next: Record<string, unknown> = { ...p, [a.key]: a.value };
        if (a.value === undefined || a.value === '') delete next[a.key]; // cleared caption/description: absent, so the save removes it
        return next as FieldProps;
      });
    case 'setInvalid': {
      const r = rows[a.index];
      if (!r) return m;
      const { [`${r.key}:${a.key}`]: _old, ...invalid } = m.invalid;
      return a.code === null ? { ...m, invalid } : { ...m, invalid: { ...invalid, [`${r.key}:${a.key}`]: a.code }, dirty: true };
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
  const next = fromDesign(req.design);
  return { ...next, selected: Math.min(m.selected, next.rows.length) };
}

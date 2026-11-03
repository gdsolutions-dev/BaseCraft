// BaseCraft's own field and table metadata on a server link (C7 R11): what the migration wizard keeps of the local design, laid
// over the design the connector reads from the server. Pure.
import { sameName, type FieldProps, type TableDesign } from '../../shared/field-types';
import type { RemoteTable } from '../connectors/connector';
import { sanitizeStoredProps, usableProps } from '../db/schema';

export const META_KEYS = ['caption', 'description', 'format', 'decimalPlaces', 'inputMask', 'defaultValue', 'validationRule', 'validationText', 'allowZeroLength', 'lookup', 'indexed'] as const;
export const TYPE_KEYS = ['type', 'numberSize', 'size', 'precision', 'scale'] as const;
export type TypeKey = Pick<FieldProps, (typeof TYPE_KEYS)[number]>;
export interface LinkMeta { table?: Pick<TableDesign, 'description' | 'validationRule' | 'validationText'>;
  fields: Record<string, { props: Partial<FieldProps>; from: TypeKey }> }

const TABLE_KEYS = ['description', 'validationRule', 'validationText'] as const;
/** The keys of `o` among `keys` that are set. */
const pick = (o: object, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.flatMap((k) => (Object.hasOwn(o, k) && (o as Record<string, unknown>)[k] !== undefined ? [[k, (o as Record<string, unknown>)[k]]] : [])));

/** R11: the local design's metadata for `linked` (its read-back design gives `from`), by the linked field's name. */
export function linkMeta(local: TableDesign, linked: RemoteTable): LinkMeta {
  const fields = Object.fromEntries(linked.design.fields.flatMap((x) => {
    const fd = local.fields.find((y) => sameName(y.name, x.name));
    return fd ? [[x.name, { props: pick(fd.props, [...META_KEYS, ...TYPE_KEYS]) as Partial<FieldProps>, from: pick(x.props, TYPE_KEYS) as TypeKey }]] : [];
  }));
  const table = pick(local, TABLE_KEYS);
  return { ...(Object.keys(table).length ? { table } : {}), fields };
}

/** R11: META_KEYS always, TYPE_KEYS while the field's TypeKey equals `from`; a merged field usableProps refuses keeps its own. */
export function withMetadata(design: TableDesign, meta: LinkMeta | undefined): TableDesign {
  if (!meta) return design;
  const fields = design.fields.map((fd) => {
    const m = Object.hasOwn(meta.fields, fd.name) ? meta.fields[fd.name] : undefined;
    if (!m) return fd;
    const typed = TYPE_KEYS.every((k) => fd.props[k] === m.from[k]);
    // the server's type keys go with the server's type: a Decimal(19,4) shown as Currency keeps no precision
    const own = typed ? Object.fromEntries(Object.entries(fd.props).filter(([k]) => !(TYPE_KEYS as readonly string[]).includes(k))) : fd.props;
    const props = sanitizeStoredProps({ ...own, ...pick(m.props, typed ? [...META_KEYS, ...TYPE_KEYS] : META_KEYS) });
    return usableProps(props) ? { name: fd.name, props } : fd;
  });
  return { ...design, ...pick(meta.table ?? {}, TABLE_KEYS), fields };
}

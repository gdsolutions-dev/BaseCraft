// Logique pure du choix d'une source (tables, puis requêtes) : liste, présélection, indice venu du document actif.
import { sameName } from '../../shared/field-types';
import type { RecordSourceRef } from '../../shared/record-source';

export type NamedSource = { kind: 'table' | 'query'; name: string };

export const sourceOptions = (tables: readonly string[], queries: readonly string[]): NamedSource[] => [
  ...tables.map((name) => ({ kind: 'table' as const, name })),
  ...queries.map((name) => ({ kind: 'query' as const, name })),
];

export const refKey = (r: NamedSource): string => `${r.kind}:${r.name}`;

const indexOf = (options: readonly NamedSource[], r: RecordSourceRef | null | undefined): number =>
  !r || r.kind === 'sql' ? -1 : options.findIndex((o) => o.kind === r.kind && sameName(o.name, r.name));

/** Index to select first: `preselect` when it is listed, else the shell's hint (unless `preselect` is null: no preselection
 *  asked), else the first item; -1 when there is nothing to pick. */
export function initialSource(options: readonly NamedSource[], preselect: RecordSourceRef | null | undefined, hint: NamedSource | null): number {
  const given = indexOf(options, preselect);
  if (given >= 0) return given;
  const hinted = preselect === null ? -1 : indexOf(options, hint);
  return hinted >= 0 ? hinted : options.length ? 0 : -1;
}

/**
 * Create › Form and Report, as Access: the navigation pane's table or query, else the record source of its form or report
 * (`definition`, read by the caller), titled with that object's name. Null when there is none: the source picker asks.
 */
export function selectedSource(sel: { kind: string; name: string } | null, definition?: unknown): { ref: RecordSourceRef; name: string } | null {
  if (sel?.kind === 'table' || sel?.kind === 'query') return { ref: { kind: sel.kind, name: sel.name }, name: sel.name };
  if (sel?.kind !== 'form' && sel?.kind !== 'report') return null;
  const ref = (definition as { recordSource?: unknown } | null | undefined)?.recordSource as Partial<RecordSourceRef> | null | undefined;
  if (ref?.kind === 'sql' && typeof ref.sql === 'string') return { ref: { kind: 'sql', sql: ref.sql }, name: sel.name };
  if ((ref?.kind === 'table' || ref?.kind === 'query') && typeof ref.name === 'string') return { ref: { kind: ref.kind, name: ref.name }, name: ref.name };
  return null;
}

/** The shell's hint: the active document when it is a saved table or query, else the navigation pane selection if it is one. */
export function sourceHint(active: { kind: string; name: string; isNew?: boolean } | null, navSelection: { kind: string; name: string } | null): NamedSource | null {
  const asSource = (x: { kind: string; name: string } | null): NamedSource | null =>
    x && (x.kind === 'table' || x.kind === 'query') ? { kind: x.kind, name: x.name } : null;
  return active && !active.isNew && asSource(active) ? asSource(active) : asSource(navSelection);
}

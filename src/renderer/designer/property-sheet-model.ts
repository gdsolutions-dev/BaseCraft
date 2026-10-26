// Feuille de propriétés générique (formulaires A4, états A5), pilotée par PROPERTY_CATALOG : lignes d'un onglet pour la sélection,
// lecture de la valeur effective, contrôle d'une valeur saisie, textes affichés <-> valeurs stockées.
import type { DesignDoc } from '../../shared/design/model';
import { isColorValue } from '../../shared/design/colors';
import { effectiveProp, PROPERTY_CATALOG, type PropertyDescriptor, type PropertyTarget } from '../../shared/design/properties';
import { checkEventValue } from '../../shared/design/events';
import { ExprSyntaxError, type ExprErrorCode } from '../../shared/expr/ast';
import { toCanonical, toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { columnWidthsText, isValidObjectName, parseColumnWidths, sameName } from '../../shared/field-types';
import { resolveFont } from '../../shared/fonts';
import { reportWidth } from '../../shared/report/model';
import type { LocaleInfo } from '../../shared/locale-format';
import type { RecordSourceRef } from '../../shared/record-source';
import { findControl, type PropTarget, type Selection } from './designer-model';
import type { SheetTab } from './sheet-types';
import { MAX_TWIPS } from './units';

export type { SheetTab, PropertySheetContext } from './sheet-types';

export const MIXED: unique symbol = Symbol('mixed');
export interface SheetRow { d: PropertyDescriptor; value: unknown | typeof MIXED; readOnly: boolean }

const TABS = ['format', 'data', 'event', 'other'] as const;
const GEOMETRY = ['Left', 'Top', 'Width', 'Height'];

/** Rien de sélectionné : le document, comme Access montre le formulaire. */
export function targetsOf(sel: Selection): PropTarget[] {
  if (sel.kind === 'section') return [{ kind: 'section', index: sel.index }];
  if (sel.kind === 'controls' && sel.names.length) return sel.names.map((name) => ({ kind: 'control', name }));
  return [{ kind: 'doc' }];
}

export const targetExists = (doc: DesignDoc, t: PropTarget): boolean =>
  t.kind === 'doc' || (t.kind === 'section' ? !!doc.sections[t.index] : !!findControl(doc, t.name));

/** Le genre d'une cible ; une cible disparue (section, contrôle) retombe sur le document (sheetRows l'écarte avant). */
export function targetKind(doc: DesignDoc, docKind: 'form' | 'report', t: PropTarget): PropertyTarget {
  if (t.kind === 'section') return doc.sections[t.index]?.kind ?? docKind;
  if (t.kind === 'control') return findControl(doc, t.name)?.control.kind ?? docKind;
  return docKind;
}

/** La valeur effective (C5) : géométrie et Name depuis ControlDef / SectionDef, RecordSource depuis doc.recordSource, le reste par effectiveProp. */
export function readProp(doc: DesignDoc, docKind: 'form' | 'report', t: PropTarget, d: PropertyDescriptor): unknown {
  if (d.name === 'RecordSource') return doc.recordSource;
  if (t.kind === 'control') {
    const c = findControl(doc, t.name)?.control;
    if (!c) return undefined;
    if (d.name === 'Name') return c.name;
    const g = ({ Left: c.left, Top: c.top, Width: c.width, Height: c.height } as Record<string, number | undefined>)[d.name];
    return g ?? effectiveProp(c.props, d.name, c.kind, docKind);
  }
  if (t.kind === 'section') {
    const s = doc.sections[t.index];
    if (!s) return undefined;
    return d.name === 'Height' ? s.height : effectiveProp(s.props, d.name, s.kind, docKind);
  }
  return d.name === 'Width' && docKind === 'report' ? reportWidth(doc) : effectiveProp(doc.props, d.name, docKind, docKind);
}

const same = (a: unknown, b: unknown): boolean => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

/** Une ligne par descripteur qui s'applique au genre de **chaque** cible (et au genre du document : `objects`), dans l'ordre du catalogue ; Tout = les quatre onglets à la suite.
 *  Des valeurs différentes donnent MIXED. Nom en lecture seule dans une sélection multiple. */
export function sheetRows(doc: DesignDoc, docKind: 'form' | 'report', targets: PropTarget[], tab: SheetTab, readOnly: boolean): SheetRow[] {
  if (!targets.length || !targets.every((t) => targetExists(doc, t))) return [];
  const kinds = targets.map((t) => targetKind(doc, docKind, t));
  return (tab === 'all' ? TABS : [tab]).flatMap((tb) => PROPERTY_CATALOG.filter((d) => d.tab === tb && (!d.objects || d.objects.includes(docKind)) && kinds.every((k) => d.appliesTo.includes(k))))
    .map((d) => {
      const values = targets.map((t) => readProp(doc, docKind, t, d));
      return { d, value: values.every((v) => same(v, values[0])) ? values[0] : MIXED,
        readOnly: readOnly || (d.name === 'Name' && targets.length > 1) };
    });
}

const err = (code: string): string => `sheet.error.${code}`;

/** Une valeur déjà convertie du texte saisi (un nombre illisible arrive en NaN, des largeurs illisibles en null).
 *  undefined = la clé retirée, permis sauf pour la géométrie et le nom. Renvoie la clé i18n de l'erreur, ou null. */
export function checkPropValue(doc: DesignDoc, t: PropTarget, d: PropertyDescriptor, v: unknown): string | null {
  if (d.name === 'Name') {
    if (typeof v !== 'string' || !isValidObjectName(v)) return err('nameInvalid');
    const self = t.kind === 'control' ? findControl(doc, t.name)?.control : undefined;
    const other = findControl(doc, v)?.control;
    return other && other !== self ? err('nameExists') : null;
  }
  if (v === undefined) return d.editor === 'twips' || GEOMETRY.includes(d.name) ? err('outOfRange') : null;
  if (d.name === 'ColumnWidths') return typeof v === 'string' && (v === '' || v.split(';').every((x) => /^\d+$/.test(x) && Number(x) <= MAX_TWIPS)) ? null : err('outOfRange');
  switch (d.editor) {
    case 'twips': return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_TWIPS ? null : err('outOfRange');
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v) || (d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) return err('outOfRange');
      return d.integer && !Number.isInteger(v) ? err('notInteger') : null;
    case 'color': return isColorValue(v) ? null : err('invalidColor');
    case 'enum': return d.options?.includes(String(v)) ? null : err('outOfRange');
    case 'event': { const e = checkEventValue(v); return e && err(e); }
    default: return null;
  }
}

/** '=' + l'expression dans la langue de l'interface ; un nom de champ tel quel ; un texte illisible tel qu'il est stocké. */
export function controlSourceToDisplay(stored: string | undefined, ctx: DisplayContext): string {
  if (!stored) return '';
  if (!stored.startsWith('=')) return stored;
  try { return `=${toDisplay(stored.slice(1), ctx)}`; } catch { return stored; }
}

/** Le texte saisi : '=…' en forme canonique, sinon un nom de champ ; vide = retiré. Un agrégat n'est accepté qu'avec `aggregates`
 *  (un état, où un groupe peut exister : A5) ; sinon il est refusé, comme dans ExpressionField. */
export function controlSourceToCanonical(text: string, ctx: DisplayContext, opts: { aggregates?: boolean } = {}):
  { ok: true; value: string | undefined } | { ok: false; code: ExprErrorCode } {
  const s = text.trim();
  if (!s) return { ok: true, value: undefined };
  if (!s.startsWith('=')) return { ok: true, value: s };
  try { return { ok: true, value: `=${toCanonical(s.slice(1), ctx, { aggregates: opts.aggregates ?? false })}` }; } catch (e) {
    return { ok: false, code: e instanceof ExprSyntaxError ? e.code : 'tooComplex' };   // RangeError : imbrication trop profonde
  }
}

/** Une instruction SQL (une table « Selections » reste une table), sinon une table, puis une requête ; inconnu ou vide -> null. */
export function toSourceRef(text: string, tables: string[], queries: string[]): RecordSourceRef | null {
  const s = text.trim();
  if (!s) return null;
  if (/^\s*(SELECT|TRANSFORM|PARAMETERS)\b/i.test(s)) return { kind: 'sql', sql: s };
  const table = tables.find((x) => sameName(x, s));
  if (table) return { kind: 'table', name: table };
  const query = queries.find((x) => sameName(x, s));
  return query ? { kind: 'query', name: query } : null;
}
export const fromSourceRef = (ref: RecordSourceRef | null): string => (!ref ? '' : ref.kind === 'sql' ? ref.sql : ref.name);

/** Twips stockés -> cm de l'onglet Liste de choix (A2) : '0;1417' -> '0cm;2,5cm'. Un texte stocké illisible est montré tel quel. */
export function columnWidthsToDisplay(stored: string, info: LocaleInfo): string {
  if (!stored) return '';
  const parts = stored.split(';');
  return parts.every((x) => /^\d+$/.test(x)) ? columnWidthsText(parts.map(Number), info.decimalSep) : stored;
}
/** cm saisis -> twips stockés : '0;2,5' -> '0;1417' ; illisible -> null. (parseColumnWidths lit les deux séparateurs décimaux.) */
export function columnWidthsToStored(text: string, _info: LocaleInfo): string | null {
  return parseColumnWidths(text)?.join(';') ?? null;
}

export const fontWarning = (name: string): string | null => (name.trim() && !resolveFont(name.trim()).portable ? 'sheet.fontNotPortable' : null);

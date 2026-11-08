// Feuille de propriétés générique (formulaires A4, états A5), pilotée par PROPERTY_CATALOG : lignes d'un onglet pour la sélection,
// lecture de la valeur effective, contrôle d'une valeur saisie, textes affichés <-> valeurs stockées.
import type { DesignDoc } from '../../shared/design/model';
import { isColorValue } from '../../shared/design/colors';
import { emptyCellRank, emptyCellsOf, type CellRef } from '../../shared/design/layout';
import { effectiveProp, PROPERTY_CATALOG, type PropertyDescriptor, type PropertyTarget } from '../../shared/design/properties';
import { checkEventValue } from '../../shared/design/events';
import { ExprSyntaxError, type ExprErrorCode } from '../../shared/expr/ast';
import { FUNCTION_TABLE } from '../../shared/expr/catalog';
import { toCanonical, toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { withUserFunctions } from '../../shared/expr/user-functions';
import { parsePythonCall, pythonCallFunctions } from '../../shared/python/call-text';
import { columnWidthsText, isValidObjectName, parseColumnWidths, sameName } from '../../shared/field-types';
import type { TFunction } from 'i18next';
import type { Theme } from '../../shared/design/theme';
import { resolveFont, resolveThemeFont } from '../../shared/fonts';
import { reportWidth } from '../../shared/report/model';
import type { LocaleInfo } from '../../shared/locale-format';
import type { RecordSourceRef } from '../../shared/record-source';
import { findControl, setProps, type PropTarget, type Selection } from './designer-model';
import type { SheetTab } from './sheet-types';
import { readPictureType } from '../../shared/pictures';
import { MAX_TWIPS } from './units';

export type { SheetTab, PropertySheetContext } from './sheet-types';

export const MIXED: unique symbol = Symbol('mixed');
export interface SheetRow { d: PropertyDescriptor; value: unknown | typeof MIXED; readOnly: boolean }

const TABS = ['format', 'data', 'event', 'other'] as const;
const PICTURE_ROWS = ['PictureType', 'Picture', 'PictureTiling', 'PictureAlignment', 'PictureSizeMode'];
const GEOMETRY = ['Left', 'Top', 'Width', 'Height'];

/** Rien de sélectionné : le document, comme Access montre le formulaire. */
export function targetsOf(sel: Selection): PropTarget[] {
  if (sel.kind === 'section') return [{ kind: 'section', index: sel.index }];
  if (sel.kind === 'controls' && sel.names.length) return sel.names.map((name) => ({ kind: 'control', name }));
  if (sel.kind === 'controls' && sel.cells?.length) return sel.cells.map((c) => ({ kind: 'cell', layout: c.layout, row: c.row, col: c.col }));
  return [{ kind: 'doc' }];
}

const emptyCellOf = (doc: DesignDoc, c: CellRef) => emptyCellsOf(doc).find((e) => e.layout === c.layout && e.row === c.row && e.col === c.col);
/** The derived name of an empty cell: localized prefix + its rank among the document's empty cells (never stored). */
export const cellName = (doc: DesignDoc, c: CellRef, prefix: string): string => `${prefix}${emptyCellRank(doc, c)}`;

export const targetExists = (doc: DesignDoc, t: PropTarget): boolean =>
  t.kind === 'doc' || (t.kind === 'cell' ? !!emptyCellOf(doc, t) : (t.kind === 'section' ? !!doc.sections[t.index] : !!findControl(doc, t.name)));

/** Le genre d'une cible ; une cible disparue (section, contrôle) retombe sur le document (sheetRows l'écarte avant). */
export function targetKind(doc: DesignDoc, docKind: 'form' | 'report', t: PropTarget): PropertyTarget {
  if (t.kind === 'section') return doc.sections[t.index]?.kind ?? docKind;
  if (t.kind === 'control') return findControl(doc, t.name)?.control.kind ?? docKind;
  return t.kind === 'cell' ? 'emptyCell' : docKind;
}

/** La valeur effective (C5) : géométrie et Name depuis ControlDef / SectionDef, RecordSource depuis doc.recordSource, le reste par effectiveProp. */
export function readProp(doc: DesignDoc, docKind: 'form' | 'report', t: PropTarget, d: PropertyDescriptor, cellPrefix = ''): unknown {
  if (d.name === 'RecordSource') return doc.recordSource;
  if (t.kind === 'cell') {   // L5: an empty cell reads like a label (its defaults), size and position from its rectangle
    const e = emptyCellOf(doc, t);
    if (!e) return undefined;
    if (d.name === 'Name') return cellName(doc, t, cellPrefix);
    return ({ Left: e.rect.left, Top: e.rect.top, Width: e.rect.width, Height: e.rect.height } as Record<string, number | undefined>)[d.name] ?? effectiveProp(e.props, d.name, 'label', docKind);
  }
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
export function sheetRows(doc: DesignDoc, docKind: 'form' | 'report', targets: PropTarget[], tab: SheetTab, readOnly: boolean, cellPrefix = ''): SheetRow[] {
  if (!targets.length || !targets.every((t) => targetExists(doc, t))) return [];
  const kinds = targets.map((t) => targetKind(doc, docKind, t));
  return (tab === 'all' ? TABS : [tab]).flatMap((tb) => PROPERTY_CATALOG.filter((d) => d.tab === tb && (!d.objects || d.objects.includes(docKind)) && kinds.every((k) => d.appliesTo.includes(k) && (!PICTURE_ROWS.includes(d.name) || pictureRows({}, k).includes(d.name)))))
    .map((d) => {
      const values = targets.map((t) => readProp(doc, docKind, t, d, cellPrefix));
      return { d, value: values.every((v) => same(v, values[0])) ? values[0] : MIXED,
        readOnly: readOnly || (d.name === 'Name' && targets.length > 1) || (['Name', 'Top', 'Left'].includes(d.name) && targets.some((t) => t.kind === 'cell')) };
    });
}

/** Les lignes du groupe Image, dans l'ordre d'Access. Le contrôle Image montre les cinq lignes (ordre de la capture 16) ; le formulaire et l'état aussi
 *  la mosaïque, l'alignement et le mode d'affichage ; le bouton de commande le type et l'image. */
export function pictureRows(_props: Record<string, unknown>, target: PropertyTarget): string[] {
  if (target === 'image') return ['PictureType', 'Picture', 'PictureTiling', 'SizeMode', 'PictureAlignment'];
  if (target === 'commandButton') return ['PictureType', 'Picture'];
  return target === 'form' || target === 'report' ? [...PICTURE_ROWS] : [];
}
/** Ce que la cellule Image affiche : le nom de l'image partagée, « (Incorporé) » pour une image incorporée, sinon rien. */
export function pictureLabel(props: Record<string, unknown>, embedded = '(Embedded)'): string {
  const pic = props.Picture;
  if (typeof pic !== 'string' || pic === '') return '';
  return readPictureType(props.PictureType) === 'shared' ? pic : embedded;
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
  try { return `=${toDisplay(stored.slice(1), ctx, { functions: withUserFunctions() })}`; } catch { return stored; }
}

/** Le texte saisi : '=…' en forme canonique, sinon un nom de champ ; vide = retiré. Un agrégat n'est accepté qu'avec `aggregates`
 *  (un état, où un groupe peut exister : A5) ; sinon il est refusé, comme dans ExpressionField. */
export function controlSourceToCanonical(text: string, ctx: DisplayContext, opts: { aggregates?: boolean } = {}):
  { ok: true; value: string | undefined } | { ok: false; code: ExprErrorCode } {
  const s = text.trim();
  if (!s) return { ok: true, value: undefined };
  if (!s.startsWith('=')) return { ok: true, value: s };
  try { return { ok: true, value: `=${toCanonical(s.slice(1), ctx, { aggregates: opts.aggregates ?? false, functions: withUserFunctions() })}` }; } catch (e) {
    return { ok: false, code: e instanceof ExprSyntaxError ? e.code : 'tooComplex' };   // RangeError : imbrication trop profonde
  }
}

/** R1: a stored `=fn(args)` shown in the interface language (`;` in French); an unreadable text as stored. */
export function eventToDisplay(stored: string, ctx: DisplayContext): string {
  try { return `=${toDisplay(stored.slice(1), ctx, { functions: pythonCallFunctions(stored), aggregates: false })}`; } catch { return stored; }
}

/** R1: the typed `=fn(args)` -> canonical, or the message key to show (`key|name`: the name fills {{name}}). A built-in written in the
 *  display language (`=Gauche(...)`) is a built-in once localized: refused, it is not a Python function. */
export function eventToCanonical(text: string, ctx: DisplayContext): { ok: true; value: string } | { ok: false; error: string } {
  const s = text.trim();
  let canonical: string;
  try { canonical = toCanonical(s.slice(1), ctx, { functions: pythonCallFunctions(s), aggregates: false }); } catch { return { ok: false, error: 'sheet.error.badFunctionCall' }; }
  const value = `=${canonical}`;
  if (parsePythonCall(value)) return { ok: true, value };
  const typed = /^=?\s*([\p{L}_][\p{L}\p{N}_]*)\s*\(/u.exec(s)?.[1], head = /^([\p{L}_][\p{L}\p{N}_]*)\s*\(/u.exec(canonical)?.[1];
  return { ok: false, error: head && typed && Object.keys(FUNCTION_TABLE).some((k) => k.toLowerCase() === head.toLowerCase())
    ? `prop.event.builtinFunction|${typed}` : 'sheet.error.badFunctionCall' };
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

/** Police affichée : « Inter (Détail) » / « Inter (En-têtes) » pour une police du thème, un nom explicite tel quel. */
export const fontLabel = (value: string, theme: Theme, t: TFunction): string =>
  value === '(Body)' ? `${resolveThemeFont(value, theme)} (${t('font.body')})` : value === '(Headings)' ? `${resolveThemeFont(value, theme)} (${t('font.headings')})` : value;

/** Les deux polices du thème, en tête des listes (comme Access) : leur libellé affiché et la référence enregistrée. */
export const themeFontChoices = (theme: Theme, t: TFunction): { label: string; ref: '(Headings)' | '(Body)' }[] =>
  (['(Headings)', '(Body)'] as const).map((ref) => ({ label: fontLabel(ref, theme, t), ref }));
/** Un libellé choisi dans la liste devient la référence du thème ; tout autre texte reste tel quel. */
export const fontFromLabel = (s: string, theme: Theme, t: TFunction): string => themeFontChoices(theme, t).find((c) => c.label === s)?.ref ?? s;

export const fontWarning = (name: string): string | null => (name.trim() && !resolveFont(name.trim()).portable ? 'sheet.fontNotPortable' : null);

/** Changer le Type d'image en une seule édition (une annulation) : il ne convertit jamais l'image, il change la lecture de `Picture`.
 *  Vers Partagé (`names` = galerie), `Picture` est effacée sauf si elle nomme une image de la galerie ; vers Incorporé, un nom est effacé (une URL de données reste). */
export function setPictureType(doc: DesignDoc, docKind: 'form' | 'report', targets: PropTarget[], type: 'shared' | 'embedded', names: Set<string> | null): DesignDoc {
  const shared = type === 'shared';
  const pic = PROPERTY_CATALOG.find((d) => d.name === 'Picture')!;
  const clear = targets.filter((x) => { const v = readProp(doc, docKind, x, pic); return typeof v === 'string' && v !== '' && (shared ? !names?.has(v) : !v.startsWith('data:image/')); });
  return setProps(setProps(doc, targets, 'PictureType', shared ? 'shared' : undefined), clear, 'Picture', undefined);
}

// Définition d'un formulaire (module pur) : lecture tolérante d'une définition stockée, formulaire vierge, contrôles d'un champ,
// ordre de tabulation, en-tête et pied de formulaire. Aucune clé inconnue n'est retirée : on étale toujours l'objet lu.
import type { ControlDef, DesignDoc, SectionDef, SectionKind } from '../../shared/design/model';
import { validateDesignDoc } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import type { RecordSourceRef } from '../../shared/record-source';
import { findControl, sectionBottomLimit, updateControl } from '../designer/designer-model';
import { TAB_KINDS } from '../designer/field-controls';
import { autoForm, autoWidth, emptyFormDoc, fieldControls, hidden, withTabOrder, type FormLabels } from '../../shared/design/auto-form';
import { MAX_TWIPS } from '../designer/units';

export { controlKindFor, nextTabIndex } from '../designer/field-controls';
export { autoForm, autoWidth, emptyFormDoc, fieldControls, withTabOrder, type FormLabels };

export const FORM_SECTIONS: SectionKind[] = ['formHeader', 'detail', 'formFooter'];
const HEADER_HEIGHT = 567;   // 1 cm, comme Access quand il affiche l'en-tête et le pied
const ROW_SLACK = 57;        // 0,1 cm : deux contrôles à moins de cette distance verticale sont sur la même ligne
const FIELD_GAP = 113;       // 0,2 cm sous le contrôle le plus bas

export class FormDefError extends Error {
  constructor(readonly code: 'invalidDefinition') { super(code); }
}

/** Les FormLabels de la langue de l'interface (`t` d'i18next). */
export const formLabels = (t: (key: string, opts?: Record<string, unknown>) => string): FormLabels =>
  ({ prefix: (k) => t(`designer.ctlPrefix.${k}`), tabPage: (n) => t('form.tabPage', { n }) });

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Une hauteur de section illisible ou hors limites est réparée : entier de twips dans [0, MAX_TWIPS], 0 si ce n'est pas un nombre. */
const twipsIn = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(0, Math.round(v)), MAX_TWIPS) + 0 : 0);

/** Chemin d'erreur -> le contrôle fautif ([section, j, k…]) ; null : l'erreur ne vise pas un contrôle. */
function controlPath(err: string): number[] | null {
  const m = /^sections\[(\d+)\]\.controls\[(\d+)\]((?:\.children\[\d+\])*)/.exec(err);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), ...[...m[3].matchAll(/\d+/g)].map((x) => Number(x[0]))];
}

/**
 * Une définition lue par api.objects.get. Forme générale illisible ($, formatVersion, sections, une section hormis sa hauteur, réparée) : FormDefError.
 * Un contrôle invalide (validateDesignDoc, ou une position ou taille au-delà de MAX_TWIPS) est retiré avec ses enfants et compté dans `dropped`.
 * Source absente : null ; présente mais invalide : null et `badSource`. Propriétés absentes ou invalides : {}.
 * Les trois sections du formulaire viennent d'abord (créées masquées, hauteur 0, s'il en manque) ; les sections d'un autre genre suivent, telles quelles.
 */
export function parseFormDoc(def: unknown): { doc: DesignDoc; dropped: number; badSource: boolean } {
  const errors = validateDesignDoc(def);
  const fatal = errors.find((e) => e === '$' || e === 'formatVersion' || e === 'sections'
    || (/^sections\[\d+\]/.test(e) && !/^sections\[\d+\]\.(props|height|controls\[)/.test(e)));
  if (fatal || !isObj(def)) throw new FormDefError('invalidDefinition');
  const bad = new Set(errors.map(controlPath).filter((p): p is number[] => p !== null).map((p) => p.join('.')));
  const sectionPropsBad = new Set(errors.flatMap((e) => { const m = /^sections\[(\d+)\]\.props$/.exec(e); return m ? [Number(m[1])] : []; }));
  let dropped = 0;
  const keep = (list: unknown[], path: number[]): ControlDef[] => list.flatMap((raw, j) => {
    const at = [...path, j];
    const c = raw as ControlDef;
    if (bad.has(at.join('.')) || [c.left, c.top, c.width, c.height].some((v) => v > MAX_TWIPS)) { dropped++; return []; }
    return [Array.isArray(c.children) ? { ...c, children: keep(c.children, at) } : c];
  });
  const read = (def.sections as SectionDef[]).map((s, i) => ({ ...s, height: twipsIn(s.height), props: sectionPropsBad.has(i) ? {} : s.props, controls: keep(s.controls, [i]) }));
  const used = new Set<SectionDef>();
  const form = FORM_SECTIONS.map((k) => { const s = read.find((x) => x.kind === k && !used.has(x)); if (s) { used.add(s); return s; } return hidden(k); });
  const source = def.recordSource;
  const badSource = source !== undefined && source !== null && errors.includes('recordSource');
  const doc = { ...def, formatVersion: '1.0', recordSource: errors.includes('recordSource') ? null : source as RecordSourceRef | null,
    props: errors.includes('props') ? {} : def.props as Record<string, unknown>, sections: [...form, ...read.filter((s) => !used.has(s))] } as DesignDoc;
  return { doc, dropped, badSource };
}

/** La définition est relue : à la première ouverture, puis quand reloadToken augmente (enregistré ailleurs) et que le concepteur
 *  n'a rien de modifié. La vue retient le jeton que produit son propre enregistrement (objectSaved l'augmente) ; un renommage le garde. */
export const shouldReload = (prev: { token: number } | null, token: number, dirty: boolean): boolean => !prev || (prev.token !== token && !dirty);

/** Sous le contrôle le plus bas de la section, + 0,2 cm ; 0 dans une section vide. */
export const nextFreeTop = (s: SectionDef): number => (s.controls.length ? Math.min(sectionBottomLimit(s) + FIELD_GAP, MAX_TWIPS) : 0);

const tabbable = (s: SectionDef): ControlDef[] => s.controls.filter((c) => TAB_KINDS.includes(c.kind));

const byTabIndex = (list: ControlDef[]): string[] => {
  const key = (c: ControlDef) => (typeof c.props.TabIndex === 'number' ? c.props.TabIndex : Number.MAX_SAFE_INTEGER);
  return list.map((c, i) => ({ c, i })).sort((a, b) => key(a.c) - key(b.c) || a.i - b.i).map((x) => x.c.name);
};

/** Les contrôles à arrêt de tabulation de la section (le contrôle onglet compris), dans leur ordre de tabulation (TabIndex, puis ordre du document). */
export const tabOrder = (s: SectionDef): string[] => byTabIndex(tabbable(s));

/** Haut en bas, puis de gauche à droite sur une même ligne (à 0,1 cm près). */
function autoNames(list: ControlDef[]): string[] {
  const rows: ControlDef[][] = [];
  for (const c of [...list].sort((a, b) => a.top - b.top)) {
    const row = rows[rows.length - 1];
    if (row && c.top - row[0].top <= ROW_SLACK) row.push(c); else rows.push([c]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.left - b.left)).map((c) => c.name);
}

/** Ordre automatique d'Access : de haut en bas, puis de gauche à droite sur une même ligne (à 0,1 cm près). */
export const autoTabOrder = (s: SectionDef): SectionDef => withTabOrder(s, autoNames(tabbable(s)));

const pageControls = (doc: DesignDoc, tabControl: string, page: number): ControlDef[] =>
  (findControl(doc, tabControl)?.control.children ?? []).filter((k) => TAB_KINDS.includes(k.kind) && (typeof k.props.PageIndex === 'number' ? k.props.PageIndex : 0) === page);

/** Les contrôles à arrêt de tabulation d'une page du contrôle onglet, dans leur ordre de tabulation. */
export const pageTabOrder = (doc: DesignDoc, tabControl: string, page: number): string[] => byTabIndex(pageControls(doc, tabControl, page));

/** Ordre automatique d'une page (haut en bas, puis gauche à droite). */
export const autoPageOrder = (doc: DesignDoc, tabControl: string, page: number): string[] => autoNames(pageControls(doc, tabControl, page));

/** TabIndex 0…n sur les contrôles de cette page seulement ; rien ne change : le même document. */
export function withPageTabOrder(doc: DesignDoc, tabControl: string, page: number, names: string[]): DesignDoc {
  const index = new Map(names.map((n, i) => [n, i]));
  const mine = new Set(pageControls(doc, tabControl, page));
  return updateControl(doc, tabControl, (t) => {
    const kids = (t.children ?? []).map((k) => (mine.has(k) && index.has(k.name) && k.props.TabIndex !== index.get(k.name) ? { ...k, props: { ...k.props, TabIndex: index.get(k.name) } } : k));
    return kids.every((k, i) => k === t.children![i]) ? t : { ...t, children: kids };
  });
}

/** Déplace le bloc lo..hi devant la position `gap` (0..n, dans la liste d'origine) ; `gap` dans [lo, hi + 1] : rien ne bouge. */
export function moveBlock(names: string[], lo: number, hi: number, gap: number): { names: string[]; lo: number; hi: number } {
  if (gap < 0 || gap > names.length || (gap >= lo && gap <= hi + 1)) return { names, lo, hi };   // hors liste ou sur le bloc : rien ne bouge
  const block = names.slice(lo, hi + 1), rest = [...names.slice(0, lo), ...names.slice(hi + 1)];
  const at = gap > hi ? gap - block.length : gap;
  return { names: [...rest.slice(0, at), ...block, ...rest.slice(at)], lo: at, hi: at + block.length - 1 };
}

/** L'en-tête de formulaire est affiché : il décide pour les deux (le menu de section, toggleHeaderFooter, les éléments d'en-tête du ruban). */
export function headerFooterShown(doc: DesignDoc): boolean {
  const header = doc.sections.find((s) => s.kind === 'formHeader');
  return !!header && header.props.Visible !== false;
}

/** En-tête/pied de formulaire (menu de la barre de section) : les affiche tous deux (1 cm au moins) ou les retire, comme Access :
 *  masquées, hauteur 0 et sans contrôles (l'hôte demande confirmation quand il y en a). Les autres propriétés restent. */
export function toggleHeaderFooter(doc: DesignDoc): DesignDoc {
  const show = !headerFooterShown(doc);
  return { ...doc, sections: doc.sections.map((s) => {
    if (s.kind !== 'formHeader' && s.kind !== 'formFooter') return s;
    if (show) return { ...s, height: Math.max(s.height, HEADER_HEIGHT), props: { ...s.props, Visible: true } };
    return { ...s, height: 0, props: { ...s.props, Visible: false }, controls: [] };
  }) };
}

/** Le nom d'un nouveau formulaire : `base` s'il est libre, sinon base1, base2… (sans tenir compte de la casse, comme les noms d'objets). */
export function uniqueFormName(existing: string[], base: string): string {
  return existing.some((x) => sameName(x, base)) ? firstFreeName(existing, (n) => `${base}${n}`) : base;
}

/** Le premier nom libre parmi nameOf(1), nameOf(2)… (Formulaire1, Formulaire2… : Création de formulaire, Formulaire vierge). */
export function firstFreeName(existing: string[], nameOf: (n: number) => string): string {
  let n = 1;
  while (existing.some((x) => sameName(x, nameOf(n)))) n++;
  return nameOf(n);
}

/** The forms' names, saved or open (a new form's tab not saved yet). */
export const formNames = (objs: readonly { kind: string; name: string }[], tabs: readonly { kind: string; name: string }[]): string[] =>
  [...objs, ...tabs].filter((x) => x.kind === 'form').map((x) => x.name);

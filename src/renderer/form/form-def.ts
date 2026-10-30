// Définition d'un formulaire (module pur) : lecture tolérante d'une définition stockée, formulaire vierge, contrôles d'un champ,
// ordre de tabulation, en-tête et pied de formulaire. Aucune clé inconnue n'est retirée : on étale toujours l'objet lu.
import type { ControlDef, ControlKind, DesignDoc, SectionDef, SectionKind } from '../../shared/design/model';
import { cmToTwips, validateDesignDoc } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import type { RecordSourceRef, SourceField, SourceInfo } from '../../shared/record-source';
import { sectionBottomLimit } from '../designer/designer-model';
import { boundControlWithLabel, TAB_KINDS } from '../designer/field-controls';
import { MAX_TWIPS } from '../designer/units';

export { controlKindFor, nextTabIndex } from '../designer/field-controls';

export const FORM_SECTIONS: SectionKind[] = ['formHeader', 'detail', 'formFooter'];
const HEADER_HEIGHT = 567;   // 1 cm, comme Access quand il affiche l'en-tête et le pied
const ROW_SLACK = 57;        // 0,1 cm : deux contrôles à moins de cette distance verticale sont sur la même ligne
const FIELD_GAP = 113;       // 0,2 cm sous le contrôle le plus bas

export class FormDefError extends Error {
  constructor(readonly code: 'invalidDefinition') { super(code); }
}

/** Préfixe des noms de contrôles (designer.ctlPrefix.<genre>) et nom d'une page d'onglet (form.tabPage), traduits par la vue. */
export interface FormLabels { prefix(kind: ControlKind): string; tabPage(n: number): string }
/** Les FormLabels de la langue de l'interface (`t` d'i18next). */
export const formLabels = (t: (key: string, opts?: Record<string, unknown>) => string): FormLabels =>
  ({ prefix: (k) => t(`designer.ctlPrefix.${k}`), tabPage: (n) => t('form.tabPage', { n }) });

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const hidden = (kind: SectionKind): SectionDef => ({ kind, height: 0, props: { Visible: false }, controls: [] });

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

/** Un formulaire vierge : Détail de 4 cm, en-tête et pied masqués à 0, largeur 16 cm. */
export function emptyFormDoc(source: RecordSourceRef | null): DesignDoc {
  return { formatVersion: '1.0', recordSource: source, props: { Width: 9072 },
    sections: [hidden('formHeader'), { kind: 'detail', height: 2268, props: {}, controls: [] }, hidden('formFooter')] };
}

/** Le contrôle lié d'un champ et son étiquette attachée (boundControlWithLabel, partagé avec A5). */
export function fieldControls(doc: DesignDoc, f: SourceField, at: { section: number; left: number; top: number }, labels: FormLabels): ControlDef[] {
  return boundControlWithLabel(doc, f, at, { objectKind: 'form', labelSuffix: labels.prefix('label') });
}

/** Sous le contrôle le plus bas de la section, + 0,2 cm ; 0 dans une section vide. */
export const nextFreeTop = (s: SectionDef): number => (s.controls.length ? Math.min(sectionBottomLimit(s) + FIELD_GAP, MAX_TWIPS) : 0);

const tabbable = (s: SectionDef): ControlDef[] => s.controls.filter((c) => TAB_KINDS.includes(c.kind));

/** TabIndex 0…n dans l'ordre donné ; les autres contrôles restent tels quels. Rien ne change : la même section. */
export function withTabOrder(s: SectionDef, names: string[]): SectionDef {
  const index = new Map(names.map((n, i) => [n, i]));
  const controls = s.controls.map((c) => (index.has(c.name) && c.props.TabIndex !== index.get(c.name) ? { ...c, props: { ...c.props, TabIndex: index.get(c.name) } } : c));
  return controls.every((c, i) => c === s.controls[i]) ? s : { ...s, controls };
}

/** Les contrôles à arrêt de tabulation de la section, dans leur ordre de tabulation (TabIndex, puis ordre du document). */
export function tabOrder(s: SectionDef): string[] {
  const list = tabbable(s);
  const key = (c: ControlDef) => (typeof c.props.TabIndex === 'number' ? c.props.TabIndex : Number.MAX_SAFE_INTEGER);
  return list.map((c, i) => ({ c, i })).sort((a, b) => key(a.c) - key(b.c) || a.i - b.i).map((x) => x.c.name);
}

/** Ordre automatique d'Access : de haut en bas, puis de gauche à droite sur une même ligne (à 0,1 cm près). */
export function autoTabOrder(s: SectionDef): SectionDef {
  const byTop = [...tabbable(s)].sort((a, b) => a.top - b.top);
  const rows: ControlDef[][] = [];
  for (const c of byTop) {
    const row = rows[rows.length - 1];
    if (row && c.top - row[0].top <= ROW_SLACK) row.push(c); else rows.push([c]);
  }
  return withTabOrder(s, rows.flatMap((r) => r.sort((a, b) => a.left - b.left)).map((c) => c.name));
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

const AUTO = { gap: cmToTwips(0.15), label: cmToTwips(0.5), control: cmToTwips(3.5), header: cmToTwips(1.2), footer: cmToTwips(0.5) };

/** Largeur du contrôle d'un champ dans un formulaire instantané ; undefined : celle de boundControlWithLabel (case à cocher…). */
function autoWidth(f: SourceField): { width: number; height?: number } | undefined {
  switch (f.type) {
    case 'shortText': return { width: Math.min(Math.max(cmToTwips(Math.min(f.props.size ?? 255, 50) * 0.2), cmToTwips(2)), cmToTwips(8)) };
    case 'longText': return { width: cmToTwips(8), height: cmToTwips(1.8) };
    case 'autoNumber': case 'number': case 'currency': case 'dateTime': return { width: cmToTwips(3) };
    default: return undefined;
  }
}

/**
 * Formulaire instantané (Créer › Formulaire), en colonne comme celui d'Access : en-tête de 1,2 cm avec le nom de la source en titre
 * (16 pt, gras ; couleurs du catalogue), un contrôle lié et son étiquette par champ, empilés à 0,15 cm (étiquettes à 0,5 cm du bord,
 * contrôles à 3,5 cm ; une autre colonne au-delà de 55,88 cm), pied de 0,5 cm vide ; Mode par défaut Formulaire unique, ordre de
 * tabulation colonne par colonne, largeur ajustée
 * au contrôle le plus large + 0,5 cm. Couleurs de thème seulement (aucune n'est écrite).
 */
export function autoForm(ref: RecordSourceRef, title: string, info: SourceInfo, labels: FormLabels): DesignDoc {
  const base = emptyFormDoc(ref);
  const titleLabel: ControlDef = { kind: 'label', name: 'Auto_Header0', left: AUTO.label, top: cmToTwips(0.2), width: cmToTwips(9), height: cmToTwips(0.8),
    props: { Caption: title, FontSize: 16, FontWeight: 'bold' } };
  let doc: DesignDoc = { ...base, sections: [
    { kind: 'formHeader', height: AUTO.header, props: { Visible: true }, controls: [titleLabel] },
    { ...base.sections[1], controls: [] },
    { kind: 'formFooter', height: AUTO.footer, props: { Visible: true }, controls: [] },
  ] };
  let top = AUTO.gap;
  let x0 = 0;          // bord gauche de la colonne : une autre commence après son contrôle le plus large quand le Détail dépasserait la limite d'Access
  let colRight = 0;
  for (const f of info.fields) {
    const [c] = fieldControls(doc, f, { section: 1, left: AUTO.control, top }, labels);
    const ctl0: ControlDef = { ...c, ...autoWidth(f) };
    if (top > AUTO.gap && top + ctl0.height > MAX_TWIPS) { x0 = colRight; top = AUTO.gap; }
    // ponytail: au-delà de 55,88 cm de colonnes (des centaines de champs Texte long), la dernière est ramenée dans la limite et peut chevaucher
    const left = Math.min(x0 + AUTO.control, MAX_TWIPS - ctl0.width);
    const ctl: ControlDef = { ...ctl0, left, top,
      children: c.children!.map((l) => ({ ...l, left: left - AUTO.control + AUTO.label, top, width: AUTO.control - AUTO.label - (c.left - l.left - l.width) })) };
    const detail = doc.sections[1];
    doc = { ...doc, sections: doc.sections.map((s, i) => (i === 1 ? { ...detail, controls: [...detail.controls, ctl] } : s)) };
    colRight = Math.max(colRight, left + ctl.width);
    top += ctl.height + AUTO.gap;
  }
  const bottom = Math.max(0, ...doc.sections[1].controls.map((c) => c.top + c.height));
  // ordre de tabulation : la première colonne de haut en bas, puis la suivante (une colonne : l'ordre automatique d'Access)
  const placed = doc.sections[1];
  const detail = withTabOrder({ ...placed, height: info.fields.length ? Math.min(bottom + AUTO.gap, MAX_TWIPS) : base.sections[1].height }, placed.controls.map((c) => c.name));
  const right = Math.max(...doc.sections.flatMap((s) => s.controls.map((c) => c.left + c.width)));
  return { ...doc, props: { ...doc.props, Width: Math.min(right + AUTO.label, MAX_TWIPS), DefaultView: 'single' }, sections: doc.sections.map((s, i) => (i === 1 ? detail : s)) };
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

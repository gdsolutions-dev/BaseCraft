// Couper, Copier, Coller des contrôles en mode Création (formulaires, états), comme Access. Presse-papiers propre au moteur de rendu :
// des copies profondes, jamais le presse-papiers du système ni du JSON relu ; il passe d'un formulaire ou d'un état à l'autre.
import type { TFunction } from 'i18next';
import { flattenControls, type ControlDef, type ControlKind, type DesignDoc, type SectionDef } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import { getClip, onClip } from '../exchange/object-clipboard';
import { runShellCommand, type CommandHandlers } from '../shell/ribbon-model';
import type { DesignerHost } from './Designer';
import { controlRect, docWidth, findControl, type DesignerAction, type DesignerState, type Selection } from './designer-model';
import { nextTabIndex, TAB_KINDS } from './field-controls';
import { intersects, type Rect } from './geometry';
import { gridStep, MAX_TWIPS } from './units';

export interface DesignClip { controls: ControlDef[]; section: Pick<SectionDef, 'kind' | 'groupLevel'> }   // section : celle d'où il vient
/** kinds : les genres de sa boîte à outils (les autres ne se collent pas) ; prefix : Texte, Étiquette… */
export interface ClipContext { target: 'form' | 'report'; kinds: ControlKind[]; prefix(k: ControlKind): string }
export type ClipCommand = 'cut' | 'copy' | 'paste';

let clip: DesignClip | null = null;
const listeners = new Set<() => void>();
/** Le ruban grise Coller quand ni ce presse-papiers (aucun genre de la cible) ni celui des objets du volet de navigation n'ont
 *  rien à coller (useSyncExternalStore de l'hôte). */
export const subscribeClip = (cb: () => void): (() => void) => {
  listeners.add(cb);
  const off = onClip(cb);
  return () => { listeners.delete(cb); off(); };
};
export const canPaste = (kinds: ControlKind[]): boolean => !!clip?.controls.some((c) => kinds.includes(c.kind));
export const pasteEnabled = (kinds: ControlKind[]): boolean => canPaste(kinds) || getClip() !== null;

export const clipContext = (host: DesignerHost, t: TFunction): ClipContext => ({ target: host.target, kinds: host.tools.map((x) => x.kind), prefix: (k) => t(`designer.ctlPrefix.${k}`) });

/** Les contrôles sélectionnés dans l'ordre du document, chacun avec ses enfants (l'étiquette attachée) ; un contrôle sous un autre
 *  contrôle sélectionné vient avec lui, pas deux fois. */
export function copySelection(doc: DesignDoc, selection: Selection): DesignClip | null {
  if (selection.kind !== 'controls') return null;
  const picked = (n: string) => selection.names.some((x) => sameName(x, n));
  const under = (n: string): boolean => { const p = findControl(doc, n)?.parent; return !!p && (picked(p) || under(p)); };
  const controls = doc.sections.flatMap((s) => flattenControls(s.controls)).filter((c) => picked(c.name) && !under(c.name));
  if (!controls.length) return null;
  const { kind, groupLevel } = doc.sections[findControl(doc, controls[0].name)!.section];
  return { controls: structuredClone(controls), section: { kind, groupLevel } };
}

/** Les contrôles du presse-papiers prêts pour `insert` dans la section : les genres que la cible a, leur nom s'il est libre (sinon
 *  « préfixe + n », comme Access), l'ordre de tabulation suivant dans un formulaire, hors de toute page d'onglet. Le groupe garde sa forme, rentre dans la largeur du document, et descend de sa
 *  hauteur tant qu'il recouvre un contrôle de la section (collé sous l'original ; à sa place s'il l'a quittée). */
export function pasteControls(doc: DesignDoc, c: DesignClip, section: number, ctx: ClipContext): ControlDef[] | null {
  const s = doc.sections[section];
  const keep = (list: ControlDef[]): ControlDef[] => list.filter((x) => ctx.kinds.includes(x.kind))
    .map((x) => (x.children ? { ...x, children: keep(x.children) } : x));
  const kept = structuredClone(keep(c.controls));
  if (!s || !kept.length) return null;
  for (const x of kept) delete x.props.PageIndex;   // collé à la racine de la section
  const all = flattenControls(kept);
  const taken = flattenControls(doc.sections.flatMap((x) => x.controls)).map((x) => x.name);
  let tab = nextTabIndex(s);
  for (const x of all) {
    const free = (n: string) => !taken.some((y) => sameName(y, n));
    for (let n = 1; !free(x.name); n++) x.name = `${ctx.prefix(x.kind)}${n}`;
    taken.push(x.name);
    if (ctx.target === 'form' && TAB_KINDS.includes(x.kind)) x.props = { ...x.props, TabIndex: tab++ };
  }
  const rs = all.map(controlRect);
  const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
  const right = Math.max(...rs.map((r) => r.left + r.width)), bottom = Math.max(...rs.map((r) => r.top + r.height));
  const dx = Math.max(Math.min(0, docWidth(doc, ctx.target) - right), -left);
  const solid = (r: Rect): Rect => ({ ...r, width: Math.max(r.width, 1), height: Math.max(r.height, 1) });   // un trait compte
  const others = flattenControls(s.controls).map((x) => solid(controlRect(x)));
  const box = solid({ left: left + dx, top, width: right - left, height: bottom - top });
  const step = Math.max(box.height, gridStep(doc));   // un trait seul descend d'un pas de grille, pas d'un twip
  let dy = 0;
  while (bottom + dy + step <= MAX_TWIPS && others.some((r) => intersects({ ...box, top: top + dy }, r))) dy += step;
  for (const x of all) { x.left += dx; x.top += dy; }
  return kept;
}

/** Copier garde la sélection ; Couper la garde puis la supprime (une annulation) ; Coller insère le presse-papiers (une annulation)
 *  dans la section sélectionnée, celle du contrôle sélectionné, sinon celle d'où il vient (si la cible l'a, affichée), sinon le Détail.
 *  Rien à faire : null. */
export function clipboardAction(cmd: ClipCommand, s: DesignerState, ctx: ClipContext): DesignerAction | null {
  if (cmd !== 'paste') {
    const c = copySelection(s.doc, s.selection);
    if (!c) return null;
    clip = c;
    listeners.forEach((l) => l());
    return cmd === 'cut' ? { type: 'deleteSelection' } : null;
  }
  if (!clip) return null;
  const sel = s.selection;
  const section = sel.kind === 'section' ? sel.index
    : (sel.kind === 'controls' && sel.names.length ? findControl(s.doc, sel.names[0])?.section : undefined)
      ?? [s.doc.sections.findIndex((x) => x.kind === clip!.section.kind && x.groupLevel === clip!.section.groupLevel && x.height > 0 && x.props.Visible !== false),
        s.doc.sections.findIndex((x) => x.kind === 'detail'), 0].find((i) => i >= 0)!;
  const controls = pasteControls(s.doc, clip, section, ctx);
  return controls ? { type: 'insert', section, controls } : null;
}

/** Accueil › Presse-papiers dans la vue hôte : les contrôles, sauf depuis une zone de saisie (un champ de la Feuille de propriétés)
 *  ou le volet de navigation, qui gardent le presse-papiers habituel de l'interface. */
export function clipboardCommands(state: () => DesignerState, dispatch: (a: DesignerAction) => void, ctx: () => ClipContext): CommandHandlers {
  const run = (cmd: ClipCommand) => () => {
    const el = document.activeElement;
    if (el?.closest('input, textarea, [contenteditable="true"], .nitem')) return runShellCommand(cmd);
    const a = clipboardAction(cmd, state(), ctx());
    if (a) dispatch(a);
  };
  return { cut: run('cut'), copy: run('copy'), paste: run('paste') };
}

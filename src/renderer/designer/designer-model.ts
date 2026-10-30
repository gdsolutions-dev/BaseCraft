// Modèle pur du concepteur générique (formulaires A4, états A5) : document, sélection, déplacement, organisation, annulation.
// Tout est en twips, relatif à la section (enfants compris). Aucune clé inconnue n'est jamais retirée : on étale toujours l'ancien objet.
import { isValidObjectName, sameName } from '../../shared/field-types';
import type { ControlDef, ControlKind, DesignDoc, SectionDef } from '../../shared/design/model';
import { effectiveProp } from '../../shared/design/properties';
import { reportWidth } from '../../shared/report/model';
import { resizeRect, intersects, type Handle, type Rect } from './geometry';
import { gridStep, MAX_TWIPS, snap } from './units';

export type Selection = { kind: 'controls'; names: string[] } | { kind: 'section'; index: number } | { kind: 'doc' };
export type PropTarget = { kind: 'doc' } | { kind: 'section'; index: number } | { kind: 'control'; name: string };
// interne au concepteur : jamais un CommandId (le ruban montre sizeSpace / align en menus, tâche 3)
export type ArrangeOp = 'alignLeft' | 'alignRight' | 'alignTop' | 'alignBottom' | 'alignToGrid'
  | 'sizeToWidest' | 'sizeToNarrowest' | 'sizeToTallest' | 'sizeToShortest' | 'sizeToGrid'
  | 'spaceHorizontalEqual' | 'spaceHorizontalIncrease' | 'spaceHorizontalDecrease'
  | 'spaceVerticalEqual' | 'spaceVerticalIncrease' | 'spaceVerticalDecrease' | 'bringToFront' | 'sendToBack';
export interface DesignerState { doc: DesignDoc; selection: Selection; dirty: boolean; past: DesignDoc[]; future: DesignDoc[]; snap: boolean;
  objectKind?: 'form' | 'report' }   // posé par l'hôte au chargement ; absent : déduit des sections
export type DesignerAction =
  | { type: 'load'; doc: DesignDoc; objectKind?: 'form' | 'report' } | { type: 'saved' }
  | { type: 'select'; selection: Selection } | { type: 'toggleSelect'; name: string } | { type: 'selectAll' }
  | { type: 'selectRect'; section: number; rect: Rect; add: boolean }
  | { type: 'moveBy'; dx: number; dy: number; free?: boolean }            // twips ; free = sans aimantation (Alt)
  | { type: 'changeSection'; to: number; top: number; dx?: number; free?: boolean }   // dépôt dans une autre section (dx : déplacement horizontal du même geste)
  | { type: 'resize'; handle: Handle; dx: number; dy: number; free?: boolean }
  | { type: 'insert'; section: number; controls: ControlDef[]; parent?: string }
  | { type: 'deleteSelection' }
  | { type: 'setProp'; targets: PropTarget[]; name: string; value: unknown }   // undefined = clé retirée
  | { type: 'setSectionHeight'; index: number; height: number }
  | { type: 'arrange'; op: ArrangeOp }
  | { type: 'edit'; apply(doc: DesignDoc): DesignDoc }                    // opération propre à l'hôte (en-tête/pied, regroupement A5)
  | { type: 'toggleSnap' } | { type: 'undo' } | { type: 'redo' };

export const CONTAINER_KINDS: ControlKind[] = ['optionGroup', 'tabControl'];
const MIN_SIZE = 57; // 0,1 cm
const HISTORY = 100;
const minFor = (kind: ControlKind): number => (kind === 'line' ? 0 : MIN_SIZE);
const isContainer = (c: ControlDef): boolean => CONTAINER_KINDS.includes(c.kind);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi)) + 0; // + 0 : jamais -0

export const controlRect = (c: ControlDef): Rect => ({ left: c.left, top: c.top, width: c.width, height: c.height });
const bounds = (rs: Rect[]): Rect => {
  const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
  return { left, top, width: Math.max(...rs.map((r) => r.left + r.width)) - left, height: Math.max(...rs.map((r) => r.top + r.height)) - top };
};

// ---- arbre
interface Entry { control: ControlDef; section: number; parent: string | null }
function entries(doc: DesignDoc): Entry[] {
  const out: Entry[] = [];
  const rec = (list: ControlDef[], section: number, parent: string | null): void => {
    for (const control of list) { out.push({ control, section, parent }); if (control.children) rec(control.children, section, control.name); }
  };
  doc.sections.forEach((s, i) => rec(s.controls, i, null));
  return out;
}
const subtree = (c: ControlDef): ControlDef[] => [c, ...(c.children ?? []).flatMap(subtree)];

export function findControl(doc: DesignDoc, name: string): { control: ControlDef; section: number; parent: string | null } | null {
  return entries(doc).find((e) => sameName(e.control.name, name)) ?? null;
}
export const sectionBottomLimit = (s: SectionDef): number => Math.max(0, ...s.controls.flatMap(subtree).map((c) => c.top + c.height));

function uniqueIn(names: string[], base: string): string {
  if (!names.some((n) => sameName(n, base))) return base;
  for (let i = 1; ; i++) if (!names.some((n) => sameName(n, base + i))) return base + i;
}
export const uniqueName = (doc: DesignDoc, base: string): string => uniqueIn(entries(doc).map((e) => e.control.name), base);

/** Mêmes éléments dans le même ordre : une liste intacte est gardée telle quelle (le canevas ne redessine que ce qui change). */
const same = <T,>(a: T[], b: T[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
/** Reconstruit les listes de contrôles, de haut en bas : `fn` voit la liste d'origine d'une section (owner null) ou d'un conteneur. */
function mapLists(doc: DesignDoc, fn: (list: ControlDef[], owner: ControlDef | null, section: number) => ControlDef[]): DesignDoc {
  const rec = (list: ControlDef[], owner: ControlDef | null, si: number): ControlDef[] =>
    fn(list, owner, si).map((c) => { if (!c.children) return c; const kids = rec(c.children, c, si); return same(kids, c.children) ? c : { ...c, children: kids }; });
  return { ...doc, sections: doc.sections.map((s, i) => { const cs = rec(s.controls, null, i); return same(cs, s.controls) ? s : { ...s, controls: cs }; }) };
}
function updateControl(doc: DesignDoc, name: string, fn: (c: ControlDef) => ControlDef): DesignDoc {
  const e = findControl(doc, name);
  if (!e) return doc;
  const n = fn(e.control);
  return n === e.control ? doc : mapLists(doc, (list) => list.map((c) => (c === e.control ? n : c)));
}

// ---- positions : un contrôle déplacé emmène ses descendants (sauf ceux qui ont leur propre cible)
type Patches = Map<ControlDef, Partial<Rect>>;
function patchDoc(doc: DesignDoc, patches: Patches, follow: (c: ControlDef) => boolean): DesignDoc {
  const go = (c: ControlDef, dx: number, dy: number): ControlDef => {
    const p = patches.get(c);
    let n = c;
    if (p) { n = { ...c, ...p }; dx = follow(c) ? n.left - c.left : 0; dy = follow(c) ? n.top - c.top : 0; }
    else if (dx || dy) n = { ...c, left: c.left + dx, top: c.top + dy };
    if (!c.children) return n;
    const kids = c.children.map((k) => go(k, dx, dy));
    return n === c && same(kids, c.children) ? c : { ...n, children: kids };   // un contrôle intact garde son identité
  };
  return { ...doc, sections: doc.sections.map((s) => { const cs = s.controls.map((c) => go(c, 0, 0)); return same(cs, s.controls) ? s : { ...s, controls: cs }; }) };
}

const followers = (c: ControlDef, patches: Patches): ControlDef[] =>
  (c.children ?? []).flatMap((k) => (patches.has(k) ? [] : [k, ...followers(k, patches)]));
/** Garde chaque contrôle (et les descendants qui le suivent) dans [0, MAX_TWIPS] ; écarte les cibles sans effet. */
function settle(patches: Patches, follow: (c: ControlDef) => boolean): Patches {
  const out: Patches = new Map();
  for (const [c, p] of patches) {
    const q: Partial<Rect> = { ...p };
    if (p.left !== undefined || p.top !== undefined) {
      const g = (follow(c) ? [c, ...followers(c, patches)] : [c]).map(controlRect);
      const dx = clamp((p.left ?? c.left) - c.left, -Math.min(...g.map((r) => r.left)), MAX_TWIPS - Math.max(...g.map((r) => r.left + r.width)));
      const dy = clamp((p.top ?? c.top) - c.top, -Math.min(...g.map((r) => r.top)), MAX_TWIPS - Math.max(...g.map((r) => r.top + r.height)));
      q.left = c.left + dx; q.top = c.top + dy;
    }
    if (p.width !== undefined) q.width = clamp(p.width, 0, MAX_TWIPS - (q.left ?? c.left));
    if (p.height !== undefined) q.height = clamp(p.height, 0, MAX_TWIPS - (q.top ?? c.top));
    if ((Object.keys(q) as (keyof Rect)[]).some((k) => q[k] !== c[k])) out.set(c, q);
  }
  return out;
}

/** Le genre posé par l'hôte ; à défaut, un document d'états a au moins une section qui lui est propre, sinon c'est un formulaire
 *  (les défauts `form:` / `report:` en dépendent). */
export const documentKind = (s: Pick<DesignerState, 'doc' | 'objectKind'>): 'form' | 'report' =>
  s.objectKind ?? (s.doc.sections.some((x) => !['formHeader', 'detail', 'formFooter'].includes(x.kind)) ? 'report' : 'form');
/** The document's width as printed and drawn: a report's by the engine's rule (reportWidth, C5), a form's Width. */
export const docWidth = (doc: DesignDoc, kind: 'form' | 'report'): number =>
  kind === 'report' ? reportWidth(doc) : Number(effectiveProp(doc.props, 'Width', kind, kind)) || 0;
const maxRight = (doc: DesignDoc): number => Math.max(0, ...entries(doc).map((e) => e.control.left + e.control.width));

/** Une section grandit pour contenir ses contrôles, et le document pour contenir leur bord droit ; rien ne rétrécit. */
function fit(doc: DesignDoc, objectKind: DesignerState['objectKind']): DesignDoc {
  const right = maxRight(doc);
  const sections = doc.sections.map((s) => { const lim = sectionBottomLimit(s); return lim > s.height ? { ...s, height: Math.min(lim, MAX_TWIPS) } : s; });
  const kind = documentKind({ doc, objectKind });
  const width = docWidth(doc, kind);
  // a report with no valid Width stores the one it had (its rightmost edge): from then on, nothing shrinks it
  const write = right > width || (kind === 'report' && width !== doc.props.Width);
  return { ...doc, sections, props: write ? { ...doc.props, Width: Math.min(Math.max(right, width), MAX_TWIPS) } : doc.props };
}

// ---- état
export const initDesigner = (doc: DesignDoc, objectKind?: 'form' | 'report'): DesignerState =>
  ({ doc, selection: { kind: 'doc' }, dirty: false, past: [], future: [], snap: true, ...(objectKind ? { objectKind } : {}) });

function prune(doc: DesignDoc, sel: Selection): Selection {
  if (sel.kind === 'section') return doc.sections[sel.index] ? sel : { kind: 'doc' };
  if (sel.kind === 'doc') return sel;
  const names = sel.names.filter((n) => findControl(doc, n));
  return names.length || !sel.names.length ? { kind: 'controls', names } : { kind: 'doc' };
}
function push(s: DesignerState, doc: DesignDoc, selection: Selection = s.selection): DesignerState {
  return { ...s, doc, selection: prune(doc, selection), dirty: true, past: [...s.past, s.doc].slice(-HISTORY), future: [] };
}
const selected = (s: DesignerState): Entry[] => {
  if (s.selection.kind !== 'controls') return [];
  const out: Entry[] = [];
  for (const n of s.selection.names) { const e = findControl(s.doc, n); if (e && !out.some((o) => o.control === e.control)) out.push(e); }
  return out;
};
/** Les contrôles que l'on peut choisir un à un : les contrôles de premier niveau et les étiquettes attachées, pas le contenu d'un conteneur. */
const selectable = (c: ControlDef): ControlDef[] => [c, ...(isContainer(c) ? [] : (c.children ?? []).flatMap(selectable))];

function geometry(s: DesignerState, doc: DesignDoc): DesignerState { return push(s, fit(doc, s.objectKind)); }
function applyPatches(s: DesignerState, patches: Patches, follow: (c: ControlDef) => boolean): DesignerState {
  const p = settle(patches, follow);
  return p.size ? geometry(s, patchDoc(s.doc, p, follow)) : s;
}

function setIn(props: Record<string, unknown>, name: string, value: unknown): Record<string, unknown> {
  if (value === undefined) { if (!Object.hasOwn(props, name)) return props; const { [name]: _gone, ...rest } = props; return rest; }
  return Object.hasOwn(props, name) && Object.is(props[name], value) ? props : { ...props, [name]: value };
}

const sameRef = (a: DesignDoc['recordSource'], b: DesignDoc['recordSource']): boolean => a === b
  || (!!a && !!b && a.kind === b.kind && ('name' in a ? a.name : undefined) === ('name' in b ? b.name : undefined) && ('sql' in a ? a.sql : undefined) === ('sql' in b ? b.sql : undefined));

function setProp(doc: DesignDoc, t: PropTarget, name: string, value: unknown): DesignDoc {
  if (name === 'RecordSource') { const ref = (value ?? null) as DesignDoc['recordSource']; return sameRef(ref, doc.recordSource) ? doc : { ...doc, recordSource: ref }; }
  if (t.kind === 'doc' && name === 'Width') {   // jamais plus étroit que le contrôle le plus à droite, comme `fit`
    if (typeof value !== 'number' || !Number.isFinite(value)) return doc;
    const props = setIn(doc.props, name, clamp(Math.round(value), maxRight(doc), MAX_TWIPS));
    return props === doc.props ? doc : { ...doc, props };
  }
  if (t.kind === 'doc') { const props = setIn(doc.props, name, value); return props === doc.props ? doc : { ...doc, props }; }
  if (t.kind === 'section') {
    const s = doc.sections[t.index];
    if (!s) return doc;
    if (name === 'Height') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return doc;
      const h = clamp(Math.round(value), sectionBottomLimit(s), MAX_TWIPS);
      return h === s.height ? doc : { ...doc, sections: doc.sections.map((x, i) => (i === t.index ? { ...x, height: h } : x)) };
    }
    const props = setIn(s.props, name, value);
    return props === s.props ? doc : { ...doc, sections: doc.sections.map((x, i) => (i === t.index ? { ...x, props } : x)) };
  }
  const e = findControl(doc, t.name);
  if (!e) return doc;
  const c = e.control;
  if (name === 'Name') {
    if (typeof value !== 'string' || !isValidObjectName(value) || entries(doc).some((o) => o.control !== c && sameName(o.control.name, value))) return doc;
    return value === c.name ? doc : updateControl(doc, c.name, (x) => ({ ...x, name: value }));
  }
  const field = ({ Left: 'left', Top: 'top', Width: 'width', Height: 'height' } as Record<string, keyof Rect | undefined>)[name];
  if (field) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return doc;
    const v = Math.round(value);
    const p = settle(new Map([[c, { [field]: field === 'width' || field === 'height' ? Math.max(v, minFor(c.kind)) : v }]]), isContainer); // un groupe emmène son contenu
    return p.size ? patchDoc(doc, p, isContainer) : doc;
  }
  return updateControl(doc, c.name, (x) => { const props = setIn(x.props, name, value); return props === x.props ? x : { ...x, props }; });
}

function arrange(s: DesignerState, op: ArrangeOp): DesignerState {
  const sel = selected(s);
  const n = sel.length;
  const step = gridStep(s.doc);
  if (op === 'bringToFront' || op === 'sendToBack') {
    const set = new Set(sel.map((e) => e.control));
    let changed = false;
    const doc = mapLists(s.doc, (list) => {
      if (!list.some((c) => set.has(c))) return list;
      const mine = list.filter((c) => set.has(c)), others = list.filter((c) => !set.has(c));
      const next = op === 'bringToFront' ? [...others, ...mine] : [...mine, ...others];
      if (next.some((c, i) => c !== list[i])) changed = true;
      return next;
    });
    return changed ? push(s, doc) : s;
  }
  const grid = op === 'alignToGrid' || op === 'sizeToGrid';
  const spacing = op.startsWith('space');
  const need = grid ? 1 : spacing ? 0 : 2;   // l'espacement vérifie son minimum par groupe
  if (n < need) return s;
  const patches: Patches = new Map();
  const set = (e: Entry, p: Partial<Rect>): void => { patches.set(e.control, { ...patches.get(e.control), ...p }); };
  const rects = sel.map((e) => controlRect(e.control));
  const pick = (f: (r: Rect) => number, m: (...v: number[]) => number): number => m(...rects.map(f));
  switch (op) {
    case 'alignLeft': { const l = pick((r) => r.left, Math.min); sel.forEach((e) => set(e, { left: l })); break; }
    case 'alignRight': { const r = pick((x) => x.left + x.width, Math.max); sel.forEach((e) => set(e, { left: r - e.control.width })); break; }
    case 'alignTop': case 'alignBottom':   // section par section
      for (const si of new Set(sel.map((e) => e.section))) {
        const g = sel.filter((e) => e.section === si);
        if (op === 'alignTop') { const t = Math.min(...g.map((e) => e.control.top)); g.forEach((e) => set(e, { top: t })); }
        else { const b = Math.max(...g.map((e) => e.control.top + e.control.height)); g.forEach((e) => set(e, { top: b - e.control.height })); }
      }
      break;
    case 'alignToGrid': sel.forEach((e) => set(e, { left: snap(e.control.left, step), top: snap(e.control.top, step) })); break;
    case 'sizeToWidest': { const w = pick((r) => r.width, Math.max); sel.forEach((e) => set(e, { width: w })); break; }
    case 'sizeToNarrowest': { const w = pick((r) => r.width, Math.min); sel.forEach((e) => set(e, { width: Math.max(w, minFor(e.control.kind)) })); break; }
    case 'sizeToTallest': { const h = pick((r) => r.height, Math.max); sel.forEach((e) => set(e, { height: h })); break; }
    case 'sizeToShortest': { const h = pick((r) => r.height, Math.min); sel.forEach((e) => set(e, { height: Math.max(h, minFor(e.control.kind)) })); break; }
    case 'sizeToGrid':
      for (const e of sel) {
        const c = e.control, l = snap(c.left, step), t = snap(c.top, step);
        set(e, { left: l, top: t, width: Math.max(minFor(c.kind), snap(c.left + c.width, step) - l), height: Math.max(minFor(c.kind), snap(c.top + c.height, step) - t) });
      }
      break;
    default: {   // space{Horizontal,Vertical}{Equal,Increase,Decrease} ; l'espacement vertical se fait section par section
      const horiz = op.startsWith('spaceHorizontal');
      const [pos, size] = horiz ? (['left', 'width'] as const) : (['top', 'height'] as const);
      const min = op.endsWith('Equal') ? 3 : 2;
      for (const g of horiz ? [sel] : [...new Set(sel.map((e) => e.section))].map((si) => sel.filter((e) => e.section === si))) {
        if (g.length < min) continue;
        const sorted = [...g].sort((a, b) => a.control[pos] - b.control[pos]);
        const m = sorted.length, first = sorted[0].control, last = sorted[m - 1].control;
        if (op.endsWith('Equal')) {
          const gap = (last[pos] + last[size] - first[pos] - sorted.reduce((t, e) => t + e.control[size], 0)) / (m - 1);
          let cur = first[pos] + first[size];
          for (let i = 1; i < m - 1; i++) { cur += gap; set(sorted[i], { [pos]: Math.round(cur) }); cur += sorted[i].control[size]; }
        } else {
          const sign = op.endsWith('Increase') ? 1 : -1;
          sorted.forEach((e, k) => { if (k) set(e, { [pos]: Math.max(0, e.control[pos] + sign * k * step) }); });
        }
      }
    }
  }
  return applyPatches(s, patches, () => true);
}

function insert(s: DesignerState, a: Extract<DesignerAction, { type: 'insert' }>): DesignerState {
  const pe = a.parent ? findControl(s.doc, a.parent) : null;
  const parent = pe && isContainer(pe.control) ? pe.control : null;
  const section = parent ? pe!.section : a.section;
  if (!s.doc.sections[section] || !a.controls.length) return s;
  const used = entries(s.doc).map((e) => e.control.name);
  const fresh = (c: ControlDef): ControlDef => {
    const name = uniqueIn(used, c.name);
    used.push(name);
    return { ...c, name, left: clamp(c.left, 0, MAX_TWIPS), top: clamp(c.top, 0, MAX_TWIPS), width: clamp(c.width, 0, MAX_TWIPS), height: clamp(c.height, 0, MAX_TWIPS),
      ...(c.children ? { children: c.children.map(fresh) } : {}) };
  };
  const added = a.controls.map(fresh);
  const doc = parent ? updateControl(s.doc, parent.name, (c) => ({ ...c, children: [...(c.children ?? []), ...added] }))
    : mapLists(s.doc, (list, owner, si) => (owner === null && si === section ? [...list, ...added] : list));
  return push(s, fit(doc, s.objectKind), { kind: 'controls', names: added.map((c) => c.name) });
}

function changeSection(s: DesignerState, a: Extract<DesignerAction, { type: 'changeSection' }>): DesignerState {
  const sel = selected(s);
  const names = sel.map((e) => e.control.name);
  const underSelected = (e: Entry): boolean => e.parent !== null && (names.some((n) => sameName(n, e.parent!)) || underSelected(findControl(s.doc, e.parent)!));
  const roots = sel.filter((e) => !underSelected(e));
  if (!roots.length || !s.doc.sections[a.to]) return s;
  const all = roots.flatMap((e) => subtree(e.control)).map(controlRect);
  const top = Math.min(...roots.map((e) => e.control.top));
  const grid = s.snap && !a.free, step = gridStep(s.doc);
  const want = grid ? snap(a.top, step) : Math.round(a.top);
  const dy = clamp(want - top, -Math.min(...all.map((r) => r.top)), MAX_TWIPS - Math.max(...all.map((r) => r.top + r.height)));
  const left = Math.min(...roots.map((e) => e.control.left));
  let dx = Math.round(a.dx ?? 0);
  if (dx && grid) dx = snap(left + dx, step) - left;   // comme moveBy : seul l'axe qui bouge s'aimante
  dx = clamp(dx, -Math.min(...all.map((r) => r.left)), MAX_TWIPS - Math.max(...all.map((r) => r.left + r.width)));
  const movers = roots.filter((e) => e.section !== a.to || e.parent !== null);   // les autres restent à leur place dans la pile
  if (!dy && !dx && !movers.length) return s;
  const moved = patchDoc(s.doc, new Map(roots.map((e) => [e.control, { left: e.control.left + dx, top: e.control.top + dy }])), () => true);
  const out = movers.map((e) => findControl(moved, e.control.name)!.control);
  const rest = mapLists(moved, (list) => list.filter((c) => !out.includes(c)));
  return push(s, fit({ ...rest, sections: rest.sections.map((x, i) => (i === a.to ? { ...x, controls: [...x.controls, ...out] } : x)) }, s.objectKind));
}

export function designerReducer(s: DesignerState, a: DesignerAction): DesignerState {
  switch (a.type) {
    case 'load': return { ...initDesigner(a.doc, a.objectKind ?? s.objectKind), snap: s.snap };
    case 'saved': return { ...s, dirty: false, past: [], future: [] };
    case 'select': return { ...s, selection: a.selection };
    case 'toggleSelect': {
      const names = s.selection.kind === 'controls' ? s.selection.names : [];
      return { ...s, selection: { kind: 'controls', names: names.some((n) => sameName(n, a.name)) ? names.filter((n) => !sameName(n, a.name)) : [...names, a.name] } };
    }
    case 'selectAll': return { ...s, selection: { kind: 'controls', names: s.doc.sections.flatMap((x) => x.controls.flatMap(selectable)).map((c) => c.name) } };
    case 'selectRect': {
      const sec = s.doc.sections[a.section];
      if (!sec) return s;
      const hit = sec.controls.flatMap(selectable).filter((c) => intersects(controlRect(c), a.rect)).map((c) => c.name);
      const old = a.add && s.selection.kind === 'controls' ? s.selection.names : [];
      const names = [...old, ...hit.filter((n) => !old.some((o) => sameName(o, n)))];
      return names.length ? { ...s, selection: { kind: 'controls', names } } : a.add ? s : { ...s, selection: { kind: 'section', index: a.section } };
    }
    case 'moveBy': {
      const sel = selected(s);
      if (!sel.length) return s;
      const bb = bounds(sel.map((e) => controlRect(e.control)));
      let dx = Math.round(a.dx), dy = Math.round(a.dy);
      if (s.snap && !a.free) { const step = gridStep(s.doc); if (dx) dx = snap(bb.left + dx, step) - bb.left; if (dy) dy = snap(bb.top + dy, step) - bb.top; }   // seul l'axe qui bouge s'aimante
      const all = sel.flatMap((e) => subtree(e.control)).map(controlRect);   // le groupe garde sa forme : un seul delta, borné pour tous
      dx = clamp(dx, -Math.min(...all.map((r) => r.left)), MAX_TWIPS - Math.max(...all.map((r) => r.left + r.width)));
      dy = clamp(dy, -Math.min(...all.map((r) => r.top)), MAX_TWIPS - Math.max(...all.map((r) => r.top + r.height)));
      if (!dx && !dy) return s;
      return applyPatches(s, new Map(sel.map((e) => [e.control, { left: e.control.left + dx, top: e.control.top + dy }])), () => true);
    }
    case 'changeSection': return changeSection(s, a);
    case 'resize': {
      const sel = selected(s);
      if (!sel.length) return s;
      const bb = bounds(sel.map((e) => controlRect(e.control)));
      const h = a.handle;
      const step = gridStep(s.doc), grid = s.snap && !a.free;
      const edge = (from: number, d: number): number => (grid ? snap(from + d, step) - from : Math.round(d)); // le bord qui bouge s'aimante
      const rb = resizeRect(bb, h, h.includes('e') ? edge(bb.left + bb.width, a.dx) : h.includes('w') ? edge(bb.left, a.dx) : 0,
        h.includes('s') ? edge(bb.top + bb.height, a.dy) : h.includes('n') ? edge(bb.top, a.dy) : 0, 0);
      const dx = h.includes('e') ? rb.left + rb.width - bb.left - bb.width : h.includes('w') ? rb.left - bb.left : 0;
      const dy = h.includes('s') ? rb.top + rb.height - bb.top - bb.height : h.includes('n') ? rb.top - bb.top : 0;
      // chaque contrôle subit le même déplacement de bord ; un conteneur redimensionné ne déplace pas son contenu
      return applyPatches(s, new Map(sel.map((e) => [e.control, resizeRect(controlRect(e.control), h, dx, dy, minFor(e.control.kind))])), () => false);
    }
    case 'insert': return insert(s, a);
    case 'deleteSelection': {
      const gone = selected(s).map((e) => e.control);
      if (!gone.length) return s;
      return push(s, mapLists(s.doc, (list) => list.filter((c) => !gone.includes(c))), { kind: 'doc' });
    }
    case 'setProp': {
      const doc = a.targets.reduce((d, t) => setProp(d, t, a.name, a.value), s.doc);
      if (doc === s.doc) return s;
      return push(s, ['Left', 'Top', 'Width', 'Height'].includes(a.name) ? fit(doc, s.objectKind) : doc, a.name === 'Name' && a.targets.length === 1 && a.targets[0].kind === 'control' && s.selection.kind === 'controls'
        ? { kind: 'controls', names: s.selection.names.map((n) => (sameName(n, (a.targets[0] as { name: string }).name) ? String(a.value) : n)) } : s.selection);
    }
    case 'setSectionHeight': {
      const doc = setProp(s.doc, { kind: 'section', index: a.index }, 'Height', a.height);
      return doc === s.doc ? s : push(s, doc);
    }
    case 'arrange': return arrange(s, a.op);
    case 'edit': { const doc = a.apply(s.doc); return doc === s.doc ? s : push(s, doc); }
    case 'toggleSnap': return { ...s, snap: !s.snap };
    case 'undo': return s.past.length ? { ...s, doc: s.past[s.past.length - 1], selection: prune(s.past[s.past.length - 1], s.selection), past: s.past.slice(0, -1), future: [s.doc, ...s.future], dirty: true } : s;
    case 'redo': return s.future.length ? { ...s, doc: s.future[0], selection: prune(s.future[0], s.selection), past: [...s.past, s.doc].slice(-HISTORY), future: s.future.slice(1), dirty: true } : s;
  }
}

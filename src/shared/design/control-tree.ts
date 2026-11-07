// Arbre des contrôles d'un document de conception (module pur, partagé avec basecraft-cli) : recherche, noms uniques, reconstruction des listes.
import { sameName } from '../field-types';
import type { ControlDef, DesignDoc, SectionDef } from './model';

export interface Entry { control: ControlDef; section: number; parent: string | null }
export function entries(doc: DesignDoc): Entry[] {
  const out: Entry[] = [];
  const rec = (list: ControlDef[], section: number, parent: string | null): void => {
    for (const control of list) { out.push({ control, section, parent }); if (control.children) rec(control.children, section, control.name); }
  };
  doc.sections.forEach((s, i) => rec(s.controls, i, null));
  return out;
}
export const subtree = (c: ControlDef): ControlDef[] => [c, ...(c.children ?? []).flatMap(subtree)];

export function findControl(doc: DesignDoc, name: string): { control: ControlDef; section: number; parent: string | null } | null {
  return entries(doc).find((e) => sameName(e.control.name, name)) ?? null;
}
export const sectionBottomLimit = (s: SectionDef): number => Math.max(0, ...s.controls.flatMap(subtree).map((c) => c.top + c.height));

export function uniqueIn(names: string[], base: string): string {
  if (!names.some((n) => sameName(n, base))) return base;
  for (let i = 1; ; i++) if (!names.some((n) => sameName(n, base + i))) return base + i;
}
export const uniqueName = (doc: DesignDoc, base: string): string => uniqueIn(entries(doc).map((e) => e.control.name), base);

/** Mêmes éléments dans le même ordre : une liste intacte est gardée telle quelle (le canevas ne redessine que ce qui change). */
export const same = <T,>(a: T[], b: T[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
/** Reconstruit les listes de contrôles, de haut en bas : `fn` voit la liste d'origine d'une section (owner null) ou d'un conteneur. */
export function mapLists(doc: DesignDoc, fn: (list: ControlDef[], owner: ControlDef | null, section: number) => ControlDef[]): DesignDoc {
  const rec = (list: ControlDef[], owner: ControlDef | null, si: number): ControlDef[] =>
    fn(list, owner, si).map((c) => { if (!c.children) return c; const kids = rec(c.children, c, si); return same(kids, c.children) ? c : { ...c, children: kids }; });
  return { ...doc, sections: doc.sections.map((s, i) => { const cs = rec(s.controls, null, i); return same(cs, s.controls) ? s : { ...s, controls: cs }; }) };
}
export function updateControl(doc: DesignDoc, name: string, fn: (c: ControlDef) => ControlDef): DesignDoc {
  const e = findControl(doc, name);
  if (!e) return doc;
  const n = fn(e.control);
  return n === e.control ? doc : mapLists(doc, (list) => list.map((c) => (c === e.control ? n : c)));
}

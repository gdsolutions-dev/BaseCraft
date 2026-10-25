// Le concepteur de macros, sans React : la définition modifiée, la sélection, les blocs réduits. Un chemin (ItemPath) suit les
// index à travers items / branches[b].items / else : dans un Si, le segment qui suit son index est la branche b (-1 : Sinon).
// Le concepteur ne peut pas créer de problème submacroPlace / submacroOrder ; les clés inconnues d'un élément sont gardées.
import { ACTIONS, type ActionDef } from '../../shared/macro/catalog';
import type { MacroDef, MacroItem } from '../../shared/macro/model';
import { i18n } from '../i18n';

export type ItemPath = number[];
export interface MacroEditState { def: MacroDef; selected: ItemPath | null; collapsed: Set<string>; dirty: boolean; showAll: boolean; catalog: boolean }
export type MacroEditAction =
  | { type: 'add'; at: ItemPath; item: MacroItem }
  | { type: 'remove'; path: ItemPath } | { type: 'move'; path: ItemPath; dir: -1 | 1 }
  | { type: 'setArg'; path: ItemPath; name: string; value: string | undefined }
  | { type: 'setCondition'; path: ItemPath; branch: number; cond: string }
  | { type: 'addElseIf'; path: ItemPath } | { type: 'addElse'; path: ItemPath }
  | { type: 'setText'; path: ItemPath; text: string }
  | { type: 'select'; path: ItemPath | null } | { type: 'collapse'; path: ItemPath; on: boolean } | { type: 'collapseAll'; on: boolean }
  | { type: 'toggleCatalog' } | { type: 'toggleShowAll' } | { type: 'saved' };

export const pathKey = (p: ItemPath): string => (p.length ? p.join('.') : 'root');
export const initialEdit = (def: MacroDef): MacroEditState => ({ def, selected: null, collapsed: new Set(), dirty: false, showAll: false, catalog: false });

/** The actions « Ajouter une nouvelle action » and the Action Catalog offer, by label: the unsafe ones only with Show All Actions
 *  (Access). Whether the base's content is enabled does not change the list: a disabled base refuses unsafe actions when they run. */
export function addableActions(showAll: boolean): ActionDef[] {
  const label = (a: ActionDef) => i18n.t(`macro.action.${a.name}`);
  return ACTIONS.filter((a) => showAll || !a.unsafe).sort((a, b) => label(a).localeCompare(label(b), i18n.language));
}

/** The list a block holds at `lp` (the path of the list: an item's path without its last index), or undefined. */
function listAt(items: MacroItem[], lp: ItemPath): MacroItem[] | undefined {
  if (!lp.length) return items;
  const it = items[lp[0]];
  if (!it) return undefined;
  if (it.k === 'if') {
    const list = lp[1] === -1 ? it.else : it.branches[lp[1]]?.items;
    return list && listAt(list, lp.slice(2));
  }
  return it.k === 'group' || it.k === 'submacro' ? listAt(it.items, lp.slice(1)) : undefined;
}

/** `items` with the list at `lp` replaced by fn(list); the same array when there is no such list. */
function mapList(items: MacroItem[], lp: ItemPath, fn: (l: MacroItem[]) => MacroItem[]): MacroItem[] {
  if (!lp.length) return fn(items);
  const [i, ...rest] = lp, it = items[i];
  let next: MacroItem;
  if (it?.k === 'if') {
    const [b, ...r2] = rest;
    if (b === -1) { if (!it.else) return items; next = { ...it, else: mapList(it.else, r2, fn) }; }
    else { if (!it.branches[b]) return items; next = { ...it, branches: it.branches.map((x, j) => (j === b ? { ...x, items: mapList(x.items, r2, fn) } : x)) }; }
  } else if (it?.k === 'group' || it?.k === 'submacro') next = { ...it, items: mapList(it.items, rest, fn) };
  else return items;
  return items.map((x, j) => (j === i ? next : x));
}

/** `items` with the item at `path` replaced by fn(item). */
const mapItem = (items: MacroItem[], path: ItemPath, fn: (it: MacroItem) => MacroItem): MacroItem[] =>
  mapList(items, path.slice(0, -1), (l) => (l[path.at(-1)!] ? l.map((x, j) => (j === path.at(-1) ? fn(x) : x)) : l));

/** A path that ends on a branch of an If (its index then b), rather than on an item. */
function branchOf(items: MacroItem[], path: ItemPath): { ifPath: ItemPath; b: number } | null {
  const ifPath = path.slice(0, -1);
  if (!ifPath.length) return null;
  const parent = listAt(items, ifPath.slice(0, -1))?.[ifPath.at(-1)!];
  return parent?.k === 'if' ? { ifPath, b: path.at(-1)! } : null;
}

/** Where the Action Catalog adds: after the selected item, at the end of a selected If branch, else at the end of the main body. */
export function addPoint({ def, selected }: MacroEditState): ItemPath {
  if (!selected) return [def.items.length];   // 'add' keeps it before the submacros
  if (branchOf(def.items, selected)) return [...selected, Number.MAX_SAFE_INTEGER];   // 'add' clamps it to the branch's length
  return [...selected.slice(0, -1), selected.at(-1)! + 1];
}

function keys(items: MacroItem[], prefix: ItemPath, out: string[]): string[] {
  items.forEach((it, i) => {
    const p = [...prefix, i];
    out.push(pathKey(p));
    if (it.k === 'group' || it.k === 'submacro') keys(it.items, p, out);
    else if (it.k === 'if') { it.branches.forEach((b, j) => keys(b.items, [...p, j], out)); if (it.else) keys(it.else, [...p, -1], out); }
  });
  return out;
}

export function macroEdit(s: MacroEditState, a: MacroEditAction): MacroEditState {
  // ponytail: collapsed blocks are keyed by path, so a change of structure expands them all; key by item identity if users mind
  const edit = (items: MacroItem[], selected = s.selected, structural = false): MacroEditState =>
    items === s.def.items ? s : { ...s, def: { ...s.def, items }, selected, dirty: true, ...(structural ? { collapsed: new Set<string>() } : {}) };
  const items = s.def.items;
  switch (a.type) {
    case 'add': {
      if (a.item.k === 'submacro') return edit([...items, a.item], [items.length], true);   // always last, at the top level
      const lp = a.at.slice(0, -1), list = listAt(items, lp);
      if (!list) return s;
      let at = Math.max(0, Math.min(a.at.at(-1)!, list.length));
      if (!lp.length) { const firstSub = list.findIndex((x) => x.k === 'submacro'); if (firstSub >= 0) at = Math.min(at, firstSub); }
      return edit(mapList(items, lp, (l) => [...l.slice(0, at), a.item, ...l.slice(at)]), [...lp, at], true);
    }
    case 'remove': {
      const br = branchOf(items, a.path);
      if (br) {
        return edit(mapList(items, br.ifPath.slice(0, -1), (l) => l.flatMap((x, j) => {
          if (j !== br.ifPath.at(-1) || x.k !== 'if') return [x];
          if (br.b === -1) { const { else: _gone, ...rest } = x; return [rest as MacroItem]; }
          const branches = x.branches.filter((_, k) => k !== br.b);
          return branches.length ? [{ ...x, branches }] : [];   // the last branch takes the If with it
        })), null, true);
      }
      const lp = a.path.slice(0, -1), i = a.path.at(-1)!;
      if (!listAt(items, lp)?.[i]) return s;
      return edit(mapList(items, lp, (l) => l.filter((_, j) => j !== i)), null, true);
    }
    case 'move': {
      const lp = a.path.slice(0, -1), i = a.path.at(-1)!, j = i + a.dir, list = listAt(items, lp);
      if (!list?.[i] || !list[j]) return s;   // never out of its block
      if ((list[i].k === 'submacro') !== (list[j].k === 'submacro')) return s;   // submacros stay after the main body
      return edit(mapList(items, lp, (l) => l.map((x, k) => (k === i ? l[j] : k === j ? l[i] : x))), [...lp, j], true);
    }
    case 'setArg':
      return edit(mapItem(items, a.path, (it) => {
        if (it.k !== 'action') return it;
        const args = { ...it.args };
        if (a.value === undefined) delete args[a.name]; else args[a.name] = a.value;
        return { ...it, args };
      }));
    case 'setCondition':
      return edit(mapItem(items, a.path, (it) => (it.k === 'if' && it.branches[a.branch]
        ? { ...it, branches: it.branches.map((b, j) => (j === a.branch ? { ...b, cond: a.cond } : b)) } : it)));
    case 'addElseIf':
      return edit(mapItem(items, a.path, (it) => (it.k === 'if' ? { ...it, branches: [...it.branches, { cond: '', items: [] }] } : it)));
    case 'addElse':
      return edit(mapItem(items, a.path, (it) => (it.k === 'if' && !it.else ? { ...it, else: [] } : it)));
    case 'setText':
      return edit(mapItem(items, a.path, (it) => (it.k === 'comment' ? { ...it, text: a.text }
        : it.k === 'group' || it.k === 'submacro' ? { ...it, name: a.text } : it)));
    case 'select': return { ...s, selected: a.path };
    case 'collapse': {
      const collapsed = new Set(s.collapsed);
      if (a.on) collapsed.add(pathKey(a.path)); else collapsed.delete(pathKey(a.path));
      return { ...s, collapsed };
    }
    case 'collapseAll': return { ...s, collapsed: new Set(a.on ? keys(items, [], []) : []) };
    case 'toggleCatalog': return { ...s, catalog: !s.catalog };
    case 'toggleShowAll': return { ...s, showAll: !s.showAll };
    case 'saved': return { ...s, dirty: false };
  }
}

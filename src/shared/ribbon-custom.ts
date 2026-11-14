// Customize Ribbon (File > Options): which main tabs show and in what order, their names, and the custom tabs and groups that
// hold existing commands. A workstation setting; the ribbon model builds the tabs from it. Pure: shared with the settings check.
export interface CustomGroup { id: string; label: string; commands: string[] }
export interface CustomTab { id: string; label: string; groups: CustomGroup[] }
export interface RibbonCustom {
  hidden: string[];                    // built-in main tabs not shown (Home is never hidden)
  order: string[];                     // tab ids in the wanted order (built-in and custom); the others follow in their own order
  names: Record<string, string>;       // renamed built-in tabs
  tabs: CustomTab[];                   // custom tabs, after the built-in ones until reordered
  groups?: Record<string, CustomGroup[]>; // custom groups inside built-in tabs (key: tab id, contextual tabs too), after the built-in groups
  groupNames?: Record<string, string>; // renamed built-in groups (key: "tab.group")
}
export const NO_RIBBON_CUSTOM: RibbonCustom = { hidden: [], order: [], names: {}, tabs: [] };

const ID = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const GROUP_KEY = /^[A-Za-z][A-Za-z0-9]{0,39}\.[A-Za-z][A-Za-z0-9]{0,39}$/;
const CUSTOM_ID = /^[cg][0-9]{1,6}$/;   // custom tab: c1; custom group: g1 (never a built-in id)
// eslint-disable-next-line no-control-regex
const label = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 1 && v.length <= 40 && !/[\u0000-\u001f\u007f]/.test(v);
const ids = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && ID.test(x)) && new Set(v).size === v.length;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Valid: bounded lists, command ids shaped as ids, custom ids unique and never a built-in tab's, labels short and printable. */
export function isRibbonCustom(v: unknown): v is RibbonCustom {
  if (!isObj(v) || !ids(v.hidden, 20) || !ids(v.order, 40) || !isObj(v.names) || !Array.isArray(v.tabs) || v.tabs.length > 10) return false;
  if (Object.entries(v.names).length > 20 || !Object.entries(v.names).every(([k, n]) => ID.test(k) && label(n))) return false;
  const seen = new Set<string>();
  const once = (id: unknown) => typeof id === 'string' && CUSTOM_ID.test(id) && !seen.has(id) && !!seen.add(id);
  const groups = (gs: unknown) => Array.isArray(gs) && gs.length <= 10
    && gs.every((g) => isObj(g) && once(g.id) && label(g.label) && Array.isArray(g.commands) && g.commands.length <= 40
      && g.commands.every((c) => typeof c === 'string' && ID.test(c)));
  const { groups: inTabs, groupNames } = v;
  if (inTabs !== undefined && !(isObj(inTabs) && Object.keys(inTabs).length <= 30 && Object.entries(inTabs).every(([k, g]) => ID.test(k) && groups(g)))) return false;
  if (groupNames !== undefined && !(isObj(groupNames) && Object.keys(groupNames).length <= 200
    && Object.entries(groupNames).every(([k, n]) => GROUP_KEY.test(k) && label(n)))) return false;
  return v.tabs.every((t) => isObj(t) && once(t.id) && label(t.label) && groups(t.groups));
}

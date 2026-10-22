// Ruban décrit par des données, et registre des commandes : le document actif fournit les actions.
import {
  ArrowDownZA, ArrowUpAZ, BetweenHorizontalStart, Eraser, FileText, KeyRound, ListX, PencilRuler, Plus, Save, Sheet, TableProperties,
  Trash2, type LucideIcon,
} from 'lucide-react';
import type { DocMode } from '../state/app-state';

export type CommandId = 'save' | 'viewDesign' | 'viewDatasheet' | 'createTableDesign' | 'primaryKey' | 'insertRows' | 'deleteRows'
  | 'newRecord' | 'deleteRecord' | 'sortAsc' | 'sortDesc' | 'sortClear' | 'importText';
export type CommandHandlers = Partial<Record<CommandId, () => void | Promise<void>>>;

/** Scope of the shell's own handlers, used when the active document does not provide the command. */
export const SHELL_SCOPE = '';
const registry = new Map<string, CommandHandlers>();
const listeners = new Set<() => void>();
let activeTab: string | null = null;
let context: RibbonContext = { hasBase: false, readOnly: false, mode: null, isNew: false };
let version = 0;
let reportError: (e: unknown) => void = (e) => console.error(e);

const changed = () => { version++; listeners.forEach((l) => l()); };
const handler = (id: CommandId) => (activeTab !== null ? registry.get(activeTab)?.[id] : undefined) ?? registry.get(SHELL_SCOPE)?.[id];

/** Registers a document's (or the shell's) handlers; returns the unregistration, which ignores a newer registration. */
export function registerCommands(tabId: string, handlers: CommandHandlers): () => void {
  const own = { ...handlers };
  registry.set(tabId, own);
  changed();
  return () => {
    if (registry.get(tabId) !== own) return;
    registry.delete(tabId);
    changed();
  };
}

/** Runs the active document's handler (else the shell's). A command without handler, or whose ribbon entry is disabled
 *  in the current context (read-only base…), does nothing: keyboard shortcuts obey the same gating as the ribbon. */
export function runCommand(id: CommandId): void {
  const h = handler(id);
  if (!h || !commandEnabled(id, context)) return;
  try {
    void Promise.resolve(h()).catch(reportError);
  } catch (e) {
    reportError(e);
  }
}

/** A document's say before its view goes: a change of mode (ribbon, status bar, navigation pane), closing its tab, closing
 *  or switching the base, closing the window. Resolves false to stay (a pending row that cannot be saved, a design kept).
 *  `reason` tells a change of mode (the document stays open) from a close (the document goes). */
export type ModeGuard = (reason: 'mode' | 'close') => Promise<boolean>;
const modeGuards = new Map<string, ModeGuard>();
export function registerModeGuard(tabId: string, guard: ModeGuard): () => void {
  modeGuards.set(tabId, guard);
  return () => { if (modeGuards.get(tabId) === guard) modeGuards.delete(tabId); };
}
export const modeGuard = (tabId: string): ModeGuard | undefined => modeGuards.get(tabId);

export function isCommandAvailable(id: CommandId): boolean { return handler(id) !== undefined; }
export function setActiveCommandTab(tabId: string | null): void { if (activeTab !== tabId) { activeTab = tabId; changed(); } }
export function setCommandContext(ctx: RibbonContext): void {
  if (JSON.stringify(ctx) !== JSON.stringify(context)) { context = { ...ctx }; changed(); }
}
/** Has a handler and its ribbon entry is enabled in `ctx`. */
export function commandEnabled(id: CommandId, ctx: RibbonContext): boolean {
  const entry = RIBBON.flatMap((t) => t.groups.flatMap((g) => g.commands)).find((c) => c.id === id);
  return isCommandAvailable(id) && (!entry || entry.enabled(ctx));
}
export function setCommandErrorHandler(fn: (e: unknown) => void): void { reportError = fn; }
export function subscribeCommands(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export const commandsVersion = (): number => version;

// ---------- Ruban ----------
/** isNew: the active document is a table not saved yet. */
export interface RibbonContext { hasBase: boolean; readOnly: boolean; mode: DocMode | null; isNew: boolean }
export interface RibbonCommand {
  id: CommandId; icon: LucideIcon; labelKey: string; size: 'lg' | 'sm';
  enabled(ctx: RibbonContext): boolean; active?(ctx: RibbonContext): boolean;
}
export interface RibbonGroup { labelKey: string; commands: RibbonCommand[] }
export interface RibbonTab { id: 'home' | 'create' | 'externalData' | 'design'; labelKey: string; contextual?: boolean; visible?(ctx: RibbonContext): boolean; groups: RibbonGroup[] }

const doc = (c: RibbonContext) => c.mode !== null;
const writable = (c: RibbonContext) => c.mode !== null && !c.readOnly;
const sheet = (c: RibbonContext) => c.mode === 'datasheet';
const sheetWritable = (c: RibbonContext) => sheet(c) && !c.readOnly;
const designWritable = (c: RibbonContext) => c.mode === 'design' && !c.readOnly;

const viewDatasheet: RibbonCommand = {
  id: 'viewDatasheet', icon: Sheet, labelKey: 'ribbon.cmd.viewDatasheet', size: 'lg', enabled: (c) => doc(c) && !c.isNew, active: sheet,
};
const viewDesign: RibbonCommand = { id: 'viewDesign', icon: PencilRuler, labelKey: 'ribbon.cmd.viewDesign', size: 'lg', enabled: doc, active: (c) => c.mode === 'design' };

export const RIBBON: RibbonTab[] = [
  {
    id: 'home', labelKey: 'ribbon.tab.home', groups: [
      { labelKey: 'ribbon.group.view', commands: [viewDatasheet, viewDesign] },
      {
        labelKey: 'ribbon.group.records', commands: [
          { id: 'newRecord', icon: Plus, labelKey: 'ribbon.cmd.newRecord', size: 'sm', enabled: sheetWritable },
          { id: 'save', icon: Save, labelKey: 'ribbon.cmd.save', size: 'sm', enabled: writable },
          { id: 'deleteRecord', icon: Trash2, labelKey: 'ribbon.cmd.deleteRecord', size: 'sm', enabled: sheetWritable },
        ],
      },
      {
        labelKey: 'ribbon.group.sort', commands: [
          { id: 'sortAsc', icon: ArrowUpAZ, labelKey: 'ribbon.cmd.sortAsc', size: 'sm', enabled: sheet },
          { id: 'sortDesc', icon: ArrowDownZA, labelKey: 'ribbon.cmd.sortDesc', size: 'sm', enabled: sheet },
          { id: 'sortClear', icon: Eraser, labelKey: 'ribbon.cmd.sortClear', size: 'sm', enabled: sheet },
        ],
      },
    ],
  },
  {
    id: 'create', labelKey: 'ribbon.tab.create', groups: [
      {
        labelKey: 'ribbon.group.tables', commands: [
          { id: 'createTableDesign', icon: TableProperties, labelKey: 'ribbon.cmd.createTableDesign', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        ],
      },
    ],
  },
  {
    id: 'externalData', labelKey: 'ribbon.tab.externalData', groups: [
      {
        labelKey: 'ribbon.group.import', commands: [
          { id: 'importText', icon: FileText, labelKey: 'ribbon.cmd.importText', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        ],
      },
    ],
  },
  {
    id: 'design', labelKey: 'ribbon.tab.design', contextual: true, visible: (c) => c.mode === 'design', groups: [
      { labelKey: 'ribbon.group.view', commands: [viewDatasheet] },
      {
        labelKey: 'ribbon.group.tools', commands: [
          { id: 'primaryKey', icon: KeyRound, labelKey: 'ribbon.cmd.primaryKey', size: 'lg', enabled: designWritable },
          { id: 'insertRows', icon: BetweenHorizontalStart, labelKey: 'ribbon.cmd.insertRows', size: 'sm', enabled: designWritable },
          { id: 'deleteRows', icon: ListX, labelKey: 'ribbon.cmd.deleteRows', size: 'sm', enabled: designWritable },
        ],
      },
    ],
  },
];

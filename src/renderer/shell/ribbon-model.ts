// Ruban décrit par des données, et registre des commandes : le document actif fournit les actions.
import {
  ALargeSmall, AlignCenter, AlignLeft, AlignRight, AlignStartVertical, Anchor, AppWindow, ArrowDown, ArrowDownToLine, ArrowDownZA,
  ArrowLeftToLine, ArrowRightLeft, ArrowRightToLine, ArrowUp, ArrowUpAZ, ArrowUpNarrowWide, ArrowUpToLine, Asterisk, Baseline,
  BetweenHorizontalStart, BetweenVerticalStart, Blend, Bold, BookOpen, Box, Braces, BringToFront, Brush, Cable, CalendarClock, ChartBar,
  ChartColumn, ChartPie, ChevronsDown, ChevronsUp, ChevronsUpDown, CircleDot, CircleHelp, CirclePlus, ClipboardList, ClipboardPaste,
  CloudUpload, Code, Columns2, Columns3, Combine, Copy, Cylinder, Database, DecimalsArrowLeft, DecimalsArrowRight, Ellipsis, Eraser, Euro,
  Expand, ExternalLink, Eye, EyeOff, File, FileCode, FileCode2, FileCog, FilePen, FileSearch, FileSpreadsheet, FileText, FileType, Files,
  Fingerprint, FolderInput, FolderOutput, FoldVertical, Frame, Funnel, FunnelX, Gauge, GitCommitHorizontal, GitFork, Globe,
  GraduationCap, Grid2x2, Grid3x3, Group, Hash, Heading, Heading1, Highlighter, Image, ImagePlus, IndentDecrease, IndentIncrease, Italic,
  KeyRound, LayoutGrid, LayoutTemplate, LetterText, LifeBuoy, Link, List, ListChecks, ListFilter, ListMinus, ListOrdered, ListPlus,
  ListTree, ListX, Merge, MessageSquare, Minus, MousePointer2, Navigation, Network, Paintbrush, PaintBucket, PanelRight, PanelTop,
  Palette, Paperclip, PencilLine, PencilRuler, PenLine, Percent, PilcrowRight, Play, Plus, Printer, RectangleHorizontal, RectangleVertical,
  RefreshCw, Replace, Rows2, Rows3, Ruler, Save, Scaling, Scan, ScanSearch, Scissors, ScrollText, Search, SendToBack,
  SeparatorHorizontal, Server, Settings, Settings2, Shapes, Sheet, ShieldCheck, Sigma, SlidersHorizontal, Sparkles, SpellCheck, Split,
  Square, SquareCheck, SquareDashed, SquareDashedMousePointer, SquareFunction, SquarePlus, SquareSplitHorizontal, SquareSplitVertical,
  StepForward, SwatchBook, Table, Table2, TableProperties, Tag, Tags, TextCursorInput, ToggleLeft, Trash, Trash2, Type, Underline,
  UnfoldVertical, Ungroup, Wallpaper, Wand, WandSparkles, Wrench, X, Zap, ZoomIn, type LucideIcon,
} from 'lucide-react';
import type { ObjectKind } from '../../shared/api';
import type { DocKind, DocMode } from '../state/app-state';

// One member per line (C4): each batch appends its own line.
export type CommandId =
  | 'save'
  | 'viewDesign'
  | 'viewDatasheet'
  | 'createTableDesign'
  | 'primaryKey'
  | 'insertRows'
  | 'deleteRows'
  | 'newRecord'
  | 'deleteRecord'
  | 'sortAsc'
  | 'sortDesc'
  | 'sortClear'
  | 'importText'
  | 'refresh'
  | 'paste'
  | 'cut'
  | 'copy'
  | 'formatPainter'
  | 'showClipboard'
  | 'filter'
  | 'filterSelection'
  | 'filterAdvanced'
  | 'filterToggle'
  | 'recordsTotals'
  | 'spelling'
  | 'moreRecords'
  | 'find'
  | 'replace'
  | 'goTo'
  | 'selectMenu'
  | 'textFont'
  | 'textFontSize'
  | 'bullets'
  | 'numbering'
  | 'indentIncrease'
  | 'indentDecrease'
  | 'textDirection'
  | 'textBold'
  | 'textItalic'
  | 'textUnderline'
  | 'textFontColor'
  | 'textHighlight'
  | 'textBackColor'
  | 'textAlignLeft'
  | 'textAlignCenter'
  | 'textAlignRight'
  | 'datasheetGridlines'
  | 'alternateRowColor'
  | 'datasheetFormatting'
  | 'zoom'
  | 'createTable'
  | 'queryWizard'
  | 'createQueryDesign'
  | 'createSqlQuery'
  | 'createForm'
  | 'createFormDesign'
  | 'createBlankForm'
  | 'formWizard'
  | 'navigationForm'
  | 'moreForms'
  | 'createReport'
  | 'createReportDesign'
  | 'createBlankReport'
  | 'reportWizard'
  | 'labels'
  | 'createMacro'
  | 'createModule'
  | 'pythonEditor'
  | 'importExcel'
  | 'importXml'
  | 'importAccess'
  | 'importSqlServer'
  | 'importPostgreSql'
  | 'importOdbc'
  | 'savedImports'
  | 'linkedTableManager'
  | 'savedExports'
  | 'exportExcel'
  | 'exportText'
  | 'exportPdf'
  | 'exportAccess'
  | 'exportXml'
  | 'exportMore'
  | 'compactRepair'
  | 'runMacro'
  | 'relationships'
  | 'objectDependencies'
  | 'databaseDocumenter'
  | 'analyzePerformance'
  | 'analyzeTable'
  | 'moveToServer'
  | 'splitDatabase'
  | 'help'
  | 'contactSupport'
  | 'feedback'
  | 'showTraining'
  | 'whatsNew'
  | 'builder'
  | 'testValidationRules'
  | 'modifyLookups'
  | 'propertySheet'
  | 'indexes'
  | 'createDataMacros'
  | 'renameDeleteMacro'
  | 'addShortText'
  | 'addNumber'
  | 'addCurrency'
  | 'addDateTime'
  | 'addYesNo'
  | 'moreFields'
  | 'deleteField'
  | 'nameCaption'
  | 'defaultValue'
  | 'fieldSize'
  | 'modifyExpression'
  | 'dataType'
  | 'format'
  | 'currencyFormat'
  | 'percentFormat'
  | 'commaFormat'
  | 'increaseDecimals'
  | 'decreaseDecimals'
  | 'required'
  | 'unique'
  | 'indexed'
  | 'validation'
  | 'tableProperties'
  | 'beforeChange'
  | 'beforeDelete'
  | 'afterInsert'
  | 'afterUpdate'
  | 'afterDelete'
  | 'namedMacro'
  | 'editRelationships'
  | 'clearLayout'
  | 'relationshipReport'
  | 'addTables'
  | 'hideTable'
  | 'directRelationships'
  | 'allRelationships'
  | 'closeRelationships'
  | 'viewSql'
  | 'runQuery'
  | 'selectQuery'
  | 'makeTableQuery'
  | 'appendQuery'
  | 'updateQuery'
  | 'crosstabQuery'
  | 'deleteQuery'
  | 'unionQuery'
  | 'passThroughQuery'
  | 'insertColumns'
  | 'deleteColumns'
  | 'returnValues'
  | 'queryTotals'
  | 'parameters'
  | 'tableNames'
  | 'themes'
  | 'themeColors'
  | 'themeFonts'
  | 'select'
  | 'textBox'
  | 'label'
  | 'button'
  | 'tabControl'
  | 'hyperlink'
  | 'navigationControl'
  | 'optionGroup'
  | 'insertPageBreak'
  | 'comboBox'
  | 'line'
  | 'toggleButton'
  | 'listBox'
  | 'rectangle'
  | 'checkBox'
  | 'unboundObjectFrame'
  | 'attachment'
  | 'optionButton'
  | 'subform'
  | 'boundObjectFrame'
  | 'image'
  | 'webBrowser'
  | 'chart'
  | 'insertImage'
  | 'insertModernChart'
  | 'logo'
  | 'title'
  | 'dateTime'
  | 'addExistingFields'
  | 'tabOrder'
  | 'chartSettings'
  | 'subformInNewWindow'
  | 'viewCode'
  | 'groupSort'
  | 'reportTotals'
  | 'hideDetails'
  | 'pageNumbers'
  | 'subreportInNewWindow'
  | 'layoutGridlines'
  | 'stacked'
  | 'tabular'
  | 'removeLayout'
  | 'insertAbove'
  | 'insertBelow'
  | 'insertLeft'
  | 'insertRight'
  | 'selectLayout'
  | 'selectColumn'
  | 'selectRow'
  | 'merge'
  | 'splitVertically'
  | 'splitHorizontally'
  | 'moveUp'
  | 'moveDown'
  | 'controlMargins'
  | 'controlPadding'
  | 'anchoring'
  | 'sizeSpace'
  | 'align'
  | 'bringToFront'
  | 'sendToBack'
  | 'objectList'
  | 'selectAll'
  | 'font'
  | 'fontSize'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'fontColor'
  | 'backColor'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'backgroundImage'
  | 'conditionalFormatting'
  | 'shapeFill'
  | 'shapeOutline'
  | 'pageSize'
  | 'margins'
  | 'showMargins'
  | 'printDataOnly'
  | 'portrait'
  | 'landscape'
  | 'columns'
  | 'pageSetupDialog'
  | 'print'
  | 'previewZoom'
  | 'onePage'
  | 'twoPages'
  | 'morePages'
  | 'closePreview'
  | 'macroRun'
  | 'singleStep'
  | 'expandActions'
  | 'collapseActions'
  | 'expandAll'
  | 'collapseAll'
  | 'actionCatalog'
  | 'showAllActions'
  | 'viewForm'
  | 'viewPrintPreview'
  | 'saveAs'
  | 'builderSaveAs'
  | 'builderClose'

export type CommandHandlers = Partial<Record<CommandId, () => void | Promise<void>>>;

/** Scope of the shell's own handlers, used when the active document does not provide the command. */
export const SHELL_SCOPE = '';
/** Scope of a modal tab's own handlers (the Query Builder), and prefix of its views' scopes: in front of it, they stand in for
 *  the shell's, which would act on the document behind. */
export const MODAL_SCOPE = 'modal:';
const registry = new Map<string, CommandHandlers>();
const listeners = new Set<() => void>();
let activeTab: string | null = null;
let context: RibbonContext = { hasBase: false, readOnly: false, mode: null, isNew: false, kind: null };
let version = 0;
let reportError: (e: unknown) => void = (e) => console.error(e);

const changed = () => { version++; listeners.forEach((l) => l()); };
const handler = (id: CommandId) => (activeTab !== null ? registry.get(activeTab)?.[id] : undefined)
  ?? registry.get(activeTab?.startsWith(MODAL_SCOPE) ? MODAL_SCOPE : SHELL_SCOPE)?.[id];

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
 *  in the current context (read-only base, placeholder…), does nothing: keyboard shortcuts obey the same gating as the ribbon.
 *  Returns whether the command ran (a shortcut keeps its default action otherwise). */
export function runCommand(id: CommandId): boolean {
  const h = handler(id);
  if (!h || !commandEnabled(id, context)) return false;
  try {
    void Promise.resolve(h()).catch(reportError);
  } catch (e) {
    reportError(e);
  }
  return true;
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
const entryIn = (tabs: RibbonTab[], id: CommandId) => tabs.flatMap((t) => t.groups.flatMap((g) => g.commands)).find((c) => c.id === id);
/** Has a handler and its ribbon entry is enabled in `ctx`. The entry is the one shown in `ctx`: the same id may be a placeholder
 *  in another context (Insert Rows is done in Table Design, planned for A3 in Query Design). */
export function commandEnabled(id: CommandId, ctx: RibbonContext): boolean {
  const entry = entryIn(visibleTabs(ctx), id) ?? entryIn(RIBBON, id);
  return isCommandAvailable(id) && (!entry || entry.enabled(ctx)) && commandState(id)?.enabled !== false;
}
export function setCommandErrorHandler(fn: (e: unknown) => void): void { reportError = fn; }
export function subscribeCommands(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export const commandsVersion = (): number => version;
/** A document's own state of a command, past its entry's rule (A3 Task 9: a query's SQL view shows SQL View pressed and
 *  Design View not, and turns Design View off when only SQL can show the query). Its unregistration ignores a newer one. */
export interface CommandState { enabled?: boolean; active?: boolean }
const states = new Map<string, Partial<Record<CommandId, CommandState>>>();
export function registerCommandStates(tabId: string, s: Partial<Record<CommandId, CommandState>>): () => void {
  const own = { ...s };
  states.set(tabId, own);
  changed();
  return () => { if (states.get(tabId) === own) { states.delete(tabId); changed(); } };
}
export const commandState = (id: CommandId): CommandState | undefined => (activeTab !== null ? states.get(activeTab)?.[id] : undefined);

// ---------- Ruban ----------
/** isNew: the active document is not saved yet. kind: the active document's kind (null: none).
 *  builder: the Query Builder's modal tab is in front (its query is the active document). embedded: an embedded macro (R16). */
export interface RibbonContext { hasBase: boolean; readOnly: boolean; mode: DocMode | null; isNew: boolean; kind: DocKind | ObjectKind | null; builder?: boolean;
  embedded?: boolean }

/**
 * Ruling C11: every Access command has its entry from now on. One not delivered yet carries `planned`, the batch or stage that
 * delivers it: it shows disabled, with a tooltip naming that batch. To deliver it, a batch edits the existing entry (every
 * entry of that id shown in its context): it removes `planned`, replaces `enabled: off` with the real enable rule, and
 * registers the handler with `registerCommands` (from its document, or SHELL_SCOPE). It never adds a second entry or a second
 * CommandId member. An entry built by a gallery shared by two tabs (`controls`, `headerFooter`: A4's form tab, A5's report tab)
 * is delivered at its own tab's call site, through the helper's `done` map, e.g. `controls('A4', false, { textBox: {...} })`,
 * never by editing the helper, which builds the other batch's tab too.
 *
 * Not created ("never" in the contextual-tabs spec): Dataverse, SharePoint lists, Convert Macros to Visual Basic, Memo
 * Settings, Quick Styles / Change Shape / Shape Effects, Application Parts, Class Module, Add-ins, export by e-mail, Word
 * merge, Data Definition query, a report's Tab Order. Access's two web browser controls (legacy and Edge) are one control
 * here, and the Python editor stands where Access has Visual Basic. Split buttons and galleries are one button each.
 */
export type PlannedIn =
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6'
  | 'B1'
  | 'B2'
  | 'B3'
  | 'B4'
  | 'B5'
  | 'C'
  | 'D'
  | 'E'
  | 'later';

/** lg: icon above its label; sm: icon and label, stacked by three; xs: icon only, in a grid of three rows (label as tooltip). */
export interface RibbonCommand {
  id: CommandId; icon: LucideIcon; labelKey: string; size: 'lg' | 'sm' | 'xs';
  enabled(ctx: RibbonContext): boolean; active?(ctx: RibbonContext): boolean;
  visible?(ctx: RibbonContext): boolean;   // shown only in these contexts (a view the active object has, as Access's View menu)
  planned?: PlannedIn;
  popup?: true | 'dialog';   // opens a menu, or a dialog (a field, colour choices) (aria-haspopup; aria-expanded while it is open, see setOpenPopup)
}
export interface RibbonGroup { id: string; labelKey: string; commands: RibbonCommand[]; visible?(ctx: RibbonContext): boolean }
export type RibbonTabId =
  | 'home'
  | 'create'
  | 'externalData'
  | 'design'
  | 'databaseTools'
  | 'help'
  | 'tableFields'
  | 'table'
  | 'relationshipDesign'
  | 'queryDesign'
  | 'formDesign'
  | 'reportDesign'
  | 'arrange'
  | 'format'
  | 'pageSetup'
  | 'printPreview'
  | 'macroDesign'

/** passive: shown in its context without being selected (Table Fields and Table: a datasheet keeps Home, as in Access). */
export interface RibbonTab {
  id: RibbonTabId; labelKey: string; contextual?: boolean; passive?: boolean; visible?(ctx: RibbonContext): boolean; groups: RibbonGroup[];
}

/** In front of the Query Builder, only Home and the builder's contextual tabs (Access: the document behind waits). */
export const visibleTabs = (ctx: RibbonContext): RibbonTab[] =>
  RIBBON.filter((t) => (!t.visible || t.visible(ctx)) && (!ctx.builder || t.id === 'home' || !!t.contextual));

/** C10, on a change of context (object kind or mode): entering it selects its first contextual tab; leaving it restores the tab
 *  selected before (`before`), else Home. `before` keeps the tab chosen outside the contextual tabs that took over. */
export function tabAfterContextChange(visible: RibbonTab[], s: { selected: RibbonTabId; before: RibbonTabId }): { selected: RibbonTabId; before: RibbonTabId } {
  const takes = (t: RibbonTab | undefined) => !!t?.contextual && !t.passive;
  const enter = visible.find(takes);
  if (enter) return { selected: enter.id, before: takes(RIBBON.find((t) => t.id === s.selected)) ? s.before : s.selected };
  if (visible.some((t) => t.id === s.selected)) return s;
  return { selected: visible.some((t) => t.id === s.before) ? s.before : 'home', before: s.before };
}

const doc = (c: RibbonContext) => c.mode !== null;
const writable = (c: RibbonContext) => c.mode !== null && !c.readOnly;
const hasBaseWritable = (c: RibbonContext) => c.hasBase && !c.readOnly;
const sheet = (c: RibbonContext) => c.mode === 'datasheet';
/** Records are shown: a datasheet, or a query (datasheet) or form in Run view. A report preview has no records to edit. */
const records = (c: RibbonContext) => sheet(c) || (c.mode === 'run' && (c.kind === 'query' || c.kind === 'form'));
const recordsWritable = (c: RibbonContext) => records(c) && !c.readOnly;
/** The Relations window has no Design or Run view. */
const switchable = (c: RibbonContext) => doc(c) && c.kind !== 'relations';
const designWritable = (c: RibbonContext) => c.mode === 'design' && !c.readOnly;
const relationsWindow = (c: RibbonContext) => c.kind === 'relations';
const off = () => false;

/** A placeholder (C11): disabled, its tooltip names the batch or stage that delivers it. */
const plan = (planned: PlannedIn, id: CommandId, icon: LucideIcon, size: RibbonCommand['size'] = 'sm'): RibbonCommand =>
  ({ id, icon, labelKey: `ribbon.cmd.${id}`, size, enabled: off, planned });
/** Table Fields (A6): writable on a table's datasheet; those that need a field are enabled by the datasheet (command state). */
const fieldCmd = (id: CommandId, icon: LucideIcon, size: RibbonCommand['size'] = 'sm'): RibbonCommand =>
  ({ id, icon, labelKey: `ribbon.cmd.${id}`, size, enabled: (c) => c.kind === 'table' && sheet(c) && !c.readOnly });
const group = (id: string, ...commands: RibbonCommand[]): RibbonGroup => ({ id, labelKey: `ribbon.group.${id}`, commands });
const resized = (c: RibbonCommand, size: RibbonCommand['size']): RibbonCommand => ({ ...c, size });

const viewDatasheet: RibbonCommand = {
  id: 'viewDatasheet', icon: Sheet, labelKey: 'ribbon.cmd.viewDatasheet', size: 'lg', enabled: (c) => switchable(c) && !c.isNew && c.kind !== 'macro',
  visible: (c) => c.kind !== 'report' && c.kind !== 'macro', // a report or a macro has no datasheet (Access)
  // an object's Run view; a form's Datasheet view is its datasheet mode (M10); a report's Run view is its Print Preview
  active: (c) => sheet(c) || (c.mode === 'run' && c.kind !== 'form' && c.kind !== 'report'),
};
// A4 (spec contextual tabs 4.1): View = Form, Datasheet, Design, as in Access.
const viewForm: RibbonCommand = {
  id: 'viewForm', icon: AppWindow, labelKey: 'ribbon.cmd.viewForm', size: 'lg', enabled: (c) => c.kind === 'form' && switchable(c) && !c.isNew,
  visible: (c) => c.kind === 'form',
  active: (c) => c.kind === 'form' && c.mode === 'run',
};
// A5 Task 12 (spec contextual tabs 4.4): a report's View is Print Preview and Design (it has no datasheet).
const viewPrintPreview: RibbonCommand = {
  id: 'viewPrintPreview', icon: Eye, labelKey: 'ribbon.cmd.viewPrintPreview', size: 'lg', enabled: (c) => c.kind === 'report' && switchable(c) && !c.isNew,
  visible: (c) => c.kind === 'report',
  active: (c) => c.kind === 'report' && c.mode === 'run',
};
const viewDesign: RibbonCommand = { id: 'viewDesign', icon: PencilRuler, labelKey: 'ribbon.cmd.viewDesign', size: 'lg', enabled: switchable, active: (c) => c.mode === 'design' };
// Shift+F9 (Access's Requery): the active document reads its data again; enabled only when it registered a handler.
const refresh: RibbonCommand = { id: 'refresh', icon: RefreshCw, labelKey: 'ribbon.cmd.refresh', size: 'sm', enabled: (c) => c.mode === 'datasheet' || c.mode === 'run' };

// Entries shown in several tabs (same id in one context = same entry).
const formatPainter = plan('later', 'formatPainter', Paintbrush);
const alternateRowColor = plan('later', 'alternateRowColor', Rows3, 'xs');
const pythonEditor = plan('D', 'pythonEditor', Code);
// Access offers it in Database Tools, Table Design and Table (relationshipsGroup).
const relationships: RibbonCommand = { id: 'relationships', icon: Network, labelKey: 'ribbon.cmd.relationships', size: 'lg', enabled: (c) => c.hasBase };
const objectDependencies = plan('later', 'objectDependencies', GitFork, 'lg');
const modifyLookups = plan('later', 'modifyLookups', ListChecks);
const exportExcel: RibbonCommand = { id: 'exportExcel', icon: FileSpreadsheet, labelKey: 'ribbon.cmd.exportExcel', size: 'lg', enabled: (c) => c.hasBase };
// A6 Task 1: the active datasheet, a report's Print Preview or the Navigation Pane's selection register the handler.
const exportText: RibbonCommand = { id: 'exportText', icon: FileText, labelKey: 'ribbon.cmd.exportText', size: 'lg', enabled: (c) => c.hasBase };
// A5 Task 9: the report preview registers it; nothing is written into the base, so a read-only base keeps it.
const exportPdf: RibbonCommand = { id: 'exportPdf', icon: FileType, labelKey: 'ribbon.cmd.exportPdf', size: 'lg', enabled: doc };
const exportMore = plan('later', 'exportMore', Ellipsis);
const relationshipsGroup = group('relationships', relationships, objectDependencies);
const themesGroup = group('themes', plan('later', 'themes', Palette, 'lg'), plan('later', 'themeColors', SwatchBook), plan('later', 'themeFonts', Type));
// A5 Task 12: Design view and Print Preview save the page setup into the definition (a read-only base cannot).
const pageSize: RibbonCommand = { id: 'pageSize', icon: File, labelKey: 'ribbon.cmd.pageSize', size: 'lg', popup: true, enabled: writable };
const margins: RibbonCommand = { id: 'margins', icon: Scan, labelKey: 'ribbon.cmd.margins', size: 'lg', popup: true, enabled: writable };
const printDataOnly = plan('later', 'printDataOnly', Sheet);
// A5 Task 8: Print Preview (the report's Run view) delivers these; Design view registers its own handlers (Task 12).
const pageSetupDialog: RibbonCommand = { id: 'pageSetupDialog', icon: Settings2, labelKey: 'ribbon.cmd.pageSetupDialog', size: 'lg', enabled: writable };
const previewCmd = (id: CommandId, icon: LucideIcon): RibbonCommand => ({ id, icon, labelKey: `ribbon.cmd.${id}`, size: 'lg', enabled: doc });
// pressed: the page's orientation (the view's registerCommandStates)
const pageLayoutGroup = group('pageLayout', { id: 'portrait', icon: RectangleVertical, labelKey: 'ribbon.cmd.portrait', size: 'lg', enabled: writable, active: off },
  { id: 'landscape', icon: RectangleHorizontal, labelKey: 'ribbon.cmd.landscape', size: 'lg', enabled: writable, active: off },
  plan('later', 'columns', Columns2, 'lg'), pageSetupDialog);

/** Entries a batch delivers in its own tab, in place of a shared gallery's placeholders (C11). */
type Delivered = Partial<Record<CommandId, RibbonCommand>>;
/** The controls gallery: delivered with the form designer (A4) and the report designer (A5); a report has no Navigation Control. */
const controls = (owner: PlannedIn, report: boolean, done: Delivered = {}) => group('controls', ...[
  plan(owner, 'select', MousePointer2, 'xs'), plan(owner, 'textBox', TextCursorInput, 'xs'), plan(owner, 'label', LetterText, 'xs'),
  plan(owner, 'button', RectangleHorizontal, 'xs'), plan(owner, 'tabControl', PanelTop, 'xs'), plan('later', 'hyperlink', Link, 'xs'),
  ...(report ? [] : [plan('later', 'navigationControl', Navigation, 'xs')]),
  plan(owner, 'optionGroup', Group, 'xs'), plan(owner, 'insertPageBreak', SeparatorHorizontal, 'xs'), plan(owner, 'comboBox', ChevronsUpDown, 'xs'),
  plan(owner, 'line', Minus, 'xs'), plan('later', 'toggleButton', ToggleLeft, 'xs'), plan(owner, 'listBox', List, 'xs'),
  plan(owner, 'rectangle', Square, 'xs'), plan(owner, 'checkBox', SquareCheck, 'xs'), plan('later', 'unboundObjectFrame', Frame, 'xs'),
  plan('later', 'attachment', Paperclip, 'xs'), plan(owner, 'optionButton', CircleDot, 'xs'), plan(owner, 'subform', AppWindow, 'xs'),
  plan('later', 'boundObjectFrame', Box, 'xs'), plan(owner, 'image', Image, 'xs'), plan('later', 'webBrowser', Globe, 'xs'),
  plan('later', 'chart', ChartColumn, 'xs'), plan('later', 'insertImage', ImagePlus), plan('later', 'insertModernChart', ChartBar),
].map((c) => done[c.id] ?? c));
const headerFooter = (owner: PlannedIn, done: Delivered = {}) =>
  [plan(owner, 'logo', Image), plan(owner, 'title', Heading1), plan(owner, 'dateTime', CalendarClock)].map((c) => done[c.id] ?? c);
const designOf = (kind: RibbonContext['kind']) => (c: RibbonContext) => c.mode === 'design' && c.kind === kind;
/** A Query Design command that edits the grid (A3 Task 8). */
const grid = (id: CommandId, icon: LucideIcon, size: RibbonCommand['size']): RibbonCommand =>
  ({ id, icon, labelKey: `ribbon.cmd.${id}`, size, enabled: (c) => designWritable(c) && c.kind === 'query' });
const macroCmd = (id: CommandId, icon: LucideIcon, size: RibbonCommand['size'] = 'sm'): RibbonCommand =>
  ({ id, icon, labelKey: `ribbon.cmd.${id}`, size, enabled: designOf('macro') });
const namedMacro = (c: RibbonContext) => designOf('macro')(c) && !c.embedded;
const formOrReportDesign = (c: RibbonContext) => c.mode === 'design' && (c.kind === 'form' || c.kind === 'report');
const designerWritable = (c: RibbonContext) => formOrReportDesign(c) && !c.readOnly;
const reportDesignWritable = (c: RibbonContext) => designOf('report')(c) && !c.readOnly;
/** A5 Task 12: the report's controls gallery — the tools of the band designer; the controls the engine does not draw stay for later. */
const reportControl = (id: CommandId, icon: LucideIcon): RibbonCommand => ({ id, icon, labelKey: `ribbon.cmd.${id}`, size: 'xs', enabled: reportDesignWritable });
const REPORT_CONTROLS: Delivered = {
  select: reportControl('select', MousePointer2), textBox: reportControl('textBox', TextCursorInput), label: reportControl('label', LetterText),
  insertPageBreak: reportControl('insertPageBreak', SeparatorHorizontal), comboBox: reportControl('comboBox', ChevronsUpDown), line: reportControl('line', Minus),
  rectangle: reportControl('rectangle', Square), checkBox: reportControl('checkBox', SquareCheck), optionButton: reportControl('optionButton', CircleDot),
  image: reportControl('image', Image),
  button: plan('later', 'button', RectangleHorizontal, 'xs'), tabControl: plan('later', 'tabControl', PanelTop, 'xs'), optionGroup: plan('later', 'optionGroup', Group, 'xs'),
  listBox: plan('later', 'listBox', List, 'xs'), subform: plan('later', 'subform', AppWindow, 'xs'),
};
/** Arrange › Sizing & Ordering (A4): the designer's handlers come from `designerCommands`. `sizeSpace` is always registered (Snap to Grid
 *  works without a selection); `align`, `bringToFront` and `sendToBack` only with a selection. */
const arrangeCmd = (id: CommandId, icon: LucideIcon, popup?: true): RibbonCommand =>
  ({ id, icon, labelKey: `ribbon.cmd.${id}`, size: 'lg', enabled: designerWritable, ...(popup ? { popup } : {}) });
/** Format (A4, Task 5b): the view's handlers write the selected controls' properties (`formatCommands`); the menus are FormatPopup;
 *  forms (A4) and reports (A5, docKind 'report': the report's defaults) register them. */
const formatCmd = (id: CommandId, icon: LucideIcon, size: RibbonCommand['size'] = 'sm', popup?: RibbonCommand['popup'], enabled = designerWritable): RibbonCommand =>
  ({ id, icon, labelKey: `ribbon.cmd.${id}`, size, enabled, ...(popup ? { popup } : {}) });
const formDesignWritable = (c: RibbonContext) => designOf('form')(c) && !c.readOnly;
/** A gallery's own placeholders, delivered in place (same id, icon and size): `planned` removed, the real enable rule. */
const delivered = (placeholders: RibbonCommand[], ids: CommandId[], enabled: RibbonCommand['enabled']): Delivered =>
  Object.fromEntries(placeholders.filter((c) => ids.includes(c.id)).map(({ planned: _planned, ...c }) => [c.id, { ...c, enabled }]));
// the 15 stage-A controls (form-ribbon.ts GALLERY_TOOLS): the next click in a section places it, as with the Toolbox
const FORM_CONTROLS: CommandId[] = ['select', 'textBox', 'label', 'button', 'tabControl', 'optionGroup', 'insertPageBreak', 'comboBox', 'line',
  'listBox', 'rectangle', 'checkBox', 'optionButton', 'subform', 'image'];

export const RIBBON: RibbonTab[] = [
  {
    id: 'home', labelKey: 'ribbon.tab.home', groups: [
      group('view', viewForm, viewPrintPreview, viewDatasheet, viewDesign),
      group('clipboard', { id: 'paste', icon: ClipboardPaste, labelKey: 'ribbon.cmd.paste', size: 'lg', enabled: hasBaseWritable },
        { id: 'cut', icon: Scissors, labelKey: 'ribbon.cmd.cut', size: 'sm', enabled: hasBaseWritable },
        { id: 'copy', icon: Copy, labelKey: 'ribbon.cmd.copy', size: 'sm', enabled: (c) => c.hasBase }, formatPainter,
        plan('later', 'showClipboard', ClipboardList)),
      group('sort',
        // filter = criterion for the column (Access's Filter); filterSelection and filterAdvanced open their menu.
        { id: 'filter', icon: Funnel, labelKey: 'ribbon.cmd.filter', size: 'lg', enabled: records },
        { id: 'sortAsc', icon: ArrowUpAZ, labelKey: 'ribbon.cmd.sortAsc', size: 'sm', enabled: records },
        { id: 'sortDesc', icon: ArrowDownZA, labelKey: 'ribbon.cmd.sortDesc', size: 'sm', enabled: records },
        { id: 'sortClear', icon: Eraser, labelKey: 'ribbon.cmd.sortClear', size: 'sm', enabled: records },
        { id: 'filterSelection', icon: ListFilter, labelKey: 'ribbon.cmd.filterSelection', size: 'sm', enabled: records },
        { id: 'filterAdvanced', icon: SlidersHorizontal, labelKey: 'ribbon.cmd.filterAdvanced', size: 'sm', enabled: records },
        { id: 'filterToggle', icon: FunnelX, labelKey: 'ribbon.cmd.filterToggle', size: 'sm', enabled: records }),
      group('records',
        refresh,
        { id: 'newRecord', icon: Plus, labelKey: 'ribbon.cmd.newRecord', size: 'sm', enabled: recordsWritable },
        { id: 'save', icon: Save, labelKey: 'ribbon.cmd.save', size: 'sm', enabled: writable },
        { id: 'deleteRecord', icon: Trash2, labelKey: 'ribbon.cmd.deleteRecord', size: 'sm', enabled: recordsWritable },
        plan('later', 'recordsTotals', Sigma), plan('later', 'spelling', SpellCheck), plan('later', 'moreRecords', Ellipsis)),
      // A6 Task 8: the table and query datasheets register Find, Go To and Select (Replace: later)
      group('find', { id: 'find', icon: Search, labelKey: 'ribbon.cmd.find', size: 'lg', enabled: records }, plan('later', 'replace', Replace),
        { id: 'goTo', icon: ArrowRightToLine, labelKey: 'ribbon.cmd.goTo', size: 'sm', enabled: records, popup: true },
        { id: 'selectMenu', icon: MousePointer2, labelKey: 'ribbon.cmd.selectMenu', size: 'sm', enabled: records, popup: true }),
      group('textFormatting',
        plan('later', 'textFont', Type), plan('later', 'textFontSize', ALargeSmall),
        plan('later', 'bullets', List, 'xs'), plan('later', 'numbering', ListOrdered, 'xs'), plan('later', 'indentIncrease', IndentIncrease, 'xs'),
        plan('later', 'indentDecrease', IndentDecrease, 'xs'), plan('later', 'textDirection', PilcrowRight, 'xs'), plan('later', 'textBold', Bold, 'xs'),
        plan('later', 'textItalic', Italic, 'xs'), plan('later', 'textUnderline', Underline, 'xs'), plan('later', 'textFontColor', Baseline, 'xs'),
        plan('later', 'textHighlight', Highlighter, 'xs'), plan('later', 'textBackColor', PaintBucket, 'xs'), plan('later', 'textAlignLeft', AlignLeft, 'xs'),
        plan('later', 'textAlignCenter', AlignCenter, 'xs'), plan('later', 'textAlignRight', AlignRight, 'xs'), plan('later', 'datasheetGridlines', Grid3x3, 'xs'),
        alternateRowColor, plan('later', 'datasheetFormatting', Settings2, 'xs')),
      group('zoom', plan('later', 'zoom', ZoomIn, 'lg')),
    ],
  },
  {
    id: 'create', labelKey: 'ribbon.tab.create', groups: [
      group('tables',
        { id: 'createTable', icon: Table, labelKey: 'ribbon.cmd.createTable', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        { id: 'createTableDesign', icon: TableProperties, labelKey: 'ribbon.cmd.createTableDesign', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly }),
      group('queries', plan('later', 'queryWizard', WandSparkles, 'lg'),
        { id: 'createQueryDesign', icon: FileSearch, labelKey: 'ribbon.cmd.createQueryDesign', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        { id: 'createSqlQuery', icon: FileCode, labelKey: 'ribbon.cmd.createSqlQuery', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly }),
      group('forms', { id: 'createForm', icon: AppWindow, labelKey: 'ribbon.cmd.createForm', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        { id: 'createFormDesign', icon: LayoutTemplate, labelKey: 'ribbon.cmd.createFormDesign', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        // Access opens it in Layout view (later): BaseCraft opens a new unbound form in Design view, the Field List shown
        { id: 'createBlankForm', icon: Square, labelKey: 'ribbon.cmd.createBlankForm', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        plan('later', 'formWizard', WandSparkles), plan('later', 'navigationForm', Navigation), plan('later', 'moreForms', LayoutGrid)),
      group('reports', { id: 'createReport', icon: ScrollText, labelKey: 'ribbon.cmd.createReport', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        { id: 'createReportDesign', icon: Ruler, labelKey: 'ribbon.cmd.createReportDesign', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        { id: 'createBlankReport', icon: File, labelKey: 'ribbon.cmd.createBlankReport', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        plan('later', 'reportWizard', WandSparkles), plan('later', 'labels', Tags)),
      group('macrosCode', { id: 'createMacro', icon: Zap, labelKey: 'ribbon.cmd.createMacro', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        plan('D', 'createModule', FileCode2), pythonEditor),
    ],
  },
  {
    id: 'externalData', labelKey: 'ribbon.tab.externalData', groups: [
      group('import',
        { id: 'importExcel', icon: FileSpreadsheet, labelKey: 'ribbon.cmd.importExcel', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly }, plan('later', 'importXml', FileCode),
        { id: 'importText', icon: FileText, labelKey: 'ribbon.cmd.importText', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly },
        plan('E', 'importAccess', Database, 'lg'), plan('C', 'importSqlServer', Server), plan('C', 'importPostgreSql', Cylinder), plan('C', 'importOdbc', Cable),
        plan('later', 'savedImports', FolderInput), plan('C', 'linkedTableManager', Link)),
      group('export', plan('later', 'savedExports', FolderOutput), exportExcel, exportText, exportPdf, plan('later', 'exportAccess', Database),
        plan('later', 'exportXml', FileCode), exportMore),
    ],
  },
  {
    id: 'databaseTools', labelKey: 'ribbon.tab.databaseTools', groups: [
      group('tools', { id: 'compactRepair', icon: Wrench, labelKey: 'ribbon.cmd.compactRepair', size: 'lg', enabled: (c) => c.hasBase && !c.readOnly }),
      group('macro', resized(pythonEditor, 'lg'), { id: 'runMacro', icon: Play, labelKey: 'ribbon.cmd.runMacro', size: 'lg', enabled: (c) => c.hasBase }),
      relationshipsGroup,
      group('analyze', plan('later', 'databaseDocumenter', BookOpen), plan('later', 'analyzePerformance', Gauge), plan('later', 'analyzeTable', ScanSearch)),
      group('moveData', plan('C', 'splitDatabase', Split), plan('C', 'moveToServer', CloudUpload)),
    ],
  },
  {
    id: 'help', labelKey: 'ribbon.tab.help', groups: [
      group('help', plan('later', 'help', CircleHelp, 'lg'), plan('later', 'contactSupport', LifeBuoy), plan('later', 'feedback', MessageSquare),
        plan('later', 'showTraining', GraduationCap), plan('later', 'whatsNew', Sparkles)),
    ],
  },
  {
    // Table Design (Création de tableau): the id stays `design`, its test id `ribbon-tab-design`.
    id: 'design', labelKey: 'ribbon.tab.design', contextual: true, visible: designOf('table'), groups: [
      group('view', viewDatasheet),
      group('tools',
        { id: 'primaryKey', icon: KeyRound, labelKey: 'ribbon.cmd.primaryKey', size: 'lg', enabled: designWritable },
        { id: 'builder', icon: Wand, labelKey: 'ribbon.cmd.builder', size: 'lg', enabled: designWritable },
        { id: 'testValidationRules', icon: ShieldCheck, labelKey: 'ribbon.cmd.testValidationRules', size: 'sm', enabled: (c) => c.mode === 'design' },
        { id: 'insertRows', icon: BetweenHorizontalStart, labelKey: 'ribbon.cmd.insertRows', size: 'sm', enabled: designWritable },
        { id: 'deleteRows', icon: ListX, labelKey: 'ribbon.cmd.deleteRows', size: 'sm', enabled: designWritable },
        modifyLookups),
      group('showHide', { id: 'propertySheet', icon: PanelRight, labelKey: 'ribbon.cmd.propertySheet', size: 'lg', enabled: (c) => c.mode === 'design' },
        { id: 'indexes', icon: ListOrdered, labelKey: 'ribbon.cmd.indexes', size: 'lg', enabled: (c) => c.mode === 'design' }),
      group('tableEvents', plan('later', 'createDataMacros', FileCog), plan('later', 'renameDeleteMacro', FilePen)),
      relationshipsGroup,
    ],
  },
  {
    id: 'tableFields', labelKey: 'ribbon.tab.tableFields', contextual: true, passive: true, visible: (c) => c.kind === 'table' && sheet(c), groups: [
      group('view', viewDesign),
      group('addDelete', fieldCmd('addShortText', Type, 'lg'), fieldCmd('addNumber', Hash, 'lg'), fieldCmd('addCurrency', Euro, 'lg'),
        fieldCmd('addDateTime', CalendarClock), fieldCmd('addYesNo', SquareCheck), { ...fieldCmd('moreFields', CirclePlus), popup: true }, fieldCmd('deleteField', Trash2)),
      group('properties', fieldCmd('nameCaption', Tag), fieldCmd('defaultValue', TextCursorInput), fieldCmd('fieldSize', Ruler), modifyLookups,
        plan('later', 'modifyExpression', SquareFunction)),
      group('formatting', { ...fieldCmd('dataType', Shapes), popup: true }, { ...fieldCmd('format', Brush), popup: true },
        fieldCmd('currencyFormat', Euro, 'xs'), fieldCmd('percentFormat', Percent, 'xs'), fieldCmd('commaFormat', Hash, 'xs'),
        fieldCmd('increaseDecimals', DecimalsArrowRight, 'xs'), fieldCmd('decreaseDecimals', DecimalsArrowLeft, 'xs')),
      // pressed from the selected field (the datasheet's command state)
      group('fieldValidation', { ...fieldCmd('required', Asterisk), active: () => false }, { ...fieldCmd('unique', Fingerprint), active: () => false },
        { ...fieldCmd('indexed', ListOrdered), active: () => false }, { ...fieldCmd('validation', ShieldCheck), popup: true }),
    ],
  },
  {
    // Table Properties (foundation step 2): the Navigation Pane's Properties dialog, read-only on a read-only base.
    id: 'table', labelKey: 'ribbon.tab.table', contextual: true, passive: true, visible: (c) => c.kind === 'table' && sheet(c), groups: [
      group('properties', { id: 'tableProperties', icon: Settings, labelKey: 'ribbon.cmd.tableProperties', size: 'lg', enabled: (c) => c.kind === 'table' && sheet(c) }),
      group('beforeEvents', plan('later', 'beforeChange', PencilLine, 'lg'), plan('later', 'beforeDelete', Trash, 'lg')),
      group('afterEvents', plan('later', 'afterInsert', ListPlus, 'lg'), plan('later', 'afterUpdate', PenLine, 'lg'), plan('later', 'afterDelete', ListMinus, 'lg')),
      group('namedMacros', plan('later', 'namedMacro', Zap, 'lg')),
      relationshipsGroup,
    ],
  },
  {
    // The layout is the viewer's: it moves in read-only too, without being saved. Hide Table and Direct Relationships need a
    // selected table: the window registers them only then.
    id: 'relationshipDesign', labelKey: 'ribbon.tab.relationshipDesign', contextual: true, visible: relationsWindow, groups: [
      group('tools',
        { id: 'editRelationships', icon: PencilLine, labelKey: 'ribbon.cmd.editRelationships', size: 'lg', enabled: (c) => relationsWindow(c) && !c.readOnly },
        { id: 'clearLayout', icon: Eraser, labelKey: 'ribbon.cmd.clearLayout', size: 'lg', enabled: relationsWindow },
        plan('later', 'relationshipReport', ScrollText, 'lg')),
      group('relationships',
        { id: 'addTables', icon: SquarePlus, labelKey: 'ribbon.cmd.addTables', size: 'lg', enabled: relationsWindow },
        { id: 'hideTable', icon: EyeOff, labelKey: 'ribbon.cmd.hideTable', size: 'sm', enabled: relationsWindow },
        { id: 'directRelationships', icon: GitCommitHorizontal, labelKey: 'ribbon.cmd.directRelationships', size: 'sm', enabled: relationsWindow },
        { id: 'allRelationships', icon: Network, labelKey: 'ribbon.cmd.allRelationships', size: 'sm', enabled: relationsWindow },
        { id: 'closeRelationships', icon: X, labelKey: 'ribbon.cmd.closeRelationships', size: 'lg', enabled: relationsWindow }),
    ],
  },
  {
    id: 'queryDesign', labelKey: 'ribbon.tab.queryDesign', contextual: true, visible: designOf('query'), groups: [
      // A3 Task 8 (the grid); Run: a select query's datasheet, an action query's run (Task 10). Task 9: SQL View
      // (pressed in SQL view; from the datasheet too, by the status bar), Union (switches to SQL view), the criteria rows, Top Values, Parameters, the property sheet and
      // Table Names (the Table row, a view option: also on a read-only base); the grid commands are registered in the grid only.
      group('results', viewDatasheet, { id: 'viewSql', icon: Code, labelKey: 'ribbon.cmd.viewSql', size: 'lg', enabled: (c) => c.kind === 'query' && (c.mode === 'design' || c.mode === 'run'), active: off },
        { id: 'runQuery', icon: Play, labelKey: 'ribbon.cmd.runQuery', size: 'lg', enabled: designOf('query') }),
      group('queryType', grid('selectQuery', Table2, 'lg'), grid('makeTableQuery', Table, 'lg'), grid('appendQuery', ListPlus, 'lg'),
        grid('updateQuery', PenLine, 'lg'), plan('B4', 'crosstabQuery', Grid2x2, 'lg'), grid('deleteQuery', ListX, 'lg'),
        grid('unionQuery', Combine, 'sm'), plan('C', 'passThroughQuery', ArrowRightLeft)),
      group('querySetup', grid('addTables', SquarePlus, 'lg'), grid('insertRows', BetweenHorizontalStart, 'sm'), grid('deleteRows', ListX, 'sm'),
        grid('builder', Wand, 'sm'), grid('insertColumns', BetweenVerticalStart, 'sm'), grid('deleteColumns', Columns3, 'sm'),
        grid('returnValues', ArrowUpNarrowWide, 'sm')),
      group('showHide', grid('queryTotals', Sigma, 'lg'), grid('parameters', Braces, 'lg'), grid('propertySheet', PanelRight, 'sm'),
        { id: 'tableNames', icon: Heading, labelKey: 'ribbon.cmd.tableNames', size: 'sm', enabled: designOf('query'), active: off }),
      // the Query Builder (Record Source, Row Source): Save As a query, Close (which asks to update the property), as in Access
      { ...group('builderClose', { id: 'builderSaveAs', icon: Save, labelKey: 'ribbon.cmd.builderSaveAs', size: 'lg', enabled: (c) => !!c.builder && c.hasBase && !c.readOnly },
        { id: 'builderClose', icon: X, labelKey: 'ribbon.cmd.builderClose', size: 'lg', enabled: (c) => !!c.builder }), visible: (c) => !!c.builder },
    ],
  },
  {
    id: 'formDesign', labelKey: 'ribbon.tab.formDesign', contextual: true, visible: designOf('form'), groups: [
      group('view', viewForm, viewDatasheet),
      themesGroup,
      controls('A4', false, delivered(controls('A4', false).commands, FORM_CONTROLS, formDesignWritable)),
      group('headerFooter', ...headerFooter('A4', delivered(headerFooter('A4'), ['logo', 'title', 'dateTime'], formDesignWritable))),
      // in a read-only base they open read-only (the view's sheet, Field List and Tab Order dialog refuse the changes)
      group('tools', { id: 'addExistingFields', icon: ListPlus, labelKey: 'ribbon.cmd.addExistingFields', size: 'sm', enabled: designOf('form') },
        { id: 'propertySheet', icon: PanelRight, labelKey: 'ribbon.cmd.propertySheet', size: 'lg', enabled: designOf('form') },
        { id: 'tabOrder', icon: ArrowDown, labelKey: 'ribbon.cmd.tabOrder', size: 'sm', enabled: designOf('form') },
        plan('later', 'chartSettings', ChartPie), plan('later', 'subformInNewWindow', ExternalLink), plan('D', 'viewCode', Code)),
    ],
  },
  {
    id: 'reportDesign', labelKey: 'ribbon.tab.reportDesign', contextual: true, visible: designOf('report'), groups: [
      group('view', viewPrintPreview),
      themesGroup,
      // A5 Task 13: Group & Sort shows or hides the pane (read-only: shown disabled); Totals needs one bound text box of the Detail selected;
      // Group & Sort and Hide Details pressed: the pane shown, the Detail hidden (registerCommandStates)
      group('groupingTotals', { id: 'groupSort', icon: ListTree, labelKey: 'ribbon.cmd.groupSort', size: 'lg', enabled: designOf('report'), active: off },
        { id: 'reportTotals', icon: Sigma, labelKey: 'ribbon.cmd.reportTotals', size: 'sm', popup: true, enabled: reportDesignWritable },
        { id: 'hideDetails', icon: EyeOff, labelKey: 'ribbon.cmd.hideDetails', size: 'sm', enabled: reportDesignWritable, active: off }),
      controls('A5', true, REPORT_CONTROLS),
      group('headerFooter', { id: 'pageNumbers', icon: Hash, labelKey: 'ribbon.cmd.pageNumbers', size: 'lg', enabled: reportDesignWritable }, ...headerFooter('A5', {
        logo: { id: 'logo', icon: Image, labelKey: 'ribbon.cmd.logo', size: 'sm', enabled: reportDesignWritable },
        title: { id: 'title', icon: Heading1, labelKey: 'ribbon.cmd.title', size: 'sm', enabled: reportDesignWritable },
        dateTime: { id: 'dateTime', icon: CalendarClock, labelKey: 'ribbon.cmd.dateTime', size: 'sm', enabled: reportDesignWritable },
      })),
      // in a read-only base they open read-only (the designer refuses the changes)
      group('tools', { id: 'addExistingFields', icon: ListPlus, labelKey: 'ribbon.cmd.addExistingFields', size: 'sm', enabled: designOf('report') },
        { id: 'propertySheet', icon: PanelRight, labelKey: 'ribbon.cmd.propertySheet', size: 'lg', enabled: designOf('report') }, plan('later', 'chartSettings', ChartPie),
        plan('later', 'subreportInNewWindow', ExternalLink), plan('D', 'viewCode', Code)),
    ],
  },
  {
    // Arrange and Format: the generic designer of A4 (Task 3), reused by A5's reports.
    id: 'arrange', labelKey: 'ribbon.tab.arrange', contextual: true, visible: formOrReportDesign, groups: [
      group('layoutTable', plan('later', 'layoutGridlines', Grid3x3, 'lg'), plan('later', 'stacked', Rows3, 'lg'), plan('later', 'tabular', Columns3, 'lg'),
        plan('later', 'removeLayout', Ungroup, 'lg')),
      group('rowsColumns', plan('later', 'insertAbove', ArrowUpToLine, 'lg'), plan('later', 'insertBelow', ArrowDownToLine, 'lg'),
        plan('later', 'insertLeft', ArrowLeftToLine, 'lg'), plan('later', 'insertRight', ArrowRightToLine, 'lg'),
        plan('later', 'selectLayout', SquareDashedMousePointer), plan('later', 'selectColumn', Columns2), plan('later', 'selectRow', Rows2)),
      group('mergeSplit', plan('later', 'merge', Merge), plan('later', 'splitVertically', SquareSplitVertical), plan('later', 'splitHorizontally', SquareSplitHorizontal)),
      group('move', plan('later', 'moveUp', ArrowUp, 'lg'), plan('later', 'moveDown', ArrowDown, 'lg')),
      group('position', plan('later', 'controlMargins', Scan, 'lg'), plan('later', 'controlPadding', Expand, 'lg'), plan('later', 'anchoring', Anchor, 'lg')),
      group('sizingOrdering', arrangeCmd('sizeSpace', Scaling, true), arrangeCmd('align', AlignStartVertical, true), arrangeCmd('bringToFront', BringToFront),
        arrangeCmd('sendToBack', SendToBack)),
    ],
  },
  {
    id: 'format', labelKey: 'ribbon.tab.format', contextual: true, visible: formOrReportDesign, groups: [
      // selecting works read-only
      group('selection', formatCmd('objectList', ListTree, 'sm', true, formOrReportDesign), formatCmd('selectAll', SquareDashed, 'sm', undefined, formOrReportDesign)),
      group('font', formatCmd('font', Type, 'sm', 'dialog'), formatCmd('fontSize', ALargeSmall, 'sm', true), formatPainter,
        formatCmd('bold', Bold, 'xs'), formatCmd('italic', Italic, 'xs'), formatCmd('underline', Underline, 'xs'), formatCmd('fontColor', Baseline, 'xs', 'dialog'),
        formatCmd('backColor', PaintBucket, 'xs', 'dialog'), formatCmd('alignLeft', AlignLeft, 'xs'), formatCmd('alignCenter', AlignCenter, 'xs'),
        formatCmd('alignRight', AlignRight, 'xs')),
      group('number', formatCmd('format', Brush, 'sm', true), formatCmd('currencyFormat', Euro, 'xs'), formatCmd('percentFormat', Percent, 'xs'),
        formatCmd('commaFormat', Hash, 'xs'), formatCmd('increaseDecimals', DecimalsArrowRight, 'xs'), formatCmd('decreaseDecimals', DecimalsArrowLeft, 'xs')),
      group('background', plan('later', 'backgroundImage', Wallpaper, 'lg'), resized(alternateRowColor, 'lg')),
      group('controlFormatting', plan('later', 'conditionalFormatting', Blend), formatCmd('shapeFill', PaintBucket, 'sm', 'dialog'), formatCmd('shapeOutline', Square, 'sm', 'dialog')),
    ],
  },
  {
    id: 'pageSetup', labelKey: 'ribbon.tab.pageSetup', contextual: true, visible: designOf('report'), groups: [
      group('pageSize', pageSize, margins, plan('later', 'showMargins', SquareDashed), printDataOnly),
      pageLayoutGroup,
    ],
  },
  {
    id: 'printPreview', labelKey: 'ribbon.tab.printPreview', contextual: true, visible: (c) => c.kind === 'report' && c.mode === 'run', groups: [
      group('print', { id: 'print', icon: Printer, labelKey: 'ribbon.cmd.print', size: 'lg', enabled: doc }),
      group('pageSize', pageSize, margins, printDataOnly),
      pageLayoutGroup,
      group('zoom', previewCmd('previewZoom', ZoomIn), previewCmd('onePage', File), previewCmd('twoPages', Files),
        { id: 'morePages', icon: LayoutGrid, labelKey: 'ribbon.cmd.morePages', size: 'lg', popup: true, enabled: doc }),
      group('data', refresh, exportExcel, exportText, exportPdf, exportMore),
      group('closePreview', previewCmd('closePreview', X)),
    ],
  },
  {
    id: 'macroDesign', labelKey: 'ribbon.tab.macroDesign', contextual: true, visible: designOf('macro'), groups: [
      // none changes the file: enabled on a read-only base too. Pressed (the view's command states): Single Step on, the
      // catalogue shown, unsafe actions listed; Expand / Collapse Actions need a selected block (command state).
      // Run and Single Step: not for an embedded macro, an event needs its object (R16)
      group('tools', { ...macroCmd('macroRun', Play, 'lg'), enabled: namedMacro }, { ...macroCmd('singleStep', StepForward), enabled: namedMacro, active: off }),
      group('expandCollapse', macroCmd('expandActions', UnfoldVertical), macroCmd('collapseActions', FoldVertical), macroCmd('expandAll', ChevronsDown),
        macroCmd('collapseAll', ChevronsUp)),
      group('showHide', { ...macroCmd('actionCatalog', BookOpen, 'lg'), active: off }, { ...macroCmd('showAllActions', ListChecks), active: off }),
    ],
  },
];

/** The ribbon command whose menu is open (A4 designer's RibbonPopup): its button shows aria-expanded. */
let openPopup: CommandId | null = null;
export function setOpenPopup(id: CommandId | null): void { if (openPopup !== id) { openPopup = id; changed(); } }
export const openPopupOf = (): CommandId | null => openPopup;

// The shell's design commands (Create, Import, Relationships, SQL View), moved from App's registerCommands(SHELL_SCOPE) (B5):
// absent from BaseCraft Runtime. `env`: the App closures they read.
import { sameName } from '../../shared/field-types';
import { formulaLang } from '../../shared/i18n';
import { instantReport, uniqueReportName } from '../../shared/report/instant';
import { api } from '../bridge';
import { autoForm, firstFreeName, formLabels, formNames, uniqueFormName } from '../form/form-def';
import { requestNewForm } from '../form/FormDesignView';
import { i18n } from '../i18n';
import { importAccessTables } from '../links/AccessImportDialog';
import { linkTables } from '../links/LinkDialog';
import { analyzePerformanceDialog } from '../database-tools/PerformanceDialog';
import { databaseDocumenter } from '../database-tools/DocumenterDialog';
import { pickDependency } from '../database-tools/DependenciesDialog';
import { openLinkedTableManager } from '../links/LinkedTableManager';
import { moveToServer } from '../links/MigrateWizard';
import { dataMacroCommands } from '../data-macros/data-macros';
import { importServerTables, linkServerTables } from '../links/ServerLinkDialog';
import { splitDatabase } from '../links/SplitDialog';
import { openSqlView } from '../query/QueryDesignView';
import { requestFieldList as requestReportFieldList, requestNewReport } from '../report/design/ReportDesignView';
import { printMargins } from '../settings-store';
import type { CommandHandlers } from '../shell/ribbon-model';
import { emptyDesign, toSaveRequest, withDefaultPrimaryKey } from '../table-design/design-model';
import { saveTableInteractive } from '../table-design/save-table';
import type { DesignShellEnv } from './hooks';
import { choose } from '../wizards/ChoiceMenu';
import { formWizard } from '../wizards/FormWizard';
import { labelWizard } from '../wizards/LabelWizard';
import { itemsForm, modalDialogForm, navigationForm } from '../wizards/more-forms-model';
import { queryWizard, type WizardResult } from '../wizards/QueryWizard';
import { reportWizard } from '../wizards/ReportWizard';

export function shellDesignCommands(env: DesignShellEnv): CommandHandlers {
  const { modal, dispatch, rawDispatch, t, live, sourceToCreate, newForm, newQueryName, newReportName, newMacroName, newModuleName, setImporting, closeDocuments } = env;
  // Create › Query / Form / Report Wizard: the wizard saves the object; the pane lists it and it opens as chosen
  const wizard = (kind: 'query' | 'form' | 'report', run: (m: typeof modal) => Promise<WizardResult | null>) => async () => {
    const r = await run(modal);
    if (!r) return;
    dispatch({ type: 'listsChanged' });
    dispatch({ type: 'open', kind, name: r.name, mode: r.open });
  };
  return {
    ...dataMacroCommands(env),
    queryWizard: wizard('query', queryWizard), formWizard: wizard('form', formWizard), reportWizard: wizard('report', reportWizard),
    // Create › Labels: the Navigation Pane's table or query is the wizard's first source
    labels: wizard('report', (m) => { const sel = live.current.navSelection; return labelWizard(m, sel?.kind === 'table' || sel?.kind === 'query' ? { kind: sel.kind, name: sel.name } : undefined); }),
    createTableDesign: () => {
      const { state: s, tables: list, objects: objs } = live.current; // a query shares the tables' namespace
      const taken = (n: string) => list.some((x) => sameName(x.name, n)) || s.tabs.some((x) => sameName(x.name, n))
        || objs.some((x) => x.kind === 'query' && sameName(x.name, n));
      let n = 1;
      while (taken(t('designer.newTableName', { n }))) n++;
      rawDispatch({ type: 'open', kind: 'table', name: t('designer.newTableName', { n }), mode: 'design', isNew: true });
    },
    // Table Fields tab › Create › Table: Table1 (free among tables, queries and open tabs) with the AutoNumber key, saved at once
    createTable: async () => {
      const { state: s, tables: list, objects: objs } = live.current;
      const taken = (n: string) => list.some((x) => sameName(x.name, n)) || s.tabs.some((x) => sameName(x.name, n))
        || objs.some((x) => x.kind === 'query' && sameName(x.name, n));
      let n = 1;
      while (taken(`${t('tableFields.newTable')}${n}`)) n++;
      const name = `${t('tableFields.newTable')}${n}`;
      const m = withDefaultPrimaryKey(emptyDesign(), t('designer.defaultIdName'));
      if (!(await saveTableInteractive(modal, s.tabs, dispatch, toSaveRequest(m, name, false)))) return;
      dispatch({ type: 'tableSaved', name });
      dispatch({ type: 'open', kind: 'table', name, mode: 'datasheet' });
    },
    // Database Tools › Object Dependencies: for the Navigation Pane's selection; the object picked opens in Design view
    objectDependencies: async () => {
      const o = await pickDependency(modal, live.current.navSelection);
      if (o) await dispatch({ type: 'open', kind: o.kind, name: o.name, mode: 'design' });
    },
    // Database Tools › Database Documenter: the Navigation Pane's selection is ticked first
    databaseDocumenter: () => {
      const sel = live.current.navSelection;
      return databaseDocumenter(modal, sel && ['table', 'query', 'form', 'report', 'macro'].includes(sel.kind) ? sel as Parameters<typeof databaseDocumenter>[1] : null);
    },
    // Database Tools › Analyze Performance: index suggestions with Optimize
    analyzePerformance: () => analyzePerformanceDialog(modal, () => live.current.state.tabs, dispatch),
    importText: () => setImporting({}),
    importExcel: () => setImporting({ source: 'excel' }),
    importXml: () => setImporting({ source: 'xml' }),
    // C1: External Data › BaseCraft or SQLite Database; the pane lists the new links
    linkBaseCraft: async () => { if (await linkTables(modal)) dispatch({ type: 'listsChanged' }); },
    // C2: External Data › Link Access Database (the same dialog, the Access filter first)
    linkAccess: async () => { if (await linkTables(modal, 'access')) dispatch({ type: 'listsChanged' }); },
    // C4: External Data › PostgreSQL (R18)
    linkPostgreSql: async () => { if (await linkServerTables(modal, 'postgresql')) dispatch({ type: 'listsChanged' }); },
    // C5: External Data › SQL Server (R17)
    linkSqlServer: async () => { if (await linkServerTables(modal, 'sqlserver')) dispatch({ type: 'listsChanged' }); },
    // C7: External Data › Import › PostgreSQL / SQL Server (R17): the tables copied into local tables
    importPostgreSql: async () => { if (await importServerTables(modal, 'postgresql')) dispatch({ type: 'listsChanged' }); },
    // E1: External Data › Import › Access: the tables and data of an Access file, then the import report
    importAccess: async () => { if (await importAccessTables(modal)) dispatch({ type: 'listsChanged' }); },
    importSqlServer: async () => { if (await importServerTables(modal, 'sqlserver')) dispatch({ type: 'listsChanged' }); },
    linkedTableManager: () => openLinkedTableManager(modal, dispatch),
    // C3: Database Tools › Move Data › Split Database; the pane then lists the links
    splitDatabase: () => splitDatabase(modal, closeDocuments, dispatch),
    // C7: Database Tools › Move Data › To a Server; the pane then lists the links
    moveToServer: () => moveToServer(modal, closeDocuments, dispatch),
    relationships: () => rawDispatch({ type: 'open', kind: 'relations', name: 'Relations', mode: 'run' }),
    createFormDesign: () => newForm(false),
    // Access opens it in Layout view (later): a new unbound form in Design view, the Field List shown
    createBlankForm: () => newForm(true),
    // Create › Form (AutoForm): a columnar form of the selected (else chosen) source, opened in Form view unsaved (Access): saved when
    // its tab closes (Yes) or on Save, under its source's name (made unique) proposed
    createForm: async () => {
      const src = await sourceToCreate('form.autoFormSource');
      if (!src) return;
      const info = await api.sources.describe(src.ref);   // a rejection (a query that cannot be read) is shown; no form
      const { state: s, objects: objs } = live.current;
      const name = uniqueFormName(formNames(objs, s.tabs), src.name);
      requestNewForm(name, autoForm(src.ref, src.name, info, formLabels(t)));
      rawDispatch({ type: 'open', kind: 'form', name, mode: 'run', isNew: true });
    },
    // Create › More Forms: Multiple Items and Datasheet are Create › Form over the same source (Tabular layout; Datasheet default view),
    // Modal Dialog an unbound form with OK and Cancel (Design view); all unsaved until their tab closes (Yes) or Save. Split Form: later.
    moreForms: async () => {
      const kind = await choose(modal, 'ribbon.cmd.moreForms', [
        { id: 'multiple' as const, labelKey: 'wizard.moreForms.multiple' }, { id: 'datasheet' as const, labelKey: 'wizard.moreForms.datasheet' },
        { id: 'split' as const, labelKey: 'wizard.moreForms.split', noteKey: 'wizard.moreForms.splitNote', disabled: true },
        { id: 'modal' as const, labelKey: 'wizard.moreForms.modal', noteKey: 'wizard.moreForms.modalNote' }]);
      if (!kind || kind === 'split') return;
      const { state: s, objects: objs } = live.current;
      const taken = formNames(objs, s.tabs);
      if (kind === 'modal') {
        const name = firstFreeName(taken, (n) => t('form.newName', { n }));
        requestNewForm(name, modalDialogForm(formLabels(t), { ok: t('dialog.button.ok'), cancel: t('dialog.button.cancel') }));
        return rawDispatch({ type: 'open', kind: 'form', name, mode: 'design', isNew: true });
      }
      const src = await sourceToCreate('form.autoFormSource');
      if (!src) return;
      const info = await api.sources.describe(src.ref);
      const name = uniqueFormName(taken, src.name);
      requestNewForm(name, itemsForm(src.ref, src.name, info, formLabels(t), kind));
      rawDispatch({ type: 'open', kind: 'form', name, mode: kind === 'datasheet' ? 'datasheet' : 'run', isNew: true });
    },
    // Create › Navigation: Horizontal Tabs = a navigation control filling a new form, a tab per form of the base (8 at most), in Design view
    navigationForm: async () => {
      const vertical = { disabled: true, noteKey: 'wizard.navigation.verticalNote' };
      const layout = await choose(modal, 'ribbon.cmd.navigationForm', [
        { id: 'horizontal' as const, labelKey: 'wizard.navigation.horizontal' },
        { id: 'verticalLeft' as const, labelKey: 'wizard.navigation.verticalLeft', ...vertical },
        { id: 'verticalRight' as const, labelKey: 'wizard.navigation.verticalRight', ...vertical },
        { id: 'horizontalVertical' as const, labelKey: 'wizard.navigation.horizontalVertical', ...vertical }]);
      if (layout !== 'horizontal') return;
      const { state: s, objects: objs } = live.current;
      const name = uniqueFormName(formNames(objs, s.tabs), t('wizard.navigation.name'));
      requestNewForm(name, navigationForm(objs.filter((x) => x.kind === 'form').map((x) => x.name), formLabels(t)));
      rawDispatch({ type: 'open', kind: 'form', name, mode: 'design', isNew: true });
    },
    // A3: a new query in Design view, named like a new table (Requête1…), free among tables, queries and open tabs
    createQueryDesign: () => rawDispatch({ type: 'open', kind: 'query', name: newQueryName(), mode: 'design', isNew: true }),
    // A3 Task 9: a new query in SQL view; SQL View from a query's datasheet (its Design view has its own handler)
    createSqlQuery: () => openSqlView(rawDispatch, newQueryName(), true),
    viewSql: () => {
      const tab = live.current.state.tabs.find((x) => x.id === live.current.state.activeId);
      if (tab?.kind === 'query') openSqlView(dispatch, tab.name, false, tab.id);
    },
    // AutoReport (A5): a tabular report on the selected (else chosen) source, opened in Print Preview unsaved (Access): saved when
    // its tab closes (Yes) or on Save, under a free name (its source's) proposed
    createReport: async () => {
      const src = await sourceToCreate('report.pickSourceTitle');
      if (!src) return;
      const doc = instantReport({ ...src.ref, name: src.name }, await api.sources.describe(src.ref), { lang: formulaLang(i18n.language), margins: printMargins() });
      const { state: s, objects: objs } = live.current;
      const name = uniqueReportName([...objs, ...s.tabs].filter((x) => x.kind === 'report').map((x) => x.name), src.name);   // free among reports, saved or open
      requestNewReport(name, doc);
      rawDispatch({ type: 'open', kind: 'report', name, mode: 'run', isNew: true });
    },
    // Report Design and Blank Report (A5): a new report in Design view, État1…; Access opens a blank report in Layout view
    // (later) with the Field List: here, Design view with the Field List.
    createReportDesign: () => rawDispatch({ type: 'open', kind: 'report', name: newReportName(), mode: 'design', isNew: true }),
    createBlankReport: () => {
      const name = newReportName();
      requestReportFieldList(name);
      rawDispatch({ type: 'open', kind: 'report', name, mode: 'design', isNew: true });
    },
    // Create › Macro (B1): a new macro in Design view, Macro1…, not saved until the user saves it
    pythonEditor: env.toggleImmediate,
    createModule: () => rawDispatch({ type: 'open', kind: 'module', name: newModuleName(), mode: 'design', isNew: true }),
    createMacro: () => rawDispatch({ type: 'open', kind: 'macro', name: newMacroName(), mode: 'design', isNew: true }),
  };
}

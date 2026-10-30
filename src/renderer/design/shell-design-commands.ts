// The shell's design commands (Create, Import, Relationships, SQL View), moved from App's registerCommands(SHELL_SCOPE) (B5):
// absent from BaseCraft Runtime. `env`: the App closures they read.
import { sameName } from '../../shared/field-types';
import { formulaLang } from '../../shared/i18n';
import { instantReport, uniqueReportName } from '../../shared/report/instant';
import { api } from '../bridge';
import { autoForm, formLabels, formNames, uniqueFormName } from '../form/form-def';
import { i18n } from '../i18n';
import { linkTables } from '../links/LinkDialog';
import { openLinkedTableManager } from '../links/LinkedTableManager';
import { splitDatabase } from '../links/SplitDialog';
import { openSqlView } from '../query/QueryDesignView';
import { requestFieldList as requestReportFieldList } from '../report/design/ReportDesignView';
import type { CommandHandlers } from '../shell/ribbon-model';
import { emptyDesign, toSaveRequest, withDefaultPrimaryKey } from '../table-design/design-model';
import { saveTableInteractive } from '../table-design/save-table';
import type { DesignShellEnv } from './hooks';

export function shellDesignCommands(env: DesignShellEnv): CommandHandlers {
  const { modal, dispatch, rawDispatch, t, live, sourceToCreate, newForm, newQueryName, newReportName, newMacroName, setImporting, closeDocuments } = env;
  return {
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
      if (!(await saveTableInteractive(modal, toSaveRequest(m, name, false)))) return;
      dispatch({ type: 'tableSaved', name });
      dispatch({ type: 'open', kind: 'table', name, mode: 'datasheet' });
    },
    importText: () => setImporting({}),
    importExcel: () => setImporting({ source: 'excel' }),
    // C1: External Data › BaseCraft or SQLite Database; the pane lists the new links
    linkBaseCraft: async () => { if (await linkTables(modal)) dispatch({ type: 'listsChanged' }); },
    // C2: External Data › Link Access Database (the same dialog, the Access filter first)
    linkAccess: async () => { if (await linkTables(modal, 'access')) dispatch({ type: 'listsChanged' }); },
    linkedTableManager: () => openLinkedTableManager(modal, dispatch),
    // C3: Database Tools › Move Data › Split Database; the pane then lists the links
    splitDatabase: () => splitDatabase(modal, closeDocuments, dispatch),
    relationships: () => rawDispatch({ type: 'open', kind: 'relations', name: 'Relations', mode: 'run' }),
    createFormDesign: () => newForm(false),
    // Access opens it in Layout view (later): a new unbound form in Design view, the Field List shown
    createBlankForm: () => newForm(true),
    // Create › Form (AutoForm): a columnar form of the selected (else chosen) source, saved under its name (made unique), opened in Form view
    createForm: async () => {
      const src = await sourceToCreate('form.autoFormSource');
      if (!src) return;
      const info = await api.sources.describe(src.ref);   // a rejection (a query that cannot be read) is shown; no form
      const { state: s, objects: objs } = live.current;
      const name = uniqueFormName(formNames(objs, s.tabs), src.name);
      const r = await api.objects.save('form', name, autoForm(src.ref, src.name, info, formLabels(t)), null);
      if (!r.ok) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, buttons: ['ok'] }); return; }
      dispatch({ type: 'objectSaved', kind: 'form', name });
      dispatch({ type: 'open', kind: 'form', name, mode: 'run' });
    },
    // A3: a new query in Design view, named like a new table (Requête1…), free among tables, queries and open tabs
    createQueryDesign: () => rawDispatch({ type: 'open', kind: 'query', name: newQueryName(), mode: 'design', isNew: true }),
    // A3 Task 9: a new query in SQL view; SQL View from a query's datasheet (its Design view has its own handler)
    createSqlQuery: () => openSqlView(rawDispatch, newQueryName(), true),
    viewSql: () => {
      const tab = live.current.state.tabs.find((x) => x.id === live.current.state.activeId);
      if (tab?.kind === 'query') openSqlView(dispatch, tab.name);
    },
    // AutoReport (A5): a tabular report on the selected (else chosen) source, saved under a free name and opened in Print Preview.
    createReport: async () => {
      const src = await sourceToCreate('report.pickSourceTitle');
      if (!src) return;
      const doc = instantReport({ ...src.ref, name: src.name }, await api.sources.describe(src.ref), { lang: formulaLang(i18n.language) });
      const name = uniqueReportName((await api.objects.list('report')).map((o) => o.name), src.name);
      const r = await api.objects.save('report', name, doc, null);
      if (!r.ok) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, buttons: ['ok'] }); return; }
      dispatch({ type: 'objectSaved', kind: 'report', name });
      dispatch({ type: 'open', kind: 'report', name, mode: 'run' });
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
    createMacro: () => rawDispatch({ type: 'open', kind: 'macro', name: newMacroName(), mode: 'design', isNew: true }),
  };
}

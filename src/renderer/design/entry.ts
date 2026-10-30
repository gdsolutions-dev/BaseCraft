// The designers' single way in (B5): run code imports `design` from here, never a designer (designer-modules.test.ts).
// BaseCraft Runtime's build aliases this module to entry.runtime.ts, so the designers are not in its bundle (designerGuard).
import { Code } from 'lucide-react';
import { EditListDialog } from '../datasheet/EditListDialog';
import { FormDesignView, requestFieldList as requestFormFieldList } from '../form/FormDesignView';
import { ImportTextWizard } from '../import-text/ImportTextWizard';
import { linkedTableManagerItem } from '../links/LinkedTableManager';
import { MacroDesignView } from '../macro/MacroDesignView';
import { openSqlView, QueryDesignView } from '../query/QueryDesignView';
import { RelationsView } from '../relations/RelationsView';
import { ReportDesignView, requestFieldList as requestReportFieldList } from '../report/design/ReportDesignView';
import { CurrentDatabaseOptions } from '../shell/CurrentDatabaseOptions';
import { registerDocumentView } from '../shell/document-views';
import { registerNavMenuItems } from '../shell/nav-menu';
import { FIELD_TYPES } from '../table-design/FieldPropertiesPanel';
import { TableDesignView } from '../table-design/TableDesignView';
import { addMoreField, editValidation, moreFieldsFor, setDataType, setFormat, tableFieldsCommands } from '../table-fields/table-fields-commands';
import type { DesignHooks } from './hooks';
import { shellDesignCommands } from './shell-design-commands';

registerDocumentView('table', 'design', TableDesignView);
registerDocumentView('relations', 'run', RelationsView);
registerDocumentView('form', 'design', FormDesignView);
registerDocumentView('query', 'design', QueryDesignView);
registerDocumentView('report', 'design', ReportDesignView);
registerDocumentView('macro', 'design', MacroDesignView);

registerNavMenuItems('query', [
  // A3 Task 9: the SQL view (part of the Design view)
  { id: 'sqlView', group: 'open', order: 30, labelKey: 'nav.menu.sqlView', icon: Code, visible: (c) => !c.runtime, run: (c) => openSqlView(c.dispatch, c.name) },
]);

// C1: a linked table's menu opens the Linked Table Manager, that link ticked
registerNavMenuItems('table', [linkedTableManagerItem]);

export const design: DesignHooks | null = {
  shellCommands: shellDesignCommands,
  requestFieldList: (kind, name) => (kind === 'form' ? requestFormFieldList : requestReportFieldList)(name),
  ImportWizard: ImportTextWizard,
  CurrentDatabaseOptions,
  tableFieldsCommands, FIELD_TYPES, moreFieldsFor, addMoreField, setDataType, setFormat, editValidation,
  EditListDialog,
};

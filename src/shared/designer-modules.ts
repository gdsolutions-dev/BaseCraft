// The designers' modules (B5): never in BaseCraft Runtime's renderer bundle. Run code reaches them only through
// src/renderer/design/entry.ts (the Runtime build aliases it to entry.runtime.ts); electron.vite.config.ts checks the bundle.
const R = 'src/renderer/';
export const DESIGNER_MODULES: readonly string[] = [
  ...['Designer', 'DesignCanvas', 'PropertySheet', 'Toolbox', 'FieldList'].map((m) => `${R}designer/${m}.tsx`),
  ...['designer-commands', 'designer-clipboard', 'format-commands', 'layout-commands', 'pointer'].map((m) => `${R}designer/${m}.ts`),
  ...['FormDesignView', 'TabOrderDialog', 'form-host', 'layout-host', 'LayoutRecordBar'].map((m) => `${R}form/${m}.tsx`),
  `${R}form/form-ribbon.ts`,
  ...['ReportDesignView', 'GroupingPane', 'PageNumbersDialog', 'report-host'].map((m) => `${R}report/design/${m}.tsx`),
  ...['grouping-model', 'header-items', 'report-sections'].map((m) => `${R}report/design/${m}.ts`),
  ...['QueryDesignView', 'QbeGrid', 'SqlView', 'ShowTableDialog', 'JoinDialog', 'TablePane', 'QueryProperties', 'ParametersDialog'].map((m) => `${R}query/${m}.tsx`),
  `${R}query/qbe-edit.ts`,
  ...['MacroDesignView', 'ActionCatalog', 'ActionBlock', 'ArgEditor'].map((m) => `${R}macro/${m}.tsx`),
  `${R}macro/macro-edit.ts`, `${R}macro/ConvertMacrosDialog.tsx`, 'src/shared/macro/to-python.ts',
  ...['TableDesignView', 'FieldPropertiesPanel', 'IndexesDialog', 'TablePropertiesPanel'].map((m) => `${R}table-design/${m}.tsx`),
  ...['design-model', 'indexes-model', 'save-table'].map((m) => `${R}table-design/${m}.ts`),
  `${R}table-fields/table-fields-commands.ts`, `${R}table-fields/NameCaptionDialog.tsx`, `${R}table-fields/field-edit.ts`,
  ...['RelationsView', 'RelationDialog'].map((m) => `${R}relations/${m}.tsx`),
  `${R}relations/relations-layout.ts`,
  ...['ImportTextWizard', 'AdvancedDialog', 'FixedRuler', 'PreviewGrid'].map((m) => `${R}import-text/${m}.tsx`),
  `${R}datasheet/EditListDialog.tsx`,
  `${R}shell/CurrentDatabaseOptions.tsx`,
  `${R}links/LinkDialog.tsx`, `${R}links/LinkedTableManager.tsx`, `${R}links/SplitDialog.tsx`, `${R}links/ServerLinkDialog.tsx`,
  `${R}links/MigrateWizard.tsx`, `${R}links/migrate-report.ts`,
  `${R}python/ImmediateWindow.tsx`, `${R}python/FunctionBuilder.tsx`, `${R}designer/ChooseBuilder.tsx`, `${R}python/ModuleEditorView.tsx`, `${R}python/module-menu.ts`,
  ...['ThemeGallery', 'ColorsGallery', 'CustomizeColorsDialog', 'FontsGallery', 'CustomizeFontsDialog', 'ColorPicker'].map((m) => `${R}designer/${m}.tsx`), ...['open-designs', 'theme-gallery-model', 'scheme-gallery-model', 'color-picker-model'].map((m) => `${R}designer/${m}.ts`),
  ...['ChartSettings', 'ChartSeriesFormat', 'ColorEditor', 'ChartTypePopup', 'chart-pane'].map((m) => `${R}designer/${m}.tsx`), `${R}designer/chart-settings-model.ts`,
  `${R}design/entry.ts`, `${R}design/shell-design-commands.ts`,
];

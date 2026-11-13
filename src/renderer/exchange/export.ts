// Exporter une table, une requête ou les données d'un état (A6) : paramètres, options, écriture, message de fin.
// Les écrans ne gèrent que ceci ; le fichier est écrit par le processus de données, au chemin choisi dans la boîte Enregistrer.
import { createElement } from 'react';
import type { ExportFormat, ExportSource, ExportTextSpec } from '../../shared/exchange';
import { defaultExportSpec } from '../../shared/exchange';
import { localeInfo, type LocaleInfo } from '../../shared/locale-format';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { promptParameters } from '../query/prompt-parameters';
import { bcErrorCode, errorMessage, type ModalApi } from '../shell/Modal';
import { ExportDoneDialog } from './ExportDoneDialog';
import { ExportTextDialog } from './ExportTextDialog';
import { SavedExportsDialog } from './SavedExportsDialog';

/** The ribbon command an export format belongs to (the title of its messages). */
export const exportTitleKey = (format: ExportFormat): string => ({ text: 'ribbon.cmd.exportText', excel: 'ribbon.cmd.exportExcel', xml: 'ribbon.cmd.exportXml', html: 'ribbon.cmd.exportMore' })[format];

const fail = (modal: ModalApi, messageKey: string, params?: object) =>
  modal.confirm({ titleKey: 'dialog.errorTitle', messageKey, params, buttons: ['ok'] }).then(() => {});

/** `src.params` absent: a parameter query asks for its values first (Cancel ends the export). An action query is refused before
 *  any dialog. A failure (bc:writeFailed, a query error…) is explained in the dialog; Cancel anywhere writes nothing.
 *  `saved` (F4, a Saved Export run): its text options, none asked; a whole table or query exported otherwise can be saved at the end. */
export async function exportObject(env: { modal: ModalApi; region: LocaleInfo }, format: ExportFormat, src: ExportSource, defaultName: string, saved?: { spec?: ExportTextSpec }): Promise<void> {
  const { modal, region } = env;
  try {
    const info = await api.sources.describe(src.ref).catch((e: unknown) => {
      if (bcErrorCode(e) === 'notSelectQuery') return null;
      throw e;
    });
    if (info === null) return fail(modal, 'exchange.actionQuery', { name: src.ref.kind === 'sql' ? defaultName : src.ref.name });
    let params = src.params;
    if (!params && info.parameters.length) {
      const values = await promptParameters(modal, info.parameters, region);
      if (values === null) return;
      params = values;
    }
    const full = { ...src, ...(params ? { params } : {}) };
    let r;
    let textSpec: ExportTextSpec | undefined;
    if (format === 'excel') r = await api.exchange.exportExcel(full, defaultName);
    else if (format === 'xml' || format === 'html') r = await api.exchange.exportMarkup(full, format, defaultName);
    else {
      textSpec = saved?.spec ?? await modal.custom<ExportTextSpec>((close) => createElement(ExportTextDialog, { initial: defaultExportSpec(region), onClose: close }), { titleKey: 'exchange.text.title' }) ?? undefined;
      if (!textSpec) return;
      r = await api.exchange.exportText(full, textSpec, defaultName);
    }
    if (!r.ok) return r.reason === 'tooManyRows' ? fail(modal, 'exchange.tooManyRows', { limit: r.limit.toLocaleString(region.locale) }) : undefined;
    const t = i18n.t.bind(i18n);
    const lines = [t('exchange.done', { count: r.rows })];
    if (r.warnings.unmappable) lines.push(t('exchange.warnUnmappable', { count: r.warnings.unmappable }));
    if (r.warnings.ambiguous) lines.push(t('exchange.warnAmbiguous', { count: r.warnings.ambiguous }));
    if (r.warnings.truncated) lines.push(t('exchange.truncated', { count: r.warnings.truncated }));
    // F4: a whole table or query (no parameters, sort or filter: they are not kept) can have its steps saved
    const ref = src.ref;
    const whole = !saved && (ref.kind === 'table' || ref.kind === 'query') && !src.params && !src.sort && !src.filter && src.where === undefined;
    const end = await modal.custom<{ name: string | null }>((close) => createElement(ExportDoneDialog, { lines, canSave: whole, defaultName: t('exchange.savedDefault', { name: defaultName }), onClose: close }), { titleKey: exportTitleKey(format) });
    if (whole && end?.name && (ref.kind === 'table' || ref.kind === 'query')) {
      await api.exchange.saveSaved(end.name, { format, kind: ref.kind, name: ref.name, ...(textSpec ? { spec: textSpec } : {}) });
    }
  } catch (e) {
    if (bcErrorCode(e) === 'hostCrashed') return; // the shell's single notice says it
    const m = errorMessage(e);
    await fail(modal, m.key, m.params);
  }
}

/** `exportObject` with the region read from the settings (the callers are components that do not hold it). */
export async function exportSource(modal: ModalApi, src: ExportSource, defaultName: string, format: ExportFormat = 'text'): Promise<void> {
  const region = localeInfo((await api.app.getSettings()).region);
  await exportObject({ modal, region }, format, src, defaultName);
}

/** A table or query of the Navigation Pane, whole. */
export const exportNamed = (modal: ModalApi, kind: 'table' | 'query', name: string, format: ExportFormat = 'text'): Promise<void> =>
  exportSource(modal, { ref: { kind, name } }, name, format);

/** External Data › More (F5): the formats beyond the four buttons. Access's Word merge, SharePoint and dBase are not offered. */
export function chooseMoreExport(modal: ModalApi): Promise<ExportFormat | null> {
  const t = i18n.t.bind(i18n);
  return modal.custom<ExportFormat>((close) => createElement('div', { className: 'modal-buttons' },
    createElement('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'export-more-html', onClick: () => close('html') }, t('exchange.fmtHtml')),
    createElement('button', { type: 'button', className: 'btn', 'data-testid': 'export-more-cancel', onClick: () => close(null) }, t('dialog.button.cancel'))), { titleKey: 'ribbon.cmd.exportMore' });
}

/** External Data › Saved Exports (F4): the list, and the one chosen run again (the file is asked where to go, as the first time). */
export async function runSavedExport(modal: ModalApi): Promise<void> {
  const name = await modal.custom<string>((close) => createElement(SavedExportsDialog, { onClose: close }), { titleKey: 'ribbon.cmd.savedExports' });
  if (name === null) return;
  try {
    const e = (await api.exchange.savedList())[name];
    if (!e) return;
    const region = localeInfo((await api.app.getSettings()).region);
    await exportObject({ modal, region }, e.format, { ref: { kind: e.kind, name: e.name } }, e.name, { spec: e.spec });
  } catch (e) {
    const m = errorMessage(e);
    await fail(modal, m.key, m.params);
  }
}

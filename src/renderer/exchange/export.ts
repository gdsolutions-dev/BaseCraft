// Exporter une table, une requête ou les données d'un état (A6) : paramètres, options, écriture, message de fin.
// Les écrans ne gèrent que ceci ; le fichier est écrit par le processus de données, au chemin choisi dans la boîte Enregistrer.
import { createElement } from 'react';
import type { ExportSource, ExportTextSpec } from '../../shared/exchange';
import { defaultExportSpec } from '../../shared/exchange';
import { localeInfo, type LocaleInfo } from '../../shared/locale-format';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { promptParameters } from '../query/prompt-parameters';
import { bcErrorCode, errorMessage, type ModalApi } from '../shell/Modal';
import { ExportTextDialog } from './ExportTextDialog';

const fail = (modal: ModalApi, messageKey: string, params?: object) =>
  modal.confirm({ titleKey: 'dialog.errorTitle', messageKey, params, buttons: ['ok'] }).then(() => {});

/** `src.params` absent: a parameter query asks for its values first (Cancel ends the export). An action query is refused before
 *  any dialog. A failure (bc:writeFailed, a query error…) is explained in the dialog; Cancel anywhere writes nothing. */
export async function exportObject(env: { modal: ModalApi; region: LocaleInfo }, format: 'text' | 'excel', src: ExportSource, defaultName: string): Promise<void> {
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
    if (format === 'excel') r = await api.exchange.exportExcel(full, defaultName);
    else {
      const spec = await modal.custom<ExportTextSpec>((close) => createElement(ExportTextDialog, { initial: defaultExportSpec(region), onClose: close }), { titleKey: 'exchange.text.title' });
      if (spec === null) return;
      r = await api.exchange.exportText(full, spec, defaultName);
    }
    if (!r.ok) return r.reason === 'tooManyRows' ? fail(modal, 'exchange.tooManyRows', { limit: r.limit.toLocaleString(region.locale) }) : undefined;
    const t = i18n.t.bind(i18n);
    const lines = [t('exchange.done', { count: r.rows })];
    if (r.warnings.unmappable) lines.push(t('exchange.warnUnmappable', { count: r.warnings.unmappable }));
    if (r.warnings.ambiguous) lines.push(t('exchange.warnAmbiguous', { count: r.warnings.ambiguous }));
    if (r.warnings.truncated) lines.push(t('exchange.truncated', { count: r.warnings.truncated }));
    await modal.confirm({ titleKey: format === 'excel' ? 'ribbon.cmd.exportExcel' : 'ribbon.cmd.exportText', messageKey: 'exchange.summary', params: { text: lines.join('\n') }, buttons: ['ok'] });
  } catch (e) {
    if (bcErrorCode(e) === 'hostCrashed') return; // the shell's single notice says it
    const m = errorMessage(e);
    await fail(modal, m.key, m.params);
  }
}

/** `exportObject` with the region read from the settings (the callers are components that do not hold it). */
export async function exportSource(modal: ModalApi, src: ExportSource, defaultName: string, format: 'text' | 'excel' = 'text'): Promise<void> {
  const region = localeInfo((await api.app.getSettings()).region);
  await exportObject({ modal, region }, format, src, defaultName);
}

/** A table or query of the Navigation Pane, whole. */
export const exportNamed = (modal: ModalApi, kind: 'table' | 'query', name: string, format: 'text' | 'excel' = 'text'): Promise<void> =>
  exportSource(modal, { ref: { kind, name } }, name, format);

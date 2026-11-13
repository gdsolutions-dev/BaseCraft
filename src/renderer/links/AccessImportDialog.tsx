// External Data › Import › Access (E1): the tables and data of an Access file copied into local tables. The file is picked and read
// as the link dialog does (a protected file asks its password inside `inspect`, bridge.ts); the password never reaches this dialog
// nor the report. Step 1 lists the tables (LinkForm), step 2 is the import report: what was carried, approximated or ignored.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REPORT_LEVEL, reportText, type AccessImportInfo, type ImportReport, type ReportLevel } from '../../shared/access-import';
import type { ImportProgress } from '../../shared/import-text';
import { api } from '../bridge';
import { errorMessage, type ModalApi } from '../shell/Modal';
import { LinkForm, SourceHeader } from './LinkDialog';
import { ImportBusy } from './ServerLinkDialog';

type Done = { tables: { name: string }[]; report: ImportReport };
const LEVELS: ReportLevel[] = ['ignored', 'approximated', 'carried'];

/** External Data › Import › Access: picks the file, reads its tables, asks which to import, then shows the report. True when
 *  tables were imported. */
export async function importAccessTables(modal: ModalApi): Promise<boolean> {
  const path = await api.links.pick('access');
  if (path === null) return false;
  const info = await api.accessImport.inspect(path);
  // Escape or the modal's close button resolve null once the report is shown, but the tables are imported: the list refreshes anyway.
  let imported = false;
  const closed = await modal.custom<true>((close) => <AccessImportDialog path={path} info={info} onClose={close} onImported={() => { imported = true; }} />, { titleKey: 'import.access.title' });
  return imported || closed === true;
}

function AccessImportDialog({ path, info, onClose, onImported }: { path: string; info: AccessImportInfo; onClose(v: true | null): void; onImported(): void }) {
  const { t } = useTranslation();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // A reason is a code: shown as the text the Relationships window or the table designer already has, or as this report's own
  const reasonKey = (code: string, reason: string) => code === 'tableUnsupported' ? `designError.${reason}`
    : reason === 'tableNotImported' || reason === 'violations' ? `import.report.reason.${reason}` : `relations.error.${reason}`;
  const rt = (key: string, params?: Record<string, unknown>) =>
    t(key, typeof params?.reason === 'string' ? { ...params, reason: t(reasonKey(key.slice(key.lastIndexOf('.') + 1), params.reason)) } : params);

  if (done) {
    const { report } = done;
    return (
      <div data-testid="import-report" className="link-dialog">
        <p className="modal-message">{t('import.server.done', { names: done.tables.map((x) => x.name).join(', ') })}</p>
        {LEVELS.map((level) => {
          const lines = report.lines.filter((l) => REPORT_LEVEL[l.code] === level);
          return lines.length > 0 && (
            <section key={level} data-testid={`report-${level}`}>
              <h3>{t(`import.report.level.${level}`)}</h3>
              <ul>
                {lines.map((l, i) => (
                  <li key={i} data-testid={`report-line-${l.code}`}>
                    {rt(`import.report.line.${l.code}`, { object: l.object, part: l.part, n: l.n, reason: l.reason })}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {saveError && <p className="modal-error" role="alert" data-testid="report-save-error">{saveError}</p>}
        <div className="modal-buttons">
          <button type="button" className="btn" data-testid="report-save" onClick={async () => {
            setSaveError(null);
            try { await api.accessImport.saveReport(reportText(report, rt), t('import.report.fileName', { source: report.source })); } // false: cancelled, silent
            catch (e) { const m = errorMessage(e); setSaveError(t(m.key, m.params)); }
          }}>{t('import.report.save')}</button>
          <button type="button" className="btn btn-primary" data-testid="import-close" autoFocus onClick={() => onClose(true)}>{t('dialog.button.ok')}</button>
        </div>
      </div>
    );
  }
  const create = async (names: string[]) => {
    setProgress(null);
    const off = api.accessImport.onProgress(setProgress);
    try {
      const r = await api.accessImport.run(path, names.map((n) => info.tables.find((x) => x.name === n)!.remote));
      if (r.ok) { onImported(); setDone(r); }
      return r;
    } finally { off(); }
  };
  const header = (
    <>
      <SourceHeader path={path} kind="access" />
      <p className="muted" data-testid="import-file-only">{t('import.access.fileOnly')}</p>
      {info.linked.length > 0 && <p className="muted" data-testid="import-linked">{t('import.access.linked', { names: info.linked.join(', ') })}</p>}
      {info.warnSize && <p className="muted" data-testid="import-warn-size">{t('import.access.warnSize')}</p>}
    </>
  );
  return <LinkForm server header={header} tables={info.tables} create={create} okKey="import.server.ok" missingKey="import.access.missingTables"
    busyNote={<ImportBusy progress={progress} />} onClose={(v) => { if (v === null) onClose(null); }} />;
}

// External Data › Import › Access (E1): the tables and data of an Access file copied into local tables. The file is picked and read
// as the link dialog does (a protected file asks its password inside `inspect`, bridge.ts); the password never reaches this dialog
// nor the report. Step 1 lists the tables (LinkForm), step 2 is the import report: what was carried, approximated or ignored.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lineKey, REPORT_LEVEL, reportText, type AccessImportInfo, type AccessStructureSource, type ImportReport, type ReportLevel } from '../../shared/access-import';
import type { ImportProgress } from '../../shared/import-text';
import { api } from '../bridge';
import { errorMessage, type ModalApi } from '../shell/Modal';
import { LinkForm, SourceHeader } from './LinkDialog';
import { ImportBusy } from './ServerLinkDialog';

type Done = { tables: { name: string }[]; report: ImportReport };
const LEVELS: ReportLevel[] = ['ignored', 'approximated', 'carried'];

/** External Data › Import › Access: picks the file, reads its tables, asks which to import, then shows the report. True when
 *  tables were imported. */
export async function importAccessTables(modal: ModalApi, opened?: string): Promise<boolean> {
  // `opened`: the Access file File › Open made a base from (main side: already allowed). Every table starts picked.
  const path = opened ?? await api.links.pick('access');
  if (path === null) return false;
  const info = await api.accessImport.inspect(path);
  // Escape or the modal's close button resolve null once the report is shown, but the tables are imported: the list refreshes anyway.
  let imported = false;
  const closed = await modal.custom<true>((close) => <AccessImportDialog path={path} info={info} allPicked={opened !== undefined} onClose={close} onImported={() => { imported = true; }} />, { titleKey: 'import.access.title' });
  return imported || closed === true;
}

// The reason of these lines is shown as it is: a control's Access type, a control's new name (the event kind only picks the sentence)
const RAW_REASONS = ['designControlReplaced', 'designControlRenamed', 'designEventDropped'];

function AccessImportDialog({ path, info, allPicked, onClose, onImported }: { path: string; info: AccessImportInfo; allPicked: boolean; onClose(v: true | null): void; onImported(): void }) {
  const { t } = useTranslation();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // E2: where the exact structure comes from. Access when this PC can run it; a folder or the keep-folder is asked of the main process (pickExport).
  const [kind, setKind] = useState<AccessStructureSource['kind']>(info.canExport ? 'access' : 'file');
  const [dir, setDir] = useState<string | null>(null);
  const [keepDir, setKeepDir] = useState<string | null>(null);
  const [keep, setKeep] = useState(false);
  const [queries, setQueries] = useState(true); // E3: the saved queries come with an export
  const [designs, setDesigns] = useState(true); // E4: so do the forms and reports
  const [macros, setMacros] = useState(true); // E5: so do the macros and modules
  const [relink, setRelink] = useState(true); // the front-end's linked tables become links to their Access file
  const [failure, setFailure] = useState<string | null>(null);
  // A reason is a code: shown as the text the Relationships window or the table designer already has, or as this report's own
  const OWN_REASONS = ['tableNotImported', 'violations', 'defaultValue', 'validationRule', 'inputMask', 'lookup',
    'unknownFunction', 'dataDefinition', 'notRead', 'notBound', 'nameInvalid', 'duplicate', 'unreadable', 'nameTaken', 'nameTooLong', 'notSaved'];
  const reasonKey = (code: string, reason: string) => (code === 'designSkipped' || code === 'macroSkipped' || code === 'moduleSkipped') && (reason === 'notRead' || reason === 'duplicate') ? `import.report.reason.design_${reason}` : OWN_REASONS.includes(reason) ? `import.report.reason.${reason}`
    : code === 'tableUnsupported' || code.startsWith('propertyDropped') ? `designError.${reason}` : `relations.error.${reason}`;
  // The line's own sentence is trimmed: a line without a reason ends on a space
  const rt = (key: string, params?: Record<string, unknown>) =>
    t(key, typeof params?.reason === 'string' && !RAW_REASONS.some((c) => key.includes(`.${c}`)) ? { ...params, reason: t(reasonKey(key.slice(key.lastIndexOf('.') + 1), params.reason), { part: params.part }) } : params).trim();

  if (done) {
    const { report } = done;
    return (
      <div data-testid="import-report" className="link-dialog">
        <p className="modal-message">{done.tables.length > 0 ? t('import.server.done', { names: done.tables.map((x) => x.name).join(', ') }) : t('import.access.doneNoTable')}</p>
        <div className="link-list">{/* capped and scrolling: the window opens at its top, the buttons stay in view */}
        {LEVELS.map((level) => {
          const lines = report.lines.filter((l) => REPORT_LEVEL[l.code] === level);
          return lines.length > 0 && (
            <section key={level} data-testid={`report-${level}`}>
              <h3>{t(`import.report.level.${level}`)}</h3>
              <ul>
                {lines.map((l, i) => (
                  <li key={i} data-testid={`report-line-${l.code}`}>
                    {rt(`import.report.line.${lineKey(l)}`, { object: l.object, part: l.part, n: l.n, reason: l.reason })}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        </div>
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
  // A radio is selected at once and given back when the folder dialog is cancelled
  const chooseFolder = async () => {
    const before = kind;
    setKind('folder'); setFailure(null);
    const p = await api.accessImport.pickExport();
    if (p === null) setKind(dir === null ? before : 'folder'); else setDir(p);
  };
  const chooseKeep = async (on: boolean) => {
    setKeep(on);
    if (!on) return setKeepDir(null);
    const p = await api.accessImport.pickExport();
    if (p === null) setKeep(false); else setKeepDir(p);
  };
  const create = async (names: string[]) => {
    setProgress(null); setFailure(null);
    const off = api.accessImport.onProgress(setProgress);
    try {
      const structure: AccessStructureSource = kind === 'folder' && dir !== null ? { kind, dir } : { kind: kind === 'access' ? 'access' : 'file' };
      const r = await api.accessImport.run(path, names.map((n) => info.tables.find((x) => x.name === n)!.remote), structure, kind === 'access' && keep && keepDir !== null ? keepDir : undefined, kind !== 'file' ? queries : undefined, kind !== 'file' ? designs : undefined, info.relinkable > 0 ? relink : undefined, kind !== 'file' ? macros : undefined);
      if (r.ok) { onImported(); setDone(r); }
      if (!r.ok && r.reason === 'export') { setFailure(r.failure); return { ok: false as const, reason: 'cancelled' as const }; } // stays on the list: another choice can be picked
      return r;
    } finally { off(); }
  };
  const header = (
    <>
      <SourceHeader path={path} kind="access" />
      {info.relinkable > 0 && ( // read with mdb-reader: needs no Access export, whatever the structure source
        <div>
          <label><input type="checkbox" data-testid="import-relink" checked={relink} onChange={(e) => setRelink(e.target.checked)} /> {t('import.access.relink', { n: info.relinkable })}</label>
          <p className="muted" data-testid="import-relink-note">{t('import.access.relinkNote')}</p>
        </div>
      )}
      <fieldset className="modal-field" data-testid="import-structure">
        <legend>{t('import.access.structure')}</legend>
        {info.canExport && (
          <div>
            <label><input type="radio" name="import-structure" data-testid="import-structure-access" checked={kind === 'access'} onChange={() => { setKind('access'); setFailure(null); }} /> {t('import.access.structureAccess')}</label>
            <p className="muted" data-testid="import-access-note">{t('import.access.accessNote')}</p>
            <label><input type="checkbox" data-testid="import-keep-export" checked={keep} disabled={kind !== 'access'} onChange={(e) => { void chooseKeep(e.target.checked); }} /> {t('import.access.keepExport')}</label>
            {keep && <p className="muted" data-testid="import-keep-note">{t('import.access.keepNote')}</p>}
            {keepDir !== null && <p className="muted path-text" data-testid="import-keep-dir">{keepDir}</p>}
          </div>
        )}
        <div>
          <label><input type="radio" name="import-structure" data-testid="import-structure-folder" checked={kind === 'folder'} onChange={() => { void chooseFolder(); }} /> {t('import.access.structureFolder')}</label>
          {kind === 'folder' && dir !== null && (
            <p className="muted path-text"><span data-testid="import-export-dir">{dir}</span> <button type="button" className="btn" data-testid="import-structure-folder-change" onClick={() => { void chooseFolder(); }}>{t('import.access.changeFolder')}</button></p>
          )}
        </div>
        {kind !== 'file' && (
          <div>
            <label><input type="checkbox" data-testid="import-queries" checked={queries} onChange={(e) => setQueries(e.target.checked)} /> {t('import.access.queries')}</label>
            <p className="muted" data-testid="import-queries-note">{t('import.access.queriesNote')}</p>
            <label><input type="checkbox" data-testid="import-designs" checked={designs} onChange={(e) => setDesigns(e.target.checked)} /> {t('import.access.designs')}</label>
            <p className="muted" data-testid="import-designs-note">{t('import.access.designsNote')}</p>
            <label><input type="checkbox" data-testid="import-macros" checked={macros} onChange={(e) => setMacros(e.target.checked)} /> {t('import.access.macros')}</label>
          </div>
        )}
        <label><input type="radio" name="import-structure" data-testid="import-structure-file" checked={kind === 'file'} onChange={() => { setKind('file'); setFailure(null); }} /> {t('import.access.structureFile')}</label>
      </fieldset>
      {failure && <p className="modal-error" role="alert" data-testid="import-export-failure">{t(`import.access.exportFailed.${failure}`)}</p>}
      {kind === 'file' && <p className="muted" data-testid="import-file-only">{t('import.access.fileOnly')}</p>}
      {info.linked.length > 0 && <p className="muted" data-testid="import-linked">{t('import.access.linked', { names: info.linked.join(', ') })}</p>}
      {info.warnSize && <p className="muted" data-testid="import-warn-size">{t('import.access.warnSize')}</p>}
    </>
  );
  // Nothing picked is an import when something else comes with it: the front-end's links, or the export's queries, forms, macros
  const extras = (info.relinkable > 0 && relink) || (kind !== 'file' && (queries || designs || macros));
  return <LinkForm server header={header} allPicked={allPicked} canSubmitEmpty={extras} tables={info.tables} create={create} okKey="import.server.ok" skippedKey="import.server.skippedInline" missingKey="import.access.missingTables"
    busyNote={<ImportBusy progress={progress} />} onClose={(v) => { if (v === null) onClose(null); }} />;
}

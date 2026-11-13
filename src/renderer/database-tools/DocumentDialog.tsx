// A generated document (the relationship report, the documenter's output) shown read-only, to print or to save as PDF through
// the report pipeline (api.reports: a hidden window that loads only this HTML; nothing is written into the base).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../bridge';
import { errorMessage, type ModalApi } from '../shell/Modal';
import './database-tools.css';

export const showDocument = (modal: ModalApi, titleKey: string, html: string, name: string, landscape = false): Promise<'close' | null> =>
  modal.custom<'close'>((close) => <DocumentView html={html} name={name} landscape={landscape} onClose={() => close('close')} />, { titleKey });

function DocumentView({ html, name, landscape, onClose }: { html: string; name: string; landscape: boolean; onClose(): void }) {
  const { t } = useTranslation();
  // The dialogs share one queue: a message cannot open over this one, so the outcome is told here
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const req = { html, name, landscape };
  const run = (job: () => Promise<string | null>) => async () => {
    try { const key = await job(); setStatus(key ? { text: t(key), error: false } : null); } catch (e) { const m = errorMessage(e); setStatus({ text: t(m.key, m.params), error: true }); }
  };
  return (
    <div className="dbt" data-testid="document-dialog">
      {/* ponytail: a sandboxed frame (no script, no navigation) shows the document; the same HTML goes to the print window */}
      <iframe className="dbt-frame" title={name} sandbox="" srcDoc={html} data-testid="document-frame" />
      {status && <p className={status.error ? 'wiz-error' : 'muted'} role="status" data-testid="document-status">{status.text}</p>}
      <div className="modal-buttons">
        <button type="button" className="btn" data-testid="document-print" onClick={run(async () => { await api.reports.print(req); return null; })}>{t('ribbon.cmd.print')}</button>
        <button type="button" className="btn" data-testid="document-pdf" onClick={run(async () => ((await api.reports.exportPdf(req)) === 'saved' ? 'report.pdfSaved' : null))}>{t('ribbon.cmd.exportPdf')}</button>
        <button type="button" className="btn" data-testid="document-close" onClick={onClose}>{t('dbtools.close')}</button>
      </div>
    </div>
  );
}

// Outils de base de données › Déplacer les données › Vers un serveur (C7 R1, R16), l'Assistant Migration : ce qui est déplacé et le
// serveur de destination, la connexion (ServerLinkDialog `pick`), le schéma ; puis, chaque document fermé, la progression avec
// « Arrêter » et le rapport ou le refus. Concepteur : absent de BaseCraft Runtime. Le mot de passe ne quitte pas l'étape de connexion.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerKind } from '../../shared/api';
import type { ImportProgress } from '../../shared/import-text';
import type { MigrateRequest, MigrateResult } from '../../shared/migrate';
import { api } from '../bridge';
import { useFocusFirst, type ModalApi } from '../shell/Modal';
import type { AppDispatch } from '../shell/nav-menu';
import { rejectedLines, reportHead, reportSections, reportText, resultLines } from './migrate-report';
import { ServerLinkDialog } from './ServerLinkDialog';

export { reportText };

const ENGINES = ['postgresql', 'sqlserver'] as const;
const DEFAULT_SCHEMA: Record<ServerKind, string> = { postgresql: 'public', sqlserver: 'dbo' };

/** Database Tools › Vers un serveur: the pages, every document closed, the run with its progress, then the report or the refusal. */
export async function moveToServer(modal: ModalApi, closeDocuments: () => Promise<boolean>, dispatch: AppDispatch): Promise<void> {
  const req = await modal.custom<MigrateRequest>((close) => <MigratePages onClose={close} />, { titleKey: 'migrate.title' });
  if (!req || !(await closeDocuments())) return;
  await modal.custom<true>((close) => <MigrateRun req={req} changed={() => void dispatch({ type: 'listsChanged' })} onClose={close} />,
    { titleKey: 'migrate.title' });
}

/** R1: page 1 what moves and the engine, page 2 the server's login, page 3 the schema. Closes with the run's request. */
function MigratePages({ onClose }: { onClose(v: MigrateRequest | null): void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ServerKind>('postgresql');
  const [page, setPage] = useState<'intro' | 'login' | 'schema'>('intro');
  const [params, setParams] = useState<unknown>(null);
  const [schema, setSchema] = useState('');
  if (page === 'login') {
    return <ServerLinkDialog kind={kind} pick onClose={(v) => {
      if (v === null || v === true) return onClose(null);
      setParams(v); setSchema(DEFAULT_SCHEMA[kind]); setPage('schema');
    }} />;
  }
  if (page === 'schema') {
    const ok = schema.trim().length >= 1 && schema.length <= 128;
    return (
      <form data-testid="migrate-schema-page" onSubmit={(e) => { e.preventDefault(); if (ok) onClose({ kind, params, schema: schema.trim() }); }}>
        <label className="modal-field">
          <span>{t('migrate.schema')}</span>
          <input data-testid="migrate-schema" autoComplete="off" value={schema} aria-invalid={!ok} onChange={(e) => setSchema(e.target.value)} />
        </label>
        <div className="modal-buttons">
          <button type="submit" className="btn btn-primary" data-testid="migrate-start" disabled={!ok}>{t('migrate.start')}</button>
          <button type="button" className="btn" data-testid="migrate-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
        </div>
      </form>
    );
  }
  return (
    <form data-testid="migrate-dialog" onSubmit={(e) => { e.preventDefault(); setPage('login'); }}>
      <p className="modal-message">{t('migrate.intro')}</p>
      <fieldset className="modal-field">
        <legend>{t('migrate.engine')}</legend>
        {ENGINES.map((k) => (
          <label key={k}>
            <input type="radio" name="migrate-engine" data-testid={`migrate-engine-${k}`} checked={kind === k} onChange={() => setKind(k)} />
            {t(`link.kind.${k}`)}
          </label>
        ))}
      </fieldset>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="migrate-next">{t('migrate.next')}</button>
        <button type="button" className="btn" data-testid="migrate-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}

type Outcome = MigrateResult | { ok: false; reason: 'error'; e: unknown; backupPath?: string };

/** The run (R8–R10): its progress with « Arrêter » (queries.cancel; disabled from `finishing` on: the COMMIT is under way), then
 *  the report (R16) or the refusal; `changed` once the tables became links. Escape does not close it while it runs. */
function MigrateRun({ req, changed, onClose }: { req: MigrateRequest; changed(): void; onClose(v: true | null): void }) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [stopping, setStopping] = useState(false);
  const started = useRef(false);
  const backup = useRef<string>(); // the run's first progress event: a Stop that ends the data process names it
  const progressRef = useRef<HTMLDivElement>(null);
  const ref = useFocusFirst<HTMLDivElement>(outcome); // the report or the refusal replaces the progress: its first button takes the focus
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const off = api.migrate.onProgress((p) => { if (p.backupPath) backup.current = p.backupPath; setProgress(p); });
    api.migrate.run(req).then((r) => { if (r.ok) changed(); setOutcome(r); },
      (e: unknown) => setOutcome({ ok: false, reason: 'error', e, backupPath: backup.current })).finally(off);
  }, []);

  if (!outcome) {
    const p = progress;
    const hold = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } };
    return (
      <div ref={progressRef} tabIndex={-1} data-testid="migrate-progress" className="migrate-progress" onKeyDown={hold}>
        <p className="modal-message" role="status">
          {p?.finishing ? t('migrate.finishing') : p?.label ? t('migrate.progress', { table: p.label, done: p.done, total: p.total }) : t('migrate.connecting')}
        </p>
        <progress max={p?.total || 1} value={p?.finishing ? p.total || 1 : p?.done ?? 0} />
        <div className="modal-buttons">
          <button type="button" className="btn" data-testid="migrate-stop" disabled={stopping || !!p?.finishing}
            onClick={() => { progressRef.current?.focus(); setStopping(true); void api.queries.cancel().catch(() => setStopping(false)); }}>{t('migrate.stop')}</button>
        </div>
      </div>
    );
  }
  const close = (
    <button type="button" className="btn btn-primary" data-testid="migrate-close" onClick={() => onClose(true)}>{t('dialog.button.ok')}</button>
  );
  if (outcome.ok) {
    const r = outcome.report;
    return (
      <div ref={ref} data-testid="migrate-report" className="migrate-report">
        {reportHead(r, t).map((line, i) => <p key={i} className="modal-message">{line}</p>)}
        {reportSections(r, t).map(([head, lines]) => (
          <section key={head}>
            <h3 className="migrate-head">{head}</h3>
            <ul>{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
          </section>
        ))}
        <div className="modal-buttons">
          {close}
          <button type="button" className="btn" data-testid="migrate-copy" onClick={() => void api.app.writeClipboard(reportText(r, t))}>{t('migrate.copy')}</button>
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} data-testid="migrate-result">
      {(outcome.reason === 'error' ? rejectedLines(outcome.e, outcome.backupPath, t) : resultLines(outcome, t)).map((line, i) => <p key={i} className="modal-message">{line}</p>)}
      <div className="modal-buttons">{close}</div>
    </div>
  );
}

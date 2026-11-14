// External Data › Import › ODBC Database (C4; D1: or Link, as Access's Import / Link choice): a data source (a DSN of this computer, or a connection string) and a login, then the
// tables to copy into local tables (LinkForm, as the server imports), then which were imported. The login lives in this dialog's
// fields and in the calls that send it: never in a shared state, never kept.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerLinkInfo } from '../../shared/api';
import type { ImportProgress } from '../../shared/import-text';
import type { ServerImportResult } from '../../shared/migrate';
import type { OdbcRequest } from '../../shared/odbc';
import { api } from '../bridge';
import { errorMessage, useFocusFirst, type ModalApi } from '../shell/Modal';
import { LinkForm } from './LinkDialog';

/** True when tables were imported. */
export async function importOdbcTables(modal: ModalApi): Promise<boolean> {
  return (await modal.custom<true>((close) => <OdbcImportDialog onClose={close} />, { titleKey: 'import.odbc.title' })) === true;
}

function OdbcImportDialog({ onClose }: { onClose(v: true | null): void }) {
  const { t } = useTranslation();
  const [dsns, setDsns] = useState<string[]>([]);
  const [dsn, setDsn] = useState('');
  const [connection, setConnection] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [link, setLink] = useState(false); // D1: link the tables (read-only, kept in memory) instead of copying them
  const [info, setInfo] = useState<{ label: string; tables: ServerLinkInfo['tables'] } | null>(null);
  const [done, setDone] = useState<Extract<ServerImportResult, { ok: true }> | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useFocusFirst<HTMLFormElement>();
  useEffect(() => { void api.odbc.dsns().then(setDsns, () => setDsns([])); }, []);
  const req: OdbcRequest = { dsn, connection: dsn === '' ? connection : '', user, password };
  const ok = dsn !== '' || connection.trim() !== '';
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setError(null); };

  const connect = async () => {
    setBusy(true); setError(null);
    try {
      setInfo(await api.odbc.inspect(req));
    } catch (e) {
      const m = errorMessage(e);
      setError(t(m.key, m.params));
    } finally { setBusy(false); }
  };

  if (info && done) {
    return (
      <div data-testid="import-result" className="link-dialog">
        <p className="modal-message">{t('import.server.done', { names: done.tables.map((x) => x.name).join(', ') })}</p>
        {done.tables.filter((x) => x.skipped.length).map((x) => (
          <p key={x.name} className="muted" data-testid={`import-skipped-${x.name}`}>{t('import.server.skipped', { table: x.name, names: x.skipped.join(', ') })}</p>
        ))}
        <div className="modal-buttons"><button type="button" className="btn btn-primary" data-testid="import-close" autoFocus onClick={() => onClose(true)}>{t('dialog.button.ok')}</button></div>
      </div>
    );
  }
  if (info) {
    const create = async (names: string[]) => {
      setProgress(null);
      const off = api.odbc.onProgress(setProgress);
      try {
        if (link) return await api.odbc.link(req, names); // LinkForm closes the dialog on ok
        const r = await api.odbc.run(req, names);
        if (r.ok) setDone(r);
        return r;
      } finally { off(); }
    };
    const busyNote = (
      <div data-testid="import-progress" className="migrate-progress">
        <p className="modal-message" role="status">{progress?.label ? t('migrate.progress', { table: progress.label, done: progress.done, total: progress.total }) : t('migrate.connecting')}</p>
        <progress max={progress?.total || 1} value={progress?.done ?? 0} />
      </div>
    );
    return <LinkForm server header={<p className="path-text" data-testid="link-path">{t('link.source', { path: info.label })}</p>} tables={info.tables} create={create}
      okKey={link ? 'link.ok' : 'import.server.ok'} skippedKey="import.server.skippedInline" busyNote={busyNote} onClose={(v) => { if (v === null || link) onClose(v); }} />;
  }
  return (
    <form ref={ref} data-testid="odbc-dialog" className="link-dialog" onSubmit={(e) => { e.preventDefault(); if (ok) void connect(); }}>
      <label className="modal-field">
        <span>{t('import.odbc.dsn')}</span>
        <select data-testid="odbc-dsn" value={dsn} onChange={edit(setDsn)}>
          <option value="" />
          {dsns.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <label className="modal-field">
        <span>{t('import.odbc.connection')}</span>
        <input data-testid="odbc-connection" autoComplete="off" disabled={dsn !== ''} value={connection} onChange={edit(setConnection)} />
      </label>
      <label className="modal-field">
        <span>{t('link.login.user')}</span>
        <input data-testid="odbc-user" autoComplete="off" value={user} onChange={edit(setUser)} />
      </label>
      <label className="modal-field">
        <span>{t('link.login.password')}</span>
        <input data-testid="odbc-password" type="password" autoComplete="off" value={password} onChange={edit(setPassword)} />
      </label>
      <fieldset className="modal-field">
        <label><input type="radio" name="odbc-mode" data-testid="odbc-mode-import" checked={!link} onChange={() => setLink(false)} />{t('import.odbc.modeImport')}</label>
        <label><input type="radio" name="odbc-mode" data-testid="odbc-mode-link" checked={link} onChange={() => setLink(true)} />{t('import.odbc.modeLink')}</label>
      </fieldset>
      {error && <p className="modal-error" role="alert" data-testid="odbc-error">{error}</p>}
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="odbc-connect" disabled={busy || !ok}>{t('link.server.connect')}</button>
        <button type="button" className="btn" data-testid="odbc-cancel" disabled={busy} onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}

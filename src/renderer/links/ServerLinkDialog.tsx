// Données externes › PostgreSQL (C4) et SQL Server (C5 R17) : connexion au serveur, puis ses tables à lier (LinkForm), chacune
// sous le nom proposé. Le Gestionnaire de tables liées l'affiche prérempli, de la sorte du lien, dans sa propre fenêtre, pour
// changer le serveur de liens (R9). Le mot de passe ne vit que dans son champ et dans l'appel qui l'envoie : jamais dans un état
// partagé, jamais journalisé.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerKind, ServerLinkInfo } from '../../shared/api';
import type { ImportProgress } from '../../shared/import-text';
import type { ServerImportResult } from '../../shared/migrate';
import { api } from '../bridge';
import { errorMessage, useFocusFirst, type ModalApi } from '../shell/Modal';
import { LinkForm, SourceHeader } from './LinkDialog';

const TLS = [['verify-full', 'tlsVerify'], ['require', 'tlsRequire'], ['disable', 'tlsDisable']] as const;
type Tls = (typeof TLS)[number][0];
type Fields = { host: string; port: string; database: string; user: string; tls: Tls; timeout: string };
/** What differs by kind (R17): the title, the default port, the `require` mode's label (SQL Server: Access's “Trust server
 *  certificate”); SQL Server's « Serveur » also takes `host\instance` (R2). */
const KIND = {
  postgresql: { title: 'link.server.title', port: '5432', require: 'tlsRequire' },
  sqlserver: { title: 'link.server.titleSqlServer', port: '1433', require: 'tlsTrust' },
} as const;
export const serverTitle = (kind: ServerKind): string => KIND[kind].title;
const importTitle = (kind: ServerKind): string => (kind === 'postgresql' ? 'import.server.title' : 'import.server.titleSqlServer');

const text = (v: unknown, d: string) => (typeof v === 'string' || typeof v === 'number' ? String(v) : d);
/** The form's fields from a server's params (LinkInfo.params), defaults where absent; an instance shown as `host\instance`. */
const fieldsOf = (kind: ServerKind, p: Record<string, unknown> = {}): Fields => ({
  host: text(p.host, '') + (typeof p.instance === 'string' && p.instance ? `\\${p.instance}` : ''), port: text(p.port, KIND[kind].port),
  database: text(p.database, ''), user: text(p.user, ''), tls: TLS.find(([v]) => v === p.tls)?.[0] ?? 'verify-full', timeout: text(p.timeout, '60'),
});
const int = (s: string, min: number, max: number) => (/^\d+$/.test(s) && Number(s) >= min && Number(s) <= max ? Number(s) : null);

/** External Data › PostgreSQL or SQL Server: connects (the login kept as asked, R10), then asks which tables to link. True when
 *  links were created. */
export async function linkServerTables(modal: ModalApi, kind: ServerKind): Promise<boolean> {
  return (await modal.custom<true>((close) => <ServerLinkDialog kind={kind} onClose={close} />, { titleKey: serverTitle(kind) })) === true;
}

/** External Data › Import › PostgreSQL or SQL Server (C7 R17): connects, then asks which tables to copy into local tables (progress and
 *  « Arrêter » while it runs), then says which were imported and which columns were not. True when tables were imported. */
export async function importServerTables(modal: ModalApi, kind: ServerKind): Promise<boolean> {
  return (await modal.custom<true>((close) => <ServerLinkDialog kind={kind} importing onClose={close} />, { titleKey: importTitle(kind) })) === true;
}

/** The import's progress with « Arrêter » (queries.cancel). Escape does not close the dialog while it runs. */
export function ImportBusy({ progress }: { progress: ImportProgress | null }) {
  const { t } = useTranslation();
  const [stopping, setStopping] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []); // the OK button that started it is disabled now
  const hold = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } };
  return (
    <div ref={ref} tabIndex={-1} data-testid="import-progress" className="migrate-progress" onKeyDown={hold}>
      <p className="modal-message" role="status">{progress?.label?.startsWith('import.') ? t(progress.label, { done: progress.done, total: progress.total }) // E2: the label is a text key (the export's steps)
          : progress?.label ? t('migrate.progress', { table: progress.label, done: progress.done, total: progress.total }) : t('migrate.connecting')}</p>
      <progress max={progress?.total || 1} value={progress?.done ?? 0} />
      <div className="modal-buttons">
        <button type="button" className="btn" data-testid="import-stop" disabled={stopping}
          onClick={() => { ref.current?.focus(); setStopping(true); void api.queries.cancel().catch(() => setStopping(false)); }}>{t('migrate.stop')}</button>
      </div>
    </div>
  );
}

/** The connection form, then LinkForm. `relink` (the Linked Table Manager): those links move to the server connected to instead
 *  (true), `initial` their server's params. `pick` (C6 R3, a pass-through's « Autre serveur… »): once the login is accepted, closes
 *  with the server's params (never the password) instead of listing its tables. `importing` (R17): the tables are copied into local
 *  tables instead of linked. */
export function ServerLinkDialog({ kind, initial, relink, pick, importing, onClose }: {
  kind: ServerKind; initial?: Record<string, unknown>; relink?: string[]; pick?: true; importing?: true; onClose(v: true | Record<string, unknown> | null): void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState(() => fieldsOf(kind, initial));
  const [password, setPassword] = useState('');
  const [canRemember, setCanRemember] = useState<boolean | null>(null);
  const [remember, setRemember] = useState(true);
  const [info, setInfo] = useState<{ server: ServerLinkInfo; params: object } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [done, setDone] = useState<Extract<ServerImportResult, { ok: true }> | null>(null);
  const ref = useFocusFirst<HTMLFormElement>(); // shown in place of the Linked Table Manager's list: the focus comes here
  useEffect(() => { void api.links.canRemember().then(setCanRemember, () => setCanRemember(false)); }, []);
  const set = (k: keyof Fields) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); setError(null); };
  // SQL Server's `host\instance` (R2): with an instance the port is not used (SQL Server Browser gives it), so neither checked nor sent
  const cut = kind === 'sqlserver' ? f.host.indexOf('\\') : -1;
  const host = (cut < 0 ? f.host : f.host.slice(0, cut)).trim();
  const instance = cut < 0 ? undefined : f.host.slice(cut + 1).trim();
  const port = int(f.port, 1, 65535);
  const timeout = int(f.timeout, 0, 3600);
  const ok = host !== '' && f.database !== '' && f.user !== '' && password !== '' && (instance !== undefined || port !== null) && timeout !== null;

  const connect = async () => {
    const params = { host, ...(instance !== undefined ? { instance } : { port }), database: f.database, user: f.user, tls: f.tls, timeout };
    setBusy(true); setError(null);
    try {
      const server = await api.links.inspectServer(kind, params, password, !!canRemember && remember);
      if (pick) return onClose(params);
      if (!relink) return setInfo({ server, params });
      const r = await api.links.relinkServer(relink, kind, params);
      if (r.ok) return onClose(true);
      setError(t(r.reason === 'missingTables' ? 'link.server.missingTables' : `link.error.${r.reason}`, { names: r.names.join(', ') }));
    } catch (e) {
      const m = errorMessage(e);
      setError(m.key === 'dialog.error.linkUnavailable_needsLogin' ? t('link.login.wrong') : t(m.key, m.params));
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
  if (info && importing) {
    const create = async (names: string[]) => {
      setProgress(null);
      const off = api.migrate.onProgress(setProgress);
      try {
        const r = await api.migrate.importTables(kind, info.params, names);
        if (r.ok) setDone(r);
        return r;
      } finally { off(); }
    };
    return <LinkForm server header={<SourceHeader path={info.server.label} kind={kind} />} tables={info.server.tables} create={create}
      okKey="import.server.ok" skippedKey="import.server.skippedInline" busyNote={<ImportBusy progress={progress} />} onClose={(v) => { if (v === null) onClose(null); }} />;
  }
  if (info) {
    return <LinkForm server header={<SourceHeader path={info.server.label} kind={kind} />} tables={info.server.tables}
      create={(names) => api.links.createServer(kind, info.params, names)} onClose={onClose} />;
  }
  return (
    <form ref={ref} data-testid="server-link-dialog" className="link-dialog" onSubmit={(e) => { e.preventDefault(); if (ok) void connect(); }}>
      <label className="modal-field">
        <span>{t('link.server.host')}</span>
        <input data-testid="srv-host" autoComplete="off" value={f.host} onChange={set('host')}
          placeholder={kind === 'sqlserver' ? t('link.server.hostHint') : undefined} />
      </label>
      <label className="modal-field">
        <span>{t('link.server.port')}</span>
        <input data-testid="srv-port" inputMode="numeric" value={f.port} disabled={instance !== undefined}
          aria-invalid={instance === undefined && port === null} onChange={set('port')} />
      </label>
      <label className="modal-field">
        <span>{t('link.server.database')}</span>
        <input data-testid="srv-database" autoComplete="off" value={f.database} onChange={set('database')} />
      </label>
      <label className="modal-field">
        <span>{t('link.login.user')}</span>
        <input data-testid="srv-user" autoComplete="off" value={f.user} onChange={set('user')} />
      </label>
      <label className="modal-field">
        <span>{t('link.login.password')}</span>
        <input data-testid="srv-password" type="password" autoComplete="off" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} />
      </label>
      <label className="modal-field">
        <span>{t('link.server.tls')}</span>
        <select data-testid="srv-tls" value={f.tls} onChange={set('tls')}>
          {TLS.map(([v, k]) => <option key={v} value={v}>{t(`link.server.${v === 'require' ? KIND[kind].require : k}`)}</option>)}
        </select>
      </label>
      <label className="modal-field">
        <span>{t('link.server.timeout')}</span>
        <input data-testid="srv-timeout" inputMode="numeric" value={f.timeout} aria-invalid={timeout === null} onChange={set('timeout')} />
      </label>
      <div className="modal-field">
        <label>
          <input type="checkbox" data-testid="srv-remember" disabled={!canRemember} checked={!!canRemember && remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('link.login.remember')}
        </label>
        {canRemember === false && <span className="muted" data-testid="srv-no-keyring">{t('link.login.noKeyring')}</span>}
      </div>
      {error && <p className="modal-error" role="alert" data-testid="srv-error">{error}</p>}
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="srv-connect" disabled={busy || !ok}>{t('link.server.connect')}</button>
        <button type="button" className="btn" data-testid="srv-cancel" disabled={busy} onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </form>
  );
}

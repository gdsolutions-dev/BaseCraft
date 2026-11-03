// Feuille de propriétés de la requête et zone Valeurs supérieures, comme dans Access, limitées à ce que le dialecte dit :
// Description, Afficher tous les champs (SELECT *), Valeurs distinctes (DISTINCT), Valeurs supérieures (TOP n [PERCENT]) ;
// pour une analyse croisée, En-têtes des colonnes (PIVOT … IN, B4 R13) seulement.
// Enregistrement unique (DISTINCTROW) et les autres propriétés d'Access n'ont pas d'équivalent : absentes.
// Une requête SQL direct (C6 R10) a la sienne : Description, Connexion, Renvoie des enregistrements, Délai d'attente ODBC.
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayContext } from '../../shared/expr/localize';
import type { PassThroughProps } from '../../shared/query/ast';
import type { QbeDesign, QbeKind } from '../../shared/query/qbe';
import type { ServerKind } from '../../shared/api';
import { ServerLinkDialog, serverTitle } from '../links/ServerLinkDialog';
import { SERVER_PRODUCTS } from '../shell/Modal';
import { MAX_DESCRIPTION } from '../shell/ObjectProperties';
import { serverOptions, type Server } from './pass-through-servers';
import { headingsText, parseHeadings, parseTop, topText } from './qbe-edit';

/** Access's choices in the Top Values box; any other number or percentage can be typed. */
const TOP_CHOICES = ['5', '25', '100', '5%', '25%'];

function TopValuesInput({ id, value, onChange, onCommit, disabled, testId, label }: {
  id?: string; value: string; onChange(v: string): void; onCommit?(): void; disabled?: boolean; testId: string; label: string;
}) {
  const { t } = useTranslation();
  const list = useId();
  return (
    <>
      <input id={id} data-testid={testId} aria-label={label} list={list} spellCheck={false} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit} onKeyDown={(e) => { if (e.key === 'Enter' && onCommit) { e.preventDefault(); onCommit(); } }} />
      <datalist id={list}>{[t('query.props.all'), ...TOP_CHOICES].map((v) => <option key={v} value={v} />)}</datalist>
    </>
  );
}

/** The ribbon's Top Values box: closes with the new value (null: All), or undefined when cancelled. */
export function TopValuesDialog({ top, onClose }: { top: QbeDesign['top']; onClose(v: { top: QbeDesign['top'] | null } | null): void }) {
  const { t } = useTranslation();
  const all = t('query.props.all');
  const [text, setText] = useState(topText(top, all));
  const [error, setError] = useState(false);
  const ok = () => { const v = parseTop(text, all); if (v === undefined) setError(true); else onClose({ top: v }); };
  return (
    <div data-testid="query-top" onKeyDown={(e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); ok(); } }}>
      <label className="modal-field">
        <span>{t('query.props.top')}</span>
        <TopValuesInput testId="query-top-input" label={t('query.props.top')} value={text} onChange={(v) => { setText(v); setError(false); }} />
        {error && <span className="modal-error" role="alert" data-testid="query-top-error">{t('query.props.badTop')}</span>}
      </label>
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="query-top-ok" onClick={ok}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="query-top-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}

export interface QueryProps { description: string; outputAll: boolean; distinct: boolean; top: QbeDesign['top'] | null; headings: string[] }

/** The query's property sheet, on the right of the grid (F4, as in Access): what each kind has, among the properties the dialect
 *  supports. Description, the checks and the Ribbon's changes apply as they are made; Top and the column headings apply when left. */
export function QueryPropertiesPanel({ kind, ctx, description, props, disabled, onDescription, onProps }: {
  kind: QbeKind; ctx: DisplayContext; description: string; props: Omit<QueryProps, 'description'>; disabled: boolean;
  onDescription(v: string): void; onProps(p: Partial<Omit<QueryProps, 'description'>>): void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const all = t('query.props.all');
  const selectLike = kind === 'select' || kind === 'makeTable' || kind === 'append';
  const topKey = JSON.stringify(props.top ?? null);
  const headingsKey = JSON.stringify(props.headings);
  const [top, setTop] = useState(topText(props.top ?? undefined, all));
  const [topError, setTopError] = useState(false);
  const [headings, setHeadings] = useState(() => headingsText(props.headings, ctx));
  const [headingsError, setHeadingsError] = useState(false);
  // a change made elsewhere (the Ribbon's Top Values) shows in the boxes
  useEffect(() => { setTop(topText(props.top ?? undefined, all)); setTopError(false); }, [topKey]);
  useEffect(() => { setHeadings(headingsText(props.headings, ctx)); setHeadingsError(false); }, [headingsKey]);
  const commitTop = () => {
    const v = parseTop(top, all);
    if (v === undefined) return setTopError(true);
    setTopError(false);
    if (JSON.stringify(v) !== topKey) onProps({ top: v });
  };
  const commitHeadings = () => {
    const h = parseHeadings(headings, ctx);
    if (h === undefined) return setHeadingsError(true);
    setHeadingsError(false);
    if (JSON.stringify(h) !== headingsKey) onProps({ headings: h });
  };
  const row = (key: string, label: string, el: JSX.Element) => (
    <div className="prow"><label htmlFor={uid + key}>{label}</label><div className="pval">{el}</div></div>
  );
  return (
    <section className="qd-props" data-testid="query-props" aria-label={t('query.props.title')}>
      <div className="fprops-head">{t('query.props.title')}</div>
      <div className="plist">
        {row('description', t('objectProperties.description'), (
          <textarea id={uid + 'description'} data-testid="query-props-description" rows={3} maxLength={MAX_DESCRIPTION} disabled={disabled}
            value={description} onChange={(e) => onDescription(e.target.value)} />
        ))}
        {(kind === 'select' || kind === 'makeTable') && row('outputAll', t('query.props.outputAll'), (
          <input id={uid + 'outputAll'} type="checkbox" data-testid="query-props-outputAll" disabled={disabled} checked={props.outputAll}
            onChange={(e) => onProps({ outputAll: e.target.checked })} />
        ))}
        {selectLike && row('distinct', t('query.props.distinct'), (
          <input id={uid + 'distinct'} type="checkbox" data-testid="query-props-distinct" disabled={disabled} checked={props.distinct}
            onChange={(e) => onProps({ distinct: e.target.checked })} />
        ))}
        {selectLike && row('top', t('query.props.top'), (
          <>
            <TopValuesInput id={uid + 'top'} testId="query-props-top" label={t('query.props.top')} disabled={disabled} value={top}
              onChange={(v) => { setTop(v); setTopError(false); }} onCommit={commitTop} />
            {topError && <span className="modal-error" role="alert" data-testid="query-props-error">{t('query.props.badTop')}</span>}
          </>
        ))}
        {kind === 'crosstab' && row('headings', t('query.props.columnHeadings'), (
          <>
            <input id={uid + 'headings'} data-testid="query-props-headings" spellCheck={false} disabled={disabled} value={headings}
              onChange={(e) => { setHeadings(e.target.value); setHeadingsError(false); }} onBlur={commitHeadings}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitHeadings(); } }} />
            {headingsError && <span className="modal-error" role="alert" data-testid="query-props-headings-error">{t('query.props.badHeadings')}</span>}
          </>
        ))}
      </div>
    </section>
  );
}

const KINDS: ServerKind[] = ['postgresql', 'sqlserver'];

/** A pass-through as designed: its connection not chosen yet (null) on a new one with no server link. */
export type PassThroughDraft = Omit<PassThroughProps, 'params'> & { params: Record<string, unknown> | null };

/** A pass-through's property sheet (C6 R10): Description; Connexion, the front-end's linked servers or « Autre serveur
 *  PostgreSQL… » / « Autre serveur SQL Server… » (C5 R13: that kind's connection dialog in its pick mode, shown in place: the
 *  modal shows one dialog at a time); Renvoie des enregistrements;
 *  Délai d'attente ODBC, the connection's `timeout` (0: no limit). */
export function PassThroughPropertiesDialog({ initial, servers, retitle, onClose }: {
  initial: { description: string; passThrough: PassThroughDraft }; servers: Server[]; retitle?(titleKey: string | null): void;
  onClose(v: { description: string; passThrough: PassThroughDraft } | null): void;
}) {
  const { t } = useTranslation();
  const pt = initial.passThrough;
  const [description, setDescription] = useState(initial.description);
  const [server, setServer] = useState<Server | null>(pt.params && { kind: pt.kind, params: pt.params });
  const [returnsRecords, setReturnsRecords] = useState(pt.returnsRecords);
  const [timeout, setTimeoutText] = useState(String(pt.params?.timeout ?? 60));
  const [error, setError] = useState(false);
  const [picking, setPicking] = useState<ServerKind | null>(null);
  const { options, selected } = serverOptions(server, servers);
  const ok = () => {
    const n = /^\d+$/.test(timeout) ? Number(timeout) : -1;
    if (n < 0 || n > 3600) return setError(true);
    onClose({ description, passThrough: { kind: server?.kind ?? pt.kind, params: server && { ...server.params, timeout: n }, returnsRecords } });
  };
  /** The server `kind`'s connection dialog closed: its params (the kind it connected to, inspectServer(kind)), else unchanged. */
  const picked = (kind: ServerKind, v: true | Record<string, unknown> | null) => {
    retitle?.(null);
    setPicking(null);
    if (!v || v === true) return;
    setServer({ kind, params: v });
    setTimeoutText(String(v.timeout)); // the timeout typed there, not the sheet's previous one
  };
  if (picking) {
    // Escape goes back to the sheet, not out of it (Modal's handler would close it); prefilled with the current server of
    // that kind only (never another engine's host and port)
    return (
      <div onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); picked(picking, null); } }}>
        <ServerLinkDialog kind={picking} initial={server?.kind === picking ? server.params : undefined} pick onClose={(v) => picked(picking, v)} />
      </div>
    );
  }
  return (
    <div data-testid="pt-props" className="query-props">
      <label className="modal-field">
        <span>{t('objectProperties.description')}</span>
        <textarea data-testid="pt-props-description" rows={3} maxLength={MAX_DESCRIPTION} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="modal-field">
        <span>{t('query.passThrough.connection')}</span>
        <select data-testid="pt-props-connection" value={selected < 0 ? '' : String(selected)} onChange={(e) => {
          const other = KINDS.find((k) => e.target.value === `other:${k}`);
          if (other) { retitle?.(serverTitle(other)); setPicking(other); } else if (e.target.value) { const o = options[Number(e.target.value)]!; setServer({ kind: o.kind, params: o.params }); }
        }}>
          {selected < 0 && <option value="" />}
          {options.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
          {KINDS.map((k) => <option key={k} value={`other:${k}`}>{t('query.passThrough.otherServerKind', { product: SERVER_PRODUCTS.get(k) })}</option>)}
        </select>
      </label>
      <label className="modal-field">
        <span>{t('query.passThrough.returnsRecords')}</span>
        <select data-testid="pt-props-returnsRecords" value={returnsRecords ? 'yes' : 'no'} onChange={(e) => setReturnsRecords(e.target.value === 'yes')}>
          <option value="yes">{t('dialog.button.yes')}</option>
          <option value="no">{t('dialog.button.no')}</option>
        </select>
      </label>
      <label className="modal-field">
        <span>{t('query.passThrough.timeout')}</span>
        <input data-testid="pt-props-timeout" inputMode="numeric" value={timeout} aria-invalid={error} onChange={(e) => { setTimeoutText(e.target.value); setError(false); }} />
        {error && <span className="modal-error" role="alert" data-testid="pt-props-error">{t('query.passThrough.badTimeout')}</span>}
      </label>
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="pt-props-ok" onClick={ok}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="pt-props-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}

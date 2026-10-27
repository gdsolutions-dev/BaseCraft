// Feuille de propriétés de la requête et zone Valeurs supérieures, comme dans Access, limitées à ce que le dialecte dit :
// Description, Afficher tous les champs (SELECT *), Valeurs distinctes (DISTINCT), Valeurs supérieures (TOP n [PERCENT]) ;
// pour une analyse croisée, En-têtes des colonnes (PIVOT … IN, B4 R13) seulement.
// Enregistrement unique (DISTINCTROW) et les autres propriétés d'Access n'ont pas d'équivalent : absentes.
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayContext } from '../../shared/expr/localize';
import type { QbeDesign, QbeKind } from '../../shared/query/qbe';
import { MAX_DESCRIPTION } from '../shell/ObjectProperties';
import { headingsText, parseHeadings, parseTop, topText } from './qbe-edit';

/** Access's choices in the Top Values box; any other number or percentage can be typed. */
const TOP_CHOICES = ['5', '25', '100', '5%', '25%'];

function TopValuesInput({ value, onChange, testId, label }: { value: string; onChange(v: string): void; testId: string; label: string }) {
  const { t } = useTranslation();
  const list = useId();
  return (
    <>
      <input data-testid={testId} aria-label={label} list={list} spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
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

/** The query's property sheet (a dialog): what each kind has in Access, among the properties the dialect supports. */
export function QueryPropertiesDialog({ kind, ctx, initial, onClose }: { kind: QbeKind; ctx: DisplayContext; initial: QueryProps; onClose(v: QueryProps | null): void }) {
  const { t } = useTranslation();
  const all = t('query.props.all');
  const [p, setP] = useState(initial);
  const [top, setTop] = useState(topText(initial.top ?? undefined, all));
  const [error, setError] = useState(false);
  const [headings, setHeadings] = useState(() => headingsText(initial.headings, ctx));
  const [headingsError, setHeadingsError] = useState(false);
  const selectLike = kind === 'select' || kind === 'makeTable' || kind === 'append';
  const ok = () => {
    const v = selectLike ? parseTop(top, all) : null;
    if (v === undefined) return setError(true);
    const h = kind === 'crosstab' ? parseHeadings(headings, ctx) : initial.headings;
    if (h === undefined) return setHeadingsError(true);
    onClose({ ...p, top: v, headings: h });
  };
  const check = (key: 'outputAll' | 'distinct') => (
    <label className="qp-check">
      <input type="checkbox" data-testid={`query-props-${key}`} checked={p[key]} onChange={(e) => setP({ ...p, [key]: e.target.checked })} />
      <span>{t(`query.props.${key}`)}</span>
    </label>
  );
  return (
    <div data-testid="query-props" className="query-props">
      <label className="modal-field">
        <span>{t('objectProperties.description')}</span>
        <textarea data-testid="query-props-description" rows={3} maxLength={MAX_DESCRIPTION} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
      </label>
      {(kind === 'select' || kind === 'makeTable') && check('outputAll')}
      {selectLike && check('distinct')}
      {selectLike && (
        <label className="modal-field">
          <span>{t('query.props.top')}</span>
          <TopValuesInput testId="query-props-top" label={t('query.props.top')} value={top} onChange={(v) => { setTop(v); setError(false); }} />
          {error && <span className="modal-error" role="alert" data-testid="query-props-error">{t('query.props.badTop')}</span>}
        </label>
      )}
      {kind === 'crosstab' && (
        <label className="modal-field">
          <span>{t('query.props.columnHeadings')}</span>
          <input data-testid="query-props-headings" spellCheck={false} value={headings} onChange={(e) => { setHeadings(e.target.value); setHeadingsError(false); }} />
          {headingsError && <span className="modal-error" role="alert" data-testid="query-props-headings-error">{t('query.props.badHeadings')}</span>}
        </label>
      )}
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="query-props-ok" onClick={ok}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="query-props-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}

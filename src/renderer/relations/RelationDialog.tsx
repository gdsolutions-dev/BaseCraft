// Boîtes de la fenêtre Relations : « Modifier des relations » (tables, paires de champs, intégrité, jointure) et « Ajouter des tables ».
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Relation } from '../../shared/api';
import { api } from '../bridge';
import { trapFocus, useErrorDialog } from '../shell/Modal';
import { relationFields } from './relations-layout';

const MAX_PAIRS = 10; // as the IPC validator allows

/** A modal box: Escape cancels, Tab stays inside, focus comes back where it was. Rendered by its owner, not queued by
 *  useModal: A3's query designer opens it over its own dialog (Show Table inside the Row Source's Query Builder). */
export function Frame({ titleKey, testId, onCancel, children, className = 'rel-dialog' }: {
  titleKey: string; testId: string; onCancel(): void; children: ReactNode; className?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus();
    return () => before?.focus?.();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // the shell's shortcuts and the canvas keys stay behind
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); } else trapFocus(e, ref.current);
  };
  return (
    <div className="modal-backdrop">
      <div ref={ref} className={`modal card ${className}`} role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} data-testid={testId}
        onKeyDown={onKeyDown}>
        <h2 id={`${testId}-title`} className="modal-title">{t(titleKey)}</h2>
        {children}
      </div>
    </div>
  );
}

/** A relation being edited: its field pairs as rows, a row possibly half filled. */
export type RelationDraft = Omit<Relation, 'parentFields' | 'childFields'> & { pairs: [string, string][] };

export const draftOf = (r: Relation): RelationDraft => {
  const { parentFields, childFields, ...rest } = r;
  return { ...rest, pairs: parentFields.map((p, i) => [p, childFields[i] ?? '']) };
};

interface Props { tables: string[]; draft: RelationDraft; original: string | null; onCancel(): void; onSaved(r: Relation): void }

/** Edit Relationships, as in Access: an existing relation keeps its tables; a new one chooses them. */
export function RelationDialog({ tables, draft, original, onCancel, onSaved }: Props) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const [d, setD] = useState(draft);
  const [fields, setFields] = useState(new Map<string, string[]>());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false); // OK was pressed: rows filled on one side only show why they are refused
  const set = (p: Partial<RelationDraft>) => { setD((x) => ({ ...x, ...p })); setError(null); };

  useEffect(() => {
    for (const name of [d.parentTable, d.childTable]) {
      if (!name || fields.has(name)) continue;
      api.tables.design(name).then((x) => setFields((f) => new Map(f).set(name, x.fields.map((fd) => fd.name))), (e) => void showError(e));
    }
  }, [d.parentTable, d.childTable]);

  const rows: [string, string][] = d.pairs.length < MAX_PAIRS ? [...d.pairs, ['', '']] : d.pairs;
  const setCell = (i: number, side: 0 | 1, v: string) => {
    const next = rows.map((r) => [...r] as [string, string]);
    next[i][side] = v;
    set({ pairs: next.filter((r) => r[0] || r[1]) });
  };
  const fieldsOf = relationFields(d.pairs);
  const incomplete = 'incomplete' in fieldsOf ? fieldsOf.incomplete : [];
  const ready = !!d.parentTable && !!d.childTable && d.pairs.length > 0;

  const save = async () => {
    if (!ready || busy) return;
    if ('incomplete' in fieldsOf) { setTried(true); return; }
    const { pairs: _pairs, ...rest } = d;
    const rel: Relation = { ...rest, ...fieldsOf, cascadeUpdate: d.enforce && d.cascadeUpdate, cascadeDelete: d.enforce && d.cascadeDelete };
    setBusy(true);
    try {
      const r = await api.relations.save(rel, original);
      if (r.ok) onSaved(r.relation);
      else {
        setError(t(`relations.error.${r.reason}`, {
          parent: d.parentTable, child: d.childTable, table: 'table' in r ? r.table : '', relation: 'relation' in r ? r.relation : '',
          count: 'rows' in r ? r.rows : 0,
        }));
      }
    } catch (e) {
      await showError(e);
    } finally {
      setBusy(false);
    }
  };

  const tableSelect = (side: 'parentTable' | 'childTable', testId: string) => (
    <label className="rel-dialog-table">
      <span>{t(`relations.dialog.${side === 'parentTable' ? 'parent' : 'child'}`)}</span>
      <select data-testid={testId} value={d[side]} disabled={original !== null} onChange={(e) => set({ ...(side === 'parentTable' ? { parentTable: e.target.value } : { childTable: e.target.value }), pairs: [] })}>
        <option value="" />
        {tables.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
  const fieldSelect = (i: number, side: 0 | 1, row: [string, string]) => {
    const table = side === 0 ? d.parentTable : d.childTable;
    return (
      <select data-testid={`relation-${side === 0 ? 'pf' : 'cf'}-${i}`} value={row[side]} disabled={!table}
        aria-label={t('relations.dialog.fieldOf', { n: i + 1, table })} onChange={(e) => setCell(i, side, e.target.value)}>
        <option value="" />
        {(fields.get(table) ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    );
  };
  const check = (key: 'enforce' | 'cascadeUpdate' | 'cascadeDelete', disabled = false) => (
    <label className="rel-dialog-check">
      <input type="checkbox" data-testid={`relation-${key}`} checked={d[key] && !disabled} disabled={disabled} onChange={(e) => set({ [key]: e.target.checked } as Pick<RelationDraft, typeof key>)} />
      {t(`relations.dialog.${key}`)}
    </label>
  );

  return (
    <Frame titleKey="relations.dialog.title" testId="relation-dialog" onCancel={onCancel}>
      <div className="rel-dialog-tables">
        {tableSelect('parentTable', 'relation-parent')}
        {tableSelect('childTable', 'relation-child')}
      </div>
      <div className="rel-dialog-pairs">
        {rows.map((row, i) => (
          <Fragment key={i}>
            <div className="rel-dialog-pair">{fieldSelect(i, 0, row)}{fieldSelect(i, 1, row)}</div>
            {tried && incomplete.includes(i) && (
              <p className="modal-error" role="alert" data-testid={`relation-pair-error-${i}`}>{t('relations.dialog.incomplete')}</p>
            )}
          </Fragment>
        ))}
      </div>
      {check('enforce')}
      <div className="rel-dialog-cascades">
        {check('cascadeUpdate', !d.enforce)}
        {check('cascadeDelete', !d.enforce)}
      </div>
      <fieldset className="rel-dialog-join">
        <legend>{t('relations.dialog.join')}</legend>
        {([1, 2, 3] as const).map((n) => (
          <label key={n}>
            <input type="radio" name="joinType" data-testid={`relation-join-${n}`} checked={d.joinType === n} onChange={() => set({ joinType: n })} />
            {t(`relations.dialog.join${n}`, { parent: d.parentTable, child: d.childTable })}
          </label>
        ))}
      </fieldset>
      {error && <p className="modal-error" role="alert" data-testid="relation-error">{error}</p>}
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="relation-ok" disabled={!ready || busy} onClick={() => void save()}>
          {original === null ? t('relations.dialog.create') : t('dialog.button.ok')}
        </button>
        <button className="btn" data-testid="relation-cancel" onClick={onCancel}>{t('dialog.button.cancel')}</button>
      </div>
    </Frame>
  );
}

/** Add Tables (Access's Show Table): the tables not shown yet, several at once. */
export function AddTablesDialog({ tables, onAdd, onClose }: { tables: string[]; onAdd(names: string[]): void; onClose(): void }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (n: string, on: boolean) => setPicked((p) => (on ? [...p, n] : p.filter((x) => x !== n)));
  return (
    <Frame titleKey="relations.add.title" testId="addtables-dialog" onCancel={onClose}>
      {tables.length ? (
        <div className="rel-add-list">
          {tables.map((n) => (
            <label key={n} className="rel-dialog-check">
              <input type="checkbox" data-testid={`addtables-item-${n}`} checked={picked.includes(n)} onChange={(e) => toggle(n, e.target.checked)} />
              {n}
            </label>
          ))}
        </div>
      ) : <p className="modal-message muted">{t('relations.add.none')}</p>}
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="addtables-add" disabled={!picked.length} onClick={() => onAdd(tables.filter((n) => picked.includes(n)))}>
          {t('relations.add.ok')}
        </button>
        <button className="btn" data-testid="addtables-close" onClick={onClose}>{t('relations.add.close')}</button>
      </div>
    </Frame>
  );
}

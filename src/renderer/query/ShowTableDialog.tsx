// « Afficher la table », comme dans Access : onglets Tables / Requêtes / Les deux, sélection multiple, Ajouter (la boîte reste
// ouverte pour en ajouter d'autres ; un double-clic ajoute un objet), Fermer.
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Frame } from '../relations/RelationDialog';

type Tab = 'tables' | 'queries' | 'both';
const TABS: readonly Tab[] = ['tables', 'queries', 'both'];

export function ShowTableDialog({ tables, queries, onAdd, onClose }: { tables: string[]; queries: string[]; onAdd(names: string[]): void; onClose(): void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('tables');
  const [picked, setPicked] = useState<string[]>([]);
  const names = tab === 'tables' ? tables : tab === 'queries' ? queries : [...tables, ...queries].sort((a, b) => a.localeCompare(b));
  const uid = useId();
  const choose = (x: Tab) => { setTab(x); setPicked([]); };
  /** ARIA tabs: Left/Right (and Home/End) move to a tab and select it. */
  const tabKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next = { ArrowLeft: TABS[(i + 2) % 3], ArrowRight: TABS[(i + 1) % 3], Home: TABS[0], End: TABS[2] }[e.key];
    if (!next) return;
    e.preventDefault();
    choose(next);
    document.getElementById(`${uid}-${next}`)?.focus();
  };
  const toggle = (n: string, on: boolean) => setPicked((p) => (on ? [...p, n] : p.filter((x) => x !== n)));
  const add = (list: string[]) => { if (list.length) onAdd(list); setPicked([]); };
  return (
    <Frame titleKey="query.showTable.title" testId="show-table" onCancel={onClose}>
      <div className="qd-tabs" role="tablist" onKeyDown={tabKey}>
        {TABS.map((x) => (
          <button key={x} id={`${uid}-${x}`} role="tab" aria-selected={tab === x} aria-controls={`${uid}-panel`} tabIndex={tab === x ? 0 : -1}
            className={`qd-tab${tab === x ? ' is-active' : ''}`} data-testid={`show-table-tab-${x}`} onClick={() => choose(x)}>{t(`query.showTable.${x}`)}</button>
        ))}
      </div>
      {names.length ? (
        <div className="rel-add-list" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${tab}`}>
          {names.map((n) => (
            <label key={n} className="rel-dialog-check" onDoubleClick={(e) => { e.preventDefault(); add([n]); }}>
              <input type="checkbox" data-testid={`show-table-${n}`} checked={picked.includes(n)} onChange={(e) => toggle(n, e.target.checked)} />
              {n}
            </label>
          ))}
        </div>
      ) : <p className="modal-message muted" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${tab}`}>{t('query.showTable.none')}</p>}
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="show-table-add" disabled={!picked.length} onClick={() => add(names.filter((n) => picked.includes(n)))}>
          {t('query.showTable.add')}
        </button>
        <button className="btn" data-testid="show-table-close" onClick={onClose}>{t('query.showTable.close')}</button>
      </div>
    </Frame>
  );
}

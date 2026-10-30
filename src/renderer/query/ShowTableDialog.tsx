// « Ajouter des tables », comme dans Access : un volet ancré à droite de la requête (pas une boîte modale), onglets
// Tables / Requêtes / Les deux, recherche, sélection multiple, « Ajouter les tables sélectionnées » (le volet reste ouvert
// pour en ajouter d'autres ; un double-clic ajoute un objet), croix pour le fermer.
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

type Tab = 'tables' | 'queries' | 'both';
const TABS: readonly Tab[] = ['tables', 'queries', 'both'];

export function ShowTableDialog({ tables, queries, onAdd, onClose }: { tables: string[]; queries: string[]; onAdd(names: string[]): void; onClose(): void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('tables');
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const all = tab === 'tables' ? tables : tab === 'queries' ? queries : [...tables, ...queries].sort((a, b) => a.localeCompare(b));
  const names = all.filter((n) => n.toLowerCase().includes(search.trim().toLowerCase()));
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
  const chosen = names.filter((n) => picked.includes(n));
  return (
    <aside className="qd-side" role="complementary" aria-labelledby={`${uid}-title`} data-testid="show-table"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div className="qd-side-head">
        <h2 id={`${uid}-title`}>{t('query.showTable.title')}</h2>
        <button className="iconbtn" data-testid="show-table-close" aria-label={t('query.showTable.close')} title={t('query.showTable.close')} onClick={onClose}>×</button>
      </div>
      <div className="qd-tabs" role="tablist" onKeyDown={tabKey}>
        {TABS.map((x) => (
          <button key={x} id={`${uid}-${x}`} role="tab" aria-selected={tab === x} aria-controls={`${uid}-panel`} tabIndex={tab === x ? 0 : -1}
            className={`qd-tab${tab === x ? ' is-active' : ''}`} data-testid={`show-table-tab-${x}`} onClick={() => choose(x)}>{t(`query.showTable.${x}`)}</button>
        ))}
      </div>
      <input type="search" className="qd-side-search" data-testid="show-table-search" placeholder={t('query.showTable.search')} aria-label={t('query.showTable.search')}
        value={search} onChange={(e) => setSearch(e.target.value)} />
      {names.length ? (
        <div className="qd-side-list" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${tab}`}>
          {names.map((n) => (
            <label key={n} className="rel-dialog-check" onDoubleClick={(e) => { e.preventDefault(); add([n]); }}>
              <input type="checkbox" data-testid={`show-table-${n}`} checked={picked.includes(n)} onChange={(e) => toggle(n, e.target.checked)} />
              {n}
            </label>
          ))}
        </div>
      ) : <p className="modal-message muted qd-side-list" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${tab}`}>{t('query.showTable.none')}</p>}
      <button className="btn" data-testid="show-table-add" disabled={!chosen.length} onClick={() => add(chosen)}>{t('query.showTable.add')}</button>
    </aside>
  );
}

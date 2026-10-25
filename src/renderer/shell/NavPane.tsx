// Volet de navigation : groupes Tables, Requêtes, Formulaires, États, Macros ; recherche, double-clic, menu contextuel tiré du
// registre nav-menu.ts (éléments du socle : nav-menu-items.ts).
import { ChevronRight, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObjectSummary, TableSummary } from '../../shared/api';
import type { AppAction } from '../state/app-state';
import { DOC_ICONS } from './DocumentTabs';
import { useModal } from './Modal';
import { NavMenu } from './NavMenu';
import { runNavItem, setNavClipboardRunner, type NavMenuContext } from './nav-menu';
import './nav-menu-items';
export { nameErrorKey } from './nav-menu-items';

/** Same folding as bc_fold (accents and case ignored). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('und');

type NavKind = 'table' | 'query' | 'form' | 'report' | 'macro';
interface Item { kind: NavKind; name: string; description?: string | null }
const GROUPS: { kind: NavKind; labelKey: string }[] = [
  { kind: 'table', labelKey: 'nav.tables' }, { kind: 'query', labelKey: 'nav.queries' },
  { kind: 'form', labelKey: 'nav.forms' }, { kind: 'report', labelKey: 'nav.reports' }, { kind: 'macro', labelKey: 'nav.macros' },
];
const itemKey = (x: Item) => `${x.kind}:${x.name}`;
/** Tables keep their test id; objects carry their kind (a form may share a table's name). */
const itemTestId = (x: Item) => (x.kind === 'table' ? `nav-item-${x.name}` : `nav-item-${x.kind}-${x.name}`);

interface Props {
  tables: TableSummary[]; objects: ObjectSummary[]; readOnly: boolean; active: { kind: string; name: string } | null;
  visible: boolean; onToggle(): void; dispatch: Dispatch<AppAction>;
  /** The selected item (the source picker preselects it when no table or query document is active). */
  onSelect?(item: { kind: string; name: string } | null): void;
}

export function NavPane({ tables, objects, readOnly, active, visible, onToggle, dispatch, onSelect }: Props) {
  const { t } = useTranslation();
  const modal = useModal();
  const [query, setQuery] = useState('');
  const [selected, setSelectedKey] = useState<string | null>(null);
  const setSelected = (x: Item) => { setSelectedKey(itemKey(x)); onSelect?.({ kind: x.kind, name: x.name }); };
  const [menu, setMenu] = useState<{ item: Item; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const q = fold(query.trim());
  const items: Item[] = [
    ...tables.map((x) => ({ ...x, kind: 'table' as const })),
    ...objects.flatMap((o) => (o.kind === 'query' || o.kind === 'form' || o.kind === 'report' || o.kind === 'macro' ? [{ ...o, kind: o.kind }] : [])), // modules: stage D
  ];
  const shown = items.filter((x) => fold(x.name).includes(q));

  /** The menu's context for `x`: `reselect` makes the selection follow a renamed object or leave a deleted one. */
  const ctxOf = (x: Item): NavMenuContext => ({
    kind: x.kind, name: x.name, readOnly, runtime: false, modal, dispatch,
    reselect: (to) => {
      if (selected !== itemKey(x)) return;
      if (to === null) { setSelectedKey(null); onSelect?.(null); } else setSelected({ kind: x.kind, name: to });
    },
  });
  // Home › Clipboard while the pane has the focus acts on the selected item, like Ctrl+X / C / V on it
  const runner = useRef<(id: 'cut' | 'copy' | 'paste') => boolean>(() => false);
  runner.current = (id) => { const x = items.find((i) => itemKey(i) === selected); return !!x && runNavItem(ctxOf(x), id); };
  useEffect(() => setNavClipboardRunner((id) => runner.current(id)), []);

  if (!visible) {
    return (
      <aside className="nav-rail" aria-label={t('nav.title')}>
        <button className="iconbtn" data-testid="nav-show" title={t('nav.show')} aria-label={t('nav.show')} onClick={onToggle}>
          <PanelLeftOpen className="ic" aria-hidden />
        </button>
        <span>{t('nav.title')}</span>
      </aside>
    );
  }

  /** A table runs as a datasheet; a query, form or report in its Run view; a macro is run (its menu's Run). */
  const open = (x: Item) => x.kind === 'macro' ? runNavItem(ctxOf(x), 'open') : dispatch({ type: 'open', kind: x.kind, name: x.name, mode: x.kind === 'table' ? 'datasheet' : 'run' });

  return (
    <aside className="nav" data-testid="nav-pane" aria-label={t('nav.title')}>
      <div className="nav-head">
        <span className="nav-filter">{t('nav.allObjects')}</span>
        <button className="iconbtn" data-testid="nav-hide" title={t('nav.hide')} aria-label={t('nav.hide')} onClick={onToggle}>
          <PanelLeftClose className="ic" aria-hidden />
        </button>
      </div>
      <label className="search">
        <Search className="ic" aria-hidden />
        <input data-testid="nav-search" type="search" placeholder={t('nav.search')} aria-label={t('nav.search')}
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="nav-list">
        {GROUPS.map((g) => {
          const Icon = DOC_ICONS[g.kind];
          const list = shown.filter((x) => x.kind === g.kind);
          return (
            <details key={g.kind} className="ngroup" open data-testid={`nav-group-${g.kind}`}>
              <summary>
                <ChevronRight className="ic ic-sm chev" aria-hidden />{t(g.labelKey)}
                <span className="count" data-testid={`nav-count-${g.kind}`}>{list.length}</span>
              </summary>
              {list.map((x) => (
                <button key={x.name} data-testid={itemTestId(x)} title={x.description || x.name}
                  className={`nitem${active?.kind === x.kind && active.name === x.name ? ' is-active' : ''}${itemKey(x) === selected ? ' is-selected' : ''}`}
                  onClick={() => setSelected(x)}
                  onDoubleClick={() => open(x)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); open(x); return; }
                    const id = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey ? ({ x: 'cut', c: 'copy', v: 'paste' } as const)[e.key.toLowerCase() as 'x'] : undefined;
                    if (id) { e.preventDefault(); setSelected(x); runNavItem(ctxOf(x), id); }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.currentTarget.focus(); // the menu gives the focus back to the item when it closes
                    setSelected(x);
                    const r = e.currentTarget.getBoundingClientRect(); // keyboard (Shift+F10) gives 0,0
                    setMenu({ item: x, x: e.clientX || r.left + 24, y: e.clientY || r.bottom });
                  }}>
                  <Icon className="ic" aria-hidden /><span>{x.name}</span>
                </button>
              ))}
            </details>
          );
        })}
        {q && shown.length === 0 && <p className="nav-empty muted">{t('nav.noMatch')}</p>}
      </div>
      {menu && (
        <NavMenu x={menu.x} y={menu.y} onClose={closeMenu} ctx={ctxOf(menu.item)} />
      )}
    </aside>
  );
}

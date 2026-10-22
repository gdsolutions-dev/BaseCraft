// Volet de navigation : groupe Tables, recherche, double-clic, menu contextuel (Ouvrir, Mode Création, Renommer, Supprimer).
import { ChevronRight, PanelLeftClose, PanelLeftOpen, Search, Table } from 'lucide-react';
import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TableSummary } from '../../shared/api';
import { isReservedName, isValidObjectName } from '../../shared/field-types';
import { api } from '../bridge';
import type { AppAction, DocMode } from '../state/app-state';
import { useErrorDialog, useModal } from './Modal';

/** Same folding as bc_fold (accents and case ignored). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('und');

export const nameErrorKey = (v: string): string | null =>
  v.trim() === '' ? 'designError.nameEmpty' : !isValidObjectName(v) ? 'designError.nameInvalid' : isReservedName(v) ? 'designError.reservedName' : null;

interface Props {
  tables: TableSummary[]; readOnly: boolean; activeName: string | null;
  visible: boolean; onToggle(): void; dispatch: Dispatch<AppAction>;
}

export function NavPane({ tables, readOnly, activeName, visible, onToggle, dispatch }: Props) {
  const { t } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

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

  const open = (name: string, mode: DocMode) => dispatch({ type: 'open', kind: 'table', name, mode });

  const rename = async (name: string) => {
    const to = await modal.prompt({
      titleKey: 'nav.renameTitle', labelKey: 'nav.renameLabel', initial: name,
      validate: (v) => { const k = nameErrorKey(v); return k && t(k); },
    });
    if (to === null || to === name) return;
    try {
      const r = await api.tables.rename(name, to);
      if (r.ok) dispatch({ type: 'tableRenamed', from: name, to });
      else await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, params: { name: 'table' in r ? r.table : 'view' in r ? r.view : name }, buttons: ['ok'] });
    } catch (e) { await showError(e); }
  };

  const remove = async (name: string) => {
    const ok = await modal.confirm({ titleKey: 'nav.deleteTitle', messageKey: 'nav.deleteMessage', params: { name }, buttons: ['yes', 'no'], defaultButton: 'no' });
    if (ok !== 'yes') return;
    try {
      const r = await api.tables.drop(name);
      if (r.ok) dispatch({ type: 'tableDropped', name });
      else await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, params: { name: 'table' in r ? r.table : 'view' in r ? r.view : name }, buttons: ['ok'] });
    } catch (e) { await showError(e); }
  };

  const q = fold(query.trim());
  const shown = tables.filter((x) => fold(x.name).includes(q));

  const menuKeys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  const menuItem = (id: string, label: string, run: () => void, disabled = false) => (
    <button role="menuitem" data-testid={`nav-menu-${id}`} disabled={disabled} onClick={() => { setMenu(null); run(); }}>{label}</button>
  );

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
        <details className="ngroup" open>
          <summary><ChevronRight className="ic ic-sm chev" aria-hidden />{t('nav.tables')}<span className="count">{shown.length}</span></summary>
          {shown.map((x) => (
            <button key={x.name} data-testid={`nav-item-${x.name}`} title={x.description || x.name}
              className={`nitem${x.name === activeName ? ' is-active' : ''}${x.name === selected ? ' is-selected' : ''}`}
              onClick={() => setSelected(x.name)}
              onDoubleClick={() => open(x.name, 'datasheet')}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); open(x.name, 'datasheet'); } }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelected(x.name);
                const r = e.currentTarget.getBoundingClientRect(); // keyboard (Shift+F10) gives 0,0
                setMenu({ name: x.name, x: e.clientX || r.left + 24, y: e.clientY || r.bottom });
              }}>
              <Table className="ic" aria-hidden /><span>{x.name}</span>
            </button>
          ))}
          {q && shown.length === 0 && <p className="nav-empty muted">{t('nav.noMatch')}</p>}
        </details>
      </div>
      {menu && (
        <div ref={menuRef} className="ctxmenu card" role="menu" data-testid="nav-menu" style={{ left: menu.x, top: menu.y }} onKeyDown={menuKeys}>
          {menuItem('open', t('nav.menu.open'), () => open(menu.name, 'datasheet'))}
          {menuItem('design', t('nav.menu.design'), () => open(menu.name, 'design'))}
          <div className="ctxmenu-sep" role="separator" />
          {menuItem('rename', t('nav.menu.rename'), () => void rename(menu.name), readOnly)}
          {menuItem('delete', t('nav.menu.delete'), () => void remove(menu.name), readOnly)}
        </div>
      )}
    </aside>
  );
}

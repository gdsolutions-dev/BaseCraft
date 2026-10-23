// Éditeur de cellule Glide d'un champ Liste de choix : une zone de saisie et, dessous, la liste filtrée par ce qui est tapé ;
// l'option qui commence par le texte tapé est mise en évidence (saisie semi-automatique d'Access). Les flèches choisissent ;
// Entrée, Tab et Échap restent ceux de Glide : chaque changement est déjà transmis, Entrée enregistre donc le choix affiché.
// Comme dans Access : colonnes visibles et leurs largeurs, ligne d'en-têtes, Lignes affichées, Largeur liste, et pour une
// liste de valeurs modifiable, « Modifier les éléments de la liste… ».
import type { ProvideEditorCallbackResult, ProvideEditorComponent, TextCell } from '@glideapps/glide-data-grid';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlValue } from '../../shared/coerce';
import { LIST_ROWS } from '../../shared/field-types';
import { listOptions, prefixMatch, visibleOptions, type ComboOption } from '../shell/combobox-model';
import type { LookupCell, LookupList } from './datasheet-cells';
export { hasLookupEditor } from './datasheet-cells';
import { takeFirstChar } from './glide-keyboard';

export const px = (twips: number): string => `${twips / 15}px`; // 1440 twips = 1 in = 96 px

/** A list row's visible columns at their widths (twips), the last one also taking what is left (datasheet and form lists). */
export function lookupColumns(texts: string[], widths: number[], className: string) {
  return texts.map((x, i) => (
    <span key={i} className={className} style={{ flex: `${i === texts.length - 1 ? 1 : 0} 0 ${px(widths[i] ?? 1440)}` }}>{x}</span>
  ));
}

export interface LookupEditorOptions {
  /** The field's name, given to the list. */
  label: string
  /** The edit text of a list value: what the cell gives the write layer. */
  edit(v: SqlValue): string
  /** List Rows: the rows shown before the list scrolls (Access's 16 by default); List Width in twips (undefined: Auto, the cell's width). */
  listRows?: number; listWidth?: number
  /** Allow Value List Edits: opens « Edit List Items » (disabled on a read-only base). */
  editList?: { open(): void; disabled(): boolean }
}

/** Glide's editor for a Lookup field (one component per list: Glide keeps it while the cell is edited). */
export function lookupEditor(list: LookupList, o: LookupEditorOptions): ProvideEditorCallbackResult<TextCell> {
  // Filtering and AutoExpand use the text shown: the first visible column, as in Access.
  const options = listOptions(list);
  const columns = (texts: string[]) => lookupColumns(texts, list.widths, 'ds-lookup-col');

  const LookupEditor: ProvideEditorComponent<TextCell> = ({ value, onChange, onFinishedEditing, initialValue }) => {
    const { t } = useTranslation();
    const id = useId();
    // Opened by typing: the typed key (openEditorWith's stand-in for a non-ASCII one) filters the list. Opened otherwise:
    // every option, the stored value's chosen, nothing changed until a key.
    const [s, setS] = useState(() => {
      if (initialValue === undefined) {
        const bound = (value as Partial<LookupCell>).bound;
        return { filter: null as string | null, text: value.data, active: bound == null ? -1 : list.rows.findIndex((r) => r.value === bound) };
      }
      const text = takeFirstChar() ?? initialValue;
      return { filter: text as string | null, text, active: prefixMatch(visibleOptions(options, text), text) };
    });
    const shown = visibleOptions(options, s.filter);
    const valueOf = (st: typeof s): string => {
      const x = visibleOptions(options, st.filter)[st.active];
      return x ? o.edit(list.rows[Number(x.id)]!.value) : st.text;
    };
    const update = (next: typeof s) => { setS(next); onChange({ ...value, data: valueOf(next) }); };
    useEffect(() => { if (initialValue !== undefined) onChange({ ...value, data: valueOf(s) }); }, []); // the typed key is the entry
    const optId = (x: ComboOption) => `${id}-opt-${x.id}`;
    const editList = o.editList && !o.editList.disabled() ? () => { onFinishedEditing(undefined); o.editList!.open(); } : undefined;
    const active = shown[s.active];
    useEffect(() => { if (active) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' }); }, [active]);

    return (
      <div className="ds-lookup" style={o.listWidth === undefined ? undefined : { width: px(o.listWidth) }}>
        <input autoFocus className="ds-mask-input" data-testid="lookup-editor" spellCheck={false} autoComplete="off" value={s.text} aria-label={o.label}
          role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={active ? optId(active) : undefined}
          onChange={(e) => { const text = e.target.value; update({ filter: text, text, active: prefixMatch(visibleOptions(options, text), text) }); }}
          aria-keyshortcuts={editList ? 'F2' : undefined}
          onKeyDown={(e) => {
            if (e.key === 'F2' && editList) { e.preventDefault(); e.stopPropagation(); return editList(); } // Edit List Items
            if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !shown.length) return;
            e.preventDefault();
            e.stopPropagation(); // the grid's own arrows stay behind
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            const next = s.active < 0 ? (delta > 0 ? 0 : shown.length - 1) : (s.active + delta + shown.length) % shown.length;
            update({ ...s, active: next, text: shown[next]!.label });
          }} />
        <div className="ds-lookup-scroll" tabIndex={0}>
          {list.heads && <div className="ds-lookup-row ds-lookup-heads" data-testid="lookup-heads" aria-hidden="true">{columns(list.heads)}</div>}
          <ul id={`${id}-list`} role="listbox" aria-label={o.label} className="ds-lookup-list" data-testid="lookup-list" onMouseDown={(e) => e.preventDefault()}
            style={{ maxHeight: `calc(${o.listRows ?? LIST_ROWS} * var(--ds-lookup-row))` }}>
            {shown.map((x, i) => {
              const r = list.rows[Number(x.id)]!;
              return (
                <li key={x.id} id={optId(x)} role="option" aria-selected={i === s.active} aria-label={r.display.join(' ')} data-testid={`lookup-option-${x.id}`}
                  className={`cbx-opt ds-lookup-row${i === s.active ? ' is-active' : ''}`}
                  onClick={() => onFinishedEditing({ ...value, data: o.edit(r.value) }, [0, 0])}>{columns(r.display)}</li>
              );
            })}
          </ul>
        </div>
        {o.editList && (
          // Enter and Space handled here: Glide's own Enter would close the editor first.
          <button type="button" className="btn ds-lookup-edit" data-testid="lookup-edit-list" disabled={!editList} onMouseDown={(e) => e.preventDefault()}
            title={t('fieldProp.editList.shortcut')} aria-keyshortcuts="F2" onClick={editList}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && editList) { e.preventDefault(); e.stopPropagation(); editList(); } }}>
            {t('fieldProp.editList.action')}
          </button>
        )}
      </div>
    );
  };
  return { editor: LookupEditor };
}

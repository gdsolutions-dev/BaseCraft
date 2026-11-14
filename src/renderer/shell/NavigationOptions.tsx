// Navigation Options dialog (Access: Options de navigation): which groups each category shows, the display options, how an object opens.
// The category and group edit buttons work on custom categories (built-ins and their computed groups are read-only); the system-objects option waits for later.
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NavOptions } from '../../shared/nav-view';
import type { ModalApi } from './Modal';
import { toggleGroup, nameTaken, addCategory, renameCategory, deleteCategory, moveCategory, addGroup, renameGroup, deleteGroup } from './navigation-options-model';

export interface NavCategory { id: string; label: string; groups: { id: string; label: string }[] }

/** Resolves with the edited options on OK, null on cancel. */
export function showNavigationOptions(modal: ModalApi, opts: NavOptions, categories: NavCategory[]): Promise<NavOptions | null> {
  return modal.custom<NavOptions>((close) => <Form opts={opts} categories={categories} onClose={close} />, { titleKey: 'nav.options.title' });
}

const plain = (s: string) => s.replace(/&(?=\S)/g, ''); // the dialog shows no mnemonics: for translated strings only, never for a category or group name

interface Ask { titleKey: string; initial: string; taken: string[]; ok(name: string): void }

function Form({ opts, categories, onClose }: { opts: NavOptions; categories: NavCategory[]; onClose(v: NavOptions | null): void }) {
  const { t } = useTranslation();
  const [o, setO] = useState(opts);
  const [sel, setSel] = useState(categories.find((c) => c.id === opts.category)?.id ?? categories[0]?.id ?? 'type');
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null); // the name prompt, inline: a modal prompt would queue behind this dialog
  const [name, setName] = useState('');
  const customIds = new Set(opts.categories.map((c) => c.id));
  const list = [...categories.filter((c) => !customIds.has(c.id)),
    ...o.categories.map((c) => ({ id: c.id, label: c.name || t('nav.category.custom'), groups: c.groups.map((g) => ({ id: g.id, label: g.name || t(`nav.group.${g.id}`) })) }))];
  const cat = list.find((c) => c.id === sel);
  const custom = o.categories.find((c) => c.id === sel);
  const group = custom?.groups.find((g) => g.id === selGroup);
  const hidden = o.hiddenGroups[sel] ?? [];
  const later = t('ribbon.planned.later');
  const open = (a: Ask) => { setName(a.initial); setAsk(a); };
  const btn = (id: string, key: string, on: boolean, run: () => void) => <button className="btn" data-testid={`nav-options-${id}`} disabled={!on} title={on ? undefined : later} onClick={run}>{plain(t(`nav.options.${key}`))}</button>;
  const pick = (id: string) => { setSel(id); setSelGroup(null); };
  const dup = ask && nameTaken(ask.taken, name) ? t('nav.options.duplicate') : null;
  const check = (id: string, label: string, on: boolean, set: (v: boolean) => void, extra: { disabled?: boolean; title?: string } = {}) => (
    <label className="modal-field"><input type="checkbox" data-testid={`nav-options-${id}`} checked={on} onChange={(e) => set(e.target.checked)} {...extra} /><span>{label}</span></label>
  );
  return (
    <div className="navopt" data-testid="nav-options">
      <fieldset className="navopt-frame">
        <legend>{t('nav.options.grouping')}</legend>
        <p className="navopt-hint">{t('nav.options.hint')}</p>
        <div className="navopt-cols">
          <div className="navopt-col">
            <span>{plain(t('nav.options.categories'))}</span>
            <ul role="listbox" className="navopt-list" data-testid="nav-options-categories">
              {list.map((c) => (
                <li key={c.id} role="option" aria-selected={c.id === sel} data-testid={`nav-options-cat-${c.id}`} onClick={() => pick(c.id)}>{c.label}</li>
              ))}
            </ul>
            <div className="navopt-btns">
            <button className="btn" data-testid="nav-options-move-up" aria-label={t('nav.options.moveUp')} disabled={!custom || o.categories[0]?.id === sel} onClick={() => setO(moveCategory(o, sel, -1))}><ArrowUp size={14} /></button>
            <button className="btn" data-testid="nav-options-move-down" aria-label={t('nav.options.moveDown')} disabled={!custom || o.categories.at(-1)?.id === sel} onClick={() => setO(moveCategory(o, sel, 1))}><ArrowDown size={14} /></button>
            {btn('add-category', 'addItem', true, () => open({ titleKey: 'nav.options.addCategoryTitle', initial: '', taken: o.categories.map((c) => c.name), ok: (n) => { const id = crypto.randomUUID(); setO(addCategory(o, id, n)); pick(id); } }))}
            {btn('delete-category', 'deleteItem', !!custom, () => { setO(deleteCategory(o, sel)); pick('type'); })}
            {btn('rename-category', 'renameItem', !!custom, () => open({ titleKey: 'nav.options.renameCategoryTitle', initial: custom!.name || cat!.label, taken: o.categories.filter((c) => c.id !== sel).map((c) => c.name), ok: (n) => setO(renameCategory(o, sel, n)) }))}
            </div>
          </div>
          <div className="navopt-col">
            {/* the placeholder goes through t() (the sentence is translated), then a replacer function swaps in the name: a name with $& or $1 stays literal */}
            <span>{plain(t('nav.options.groupsFor', { name: '{{NAME}}' })).replace('{{NAME}}', () => cat?.label ?? '')}</span>
            <ul className="navopt-list" data-testid="nav-options-groups">
              {(cat?.groups ?? []).map((g) => (
                <li key={g.id} aria-selected={g.id === selGroup} onClick={() => setSelGroup(g.id)}>{check(`group-${g.id}`, g.label, !hidden.includes(g.id), () => setO(toggleGroup(o, sel, g.id, cat!.groups.map((x) => x.id))))}</li>
              ))}
            </ul>
            <div className="navopt-btns">
            {btn('add-group', 'addGroup', !!custom, () => open({ titleKey: 'nav.options.addGroupTitle', initial: '', taken: custom!.groups.map((g) => g.name), ok: (n) => setO(addGroup(o, sel, crypto.randomUUID(), n)) }))}
            {btn('delete-group', 'deleteGroup', !!group, () => { setO(deleteGroup(o, sel, selGroup!)); setSelGroup(null); })}
            {btn('rename-group', 'renameGroup', !!group, () => open({ titleKey: 'nav.options.renameGroupTitle', initial: group!.name || t(`nav.group.${group!.id}`), taken: custom!.groups.filter((g) => g.id !== selGroup).map((g) => g.name), ok: (n) => setO(renameGroup(o, sel, selGroup!, n)) }))}
            </div>
            {ask && (
              <form data-testid="nav-options-ask" className="modal-field" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !dup) { ask.ok(name); setAsk(null); } }}>
                <span>{t(ask.titleKey)}</span>
                <input data-testid="nav-options-ask-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!dup} />
                {dup && <span role="alert" data-testid="nav-options-ask-error">{dup}</span>}
                <button type="submit" className="btn btn-primary" data-testid="nav-options-ask-ok" disabled={!name.trim() || !!dup}>{t('dialog.button.ok')}</button>
                <button type="button" className="btn" data-testid="nav-options-ask-cancel" onClick={() => setAsk(null)}>{t('dialog.button.cancel')}</button>
              </form>
            )}
          </div>
        </div>
      </fieldset>
      <div className="navopt-row">
      <fieldset className="navopt-frame">
        <legend>{t('nav.options.display')}</legend>
        {check('show-hidden', plain(t('nav.options.showHidden')), o.showHidden, (v) => setO({ ...o, showHidden: v }))}
        {check('show-system', plain(t('nav.options.showSystem')), false, () => undefined, { disabled: true, title: later })}
        {check('search-bar', plain(t('nav.options.searchBar')), o.searchBar, (v) => setO({ ...o, searchBar: v }))}
      </fieldset>
      <fieldset className="navopt-frame navopt-open">
        <legend>{t('nav.options.openWith')}</legend>
        {([true, false] as const).map((single) => (
          <label key={String(single)} className="modal-field">
            <input type="radio" name="nav-options-open" data-testid={`nav-options-${single ? 'single' : 'double'}`} checked={o.singleClick === single} onChange={() => setO({ ...o, singleClick: single })} />
            <span>{plain(t(single ? 'nav.options.single' : 'nav.options.double'))}</span>
          </label>
        ))}
      </fieldset>
      </div>
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="nav-options-ok" onClick={() => onClose(o)}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="nav-options-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}

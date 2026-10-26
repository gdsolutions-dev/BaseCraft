// Zone de liste déroulante (motif combobox ARIA) : une zone de texte qui montre le texte de la valeur dans la liste (sinon la
// valeur telle quelle) et une liste des colonnes visibles à leurs largeurs. ↓, Alt+↓, F4 ou le bouton l'ouvrent ; la frappe
// filtre (texte contenu, accents et casse ignorés) et complète avec la première ligne qui commence par le texte (AutoExpand
// d'Access) ; Entrée choisit, Échap ferme puis annule. Le texte hors de la liste est vérifié en quittant (Limiter à liste).
import { ChevronDown } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { lookupColumns } from '../../datasheet/LookupEditor';
import { CLOSED, comboKey, placeList, prefixMatch, typed, visibleOptions, type ComboOption, type ComboState } from '../../shell/combobox-model';
import { controlEnabled } from '../run-model';
import { LIST_MAX, rowOfText } from '../row-source';
import { ctlAttrs, fieldOf, listChoose, listCurrent, NO_LIST, type CtlProps } from './run-ctx';

/** A list row: its visible columns at their widths, the last one taking what is left (as the datasheet's list). */
export const columns = (texts: string[], widths: number[]) => lookupColumns(texts, widths, 'frun-list-col');

export function ComboBoxCtl({ c, x, style }: CtlProps) {
  const list = x.lists[c.name] ?? NO_LIST;
  const { options } = list;
  const b = fieldOf(c, x);
  const { disabled, readOnly } = controlEnabled(c, x.snap, b?.f ?? null);
  const locked = disabled || readOnly;
  const { row, text } = listCurrent(c, x);
  const [s, setS] = useState<ComboState>(CLOSED);
  const [pos, setPos] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const down = useRef<boolean | null>(null);
  const tail = useRef<number | null>(null);   // AutoExpand: the length typed, the rest of the completed text selected
  const shown = visibleOptions(options, s.filter);
  const open = s.open && !locked && (shown.length > 0 || list.truncated);
  const id = x.id(c.name);
  const listId = `${id}-list`;
  const optId = (o: ComboOption) => `${id}-opt-${o.id}`;
  const active = open ? shown[s.active] : undefined;
  const ev = x.events(c);

  useLayoutEffect(() => {
    const el = input.current;
    if (tail.current !== null && el && document.activeElement === el) el.setSelectionRange(tail.current, el.value.length);
    tail.current = null;
  });
  // the list follows the control (window resized, form scrolled); placed in <body>, a scrolling form never cuts it
  useLayoutEffect(() => {
    if (!open) { down.current = null; return; }
    const place = () => {
      if (!box.current || !popup.current) return;
      const p = placeList(box.current.getBoundingClientRect(), innerHeight, popup.current.scrollHeight, down.current);
      down.current = p.down;
      setPos(p.style);
    };
    place();
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    return () => { removeEventListener('scroll', place, true); removeEventListener('resize', place); };
  }, [open, shown.length]);
  useLayoutEffect(() => { if (active) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' }); });

  const pick = (o: ComboOption) => x.update(c, () => listChoose(c, x, Number(o.id), o.label));
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (locked) return;
    const t = e.target.value;
    const deleting = ((e.nativeEvent as InputEvent).inputType ?? '').startsWith('delete');
    const narrowed = visibleOptions(options, t);
    const k = deleting ? -1 : prefixMatch(narrowed, t);
    setS({ ...typed(options, t), active: k });
    tail.current = k >= 0 ? t.length : null;
    listChoose(c, x, k >= 0 ? Number(narrowed[k].id) : rowOfText(list.data, t), t);
    x.input(c);
  };
  const toggle = () => setS(open ? CLOSED : { open: true, filter: null, active: row });
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!locked && e.key === 'F4' && !e.altKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); toggle(); return; }
    const r = locked ? { state: CLOSED, handled: false } : comboKey(s, e.key, e.altKey, options, text);
    setS(r.state);
    if (r.handled) {
      e.preventDefault();
      e.stopPropagation();
      if (r.pick) pick(r.pick);
      else if (s.open && r.state.open && r.state.active !== s.active) {   // the arrows in the open list choose as they go (Access)
        const o = visibleOptions(options, r.state.filter)[r.state.active];
        if (o) { listChoose(c, x, Number(o.id), o.label); x.input(c); }   // its update events when it is left, as a typed text
      }
      return;
    }
    ev.onKeyDown(e);   // Escape on the closed list (undo), Tab, Page Down…
  };

  return (
    <div ref={box} className="frun-combo" style={style}>
      <input ref={input} {...ctlAttrs(c, x)} className="frun-text" value={text} disabled={disabled} readOnly={readOnly}
        spellCheck={false} autoComplete="off" role="combobox" aria-autocomplete="both" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={active ? optId(active) : undefined}
        onChange={onChange} onKeyDown={onKeyDown} onBlur={(e) => { setS(CLOSED); ev.onBlur(e); }} />
      <button type="button" className="frun-combo-toggle" tabIndex={-1} disabled={locked} data-testid={`form-ctl-${c.name}-toggle`}
        aria-label={x.t('app.showList')} aria-expanded={open} aria-controls={listId}
        onMouseDown={(e) => e.preventDefault()} onClick={() => { input.current?.focus({ preventScroll: true }); toggle(); }}>
        <ChevronDown className="ic-sm" aria-hidden />
      </button>
      {open && createPortal(
        <div ref={popup} className="cbx-list frun-combo-list" style={pos} onMouseDown={(e) => e.preventDefault()}>
          {list.data.heads && <div className="frun-list-row frun-list-heads" aria-hidden="true" data-testid={`form-list-heads-${c.name}`}>{columns(list.data.heads, list.data.widths)}</div>}
          <ul id={listId} role="listbox" aria-label={c.name} data-testid={`form-list-${c.name}`}>
            {shown.map((o, i) => {
              const r = list.data.rows[Number(o.id)];
              return (
                <li key={o.id} id={optId(o)} role="option" aria-selected={i === s.active} aria-label={r.display.join(' ')} data-testid={`form-option-${c.name}-${o.id}`}
                  className={`cbx-opt frun-list-row${i === s.active ? ' is-active' : ''}${Number(o.id) === row ? ' is-current' : ''}`}
                  onMouseMove={() => { if (i !== s.active) setS({ ...s, active: i }); }} onClick={() => { setS(CLOSED); pick(o); }}>
                  {columns(r.display, list.data.widths)}
                </li>
              );
            })}
          </ul>
          {list.truncated && <div className="frun-list-note" data-testid={`form-list-truncated-${c.name}`}>{x.t('form.list.truncated', { count: LIST_MAX })}</div>}
        </div>, document.body)}
    </div>
  );
}

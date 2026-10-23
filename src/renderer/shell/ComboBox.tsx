// Liste modifiable aux couleurs de l'application : remplace <datalist>, dont la liste native suit le thème de Windows.
// Texte libre permis ; la liste est posée en position fixe dans <body> (un panneau qui défile ne la coupe pas).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { CLOSED, comboKey, placeList, typed, visibleOptions, type ComboOption, type ComboState } from './combobox-model';

/** onChange gets the text as typed, or the label of the option picked. label: the field's name, given to the list.
 *  describedBy: the id of the field's message (an error with role="alert"). */
export function ComboBox({ id, testId, label, value, options, disabled, onChange, describedBy }: {
  id: string; testId: string; label: string; value: string; options: ComboOption[]; disabled?: boolean; onChange(text: string): void; describedBy?: string
}) {
  const { t } = useTranslation();
  const [s, setS] = useState<ComboState>(CLOSED);
  const [pos, setPos] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const down = useRef<boolean | null>(null); // the side the open list was given
  const shown = visibleOptions(options, s.filter);
  const open = s.open && shown.length > 0 && !disabled;
  const listId = `${id}-list`;
  const optId = (o: ComboOption) => `${id}-opt-${o.id}`;
  const active = open ? shown[s.active] : undefined;

  // The list follows its field when the window or what holds the field changes. Once a scroll hides the field, the list
  // closes, as a native one does (else it would float away). Other scrolls (the list's, the field's own text) leave it.
  useLayoutEffect(() => {
    if (!open) { down.current = null; return; }
    const place = () => {
      const p = placeList(box.current!.getBoundingClientRect(), innerHeight, list.current!.scrollHeight, down.current);
      down.current = p.down;
      setPos(p.style);
    };
    place();
    const onScroll = ({ target }: Event) => {
      const area = target === document ? { top: 0, bottom: innerHeight, left: 0, right: innerWidth }
        : target instanceof Element && target.contains(box.current) ? target.getBoundingClientRect() : null;
      if (!area) return;
      const r = box.current!.getBoundingClientRect();
      if (r.bottom <= area.top || r.top >= area.bottom || r.right <= area.left || r.left >= area.right) setS(CLOSED);
      else place();
    };
    addEventListener('scroll', onScroll, true);
    addEventListener('resize', place);
    return () => { removeEventListener('scroll', onScroll, true); removeEventListener('resize', place); };
  }, [open, shown.length]);
  useEffect(() => { if (active) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' }); });

  if (!options.length) {
    return <input id={id} data-testid={testId} disabled={disabled} spellCheck={false} autoComplete="off" value={value} aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)} />;
  }
  const pick = (o: ComboOption) => { setS(CLOSED); onChange(o.label); };
  return (
    <div ref={box} className="cbx">
      <input ref={input} id={id} data-testid={testId} disabled={disabled} spellCheck={false} autoComplete="off" value={value} aria-describedby={describedBy}
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={active ? optId(active) : undefined}
        onChange={(e) => { onChange(e.target.value); setS(typed(options, e.target.value)); }}
        onBlur={() => setS(CLOSED)} // click outside, Tab, another window
        onKeyDown={(e) => {
          const r = comboKey(s, e.key, e.altKey, options, value);
          setS(r.state);
          if (r.pick) onChange(r.pick.label);
          if (r.handled) { e.preventDefault(); e.stopPropagation(); }
        }} />
      <button type="button" className="cbx-toggle" tabIndex={-1} disabled={disabled} data-testid={`${testId}-toggle`}
        aria-label={t('app.showList')} aria-expanded={open} aria-controls={listId}
        onMouseDown={(e) => e.preventDefault()} // the focus stays in the field
        onClick={() => {
          input.current?.focus({ preventScroll: true }); // a scroll would close the list it opens
          setS(open ? CLOSED : { open: true, filter: null, active: options.findIndex((o) => o.label === value) });
        }}>
        <ChevronDown className="ic-sm" aria-hidden />
      </button>
      {open && createPortal(
        <ul ref={list} id={listId} role="listbox" aria-label={label} className="cbx-list" data-testid={`${testId}-list`} style={pos}
          onMouseDown={(e) => e.preventDefault()}>
          {shown.map((o, i) => (
            <li key={o.id} id={optId(o)} role="option" aria-selected={i === s.active} data-testid={`${testId}-option-${o.id}`}
              className={`cbx-opt${i === s.active ? ' is-active' : ''}${o.label === value ? ' is-current' : ''}`}
              onMouseMove={() => { if (i !== s.active) setS({ ...s, active: i }); }} onClick={() => pick(o)}>{o.label}</li>
          ))}
        </ul>, document.body)}
    </div>
  );
}

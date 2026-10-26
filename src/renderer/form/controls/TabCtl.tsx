// Contrôle onglet : role="tablist" ; chaque page (Pages ?? []) montre les contrôles dont PageIndex est le sien (absent : la première).
import type { KeyboardEvent, ReactNode } from 'react';
import type { ControlDef } from '../../../shared/design/model';
import { prop } from '../run-model';
import { tipOf, type CtlProps } from './run-ctx';

export function TabCtl({ c, x, style, renderChild }: CtlProps & { renderChild(k: ControlDef, origin: ControlDef): ReactNode }) {
  const page = x.pages[c.name] ?? 0;
  /** Another page: the subforms of the page left are saved first (they go with it); refused, the page stays (data safety). */
  const setPage = async (i: number): Promise<boolean> => {
    if (i === page) return true;
    if (x.sub && !(await x.sub.leavePage(c.name, page))) return false;
    x.setPage(c.name, i);
    void x.raise('OnChange', c.name);
    return true;
  };
  const ev = x.events(c);   // the strip is the tab control's stop in the tab order
  const v = prop(c, 'Pages');
  const pages = Array.isArray(v) ? v.map(String) : [];
  const id = x.id(c.name);
  const keys = (e: KeyboardEvent) => {
    const n = pages.length;
    const next = e.key === 'ArrowRight' ? (page + 1) % n : e.key === 'ArrowLeft' ? (page + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null || !n) return;
    e.preventDefault();
    void setPage(next).then((ok) => { if (ok) document.getElementById(`${id}-tab-${next}`)?.focus(); });
  };
  return (
    <div className="frun-tabs" style={style} data-testid={`form-ctl-${c.name}`} data-ctl={c.name} {...tipOf(c)}>
      <div role="tablist" aria-label={c.name} className="frun-tabstrip" onFocus={ev.onFocus} onBlur={ev.onBlur} onKeyDown={(e) => { keys(e); if (!e.defaultPrevented) ev.onKeyDown(e); }}>
        {pages.map((p, i) => (
          <button key={i} type="button" role="tab" id={`${id}-tab-${i}`} aria-selected={i === page} aria-controls={`${id}-panel`} tabIndex={i === page && x.stops.has(c.name) ? 0 : -1}
            data-testid={`form-tab-${c.name}-${i}`} onClick={() => void setPage(i)}>{p}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${page}`}>
        {(c.children ?? []).filter((k) => (typeof k.props.PageIndex === 'number' ? k.props.PageIndex : 0) === page).map((k) => renderChild(k, c))}
      </div>
    </div>
  );
}

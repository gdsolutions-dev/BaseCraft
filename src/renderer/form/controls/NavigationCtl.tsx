// Contrôle navigation (D4) : une barre d'onglets (NavigationTargets) ; l'onglet actif montre son formulaire dans le cadre dessous, comme un
// sous-formulaire (SubformCtl : mêmes enregistrements, mêmes règles d'enregistrement en quittant). ponytail: forms only; a report tab says so.
import type { KeyboardEvent } from 'react';
import type { ControlDef } from '../../../shared/design/model';
import { parseTargets } from '../nav-targets';
import { prop } from '../run-model';
import { SubformCtl } from './SubformCtl';
import { tipOf, type CtlProps } from './run-ctx';

export function NavigationCtl({ c, x, style }: CtlProps) {
  const targets = parseTargets(prop(c, 'NavigationTargets'));
  const page = Math.min(x.pages[c.name] ?? 0, Math.max(0, targets.length - 1));
  const target = targets[page];
  /** Another tab: the form left is saved first (as a subform leaving its page); refused, the tab stays (data safety). */
  const go = async (i: number): Promise<boolean> => {
    if (i === page) return true;
    if (x.sub && !(await x.sub.leavePage(c.name, page))) return false;
    x.setPage(c.name, i);
    return true;
  };
  const id = x.id(c.name);
  const keys = (e: KeyboardEvent) => {
    const n = targets.length;
    const next = e.key === 'ArrowRight' ? (page + 1) % n : e.key === 'ArrowLeft' ? (page + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null || !n) return;
    e.preventDefault();
    void go(next).then((ok) => { if (ok) document.getElementById(`${id}-tab-${next}`)?.focus(); });
  };
  // the frame below is a subform control of its own, on the target form
  const inner: ControlDef = { ...c, kind: 'subform', props: { SourceObject: target?.kind === 'form' ? target.name : '' } };
  return (
    <div className="frun-tabs" style={style} data-testid={`form-nav-${c.name}`} {...tipOf(c)}>
      <div role="tablist" aria-label={c.name} className="frun-tabstrip" onKeyDown={keys}>
        {targets.map((t, i) => (
          <button key={i} type="button" role="tab" id={`${id}-tab-${i}`} aria-selected={i === page} aria-controls={`${id}-panel`} tabIndex={i === page ? 0 : -1}
            data-testid={`form-nav-tab-${c.name}-${i}`} onClick={() => void go(i)}>{t.caption}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} className="frun-nav-panel">
        {target?.kind === 'report'
          ? <div className="frun-subform-error" role="status" data-testid="form-nav-report">{x.t('form.nav.reportLater')}</div>
          : target && <SubformCtl key={target.name} c={inner} x={x} style={{ position: 'absolute', inset: 0 }} />}
      </div>
    </div>
  );
}

// Groupe d'options : role="radiogroup" nommé par sa légende (Caption) ; chaque option (enfant avec une Valeur d'option) est un
// role="radio" qui écrit sa valeur dans le champ du groupe ; les flèches passent d'une option à l'autre, comme des boutons radio.
import type { KeyboardEvent, ReactNode } from 'react';
import type { ControlDef } from '../../../shared/design/model';
import { num } from '../../../shared/expr/library';
import { isUnbound } from '../control-values';
import { controlEnabled, optionGroupValue, prop } from '../run-model';
import { fieldOf, hasLabel, placed, tipOf, type CtlProps } from './run-ctx';

const isOption = (k: ControlDef): boolean => (k.kind === 'optionButton' || k.kind === 'checkBox') && typeof k.props.OptionValue === 'number' && prop(k, 'Visible') !== false;

export function OptionGroupCtl({ c, x, style, renderChild }: CtlProps & { renderChild(k: ControlDef, origin: ControlDef, forId?: string): ReactNode }) {
  const b = fieldOf(c, x);
  const { disabled, readOnly } = controlEnabled(c, x.snap, b?.f ?? null);
  const unbound = isUnbound(c);
  const u = x.unbound[c.name]?.value ?? null;
  const value = unbound ? (u?.t === 'num' ? u.v : null)
    : b ? (b.pending !== undefined ? (typeof b.pending === 'boolean' ? Number(b.pending) : b.pending) : b.stored) : null;
  const chosen = optionGroupValue(c, value);
  const options = (c.children ?? []).filter(isOption);
  const target = chosen ?? options[0]?.name;   // the option that holds the group's tab stop (roving tabindex)
  const err = x.errors[c.name];
  const ev = x.events(c);
  const choose = (k: ControlDef) => {
    if (readOnly || disabled || prop(k, 'Enabled') === false) return;
    if (chosen === k.name) return;
    x.update(c, () => { if (unbound) x.editUnbound(c, num(k.props.OptionValue as number)); else if (b) x.edit(b.f, k.props.OptionValue as number); });
  };
  const keys = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (e.key === ' ') { e.preventDefault(); choose(options[i]); return; }
    if (!step || !options.length) return;
    e.preventDefault();
    const next = options[(i + step + options.length) % options.length];
    choose(next);
    document.getElementById(x.id(next.name))?.focus();
  };
  const caption = String(prop(c, 'Caption') ?? '');
  return (
    <div role="radiogroup" id={x.id(c.name)} data-testid={`form-ctl-${c.name}`} data-ctl={c.name} className="frun-group" style={style}
      {...(caption ? { 'aria-labelledby': `${x.id(c.name)}-caption` } : { 'aria-label': c.name })} aria-disabled={disabled || undefined} aria-readonly={readOnly || undefined}
      {...(err !== undefined ? { 'aria-invalid': true, 'aria-describedby': `${x.id(c.name)}-err` } : {})} {...tipOf(c)} {...ev}>
      <span className="frun-legend" id={`${x.id(c.name)}-caption`}>{caption}</span>
      {(c.children ?? []).map((k) => {
        if (!isOption(k)) return renderChild(k, c);
        const i = options.indexOf(k);
        return [
          <div key={k.name} role="radio" id={x.id(k.name)} data-testid={`form-ctl-${k.name}`} aria-checked={chosen === k.name}
            className={`frun-radio${k.kind === 'checkBox' ? ' frun-square' : ''}`} style={placed(k, c)}
            tabIndex={k.name === target && x.stops.has(c.name) ? 0 : -1} aria-disabled={disabled || prop(k, 'Enabled') === false || undefined}
            {...(hasLabel(k) ? { 'aria-labelledby': `${x.id(k.name)}-label` } : { 'aria-label': k.name })} {...tipOf(k)}
            onClick={() => choose(k)} onKeyDown={(e) => keys(e, i)} />,
          ...(k.children ?? []).map((l) => renderChild(l, c, x.id(k.name))),
        ];
      })}
    </div>
  );
}

// Bouton bascule : un <button aria-pressed> lié à un Oui/Non (ou indépendant), enfoncé quand la valeur est vraie ; un clic l'inverse, comme une case à cocher.
import { bool, truthy } from '../../../shared/expr/library';
import { isUnbound } from '../control-values';
import { controlEnabled, prop } from '../run-model';
import { isOn } from './CheckBoxCtl';
import { ctlAttrs, fieldOf, type CtlProps } from './run-ctx';

export function ToggleButtonCtl({ c, x, style }: CtlProps) {
  const b = fieldOf(c, x);
  const { disabled, readOnly } = controlEnabled(c, x.snap, b?.f ?? null);
  const unbound = isUnbound(c);
  const u = x.unbound[c.name]?.value ?? null;
  const on = unbound ? u !== null && truthy(u) === true : b ? isOn(b.stored, b.pending) : false;
  const attrs = ctlAttrs(c, x);
  const caption = String(prop(c, 'Caption') ?? '');
  return (
    <button type="button" {...attrs} aria-pressed={on} aria-label={caption ? undefined : c.name} className="frun-button frun-toggle" style={style} disabled={disabled}
      aria-readonly={readOnly || undefined}
      onClick={(e) => {
        if (!readOnly) x.update(c, () => { if (unbound) x.editUnbound(c, bool(!on)); else if (b) x.edit(b.f, !on); });   // a read-only toggle does not toggle
        attrs.onClick?.(e);
      }}>{caption}</button>
  );
}

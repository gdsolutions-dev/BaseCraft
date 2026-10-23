// Case à cocher (et case d'option hors d'un groupe, liée à un Oui/Non) : <input type="checkbox">, Oui/Non écrit comme un booléen.
import type { CellInput, SqlValue } from '../../../shared/coerce';
import { bool, truthy } from '../../../shared/expr/library';
import { isUnbound } from '../control-values';
import { controlEnabled } from '../run-model';
import { ctlAttrs, fieldOf, type CtlProps } from './run-ctx';

export const isOn = (stored: SqlValue, pending: CellInput | undefined): boolean =>
  pending !== undefined ? (typeof pending === 'boolean' ? pending : pending !== null && pending !== '' && pending !== 0 && pending !== '0')
    : stored !== null && stored !== 0 && stored !== '0';

export function CheckBoxCtl({ c, x, style }: CtlProps) {
  const b = fieldOf(c, x);
  const { disabled, readOnly } = controlEnabled(c, x.snap, b?.f ?? null);
  const unbound = isUnbound(c);
  const u = x.unbound[c.name]?.value ?? null;
  return (
    <input type="checkbox" {...ctlAttrs(c, x)} className={`frun-check${c.kind === 'optionButton' ? ' frun-round' : ''}`} style={style}
      checked={unbound ? u !== null && truthy(u) === true : b ? isOn(b.stored, b.pending) : false} disabled={disabled} aria-readonly={readOnly || undefined}
      onClick={(e) => { if (readOnly) e.preventDefault(); }}   // a read-only checkbox does not toggle
      onChange={(e) => { if (readOnly) return; if (unbound) x.editUnbound(c, bool(e.target.checked)); else if (b) x.edit(b.f, e.target.checked); }} />
  );
}

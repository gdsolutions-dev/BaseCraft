// The record clipboard (E6b): what a macro's RunMenuCommand copy puts and paste reads. In memory, inside the application only.
// ponytail: internal clipboard, the system clipboard when records must go to another application
import type { Value } from '../../shared/expr/ast';
import type { ControlDef } from '../../shared/design/model';
import { foldName } from '../../shared/field-types';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import { boundField } from './control-values';
import type { RecordSnapshot } from './record-controller';
import { controlEnabled } from './run-model';

let copied: ReadonlyMap<string, Value> | null = null;

/** The values of a record by folded field name; replaces what was copied. */
export function copyRecord(values: Map<string, Value>): void { copied = new Map(values); }
export const copiedRecord = (): ReadonlyMap<string, Value> | null => copied;
/** The base closes or switches. */
export function clearRecordClipboard(): void { copied = null; }

/** The copied fields a paste writes: each bound to a control of this form (the first one per field) that the user could type in (not
 *  AutoNumber, calculated, locked or disabled), in control order. */
export function pasteTargets(controls: readonly ControlDef[], snap: RecordSnapshot, info: SourceInfo, copied: ReadonlyMap<string, Value>): { f: SourceField; v: Value }[] {
  const seen = new Set<string>();
  return controls.flatMap((c) => {
    const f = boundField(c, info), k = f && foldName(f.name);
    if (!f || !k || seen.has(k) || !copied.has(k)) return [];
    const e = controlEnabled(c, snap, f);
    if (e.readOnly || e.disabled) return [];
    seen.add(k);
    return [{ f, v: copied.get(k)! }];
  });
}

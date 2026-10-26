// The open base's temporary variables (TempVars), keyed by foldName: every macro run shares them, and a query's
// [TempVars]! parameter reads them (promptParameters). Kept apart from macro-shell so that reading them imports no React.
import type { Value } from '../../shared/expr/ast';

export const tempVars = new Map<string, Value>();
/** App clears them when the base closes or changes. */
export function clearTempVars(): void { tempVars.clear(); }

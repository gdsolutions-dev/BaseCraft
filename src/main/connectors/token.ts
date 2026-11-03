// Row tokens (C4 R4, C5 R11): what a server connector reads back to find a row again. Shared by every connector: the key
// column names, their values as the server's text, and the row's version ('' when the table has none).

const invalid = (): never => { throw new Error('bc:invalidArgument'); };

/** A RowRef of a row's k/v cells under its key column `names`: JSON [[name…], [k…], v]; longer than 4096 → null (R4: the
 *  row reads without a reference). */
export function rowToken(names: string[], keys: string[], version: string): string | null {
  const t = JSON.stringify([names, keys, version]);
  return t.length > 4096 ? null : t;
}

const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((y) => typeof y === 'string');
/** A token rowToken made for a table keyed by `names`; null when it names other key columns (read before Refresh Link changed
 *  the key: stale, its values are not this key's); anything else: bc:invalidArgument. */
export function parseRowToken(t: string, names: string[]): { keys: string[]; version: string } | null {
  let v: unknown;
  try { v = JSON.parse(t); } catch { return invalid(); }
  if (!Array.isArray(v) || v.length !== 3) return invalid();
  const [n, k, ver] = v as unknown[];
  if (!strings(n) || !strings(k) || k.length !== n.length || !k.length || typeof ver !== 'string') return invalid();
  return n.length === names.length && n.every((x, i) => x === names[i]) ? { keys: k, version: ver } : null;
}

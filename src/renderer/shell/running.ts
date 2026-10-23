// Query work the user may stop (A3): a tracked call (bridge.ts: query and datasheet reads, action queries) that lasts more
// than a second shows « Exécution… » with Stop (RunningNotice); Ctrl+Break stops it too, as in Access.
const SLOW_MS = 1000;
let slow = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const f of listeners) f(); };

export function track<T>(p: Promise<T>): Promise<T> {
  let late = false;
  const timer = setTimeout(() => { late = true; slow++; notify(); }, SLOW_MS);
  const end = () => { clearTimeout(timer); if (late) { slow--; notify(); } };
  p.then(end, end);
  return p;
}
export function subscribeSlow(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
export const isSlow = (): boolean => slow > 0;

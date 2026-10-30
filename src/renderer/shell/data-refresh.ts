// C3 R10: another workstation wrote (App forwards base.onDataChanged here, once). Every open datasheet and form view
// subscribes and refreshes what it shows; an edit in progress is kept (each view decides).
const listeners = new Set<() => void>();

export function onDataRefresh(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function emitDataRefresh(): void {
  for (const f of [...listeners]) f();
}

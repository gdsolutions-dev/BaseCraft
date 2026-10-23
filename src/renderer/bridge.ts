import type { BasecraftApi } from '../shared/api';
import { track } from './shell/running';

const raw = (window as unknown as { basecraft: BasecraftApi }).basecraft;

/** The group with these methods tracked (running.ts): a call that lasts shows « Exécution… » with Stop. */
function tracked<G extends object>(g: G | undefined, names: (keyof G & string)[]): G | undefined {
  if (!g) return g;
  const out = { ...g } as Record<string, unknown>;
  for (const n of names) {
    if (typeof g[n] === 'function') out[n] = (...a: unknown[]) => track((g[n] as (...a: unknown[]) => Promise<unknown>)(...a));
  }
  return out as G;
}

/** The renderer's only way out: the preload bridge. Query reads, datasheet pages and action queries can be stopped. */
export const api: BasecraftApi = raw && {
  ...raw,
  sources: tracked(raw.sources, ['describe', 'page'])!,
  queries: tracked(raw.queries, ['actionCount', 'runAction'])!,
  rows: tracked(raw.rows, ['page', 'count'])!,
};

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

let askPassword: ((path: string, wrong: boolean) => Promise<string | null>) | null = null;
/** App registers it (modal.prompt, secret). Resolves the typed password, or null on Cancel. */
export function setPasswordPrompt(fn: (path: string, wrong: boolean) => Promise<string | null>): void { askPassword = fn; }

const NEEDS_PASSWORD = /bc:linkUnavailable\|needsPassword\|(.+)$/s;
/** One prompt per file at a time (Map<path, Promise<boolean>>): concurrent refused calls wait for the same answer. The password lives
 *  in this closure until links.unlock returns, never in a state, never logged. */
const prompts = new Map<string, Promise<boolean>>();
function unlockWithPrompt(path: string, unlock: BasecraftApi['links']['unlock']): Promise<boolean> {
  let p = prompts.get(path);
  if (!p) {
    p = (async () => {
      for (let wrong = false; ; wrong = true) {
        const pw = askPassword ? await askPassword(path, wrong) : null;
        if (pw === null) return false;
        if (await unlock(path, pw)) return true;
      }
    })().finally(() => prompts.delete(path));
    prompts.set(path, p);
  }
  return p;
}

/** Every api method except links.unlock: on bc:linkUnavailable|needsPassword|<path>, prompt, unlock, retry once. Cancel rethrows the
 *  original error. (A subscription such as onProgress returns no promise: passed through.) */
function withPassword<G extends object>(g: G): G {
  const unlock = (g as unknown as BasecraftApi).links?.unlock;
  const wrap = (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => {
    const r = fn(...a);
    if (!(r instanceof Promise)) return r;
    return r.catch(async (e: unknown) => {
      const path = NEEDS_PASSWORD.exec(e instanceof Error ? e.message : String(e))?.[1];
      if (path === undefined || !unlock || !(await unlockWithPrompt(path, unlock))) throw e;
      return fn(...a);
    });
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) {
    if (typeof v === 'function') out[k] = wrap(v as never);
    else if (v && typeof v === 'object') {
      out[k] = Object.fromEntries(Object.entries(v).map(([n, f]) => [n, typeof f === 'function' && !(k === 'links' && n === 'unlock') ? wrap(f as never) : f]));
    } else out[k] = v;
  }
  return out as G;
}

/** The renderer's only way out: the preload bridge. Query reads, datasheet pages and action queries can be stopped. */
export const api: BasecraftApi = raw && withPassword({
  ...raw,
  sources: tracked(raw.sources, ['describe', 'page'])!,
  queries: tracked(raw.queries, ['actionCount', 'runAction'])!,
  rows: tracked(raw.rows, ['page', 'count'])!,
});

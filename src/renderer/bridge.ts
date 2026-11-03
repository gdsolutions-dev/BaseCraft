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

/** Every wrapped call's number, taken when it is sent. */
let sent = 0;
/** A key's prompts (a file's password, a server's login): `pending`, the one shown; `answers`, the last answer and the last call sent before it. */
type Prompts = { pending: Map<string, Promise<boolean>>; answers: Map<string, { upTo: number; ok: boolean }> };
/** One prompt per key at a time: concurrent refused calls wait for the same answer. A call sent before an answer takes it even when
 *  its refusal lands after it (a Datasheet's reads go together: Cancel never asks again for them); a call sent after it asks again. */
function prompted(p: Prompts, key: string, call: number, ask: () => Promise<boolean>): Promise<boolean> {
  const a = p.answers.get(key);
  if (a && call <= a.upTo) return Promise.resolve(a.ok);
  let q = p.pending.get(key);
  if (!q) {
    q = ask().then((ok) => { p.answers.set(key, { upTo: sent, ok }); return ok; }).finally(() => p.pending.delete(key));
    p.pending.set(key, q);
  }
  return q;
}

const NEEDS_PASSWORD = /bc:linkUnavailable\|needsPassword\|(.+)$/s;
/** One prompt per file (prompted). The password lives in this closure until links.unlock returns, never in a state, never logged. */
const passwords: Prompts = { pending: new Map(), answers: new Map() };
function unlockWithPrompt(path: string, call: number, unlock: BasecraftApi['links']['unlock']): Promise<boolean> {
  return prompted(passwords, path, call, async () => {
    for (let wrong = false; ; wrong = true) {
      const pw = askPassword ? await askPassword(path, wrong) : null;
      if (pw === null) return false;
      if (await unlock(path, pw)) return true;
    }
  });
}

export type LoginAnswer = { user: string; password: string; remember: boolean };
let askLogin: ((key: string, wrong: boolean, untrusted: boolean) => Promise<LoginAnswer | null>) | null = null;
/** App registers it (LoginDialog, C4 R10). Resolves the typed login, or null on Cancel. `untrusted` (C6 Task 8): a pass-through
 *  of a file not trusted, the remembered password not used. */
export function setLoginPrompt(fn: (key: string, wrong: boolean, untrusted: boolean) => Promise<LoginAnswer | null>): void { askLogin = fn; }

/** needsLogin|<key>, or needsLogin|<key>|untrusted (C6 Task 8). */
const NEEDS_LOGIN = /bc:linkUnavailable\|needsLogin\|(.+?)(\|untrusted)?$/s;
/** As unlockWithPrompt, per server key: one login dialog at a time, asked again while the server refuses it. */
const logins: Prompts = { pending: new Map(), answers: new Map() };
function loginWithPrompt(key: string, untrusted: boolean, call: number, login: BasecraftApi['links']['login']): Promise<boolean> {
  return prompted(logins, key, call, async () => {
    for (let wrong = false; ; wrong = true) {
      const a = askLogin ? await askLogin(key, wrong, untrusted) : null;
      if (a === null) return false;
      if (await login(key, a.user, a.password, a.remember)) return true;
    }
  });
}

/** links' own prompts' methods: never wrapped (they answer for the prompt); the server link dialog's, which log in themselves (C4). */
const UNWRAPPED = new Set(['unlock', 'login', 'loginInfo', 'inspectServer', 'createServer', 'relinkServer', 'canRemember']);

/** A cancelled login's error names the server by its label (loginInfo), not by its credential key (C4), without C6's |untrusted;
 *  `e` when there is neither. */
async function labelled(e: unknown, msg: string, key: string, info: BasecraftApi['links']['loginInfo'] | undefined): Promise<unknown> {
  const label = await info?.(key).then((i) => i?.label, () => undefined);
  const plain = msg.replace(/\|untrusted$/, '');
  return label ? new Error(plain.replace(`needsLogin|${key}`, `needsLogin|${label}`)) : plain !== msg ? new Error(plain) : e;
}
/** Every api method except those: on bc:linkUnavailable|needsPassword|<path> (C2) or needsLogin|<key> (C4), prompt, unlock or log
 *  in, retry once. Cancel rethrows the original error (a login's: with the server's label). (A subscription such as onProgress returns no promise: passed through.) */
function withPassword<G extends object>(g: G): G {
  const links = (g as unknown as BasecraftApi).links;
  const wrap = (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => {
    const call = ++sent;
    const r = fn(...a);
    if (!(r instanceof Promise)) return r;
    return r.catch(async (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      const path = NEEDS_PASSWORD.exec(msg)?.[1];
      const login = NEEDS_LOGIN.exec(msg);
      const key = login?.[1];
      const ok = path !== undefined ? !!links?.unlock && await unlockWithPrompt(path, call, links.unlock)
        : key !== undefined ? !!links?.login && await loginWithPrompt(key, login![2] !== undefined, call, links.login) : false;
      if (!ok) throw key !== undefined ? await labelled(e, msg, key, links?.loginInfo) : e;
      return fn(...a);
    });
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) {
    if (typeof v === 'function') out[k] = wrap(v as never);
    else if (v && typeof v === 'object') {
      out[k] = Object.fromEntries(Object.entries(v).map(([n, f]) => [n, typeof f === 'function' && !(k === 'links' && UNWRAPPED.has(n)) ? wrap(f as never) : f]));
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

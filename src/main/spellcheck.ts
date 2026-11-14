import { spawn } from 'node:child_process';
// Home › Spelling (C2): the dictionary of the interface language, among the languages Chromium's spell checker offers.
const DEFAULT_REGION: Record<string, string> = { en: 'en-US', pt: 'pt-BR' };

/** The language to check with: the interface language of the user's region (fr-CH), else its default, else the first one of it. */
export function pickSpellLanguage(available: readonly string[], ui: string, region: string): string | null {
  const ofUi = available.filter((a) => a === ui || a.startsWith(`${ui}-`));
  const country = region.split('-')[1];
  return ofUi.find((a) => a === `${ui}-${country}`) ?? ofUi.find((a) => a === ui || a === DEFAULT_REGION[ui]) ?? ofUi[0] ?? null;
}

/** The language tags to offer the Windows checker, best first: the user's region when it is in the interface language (fr-CH), then the Chromium pick, then the language. */
export function winSpellTags(pick: string | null, ui: string, region: string): string[] {
  return [...new Set([region.startsWith(`${ui}-`) ? region : '', pick ?? '', DEFAULT_REGION[ui] ?? '', ui].filter(Boolean))];
}

export type WinSpell = { ready: Promise<boolean>; check(words: string[]): Promise<Record<string, string[]>>; stop(): void; /** false once the child ended */ alive(): boolean };

/**
 * Windows only: one long-lived child (resources/spellcheck.ps1) querying the OS spell checker, because Chromium's renderer API
 * (webFrame) is blind to it. Words go through stdin, one tab-separated line per request; the answer lists the misspelled ones
 * with their suggestions. `ready` is false when the OS has no checker for the tags, or the child fails or is too slow to start.
 */
export function startWinSpell(file: string, args: string[], startMs = 30_000, askMs = 10_000): WinSpell {
  const child = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdout.setEncoding('utf8');
  const CLOSED = '\u0000closed';
  let buf = '';
  let onLine: ((l: string) => void) | null = null;
  let dead = false;
  child.on('error', () => { dead = true; onLine?.(CLOSED); });
  child.on('close', () => { dead = true; onLine?.(CLOSED); });
  child.stdin.on('error', () => { /* the child is gone: close reports it */ });
  child.stdout.on('data', (d: string) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); onLine?.(l); }
  });
  const stop = () => { dead = true; child.kill(); };
  /** Reads lines until `done` says so; null on a timeout or when the child ends. */
  const read = (ms: number, done: (l: string) => boolean) => new Promise<string[] | null>((res) => {
    const got: string[] = [];
    const timer = setTimeout(() => { onLine = null; stop(); res(null); }, ms);
    onLine = (l) => {
      if (l === CLOSED) { clearTimeout(timer); onLine = null; return res(null); }
      got.push(l);
      if (done(l)) { clearTimeout(timer); onLine = null; res(got); }
    };
  });
  const ready = read(startMs, (l) => l.startsWith('READY ')).then((r) => !!r && !r[r.length - 1].endsWith(' -'));
  let queue: Promise<unknown> = ready;
  const check = (words: string[]) => {
    const one = async (): Promise<Record<string, string[]>> => {
      if (dead || !(await ready) || !words.length) return {};
      const lines = read(askMs, (l) => l === 'END');
      child.stdin.write(`${words.map((w) => w.replace(/[\t\r\n\0]/g, ' ')).join('\t')}\n`);
      const out: Record<string, string[]> = {};
      for (const l of (await lines) ?? []) if (l !== 'END') { const [w, ...s] = l.split('\t'); out[w] = s; }
      return out;
    };
    const r = queue.then(one, one);   // one request at a time
    queue = r;
    return r;
  };
  return { ready, check, stop, alive: () => !dead };
}

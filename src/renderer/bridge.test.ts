// The password prompt of a protected Access file (C2 R7): a call refused with needsPassword asks, unlocks, retries once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasecraftApi } from '../shared/api';

const PATH = '/a.accdb';
const refused = () => new Error(`Error invoking remote method 'bc:rows:page': Error: bc:linkUnavailable|needsPassword|${PATH}`);

let unlocked: boolean;
const unlock = vi.fn(async (_p: string, pw: string) => (unlocked = pw === 'ok'));
const page = vi.fn(async () => { if (!unlocked) throw refused(); return 'rows'; });

async function load() {
  vi.resetModules();
  vi.stubGlobal('window', { basecraft: { rows: { page }, links: { unlock }, pickFolder: async () => null } });
  return import('./bridge') as Promise<{ api: BasecraftApi; setPasswordPrompt(fn: (p: string, wrong: boolean) => Promise<string | null>): void }>;
}

beforeEach(() => { unlocked = false; unlock.mockClear(); page.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('withPassword', () => {
  it('right password: unlocks, then the call resolves on its retry', async () => {
    const { api, setPasswordPrompt } = await load();
    const prompt = vi.fn(async () => 'ok');
    setPasswordPrompt(prompt);
    await expect((api.rows.page as () => Promise<string>)()).resolves.toBe('rows');
    expect(prompt).toHaveBeenCalledWith(PATH, false);
    expect(unlock).toHaveBeenCalledWith(PATH, 'ok');
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('wrong then right: the second prompt says so, once', async () => {
    const { api, setPasswordPrompt } = await load();
    const answers = ['faux', 'ok'];
    const prompt = vi.fn(async () => answers.shift()!);
    setPasswordPrompt(prompt);
    await expect((api.rows.page as () => Promise<string>)()).resolves.toBe('rows');
    expect(prompt.mock.calls.map((c) => (c as unknown as [string, boolean])[1])).toEqual([false, true]);
  });

  it('Cancel: the original error, no unlock', async () => {
    const { api, setPasswordPrompt } = await load();
    setPasswordPrompt(async () => null);
    await expect((api.rows.page as () => Promise<string>)()).rejects.toThrow(`bc:linkUnavailable|needsPassword|${PATH}`);
    expect(unlock).not.toHaveBeenCalled();
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('two concurrent calls on the same file: one prompt', async () => {
    const { api, setPasswordPrompt } = await load();
    const prompt = vi.fn(async () => 'ok');
    setPasswordPrompt(prompt);
    const call = api.rows.page as () => Promise<string>;
    await expect(Promise.all([call(), call()])).resolves.toEqual(['rows', 'rows']);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  // a Datasheet sends its reads together; one refused after the prompt was answered takes that answer, never a second prompt
  it('a call sent before the prompt was answered, refused after it: the same answer (Cancel: rethrown; OK: retried)', async () => {
    for (const answer of [null, 'ok']) {
      const { api, setPasswordPrompt } = await load();
      unlocked = false;
      page.mockClear();
      let refuseLate!: () => void;
      const late = new Promise<void>((r) => { refuseLate = r; });
      page.mockImplementationOnce(async () => { throw refused(); })
        .mockImplementationOnce(async () => { await late; throw refused(); });
      const prompt = vi.fn(async () => answer);
      setPasswordPrompt(prompt);
      const call = api.rows.page as () => Promise<string>;
      const first = call();
      const second = call();
      if (answer === null) await expect(first).rejects.toThrow('needsPassword'); else await expect(first).resolves.toBe('rows');
      refuseLate();
      if (answer === null) await expect(second).rejects.toThrow('needsPassword'); else await expect(second).resolves.toBe('rows');
      expect(prompt).toHaveBeenCalledTimes(1);
      // a call sent after the answer asks again (the table opened again)
      unlocked = false;
      const again = vi.fn(async () => null);
      setPasswordPrompt(again);
      await expect(call()).rejects.toThrow('needsPassword');
      expect(again).toHaveBeenCalledTimes(1);
    }
  });

  it('other errors pass through, and links.unlock is never wrapped', async () => {
    const { api, setPasswordPrompt } = await load();
    const prompt = vi.fn(async () => 'ok');
    setPasswordPrompt(prompt);
    page.mockRejectedValueOnce(new Error('bc:cancelled'));
    await expect((api.rows.page as () => Promise<string>)()).rejects.toThrow('bc:cancelled');
    unlock.mockRejectedValueOnce(refused());
    await expect(api.links.unlock(PATH, 'x')).rejects.toThrow('needsPassword');
    expect(prompt).not.toHaveBeenCalled();
  });
});

// C4 R10: a server source without a working credential (needsLogin) asks the login dialog, logs in, retries once (Review Focus 2).
describe('withLogin', () => {
  const KEY = 'postgresql://db.example:5432/ventes';
  const noLogin = () => new Error(`Error invoking remote method 'bc:rows:page': Error: bc:linkUnavailable|needsLogin|${KEY}`);
  let logged: boolean;
  const login = vi.fn(async (_k: string, _u: string, pw: string, _r: boolean) => (logged = pw === 'ok'));
  const read = vi.fn(async () => { if (!logged) throw noLogin(); return 'rows'; });
  type Answer = { user: string; password: string; remember: boolean } | null;
  async function loadLogin() {
    vi.resetModules();
    const loginInfo = vi.fn(async () => ({ user: 'ana', label: 'db.example:5432/ventes', canRemember: true }));
    vi.stubGlobal('window', { basecraft: { rows: { page: read }, links: { unlock, login, loginInfo } } });
    return import('./bridge') as Promise<{ api: BasecraftApi; setLoginPrompt(fn: (k: string, wrong: boolean, untrusted: boolean) => Promise<Answer>): void }>;
  }
  beforeEach(() => { logged = false; login.mockClear(); read.mockClear(); });

  it('one login per key for concurrent calls, asked again when wrong, Cancel rethrows', async () => {
    const { api, setLoginPrompt } = await loadLogin();
    const answers: Answer[] = [{ user: 'ana', password: 'bad', remember: true }, { user: 'ana', password: 'ok', remember: false }];
    const prompt = vi.fn(async (_k: string, _w: boolean) => answers.shift()!);
    setLoginPrompt(prompt);
    const call = api.rows.page as () => Promise<string>;
    await expect(Promise.all([call(), call()])).resolves.toEqual(['rows', 'rows']);
    expect(prompt.mock.calls).toEqual([[KEY, false, false], [KEY, true, false]]);
    expect(login.mock.calls).toEqual([[KEY, 'ana', 'bad', true], [KEY, 'ana', 'ok', false]]);
    expect(read).toHaveBeenCalledTimes(4); // both refused, both retried once

    logged = false;
    read.mockClear();
    login.mockClear();
    setLoginPrompt(async () => null);
    await expect(call()).rejects.toThrow(/bc:linkUnavailable\|needsLogin\|db\.example:5432\/ventes$/); // the label, not the key
    expect(login).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('a call sent before the login was cancelled, refused after it: no second login dialog', async () => {
    const { api, setLoginPrompt } = await loadLogin();
    let refuseLate!: () => void;
    const late = new Promise<void>((r) => { refuseLate = r; });
    read.mockImplementationOnce(async () => { throw noLogin(); }).mockImplementationOnce(async () => { await late; throw noLogin(); });
    const prompt = vi.fn(async () => null);
    setLoginPrompt(prompt);
    const call = api.rows.page as () => Promise<string>;
    const first = call();
    const second = call();
    await expect(first).rejects.toThrow('needsLogin');
    refuseLate();
    await expect(second).rejects.toThrow('needsLogin');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  // C6 Task 8: a file not trusted does not use the remembered password of its pass-throughs: the prompt says why
  it('needsLogin|<key>|untrusted: the prompt is told, the key read without the suffix; Cancel names the label alone', async () => {
    const { api, setLoginPrompt } = await loadLogin();
    read.mockImplementation(async () => { if (!logged) throw new Error(`Error invoking remote method 'bc:rows:page': Error: bc:linkUnavailable|needsLogin|${KEY}|untrusted`); return 'rows'; });
    const prompt = vi.fn(async (_k: string, _w: boolean, _u: boolean) => ({ user: 'ana', password: 'ok', remember: false }));
    setLoginPrompt(prompt);
    const call = api.rows.page as () => Promise<string>;
    await expect(call()).resolves.toBe('rows');
    expect(prompt.mock.calls).toEqual([[KEY, false, true]]);
    expect(login.mock.calls).toEqual([[KEY, 'ana', 'ok', false]]);
    logged = false;
    setLoginPrompt(async () => null);
    await expect(call()).rejects.toThrow(/bc:linkUnavailable\|needsLogin\|db\.example:5432\/ventes$/);
    read.mockImplementation(async () => { if (!logged) throw noLogin(); return 'rows'; });
  });

  it('links.login, links.loginInfo and the server link dialog calls are never wrapped', async () => {
    const { api, setLoginPrompt } = await loadLogin();
    const prompt = vi.fn(async () => ({ user: 'ana', password: 'ok', remember: false }));
    setLoginPrompt(prompt);
    login.mockRejectedValueOnce(noLogin());
    await expect(api.links.login(KEY, 'ana', 'x', false)).rejects.toThrow('needsLogin');
    expect(prompt).not.toHaveBeenCalled();
    for (const n of ['inspectServer', 'createServer', 'relinkServer', 'canRemember'] as const) {
      expect(api.links[n]).toBe((window as unknown as { basecraft: BasecraftApi }).basecraft.links[n]);
    }
  });
});

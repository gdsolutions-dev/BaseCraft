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

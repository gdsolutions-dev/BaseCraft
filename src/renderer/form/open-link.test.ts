import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModalApi } from '../shell/Modal';

const open = vi.fn(async () => {});
vi.mock('../bridge', () => ({ api: { app: { openHyperlink: (u: string) => open(u) } } }));

const { openHyperlink } = await import('./open-link');
const modal = (answer: 'yes' | 'no') => ({ confirm: vi.fn(async () => answer) }) as unknown as ModalApi & { confirm: ReturnType<typeof vi.fn> };

describe('openHyperlink', () => {
  beforeEach(() => open.mockClear());
  it('asks the first time, then opens the same address without asking again', async () => {
    const m = modal('yes');
    expect(await openHyperlink(m, 'https://example.com/a')).toBe(true);
    expect(await openHyperlink(m, ' https://example.com/a ')).toBe(true);
    expect(m.confirm).toHaveBeenCalledTimes(1);
    expect(m.confirm).toHaveBeenCalledWith(expect.objectContaining({ messageKey: 'hyperlink.open', params: { url: 'https://example.com/a' } }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith('https://example.com/a');
  });
  it('opens nothing when the user declines', async () => {
    expect(await openHyperlink(modal('no'), 'https://example.com/declined')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
  it('never asks, never opens, a file: address or any other scheme', async () => {
    const m = modal('yes');
    for (const bad of ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'ms-msdt:/id x', 'notepad.exe']) expect(await openHyperlink(m, bad), bad).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(m.confirm).toHaveBeenCalledTimes(4);   // the refusal message only
    expect(m.confirm).not.toHaveBeenCalledWith(expect.objectContaining({ messageKey: 'hyperlink.open' }));
  });
});

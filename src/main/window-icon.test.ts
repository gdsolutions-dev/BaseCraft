import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { join } from 'node:path';

const { createFromBuffer, app } = vi.hoisted(() => ({ createFromBuffer: vi.fn(), app: { isPackaged: false, getAppPath: () => '/app' } }));
vi.mock('electron', () => ({ app, nativeImage: { createFromBuffer } }));
import { defaultIconPath, setWindowIcon } from './window-icon';

/** A PNG header claiming a size (signature, IHDR length and type, width, height): all the main process reads before nativeImage. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer); v.setUint32(16, width); v.setUint32(20, height);
  return b;
}
const image = (width: number, height: number) => ({ isEmpty: () => width === 0, getSize: () => ({ width, height }) });
const onPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p });
const log = () => (globalThis as { __bcIconE2E?: { last: unknown } }).__bcIconE2E?.last;

describe('window icon', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const win = { setIcon: vi.fn() };
  const set = (p: Uint8Array | null) => setWindowIcon(win as unknown as BrowserWindow, p);
  // whatever the platform the tests run on (macOS applies nothing): win32 unless a test says otherwise
  beforeEach(() => { onPlatform('win32'); });
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform); vi.restoreAllMocks(); vi.unstubAllEnvs(); win.setIcon.mockReset(); createFromBuffer.mockReset();
    app.isPackaged = false; delete (process as { resourcesPath?: string }).resourcesPath; delete (globalThis as { __bcIconE2E?: unknown }).__bcIconE2E;
  });

  it('the default icon is the build resource', () => {
    expect(defaultIconPath()).toBe(join('/app', 'build/icon.png'));
    set(null);
    expect(win.setIcon).toHaveBeenCalledWith(defaultIconPath());
    expect(createFromBuffer).not.toHaveBeenCalled();
  });
  it('applies a small PNG; refuses an empty or a larger one, and one whose header claims more before decoding it', () => {
    createFromBuffer.mockReturnValue(image(64, 32));
    set(png(64, 32));
    expect(win.setIcon).toHaveBeenCalledWith(createFromBuffer.mock.results[0].value);
    for (const [claimed, read] of [[[64, 32], image(0, 0)], [[64, 32], image(300, 300)], [[256, 257], image(256, 257)]] as const) {
      createFromBuffer.mockReturnValue(read); win.setIcon.mockClear();
      expect(() => set(png(claimed[0], claimed[1]))).toThrow('bc:badIcon');
      expect(win.setIcon).not.toHaveBeenCalled();
    }
    createFromBuffer.mockClear();
    expect(() => set(png(30_000, 30_000))).toThrow('bc:badIcon');
    expect(createFromBuffer).not.toHaveBeenCalled(); // never decoded in the main process
    const noIhdr = png(64, 32); noIhdr[12] = 0x58; // a PNG signature, but the first chunk is no IHDR
    for (const bytes of [noIhdr, png(64, 32).slice(0, 20), new Uint8Array(40)]) expect(() => set(bytes)).toThrow('bc:badIcon');
    expect(createFromBuffer).not.toHaveBeenCalled();
  });
  it('logs what it chose for the e2e, unpackaged under BASECRAFT_E2E only', () => {
    set(null);
    expect(log()).toBeUndefined(); // no BASECRAFT_E2E
    vi.stubEnv('BASECRAFT_E2E', '1');
    createFromBuffer.mockReturnValue(image(64, 32));
    set(png(64, 32));
    expect(log()).toEqual({ width: 64, height: 32 });
    set(null);
    expect(log()).toBe('default');
    vi.stubEnv('BASECRAFT_E2E', '0');
    delete (globalThis as { __bcIconE2E?: unknown }).__bcIconE2E;
    set(null);
    expect(log()).toBeUndefined();
  });
  it('packaged: no e2e log even under BASECRAFT_E2E; the default icon is the package resource', () => {
    app.isPackaged = true;
    Object.defineProperty(process, 'resourcesPath', { value: '/res', configurable: true });
    vi.stubEnv('BASECRAFT_E2E', '1');
    expect(defaultIconPath()).toBe(join('/res', 'icon.png'));
    set(null);
    expect(win.setIcon).toHaveBeenCalledWith(join('/res', 'icon.png'));
    expect(log()).toBeUndefined();
    expect((globalThis as { __bcIconE2E?: unknown }).__bcIconE2E).toBeUndefined();
  });
  it('macOS has no window icon: nothing is applied, the e2e log is still written, a bad icon is still refused', () => {
    onPlatform('darwin');
    vi.stubEnv('BASECRAFT_E2E', '1');
    createFromBuffer.mockReturnValue(image(64, 32));
    set(png(64, 32));
    expect(log()).toEqual({ width: 64, height: 32 });
    set(null);
    expect(log()).toBe('default');
    expect(() => set(png(30_000, 30_000))).toThrow('bc:badIcon');
    expect(win.setIcon).not.toHaveBeenCalled();
  });
});

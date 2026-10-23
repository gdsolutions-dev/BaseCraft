import { describe, expect, it, vi } from 'vitest';
import { fileArg, handleOpenFile, openAll } from './open-file';

describe('fileArg', () => {
  it('finds the base argument', () => {
    expect(fileArg(['BaseCraft.exe', '--flag', 'C:\\d\\Ventes.BASECRAFT'])).toBe('C:\\d\\Ventes.BASECRAFT');
    expect(fileArg(['/Applications/BaseCraft.app/Contents/MacOS/BaseCraft', '-psn_0_12345'])).toBeNull();
    expect(fileArg(['BaseCraft.exe', '--x.basecraft', 'a.basecraft'])).toBe('a.basecraft');
  });
});

describe('handleOpenFile', () => {
  const deps = (has: boolean) => ({ hasBase: () => has, open: vi.fn(async () => {}), spawn: vi.fn() });
  it('opens here when empty, spawns otherwise', async () => {
    const a = deps(false);
    await handleOpenFile('a.basecraft', a);
    expect(a.open).toHaveBeenCalledWith('a.basecraft');
    expect(a.spawn).not.toHaveBeenCalled();
    const b = deps(true);
    await handleOpenFile('b.basecraft', b);
    expect(b.spawn).toHaveBeenCalledWith('b.basecraft');
    expect(b.open).not.toHaveBeenCalled();
  });
});

describe('openAll', () => {
  it('opens the first file here and spawns the others', async () => {
    let has = false;
    const open = vi.fn(async (_p: string) => {}), spawn = vi.fn();
    // like openBase: the base counts as open as soon as the open starts
    await openAll(['a.basecraft', 'b.basecraft', 'c.basecraft'], { hasBase: () => has, open: (p) => { has = true; return open(p); }, spawn });
    expect(open.mock.calls).toEqual([['a.basecraft']]);
    expect(spawn.mock.calls).toEqual([['b.basecraft'], ['c.basecraft']]);
  });
});

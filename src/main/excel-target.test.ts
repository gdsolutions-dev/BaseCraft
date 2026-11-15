import { describe, expect, it } from 'vitest';
import { checkExcelTarget } from './ipc-validate';

// E6b: the main-side guard rails of ExportWithFormatting (macro): refused before any file-system call.
const base = { content: 'enabled' as const, protectedPaths: ['C:\\data\\Base.basecraft'], platform: 'win32' as const };
const run = (path: string, o: Partial<Parameters<typeof checkExcelTarget>[1]> = {}) => {
  try { return { out: checkExcelTarget(path, { ...base, ...o }) }; } catch (e) { return { err: (e as Error).message }; }
};

describe('checkExcelTarget', () => {
  it.each([
    ['content disabled', 'C:\\out\\a.xlsx', { content: 'disabled' as const }, 'bc:contentDisabled'],
    ['content none', 'C:\\out\\a.xlsx', { content: 'none' as const }, 'bc:contentDisabled'],
    ['relative path', 'out\\a.xlsx', {}, 'bc:invalidArgument'],
    ['not .xlsx', 'C:\\out\\a.exe', {}, 'bc:invalidArgument'],
    ['stream', 'C:\\out\\a.exe:x.xlsx', {}, 'bc:invalidArgument'],
    ['device name', 'C:\\out\\CON.xlsx', {}, 'bc:invalidArgument'],
    ['device name 2', 'C:\\out\\nul.xlsx', {}, 'bc:invalidArgument'],
    ['device name with dots', 'C:\\out\\com1.a.xlsx', {}, 'bc:invalidArgument'],
    ['CONIN$', 'C:\\out\\CONIN$.xlsx', {}, 'bc:invalidArgument'],
    ['superscript device name', 'C:\\out\\com¹.xlsx', {}, 'bc:invalidArgument'],
    ['device name, space before the dot', 'C:\\out\\con .xlsx', {}, 'bc:invalidArgument'],
    ['root-relative device form', '\\?\\UNC\\host\\share\\a.xlsx', {}, 'bc:invalidArgument'],
    ['three backslashes (normalises to a root-relative path)', '\\\\\\host\\share\\a.xlsx', {}, 'bc:invalidArgument'],
    ['trailing dot', 'C:\\out\\a.xlsx.', {}, 'bc:invalidArgument'],
    ['trailing space', 'C:\\out\\a.xlsx ', {}, 'bc:invalidArgument'],
    ['\\\\?\\ device path', '\\\\?\\C:\\a.xlsx', {}, 'bc:invalidArgument'],
    ['\\\\.\\ device path', '\\\\.\\pipe\\x.xlsx', {}, 'bc:invalidArgument'],
    ['the open base, other case', 'C:\\DATA\\base.BASECRAFT', {}, 'bc:invalidArgument'],
    ['2000 characters', 'C:\\out\\' + 'a'.repeat(2000) + '.xlsx', {}, 'bc:invalidArgument'],
  ])('refuses %s', (_n, path, o, err) => { expect(run(path, o).err).toBe(err); });

  it('refuses the open base reached by a .. path', () => {
    expect(run('C:\\data\\x\\..\\Base.basecraft', { protectedPaths: ['C:\\data\\Base.basecraft'] }).err).toBe('bc:invalidArgument');
    expect(run('C:\\out\\x\\..\\..\\data\\b.xlsx', { protectedPaths: ['C:\\data\\B.XLSX'] }).err).toBe('bc:invalidArgument');
  });

  it('accepts a network path once the content is enabled, and returns it normalised', () => {
    const unc = '\\\\host\\share\\a.xlsx';
    expect(run(unc).out).toBe(unc);
    expect(run('//host/share/a.xlsx').out).toBe(unc);
    expect(run('\\/host/share/a.xlsx').out).toBe(unc);
    expect(run('Z:\\a.xlsx').out).toBe('Z:\\a.xlsx');
  });

  it('refuses a network path while the content is not enabled, before anything else', () => {
    for (const p of ['\\\\host\\share\\a.xlsx', '//host/share/a.xlsx', 'Z:\\a.xlsx']) expect(run(p, { content: 'disabled' }).err).toBe('bc:contentDisabled');
  });

  it('still refuses the open base and device names on a UNC path', () => {
    expect(run('\\\\host\\share\\Base.basecraft', { protectedPaths: ['\\\\host\\share\\base.basecraft'] }).err).toBe('bc:invalidArgument');
    for (const p of ['\\\\host\\share\\CON.xlsx', '\\\\host\\share\\a.exe:x.xlsx']) expect(run(p).err).toBe('bc:invalidArgument');
  });

  it('accepts and normalises a local path', () => {
    expect(run('C:\\out\\..\\out\\a.xlsx').out).toBe('C:\\out\\a.xlsx');
    expect(run('C:\\out\\a.XLSX').out).toBe('C:\\out\\a.XLSX');
  });

  it('refuses /dev, /proc and /sys on POSIX', () => {
    for (const p of ['/dev/shm/a.xlsx', '/proc/self/a.xlsx', '/sys/a.xlsx']) expect(run(p, { platform: 'linux' }).err).toBe('bc:invalidArgument');
    expect(run('/home/u/a:b.xlsx', { platform: 'linux' }).out).toBe('/home/u/a:b.xlsx');
  });
});

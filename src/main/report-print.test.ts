import { describe, expect, it, vi } from 'vitest';
import { printRequest } from './ipc-validate';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfFileName, replaceFile, resolvePrintRequest } from './report-print';

vi.mock('electron', () => ({}));

const id = '7d1f2c3a-0000-4000-8000-000000000001', docs = new Map([[id, '<p>x</p>']]);

describe('print protocol and requests', () => {
  it('serves known docs and whitelisted fonts only', () => {
    expect(resolvePrintRequest(`bc-print://doc/${id}`, docs)).toEqual({ kind: 'doc', html: '<p>x</p>' });
    expect(resolvePrintRequest('bc-print://doc/fonts/Carlito-Regular.ttf', docs)).toEqual({ kind: 'font', file: 'Carlito-Regular.ttf' });
    expect(resolvePrintRequest('bc-print://doc/fonts/Carlito%2DRegular.ttf', docs)).toEqual({ kind: 'font', file: 'Carlito-Regular.ttf' }); // decoded once
    for (const u of ['bc-print://doc/fonts/../../main/index.js', 'bc-print://doc/fonts/%2e%2e%2fx.ttf', 'bc-print://doc/fonts/a\\b.ttf', 'bc-print://doc/fonts/%5cCarlito-Regular.ttf',
      'bc-print://doc/fonts/evil.ttf', 'bc-print://doc/unknown', 'https://x/', 'bc-print://doc/fonts/x/Carlito-Regular.ttf',
      'bc-print://doc/fonts/%252e%252e%252fCarlito-Regular.ttf', 'bc-print://doc/fonts/Carlito-Regular.ttf?x', 'bc-print://doc/%E0%A4%A',
      'bc-print://other/' + id, `bc-print://doc/${id}/x`, 'bc-print://doc/fonts/__proto__', 'bc-print://doc/fonts/'])
      expect(resolvePrintRequest(u, docs), u).toBeNull();
  });

  it('pdf file name', () => {
    expect(pdfFileName('Factures: 2026/10 "T1"')).toBe('Factures_ 2026_10 _T1_.pdf');
    expect(pdfFileName('a\\b*c?d<e>f|g\u0001h\u007f')).toBe('a_b_c_d_e_f_g_h_.pdf');
    expect(pdfFileName('😀'.repeat(1024))).toBe(`${'😀'.repeat(200)}.pdf`); // a long external name: 200 characters kept
    // Windows refuses its device names (with or without an extension) and a name ending in a dot or a space (M4)
    for (const n of ['CON', 'nul', 'Com1', 'LPT9', 'aux.txt', 'PRN.']) expect(pdfFileName(n), n).toBe(`_${n.replace(/\.$/, '')}.pdf`);
    expect(pdfFileName('Factures. ')).toBe('Factures.pdf'); expect(pdfFileName('...')).toBe('_.pdf');
    expect(pdfFileName('Console')).toBe('Console.pdf'); expect(pdfFileName('COM10')).toBe('COM10.pdf');
  });

  it('validates print requests', () => {
    expect(printRequest({ html: '<p>x</p>', name: 'É', landscape: true })).toEqual({ html: '<p>x</p>', name: 'É', landscape: true });
    expect(() => printRequest({ html: 1, name: 'a', landscape: false })).toThrow(/invalidArgument/);
    expect(() => printRequest({ html: 'x', name: '', landscape: false })).toThrow(/invalidArgument/);
    expect(() => printRequest({ html: 'x', name: 'a'.repeat(1025), landscape: false })).toThrow(/invalidArgument/);
    expect(printRequest({ html: 'x', name: '😀'.repeat(1024), landscape: false }).name).toHaveLength(2048); // C8 lookupName: 1024 characters
    expect(() => printRequest({ html: 'x', name: 'a', landscape: 'yes' })).toThrow(/invalidArgument/);
    expect(() => printRequest({ html: 'x'.repeat(64 * 1024 ** 2 + 1), name: 'a', landscape: false })).toThrow(/invalidArgument/);
    for (const v of [null, 'x', [], { html: 'x', name: 'a' }]) expect(() => printRequest(v)).toThrow(/invalidArgument/);
  });
});

describe('replaceFile (final review I2)', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'bc-pdf-'));
  it('replaces the file through a sibling temp file', async () => {
    const d = dir(), path = join(d, 'Factures.pdf');
    writeFileSync(path, 'old');
    await replaceFile(path, new TextEncoder().encode('new'));
    expect(readFileSync(path, 'utf8')).toBe('new'); expect(readdirSync(d)).toEqual(['Factures.pdf']);
  });
  it('a failed write leaves the read-only file already there intact, and no temp file', async () => {
    const d = dir(), path = join(d, 'Factures.pdf');
    writeFileSync(path, 'archive'); chmodSync(path, 0o444);
    const fail = async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
    await expect(replaceFile(path, new Uint8Array([1]), fail)).rejects.toThrow('EPERM');
    expect(readFileSync(path, 'utf8')).toBe('archive'); expect(readdirSync(d)).toEqual(['Factures.pdf']);
    if (process.platform === 'win32') {   // Windows refuses to rename over a read-only file: the original stays, the temp goes
      await expect(replaceFile(path, new Uint8Array([1]))).rejects.toThrow();
      expect(readFileSync(path, 'utf8')).toBe('archive'); expect(readdirSync(d)).toEqual(['Factures.pdf']);
    }
    chmodSync(path, 0o666);
  });
});

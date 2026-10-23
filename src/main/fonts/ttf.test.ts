import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FONT_ALIASES, FONT_FILES, fontFile, type FontStyleKey } from '../../shared/fonts';
import { metricsOf, type FontMetrics } from '../../shared/font-metrics';
import { readMetrics } from './ttf';
import CAMBRIA from './cambria-advances.json';

const FONTS_DIR = fileURLToPath(new URL('../../renderer/public/fonts/', import.meta.url));
const JSON_PATH = fileURLToPath(new URL('../../shared/font-metrics.json', import.meta.url));

const allFiles = (): string[] => Object.values(FONT_FILES).flatMap((s) => Object.values(s));
const read = (f: string): Uint8Array => new Uint8Array(fs.readFileSync(FONTS_DIR + f));
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const sources = fs.readFileSync(FONTS_DIR + 'SOURCES.md', 'utf8');
const sourcesSha = (f: string): string | undefined =>
  sources.split('\n').find((l) => l.startsWith(`| ${f} |`))?.match(/\b[0-9a-f]{64}\b/)?.[0];
const stripVersion = ({ version: _, ...m }: FontMetrics & { version: string }): FontMetrics => m;
const adv = (m: FontMetrics, ch: string): number | null => {
  const cp = ch.codePointAt(0)!;
  const run = m.runs.find(([first, a]) => cp >= first && cp < first + a.length);
  return run ? run[1][cp - run[0]]! : null;
};

/** One line per file: diffs stay readable. */
const serialize = (table: Record<string, FontMetrics>): string =>
  '{\n' + Object.entries(table).map(([f, m]) => `${JSON.stringify(f)}:${JSON.stringify(m)}`).join(',\n') + '\n}\n';

describe('embedded TTF files', () => {
  const fresh = Object.fromEntries(allFiles().sort().map((f) => [f, stripVersion(readMetrics(read(f)))]));
  if (process.env.BC_WRITE_FONT_METRICS === '1') fs.writeFileSync(JSON_PATH, serialize(fresh));

  it('every embedded file matches SOURCES.md sha256, and nothing else is shipped', () => {
    expect(allFiles()).toHaveLength(24);
    expect(fs.readdirSync(FONTS_DIR).filter((f) => f.endsWith('.ttf')).sort()).toEqual(allFiles().sort());
    for (const f of allFiles()) expect(sha256(read(f)), f).toBe(sourcesSha(f));
  });

  it('metrics json is the parse of the files', () => {
    expect(JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))).toEqual(fresh); // parsed: a CRLF checkout (autocrlf) still passes
    for (const f of allFiles()) expect(metricsOf(f)).toEqual(fresh[f]);
  });

  it('metric compatibility', () => {
    const sans = readMetrics(read('LiberationSans-Regular.ttf'));
    expect(sans.upm).toBe(2048);
    expect(adv(sans, 'A')).toBe(1366);
    expect(adv(sans, ' ')).toBe(569); // = Arial
    const mono = readMetrics(read('LiberationMono-Regular.ttf'));
    for (let c = 0x20; c < 0x7f; c++) expect(adv(mono, String.fromCharCode(c))).toBe(1229); // = Courier New
  });

  // The Office fonts (C:\Windows\Fonts, Regular): line height = hhea ascender - descender + lineGap, then the advances
  // of 'A', ' ', '1', 'M', 'é'. Helvetica: Adobe AFM advances; Windows substitutes Arial for it, hence Arial's line height.
  const OFFICE: Record<string, [upm: number, lineHeight: number, advances: number[]]> = {
    Arial: [2048, 2355, [1366, 569, 1139, 1706, 1139]],
    Helvetica: [1000, 1150, [667, 278, 556, 833, 556]],
    'Times New Roman': [2048, 2355, [1479, 512, 1024, 1821, 909]],
    'Courier New': [2048, 2320, [1229, 1229, 1229, 1229, 1229]],
    Calibri: [2048, 2500, [1185, 463, 1038, 1751, 1019]],
    Cambria: [2048, 2401, [1276, 451, 1134, 1670, 999]],
  };
  /** The alias's embedded file has the Office line height and advances, to the thousandth of an em (the precision of a
   *  1000-unit font): same line breaks and same page breaks. */
  const keepsOfficeMetrics = (alias: string): void => {
    const [upm, lineHeight, office] = OFFICE[alias]!;
    const m = metricsOf(fontFile(alias, false, false));
    expect((m.ascender - m.descender + m.lineGap) / m.upm, `${alias} line height`).toBeCloseTo(lineHeight / upm, 3);
    [...'A 1Mé'].forEach((ch, i) => expect(adv(m, ch)! / m.upm, `${alias} '${ch}'`).toBeCloseTo(office[i]! / upm, 3));
  };

  it('every Office alias keeps the Office line height and advances', () => {
    for (const alias of Object.keys(FONT_ALIASES)) keepsOfficeMetrics(alias);
  });

  // C12: Caladea is the Crosextra 1.002 release. Each advance is Cambria's rounded to Caladea's 1000-unit grid (within half
  // a unit), in the four styles, except these pinned known exceptions (SOURCES.md, Notes).
  it('Cambria → Caladea keeps the Cambria line height and advances in every style, except the known exceptions', () => {
    const off: string[] = [];
    for (const [style, f] of Object.entries(FONT_FILES['Caladea']!) as [FontStyleKey, string][]) {
      const m = metricsOf(f);
      expect((m.ascender - m.descender + m.lineGap) / m.upm, `${f} line height`).toBeCloseTo(2401 / 2048, 3);
      CAMBRIA.codePoints.forEach((cp, i) => {
        if (Math.abs(adv(m, String.fromCodePoint(cp))! - (CAMBRIA[style][i]! * m.upm) / 2048) > 0.5) off.push(`${f} ${hex(cp)}`);
      });
    }
    expect(off).toEqual([
      'Caladea-Italic.ttf U+00AD',
      ...['0024', '0060', '00A8', '00AD', '00AF', '00B4', '00B7', '00B8', '00BC', '00BE', '00D0']
        .map((cp) => `Caladea-BoldItalic.ttf U+${cp}`),
    ]);
  });

  it('printable ASCII, Latin-1, €, NBSP and U+202F are mapped in every file, except the known gaps', () => {
    const cps = [...range(0x20, 0x7e), ...range(0xa0, 0xff), 0x20ac, 0x202f];
    const missing = allFiles().flatMap((f) => cps.filter((cp) => adv(metricsOf(f), String.fromCodePoint(cp)) === null)
      .map((cp) => `${f} ${hex(cp)}`));
    // The pinned files lack exactly these (SOURCES.md, Notes); the measurer must handle them.
    const lacks = (families: string[], cp: string) => families.flatMap((fam) => Object.values(FONT_FILES[fam]!).map((f) => `${f} ${cp}`));
    expect(missing.sort()).toEqual([...lacks(['Carlito', 'Inter'], 'U+00AD'), ...lacks(['Caladea', 'Liberation Mono'], 'U+202F')].sort());
  });

  it('runs are sorted, maximal and within the BMP', () => {
    for (const f of allFiles()) {
      let next = 0;
      for (const [first, a] of metricsOf(f).runs) {
        expect(first).toBeGreaterThanOrEqual(next);
        expect(a.length).toBeGreaterThan(0);
        next = first + a.length + 1; // consecutive runs are merged
      }
      expect(next - 1).toBeLessThanOrEqual(0x10000);
    }
  });

  it('reads the version from the name table', () => {
    expect(readMetrics(read('LiberationSans-Regular.ttf')).version).toMatch(/^Version 2\.1\.5/);
    expect(readMetrics(read('Inter-Regular.ttf')).version).toMatch(/^Version 4\.001/); // release v4.1
  });

  it('rejects a truncated file', () => {
    expect(() => readMetrics(read('LiberationSans-Regular.ttf').slice(0, 100))).toThrow('bad font');
    expect(() => readMetrics(new Uint8Array(0))).toThrow('bad font');
  });

  it('rejects a file with a missing table', () => {
    const b = read('LiberationSans-Regular.ttf');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0, n = dv.getUint16(4); i < n; i++) {
      const at = 12 + 16 * i;
      if (String.fromCharCode(...b.subarray(at, at + 4)) === 'hmtx') b.set([120, 120, 120, 120], at); // tag 'xxxx'
    }
    expect(() => readMetrics(b)).toThrow('bad font');
  });

  it('metricsOf refuses an unknown file', () => expect(() => metricsOf('Nope.ttf')).toThrow());
});

function hex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultSpec } from '../../shared/import-text';
import { localeInfo } from '../../shared/locale-format';
import {
  detectDelimiter, detectEncoding, detectFormat, proposeBreaks, QUOTED_MAX_CHARS, QUOTED_MAX_LINES, readRecords, recordSplitter, sliceFixed, sniffEncoding,
  type Rec,
} from './text-parse';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bctp-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const file = (name: string, data: Buffer | string) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return p; };

/** Découpe `text` en morceaux de `size` caractères (frontières de bloc au milieu des cas difficiles). */
function split(text: string, delim = ',', qual = '"', size = text.length || 1): string[][] {
  const out: string[][] = [];
  const s = recordSplitter(delim, qual);
  for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size), out);
  s.end(out);
  return out;
}

describe('delimited records (RFC 4180)', () => {
  const cases: [string, string, string[][]][] = [
    ['plain', 'a,b\nc,d', [['a', 'b'], ['c', 'd']]],
    ['quoted delimiter', '"a,1",b', [['a,1', 'b']]],
    ['doubled qualifier', '"say ""hi""",x', [['say "hi"', 'x']]],
    ['embedded newline', '"l1\r\nl2",x\ny,z', [['l1\r\nl2', 'x'], ['y', 'z']]],
    ['trailing delimiter', 'a,b,\n', [['a', 'b', '']]],
    ['empty fields', ',,\n"",x', [['', '', ''], ['', 'x']]],
    ['CRLF', 'a\r\nb\r\n', [['a'], ['b']]],
    ['CR only', 'a\rb\r', [['a'], ['b']]],
    ['blank lines skipped', 'a\n\n\nb', [['a'], ['b']]],
    ['qualifier inside a field is literal', 'ab"c,d', [['ab"c', 'd']]],
    ['empty input', '', []],
  ];
  for (const [name, text, want] of cases) {
    it(name, () => {
      expect(split(text)).toEqual(want);
      expect(split(text, ',', '"', 1)).toEqual(want); // one character per chunk
    });
  }
  it('a line made of one quoted empty field is a record', () => expect(split('a\n""\nb')).toEqual([['a'], [''], ['b']]));
  it('records carry their first physical line', () => {
    const out: Rec[] = [];
    const s = recordSplitter(',', '"');
    s.push('a\r\n"x\ny",b\n\nc', out);
    s.end(out);
    expect(out.map((r) => r.line)).toEqual([1, 2, 5]);
  });
  it('unclosed qualifier at the end: the quote becomes data, the record is flagged, nothing is swallowed', () => {
    const cases: [string, string[][]][] = [
      ['Nom;Desc\nA;"bad\nB;ok\nC;ok', [['Nom', 'Desc'], ['A', '"bad'], ['B', 'ok'], ['C', 'ok']]], // never closed
      ['Nom;Desc\nA;"bad\nB;ok\nC;"fine"', [['Nom', 'Desc'], ['A', '"bad'], ['B', 'ok'], ['C', 'fine']]], // closed by another field's quote
    ];
    for (const [text, want] of cases) {
      for (const size of [1, 1000]) {
        const out: Rec[] = [];
        const s = recordSplitter(';', '"');
        for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size), out);
        s.end(out);
        expect(out.map((r) => [...r])).toEqual(want);
        expect(out.map((r) => r.unclosed ?? false)).toEqual([false, true, false, false]);
        expect(out.map((r) => r.line)).toEqual([1, 2, 3, 4]);
      }
    }
  });
  it(`a quoted field is bounded (${QUOTED_MAX_LINES} lines): the rest of the file is still read`, () => {
    const out: Rec[] = [];
    const s = recordSplitter(';', '"');
    s.push('A;"x\n' + 'l;m\n'.repeat(QUOTED_MAX_LINES + 200) + 'Z;"o""k"\n', out);
    expect(out[0]).toEqual(['A', '"x']);
    expect(out[0].unclosed).toBe(true);
    expect(out).toHaveLength(QUOTED_MAX_LINES + 202); // the cap is hit before the end: no end() needed
    expect([...out[out.length - 1]]).toEqual(['Z', 'o"k']);
    expect(out[out.length - 1].line).toBe(QUOTED_MAX_LINES + 202);
  });
  it('a quoted field is bounded in characters too', () => {
    const out: Rec[] = [];
    const s = recordSplitter(';', '"');
    s.push('A;"' + ('x'.repeat(1000) + ';').repeat(1100) + 'y\nB;z\n', out); // over 1 MiB on one line, read again unqualified
    expect(out.map((r) => [r.length, r.unclosed ?? false])).toEqual([[1102, true], [2, false]]);
    expect(() => recordSplitter(';', '"').push('A;"' + 'x'.repeat(QUOTED_MAX_CHARS + 10), [])).toThrow('bc:fieldTooLong'); // no delimiter in it
  });
  it('an unquoted field over the same bound is a typed error, never a raw one', () => {
    const s = recordSplitter(';', '"');
    expect(() => s.push('a;' + 'x'.repeat(QUOTED_MAX_CHARS + 1), [])).toThrow('bc:fieldTooLong');
    expect(() => recordSplitter('', '').push('y'.repeat(QUOTED_MAX_CHARS + 1), [])).toThrow('bc:fieldTooLong'); // a fixed-width line
  });
  it('no qualifier: quotes are data', () => expect(split('"a,b"', ',', '')).toEqual([['"a', 'b"']]));
  it('single quote qualifier', () => expect(split("'a;b';c", ';', "'")).toEqual([['a;b', 'c']]));
});

describe('fixed width', () => {
  const lines = ['Dupont    Paris     12', 'Martin    Lyon      345', 'Lé        Nice        '];
  it('proposes breaks after whitespace columns', () => expect(proposeBreaks(lines)).toEqual([10, 20]));
  it('slices and trims by character', () => expect(sliceFixed(lines[2], [10, 20])).toEqual(['Lé', 'Nice', '']));
  it('detects the format', () => expect(detectFormat(lines)).toEqual({ format: 'fixed', delimiter: ',', breaks: [10, 20] }));
});

describe('delimiter detection', () => {
  it('semicolon with French decimals', () => expect(detectDelimiter('a;b;c\n1,5;2;3\n4,25;5;6', '"')).toBe(';'));
  it('comma', () => expect(detectDelimiter('a,b\n1,2\n3,4', '"')).toBe(','));
  it('tab', () => expect(detectDelimiter('a\tb\n1\t2', '"')).toBe('\t'));
  it('nothing regular', () => expect(detectDelimiter('hello\nworld', '"')).toBeNull());
});

describe('encoding', () => {
  const text = 'Quantité;Prix (€)\n';
  it('UTF-8 without BOM', () => expect(sniffEncoding(file('u8.csv', Buffer.from(text, 'utf8')))).toBe('utf-8'));
  it('UTF-8 with BOM', () => expect(sniffEncoding(file('u8b.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])))).toBe('utf-8'));
  it('UTF-16 LE with BOM', () => expect(sniffEncoding(file('u16.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])))).toBe('utf-16le'));
  it('Windows-1252 (é = E9, € = 80)', () => {
    const p = file('w.csv', Buffer.from([0x51, 0x75, 0x61, 0x6e, 0x74, 0x69, 0x74, 0xe9, 0x3b, 0x80, 0x0a]));
    expect(sniffEncoding(p)).toBe('windows-1252');
    const spec = { ...defaultSpec(localeInfo('fr-FR')), delimiter: ';' };
    expect([...readRecords(p, { spec, encoding: 'windows-1252' })]).toEqual([['Quantité', '€']]);
  });
  it('BOM wins', () => expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x41, 0]), true)).toBe('utf-16le'));
  it('decodes UTF-8 without mojibake and drops the BOM', () => {
    const p = file('m.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Quantité vendue,Prix unitaire (€)\n2,"12,5"\n')]));
    const spec = defaultSpec(localeInfo('fr-FR'));
    expect([...readRecords(p, { spec, encoding: 'utf-8' })]).toEqual([['Quantité vendue', 'Prix unitaire (€)'], ['2', '12,5']]);
  });
  it('reads a file larger than one chunk, multibyte characters across chunk ends', () => {
    const line = 'é€,ü\n';
    const p = file('big.csv', line.repeat(300000)); // ~2.4 MB
    const spec = defaultSpec(localeInfo('fr-FR'));
    let n = 0;
    for (const r of readRecords(p, { spec, encoding: 'utf-8' })) { if (r[0] !== 'é€' || r[1] !== 'ü') throw new Error(`bad ${r}`); n++; }
    expect(n).toBe(300000);
  });
});

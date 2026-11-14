import fs from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blockBytes, parseAccessText, type AccessBlock } from './access-text';

const fixture = (f: string) => fs.readFileSync(join(__dirname, '../../tests/fixtures/access/Ventes-complet.export', f), 'utf8');

describe('parseAccessText', () => {
  it('reads the fixture form', () => {
    const t = parseAccessText(fixture('forms/1.txt'));
    expect(t.root.type).toBe('Form');
    expect(t.root.props.get('RecordSource')).toBe('Clients');
    expect(t.root.props.get('Width')).toBe(11838);
    expect(t.root.props.get('DividingLines')).toEqual({ notDefault: true });
    expect(t.header.get('Version')).toBe(21);
    expect(t.code).toContain('Private Sub Form_Current()');
    expect(t.unread).toBe(0);
    const [defaults] = t.root.blocks; // the bare Begin: default blocks, then sections
    expect(defaults.type).toBe('');
    expect(defaults.blocks.map((b) => b.type)).toEqual(['Label', 'Image', 'CommandButton', 'CheckBox', 'TextBox', 'ComboBox', 'Subform', 'Attachment', 'EmptyCell', 'FormHeader', 'Section', 'FormFooter']);
  });
  it('reads the fixture report', () => {
    const t = parseAccessText(fixture('reports/1.txt'));
    expect(t.root.type).toBe('Report');
    const all = (b: AccessBlock): AccessBlock[] => [b, ...b.blocks.flatMap(all)];
    expect(all(t.root).filter((b) => b.type === 'BreakLevel').map((b) => b.props.get('ControlSource'))).toEqual(['Client', 'Lot']);
    expect(all(t.root).some((b) => b.props.get('ControlSource') === '="Page " & [Page] & " sur " & [Pages]')).toBe(true);
  });
  it('strings: escapes and continuation lines', () => {
    const t = parseAccessText('Begin Form\n  Caption ="a\\"b\\\\c\\015\\012d"\n      "e"\n  Tag =""\nEnd\n');
    expect(t.root.props.get('Caption')).toBe('a"b\\c\r\nde');
    expect(t.root.props.get('Tag')).toBe('');
  });
  it('property blocks: hex and nested', () => {
    const t = parseAccessText('Begin Form\n  GUID = Begin\n    0x0a0b ,\n    0xff\n  End\n  OnClickEmMacro = Begin\n    Version =196611\n    Begin\n      Action ="Beep"\n    End\n  End\n  Width =5\nEnd\n');
    expect(blockBytes(t.root.props.get('GUID'))).toEqual(new Uint8Array([10, 11, 255]));
    expect(blockBytes(t.root.props.get('OnClickEmMacro'))).toBeNull();
    expect(t.root.props.get('Width')).toBe(5); // the nested End did not close the form
  });
  it('names are data', () => {
    const t = parseAccessText('Begin Form\n  __proto__ =1\n  constructor ="x"\nEnd\n');
    expect(t.root.props.get('__proto__')).toBe(1);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it.each([['', 'noRoot'], ['Version =21\n', 'noRoot'], ['Begin Form\n Begin Label\n', 'unbalanced'], ['Begin Form\nEnd\nEnd\n', 'unbalanced'],
    [`${'Begin Form\n'}${'Begin\n'.repeat(60)}${'End\n'.repeat(61)}`, 'tooDeep']])('refuses %#', (text, code) => {
    expect(() => parseAccessText(text)).toThrow(expect.objectContaining({ code }));
  });
  it('refuses a text over the limit', () => {
    expect(() => parseAccessText(' '.repeat(16_777_217))).toThrow(expect.objectContaining({ code: 'tooLong' }));
  });
  it('a line of no known shape is counted, a CRLF file and a BOM are read', () => {
    const t = parseAccessText('﻿Begin Report\r\n  ???\r\n  Width =7\r\nEnd\r\n');
    expect(t.unread).toBe(1);
    expect(t.root.props.get('Width')).toBe(7);
  });
  it('a nested property block opened by X = Begin is balanced', () => {
    const t = parseAccessText('Begin Form\n A = Begin\n  B = Begin\n   0x01\n  End\n End\n Width =5\nEnd\n');
    expect(t.root.props.get('Width')).toBe(5);
    expect(t.root.props.get('A')).toEqual({ lines: ['B = Begin', '0x01', 'End'] });
  });
  it('a stray top-level block after the root is skipped whole, a code-behind line after it still starts code', () => {
    const t = parseAccessText('Begin Form\n Width =5\nEnd\nBegin Foo\n X =1\nEnd\n');
    expect(t.root.props.get('Width')).toBe(5);
    expect(t.unread).toBe(3);
    const c = parseAccessText('Begin Form\n Width =5\nEnd\nBegin Foo\n X =1\n Begin Bar\n End\nEnd\nCodeBehindForm\nOption Compare Database\n');
    expect(c.unread).toBe(5);
    expect(c.code).toBe('Option Compare Database\n');
  });
  it('a dotAll-sensitive property keeps U+2028 inside its string', () => {
    const t = parseAccessText('Begin Form\n Caption ="a\u2028b"\nEnd\n');
    expect(t.root.props.get('Caption')).toBe('a\u2028b');
    expect(t.unread).toBe(0);
  });
  it('code after a report is kept', () => {
    const t = parseAccessText('Begin Report\n Width =1\nEnd\nCodeBehindReport\nOption Compare Database\n');
    expect(t.code).toContain('Option Compare Database');
  });
  it('a property written twice keeps the last value', () => {
    const t = parseAccessText('Begin Form\n Width =1\n Width =2\nEnd\n');
    expect(t.root.props.get('Width')).toBe(2);
  });
  it('an octal escape decodes', () => {
    const t = parseAccessText('Begin Form\n Caption ="\\101"\nEnd\n');
    expect(t.root.props.get('Caption')).toBe('A');
  });
});

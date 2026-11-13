import { expect, it } from 'vitest';
import { defaultProps, type FieldType } from './field-types';
import type { SourceField } from './record-source';
import { htmlText, xmlName, xmlRow, xmlText, xmlUnname, xmlValue } from './export-markup';

const f = (name: string, type: FieldType): SourceField => ({ name, type, props: defaultProps(type) });

it('names are escaped as Access does and read back', () => {
  expect(xmlName('Order Date')).toBe('Order_x0020_Date');
  expect(xmlName('1st')).toBe('_x0031_st');
  expect(xmlName('N°')).toBe('N_x00B0_');
  expect(xmlName('Prénom')).toBe('Prénom');
  expect(xmlName('a<b>&')).toBe('a_x003C_b_x003E__x0026_');
  expect(xmlName('')).toBe('_x0020_');
  for (const n of ['Order Date', '1st', 'N°', 'a<b>&"\'', '😀 x']) expect(xmlUnname(xmlName(n))).toBe(n);
});
it('text is escaped and illegal characters dropped', () => {
  expect(xmlText('a & <b> "c"\u0001\u0000')).toBe('a &amp; &lt;b&gt; "c"');
  expect(htmlText(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});
it('values: ISO dates, 1/0, null omitted', () => {
  expect(xmlValue('2026-01-15', f('D', 'dateTime'))).toBe('2026-01-15T00:00:00');
  expect(xmlValue('2026-01-15 08:09:10', f('D', 'dateTime'))).toBe('2026-01-15T08:09:10');
  expect(xmlValue(1, f('B', 'yesNo'))).toBe('1');
  expect(xmlValue(0, f('B', 'yesNo'))).toBe('0');
  expect(xmlValue(12.5, f('N', 'number'))).toBe('12.5');
  expect(xmlValue(null, f('N', 'number'))).toBeUndefined();
  expect(xmlRow('T', [f('A b', 'shortText'), f('C', 'shortText')], ['x<y', null])).toBe('<T>\r\n<A_x0020_b>x&lt;y</A_x0020_b>\r\n</T>\r\n');
});

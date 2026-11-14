import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { THEME_SLOTS } from '../shared/design/theme';
import { readThmx } from './thmx';

const clr = (s: string, v: string) => `<a:${s}><a:srgbClr val="${v}"/></a:${s}>`;
const THEME_XML = `<?xml version="1.0"?><a:theme xmlns:a="x" name="Mon &amp; Thème"><a:themeElements><a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
${clr('dk2', '44546A')}${clr('lt2', 'E7E6E6')}${['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'].map((v, i) => clr(`accent${i + 1}`, v)).join('')}${clr('hlink', '0563C1')}${clr('folHlink', '954F72')}
</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

async function thmx(xml: string | null): Promise<string> {
  const z = new JSZip();
  if (xml !== null) z.file('theme/theme/theme1.xml', xml);
  const p = join(mkdtempSync(join(tmpdir(), 'thmx-')), 't.thmx');
  writeFileSync(p, await z.generateAsync({ type: 'nodebuffer' }));
  return p;
}

describe('readThmx', () => {
  it('reads the 12 colours and the fonts', async () => {
    const t = await readThmx(await thmx(THEME_XML));
    expect(t.name).toBe('Mon & Thème');
    expect(t.colors.light.accent1).toBe('#4472c4');
    expect(t.colors.light.dk1).toBe('#000000');
    expect(t.colors.light.lt1).toBe('#ffffff');
    expect(THEME_SLOTS.every((s) => /^#[0-9a-f]{6}$/.test(t.colors.dark[s]))).toBe(true);
    expect(t.fonts).toMatchObject({ major: 'Calibri Light', minor: 'Calibri' });
  });
  it('rejects a zip without theme, a missing colour, and a non-zip', async () => {
    await expect(readThmx(await thmx(null))).rejects.toThrow('bc:invalidThemeFile');
    await expect(readThmx(await thmx(THEME_XML.replace('accent3', 'accentX')))).rejects.toThrow('bc:invalidThemeFile');
    const p = join(mkdtempSync(join(tmpdir(), 'thmx-')), 'x.thmx');
    writeFileSync(p, 'not a zip');
    await expect(readThmx(p)).rejects.toThrow('bc:invalidThemeFile');
  });
});

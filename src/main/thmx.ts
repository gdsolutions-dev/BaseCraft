// Office .thmx theme (a zip): the colour and font schemes of theme/theme/theme1.xml become a BaseCraft Theme.
// jszip is a direct dependency (it also reads and writes .xlsx); no XML parser: the scheme elements are flat, a regex reads them.
import { readFileSync, statSync } from 'node:fs';
import JSZip from 'jszip';
import { deriveDark, THEME_SLOTS, type Palette, type Theme } from '../shared/design/theme';

const MAX_BYTES = 10 * 1024 * 1024;
const XML = 'theme/theme/theme1.xml';
// <a:accent1><a:srgbClr val="4472C4"/></a:accent1>, or <a:sysClr val="windowText" lastClr="000000"/> for dk1/lt1.
const slotHex = (xml: string, slot: string): string | null => {
  const m = new RegExp(`<a:${slot}>\s*<a:(?:srgbClr val|sysClr [^>]*?lastClr)="([0-9A-Fa-f]{6})"`).exec(xml);
  return m ? `#${m[1]!.toLowerCase()}` : null;
};
const xmlText = (s: string): string => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]!);

/** Throws bc:invalidThemeFile when the file is not a readable .thmx. */
export async function readThmx(path: string): Promise<Theme> {
  try {
    if (statSync(path).size > MAX_BYTES) throw new Error('too big');
    const xml = await (await JSZip.loadAsync(readFileSync(path))).file(XML)?.async('string');
    if (!xml) throw new Error('no theme');
    const light = {} as Palette;
    for (const s of THEME_SLOTS) { const h = slotHex(xml, s); if (!h) throw new Error(`no ${s}`); light[s] = h; }
    const nameOf = (tag: string): string | null => { const m = new RegExp(`<${tag}\\b[^>]*?\\bname="([^"]*)"`).exec(xml); return m ? xmlText(m[1]!).trim() : null; };
    const latin = (tag: string): string => { const m = new RegExp(`<a:${tag}>\s*<a:latin typeface="([^"]+)"`).exec(xml); if (!m) throw new Error('no font'); return xmlText(m[1]!); };
    const name = (nameOf('a:theme') || nameOf('a:clrScheme') || 'Office').slice(0, 60);
    return { name, colors: { name: nameOf('a:clrScheme') || name, light, dark: deriveDark(light) }, fonts: { name: nameOf('a:fontScheme') || name, major: latin('majorFont'), minor: latin('minorFont') } };
  } catch { throw new TypeError('bc:invalidThemeFile'); }
}

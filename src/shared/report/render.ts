// Rendu HTML/CSS positionné d'un état mis en page (pur) : le navigateur dessine ce que le moteur a calculé, sans rien
// paginer ni couper. Longueurs en pt (twips / 20), polices embarquées seulement, thème clair, aucune URL hors fonts/ et
// data:image/, tout texte et tout attribut échappé.
import { cssFamily, cssString, fontFaceCss, resolveFont } from '../fonts';
import { lineHeight } from './text';
import type { Border, FontSpec, LaidOutItem, LaidOutPage, LaidOutReport } from './types';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Twips → pt, in plain decimal notation (twips are integers: two decimals at most). */
const pt = (twips: number): string => `${Number((twips / 20).toFixed(2))}pt`;
const box = (left: number, top: number, width: number, height: number) => `left:${pt(left)};top:${pt(top)};width:${pt(width)};height:${pt(height)}`;
/** Layout resolves colours to #rrggbb; anything else never reaches CSS. */
const hex = (c: string | null): string | null => c !== null && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
const back = (c: string | null) => { const h = hex(c); return h ? `;background:${h}` : ''; };
const STYLES = ['solid', 'dashed', 'dotted'];
const stroke = (b: Border) => `${pt(b.width)} ${STYLES.includes(b.style) ? b.style : 'solid'} ${hex(b.color) ?? '#000000'}`;
/** A number written raw (attribute, SVG): never anything but a number, even from a model that did not come from layout. */
const n = (v: number): string => String(Number(v));

/** The embedded face the engine measured: a non-portable font draws in Liberation Sans, even when it is installed, so
 *  drawing matches measuring (final review M1; fontNotPortable says so). */
function fontCss(f: FontSpec): string {
  const r = resolveFont(f.name);
  const family = cssString(cssFamily(r.portable ? r.family : 'Liberation Sans'));
  return `font-family:${family};font-size:${Number(Number(f.size).toFixed(2))}pt;font-weight:${f.bold ? 700 : 400};font-style:${f.italic ? 'italic' : 'normal'}`;
}

const OBJECT_FIT = { clip: 'none', stretch: 'fill', zoom: 'contain' } as const;

/** Print document only: the class of each distinct look (`;prop:value…`). The preview writes looks inline and keeps the
 *  model in data-* attributes (its tests read them); the print document leaves both out (the 64 Mi IPC cap, I3). */
type Looks = Map<string, string>;
const attrs = (base: string, where: string, look: string, looks?: Looks): string => {
  if (!looks || !look) return `class="${base}" style="${esc(where + look)}"`;
  let c = looks.get(look);
  if (c === undefined) looks.set(look, c = `c${looks.size}`);
  return `class="${base} ${c}"${where ? ` style="${where}"` : ''}`;
};
const data = (looks: Looks | undefined, a: Record<string, string>) => (looks ? '' : Object.entries(a).map(([k, v]) => ` data-${k}="${v}"`).join(''));

function item(i: LaidOutItem, looks?: Looks): string {
  switch (i.kind) {
    case 'text': {
      const lh = `;line-height:${pt(lineHeight(i.font))}${i.font.underline ? ';text-decoration:underline' : ''}`;
      // the lines are wrap()'s, drawn verbatim: they already carry the substituted characters (C12)
      // print: a line at 0 leaves its left or top to .bc-line's
      const lines = i.lines.map((l) => looks ? `<span ${attrs('bc-line', [l.x ? `left:${pt(l.x)}` : '', l.y ? `top:${pt(l.y)}` : ''].filter(Boolean).join(';'), lh, looks)}>${esc(l.text)}</span>`
        : `<span class="bc-line"${data(looks, { x: n(l.x), y: n(l.y), w: n(l.width) })} style="left:${pt(l.x)};top:${pt(l.y)}${lh}">${esc(l.text)}</span>`);
      return `<div ${attrs('bc-text', box(i.left, i.top, i.width, i.height), `${i.border ? `;border:${stroke(i.border)}` : ''}${back(i.back)}`
        + `;color:${hex(i.color) ?? '#000000'};${fontCss(i.font)}`, looks)}>${lines.join('')}</div>`;
    }
    case 'check': {
      const side = Math.min(i.width, i.height), color = hex(i.color) ?? '#000000';
      const tick = i.checked ? `<svg viewBox="0 0 10 10" width="100%" height="100%"><path d="M2 5.2l2.1 2.1L8 3" fill="none" stroke="${color}" stroke-width="1.4"/></svg>` : '';
      return `<div ${attrs('bc-check', box(i.left, i.top, side, side), `;border:${stroke({ width: 15, color, style: 'solid' })}`, looks)}>${tick}</div>`;
    }
    case 'line': {
      const left = Math.min(i.x1, i.x2), top = Math.min(i.y1, i.y2), w = Math.abs(i.x2 - i.x1), h = Math.abs(i.y2 - i.y1);
      if (h === 0) return `<div ${attrs('bc-rule', box(left, top, w, 0), `;border-top:${stroke(i.border)}`, looks)}></div>`;
      if (w === 0) return `<div ${attrs('bc-rule', box(left, top, 0, h), `;border-left:${stroke(i.border)}`, looks)}></div>`;
      // slanted: an SVG over its bounding box, in twips (viewBox) so nothing is converted
      const bw = n(i.border.width), dash = i.border.style === 'dashed' ? ` stroke-dasharray="${n(4 * i.border.width)} ${n(2 * i.border.width)}"` : i.border.style === 'dotted' ? ` stroke-dasharray="${bw} ${bw}"` : '';
      return `<svg class="bc-rule" style="${box(left, top, w, h)}" viewBox="0 0 ${n(w)} ${n(h)}" preserveAspectRatio="none"><line x1="${n(i.x1 - left)}" y1="${n(i.y1 - top)}" `
        + `x2="${n(i.x2 - left)}" y2="${n(i.y2 - top)}" stroke="${hex(i.border.color) ?? '#000000'}" stroke-width="${bw}"${dash}/></svg>`;
    }
    case 'rect':
      return `<div ${attrs('bc-rect', box(i.left, i.top, i.width, i.height), `${i.border ? `;border:${stroke(i.border)}` : ''}${back(i.back)}`, looks)}></div>`;
    case 'image':
      if (!i.src.startsWith('data:image/')) return '';
      return `<img class="bc-img" alt="" src="${esc(i.src)}" style="${box(i.left, i.top, i.width, i.height)};object-fit:${Object.hasOwn(OBJECT_FIT, i.sizeMode) ? OBJECT_FIT[i.sizeMode] : 'contain'}">`;
  }
}

/** One self-contained `.bc-page`; every page but the last breaks after itself. `looks`: the print document's classes. */
export function renderPageHtml(page: LaidOutPage, report: LaidOutReport, looks?: Looks): string {
  const last = page.number === report.pages[report.pages.length - 1]?.number;
  const bands = page.bands.map((b) => `<div class="bc-band"${data(looks, { section: esc(b.section), top: n(b.top), height: n(b.height) })} `
    + `style="${box(b.left, b.top, b.width, b.height)}${back(b.back)}">${b.items.map((i) => item(i, looks)).join('')}</div>`);
  return `<div class="bc-page"${data(looks, { page: n(page.number) })} style="width:${pt(report.width)};height:${pt(report.height)}${last ? '' : ';break-after:page'}">${bands.join('')}</div>`;
}

/** @font-face of the faces the report uses (a non-portable font draws in Liberation Sans, as measured) and the .bc-* rules. */
export function reportCss(report: LaidOutReport, fontBaseUrl: string): string {
  const faces = report.pages.flatMap((p) => p.bands.flatMap((b) => b.items.flatMap((i) => i.kind === 'text' ? [{ family: i.font.name, bold: i.font.bold, italic: i.font.italic }] : [])));
  return [fontFaceCss(faces, fontBaseUrl),
    '.bc-page{position:relative;overflow:hidden;background:#ffffff;color:#000000;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    // a cut band part can hold items above its top or past its bottom: the band clips them
    '.bc-band{position:absolute;overflow:hidden}',
    '.bc-text,.bc-check,.bc-rule,.bc-rect,.bc-img{position:absolute;box-sizing:border-box;margin:0}',
    '.bc-text,.bc-check{overflow:hidden}.bc-rule{overflow:visible}.bc-check svg{display:block}',
    '.bc-text{font-kerning:none;font-variant-ligatures:none;font-feature-settings:"kern" 0,"liga" 0,"calt" 0;font-synthesis:none}',
    '.bc-line{position:absolute;left:0;top:0;white-space:pre}',
  ].filter(Boolean).join('\n');
}

/** The whole document for the print window: A4 pages, fonts under fonts/, light background. */
export function renderDocumentHtml(report: LaidOutReport): string {
  const size = report.width > report.height ? '297mm 210mm' : '210mm 297mm';
  const looks: Looks = new Map(), body = report.pages.map((p) => renderPageHtml(p, report, looks)).join('\n');
  // a look holds only numbers, #rrggbb and escaped font names; `<` escaped all the same: nothing closes the <style>
  const classes = [...looks].map(([look, c]) => `.${c}{${look.slice(1).replace(/</g, '\\3c ')}}`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: ${size}; margin: 0 }\n${reportCss(report, 'fonts/')}\n`
    + `html,body{margin:0;background:#ffffff}\n${classes}</style></head><body>${body}</body></html>`;
}

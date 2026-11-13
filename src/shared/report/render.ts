// Rendu HTML/CSS positionné d'un état mis en page (pur) : le navigateur dessine ce que le moteur a calculé, sans rien
// paginer ni couper. Longueurs en pt (twips / 20), polices embarquées seulement, thème clair, aucune URL hors fonts/ et
// data:image/, tout texte et tout attribut échappé.
import { cssFamily, cssString, fontFaceCss, resolveFont } from '../fonts';
import { sanitizeRich } from '../rich-text';
import { PAPERS } from './model';
import { lineHeight } from './text';
import { chartFrame, chartOption } from '../chart/option';
import { chartSvg } from '../chart/svg';
import { objectPosition, pictureCss } from '../design/picture-css';
import type { Border, FontSpec, Gridlines, LaidOutItem, LaidOutPage, LaidOutReport } from './types';

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

/** The gridline overlay: a sibling box over the cell rectangle (the control grown by its padding), only its drawn sides bordered. */
function gridHtml(i: LaidOutItem, looks?: Looks): string {
  if (i.kind === 'line' || i.kind === 'chart') return '';
  const g: Gridlines | undefined = i.grid;
  if (!g) return '';
  const p = g.padding;
  const sides = (['top', 'right', 'bottom', 'left'] as const).flatMap((s) => (g[s] ? [`;border-${s}:${stroke(g[s]!)}`] : []));
  return `<div ${attrs('bc-grid', box(i.left - p.left, i.top - p.top, i.width + p.left + p.right, i.height + p.top + p.bottom), sides.join(''), looks)}></div>`;
}

/** chartSvg numérote ses identifiants depuis zr0 : dans un même document HTML, deux graphiques se disputeraient clipPath et
 *  styles. Chacun reçoit un préfixe `id` propre au document (page_rang, voir `chartIds`), donc déterministe : l'ordre de rendu
 *  est celui des pages, bandes et éléments. */
const uniqueIds = (svg: string, id: string): string => svg.replace(/(?<=["#.(])zr0(?!\d)/g, `zr${id}`);

/** Le compteur de graphiques d'une page : `<page>_<rang>` (le mode Page des formulaires/états n'a qu'une page, numéro 0). */
const chartIds = (page: number) => { let k = 0; return () => `${page}_${k++}`; };

function item(i: LaidOutItem, looks?: Looks, nextId?: () => string): string {
  return itemHtml(i, looks, nextId) + gridHtml(i, looks);
}

function itemHtml(i: LaidOutItem, looks?: Looks, nextId: () => string = chartIds(0)): string {
  switch (i.kind) {
    case 'text': {
      const lh = `;line-height:${pt(lineHeight(i.font))}${i.font.underline ? ';text-decoration:underline' : ''}`;
      // the lines are wrap()'s, drawn verbatim: they already carry the substituted characters (C12)
      // print: a line at 0 leaves its left or top to .bc-line's
      const lines = i.lines.map((l) => looks ? `<span ${attrs('bc-line', [l.x ? `left:${pt(l.x)}` : '', l.y ? `top:${pt(l.y)}` : ''].filter(Boolean).join(';'), lh, looks)}>${esc(l.text)}</span>`
        : `<span class="bc-line"${data(looks, { x: n(l.x), y: n(l.y), w: n(l.width) })} style="left:${pt(l.x)};top:${pt(l.y)}${lh}">${esc(l.text)}</span>`);
      // Rich Text: the stored HTML through the allow-list, the margins as padding; every other text is escaped above
      const inner = i.rich ? sanitizeRich(i.rich.html) : lines.join('');
      const rich = i.rich ? `${lh};padding:${i.rich.inset.map(pt).join(' ')};text-align:${i.align}` : '';
      return `<div ${attrs(i.rich ? 'bc-text bc-rich' : 'bc-text', box(i.left, i.top, i.width, i.height), `${i.border ? `;border:${stroke(i.border)}` : ''}${back(i.back)}`
        + `;color:${hex(i.color) ?? '#000000'};${fontCss(i.font)}${rich}`, looks)}>${inner}</div>`;
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
      if (i.tiling) return `<div class="bc-img" style="${box(i.left, i.top, i.width, i.height)};${esc(cssDecl(pictureCss({ src: i.src, sizeMode: 'clip', alignment: i.pictureAlign ?? 'center', tiling: true })))}"></div>`;
      return `<img class="bc-img" alt="" src="${esc(i.src)}" style="${box(i.left, i.top, i.width, i.height)};object-fit:${Object.hasOwn(OBJECT_FIT, i.sizeMode) ? OBJECT_FIT[i.sizeMode] : 'contain'}${i.pictureAlign ? `;object-position:${objectPosition(i.pictureAlign)}` : ''}">`;
    case 'chart': {
      // cadre : sa largeur est en px (0 = filet de 1 px), 15 twips le px ; aucun trait quand la bordure est transparente
      const fr = chartFrame(i.format, i.palette);
      // la taille du dessin est en pt ; avec un cadre, le dessin prend la boîte moins les deux traits (1 px = 0,75 pt) : le SVG n'est pas réduit, le texte garde sa taille
      const edge = fr ? 2 * fr.width * 0.75 : 0;
      const size = { width: i.width / 20 - edge, height: i.height / 20 - edge };
      const option = chartOption(i.spec, i.data, i.format, i.palette, size);
      // des lignes mais rien à tracer : le même texte d'aide que la vue formulaire
      const hint = i.hint && i.data && i.data.rows.length > 0 && ((option as { series?: unknown[] }).series ?? []).length === 0
        ? `<div class="bc-chart-hint" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;font-size:${i.format.axisSize}pt;color:${i.palette.text}">${esc(i.hint)}</div>` : '';
      return `<div class="bc-chart" style="${box(i.left, i.top, i.width, i.height)}${fr ? `;border:${stroke({ width: fr.width * 15, color: fr.color, style: fr.style })}` : ''}">${uniqueIds(chartSvg(option, size), nextId())}${hint}</div>`;
    }
  }
}

/** L'image de fond : un `.bc-bg` premier enfant de la page (son style, une seule fois, dans reportCss). */
const bg = (report: LaidOutReport): string => report.background ? '<div class="bc-bg"></div>' : '';

/** One self-contained `.bc-page`; every page but the last breaks after itself. `looks`: the print document's classes. */
export function renderPageHtml(page: LaidOutPage, report: LaidOutReport, looks?: Looks): string {
  const nextId = chartIds(page.number);
  const last = page.number === report.pages[report.pages.length - 1]?.number;
  const bands = page.bands.map((b) => `<div class="bc-band"${data(looks, { section: esc(b.section), top: n(b.top), height: n(b.height) })} `
    + `style="${box(b.left, b.top, b.width, b.height)}${back(b.back)}">${b.items.map((i) => item(i, looks, nextId)).join('')}</div>`);
  return `<div class="bc-page"${data(looks, { page: n(page.number) })} style="width:${pt(report.width)};height:${pt(report.height)}${last ? '' : ';break-after:page'}">${bg(report)}${bands.join('')}</div>`;
}

/** Space under the content of a flow page, standing in for the bottom margin (twips; the layout's height excludes it). */
const FLOW_BOTTOM = 567;

/** The single page of a flow report (Layout view): same classes and CSS as renderPageHtml, but every item carries its
 *  control name (`data-name`) and every band its section and geometry, whatever `looks`; the height adds FLOW_BOTTOM. */
export function renderFlowHtml(report: LaidOutReport): string {
  const nextId = chartIds(1);
  const bands = (report.pages[0]?.bands ?? []).map((b) => `<div class="bc-band" data-section="${esc(b.section)}" data-top="${n(b.top)}" data-height="${n(b.height)}" `
    + `style="${box(b.left, b.top, b.width, b.height)}${back(b.back)}">${b.items.map((i) => item(i, undefined, nextId).replace(/^<(div|svg|img) /, `<$1 data-name="${esc(i.name)}" `)).join('')}</div>`);
  return `<div class="bc-page" data-page="1" style="width:${pt(report.width)};height:${pt(report.height + FLOW_BOTTOM)}">${bg(report)}${bands.join('')}</div>`;
}

const cssDecl = (o: Record<string, string>): string => Object.entries(o).map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${v}`).join(';');

/** @font-face of the faces the report uses (a non-portable font draws in Liberation Sans, as measured) and the .bc-* rules. */
export function reportCss(report: LaidOutReport, fontBaseUrl: string): string {
  const faces = report.pages.flatMap((p) => p.bands.flatMap((b) => b.items.flatMap((i) => i.kind === 'text' ? (i.rich ? [false, true].flatMap((bold) => [false, true].map((italic) => ({ family: i.font.name, bold, italic }))) // a Rich Text value may use any of the four faces
    : [{ family: i.font.name, bold: i.font.bold, italic: i.font.italic }])
        // le titre du graphique est en gras (ECharts) : sans la face grasse embarquée, Chromium la synthétiserait
    : i.kind === 'chart' ? [{ family: i.fontFamily, bold: false, italic: false }, ...(i.format.hasTitle ? [{ family: i.fontFamily, bold: true, italic: false }] : []),
        // la police du titre (TitleFontName), en normal et en gras (le titre est en gras) ; la même que le corps : fontFaceCss dédouble
        { family: i.titleFamily, bold: false, italic: false }, { family: i.titleFamily, bold: true, italic: false }] : [])));
  const charts = report.pages.some((p) => p.bands.some((b) => b.items.some((i) => i.kind === 'chart')));
  const rich = report.pages.some((p) => p.bands.some((b) => b.items.some((i) => i.kind === 'text' && i.rich)));
  return [fontFaceCss(faces, fontBaseUrl),
    '.bc-page{position:relative;overflow:hidden;background:#ffffff;color:#000000;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    // a cut band part can hold items above its top or past its bottom: the band clips them
    '.bc-band{position:absolute;overflow:hidden}',
    '.bc-text,.bc-check,.bc-rule,.bc-rect,.bc-img,.bc-grid{position:absolute;box-sizing:border-box;margin:0}',
    '.bc-text,.bc-check{overflow:hidden}.bc-rule{overflow:visible}.bc-check svg{display:block}',
    '.bc-text{font-kerning:none;font-variant-ligatures:none;font-feature-settings:"kern" 0,"liga" 0,"calt" 0;font-synthesis:none}',
    '.bc-grid{pointer-events:none}',
    // seulement avec un graphique : un état sans graphique garde son CSS à l'octet près
    charts ? '.bc-chart{position:absolute;box-sizing:border-box;margin:0;overflow:hidden}.bc-chart svg{display:block;width:100%;height:100%}' : '',
    report.background ? `.bc-bg{position:absolute;inset:0;${cssDecl(pictureCss(report.background))}}` : '',
    '.bc-line{position:absolute;left:0;top:0;white-space:pre}',
    // Rich Text boxes (the line height is set inline, with the font)
    rich ? '.bc-rich ul,.bc-rich ol{margin:0;padding-left:15pt}.bc-rich blockquote{margin:0 0 0 22pt}.bc-rich p,.bc-rich div{margin:0}' : '',
  ].filter(Boolean).join('\n');
}

/** Print Data Only (Access, for pre-printed forms): the report without its decoration and its labels. Lines, boxes, pictures,
 *  colours, borders and gridlines go; the bound and calculated text and the check boxes stay. `labels`: the names of the
 *  report's label controls (the layout does not tell them apart; its output stays as it is). */
export function dataOnlyReport(report: LaidOutReport, labels: ReadonlySet<string>): LaidOutReport {
  return { ...report, background: undefined, pages: report.pages.map((p) => ({ ...p, bands: p.bands.map((b) => ({ ...b, back: null, items: b.items.flatMap((i): LaidOutItem[] =>
    i.kind === 'text' ? (labels.has(i.name) ? [] : [{ ...i, border: null, back: null, grid: undefined }]) : i.kind === 'check' ? [{ ...i, grid: undefined }] : []) })) })) };
}

/** The whole document for the print window: A4 pages, fonts under fonts/, light background. */
export function renderDocumentHtml(report: LaidOutReport): string {
  const long = Math.max(report.width, report.height), short = Math.min(report.width, report.height);
  const paper = Object.values(PAPERS).find((x) => x.width === short && x.height === long);
  const size = paper ? (report.width > report.height ? paper.css.split(' ').reverse().join(' ') : paper.css) : '210mm 297mm';
  const looks: Looks = new Map(), body = report.pages.map((p) => renderPageHtml(p, report, looks)).join('\n');
  // a look holds only numbers, #rrggbb and escaped font names; `<` escaped all the same: nothing closes the <style>
  const classes = [...looks].map(([look, c]) => `.${c}{${look.slice(1).replace(/</g, '\\3c ')}}`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: ${size}; margin: 0 }\n${reportCss(report, 'fonts/')}\n`
    + `html,body{margin:0;background:#ffffff}\n${classes}</style></head><body>${body}</body></html>`;
}

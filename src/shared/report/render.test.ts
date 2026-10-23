// Rendu HTML/CSS positionné d'un état mis en page : unités, échappement, polices embarquées, images, thème clair.
import { describe, expect, it } from 'vitest';
import { defaultProps } from '../field-types';
import { FACTURES_FIELDS, FACTURES_REPORT, FACTURES_ROWS } from './fixtures/factures';
import { instantReport } from './instant';
import { layoutReport } from './layout';
import { readReport } from './model';
import { renderDocumentHtml, renderPageHtml, reportCss } from './render';
import { lineHeight } from './text';
import type { FontSpec, LaidOutBand, LaidOutItem, LaidOutPage, LaidOutReport } from './types';

const FONT: FontSpec = { name: 'Liberation Sans', size: 10, bold: false, italic: false, underline: false };
const band = (items: LaidOutItem[], o: Partial<LaidOutBand> = {}): LaidOutBand =>
  ({ section: 'detail', top: 567, left: 567, width: 10772, height: 1000, back: null, items, ...o });
const page = (items: LaidOutItem[], number = 1): LaidOutPage => ({ number, bands: [band(items)] });
const report = (pages: LaidOutPage[], landscape = false): LaidOutReport =>
  ({ width: landscape ? 16838 : 11906, height: landscape ? 11906 : 16838, pages, issues: [] });

const textItem = (text: string, o: Partial<Extract<LaidOutItem, { kind: 'text' }>> = {}): LaidOutItem =>
  ({ kind: 'text', name: 'T', left: 0, top: 0, width: 3000, height: 300, font: FONT, color: '#000000', back: null, border: null,
    align: 'left', lines: [{ text, x: 0, y: 0, width: 120 }], ...o });
const pageWithText = (text: string, o: Partial<Extract<LaidOutItem, { kind: 'text' }>> = {}) => page([textItem(text, o)]);
const pageWithImage = (src: string, sizeMode: 'clip' | 'stretch' | 'zoom' = 'clip') =>
  page([{ kind: 'image', name: 'I', left: 0, top: 0, width: 1000, height: 1000, src, sizeMode }]);
const rep = report([pageWithText('a')]);
const landscapeRep = report([pageWithText('a')], true);
const repWith = (font: Partial<FontSpec>) => report([page([textItem('a', { font: { ...FONT, ...font } })])]);

describe('render (brief)', () => {
  it('escapes data', () => {
    const html = renderPageHtml(pageWithText('<script>alert(1)</script> & "x"'), rep);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;'); expect(html).not.toMatch(/<script|on\w+=/i);
  });
  it('positions in pt from twips', () => expect(renderPageHtml(pageWithText('a', { left: 567, top: 20 }), rep)).toMatch(/left:28\.35pt;top:1pt/));
  it('lines carry their model', () => expect(renderPageHtml(pageWithText('a'), rep)).toMatch(/class="bc-line" data-x="0" data-y="0" data-w="\d+"/));
  it('declares only used faces and disables kerning', () => {
    const css = reportCss(repWith({ name: 'Liberation Sans', bold: true }), 'fonts/');
    expect(css).toContain('LiberationSans-Bold.ttf'); expect(css).not.toContain('LiberationSans-Regular.ttf'); expect(css).toContain('font-kerning:none');
  });
  it('aliased font uses its embedded face', () => expect(reportCss(repWith({ name: 'Arial' }), 'fonts/')).toContain('LiberationSans-Regular.ttf'));
  it('page size and orientation', () => {
    expect(renderDocumentHtml(rep)).toContain('size: 210mm 297mm'); expect(renderDocumentHtml(landscapeRep)).toContain('size: 297mm 210mm');
  });
  it('only data images, object-fit from size mode', () => {
    expect(renderPageHtml(pageWithImage('https://x/y.png'), rep)).not.toContain('<img');
    expect(renderPageHtml(pageWithImage('data:image/png;base64,AA==', 'zoom'), rep)).toContain('object-fit:contain');
  });
  it('always light', () => expect(renderDocumentHtml(rep)).not.toContain('var(--'));
});

describe('render', () => {
  it('draws the lines verbatim (substituted characters kept) and escapes quotes in attributes', () => {
    // wrap() already turned U+202F into U+2009 (or U+00A0) for a face without it: the line is drawn as given
    const html = renderPageHtml(page([textItem('', { lines: [{ text: "l'été 1 234,50 €", x: 5, y: 0, width: 900 }, { text: 'x', x: 0, y: 230, width: 50 }] })]), rep);
    expect(html).toContain(">l&#39;été 1 234,50 €</span>"); expect(html).toMatch(/data-x="0" data-y="230" data-w="50" style="left:0pt;top:11\.5pt;/);
    expect(renderPageHtml(page([{ kind: 'image', name: 'I', left: 0, top: 0, width: 10, height: 10, src: 'data:image/png;base64,"><b>', sizeMode: 'stretch' }]), rep))
      .toContain('src="data:image/png;base64,&quot;&gt;&lt;b&gt;"');
  });
  it('line height and font of the line box', () => {
    const html = renderPageHtml(pageWithText('a', { font: { ...FONT, size: 12, bold: true, italic: true, underline: true } }), rep);
    const lh = lineHeight({ ...FONT, size: 12 });
    expect(html).toContain(`line-height:${lh / 20}pt`);
    expect(html).toContain('font-family:&quot;BC Liberation Sans&quot;;font-size:12pt;font-weight:700;font-style:italic');
    expect(html).toContain('text-decoration:underline');
  });
  it('an aliased font draws with its embedded family, an unknown one with Liberation Sans only, as it is measured (M1)', () => {
    expect(renderPageHtml(pageWithText('a', { font: { ...FONT, name: 'Calibri' } }), rep)).toContain('font-family:&quot;BC Carlito&quot;;');
    // an installed non-portable font would draw wider or narrower than the engine measured: never in the stack
    for (const name of ['Comic Sans MS', 'My "Font";x:url(http://e)']) {
      const html = renderPageHtml(pageWithText('a', { font: { ...FONT, name } }), rep);
      expect(html).toContain('font-family:&quot;BC Liberation Sans&quot;;'); expect(html).not.toMatch(/Comic|My /);
    }
    expect(reportCss(repWith({ name: 'Wingdings', italic: true }), 'fonts/')).toContain('"BC Liberation Sans";src:url("fonts/LiberationSans-Italic.ttf")');
  });
  it('page breaks between pages only, pages and bands clip', () => {
    const two = report([page([], 1), page([], 2)]);
    expect(renderPageHtml(two.pages[0]!, two)).toContain('break-after:page');
    expect(renderPageHtml(two.pages[1]!, two)).not.toContain('break-after');
    expect(renderPageHtml(two.pages[0]!, two)).toMatch(/^<div class="bc-page" data-page="1" style="width:595\.3pt;height:841\.9pt;/);
    const css = reportCss(two, 'fonts/');
    expect(css).toMatch(/\.bc-page\{[^}]*position:relative;overflow:hidden;background:#ffffff/); expect(css).toMatch(/\.bc-band\{[^}]*overflow:hidden/);
  });
  it('a cut band part keeps items above or below it, clipped by the band', () => {
    const html = renderPageHtml({ number: 1, bands: [band([textItem('a', { top: -300 })], { top: 1000, height: 200, continued: true })] }, rep);
    expect(html).toContain('<div class="bc-band" data-section="detail" data-top="1000" data-height="200" style="left:28.35pt;top:50pt;width:538.6pt;height:10pt">');
    expect(html).toContain('top:-15pt');
  });
  it('lengths are plain decimals', () => {
    const html = renderPageHtml(pageWithText('a', { left: 1, top: 3, width: 7 }), rep);
    expect(html).toContain('left:0.05pt;top:0.15pt;width:0.35pt'); expect(html).not.toMatch(/\de-?\d/);
  });
  it('a colour that is not #rrggbb never reaches CSS', () => {
    const html = renderPageHtml(pageWithText('a', { color: 'red;background:url(http://e)', back: 'x', border: { width: 15, color: '#12ab34', style: 'dashed' } }), rep);
    expect(html).not.toContain('http'); expect(html).toContain('color:#000000'); expect(html).toContain('border:0.75pt dashed #12ab34');
  });
  it('a model that did not come from layout cannot inject markup or CSS through numbers or enums', () => {
    const bad = '1" onclick="x' as unknown as number;
    const html = renderPageHtml(page([textItem('a', { lines: [{ text: 'a', x: bad, y: 0, width: bad }],
      border: { width: 15, color: '#000000', style: 'solid;background:url(http://e)' as 'solid' } }),
      { kind: 'image', name: 'I', left: 0, top: 0, width: 10, height: 10, src: 'data:image/png;base64,AA==', sizeMode: 'x;y' as 'zoom' }]), rep);
    expect(html).not.toMatch(/onclick|http|x;y/); expect(html).toContain('data-x="NaN"'); expect(html).toContain('object-fit:contain');
  });
  it('band background, rectangle, check box', () => {
    const html = renderPageHtml({ number: 1, bands: [band([
      { kind: 'rect', name: 'R', left: 0, top: 0, width: 100, height: 100, border: { width: 15, color: '#ff0000', style: 'solid' }, back: '#00ff00' },
      { kind: 'check', name: 'C', left: 0, top: 0, width: 400, height: 200, checked: true, color: '#0000ff' },
      { kind: 'check', name: 'D', left: 0, top: 0, width: 200, height: 200, checked: false, color: '#0000ff' }], { back: '#eeeeee' })] }, rep);
    expect(html).toContain('background:#eeeeee');
    expect(html).toContain('class="bc-rect" style="left:0pt;top:0pt;width:5pt;height:5pt;border:0.75pt solid #ff0000;background:#00ff00"');
    expect(html.match(/class="bc-check"/g)).toHaveLength(2); expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain('width:10pt;height:10pt;border:0.75pt solid #0000ff');   // a square: the smaller side
  });
  it('lines: a border when straight, an SVG when slanted', () => {
    const b = { width: 30, color: '#000000', style: 'dotted' } as const;
    const html = renderPageHtml(page([{ kind: 'line', name: 'H', x1: 200, y1: 100, x2: 0, y2: 100, border: b },
      { kind: 'line', name: 'V', x1: 0, y1: 0, x2: 0, y2: 400, border: b }, { kind: 'line', name: 'S', x1: 0, y1: 400, x2: 200, y2: 0, border: b }]), rep);
    expect(html).toContain('class="bc-rule" style="left:0pt;top:5pt;width:10pt;height:0pt;border-top:1.5pt dotted #000000"');
    expect(html).toContain('class="bc-rule" style="left:0pt;top:0pt;width:0pt;height:20pt;border-left:1.5pt dotted #000000"');
    expect(html).toMatch(/<svg class="bc-rule" style="left:0pt;top:0pt;width:10pt;height:20pt" viewBox="0 0 200 400"[^>]*><line x1="0" y1="400" x2="200" y2="0"/);
  });
  it('object-fit for each size mode', () => {
    expect(renderPageHtml(pageWithImage('data:image/png;base64,AA==', 'clip'), rep)).toContain('object-fit:none');
    expect(renderPageHtml(pageWithImage('data:image/png;base64,AA==', 'stretch'), rep)).toContain('object-fit:fill');
    expect(renderPageHtml(pageWithImage('javascript:alert(1)'), rep)).not.toContain('javascript');
  });
  it('the document of a real report: every page, no network URL, no script', async () => {
    const env = { locale: 'fr-FR', lang: 'fr', now: () => new Date(0), errorText: { error: '#Erreur', name: '#Nom?' } } as const;
    const laid = await layoutReport(readReport(FACTURES_REPORT, FACTURES_FIELDS), { fields: FACTURES_FIELDS, rows: FACTURES_ROWS }, env);
    const html = renderDocumentHtml(laid);
    expect(html.startsWith('<!doctype html><html><head><meta charset="utf-8"><style>@page { size: 210mm 297mm; margin: 0 }')).toBe(true);
    expect(html).toContain('html,body{margin:0;background:#ffffff}');
    expect(html.match(/class="bc-page"/g)).toHaveLength(laid.pages.length); expect(laid.pages.length).toBeGreaterThan(1);
    expect(html.match(/url\([^)]*\)/g)!.every((u) => u.startsWith('url("fonts/'))).toBe(true);
    expect(html).not.toMatch(/<script|on\w+=|NaN|undefined/i);
  });
});

describe('the print document (final review I3)', () => {
  // un état instantané de 6 colonnes sur 2 000 lignes, comme la sonde de la revue
  const fields = [...FACTURES_FIELDS, { name: 'Note', type: 'shortText' as const, props: defaultProps('shortText') }];
  const rows = Array.from({ length: 2000 }, (_, i) => [...FACTURES_ROWS[i % 75]!, `Note ${i}`]);
  const env = { locale: 'fr-FR', lang: 'fr', now: () => new Date(0), errorText: { error: '#Erreur', name: '#Nom?' } } as const;
  const auto = () => layoutReport(readReport(instantReport({ kind: 'table', name: 'Factures' }, { fields, updatable: true, parameters: [] }, { lang: 'fr' }), fields), { fields, rows }, env);
  it('one class per distinct look, no data-* attribute: under 30 000 characters a page', async () => {
    const laid = await auto(), html = renderDocumentHtml(laid);
    expect(html).not.toMatch(/ data-[a-z]+=/); expect(html).not.toMatch(/style="[^"]*font-family/);
    expect(html.length / laid.pages.length).toBeLessThan(30000);
  }, 60000);
  it('draws the same: each class carries the look the preview writes inline', () => {
    const r = report([page([textItem('a', { color: '#123456', border: { width: 15, color: '#ff0000', style: 'solid' } }), textItem('b', { color: '#123456', border: { width: 15, color: '#ff0000', style: 'solid' } })])]);
    const html = renderDocumentHtml(r), cls = /class="bc-text (c\d+)"/g;
    const used = [...html.matchAll(cls)].map((m) => m[1]);
    expect(used).toHaveLength(2); expect(used[0]).toBe(used[1]);   // deux zones de même apparence, une classe
    const rule = new RegExp(`\.${used[0]}\{([^}]*)\}`).exec(html)![1];
    expect(rule).toContain('border:0.75pt solid #ff0000'); expect(rule).toContain('color:#123456'); expect(rule).toContain('font-family:"BC Liberation Sans"');
    expect(renderPageHtml(r.pages[0]!, r)).toContain('data-x="0"');   // l'aperçu garde son modèle
  });
});

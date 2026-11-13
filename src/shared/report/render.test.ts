// Rendu HTML/CSS positionné d'un état mis en page : unités, échappement, polices embarquées, images, thème clair.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultProps } from '../field-types';
import { FACTURES_FIELDS, FACTURES_REPORT, FACTURES_ROWS } from './fixtures/factures';
import { instantReport } from './instant';
import { layoutReport } from './layout';
import { readReport } from './model';
import { itemAt, occurrences } from './flow';
import { dataOnlyReport, renderDocumentHtml, renderFlowHtml, renderPageHtml, reportCss } from './render';
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
const imgItem = (o: Partial<Extract<LaidOutItem, { kind: 'image' }>>): LaidOutItem =>
  ({ kind: 'image', name: 'I', left: 0, top: 0, width: 1000, height: 1000, src: 'data:image/png;base64,AA==', sizeMode: 'clip', ...o });
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
  it('image alignment prints object-position, tiling prints a div; neither prop keeps the old img', () => {
    expect(renderPageHtml(page([imgItem({ pictureAlign: 'bottomRight' })]), rep)).toContain(';object-position:right bottom">');
    const tiled = renderPageHtml(page([imgItem({ tiling: true })]), rep);
    expect(tiled).toContain('background-repeat:repeat'); expect(tiled).not.toContain('<img');
    expect(renderPageHtml(page([imgItem({})]), rep)).not.toContain('object-position');
    expect(renderPageHtml(page([imgItem({})]), rep)).toContain('<img class="bc-img" alt="" src="data:image/png;base64,AA==" style="left:0pt;top:0pt;width:50pt;height:50pt;object-fit:none">');
  });
  it('only data images, object-fit from size mode', () => {
    expect(renderPageHtml(pageWithImage('https://x/y.png'), rep)).not.toContain('<img');
    expect(renderPageHtml(pageWithImage('data:image/png;base64,AA==', 'zoom'), rep)).toContain('object-fit:contain');
  });
  it('always light', () => expect(renderDocumentHtml(rep)).not.toContain('var(--'));
});

describe('render of a Rich Text value', () => {
  const rich = (html: string) => renderPageHtml(page([textItem('', { lines: [], rich: { html, inset: [0, 0, 0, 0] } })]), rep);
  it('draws the formatting, sanitized', () => {
    const html = rich('<div><b>bold</b></div><ul><li>one</li></ul><img src=x onerror=alert(1)><script>alert(1)</script><span style="color:red;position:fixed" onclick="x">t</span>');
    expect(html).toContain('<div><b>bold</b></div><ul><li>one</li></ul>');
    expect(html).toContain('<span style="color:red">t</span>');
    expect(html).not.toMatch(/<script|<img|onerror|onclick|position:fixed/i);
  });
  it('a plain text item stays escaped', () => expect(renderPageHtml(pageWithText('<b>x</b>'), rep)).toContain('&lt;b&gt;x&lt;/b&gt;'));
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

describe('flow rendering and item lookup (L3)', () => {
  const BEFORE = '<div class="bc-page" data-page="1" style="width:595.3pt;height:841.9pt"><div class="bc-band" data-section="detail" data-top="567" data-height="1000" style="left:28.35pt;top:28.35pt;width:538.6pt;height:50pt"><div class="bc-text" style="left:28.35pt;top:1pt;width:150pt;height:15pt;color:#000000;font-family:&quot;BC Liberation Sans&quot;;font-size:10pt;font-weight:400;font-style:normal"><span class="bc-line" data-x="0" data-y="0" data-w="120" style="left:0pt;top:0pt;line-height:11.5pt">a</span></div></div></div>';
  const T = (name: string, o = {}) => textItem('x', { name, ...o });
  const flowRep = (): LaidOutReport => ({ width: 11906, height: 3000, issues: [], pages: [{ number: 1, bands: [
    band([T('Total', { left: 100, top: 50 }), T('Multi', { left: 0, top: 400, width: 2000, height: 600, lines: [{ text: 'a', x: 0, y: 0, width: 5 }, { text: 'b', x: 0, y: 200, width: 5 }] })], { section: 'reportHeader', top: 0, left: 567, height: 1000 }),
    band([T('Total', { left: 100, top: 0 }), { kind: 'line', name: 'L', x1: 3000, y1: 250, x2: 2000, y2: 100, border: { width: 15, color: '#000000', style: 'solid' } }], { top: 1000, left: 567, height: 300 }),
    band([T('Total', { left: 100, top: 0 })], { top: 1300, left: 567, height: 300 }),
  ] }] });
  it('renderPageHtml is unchanged', () => {
    // captured before the change, from the unmodified renderPageHtml
    expect(renderPageHtml(pageWithText('a', { left: 567, top: 20 }), rep)).toBe(BEFORE);
  });
  it('renderFlowHtml: one data-name per occurrence, band data, bottom space', () => {
    const html = renderFlowHtml(flowRep());
    expect(html.match(/data-name="Total"/g)).toHaveLength(3); expect(html).toContain('data-section="detail" data-top="1000" data-height="300"');
    expect(html).toContain('<svg data-name="L" class="bc-rule"'); expect(html).toContain(`height:${(3000 + 567) / 20}pt`);
  });
  it('renderFlowHtml escapes the control name', () => {
    const r = flowRep(); r.pages[0]!.bands[0]!.items.push(T('a"b<&'));
    expect(renderFlowHtml(r)).toContain('data-name="a&quot;b&lt;&amp;"');
  });
  it('occurrences: absolute twips, one per record, multi-line is one', () => {
    expect(occurrences(flowRep(), 'Total').map((o) => [o.left, o.top, o.section, o.row])).toEqual([[667, 50, 'reportHeader', 0], [667, 1000, 'detail', 0], [667, 1300, 'detail', 1]]);
    expect(occurrences(flowRep(), 'Multi')).toEqual([{ left: 567, top: 400, width: 2000, height: 600, section: 'reportHeader', row: 0 }]);
    expect(occurrences(flowRep(), 'L')[0]).toMatchObject({ left: 2567, top: 1100, width: 1000, height: 150 });
  });
  it('itemAt: null in gaps, topmost on overlap', () => {
    const r = flowRep(); expect(itemAt(r, 5000, 5000)).toBeNull(); expect(itemAt(r, 700, 100)).toBe('Total');
    r.pages[0]!.bands[0]!.items.push(T('Over', { left: 100, top: 50 })); expect(itemAt(r, 700, 100)).toBe('Over');
  });
});

describe('gridlines', () => {
  const B = { width: 15, color: '#ff0000', style: 'solid' as const };
  it('one overlay sibling with exactly the drawn sides, over the padded cell', () => {
    const html = renderPageHtml(page([textItem('a', { grid: { top: B, bottom: B, left: null, right: null, padding: { top: 0, bottom: 0, left: 20, right: 0 } } })]), report([]));
    expect(html.match(/bc-grid/g)).toHaveLength(1);
    expect(html).toMatch(/class="bc-grid" style="left:-1pt;top:0pt;width:151pt;height:15pt;border-top:0.75pt solid #ff0000;border-bottom:0.75pt solid #ff0000"/);
    expect(html).not.toContain('border-left');
  });
  it('no overlay without gridlines', () => expect(renderPageHtml(pageWithText('a'), report([]))).not.toContain('bc-grid'));
});

describe('empty layout cells (L5)', () => {
  const env = { locale: 'fr-FR', lang: 'fr', now: () => new Date(Date.UTC(2026, 9, 22)), errorText: { error: '#Erreur', name: '#Nom?' } } as const;
  const withCell = (props?: Record<string, unknown>) => ({ ...FACTURES_REPORT, props: { ...FACTURES_REPORT.props, Layouts: [{ id: 'L1', kind: 'stacked', left: 200, tops: { reportHeader: 100 }, cols: [1000],
    rows: [{ section: 'reportHeader', height: 300 }], cells: [{ row: 0, col: 0, control: null, ...(props ? { props } : {}) }] }] } });
  const html = async (d: typeof FACTURES_REPORT) => {
    const r = await layoutReport(readReport(d, FACTURES_FIELDS), { fields: FACTURES_FIELDS, rows: FACTURES_ROWS }, env);
    return renderPageHtml(r.pages[0], r);
  };
  it('a formatted cell draws its back colour and one gridline overlay', async () => {
    const out = await html(withCell({ BackStyle: 'normal', BackColor: '#ff0000', GridlineStyleTop: 'solid' }));
    expect(out).toContain('#ff0000');
    expect(out.match(/class="bc-grid"/g)).toHaveLength(1);
    expect(out).toContain('border-top');
  });
  it('a pre-L5 report with a bare cell renders byte-identically', async () => {
    expect(await html(withCell())).toBe(await html(FACTURES_REPORT));
  });
});

describe("image d'arrière-plan de l'état (F3 Task 8)", () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const withBg = { ...report([pageWithText('a'), pageWithText('b', {})].map((p, i) => ({ ...p, number: i + 1 }))), background: { src: png, sizeMode: 'clip' as const, alignment: 'center' as const, tiling: true } };
  it('un .bc-bg par page, premier enfant, mosaïque', () => {
    const html = withBg.pages.map((p) => renderPageHtml(p, withBg)).join('');
    expect(html.match(/class="bc-bg"/g)).toHaveLength(2);
    expect(reportCss(withBg, 'f/')).toContain('background-repeat:repeat');
    expect(renderPageHtml(withBg.pages[0]!, withBg)).toMatch(/^<div class="bc-page"[^>]*><div class="bc-bg"/);
    expect(renderDocumentHtml(withBg)).toContain('.bc-bg{position:absolute;inset:0;background-image:url("data:');
  });
  it("sans image : identique à avant (aucun bc-bg)", () => {
    expect(renderPageHtml(rep.pages[0]!, rep)).not.toContain('bc-bg');
    expect(reportCss(rep, 'f/')).not.toContain('bc-bg');
  });
  it("déterministe : le même HTML d'impression à chaque appel", () => {
    expect(renderDocumentHtml(withBg)).toBe(renderDocumentHtml(withBg));
  });
  it('renderFlowHtml aussi', () => {
    expect(renderFlowHtml(withBg)).toContain('<div class="bc-bg"');
  });
});

describe('graphique dans un état (F4)', () => {
  const env = { locale: 'fr-FR', lang: 'fr', now: () => new Date(0), errorText: { error: '#Erreur', name: '#Nom?' } } as const;
  const values = [{ field: 'Montant', agg: 'sum' }];
  const chartDoc = (props: Record<string, unknown> = {}) => ({ formatVersion: '1.0', recordSource: null, props: {}, sections: [
    { kind: 'reportHeader', height: 4000, props: {}, controls: [{ kind: 'chart', name: 'Graph', left: 200, top: 100, width: 6000, height: 3600,
      props: { ChartAxis: ['Ville'], ChartValues: values, ...props } }] }] }) as unknown as typeof FACTURES_REPORT;
  const data = { columns: [{ role: 'category' as const, field: 'Ville', name: 'Ville' }, { role: 'value' as const, field: 'Montant', name: 'SumOfMontant' }],
    rows: [['A', 4], ['B', 6]], truncated: false };
  const html = async (d = chartDoc(), charts: Record<string, typeof data> = { Graph: data }) =>
    renderDocumentHtml(await layoutReport(readReport(d, [], { charts, chartLabels: { title: 'Titre du graphique', empty: '(vide)' } }), { fields: [], rows: [] }, env));

  it('un svg en ligne avec viewBox, ses catégories, aucun script', async () => {
    const h = await html();
    expect(h.match(/<svg/g)).toHaveLength(1);
    expect(h).toMatch(/<div class="bc-chart" style="left:10pt;top:5pt;width:300pt;height:180pt"><svg[^>]* viewBox="/);
    expect(h).toContain('>A</text>'); expect(h).toContain('Titre du graphique');
    expect(h).not.toMatch(/<script|\son\w+=|https?:\/\/(?!www\.w3\.org\/)/i); expect(h).not.toMatch(/NaN|undefined/);
  });
  it("deux graphiques d'un même document n'ont aucun identifiant commun", async () => {
    const d = chartDoc(); const c = (d.sections[0] as unknown as { controls: unknown[] }).controls;
    c.push({ ...(c[0] as object), name: 'G2', top: 1800, props: { ChartAxis: ['Ville'], ChartValues: values, ChartType: 'line' } });
    const ids = (h: string) => new Set(h.match(/zr[0-9a-f]+-c\d+/g));
    const h = await html(d, { Graph: data, G2: data });
    expect(h.match(/<svg/g)).toHaveLength(2);
    const [a, b] = h.split('<svg').slice(1).map(ids);
    expect([...a!].filter((x) => b!.has(x))).toEqual([]);
  });
  it("le même graphique deux fois dans un document : aucune valeur d'attribut id en double", async () => {
    const d = chartDoc(); const c = (d.sections[0] as unknown as { controls: unknown[] }).controls;
    c.push({ ...(c[0] as object), name: 'G2', top: 1800 });
    const h = await html(d, { Graph: data, G2: data });
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(h.match(/zr\d+_\d+(?=-)/g))).toEqual(new Set(['zr1_0', 'zr1_1']));   // une page, deux graphiques : deux préfixes
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('un titre hostile est échappé', async () => {
    const h = await html(chartDoc({ ChartTitle: '</svg><script>x' }));
    expect(h).not.toContain('<script'); expect(h).toContain('&lt;/svg&gt;');
  });
  it('police du titre déclarée (normal et gras), cadre seulement si la bordure est tracée, hostile échappé', async () => {
    const h = await html(chartDoc({ TitleFontName: 'Carlito', ChartBorderStyle: 'dashed', ChartBorderWidth: 2, ChartBorderColor: '#ff0000', Subtitle: '<b>x', HasSubtitle: true }));
    expect(h).toContain('font-family:"BC Carlito"');
    expect(h).toContain('Carlito-Regular.ttf'); expect(h).toContain('Carlito-Bold.ttf');
    expect(h).toMatch(/class="bc-chart" style="[^"]*;border:[^"]*dashed #ff0000"/);
    expect(h).not.toContain('<b>x');
    // le dessin ne dépasse pas l'intérieur du cadre (2 px de chaque côté = 3 pt au total) : le texte n'est pas réduit
    expect(h).toMatch(/<svg[^>]* viewBox="0 0 297 177"/);
    expect(await html(chartDoc({ TitleFontName: 'Police Inconnue' }))).toContain('LiberationSans-Bold.ttf');
    expect(await html()).not.toMatch(/bc-chart" style="[^"]*border/);
  });
  it('la police du graphique est déclarée (régulier) pour le PDF', async () => {
    const h = await html();
    expect(h).toContain('@font-face{font-family:"BC Inter";src:url("fonts/Inter-Regular.ttf")');
    expect(h).toContain('@font-face{font-family:"BC Inter";src:url("fonts/Inter-Bold.ttf") format("truetype");font-weight:700');   // le titre
    expect(h).toContain('font-family:BC Inter');
  });
  it('identique à un second appel et après un autre graphique ; égal au golden', async () => {
    const a = await html();
    await html(chartDoc({ ChartType: 'pie' }));
    expect(await html()).toBe(a);
    const file = fileURLToPath(new URL('../chart/fixtures/report-chart.html', import.meta.url));
    if (process.env.UPDATE_GOLDEN) writeFileSync(file, a);
    expect(a).toBe(readFileSync(file, 'utf8'));
  });
  it('sans données : un cadre sans courbe ; sans graphique : aucun CSS de graphique', async () => {
    expect(await html(chartDoc(), {})).not.toContain('<path');
    const none = renderDocumentHtml(await layoutReport(readReport(FACTURES_REPORT, FACTURES_FIELDS), { fields: FACTURES_FIELDS, rows: FACTURES_ROWS }, env));
    expect(none).not.toContain('bc-chart');
  });
});

describe('graphiques F5a dans un état', () => {
  const env = { locale: 'fr-FR', lang: 'fr', now: () => new Date(0), errorText: { error: '#Erreur', name: '#Nom?' } } as const;
  const cat = { role: 'category' as const, field: 'Ville', name: 'Ville' };
  const val = { role: 'value' as const, field: 'Montant', name: 'SumOfMontant' };
  const grouped = { columns: [cat, val], rows: [['A', 4], ['B', 6], ['C', 2]], truncated: false };
  const xy = { columns: [{ role: 'category' as const, field: 'Qte', name: 'Qte' }, val], rows: [[1, 10], [2, 25], [3, 18], [4, 30]], truncated: false };
  const xys = { columns: [...xy.columns, { role: 'value' as const, field: 'Remise', name: 'Remise' }], rows: [[1, 10, 3], [2, 25, 8], [3, 18, 5], [4, 30, 12]], truncated: false };
  const chart = (name: string, top: number, type: string, extra: Record<string, unknown> = {}) => ({ kind: 'chart', name, left: 200, top, width: 5200, height: 2400,
    props: { ChartType: type, ChartTitle: `T ${name}`, ChartAxis: [type === 'scatter' || type === 'bubble' ? 'Qte' : 'Ville'], ChartValues: [{ field: 'Montant', agg: 'sum' }], ...extra } });
  const doc = ({ formatVersion: '1.0', recordSource: null, props: {}, sections: [{ kind: 'reportHeader', height: 13000, props: {}, controls: [
    chart('Anneau', 100, 'doughnut'), chart('Arc', 2600, 'arc'), chart('Entonnoir', 5100, 'funnel'), chart('Nuage', 7600, 'scatter'),
    chart('Bulles', 10100, 'bubble', { ChartValues: [{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'sum' }] })] }] }) as unknown as typeof FACTURES_REPORT;
  const charts = { Anneau: grouped, Arc: grouped, Entonnoir: grouped, Nuage: xy, Bulles: xys };
  const html = async (c: Record<string, typeof grouped> = charts) =>
    renderDocumentHtml(await layoutReport(readReport(doc, [], { charts: c, chartLabels: { title: 'Titre du graphique', empty: '(vide)' } }), { fields: [], rows: [] }, env));

  it('cinq svg, aucun script ni NaN, identique à un second appel et après un autre graphique, égal au golden', async () => {
    const a = await html();
    expect(a.match(/<svg/g)).toHaveLength(5);
    expect(a).not.toMatch(/<script|\son\w+=|NaN|undefined/);
    expect(await html()).toBe(a);
    await html({ ...charts, Nuage: { ...xy, rows: [[9, 9]] } });
    expect(await html()).toBe(a);
    const file = fileURLToPath(new URL('../chart/fixtures/report-chart-f5a.html', import.meta.url));
    if (process.env.UPDATE_GOLDEN) writeFileSync(file, a);
    expect(a).toBe(readFileSync(file, 'utf8'));
  });

  it("un nuage de points dont le X est du texte imprime l'aide du type (échappée, déterministe) ; un graphique tracé n'en imprime pas", async () => {
    const hints = { 'chart.settings.typeHint.scatter': 'X <must> be a number & more', 'chart.noData': 'No data' };
    const text: typeof grouped = { ...xy, rows: [['a', 10], ['b', 25]] };
    const h = (c: typeof grouped) => async () => renderDocumentHtml(await layoutReport(readReport(doc, [], { charts: { ...charts, Nuage: c }, chartLabels: { title: 'Titre du graphique', empty: '(vide)', hints } }), { fields: [], rows: [] }, env));
    const a = await h(text)();
    expect(a).toContain('X &lt;must&gt; be a number &amp; more');
    expect(a).not.toContain('<must>');
    expect(await h(text)()).toBe(a);
    expect((await h(xy)()).match(/bc-chart-hint/g) ?? []).toHaveLength(0);
  });
});

describe('graphiques F5 : les huit nouveaux types dans un état', () => {
  const env = { locale: 'fr-FR', lang: 'fr', now: () => new Date(0), errorText: { error: '#Erreur', name: '#Nom?' } } as const;
  const cat = { role: 'category' as const, field: 'Ville', name: 'Ville' };
  const val = { role: 'value' as const, field: 'Montant', name: 'SumOfMontant' };
  const grouped = { columns: [cat, val], rows: [['A', 40], ['B', 60], ['C', -20], ['D', 35]], truncated: false };
  const xy = { columns: [{ role: 'category' as const, field: 'Qte', name: 'Qte' }, val], rows: [[1, 10], [2, 25], [3, 18], [4, 30]], truncated: false };
  const xys = { columns: [...xy.columns, { role: 'value' as const, field: 'Remise', name: 'Remise' }], rows: [[1, 10, 3], [2, 25, 8], [3, 18, 5], [4, 30, 12]], truncated: false };
  const box = { columns: [cat, val], rows: [...[1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((v) => ['A', v]), ...[2, 4, 4, 5, 7, 9].map((v) => ['B', v])], truncated: false };
  const TYPES = ['doughnut', 'arc', 'funnel', 'scatter', 'bubble', 'boxWhisker', 'pareto', 'waterfall'] as const;
  const data = { doughnut: grouped, arc: grouped, funnel: grouped, scatter: xy, bubble: xys, boxWhisker: box, pareto: grouped, waterfall: grouped };
  const chart = (type: (typeof TYPES)[number], top: number) => ({ kind: 'chart', name: type, left: 200, top, width: 5200, height: 2400,
    props: { ChartType: type, ChartTitle: `T ${type}`, ChartAxis: [type === 'scatter' || type === 'bubble' ? 'Qte' : 'Ville'],
      ChartValues: type === 'bubble' ? [{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'sum' }] : [{ field: 'Montant', agg: 'sum' }] } });
  // deux pages : quatre graphiques dans l'en-tête d'état (page 1), quatre dans le pied (la page suivante)
  const docOf = (order: readonly (typeof TYPES)[number][]) => ({ formatVersion: '1.0', recordSource: null, props: {}, sections: [
    { kind: 'reportHeader', height: 12000, props: {}, controls: order.slice(0, 4).map((t, i) => chart(t, 100 + i * 2900)) },
    { kind: 'reportFooter', height: 12000, props: {}, controls: order.slice(4).map((t, i) => chart(t, 100 + i * 2900)) }] }) as unknown as typeof FACTURES_REPORT;
  const labels = { title: 'Titre du graphique', empty: '(vide)', total: 'Total', cumulative: 'Cumul %', increase: 'Hausse', decrease: 'Baisse' };
  const html = async (order: readonly (typeof TYPES)[number][] = TYPES, d: Record<string, typeof grouped> = data) =>
    renderDocumentHtml(await layoutReport(readReport(docOf(order), [], { charts: d, chartLabels: labels }), { fields: [], rows: [] }, env));
  const svgs = (h: string) => h.split('<svg').slice(1).map((x) => '<svg' + x.slice(0, x.indexOf('</svg>') + 6));
  const norm = (x: string) => x.replace(/zr\d+_\d+/g, 'zr0');

  it('huit svg sur deux pages, aucun script ni NaN, identique à un second appel et après un autre graphique, égal au golden', async () => {
    const a = await html();
    expect(a.match(/<svg/g)).toHaveLength(8);
    expect(a.match(/class="bc-page"/g)).toHaveLength(2);
    expect(a).not.toMatch(/<script|\son\w+=|NaN|undefined|Infinity/);
    expect(a).toContain('>Total</text>'); expect(a).toContain('Cumul %');
    expect(a.length).toBeLessThan(64 * 1024 ** 2);
    expect(await html()).toBe(a);
    await html(TYPES, { ...data, scatter: { ...xy, rows: [[9, 9]] } });
    expect(await html()).toBe(a);
    const file = fileURLToPath(new URL('../chart/fixtures/report-chart-f5.html', import.meta.url));
    if (process.env.UPDATE_GOLDEN) writeFileSync(file, a);
    expect(a).toBe(readFileSync(file, 'utf8'));
  });

  it("chaque graphique ne dépend que de ses données : même dessin (identifiants normalisés) seul, en ordre inverse, ou après un autre", async () => {
    const all = svgs(await html()).map(norm);
    const reversed = svgs(await html([...TYPES].reverse())).map(norm);
    expect(reversed).toEqual([...all].reverse());
    for (const [i, t] of TYPES.entries()) {
      const alone = svgs(await html([t, ...TYPES.filter((x) => x !== t).slice(0, 7)]))[0];
      expect(norm(alone!), t).toBe(all[i]);
    }
  });
});

describe('Print Data Only', () => {
  it('keeps the bound text and check boxes; drops labels, lines, boxes, pictures, colours and gridlines', () => {
    const border = { width: 15, color: '#000000', style: 'solid' as const };
    const grid = { top: border, right: null, bottom: null, left: null, padding: { left: 0, right: 0, top: 0, bottom: 0 } };
    const rp = report([{ number: 1, bands: [band([
      textItem('keep', { border, back: '#ffff00', grid }),
      textItem('caption', { name: 'Cap' }),
      { kind: 'rect', name: 'R', left: 0, top: 0, width: 10, height: 10, border, back: '#ff0000' },
      { kind: 'line', name: 'L', x1: 0, y1: 0, x2: 10, y2: 0, border },
      { kind: 'check', name: 'C', left: 0, top: 0, width: 200, height: 200, checked: true, color: '#000000' },
      { kind: 'image', name: 'I', left: 0, top: 0, width: 10, height: 10, src: 'data:image/png;base64,AA==', sizeMode: 'zoom' },
    ], { back: '#00ff00' })] }]);
    const out = dataOnlyReport(rp, new Set(['Cap']));
    expect(out.pages[0]!.bands[0]!.back).toBeNull();
    expect(out.pages[0]!.bands[0]!.items.map((i) => i.kind)).toEqual(['text', 'check']);   // the label and the rest go
    expect(out.pages[0]!.bands[0]!.items[0]).toMatchObject({ border: null, back: null, grid: undefined, lines: [{ text: 'keep' }] });
    expect(rp.pages[0]!.bands[0]!.items).toHaveLength(6);   // the input is not changed
  });
});

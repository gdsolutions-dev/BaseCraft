// Pagination d'un état : tri et groupes, suite des bandes, placement (Garder ensemble, Répéter la section, Saut de page,
// coupe), en-tête et pied de page, deux passes, réactivité et déterminisme.
import { describe, expect, it, vi } from 'vitest';
import { FACTURES_FIELDS, FACTURES_REPORT, FACTURES_ROWS } from './fixtures/factures';
import { layoutReport, MAX_PAGES, sortAndGroup } from './layout';
import { readReport, type GroupLevel } from './model';
import { measure } from './text';
import type { LaidOutBand, LaidOutPage, LaidOutReport, LayoutEnv, SectionEvent } from './types';
import type { SqlValue } from '../coerce';
import { MAX_TWIPS } from '../field-types';
import { validateDesignDoc, type ControlDef, type DesignDoc, type SectionKind } from '../design/model';
import { formatValue } from '../expr/format';
import { num, str } from '../expr/library';

const fr = { locale: 'fr-FR', lang: 'fr' } as const;
const frEnv = (o: Partial<LayoutEnv> = {}): LayoutEnv => ({ ...fr, now: () => new Date(Date.UTC(2026, 9, 22)), errorText: { error: '#Erreur', name: '#Nom?' }, ...o });
const cur = (n: number) => formatValue(num(n), 'currency', fr);

const run = async (doc = FACTURES_REPORT, rows = FACTURES_ROWS, env = frEnv()) => layoutReport(readReport(doc, FACTURES_FIELDS), { fields: FACTURES_FIELDS, rows }, env);
const seq = (p: LaidOutPage) => p.bands.map((b) => b.section + (b.repeated ? '*' : ''));

/** The text of each text item of a band, in drawing order. */
const texts = (b: LaidOutBand) => b.items.flatMap((i) => (i.kind === 'text' ? [i.lines.map((l) => l.text).join('\n')] : []));
const bands = (r: LaidOutReport, s: SectionKind) => r.pages.flatMap((p) => p.bands.filter((b) => b.section === s));
const footerText = (p: LaidOutPage) => texts(p.bands.find((b) => b.section === 'pageFooter')!)[0];
const groupTotals = (r: LaidOutReport) => bands(r, 'groupFooter').map((b) => texts(b)[1]);
const reportFooterTexts = (r: LaidOutReport) => texts(bands(r, 'reportFooter')[0]!);
const groupKeys = (r: LaidOutReport) => bands(r, 'groupHeader').filter((b) => !b.repeated).map((b) => texts(b)[0]);

const FONT = { FontName: 'Liberation Sans', FontSize: 10, BorderStyle: 'transparent' };
/** A text box at the right of the columns; `props` are added to the fixture's font and its source. */
const tb = (name: string, src: string, o: Partial<ControlDef> = {}, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind: 'textBox', name, left: 9400, top: 0, width: 1300, height: 340, ...o, props: { ...FONT, ControlSource: src, ...props } });
const edit = (d: DesignDoc, f: (c: DesignDoc) => void): DesignDoc => { const c = structuredClone(d); f(c); return c; };
const sectionOf = (d: DesignDoc, kind: SectionKind) => d.sections.find((s) => s.kind === kind)!;
const withSection = (d: DesignDoc, kind: SectionKind, props: Record<string, unknown>) => edit(d, (c) => Object.assign(sectionOf(c, kind).props, props));
const withControl = (d: DesignDoc, kind: SectionKind, ctl: ControlDef) => edit(d, (c) => sectionOf(c, kind).controls.push(ctl));
/** Patches a grouping level; an expression key is also shown in the level's header, as a designer would. */
const withGrouping = (d: DesignDoc, level: number, patch: Partial<GroupLevel>) => edit(d, (c) => {
  Object.assign((c.props.grouping as GroupLevel[])[level]!, patch);
  if (patch.expression !== undefined) c.sections.find((s) => s.kind === 'groupHeader' && s.groupLevel === level)!.controls[0]!.props.ControlSource = patch.expression;
});
const withoutPagesFooter = (d: DesignDoc) => edit(d, (c) => { sectionOf(c, 'pageFooter').controls[0]!.props.ControlSource = '="Page " & [Page]'; });
/** A Detail that grows: a Can Grow box below the row, `lines` words narrow enough to take one line each. */
const withMemo = (d: DesignDoc, lines: number) => edit(d, (c) => {
  const detail = sectionOf(c, 'detail'), words = Array.from({ length: lines }, (_, i) => `ligne${String(i + 1).padStart(3, '0')}`);
  const width = Math.ceil(measure('ligne000', { name: 'Liberation Sans', size: 10, bold: false, italic: false, underline: false }).width) + 1;
  detail.height = 680; detail.props.CanGrow = true;
  detail.controls.push(tb('Memo', `="${words.join(' ')}"`, { left: 0, top: 340, width }, { CanGrow: true }));
});
const rowsOf = (...clients: string[]) => FACTURES_ROWS.filter((r) => clients.includes(r[1] as string));

describe('the reference report', () => {
  it('is a valid definition with no issue, over 75 mixed rows', () => {
    expect(validateDesignDoc(FACTURES_REPORT)).toEqual([]); expect(readReport(FACTURES_REPORT, FACTURES_FIELDS).issues).toEqual([]);
    expect(FACTURES_ROWS.map((r) => r[0])).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
    expect(['Dupont', 'Martin', 'Durand'].map((c) => rowsOf(c).length)).toEqual([60, 10, 5]);
    expect(FACTURES_ROWS.filter((r, i) => i > 0 && r[1] !== FACTURES_ROWS[i - 1]![1]).length).toBeGreaterThan(20);   // les clients alternent
  });
});

describe('layoutReport (brief)', () => {
  it('reference report paginates as computed', async () => { const r = await run(); expect(r.pages).toHaveLength(3);
    expect(seq(r.pages[0]!)).toEqual(['reportHeader', 'pageHeader', 'groupHeader', ...Array(38).fill('detail'), 'pageFooter']);
    expect(seq(r.pages[1]!)).toEqual(['pageHeader', 'groupHeader*', ...Array(22).fill('detail'), 'groupFooter', 'groupHeader', ...Array(5).fill('detail'), 'groupFooter', 'groupHeader', ...Array(9).fill('detail'), 'pageFooter']);
    expect(seq(r.pages[2]!)).toEqual(['pageHeader', 'groupHeader*', 'detail', 'groupFooter', 'reportFooter', 'pageFooter']);
    expect(r.pages.map((p) => footerText(p))).toEqual(['Page 1 sur 3', 'Page 2 sur 3', 'Page 3 sur 3']);
  });
  it('exact totals per group and grand total', async () => { const r = await run();
    expect(groupTotals(r)).toEqual([cur(6), cur(121), cur(19999.9)]);   // Dupont, Durand, Martin
    expect(reportFooterTexts(r)).toEqual(['75', cur(20126.9)]);
  });
  it('single pass without [Pages], two with', async () => { let n = 0; const hooks = { onFormat: async (e: SectionEvent) => { if (e.section === 'detail') n++; } };
    await run(withoutPagesFooter(FACTURES_REPORT), FACTURES_ROWS, frEnv({ hooks })); expect(n).toBe(75); n = 0;
    await run(FACTURES_REPORT, FACTURES_ROWS, frEnv({ hooks })); expect(n).toBe(150); });
  it('empty source', async () => { const r = await run(FACTURES_REPORT, []); expect(r.pages).toHaveLength(1);
    expect(seq(r.pages[0]!)).toEqual(['reportHeader', 'pageHeader', 'reportFooter', 'pageFooter']); expect(reportFooterTexts(r)).toEqual(['0', '']); });
  it('force new page before each group', async () => { const r = await run(withSection(FACTURES_REPORT, 'groupHeader', { ForceNewPage: 'before' }));
    expect(r.pages).toHaveLength(5);   // 1 : En-tête d'état seul ; 2-3 : Dupont ; 4 : Durand ; 5 : Martin
    for (const p of r.pages) { const i = seq(p).indexOf('groupHeader'); if (i >= 0) expect(seq(p).slice(0, i).every((s) => s === 'pageHeader' || s === 'groupHeader*')).toBe(true); } });
  it('keep whole group together moves the group to a fresh page', async () => {
    const r = await run(withGrouping(FACTURES_REPORT, 0, { keepTogether: 'wholeGroup' }));   // Martin (4308 twips) ne tient pas dans les 3574 restants de la page 2
    expect(seq(r.pages[1]!).at(-2)).toBe('groupFooter'); expect(seq(r.pages[2]!).slice(0, 2)).toEqual(['pageHeader', 'groupHeader']); });
  it('band taller than a page is split between lines and terminates', async () => {
    const r = await run(withMemo(FACTURES_REPORT, 200 /* lignes */), FACTURES_ROWS.slice(0, 1));
    const parts = r.pages.flatMap((p) => p.bands.filter((b) => b.section === 'detail')); expect(parts.length).toBeGreaterThan(1); expect(parts.slice(1).every((b) => b.continued)).toBe(true);
    expect(parts.flatMap((b) => b.items.flatMap((i) => (i.kind === 'text' ? i.lines : []))).length).toBeGreaterThanOrEqual(200);
  });
  it('group by expression, descending, Null first ascending', async () => {
    expect(groupKeys(await run(withGrouping(FACTURES_REPORT, 0, { expression: '=Left([Client], 1)', order: 'desc' })))).toEqual(['M', 'D']);   // Dupont et Durand : un seul groupe
    expect(groupKeys(await run(FACTURES_REPORT, [...FACTURES_ROWS, [76, null, '2026-10-01 00:00:00', 'x', 1]]))[0]).toBe('');   // le groupe Null vient en premier
  });
  it('aborts', async () => { const c = new AbortController(); c.abort(); await expect(run(FACTURES_REPORT, FACTURES_ROWS, frEnv({ signal: c.signal }))).rejects.toThrow(/abort/i); });
  it('is deterministic', async () => expect(JSON.stringify(await run())).toBe(JSON.stringify(await run())));
});

describe('sortAndGroup', () => {
  const rows: SqlValue[][] = [[1, 'b', null, 'x', 1], [2, null, null, 'x', 1], [3, 'A', null, 'x', 1], [4, 'a', null, 'x', 1], [5, 'B', null, 'x', 1]];
  it('stable per level, Null first ascending and last descending, case ignored', async () => {
    const asc = await sortAndGroup(readReport(FACTURES_REPORT, FACTURES_FIELDS), { fields: FACTURES_FIELDS, rows }, frEnv());
    expect(asc.order).toEqual([1, 2, 3, 0, 4]); expect(asc.keys).toEqual([[null], [str('A')], [str('a')], [str('b')], [str('B')]]);
    const desc = await sortAndGroup(readReport(withGrouping(FACTURES_REPORT, 0, { order: 'desc' }), FACTURES_FIELDS), { fields: FACTURES_FIELDS, rows }, frEnv());
    expect(desc.order).toEqual([0, 4, 2, 3, 1]);   // b et B, puis A et a : à égalité, l'ordre de la source
    expect(groupKeys(await run(FACTURES_REPORT, rows))).toEqual(['', 'A', 'b']);   // a et A, b et B : un groupe chacun
  });
  it('a key that fails is Null; levels sort in turn', async () => {
    const two = edit(FACTURES_REPORT, (c) => { c.props.grouping = [{ expression: '=1/0', order: 'asc', header: false, footer: false, keepTogether: 'no' },
      { expression: 'Montant', order: 'desc', header: false, footer: false, keepTogether: 'no' }]; });
    const g = await sortAndGroup(readReport(two, FACTURES_FIELDS), { fields: FACTURES_FIELDS, rows: FACTURES_ROWS.slice(0, 5) }, frEnv());
    expect(g.keys.map((k) => k[0])).toEqual([null, null, null, null, null]);
    expect(g.order.map((i) => FACTURES_ROWS[i]![4])).toEqual([...FACTURES_ROWS.slice(0, 5).map((r) => r[4] as number)].sort((a, b) => b - a));
  });
});

describe('layoutReport: bands and scopes', () => {
  it('totals read the group in headers, footers and the Detail, every row in the report sections; a sort-only level groups nothing', async () => {
    let d = withControl(withControl(withControl(FACTURES_REPORT, 'groupHeader', tb('NG', '=Count(*)')), 'detail', tb('ND', '=Count(*)')), 'reportHeader', tb('NR', '=Count(*)'));
    let r = await run(d);
    expect(bands(r, 'groupHeader').filter((b) => !b.repeated).map((b) => texts(b)[1])).toEqual(['60', '5', '10']);
    expect(texts(bands(r, 'detail')[0]!).at(-1)).toBe('60'); expect(texts(bands(r, 'detail').at(-1)!).at(-1)).toBe('10'); expect(texts(bands(r, 'reportHeader')[0]!).at(-1)).toBe('75');
    d = edit(d, (c) => { c.props.grouping = [{ expression: 'Client', order: 'desc', header: false, footer: false, keepTogether: 'no' }]; c.sections = c.sections.filter((s) => !s.kind.startsWith('group')); });
    r = await run(d);
    expect(bands(r, 'groupHeader')).toEqual([]); expect(texts(bands(r, 'detail')[0]!).at(-1)).toBe('75');
    expect(bands(r, 'detail').map((b) => texts(b)[1]).slice(0, 10)).toEqual(rowsOf('Martin').map((x) => x[3]));   // Martin d'abord (descendant), dans l'ordre de la source
  });
  it('two grouped levels: headers outermost first, footers innermost first, each level its own scope, repeated outermost first', async () => {
    const d = edit(FACTURES_REPORT, (c) => {
      (c.props.grouping as GroupLevel[]).push({ expression: '=[Montant]>1', order: 'asc', header: true, footer: true, keepTogether: 'no' });
      c.sections.push({ kind: 'groupHeader', groupLevel: 1, height: 340, props: { RepeatSection: true }, controls: [tb('NH1', '=Count(*)')] },
        { kind: 'groupFooter', groupLevel: 1, height: 340, props: {}, controls: [tb('NF1', '=Count(*)')] });
      sectionOf(c, 'detail').controls.push(tb('ND', '=Count(*)'));
      c.sections.find((s) => s.kind === 'groupFooter' && s.groupLevel === 0)!.controls.push(tb('NF0', '=Count(*)', { left: 0 }));
    });
    const r = await run(d, rowsOf('Durand', 'Dupont'));
    const lv = (b: LaidOutBand) => b.section + (b.groupLevel ?? '');
    const body = r.pages.flatMap((p) => p.bands.filter((b) => !b.repeated && !b.section.startsWith('page')));
    const durand = bands(r, 'detail').slice(60).map((b) => texts(b).at(-1));
    const [a, b] = [3, 2];   // Durand : Vrai (-1) avant Faux (0), donc 12,35, 7,65 et 100, puis 0,01 et 0,99
    expect(body.map(lv)).toEqual(['reportHeader', 'groupHeader0', 'groupHeader1', ...Array(60).fill('detail'), 'groupFooter1', 'groupFooter0',
      'groupHeader0', 'groupHeader1', ...Array(a).fill('detail'), 'groupFooter1', 'groupHeader1', ...Array(b).fill('detail'), 'groupFooter1', 'groupFooter0', 'reportFooter']);
    const count = (s: SectionKind, level: number) => body.filter((x) => x.section === s && x.groupLevel === level).map((x) => texts(x).at(-1));
    expect(count('groupHeader', 1)).toEqual(['60', String(a), String(b)]); expect(count('groupFooter', 1)).toEqual(['60', String(a), String(b)]);
    expect(durand).toEqual([...Array(a).fill(String(a)), ...Array(b).fill(String(b))]);
    expect(count('groupFooter', 0)).toEqual(['60', '5']);
    expect(r.pages[1]!.bands.slice(0, 3).map((x) => lv(x) + (x.repeated ? '*' : ''))).toEqual(['pageHeader', 'groupHeader0*', 'groupHeader1*']);
  });
  it('a band sits at the body left, as wide as the report but never wider than the page; bands go down each page', async () => {
    const r = await run(edit(FACTURES_REPORT, (c) => { c.props.Width = 20000; }));
    expect(r).toMatchObject({ width: 11906, height: 16838 }); expect(r.pages.every((p) => p.bands.every((b) => b.left === 567 && b.width === 10772))).toBe(true);
    for (const p of r.pages) expect(p.bands.map((b) => b.top)).toEqual(p.bands.map((b) => b.top).sort((a, b) => a - b));
    expect(r.pages[0]!.bands.slice(0, 3).map((b) => [b.section, b.top])).toEqual([['reportHeader', 567], ['pageHeader', 1701], ['groupHeader', 2268]]);
    expect(r.pages[0]!.bands.at(-1)).toMatchObject({ section: 'pageFooter', top: 567 + 15704 - 567, height: 567 });
    expect((await run()).pages[1]!.bands.slice(0, 2).map((b) => b.top)).toEqual([567, 1134]);
  });
  it('the Page Header reads the first Detail row of its page, the Page Footer the last; a total there is #Erreur', async () => {
    const d = withControl(withControl(withoutPagesFooter(FACTURES_REPORT), 'pageHeader', tb('PL', 'Libellé', { top: 113 })), 'pageFooter', tb('PS', '=Sum([Montant])', { top: 113 }));
    const r = await run(withControl(d, 'pageFooter', tb('PF', 'Libellé', { left: 0, top: 0 })));
    for (const p of r.pages) {
      const details = p.bands.filter((b) => b.section === 'detail').map((b) => texts(b)[1]);
      const head = texts(p.bands.find((b) => b.section === 'pageHeader')!), foot = texts(p.bands.find((b) => b.section === 'pageFooter')!);
      expect(head.at(-1)).toBe(details[0]); expect(foot).toEqual([expect.any(String), '#Erreur', details.at(-1)]);
    }
    expect(r.issues).toContainEqual({ code: 'aggregateNotAllowed', control: 'PS', detail: '=Sum([Montant])' });
  });
  it('issues: the definition\'s, then the bands\', each once', async () => {
    const rows = FACTURES_ROWS.map((x, i) => (i < 3 ? [...x.slice(0, 3), '😀', x[4]!] : x));
    const r = await run(withControl(FACTURES_REPORT, 'detail', tb('X', '[Inconnu]')), rows);
    expect(r.issues).toEqual([{ code: 'unknownField', control: 'X', detail: 'Inconnu' }, { code: 'glyphMissing', control: 'Libelle', detail: '😀' }]);
  });
});

describe('layoutReport: placement', () => {
  /** Durand then Martin, after a Report Header that leaves 600 twips under Durand's footer: Martin's header fits, not with its first Detail. */
  const tight = (keepTogether: GroupLevel['keepTogether']) => run(withGrouping(edit(FACTURES_REPORT, (c) => { sectionOf(c, 'reportHeader').height = 11362; }), 0, { keepTogether }), rowsOf('Durand', 'Martin'));
  it('keep with first Detail: a header never ends a page alone', async () => {
    let r = await tight('withFirstDetail');
    expect(seq(r.pages[0]!).at(-2)).toBe('groupFooter'); expect(seq(r.pages[1]!).slice(0, 3)).toEqual(['pageHeader', 'groupHeader', 'detail']);
    r = await tight('no');
    expect(seq(r.pages[0]!).at(-2)).toBe('groupHeader'); expect(seq(r.pages[1]!).slice(0, 3)).toEqual(['pageHeader', 'groupHeader*', 'detail']);
  });
  it('keep whole group: a group taller than a page keeps at least its header with its first Detail', async () => {
    const big = (keepTogether: GroupLevel['keepTogether']) => run(withGrouping(edit(FACTURES_REPORT, (c) => { sectionOf(c, 'reportHeader').height = 13970; }), 0, { keepTogether }), rowsOf('Dupont'));
    expect(seq((await big('wholeGroup')).pages[0]!)).toEqual(['reportHeader', 'pageHeader', 'pageFooter']);   // 600 restants : l'en-tête, pas son premier détail
    expect(seq((await big('no')).pages[0]!)).toEqual(['reportHeader', 'pageHeader', 'groupHeader', 'pageFooter']);
  });
  it('without Repeat Section, a group continues with no header', async () => {
    const r = await run(withSection(FACTURES_REPORT, 'groupHeader', { RepeatSection: false }));
    expect(seq(r.pages[1]!).slice(0, 2)).toEqual(['pageHeader', 'detail']);
  });
  it('a band that reads [Page] is formatted again when Keep Together moves it', async () => {
    const seen: [number, number][] = [];
    const hooks = { onFormat: async (e: SectionEvent) => { if (e.section === 'detail' && e.formatCount > 1) seen.push([e.page, e.formatCount]); } };
    const r = await run(withControl(withoutPagesFooter(FACTURES_REPORT), 'detail', tb('P', '=[Page]')), FACTURES_ROWS, frEnv({ hooks }));
    expect(seen).toEqual([[2, 2], [3, 2]]);   // le 39e détail de Dupont, le 10e de Martin
    expect(texts(r.pages[1]!.bands.find((b) => b.section === 'detail')!).at(-1)).toBe('2');
  });
  it('page break controls: in a band it is cut there, at its bottom the next band opens a page', async () => {
    const pb = (top: number): ControlDef => ({ kind: 'pageBreak', name: 'Saut', left: 0, top, width: 0, height: 0, props: {} });
    let r = await run(withControl(FACTURES_REPORT, 'reportHeader', pb(567)));
    expect(seq(r.pages[0]!)).toEqual(['reportHeader', 'pageHeader', 'pageFooter']);
    expect(r.pages[1]!.bands[1]).toMatchObject({ section: 'reportHeader', continued: true, height: 567, top: 1134 });
    expect((await run(withControl(FACTURES_REPORT, 'groupHeader', pb(0)))).pages.map(seq))   // en haut : comme Saut de page Avant
      .toEqual((await run(withSection(FACTURES_REPORT, 'groupHeader', { ForceNewPage: 'before' }))).pages.map(seq));
    r = await run(withControl(FACTURES_REPORT, 'groupFooter', pb(454)));
    expect(r.pages.map((p) => p.bands.filter((b) => b.section === 'groupFooter').length)).toEqual([0, 1, 1, 1, 0]);
    expect(seq(r.pages[4]!)).toEqual(['pageHeader', 'reportFooter', 'pageFooter']);
  });
  it('force new page after: the next band starts a page, never a trailing empty page', async () => {
    const r = await run(withSection(withSection(FACTURES_REPORT, 'reportHeader', { ForceNewPage: 'after' }), 'reportFooter', { ForceNewPage: 'after' }));
    expect(seq(r.pages[0]!)).toEqual(['reportHeader', 'pageHeader', 'pageFooter']); expect(seq(r.pages.at(-1)!).at(-2)).toBe('reportFooter');
  });
  it('a band with no cut point that reads [Page] is formatted again when it moves whole to the next page', async () => {
    // pied d'état sans Garder ensemble : 36 détails de Dupont le poussent à la page 2
    let r = await run(withControl(withoutPagesFooter(FACTURES_REPORT), 'reportFooter', tb('P', '="P" & [Page]', { top: 0, height: 567 })), rowsOf('Dupont').slice(0, 36));
    expect(r.pages).toHaveLength(2); expect(bands(r, 'reportFooter')).toHaveLength(1);
    expect(seq(r.pages[1]!)).toContain('reportFooter'); expect(reportFooterTexts(r).at(-1)).toBe('P2');
    // pied de groupe : 200 twips sous le 5e détail de Durand
    r = await run(edit(withoutPagesFooter(FACTURES_REPORT), (c) => {
      sectionOf(c, 'reportHeader').height = 12216; sectionOf(c, 'groupFooter').controls = [tb('P', '="P" & [Page]', { left: 0, top: 0, height: 454 })];
    }), rowsOf('Durand'));
    expect(seq(r.pages[1]!)).toContain('groupFooter'); expect(texts(bands(r, 'groupFooter')[0]!)).toEqual(['P2']);
  });
  it('a pending page break is kept by a band that does not print: no trailing empty page', async () => {
    const pageOnly = (r: LaidOutReport) => r.pages.filter((p) => seq(p).every((s) => s === 'pageHeader' || s === 'pageFooter'));
    const after = withSection(FACTURES_REPORT, 'groupFooter', { ForceNewPage: 'after' });
    let r = await run(withSection(after, 'reportFooter', { Visible: false }));
    expect(pageOnly(r)).toEqual([]); expect(r.pages).toHaveLength(4);
    r = await run(after, FACTURES_ROWS, frEnv({ hooks: { onFormat: async (e) => { if (e.section === 'reportFooter') e.cancel = true; } } }));
    expect(pageOnly(r)).toEqual([]); expect(r.pages).toHaveLength(4);
    // a hidden band's own Force New Page Before opens nothing either
    r = await run(withSection(FACTURES_REPORT, 'reportFooter', { Visible: false, ForceNewPage: 'before' }));
    expect(pageOnly(r)).toEqual([]); expect(r.pages).toHaveLength(3);
    // the break still holds for the next band that prints: a hidden header between them does not use it up
    r = await run(withSection(withSection(FACTURES_REPORT, 'groupHeader', { Visible: false }), 'groupFooter', { ForceNewPage: 'after' }));
    expect(r.pages.map((p) => seq(p).filter((s) => s === 'groupFooter').length)).toEqual([0, 1, 1, 1, 0]); expect(seq(r.pages[4]!)).toEqual(['pageHeader', 'reportFooter', 'pageFooter']);
  });
  it('onPrint sees each placed band once, on its page; cancel leaves the space empty', async () => {
    const printed: string[] = [];
    const hooks = { onPrint: async (e: SectionEvent) => { printed.push(`${e.section}@${e.page}`); if (e.section === 'detail') e.cancel = true; } };
    const r = await run(withoutPagesFooter(FACTURES_REPORT), FACTURES_ROWS, frEnv({ hooks }));
    expect([...printed].sort()).toEqual(r.pages.flatMap((p) => p.bands.map((b) => `${b.section}@${p.number}`)).sort());
    expect(printed.filter((s) => s.startsWith('detail'))).toHaveLength(75);
    expect(bands(r, 'detail').every((b) => b.items.length === 0)).toBe(true); expect(seq(r.pages[0]!)).toHaveLength(42);
  });
  it('a band with no cut point taller than the page is cut cleanly, and the layout ends', async () => {
    const r = await run(edit(FACTURES_REPORT, (c) => {
      const d = sectionOf(c, 'detail'); d.height = MAX_TWIPS; d.controls.push({ kind: 'rectangle', name: 'Cadre', left: 0, top: 0, width: 1000, height: MAX_TWIPS, props: {} });
    }), FACTURES_ROWS.slice(0, 1));
    const parts = bands(r, 'detail');
    expect(seq(r.pages[0]!)).not.toContain('detail');   // pas de point de coupe et une page déjà commencée : la bande part à la page suivante
    expect(parts.length).toBeGreaterThan(2); expect(parts.reduce((s, b) => s + b.height, 0)).toBe(MAX_TWIPS);
    expect(parts.map((b) => b.items.filter((i) => i.kind === 'rect').length)).toEqual(parts.map(() => 1));   // le cadre, coupé à chaque page
  });
  it('a cut with no cut point never goes through a line of text: the line moves whole to the next page', async () => {
    // un cadre couvre tout le mémo : aucune limite de ligne n'est un point de coupe, la coupe forcée doit remonter au début d'une ligne
    const d = edit(withMemo(FACTURES_REPORT, 130), (c) => sectionOf(c, 'detail').controls.push({ kind: 'rectangle', name: 'Cadre', left: 0, top: 0, width: 1000, height: MAX_TWIPS, props: {} }));
    const parts = bands(await run(d, FACTURES_ROWS.slice(0, 1)), 'detail');
    expect(parts.length).toBeGreaterThan(2);
    const lh = 230;   // Liberation Sans 10 pt
    for (const b of parts) for (const i of b.items) if (i.kind === 'text') for (const l of i.lines) expect(i.top + l.y + lh).toBeLessThanOrEqual(b.height);
    expect(parts.flatMap((b) => b.items.flatMap((i) => (i.kind === 'text' ? i.lines.map((l) => l.text) : [])))).toHaveLength(133);   // 130 lignes et la ligne de facture, chacune une fois
  });
});

describe('layoutReport: passes', () => {
  it('a third pass when [Pages] widens text and changes the page count, never a fourth', async () => {
    let n = 0;
    const d = withControl(withSection(FACTURES_REPORT, 'reportHeader', { CanGrow: true }), 'reportHeader', tb('Large', '=String([Pages] * 1000, "W")', { left: 0, top: 680, width: 4535 }, { CanGrow: true }));
    const r = await run(d, FACTURES_ROWS, frEnv({ hooks: { onFormat: async (e) => { if (e.section === 'reportHeader') n++; } } }));
    expect(n).toBe(3);
    const pages = Number(footerText(r.pages[0]!)!.split(' sur ')[1]);
    expect(pages).toBeGreaterThan(3);   // la passe 2 a compté plus de pages que la passe 1 (3)
    expect(r.pages.map((p) => footerText(p))).toEqual(r.pages.map((p) => `Page ${p.number} sur ${pages}`));
  });
});

describe('layoutReport: responsiveness and scale', () => {
  /** Runs `f` with Date.now (the heartbeat's clock) moved on by `step` ms at each read. */
  const clocked = async <T>(step: number, f: () => Promise<T>): Promise<T> => {
    let now = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => (now += step));
    try { return await f(); } finally { spy.mockRestore(); }
  };
  it('yields after 50 ms of work, and stops when aborted during a yield', async () => {
    let ticks = 0;
    await clocked(0, () => run(withoutPagesFooter(FACTURES_REPORT), FACTURES_ROWS, frEnv({ tick: async () => { ticks++; } })));
    expect(ticks).toBe(0);   // moins de 50 ms : jamais
    await clocked(10, () => run(withoutPagesFooter(FACTURES_REPORT), FACTURES_ROWS, frEnv({ tick: async () => { ticks++; } })));
    expect(ticks).toBeGreaterThan(10);
    const c = new AbortController(); ticks = 0;
    await expect(clocked(60, () => run(FACTURES_REPORT, FACTURES_ROWS, frEnv({ signal: c.signal, tick: async () => { if (++ticks === 7) c.abort(); } }))))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(ticks).toBe(7);
  });
  it('hands over the pages of the pass whose count is known as they close: the only pass, or the one after [Pages] is counted', async () => {
    const seen: number[] = [];
    const r = await run(withoutPagesFooter(FACTURES_REPORT), FACTURES_ROWS, frEnv({ onPage: (p) => { seen.push(p.length); } }));
    expect(seen).toEqual(r.pages.map((_, i) => i + 1));
    seen.length = 0;
    const r2 = await run(FACTURES_REPORT, FACTURES_ROWS, frEnv({ onPage: (p) => { seen.push(p.length); } }));
    expect(seen).toEqual(r2.pages.map((_, i) => i + 1));   // la passe qui compte les pages n'en montre aucune
  });
  it('the pass that counts the pages formats a band of fixed shape once, and gives the same pages', async () => {
    let calls = 0;
    const d = withControl(FACTURES_REPORT, 'detail', tb('Quand', '=Now()'));   // now() : une fois par mise en forme du détail
    const env = frEnv({ now: () => { calls++; return new Date(0); } });
    const counted = await run(d, FACTURES_ROWS, env), withPages = calls;
    calls = 0;
    const single = await run(withoutPagesFooter(d), FACTURES_ROWS, env);
    expect(withPages - calls).toBeLessThan(10);   // sans le raccourci : 75 de plus, une par ligne
    expect(counted.pages.map(seq)).toEqual(single.pages.map(seq));
  });
  it('a 10,000-row report formats in linear time: each total once per scope, across passes and repeated headers', async () => {
    // Count(Now()) appelle now() une fois par ligne de sa portée : le compteur dit combien de lignes les totaux ont lues
    let d = edit(FACTURES_REPORT, (c) => { sectionOf(c, 'detail').controls = []; });   // un détail léger : le test mesure la mise en page, pas le format
    for (const k of ['groupHeader', 'detail', 'groupFooter'] as const) d = withControl(d, k, tb(`N_${k}`, '=Count(Now())'));
    const rows = Array.from({ length: 10000 }, (_, i) => FACTURES_ROWS[i % 75]!);
    let calls = 0;
    const r = await run(d, rows, frEnv({ now: () => { calls++; return new Date(0); } }));
    expect(r.pages.length).toBeGreaterThan(200);   // [Pages] : deux passes ; l'en-tête de Dupont répété sur chaque page
    expect(calls).toBe(3 * 10000);   // en-tête, détail, pied : une fois par groupe chacun, jamais par bande ni par passe
  }, 60000);
  // revue finale I1 : une définition aux dimensions absurdes ne fige jamais le moteur de rendu
  const noPageSections = (d: DesignDoc) => edit(d, (c) => { c.sections = c.sections.filter((s) => s.kind !== 'pageHeader' && s.kind !== 'pageFooter'); });
  it.each([9e15, 1e9])('a Detail %d twips high, with no page header or footer, is clamped: a few pages, with its issue', async (big) => {
    const r = await run(edit(noPageSections(FACTURES_REPORT), (c) => { sectionOf(c, 'detail').height = big; }), FACTURES_ROWS.slice(0, 1));
    expect(r.pages.length).toBeLessThanOrEqual(4);   // en-têtes, 31 680 twips de détail sur des pages de 15 704, pieds
    expect(r.issues).toContainEqual({ code: 'sizeClamped', detail: 'detail' });
  });
  it('a band cut over many pages yields, and is aborted there', async () => {
    let ticks = 0;
    const d = withMemo(noPageSections(FACTURES_REPORT), 7000), one = FACTURES_ROWS.slice(0, 1);
    // 60 ms à chaque lecture de l'horloge : chaque battement cède ; la coupe bat au moins une fois par page
    const r = await clocked(60, () => run(d, one, frEnv({ tick: async () => { ticks++; } })));
    expect(r.pages.length).toBeGreaterThan(150);
    expect(ticks).toBeGreaterThanOrEqual(r.pages.length);
    const c = new AbortController(), stop = ticks - 1;
    ticks = 0;
    await expect(clocked(60, () => run(d, one, frEnv({ signal: c.signal, tick: async () => { if (++ticks === stop) c.abort(); } })))).rejects.toMatchObject({ name: 'AbortError' });
  }, 60000);
  it(`stops past ${MAX_PAGES} pages with tooManyPages`, async () => {
    const d = edit(noPageSections(FACTURES_REPORT), (c) => { sectionOf(c, 'detail').height = MAX_TWIPS; });   // plus de deux pages par ligne
    const rows = Array.from({ length: 5000 }, (_, i) => FACTURES_ROWS[i % 75]!);
    await expect(run(d, rows)).rejects.toMatchObject({ code: 'tooManyPages' });
  }, 60000);
});

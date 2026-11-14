import fs from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertAccessDesign } from './access-design';
import { flattenControls, validateDesignDoc, type DesignDoc } from './design/model';
import { parseCanonical, serialize, serializeCriteria } from './expr/parser';
import { readReport, type GroupLevel } from './report/model';

const fixture = (f: string) => fs.readFileSync(join(__dirname, '../../tests/fixtures/access/Ventes-complet.export', f), 'utf8');
const form = () => convertAccessDesign(fixture('forms/1.txt'), 'form');
const flat = (d: DesignDoc) => d.sections.flatMap((s) => flattenControls(s.controls));
const ctl = (d: DesignDoc, name: string) => flat(d).find((c) => c.name === name)!;
const wrap = (controls: string) => `Begin Form\n Begin\n  Begin Section\n   Height =1000\n   Begin\n${controls}\n   End\n  End\n End\nEnd\n`;

describe('control cap', () => {
  const many = (n: number) => wrap('    Begin Line\n    End\n'.repeat(n));
  it('20 000 controls convert, 20 001 throw tooLong', () => {
    expect(validateDesignDoc(convertAccessDesign(many(20000), 'form').doc)).toEqual([]);
    expect(() => convertAccessDesign(many(20001), 'form')).toThrow(expect.objectContaining({ code: 'tooLong' }));
  });
});

describe('measured on real applications (E4 task 6)', () => {
  const ctlBlock = (type: string, name: string, extra: string) => `    Begin ${type}\n     Name ="${name}"\n     Width =1000\n     Height =300\n${extra}    End\n`;
  it('pure bookkeeping is never counted, what has an effect still is', () => {
    const head = ['EventProcPrefix ="Form"', 'DisplayOnSharePointSite =1', 'NoSaveCTIWhenDisabled =1', 'GridY =24', 'TabularFamily =0', 'AutoCenter =1'].map((l) => ` ${l}\n`).join('');
    const btn = ['ThemeFontIndex =1', 'QuickStyle =10', 'QuickStyleMask =-1', 'WebImagePaddingTop =1', 'WebImagePaddingBottom =1', 'WebImagePaddingLeft =1', 'WebImagePaddingRight =1', 'HoverColor =123'].map((l) => `     ${l}\n`).join('');
    const combo = '     RowSourceTypeInt =1\n     RowSourceType ="Value List"\n';
    const r = convertAccessDesign(`Begin Form\n${head} Begin\n  Begin Section\n   Height =1000\n   Begin\n${ctlBlock('CommandButton', 'B', btn)}${ctlBlock('ComboBox', 'C', combo)}   End\n  End\n End\nEnd\n`, 'form');
    expect([...r.ignored.keys()].sort()).toEqual(['AutoCenter', 'HoverColor']);
  });
  it('ColumnWidth: a positive width is carried, -1 (the default) is not', () => {
    const d = convertAccessDesign(wrap(ctlBlock('TextBox', 'A', '     ColumnWidth =2400\n') + ctlBlock('TextBox', 'B', '     ColumnWidth =-1\n')), 'form');
    expect(validateDesignDoc(d.doc)).toEqual([]);
    expect(ctl(d.doc, 'A').props.ColumnWidth).toBe(2400);
    expect(ctl(d.doc, 'B').props.ColumnWidth).toBeUndefined();
    expect(d.ignored.get('ColumnWidth')).toBeUndefined();
  });
});

describe('convertAccessDesign, forms', () => {
  it('the fixture form: valid, sections, record source, code', () => {
    const r = form();
    expect(validateDesignDoc(r.doc)).toEqual([]);
    expect(r.doc.recordSource).toBeNull();
    expect(r.recordSource).toBe('Clients');
    expect(r.doc.sections.map((s) => [s.kind, s.height])).toEqual([['formHeader', 899], ['detail', 8164], ['formFooter', 0]]);
    expect(r.doc.sections[0]!.props.BackColor).toBe('#b8d4f0');
    expect(r.doc.props.Width).toBe(11838);
    expect(r.code).toContain('Form_Current');
  });
  it("positions are Access's, to the twip", () => {
    const d = form().doc;
    expect(ctl(d, 'N°')).toMatchObject({ kind: 'textBox', left: 1620, top: 343, width: 10157, height: 334, props: { ControlSource: 'N°', LeftMargin: 44, BottomPadding: 150 } });
    expect(ctl(d, 'Étiquette0')).toMatchObject({ kind: 'label', left: 343, top: 343, width: 1209, height: 334, props: { Caption: 'N°' } });
    expect(ctl(d, 'Commande25')).toMatchObject({ kind: 'commandButton', left: 2794, top: 60, width: 9009, height: 291, props: { Caption: 'Ouvrir état', OnClick: 'MOuvrirEtat', HorizontalAnchor: 'both' } });
    expect(ctl(d, 'Modifiable30')).toMatchObject({ kind: 'comboBox', left: 2040, top: 60, width: 694, height: 291 });
    expect(ctl(d, 'Fille21')).toMatchObject({ kind: 'subform', left: 343, top: 5134, width: 11434, height: 2880, props: { SourceObject: 'Table.Commandes', LinkMasterFields: 'N°', LinkChildFields: 'Client' } });
  });
  it('an attached label follows its control in the same list', () => {
    const detail = form().doc.sections[1]!.controls.map((c) => c.name);
    expect(detail.indexOf('Étiquette0')).toBe(detail.indexOf('N°') + 1);
  });
  it("inherited style is written: the labels take the form's default block", () => {
    expect(ctl(form().doc, 'Étiquette0').props).toMatchObject({ FontName: 'Aptos', FontSize: 11, ForeColor: '#666666' });   // 6710886
  });
  it('notes: the event procedure, the attachment', () => {
    const r = form();
    expect(r.doc.props.OnCurrent).toBeUndefined();
    expect(r.notes).toContainEqual({ code: 'eventDropped', part: 'Form_Current', reason: 'procedure' });
    expect(r.notes.filter((n) => n.code === 'controlReplaced').map((n) => n.reason)).toEqual(['Attachment']);
    expect(flat(r.doc).some((c) => c.kind === 'label' && c.props.BorderStyle === 'solid' && c.props.Caption === c.name)).toBe(true);
    expect(flat(r.doc).some((c) => /^CelluleVide/.test(c.name))).toBe(false);   // EmptyCell dropped
  });
  it('ignored properties are counted by name, bookkeeping is not', () => {
    const { ignored } = form();
    expect(ignored.get('GUID')).toBeUndefined();
    expect(ignored.get('LayoutCachedLeft')).toBeUndefined();
    expect(ignored.get('IMESentenceMode')).toBeUndefined();
    expect(ignored.get('RowStart')).toBeGreaterThan(0);
    expect(ignored.get('AllowDatasheetView')).toBe(1);
  });
  it('names: duplicate, refused, missing, __proto__', () => {
    const r = convertAccessDesign(wrap('Begin TextBox\n Name ="A"\nEnd\nBegin TextBox\n Name ="a"\nEnd\nBegin TextBox\n Name ="[x]"\nEnd\nBegin TextBox\nEnd\nBegin TextBox\n Name ="__proto__"\nEnd'), 'form');
    expect(validateDesignDoc(r.doc)).toEqual([]);
    expect(flat(r.doc)).toHaveLength(5);
    expect(r.notes.filter((n) => n.code === 'controlRenamed').length).toBeGreaterThanOrEqual(3);
    expect(flat(r.doc).map((c) => c.name)).toEqual(['A', 'a1', 'x', 'textBox', '__proto__']);
    expect(({} as Record<string, unknown>).Name).toBeUndefined();
  });
  it('a tab control and an option group nest', () => {
    const r = convertAccessDesign(wrap('Begin Tab\n Name ="T"\n Begin\n  Begin Page\n   Name ="P1"\n   Caption ="One"\n   Begin\n    Begin TextBox\n     Name ="A"\n    End\n   End\n  End\n  Begin Page\n   Name ="P2"\n   Begin\n    Begin OptionGroup\n     Name ="G"\n     Begin\n      Begin Label\n       Name ="GL"\n      End\n      Begin OptionButton\n       Name ="O1"\n       OptionValue =1\n      End\n     End\n    End\n   End\n  End\n End\nEnd'), 'form');
    const tab = r.doc.sections[0]!.controls[0]!;
    expect(tab).toMatchObject({ kind: 'tabControl', props: { Pages: ['One', 'P2'] } });
    expect(tab.children!.map((c) => [c.name, c.props.PageIndex ?? 0])).toEqual([['A', 0], ['G', 1], ['GL', 1]]);
    expect(tab.children![1]!.children!.map((c) => [c.name, c.props.OptionValue])).toEqual([['O1', 1]]);
  });
  it('events: expression and embedded macro are dropped and noted; an unknown system colour is counted', () => {
    const r = convertAccessDesign(wrap('Begin CommandButton\n Name ="B"\n OnClick ="=Go()"\n OnDblClickEmMacro = Begin\n  Version =1\n End\n ForeColor =-2147483550\nEnd'), 'form');
    expect(ctl(r.doc, 'B').props.OnClick).toBeUndefined();
    expect(r.notes).toEqual(expect.arrayContaining([{ code: 'eventDropped', part: '=Go()', reason: 'expression' }, { code: 'eventDropped', part: 'B.OnDblClick', reason: 'embeddedMacro' }]));
    expect(r.ignored.get('ForeColor')).toBe(1);
  });
  it('an expression BaseCraft does not read is kept as written', () => {
    const r = convertAccessDesign(wrap('Begin TextBox\n Name ="A"\n ControlSource ="=1 +"\nEnd\nBegin TextBox\n Name ="B"\n ControlSource ="=[x]+1"\nEnd'), 'form');
    expect(ctl(r.doc, 'A').props.ControlSource).toBe('=1 +');
    expect(r.notes).toContainEqual({ code: 'expressionKept', part: 'A' });
    expect(ctl(r.doc, 'B').props.ControlSource).toBe(`=${serialize(parseCanonical('[x]+1'))}`);
  });
  it("a form's page header is dropped; no detail gives an empty one; wrong kind is refused", () => {
    const r = convertAccessDesign('Begin Form\n Begin\n  Begin PageHeader\n   Height =100\n  End\n End\nEnd\n', 'form');
    expect(r.doc.sections).toEqual([{ kind: 'detail', height: 0, props: {}, controls: [] }]);
    expect(r.notes).toEqual([{ code: 'sectionDropped', part: 'PageHeader' }]);
    expect(() => convertAccessDesign('Begin Report\nEnd\n', 'form')).toThrow(expect.objectContaining({ code: 'noRoot' }));
  });
  it('names stay within the limit and renaming is linear', () => {
    const x64 = 'x'.repeat(64);
    const r = convertAccessDesign(wrap(`Begin TextBox\n Name ="${x64}"\nEnd\nBegin TextBox\n Name ="${x64}"\nEnd\nBegin TextBox\n Name ="${x64}"\nEnd\nBegin TextBox\n Name ="${'[y'.repeat(70)}"\nEnd`), 'form');
    expect(validateDesignDoc(r.doc)).toEqual([]);
    const names = flat(r.doc).map((c) => c.name);
    expect(new Set(names).size).toBe(4);
    for (const n of names) expect([...n].length).toBeLessThanOrEqual(64);
    const t0 = Date.now();
    const big = convertAccessDesign(wrap('Begin Line\nEnd\n'.repeat(3000)), 'form');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(validateDesignDoc(big.doc)).toEqual([]);
    expect(new Set(flat(big.doc).map((c) => c.name.toLowerCase())).size).toBe(3000);
  });
  it('a block typed like an Object.prototype key is not a section start', () => {
    const t = 'Begin Form\n Begin\n  Begin constructor\n  End\n  Begin TextBox\n   FontName ="Zed"\n  End\n  Begin Section\n   Begin\n    Begin TextBox\n     Name ="T"\n    End\n   End\n  End\n End\nEnd\n';
    expect(ctl(convertAccessDesign(t, 'form').doc, 'T').props.FontName).toBe('Zed');
  });
  it('a second section of the same kind is dropped and noted', () => {
    const r = convertAccessDesign('Begin Form\n Begin\n  Begin FormHeader\n  End\n  Begin Section\n  End\n  Begin Section\n  End\n  Begin FormHeader\n  End\n  Begin FormFooter\n  End\n  Begin FormFooter\n  End\n End\nEnd\n', 'form');
    expect(r.notes).toEqual([{ code: 'sectionDropped', part: 'Section' }, { code: 'sectionDropped', part: 'FormHeader' }, { code: 'sectionDropped', part: 'FormFooter' }]);
  });
  it.each<[string, string, string | undefined]>([
    ['OldBorderStyle =0\n BorderLineStyle =3', 'BorderStyle', 'transparent'],
    ['OldBorderStyle =1\n BorderLineStyle =0', 'BorderStyle', undefined],
    ['OldBorderStyle =1\n BorderLineStyle =1', 'BorderStyle', 'dashed'],
    ['OldBorderStyle =1\n BorderLineStyle =3', 'BorderStyle', 'dotted'],
    ['BackStyle =0', 'BackStyle', 'transparent'],
    ['BackStyle =1', 'BackStyle', undefined],
    ['FontWeight =700', 'FontWeight', 'bold'],
    ['FontWeight =400', 'FontWeight', undefined],
    ['TextAlign =1', 'TextAlign', 'left'],
    ['TextAlign =2', 'TextAlign', 'center'],
    ['TextAlign =3', 'TextAlign', 'right'],
    ['TextAlign =9', 'TextAlign', undefined],
    ['DecimalPlaces =255', 'DecimalPlaces', undefined],
    ['DecimalPlaces =2', 'DecimalPlaces', '2'],
    ['ForeColor =-2147483643', 'ForeColor', '#ffffff'],
  ])('enum conversion (undefined: the default is not written): %s', (text, prop, want: string | undefined) => {
    const c = ctl(convertAccessDesign(wrap(`Begin TextBox\n Name ="A"\n ${text}\nEnd`), 'form').doc, 'A');
    expect(c.props[prop]).toBe(want);
  });
  it('DefaultView and RowSourceType', () => {
    const v = (n: number) => convertAccessDesign(`Begin Form\n DefaultView =${n}\nEnd\n`, 'form');
    expect([0, 1, 2].map((n) => v(n).doc.props.DefaultView)).toEqual([undefined, 'continuous', 'datasheet']);   // single is the default
    expect(v(5).doc.props.DefaultView).toBeUndefined();
    expect(v(5).ignored.get('DefaultView')).toBe(1);
    const r = convertAccessDesign(wrap('Begin ComboBox\n Name ="V"\n RowSourceType ="Value List"\n RowSource ="a;b"\nEnd\nBegin ComboBox\n Name ="F"\n RowSourceType ="Field List"\n RowSource ="T"\nEnd'), 'form');
    expect(ctl(r.doc, 'V').props).toMatchObject({ RowSourceType: 'valueList', RowSource: 'a;b' });
    expect(ctl(r.doc, 'F').props.RowSourceType).toBeUndefined();
    expect(ctl(r.doc, 'F').props.RowSource).toBeUndefined();
    expect([r.ignored.get('RowSourceType'), r.ignored.get('RowSource')]).toEqual([1, 1]);
  });
  it('garbage values do not throw and do not leak a wrong type', () => {
    const r = convertAccessDesign(wrap('Begin TextBox\n Left ="abc"\n Top =-5\n Width =1e300\n Height =1.5\n Name = Begin\n  0x00\n End\n Caption = Begin\n  0x00\n End\n FontSize ="big"\n ForeColor ="red"\nEnd'), 'form');
    expect(validateDesignDoc(r.doc)).toEqual([]);
    const c = flat(r.doc)[0]!;
    for (const n of [c.left, c.top, c.width, c.height]) expect(Number.isSafeInteger(n) && n >= 0).toBe(true);
    expect(['undefined', 'number']).toContain(typeof c.props.FontSize);
    expect(c.props.ForeColor === undefined || /^#[0-9a-f]{6}$/.test(c.props.ForeColor as string)).toBe(true);
  });
  it('ValidationRule and DefaultValue are stored canonical, refused ones are kept and noted', () => {
    const r = convertAccessDesign(wrap('Begin TextBox\n Name ="A"\n ValidationRule =">0"\n DefaultValue ="=Date()"\nEnd\nBegin TextBox\n Name ="B"\n ValidationRule =">>"\nEnd'), 'form');
    expect(ctl(r.doc, 'A').props.ValidationRule).toBe(serializeCriteria(parseCanonical('>0', { criteria: true })));
    expect(ctl(r.doc, 'A').props.DefaultValue).toBe(serialize(parseCanonical('Date()')));
    expect(ctl(r.doc, 'B').props.ValidationRule).toBe('>>');
    expect(r.notes.filter((n) => n.code === 'expressionKept')).toEqual([{ code: 'expressionKept', part: 'B' }]);
  });
});

const mip = (v: number[]) => new Uint8Array(new Int32Array([...v, ...Array(14 - v.length).fill(0)]).buffer);
const dev = (orientation: number, paper: number) => { const b = new Uint8Array(64); new DataView(b.buffer).setInt16(44, orientation, true); new DataView(b.buffer).setInt16(46, paper, true); return b; };
const report = () => convertAccessDesign(fixture('reports/1.txt'), 'report');

describe('convertAccessDesign, reports', () => {
  it('the fixture report: sections, grouping, sources', () => {
    const r = report();
    expect(validateDesignDoc(r.doc)).toEqual([]);
    expect(r.recordSource).toBe('Commandes');
    expect(r.doc.props.Width).toBe(22372);
    expect(r.doc.props.grouping).toEqual([{ expression: 'Client', order: 'asc', header: true, footer: true, keepTogether: 'no' }, { expression: 'Lot', order: 'asc', header: true, footer: true, keepTogether: 'no' }]);
    expect(r.doc.sections.map((s) => [s.kind, s.groupLevel])).toEqual([['reportHeader', undefined], ['pageHeader', undefined], ['groupHeader', 0], ['groupHeader', 1], ['detail', undefined], ['groupFooter', 1], ['groupFooter', 0], ['pageFooter', undefined], ['reportFooter', undefined]]);
    // Access's own sections (object model): the footer of level 1 is 1134 high, that of level 0 is 461 — the text holds the innermost first
    expect(r.doc.sections.slice(5, 7).map((s) => s.height)).toEqual([1134, 461]);
    expect(r.doc.sections[0]!.height).toBe(727);
    const sources = (i: number) => flattenControls(r.doc.sections[i]!.controls).map((c) => c.props.ControlSource).filter(Boolean);
    expect(sources(8)).toEqual([`=${serialize(parseCanonical('Sum([Montant])'))}`]);
    expect(sources(7)).toEqual([`=${serialize(parseCanonical('"Page " & [Page] & " sur " & [Pages]'))}`]);
    expect(sources(4)).toEqual(['N°', 'Montant', 'Le', 'Quantité', 'Remise', 'Poids', 'Taux', 'Lot']);
    expect(r.notes).toContainEqual({ code: 'pageDefault' });   // the committed fixture has no Prt blocks
    expect(r.doc.props.pageSetup).toBeUndefined();
    expect(r.doc.props.columns).toBeUndefined();
  });
  it('the document reads as a report: readReport finds the groups and no structural issue', () => {
    const spec = readReport(report().doc, []);
    expect(spec.grouping).toHaveLength(2);
    for (const i of [0, 1]) { expect(spec.groupHeaders[i]).toBeDefined(); expect(spec.groupFooters[i]).toBeDefined(); }
    expect(spec.issues.map((i) => i.code).filter((c) => c === 'groupingMalformed' || c === 'sectionIgnored' || c === 'unsupportedControl')).toEqual([]);
  });
  const rep = (levels: string, sections: string) => `Begin Report\n Begin\n${levels}\n${sections}\n End\nEnd\n`;
  const level = (src: string, extra = '') => `Begin BreakLevel\n ControlSource ="${src}"\n${extra}\nEnd`;
  it('two levels: headers first to last, footers last to first; sort order; keep together', () => {
    const r = convertAccessDesign(rep(`${level('A', 'GroupHeader = NotDefault\nGroupFooter = NotDefault\nSortOrder = NotDefault')}\n${level('B', 'GroupFooter = NotDefault\nKeepTogether =1')}\n${level('C')}`,
      'Begin BreakHeader\n Name ="hA"\nEnd\nBegin Section\nEnd\nBegin BreakFooter\n Name ="fB"\nEnd\nBegin BreakFooter\n Name ="fA"\nEnd'), 'report');
    expect((r.doc.props.grouping as GroupLevel[]).map((g) => [g.expression, g.order, g.header, g.footer, g.keepTogether])).toEqual([['A', 'desc', true, true, 'no'], ['B', 'asc', false, true, 'wholeGroup'], ['C', 'asc', false, false, 'no']]);
    expect(r.doc.sections.map((s) => [s.kind, s.groupLevel])).toEqual([['groupHeader', 0], ['detail', undefined], ['groupFooter', 1], ['groupFooter', 0]]);
  });
  it('sections and levels that do not match', () => {
    const r = convertAccessDesign(rep(level('A', 'GroupHeader = NotDefault\nGroupFooter = NotDefault'), 'Begin BreakHeader\nEnd\nBegin BreakHeader\nEnd\nBegin Section\nEnd'), 'report');
    expect(r.doc.sections.map((s) => s.kind)).toEqual(['groupHeader', 'detail']);
    expect(r.notes).toContainEqual({ code: 'sectionDropped', part: 'BreakHeader' });
    expect((r.doc.props.grouping as GroupLevel[])[0]).toMatchObject({ header: true, footer: false });
    expect(readReport(r.doc, []).issues.map((i) => i.code)).not.toContain('sectionIgnored');
  });
  it('group on / interval are counted; an expression key is canonical, else kept and noted; no detail: an empty one is made', () => {
    const r = convertAccessDesign(rep(`${level('=Year([Le])', 'GroupOn =3\nGroupInterval =2')}\n${level('=Nope((')}`, 'Begin PageHeader\nEnd'), 'report');
    expect(r.ignored.get('GroupOn')).toBe(1);
    expect(r.ignored.get('GroupInterval')).toBe(1);
    expect((r.doc.props.grouping as GroupLevel[]).map((g) => g.expression)).toEqual([`=${serialize(parseCanonical('Year([Le])'))}`, '=Nope((']);
    expect(r.notes).toContainEqual({ code: 'expressionKept', part: 'grouping' });
    expect(r.doc.sections.map((s) => s.kind)).toEqual(['pageHeader', 'detail']);
  });
  it('a level is not a default block, and a second single section is dropped', () => {
    const r = convertAccessDesign(rep(`${level('A', 'SortOrder = NotDefault')}\n${level('B')}`, 'Begin Section\nEnd\nBegin Section\nEnd'), 'report');
    expect((r.doc.props.grouping as GroupLevel[]).map((g) => g.order)).toEqual(['desc', 'asc']);
    expect(r.notes).toContainEqual({ code: 'sectionDropped', part: 'Section' });
  });
  const HF = 'GroupHeader = NotDefault\nGroupFooter = NotDefault';
  const clean = (r: ReturnType<typeof convertAccessDesign>) => readReport(r.doc, []).issues.map((i) => i.code).filter((c) => c === 'groupingMalformed' || c === 'sectionIgnored');
  it('a level without a key is removed with its sections; later levels are renumbered', () => {
    const noKey = `Begin BreakLevel\n${HF}\nEnd`;
    const emptyKey = `Begin BreakLevel\n ControlSource =""\n${HF}\nEnd`;
    for (const mid of [noKey, emptyKey]) {
      const hs = ['hA', 'hMid', 'hC'].map((n) => `Begin BreakHeader\n Begin\n  Begin TextBox\n   Name ="${n}"\n  End\n End\nEnd`).join('\n');
      const fs = ['fC', 'fMid', 'fA'].map((n) => `Begin BreakFooter\n Begin\n  Begin TextBox\n   Name ="${n}"\n  End\n End\nEnd`).join('\n');
      const r = convertAccessDesign(rep(`${level('A', HF)}\n${mid}\n${level('C', HF)}`, `${hs}\nBegin Section\nEnd\n${fs}`), 'report');
      expect((r.doc.props.grouping as GroupLevel[]).map((g) => g.expression)).toEqual(['A', 'C']);
      expect(r.doc.sections.map((s) => [s.kind, s.groupLevel, s.controls[0]?.name])).toEqual([['groupHeader', 0, 'hA'], ['groupHeader', 1, 'hC'], ['detail', undefined, undefined], ['groupFooter', 1, 'fC'], ['groupFooter', 0, 'fA']]);
      expect(r.notes.filter((n) => n.code === 'sectionDropped' && n.part === 'BreakLevel')).toHaveLength(1);
      expect(validateDesignDoc(r.doc)).toEqual([]);
      expect(clean(r)).toEqual([]);
    }
  });
  it('levels beyond the tenth are removed with their sections', () => {
    const names = 'ABCDEFGHIJKL'.split('');
    const r = convertAccessDesign(rep(names.map((n) => level(n, HF)).join('\n'), `${names.map(() => 'Begin BreakHeader\nEnd').join('\n')}\nBegin Section\nEnd\n${names.map(() => 'Begin BreakFooter\nEnd').join('\n')}`), 'report');
    expect((r.doc.props.grouping as GroupLevel[]).map((g) => g.expression)).toEqual(names.slice(0, 10));
    expect(r.notes.filter((n) => n.code === 'sectionDropped' && n.part === 'BreakLevel')).toHaveLength(2);
    expect(r.doc.sections).toHaveLength(21);
    expect(validateDesignDoc(r.doc)).toEqual([]);
    expect(clean(r)).toEqual([]);
  });
  it('a level without SortOrder is ascending', () => {
    const r = convertAccessDesign(rep('Begin BreakLevel\n ControlSource ="A"\nEnd', 'Begin Section\nEnd'), 'report');
    expect((r.doc.props.grouping as GroupLevel[])[0]!.order).toBe('asc');
  });
  it('page setup from the Prt blocks', () => {
    const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString('hex')}`;
    const r = convertAccessDesign(`Begin Report\n PrtMip = Begin\n  ${hex(mip([1440, 720, 1440, 720, 0, 0, 0, 1, 1]))}\n End\n PrtDevMode = Begin\n  ${hex(dev(2, 1))}\n End\n Begin\n  Begin Section\n  End\n End\nEnd\n`, 'report');
    expect(r.doc.props.pageSetup).toEqual({ orientation: 'landscape', paper: 'letter', margins: { left: 1440, top: 720, right: 1440, bottom: 720 } });
    expect(r.doc.props.columns).toBeUndefined();
    expect(r.notes).not.toContainEqual({ code: 'pageDefault' });
    expect(r.ignored.has('PrtMip')).toBe(false);
  });
  it('several columns reach the document', () => {
    const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString('hex')}`;
    const r = convertAccessDesign(`Begin Report\n PrtMip = Begin\n  ${hex(mip([567, 567, 567, 567, 0, 0, 0, 1, 2, 0, 100]))}\n End\n Begin\n  Begin Section\n  End\n End\nEnd\n`, 'report');
    expect(r.doc.props.columns).toEqual({ count: 2, spacing: 100, across: false });
  });
});

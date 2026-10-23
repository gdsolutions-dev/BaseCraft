// Mise en forme d'une bande : valeurs, texte en lignes, Peut augmenter / Peut réduire, points de coupe, points d'accroche.
import { describe, expect, it } from 'vitest';
import { formatBand, type BandContext } from './band';
import { readReport } from './model';
import { lineHeight, measure } from './text';
import type { FontSpec, LaidOutItem, LayoutEnv, LayoutHooks, ReportData, SectionEvent } from './types';
import type { ControlDef, SectionDef } from '../design/model';
import type { Value } from '../expr/ast';
import { formatValue } from '../expr/format';
import { num, str } from '../expr/library';
import type { SqlValue } from '../coerce';
import { defaultProps, type FieldProps, type FieldType } from '../field-types';
import type { SourceField } from '../record-source';

const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField => ({ name, type, props: { ...defaultProps(type), ...props } });
const FIELDS = [sf('Client', 'shortText'), sf('Montant', 'currency'), sf('Note', 'longText'), sf('Payé', 'yesNo'),
  sf('Dec', 'number', { numberSize: 'decimal', precision: 18, scale: 4 })];
const fr = { locale: 'fr-FR', lang: 'fr' } as const;

const MONO: FontSpec = { name: 'Liberation Mono', size: 10, bold: false, italic: false, underline: false };
/** Width of n Liberation Mono 10 pt characters, rounded up to the twip. */
const mono = (n: number) => Math.ceil(measure('a'.repeat(n), MONO).width);
const lh = lineHeight(MONO);

const GEOMETRY = ['left', 'top', 'width', 'height'];
/** A control: `o` mixes geometry and properties; text in Liberation Mono 10 pt with no border, so widths are exact. */
const ctl = (kind: ControlDef['kind'], name: string, o: Record<string, unknown> = {}, text = true): ControlDef => ({
  kind, name, left: 0, top: 0, width: 3000, height: 300,
  ...Object.fromEntries(Object.entries(o).filter(([k]) => GEOMETRY.includes(k))),
  props: { ...(text ? { FontName: 'Liberation Mono', FontSize: 10, BorderStyle: 'transparent' } : {}),
    ...Object.fromEntries(Object.entries(o).filter(([k]) => !GEOMETRY.includes(k))) },
});
const tb = (name: string, src: string, o: Record<string, unknown> = {}) => ctl('textBox', name, { ControlSource: src, ...o });
const lbl = (name: string, caption: string, o: Record<string, unknown> = {}) => ctl('label', name, { Caption: caption, ...o });
const cb = (name: string, src: string, o: Record<string, unknown> = {}) => ctl('checkBox', name, { ControlSource: src, ...o });
// a line or a rectangle keeps the catalog border (a transparent line draws nothing)
const ln = (name: string, o: Record<string, unknown> = {}) => ctl('line', name, o, false);
const rc = (name: string, o: Record<string, unknown> = {}) => ctl('rectangle', name, o, false);
const pb = (name: string, o: Record<string, unknown> = {}) => ctl('pageBreak', name, o, false);
/** A Detail section of 1134 twips; `height` in `o` is its height, the rest its properties. */
const sec = (controls: ControlDef[], o: Record<string, unknown> = {}): SectionDef => {
  const { height = 1134, ...props } = o;
  return { kind: 'detail', height: height as number, props, controls };
};

const stored = (v: Record<string, SqlValue>) => FIELDS.map((f) => v[f.name] ?? null);
const row = (v: Record<string, SqlValue> = {}): ReportData => ({ fields: FIELDS, rows: [stored(v)] });
const rows = (list: Record<string, SqlValue>[]): ReportData => ({ fields: FIELDS, rows: list.map(stored) });

async function fmt(s: SectionDef, data: ReportData, o: { ctx?: Partial<BandContext>; hooks?: LayoutHooks } = {}) {
  const spec = readReport({ formatVersion: '1.0', recordSource: null, props: {}, sections: [s] }, FIELDS).detail!;
  const env: LayoutEnv = { ...fr, now: () => new Date(0), errorText: { error: '#Erreur', name: '#Nom?' }, ...(o.hooks ? { hooks: o.hooks } : {}) };
  return formatBand(spec, data, { row: 0, scope: data.rows.map((_, i) => i), page: 1, pages: null, formatCount: 1, ...o.ctx }, env);
}
type Band = Awaited<ReturnType<typeof fmt>>;
/** An item by control name, untyped: the tests read every kind's fields. */
const item = (b: Band, name: string): any => b!.items.find((i: LaidOutItem) => i.name === name);
const text = (b: Band, name: string): string => (item(b, name).lines as { text: string }[]).map((l) => l.text).join('\n');

describe('formatBand (brief)', () => {
  it('field value formatted, currency default', async () => { const b = await fmt(sec([tb('M', '[Montant]', { width: 2000 })]), row({ Montant: 12.35 }));
    expect(text(b, 'M')).toBe(formatValue(num(12.35), 'currency', { locale: 'fr-FR', lang: 'fr' })); expect(item(b, 'M').align).toBe('right'); });
  it('label wraps without CanGrow and clips to box', async () => { const b = await fmt(sec([lbl('L', 'aaaa bbbb cccc', { width: mono(5), height: lh })]), row());
    expect(item(b, 'L').lines.map((l: { text: string }) => l.text)).toEqual(['aaaa']); });
  it('CanGrow pushes controls below and grows the section', async () => {
    const b = await fmt(sec([tb('T', '[Note]', { top: 0, height: lh, width: mono(5), CanGrow: true }), tb('U', '[Client]', { top: lh + 10 })], { CanGrow: true, height: 2 * lh + 10 }), row({ Note: 'aaaa bbbb cccc' }));
    expect(item(b, 'T').height).toBe(3 * lh); expect(item(b, 'U').top).toBe(lh + 10 + 2 * lh); expect(b!.height).toBe(2 * lh + 10 + 2 * lh);
    expect(b!.cuts).toContain(lh); expect(b!.cuts).toContain(2 * lh);
  });
  it('CanShrink removes empty control space unless overlapped', async () => {
    const b = await fmt(sec([tb('A', '[Note]', { top: 0, height: 300, CanShrink: true }), tb('B', '[Client]', { top: 300 })], { CanShrink: true, height: 600 }), row({ Note: null }));
    expect(item(b, 'A')).toBeUndefined(); expect(item(b, 'B').top).toBe(0); expect(b!.height).toBe(300);
  });
  it('errors and unknown fields', async () => { const b = await fmt(sec([tb('X', '=1/0'), tb('Y', '[Inconnu]')]), row());
    expect(text(b, 'X')).toBe('#Erreur'); expect(text(b, 'Y')).toBe('#Nom?'); });
  it('number too wide shows ####', async () => expect(text(await fmt(sec([tb('N', '[Montant]', { width: mono(3) })]), row({ Montant: 123456 })), 'N')).toBe('###'));
  it('aggregate over scope with Page refs', async () => {
    const b = await fmt(sec([tb('S', '=Sum([Montant])'), tb('P', '="Page " & [Page] & " sur " & [Pages]')]), rows([{ Montant: 0.1 }, { Montant: 0.2 }]), { ctx: { row: null, scope: [0, 1], page: 2, pages: 5 } });
    expect(text(b, 'S')).toBe(formatValue(num(0.3), 'currency', fr)); expect(text(b, 'P')).toBe('Page 2 sur 5');
  });
  it('check box, line, rect, page break', async () => {
    const b = await fmt(sec([cb('C', '[Payé]'), ln('L', { left: 0, top: 100, width: 500, height: 0 }), rc('R'), pb('B', { top: 600 })]), row({ Payé: null }));
    expect(item(b, 'C').checked).toBeNull(); expect(item(b, 'L')).toMatchObject({ x1: 0, y1: 100, x2: 500, y2: 100 }); expect(b!.breaks).toEqual([600]); });
  it('slanted line', async () => expect(item(await fmt(sec([ln('L', { left: 0, top: 0, width: 500, height: 200, LineSlant: true })]), row()), 'L')).toMatchObject({ x1: 0, y1: 200, x2: 500, y2: 0 }));
  it('onFormat hook can hide a control, change a value or cancel', async () => {
    const hooks = { onFormat: async (e: SectionEvent) => { e.visible.U = false; e.values.T = str('X'); } };
    const b = await fmt(sec([tb('T', '[Client]'), tb('U', '[Client]')]), row({ Client: 'A' }), { hooks });
    expect(text(b, 'T')).toBe('X'); expect(item(b, 'U')).toBeUndefined();
    expect(await fmt(sec([tb('T', '[Client]')]), row(), { hooks: { onFormat: async (e: SectionEvent) => { e.cancel = true; } } })).toBeNull();
  });
  it('missing glyph reported once', async () => expect((await fmt(sec([tb('T', '[Client]')]), row({ Client: '😀😀' })))!.issues).toEqual([{ code: 'glyphMissing', control: 'T', detail: '😀' }]));
});

describe('formatBand: values', () => {
  /** The Value each bound control gets, as the onFormat hook sees it. */
  const valuesOf = async (controls: ControlDef[], data: ReportData, ctx?: Partial<BandContext>) => {
    let got: Record<string, Value> = {};
    await fmt(sec(controls), data, { ctx, hooks: { onFormat: async (e) => { got = { ...e.values }; } } });
    return got;
  };
  it('Empty values are counted and summed as 0 (C7)', async () => {
    const v = await valuesOf([tb('C', '=Count(Nz([Montant]))'), tb('N', '=Count([Montant])'), tb('S', '=Sum(Nz([Montant]))')], rows([{ Montant: null }, { Montant: null }]));
    expect(v).toEqual({ C: num(2), N: num(0), S: num(0) });
  });
  it('a Decimal field stored as TEXT totals exactly', async () => {
    const v = await valuesOf([tb('S', '=Sum([Dec])'), tb('A', '=Avg([Dec])')], rows([{ Dec: '0.1000' }, { Dec: '0.2000' }]));
    expect(v.S).toEqual(num(0.3)); expect(v.A).toEqual(num(0.15));
  });
  it('Page and Pages resolve outside aggregates only, and a real field named Page wins', async () => {
    const b = await fmt(sec([tb('A', '=Sum([Page])'), tb('P', '=[Pages] + 1')]), row(), { ctx: { page: 3, pages: null } });
    expect(text(b, 'A')).toBe('#Nom?'); expect(text(b, 'P')).toBe('1');   // pages inconnu au premier passage : 0
  });
  it('with no current row a field is Null; an error source shows #Erreur, an unbound one nothing', async () => {
    const b = await fmt(sec([tb('F', '[Client]'), tb('E', '=1 +'), tb('U', '')]), row({ Client: 'A' }), { ctx: { row: null } });
    expect(text(b, 'F')).toBe(''); expect(text(b, 'E')).toBe('#Erreur'); expect(text(b, 'U')).toBe('');
  });
  it('default format: a currency total, never a count', async () => {
    const b = await fmt(sec([tb('S', '=Max([Montant])'), tb('C', '=Count([Montant])'), tb('F', '[Montant]', { Format: 'fixed' }), tb('X', '=Sum([Montant]) * 2')]), rows([{ Montant: 2 }, { Montant: 3 }]));
    expect(text(b, 'S')).toBe(formatValue(num(3), 'currency', fr)); expect(text(b, 'C')).toBe('2');
    expect(text(b, 'F')).toBe(formatValue(num(2), 'fixed', fr)); expect(text(b, 'X')).toBe('10');
  });
  it('a total is computed once per scope and data, not once per band', async () => {
    // Count(Now()) appelle now() une fois par ligne de la portée : le compteur dit combien de fois le total est calculé
    const spec = readReport({ formatVersion: '1.0', recordSource: null, props: {}, sections: [sec([tb('T', '=Count(Now())')])] }, FIELDS).detail!;
    let calls = 0;
    const env: LayoutEnv = { ...fr, now: () => { calls++; return new Date(0); }, errorText: { error: '#Erreur', name: '#Nom?' } };
    const data = rows([{}, {}, {}]), scope = [0, 1, 2];
    const ctx = (r: number, s = scope): BandContext => ({ row: r, scope: s, page: 1, pages: null, formatCount: 1 });
    for (const r of scope) expect(text(await formatBand(spec, data, ctx(r), env), 'T')).toBe('3');
    expect(calls).toBe(3);   // une seule fois pour les trois bandes de la même portée
    expect(text(await formatBand(spec, data, ctx(0, [0]), env), 'T')).toBe('1'); expect(calls).toBe(4);   // une autre portée : son propre total
    await formatBand(spec, rows([{}, {}, {}]), ctx(0), env); expect(calls).toBe(7);   // d'autres données : recalculé
  });
  it('a check box reads its value as a truth value', async () => {
    const b = await fmt(sec([cb('Y', '[Payé]'), cb('N', '=[Payé] = 0'), cb('E', '[Client]')]), row({ Payé: 1, Client: 'abc' }));
    expect([item(b, 'Y').checked, item(b, 'N').checked, item(b, 'E').checked]).toEqual([true, false, null]);
  });
});

describe('formatBand: text', () => {
  it('a line break in a label gives lines, never a missing glyph', async () => {
    const b = await fmt(sec([lbl('L', 'ab\r\ncd\ne', { height: 3 * lh })]), row());
    expect(item(b, 'L').lines.map((l: { text: string }) => l.text)).toEqual(['ab', 'cd', 'e']); expect(b!.issues).toEqual([]);
  });
  it('alignment inside the border: x, y and width per line', async () => {
    const w = mono(10) + 30;   // 10 characters inside a 15-twip border on each side
    const b = await fmt(sec([tb('R', '[Montant]', { width: w, BorderStyle: 'solid' }), lbl('C', 'ab', { width: w, TextAlign: 'center', BorderStyle: 'solid' })]), row({ Montant: 1 }));
    const one = formatValue(num(1), 'currency', fr);
    expect(item(b, 'R').lines).toEqual([{ text: one, x: Math.round(w - 30 - measure(one, MONO).width), y: 0, width: Math.round(measure(one, MONO).width) }]);
    expect(item(b, 'C').lines).toEqual([{ text: 'ab', x: Math.round((w - 30 - measure('ab', MONO).width) / 2), y: 0, width: Math.round(measure('ab', MONO).width) }]);
    expect(item(b, 'R').border).toMatchObject({ width: 15 });
  });
  it('a CanGrow box keeps every line and counts its border', async () => {
    const b = await fmt(sec([tb('T', '[Note]', { height: 300, width: mono(5) + 30, CanGrow: true, BorderStyle: 'solid' })], { CanGrow: true }), row({ Note: 'aaaa bbbb cccc dddd' }));
    expect(item(b, 'T').lines.map((l: { y: number }) => l.y)).toEqual([0, lh, 2 * lh, 3 * lh]); expect(item(b, 'T').height).toBe(4 * lh + 30);
    expect(b!.cuts).toEqual(expect.arrayContaining([15 + lh, 15 + 2 * lh, 15 + 3 * lh]));
  });
});

describe('formatBand: Can Grow and Can Shrink', () => {
  it('stacked growing boxes push each other down (the push accumulates)', async () => {
    const b = await fmt(sec([tb('A', '[Note]', { top: 0, height: lh, width: mono(5), CanGrow: true }), tb('B', '[Note]', { top: lh, height: lh, width: mono(5), CanGrow: true }),
      tb('C', '[Client]', { top: 2 * lh })], { CanGrow: true, height: 2 * lh + 300 }), row({ Note: 'aaaa bbbb' }));
    expect(item(b, 'B').top).toBe(2 * lh); expect(item(b, 'C').top).toBe(4 * lh); expect(b!.height).toBe(4 * lh + 300);
  });
  it('side by side, the largest growth wins', async () => {
    const b = await fmt(sec([tb('A', '[Note]', { left: 0, height: lh, width: mono(5), CanGrow: true }), tb('B', '[Client]', { left: 4000, height: lh, width: mono(5), CanGrow: true }),
      tb('C', '[Client]', { top: lh })], { CanGrow: true, height: lh + 300 }), row({ Note: 'aaaa bbbb cccc', Client: 'aaaa bbbb' }));
    expect(item(b, 'C').top).toBe(3 * lh); expect(b!.height).toBe(3 * lh + 300);
  });
  it('a section that cannot grow keeps its height; controls still move', async () => {
    const b = await fmt(sec([tb('T', '[Note]', { height: lh, width: mono(5), CanGrow: true }), tb('U', '[Client]', { top: lh })], { height: 600 }), row({ Note: 'aaaa bbbb' }));
    expect(item(b, 'U').top).toBe(2 * lh); expect(b!.height).toBe(600);
  });
  it('an overlapped empty box frees nothing; stacked empty boxes free both bands; side by side or nested only once', async () => {
    const empty = { Note: null, Client: null };
    const over = await fmt(sec([tb('A', '[Note]', { height: 300, CanShrink: true }), lbl('L', 'x', { left: 4000, top: 100, height: 300 }), tb('B', '[Montant]', { top: 400 })], { CanShrink: true, height: 700 }), row(empty));
    expect(item(over, 'A')).toBeUndefined(); expect(item(over, 'B').top).toBe(400); expect(over!.height).toBe(700);
    const stacked = await fmt(sec([tb('A', '[Note]', { height: 300, CanShrink: true }), tb('A2', '[Client]', { top: 300, height: 300, CanShrink: true }), tb('B', '[Montant]', { top: 600 })], { CanShrink: true, height: 900 }), row(empty));
    expect(item(stacked, 'B').top).toBe(0); expect(stacked!.height).toBe(300);
    const side = await fmt(sec([tb('A', '[Note]', { height: 300, CanShrink: true }), tb('A2', '[Client]', { left: 4000, height: 300, CanShrink: true }),
      tb('A3', '[Note]', { left: 8000, top: 100, height: 100, CanShrink: true }), tb('B', '[Montant]', { top: 300 })], { height: 600 }), row(empty));
    expect(item(side, 'B').top).toBe(0); expect(side!.height).toBe(600);   // la section ne peut pas réduire
  });
  it('a shrinking section never ends above its last control', async () => {
    // A libère 300 et T monte, mais T a grandi : la section (qui ne peut pas augmenter) garde 600, pas 300
    const b = await fmt(sec([tb('A', '[Note]', { height: 300, CanShrink: true }), tb('T', '[Client]', { top: 300, height: lh, width: mono(5), CanGrow: true })], { CanShrink: true, height: 600 }), row({ Client: 'aaaa bbbb cccc' }));
    expect(item(b, 'A')).toBeUndefined(); expect(item(b, 'T')).toMatchObject({ top: 0, height: 3 * lh }); expect(b!.height).toBe(600);
    const below = await fmt(sec([tb('A', '[Note]', { height: 300, CanShrink: true }), tb('B', '[Client]', { top: 300, height: 300 })], { CanShrink: true, height: 900 }), row());
    expect(below!.height).toBe(600);   // 900 − 300 : l'espace sous B reste
  });
  it('a shrinking section whose controls are all empty collapses to the space between them', async () => {
    const one = await fmt(sec([tb('A', '[Note]', { height: 300, CanShrink: true })], { CanShrink: true, height: 300 }), row());
    expect(one!.items).toEqual([]); expect(one!.height).toBe(0);
    const two = await fmt(sec([tb('A', '[Note]', { height: 300, CanShrink: true }), tb('B', '[Client]', { top: 400, height: 300, CanShrink: true })], { CanShrink: true, height: 700 }), row());
    expect(two!.height).toBe(100);
  });
  it('the clamp is the bottom of the lowest control, not of the first one', async () => {
    // L finit haut, T (sous A vide) monte et grandit : la section s'arrête sous T, jamais sous L
    const grown = await fmt(sec([lbl('L', 'x', { left: 4000, height: 300 }), tb('A', '[Note]', { top: 300, height: 300, CanShrink: true }),
      tb('T', '[Client]', { top: 600, height: lh, width: mono(5), CanGrow: true })], { CanShrink: true, height: 900 }), row({ Client: 'aaaa bbbb cccc' }));
    expect(item(grown, 'T')).toMatchObject({ top: 300, height: 3 * lh }); expect(grown!.height).toBe(900);
    const mid = await fmt(sec([tb('A', '[Note]', { height: 300, CanShrink: true }), lbl('L', 'x', { top: 300, height: 100 }),
      tb('T', '[Client]', { top: 400, height: lh, width: mono(5), CanGrow: true })], { CanShrink: true, height: 900 }), row({ Client: 'aaaa bbbb cccc' }));
    expect(item(mid, 'T').top).toBe(100); expect(mid!.height).toBe(100 + 3 * lh);
  });
  it('invisible controls are not drawn and move nothing', async () => {
    const b = await fmt(sec([tb('T', '[Note]', { height: lh, width: mono(5), CanGrow: true, Visible: false }), tb('U', '[Client]', { top: lh }), pb('P', { top: 900, Visible: false })], { CanGrow: true }), row({ Note: 'aaaa bbbb' }));
    expect(item(b, 'T')).toBeUndefined(); expect(item(b, 'U').top).toBe(lh); expect(b!.breaks).toEqual([]); expect(b!.height).toBe(1134);
  });
});

describe('formatBand: cuts, breaks and hooks', () => {
  it('cuts are where nothing straddles, inside the band, ascending', async () => {
    const b = await fmt(sec([rc('R', { top: 100, height: 400 }), tb('T', '[Client]', { top: 200, height: 100 }), ln('L', { top: 700, height: 0 }), pb('P', { top: 800 })], { height: 1000 }), row({ Client: 'A' }));
    expect(b!.cuts).toEqual([100, 500, 700]); expect(b!.breaks).toEqual([800]);
  });
  it('page breaks move with the controls above them', async () => {
    const b = await fmt(sec([tb('T', '[Note]', { height: lh, width: mono(5), CanGrow: true }), pb('P', { top: lh })], { CanGrow: true }), row({ Note: 'aaaa bbbb' }));
    expect(b!.breaks).toEqual([2 * lh]);
  });
  it('the event carries the context; its height and section visibility apply', async () => {
    let seen: SectionEvent | undefined;
    const b = await fmt(sec([tb('T', '[Client]')]), row({ Client: 'A' }), { ctx: { page: 4, formatCount: 2 }, hooks: { onFormat: async (e) => { seen = { ...e }; e.height = 2000; } } });
    expect(seen).toMatchObject({ section: 'detail', page: 4, formatCount: 2, values: { T: str('A') }, visible: { T: true }, sectionVisible: true, cancel: false, height: 1134 });
    expect(b!.height).toBe(2000); expect(b!.event.height).toBe(2000);
    expect(await fmt(sec([tb('T', '[Client]')], { Visible: false }), row())).toBeNull();
    expect(await fmt(sec([tb('T', '[Client]')]), row(), { hooks: { onFormat: async (e) => { e.sectionVisible = false; } } })).toBeNull();
  });
  it('a value given to an unbound or failing control replaces its text', async () => {
    const b = await fmt(sec([tb('U', ''), tb('E', '=1/0')]), row(), { hooks: { onFormat: async (e) => { e.values.U = str('u'); e.values.E = num(1); } } });
    expect(text(b, 'U')).toBe('u'); expect(text(b, 'E')).toBe('1');
  });
  it('a combo box prints as a text box; an image keeps its size mode; a subform is an empty frame', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const b = await fmt(sec([ctl('comboBox', 'K', { ControlSource: '[Client]' }), ctl('image', 'I', { Picture: png, SizeMode: 'clip' }, false), ctl('subform', 'S', {}, false)]), row({ Client: 'A' }));
    expect(item(b, 'K')).toMatchObject({ kind: 'text', lines: [{ text: 'A' }] });
    expect(item(b, 'I')).toMatchObject({ kind: 'image', src: png, sizeMode: 'clip' });
    expect(item(b, 'S')).toMatchObject({ kind: 'rect', left: 0, top: 0, width: 3000, height: 300 });
  });
});

describe('formatBand (Task 6 carry-overs)', () => {
  it('a control named like an Object.prototype member reads nothing inherited', async () => {
    // toString n'a pas de valeur et constructor n'a plus d'entrée de visibilité : ni l'un ni l'autre ne lit Object.prototype
    const b = await fmt(sec([cb('toString', ''), lbl('constructor', 'x')]), row(), { hooks: { onFormat: async (e) => { Reflect.deleteProperty(e.visible, 'constructor'); } } });
    expect(item(b, 'toString').checked).toBeNull(); expect(item(b, 'constructor')).toBeUndefined();
  });
  it('a control named __proto__ prints its value', async () => {
    const b = await fmt(sec([tb('__proto__', '[Client]')]), row({ Client: 'Dupont' }));
    expect(text(b, '__proto__')).toBe('Dupont');
  });
  it('a zero-height growing box is not pushed by its own growth, nor by one beside it', async () => {
    const b = await fmt(sec([tb('Z', '[Note]', { top: 100, height: 0, width: mono(5), CanGrow: true }), tb('Y', '[Note]', { left: 4000, top: 100, height: 0, width: mono(5), CanGrow: true }),
      tb('U', '[Client]', { top: 200 })], { CanGrow: true, height: 500 }), row({ Note: 'aaaa bbbb' }));
    expect(item(b, 'Z').top).toBe(100); expect(item(b, 'Y').top).toBe(100); expect(item(b, 'U').top).toBe(200 + 2 * lh); expect(b!.height).toBe(500 + 2 * lh);
  });
  it('a page break inside a freed band moves up with the shrink', async () => {
    const b = await fmt(sec([tb('A', '[Note]', { top: 300, height: 300, CanShrink: true }), pb('P', { top: 450 }), tb('B', '[Client]', { top: 600 })], { CanShrink: true, height: 900 }), row());
    expect(item(b, 'B').top).toBe(300); expect(b!.breaks).toEqual([300]);
  });
});

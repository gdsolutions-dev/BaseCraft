import { describe, expect, it } from 'vitest';
import type { ControlDef } from '../../shared/design/model';
import { defaultProps, type FieldProps, type FieldType } from '../../shared/field-types';
import { bool, num, str } from '../../shared/expr/library';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import { buildCalcEnv, checkControlRule, controlDefaults, evalControlSource, FAILED, Latest, parseExpr, typedValue, unboundDefaults } from './calc';

const ctl = (props: Record<string, unknown>): ControlDef => ({ kind: 'textBox', name: 'T', left: 0, top: 0, width: 1000, height: 300, props });
const calcCtl = (src: string, props: Record<string, unknown> = {}): ControlDef => ctl({ ControlSource: src, ...props });
const bound = (field: string, props: Record<string, unknown> = {}): ControlDef => ({ ...ctl({ ControlSource: field, ...props }), name: field });
const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField =>
  ({ name, type, props: { ...defaultProps(type), ...props } as FieldProps });
const infoWith = (...fields: SourceField[]): SourceInfo =>
  ({ fields: fields.map((f) => ({ ...f, origin: { table: 'T', field: f.name } })), updatable: true, keyTable: 'T', parameters: [] });
const env = (fields = {}, controls = {}) => ({ fields, controls, locale: 'fr-FR', lang: 'fr' as const, now: () => new Date(2026, 9, 21, 14, 5) });

describe('evalControlSource', () => {
  it.each([
    ['=[Qté] * [Prix]', { Qté: num(3), Prix: num(2.5) }, {}, '7,5'],
    ['=[Nom] & " (" & [Ville] & ")"', { Nom: str('Dupont'), Ville: null }, {}, 'Dupont ()'],
    ['=[Total] * 2', {}, { Total: num(4) }, '8'],
    ['=IIf([Actif], "oui", "non")', { Actif: bool(true) }, {}, 'oui'],
  ])('%s', async (src, f, c, text) => expect(await evalControlSource(calcCtl(src), env(f, c))).toMatchObject({ ok: true, text }));
  it('control wins over field', async () => expect(await evalControlSource(calcCtl('=[X]'), env({ X: num(1) }, { X: num(2) }))).toMatchObject({ text: '2' }));
  it('control wins over field whatever the case', async () =>
    expect(await evalControlSource(calcCtl('=[x]'), env({ x: num(1) }, { X: num(2) }))).toMatchObject({ text: '2' }));
  it('#Name? and #Error', async () => {
    expect(await evalControlSource(calcCtl('=[Inconnu]'), env())).toEqual({ ok: false, code: 'name' });
    expect(await evalControlSource(calcCtl('=1/0'), env())).toEqual({ ok: false, code: 'error' });
  });
  it('unreadable definition = #Name?', async () => {
    expect(await evalControlSource(calcCtl('=1 +'), env())).toEqual({ ok: false, code: 'name' });
    expect(await evalControlSource(calcCtl('='), env())).toEqual({ ok: false, code: 'name' });
  });
  it('aggregate outside a report = #Error', async () => expect(await evalControlSource(calcCtl('=Sum([Qté])'), env({ Qté: num(1) }))).toEqual({ ok: false, code: 'error' }));
  it('format applies', async () => expect(await evalControlSource(calcCtl('=[P]', { Format: 'fixed' }), env({ P: num(2) }))).toMatchObject({ text: '2,00' }));
  it('booleans follow the language, Null is blank', async () => {
    expect(await evalControlSource(calcCtl('=1 < 2'), env())).toEqual({ ok: true, value: bool(true), text: 'Vrai' });
    expect(await evalControlSource(calcCtl('=1 < 2'), { ...env(), lang: 'en' })).toMatchObject({ text: 'True' });
    expect(await evalControlSource(calcCtl('=Null'), env())).toEqual({ ok: true, value: null, text: '' });
  });
});

describe('Latest', () => {
  it('stale token dropped', () => { const l = new Latest(); const a = l.next(); l.next(); expect(l.isCurrent(a)).toBe(false); });
  it('the last token is current', () => { const l = new Latest(); l.next(); const b = l.next(); expect(l.isCurrent(b)).toBe(true); });
});

describe('controlDefaults', () => {
  it('control default overrides field default', async () => expect(await controlDefaults([bound('Qté', { DefaultValue: '5' })], infoWith(sf('Qté', 'number', { defaultValue: '1' })), env()))
    .toEqual({ Qté: 5 }));
  it('field default when the control has none', async () => expect(await controlDefaults([bound('Qté')], infoWith(sf('Qté', 'number', { defaultValue: '1' })), env()))
    .toEqual({ Qté: 1 }));
  it('converted for the bound field, by its source name', async () => expect(await controlDefaults(
    [bound('qté', { DefaultValue: '2 + 3' }), bound('Quand', { DefaultValue: 'Date()' }), bound('Nom', { DefaultValue: '"x" & 1' })],
    infoWith(sf('Qté', 'shortText'), sf('Quand', 'dateTime'), sf('Nom', 'shortText')), env()))
    .toEqual({ Qté: '5', Quand: '2026-10-21 00:00:00', Nom: 'x1' }));
  it('two controls bound to the same field: the first one decides', async () => {
    const info = infoWith(sf('Qté', 'number', { defaultValue: '1' }));
    expect(await controlDefaults([bound('Qté', { DefaultValue: '5' }), { ...bound('qté', { DefaultValue: '7' }), name: 'Qté2' }], info, env())).toEqual({ Qté: 5 });
    expect(await controlDefaults([bound('Qté'), { ...bound('Qté', { DefaultValue: '7' }), name: 'Qté2' }], info, env())).toEqual({ Qté: 1 });
    expect(await controlDefaults([bound('Qté', { DefaultValue: '1/0' }), { ...bound('Qté', { DefaultValue: '7' }), name: 'Qté2' }], info, env())).toEqual({ Qté: null });
  });
  it('an evaluation error leaves the field empty', async () => expect(await controlDefaults(
    [bound('A', { DefaultValue: '1/0' }), bound('B', { DefaultValue: '[Autre]' })], infoWith(sf('A', 'number', { defaultValue: '1' }), sf('B', 'number')), env()))
    .toEqual({ A: null, B: null }));
  it('calculated, unbound and unknown controls give nothing; no default gives nothing', async () => expect(await controlDefaults(
    [calcCtl('=1', { DefaultValue: '2' }), ctl({ DefaultValue: '3' }), bound('Absent', { DefaultValue: '4' }), bound('Libre')],
    infoWith(sf('Libre', 'number')), env()))
    .toEqual({}));
});

describe('checkControlRule', () => {
  const qInfo = infoWith(sf('Qté', 'number'));
  it('control rule', async () => {
    expect(await checkControlRule(bound('Qté', { ValidationRule: '> 0', ValidationText: 'Positif' }), num(-1), qInfo, env()))
      .toEqual({ field: 'Qté', code: 'controlValidation', message: 'Positif' });
    expect(await checkControlRule(bound('Qté', { ValidationRule: '> 0' }), null, qInfo, env())).toBeNull();
  });
  it('passes when true or without a rule', async () => {
    expect(await checkControlRule(bound('Qté', { ValidationRule: '> 0' }), num(1), qInfo, env())).toBeNull();
    expect(await checkControlRule(bound('Qté'), num(-1), qInfo, env())).toBeNull();
  });
  it('a rule that cannot be evaluated blocks', async () => {
    const blocked = { field: 'Qté', code: 'controlValidation', message: 'Positif' };
    expect(await checkControlRule(bound('Qté', { ValidationRule: '> [Autre]', ValidationText: 'Positif' }), num(-1), qInfo, env())).toEqual(blocked);
    expect(await checkControlRule(bound('Qté', { ValidationRule: '> 0', ValidationText: 'Positif' }), str('abc'), qInfo, env())).toEqual(blocked);
    expect(await checkControlRule(bound('Qté', { ValidationRule: '>', ValidationText: 'Positif' }), num(1), qInfo, env())).toEqual(blocked);
  });
  it('the error names the bound field as the source spells it, else the control', async () => {
    expect(await checkControlRule(bound('qté', { ValidationRule: '> 0' }), num(-1), qInfo, env())).toEqual({ field: 'Qté', code: 'controlValidation' });
    expect(await checkControlRule({ ...ctl({ ValidationRule: '> 0' }), name: 'Libre' }, num(-1), qInfo, env())).toEqual({ field: 'Libre', code: 'controlValidation' });
  });
  it('no message without a Validation Text', async () => {
    const e = await checkControlRule(bound('Qté', { ValidationRule: '> 0', ValidationText: '' }), num(-1), qInfo, env());
    expect(e).toEqual({ field: 'Qté', code: 'controlValidation' });
    expect(e && 'message' in e && e.message !== undefined).toBe(false);
  });
});

describe('parseExpr', () => {
  it('parses each text once per mode, failures included', () => {
    expect(parseExpr('[A] + 1', false)).toBe(parseExpr('[A] + 1', false));
    expect(parseExpr('> 0', true)).not.toBe(parseExpr('0', false));
    expect(parseExpr('> 0', true)).toEqual({ k: 'bin', op: '>', l: { k: 'subject' }, r: { k: 'num', v: '0' } });
    let first: unknown, second: unknown;
    try { parseExpr('1 +', false); } catch (e) { first = e; }
    try { parseExpr('1 +', false); } catch (e) { second = e; }
    expect(first).toBeInstanceOf(Error);
    expect(second).toBe(first);
  });
});

describe('buildCalcEnv', () => {
  const base = { locale: 'fr-FR', lang: 'fr' as const, now: () => new Date(2026, 9, 21, 14, 5) };
  const info = infoWith(sf('Qté', 'number'), sf('Prix', 'number', { numberSize: 'double' }), sf('Nom', 'shortText', { required: true }), sf('Quand', 'dateTime'));
  const stored = { Qté: 3, Prix: 2.5, Nom: 'Dupont', Quand: '2026-10-21 00:00:00' };

  it('fields from the stored values, bound controls take their field value, calculated controls their result', async () => {
    const r = await buildCalcEnv([bound('qté'), { ...bound('Prix'), name: 'PrixU' }, { ...calcCtl('=[qté] * [PrixU]'), name: 'Total' }], info, stored, {}, base);
    expect(r.fields).toEqual({ Qté: num(3), Prix: num(2.5), Nom: str('Dupont'), Quand: { t: 'date', v: 46316 } });
    expect(r.controls).toEqual({ qté: num(3), PrixU: num(2.5), Total: num(7.5) });
    expect(r.results.Total).toEqual({ ok: true, value: num(7.5), text: '7,5' });
  });
  it('a pending edit beats the stored value, whatever the case of its key; a blank one is Null', async () => {
    const r = await buildCalcEnv([{ ...calcCtl('=[Qté] * [Prix]'), name: 'Total' }, { ...calcCtl('=IsNull([Nom])'), name: 'Vide' }],
      info, stored, { qté: '4', Prix: '0,5', Nom: '' }, base);
    expect(r.fields.Qté).toEqual(num(4));
    expect(r.results.Total).toMatchObject({ ok: true, text: '2' });
    expect(r.results.Vide).toMatchObject({ ok: true, text: 'Vrai' });
  });
  it('unreadable typed text is an error value: #Error where it is used', async () => {
    const r = await buildCalcEnv([bound('Qté'), { ...calcCtl('=[Qté] + 1'), name: 'Plus' }, { ...calcCtl('=[Prix] + 1'), name: 'Autre' }],
      info, stored, { Qté: 'abc' }, base);
    expect(r.fields.Qté).toBe(FAILED);
    expect(r.controls.Qté).toBe(FAILED);
    expect(r.results.Plus).toEqual({ ok: false, code: 'error' });
    expect(r.results.Autre).toMatchObject({ ok: true, text: '3,5' });
    expect(await evalControlSource(calcCtl('=[Quand]'), r)).toMatchObject({ ok: true, text: '21/10/2026' });
  });
  it('a failed calculated control is an error value too; a control bound to an unknown field is not in the environment', async () => {
    const r = await buildCalcEnv([{ ...calcCtl('=1/0'), name: 'Div' }, { ...calcCtl('=[Div] + 1'), name: 'Suite' }, bound('Absent')], info, stored, {}, base);
    expect(r.controls.Div).toBe(FAILED);
    expect(r.results.Suite).toEqual({ ok: false, code: 'error' });
    expect('Absent' in r.controls).toBe(false);
  });
  it('unbound controls: their values (extra) feed the calculated controls', async () => {
    const r = await buildCalcEnv([{ ...ctl({}), name: 'Remise' }, { ...calcCtl('=[Qté] * [Remise]'), name: 'Net' }], info, stored, {}, base, { Remise: num(2) });
    expect(r.controls.Remise).toEqual(num(2));
    expect(r.results.Net).toMatchObject({ ok: true, text: '6' });
  });
  it('controls inside an option group or a tab are included', async () => {
    const tab: ControlDef = { ...ctl({}), kind: 'tabControl', name: 'Onglets', children: [{ ...calcCtl('=[Qté] * 2'), name: 'Double' }] };
    expect((await buildCalcEnv([tab], info, stored, {}, base)).results.Double).toMatchObject({ ok: true, text: '6' });
  });
});

describe('calculation order', () => {
  const base = { locale: 'fr-FR', lang: 'fr' as const, now: () => new Date(2026, 9, 21, 14, 5) };
  const info = infoWith(sf('Qté', 'number'), sf('Total', 'number'));
  const calc = (name: string, src: string): ControlDef => ({ ...calcCtl(src), name });

  it('a control uses the result of a control placed after it', async () => {
    const r = await buildCalcEnv([calc('TTC', '=[ht] * 2'), calc('HT', '=[Qté] + 1')], info, { Qté: 3, Total: 10 }, {}, base);
    expect(r.results.TTC).toMatchObject({ ok: true, text: '8' });
  });
  it('a control referring to itself is #Error, even with a field of its name', async () => {
    const r = await buildCalcEnv([calc('Total', '=[Total] + 1')], info, { Qté: 3, Total: 10 }, {}, base);
    expect(r.results.Total).toEqual({ ok: false, code: 'error' });
    expect(await evalControlSource(calc('Total', '=[total] + 1'), { ...base, fields: { Total: num(10) }, controls: { Total: num(11) } }))
      .toEqual({ ok: false, code: 'error' });
  });
  it('a Null control is a value, not an absent name', async () => {
    const r = await buildCalcEnv([calc('Rien', '=Null'), calc('Suite', '=IsNull([Rien])')], info, { Qté: 3, Total: 10 }, {}, base);
    expect(r.results.Suite).toMatchObject({ ok: true, text: 'Vrai' });
    expect(await evalControlSource(calcCtl('=[Rien]'), { ...base, fields: {}, controls: { Rien: null } })).toEqual({ ok: true, value: null, text: '' });
    expect(await evalControlSource(calcCtl('=[total]'), { ...base, fields: { Total: num(10) }, controls: { Total: null } })).toEqual({ ok: true, value: null, text: '' });
  });
  it('a three-control cycle is #Error for its members and their user', async () => {
    const r = await buildCalcEnv([calc('A', '=[B] + 1'), calc('B', '=[C] + 1'), calc('C', '=[A] + 1'), calc('U', '=[C] * 2'), calc('D', '=[Qté]')],
      info, { Qté: 3, Total: 10 }, {}, base);
    const err = { ok: false, code: 'error' };
    expect(r.results).toEqual({ A: err, B: err, C: err, U: err, D: { ok: true, value: num(3), text: '3' } });
  });
  it('a cycle is #Error for its members and their users, the same on every pass', async () => {
    const cs = [calc('A', '=[B] + 1'), calc('B', '=[a] + 1'), calc('C', '=[A] * 2'), calc('D', '=[Qté]')];
    const first = await buildCalcEnv(cs, info, { Qté: 3, Total: 10 }, {}, base);
    expect(first.results).toEqual({ A: { ok: false, code: 'error' }, B: { ok: false, code: 'error' }, C: { ok: false, code: 'error' },
      D: { ok: true, value: num(3), text: '3' } });
    const second = await buildCalcEnv(cs, info, { Qté: 3, Total: 10 }, {}, base);
    expect(second.results).toEqual(first.results);
    expect(second.controls).toEqual(first.controls);
  });
});

describe('unbound controls', () => {
  const base = { locale: 'fr-FR', lang: 'fr' as const, now: () => new Date(2026, 9, 21, 14, 5) };
  it('typed text: blank is Null, a number in the region a number, anything else text', () => {
    expect(typedValue('', 'fr-FR')).toBeNull();
    expect(typedValue('2,5', 'fr-FR')).toEqual(num(2.5));
    expect(typedValue('abc', 'fr-FR')).toEqual(str('abc'));
  });
  it('Default Value of unbound inputs only (text box, check box, option group)', async () => {
    const u = (kind: ControlDef['kind'], name: string, props: Record<string, unknown>): ControlDef => ({ ...ctl(props), kind, name });
    expect(await unboundDefaults([u('textBox', 'Remise', { DefaultValue: '1 + 1' }), u('checkBox', 'Oui', { DefaultValue: 'True' }),
      u('textBox', 'Lié', { ControlSource: 'Qté', DefaultValue: '5' }), u('textBox', 'Calc', { ControlSource: '=1', DefaultValue: '5' }), u('textBox', 'Vide', {}),
      u('textBox', 'Faux', { DefaultValue: '1 +' })], base))
      .toEqual({ Remise: num(2), Oui: bool(true), Vide: null, Faux: null });
  });
});

describe('[Forms]! and [TempVars]! in a form (B2 R11)', () => {
  const member = (p: string[]) => (p[0] === 'Forms' ? str(`${p[1]}.${p[2]}`) : num(7));
  it('calculated controls, default values and rules read them through the member option', async () => {
    const base = { ...env(), member };
    const r = await buildCalcEnv([calcCtl('=[Forms]![FClients]![Nom] & [TempVars]![x]')], infoWith(), {}, {}, base);
    expect(r.results.T).toMatchObject({ ok: true, text: 'FClients.Nom7' });
    expect(await unboundDefaults([ctl({ DefaultValue: '[TempVars]![x] + 1' })], base)).toEqual({ T: num(8) });
    expect(await checkControlRule(ctl({ ValidationRule: '<[TempVars]![x]' }), num(9), infoWith(), base)).not.toBeNull();
    expect((await buildCalcEnv([calcCtl('=[TempVars]![x]')], infoWith(), {}, {}, env())).results.T).toEqual({ ok: false, code: 'name' });   // no member: #Nom?
  });
});

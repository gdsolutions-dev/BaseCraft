import { describe, it, expect } from 'vitest';
import { captionParts, shortcutFor } from './access-keys';
import { associateLabel, checkDesign, ignoreError, type CheckOptions } from './error-check';
import { applyTemplate } from './template';
import { isRibbonCustom, NO_RIBBON_CUSTOM } from '../ribbon-custom';
import type { ControlDef, DesignDoc } from './model';

const ctl = (kind: ControlDef['kind'], name: string, left: number, top: number, props: Record<string, unknown> = {}, children?: ControlDef[]): ControlDef =>
  ({ kind, name, left, top, width: 1000, height: 300, props, ...(children ? { children } : {}) });
const doc = (controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc =>
  ({ formatVersion: '1.0', recordSource: { kind: 'table', name: 'T' }, props: { Width: 5000, ...props }, sections: [{ kind: 'detail', height: 2000, props: {}, controls }] });
const ALL: CheckOptions = { unassociated: true, newLabel: true, property: true, report: true, shortcut: true };

describe('error checking', () => {
  it('a free label beside a control without label is unassociated; far from any control it is a new unassociated label', () => {
    const d = doc([ctl('label', 'L1', 0, 0), ctl('textBox', 'Name', 1100, 0), ctl('label', 'Alone', 0, 1500)]);
    expect(checkDesign(d, 'form', ['Name'], ALL).map((i) => [i.check, i.control])).toEqual([['unassociated', 'L1'], ['newLabel', 'Alone']]);
    expect(checkDesign(d, 'form', ['Name'], { ...ALL, unassociated: false }).map((i) => i.control)).toEqual(['Alone']);
  });
  it('associating moves the label into the control; a control with its own label is not a target', () => {
    const d = doc([ctl('label', 'L1', 0, 0), ctl('textBox', 'Name', 1100, 0)]);
    const done = associateLabel(d, 'L1');
    expect(done.sections[0]!.controls.map((c) => c.name)).toEqual(['Name']);
    expect(done.sections[0]!.controls[0]!.children!.map((c) => c.name)).toEqual(['L1']);
    expect(checkDesign(done, 'form', ['Name'], ALL)).toEqual([]);
  });
  it('a ControlSource that names no field or does not parse is an invalid property (form)', () => {
    const d = doc([ctl('textBox', 'A', 0, 0, { ControlSource: 'Nope' }), ctl('textBox', 'B', 0, 400, { ControlSource: '=[Name]+' }), ctl('textBox', 'C', 0, 800, { ControlSource: '=[A]&[Name]' })]);
    expect(checkDesign(d, 'form', ['Name'], ALL).map((i) => [i.code, i.control])).toEqual([['unknownField', 'A'], ['invalidExpression', 'B']]);
    expect(checkDesign(d, 'form', [], ALL).map((i) => i.control)).toEqual(['B']);   // no known field: only the syntax
  });
  it('a report wider than its page and an invalid control source are reported', () => {
    const d = doc([ctl('textBox', 'A', 0, 0, { ControlSource: 'Nope' })], { Width: 20000 });
    const got = checkDesign(d, 'report', ['Name'], ALL).map((i) => [i.check, i.code, i.control]);
    expect(got).toEqual(expect.arrayContaining([['report', 'widthExceedsPage', null], ['property', 'unknownField', 'A']]));
    expect(checkDesign(d, 'report', ['Name'], { ...ALL, report: false }).map((i) => i.check)).toEqual(['property']);
  });
});

describe('templates', () => {
  const base: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072, grouping: [] }, sections: [
    { kind: 'detail', height: 2268, props: {}, controls: [] }, { kind: 'pageHeader', height: 454, props: {}, controls: [] }] };
  const tpl: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'X' }, props: { Width: 5000, BackColor: '#eee', grouping: [{ x: 1 }] }, sections: [
    { kind: 'detail', height: 1000, props: { BackColor: '#ddd' }, controls: [ctl('label', 'L', 0, 0)] }] };
  it('copies properties and section settings, never controls, source or grouping', () => {
    const d = applyTemplate(base, tpl, 'report');
    expect(d.props).toEqual({ Width: 5000, BackColor: '#eee', grouping: [] });
    expect(d.sections.map((s) => [s.kind, s.height, s.controls.length])).toEqual([['detail', 1000, 0], ['pageHeader', 454, 0]]);
    expect(d.sections[0]!.props).toEqual({ BackColor: '#ddd' });
    expect(d.recordSource).toBeNull();
  });
  it('a generated document keeps its own width and visibility and is never made shorter than its content needs', () => {
    const gen: DesignDoc = { ...base, sections: [{ kind: 'detail', height: 3000, props: { Visible: true }, controls: [] }, { kind: 'pageHeader', height: 0, props: { Visible: false }, controls: [] }] };
    const d = applyTemplate(gen, { ...tpl, sections: [{ kind: 'detail', height: 1000, props: { BackColor: '#ddd', Visible: false }, controls: [] }, { kind: 'pageHeader', height: 800, props: {}, controls: [] }] }, 'report', true);
    expect(d.props).toEqual({ Width: 9072, BackColor: '#eee', grouping: [] });
    expect(d.sections.map((s) => [s.height, s.props])).toEqual([[3000, { BackColor: '#ddd', Visible: true }], [800, { Visible: false }]]);
  });
  it('a template that is not a definition leaves the base as it is', () => {
    expect(applyTemplate(base, { nope: 1 }, 'form')).toBe(base);
  });
});

describe('ignore error, kept in the design', () => {
  it('the ignored code is stored on the control and no longer reported; the document keeps its own', () => {
    const d = doc([ctl('label', 'L1', 0, 0), ctl('textBox', 'Name', 1100, 0), ctl('textBox', 'Ghost', 0, 900, { ControlSource: 'Nope' })]);
    const after = ignoreError(d, { code: 'unknownField', control: 'Ghost' });
    expect(after.sections[0]!.controls[2]!.props.IgnoreErrors).toEqual(['unknownField']);
    expect(checkDesign(after, 'form', ['Name'], ALL).map((i) => i.control)).toEqual(['L1']);
    expect(ignoreError(after, { code: 'unknownField', control: 'Ghost' })).toBe(after);
    expect(ignoreError(d, { code: 'widthExceedsPage', control: null }).props.IgnoreErrors).toEqual(['widthExceedsPage']);
  });
});

describe('keyboard shortcut keys in captions', () => {
  it('splits around the key; && is an ampersand; a non letter is no key', () => {
    expect(captionParts('&Nom')).toEqual({ before: '', key: 'N', after: 'om' });
    expect(captionParts('Rech&&erche &Go')).toEqual({ before: 'Rech&erche ', key: 'G', after: 'o' });
    expect(captionParts('A & B')).toEqual({ before: 'A ', key: '', after: ' B' });
    expect(captionParts('Plain')).toEqual({ before: 'Plain', key: '', after: '' });
  });
  it('a label acts on the control it belongs to, a button on itself; keys used twice and invalid ones are errors', () => {
    const d = doc([ctl('textBox', 'Name', 1100, 0, {}, [ctl('label', 'LName', 0, 0, { Caption: '&Nom' })]), ctl('commandButton', 'Ok', 0, 600, { Caption: 'N&ouveau' }),
      ctl('commandButton', 'Dup', 0, 900, { Caption: '&Name' }), ctl('commandButton', 'Bad', 0, 1200, { Caption: '& x' })]);
    expect(shortcutFor(d, 'n')).toMatchObject({ target: 'Name', button: false });
    expect(shortcutFor(d, 'O')).toMatchObject({ target: 'Ok', button: true });
    expect(checkDesign(d, 'form', ['Name'], ALL).map((i) => [i.code, i.control])).toEqual([['shortcutDuplicate', 'Dup'], ['shortcutInvalid', 'Bad']].sort());
    expect(checkDesign(d, 'form', ['Name'], { ...ALL, shortcut: false })).toEqual([]);
  });
});

describe('ribbon customization setting', () => {
  it('accepts the empty one and a well formed one; refuses what is not', () => {
    expect(isRibbonCustom(NO_RIBBON_CUSTOM)).toBe(true);
    expect(isRibbonCustom({ hidden: ['help'], order: ['create', 'c1'], names: { home: 'Start' }, tabs: [{ id: 'c1', label: 'Mine', groups: [{ id: 'g1', label: 'G', commands: ['find'] }] }] })).toBe(true);
    expect(isRibbonCustom({ ...NO_RIBBON_CUSTOM, groups: { create: [{ id: 'g1', label: 'G', commands: ['find'] }] }, groupNames: { 'create.tables': 'T' } })).toBe(true);
    for (const bad of [{ ...NO_RIBBON_CUSTOM, groupNames: { create: 'T' } }, { ...NO_RIBBON_CUSTOM, groups: { create: [{ id: 'g1', label: 'G', commands: [] }, { id: 'g1', label: 'H', commands: [] }] } }]) expect(isRibbonCustom(bad)).toBe(false);
    for (const bad of [null, {}, { ...NO_RIBBON_CUSTOM, hidden: ['a b'] }, { ...NO_RIBBON_CUSTOM, tabs: [{ id: 'home', label: 'x', groups: [] }] },
      { ...NO_RIBBON_CUSTOM, tabs: [{ id: 'c1', label: '', groups: [] }] }, { ...NO_RIBBON_CUSTOM, tabs: [{ id: 'c1', label: 'a', groups: [] }, { id: 'c1', label: 'b', groups: [] }] },
      { ...NO_RIBBON_CUSTOM, names: { home: 1 } }]) expect(isRibbonCustom(bad)).toBe(false);
  });
});

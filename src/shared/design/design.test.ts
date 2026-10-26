import { describe, expect, it } from 'vitest';
import fr from '../i18n/fr.json';
import en from '../i18n/en.json';
import { CONTROL_KINDS, cmToTwips, SECTION_KINDS, twipsToCm, validateDesignDoc, type DesignDoc } from './model';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { colorCss, DARK_THEME_HEX, isColorValue, LIGHT_THEME_HEX, resolveColor, THEME_COLORS } from './colors';
import { defaultFor, effectiveProp, PROPERTY_CATALOG, propertiesFor, type PropertyDescriptor } from './properties';
import { EMBEDDED_FONTS, FONT_ALIASES, isEmbeddedFont, resolveFont } from '../fonts';

const get = (o: unknown, k: string): unknown => k.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], o);

describe('units', () => {
  it('1 cm = 567 twips, rounded to the twip', () => {
    expect(cmToTwips(1)).toBe(567);
    expect(cmToTwips(2.5)).toBe(1418);
    expect(twipsToCm(567)).toBe(1);
    expect(twipsToCm(cmToTwips(3.7))).toBeCloseTo(3.7, 2);
  });
});

describe('property catalog', () => {
  const EDITORS = ['text', 'number', 'twips', 'bool', 'enum', 'color', 'expression', 'criteria', 'controlSource', 'recordSource', 'rowSource',
    'objectName', 'fieldList', 'picture', 'textList', 'event', 'font'];

  it('one descriptor per invariant name, with a known tab, editor, target and label in both languages', () => {
    const names = PROPERTY_CATALOG.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    const targets = ['form', 'report', ...SECTION_KINDS, ...CONTROL_KINDS];
    for (const p of PROPERTY_CATALOG) {
      expect(p.name).toMatch(/^[A-Z][A-Za-z]+$/);
      expect(['format', 'data', 'event', 'other']).toContain(p.tab);
      expect(EDITORS).toContain(p.editor);
      expect(p.appliesTo.length).toBeGreaterThan(0);
      for (const a of p.appliesTo) expect(targets).toContain(a);
      expect(p.labelKey).toBe(`prop.${p.name}`);
      for (const c of [fr, en]) expect(typeof get(c, p.labelKey)).toBe('string');
      expect(p.options === undefined).toBe(p.editor !== 'enum');
      if (p.options) {
        expect(p.options).toContain(p.default);
        for (const v of p.options) if (!/^\d+$/.test(v)) for (const c of [fr, en]) expect(typeof get(c, `propValue.${p.name}.${v}`)).toBe('string');
      }
    }
    for (const c of THEME_COLORS) for (const cat of [fr, en]) expect(typeof get(cat, `color.${c}`)).toBe('string');
  });

  it('covers the closed list of stage A (spec 4.7)', () => {
    const names = PROPERTY_CATALOG.map((p) => p.name);
    for (const n of ['Visible', 'Enabled', 'Locked', 'Format', 'DecimalPlaces', 'DefaultValue', 'ValidationRule', 'ValidationText', 'AllowAdditions',
      'AllowEdits', 'AllowDeletions', 'RecordSource', 'ControlSource', 'RowSource', 'BoundColumn', 'ColumnCount', 'ColumnWidths', 'CanGrow', 'CanShrink',
      'KeepTogether', 'RepeatSection', 'ForceNewPage', 'BackColor', 'ForeColor', 'FontName', 'FontSize', 'BorderStyle', 'BorderColor', 'BorderWidth']) {
      expect(names).toContain(n);
    }
  });

  /** A value fits its descriptor's editor, options and bounds. */
  const fits = (p: PropertyDescriptor, d: unknown) => {
    switch (p.editor) {
      case 'bool': expect(typeof d, p.name).toBe('boolean'); break;
      case 'number': case 'twips':
        expect(Number.isFinite(d), p.name).toBe(true);
        if (p.min !== undefined) expect(d as number, p.name).toBeGreaterThanOrEqual(p.min);
        if (p.max !== undefined) expect(d as number, p.name).toBeLessThanOrEqual(p.max);
        break;
      case 'color': expect(isColorValue(d), p.name).toBe(true); break;
      case 'enum': expect(p.options, p.name).toContain(d); break;
      default: expect(typeof d, p.name).toBe('string');
    }
  };

  it('defaults fit their editor (stored values of the A4 table), per target too', () => {
    for (const p of PROPERTY_CATALOG) {
      if (p.default !== undefined) fits(p, p.default);
      for (const [key, d] of Object.entries(p.defaults ?? {})) {
        expect(p.appliesTo, `${p.name}.${key}`).toContain(key.split(':').pop());
        fits(p, d);
      }
      if (p.min !== undefined || p.max !== undefined) expect(['number', 'twips'], p.name).toContain(p.editor);
    }
    const byName = (n: string) => PROPERTY_CATALOG.find((p) => p.name === n)!;
    expect(byName('BorderStyle').options).toEqual(['transparent', 'solid', 'dashed', 'dotted']);
    expect(byName('FontWeight').options).toEqual(['normal', 'bold']);
    expect(byName('BackColor').default).toBe('theme:surface');
    expect(byName('FontName').editor).toBe('font');
    expect(byName('ColumnWidths').editor).toBe('text');
    expect(byName('ColumnHeads')).toMatchObject({ editor: 'bool', default: false, appliesTo: ['comboBox', 'listBox'], tab: 'format' });
    const bounds = (n: string) => [byName(n).min, byName(n).max];
    expect([bounds('GridX'), bounds('GridY'), bounds('FontSize'), bounds('BorderWidth'), bounds('BoundColumn'), bounds('ColumnCount')])
      .toEqual([[1, 16], [1, 16], [6, 72], [0, 6], [1, 20], [1, 20]]);
  });

  it("defaultFor: a report's combo box prints like its text box (every property)", () => {
    for (const d of PROPERTY_CATALOG) if (d.appliesTo.includes('textBox') && d.appliesTo.includes('comboBox'))
      expect([d.name, defaultFor(d, 'comboBox', 'report')]).toEqual([d.name, defaultFor(d, 'textBox', 'report')]);
    const border = PROPERTY_CATALOG.find((p) => p.name === 'BorderStyle')!;
    expect(defaultFor(border, 'comboBox', 'report')).toBe('transparent');
    expect(defaultFor(border, 'comboBox', 'form')).toBe('solid');
  });

  it('defaultFor: the per-target default, else the default (Access defaults differ by kind)', () => {
    const byName = (n: string) => PROPERTY_CATALOG.find((p) => p.name === n)!;
    expect(defaultFor(byName('BorderStyle'), 'label')).toBe('transparent');
    expect(defaultFor(byName('BorderStyle'), 'textBox')).toBe('solid');
    expect(defaultFor(byName('BackStyle'), 'label')).toBe('transparent');
    expect(defaultFor(byName('BorderStyle'), 'textBox', 'report')).toBe('transparent'); // most specific wins
    expect(defaultFor(byName('BorderStyle'), 'textBox', 'form')).toBe('solid');
    expect(defaultFor(byName('BorderStyle'), 'label', 'report')).toBe('transparent');
    expect(defaultFor(byName('BackColor'), 'pageHeader', 'report')).toBe('#ffffff');
    expect(defaultFor(byName('BackColor'), 'detail', 'report')).toBe('#ffffff');
    expect(defaultFor(byName('BackColor'), 'detail', 'form')).toBe('theme:surface');
    expect(defaultFor(byName('BackColor'), 'detail')).toBe('theme:surface');
    expect(defaultFor(byName('KeepTogether'), 'groupHeader')).toBe(true);
    expect(defaultFor(byName('KeepTogether'), 'detail', 'report')).toBe(true);
    expect(defaultFor(byName('KeepTogether'), 'detail', 'form')).toBe(false);
    expect(defaultFor(byName('Caption'), 'label')).toBe('');
    expect(defaultFor(byName('Width'), 'report', 'report')).toBe(6994);
  });

  it('in a report, every color default resolves to a light hex; a report text box draws no box', () => {
    const targets = [...SECTION_KINDS, ...CONTROL_KINDS] as const;
    for (const p of PROPERTY_CATALOG.filter((x) => x.editor === 'color')) {
      for (const target of targets.filter((x) => p.appliesTo.includes(x))) {
        expect(resolveColor(defaultFor(p, target, 'report'), 'light'), `${p.name} ${target}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    const byName = (n: string) => PROPERTY_CATALOG.find((p) => p.name === n)!;
    for (const k of ['textBox', 'label'] as const) {
      expect(defaultFor(byName('BackStyle'), k, 'report'), k).toBe('transparent');
      expect(defaultFor(byName('BorderStyle'), k, 'report'), k).toBe('transparent');
    }
    expect(defaultFor(byName('BackStyle'), 'textBox', 'form')).toBe('normal');
  });

  it('BaseCraft wording for Can Grow / Can Shrink (spec 4.7)', () => {
    expect([fr.prop.CanGrow, fr.prop.CanShrink]).toEqual(['Peut augmenter', 'Peut réduire']);
  });

  it('filters by target', () => {
    const label = propertiesFor('label').map((p) => p.name);
    expect(label).toContain('Caption');
    expect(label).not.toContain('ControlSource');
    expect(propertiesFor('textBox').map((p) => p.name)).toContain('ControlSource');
    expect(propertiesFor('form').map((p) => p.name)).toContain('RecordSource');
    expect(propertiesFor('groupHeader').map((p) => p.name)).toEqual(expect.arrayContaining(['KeepTogether', 'RepeatSection', 'ForceNewPage']));
    expect(propertiesFor('pageHeader').map((p) => p.name)).not.toContain('CanGrow');
  });
});

describe('A4 catalog additions', () => {
  it('present, events through the event editor, no PageIndex, no Pages default', () => {
    const names = PROPERTY_CATALOG.map((p) => p.name);
    for (const n of ['RecordSelectors', 'Left', 'Top', 'Height', 'Picture', 'SizeMode', 'LineSlant', 'Pages', 'Name', 'TabStop', 'TabIndex',
      'ControlTipText', 'StatusBarText', 'OnOpen', 'OnCurrent', 'OnClick', 'BeforeUpdate', 'AfterUpdate', 'OnChange']) expect(names, n).toContain(n);
    expect(PROPERTY_CATALOG.filter((p) => p.tab === 'event').map((p) => p.editor)).toEqual(expect.arrayContaining(['event']));
    expect(PROPERTY_CATALOG.filter((p) => p.tab === 'event').every((p) => p.editor === 'event')).toBe(true);
    expect(names).not.toContain('PageIndex');
    expect(PROPERTY_CATALOG.find((p) => p.name === 'Pages')!.default).toBeUndefined();
  });
  it('the events of A4, targets and defaults of the brief (B2 narrows and adds: events.test.ts)', () => {
    const byName = (n: string) => PROPERTY_CATALOG.find((p) => p.name === n)!;
    for (const n of ['OnOpen', 'OnLoad', 'OnCurrent', 'OnClose', 'BeforeInsert', 'AfterInsert', 'BeforeUpdate', 'AfterUpdate', 'OnDelete', 'OnClick',
      'OnDblClick', 'OnEnter', 'OnExit', 'OnGotFocus', 'OnLostFocus', 'OnChange']) expect(byName(n).tab, n).toBe('event');
    expect(byName('BeforeUpdate').appliesTo).toEqual(expect.arrayContaining(['form', 'textBox', 'comboBox']));
    expect(byName('AfterUpdate')).toMatchObject({ appliesTo: byName('BeforeUpdate').appliesTo });
    expect(propertiesFor('commandButton').map((p) => p.name)).toEqual(expect.arrayContaining(['OnClick', 'TabStop', 'TabIndex']));
    expect(propertiesFor('detail').map((p) => p.name)).toContain('Height');
    expect([byName('RecordSelectors').default, byName('SizeMode').default, byName('LineSlant').default, byName('TabStop').default]).toEqual([true, 'zoom', false, true]);
    expect(byName('SizeMode').options).toEqual(['clip', 'stretch', 'zoom']);
    expect(byName('TabIndex').min).toBe(0);
    expect(byName('Pages').editor).toBe('textList');
    // proprietes.md section 9: the option group has Enter/Exit but no Got/Lost Focus; the tab control has neither Enter/Exit; option buttons have Before/After Update
    expect(byName('OnEnter').appliesTo).toEqual(expect.arrayContaining(['optionGroup', 'optionButton', 'commandButton', 'subform']));
    expect(byName('OnEnter').appliesTo).not.toContain('tabControl');
    expect(byName('OnExit').appliesTo).toEqual(byName('OnEnter').appliesTo);
    expect(byName('OnGotFocus').appliesTo).toEqual(['textBox', 'checkBox', 'comboBox', 'listBox', 'commandButton', 'optionButton']);
    expect(byName('OnLostFocus').appliesTo).toEqual(byName('OnGotFocus').appliesTo);
    expect(byName('OnClick').appliesTo).toEqual(expect.arrayContaining(['form', 'commandButton', 'optionGroup', 'checkBox', 'optionButton', 'image', 'tabControl']));
    expect(byName('BeforeUpdate').appliesTo).toContain('optionButton');
    expect(byName('AfterUpdate').appliesTo).toContain('optionButton');
  });
  it('effectiveProp: the stored value, else the most specific default', () => {
    expect(effectiveProp({}, 'BorderStyle', 'textBox', 'report')).toBe('transparent');
    expect(effectiveProp({}, 'BorderStyle', 'textBox', 'form')).toBe('solid');
    expect(effectiveProp({}, 'BorderStyle', 'label', 'form')).toBe('transparent');
    expect(effectiveProp({ BorderStyle: 'dashed' }, 'BorderStyle', 'textBox', 'report')).toBe('dashed');
    expect(effectiveProp({}, 'Zz', 'textBox')).toBeUndefined();
    expect(effectiveProp({ Zz: 1 }, 'Zz', 'textBox')).toBeUndefined(); // outside the catalog: never a stored value
    expect(effectiveProp({ BorderStyle: null }, 'BorderStyle', 'textBox', 'form')).toBe('solid'); // a stored null is absent
    expect(effectiveProp({}, 'constructor', 'textBox')).toBeUndefined(); // no inherited key
  });
});

describe('colors', () => {
  /** `--bc-*: #hex;` declarations of the first block that `selector` opens in theme.css. */
  const css = readFileSync(resolve('src/renderer/theme.css'), 'utf8');
  const block = (selector: string) => {
    const body = css.slice(css.indexOf(selector)).split('}')[0]!;
    return Object.fromEntries([...body.matchAll(/(--bc-[\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
  };
  const vars: Record<string, string> = { background: '--bc-bg', surface: '--bc-surface', surface2: '--bc-surface-2', text: '--bc-text',
    textMuted: '--bc-text-muted', border: '--bc-border', accent: '--bc-accent', accentContrast: '--bc-accent-contrast', danger: '--bc-danger', warning: '--bc-warning' };

  it('light and dark values are those of theme.css', () => {
    const light = block(':root {');
    const dark = block('[data-theme="dark"] {');
    for (const t of THEME_COLORS) {
      expect(LIGHT_THEME_HEX[t]).toBe(light[vars[t]!]);
      expect(DARK_THEME_HEX[t]).toBe(dark[vars[t]!]);
      expect(colorCss(`theme:${t}`)).toBe(`var(${vars[t]})`);
    }
  });

  it('values, CSS and resolution', () => {
    expect(colorCss('theme:surface2')).toBe('var(--bc-surface-2)');
    expect(colorCss('#1a2b3c')).toBe('#1a2b3c');
    expect(isColorValue('#1a2b3c')).toBe(true);
    for (const v of ['#1A2B3C', '#123', 'theme:nope', 'red', 3, null]) expect(isColorValue(v)).toBe(false);
    expect(resolveColor('theme:text', 'light')).toBe('#1b1f27');
    expect(resolveColor('theme:text', 'dark')).toBe('#e6e8ec');
    expect(resolveColor('#1a2b3c', 'dark')).toBe('#1a2b3c');
  });

  it('total: an invalid value falls back to the caller\'s default, never raw text into CSS', () => {
    for (const bad of ['#ABCDEF', '#zzz', 'theme:nope', 'red; background: url(x)', 3, null, undefined]) {
      expect(colorCss(bad, 'theme:surface')).toBe('var(--bc-surface)');
      expect(resolveColor(bad, 'light', '#000000')).toBe('#000000');
      expect(colorCss(bad)).toBe('transparent');
      expect(resolveColor(bad, 'dark')).toBe('transparent');
    }
    expect(colorCss('#zzz', '#nope' as never)).toBe('transparent'); // an invalid fallback too
  });
});

describe('fonts', () => {
  it('embedded fonts, case ignored', () => {
    expect(EMBEDDED_FONTS.map((f) => f.family)).toEqual(['Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Carlito', 'Caladea', 'Inter']);
    expect(isEmbeddedFont('carlito')).toBe(true);
    expect(isEmbeddedFont('Arial')).toBe(false);
    expect(isEmbeddedFont(String(PROPERTY_CATALOG.find((p) => p.name === 'FontName')!.default))).toBe(true);
  });

  it('aliases: an Office font maps to its metric-compatible embedded font', () => {
    expect(FONT_ALIASES).toEqual({ Arial: 'Liberation Sans', Helvetica: 'Liberation Sans', 'Times New Roman': 'Liberation Serif',
      'Courier New': 'Liberation Mono', Calibri: 'Carlito', Cambria: 'Caladea' });
    expect(resolveFont('calibri')).toEqual({ family: 'Carlito', portable: true });
    expect(resolveFont('CARLITO')).toEqual({ family: 'Carlito', portable: true });
    expect(resolveFont('Times New Roman')).toEqual({ family: 'Liberation Serif', portable: true });
    expect(resolveFont('Comic Sans MS')).toEqual({ family: 'Comic Sans MS', portable: false });
  });
});

const doc = (): DesignDoc => ({
  formatVersion: '1.0',
  recordSource: { kind: 'table', name: 'Clients' },
  props: { Caption: 'Clients' },
  sections: [
    {
      kind: 'detail', height: 2835, props: {}, controls: [
        { kind: 'textBox', name: 'Nom', left: 0, top: 0, width: 1701, height: 340, props: { ControlSource: 'Nom' } },
        { kind: 'optionGroup', name: 'Choix', left: 0, top: 400, width: 1701, height: 900, props: {}, children: [
          { kind: 'optionButton', name: 'Un', left: 50, top: 450, width: 300, height: 300, props: { OptionValue: 1 } },
        ] },
      ],
    },
  ],
});

describe('validateDesignDoc', () => {
  it('accepts a well-formed document and keeps unknown keys', () => {
    const d = { ...doc(), futureKey: { x: 1 } } as DesignDoc & { futureKey: unknown };
    (d.sections[0] as unknown as Record<string, unknown>).futureSectionKey = 1;
    d.sections[0]!.controls[0]!.props.FutureProp = 'y';
    const before = JSON.stringify(d);
    expect(validateDesignDoc(d)).toEqual([]);
    expect(JSON.stringify(d)).toBe(before);
    expect(validateDesignDoc({ ...doc(), recordSource: null })).toEqual([]);
    expect(validateDesignDoc({ ...doc(), recordSource: { kind: 'sql', sql: 'SELECT 1' } })).toEqual([]);
  });

  it('reports structural errors with their path', () => {
    expect(validateDesignDoc(null)).toEqual(['$']);
    expect(validateDesignDoc({ ...doc(), formatVersion: '2.0' })).toEqual(['formatVersion']);
    expect(validateDesignDoc({ ...doc(), recordSource: { kind: 'table' } })).toEqual(['recordSource']);
    expect(validateDesignDoc({ ...doc(), props: [] })).toEqual(['props']);
    expect(validateDesignDoc({ ...doc(), sections: {} })).toEqual(['sections']);
    const d = doc() as unknown as { sections: Record<string, unknown>[] };
    d.sections[0]!.kind = 'header';
    d.sections[0]!.height = -1;
    d.sections[0]!.groupLevel = 1.5;
    const c = (d.sections[0]!.controls as Record<string, unknown>[]);
    c[0]!.kind = 'button';
    c[0]!.width = 1.5;
    c[0]!.name = '';
    ((c[1]!.children as Record<string, unknown>[])[0]!).props = null;
    expect(validateDesignDoc(d)).toEqual([
      'sections[0].kind', 'sections[0].height', 'sections[0].groupLevel',
      'sections[0].controls[0].kind', 'sections[0].controls[0].name', 'sections[0].controls[0].width',
      'sections[0].controls[1].children[0].props',
    ]);
  });

  it('control names follow the object name rules', () => {
    for (const bad of ['a.b', ' x', 'a[1]', 'x'.repeat(65)]) {
      const d = doc();
      d.sections[0]!.controls[0]!.name = bad;
      expect(validateDesignDoc(d), bad).toEqual(['sections[0].controls[0].name']);
    }
  });

  it('control names are unique in the document (case ignored)', () => {
    const d = doc();
    d.sections.push({ kind: 'formFooter', height: 567, props: {}, controls: [{ kind: 'label', name: 'NOM', left: 0, top: 0, width: 1, height: 1, props: {} }] });
    expect(validateDesignDoc(d)).toEqual(['sections[1].controls[0].name']);
  });

  it('knows every section and control kind of the contract', () => {
    expect(SECTION_KINDS).toEqual(['formHeader', 'detail', 'formFooter', 'reportHeader', 'pageHeader', 'groupHeader', 'groupFooter', 'pageFooter', 'reportFooter']);
    expect(CONTROL_KINDS).toEqual(['label', 'textBox', 'checkBox', 'optionGroup', 'optionButton', 'comboBox', 'listBox', 'commandButton', 'subform',
      'image', 'line', 'rectangle', 'pageBreak', 'tabControl']);
  });
});

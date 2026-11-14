import fs from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAccessText, type AccessBlock } from './access-text';
import { ACCESS_DEFAULTS, resolveAccess } from './access-design-defaults';

const dir = join(__dirname, '../../tests/fixtures/access');
const fixture = (f: string) => fs.readFileSync(join(dir, 'Ventes-complet.export', f), 'utf8');
interface Truth { name: string; props: Record<string, number | string> }
const props = JSON.parse(fs.readFileSync(join(dir, 'Ventes-complet.props.json'), 'utf8')) as {
  objects: Array<{ kind: string; name: string; props: Record<string, number | string>; sections: Truth[]; controls: Truth[] }>
};

const SECTIONS = new Set(['FormHeader', 'FormFooter', 'Section', 'PageHeader', 'PageFooter', 'BreakHeader', 'BreakFooter'])

describe('Access design defaults', () => {
  // For the fixture's form and report: every measured property of the object, its sections and controls, resolved from the text, equals what Access's object model gave.
  // Number of compared values per file: pinned, so the comparison cannot quietly shrink.
  const PINNED: Record<string, number> = { 'forms/1.txt': 805, 'reports/1.txt': 1502 };
  it.each(['forms/1.txt', 'reports/1.txt'])('%s resolves as Access does', (file) => {
    const t = parseAccessText(fixture(file));
    const truth = props.objects.find((o) => o.kind === (t.root.type === 'Form' ? 'form' : 'report'))!;
    const byName = (list: Truth[]) => new Map(list.map((x) => [x.name, x.props]));
    const sections = byName(truth.sections);
    const controls = byName(truth.controls);
    const mismatches: string[] = [];
    let checked = 0;
    const check = (label: string, block: AccessBlock, want: Record<string, number | string> | undefined, defaults: ReadonlyMap<string, AccessBlock>) => {
      if (!want) return;
      for (const [name, value] of Object.entries(want)) {
        checked++;
        const got = resolveAccess(block, name, defaults);
        if (String(got) !== String(value)) mismatches.push(`${label}.${name}: text ${String(got)}, Access ${String(value)}`);
      }
    };
    const controlsOf = (container: AccessBlock, defaults: ReadonlyMap<string, AccessBlock>) => {
      for (const c of container.blocks) {
        const name = String(c.props.get('Name'));
        check(`${c.type} ${name}`, c, controls.get(name), defaults);
        for (const inner of c.blocks) controlsOf(inner, defaults);
      }
    };
    check(t.root.type, t.root, truth.props, new Map());
    const [container] = t.root.blocks; // default blocks, then the sections
    const defaults = new Map<string, AccessBlock>();
    for (const b of container.blocks) if (!SECTIONS.has(b.type) && b.type !== 'BreakLevel' && !b.props.has('Name')) defaults.set(b.type, b);
    let level = 0;
    for (const b of container.blocks) {
      if (b.type === 'BreakLevel') check(`BreakLevel${level}`, b, sections.get(`BreakLevel${level++}`), defaults);
      else if (SECTIONS.has(b.type)) {
        check(`${b.type} ${String(b.props.get('Name'))}`, b, sections.get(String(b.props.get('Name'))), defaults);
        for (const inner of b.blocks) controlsOf(inner, defaults);
      }
    }
    expect(checked).toBe(PINNED[file]);
    expect(mismatches).toEqual([]);
  });
  it('NotDefault flips the fallback', () => {
    const t = parseAccessText('Begin Report\n Begin\n  Begin BreakLevel\n   GroupHeader = NotDefault\n  End\n End\nEnd\n');
    expect(resolveAccess(t.root.blocks[0]!.blocks[0]!, 'GroupHeader', new Map())).toBe(1);
  });
  // A form's default block, then a control, inside a container.
  const blocksOf = (body: string) => parseAccessText(`Begin Form\n Begin\n${body}\n End\nEnd\n`).root.blocks[0]!.blocks;
  const defaultsFrom = (list: AccessBlock[]) => new Map(list.filter((b) => !b.props.has('Name')).map((b) => [b.type, b] as const));
  it('a NotDefault in the default block flips the built-in value of a control without its own', () => {
    const [d, ctl] = blocksOf('  Begin TextBox\n   Locked = NotDefault\n  End\n  Begin TextBox\n   Name = "T"\n  End');
    expect(resolveAccess(ctl!, 'Locked', defaultsFrom([d!]))).toBe(1);
  });
  it('a NotDefault in the default block and in the control flips back', () => {
    const [d, ctl] = blocksOf('  Begin TextBox\n   Locked = NotDefault\n  End\n  Begin TextBox\n   Name = "T"\n   Locked = NotDefault\n  End');
    expect(resolveAccess(ctl!, 'Locked', defaultsFrom([d!]))).toBe(0);
  });
  it('a property nobody knows resolves to undefined', () => {
    const t = parseAccessText('Begin Form\n Begin\n  Begin TextBox\n   Name = "T"\n  End\n End\nEnd\n');
    expect(resolveAccess(t.root.blocks[0]!.blocks[0]!, 'NoSuchProperty', new Map())).toBeUndefined();
  });
  it('inherited object keys of the built-in table are not defaults', () => {
    const t = parseAccessText('Begin Form\n Begin\n  Begin constructor\n   Name = "X"\n  End\n  Begin Label\n   Name = "L"\n  End\n End\nEnd\n');
    const [ctor, lbl] = t.root.blocks[0]!.blocks;
    expect(resolveAccess(ctor!, 'name', new Map())).toBeUndefined();
    expect(resolveAccess(lbl!, '__proto__', new Map())).toBeUndefined();
    expect(resolveAccess(lbl!, 'constructor', new Map())).toBeUndefined();
  });
  it('a default block holding a property block gives undefined for a control without its own', () => {
    const [d, ctl] = blocksOf('  Begin TextBox\n   Locked = Begin\n    0x00\n   End\n  End\n  Begin TextBox\n   Name = "T"\n  End');
    expect(resolveAccess(ctl!, 'Locked', defaultsFrom([d!]))).toBeUndefined();
  });
  it('every block type the converter knows has an entry', () => {
    for (const type of ['Form', 'Report', 'Section', 'FormHeader', 'FormFooter', 'PageHeader', 'PageFooter', 'BreakHeader', 'BreakFooter', 'BreakLevel', 'Label', 'TextBox', 'ComboBox', 'ListBox', 'CheckBox', 'OptionGroup', 'OptionButton', 'ToggleButton', 'CommandButton', 'Subform', 'Image', 'Line', 'Rectangle', 'PageBreak', 'Tab', 'Page'])
      expect(ACCESS_DEFAULTS[type], type).toBeDefined();
  });
});

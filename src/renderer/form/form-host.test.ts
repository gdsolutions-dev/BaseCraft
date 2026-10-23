import { describe, expect, it } from 'vitest';
import type { ControlDef } from '../../shared/design/model';
import { emptyFormDoc, headerFooterShown, toggleHeaderFooter, type FormLabels } from './form-def';
import { FORM_TOOLS, formSectionMenu, newFormControls } from './form-host';

const labels: FormLabels = { prefix: (k) => ({ label: 'Étiquette', textBox: 'Texte', checkBox: 'Case', optionGroup: 'Cadre', tabControl: 'OngletCtl' } as Record<string, string>)[k] ?? k,
  tabPage: (n) => `Page${n}` };
const click = { left: 2835, top: 567, width: 1418, height: 340 };   // la taille d'un simple clic
const withDetail = (...controls: ControlDef[]) => { const d = emptyFormDoc(null); return { ...d, sections: d.sections.map((s) => (s.kind === 'detail' ? { ...s, controls } : s)) }; };

describe('form host', () => {
  it('tools in the mockup order, labelled by their ribbon gallery entry', () => {
    expect(FORM_TOOLS.map((x) => x.kind)).toEqual(['label', 'textBox', 'commandButton', 'comboBox', 'listBox', 'checkBox', 'optionGroup', 'optionButton',
      'tabControl', 'subform', 'image', 'rectangle', 'line', 'pageBreak']);
    expect(FORM_TOOLS.find((x) => x.kind === 'commandButton')!.labelKey).toBe('ribbon.cmd.button');
    expect(FORM_TOOLS.find((x) => x.kind === 'pageBreak')!.labelKey).toBe('ribbon.cmd.insertPageBreak');
  });
  it('a text box: prefix + first free number, an attached label on its left, the next tab index', () => {
    const doc = withDetail({ kind: 'textBox', name: 'Texte1', left: 0, top: 0, width: 100, height: 100, props: { TabIndex: 0 } });
    const [c] = newFormControls('textBox', click, 1, doc, labels);
    expect(c).toMatchObject({ kind: 'textBox', name: 'Texte2', left: 2835, props: { TabIndex: 1 }, children: [{ kind: 'label', name: 'Étiquette1', left: 2835 - 1418, props: { Caption: 'Texte2:' } }] });
    expect(newFormControls('textBox', { ...click, left: 0 }, 1, doc, labels)[0].children![0].left).toBe(0);   // l'étiquette reste dans la section
  });
  it('a check box: small by a click, label on its right outside a group, none inside one', () => {
    const [c] = newFormControls('checkBox', click, 1, emptyFormDoc(null), labels);
    expect(c).toMatchObject({ width: 284, height: 284, children: [{ kind: 'label', left: 2835 + 284 + 57, props: { Caption: 'Case1' } }] });
    const grouped = withDetail({ kind: 'optionGroup', name: 'Cadre1', left: 2000, top: 0, width: 3000, height: 2000, props: {} });
    expect(newFormControls('checkBox', click, 1, grouped, labels)[0].children).toBeUndefined();
  });
  it('an option group gets a caption, a tab control two translated pages', () => {
    expect(newFormControls('optionGroup', click, 1, emptyFormDoc(null), labels)[0].props).toMatchObject({ Caption: 'Cadre1' });
    expect(newFormControls('tabControl', click, 1, emptyFormDoc(null), labels)[0].props.Pages).toEqual(['Page1', 'Page2']);
    expect(newFormControls('rectangle', click, 1, emptyFormDoc(null), labels)[0].props).toEqual({});
    expect(newFormControls('line', click, 1, emptyFormDoc(null), labels)[0]).toMatchObject({ width: 1418, height: 0 });
  });
  it('section menu: Header/Footer on those bars only, confirmed when hiding them deletes controls', () => {
    const shown = toggleHeaderFooter(emptyFormDoc(null));
    expect(formSectionMenu(1, shown)).toEqual([]);
    const [item] = formSectionMenu(0, emptyFormDoc(null));
    expect(item).toMatchObject({ id: 'headerFooter', labelKey: 'form.headerFooter' }); expect(item.confirmKey).toBeUndefined();
    expect(formSectionMenu(2, shown)[0].confirmKey).toBeUndefined();   // shown but empty
    const filled = { ...shown, sections: shown.sections.map((s, i) => (i === 2 ? { ...s, controls: [{ kind: 'label' as const, name: 'P', left: 0, top: 0, width: 10, height: 10, props: {} }] } : s)) };
    expect(formSectionMenu(0, filled)[0].confirmKey).toBe('form.headerFooterConfirm');
  });
  it('header hidden, footer shown with controls: the item shows both, without asking (the same rule as toggleHeaderFooter)', () => {
    const d = emptyFormDoc(null);
    const odd = { ...d, sections: d.sections.map((s, i) => (i === 2 ? { ...s, height: 567, props: { Visible: true }, controls: [{ kind: 'label' as const, name: 'P', left: 0, top: 0, width: 10, height: 10, props: {} }] } : s)) };
    expect(headerFooterShown(odd)).toBe(false);
    expect(formSectionMenu(2, odd)[0].confirmKey).toBeUndefined();
    expect(toggleHeaderFooter(odd).sections[2].controls).toHaveLength(1);
    expect(headerFooterShown(toggleHeaderFooter(odd))).toBe(true);
  });
});

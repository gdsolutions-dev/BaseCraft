import { describe, expect, it } from 'vitest';
import { validateDesignDoc } from '../../shared/design/model';
import { validateMacro } from '../../shared/macro/model';
import type { SourceInfo } from '../../shared/record-source';
import { FACTURES_FIELDS } from '../../shared/report/fixtures/factures';
import { readEvent } from '../../shared/design/events';
import { formLabels } from '../form/form-def';
import { parseTargets } from '../form/nav-targets';
import { itemsForm, MAX_NAV_TABS, modalDialogForm, navigationForm } from './more-forms-model';

const labels = formLabels((k) => k.split('.').pop()!);
const info: SourceInfo = { fields: FACTURES_FIELDS, updatable: true, parameters: [] };

describe('itemsForm', () => {
  it('Multiple Items is continuous and Datasheet opens as a datasheet, both over every field', () => {
    const m = itemsForm({ kind: 'table', name: 'Factures' }, 'Factures', info, labels, 'multiple');
    expect(m.props.DefaultView).toBe('continuous');
    expect(m.sections[1]!.controls).toHaveLength(FACTURES_FIELDS.length);
    expect(itemsForm({ kind: 'table', name: 'Factures' }, 'Factures', info, labels, 'datasheet').props.DefaultView).toBe('datasheet');
  });
});

describe('modalDialogForm', () => {
  const d = modalDialogForm(labels, { ok: 'OK', cancel: 'Cancel' });
  it('is an unbound form of two buttons that close it', () => {
    expect(validateDesignDoc(d)).toEqual([]);
    expect(d.recordSource).toBeNull();
    expect(d.props).toMatchObject({ NavigationButtons: false, RecordSelectors: false });
    const buttons = d.sections[1]!.controls;
    expect(buttons.map((b) => b.props.Caption)).toEqual(['OK', 'Cancel']);
    for (const b of buttons) {
      const e = readEvent(b.props.OnClick);
      expect(e.kind).toBe('embedded');
      if (e.kind === 'embedded') expect(validateMacro(e.def)).toEqual([]);
    }
  });
});

describe('navigationForm', () => {
  it('one navigation control filling the form, a tab per form, at most 8', () => {
    const forms = Array.from({ length: 10 }, (_, i) => `F${i}`);
    const d = navigationForm(['A|B', ...forms], labels);
    expect(validateDesignDoc(d)).toEqual([]);
    const nav = d.sections[1]!.controls[0]!;
    expect(nav.kind).toBe('navigationControl');
    expect([nav.left, nav.top, nav.width, nav.height]).toEqual([0, 0, d.props.Width, d.sections[1]!.height]);
    expect(parseTargets(nav.props.NavigationTargets).map((t) => [t.caption, t.kind, t.name])).toEqual(forms.slice(0, MAX_NAV_TABS).map((n) => [n, 'form', n]));
  });
});

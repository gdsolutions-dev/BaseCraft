import { describe, expect, it } from 'vitest';
import { readLayouts } from '../../shared/design/layout';
import { validateDesignDoc } from '../../shared/design/model';
import type { SourceInfo } from '../../shared/record-source';
import { FACTURES_FIELDS } from '../../shared/report/fixtures/factures';
import { formLabels } from '../form/form-def';
import { wizardForm } from './form-wizard-model';

const ref = { kind: 'table', name: 'Factures' } as const;
const info: SourceInfo = { fields: FACTURES_FIELDS, updatable: true, parameters: [] };
const labels = formLabels((k) => k.split('.').pop()!);
const build = (layout: Parameters<typeof wizardForm>[4], n = 3) => wizardForm(ref, 'Mes factures', { ...info, fields: info.fields.slice(0, n) }, labels, layout);

describe('wizardForm', () => {
  it('columnar and justified: the Create › Form form on the picked fields', () => {
    const d = build('columnar');
    expect(d.props.DefaultView).toBe('single');
    expect(d.sections[1]!.controls.filter((c) => c.kind !== 'label').map((c) => c.props.ControlSource)).toEqual(FACTURES_FIELDS.slice(0, 3).map((f) => f.name));
    expect(d.sections[0]!.controls[0]!.props.Caption).toBe('Mes factures');
    expect(build('justified')).toEqual(d);
    expect(validateDesignDoc(d)).toEqual([]);
  });
  it('tabular: one row of controls, their labels in the header, continuous', () => {
    const d = build('tabular');
    expect(d.props.DefaultView).toBe('continuous');
    const detail = d.sections[1]!.controls, header = d.sections[0]!.controls;
    expect(new Set(detail.map((c) => c.top)).size).toBe(1);
    expect(detail.map((c) => c.left)).toEqual([...detail.map((c) => c.left)].sort((a, b) => a - b));
    expect(header.filter((c) => c.kind === 'label').map((c) => c.props.Caption)).toContain(FACTURES_FIELDS[0]!.name + ':');
    expect(readLayouts(d)).toHaveLength(1);
    expect(readLayouts(d)[0]!.kind).toBe('tabular');
    expect(d.sections[1]!.height).toBeLessThan(1000);
    expect(validateDesignDoc(d)).toEqual([]);
  });
  it('datasheet: the tabular design in the Datasheet default view', () => {
    expect(build('datasheet').props.DefaultView).toBe('datasheet');
  });
  it('no field: the form is left as generated', () => {
    expect(build('tabular', 0).sections[1]!.controls).toEqual([]);
  });
});

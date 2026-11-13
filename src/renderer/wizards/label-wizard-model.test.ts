import { describe, expect, it } from 'vitest';
import { validateDesignDoc } from '../../shared/design/model';
import { readReport } from '../../shared/report/model';
import { LABEL_SHEETS, labelGeometry, labelReport, lineExpression } from './label-wizard-model';

const fields = ['Nom', 'Prénom', 'Code]postal'];

describe('lineExpression', () => {
  it('joins text and fields with &, brackets the names, doubles the quotes of the text', () => {
    expect(lineExpression('[Prénom] [Nom]', fields)).toBe('=[Prénom] & " " & [Nom]');
    expect(lineExpression('Tél "bureau": [nom]', fields)).toBe('="Tél ""bureau"": " & [Nom]');
    expect(lineExpression('[Code]]postal] ville', fields)).toBe('=[Code]]postal] & " ville"');
  });
  it('leaves what is not a field as text, and an empty line as nothing', () => {
    expect(lineExpression('[Inconnu]', fields)).toBe('="[Inconnu]"');
    expect(lineExpression('', fields)).toBeNull();
  });
});

describe('labelReport', () => {
  const l7160 = LABEL_SHEETS.L7160!;
  const doc = labelReport({ kind: 'table', name: 'Clients' }, fields, { sheet: l7160, fontSize: 10, lines: ['[Prénom] [Nom]', '', 'Paris'], sort: 'Nom' });
  it('is a valid report of 3 columns, Across then Down, a Detail as tall as a label with one box per non empty line', () => {
    expect(validateDesignDoc(doc)).toEqual([]);
    const spec = readReport(doc, []);
    expect(spec.columns).toMatchObject({ count: 3, across: true });
    expect(spec.issues.filter((i) => i.code === 'widthExceedsPage')).toEqual([]);
    const detail = doc.sections.find((s) => s.kind === 'detail')!;
    expect(detail.height).toBe(2160);
    expect(detail.controls.map((c) => c.props.ControlSource)).toEqual(['=[Prénom] & " " & [Nom]', '="Paris"']);
    expect(doc.props.grouping).toEqual([expect.objectContaining({ expression: 'Nom' })]);
  });
  it('every preset fits its sheet', () => {
    for (const s of Object.values(LABEL_SHEETS)) expect(labelGeometry(s).fits, s.name).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { flattenControls, validateDesignDoc } from '../../shared/design/model';
import type { SourceInfo } from '../../shared/record-source';
import { FACTURES_FIELDS } from '../../shared/report/fixtures/factures';
import { readReport } from '../../shared/report/model';
import { groupLevels } from '../report/design/grouping-model';
import { wizardReport, type ReportChoices } from './report-wizard-model';

const ref = { kind: 'table', name: 'Factures' } as const;
const info: SourceInfo = { fields: FACTURES_FIELDS, updatable: true, parameters: [] };
const base: ReportChoices = { title: 'Mes factures', fields: ['N°', 'Client', 'Montant'], groups: [], sorts: [], totals: {}, summaryOnly: false, orientation: 'portrait' };
const build = (c: Partial<ReportChoices>) => wizardReport({ ...ref }, info, { ...base, ...c }, { lang: 'en' });
const sources = (d: ReturnType<typeof build>, kind: string) => d.sections.filter((s) => s.kind === kind);

describe('wizardReport', () => {
  it('fields and title: the Create › Report report over the picked fields', () => {
    const d = build({});
    expect(d.sections.find((s) => s.kind === 'detail')!.controls.map((c) => c.props.ControlSource)).toEqual(['N°', 'Client', 'Montant']);
    expect(d.sections[0]!.controls[0]!.props.Caption).toBe('Mes factures');
    expect(d.recordSource).toEqual({ kind: 'table', name: 'Factures' });
    expect(validateDesignDoc(d)).toEqual([]);
  });
  it('orientation', () => {
    expect((build({ orientation: 'landscape' }).props.pageSetup as { orientation: string }).orientation).toBe('landscape');
    expect((build({ orientation: 'portrait' }).props.pageSetup as { orientation: string }).orientation).toBe('portrait');
  });
  it('groups come first, then the sort fields (a grouped field is not sorted twice), descending kept', () => {
    const d = build({ groups: ['Client'], sorts: [{ field: 'Client', desc: false }, { field: 'Montant', desc: true }] });
    expect(groupLevels(d).map((g) => [g.expression, g.order, g.header, g.footer])).toEqual([['Client', 'asc', true, false], ['Montant', 'desc', false, false]]);
    expect(sources(d, 'groupHeader')[0]!.controls.map((c) => c.props.ControlSource)).toEqual(['Client']);
    expect(readReport(d, FACTURES_FIELDS).issues).toEqual([]);
    expect(validateDesignDoc(d)).toEqual([]);
  });
  it('summary values: footers of every group and of the report, one control per function', () => {
    const d = build({ groups: ['Client'], totals: { Montant: ['Sum', 'Avg'] } });
    expect(groupLevels(d)[0]!.footer).toBe(true);
    const sources_ = (kind: string) => flattenControls(d.sections.filter((s) => s.kind === kind).flatMap((s) => s.controls)).map((c) => c.props.ControlSource);
    expect(sources_('groupFooter')).toEqual(['=Sum([Montant])', '=Avg([Montant])']);
    expect(sources_('reportFooter')).toEqual(expect.arrayContaining(['=Sum([Montant])', '=Avg([Montant])']));
    expect(validateDesignDoc(d)).toEqual([]);
  });
  it('summary only hides the detail; at most four levels', () => {
    expect(build({ groups: ['Client'], totals: { Montant: ['Sum'] }, summaryOnly: true }).sections.find((s) => s.kind === 'detail')!.props.Visible).toBe(false);
    expect(groupLevels(build({ fields: ['N°', 'Client', 'Montant', 'Date', 'Libellé'], groups: ['N°', 'Client', 'Montant', 'Date', 'Libellé'] }))).toHaveLength(4);
  });
});

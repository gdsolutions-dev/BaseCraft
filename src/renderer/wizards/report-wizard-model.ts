// Report Wizard (Create › Report Wizard): the Create › Report generator over the picked fields, then the grouping levels, the sort
// order and the summary values, by the report designer's own operations (addGroup, addSort, addTotal). Pure module.
import { flattenControls, type DesignDoc } from '../../shared/design/model';
import { isSummable } from './query-wizard-model';
import { sameName } from '../../shared/field-types';
import type { RecordSourceRef, SourceInfo } from '../../shared/record-source';
import { instantReport } from '../../shared/report/instant';
import type { PageSetup } from '../../shared/report/model';
import { uniqueName } from '../designer/designer-model';
import { addGroup, addSort, addTotal, groupLevels, setGroup, type TotalFn } from '../report/design/grouping-model';
import { placeControls, topBelow } from '../report/design/report-sections';

export const REPORT_TOTALS: TotalFn[] = ['Sum', 'Avg', 'Min', 'Max'];
export const MAX_LEVELS = 4;   // Access's wizard: four grouping levels, four sort fields
export interface ReportChoices {
  title: string; fields: string[]; groups: string[]; sorts: { field: string; desc: boolean }[];
  /** The summary values asked per numeric field. */
  totals: Record<string, TotalFn[]>; summaryOnly: boolean; orientation: PageSetup['orientation'];
}

/** ponytail: Stepped layout only (the instant report's tabular body under group headers); Block and Outline need another body. */
export function wizardReport(ref: RecordSourceRef & { name: string }, info: SourceInfo, c: ReportChoices, opts: { lang: 'fr' | 'en'; margins?: PageSetup['margins'] }): DesignDoc {
  const fields = c.fields.flatMap((n) => info.fields.filter((f) => f.name === n));
  let doc = instantReport(ref, { ...info, fields }, { ...opts, title: c.title, orientation: c.orientation });
  const wanted = fields.filter((f) => isSummable(f.type) && c.totals[f.name]?.length);
  const groups = c.groups.slice(0, MAX_LEVELS);
  // each group level: a header holding the grouped value; footers when summary values are asked for
  for (const g of groups) doc = addGroup(doc, g);
  groups.forEach((g, level) => {
    doc = setGroup(doc, level, { footer: wanted.length > 0 });
    const at = doc.sections.findIndex((s) => s.kind === 'groupHeader' && s.groupLevel === level);
    doc = placeControls(doc, at, [{ kind: 'textBox', name: uniqueName(doc, `Groupe_${g}`), left: 0, top: topBelow(doc.sections[at]!), width: 3402, height: 340,
      props: { ControlSource: g, FontWeight: 'bold' } }]);
  });
  // ponytail: a grouped field also stays in the detail columns
  for (const s of c.sorts.filter((x) => !groups.some((g) => sameName(g, x.field))).slice(0, MAX_LEVELS)) {
    doc = addSort(doc, s.field);
    if (s.desc) doc = setGroup(doc, groupLevels(doc).length - 1, { order: 'desc' });
  }
  for (const f of wanted) {
    const box = flattenControls(doc.sections.find((s) => s.kind === 'detail')!.controls).find((x) => x.kind === 'textBox' && x.props.ControlSource === f.name);
    if (box) for (const fn of c.totals[f.name]!) doc = addTotal(doc, f, fn, box.left, box.width, box.name);
  }
  if (c.summaryOnly) doc = { ...doc, sections: doc.sections.map((s) => (s.kind === 'detail' ? { ...s, props: { ...s.props, Visible: false } } : s)) };
  return doc;
}

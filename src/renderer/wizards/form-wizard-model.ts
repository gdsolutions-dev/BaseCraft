// Form Wizard (Create › Form Wizard): the Create › Form generator over the picked fields, then the layout asked for. Pure module.
import { createLayout, membersOf } from '../../shared/design/layout-edit';
import type { DesignDoc } from '../../shared/design/model';
import type { RecordSourceRef, SourceInfo } from '../../shared/record-source';
import { autoForm, type FormLabels } from '../form/form-def';
import { MAX_TWIPS } from '../designer/units';

/** ponytail: Justified is a Columnar form (the stacked layout is the only one-record layout BaseCraft has). */
export type FormLayoutChoice = 'columnar' | 'tabular' | 'datasheet' | 'justified';
const MARGIN = 283, GAP = 85;   // right margin and the room under a row of controls

export function wizardForm(ref: RecordSourceRef, title: string, info: SourceInfo, labels: FormLabels, layout: FormLayoutChoice): DesignDoc {
  const doc = autoForm(ref, title, info, labels);
  if (layout === 'columnar' || layout === 'justified' || !info.fields.length) return doc;
  // Tabular and Datasheet: a row of controls under their labels (the header row), as Access lays them out; Datasheet shows the same
  // design in its Default View.
  const rows = doc.sections.findIndex((s) => s.kind === 'detail');
  const names = doc.sections[rows]!.controls.filter((c) => c.kind !== 'label').map((c) => c.name);
  const laid = createLayout(doc, membersOf(doc, names), 'tabular', { headerSection: 'formHeader' });
  const detail = laid.sections[rows]!;
  const bottom = Math.max(...detail.controls.map((c) => c.top + c.height));
  const right = Math.max(...laid.sections.flatMap((s) => s.controls.map((c) => c.left + c.width)));
  return { ...laid, props: { ...laid.props, Width: Math.min(right + MARGIN, MAX_TWIPS), DefaultView: layout === 'tabular' ? 'continuous' : 'datasheet' },
    sections: laid.sections.map((s, i) => (i === rows ? { ...s, height: Math.min(bottom + GAP, MAX_TWIPS) } : s)) };
}

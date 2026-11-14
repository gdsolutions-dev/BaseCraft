// Error checking of a form or report in Design view (Access: Options > Object Designers > Error checking). Pure: the designer
// shows an indicator on the control (or on the document) of each issue. The checks that map to this model:
//  - unassociated: a free label right beside (left of) or above a control that has no label of its own;
//  - newLabel: a free label of the detail section with nothing to associate it with;
//  - property: a bound ControlSource naming a field that is not there, or an expression that does not parse;
//  - report: the report is wider than its page, or its sorting and grouping cannot be read.
//  - shortcut: a caption's `&` shortcut key that is no letter or digit, or that an earlier control already has.
// « Ignore error » is kept in the design, as Access keeps it per control: the codes in the control's IgnoreErrors property (the
// document's own, for an error of the whole document).
import { fieldRefs, parseCanonical } from '../expr/parser';
import { withUserFunctions } from '../expr/user-functions';
import { sameName } from '../field-types';
import type { SourceField } from '../record-source';
import { bareName, readReport } from '../report/model';
import { shortcutIssues } from './access-keys';
import { updateControl } from './control-tree';
import { flattenControls, type ControlDef, type DesignDoc, type SectionDef } from './model';

export type CheckId = 'unassociated' | 'newLabel' | 'property' | 'report' | 'shortcut';
export interface DesignIssue { check: CheckId; code: string; control: string | null; detail?: string }
export type CheckOptions = { [K in CheckId]: boolean };

const GAP = 284;   // 0.5 cm: how near a label must be to look like the control's
const LABELLED = new Set<ControlDef['kind']>(['textBox', 'comboBox', 'listBox', 'checkBox', 'toggleButton']);
const hasLabel = (c: ControlDef) => !!c.children?.some((k) => k.kind === 'label');
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0;

/** The control beside or under a free label that could be its own, or undefined. */
export function labelTarget(s: SectionDef, label: ControlDef): ControlDef | undefined {
  return s.controls.find((c) => LABELLED.has(c.kind) && !hasLabel(c) && (
    (overlap(label.top, label.top + label.height, c.top, c.top + c.height) && c.left >= label.left + label.width - 1 && c.left - (label.left + label.width) <= GAP)   // to its left
    || (overlap(label.left, label.left + label.width, c.left, c.left + c.width) && c.top >= label.top + label.height - 1 && c.top - (label.top + label.height) <= GAP)));   // above it
}

/** Moves the free label into the control (its attached label child, as a bound control's label is). */
export function associateLabel(doc: DesignDoc, label: string): DesignDoc {
  for (const [si, s] of doc.sections.entries()) {
    const l = s.controls.find((c) => c.kind === 'label' && sameName(c.name, label));
    const target = l && labelTarget(s, l);
    if (!l || !target) continue;
    const controls = s.controls.filter((c) => c !== l).map((c) => (c === target ? { ...c, children: [...(c.children ?? []), l] } : c));
    return { ...doc, sections: doc.sections.map((x, i) => (i === si ? { ...x, controls } : x)) };
  }
  return doc;
}

/** The document with this error ignored: kept on the control (or the document), so it survives closing and reopening. */
export function ignoreError(doc: DesignDoc, issue: Pick<DesignIssue, 'code' | 'control'>): DesignDoc {
  const add = (props: Record<string, unknown>) => {
    const had = Array.isArray(props.IgnoreErrors) ? props.IgnoreErrors as string[] : [];
    return had.includes(issue.code) ? props : { ...props, IgnoreErrors: [...had, issue.code] };
  };
  if (!issue.control) { const props = add(doc.props); return props === doc.props ? doc : { ...doc, props }; }
  return updateControl(doc, issue.control, (c) => { const props = add(c.props); return props === c.props ? c : { ...c, props }; });
}

/** The issues of the document, those ignored on their control left out; `fields`: the names of the record source's fields (none known: no field is reported unknown). */
export function checkDesign(doc: DesignDoc, kind: 'form' | 'report', fields: string[], on: CheckOptions): DesignIssue[] {
  const ignored = (i: DesignIssue) => {
    const list = (i.control ? flattenControls(doc.sections.flatMap((s) => s.controls)).find((c) => sameName(c.name, i.control!))?.props : doc.props)?.IgnoreErrors;
    return Array.isArray(list) && list.includes(i.code);
  };
  return findIssues(doc, kind, fields, on).filter((i) => !ignored(i));
}

function findIssues(doc: DesignDoc, kind: 'form' | 'report', fields: string[], on: CheckOptions): DesignIssue[] {
  const out: DesignIssue[] = [];
  if (on.shortcut) for (const i of shortcutIssues(doc)) out.push({ check: 'shortcut', code: i.code, control: i.control, ...(i.detail ? { detail: i.detail } : {}) });
  for (const s of doc.sections) {
    if (!on.unassociated && !on.newLabel) break;
    for (const l of s.controls) {
      if (l.kind !== 'label') continue;
      if (labelTarget(s, l)) { if (on.unassociated) out.push({ check: 'unassociated', code: 'unassociated', control: l.name }); }
      else if (on.newLabel && s.kind === 'detail') out.push({ check: 'newLabel', code: 'newLabel', control: l.name });
    }
  }
  const known = (n: string) => fields.length === 0 || fields.some((f) => sameName(f, n));
  if (on.property && kind === 'form') {
    const names = flattenControls(doc.sections.flatMap((s) => s.controls)).map((c) => c.name);
    for (const c of flattenControls(doc.sections.flatMap((s) => s.controls))) {
      const text = c.props.ControlSource;
      if (typeof text !== 'string' || text === '') continue;
      if (!text.startsWith('=')) { if (!known(bareName(text))) out.push({ check: 'property', code: 'unknownField', control: c.name, detail: bareName(text) }); continue; }
      try {
        for (const n of fieldRefs(parseCanonical(text.slice(1), { functions: withUserFunctions() })))
          if (!n.startsWith('\u0000') && !known(n) && !names.some((x) => sameName(x, n))) out.push({ check: 'property', code: 'unknownField', control: c.name, detail: n });
      } catch { out.push({ check: 'property', code: 'invalidExpression', control: c.name, detail: text }); }
    }
  }
  if (kind === 'report' && (on.property || on.report)) {
    const asFields = fields.map((name) => ({ name }) as SourceField);
    for (const i of readReport(doc, asFields).issues) {
      if (i.code === 'unknownField' && fields.length === 0) continue;
      const property = i.control !== undefined && (i.code === 'unknownField' || i.code === 'invalidExpression' || i.code === 'aggregateNotAllowed');
      const report = i.code === 'widthExceedsPage' || i.code === 'groupingInvalid' || i.code === 'groupingMalformed' || (i.code === 'unknownField' && i.control === undefined);
      if (property && on.property) out.push({ check: 'property', code: i.code, control: i.control ?? null, ...(i.detail ? { detail: i.detail } : {}) });
      else if (report && on.report) out.push({ check: 'report', code: i.code, control: null, ...(i.detail ? { detail: i.detail } : {}) });
    }
  }
  return out;
}

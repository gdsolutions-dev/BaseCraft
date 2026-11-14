// Form and report templates (Access: Options > Object Designers): a new form or report copies the properties and the section
// settings (height, properties) of the form or report named in the options. Its controls, record source and, for a report,
// its grouping (the sections of the groups belong to it) stay the new document's own. Pure.
import type { DesignDoc } from './model';
import { validateDesignDoc } from './model';

/** `base` with what `template` (a stored definition, anything) sets; `base` itself when the template is not a valid definition.
 *  `generated`: base is an AutoForm, wizard... document whose layout follows its content: its own properties win (the form's Width,
 *  a section's Visible), and a section is never made shorter than its controls need (the template's height is a minimum). */
export function applyTemplate(base: DesignDoc, template: unknown, kind: 'form' | 'report', generated = false): DesignDoc {
  if (validateDesignDoc(template).length) return base;
  const t = template as DesignDoc;
  const { grouping: _grouping, ...props } = t.props;   // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    ...base,
    props: { ...base.props, ...(generated ? { ...props, ...base.props } : props), ...(kind === 'report' && base.props.grouping !== undefined ? { grouping: base.props.grouping } : {}) },
    sections: base.sections.map((s) => {
      const from = t.sections.find((x) => x.kind === s.kind && (x.groupLevel ?? 0) === (s.groupLevel ?? 0));
      if (!from) return s;
      return generated ? { ...s, height: Math.max(s.height, from.height), props: { ...from.props, ...s.props } } : { ...s, height: from.height, props: { ...from.props } };
    }),
  };
}

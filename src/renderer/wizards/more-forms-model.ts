// Create › More Forms and Navigation: the forms they make beyond the Create › Form one. Pure module.
import type { ControlDef, DesignDoc } from '../../shared/design/model';
import type { RecordSourceRef, SourceInfo } from '../../shared/record-source';
import { emptyFormDoc, type FormLabels } from '../form/form-def';
import { wizardForm } from './form-wizard-model';

/** Multiple Items: the Tabular layout of every field (a continuous form); Datasheet: the same design in its Datasheet default view. */
export const itemsForm = (ref: RecordSourceRef, title: string, info: SourceInfo, labels: FormLabels, kind: 'multiple' | 'datasheet'): DesignDoc =>
  wizardForm(ref, title, info, labels, kind === 'multiple' ? 'tabular' : 'datasheet');

/** The macro of a button that closes its form: an embedded CloseWindow (no ObjectName: the window the button is in). */
const CLOSE = { embedded: { formatVersion: '1.0', items: [{ k: 'action', action: 'CloseWindow', args: {} }] } };

/** Modal Dialog: an unbound form without record selectors and navigation buttons, OK and Cancel (both close it).
 *  ponytail: the catalog has no Modal, Pop Up or dialog Border Style property, so it opens as an ordinary form tab. */
export function modalDialogForm(labels: FormLabels, captions: { ok: string; cancel: string }): DesignDoc {
  const base = emptyFormDoc(null);
  const button = (n: number, left: number, caption: string): ControlDef =>
    ({ kind: 'commandButton', name: `${labels.prefix('commandButton')}${n}`, left, top: 1134, width: 1418, height: 454, props: { Caption: caption, OnClick: CLOSE, TabIndex: n - 1 } });
  return { ...base, props: { ...base.props, Width: 3402, NavigationButtons: false, RecordSelectors: false },
    sections: base.sections.map((s) => (s.kind === 'detail' ? { ...s, height: 1814, controls: [button(1, 113, captions.ok), button(2, 1871, captions.cancel)] } : s)) };
}

/** The most tabs a new Navigation form has (Access: a tab per form dropped on it; here the user edits the rest). */
export const MAX_NAV_TABS = 8;

/** Navigation › Horizontal Tabs: an unbound form filled by a navigation control, one tab per form. ponytail: a form named with `|`
 *  cannot be written in NavigationTargets (`Caption|form:Name`), it is left out. */
export function navigationForm(forms: string[], labels: FormLabels): DesignDoc {
  const base = emptyFormDoc(null), width = 12247, height = 6804;
  const targets = forms.filter((n) => !n.includes('|')).slice(0, MAX_NAV_TABS).map((n) => `${n}|form:${n}`);
  const nav: ControlDef = { kind: 'navigationControl', name: `${labels.prefix('navigationControl')}1`, left: 0, top: 0, width, height, props: { NavigationTargets: targets } };
  return { ...base, props: { ...base.props, Width: width },
    sections: base.sections.map((s) => (s.kind === 'detail' ? { ...s, height, controls: [nav] } : s)) };
}

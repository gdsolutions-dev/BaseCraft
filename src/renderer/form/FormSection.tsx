// Une section d'un formulaire en mode Formulaire : ses contrôles à leur place (twips -> px), dans l'ordre du document (z-order),
// chaque étiquette attachée liée à son contrôle, chaque erreur sous le contrôle lié au champ.
import { Fragment, type ReactNode } from 'react';
import { colorCss, type ColorValue } from '../../shared/design/colors';
import type { ControlDef, SectionDef } from '../../shared/design/model';
import { defaultFor, effectiveProp, PROPERTY_CATALOG } from '../../shared/design/properties';
import { twipsToPx } from '../designer/units';
import { errorMessage } from '../shell/Modal';
import { CheckBoxCtl } from './controls/CheckBoxCtl';
import { ComboBoxCtl } from './controls/ComboBoxCtl';
import { CommandButtonCtl } from './controls/CommandButtonCtl';
import { ImageCtl } from './controls/ImageCtl';
import { LabelCtl } from './controls/LabelCtl';
import { ListBoxCtl } from './controls/ListBoxCtl';
import { OptionGroupCtl } from './controls/OptionGroupCtl';
import { placed, type RunCtx } from './controls/run-ctx';
import { ShapeCtl } from './controls/ShapeCtl';
import { SubformCtl } from './controls/SubformCtl';
import { TabCtl } from './controls/TabCtl';
import { TextBoxCtl } from './controls/TextBoxCtl';
import { prop, tabSequence } from './run-model';

const BACK = PROPERTY_CATALOG.find((d) => d.name === 'BackColor')!;

/** One control (and its attached labels), placed relative to `origin` (a container) or to the section. */
function renderControl(c: ControlDef, x: RunCtx, origin: ControlDef | null, z?: number, forId?: string): ReactNode {
  if (prop(c, 'Visible') === false) return null;
  const style = { ...placed(c, origin), ...(z === undefined ? {} : { zIndex: z }) };
  const child = (k: ControlDef, o: ControlDef, id?: string) => renderControl(k, x, o, undefined, id);
  const p = { c, x, style };
  let el: ReactNode;
  switch (c.kind) {
    case 'textBox': el = <TextBoxCtl {...p} />; break;
    case 'label': el = <LabelCtl {...p} forId={forId} />; break;
    case 'checkBox': case 'optionButton': el = <CheckBoxCtl {...p} />; break;
    case 'optionGroup': el = <OptionGroupCtl {...p} renderChild={child} />; break;
    case 'commandButton': el = <CommandButtonCtl {...p} />; break;
    case 'image': el = <ImageCtl {...p} />; break;
    case 'line': case 'rectangle': case 'pageBreak': el = <ShapeCtl {...p} />; break;
    case 'tabControl': el = <TabCtl {...p} renderChild={child} />; break;
    case 'comboBox': el = <ComboBoxCtl {...p} />; break;
    case 'listBox': el = <ListBoxCtl {...p} />; break;
    case 'subform': el = <SubformCtl {...p} />; break;
    default: el = null;
  }
  const container = c.kind === 'optionGroup' || c.kind === 'tabControl';
  const err = x.errors[c.name];
  const listError = x.lists[c.name]?.error;
  const note = listError === undefined ? undefined : (() => { const m = errorMessage(listError); return x.t('form.list.sourceError', { message: x.t(m.key, m.params) }); })();
  const s = style as { left: number; top: number; height: number; width: number };
  return (
    <Fragment key={c.name}>
      {el}
      {!container && (c.children ?? []).map((k) => renderControl(k, x, origin, z, x.id(c.name)))}
      {err !== undefined && (
        <div role="alert" id={`${x.id(c.name)}-err`} className="frun-error" data-testid={`form-error-${c.name}`}
          style={{ left: s.left, top: s.top + s.height + 2, minWidth: s.width }}>{err}</div>
      )}
      {note !== undefined && (
        <div role="status" id={`${x.id(c.name)}-note`} className="frun-note" data-testid={`form-list-note-${c.name}`}
          style={{ left: s.left, top: s.top + s.height + (err === undefined ? 2 : 24), minWidth: s.width }}>{note}</div>
      )}
    </Fragment>
  );
}

export function FormSection({ section, x, width }: { section: SectionDef; x: RunCtx; width: number }) {
  const back = colorCss(effectiveProp(section.props, 'BackColor', section.kind, 'form'), (defaultFor(BACK, section.kind, 'form') ?? 'theme:surface') as ColorValue);
  // DOM order: the tab stops in tab order, then the rest; the paint order stays the document's (z-index)
  const seq = tabSequence(section, x.pages);
  const rank = (i: number) => { const k = seq.indexOf(section.controls[i].name); return k < 0 ? seq.length + i : k; };
  const order = section.controls.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  return (
    // a click on the section itself, not on a control: the form's On Click / On Dbl Click
    <div className="frun-section" data-testid={`form-section-${section.kind}`} style={{ height: twipsToPx(section.height), width, background: back }}
      onClick={(e) => { if (e.target === e.currentTarget) void x.raise('OnClick'); }}
      onDoubleClick={(e) => { if (e.target === e.currentTarget) void x.raise('OnDblClick'); }}>
      {order.map((i) => renderControl(section.controls[i], x, null, i))}
    </div>
  );
}

// Étiquette : un texte ; attachée à un contrôle, un <label for> qui le désigne (un clic sur celle d'une case d'option la choisit).
import type { MouseEvent } from 'react';
import { prop } from '../run-model';
import { tipOf, type CtlProps } from './run-ctx';

export function LabelCtl({ c, style, forId }: CtlProps & { forId?: string }) {
  const text = String(prop(c, 'Caption') ?? '');
  if (!forId) return <div className="frun-label" style={style} data-testid={`form-ctl-${c.name}`} {...tipOf(c)}>{text}</div>;
  // a <label> only activates real inputs: an option of a group is a role="radio" element, a list box a role="listbox" one
  const click = (e: MouseEvent) => {
    const el = document.getElementById(forId);
    const role = el?.getAttribute('role');
    if (role === 'radio') { e.preventDefault(); el!.click(); } else if (role === 'listbox') { e.preventDefault(); el!.focus(); }
  };
  return <label className="frun-label" style={style} htmlFor={forId} id={`${forId}-label`} data-testid={`form-ctl-${c.name}`} onClick={click} {...tipOf(c)}>{text}</label>;
}

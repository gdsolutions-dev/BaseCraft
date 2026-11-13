// Étiquette : un texte ; attachée à un contrôle, un <label for> qui le désigne (un clic sur celle d'une case d'option la choisit).
import type { MouseEvent } from 'react';
import { useModal } from '../../shell/Modal';
import { openHyperlink } from '../open-link';
import { linkAddress, LINK_LOOK, prop } from '../run-model';
import { tipOf, type CtlProps } from './run-ctx';

export function LabelCtl({ c, style, forId }: CtlProps & { forId?: string }) {
  const text = String(prop(c, 'Caption') ?? '');
  const modal = useModal();
  const address = linkAddress(c);
  // a hyperlink label (D3): drawn as a link; a click (or Enter, Space) asks before opening the address in the browser
  if (address) {
    const go = () => { void openHyperlink(modal, address); };
    return <div className="frun-label frun-link" role="link" tabIndex={0} style={{ ...style, ...LINK_LOOK, cursor: 'pointer' }} data-testid={`form-ctl-${c.name}`} {...tipOf(c)}
      onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>{text}</div>;
  }
  if (!forId) return <div className="frun-label" style={style} data-testid={`form-ctl-${c.name}`} {...tipOf(c)}>{text}</div>;
  // a <label> only activates real inputs: an option of a group is a role="radio" element, a list box a role="listbox" one
  const click = (e: MouseEvent) => {
    const el = document.getElementById(forId);
    const role = el?.getAttribute('role');
    if (role === 'radio') { e.preventDefault(); el!.click(); } else if (role === 'listbox') { e.preventDefault(); el!.focus(); }
  };
  return <label className="frun-label" style={style} htmlFor={forId} id={`${forId}-label`} data-testid={`form-ctl-${c.name}`} onClick={click} {...tipOf(c)}>{text}</label>;
}

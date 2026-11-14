// A form's window properties (backlog C6b: Pop Up, Modal, Auto Resize, Auto Center, Border Style, Min Max Buttons, Close Button, Control Box),
// read from its definition into the tab (`DocTab.win`) when it opens in Form view; the hosts and DialogHost draw the window from it.
import type { DesignDoc } from '../../shared/design/model';
import { effectiveProp } from '../../shared/design/properties';
import { twipsToPx } from '../designer/units';
import type { FormWin } from '../state/app-state';

/** The record selector's width beside the Detail section (SingleFormView). */
export const SELECTOR_PX = 18;

export const DEFAULT_WIN: FormWin = { popup: false, modal: false, autoResize: true, autoCenter: false, border: 'sizable', minMax: 'both', closeButton: true, controlBox: true, width: 480, token: 0 };

export function formWinOf(doc: DesignDoc, token: number): FormWin {
  const e = (n: string) => effectiveProp(doc.props, n, 'form');
  const selectors = !!doc.recordSource && e('RecordSelectors') !== false;
  const border = e('BorderStyle'), mm = e('MinMaxButtons');
  return {
    popup: e('PopUp') === true, modal: e('Modal') === true, autoResize: e('AutoResize') !== false, autoCenter: e('AutoCenter') === true,
    border: border === 'none' || border === 'thin' || border === 'dialog' ? border : 'sizable', minMax: mm === 'none' || mm === 'min' || mm === 'max' ? mm : 'both',
    closeButton: e('CloseButton') !== false, controlBox: e('ControlBox') !== false, width: twipsToPx(Number(e('Width')) || 0) + (selectors ? SELECTOR_PX : 0), token,
  };
}

/** What the title bar offers: none (no bar), the buttons enabled (a dialog border has no minimize or maximize), whether the window resizes. */
export function chrome(w: FormWin) {
  const bar = w.border !== 'none', box = bar && w.controlBox;
  return { bar, box, min: box && w.border !== 'dialog' && (w.minMax === 'min' || w.minMax === 'both'), max: box && w.border !== 'dialog' && (w.minMax === 'max' || w.minMax === 'both'),
    close: box && w.closeButton, resize: w.border === 'sizable' };
}

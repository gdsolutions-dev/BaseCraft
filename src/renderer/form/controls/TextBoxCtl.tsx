// Zone de texte : <input>, ou <textarea> au-delà de deux lignes ou sur un champ Texte long. Liée : texte affiché, ou modifiable
// pendant la saisie ; calculée : son résultat (#Erreur, #Nom?) ; liée à un champ inconnu : #Nom?.
import { useLayoutEffect, useRef } from 'react';
import { entryCaret } from '../../datasheet/edit-keys';
import { currentSettings } from '../../settings-store';
import { typedValue } from '../calc';
import { controlTexts, isRichBox, isUnbound } from '../control-values';
import { controlEnabled, prop } from '../run-model';
import { RichTextCtl } from './RichTextCtl';
import { ctlAttrs, fieldOf, unboundText, type CtlProps } from './run-ctx';

/** A box on a Rich Text field is the rich editor (the choice is the field's, so it never changes under a mounted box). */
export function TextBoxCtl(p: CtlProps) {
  const b = fieldOf(p.c, p.x);
  return b && isRichBox(p.c, b.f) ? <RichTextCtl {...p} /> : <PlainTextBoxCtl {...p} />;
}

function PlainTextBoxCtl({ c, x, style }: CtlProps) {
  const src = prop(c, 'ControlSource');
  const b = fieldOf(c, x);
  const unbound = isUnbound(c);
  const focused = x.focused === c.name;
  const el = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const clicked = useRef(false);   // the focus came from a click: the caret stays where it landed
  let value = '';
  if (unbound) {
    value = unboundText(c, x);
  } else if (x.snap.status !== 'ready') {
    value = '';   // the source is still being read: never a flash of #Name?
  } else if (typeof src === 'string' && src.startsWith('=')) {
    const r = x.results[c.name];
    value = !r ? '' : r.ok ? r.text : x.t(`form.calc.${r.code}`);
  } else if (b) {
    const texts = controlTexts(c, b.f, b.stored, b.pending, x.display);
    value = focused ? texts.edit : texts.display;
  } else if (src) {
    value = x.t('form.calc.name');
  }
  // Entered by the keyboard (Tab, Enter, an arrow) or moved to: after the display -> edit swap, the selection of Behavior
  // entering field (O2 R5: the whole text, its start or its end); a click, or the focus given back, keeps the caret where it was
  useLayoutEffect(() => {
    const e = el.current;
    if (focused && !clicked.current && !x.givenBack(c.name) && e && e === document.activeElement) e.setSelectionRange(...entryCaret(e.value.length, currentSettings().enterFieldBehavior));
    clicked.current = false;
  }, [focused]);
  const { disabled, readOnly } = controlEnabled(c, x.snap, b?.f ?? null);
  const lines = (Number(prop(c, 'FontSize')) || 10) * 20 * 1.2;   // a line of text, in twips
  const attrs = ctlAttrs(c, x);
  const props = {
    ...attrs, ref: el, className: 'frun-text', style, value, disabled, readOnly,
    onMouseDown: (e: { target: EventTarget | null }) => { clicked.current = true; attrs.onMouseDown?.(e); },
    onChange: (e: { target: { value: string } }) => {
      if (readOnly) return;
      if (unbound) x.editUnbound(c, typedValue(e.target.value, x.display.locale), e.target.value);
      else if (b) x.edit(b.f, e.target.value);
      x.input(c);
    },
  };
  return c.height > 2 * lines || b?.f.type === 'longText' ? <textarea {...props} /> : <input {...props} />;
}

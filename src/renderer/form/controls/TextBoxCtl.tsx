// Zone de texte : <input>, ou <textarea> au-delà de deux lignes ou sur un champ Texte long. Liée : texte affiché, ou modifiable
// pendant la saisie ; calculée : son résultat (#Erreur, #Nom?) ; liée à un champ inconnu : #Nom?.
import { typedValue } from '../calc';
import { controlTexts, isUnbound } from '../control-values';
import { controlEnabled, prop } from '../run-model';
import { ctlAttrs, fieldOf, unboundText, type CtlProps } from './run-ctx';

export function TextBoxCtl({ c, x, style }: CtlProps) {
  const src = prop(c, 'ControlSource');
  const b = fieldOf(c, x);
  const unbound = isUnbound(c);
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
    value = x.focused === c.name ? texts.edit : texts.display;
  } else if (src) {
    value = x.t('form.calc.name');
  }
  const { disabled, readOnly } = controlEnabled(c, x.snap, b?.f ?? null);
  const lines = (Number(prop(c, 'FontSize')) || 10) * 20 * 1.2;   // a line of text, in twips
  const props = {
    ...ctlAttrs(c, x), className: 'frun-text', style, value, disabled, readOnly,
    onChange: (e: { target: { value: string } }) => {
      if (readOnly) return;
      if (unbound) x.editUnbound(c, typedValue(e.target.value, x.display.locale), e.target.value);
      else if (b) x.edit(b.f, e.target.value);
    },
  };
  return c.height > 2 * lines || b?.f.type === 'longText' ? <textarea {...props} /> : <input {...props} />;
}

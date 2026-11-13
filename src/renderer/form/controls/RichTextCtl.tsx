// Zone de texte liée à un champ Texte long en Texte enrichi : un contenteditable qui édite un sous-ensemble d'HTML. Tout ce qui est
// lu (affiché) ou écrit passe par sanitizeRich ; le ruban agit dessus par rich-edit.ts.
import { useLayoutEffect, useRef } from 'react';
import { richToPlain, sanitizeRich } from '../../../shared/rich-text';
import { controlEnabled } from '../run-model';
import { rememberSelection, trackRich } from '../rich-edit';
import { ctlAttrs, fieldOf, type CtlProps } from './run-ctx';

/** Keys the form handles for any control; the others (Enter, arrows, Home/End…) are the editor's own. */
const FORM_KEYS = (e: { key: string; shiftKey: boolean; ctrlKey: boolean }) =>
  e.key === 'Escape' || e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Tab' || (e.key === 'Enter' && e.shiftKey) || ((e.key === 'Home' || e.key === 'End') && e.ctrlKey);

export function RichTextCtl({ c, x, style }: CtlProps) {
  const b = fieldOf(c, x)!;
  const el = useRef<HTMLDivElement>(null);
  const attrs = ctlAttrs(c, x);
  const { disabled, readOnly } = controlEnabled(c, x.snap, b.f);
  const raw = x.snap.status !== 'ready' ? '' : b.pending !== undefined ? String(b.pending ?? '') : b.stored == null ? '' : String(b.stored);
  const html = sanitizeRich(raw);
  // The DOM follows the value unless it already shows it (typing: not rewritten, the caret stays).
  useLayoutEffect(() => {
    const e = el.current;
    if (e && sanitizeRich(e.innerHTML) !== html) e.innerHTML = html;   // the sanitized string, nothing else
  }, [html]);
  return (
    <div {...attrs} ref={el} className="frun-text frun-rich" style={style} role="textbox" aria-multiline="true" aria-disabled={disabled || undefined} aria-readonly={readOnly || undefined}
      contentEditable={disabled || readOnly ? false : true} suppressContentEditableWarning spellCheck
      onFocus={() => { trackRich(el.current); attrs.onFocus(); }}
      onBlur={(e) => { if (el.current) rememberSelection(el.current); attrs.onBlur(e); }}
      onKeyDown={(e) => { if (FORM_KEYS(e)) attrs.onKeyDown(e); }}
      onPaste={(e) => {   // plain text only: pasted markup is never taken in
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      onInput={() => {
        if (readOnly || !el.current) return;
        const clean = sanitizeRich(el.current.innerHTML);
        x.edit(b.f, richToPlain(clean).trim() === '' ? '' : clean);
        x.input(c);
      }} />
  );
}

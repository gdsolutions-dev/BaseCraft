// Éditeur de cellule Glide d'un champ à masque de saisie : les emplacements sont affichés avec le caractère de remplissage,
// seuls les caractères acceptés entrent, la casse du masque s'applique. Entrée, Tab et Échap restent ceux de Glide (et de la
// correction de glide-keyboard, qui agit sur tout éditeur de #portal).
import type { ProvideEditorCallbackResult, ProvideEditorComponent, TextCell } from '@glideapps/glide-data-grid';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fitSlot, maskFills, parseMask, renderMask, skipToLiteral, type Mask, type MaskSlot } from '../../shared/expr/input-mask';
import { takeFirstChar } from './glide-keyboard';

function makeEditor(mask: Mask): ProvideEditorComponent<TextCell> {
  const at = mask.slots.flatMap((s, i) => (s.kind === 'input' ? [i] : [])); // caret position of each input slot
  const slot = (k: number) => mask.slots[at[k]] as Extract<MaskSlot, { kind: 'input' }>;
  /** The input slot at or after a caret position. */
  const slotAt = (pos: number) => { const k = at.findIndex((p) => p >= pos); return k < 0 ? at.length : k; };
  const caretOf = (k: number) => (k < at.length ? at[k] : mask.slots.length);
  const firstEmpty = (fills: string[]) => { const k = fills.indexOf(''); return k < 0 ? at.length : k; };

  return function MaskedEditor({ value, onChange, initialValue }) {
    // Opened by typing: Glide gives the typed key, or openEditorWith's stand-in for a non-ASCII one. A stored value that does
    // not match the mask fills what fits.
    const [fills, setFills] = useState(() => maskFills(mask, (initialValue !== undefined && takeFirstChar()) || value.data));
    const current = useRef(fills); // read by the native listener, ahead of React's render
    const caret = useRef(caretOf(firstEmpty(fills)));
    const input = useRef<HTMLInputElement>(null);

    const update = (next: string[], k: number) => {
      current.current = next;
      caret.current = caretOf(k);
      setFills(next);
      onChange({ ...value, data: next.every((c) => c === '') ? '' : renderMask(mask, next) });
    };

    // Uncontrolled: React never rewrites the text in the middle of an IME composition.
    useLayoutEffect(() => {
      const el = input.current!;
      el.value = renderMask(mask, fills);
      el.setSelectionRange(caret.current, caret.current);
    }, [fills]);
    useEffect(() => {
      if (initialValue !== undefined) update(current.current, firstEmpty(current.current)); // the typed key is the cell's new text
      const el = input.current!;
      /** Input slots of the selection: [first, after last). */
      const range = (): [number, number] => { const s = el.selectionStart ?? 0, k = slotAt(s); return [k, Math.max(k, slotAt(el.selectionEnd ?? s))]; };
      /** Clears the slots [k, end), then types `text` from k; a refused character (a letter in a digit slot…) is dropped. */
      const type = ([k, end]: [number, number], text: string) => {
        const next = current.current.map((c, j) => (j >= k && j < end ? '' : c));
        for (const ch of text) {
          if (k >= at.length) break;
          const c = fitSlot(slot(k), ch);
          if (c !== null) { next[k++] = c; continue; }
          const j = skipToLiteral(mask, k, ch); // the literal of a later position: past it, the optional slots before it left empty
          if (j !== null) { next.fill('', k, j); k = j; }
        }
        update(next, k);
      };
      let composing: [number, number] | null = null; // the selection when an IME composition started
      // Typed text (AltGr, dead keys), paste and deletions, at the caret; any other edit is refused.
      const onBeforeInput = (e: InputEvent) => {
        if (composing || e.inputType.includes('Composition')) return; // not cancelable: compositionend types the result
        e.preventDefault();
        const [k, end] = range();
        if (e.inputType.startsWith('delete')) type(end > k ? [k, end] : e.inputType.endsWith('Forward') ? [k, Math.min(k + 1, at.length)] : [Math.max(0, k - 1), k], '');
        else if (e.inputType.startsWith('insert')) type([k, end], e.data ?? e.dataTransfer?.getData('text/plain') ?? '');
      };
      const onStart = () => { composing = range(); };
      const onEnd = (e: CompositionEvent) => { const r = composing ?? range(); composing = null; type(r, e.data); }; // also restores the text
      el.addEventListener('beforeinput', onBeforeInput);
      el.addEventListener('compositionstart', onStart);
      el.addEventListener('compositionend', onEnd);
      return () => {
        el.removeEventListener('beforeinput', onBeforeInput);
        el.removeEventListener('compositionstart', onStart);
        el.removeEventListener('compositionend', onEnd);
      };
    }, []);

    return <input ref={input} autoFocus className="ds-mask-input" data-testid="masked-editor" spellCheck={false} autoComplete="off" defaultValue={renderMask(mask, fills)} />;
  };
}

const editors = new Map<string, ProvideEditorCallbackResult<TextCell>>();

/** Glide's editor for an input mask (one component per mask: Glide keeps it while the cell is edited); undefined, Glide's own
 *  editor, for an unreadable mask. */
export function maskedEditor(maskText: string): ProvideEditorCallbackResult<TextCell> {
  if (!editors.has(maskText)) {
    let mask: Mask | null = null;
    try { mask = parseMask(maskText); } catch { /* unreadable: plain text editor */ }
    editors.set(maskText, mask ? { editor: makeEditor(mask) } : undefined);
  }
  return editors.get(maskText);
}

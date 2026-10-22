// Deux corrections clavier de Glide 6.0.3, au niveau du DOM (Glide n'offre pas d'API pour ouvrir un éditeur avec un texte).

const EDITOR = '#portal .gdg-clip-region';
const deferred = new WeakSet<Event>();

/**
 * Glide's cell editor saves on Enter/Tab in a setTimeout; every key also queues one, which runs first and, seeing the
 * Enter's motion, closes the editor WITHOUT its text when Enter follows the last key within the same tick (barcode
 * scanners, text expanders). Enter/Tab are re-sent one timeout later, after the earlier keys' timeouts. Installed once.
 */
export function installEditorCommitFix(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== 'Tab') || (e.key === 'Enter' && e.shiftKey) || e.isComposing || deferred.has(e)) return;
    const target = e.target as Element | null;
    if (!target?.closest?.(EDITOR)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const again = new KeyboardEvent('keydown', {
      key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true,
    });
    deferred.add(again);
    setTimeout(() => target.dispatchEvent(again), 0);
  }, true);
}
let installed = false;

const PLACEHOLDER = 'x';

/**
 * Glide opens the editor by typing only for ASCII keys (/[ -~]/): « é », « ç », « à » or a dead-key result (« ê ») would be
 * lost. The key is replaced by an ASCII one, which opens the editor the usual way, then that first character is put back.
 */
export function openEditorWith(target: EventTarget, ch: string): void {
  firstChar = ch;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: PLACEHOLDER, bubbles: true, cancelable: true }));
  const putBack = (frames: number) => {
    if (firstChar !== ch) return; // taken by a custom editor (takeFirstChar)
    const ta = document.querySelector<HTMLTextAreaElement>(`${EDITOR} textarea`);
    if (ta?.value.startsWith(PLACEHOLDER)) {
      firstChar = null;
      // React's controlled textarea: the native setter, then an input event, so that Glide's onChange sees it.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, ch + ta.value.slice(1));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (frames > 0) {
      requestAnimationFrame(() => putBack(frames - 1));
    } else {
      firstChar = null;
    }
  };
  putBack(30);
}
let firstChar: string | null = null;

/** For a custom editor opened by typing (Glide's initialValue): the character openEditorWith stands for, taken once, else null. */
export function takeFirstChar(): string | null {
  const ch = firstChar;
  firstChar = null;
  return ch;
}

/** A key that types one non-ASCII character (AltGr counts as Ctrl+Alt on Windows; Ctrl or Meta alone are shortcuts). */
export function isNonAsciiChar(e: KeyboardEvent): boolean {
  return e.key.length === 1 && !/[ -~]/.test(e.key) && !e.isComposing && !e.metaKey && !(e.ctrlKey && !e.altKey);
}

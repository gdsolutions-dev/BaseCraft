// Rich Text in Form view: the ribbon's text commands over the contenteditable of the focused rich text box. The editor is the
// browser's own (contenteditable + document.execCommand: deprecated, but the only way to a limited HTML subset with no
// dependency); everything it writes goes through sanitizeRich before it is stored.
// ponytail: one editor at a time (a module variable); execCommand is replaced by hand-made range edits if a browser drops it.

export type RichCommand = 'bold' | 'italic' | 'underline' | 'bullets' | 'numbering' | 'indentIncrease' | 'indentDecrease' | 'direction' | 'foreColor' | 'highlight';
export type RichState = Partial<Record<'bold' | 'italic' | 'underline' | 'bullets' | 'numbering' | 'direction', boolean>>;

let target: HTMLElement | null = null;   // the editor that has (or last had) the focus
let saved: Range | null = null;          // its selection when the focus left it (a colour popup)

export function trackRich(el: HTMLElement | null): void { if (el) target = el; }
/** The selection of `el`, kept for the popups that take the focus away. */
export function rememberSelection(el: HTMLElement): void {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && el.contains(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange();
}

const EXEC: Partial<Record<RichCommand, string>> = {
  bold: 'bold', italic: 'italic', underline: 'underline', bullets: 'insertUnorderedList', numbering: 'insertOrderedList',
  indentIncrease: 'indent', indentDecrease: 'outdent', foreColor: 'foreColor', highlight: 'hiliteColor',
};

/** The block (div, li…) the caret is in, below the editor; the editor's text gets a div first so it has one to carry dir. */
function toggleDirection(root: HTMLElement): void {
  const block = () => {
    const n = window.getSelection()?.anchorNode;
    const e = n instanceof Element ? n : n?.parentElement;
    const b = e?.closest('div,li,p,blockquote,ul,ol');
    return b && b !== root && root.contains(b) ? (b as HTMLElement) : null;
  };
  let b = block();
  if (!b) { document.execCommand('formatBlock', false, 'div'); b = block(); }
  if (!b) return;
  if (b.getAttribute('dir') === 'rtl') b.removeAttribute('dir'); else b.setAttribute('dir', 'rtl');
  root.dispatchEvent(new Event('input', { bubbles: true }));   // the edit is not the browser's own: say it
}

/** Runs a command on the editor: focus and selection given back first (a ribbon popup had them). */
export function runRich(cmd: RichCommand, value?: string): void {
  const el = target;
  if (!el || !el.isConnected) return;
  const sel = window.getSelection();
  el.focus({ preventScroll: true });
  if (saved && sel && !el.contains(sel.anchorNode)) { sel.removeAllRanges(); sel.addRange(saved); }
  if (cmd === 'direction') { toggleDirection(el); return; }
  document.execCommand('styleWithCSS', false, 'false');   // <b>, <font color>, not style="font-weight"
  document.execCommand(EXEC[cmd]!, false, value);
}

/** Pressed buttons at the caret. */
export function richState(): RichState {
  const q = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
  const n = window.getSelection()?.anchorNode;
  const e = n instanceof Element ? n : n?.parentElement;
  return { bold: q('bold'), italic: q('italic'), underline: q('underline'), bullets: q('insertUnorderedList'), numbering: q('insertOrderedList'),
    direction: !!e?.closest('[dir="rtl"]') && !!target?.contains(e) };
}

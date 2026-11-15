/** E6b: the marks the print CSS (form.css) reads: html.bc-print-record and the form's data-print-record. Set while `print` runs, removed
 *  in a finally whatever happens; one print at a time (a second call is refused, the first's marks untouched). */
export type Marked = Pick<Element, 'classList' | 'setAttribute' | 'removeAttribute'>;

let printing = false;

export async function withPrintMarks(el: Marked | null, print: () => Promise<unknown>, html: Marked = document.documentElement, mark = ''): Promise<void> {
  if (!el) throw new Error('bc:actionNotRun');
  if (printing) throw new Error('bc:commandUnavailable');
  printing = true;
  html.classList.add('bc-print-record');
  el.setAttribute('data-print-record', mark);
  try { await print(); } finally {
    el.removeAttribute('data-print-record');
    html.classList.remove('bc-print-record');
    printing = false;
  }
}

/** The form's data-print-record value for `print` (every record); '' is the current record only (printSelection). */
export const PRINT_ALL = 'all';

// ponytail: the print-only block holds one rendered detail per record, all in the DOM at once, and the rows are read by the renderer: past this many
// records `print` is refused. Upgrade path: paged rendering (render and print a page of records at a time, one print job).
export const MAX_PRINT_RECORDS = 5000;

/** The indexes of the records `print` renders, in the form's order (the new-record row is never one); refused past the ceiling. */
export function printAllRows(total: number): number[] {
  if (total > MAX_PRINT_RECORDS) throw new Error('bc:commandUnavailable');
  return Array.from({ length: total }, (_, i) => i);
}

/** Datasheet view: refused (Access prints the datasheet selection; deliberate deviation, noted). */
export function refuseDatasheet(view: string): void {
  if (view === 'datasheet') throw new Error('bc:commandUnavailable');
}

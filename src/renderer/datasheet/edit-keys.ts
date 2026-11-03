// Le modèle de touches d'Access (O2 R3–R9), pur : une touche et l'état de la saisie en entrée, un déplacement en sortie. Les
// formulaires (événements des contrôles de FormRunView) et les grilles Glide n'appliquent que le déplacement.
import type { AppSettings } from '../../shared/api';

export type EditPrefs = Pick<AppSettings, 'moveAfterEnter' | 'enterFieldBehavior' | 'arrowKeyBehavior' | 'continuousArrowKeys' | 'cursorStopsAtEnds'>;
export interface EditKey {
  key: string; shift: boolean; ctrl: boolean; alt: boolean; meta: boolean; composing: boolean;
  caret: { start: number; end: number; length: number } | null;   // null: an entry without text (check box, option, Yes/No cell)
  editing: boolean;       // R3's edit mode (a grid: its editor is open)
  grid: boolean;          // a Glide grid (Up/Down are records there, Glide's own)
  continuous: boolean;    // Continuous Forms view (R7)
  multiline: boolean;     // a textarea (Enter, Up/Down stay in the text)
}
export type EditMove =
  | { to: 'pass' }                                   // the key does what it does today
  | { to: 'field'; dir: 1 | -1; stopAtEnds: boolean } // R4, R6, R8, R9
  | { to: 'record'; dir: 1 | -1 }                     // R4 next record, R7
  | { to: 'stay' }                                    // R4 « Aucun effet »: a grid commits its editor
  | { to: 'caret'; at: 'all' | 'start' | 'end' };     // R3 F2, R6 collapse; a grid opens its editor there

const PASS: EditMove = { to: 'pass' };

/** What the key does in an entry. Characters, Tab and any key with Ctrl, Alt (AltGr), Meta or Shift, or typed while an IME
 *  composes, are never taken: they pass. */
export function editKey(k: EditKey, p: EditPrefs): EditMove {
  if (k.composing || k.ctrl || k.alt || k.meta || k.shift) return PASS;
  if (k.key === 'Enter') {
    if (k.multiline) return PASS;
    return p.moveAfterEnter === 'nextField' ? { to: 'field', dir: 1, stopAtEnds: false } : p.moveAfterEnter === 'nextRecord' ? { to: 'record', dir: 1 } : { to: 'stay' };
  }
  if (k.key === 'F2') return { to: 'caret', at: k.editing ? 'all' : 'end' };
  const field = (dir: 1 | -1): EditMove => ({ to: 'field', dir, stopAtEnds: p.cursorStopsAtEnds });
  if (k.key === 'ArrowUp' || k.key === 'ArrowDown') {
    const dir = k.key === 'ArrowDown' ? 1 : -1;
    if (k.continuous && p.continuousArrowKeys === 'upDown') return { to: 'record', dir };
    return k.grid || k.multiline ? PASS : field(dir);
  }
  if (k.key !== 'ArrowLeft' && k.key !== 'ArrowRight') return PASS;
  const dir = k.key === 'ArrowRight' ? 1 : -1;
  if (k.continuous && p.continuousArrowKeys === 'leftRight') return { to: 'record', dir };
  if (k.caret === null) return field(dir);
  if (p.arrowKeyBehavior === 'nextField') return k.editing ? PASS : field(dir);
  const { start, end, length } = k.caret;
  if (start === end) return (dir > 0 ? end === length : start === 0) ? field(dir) : PASS;
  if (start === 0 && end === length) return { to: 'caret', at: dir > 0 ? 'end' : 'start' };
  return PASS;
}

/** A grid's next cell for a field move; null: stays (an end with stopAtEnds, the sheet's last cell, nothing to add). */
export function nextCell(at: [col: number, row: number], dir: 1 | -1, cols: number, rows: number /* the new record's row included */, stopAtEnds: boolean): [number, number] | null {
  const [col, row] = at;
  if (col + dir >= 0 && col + dir < cols) return [col + dir, row];
  if (stopAtEnds || row + dir < 0 || row + dir >= rows) return null;
  return [dir > 0 ? 0 : cols - 1, row + dir];
}

/** R5: the selection an entry reached by the keyboard gets. */
export function entryCaret(length: number, b: EditPrefs['enterFieldBehavior']): [number, number] {
  return b === 'selectAll' ? [0, length] : b === 'start' ? [0, 0] : [length, length];
}

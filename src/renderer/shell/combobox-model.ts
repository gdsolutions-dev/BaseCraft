// Liste modifiable (combobox ARIA) : ce que montre la liste et ce que font les touches. Module pur, testé sans DOM.
import type { LookupData } from '../../shared/api';

export interface ComboOption { id: string; label: string }
/** filter: the typed text the list is narrowed to, or null (opened from the button or the arrows: every option). */
export interface ComboState { open: boolean; filter: string | null; active: number }
export const CLOSED: ComboState = { open: false, filter: null, active: -1 };

const MAX_HEIGHT = 240;
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

export function visibleOptions(options: ComboOption[], filter: string | null): ComboOption[] {
  return filter === null ? options : options.filter((o) => fold(o.label).includes(fold(filter)));
}

/** A lookup list's options: each row's shown text (its first visible column), what filtering and AutoExpand compare. */
export function listOptions(data: LookupData): ComboOption[] {
  return data.rows.map((r, i) => ({ id: String(i), label: r.display[0] ?? '' }));
}

/** The first option whose folded text starts with the folded text typed; -1 (Access's AutoExpand). */
export function prefixMatch(options: ComboOption[], text: string): number {
  return text === '' ? -1 : options.findIndex((o) => fold(o.label).startsWith(fold(text)));
}

/** Typing keeps the text as typed (free text); the list shows the options that contain it, none active (an emptied
 *  field closes it). */
export function typed(options: ComboOption[], text: string): ComboState {
  return { open: text !== '' && visibleOptions(options, text).length > 0, filter: text, active: -1 };
}

/** A key on the input. handled: the component stops it (the designer's arrows, the dialogs' Escape never see it).
 *  Down/Up open the whole list on the current value (Alt+Down: without moving), then move and wrap; Enter picks the
 *  active option; Escape and Alt+Up close; Tab closes and leaves. */
export function comboKey(s: ComboState, key: string, alt: boolean, options: ComboOption[], value: string)
  : { state: ComboState; pick?: ComboOption; handled: boolean } {
  const shown = visibleOptions(options, s.filter);
  if (key === 'ArrowUp' && alt && s.open) return { state: CLOSED, handled: true };
  if ((key === 'ArrowDown' || key === 'ArrowUp') && options.length) {
    const delta = key === 'ArrowDown' ? 1 : -1;
    if (!s.open) {
      const current = options.findIndex((o) => o.label === value);
      const active = alt ? current : current >= 0 ? current : delta > 0 ? 0 : options.length - 1;
      return { state: { open: true, filter: null, active }, handled: true };
    }
    if (!shown.length) return { state: s, handled: true };
    const active = s.active < 0 ? (delta > 0 ? 0 : shown.length - 1) : (s.active + delta + shown.length) % shown.length;
    return { state: { ...s, active }, handled: true };
  }
  if (key === 'Enter' && s.open && shown[s.active]) return { state: CLOSED, pick: shown[s.active], handled: true };
  if (key === 'Escape' || key === 'Enter' || key === 'Tab') return { state: CLOSED, handled: key === 'Escape' && s.open };
  return { state: s, handled: false };
}

/** Where the list goes: below the field, or above when there is more room there. down: the side chosen when the list
 *  opened, kept while it stays open (else it would jump from side to side as typing narrows it); null when opening. */
export function placeList(field: { left: number; top: number; bottom: number; width: number }, viewHeight: number,
  contentHeight: number, down: boolean | null) {
  const below = viewHeight - field.bottom - 4, above = field.top - 4;
  const d = down ?? (below >= Math.min(MAX_HEIGHT, contentHeight) || below >= above);
  return { down: d, style: { left: field.left, minWidth: field.width, maxHeight: Math.min(MAX_HEIGHT, d ? below : above),
    ...(d ? { top: field.bottom + 2 } : { bottom: viewHeight - field.top + 2 }) } };
}

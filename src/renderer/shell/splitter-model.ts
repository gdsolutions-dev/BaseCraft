// Splitter model: positions are kept as a ratio (first pane / available size), shown and clamped in pixels.
export const SPLIT_DEFAULT = 0.6;

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** Px size of the first pane for a ratio; the first pane's minimum wins when `total` cannot hold both minimums. */
export function ratioToPx(ratio: number, total: number, minA: number, minB: number): number {
  return Math.round(clamp(ratio * total, minA, total - minB));
}

export const pxToRatio = (px: number, total: number): number => (total > 0 ? px / total : SPLIT_DEFAULT);

/** A stored value is only trusted when it is a ratio strictly between 0 and 1. */
export function parseRatio(raw: string | null | undefined): number {
  const n = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return n > 0 && n < 1 ? n : SPLIT_DEFAULT;
}

export function loadRatio(key: string): number {
  try { return parseRatio(localStorage.getItem(key)); } catch { return SPLIT_DEFAULT; }
}

export function saveRatio(key: string, ratio: number): void {
  try { localStorage.setItem(key, String(ratio)); } catch { /* storage unavailable: the position is simply not remembered */ }
}

// Rectangles et poignées du concepteur (twips). Module pur.
import { MAX_TWIPS } from './units';

export interface Rect { left: number; top: number; width: number; height: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Déplace les bords désignés par la poignée : jamais sous `min`, jamais sous 0, jamais au-delà de MAX_TWIPS. Le bord opposé ne bouge pas. */
export function resizeRect(r: Rect, h: Handle, dx: number, dy: number, min: number): Rect {
  let { left, top, width, height } = r;
  if (h.includes('e')) width = Math.min(Math.max(width + dx, min), MAX_TWIPS - left);
  if (h.includes('w')) { const right = left + width; left = Math.max(0, Math.min(left + dx, right - min)); width = Math.max(min, right - left); }
  if (h.includes('s')) height = Math.min(Math.max(height + dy, min), MAX_TWIPS - top);
  if (h.includes('n')) { const bottom = top + height; top = Math.max(0, Math.min(top + dy, bottom - min)); height = Math.max(min, bottom - top); }
  return { left: left + 0, top: top + 0, width: width + 0, height: height + 0 }; // + 0 : jamais -0
}

/** Recouvrement strict : deux rectangles qui se touchent seulement par un bord ne se coupent pas (un trait de hauteur 0 compte s'il est à l'intérieur). */
export const intersects = (a: Rect, b: Rect): boolean =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

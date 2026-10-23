// Geste de souris ou touche du clavier -> actions du modèle du concepteur. Module pur.
// Coordonnées en px (100 %) relatives à la section : pour 'move', le coin haut gauche de la sélection (son ancre) au départ
// et à l'arrivée, l'arrivée dans le repère de la section survolée ; pour 'band' et 'place', l'arrivée dans le repère de départ.
import type { ControlKind } from '../../shared/design/model';
import type { DesignerAction } from './designer-model';
import type { Handle, Rect } from './geometry';
import { pxToTwips, TWIPS_PER_PX } from './units';

type Point = { x: number; y: number };
export type Gesture =
  | { kind: 'move'; section: number; origin: Point } | { kind: 'resize'; handle: Handle; origin: Point }
  | { kind: 'band'; section: number; origin: Point } | { kind: 'sectionHeight'; index: number; origin: { y: number }; start: number }
  | { kind: 'place'; tool: ControlKind; section: number; origin: Point };

const CLICK_PX = 3;
const DEFAULT_SIZE = { width: 1418, height: 340 }; // 2,5 cm × 0,6 cm
const isClick = (o: Point, at: Point): boolean => Math.abs(at.x - o.x) < CLICK_PX && Math.abs(at.y - o.y) < CLICK_PX;
const spanned = (o: Point, at: Point): Rect => ({
  left: pxToTwips(Math.min(o.x, at.x)), top: pxToTwips(Math.min(o.y, at.y)), width: pxToTwips(Math.abs(at.x - o.x)), height: pxToTwips(Math.abs(at.y - o.y)),
});
const free = (alt: boolean) => (alt ? { free: true } : {});

export function gestureEnd(g: Gesture, at: Point & { section: number }, mods: { alt: boolean; shift: boolean }): DesignerAction[] {
  switch (g.kind) {
    case 'move': {
      if (at.section === g.section && isClick(g.origin, at)) return [];
      const dx = pxToTwips(at.x - g.origin.x);
      if (at.section !== g.section) {   // dépôt dans une autre section, une seule action : l'ancre arrive au point visé (le réducteur aimante)
        return [{ type: 'changeSection', to: at.section, top: Math.max(0, pxToTwips(at.y)), ...(dx ? { dx } : {}), ...free(mods.alt) }];
      }
      return [{ type: 'moveBy', dx, dy: pxToTwips(at.y - g.origin.y), ...free(mods.alt) }];
    }
    case 'resize':
      return isClick(g.origin, at) ? [] : [{ type: 'resize', handle: g.handle, dx: pxToTwips(at.x - g.origin.x), dy: pxToTwips(at.y - g.origin.y), ...free(mods.alt) }];
    case 'band':
      if (isClick(g.origin, at)) return mods.shift ? [] : [{ type: 'select', selection: { kind: 'doc' } }];
      return [{ type: 'selectRect', section: g.section, rect: spanned(g.origin, at), add: mods.shift }];
    case 'sectionHeight':
      return Math.abs(at.y - g.origin.y) < CLICK_PX ? [] : [{ type: 'setSectionHeight', index: g.index, height: Math.max(0, g.start + pxToTwips(at.y - g.origin.y)) }];
    case 'place': return [];   // le canevas appelle placeRect, puis host.newControls
  }
}

/** Un clic : la taille par défaut au point d'origine ; sinon le rectangle tracé. */
export function placeRect(g: Extract<Gesture, { kind: 'place' }>, at: Point & { section: number }): { section: number; rect: Rect } {
  if (isClick(g.origin, at)) return { section: g.section, rect: { left: pxToTwips(Math.max(0, g.origin.x)), top: pxToTwips(Math.max(0, g.origin.y)), ...DEFAULT_SIZE } };
  return { section: g.section, rect: spanned({ x: Math.max(0, g.origin.x), y: Math.max(0, g.origin.y) }, { x: Math.max(0, at.x), y: Math.max(0, at.y) }) };
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Flèches : déplacer d'un pas de grille ; Ctrl : d'un pixel, sans aimanter ; Maj : redimensionner (bord droit ou bas). */
export function keyAction(key: string, mods: { ctrl: boolean; shift: boolean }, step: number): DesignerAction | null {
  const arrow = ARROWS[key];
  if (arrow) {
    const n = mods.ctrl ? TWIPS_PER_PX : step;
    const [dx, dy] = [arrow[0] * n + 0, arrow[1] * n + 0];   // + 0 : jamais -0
    const f = free(mods.ctrl);
    return mods.shift ? { type: 'resize', handle: dx ? 'e' : 's', dx, dy, ...f } : { type: 'moveBy', dx, dy, ...f };
  }
  if (mods.shift) return null;
  if (!mods.ctrl) {
    if (key === 'Delete') return { type: 'deleteSelection' };
    if (key === 'Escape') return { type: 'select', selection: { kind: 'doc' } };
    return null;
  }
  return ({ a: { type: 'selectAll' }, z: { type: 'undo' }, y: { type: 'redo' } } as Record<string, DesignerAction>)[key.toLowerCase()] ?? null;
}

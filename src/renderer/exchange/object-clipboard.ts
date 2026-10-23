// Presse-papiers des objets du volet de navigation (A6) : Couper et Copier ne retiennent que { type, nom, coupé } ; Coller fait le travail.
// Il vit le temps de la base de la fenêtre : fermer ou changer de base le vide.
import type { DocKind } from '../state/app-state';

export interface ObjectClip { kind: DocKind; name: string; cut: boolean }

let clip: ObjectClip | null = null;
const listeners = new Set<() => void>();

export function setClip(c: ObjectClip | null): void {
  clip = c;
  listeners.forEach((l) => l());
}
export const getClip = (): ObjectClip | null => clip;
export function onClip(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

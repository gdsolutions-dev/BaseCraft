// Cache des images partagées de la base (lot F3) : une promesse par nom, vidée quand la galerie change.
import { useEffect, useMemo, useState } from 'react';
import { readPictureSpec, type PictureSpec } from '../../shared/design/picture-css';
import { readPictureType, type ResourceMap } from '../../shared/pictures';
import { api } from '../bridge';

let cache = new Map<string, Promise<string | undefined>>();
let version = 0;
const listeners = new Set<() => void>();
let wired = false;

/** Vide le cache et prévient les vues ouvertes (galerie modifiée, base changée). */
export function invalidateResources(): void {
  cache = new Map();
  version++;
  for (const l of listeners) l();
}

/** Abonnement à « la galerie a changé » (aussi à la base changée), pour les vues qui refont une mise en page. */
export function onResourcesChanged(fn: () => void): () => void {
  wire();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function wire(): void {
  if (wired) return;
  wired = true;
  api.resources?.onChange(invalidateResources);
  api.base?.onStateChanged?.(invalidateResources);
}

/** Les images demandées : un seul appel `get` par nom (les noms inconnus sont omis) ; un échec donne « absente », jamais d'exception. */
export async function loadResources(names: string[]): Promise<ResourceMap> {
  wire();
  const fresh = [...new Set(names)].filter((n) => !cache.has(n));
  for (let i = 0; i < fresh.length; i += 100) {   // main refuses more than 100 names at once
    const part = fresh.slice(i, i + 100);
    const batch = (async () => { try { return await api.resources.get(part); } catch { return {} as Record<string, string>; } })();
    for (const n of part) cache.set(n, batch.then((m) => m[n]));
  }
  const out: Record<string, string> = {};
  await Promise.all([...new Set(names)].map(async (n) => { const v = await cache.get(n); if (v !== undefined) out[n] = v; }));
  return out;
}

function useVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => { wire(); const l = () => setV(version); listeners.add(l); l(); return () => { listeners.delete(l); }; }, []);
  return v;
}

/** Plusieurs images partagées ; `ready` devient vrai quand la réponse (même vide) est arrivée. */
export function useResources(names: string[]): { map: ResourceMap; ready: boolean } {
  const v = useVersion();
  const key = JSON.stringify([...new Set(names)].sort());
  const [state, setState] = useState<{ key: string; v: number; map: ResourceMap }>({ key: '', v: -1, map: {} });
  useEffect(() => {
    let live = true;
    void loadResources(JSON.parse(key) as string[]).then((map) => { if (live) setState({ key, v, map }); });
    return () => { live = false; };
  }, [key, v]);
  return useMemo(() => ({ map: state.map, ready: state.key === key && state.v === v }), [state, key, v]);
}

/** L'URL de données d'une image partagée ; undefined pendant le chargement ou si elle n'existe pas. */
export function useResource(name: string | undefined): string | undefined {
  const { map } = useResources(name === undefined ? [] : [name]);
  return name === undefined ? undefined : map[name];
}

/** L'image de fond d'un document (ses propriétés `Picture*`) prête à dessiner : la partagée est lue dans la galerie ; undefined sans image. */
export function useDocPicture(props: Record<string, unknown>): PictureSpec | undefined {
  const name = readPictureType(props.PictureType) === 'shared' && typeof props.Picture === 'string' ? props.Picture : undefined;
  const url = useResource(name);
  return useMemo(() => readPictureSpec(props, name !== undefined && url !== undefined ? { [name]: url } : {}), [props, name, url]);
}

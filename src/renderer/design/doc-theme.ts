// Le contexte de thème et le mode de l'application, sans accès à l'API (importable par les modules purs et les tests de rendu).
import { createContext, useContext, useSyncExternalStore } from 'react';
import { DEFAULT_THEME, type Mode, type Theme } from '../../shared/design/theme';

/** `data-theme` (absent = « système ») l'emporte sur la préférence du système. */
export const modeOf = (attr: string | null, prefersDark: boolean): Mode =>
  attr === 'dark' ? 'dark' : attr === 'light' ? 'light' : prefersDark ? 'dark' : 'light';

const readMode = (): Mode => modeOf(document.documentElement.getAttribute('data-theme'), matchMedia('(prefers-color-scheme: dark)').matches);

// Un seul observateur pour toute la fenêtre, créé au premier abonné.
function subscribeMode(cb: () => void): () => void {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', cb);
  return () => { observer.disconnect(); media.removeEventListener('change', cb); };
}
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;
function subscribe(cb: () => void): () => void {
  if (listeners.size === 0) stop = subscribeMode(() => listeners.forEach((l) => l()));
  listeners.add(cb);
  return () => { listeners.delete(cb); if (listeners.size === 0) { stop?.(); stop = null; } };
}

/** Le mode de l'application (clair ou sombre), à jour quand l'utilisateur ou le système change. */
export const useAppMode = (): Mode => useSyncExternalStore(subscribe, readMode);

export const Ctx = createContext<{ theme: Theme; mode: Mode }>({ theme: DEFAULT_THEME, mode: 'light' });

export const useDocTheme = (): { theme: Theme; mode: Mode } => useContext(Ctx);

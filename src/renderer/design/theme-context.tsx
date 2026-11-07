// Contexte de thème (lot F2) : le thème effectif d'un document (son remplacement, sinon le défaut de la base) et le mode
// clair/sombre de l'application. Le thème de la base est lu une fois et relu quand la fenêtre signale un changement.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, effectiveTheme, type Mode, type Theme } from '../../shared/design/theme';
import { Ctx, modeOf, useAppMode, useDocTheme } from './doc-theme';
import { fontFaceCss } from '../../shared/fonts';
import { api } from '../bridge';

/** Le thème par défaut de la base ; relu quand il change et quand la base change (le défaut intégré tant que rien n'est lu). */
export function useBaseTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  useEffect(() => {
    let live = true;
    // Le même thème relu garde l'objet précédent : la valeur du contexte reste stable, les contrôles ne se redessinent pas.
    const load = () => { api.theme?.get().then((t) => { if (live) setTheme((prev) => (JSON.stringify(prev) === JSON.stringify(t) ? prev : t)); }, () => { /* pas de base : thème intégré */ }); };
    load();
    const offTheme = api.theme?.onChange(load);
    const offState = api.base.onStateChanged(load);
    return () => { live = false; offTheme?.(); offState(); };
  }, []);
  return theme;
}

/** Fournit le thème effectif du document (`docProps.Theme` s'il est valide, sinon le défaut de la base) et le mode donné
 *  (le mode de l'application pour un formulaire, `light` pour un état). */
export function DocThemeProvider({ docProps, mode, children }: { docProps: Record<string, unknown>; mode: Mode; children: ReactNode }) {
  const base = useBaseTheme();
  const theme = effectiveTheme(docProps, base);
  const value = useMemo(() => ({ theme, mode }), [theme, mode]);
  // Les polices du thème (embarquées) pour les contrôles dessinés à l'écran sous le nom « BC <famille> », comme dans l'aperçu d'un état.
  const faces = useMemo(() => fontFaceCss([theme.fonts.major, theme.fonts.minor].flatMap((family) =>
    [false, true].flatMap((bold) => [false, true].map((italic) => ({ family, bold, italic })))), 'fonts/'), [theme]);
  useEffect(() => {   // dans <head> : aucun élément de plus dans la mise en page de la vue
    const el = document.createElement('style');
    el.textContent = faces;
    document.head.append(el);
    return () => el.remove();
  }, [faces]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { modeOf, useAppMode, useDocTheme };

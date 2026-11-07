// Galerie des thèmes : l'ordre des sections et l'application d'un thème à un document (fonctions pures).
import type { DesignDoc } from '../../shared/design/model';
import type { Theme } from '../../shared/design/theme';
import { setDocProp } from './designer-model';

export interface GalleryEntry { section: 'current' | 'custom' | 'builtin'; theme: Theme }

export const sameTheme = (a: Theme, b: Theme): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Le thème actuel d'abord (une seule fois), puis les thèmes personnalisés, puis ceux fournis. */
export function themeSections(current: Theme, custom: Theme[], builtin: readonly Theme[]): GalleryEntry[] {
  const rest = (list: readonly Theme[], section: 'custom' | 'builtin'): GalleryEntry[] =>
    list.filter((t) => !sameTheme(t, current)).map((theme) => ({ section, theme }));
  return [{ section: 'current', theme: current }, ...rest(custom, 'custom'), ...rest(builtin, 'builtin')];
}

/** « Cet objet uniquement » : écrit `props.Theme` ; le même document s'il le porte déjà. */
export const applyThemeToDoc = (doc: DesignDoc, t: Theme): DesignDoc =>
  doc.props.Theme !== undefined && sameTheme(doc.props.Theme as Theme, t) ? doc : setDocProp(doc, 'Theme', t);

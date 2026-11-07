// Galerie des thèmes (ruban › Thèmes) : le thème actuel, les thèmes personnalisés (F2b), puis ceux de BaseCraft. Un clic gauche applique le
// thème à tous les objets correspondants, comme dans Access ; le clic droit offre aussi « cet objet uniquement » et « valeur par défaut ».
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILTIN_THEMES, THEME_SLOTS, type Theme } from '../../shared/design/theme';
import { cssFamily } from '../../shared/fonts';
import { api } from '../bridge';
import { bcErrorCode, useErrorDialog } from '../shell/Modal';
import type { AppAction } from '../state/app-state';
import { useDocTheme } from '../design/theme-context';
import type { DesignerAction } from './designer-model';
import { openDesigns } from './open-designs';
import { PopupMenu, RibbonPopup } from './RibbonPopup';
import { applyThemeToDoc, themeSections, type GalleryEntry } from './theme-gallery-model';

const SWATCHES = THEME_SLOTS.filter((s) => s.startsWith('accent'));
const SECTIONS = ['current', 'custom', 'builtin'] as const;

/** Les trois actions d'un thème. « Tous » écrit la base, puis retire le thème propre de chaque document ouvert du genre (une modification
 *  chacun, enregistrée avec lui) ; la base a laissé de côté leurs lignes enregistrées. */
export function ThemeGallery(p: { kind: 'form' | 'report'; dispatch: (a: DesignerAction) => void; appDispatch: (a: AppAction) => unknown; onClose(): void; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { theme: current } = useDocTheme();
  const { kind, readOnly, onClose, appDispatch } = p;
  const showError = useErrorDialog();
  const fail = (e: unknown) => (bcErrorCode(e) === 'readOnly' ? undefined : showError(e));   // refusée (base passée en lecture seule) : rien n'a changé, sans message
  const [menu, setMenu] = useState<{ x: number; y: number; theme: Theme } | null>(null);
  const entries = themeSections(current, [], BUILTIN_THEMES);

  const all = async (theme: Theme) => {
    onClose();
    const open = openDesigns(kind);
    try { await api.theme.applyToAll(theme, kind, open.map((d) => d.name)); } catch (e) { void fail(e); return; }
    open.forEach((d) => d.clearTheme());
    appDispatch({ type: 'objectsReloaded', kind, except: open.map((d) => d.name) });   // les autres onglets du genre (Mode Formulaire, Aperçu) relisent leur ligne enregistrée
  };
  const actions: [string, (th: Theme) => void][] = [
    ['all', (th) => { void all(th); }],
    ['object', (th) => { onClose(); p.dispatch({ type: 'edit', apply: (d) => applyThemeToDoc(d, th) }); }],
    ['default', (th) => { onClose(); void api.theme.set(th).catch(fail); }],
  ];
  let index = 0;
  return (
    <RibbonPopup anchor="themes" testId="theme-gallery" labelKey="ribbon.cmd.themes" onClose={onClose} role="dialog">
      <div className="tg">
        {SECTIONS.map((s) => {
          const list = entries.filter((e: GalleryEntry) => e.section === s);
          return list.length === 0 ? null : (
            <section key={s}>
              <h3 className="tg-title">{t(`themeGallery.${s}`)}</h3>
              <div className="tg-grid">
                {list.map((e) => {
                  const i = index++;
                  const th = e.theme, light = th.colors.light;
                  return (
                    <button key={th.name} type="button" className="tg-item" data-testid={`theme-item-${i}`} data-theme-name={th.name} aria-label={th.name}
                      aria-current={e.section === 'current' ? 'true' : undefined} title={th.name}
                      onClick={() => { if (!readOnly) void all(th); }}
                      onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, theme: th }); }}>
                      <span className="tg-thumb" style={{ background: light.lt1, color: light.dk1, fontFamily: `"${cssFamily(th.fonts.major)}", sans-serif` }} aria-hidden>
                        <span className="tg-aa">Aa</span>
                        <span className="tg-sw">{SWATCHES.map((k) => <i key={k} style={{ background: light[k] }} />)}</span>
                      </span>
                      <span className="tg-name">{th.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {menu && (
        <PopupMenu x={menu.x} y={menu.y} testId="theme-menu" labelKey="ribbon.cmd.themes" onClose={() => setMenu(null)}>
          {actions.map(([id, run]) => (
            <button key={id} type="button" role="menuitem" data-testid={`theme-menu-${id}`} disabled={readOnly} onClick={() => run(menu.theme)}>{t(`themeGallery.${id}`)}</button>
          ))}
        </PopupMenu>
      )}
    </RibbonPopup>
  );
}

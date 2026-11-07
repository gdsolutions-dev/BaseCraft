// Galerie des couleurs (ruban › Thèmes › Couleurs) : le jeu actuel, les jeux des thèmes personnalisés, puis ceux de BaseCraft.
// Un clic applique le jeu à tous les objets correspondants ; le clic droit offre aussi « cet objet uniquement » et « valeur par défaut ». Les polices du thème ne changent jamais ici.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILTIN_THEMES, THEME_SLOTS, type Theme } from '../../shared/design/theme';
import { api } from '../bridge';
import { bcErrorCode, useErrorDialog, useModal } from '../shell/Modal';
import { useBaseTheme, useDocTheme } from '../design/theme-context';
import { CustomizeColorsDialog } from './CustomizeColorsDialog';
import type { DesignerAction } from './designer-model';
import { PopupMenu, RibbonPopup } from './RibbonPopup';
import { colorSchemes, swapColors, type ColorScheme } from './scheme-gallery-model';
import { applyThemeToDoc } from './theme-gallery-model';
import type { AppAction } from '../state/app-state';
import { applyToAllObjects, saveUserTheme } from './ThemeGallery';

const SWATCHES = ['dk2', 'lt2', ...THEME_SLOTS.filter((s) => s.startsWith('accent'))] as const;
const SECTIONS = ['current', 'custom', 'builtin'] as const;

export function ColorsGallery(p: { kind: 'form' | 'report'; appDispatch: (a: AppAction) => unknown; dispatch: (a: DesignerAction) => void; onClose(): void; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { theme: current } = useDocTheme();
  const base = useBaseTheme();
  const { readOnly, onClose } = p;
  const showError = useErrorDialog();
  const modal = useModal();
  const fail = (e: unknown) => (bcErrorCode(e) === 'readOnly' ? undefined : showError(e));   // refusée (base passée en lecture seule) : rien n'a changé, sans message
  const [menu, setMenu] = useState<{ x: number; y: number; scheme: ColorScheme } | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [custom, setCustom] = useState<Theme[]>([]);
  const reload = () => api.themes.list().then(setCustom, () => undefined);
  useEffect(() => { void reload(); }, []);
  const entries = colorSchemes(current, custom, BUILTIN_THEMES);

  const toObject = (s: ColorScheme) => p.dispatch({ type: 'edit', apply: (d) => applyThemeToDoc(d, swapColors(current, s)) });
  const all = (s: ColorScheme) => { onClose(); void applyToAllObjects(p.kind, swapColors(base, s), p.appDispatch, fail); };
  const actions: [string, (s: ColorScheme) => void][] = [
    ['all', all],
    ['object', (s) => { onClose(); toObject(s); }],
    ['default', (s) => { onClose(); void api.theme.set(swapColors(base, s)).catch(fail); }],
  ];
  let index = 0;
  return (
    <>
      {!customizing && (
        <RibbonPopup anchor="themeColors" testId="colors-gallery" labelKey="ribbon.cmd.themeColors" onClose={onClose} role="dialog">
          <div className="tg">
            {SECTIONS.map((sec) => {
              const list = entries.filter((e) => e.section === sec);
              return list.length === 0 ? null : (
                <section key={sec}>
                  <h3 className="tg-title">{t(`themeGallery.${sec}`)}</h3>
                  <div className="tg-grid">
                    {list.map((e) => {
                      const i = index++;
                      return (
                        <button key={`${sec}:${e.scheme.name}:${i}`} type="button" className="tg-item" data-testid={`colors-item-${i}`} data-scheme-name={e.scheme.name} aria-label={e.scheme.name}
                          aria-current={sec === 'current' ? 'true' : undefined} title={e.scheme.name}
                          onClick={() => { if (!readOnly) all(e.scheme); }}
                          onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, scheme: e.scheme }); }}>
                          <span className="tg-thumb" aria-hidden><span className="tg-sw cs-sw">{SWATCHES.map((k) => <i key={k} style={{ background: e.scheme.light[k] }} />)}</span></span>
                          <span className="tg-name">{e.scheme.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="tg-footer">
            <button type="button" role="menuitem" data-testid="colors-customize" onClick={() => setCustomizing(true)}>{t('colorsGallery.customize')}</button>
          </div>
          {menu && (
            <PopupMenu x={menu.x} y={menu.y} testId="colors-menu" labelKey="ribbon.cmd.themeColors" onClose={() => setMenu(null)}>
              {actions.map(([id, run]) => (
                <button key={id} type="button" role="menuitem" data-testid={`colors-menu-${id}`} disabled={readOnly} onClick={() => run(menu.scheme)}>{t(`colorsGallery.${id}`)}</button>
              ))}
            </PopupMenu>
          )}
        </RibbonPopup>
      )}
      {customizing && (
        <CustomizeColorsDialog base={current.colors} readOnly={readOnly} onCancel={onClose}
          onOk={(s) => { onClose(); toObject(s); }}
          onSave={(s) => { void saveUserTheme(modal, showError, { name: s.name, colors: s, fonts: current.fonts }); }} />
      )}
    </>
  );
}

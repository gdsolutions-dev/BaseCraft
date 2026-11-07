// Galerie des polices (ruban › Thèmes › Polices) : le jeu actuel, les jeux des thèmes personnalisés, puis ceux de BaseCraft.
// Un clic applique le jeu à tous les objets correspondants ; le clic droit offre aussi « cet objet uniquement » et « valeur par défaut ». Les couleurs du thème ne changent jamais ici.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILTIN_THEMES, type Theme } from '../../shared/design/theme';
import { cssFamily } from '../../shared/fonts';
import { api } from '../bridge';
import { bcErrorCode, useErrorDialog, useModal } from '../shell/Modal';
import { useBaseTheme, useDocTheme } from '../design/theme-context';
import { CustomizeFontsDialog } from './CustomizeFontsDialog';
import type { DesignerAction } from './designer-model';
import { PopupMenu, RibbonPopup } from './RibbonPopup';
import { fontSchemes, swapFonts, type FontScheme } from './scheme-gallery-model';
import { applyThemeToDoc } from './theme-gallery-model';
import type { AppAction } from '../state/app-state';
import { applyToAllObjects, saveUserTheme } from './ThemeGallery';

const SECTIONS = ['current', 'custom', 'builtin'] as const;

export function FontsGallery(p: { kind: 'form' | 'report'; appDispatch: (a: AppAction) => unknown; dispatch: (a: DesignerAction) => void; onClose(): void; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { theme: current } = useDocTheme();
  const base = useBaseTheme();
  const { readOnly, onClose } = p;
  const showError = useErrorDialog();
  const modal = useModal();
  const fail = (e: unknown) => (bcErrorCode(e) === 'readOnly' ? undefined : showError(e));   // refusée (base passée en lecture seule) : rien n'a changé, sans message
  const [menu, setMenu] = useState<{ x: number; y: number; scheme: FontScheme } | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [custom, setCustom] = useState<Theme[]>([]);
  useEffect(() => { void api.themes.list().then(setCustom, () => undefined); }, []);
  const entries = fontSchemes(current, custom, BUILTIN_THEMES);

  const toObject = (s: FontScheme) => p.dispatch({ type: 'edit', apply: (d) => applyThemeToDoc(d, swapFonts(current, s)) });
  const all = (s: FontScheme) => { onClose(); void applyToAllObjects(p.kind, swapFonts(base, s), p.appDispatch, fail); };
  const actions: [string, (s: FontScheme) => void][] = [
    ['all', all],
    ['object', (s) => { onClose(); toObject(s); }],
    ['default', (s) => { onClose(); void api.theme.set(swapFonts(base, s)).catch(fail); }],
  ];
  let index = 0;
  return (
    <>
      {!customizing && (
        <RibbonPopup anchor="themeFonts" testId="fonts-gallery" labelKey="ribbon.cmd.themeFonts" onClose={onClose} role="dialog">
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
                        <button key={`${sec}:${e.scheme.name}:${i}`} type="button" className="tg-item" data-testid={`fonts-item-${i}`} data-scheme-name={e.scheme.name} aria-label={e.scheme.name}
                          aria-current={sec === 'current' ? 'true' : undefined} title={`${e.scheme.major} / ${e.scheme.minor}`}
                          onClick={() => { if (!readOnly) all(e.scheme); }}
                          onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, scheme: e.scheme }); }}>
                          <span className="tg-thumb" aria-hidden><span className="fs-aa" style={{ fontFamily: `"${cssFamily(e.scheme.major)}", sans-serif` }}>Aa</span></span>
                          <span className="tg-name">{e.scheme.name}</span>
                          <span className="tg-name fs-pair">{e.scheme.major} / {e.scheme.minor}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="tg-footer">
            <button type="button" role="menuitem" data-testid="fonts-customize" onClick={() => setCustomizing(true)}>{t('fontsGallery.customize')}</button>
          </div>
          {menu && (
            <PopupMenu x={menu.x} y={menu.y} testId="fonts-menu" labelKey="ribbon.cmd.themeFonts" onClose={() => setMenu(null)}>
              {actions.map(([id, run]) => (
                <button key={id} type="button" role="menuitem" data-testid={`fonts-menu-${id}`} disabled={readOnly} onClick={() => run(menu.scheme)}>{t(`fontsGallery.${id}`)}</button>
              ))}
            </PopupMenu>
          )}
        </RibbonPopup>
      )}
      {customizing && (
        <CustomizeFontsDialog base={current.fonts} readOnly={readOnly} onCancel={onClose}
          onOk={(s) => { onClose(); toObject(s); }}
          onSave={(s) => { void saveUserTheme(modal, showError, { name: s.name, colors: current.colors, fonts: s }); }} />
      )}
    </>
  );
}

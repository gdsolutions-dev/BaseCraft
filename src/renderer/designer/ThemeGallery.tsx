// Galerie des thèmes (ruban › Thèmes) : le thème actuel, les thèmes personnalisés (F2b), puis ceux de BaseCraft. Un clic gauche applique le
// thème à tous les objets correspondants, comme dans Access ; le clic droit offre aussi « cet objet uniquement » et « valeur par défaut ».
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILTIN_THEMES, THEME_SLOTS, type Theme } from '../../shared/design/theme';
import { cssFamily } from '../../shared/fonts';
import { api } from '../bridge';
import { bcErrorCode, useErrorDialog, useModal, type ModalApi } from '../shell/Modal';
import type { AppAction } from '../state/app-state';
import { useDocTheme } from '../design/theme-context';
import type { DesignerAction } from './designer-model';
import { openDesigns } from './open-designs';
import { PopupMenu, RibbonPopup } from './RibbonPopup';
import { applyThemeToDoc, customNamed, themeSections, type GalleryEntry } from './theme-gallery-model';

const SWATCHES = THEME_SLOTS.filter((s) => s.startsWith('accent'));
const SECTIONS = ['current', 'custom', 'builtin'] as const;

/** Enregistre un thème de l'utilisateur ; si le nom existe déjà, demande confirmation pour le remplacer. Vrai si enregistré. */
export async function saveUserTheme(modal: ModalApi, showError: (e: unknown) => Promise<void>, th: Theme): Promise<boolean> {
  try {
    try { await api.themes.save(th); } catch (e) {
      if (bcErrorCode(e) !== 'themeExists') throw e;
      if (await modal.confirm({ titleKey: 'themeGallery.saveTitle', messageKey: 'themeGallery.replace', params: { name: th.name }, buttons: ['yes', 'no'], defaultButton: 'no' }) !== 'yes') return false;
      await api.themes.save(th, true);
    }
  } catch (e) { void showError(e); return false; }
  return true;
}

/** « Tous les objets correspondants » : écrit la base, retire le thème propre des documents ouverts du genre (une modification chacun) et
 *  fait relire leur ligne aux autres onglets du genre. Partagé par les galeries Thèmes, Couleurs et Polices. */
export async function applyToAllObjects(kind: 'form' | 'report', theme: Theme, appDispatch: (a: AppAction) => unknown, fail: (e: unknown) => unknown): Promise<void> {
  const open = openDesigns(kind);
  try { await api.theme.applyToAll(theme, kind, open.map((d) => d.name)); } catch (e) { void fail(e); return; }
  open.forEach((d) => d.clearTheme());
  appDispatch({ type: 'objectsReloaded', kind, except: open.map((d) => d.name) });   // les autres onglets du genre (Mode Formulaire, Aperçu) relisent leur ligne enregistrée
}

/** Les trois actions d'un thème. « Tous » écrit la base, puis retire le thème propre de chaque document ouvert du genre (une modification
 *  chacun, enregistrée avec lui) ; la base a laissé de côté leurs lignes enregistrées. */
export function ThemeGallery(p: { kind: 'form' | 'report'; dispatch: (a: DesignerAction) => void; appDispatch: (a: AppAction) => unknown; onClose(): void; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { theme: current } = useDocTheme();
  const { kind, readOnly, onClose, appDispatch } = p;
  const showError = useErrorDialog();
  const fail = (e: unknown) => (bcErrorCode(e) === 'readOnly' ? undefined : showError(e));   // refusée (base passée en lecture seule) : rien n'a changé, sans message
  const [menu, setMenu] = useState<{ x: number; y: number; theme: Theme } | null>(null);
  const modal = useModal();
  const [custom, setCustom] = useState<Theme[]>([]);
  const reload = () => api.themes.list().then(setCustom, () => undefined);
  useEffect(() => { void reload(); }, []);
  const entries = themeSections(current, custom, BUILTIN_THEMES);

  // « Enregistrer le thème actif… » : un nom, puis un remplacement confirmé si ce nom existe déjà.
  const saveCurrent = async () => {
    const name = await modal.prompt({ titleKey: 'themeGallery.saveTitle', labelKey: 'themeGallery.nameLabel', initial: current.name,
      validate: (v) => (v.trim() === '' || v.trim().length > 60 ? t('dialog.error.invalidName') : null) });
    if (name === null) return;
    if (await saveUserTheme(modal, showError, { ...current, name: name.trim() })) void reload();
  };
  const remove = async (th: Theme) => {
    if (await modal.confirm({ titleKey: 'themeGallery.deleteTitle', messageKey: 'themeGallery.deleteConfirm', params: { name: th.name }, buttons: ['yes', 'no'], defaultButton: 'no' }) !== 'yes') return;
    try { await api.themes.remove(th.name); } catch (e) { void showError(e); return; }
    void reload();
  };

  const all = (theme: Theme) => { onClose(); return applyToAllObjects(kind, theme, appDispatch, fail); };
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
                    <button key={e.key} type="button" className="tg-item" data-testid={`theme-item-${i}`} data-theme-name={th.name} aria-label={th.name}
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
      <div className="tg-footer">
        <button type="button" role="menuitem" data-testid="theme-save" onClick={() => { onClose(); void saveCurrent(); }}>{t('themeGallery.save')}</button>
        <button type="button" role="menuitem" data-testid="theme-browse" disabled title={t('themes.browseLater')}>{t('themeGallery.browse')}</button>
      </div>
      {menu && (
        <PopupMenu x={menu.x} y={menu.y} testId="theme-menu" labelKey="ribbon.cmd.themes" onClose={() => setMenu(null)}>
          {actions.map(([id, run]) => (
            <button key={id} type="button" role="menuitem" data-testid={`theme-menu-${id}`} disabled={readOnly} onClick={() => run(menu.theme)}>{t(`themeGallery.${id}`)}</button>
          ))}
          {customNamed(custom, menu.theme) && (
            <button type="button" role="menuitem" data-testid="theme-menu-delete" onClick={() => { const th = customNamed(custom, menu.theme)!; setMenu(null); onClose(); void remove(th); }}>{t('themeGallery.delete')}</button>
          )}
        </PopupMenu>
      )}
    </RibbonPopup>
  );
}

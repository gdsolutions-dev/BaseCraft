// Galerie d'images (ruban › Insérer une image, et plus tard Image d'arrière-plan) : les images de la base, puis « Parcourir… ».
// Choisir une image ne change pas le document : l'hôte arme l'outil Image (voir image-gallery-model). Parcourir ajoute d'abord le fichier
// à la galerie (une écriture de conception : désactivé en lecture seule), puis le choisit de la même façon.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PICTURE_ACCEPT } from '../../shared/pictures';
import { api } from '../bridge';
import { useResource } from '../design/resources';
import { bcErrorCode, useErrorDialog, useModal } from '../shell/Modal';
import { browseName, galleryItems, readPictureFile, type GalleryItem } from './image-gallery-model';
import { PopupMenu, RibbonPopup } from './RibbonPopup';

function Thumb({ name }: { name: string }) {
  const url = useResource(name);
  return <span className="ig-thumb">{url && <img src={url} alt="" draggable={false} loading="lazy" />}</span>;
}

/** `at` : ouverte sous un autre bouton que celui du ruban (la feuille de propriétés), à ces coordonnées. */
export function ImageGallery(p: { mode: 'insert' | 'background'; readOnly: boolean; onPick(name: string): void; onNone?(): void /* mode background : « Aucune » retire l'image */; onClose(): void; at?: { x: number; y: number } }) {
  const { t } = useTranslation();
  const { mode, readOnly, onPick, onClose } = p;
  const showError = useErrorDialog();
  const modal = useModal();
  const [menu, setMenu] = useState<{ x: number; y: number; name: string } | null>(null);
  const replacing = useRef<string | null>(null);   // le nom à remplacer quand le sélecteur de fichier sert à Remplacer, sinon Parcourir
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    const load = () => { api.resources.list().then((l) => { if (live) setItems(galleryItems(l)); }, (e: unknown) => { if (live) { setItems([]); void showError(e); } }); };
    load();
    const off = api.resources.onChange(load);
    return () => { live = false; off(); };
  }, [showError]);

  const replace = async (name: string, f: File) => {
    try { await api.resources.replace(name, await readPictureFile(f)); } catch (e) { if (bcErrorCode(e) !== 'readOnly') void showError(e); }
  };
  const remove = async (name: string) => {
    try { await api.resources.remove(name); } catch (e) {
      const used = /bc:resourceInUse\|(\d+)/.exec(e instanceof Error ? e.message : String(e));
      if (used) void modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'imageGallery.deleteInUse', params: { count: Number(used[1]) }, buttons: ['ok'] });
      else if (bcErrorCode(e) !== 'readOnly') void showError(e);
    }
  };
  const browse = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = browseName(f);
      if (!n.ok) throw new Error(n.reason === 'tooLarge' ? 'bc:pictureTooLarge' : 'bc:invalidArgument');
      const name = await api.resources.add(n.name, await readPictureFile(f));
      onPick(name);
    } catch (e) { if (bcErrorCode(e) !== 'readOnly') void showError(e); }
  };

  const anchor = mode === 'insert' ? 'insertImage' : 'backgroundImage';
  const body = (
    <>
      <div className="tg">
        <h3 className="tg-title">{t('imageGallery.title')}</h3>
        {items?.length === 0 && <p className="ig-empty" data-testid="image-gallery-empty">{t('imageGallery.empty')}</p>}
        {mode === 'background' && (
          <button type="button" className="tg-item ig-none" data-testid="image-none" aria-disabled={readOnly ? 'true' : undefined}
            onClick={() => { if (!readOnly) p.onNone?.(); }}>{t('imageGallery.none')}</button>
        )}
        <div className="tg-grid ig-grid">
          {(items ?? []).map((it, i) => (
            <button key={it.name} type="button" className="tg-item" data-testid={`image-item-${i}`} data-image-name={it.name} aria-label={it.name} title={it.name} aria-disabled={readOnly ? 'true' : undefined}
              onClick={() => { if (!readOnly) onPick(it.name); }} onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY, name: it.name }); }}>
              <Thumb name={it.name} />
              <span className="tg-name">{it.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="tg-footer">
        <button type="button" role="menuitem" data-testid="image-browse" disabled={readOnly} onClick={() => { replacing.current = null; file.current?.click(); }}>{t('imageGallery.browse')}</button>
        <input ref={file} type="file" hidden accept={PICTURE_ACCEPT} data-testid="gallery-file" onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          const name = replacing.current; replacing.current = null;
          if (f && name) void replace(name, f); else void browse(f);
        }} />
      </div>
      {menu && (
        <PopupMenu x={menu.x} y={menu.y} testId="gallery-menu" labelKey="imageGallery.title" onClose={() => setMenu(null)}>
          <button type="button" role="menuitem" data-testid="gallery-menu-replace" disabled={readOnly}
            onClick={() => { replacing.current = menu.name; setMenu(null); file.current?.click(); }}>{t('imageGallery.replace')}</button>
          <button type="button" role="menuitem" data-testid="gallery-menu-delete" disabled={readOnly}
            onClick={() => { const n = menu.name; setMenu(null); void remove(n); }}>{t('imageGallery.delete')}</button>
        </PopupMenu>
      )}
    </>
  );
  return p.at
    ? <PopupMenu x={p.at.x} y={p.at.y} testId="image-gallery" labelKey={`ribbon.cmd.${anchor}`} onClose={onClose} role="dialog">{body}</PopupMenu>
    : <RibbonPopup anchor={anchor} testId="image-gallery" labelKey={`ribbon.cmd.${anchor}`} onClose={onClose} role="dialog">{body}</RibbonPopup>;
}

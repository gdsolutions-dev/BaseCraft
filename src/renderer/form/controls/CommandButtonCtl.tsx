// Bouton de commande : un <button> ; son clic (souris, Entrée, Espace) déclenche Sur clic (ctlAttrs).
// Son image (incorporée ou partagée) se dessine avant la légende, 16 px de haut ; sans image, la légende seule.
import { prop } from '../run-model';
import { useImageSource } from './ImageCtl';
import { ctlAttrs, type CtlProps } from './run-ctx';

export function CommandButtonCtl({ c, x, style }: CtlProps) {
  const caption = String(prop(c, 'Caption') ?? '');
  const pic = useImageSource(c);
  return <button type="button" {...ctlAttrs(c, x)} aria-label={caption ? undefined : c.name} className="frun-button" style={style} disabled={prop(c, 'Enabled') === false}>
    {pic && <img src={pic} alt="" className="frun-button-pic" draggable={false} />}{caption}</button>;
}

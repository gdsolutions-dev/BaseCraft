// Bouton de commande : un <button> sans effet (les événements arrivent à l'étape B).
import { prop } from '../run-model';
import { ctlAttrs, type CtlProps } from './run-ctx';

export function CommandButtonCtl({ c, x, style }: CtlProps) {
  const caption = String(prop(c, 'Caption') ?? '');
  return <button type="button" {...ctlAttrs(c, x)} aria-label={caption ? undefined : c.name} className="frun-button" style={style} disabled={prop(c, 'Enabled') === false}>{caption}</button>;
}

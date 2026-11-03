// Mode Page des états (L3) : ce que montre le concepteur d'état selon le mode de l'onglet. Module pur.
import { REPORT_LAYOUT_RESTRICT, type DesignerRestrict } from '../../designer/designer-restrict';
import type { DocMode } from '../../state/app-state';
import type { FlowNotice } from '../layout-flow';

/** En Page : le flux mis en page (ReportLayoutCanvas) et les gestes restreints ; en Création : la surface de création, rien de
 *  restreint (le concepteur reçoit alors exactement ce qu'il recevait avant L3). */
export function reportView(mode: DocMode): { canvas: 'flow' | 'design'; restrict: DesignerRestrict | undefined } {
  return mode === 'layout' ? { canvas: 'flow', restrict: REPORT_LAYOUT_RESTRICT } : { canvas: 'design', restrict: undefined };
}

/** La clé du bandeau du flux : les textes propres aux états (pas « ce formulaire »), la troncature commune ; une source
 *  illisible n'est pas répétée sous le bandeau d'erreur de la source, déjà affiché. */
export function layoutNoticeKey(notice: FlowNotice | null, sourceError: boolean): string | null {
  if (!notice || (notice === 'unreadable' && sourceError)) return null;
  return notice === 'truncated' ? 'layoutView.notice.truncated' : `layoutView.notice.report.${notice}`;
}

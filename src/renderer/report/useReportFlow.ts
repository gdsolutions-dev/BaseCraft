// Mode Page des états (L3) : les lignes de la source lues une fois par source (comme liveKey du mode Page des formulaires :
// ni Création ↔ Page ni une modification ne redemandent les paramètres), puis la définition courante remise en page 150 ms
// après sa dernière modification ; la mise en page précédente est annulée, un résultat périmé n'est jamais montré.
import { useEffect, useRef, useState } from 'react';
import type { DesignDoc } from '../../shared/design/model';
import type { Theme } from '../../shared/design/theme';
import type { LaidOutReport } from '../../shared/report/types';
import { usedResourceNames } from '../../shared/pictures';
import { useResources } from '../design/resources';
import { useModal } from '../shell/Modal';
import { flowKey, keptOutOfLayout, latestRun, layoutFlow, loadFlowData, type FlowData, type FlowSource } from './layout-flow';
import { onUserFunctionsChanged } from '../python/user-function-names';
import { askParameters, layoutEnv } from './ReportPreviewView';

const RELAYOUT_DELAY = 150;   // ms

/** `active` faux (autre mode) : rien n'est lu ni mis en page, la mise en page en cours est annulée. Ne rejette jamais : un
 *  échec de la mise en page donne `notice: 'layoutFailed'`. `busy` : ce qui est montré n'est pas encore celui de `doc`. */
export function useReportFlow(doc: DesignDoc, active: boolean, theme?: Theme): { flow: FlowData; busy: boolean } {
  const modal = useModal();
  const [runs] = useState(() => latestRun(RELAYOUT_DELAY));
  const key = flowKey(doc);
  const { map: resources } = useResources(usedResourceNames(doc));   // la galerie change : mise en page refaite
  const [src, setSrc] = useState<{ key: string; source: FlowSource } | null>(null);
  const [fnTick, setFnTick] = useState(0);
  useEffect(() => onUserFunctionsChanged(() => setFnTick((n) => n + 1)), []);   // D3 R5: laid out again
  const [laid, setLaid] = useState<{ doc: DesignDoc; source: FlowSource; report: LaidOutReport | null } | null>(null);

  // une lecture en cours n'est pas abandonnée en quittant le mode Page (y revenir ne redemande pas les paramètres) ; seule une
  // autre source la rend caduque. Hors du mode Page, une lecture échouée n'est pas gardée : y revenir réessaie.
  const activeNow = useRef(active);
  activeNow.current = active;
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (!active || src?.key === key || pending.current === key) return;
    pending.current = key;
    void loadFlowData(doc, askParameters(modal)).then((source) => {
      if (pending.current !== key) return;
      pending.current = null;
      const got = { key, source };
      setSrc(activeNow.current ? got : keptOutOfLayout(got));
    });
  }, [active, key]);   // eslint-disable-line react-hooks/exhaustive-deps -- `doc` n'est lu que pour sa source, qui suit key
  useEffect(() => { if (!active) setSrc(keptOutOfLayout); }, [active]);

  const source = src?.key === key ? src.source : null;
  useEffect(() => {
    if (!active || !source) return;
    runs.schedule((signal) => layoutEnv().then((env) => layoutFlow(doc, source, env, signal, theme, resources)), (report) => setLaid({ doc, source, report }));
    return runs.cancel;
  }, [active, doc, source, runs, fnTick, theme, resources]);

  const failed = laid !== null && laid.source === source && !laid.report;
  return {
    flow: { report: laid?.report ?? null, notice: failed ? 'layoutFailed' : source?.notice ?? null },
    busy: active && !(laid?.doc === doc && laid.source === source),
  };
}

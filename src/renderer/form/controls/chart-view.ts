// Données d'un graphique (F4) : la demande du canal `charts.data` et le hook qui la lit sans qu'une réponse lente n'écrase une plus récente.
import { useEffect, useRef, useState } from 'react';
import { chartRequest, type ChartData, type ChartDataRequest } from '../../../shared/chart/query';
import { api } from '../../bridge';

export { chartRequest };

export type ChartState = { data: ChartData | null };

/** La clé d'une lecture : la demande et la version (enregistrement, Requery). */
export const chartKey = (req: ChartDataRequest | null, version: number): string => (req ? `${JSON.stringify(req)}#${version}` : '');

/** Lit les données de `req` (null : aucune), de nouveau quand `version` change ; un numéro de demande écarte toute réponse devenue obsolète. */
export function useChartData(req: ChartDataRequest | null, version = 0): ChartState {
  const [state, setState] = useState<ChartState>({ data: null });
  const last = useRef(0);
  const key = chartKey(req, version);   // la version change après un enregistrement ou un Requery : on relit, l'ancien dessin reste
  useEffect(() => {
    const id = ++last.current;
    if (!req) { setState({ data: null }); return; }
    api.charts.data(req).then(
      (data) => { if (id === last.current) setState({ data }); },
      () => { if (id === last.current) setState({ data: null }); });
    return () => { last.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` est le contenu de `req`
  }, [key]);
  return state;
}

// Mode Feuille de données d'une requête (exécution) : les paramètres sont demandés d'abord, comme dans Access, puis la feuille
// de données lit la requête avec ces valeurs, gardées pour la vie de l'onglet (Actualiser, Maj+F9, les réutilise). Une requête
// action s'exécute (après confirmation) et l'onglet se ferme : elle n'a pas de feuille de données, comme dans Access.
import { useEffect, useRef, useState } from 'react';
import type { CellInput } from '../../shared/coerce';
import { localeInfo } from '../../shared/locale-format';
import { api } from '../bridge';
import { DatasheetView } from '../datasheet/DatasheetView';
import type { DocViewProps } from '../shell/DocumentTabs';
import { bcErrorCode, useErrorDialog, useModal } from '../shell/Modal';
import { runParameters } from './prompt-parameters';
import { runActionFlow } from './run-action';

/**
 * A select query: describe, the parameter prompts (Cancel closes the tab; a crosstab whose headings need them is described
 * again with them, B4 R11), a first count with the values (an error the query
 * meets when it runs shows before any grid), then the datasheet. Any bc:* error shows, then the tab closes. An action query
 * (bc:notSelectQuery) runs through runActionFlow, then the tab closes (a select query whose source became an action query:
 * runActionFlow shows bc:notSelectQuery). A save of the query's design
 * (reloadToken) starts over: the parameters may have changed. A first count that lasts shows the shell's « Exécution… »
 * with Stop (RunningNotice): it then rejects bc:cancelled, shown, and the tab closes. `sql`: the Query Builder's design, run
 * as it stands (its tab's close goes back to the design).
 */
export function QueryRunView(p: DocViewProps & { sql?: string }) {
  const modal = useModal();
  const showError = useErrorDialog();
  const [params, setParams] = useState<{ values: Record<string, CellInput>; token: number } | null>(null);
  const started = useRef<number | null>(null);
  const source = p.sql !== undefined ? { kind: 'sql' as const, sql: p.sql } : { kind: 'query' as const, name: p.tab.name }; // the live name: a rename keeps the tab

  // Again when the query's design is saved (reloadToken): its parameters may have changed, so they are asked again.
  useEffect(() => {
    const token = p.tab.reloadToken;
    if (started.current === token) return;
    started.current = token;
    setParams(null);
    // only the latest run acts: an older one (a token passed meanwhile) neither shows its rows nor closes the tab
    const close = () => { if (started.current === token) void p.dispatch({ type: 'close', id: p.tab.id }); };
    void (async () => {
      try {
        const region = localeInfo((await api.app.getSettings()).region);
        const info = await api.sources.describe(source).catch(async (e: unknown) => {
          if (bcErrorCode(e) !== 'notSelectQuery') throw e;
          await runActionFlow(source, { modal, region, showError, dispatch: p.dispatch });
          return null;
        });
        if (info === null) return close();
        const values = await runParameters(modal, info, region, (v) => api.sources.describe(source, v));
        if (values === null) return close();
        await api.sources.page(source, { offset: 0, limit: 0, params: values });
        if (started.current === token) setParams({ values, token });
      } catch (e) {
        if (started.current !== token) return;
        await showError(e);
        close();
      }
    })();
  }, [p.tab.reloadToken]);

  if (!params) return <div className="datasheet" aria-busy />;
  return <DatasheetView key={params.token} {...p} source={source} params={params.values} />;
}

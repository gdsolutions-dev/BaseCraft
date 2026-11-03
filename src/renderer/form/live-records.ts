// Mode Page (L2) : les premiers enregistrements de la source, lus une fois, et la valeur qu'un contrôle en montre. Module pur,
// hors loadLive dont l'api est injectée (le pont par défaut, chargé à la demande : les tests n'ont pas de window).
import type { BasecraftApi } from '../../shared/api';
import type { SqlValue } from '../../shared/coerce';
import type { ControlDef } from '../../shared/design/model';
import type { RecordSourceRef, SourceInfo } from '../../shared/record-source';
import type { AskParameters } from '../report/load';
import { boundField, controlTexts } from './control-values';

export const LIVE_ROWS = 25;
export type LiveNotice = 'noSource' | 'empty' | 'unreadable' | 'parameters';
export interface LiveData { info: SourceInfo; rows: SqlValue[][]; notice: LiveNotice | null }
export type LiveContent = { kind: 'text'; text: string } | { kind: 'check'; checked: boolean | null } | { kind: 'placeholder' };
export type LiveApi = Pick<BasecraftApi, 'sources'>;

const NO_INFO: SourceInfo = { fields: [], updatable: false, parameters: [] };
const none = (notice: LiveNotice, info = NO_INFO): LiveData => ({ info, rows: [], notice });

/** Les LIVE_ROWS premiers enregistrements de `ref`, paramètres demandés par `ask`. Ne rejette jamais : une erreur donne
 *  'unreadable', pas de source 'noSource', aucune ligne 'empty', des paramètres refusés 'parameters'. */
export async function loadLive(ref: RecordSourceRef | null, ask: AskParameters, api?: LiveApi): Promise<LiveData> {
  if (!ref) return none('noSource');
  try {
    const a = api ?? (await import('../bridge')).api;
    let info = await a.sources.describe(ref);
    let params;
    if (info.parameters.length) {
      params = await ask(info.parameters);
      if (!params) return none('parameters', info);
      // une analyse croisée dont les en-têtes dépendent des paramètres est redécrite avec eux (comme runParameters)
      if (info.crosstab?.headings === 'needsParameters') info = await a.sources.describe(ref, params);
    }
    const rows = (await a.sources.page(ref, { offset: 0, limit: LIVE_ROWS, ...(params && { params }) })).rows.slice(0, LIVE_ROWS);
    return { info, rows, notice: rows.length ? null : 'empty' };
  } catch {
    return none('unreadable');
  }
}

const TEXTS: ControlDef['kind'][] = ['textBox', 'comboBox', 'listBox'];
const CHECKS: ControlDef['kind'][] = ['checkBox', 'optionButton'];

/** Ce que le contrôle `c` montre de l'enregistrement `row` : la valeur liée mise en forme (Format du contrôle, sinon du champ),
 *  l'état d'une case ; tout autre contrôle garde son rendu Création. */
export function liveContent(c: ControlDef, data: LiveData, row: number, ctx: { locale: string; lang: 'fr' | 'en'; fourDigitYear?: boolean }): LiveContent {
  const src = c.props.ControlSource;
  const f = boundField(c, data.info);
  const v = f ? data.rows[row]?.[data.info.fields.indexOf(f)] ?? null : null;
  if (CHECKS.includes(c.kind)) return { kind: 'check', checked: v === null ? null : v !== 0 && v !== '0' };
  if (!TEXTS.includes(c.kind)) return { kind: 'placeholder' };
  // ponytail: un contrôle calculé garde son aperçu Création (l'expression localisée) ; évaluer avec buildCalcEnv (calc.ts) si le mode Page doit montrer le résultat
  if (typeof src === 'string' && src.startsWith('=')) return { kind: 'placeholder' };
  return { kind: 'text', text: f && v !== null ? controlTexts(c, f, v, undefined, ctx).display : '' };
}

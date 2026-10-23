// Saisie d'une expression dans le panneau des propriétés : forme affichée (langue de l'interface, région), forme
// canonique stockée. Traduite à la sortie du champ (ou Entrée) ; un texte illisible reste affiché avec son erreur.
// « … » ouvre le générateur d'expressions sur le texte affiché.
import { Ellipsis } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExprSyntaxError, type ExprErrorCode } from '../../shared/expr/ast';
import { toCanonical, toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { named, plainField, splitAlias } from '../../shared/query/qbe';
import type { BuilderContext } from './builder-model';
import { useModal } from '../shell/Modal';
import { ExpressionBuilder } from './ExpressionBuilder';

interface Props {
  id: string;
  testId: string;
  value: string | undefined; // canonical
  criteria?: boolean;
  ctx: DisplayContext;
  /** The fields the builder offers (and accepts). */
  fields: string[];
  disabled: boolean;
  error: string | undefined; // an expr.error code
  onCommit(canonical: string | undefined): void;
  onInvalid(code: ExprErrorCode | null): void;
  /** A group exists (a report, A5): aggregates are accepted and offered by the builder. Default: refused. */
  aggregates?: boolean;
  placeholder?: string;
  /** When set, a draft still pending when the field goes away (another selection, the panel closed) is committed; an unreadable
   *  one is reported here instead of being dropped. */
  onLostDraft?(code: ExprErrorCode): void;
  /** A query grid cell (A3): its parse options (aggregates allowed in Field), any name accepted (a parameter); `alias`: the
   *  Field cell's « Name: expression », the builder editing the expression only. */
  query?: BuilderContext['query'] & { aggregates?: boolean; alias?: boolean };
  /** The input's accessible name, when no <label for={id}> names it (a grid cell). */
  label?: string;
}

function shownText(value: string | undefined, ctx: DisplayContext, criteria: boolean, query: Props['query']): string {
  if (!value) return '';
  const { alias, expr } = query?.alias ? splitAlias(value) : { alias: undefined, expr: value };
  try {
    const shown = toDisplay(expr, ctx, { ...query, criteria });
    // a query's Field cell shows a field as Access does (Nom), when the bare word reads back as the same field
    const same = (s: string) => { try { return toCanonical(s, ctx, { ...query, aggregates: true }) === toCanonical(shown, ctx, { ...query, aggregates: true }); } catch { return false; } };
    return named(alias, query?.alias ? plainField(shown, same, ctx.lang) : shown);
  } catch { return value; } // unreadable stored text: shown as stored
}

export function ExpressionField({ id, testId, value, criteria = false, ctx, fields, disabled, error, onCommit, onInvalid, aggregates = false, placeholder, onLostDraft, query, label }: Props) {
  const { t } = useTranslation();
  const modal = useModal();
  const shown = useMemo(() => shownText(value, ctx, criteria, query), [value, ctx, criteria, query]);
  const [draft, setDraft] = useState<string | null>(null);
  const parts = (text: string) => (query?.alias ? splitAlias(text) : { alias: undefined, expr: text });

  /** The draft's canonical form, or the code that refuses it. */
  const read = (text: string): { canonical: string | undefined } | { code: ExprErrorCode } => {
    try {
      const { alias, expr } = parts(text);
      // aggregates only where a group exists (a report) or a query grid cell says
      return { canonical: text === '' ? undefined : named(alias?.trim(), toCanonical(expr.trim(), ctx, { ...query, criteria, aggregates: query?.aggregates ?? aggregates })) };
    } catch (e) {
      return { code: e instanceof ExprSyntaxError ? e.code : 'tooComplex' }; // RangeError: nesting too deep
    }
  };
  const commit = () => {
    const r = read((draft ?? shown).trim());
    if ('code' in r) { onInvalid(r.code); return; }
    if (r.canonical !== value) onCommit(r.canonical);
    if (error) onInvalid(null);
    setDraft(null);
    leave.current = () => {};   // committed: the field may go away before it renders again
  };
  const leave = useRef<() => void>(() => {});
  leave.current = () => {
    if (!onLostDraft || draft === null) return;
    const r = read(draft.trim());
    if ('code' in r) onLostDraft(r.code);
    else if (r.canonical !== value) onCommit(r.canonical);
  };
  useEffect(() => () => leave.current(), []);

  const build = async () => {
    const { alias, expr } = parts(draft ?? shown);
    const built = await modal.custom<string>((close) => (
      <ExpressionBuilder ctx={{ ...ctx, fields, criteria, aggregates: query?.aggregates ?? aggregates, query }} initial={expr.trim()} close={close} />
    ), { titleKey: 'builder.title' });
    if (built === null) return;
    leave.current = () => {};   // committed below: nothing left for unmount
    const canonical = built && named(alias?.trim(), built);
    if ((canonical || undefined) !== value) onCommit(canonical || undefined);
    onInvalid(null);
    setDraft(null);
  };

  return (
    <>
      <input id={id} data-testid={testId} disabled={disabled} spellCheck={false} value={draft ?? shown} aria-invalid={!!error} aria-label={label}
        placeholder={placeholder} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'F2' && e.ctrlKey && !disabled) { e.preventDefault(); void build(); } // Ctrl+F2: Access's Builder key
        }} />
      {/* a grid cell is one tab stop: its « … » is reached by Ctrl+F2 */}
      <button type="button" className="iconbtn" data-testid={`${testId}-build`} disabled={disabled} aria-label={t('builder.title')} title={t('builder.title')}
        tabIndex={query ? -1 : undefined}
        onClick={() => void build()}><Ellipsis className="ic ic-sm" aria-hidden /></button>
      {error && <div id={`${id}-error`} className="pval-error" role="alert" data-testid={`${testId}-error`}>{t(`expr.error.${error}`)}</div>}
    </>
  );
}

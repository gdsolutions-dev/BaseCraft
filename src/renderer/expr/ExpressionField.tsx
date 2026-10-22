// Saisie d'une expression dans le panneau des propriétés : forme affichée (langue de l'interface, région), forme
// canonique stockée. Traduite à la sortie du champ (ou Entrée) ; un texte illisible reste affiché avec son erreur.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExprSyntaxError, type ExprErrorCode } from '../../shared/expr/ast';
import { toCanonical, toDisplay, type DisplayContext } from '../../shared/expr/localize';

interface Props {
  id: string;
  testId: string;
  value: string | undefined; // canonical
  criteria?: boolean;
  ctx: DisplayContext;
  disabled: boolean;
  error: string | undefined; // an expr.error code
  onCommit(canonical: string | undefined): void;
  onInvalid(code: ExprErrorCode | null): void;
}

function shownText(value: string | undefined, ctx: DisplayContext, criteria: boolean): string {
  if (!value) return '';
  try { return toDisplay(value, ctx, { criteria }); } catch { return value; } // unreadable stored text: shown as stored
}

export function ExpressionField({ id, testId, value, criteria = false, ctx, disabled, error, onCommit, onInvalid }: Props) {
  const { t } = useTranslation();
  const shown = useMemo(() => shownText(value, ctx, criteria), [value, ctx, criteria]);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const text = (draft ?? shown).trim();
    try {
      const canonical = text === '' ? undefined : toCanonical(text, ctx, { criteria });
      if (canonical !== value) onCommit(canonical);
      if (error) onInvalid(null);
      setDraft(null);
    } catch (e) {
      onInvalid(e instanceof ExprSyntaxError ? e.code : 'tooComplex'); // RangeError: nesting too deep
    }
  };

  return (
    <>
      <input id={id} data-testid={testId} disabled={disabled} spellCheck={false} value={draft ?? shown} aria-invalid={!!error}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      {error && <div className="pval-error" role="alert" data-testid={`${testId}-error`}>{t(`expr.error.${error}`)}</div>}
    </>
  );
}

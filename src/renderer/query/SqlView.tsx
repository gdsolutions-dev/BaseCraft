// Mode SQL d'une requête, comme dans Access : un éditeur de texte à chasse fixe qui tient le SQL canonique (printSql), jamais
// traduit (spec 4.5). Une erreur de lecture s'affiche sous l'éditeur et sa plage est sélectionnée.
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Span } from '../../shared/expr/ast';

interface Props {
  sql: string;
  onChange(sql: string): void;
  error: { code: string; span: Span } | null;
  /** A note under the editor (only SQL view can show this query). */
  notice?: string | null;
  readOnly?: boolean;
}

export function SqlView({ sql, onChange, error, notice, readOnly }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const errorId = useId(); // tabs stay mounted: one id per view
  // a new error selects its range, as Access selects the faulty word
  useEffect(() => {
    const el = ref.current;
    if (!el || !error) return;
    el.focus();
    el.setSelectionRange(error.span.start, Math.max(error.span.start, error.span.end));
  }, [error]);
  return (
    <div className="qd-sql">
      <textarea ref={ref} data-testid="query-sql" className="qd-sql-text" spellCheck={false} value={sql} readOnly={readOnly}
        aria-label={t('ribbon.cmd.viewSql')} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)} />
      {error && (
        <p id={errorId} className="modal-error" role="alert" data-testid="query-sql-error">
          {t([`query.error.${error.code}`, `expr.error.${error.code}`])}
        </p>
      )}
      {notice && <p className="muted" data-testid="query-sql-notice">{notice}</p>}
    </div>
  );
}

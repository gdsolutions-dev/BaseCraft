// Barre de navigation des enregistrements (bas de la feuille) : premier, précédent, numéro, suivant, dernier, nouveau.
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Plus, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  /** 0-based row of the current record (count = the new record), null when nothing is selected. */
  current: number | null;
  count: number;
  canAdd: boolean;
  onGo(row: number): void;
  onNew(): void;
}

export function NavigationBar({ current, count, canAdd, onGo, onNew }: Props) {
  const { t } = useTranslation();
  const shown = current === null ? '' : String(current + 1);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const go = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 1 && count > 0) onGo(Math.min(n, count) - 1);
    else setDraft(shown);
  };
  const btn = (key: string, Icon: LucideIcon, row: number | null, testid?: string) => (
    <button className="iconbtn" aria-label={t(`datasheet.nav.${key}`)} title={t(`datasheet.nav.${key}`)} data-testid={testid}
      disabled={row === null || row === current} onClick={() => row !== null && onGo(row)}>
      <Icon className="ic" aria-hidden />
    </button>
  );
  const last = count > 0 ? count - 1 : null;
  return (
    <div className="recnav" role="group" aria-label={t('datasheet.nav.region')}>
      <span className="lbl" aria-hidden>{t('datasheet.nav.label')}</span>
      {btn('first', ChevronFirst, last === null ? null : 0)}
      {btn('prev', ChevronLeft, current !== null && current > 0 ? Math.min(current, count) - 1 : null)}
      <span className="recpos">
        <input data-testid="nav-record-input" aria-label={t('datasheet.nav.current')} inputMode="numeric" value={draft}
          onChange={(e) => setDraft(e.target.value)} onBlur={() => setDraft(shown)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); go(); }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(shown); }
          }} />
        <span>{t('datasheet.nav.of')}&nbsp;<span data-testid="nav-record-count">{count}</span></span>
      </span>
      {btn('next', ChevronRight, current === null ? (last === null ? null : 0) : current + 1 < count ? current + 1 : null)}
      {btn('last', ChevronLast, last)}
      <button className="iconbtn" aria-label={t('datasheet.nav.new')} title={t('datasheet.nav.new')} data-testid="nav-new" disabled={!canAdd} onClick={onNew}>
        <Plus className="ic" aria-hidden />
      </button>
      <span className="sr-only" role="status">
        {current === null ? '' : current >= count ? t('datasheet.nav.positionNew') : t('datasheet.nav.position', { current: current + 1, count })}
      </span>
    </div>
  );
}

// Mode Page (L2) : la barre des enregistrements lus (premier, précédent, « n / N », suivant, dernier). Elle ne change que
// l'enregistrement montré par le concepteur : aucune écriture.
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../datasheet/datasheet.css';

export function LayoutRecordBar({ row, count, onGo }: { row: number; count: number; onGo(row: number): void }) {
  const { t } = useTranslation();
  const btn = (key: string, id: string, Icon: LucideIcon, to: number) => (
    <button className="iconbtn" aria-label={t(`datasheet.nav.${key}`)} title={t(`datasheet.nav.${key}`)} data-testid={`layout-record-${id}`}
      disabled={to < 0 || to >= count || to === row} onClick={() => onGo(to)}>
      <Icon className="ic" aria-hidden />
    </button>
  );
  const current = count ? row + 1 : 0;
  return (
    <div className="recnav" role="group" aria-label={t('datasheet.nav.region')} data-testid="layout-record-bar">
      <span className="lbl" aria-hidden>{t('datasheet.nav.label')}</span>
      {btn('first', 'first', ChevronFirst, 0)}
      {btn('prev', 'prev', ChevronLeft, row - 1)}
      <span className="recpos" data-testid="layout-record-pos" title={t('datasheet.nav.position', { current, count })}>{current} / {count}</span>
      {btn('next', 'next', ChevronRight, row + 1)}
      {btn('last', 'last', ChevronLast, count - 1)}
    </div>
  );
}

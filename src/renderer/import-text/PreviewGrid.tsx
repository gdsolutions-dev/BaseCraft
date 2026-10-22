// Aperçu des enregistrements en colonnes (police à chasse fixe) ; colonnes sélectionnables à l'étape des champs.
import { useTranslation } from 'react-i18next';

interface Props {
  headings: string[];
  rows: string[][];
  selected?: number;
  onSelect?: (col: number) => void;
  dimmed?: boolean[]; // colonnes sautées
}

export function PreviewGrid({ headings, rows, selected, onSelect, dimmed }: Props) {
  const { t } = useTranslation();
  const cls = (i: number) => [i === selected ? 'is-sel' : '', dimmed?.[i] ? 'is-dim' : ''].join(' ').trim() || undefined;
  return (
    <div className="iw-grid-wrap">
      <table className="iw-grid" data-testid="import-preview" aria-label={t('importText.previewGrid')}>
        <thead>
          <tr>
            <th className="iw-rownum" aria-hidden />
            {headings.map((h, i) => (
              <th key={i} className={cls(i)} scope="col">
                {onSelect ? (
                  <button type="button" data-testid={`import-col-${i}`} aria-pressed={i === selected} onClick={() => onSelect(i)}>{h}</button>
                ) : <span data-testid={`import-col-${i}`}>{h}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => (
            <tr key={n}>
              <td className="iw-rownum">{n + 1}</td>
              {headings.map((_h, i) => (
                <td key={i} className={cls(i)} onClick={onSelect ? () => onSelect(i) : undefined}>{r[i] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

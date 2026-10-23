// Boîte Paramètres de la requête, comme dans Access : une grille Paramètre / Type de données (une ligne vide en fin pour en
// ajouter). Un nom vide ou en double est refusé dans la boîte ; OK rend les déclarations (clause PARAMETERS).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sameName } from '../../shared/field-types';
import type { ParamDecl } from '../../shared/query/ast';
import { PARAMETER_TYPES } from '../../shared/query/sql-parser';

/** The Data Type choices: the PARAMETERS types, numbers by size. */
const TYPES = PARAMETER_TYPES.map(([type, size]) => ({ key: size ? `${type}:${size}` : type, type, size }));
const keyOf = (p: ParamDecl): string => (p.type === 'number' ? `number:${p.numberSize ?? 'longInteger'}` : p.type);
interface Row { name: string; type: string }

export function ParametersDialog({ params, onClose }: { params: ParamDecl[]; onClose(v: ParamDecl[] | null): void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>(() => [...params.map((p) => ({ name: p.name, type: keyOf(p) })), { name: '', type: 'shortText' }]);
  const [error, setError] = useState<string | null>(null);
  const label = (k: (typeof TYPES)[number]) => (k.size ? t(`fieldProp.numberSizes.${k.size}`) : t(`fieldType.${k.type}`));
  const edit = (i: number, patch: Partial<Row>) => {
    setError(null);
    setRows((rs) => {
      const next = rs.map((r, j) => (j === i ? { ...r, ...patch } : r));
      return next[next.length - 1].name.trim() ? [...next, { name: '', type: 'shortText' }] : next; // a spare row, as in Access
    });
  };
  const ok = () => {
    const used = rows.filter((r, i) => r.name.trim() || (i < rows.length - 1 && r.type !== 'shortText'));
    const out: ParamDecl[] = [];
    for (const r of used) {
      const name = r.name.trim();
      if (!name) return setError(t('query.params.emptyName'));
      if (out.some((p) => sameName(p.name, name))) return setError(t('query.params.duplicate', { name }));
      const k = TYPES.find((x) => x.key === r.type)!;
      out.push({ name, type: k.type, ...(k.size && { numberSize: k.size }) });
    }
    onClose(out);
  };
  return (
    <div data-testid="query-params" className="query-params">
      <table className="qp-grid">
        <thead><tr><th scope="col">{t('query.params.name')}</th><th scope="col">{t('query.params.type')}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input data-testid={`query-params-name-${i}`} aria-label={`${t('query.params.name')} ${i + 1}`} value={r.name}
                  spellCheck={false} onChange={(e) => edit(i, { name: e.target.value })} />
              </td>
              <td>
                <select data-testid={`query-params-type-${i}`} aria-label={`${t('query.params.type')} ${i + 1}`} value={r.type}
                  onChange={(e) => edit(i, { type: e.target.value })}>
                  {TYPES.map((k) => <option key={k.key} value={k.key}>{label(k)}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="modal-error" role="alert" data-testid="query-params-error">{error}</p>}
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="query-params-ok" onClick={ok}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="query-params-cancel" onClick={() => onClose(null)}>{t('dialog.button.cancel')}</button>
      </div>
    </div>
  );
}

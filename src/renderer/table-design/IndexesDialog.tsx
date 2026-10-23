// Boîte de dialogue Index du mode Création, comme dans Access : une ligne par index (nom, champs avec leur ordre de tri,
// Primaire, Unique). Elle modifie la conception ouverte ; l'enregistrement de la table applique les index.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TableDesign } from '../../shared/field-types';
import type { ModalApi } from '../shell/Modal';
import { applyIndexRows, indexRows, indexRowsError, type IndexRow } from './indexes-model';

export function editIndexes(modal: ModalApi, d: TableDesign, readOnly: boolean): Promise<TableDesign | null> {
  return modal.custom<TableDesign>((close) => <IndexesDialog design={d} readOnly={readOnly} onClose={close} />, { titleKey: 'indexes.title' });
}

function IndexesDialog({ design, readOnly, onClose }: { design: TableDesign; readOnly: boolean; onClose(v: TableDesign | null): void }) {
  const { t } = useTranslation();
  const fields = design.fields.map((x) => x.name).filter(Boolean);
  const [rows, setRows] = useState<IndexRow[]>(() => indexRows(design));
  const [error, setError] = useState<string | null>(null);
  const edit = (i: number, fn: (r: IndexRow) => IndexRow) => { setError(null); setRows((rs) => rs.map((r, k) => (k === i ? fn(r) : r))); };
  const editField = (i: number, j: number, patch: Partial<IndexRow['fields'][number]>) =>
    edit(i, (r) => ({ ...r, fields: r.fields.map((x, k) => (k === j ? { ...x, ...patch } : x)) }));
  const ok = () => {
    const err = indexRowsError(rows, fields);
    if (err) setError(t(err));
    else onClose(applyIndexRows(design, rows));
  };
  return (
    <div data-testid="indexes-dialog" className="indexes-dialog">
      <table className="idx-grid">
        <thead>
          <tr>
            <th scope="col">{t('indexes.indexName')}</th><th scope="col">{t('indexes.fieldName')}</th><th scope="col">{t('indexes.sortOrder')}</th>
            <th scope="col">{t('indexes.primary')}</th><th scope="col">{t('indexes.unique')}</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => r.fields.concat(r.fields.length ? [] : [{ name: '', desc: false }]).map((x, j) => (
            <tr key={`${i}-${j}`} className={j === 0 ? 'idx-first' : undefined}>
              <td>{j === 0 && <input data-testid={`idx-name-${i}`} aria-label={`${t('indexes.indexName')} ${i + 1}`} value={r.name} disabled={readOnly}
                spellCheck={false} onChange={(e) => edit(i, (y) => ({ ...y, name: e.target.value }))} />}</td>
              <td className="idx-field">
                <select data-testid={`idx-field-${i}-${j}`} aria-label={`${t('indexes.fieldName')} ${i + 1}.${j + 1}`} value={x.name} disabled={readOnly}
                  onChange={(e) => (r.fields.length ? editField(i, j, { name: e.target.value }) : edit(i, (y) => ({ ...y, fields: [{ name: e.target.value, desc: false }] })))}>
                  {!x.name && <option value="" />}
                  {fields.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                {r.fields.length > 0 && <button className="btn" data-testid={`idx-remove-field-${i}-${j}`} title={t('indexes.removeField')} aria-label={t('indexes.removeField')}
                  disabled={readOnly} onClick={() => edit(i, (y) => ({ ...y, fields: y.fields.filter((_, k) => k !== j) }))}>−</button>}
              </td>
              <td>
                <select data-testid={`idx-dir-${i}-${j}`} aria-label={`${t('indexes.sortOrder')} ${i + 1}.${j + 1}`} value={x.desc ? 'desc' : 'asc'}
                  disabled={readOnly || !r.fields.length} onChange={(e) => editField(i, j, { desc: e.target.value === 'desc' })}>
                  <option value="asc">{t('indexes.ascending')}</option><option value="desc">{t('indexes.descending')}</option>
                </select>
              </td>
              <td>{j === 0 && <input type="checkbox" data-testid={`idx-primary-${i}`} aria-label={`${t('indexes.primary')} ${i + 1}`} checked={r.primary}
                disabled={readOnly} onChange={(e) => edit(i, (y) => ({ ...y, primary: e.target.checked, unique: e.target.checked || y.unique }))} />}</td>
              <td>{j === 0 && <input type="checkbox" data-testid={`idx-unique-${i}`} aria-label={`${t('indexes.unique')} ${i + 1}`} checked={r.unique || r.primary}
                disabled={readOnly || r.primary} onChange={(e) => edit(i, (y) => ({ ...y, unique: e.target.checked }))} />}</td>
              <td>{j === 0 && <>
                <button className="btn" data-testid={`idx-add-field-${i}`} disabled={readOnly || !r.fields.length}
                  onClick={() => edit(i, (y) => ({ ...y, fields: [...y.fields, { name: fields.find((n) => !y.fields.some((z) => z.name === n)) ?? fields[0]!, desc: false }] }))}>
                  {t('indexes.addField')}
                </button>
                <button className="btn" data-testid={`idx-remove-${i}`} disabled={readOnly}
                  onClick={() => { setError(null); setRows((rs) => rs.filter((_, k) => k !== i)); }}>{t('indexes.removeIndex')}</button>
              </>}</td>
            </tr>
          )))}
        </tbody>
      </table>
      {!readOnly && <button className="btn" data-testid="idx-add" onClick={() => { setError(null); setRows((rs) => [...rs, { name: '', fields: [], primary: false, unique: false }]); }}>
        {t('indexes.addIndex')}
      </button>}
      {error && <p className="modal-error" role="alert" data-testid="indexes-error">{error}</p>}
      <div className="modal-buttons">
        {!readOnly && <button className="btn btn-primary" data-testid="indexes-ok" onClick={ok}>{t('dialog.button.ok')}</button>}
        <button className="btn" data-testid="indexes-cancel" onClick={() => onClose(null)}>{t(readOnly ? 'dialog.button.ok' : 'dialog.button.cancel')}</button>
      </div>
    </div>
  );
}

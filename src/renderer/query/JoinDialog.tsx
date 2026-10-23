// « Propriétés de la jointure », comme dans Access : les deux tables et colonnes, et les trois façons de joindre.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { JoinKind } from '../../shared/query/ast';
import type { QbeJoin } from '../../shared/query/qbe';
import { Frame } from '../relations/RelationDialog';

export function JoinDialog({ join, onOk, onCancel }: { join: QbeJoin; onOk(kind: JoinKind): void; onCancel(): void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<JoinKind>(join.kind);
  const names = { l: join.l, r: join.r };
  const shown = (labelKey: string, value: string) => (
    <label className="rel-dialog-table"><span>{t(labelKey)}</span><input value={value} readOnly /></label>
  );
  return (
    <Frame titleKey="query.joinDialog.title" testId="join-dialog" onCancel={onCancel}>
      <div className="rel-dialog-tables">
        {shown('query.joinDialog.leftTable', join.l)}{shown('query.joinDialog.rightTable', join.r)}
        {shown('query.joinDialog.leftColumn', join.lField)}{shown('query.joinDialog.rightColumn', join.rField)}
      </div>
      <fieldset className="rel-dialog-join">
        <legend>{t('query.joinDialog.kind')}</legend>
        {(['inner', 'left', 'right'] as const).map((k) => (
          <label key={k}>
            <input type="radio" name="join-kind" data-testid={`join-kind-${k}`} checked={kind === k} onChange={() => setKind(k)} />
            {t(`query.joinDialog.${k}`, names)}
          </label>
        ))}
      </fieldset>
      <div className="modal-buttons">
        <button className="btn btn-primary" data-testid="join-ok" onClick={() => onOk(kind)}>{t('dialog.button.ok')}</button>
        <button className="btn" data-testid="join-cancel" onClick={onCancel}>{t('dialog.button.cancel')}</button>
      </div>
    </Frame>
  );
}

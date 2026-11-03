// Property update options (O4 R12): the question after a table save that changed a field's Format or Decimal Places, one
// checkbox per bound control carrying its own value. Answers the ticked targets, or null (No, Escape).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PropertyUpdate } from '../../shared/api';

export function PropertyUpdateDialog({ update, onClose }: { update: PropertyUpdate; onClose(v: PropertyUpdate['targets'] | null): void }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(() => update.targets.map(() => true));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onClose(update.targets.filter((_, i) => on[i])); }}>
      <p data-testid="property-update-message">{t('propertyUpdate.message', { prop: t(`prop.${update.prop}`), field: update.field })}</p>
      <fieldset className="modal-field">
        {update.targets.map((x, i) => (
          <label key={`${x.kind}|${x.name}|${x.control}`}>
            <input type="checkbox" data-testid={`property-update-target-${i}`} checked={on[i]} onChange={() => setOn(on.map((v, j) => (j === i ? !v : v)))} />
            {t('propertyUpdate.target', { kind: t(`autoCorrect.kind.${x.kind}`), name: x.name, control: x.control, current: update.prop === 'Format' ? t(`format.${x.current}`, { defaultValue: x.current }) : x.current })}
          </label>
        ))}
      </fieldset>
      <div className="modal-buttons">
        <button type="submit" className="btn btn-primary" data-testid="property-update-yes" autoFocus>{t('dialog.button.yes')}</button>
        <button type="button" className="btn" data-testid="property-update-no" onClick={() => onClose(null)}>{t('dialog.button.no')}</button>
      </div>
    </form>
  );
}

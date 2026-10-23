// Feuille de propriétés de la table (Création de tableau, à droite ; ruban ou F4) : Description, Valide si (règle
// d'enregistrement, avec le générateur), Message si erreur.
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { BuilderContext } from '../expr/builder-model';
import { ExpressionField } from '../expr/ExpressionField';
import { TABLE_KEY, type DesignAction, type DesignModel } from './design-model';

export function TablePropertiesPanel({ model, disabled, dispatch, ctx }: { model: DesignModel; disabled: boolean; dispatch: (a: DesignAction) => void; ctx: BuilderContext }) {
  const { t } = useTranslation();
  const uid = useId();
  const set = (name: 'description' | 'validationRule' | 'validationText', value: string | undefined) => dispatch({ type: 'setTableProp', name, value });
  const row = (key: string, label: string, el: JSX.Element) => (
    <div className="prow"><label htmlFor={uid + key}>{label}</label><div className="pval">{el}</div></div>
  );
  return (
    <section className="tprops" data-testid="table-properties" aria-label={t('designer.tableProperties')}>
      <div className="fprops-head">{t('designer.tableProperties')}</div>
      <div className="plist">
        {row('description', t('designer.tableDescription'), (
          <input id={uid + 'description'} data-testid="table-prop-description" disabled={disabled} value={model.description}
            onChange={(e) => set('description', e.target.value)} />
        ))}
        {row('validationRule', t('fieldProp.validationRule'), (
          // Any field of the table, never another table (validateDesign); a full expression, not a criterion.
          <ExpressionField id={uid + 'validationRule'} testId="table-prop-validationRule" value={model.validationRule} ctx={ctx} fields={ctx.fields}
            disabled={disabled} error={model.invalid[`${TABLE_KEY}:validationRule`]} onCommit={(v) => set('validationRule', v)}
            onInvalid={(code) => dispatch({ type: 'setInvalid', index: -1, key: 'validationRule', code })} />
        ))}
        {row('validationText', t('fieldProp.validationText'), (
          <input id={uid + 'validationText'} data-testid="table-prop-validationText" disabled={disabled} maxLength={255} value={model.validationText ?? ''}
            onChange={(e) => set('validationText', e.target.value)} />
        ))}
      </div>
    </section>
  );
}

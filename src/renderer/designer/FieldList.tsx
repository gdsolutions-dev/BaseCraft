// Liste des champs (générique : formulaires A4, états A5) : les champs de la source, chacun glissé vers une section, ou ajouté par
// double-clic, Entrée ou Espace. L'hôte décide de ce que `onAdd` crée (en général boundControlWithLabel, field-controls.ts) ; la surface
// reçoit le dépôt par `fieldDrop`.
import { useTranslation } from 'react-i18next';
import type { SourceField } from '../../shared/record-source';

type At = { section: number; left: number; top: number };
// ponytail: un seul glisser à la fois et un seul concepteur visible (l'onglet actif) : un état de module suffit ; un contexte React
// par concepteur s'il fallait un jour en montrer deux côte à côte.
let dragging: { f: SourceField; onAdd(f: SourceField, at?: At): void } | null = null;

/** Pour la surface : le champ en cours de glisser depuis une Liste des champs, et ce qui l'ajoute à l'endroit du dépôt. */
export const fieldDrop = (): ((at: At) => void) | null => {
  const d = dragging;
  return d ? (at) => d.onAdd(d.f, at) : null;
};

export function FieldList(p: { fields: SourceField[]; readOnly: boolean; onAdd(f: SourceField, at?: At): void }) {
  const { t } = useTranslation();
  return (
    <section className="dz-fields" aria-label={t('designer.fieldList')} data-testid="field-list">
      <div className="dz-props-head">{t('designer.fieldList')}</div>
      <ul className="dz-fields-list">
        {p.fields.map((f) => (
          <li key={f.name} draggable={!p.readOnly}
            onDragStart={(e) => { dragging = { f, onAdd: p.onAdd }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', f.name); }}
            onDragEnd={() => { dragging = null; }}>
            {/* un clic de souris sélectionne seulement (detail 1) ; Entrée ou Espace (detail 0) et le double-clic ajoutent, comme Access */}
            <button type="button" data-testid={`field-${f.name}`} disabled={p.readOnly}
              onClick={(e) => { if (e.detail === 0) p.onAdd(f); }} onDoubleClick={() => p.onAdd(f)}>{f.name}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

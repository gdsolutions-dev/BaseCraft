// Le volet Catalogue d'actions, comme Access : une recherche (sans accents ni casse), le Déroulement de programme (les blocs),
// puis les actions par catégorie (les actions non sûres seulement avec Afficher toutes les actions). Un double-clic ou Entrée
// ajoute l'élément après la sélection, sinon à la fin du corps de la macro.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { foldKey } from '../shell/nav-menu';
import { BLOCKS, newItem } from './ActionBlock';
import { addPoint, addableActions, type MacroEditAction, type MacroEditState } from './macro-edit';

export function ActionCatalog({ state, send, readOnly }: { state: MacroEditState; send(a: MacroEditAction): void; readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const match = (label: string) => foldKey(label).includes(foldKey(search.trim()));
  const flow = BLOCKS.map((b) => ({ id: `block-${b}`, label: t(`macro.block.${b}`) })).filter((x) => match(x.label));
  const byCategory = new Map<string, { id: string; label: string }[]>();
  for (const a of addableActions(state.showAll)) {
    const label = t(`macro.action.${a.name}`);
    if (match(label)) byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), { id: a.name, label }]);
  }
  const sections = [...byCategory].map(([cat, items]) => ({ id: cat, title: t(`macro.category.${cat}`), items }))
    .sort((a, b) => a.title.localeCompare(b.title, i18n.language));
  if (flow.length) sections.unshift({ id: 'flow', title: t('macro.catalog.flow'), items: flow });

  const add = (id: string) => { if (!readOnly) send({ type: 'add', at: addPoint(state), item: newItem(id, state.def, t) }); };
  return (
    <aside className="macro-catalog" data-testid="macro-catalog" aria-label={t('macro.catalog.title')}>
      <div className="macro-catalog-title">{t('macro.catalog.title')}</div>
      <input type="search" data-testid="macro-catalog-search" aria-label={t('macro.catalog.search')} placeholder={t('macro.catalog.search')}
        spellCheck={false} value={search} onChange={(e) => setSearch(e.target.value)} />
      {sections.map((sec) => (
        <section key={sec.id} data-testid={`macro-catalog-${sec.id}`}>
          <h3>{sec.title}</h3>
          <ul>
            {sec.items.map((x) => (
              <li key={x.id} tabIndex={0} data-testid={`macro-catalog-item-${x.id}`} aria-disabled={readOnly || undefined}
                onDoubleClick={() => add(x.id)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(x.id); } }}>{x.label}</li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

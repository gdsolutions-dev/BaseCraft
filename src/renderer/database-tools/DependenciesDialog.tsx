// Object Dependencies (K2): « Objects that depend on me » and « Objects that I depend on » for the Navigation Pane's selection, each a
// button that closes the dialog and opens the object in Design view. ponytail: a dialog, not a docked pane; computed when it opens.
import { useTranslation } from 'react-i18next';
import { api } from '../bridge';
import type { ModalApi } from '../shell/Modal';
import { dependencies, type DepKind, type DepObject, type DepRef } from './dependencies';
import './database-tools.css';

const KINDS: string[] = ['table', 'query', 'form', 'report', 'macro'];

/** Resolves with the object picked; null: closed. */
export async function pickDependency(modal: ModalApi, sel: { kind: string; name: string } | null | undefined): Promise<DepRef | null> {
  if (!sel || !KINDS.includes(sel.kind)) {
    await modal.confirm({ titleKey: 'ribbon.cmd.objectDependencies', messageKey: 'dbtools.depsNoSelection', buttons: ['ok'] });
    return null;
  }
  const [tables, list] = await Promise.all([api.tables.list(), api.objects.list()]);
  const objects: DepObject[] = await Promise.all(list.filter((o) => o.kind !== 'module').map(async (o) =>
    ({ kind: o.kind as DepObject['kind'], name: o.name, definition: await api.objects.get(o.kind, o.name).then((x) => x.definition, () => null) })));
  const deps = dependencies({ tables: tables.map((x) => x.name), objects }, { kind: sel.kind as DepKind, name: sel.name });
  return modal.custom<DepRef>((close) => <DependenciesView target={sel} deps={deps} onPick={close} />, { titleKey: 'ribbon.cmd.objectDependencies' });
}

function DependenciesView({ target, deps, onPick }: { target: { kind: string; name: string }; deps: ReturnType<typeof dependencies>; onPick(r: DepRef | null): void }) {
  const { t } = useTranslation();
  const list = (title: string, refs: DepRef[], id: string) => (
    <section>
      <h3>{title}</h3>
      {refs.length ? (
        <ul className="dbt-list" data-testid={id}>
          {refs.map((r) => (
            <li key={`${r.kind}|${r.name}`}>
              <button type="button" className="btn" data-testid={`dep-${r.kind}-${r.name}`} onClick={() => onPick(r)}>{r.name}</button>
              <small className="muted">{t(`tabs.kind.${r.kind}`)}</small>
            </li>
          ))}
        </ul>
      ) : <p className="muted" data-testid={id}>{t('dbtools.depsNone')}</p>}
    </section>
  );
  return (
    <div className="dbt" data-testid="dependencies-dialog">
      <p>{t(`tabs.kind.${target.kind}`)} <strong>{target.name}</strong></p>
      <div className="dbt-cols">
        {list(t('dbtools.depsOnMe'), deps.dependsOnMe, 'deps-on-me')}
        {list(t('dbtools.depsIDependOn'), deps.iDependOn, 'deps-i-depend-on')}
      </div>
      <p className="muted">{t('dbtools.depsHint')}</p>
      <div className="modal-buttons"><button type="button" className="btn" data-testid="deps-close" onClick={() => onPick(null)}>{t('dbtools.close')}</button></div>
    </div>
  );
}

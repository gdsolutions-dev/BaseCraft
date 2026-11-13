// Analyze Performance (K4): the suggestions of analyzePerformance, each with a reason; an index suggestion has Optimize, which adds
// the index through the table save path (as the Indexes dialog does). ponytail: the analysis is shown again after each Optimize
// (a save may ask questions, and a dialog cannot open over this one); a missing primary key is informational.
import { useTranslation } from 'react-i18next';
import { sameName } from '../../shared/field-types';
import { api } from '../bridge';
import { errorMessage, type ModalApi } from '../shell/Modal';
import type { AppAction, DocTab } from '../state/app-state';
import { fromDesign, toSaveRequest } from '../table-design/design-model';
import { applyIndexRows, indexRows } from '../table-design/indexes-model';
import { saveTableInteractive } from '../table-design/save-table';
import { analyzePerformance, type Suggestion } from './performance';
import './database-tools.css';

async function analysis() {
  const [tables, relations, list] = await Promise.all([api.tables.list(), api.relations.list({ localOnly: true }), api.objects.list('query')]);
  const designs = await Promise.all(tables.filter((x) => !x.link).map((x) => api.tables.design(x.name)));
  const queries = (await Promise.all(list.map(async (q) => {
    const def = (await api.objects.get('query', q.name).catch(() => null))?.definition as { formatVersion?: unknown; sql?: unknown } | null;
    return def && typeof def.sql === 'string' && !/^2\./.test(String(def.formatVersion)) ? [{ name: q.name, sql: def.sql }] : [];   // a pass-through is server SQL
  }))).flat();
  return analyzePerformance({ tables: designs, relations: relations.filter((r) => !r.linked), queries });
}

/** An ascending index on `field`, saved with the table's design. */
async function createIndex(modal: ModalApi, tabs: () => DocTab[], dispatch: (a: AppAction) => void, table: string, field: string): Promise<void> {
  const d = await api.tables.design(table);
  const rows = indexRows(d);
  const name = rows.some((r) => sameName(r.name, field)) ? `${field}_idx` : field;
  const next = applyIndexRows(d, [...rows, { name, fields: [{ name: field, desc: false }], primary: false, unique: false }]);
  await saveTableInteractive(modal, tabs(), dispatch, toSaveRequest(fromDesign(next), table, false));
}

export async function analyzePerformanceDialog(modal: ModalApi, tabs: () => DocTab[], dispatch: (a: AppAction) => void): Promise<void> {
  try {
    for (;;) {
      const list = await analysis();
      const pick = await modal.custom<Suggestion>((close) => <PerformanceView list={list} onClose={close} />, { titleKey: 'ribbon.cmd.analyzePerformance' });
      if (!pick || pick.kind === 'noPrimaryKey') return;
      await createIndex(modal, tabs, dispatch, pick.table, pick.field);
    }
  } catch (e) {
    const m = errorMessage(e);
    await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: m.key, params: m.params, buttons: ['ok'] });
  }
}

function PerformanceView({ list, onClose }: { list: Suggestion[]; onClose(v: Suggestion | null): void }) {
  const { t } = useTranslation();
  const text = (s: Suggestion) => (s.kind === 'noPrimaryKey' ? t('dbtools.perfNoKey', { table: s.table })
    : s.kind === 'relationIndex' ? t('dbtools.perfRelation', { table: s.table, field: s.field, relation: s.relation })
      : t('dbtools.perfQuery', { table: s.table, field: s.field, query: s.query }));
  return (
    <div className="dbt" data-testid="performance-dialog">
      {list.length ? (
        <ul className="dbt-list" data-testid="performance-list">
          {list.map((s, i) => (
            <li key={i} data-testid={`perf-${s.kind}`}>
              <span style={{ flex: 1 }}>{text(s)}</span>
              {s.kind !== 'noPrimaryKey' && <button type="button" className="btn" data-testid={`perf-optimize-${s.table}-${s.field}`} onClick={() => onClose(s)}>{t('dbtools.perfOptimize')}</button>}
            </li>
          ))}
        </ul>
      ) : <p data-testid="performance-list">{t('dbtools.perfNone')}</p>}
      <div className="modal-buttons"><button type="button" className="btn" data-testid="perf-close" onClick={() => onClose(null)}>{t('dbtools.close')}</button></div>
    </div>
  );
}

// Registre type de document + mode → vue. Chaque lot inscrit ses vues ici par registerDocumentView ; sans vue, « non disponible ».
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { DatasheetView } from '../datasheet/DatasheetView';
import { FormDesignView } from '../form/FormDesignView';
import { FormRunView } from '../form/FormRunView';
import type { DocTab } from '../state/app-state';
import { QueryRunView } from '../query/QueryRunView';
import { QueryDesignView } from '../query/QueryDesignView';
import { RelationsView } from '../relations/RelationsView';
import { TableDesignView } from '../table-design/TableDesignView';
import type { DocViewProps } from './DocumentTabs';
import { ReportPreviewView } from '../report/ReportPreviewView';
import { ReportDesignView } from '../report/design/ReportDesignView';

type ViewMode = 'design' | 'run';
const views = new Map<string, ComponentType<DocViewProps>>();

/** A table's Datasheet is its Run view. */
export function registerDocumentView(kind: DocTab['kind'], mode: ViewMode, view: ComponentType<DocViewProps>): void {
  views.set(`${kind}:${mode}`, view);
}

/** A view is registered for `kind` in `mode` (the Navigation Pane's generic Open and Design View are enabled only then). */
export function hasDocumentView(kind: DocTab['kind'], mode: ViewMode): boolean { return views.has(`${kind}:${mode}`); }

registerDocumentView('table', 'design', TableDesignView);
registerDocumentView('table', 'run', DatasheetView);
registerDocumentView('relations', 'run', RelationsView);
registerDocumentView('form', 'design', FormDesignView);
registerDocumentView('form', 'run', FormRunView);
registerDocumentView('query', 'run', QueryRunView);
registerDocumentView('query', 'design', QueryDesignView);

export function UnavailableView() {
  const { t } = useTranslation();
  return <div className="doc-empty muted" data-testid="doc-unavailable">{t('doc.unavailable')}</div>;
}

export function DocumentView(p: DocViewProps) {
  const mode: ViewMode = p.tab.mode === 'design' ? 'design' : 'run';
  const View = views.get(`${p.tab.kind}:${mode}`) ?? UnavailableView;
  return <View {...p} />;
}

registerDocumentView('report', 'run', ReportPreviewView);
registerDocumentView('report', 'design', ReportDesignView);

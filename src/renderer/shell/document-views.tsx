// Registre type de document + mode → vue. Chaque lot inscrit ses vues ici par registerDocumentView ; sans vue, « non disponible ».
// Les vues des concepteurs (et la fenêtre Relations) s'inscrivent depuis design/entry.ts : absentes de BaseCraft Runtime (B5).
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { DatasheetView } from '../datasheet/DatasheetView';
import { FormRunView } from '../form/FormRunView';
import type { DocTab } from '../state/app-state';
import { QueryRunView } from '../query/QueryRunView';
import type { DocViewProps } from './DocumentTabs';
import { ReportPreviewView } from '../report/ReportPreviewView';

type ViewMode = 'design' | 'run';
// `var`, créé au premier usage : design/entry.ts inscrit ses vues par un cycle d'imports (ce module → DatasheetView → design/entry)
// qui peut l'évaluer avant le corps de ce module ; un `const` serait alors encore inaccessible (TDZ), quel que soit l'ordre des imports.
var views: Map<string, ComponentType<DocViewProps>> | undefined;

/** A table's Datasheet is its Run view. */
export function registerDocumentView(kind: DocTab['kind'], mode: ViewMode, view: ComponentType<DocViewProps>): void {
  (views ??= new Map()).set(`${kind}:${mode}`, view);
}

/** A view is registered for `kind` in `mode` (the Navigation Pane's generic Open and Design View are enabled only then). */
export function hasDocumentView(kind: DocTab['kind'], mode: ViewMode): boolean { return !!views?.has(`${kind}:${mode}`); }

registerDocumentView('table', 'run', DatasheetView);
registerDocumentView('form', 'run', FormRunView);
registerDocumentView('query', 'run', QueryRunView);

export function UnavailableView() {
  const { t } = useTranslation();
  return <div className="doc-empty muted" data-testid="doc-unavailable">{t('doc.unavailable')}</div>;
}

export function DocumentView(p: DocViewProps) {
  const mode: ViewMode = p.tab.mode === 'design' ? 'design' : 'run';
  const View = views?.get(`${p.tab.kind}:${mode}`) ?? UnavailableView;
  return <View {...p} />;
}

registerDocumentView('report', 'run', ReportPreviewView);

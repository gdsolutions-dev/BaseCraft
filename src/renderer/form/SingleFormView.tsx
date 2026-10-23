// Affichage Formulaire unique : en-tête en haut, Détail défilant au milieu (sélecteur d'enregistrement à gauche), pied en bas,
// barre de messages et barre de navigation.
import { ChevronRight, Pencil } from 'lucide-react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignDoc } from '../../shared/design/model';
import { effectiveProp } from '../../shared/design/properties';
import { NavigationBar } from '../datasheet/NavigationBar';
import { twipsToPx } from '../designer/units';
import { type RunCtx, readOnlyNote } from './controls/run-ctx';
import { FormSection } from './FormSection';

export interface SingleFormProps {
  doc: DesignDoc; x: RunCtx; root: RefObject<HTMLDivElement>;
  messages: string[];                     // errors on fields no control shows (form-message)
  filter: 'none' | 'on' | 'off';
  onGo(row: number): void; onNew(): void; onToggleFilter(): void;
}

export function SingleFormView({ doc, x, root, messages, filter, onGo, onNew, onToggleFilter }: SingleFormProps) {
  const { t } = useTranslation();
  const width = twipsToPx(Number(effectiveProp(doc.props, 'Width', 'form')) || 0);
  const shown = (kind: string) => doc.sections.find((s) => s.kind === kind && s.props.Visible !== false);
  const [header, detail, footer] = [shown('formHeader'), shown('detail'), shown('formFooter')];
  const bound = doc.recordSource !== null;   // an unbound form has no records: no selector, no navigation bar
  const selectors = bound && effectiveProp(doc.props, 'RecordSelectors', 'form') !== false;
  const nav = bound && effectiveProp(doc.props, 'NavigationButtons', 'form') !== false;
  const { snap } = x;
  return (
    <div className="frun" ref={root} data-testid="form-run">
      {header && <div className="frun-fixed"><FormSection section={header} x={x} width={width} /></div>}
      <div className="frun-body">
        {detail && (
          <div className="frun-detail">
            {selectors && (
              <div className="frun-selector" data-testid="form-selector" style={{ height: twipsToPx(detail.height) }}>
                {snap.dirty
                  ? <span data-testid="form-dirty" title={t('form.dirty')}><Pencil className="ic ic-sm" aria-hidden /><span className="sr-only">{t('form.dirty')}</span></span>
                  : <ChevronRight className="ic ic-sm" aria-hidden />}
              </div>
            )}
            <FormSection section={detail} x={x} width={width} />
          </div>
        )}
      </div>
      {footer && <div className="frun-fixed"><FormSection section={footer} x={x} width={width} /></div>}
      {messages.length > 0 && (
        <div className="frun-message" role="alert" aria-label={t('form.message')} data-testid="form-message">
          {messages.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
      {nav && (
        <NavigationBar current={snap.status === 'ready' ? snap.index : null} count={snap.total} canAdd={snap.canAdd}
          filter={filter} onGo={onGo} onNew={onNew} onToggleFilter={onToggleFilter} note={readOnlyNote(x)} />
      )}
    </div>
  );
}

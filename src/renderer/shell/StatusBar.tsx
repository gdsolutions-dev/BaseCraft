import { PencilRuler, Sheet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DocMode } from '../state/app-state';
import { commandEnabled, commandsVersion, runCommand, subscribeCommands, type RibbonContext } from './ribbon-model';
import { useSyncExternalStore } from 'react';

export function StatusBar({ ctx }: { ctx: RibbonContext }) {
  const { t } = useTranslation();
  useSyncExternalStore(subscribeCommands, commandsVersion);
  const { mode } = ctx;
  const view = (m: DocMode, Icon: typeof Sheet) => {
    const label = t(`status.mode.${m}`);
    const cmd = m === 'design' ? 'viewDesign' : 'viewDatasheet';
    return (
      <button data-testid={`status-view-${m}`} className={mode === m ? 'is-on' : ''} title={label} aria-label={label}
        aria-pressed={mode === m} disabled={!commandEnabled(cmd, ctx)}
        onClick={() => runCommand(cmd)}>
        <Icon className="ic" aria-hidden />
      </button>
    );
  };
  return (
    <footer className="status">
      <span data-testid="status-mode">{mode ? t(`status.mode.${mode}`) : t('status.ready')}</span>
      <div className="views" role="group" aria-label={t('status.views')}>
        {view('datasheet', Sheet)}
        {view('design', PencilRuler)}
      </div>
    </footer>
  );
}

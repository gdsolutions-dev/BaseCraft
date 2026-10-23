import { AppWindow, Code, PencilRuler, Sheet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DocMode } from '../state/app-state';
import { commandEnabled, commandState, commandsVersion, runCommand, subscribeCommands, type CommandId, type RibbonContext } from './ribbon-model';
import { useSyncExternalStore } from 'react';

export function StatusBar({ ctx }: { ctx: RibbonContext }) {
  const { t } = useTranslation();
  useSyncExternalStore(subscribeCommands, commandsVersion);
  const { mode } = ctx;
  const form = ctx.kind === 'form';   // M10: Form view is the form's run mode, Datasheet view its datasheet mode
  const button = (id: string, label: string, cmd: CommandId, on: boolean, Icon: typeof Sheet) => (
    <button data-testid={`status-view-${id}`} className={on ? 'is-on' : ''} title={label} aria-label={label}
      aria-pressed={on} disabled={!commandEnabled(cmd, ctx)}
      onClick={() => runCommand(cmd)}>
      <Icon className="ic" aria-hidden />
    </button>
  );
  const view = (m: DocMode | 'form', Icon: typeof Sheet) => {
    const cmd = m === 'design' ? 'viewDesign' : m === 'form' ? 'viewForm' : 'viewDatasheet';
    const on = form ? mode === (m === 'form' ? 'run' : m) : mode === m || (m === 'datasheet' && mode === 'run');
    return button(m, t(`status.mode.${m}`), cmd, commandState(cmd)?.active ?? on, Icon);
  };
  const sql = commandState('viewSql')?.active === true; // A3: a query's SQL view (part of its Design view)
  const flash = useSyncExternalStore(subscribeFlash, flashNow);
  return (
    <footer className="status">
      <span data-testid="status-mode">{sql ? t('status.mode.sql') : mode && mode !== 'run' ? t(`status.mode.${mode}`) : t('status.ready')}</span>
      {/* the live region stays mounted (one inserted with its text is not announced); the inner span restarts the flash */}
      <span role="status" data-testid="status-message"><span className="status-flash" key={flash?.n}>{flash ? t(flash.key) : ''}</span></span>
      <div className="views" role="group" aria-label={t('status.views')}>
        {form && view('form', AppWindow)}
        {view('datasheet', Sheet)}
        {ctx.kind === 'query' && button('sql', t('status.mode.sql'), 'viewSql', sql, Code) /* A3: Access's order */}
        {view('design', PencilRuler)}
      </div>
    </footer>
  );
}

// A short message in the status bar (a form's type-ahead dropped…), shown a few seconds with a flash.
let flashed: { key: string; n: number } | null = null;
const flashListeners = new Set<() => void>();
let flashTimer: ReturnType<typeof setTimeout> | undefined;
const subscribeFlash = (cb: () => void) => { flashListeners.add(cb); return () => { flashListeners.delete(cb); }; };
const flashNow = () => flashed;
export function flashStatus(key: string): void {
  flashed = { key, n: (flashed?.n ?? 0) + 1 };
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashed = null; flashListeners.forEach((cb) => cb()); }, 4000);
  flashListeners.forEach((cb) => cb());
}

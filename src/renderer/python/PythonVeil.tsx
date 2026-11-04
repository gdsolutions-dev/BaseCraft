// While a Python call runs the window stands back (App makes it inert); after 2 s the veil says why and offers Interrupt (R6).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { pythonHost } from './python-host';

export const usePythonRunning = (): boolean =>
  useSyncExternalStore(pythonHost().subscribe, () => pythonHost().state() === 'running');

const SLOW_MS = 2000;

export function PythonVeil() {
  const { t } = useTranslation();
  const running = usePythonRunning();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!running) return;
    const left = SLOW_MS - (Date.now() - (pythonHost().runningSince() ?? Date.now()));
    const id = setTimeout(() => setSlow(true), Math.max(0, left));
    return () => clearTimeout(id);
  }, [running]);
  if (!running) return null;
  return (
    <div className="python-veil" data-testid="python-veil" aria-busy="true">
      {slow && (
        <div className="python-veil-box" role="status">
          <span>{t('python.running')}</span>
          <button type="button" className="btn" data-testid="python-interrupt" aria-keyshortcuts="Control+Pause" onClick={() => pythonHost().interrupt()}>{t('python.interrupt')}</button>
        </div>
      )}
    </div>
  );
}

// R12: the Immediate window, a bottom pane: output log + one input line. `?expr` prints str(value); any other line runs as a
// statement in a namespace that lives as long as the Python session. The first use starts Python (input disabled meanwhile).
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Splitter } from '../shell/Splitter';
import { loadRatio, pxToRatio, ratioToPx, saveRatio } from '../shell/splitter-model';
import { ImmediateHistory } from './immediate-history';
import { PythonError, pythonHost } from './python-host';
import './immediate.css';

const RATIO_KEY = 'bc.immediateRatio'; // the share of the window kept by what is above the pane
const PANE_MIN = 96, ABOVE_MIN = 240;

export function ImmediateWindow({ visible, focusKey }: { visible: boolean; focusKey: number }) {
  const { t } = useTranslation();
  const host = pythonHost();
  const state = useSyncExternalStore(host.subscribe, host.state);
  const [lines, setLines] = useState<string[]>(() => [...host.log()]);
  const [text, setText] = useState('');
  const [ratio, setRatio] = useState(loadRatio(RATIO_KEY));
  const [, resize] = useState(0);
  const history = useRef(new ImmediateHistory());
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const add = (...l: string[]) => setLines((x) => [...x, ...l].slice(-1000));

  useEffect(() => host.onLog((l) => add(l)), [host]);
  useEffect(() => { const f = () => resize((n) => n + 1); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [lines, visible]);
  const busy = state === 'loading' || state === 'running';
  useEffect(() => { if (visible && !busy) input.current?.focus(); }, [visible, focusKey, busy]);

  const run = async (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    history.current.push(line);
    setText('');
    add(`> ${line}`);
    try {
      const out = await host.immediate(line);
      if (out) add(out);
    } catch (e) {
      if (e instanceof PythonError) {
        const { type, message, module, line: at } = e.info;
        add(`${type}: ${message}${module && at ? ` ${t('immediate.errorAt', { module, line: at })}` : ''}`);
      } else add(/bc:contentDisabled/.test(String((e as Error)?.message ?? e)) ? t('python.contentDisabled') : String((e as Error)?.message ?? e));
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void run(text); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setText(history.current.prev(text)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setText(history.current.next()); }
  };

  const total = window.innerHeight;
  const above = ratioToPx(ratio, total, ABOVE_MIN, PANE_MIN);
  const paneH = Math.max(PANE_MIN, total - above);
  const move = (px: number) => { const r = pxToRatio(total - Math.max(PANE_MIN, total - px), total); setRatio(r); saveRatio(RATIO_KEY, r); };
  return (
    <div className="immediate" hidden={!visible} data-testid="immediate-window" style={{ height: paneH }}>
      <Splitter testId="immediate-splitter" label={t('immediate.splitter')} total={total} value={total - paneH} min={ABOVE_MIN} max={total - PANE_MIN}
        onChange={move} onReset={() => { setRatio(0.6); saveRatio(RATIO_KEY, 0.6); }} />
      <div className="immediate-title">{t('immediate.title')}</div>
      <div className="immediate-log" ref={log} data-testid="immediate-log" role="log" aria-live="polite">
        {lines.map((l, i) => <div key={i} className="immediate-line">{l}</div>)}
      </div>
      <input ref={input} className="immediate-input" data-testid="immediate-input" spellCheck={false} autoComplete="off"
        value={text} disabled={busy} aria-label={t('immediate.title')}
        placeholder={state === 'loading' ? t('python.loading') : t('immediate.placeholder')}
        onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
    </div>
  );
}

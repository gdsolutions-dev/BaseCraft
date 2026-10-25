// Boîtes de dialogue modales (jamais window.alert/confirm/prompt). Une à la fois : les demandes suivantes attendent.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';

export type ModalButton = 'yes' | 'no' | 'cancel' | 'ok';
/** defaultButton: focused and highlighted (default: the first); destructive questions put it on 'no'. */
export interface ConfirmOptions { titleKey: string; messageKey: string; params?: object; buttons: ModalButton[]; defaultButton?: ModalButton }
export interface PromptOptions { titleKey: string; labelKey: string; params?: object; initial: string; validate?: (v: string) => string | null
  /** The label's interpolation values (A3: a parameter's name, never read as a key). */
  labelParams?: object }
export interface CustomOptions { titleKey: string; titleParams?: object }
export interface ModalApi {
  confirm(opts: ConfirmOptions): Promise<ModalButton>;
  prompt(opts: PromptOptions): Promise<string | null>;
  /** A dialog with its own content, in the same queue (A2 Task 13 signature). `close(null)` and Escape cancel.
   *  `titleParams`: the title's interpolation values (B1: a macro's MessageBox title, never read as a key). */
  custom<T>(render: (close: (v: T | null) => void) => ReactNode, opts: CustomOptions): Promise<T | null>;
}

type Request =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: ModalButton) => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { id: number; kind: 'custom'; opts: CustomOptions; render: (close: (v: unknown) => void) => ReactNode; resolve: (v: unknown) => void };

const ModalContext = createContext<ModalApi | null>(null);
let nextId = 0;

export function ModalProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const api = useMemo<ModalApi>(() => ({
    confirm: (opts) => new Promise((resolve) => setQueue((q) => [...q, { id: ++nextId, kind: 'confirm', opts, resolve }])),
    prompt: (opts) => new Promise((resolve) => setQueue((q) => [...q, { id: ++nextId, kind: 'prompt', opts, resolve }])),
    custom: <T,>(render: (close: (v: T | null) => void) => ReactNode, opts: CustomOptions) => new Promise<T | null>((resolve) =>
      setQueue((q) => [...q, { id: ++nextId, kind: 'custom', opts, render: render as (close: (v: unknown) => void) => ReactNode, resolve: resolve as (v: unknown) => void }])),
  }), []);
  const current = queue[0];
  const done = (v: unknown) => {
    setQueue((q) => (q[0] === current ? q.slice(1) : q)); // a double click answers once
    (current.resolve as (x: typeof v) => void)(v);
  };
  return (
    <ModalContext.Provider value={api}>
      {children}
      {current && <Dialog key={current.id} req={current} onDone={done} />}
    </ModalContext.Provider>
  );
}

export function useModal(): ModalApi {
  const m = useContext(ModalContext);
  if (!m) throw new Error('useModal outside ModalProvider');
  return m;
}

/** `bc:<code>` of a rejected IPC call. Electron prefixes the message with the channel name, itself `bc:x:y`, hence the last
 *  match, read before the first `|` (`bc:<code>|<sub-code>|<detail>`: a detail never reads as the code). */
export function bcErrorCode(e: unknown): string | null {
  const msg = (e instanceof Error ? e.message : String(e)).split('|')[0];
  const all = [...msg.matchAll(/\bbc:(\w+)\b(?!:)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

/**
 * Message of an error (shared by useErrorDialog and the Properties dialog): `dialog.error.<code>_<sub-code>`, else
 * `dialog.error.<code>`, else `dialog.error.unknown`. Params: `detail` (the part after the sub-code, or the whole message
 * without Electron's prefix) and `reason` (the sub-code's `expr.error.*` text when there is one: a parse error's cause).
 */
export function errorMessage(e: unknown): { key: string; params: { detail: string; reason: string } } {
  const msg = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '');
  const code = bcErrorCode(e);
  const [, sub = '', ...rest] = msg.split('|');
  const key = [code && sub && `dialog.error.${code}_${sub}`, code && `dialog.error.${code}`].find((k) => k && i18n.exists(k)) || 'dialog.error.unknown';
  const reason = sub && i18n.exists(`expr.error.${sub}`) ? i18n.t(`expr.error.${sub}`) : '';
  return { key, params: { detail: msg.includes('|') ? rest.join('|') : msg, reason } };
}

/** One Stop ends the query and the calls queued behind it (a row save, a refresh): one « cancelled » message for all. */
let cancelledShown: Promise<void> | null = null;

/** Shows an error in the modal, translated when it carries a known `bc:` code. */
export function useErrorDialog(): (e: unknown) => Promise<void> {
  const modal = useModal();
  return useCallback(async (e: unknown) => {
    const code = bcErrorCode(e);
    if (code === 'hostCrashed') return; // the shell's single notice says it (App: onHostCrashed)
    if (code === 'cancelled' && cancelledShown) return cancelledShown;
    const m = errorMessage(e);
    const shown = modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: m.key, params: m.params, buttons: ['ok'] }).then(() => {});
    if (code !== 'cancelled') return shown;
    cancelledShown = shown.finally(() => { cancelledShown = null; });
    return cancelledShown;
  }, [modal]);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Keeps Tab / Shift+Tab inside `root` (modal dialogs, backstage). */
export function trapFocus(e: KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab') return;
  const items = [...(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
  e.preventDefault();
  items[next].focus();
}

function Dialog({ req, onDone }: { req: Request; onDone: (v: unknown) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(req.kind === 'prompt' ? req.opts.initial : '');
  const [error, setError] = useState<string | null>(null);
  const buttons: ModalButton[] = req.kind === 'confirm' ? req.opts.buttons : ['ok', 'cancel'];
  const def = (req.kind === 'confirm' && req.opts.defaultButton) || buttons[0];

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(req.kind === 'custom' ? FOCUSABLE : `input, [data-testid="modal-btn-${def}"]`);
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
    return () => before?.focus?.();
  }, []);

  const press = (b: ModalButton) => {
    if (req.kind === 'custom') return onDone(null);
    if (req.kind === 'confirm') return onDone(b);
    if (b !== 'ok') return onDone(null);
    const err = req.opts.validate?.(value) ?? null;
    if (err) setError(err);
    else onDone(value);
  };
  // Escape = cancel; a box without Cancel falls back to No, then to its last button (OK).
  const escape = () => press(buttons.includes('cancel') ? 'cancel' : buttons.includes('no') ? 'no' : buttons[buttons.length - 1]);

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // the shell's shortcuts (Ctrl+S, F11) do not reach the page behind
    if (e.key === 'Escape') { e.preventDefault(); escape(); }
    else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && req.kind === 'prompt') { e.preventDefault(); press('ok'); }
    else trapFocus(e, ref.current);
  };

  const titleId = `modal-title-${req.id}`;
  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal card" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="modal" onKeyDown={onKeyDown}>
        <h2 id={titleId} className="modal-title">{t(req.opts.titleKey, req.kind === 'custom' ? { ...req.opts.titleParams } : undefined)}</h2>
        {req.kind === 'custom' ? req.render(onDone) : req.kind === 'confirm' ? (
          <p className="modal-message">{t(req.opts.messageKey, { ...req.opts.params })}</p>
        ) : (
          <label className="modal-field">
            <span>{t(req.opts.labelKey, { ...req.opts.params, ...req.opts.labelParams })}</span>
            <input data-testid="modal-input" value={value} aria-invalid={error !== null}
              onChange={(e) => { setValue(e.target.value); setError(null); }} />
            {error && <span className="modal-error" role="alert" data-testid="modal-error">{error}</span>}
          </label>
        )}
        {req.kind !== 'custom' && <div className="modal-buttons">
          {buttons.map((b) => (
            <button key={b} className={b === def ? 'btn btn-primary' : 'btn'} data-testid={`modal-btn-${b}`} onClick={() => press(b)}>
              {t(`dialog.button.${b}`)}
            </button>
          ))}
        </div>}
      </div>
    </div>
  );
}

// Boîtes de dialogue modales (jamais window.alert/confirm/prompt). Une à la fois : les demandes suivantes attendent.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';

export type ModalButton = 'yes' | 'no' | 'cancel' | 'ok';
/** defaultButton: focused and highlighted (default: the first); destructive questions put it on 'no'. */
export interface ConfirmOptions { titleKey: string; messageKey: string; params?: object; buttons: ModalButton[]; defaultButton?: ModalButton }
export interface PromptOptions { titleKey: string; labelKey: string; initial: string; validate?: (v: string) => string | null }
export interface ModalApi {
  confirm(opts: ConfirmOptions): Promise<ModalButton>;
  prompt(opts: PromptOptions): Promise<string | null>;
}

type Request =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: ModalButton) => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

const ModalContext = createContext<ModalApi | null>(null);
let nextId = 0;

export function ModalProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const api = useMemo<ModalApi>(() => ({
    confirm: (opts) => new Promise((resolve) => setQueue((q) => [...q, { id: ++nextId, kind: 'confirm', opts, resolve }])),
    prompt: (opts) => new Promise((resolve) => setQueue((q) => [...q, { id: ++nextId, kind: 'prompt', opts, resolve }])),
  }), []);
  const current = queue[0];
  const done = (v: ModalButton | string | null) => {
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

/** `bc:<code>` of a rejected IPC call. Electron prefixes the message with the channel name, itself `bc:x:y`, hence the last match. */
export function bcErrorCode(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  const all = [...msg.matchAll(/\bbc:(\w+)\b(?!:)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

/** Shows an error in the modal, translated when it carries a known `bc:` code. */
export function useErrorDialog(): (e: unknown) => Promise<void> {
  const modal = useModal();
  return useCallback(async (e: unknown) => {
    const code = bcErrorCode(e);
    const key = code && i18n.exists(`dialog.error.${code}`) ? `dialog.error.${code}` : 'dialog.error.unknown';
    const detail = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(e);
    await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: key, params: { detail }, buttons: ['ok'] });
  }, [modal]);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

function Dialog({ req, onDone }: { req: Request; onDone: (v: ModalButton | string | null) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(req.kind === 'prompt' ? req.opts.initial : '');
  const [error, setError] = useState<string | null>(null);
  const buttons: ModalButton[] = req.kind === 'confirm' ? req.opts.buttons : ['ok', 'cancel'];
  const def = (req.kind === 'confirm' && req.opts.defaultButton) || buttons[0];

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(`input, [data-testid="modal-btn-${def}"]`);
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
    return () => before?.focus?.();
  }, []);

  const press = (b: ModalButton) => {
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
    else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); press('ok'); }
    else trapFocus(e, ref.current);
  };

  const titleId = `modal-title-${req.id}`;
  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal card" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="modal" onKeyDown={onKeyDown}>
        <h2 id={titleId} className="modal-title">{t(req.opts.titleKey)}</h2>
        {req.kind === 'confirm' ? (
          <p className="modal-message">{t(req.opts.messageKey, { ...req.opts.params })}</p>
        ) : (
          <label className="modal-field">
            <span>{t(req.opts.labelKey)}</span>
            <input data-testid="modal-input" value={value} aria-invalid={error !== null}
              onChange={(e) => { setValue(e.target.value); setError(null); }} />
            {error && <span className="modal-error" role="alert" data-testid="modal-error">{error}</span>}
          </label>
        )}
        <div className="modal-buttons">
          {buttons.map((b) => (
            <button key={b} className={b === def ? 'btn btn-primary' : 'btn'} data-testid={`modal-btn-${b}`} onClick={() => press(b)}>
              {t(`dialog.button.${b}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

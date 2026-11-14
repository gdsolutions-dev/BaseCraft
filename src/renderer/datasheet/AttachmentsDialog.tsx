// Access's « Pièces jointes » box (C5): the files of one Attachment cell. Add, Remove, Open, Save As, Save All. Every change is
// written at once (as Access); `onClose(changed)` tells the view to read its rows again. Open asks first, and again with a
// stronger warning for a program or script: a file from a base is never run silently.
import { Paperclip } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isRunnable, type AttachmentInfo } from '../../shared/attachments';
import type { RowRef } from '../../shared/api';
import { api } from '../bridge';
import { trapFocus, useErrorDialog } from '../shell/Modal';

export interface AttachmentTarget { table: string; field: string; rowid: RowRef }

const size = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

interface Props { target: AttachmentTarget; readOnly: boolean; onClose(changed: boolean): void }

export function AttachmentsDialog({ target, readOnly, onClose }: Props) {
  const { t } = useTranslation();
  const showError = useErrorDialog();
  const ref = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<AttachmentInfo[] | null>(null);
  const [at, setAt] = useState(0);
  const [changed, setChanged] = useState(false);
  const [confirm, setConfirm] = useState<AttachmentInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const { table, field, rowid } = target;

  const read = async (select?: number) => {
    const list = await api.attachments.list(table, field, rowid);
    setFiles(list);
    setAt(Math.min(select ?? at, Math.max(0, list.length - 1)));
  };
  useEffect(() => { read().catch((e) => { void showError(e); onClose(false); }); }, []);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.();
  }, []);
  useEffect(() => { if (files) ref.current?.querySelector<HTMLElement>('[data-testid="att-add"]')?.focus(); }, [files === null]);

  const run = async (fn: () => Promise<unknown>, writes = false) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); if (writes) setChanged(true); } catch (e) { await showError(e); }
    setBusy(false);
  };
  const cur = files?.[at];
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // the shell's shortcuts and the grid's keys stay behind
    if (e.key === 'Escape') { e.preventDefault(); if (confirm) setConfirm(null); else onClose(changed); } else trapFocus(e, ref.current);
  };

  return (
    <div className="modal-backdrop">
      <div ref={ref} className="modal card attachments" role="dialog" aria-modal="true" aria-labelledby="att-title" data-testid="attachments-dialog" onKeyDown={onKeyDown}>
        <h2 id="att-title" className="modal-title">{t('attachments.title')}</h2>
        <div className="att-list" role="listbox" aria-labelledby="att-title" data-testid="att-list">
          {files?.length === 0 && <div className="muted att-none" data-testid="att-none">{t('attachments.none')}</div>}
          {files?.map((f, i) => (
            <div key={f.id} role="option" aria-selected={i === at} className={`att-item${i === at ? ' selected' : ''}`} data-testid={`att-item-${i}`} tabIndex={-1}
              onClick={() => setAt(i)} onDoubleClick={() => setConfirm(f)}>
              <Paperclip size={14} aria-hidden /> <span className="att-name">{f.name}</span> <span className="muted">{size(f.bytes)}</span>
            </div>
          ))}
        </div>
        <div className="modal-buttons att-buttons">
          <button className="btn" data-testid="att-add" disabled={busy || readOnly || !files}
            onClick={() => void run(async () => { const n = await api.attachments.add(table, field, rowid); if (n.length) { await read(Number.MAX_SAFE_INTEGER); setChanged(true); } })}>{t('attachments.add')}</button>
          <button className="btn" data-testid="att-remove" disabled={busy || readOnly || !cur}
            onClick={() => void run(async () => { await api.attachments.remove(table, field, rowid, cur!.id); await read(at); }, true)}>{t('attachments.remove')}</button>
          <button className="btn" data-testid="att-open" disabled={busy || !cur} onClick={() => setConfirm(cur!)}>{t('attachments.open')}</button>
          <button className="btn" data-testid="att-saveAs" disabled={busy || !cur} onClick={() => void run(() => api.attachments.save(table, field, rowid, cur!.id))}>{t('attachments.saveAs')}</button>
          <button className="btn" data-testid="att-saveAll" disabled={busy || !files?.length} onClick={() => void run(() => api.attachments.saveAll(table, field, rowid))}>{t('attachments.saveAll')}</button>
          <button className="btn btn-primary" data-testid="att-ok" onClick={() => onClose(changed)}>{t('dialog.button.ok')}</button>
        </div>
        {confirm && (
          <div className="modal-backdrop" onClick={(e) => e.stopPropagation()}>
            <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="att-confirm-msg" data-testid="att-confirm">
              <p id="att-confirm-msg" className="modal-message">{t(isRunnable(confirm.name) ? 'attachments.openConfirmRunnable' : 'attachments.openConfirm', { name: confirm.name })}</p>
              <div className="modal-buttons">
                <button className="btn" data-testid="att-confirm-yes" onClick={() => { const f = confirm; setConfirm(null); void run(() => api.attachments.open(table, field, rowid, f.id, true)); }}>{t('dialog.button.yes')}</button>
                <button className="btn btn-primary" autoFocus data-testid="att-confirm-no" onClick={() => setConfirm(null)}>{t('dialog.button.no')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

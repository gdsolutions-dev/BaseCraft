// Attachment control (C5) in Form view: the current file of the record's Attachment field (its picture, else a paperclip and its
// name), arrows to go through the files, a double-click for Access's Attachments box. Bound to an Attachment field of the form's
// key table; a new record (not saved yet) has no files to show.
import { ChevronLeft, ChevronRight, Paperclip } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { AttachmentInfo } from '../../../shared/attachments';
import { api } from '../../bridge';
import { AttachmentsDialog } from '../../datasheet/AttachmentsDialog';
import { prop } from '../run-model';
import { fieldOf, tipOf, type CtlProps } from './run-ctx';

export function AttachmentCtl({ c, x, style }: CtlProps) {
  const { t } = useTranslation();
  const bound = fieldOf(c, x);
  const table = bound?.f.origin?.table ?? x.info?.keyTable;
  const field = bound?.f.origin?.field ?? bound?.f.name;
  const rowid = x.snap.rowid;
  const live = !!bound && bound.f.type === 'attachment' && table !== undefined && field !== undefined && typeof rowid === 'number' && Number.isFinite(rowid) && !x.snap.isNew;
  const enabled = prop(c, 'Enabled') !== false;
  const [files, setFiles] = useState<AttachmentInfo[]>([]);
  const [at, setAt] = useState(0);
  const [pic, setPic] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [dlg, setDlg] = useState(false);
  const key = live ? `${table}|${field}|${String(rowid)}` : '';

  useEffect(() => { setAt(0); }, [key]);
  useEffect(() => {
    let stale = false;
    if (!live) { setFiles([]); return; }
    api.attachments.list(table!, field!, rowid).then((l) => { if (!stale) { setFiles(l); setAt((a) => Math.min(a, Math.max(0, l.length - 1))); } }, () => { if (!stale) setFiles([]); });
    return () => { stale = true; };
  }, [key, version]);
  const cur = files[at];
  useEffect(() => {
    let stale = false;
    setPic(null);
    if (live && cur) api.attachments.preview(table!, field!, rowid, cur.id).then((p) => { if (!stale) setPic(p); }, () => undefined);
    return () => { stale = true; };
  }, [key, cur?.id]);

  const open = () => { if (live && enabled) setDlg(true); };
  const go = (d: number) => setAt((a) => (a + d + files.length) % files.length);
  const readOnly = !x.snap.editable || prop(c, 'Locked') === true;
  return (
    <div role="group" aria-label={c.name} className="frun-attachment" style={style} data-testid={`form-ctl-${c.name}`} data-count={files.length}
      title={t('attachments.manage')} {...tipOf(c)} onDoubleClick={open} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } }}>
      <div className="frun-att-body">
        {pic ? <img src={pic} alt={cur?.name ?? ''} draggable={false} data-testid={`form-att-img-${c.name}`} />
          : <span className="frun-att-icon"><Paperclip size={22} aria-hidden />{cur && <span className="frun-att-name" data-testid={`form-att-name-${c.name}`}>{cur.name}</span>}</span>}
      </div>
      <div className="frun-att-bar">
        <button type="button" className="frun-att-nav" disabled={files.length < 2} aria-label={t('attachments.previous')} data-testid={`form-att-prev-${c.name}`} onClick={() => go(-1)}><ChevronLeft size={14} aria-hidden /></button>
        <span data-testid={`form-att-pos-${c.name}`}>{files.length ? `${at + 1}/${files.length}` : '0'}</span>
        <button type="button" className="frun-att-nav" disabled={files.length < 2} aria-label={t('attachments.next')} data-testid={`form-att-next-${c.name}`} onClick={() => go(1)}><ChevronRight size={14} aria-hidden /></button>
      </div>
      {dlg && createPortal(
        <AttachmentsDialog target={{ table: table!, field: field!, rowid }} readOnly={readOnly} onClose={(changed) => { setDlg(false); if (changed) setVersion((v) => v + 1); }} />, document.body)}
    </div>
  );
}

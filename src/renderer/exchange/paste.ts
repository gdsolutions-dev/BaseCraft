// Coller un objet du presse-papiers du volet (A6) : contrôle du nom (pur), puis copie, déplacement (couper = renommer) ou ajout de données.
import type { ObjectKind } from '../../shared/api';
import { sameName } from '../../shared/field-types';
import { bcErrorCode, errorMessage, type ModalApi } from '../shell/Modal';
import { nameErrorKey } from '../shell/name-error';
import type { AppDispatch } from '../shell/nav-menu';
import type { DocKind } from '../state/app-state';
import { askPaste, type PasteMode } from './PasteDialog';
import { getClip, setClip, type ObjectClip } from './object-clipboard';

export type { PasteMode };
export interface PasteNames { tables: string[]; queries: string[]; forms: string[]; reports: string[]; macros: string[] }

const MAX_CHARS = 64;

/** The names a new object of `kind` competes with: tables and queries share one namespace. */
export const takenNames = (kind: DocKind, n: PasteNames): string[] =>
  kind === 'table' || kind === 'query' ? [...n.tables, ...n.queries] : kind === 'form' ? n.forms : kind === 'macro' ? n.macros : n.reports;

/** The i18n key of what refuses this paste, else null. */
export function pasteError(clip: ObjectClip, name: string, mode: PasteMode, names: PasteNames): string | null {
  if (name.trim() === '') return 'designError.nameEmpty';
  if (mode === 'append') return names.tables.some((x) => sameName(x, name)) && !sameName(name, clip.name) ? null : 'nav.paste.appendTarget';
  if (clip.cut && sameName(name, clip.name)) return null; // moved nowhere
  if ([...name].length > MAX_CHARS) return 'designError.nameTooLong';
  return nameErrorKey(name) ?? (takenNames(clip.kind, names).some((x) => sameName(x, name)) ? 'nav.paste.exists' : null);
}

export async function pasteNames(): Promise<PasteNames> {
  const { api } = await import('../bridge'); // not at load: the bridge reads window
  const [tables, objects] = await Promise.all([api.tables.list(), api.objects.list()]);
  const of = (k: ObjectKind) => objects.filter((o) => o.kind === k).map((o) => o.name);
  return { tables: tables.map((x) => x.name), queries: of('query'), forms: of('form'), reports: of('report'), macros: of('macro') };
}

const fail = (modal: ModalApi, messageKey: string, params?: object) =>
  modal.confirm({ titleKey: 'dialog.errorTitle', messageKey, params, buttons: ['ok'] }).then(() => {});

export async function runPaste(env: { modal: ModalApi; dispatch: AppDispatch }, clip: ObjectClip, choice: { name: string; mode: PasteMode }): Promise<void> {
  const { modal, dispatch } = env;
  const { name, mode } = choice;
  const kind = clip.kind as ObjectKind;
  try {
    const { api } = await import('../bridge');
    if (mode === 'append') {
      const r = await api.tables.append(clip.name, name);
      dispatch({ type: 'tableDataChanged', name });
      return await modal.confirm({ titleKey: 'nav.paste.title', messageKey: 'nav.paste.appended', params: r, buttons: ['ok'] }).then(() => {});
    }
    if (clip.cut && sameName(name, clip.name)) return setClip(null);
    const params = { name: clip.name, newName: name };
    const r = clip.cut
      ? await (clip.kind === 'table' ? api.tables.rename(clip.name, name) : api.objects.rename(kind, clip.name, name))
      : await (clip.kind === 'table' ? api.tables.copy(clip.name, name, mode === 'structure' ? 'structure' : 'data') : api.objects.copy(kind, clip.name, name));
    if (!r.ok) {
      return await fail(modal, `dialog.op.${r.reason}`, { ...params, table: 'table' in r ? r.table : '', view: 'view' in r ? r.view : '' });
    }
    if (clip.cut) {
      setClip(null);
      dispatch(clip.kind === 'table' ? { type: 'tableRenamed', from: clip.name, to: name } : { type: 'objectRenamed', kind, from: clip.name, to: name });
    } else dispatch(clip.kind === 'table' ? { type: 'tableSaved', name } : { type: 'objectSaved', kind, name });
  } catch (e) {
    if (bcErrorCode(e) === 'hostCrashed') return; // the shell's single notice says it
    const m = errorMessage(e);
    await fail(modal, m.key, m.params);
  }
}

/** Paste (menu, ribbon, Ctrl+V): asks for the name and mode, then pastes the clip, whatever object was right-clicked. */
export async function pasteClip(env: { modal: ModalApi; dispatch: AppDispatch }): Promise<void> {
  const clip = getClip();
  if (!clip) return;
  const choice = await askPaste(env.modal, clip, await pasteNames());
  if (choice) await runPaste(env, clip, choice);
}


// « Entrer une valeur de paramètre » (contrat 1.2, règle C3) : la boîte commune que A3, A4 et A5 appellent avant sources.page.
import { coerce, type CellInput } from '../../shared/coerce';
import { defaultProps } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import type { SourceInfo } from '../../shared/record-source';
import { i18n } from '../i18n';
import type { ModalApi } from '../shell/Modal';

/**
 * One prompt per parameter, in order, as in Access; the name is the label (an i18n param, never a key). Each text is checked
 * as the parameter's type stores it, in the region; the typed text is returned (the main process converts it again).
 * null: Escape (or Cancel) on any prompt. `modal` comes from useModal() in the calling component.
 */
export async function promptParameters(modal: ModalApi, params: SourceInfo['parameters'], region: LocaleInfo): Promise<Record<string, CellInput> | null> {
  const out: Record<string, CellInput> = {};
  for (const p of params) {
    const field = { name: p.name, props: p.props ?? defaultProps(p.type ?? 'shortText') };
    const text = await modal.prompt({
      titleKey: 'query.param.title', labelKey: 'query.param.label', labelParams: { name: p.name }, initial: '',
      validate: (v) => {
        const r = coerce(field, v, region);
        return r.ok ? null : i18n.t(`fieldError.${r.error}`);
      },
    });
    if (text === null) return null;
    out[p.name] = text;
  }
  return out;
}

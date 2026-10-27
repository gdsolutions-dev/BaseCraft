// « Entrer une valeur de paramètre » (contrat 1.2, règle C3) : la boîte commune que A3, A4 et A5 appellent avant sources.page.
import { coerce, type CellInput } from '../../shared/coerce';
import { defaultProps } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import type { SourceInfo } from '../../shared/record-source';
import { memberParamValue } from '../form/form-instances';
import { i18n } from '../i18n';
import { tempVars } from '../macro/temp-vars';
import type { ModalApi } from '../shell/Modal';

/**
 * One prompt per parameter, in order, as in Access; the name is the label (an i18n param, never a key). Each text is checked
 * as the parameter's type stores it, in the region; the typed text is returned (the main process converts it again).
 * null: Escape (or Cancel) on any prompt. `modal` comes from useModal() in the calling component.
 * A [Forms]! / [Reports]! / [TempVars]! parameter (B2 R11) is filled from the open object or the temporary variable,
 * asked only when its form or report is not open.
 */
export async function promptParameters(modal: ModalApi, params: SourceInfo['parameters'], region: LocaleInfo): Promise<Record<string, CellInput> | null> {
  const out: Record<string, CellInput> = {};
  for (const p of params) {
    const m = memberParamValue(p.name, tempVars, p.type);
    if (m.found) { out[p.name] = m.value; continue; }
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

/** A query's parameter values before its datasheet (QueryRunView): asked once; a crosstab whose headings need them (B4 R11)
 *  is described again with them (`describe`), its headings then known. The prompts keep the first description's list: an
 *  expansion over no pivot value lists only the parameters its rows use. null: cancelled. */
export async function runParameters(modal: ModalApi, info: SourceInfo, region: LocaleInfo,
  describe: (values: Record<string, CellInput>) => Promise<unknown>): Promise<Record<string, CellInput> | null> {
  const values = info.parameters.length ? await promptParameters(modal, info.parameters, region) : {};
  if (values && info.crosstab?.headings === 'needsParameters') await describe(values);
  return values;
}

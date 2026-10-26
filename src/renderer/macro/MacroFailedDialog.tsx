// Échec de l'action, comme Access : la macro, l'action, ses arguments tels qu'enregistrés (les expressions sous leur forme
// affichée), le numéro et le message de l'erreur, et le seul bouton « Arrêter toutes les macros ».
import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ExprRuntimeError } from '../../shared/expr/ast';
import { toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { localeInfo } from '../../shared/locale-format';
import { actionDef } from '../../shared/macro/catalog';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { bcErrorCode, errorMessage, type ModalApi } from '../shell/Modal';
import type { MacroFailure } from './engine';

const t = (key: string, params: Record<string, unknown> = {}) => i18n.t(key, params);
export const actionLabel = (name: string) => (i18n.exists(`macro.action.${name}`) ? t(`macro.action.${name}`) : name);

/** The form actions' own refusals (B2): `bc:<code>` or `bc:<code>||<name>`. */
const FORM_REFUSALS = new Set(['notOpen', 'noActiveForm', 'cantGoToRecord', 'cantFocus', 'saveRefused', 'propertyNotSupported', 'badReference', 'badValue', 'findWhatTooLong', 'saveDuringEvent']);

/** The failure's message: `macro.error.<code>`; an action's own refusal (`bc:<code>`) in its own words. */
export function failureMessage(f: MacroFailure): string {
  const action = actionLabel(f.action), detail = f.detail ?? '';
  const code = bcErrorCode(detail);
  // a macro not found: the name the detail carries, else the one RunMacro asked for, else the macro run
  const name = (code ? detail.split('|')[2] : detail) || f.raw.MacroName || f.macro;
  switch (f.code) {
    case 'actionFailed':
      if (code === 'notFound') return t('macro.error.notFound', { name });
      if (code === 'runSqlSelect') return t('macro.error.runSqlSelect');
      if (code === 'actionCancelled' || code === 'actionNotRun') return t(`macro.error.${code}`, { action });
      if (code && FORM_REFUSALS.has(code)) return t('macro.error.actionFailed', { action, detail: t(`macro.error.${code}`, { name }) });
      if (code) { const m = errorMessage(f.cause ?? detail); return t('macro.error.actionFailed', { action, detail: t(m.key, m.params) }); }
      return t('macro.error.actionFailed', { action, detail });
    case 'expression':
      return t('macro.error.expression', { action, detail: i18n.exists(`expr.error.${detail}`)
        ? t(`expr.error.${detail}`, { name: f.cause instanceof ExprRuntimeError ? f.cause.detail : '' }) : detail });   // notOpen: the object's name
    case 'notFound': case 'badDefinition':
      return t(`macro.error.${f.code}`, { name: f.code === 'badDefinition' ? f.raw.MacroName || f.macro : name, detail });
    case 'tooDeep':
      return t(detail === 'events' ? 'macro.error.eventTooDeep' : 'macro.error.tooDeep');   // runEvent's nesting, else RunMacro's
    default:
      return t(`macro.error.${f.code}`, { action, detail });
  }
}

/** An argument as stored, shown as the designer shows it: an enum's label, an expression in its display form. */
export function argText(action: string, arg: string, value: string, ctx: DisplayContext): string {
  const type = actionDef(action)?.args.find((a) => a.name === arg)?.type;
  try {
    if (type === 'enum') return t(`macro.argValue.${arg}.${value || 'empty'}`);
    if (type === 'expression' || type === 'where' || type === 'reference') return value && toDisplay(value, ctx);
    if ((type === 'text' || type === 'number') && value.startsWith('=')) return `=${toDisplay(value.slice(1), ctx)}`;
  } catch { /* as stored */ }
  return value;
}

function MacroFailed({ f, ctx, onClose }: { f: MacroFailure; ctx: DisplayContext; onClose(v: true): void }) {
  const { t: tr } = useTranslation();
  const def = actionDef(f.action);
  const names = def ? def.args.map((a) => a.name) : Object.keys(f.raw);
  const args = names.map((n) => argText(f.action, n, f.raw[n] ?? '', ctx)).join(', ');
  return (
    <div data-testid="macro-failed">
      <dl className="macro-failed-facts">
        <dt>{tr('macro.failed.macro')}</dt><dd data-testid="macro-failed-macro">{f.macro}</dd>
        {f.action && <><dt>{tr('macro.failed.action')}</dt><dd data-testid="macro-failed-action">{actionLabel(f.action)}</dd></>}
        {f.action && <><dt>{tr('macro.failed.args')}</dt><dd data-testid="macro-failed-args">{args}</dd></>}
        <dt>{tr('macro.failed.number')}</dt><dd data-testid="macro-failed-number">{f.number}</dd>
      </dl>
      <p className="modal-message" role="alert" data-testid="macro-failed-message">{failureMessage(f)}</p>
      <div className="modal-buttons">
        <button type="button" className="btn btn-primary" data-testid="macro-failed-stop" onClick={() => onClose(true)}>{tr('macro.failed.stop')}</button>
      </div>
    </div>
  );
}

export async function showMacroFailed(modal: ModalApi, f: MacroFailure): Promise<void> {
  const s = await api.app.getSettings();
  const ctx: DisplayContext = { lang: s.uiLanguage, region: localeInfo(s.region) };
  await modal.custom<true>((close) => createElement(MacroFailed, { f, ctx, onClose: close }), { titleKey: 'macro.failed.title' });
}

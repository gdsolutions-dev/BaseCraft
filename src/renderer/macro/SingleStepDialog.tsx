// Pas à pas, comme Access : avant chaque action, la macro, la condition qui y mène (forme affichée) ou « Aucune », l'action et
// ses arguments ; Pas à pas exécute l'action et s'arrête à la suivante, Continuer exécute la suite sans s'arrêter, Arrêter toutes
// les macros termine l'exécution.
import { createElement } from 'react';
import { useTranslation } from 'react-i18next';
import { toDisplay, type DisplayContext } from '../../shared/expr/localize';
import { localeInfo } from '../../shared/locale-format';
import { actionDef } from '../../shared/macro/catalog';
import { api } from '../bridge';
import type { ModalApi } from '../shell/Modal';
import type { StepInfo } from './engine';
import { formulaLang } from '../../shared/i18n';
import { actionLabel, argText } from './MacroFailedDialog';

type StepAnswer = 'step' | 'continue' | 'stopAll';

function SingleStep({ s, ctx, onClose }: { s: StepInfo; ctx: DisplayContext; onClose(v: StepAnswer): void }) {
  const { t } = useTranslation();
  let condition = t('macro.step.none');
  if (s.condition) { try { condition = toDisplay(s.condition, ctx); } catch { condition = s.condition; } }
  const names = actionDef(s.action)?.args.map((a) => a.name) ?? Object.keys(s.args);
  const args = names.map((n) => argText(s.action, n, s.args[n] ?? '', ctx)).join(', ');
  const button = (answer: StepAnswer, testId: string, key: string, primary = false) => (
    <button type="button" className={primary ? 'btn btn-primary' : 'btn'} data-testid={testId} onClick={() => onClose(answer)}>{t(key)}</button>
  );
  return (
    <div data-testid="macro-step">
      <dl className="macro-failed-facts">
        <dt>{t('macro.failed.macro')}</dt><dd data-testid="macro-step-macro">{s.macro}</dd>
        <dt>{t('macro.step.condition')}</dt><dd data-testid="macro-step-condition">{condition}</dd>
        <dt>{t('macro.failed.action')}</dt><dd data-testid="macro-step-action">{actionLabel(s.action)}</dd>
        <dt>{t('macro.failed.args')}</dt><dd data-testid="macro-step-args">{args}</dd>
      </dl>
      <div className="modal-buttons">
        {button('step', 'macro-step-step', 'macro.step.step', true)}
        {button('stopAll', 'macro-step-stop', 'macro.failed.stop')}
        {button('continue', 'macro-step-continue', 'macro.step.continue')}
      </div>
    </div>
  );
}

/** Asks before the next action; closed without an answer (Escape), the run stops, the safe way out. */
export async function askStep(modal: ModalApi, s: StepInfo): Promise<StepAnswer> {
  const settings = await api.app.getSettings();
  const ctx: DisplayContext = { lang: formulaLang(settings.uiLanguage), region: localeInfo(settings.region) };
  return (await modal.custom<StepAnswer>((close) => createElement(SingleStep, { s, ctx, onClose: close }), { titleKey: 'macro.step.title' })) ?? 'stopAll';
}

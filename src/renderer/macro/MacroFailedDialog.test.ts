import { describe, expect, it, vi } from 'vitest';
import type { DisplayContext } from '../../shared/expr/localize';
import { localeInfo } from '../../shared/locale-format';
import { ExprRuntimeError } from '../../shared/expr/ast';
import { i18n } from '../i18n';
import { argText, failureMessage } from './MacroFailedDialog';

vi.mock('../bridge', () => ({ api: {} }));   // argText is pure; the dialog's bridge needs a window

const FR: DisplayContext = { lang: 'fr', region: localeInfo('fr-FR') };
const EN: DisplayContext = { lang: 'en', region: localeInfo('en-US') };

describe('argText (Macro Failed and Single Step dialogs show arguments as the designer does)', () => {
  it('a reference argument is shown in its display form, like an expression', () => {
    expect(argText('SetValue', 'Item', '[Forms]![F]![C]', FR)).toBe('[Formulaires]![F]![C]');
    expect(argText('SetValue', 'Item', '[Forms]![F]![C]', EN)).toBe('[Forms]![F]![C]');
    expect(argText('SetValue', 'Expression', '[Forms]![F]![C] + 1', FR)).toBe('[Formulaires]![F]![C] + 1');
    expect(argText('SetValue', 'Item', '', FR)).toBe('');
    expect(argText('SetValue', 'Item', '[Forms]![', FR)).toBe('[Forms]![');   // unreadable: as stored
  });
});

it('a form not open is named in the message', async () => {
  await i18n.changeLanguage('fr');
  const cause = new ExprRuntimeError('notOpen', 'FClients');
  const text = failureMessage({ macro: 'M', action: 'MessageBox', raw: {}, code: 'expression', number: 0, detail: 'notOpen', cause });
  expect(text).toContain("« FClients » n'est pas ouvert.");
  expect(text).not.toContain('formulaire');   // a form or a report: neutral (expr.error.notOpen)
});

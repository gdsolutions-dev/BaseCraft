import { describe, expect, it, vi } from 'vitest';
import type { DisplayContext } from '../../shared/expr/localize';
import { localeInfo } from '../../shared/locale-format';
import { ExprRuntimeError } from '../../shared/expr/ast';
import { i18n } from '../i18n';
import { setUserFunctions } from '../../shared/expr/user-functions';
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
  it('an expression or = text argument shows a Python call as written, a WHERE argument stays canonical', () => {
    setUserFunctions(['Remise']);
    try {
      expect(argText('SetTempVar', 'Expression', 'remise(1)', EN)).toBe('Remise(1)');
      expect(argText('MessageBox', 'Message', '=remise(1)', EN)).toBe('=Remise(1)');
      expect(argText('ApplyFilter', 'WhereCondition', 'remise(1)', EN)).toBe('remise(1)');   // unreadable for SQL: as stored
    } finally { setUserFunctions([]); }
  });
});

it('a form not open is named in the message', async () => {
  await i18n.changeLanguage('fr');
  const cause = new ExprRuntimeError('notOpen', 'FClients');
  const text = failureMessage({ macro: 'M', action: 'MessageBox', raw: {}, code: 'expression', number: 0, detail: 'notOpen', cause });
  expect(text).toContain("« FClients » n'est pas ouvert.");
  expect(text).not.toContain('formulaire');   // a form or a report: neutral (expr.error.notOpen)
});

it('a Python error in an expression carries the error message', async () => {
  await i18n.changeLanguage('fr');
  const cause = new ExprRuntimeError('pythonError', 'ZeroDivisionError: boom');
  const text = failureMessage({ macro: 'M', action: 'MessageBox', raw: {}, code: 'expression', number: 0, detail: 'pythonError', cause });
  expect(text).toContain('Erreur Python : ZeroDivisionError: boom');
});
